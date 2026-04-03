/**
 * Improvement daemon state machine.
 *
 * Manages the autonomous improvement cycle:
 * IDLE → DIAGNOSING → PROPOSING → BENCHMARKING → JUDGING → EVALUATING → IDLE
 *
 * Called by server.ts (manual trigger, nightly schedule) and poller.ts (batch complete events).
 * Does not run its own HTTP server — just exports functions.
 */

import { readFileSync } from "node:fs"
import db from "./db"
import { createOrchestratorBatch } from "./db"
import { diagnose, diagnoseFor } from "./diagnose"
import { proposeChange, applyChange, revertChange, runBenchmark, getLatestScores, TARGETS, buildImproverContext, synthesizeConclusion } from "./improve"
import { generate as atomicGenerate, judge as atomicJudge } from "./atomic"
import { getDaemonTargetFull } from "../../benchmark/registry"
import { createTuningExperiment, concludeExperiment } from "../../data/db"
import { getModelForAgent } from "../../models/roles"
import { type ExperimentLimits, resolveDefaults, checkLimits, getExperimentActualCost } from "./experiment-limits"
import { validateProposal } from "./guardrails"

const HARNESS_ROOT = process.env.HARNESS_ROOT ?? "/home/andre/apps/novel-harness"
const NOTIFY_URL = process.env.NOTIFY_URL ?? "http://localhost:2586"
const NOTIFY_TOPIC = process.env.NOTIFY_TOPIC ?? "novel-harness-batch"
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL

// ── State ───────────────────────────────────────────────────────────────

interface ActiveCycle {
  cycleId: number
  experimentId: number
  iterationNum: number
  target: string
  dimension: string
  currentScore: number
  baselineScore: number
  consecutiveFailures: number
  limits: ExperimentLimits
  backup?: { filePath: string; originalContent: string }
  pendingBatchId?: number
  iterationId?: number
  /** When true, uses atomic generate+judge instead of subprocess benchmark */
  useAtomic: boolean
  /** Proposal kept in memory for atomic mode — only written to disk when kept */
  pendingProposal?: { agentName: string; newPrompt: string; explanation: string; filePath: string }
}

let activeCycle: ActiveCycle | null = null

// ── Notifications ───────────────────────────────────────────────────────

async function notify(title: string, body: string) {
  try {
    const headers: Record<string, string> = { "Title": title }
    if (NOTIFY_EMAIL) headers["Email"] = NOTIFY_EMAIL
    await fetch(`${NOTIFY_URL}/${NOTIFY_TOPIC}`, { method: "POST", headers, body })
  } catch (err) {
    console.error("[daemon:notify] Failed:", err instanceof Error ? err.message : err)
  }
}

// ── Public API ──────────────────────────────────────────────────────────

export async function getDaemonStatus() {
  const actualCost = activeCycle ? await getExperimentActualCost(activeCycle.experimentId) : 0
  return {
    active: !!activeCycle,
    cycle: activeCycle ? {
      id: activeCycle.cycleId,
      experimentId: activeCycle.experimentId,
      target: activeCycle.target,
      dimension: activeCycle.dimension,
      iteration: activeCycle.iterationNum,
      currentScore: activeCycle.currentScore,
      baselineScore: activeCycle.baselineScore,
      consecutiveFailures: activeCycle.consecutiveFailures,
      pendingBatchId: activeCycle.pendingBatchId,
      limits: activeCycle.limits,
      actualCost,
    } : null,
  }
}

