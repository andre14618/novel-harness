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
import { proposeChange, applyChange, revertChange, runBenchmark, getLatestScores, TARGETS } from "./improve"
import { createTuningExperiment, concludeExperiment } from "../../data/db"
import { getModelForAgent } from "../../models/roles"
import { checkBudget, recordSpend, getTodayBudget, MAX_ITERATIONS, MAX_CONSECUTIVE_FAILURES, BUDGET_ALERT_THRESHOLD } from "./budget"
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
  backup?: { filePath: string; originalContent: string }
  pendingBatchId?: number
  iterationId?: number
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
  const budget = await getTodayBudget()
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
    } : null,
    budget,
  }
}

export async function startCycle(trigger: string, override?: { target: string; dimension: string }): Promise<void> {
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

  console.log(`[daemon] Starting: ${diagnosis.target}/${diagnosis.dimension} (score: ${diagnosis.currentScore})`)

  // Create experiment in SQLite — links all benchmark runs together
  const improverModel = getModelForAgent("improver")
  const experimentId = await createTuningExperiment("improvement-daemon", `${diagnosis.target}/${diagnosis.dimension}: improve from ${diagnosis.currentScore}`, {
    target: diagnosis.target,
    dimension: diagnosis.dimension,
    improverModel: improverModel?.model ?? "unknown",
    improverProvider: improverModel?.provider ?? "unknown",
    budgetUsd: parseFloat(process.env.IMPROVEMENT_BUDGET ?? "0.80"),
    maxIterations: MAX_ITERATIONS,
    trigger,
  })
  console.log(`[daemon] Created experiment #${experimentId}`)

  // Run baseline benchmark
  console.log(`[daemon] Running baseline benchmark...`)
  const baselineResult = await runBenchmark(targetConfig.benchmarkCmd, experimentId)
  if (!baselineResult) {
    console.log("[daemon] Baseline benchmark failed, aborting")
    await concludeExperiment(experimentId, "Aborted: baseline benchmark failed")
    return
  }

  const baselineScores = await getLatestScores(diagnosis.target, diagnosis.dimension)
  const baselineScore = baselineScores?.avgScore ?? diagnosis.currentScore
  console.log(`[daemon] Baseline: ${baselineScore}/10 (run ${baselineResult.runId})`)

  const rows = await db`
    INSERT INTO improvement_cycles (trigger_type, status) VALUES (${trigger}, 'active') RETURNING id
  `
  const cycleId = (rows[0] as any).id

  activeCycle = {
    cycleId, experimentId, iterationNum: 0,
    target: diagnosis.target, dimension: diagnosis.dimension,
    currentScore: baselineScore, baselineScore,
    consecutiveFailures: 0,
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

  const budget = await checkBudget(0.015)
  if (!budget.allowed) {
    await finishCycle("budget-exhausted", `Budget: $${budget.spent.toFixed(2)}/$${(budget.spent + budget.remaining).toFixed(2)}`)
    return
  }

  cycle.iterationNum++
  const targetConfig = TARGETS[cycle.target]
  if (!targetConfig) { await finishCycle("failed", `Unknown target: ${cycle.target}`); return }

  console.log(`[daemon] Iteration ${cycle.iterationNum}: ${cycle.target}/${cycle.dimension} (current: ${cycle.currentScore})`)

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

  // Propose
  const proposal = await proposeChange(currentPrompts, cycle.dimension, cycle.currentScore, judgeReasoning)
  if (!proposal) {
    await db`UPDATE improvement_iterations SET result = 'no-proposal', phase = 'done', finished_at = now() WHERE id = ${cycle.iterationId}`
    cycle.consecutiveFailures++
    if (cycle.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      await finishCycle("completed", `${MAX_CONSECUTIVE_FAILURES} consecutive failures`)
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

  // Apply
  const backup = applyChange(proposal, targetConfig)
  if (!backup) {
    await db`UPDATE improvement_iterations SET result = 'failed', phase = 'done', finished_at = now() WHERE id = ${cycle.iterationId}`
    return
  }

  cycle.backup = backup
  await db`
    UPDATE improvement_iterations
    SET phase = 'benchmarking', proposal_explanation = ${proposal.explanation},
        agent_name = ${proposal.agentName}, file_path = ${targetFile.path},
        backup_content = ${backup.originalContent}
    WHERE id = ${cycle.iterationId}
  `

  // Benchmark
  const benchResult = await runBenchmark(targetConfig.benchmarkCmd, cycle.experimentId)
  if (!benchResult) {
    console.log("[daemon] Benchmark failed, reverting")
    revertChange(backup.filePath, backup.originalContent)
    await db`UPDATE improvement_iterations SET result = 'failed', phase = 'done', finished_at = now() WHERE id = ${cycle.iterationId}`
    cycle.consecutiveFailures++
    if (cycle.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
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

  const iterCost = 0.011
  await recordSpend(iterCost)
  await db`UPDATE improvement_iterations SET cost_usd = ${iterCost} WHERE id = ${cycle.iterationId}`
  await db`UPDATE improvement_cycles SET total_iterations = ${cycle.iterationNum}, total_cost_usd = total_cost_usd + ${iterCost} WHERE id = ${cycle.cycleId}`

  if (improved) {
    console.log(`[daemon] KEPT: ${cycle.currentScore} → ${newScores.avgScore} (${delta >= 0 ? "+" : ""}${delta})`)
    cycle.currentScore = newScores.avgScore
    cycle.consecutiveFailures = 0
    await db`UPDATE improvement_cycles SET kept_count = kept_count + 1 WHERE id = ${cycle.cycleId}`
    const budget = await getTodayBudget()
    await notify(`#${cycle.cycleId} iter ${cycle.iterationNum}: ${cycle.target}/${cycle.dimension} ${(cycle.currentScore - delta).toFixed(1)} → ${cycle.currentScore.toFixed(1)} (kept)`, `$${budget.spent.toFixed(2)} spent`)
  } else {
    console.log(`[daemon] REVERTED: ${cycle.currentScore} → ${newScores.avgScore} (${delta >= 0 ? "+" : ""}${delta})`)
    if (cycle.backup) revertChange(cycle.backup.filePath, cycle.backup.originalContent)
    cycle.consecutiveFailures++
  }

  cycle.backup = undefined
  cycle.pendingBatchId = undefined

  // Budget alert
  const budget = await getTodayBudget()
  if (budget.spent / budget.budget >= BUDGET_ALERT_THRESHOLD) {
    await notify(`Budget ${Math.round(budget.spent / budget.budget * 100)}%`, `$${budget.spent.toFixed(2)}/$${budget.budget.toFixed(2)}`)
  }

  // Stop conditions
  if (cycle.iterationNum >= MAX_ITERATIONS) { await finishCycle("completed", `Max iterations (${MAX_ITERATIONS})`); return }
  if (cycle.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) { await finishCycle("completed", `${MAX_CONSECUTIVE_FAILURES} consecutive failures`); return }
  if (!budget.allowed) { await finishCycle("budget-exhausted", `$${budget.spent.toFixed(2)}/$${budget.budget.toFixed(2)}`); return }

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
  const budget = await getTodayBudget()

  // Run validation benchmark to confirm results outside the loop
  const targetConfig = TARGETS[cycle.target]
  let validationScore: number | null = null
  if (targetConfig && cycle.iterationNum > 0) {
    console.log(`[daemon] Running validation benchmark...`)
    const valResult = await runBenchmark(targetConfig.benchmarkCmd, cycle.experimentId)
    if (valResult) {
      const valScores = await getLatestScores(cycle.target, cycle.dimension)
      validationScore = valScores?.avgScore ?? null
      console.log(`[daemon] Validation: ${validationScore}/10 (run ${valResult.runId})`)
    }
  }

  const valStr = validationScore !== null ? `, validation: ${validationScore}` : ""
  const summary = `${cycle.target}/${cycle.dimension}: ${cycle.baselineScore} → ${cycle.currentScore} (${totalDelta >= 0 ? "+" : ""}${totalDelta}${valStr}). ${cycle.iterationNum} iters, $${budget.spent.toFixed(2)}. ${reason}`

  await db`UPDATE improvement_cycles SET status = ${status}, finished_at = now(), summary = ${summary}, total_iterations = ${cycle.iterationNum} WHERE id = ${cycle.cycleId}`

  // Conclude the experiment in Postgres
  await concludeExperiment(cycle.experimentId, summary)
  console.log(`[daemon] Experiment #${cycle.experimentId} concluded`)

  await notify(`Cycle #${cycle.cycleId} ${status}`, `${summary}\nExperiment: #${cycle.experimentId}\n\nSync: bash scripts/sync-improvements.sh`)
  console.log(`[daemon] Cycle #${cycle.cycleId} ${status}: ${summary}`)
  activeCycle = null
}

// Run crash recovery on import
await recoverActiveCycle()