export async function startCycle(trigger: string, override?: { target: string; dimension: string }, limitsConfig?: Partial<ExperimentLimits>): Promise<void> {
  if (activeCycle) {
    console.log("[daemon] Cycle already active, ignoring")
    return
  }

  const diagnosis = override
    ? await diagnoseFor(override.target, override.dimension)
    : await diagnose()
  if (!diagnosis) {
    console.log("[daemon] No improvement target found")
    return
  }

  const targetConfig = TARGETS[diagnosis.target]
  if (!targetConfig) {
    console.log(`[daemon] Unknown target: ${diagnosis.target}`)
    return
  }

  // Check if this benchmark supports atomic ops
  const fullTarget = getDaemonTargetFull(diagnosis.target)
  const useAtomic = !!fullTarget?.supportsAtomic

  console.log(`[daemon] Starting: ${diagnosis.target}/${diagnosis.dimension} (score: ${diagnosis.currentScore}, atomic: ${useAtomic})`)

  // Create experiment — links all benchmark runs together
  const limits = resolveDefaults(limitsConfig)
  const improverModel = getModelForAgent("improver")
  const experimentId = await createTuningExperiment("improvement-daemon", `${diagnosis.target}/${diagnosis.dimension}: improve from ${diagnosis.currentScore}`, {
    target: diagnosis.target,
    dimension: diagnosis.dimension,
    improverModel: improverModel?.model ?? "unknown",
    improverProvider: improverModel?.provider ?? "unknown",
    maxIterations: limits.maxIterations,
    maxCostUsd: limits.maxCostUsd,
    trigger,
    mode: useAtomic ? "atomic" : "subprocess",
  })
  console.log(`[daemon] Created experiment #${experimentId}`)

  // Run baseline — atomic if supported, subprocess otherwise
  console.log(`[daemon] Running baseline...`)
  let baselineScore: number

  if (useAtomic && fullTarget) {
    const seeds = fullTarget.loadInputs(fullTarget.supportsAtomic
      ? (fullTarget as any).daemonEnv?.BENCHMARK_SEEDS?.split(",") ?? undefined
      : undefined
    )
    const seedNames = seeds.length > 0
      ? seeds.map(s => s.name)
      : [targetConfig.promptFiles[0]?.agentName ? "romance-drama" : "romance-drama"]

    const baselineGens = await Promise.all(
      seedNames.map(seedName => atomicGenerate({
        benchmarkType: diagnosis.target,
        seedName,
        experimentId,
      }))
    )
    const successfulGens = baselineGens.filter(Boolean) as NonNullable<typeof baselineGens[number]>[]

    if (successfulGens.length === 0) {
      console.log("[daemon] Baseline generation failed, aborting")
      await concludeExperiment(experimentId, "Aborted: baseline generation failed")
      return
    }

    const baselineJudges = await Promise.all(
      successfulGens.map(gen => atomicJudge({
        generationId: gen.generationId,
        dimension: diagnosis.dimension,
        benchmarkType: diagnosis.target,
        seedName: undefined,
      }))
    )
    const successfulJudges = baselineJudges.filter(Boolean) as NonNullable<typeof baselineJudges[number]>[]

    if (successfulJudges.length === 0) {
      console.log("[daemon] Baseline judging failed, aborting")
      await concludeExperiment(experimentId, "Aborted: baseline judging failed")
      return
    }

    baselineScore = successfulJudges.reduce((s, j) => s + j.score, 0) / successfulJudges.length
    baselineScore = Math.round(baselineScore * 10) / 10
  } else {
    const baselineResult = await runBenchmark(targetConfig.benchmarkCmd, experimentId)
    if (!baselineResult) {
      console.log("[daemon] Baseline benchmark failed, aborting")
      await concludeExperiment(experimentId, "Aborted: baseline benchmark failed")
      return
    }
    const baselineScores = await getLatestScores(diagnosis.target, diagnosis.dimension)
    baselineScore = baselineScores?.avgScore ?? diagnosis.currentScore
  }

  console.log(`[daemon] Baseline: ${baselineScore}/10`)

  const rows = await db`
    INSERT INTO improvement_cycles (trigger_type, status, experiment_id, max_iterations, max_cost_usd)
    VALUES (${trigger}, 'active', ${experimentId}, ${limits.maxIterations}, ${limits.maxCostUsd})
    RETURNING id
  `
  const cycleId = (rows[0] as any).id

  activeCycle = {
    cycleId, experimentId, iterationNum: 0,
    target: diagnosis.target, dimension: diagnosis.dimension,
    currentScore: baselineScore, baselineScore,
    consecutiveFailures: 0, limits,
    useAtomic,
  }

  await notify(`Improvement cycle #${cycleId} started`, `Target: ${diagnosis.target}/${diagnosis.dimension} (baseline: ${baselineScore})\nExperiment: #${experimentId}\nTrigger: ${trigger}`)
  await runIteration(diagnosis.judgeReasoning)
}

export async function handleBatchComplete(batchId: number): Promise<void> {
  if (!activeCycle || activeCycle.pendingBatchId !== batchId) return
  console.log(`[daemon] Batch ${batchId} complete, evaluating iteration ${activeCycle.iterationNum}`)

  // Collect results into local SQLite via the harness collect script
  const proc = Bun.spawn(["bun", "benchmark/batch/collect.ts"], {
    cwd: HARNESS_ROOT, stdout: "pipe", stderr: "pipe", env: { ...process.env },
  })
  await proc.exited

  await evaluateIteration([])
}

// ── Crash recovery (called on startup) ──────────────────────────────────

export async function recoverActiveCycle(): Promise<void> {
  const rows = await db`SELECT id FROM improvement_cycles WHERE status = 'active' LIMIT 1`
  if (rows.length === 0) return

  const cycleId = (rows[0] as any).id
  console.log(`[daemon] Found active cycle #${cycleId} from previous run, marking failed`)

  const pending = await db`
    SELECT id, file_path, backup_content FROM improvement_iterations
    WHERE cycle_id = ${cycleId} AND phase NOT IN ('done') AND backup_content IS NOT NULL
  `
  for (const iter of pending as any[]) {
    if (iter.file_path && iter.backup_content) {
      console.log(`[daemon] Reverting pending change to ${iter.file_path}`)
      revertChange(iter.file_path, iter.backup_content)
    }
    await db`UPDATE improvement_iterations SET result = 'failed', phase = 'done', finished_at = now() WHERE id = ${iter.id}`
  }

  await db`UPDATE improvement_cycles SET status = 'failed', finished_at = now(), summary = 'Daemon restarted — reverted pending changes' WHERE id = ${cycleId}`
}

// ── Internal iteration logic ────────────────────────────────────────────

async function runIteration(judgeReasoning: string[]): Promise<void> {
  if (!activeCycle) return
  const cycle = activeCycle

  const costBeforeIter = await getExperimentActualCost(cycle.experimentId)
  const check = checkLimits(costBeforeIter, cycle.iterationNum, cycle.consecutiveFailures, cycle.limits)
  if (!check.allowed) {
    await finishCycle("completed", check.reason ?? "Limit reached")
    return
  }

  cycle.iterationNum++
  const targetConfig = TARGETS[cycle.target]
  if (!targetConfig) { await finishCycle("failed", `Unknown target: ${cycle.target}`); return }

  console.log(`[daemon] Iteration ${cycle.iterationNum}: ${cycle.target}/${cycle.dimension} (current: ${cycle.currentScore}, atomic: ${cycle.useAtomic})`)

  const iterRows = await db`
    INSERT INTO improvement_iterations (cycle_id, iteration_num, target, dimension, phase, baseline_score)
    VALUES (${cycle.cycleId}, ${cycle.iterationNum}, ${cycle.target}, ${cycle.dimension}, 'proposing', ${cycle.currentScore})
    RETURNING id
  `
  cycle.iterationId = (iterRows[0] as any).id

  // Read current prompts
  const currentPrompts = targetConfig.promptFiles.map(f => ({
    agentName: f.agentName,
    content: readFileSync(`${HARNESS_ROOT}/${f.path}`, "utf-8"),
  }))

  // Build rich context for the improver
  const promptFile = targetConfig.promptFiles[0]
  const improverContext = await buildImproverContext(
    cycle.cycleId, cycle.target, cycle.dimension,
    promptFile?.path ?? "",
  )

  // Propose
  const proposal = await proposeChange(currentPrompts, cycle.dimension, cycle.currentScore, judgeReasoning, improverContext)
  if (!proposal) {
    await db`UPDATE improvement_iterations SET result = 'no-proposal', phase = 'done', finished_at = now() WHERE id = ${cycle.iterationId}`
    cycle.consecutiveFailures++
    if (cycle.consecutiveFailures >= cycle.limits.maxConsecutiveFailures) {
      await finishCycle("completed", `${cycle.limits.maxConsecutiveFailures} consecutive failures`)
      return
    }
    await runIteration(judgeReasoning)
    return
  }

  // Validate
  const targetFile = targetConfig.promptFiles.find(f => f.agentName === proposal.agentName)
  if (!targetFile) {
    await db`UPDATE improvement_iterations SET result = 'failed', phase = 'done', finished_at = now() WHERE id = ${cycle.iterationId}`
    await runIteration(judgeReasoning)
    return
  }

  const validation = validateProposal({
    agentName: proposal.agentName, filePath: targetFile.path,
    newContent: proposal.newPrompt, explanation: proposal.explanation,
  }, HARNESS_ROOT)

  if (!validation.valid) {
    console.log(`[daemon] Proposal rejected: ${validation.reason}`)
    await db`UPDATE improvement_iterations SET result = 'failed', phase = 'done', finished_at = now() WHERE id = ${cycle.iterationId}`
    await runIteration(judgeReasoning)
    return
  }

  // Store both original and proposed content for all attempts (enables conclusion diffs)
  const originalContent = currentPrompts.find(p => p.agentName === proposal.agentName)?.content ?? ""
  await db`
    UPDATE improvement_iterations
    SET phase = 'benchmarking', proposal_explanation = ${proposal.explanation},
        agent_name = ${proposal.agentName}, file_path = ${targetFile.path},
        proposed_content = ${proposal.newPrompt},
        backup_content = ${originalContent}
    WHERE id = ${cycle.iterationId}
  `

  // ── Atomic mode: generate + judge in-process, no disk writes ──────
  if (cycle.useAtomic) {
    const fullTarget = getDaemonTargetFull(cycle.target)
    if (!fullTarget) { await finishCycle("failed", `Target lost: ${cycle.target}`); return }

    // Determine seeds for daemon runs
    const daemonSeeds = fullTarget.loadInputs(
      (TARGETS[cycle.target] as any)?.daemonEnv?.BENCHMARK_SEEDS?.split(",") ?? undefined
    )
    const seedNames = daemonSeeds.length > 0 ? daemonSeeds.map(s => s.name) : ["romance-drama"]

    // Generate with prompt override (in-memory, no disk write)
    const gens = await Promise.all(
      seedNames.map(seedName => atomicGenerate({
        benchmarkType: cycle.target,
        seedName,
        promptOverride: proposal.newPrompt,
        agentName: proposal.agentName,
        experimentId: cycle.experimentId,
      }))
    )
    const successfulGens = gens.filter(Boolean) as NonNullable<typeof gens[number]>[]

    if (successfulGens.length === 0) {
      console.log("[daemon] Atomic generation failed")
      await db`UPDATE improvement_iterations SET result = 'failed', phase = 'done', finished_at = now() WHERE id = ${cycle.iterationId}`
      cycle.consecutiveFailures++
      if (cycle.consecutiveFailures >= cycle.limits.maxConsecutiveFailures) {
        await finishCycle("completed", "Generation failures"); return
      }
      await runIteration(judgeReasoning); return
    }

    // Judge only the target dimension
    const judges = await Promise.all(
      successfulGens.map(gen => atomicJudge({
        generationId: gen.generationId,
        dimension: cycle.dimension,
        benchmarkType: cycle.target,
      }))
    )
    const successfulJudges = judges.filter(Boolean) as NonNullable<typeof judges[number]>[]

    if (successfulJudges.length === 0) {
      console.log("[daemon] Atomic judging failed")
      await db`UPDATE improvement_iterations SET result = 'failed', phase = 'done', finished_at = now() WHERE id = ${cycle.iterationId}`
      cycle.consecutiveFailures++
      if (cycle.consecutiveFailures >= cycle.limits.maxConsecutiveFailures) {
        await finishCycle("completed", "Judging failures"); return
      }
      await runIteration(judgeReasoning); return
    }

    // Compute average score
    const newScore = Math.round(
      (successfulJudges.reduce((s, j) => s + j.score, 0) / successfulJudges.length) * 10
    ) / 10

    // Store proposal for potential disk write if kept
    cycle.pendingProposal = {
      agentName: proposal.agentName,
      newPrompt: proposal.newPrompt,
      explanation: proposal.explanation,
      filePath: targetFile.path,
    }

    await db`UPDATE improvement_iterations SET run_id = ${successfulGens[0].runId}, phase = 'evaluating' WHERE id = ${cycle.iterationId}`
    await evaluateIterationAtomic(newScore, judgeReasoning)
    return
  }

  // ── Subprocess mode: write to disk, run full benchmark ────────────
  const backup = applyChange(proposal, targetConfig)
  if (!backup) {
    await db`UPDATE improvement_iterations SET result = 'failed', phase = 'done', finished_at = now() WHERE id = ${cycle.iterationId}`
    return
  }

  cycle.backup = backup
  await db`
    UPDATE improvement_iterations
    SET backup_content = ${backup.originalContent},
        proposed_content = ${proposal.newPrompt}
    WHERE id = ${cycle.iterationId}
  `

  const benchResult = await runBenchmark(targetConfig.benchmarkCmd, cycle.experimentId)
  if (!benchResult) {
    console.log("[daemon] Benchmark failed, reverting")
    revertChange(backup.filePath, backup.originalContent)
    await db`UPDATE improvement_iterations SET result = 'failed', phase = 'done', finished_at = now() WHERE id = ${cycle.iterationId}`
    cycle.consecutiveFailures++
    if (cycle.consecutiveFailures >= cycle.limits.maxConsecutiveFailures) {
      await finishCycle("completed", "Benchmark failures")
      return
    }
    await runIteration(judgeReasoning)
    return
  }

  await db`UPDATE improvement_iterations SET run_id = ${benchResult.runId}, phase = 'judging' WHERE id = ${cycle.iterationId}`

  // If prose --batch, the batch was submitted by run.ts. Wait for it.
  const batchMatch = benchResult.stdout.match(/Provider batch ID: (batch_\w+)/)
  if (batchMatch) {
    const providerBatchId = batchMatch[1]
    const orchBatchId = await createOrchestratorBatch(
      providerBatchId, "openai", "gpt-5.4-mini", 0,
      benchResult.runId, 0, `improvement cycle #${cycle.cycleId} iter ${cycle.iterationNum}`,
    )
    cycle.pendingBatchId = orchBatchId
    await db`UPDATE improvement_iterations SET batch_id = ${orchBatchId} WHERE id = ${cycle.iterationId}`
    console.log(`[daemon] Waiting for batch ${orchBatchId} (${providerBatchId})`)
    return // poller will call handleBatchComplete when done
  }

  // Non-prose benchmarks judge in real-time — evaluate now
  await evaluateIteration(judgeReasoning)
}

/**
 * Evaluate an atomic iteration — score was computed in-process, no DB lookup needed.
 * If kept, writes the proposal to disk. If reverted, nothing touches the filesystem.
 */
async function evaluateIterationAtomic(newScore: number, judgeReasoning: string[]): Promise<void> {
  if (!activeCycle) return
  const cycle = activeCycle

  const delta = Math.round((newScore - cycle.currentScore) * 10) / 10
  const improved = delta > 0

  await db`
    UPDATE improvement_iterations
    SET new_score = ${newScore}, delta = ${delta},
        result = ${improved ? 'kept' : 'reverted'}, phase = 'done', finished_at = now()
    WHERE id = ${cycle.iterationId}
  `

  // Update with real costs from llm_calls
  const actualCost = await getExperimentActualCost(cycle.experimentId)
  await db`UPDATE improvement_cycles SET total_iterations = ${cycle.iterationNum}, total_cost_usd = ${actualCost} WHERE id = ${cycle.cycleId}`

  if (improved && cycle.pendingProposal) {
    console.log(`[daemon] KEPT: ${cycle.currentScore} → ${newScore} (${delta >= 0 ? "+" : ""}${delta})`)
    // Write to disk only when keeping a change
    const targetConfig = TARGETS[cycle.target]
    if (targetConfig) {
      const backup = applyChange(cycle.pendingProposal, targetConfig)
      if (backup) {
        // Save backup content so crash recovery can revert if needed
        await db`UPDATE improvement_iterations SET backup_content = ${backup.originalContent} WHERE id = ${cycle.iterationId}`
      }
    }
    cycle.currentScore = newScore
    cycle.consecutiveFailures = 0
    await db`UPDATE improvement_cycles SET kept_count = kept_count + 1 WHERE id = ${cycle.cycleId}`
  } else {
    console.log(`[daemon] REVERTED: ${cycle.currentScore} → ${newScore} (${delta >= 0 ? "+" : ""}${delta})`)
    // No disk revert needed — prompt override was in-memory only
    cycle.consecutiveFailures++
  }

  cycle.pendingProposal = undefined

  // Check limits for next iteration
  const check = checkLimits(actualCost, cycle.iterationNum, cycle.consecutiveFailures, cycle.limits)
  if (!check.allowed) { await finishCycle("completed", check.reason ?? "Limit reached"); return }

  // Re-diagnose
  const newDiagnosis = await diagnose()
  if (newDiagnosis && (newDiagnosis.target !== cycle.target || newDiagnosis.dimension !== cycle.dimension)) {
    console.log(`[daemon] Switching: ${cycle.target}/${cycle.dimension} → ${newDiagnosis.target}/${newDiagnosis.dimension}`)
    cycle.target = newDiagnosis.target
    cycle.dimension = newDiagnosis.dimension
    cycle.currentScore = newDiagnosis.currentScore
    // Re-check atomic support for new target
    const newFullTarget = getDaemonTargetFull(newDiagnosis.target)
    cycle.useAtomic = !!newFullTarget?.supportsAtomic
    judgeReasoning = newDiagnosis.judgeReasoning
  }

  await runIteration(newDiagnosis?.judgeReasoning ?? judgeReasoning)
}

async function evaluateIteration(judgeReasoning: string[]): Promise<void> {
  if (!activeCycle) return
  const cycle = activeCycle

  await db`UPDATE improvement_iterations SET phase = 'evaluating' WHERE id = ${cycle.iterationId}`

  const newScores = await getLatestScores(cycle.target, cycle.dimension)
  if (!newScores) {
    console.log("[daemon] No scores, reverting")
    if (cycle.backup) revertChange(cycle.backup.filePath, cycle.backup.originalContent)
    await db`UPDATE improvement_iterations SET result = 'failed', phase = 'done', finished_at = now() WHERE id = ${cycle.iterationId}`
    cycle.consecutiveFailures++
    return
  }

  const delta = Math.round((newScores.avgScore - cycle.currentScore) * 10) / 10
  const improved = delta > 0

  await db`
    UPDATE improvement_iterations
    SET new_score = ${newScores.avgScore}, delta = ${delta},
        result = ${improved ? 'kept' : 'reverted'}, phase = 'done', finished_at = now()
    WHERE id = ${cycle.iterationId}
  `

  // Update with real costs from llm_calls
  const actualCost = await getExperimentActualCost(cycle.experimentId)
  await db`UPDATE improvement_cycles SET total_iterations = ${cycle.iterationNum}, total_cost_usd = ${actualCost} WHERE id = ${cycle.cycleId}`

  if (improved) {
    console.log(`[daemon] KEPT: ${cycle.currentScore} → ${newScores.avgScore} (${delta >= 0 ? "+" : ""}${delta})`)
    cycle.currentScore = newScores.avgScore
    cycle.consecutiveFailures = 0
    await db`UPDATE improvement_cycles SET kept_count = kept_count + 1 WHERE id = ${cycle.cycleId}`
  } else {
    console.log(`[daemon] REVERTED: ${cycle.currentScore} → ${newScores.avgScore} (${delta >= 0 ? "+" : ""}${delta})`)
    if (cycle.backup) revertChange(cycle.backup.filePath, cycle.backup.originalContent)
    cycle.consecutiveFailures++
  }

  cycle.backup = undefined
  cycle.pendingBatchId = undefined

  // Check limits for next iteration
  const check = checkLimits(actualCost, cycle.iterationNum, cycle.consecutiveFailures, cycle.limits)
  if (!check.allowed) { await finishCycle("completed", check.reason ?? "Limit reached"); return }

  // Re-diagnose
  const newDiagnosis = await diagnose()
  if (newDiagnosis && (newDiagnosis.target !== cycle.target || newDiagnosis.dimension !== cycle.dimension)) {
    console.log(`[daemon] Switching: ${cycle.target}/${cycle.dimension} → ${newDiagnosis.target}/${newDiagnosis.dimension}`)
    cycle.target = newDiagnosis.target
    cycle.dimension = newDiagnosis.dimension
    cycle.currentScore = newDiagnosis.currentScore
    judgeReasoning = newDiagnosis.judgeReasoning
  }

  await runIteration(newDiagnosis?.judgeReasoning ?? judgeReasoning)
}

async function finishCycle(status: string, reason: string): Promise<void> {
  if (!activeCycle) return
  const cycle = activeCycle
  const totalDelta = Math.round((cycle.currentScore - cycle.baselineScore) * 10) / 10
  const actualCost = await getExperimentActualCost(cycle.experimentId)

  // All-dimensions regression check: judge existing generations on remaining dimensions.
  // Uses prefix caching — the generation content is already cached from target dimension judging.
  // DeepSeek is the recommended judge for this step: 95% input cache discount makes judging
  // all remaining dimensions nearly free (~$0.005 for 20 calls). Other providers work but
  // cost 10-50x more without prefix caching. Configure the judge in models/roles.ts.
  const fullTarget = getDaemonTargetFull(cycle.target)
  let regressionReport = ""
  if (fullTarget && cycle.iterationNum > 0) {
    // Find the last kept iteration's run to get its generations
    const lastKept = await db`
      SELECT run_id FROM improvement_iterations
      WHERE cycle_id = ${cycle.cycleId} AND result = 'kept' AND run_id IS NOT NULL
      ORDER BY iteration_num DESC LIMIT 1
    ` as any[]

    if (lastKept.length > 0) {
      const harnessDb = (await import("../../data/connection")).default
      const gens = await harnessDb`
        SELECT id, seed FROM generations
        WHERE run_id = ${lastKept[0].run_id} AND passed = true
      ` as any[]

      if (gens.length > 0) {
        const otherDimensions = fullTarget.dimensions.filter(d => d !== cycle.dimension)
        if (otherDimensions.length > 0) {
          console.log(`[daemon] Regression check: ${gens.length} generations × ${otherDimensions.length} dimensions`)

          const judgeResults = await Promise.all(
            gens.flatMap((gen: any) =>
              otherDimensions.map(dim => atomicJudge({
                generationId: gen.id,
                dimension: dim,
                benchmarkType: cycle.target,
                seedName: gen.seed,
              }))
            )
          )

          // Aggregate per-dimension
          const dimScores: Record<string, number[]> = {}
          for (let i = 0; i < judgeResults.length; i++) {
            const dim = otherDimensions[i % otherDimensions.length]
            if (judgeResults[i]) {
              dimScores[dim] = dimScores[dim] ?? []
              dimScores[dim].push(judgeResults[i]!.score)
            }
          }

          const lines: string[] = []
          for (const [dim, scores] of Object.entries(dimScores)) {
            const avg = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
            lines.push(`${dim}: ${avg}/10`)
          }
          regressionReport = lines.join(", ")
          console.log(`[daemon] Other dimensions: ${regressionReport}`)
        }
      }
    }
  }

  const regStr = regressionReport ? `, other dims: ${regressionReport}` : ""
  const statsSummary = `${cycle.target}/${cycle.dimension}: ${cycle.baselineScore} → ${cycle.currentScore} (${totalDelta >= 0 ? "+" : ""}${totalDelta}${regStr}). ${cycle.iterationNum} iters, $${actualCost.toFixed(4)}. ${reason}`

  // Synthesize a strategic conclusion from diffs + scores + reasoning
  let conclusion = statsSummary
  if (cycle.iterationNum > 0) {
    console.log(`[daemon] Synthesizing conclusion...`)
    const synthesized = await synthesizeConclusion(
      cycle.cycleId, cycle.target, cycle.dimension,
      cycle.baselineScore, cycle.currentScore,
    )
    if (synthesized) {
      conclusion = `${statsSummary}\n\n${synthesized}`
      console.log(`[daemon] Conclusion: ${synthesized.slice(0, 200)}...`)
    }
  }

  await db`UPDATE improvement_cycles SET status = ${status}, finished_at = now(), summary = ${conclusion}, total_iterations = ${cycle.iterationNum}, total_cost_usd = ${actualCost} WHERE id = ${cycle.cycleId}`

  // Conclude the experiment in Postgres
  await concludeExperiment(cycle.experimentId, conclusion)
  console.log(`[daemon] Experiment #${cycle.experimentId} concluded`)

  await notify(`Cycle #${cycle.cycleId} ${status}`, `${conclusion}\nExperiment: #${cycle.experimentId}\n\nSync: bash scripts/sync-improvements.sh`)
  console.log(`[daemon] Cycle #${cycle.cycleId} ${status}: ${statsSummary}`)
  activeCycle = null
}

// Run crash recovery on import
await recoverActiveCycle()
