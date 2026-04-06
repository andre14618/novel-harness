/**
 * Improvement daemon state machine.
 *
 * Manages the autonomous improvement cycle:
 * IDLE → DIAGNOSING → PROPOSING → BENCHMARKING → JUDGING → EVALUATING → IDLE
 *
 * Uses the harness service layer (src/harness/) for all data access.
 */

import { readFileSync } from "node:fs"
import * as harness from "../harness"
import { diagnose, diagnoseFor } from "./diagnose"
import {
  proposeChange, applyChange, revertChange, runBenchmark, TARGETS, buildImproverContext, synthesizeConclusion,
  getConfigComponentsForDimension, loadConfigValues, proposeConfigChange, applyConfigChange, revertConfigChange,
  getTemplateComponentsForDimension, proposeTemplateChange, applyTemplateChange, revertTemplateChange,
} from "./improve"
import { generate as atomicGenerate, judge as atomicJudge } from "./atomic"
import { getDaemonTargetFull } from "../../benchmark/registry"
import { getModelForAgent } from "../../models/roles"
import { type ExperimentLimits, resolveDefaults, checkLimits, getExperimentActualCost } from "./experiment-limits"
import { validateProposal, validateConfigProposal, validateTemplateProposal } from "./guardrails"

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
  configBackup?: { table: string; column: string; oldValue: number; novelId: string }
  templateBackup?: { sourceType: string; oldTemplate: string; storage?: string }
  pendingBatchId?: number
  iterationId?: number
  useAtomic: boolean
  dimensionLocked: boolean
  pendingProposal?: { agentName: string; newPrompt: string; explanation: string; filePath: string }
  pendingConfigProposal?: { componentId: string; newValue: number; explanation: string }
  /** Novel ID used for config tuning (from context benchmark) */
  configNovelId?: string
  /** Track iteration type so evaluator knows how to revert */
  iterationType?: "prompt" | "config" | "template"
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

export async function startCycle(trigger: string, override?: { target: string; dimension: string }, limitsConfig?: Partial<ExperimentLimits>, options?: { dimensionLocked?: boolean }): Promise<void> {
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

  const fullTarget = getDaemonTargetFull(diagnosis.target)
  const useAtomic = !!fullTarget?.supportsAtomic
  const dimensionLocked = options?.dimensionLocked ?? true
  const limits = resolveDefaults(limitsConfig, dimensionLocked)

  console.log(`[daemon] Starting: ${diagnosis.target}/${diagnosis.dimension} (score: ${diagnosis.currentScore}, atomic: ${useAtomic})`)

  const improverModel = getModelForAgent("improver")
  const experimentId = await harness.experiments.createTuningExperiment("improvement-daemon", `${diagnosis.target}/${diagnosis.dimension}: improve from ${diagnosis.currentScore}`, {
    target: diagnosis.target,
    dimension: diagnosis.dimension,
    improverModel: improverModel?.model ?? "unknown",
    improverProvider: improverModel?.provider ?? "unknown",
    maxIterations: limits.maxIterations,
    maxCostUsd: limits.maxCostUsd,
    trigger,
    mode: useAtomic ? "atomic" : "subprocess",
    dimensionLocked,
  }, { target: diagnosis.target, dimension: diagnosis.dimension })
  console.log(`[daemon] Created experiment #${experimentId} (locked: ${dimensionLocked})`)

  const linkedTo = await harness.experiments.autoLinkToPrior(experimentId, diagnosis.target, diagnosis.dimension)
  if (linkedTo) console.log(`[daemon] Linked to prior experiment #${linkedTo}`)

  // Run baseline
  console.log(`[daemon] Running baseline...`)
  let baselineScore: number

  if (useAtomic && fullTarget) {
    let seeds: ReturnType<typeof fullTarget.loadInputs> = []
    try { seeds = fullTarget.loadInputs() } catch {}
    const seedNames = seeds.length > 0 ? seeds.slice(0, 3).map(s => s.name) : ["romance-drama"]

    const baselineGens = await Promise.all(
      seedNames.map(seedName => atomicGenerate({ benchmarkType: diagnosis.target, seedName, experimentId }))
    )
    const successfulGens = baselineGens.filter(Boolean) as NonNullable<typeof baselineGens[number]>[]

    if (successfulGens.length === 0) {
      console.log("[daemon] Baseline generation failed, aborting")
      await harness.experiments.concludeExperiment(experimentId, "Aborted: baseline generation failed")
      return
    }

    const baselineJudges = await Promise.all(
      successfulGens.map(gen => atomicJudge({ generationId: gen.generationId, dimension: diagnosis.dimension, benchmarkType: diagnosis.target }))
    )
    const successfulJudges = baselineJudges.filter(Boolean) as NonNullable<typeof baselineJudges[number]>[]

    if (successfulJudges.length === 0) {
      console.log("[daemon] Baseline judging failed, aborting")
      await harness.experiments.concludeExperiment(experimentId, "Aborted: baseline judging failed")
      return
    }

    baselineScore = Math.round((successfulJudges.reduce((s, j) => s + j.score, 0) / successfulJudges.length) * 10) / 10
  } else {
    const baselineResult = await runBenchmark(targetConfig.benchmarkCmd, experimentId)
    if (!baselineResult) {
      console.log("[daemon] Baseline benchmark failed, aborting")
      await harness.experiments.concludeExperiment(experimentId, "Aborted: baseline benchmark failed")
      return
    }
    const baselineScores = await harness.scores.getLatestScores(diagnosis.target, diagnosis.dimension)
    baselineScore = baselineScores?.avgScore ?? diagnosis.currentScore
  }

  console.log(`[daemon] Baseline: ${baselineScore}`)

  const cycleId = await harness.cycles.createCycle({
    trigger, experimentId, maxIterations: limits.maxIterations,
    maxCostUsd: limits.maxCostUsd, target: diagnosis.target,
    dimension: diagnosis.dimension, dimensionLocked,
  })

  // Determine config novel ID for config tuning (from benchmark inputs)
  let configNovelId: string | undefined
  try {
    if (fullTarget) {
      const inputs = fullTarget.loadInputs()
      const firstWithNovel = inputs.find((i: any) => i.novelId)
      if (firstWithNovel) configNovelId = (firstWithNovel as any).novelId
    }
  } catch { /* inputs may not have novelId — that's fine */ }

  activeCycle = {
    cycleId, experimentId, iterationNum: 0,
    target: diagnosis.target, dimension: diagnosis.dimension,
    currentScore: baselineScore, baselineScore,
    consecutiveFailures: 0, limits, useAtomic, dimensionLocked,
    configNovelId,
  }

  await notify(`Improvement cycle #${cycleId} started`, `Target: ${diagnosis.target}/${diagnosis.dimension} (baseline: ${baselineScore})\nExperiment: #${experimentId}\nTrigger: ${trigger}`)
  await runIteration(diagnosis.judgeReasoning)
}

export async function handleBatchComplete(batchId: number): Promise<void> {
  if (!activeCycle || activeCycle.pendingBatchId !== batchId) return
  console.log(`[daemon] Batch ${batchId} complete, evaluating iteration ${activeCycle.iterationNum}`)

  const proc = Bun.spawn(["bun", "benchmark/batch/collect.ts"], {
    cwd: HARNESS_ROOT, stdout: "pipe", stderr: "pipe", env: { ...process.env },
  })
  await proc.exited

  await evaluateIteration([])
}

// ── Crash recovery ──────────────────────────────────────────────────────

export async function recoverActiveCycle(): Promise<void> {
  const cycleId = await harness.cycles.findActiveCycle()
  if (!cycleId) return

  console.log(`[daemon] Found active cycle #${cycleId} from previous run, marking failed`)

  const pending = await harness.cycles.getPendingIterations(cycleId)
  for (const iter of pending) {
    if (iter.filePath && iter.backupContent) {
      console.log(`[daemon] Reverting pending change to ${iter.filePath}`)
      revertChange(iter.filePath, iter.backupContent)
    }
    await harness.cycles.failIteration(iter.id)
  }

  await harness.cycles.failCycle(cycleId, "Daemon restarted — reverted pending changes")
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

  cycle.iterationId = await harness.cycles.createIteration(cycle.cycleId, cycle.iterationNum, cycle.target, cycle.dimension, cycle.currentScore)

  // Decide iteration type: rotate prompt → config → template based on iteration number and failures
  const configComponents = getConfigComponentsForDimension(cycle.dimension)
  const templateComponents = getTemplateComponentsForDimension(cycle.dimension)

  const iterMod = cycle.iterationNum % 4 // 1=prompt, 2=prompt, 3=config, 0=template
  const shouldTryConfig = configComponents.length > 0 && cycle.configNovelId && (
    iterMod === 3 || cycle.consecutiveFailures >= 2
  )
  const shouldTryTemplate = templateComponents.length > 0 && (
    iterMod === 0 || (cycle.consecutiveFailures >= 3 && !shouldTryConfig)
  )

  if (shouldTryConfig) {
    const configResult = await runConfigIteration(cycle, configComponents, judgeReasoning, targetConfig)
    if (configResult) return
    console.log(`[daemon] Config proposal failed, trying template or prompt`)
  }

  if (shouldTryTemplate || (shouldTryConfig && !shouldTryConfig)) {
    const templateResult = await runTemplateIteration(cycle, templateComponents, judgeReasoning, targetConfig)
    if (templateResult) return
    console.log(`[daemon] Template proposal failed, falling back to prompt iteration`)
  }

  // ── Prompt iteration ──────────────────────────────────────────────

  // Read current prompts
  const currentPrompts = targetConfig.promptFiles.map(f => ({
    agentName: f.agentName,
    content: readFileSync(`${HARNESS_ROOT}/${f.path}`, "utf-8"),
  }))

  // Build rich context
  const promptFile = targetConfig.promptFiles[0]
  const improverContext = await buildImproverContext(cycle.cycleId, cycle.target, cycle.dimension, promptFile?.path ?? "")

  // Propose
  const proposal = await proposeChange(currentPrompts, cycle.dimension, cycle.currentScore, judgeReasoning, improverContext, cycle.consecutiveFailures)
  if (!proposal) {
    await harness.cycles.completeIteration(cycle.iterationId, { outcome: "no-proposal" })
    cycle.consecutiveFailures++
    if (cycle.consecutiveFailures >= cycle.limits.maxConsecutiveFailures) {
      await finishCycle("completed", `${cycle.limits.maxConsecutiveFailures} consecutive failures`)
      return
    }
    await runIteration(judgeReasoning)
    return
  }
  cycle.iterationType = "prompt"

  // Validate
  const targetFile = targetConfig.promptFiles.find(f => f.agentName === proposal.agentName)
  if (!targetFile) {
    await harness.cycles.completeIteration(cycle.iterationId, { outcome: "failed" })
    await runIteration(judgeReasoning)
    return
  }

  const validation = validateProposal({
    agentName: proposal.agentName, filePath: targetFile.path,
    newContent: proposal.newPrompt, explanation: proposal.explanation,
  }, HARNESS_ROOT)

  if (!validation.valid) {
    console.log(`[daemon] Proposal rejected: ${validation.reason}`)
    await harness.cycles.completeIteration(cycle.iterationId, { outcome: "failed" })
    await runIteration(judgeReasoning)
    return
  }

  // Store proposal
  const originalContent = currentPrompts.find(p => p.agentName === proposal.agentName)?.content ?? ""
  await harness.cycles.setIterationProposal(cycle.iterationId, {
    explanation: proposal.explanation,
    agentName: proposal.agentName,
    filePath: targetFile.path,
    proposedContent: proposal.newPrompt,
    backupContent: originalContent,
  })

  // ── Atomic mode ──────────────────────────────────────────────────────
  if (cycle.useAtomic) {
    const fullTarget = getDaemonTargetFull(cycle.target)
    if (!fullTarget) { await finishCycle("failed", `Target lost: ${cycle.target}`); return }

    let daemonSeeds: ReturnType<typeof fullTarget.loadInputs> = []
    try { daemonSeeds = fullTarget.loadInputs() } catch {}
    const seedNames = daemonSeeds.length > 0 ? daemonSeeds.slice(0, 3).map(s => s.name) : ["romance-drama"]

    const gens = await Promise.all(
      seedNames.map(seedName => atomicGenerate({
        benchmarkType: cycle.target, seedName,
        promptOverride: proposal.newPrompt, agentName: proposal.agentName,
        experimentId: cycle.experimentId,
      }))
    )
    const successfulGens = gens.filter(Boolean) as NonNullable<typeof gens[number]>[]

    if (successfulGens.length === 0) {
      console.log("[daemon] Atomic generation failed")
      await harness.cycles.completeIteration(cycle.iterationId, { outcome: "failed" })
      cycle.consecutiveFailures++
      if (cycle.consecutiveFailures >= cycle.limits.maxConsecutiveFailures) {
        await finishCycle("completed", "Generation failures"); return
      }
      await runIteration(judgeReasoning); return
    }

    const judges = await Promise.all(
      successfulGens.map(gen => atomicJudge({
        generationId: gen.generationId, dimension: cycle.dimension,
        benchmarkType: cycle.target,
      }))
    )
    const successfulJudges = judges.filter(Boolean) as NonNullable<typeof judges[number]>[]

    if (successfulJudges.length === 0) {
      console.log("[daemon] Atomic judging failed")
      await harness.cycles.completeIteration(cycle.iterationId, { outcome: "failed" })
      cycle.consecutiveFailures++
      if (cycle.consecutiveFailures >= cycle.limits.maxConsecutiveFailures) {
        await finishCycle("completed", "Judging failures"); return
      }
      await runIteration(judgeReasoning); return
    }

    const newScore = Math.round((successfulJudges.reduce((s, j) => s + j.score, 0) / successfulJudges.length) * 10) / 10

    cycle.pendingProposal = {
      agentName: proposal.agentName, newPrompt: proposal.newPrompt,
      explanation: proposal.explanation, filePath: targetFile.path,
    }

    await harness.cycles.setIterationRunId(cycle.iterationId, successfulGens[0].runId)
    await evaluateIterationAtomic(newScore, judgeReasoning)
    return
  }

  // ── Subprocess mode ──────────────────────────────────────────────────
  const backup = applyChange(proposal, targetConfig)
  if (!backup) {
    await harness.cycles.completeIteration(cycle.iterationId, { outcome: "failed" })
    return
  }

  cycle.backup = backup

  const benchResult = await runBenchmark(targetConfig.benchmarkCmd, cycle.experimentId)
  if (!benchResult) {
    console.log("[daemon] Benchmark failed, reverting")
    revertChange(backup.filePath, backup.originalContent)
    await harness.cycles.completeIteration(cycle.iterationId, { outcome: "failed" })
    cycle.consecutiveFailures++
    if (cycle.consecutiveFailures >= cycle.limits.maxConsecutiveFailures) {
      await finishCycle("completed", "Benchmark failures")
      return
    }
    await runIteration(judgeReasoning)
    return
  }

  await harness.cycles.setIterationRunId(cycle.iterationId, benchResult.runId)

  // If prose --batch, wait for async batch
  const batchMatch = benchResult.stdout.match(/Provider batch ID: (batch_\w+)/)
  if (batchMatch) {
    const providerBatchId = batchMatch[1]
    const orchBatchId = await harness.cycles.createOrchestratorBatch(
      providerBatchId, "openai", "gpt-5.4-mini", 0,
      benchResult.runId, 0, `improvement cycle #${cycle.cycleId} iter ${cycle.iterationNum}`,
    )
    cycle.pendingBatchId = orchBatchId
    await harness.cycles.setIterationBatchId(cycle.iterationId, orchBatchId)
    console.log(`[daemon] Waiting for batch ${orchBatchId} (${providerBatchId})`)
    return
  }

  await evaluateIteration(judgeReasoning)
}

// ── Config iteration (DB parameter tuning) ──────────────────────────────

async function runConfigIteration(
  cycle: ActiveCycle,
  configComponents: ReturnType<typeof getConfigComponentsForDimension>,
  judgeReasoning: string[],
  targetConfig: typeof TARGETS[string],
): Promise<boolean> {
  if (!cycle.configNovelId) return false

  console.log(`[daemon] Config iteration: ${configComponents.length} tunable parameters for ${cycle.dimension}`)

  const currentValues = await loadConfigValues(cycle.configNovelId, configComponents)
  const improverContext = await buildImproverContext(cycle.cycleId, cycle.target, cycle.dimension, "")

  const proposal = await proposeConfigChange(
    configComponents, currentValues, cycle.dimension,
    cycle.currentScore, judgeReasoning, improverContext, cycle.consecutiveFailures,
  )

  if (!proposal) return false

  const validation = validateConfigProposal(proposal)
  if (!validation.valid) {
    console.log(`[daemon] Config proposal rejected: ${validation.reason}`)
    return false
  }

  // Store proposal info
  await harness.cycles.setIterationProposal(cycle.iterationId!, {
    explanation: `[config] ${proposal.explanation}`,
    agentName: proposal.componentId,
    filePath: `${proposal.table}.${proposal.column}`,
    proposedContent: `${proposal.oldValue} → ${proposal.newValue}`,
    backupContent: String(proposal.oldValue),
  })

  cycle.iterationType = "config"
  cycle.pendingConfigProposal = { componentId: proposal.componentId, newValue: proposal.newValue, explanation: proposal.explanation }

  // Apply config change
  const backup = await applyConfigChange(proposal, cycle.configNovelId)
  cycle.configBackup = { ...backup, novelId: cycle.configNovelId }

  // Run benchmark (subprocess only — config changes don't work with atomic mode)
  const benchResult = await runBenchmark(targetConfig.benchmarkCmd, cycle.experimentId)
  if (!benchResult) {
    console.log("[daemon] Benchmark failed after config change, reverting")
    await revertConfigChange(backup, cycle.configNovelId)
    cycle.configBackup = undefined
    cycle.pendingConfigProposal = undefined
    await harness.cycles.completeIteration(cycle.iterationId!, { outcome: "failed" })
    cycle.consecutiveFailures++
    return true // handled, even though it failed
  }

  await harness.cycles.setIterationRunId(cycle.iterationId!, benchResult.runId)
  await evaluateIteration(judgeReasoning)
  return true
}

// ── Template iteration (embedding template tuning) ──────────────────────

async function runTemplateIteration(
  cycle: ActiveCycle,
  templateComponents: ReturnType<typeof getTemplateComponentsForDimension>,
  judgeReasoning: string[],
  targetConfig: typeof TARGETS[string],
): Promise<boolean> {
  if (templateComponents.length === 0) return false

  console.log(`[daemon] Template iteration: ${templateComponents.length} tunable templates for ${cycle.dimension}`)

  const { getAllEmbeddingTemplates } = await import("../db/embed")
  const { getAllContextTemplates } = await import("../db/context-templates")
  const [embedTemplates, ctxTemplates] = await Promise.all([getAllEmbeddingTemplates(), getAllContextTemplates()])
  const currentTemplates = { ...embedTemplates, ...ctxTemplates }

  const proposal = await proposeTemplateChange(
    templateComponents, currentTemplates, cycle.dimension,
    cycle.currentScore, judgeReasoning, cycle.consecutiveFailures,
  )

  if (!proposal) return false

  const validation = validateTemplateProposal(proposal)
  if (!validation.valid) {
    console.log(`[daemon] Template proposal rejected: ${validation.reason}`)
    return false
  }

  await harness.cycles.setIterationProposal(cycle.iterationId!, {
    explanation: `[template] ${proposal.explanation}`,
    agentName: proposal.componentId,
    filePath: `embedding_templates.${proposal.sourceType}`,
    proposedContent: proposal.newTemplate,
    backupContent: proposal.oldTemplate,
  })

  cycle.iterationType = "template"
  const backup = await applyTemplateChange(proposal)
  cycle.templateBackup = backup

  const benchResult = await runBenchmark(targetConfig.benchmarkCmd, cycle.experimentId)
  if (!benchResult) {
    console.log("[daemon] Benchmark failed after template change, reverting")
    await revertTemplateChange(backup)
    cycle.templateBackup = undefined
    await harness.cycles.completeIteration(cycle.iterationId!, { outcome: "failed" })
    cycle.consecutiveFailures++
    return true
  }

  await harness.cycles.setIterationRunId(cycle.iterationId!, benchResult.runId)
  await evaluateIteration(judgeReasoning)
  return true
}

async function evaluateIterationAtomic(newScore: number, judgeReasoning: string[]): Promise<void> {
  if (!activeCycle) return
  const cycle = activeCycle

  const delta = Math.round((newScore - cycle.currentScore) * 10) / 10
  const improved = delta >= cycle.limits.minDeltaThreshold

  await harness.cycles.completeIteration(cycle.iterationId!, {
    newScore, delta, outcome: improved ? "kept" : "reverted",
  })

  const actualCost = await getExperimentActualCost(cycle.experimentId)
  await harness.cycles.updateCycleStats(cycle.cycleId, { totalIterations: cycle.iterationNum, totalCostUsd: actualCost })

  if (improved && cycle.pendingProposal) {
    console.log(`[daemon] KEPT: ${cycle.currentScore} → ${newScore} (${delta >= 0 ? "+" : ""}${delta})`)
    const targetConfig = TARGETS[cycle.target]
    if (targetConfig) {
      const backup = applyChange(cycle.pendingProposal, targetConfig)
      if (backup) {
        await harness.cycles.setIterationBackup(cycle.iterationId!, backup.originalContent)
      }
    }
    cycle.currentScore = newScore
    cycle.consecutiveFailures = 0
    await harness.cycles.incrementCycleKept(cycle.cycleId)

    // Auto-commit
    if (cycle.pendingProposal) {
      try {
        const filePath = cycle.pendingProposal.filePath
        const commitMsg = `[daemon:${cycle.pendingProposal.agentName}] ${cycle.dimension} ${(cycle.currentScore - delta).toFixed(1)} → ${newScore.toFixed(1)} (+${delta.toFixed(1)})\n\n${cycle.pendingProposal.explanation}\n\nexperiment: #${cycle.experimentId}, cycle: #${cycle.cycleId}, iter: ${cycle.iterationNum}`
        await Bun.spawn(["git", "add", filePath], { cwd: HARNESS_ROOT, stdout: "pipe", stderr: "pipe" }).exited
        await Bun.spawn(["git", "commit", "-m", commitMsg], { cwd: HARNESS_ROOT, stdout: "pipe", stderr: "pipe" }).exited
        console.log(`[daemon] Auto-committed: ${filePath}`)
      } catch (err) {
        console.log(`[daemon] Auto-commit failed: ${err instanceof Error ? err.message : err}`)
      }
    }
  } else {
    const belowThreshold = delta > 0 && !improved
    const reason = belowThreshold ? ` (below threshold ${cycle.limits.minDeltaThreshold})` : ""
    console.log(`[daemon] REVERTED: ${cycle.currentScore} → ${newScore} (${delta >= 0 ? "+" : ""}${delta})${reason}`)
    cycle.consecutiveFailures++
  }

  cycle.pendingProposal = undefined

  const check = checkLimits(actualCost, cycle.iterationNum, cycle.consecutiveFailures, cycle.limits)
  if (!check.allowed) { await finishCycle("completed", check.reason ?? "Limit reached"); return }

  if (!cycle.dimensionLocked) {
    const newDiagnosis = await diagnose()
    if (newDiagnosis && (newDiagnosis.target !== cycle.target || newDiagnosis.dimension !== cycle.dimension)) {
      console.log(`[daemon] Switching: ${cycle.target}/${cycle.dimension} → ${newDiagnosis.target}/${newDiagnosis.dimension}`)
      cycle.target = newDiagnosis.target
      cycle.dimension = newDiagnosis.dimension
      cycle.currentScore = newDiagnosis.currentScore
      const newFullTarget = getDaemonTargetFull(newDiagnosis.target)
      cycle.useAtomic = !!newFullTarget?.supportsAtomic
      judgeReasoning = newDiagnosis.judgeReasoning
    }
  }

  await runIteration(judgeReasoning)
}

async function evaluateIteration(judgeReasoning: string[]): Promise<void> {
  if (!activeCycle) return
  const cycle = activeCycle

  await harness.cycles.setIterationPhase(cycle.iterationId!, "evaluating")

  const newScores = await harness.scores.getLatestScores(cycle.target, cycle.dimension)
  if (!newScores) {
    console.log("[daemon] No scores, reverting")
    if (cycle.backup) revertChange(cycle.backup.filePath, cycle.backup.originalContent)
    if (cycle.configBackup) await revertConfigChange(cycle.configBackup, cycle.configBackup.novelId)
    if (cycle.templateBackup) await revertTemplateChange(cycle.templateBackup)
    await harness.cycles.completeIteration(cycle.iterationId!, { outcome: "failed" })
    cycle.consecutiveFailures++
    return
  }

  const delta = Math.round((newScores.avgScore - cycle.currentScore) * 10) / 10
  const improved = delta >= cycle.limits.minDeltaThreshold

  await harness.cycles.completeIteration(cycle.iterationId!, {
    newScore: newScores.avgScore, delta, outcome: improved ? "kept" : "reverted",
  })

  const actualCost = await getExperimentActualCost(cycle.experimentId)
  await harness.cycles.updateCycleStats(cycle.cycleId, { totalIterations: cycle.iterationNum, totalCostUsd: actualCost })

  if (improved) {
    console.log(`[daemon] KEPT: ${cycle.currentScore} → ${newScores.avgScore} (${delta >= 0 ? "+" : ""}${delta})`)
    cycle.currentScore = newScores.avgScore
    cycle.consecutiveFailures = 0
    await harness.cycles.incrementCycleKept(cycle.cycleId)

    if (cycle.backup) {
      try {
        const commitMsg = `[daemon] ${cycle.dimension} ${(cycle.currentScore - delta).toFixed(1)} → ${newScores.avgScore.toFixed(1)} (+${delta.toFixed(1)})\n\nexperiment: #${cycle.experimentId}, cycle: #${cycle.cycleId}, iter: ${cycle.iterationNum}`
        await Bun.spawn(["git", "add", cycle.backup.filePath], { cwd: HARNESS_ROOT, stdout: "pipe", stderr: "pipe" }).exited
        await Bun.spawn(["git", "commit", "-m", commitMsg], { cwd: HARNESS_ROOT, stdout: "pipe", stderr: "pipe" }).exited
        console.log(`[daemon] Auto-committed: ${cycle.backup.filePath}`)
      } catch (err) {
        console.log(`[daemon] Auto-commit failed: ${err instanceof Error ? err.message : err}`)
      }
    }
    if (cycle.configBackup) {
      console.log(`[daemon] Config change kept: ${cycle.configBackup.column} = ${cycle.pendingConfigProposal?.newValue}`)
    }
    if (cycle.templateBackup) {
      console.log(`[daemon] Template change kept: ${cycle.templateBackup.sourceType}`)
    }
  } else {
    const belowThreshold = delta > 0 && !improved
    const reason = belowThreshold ? ` (below threshold ${cycle.limits.minDeltaThreshold})` : ""
    console.log(`[daemon] REVERTED: ${cycle.currentScore} → ${newScores.avgScore} (${delta >= 0 ? "+" : ""}${delta})${reason}`)
    if (cycle.backup) revertChange(cycle.backup.filePath, cycle.backup.originalContent)
    if (cycle.configBackup) await revertConfigChange(cycle.configBackup, cycle.configBackup.novelId)
    if (cycle.templateBackup) await revertTemplateChange(cycle.templateBackup)
    cycle.consecutiveFailures++
  }

  cycle.backup = undefined
  cycle.configBackup = undefined
  cycle.templateBackup = undefined
  cycle.pendingConfigProposal = undefined
  cycle.iterationType = undefined
  cycle.pendingBatchId = undefined

  const check = checkLimits(actualCost, cycle.iterationNum, cycle.consecutiveFailures, cycle.limits)
  if (!check.allowed) { await finishCycle("completed", check.reason ?? "Limit reached"); return }

  if (!cycle.dimensionLocked) {
    const newDiagnosis = await diagnose()
    if (newDiagnosis && (newDiagnosis.target !== cycle.target || newDiagnosis.dimension !== cycle.dimension)) {
      console.log(`[daemon] Switching: ${cycle.target}/${cycle.dimension} → ${newDiagnosis.target}/${newDiagnosis.dimension}`)
      cycle.target = newDiagnosis.target
      cycle.dimension = newDiagnosis.dimension
      cycle.currentScore = newDiagnosis.currentScore
      judgeReasoning = newDiagnosis.judgeReasoning
    }
  }

  await runIteration(judgeReasoning)
}

async function finishCycle(status: string, reason: string): Promise<void> {
  if (!activeCycle) return
  const cycle = activeCycle
  const totalDelta = Math.round((cycle.currentScore - cycle.baselineScore) * 10) / 10
  const actualCost = await getExperimentActualCost(cycle.experimentId)

  // Regression check on other dimensions
  const fullTarget = getDaemonTargetFull(cycle.target)
  let regressionReport = ""
  if (fullTarget && cycle.iterationNum > 0) {
    const latestScores = await harness.scores.getLatestScores(cycle.target, cycle.dimension)
    if (latestScores) {
      const gens = await harness.scores.getGenerationsForRun(latestScores.runId)
      if (gens.length > 0) {
        const otherDimensions = fullTarget.dimensions.filter(d => d !== cycle.dimension)
        if (otherDimensions.length > 0) {
          console.log(`[daemon] Regression check: ${gens.length} generations x ${otherDimensions.length} dimensions`)

          const judgeResults = await Promise.all(
            gens.flatMap(gen =>
              otherDimensions.map(dim => atomicJudge({
                generationId: gen.id, dimension: dim,
                benchmarkType: cycle.target, seedName: gen.seed,
              }))
            )
          )

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
            lines.push(`${dim}: ${avg}`)
          }
          regressionReport = lines.join(", ")
          console.log(`[daemon] Other dimensions: ${regressionReport}`)
        }
      }
    }
  }

  const regStr = regressionReport ? `, other dims: ${regressionReport}` : ""
  const statsSummary = `${cycle.target}/${cycle.dimension}: ${cycle.baselineScore} → ${cycle.currentScore} (${totalDelta >= 0 ? "+" : ""}${totalDelta}${regStr}). ${cycle.iterationNum} iters, $${actualCost.toFixed(4)}. ${reason}`

  let conclusion = statsSummary
  if (cycle.iterationNum > 0) {
    console.log(`[daemon] Synthesizing conclusion...`)
    const synthesized = await synthesizeConclusion(cycle.cycleId, cycle.target, cycle.dimension, cycle.baselineScore, cycle.currentScore)
    if (synthesized) {
      conclusion = `${statsSummary}\n\n${synthesized}`
      console.log(`[daemon] Conclusion: ${synthesized.slice(0, 200)}...`)
    }
  }

  await harness.cycles.finishCycle(cycle.cycleId, status, conclusion, {
    totalIterations: cycle.iterationNum, totalCostUsd: actualCost,
  })

  await harness.experiments.concludeExperiment(cycle.experimentId, conclusion)
  console.log(`[daemon] Experiment #${cycle.experimentId} concluded`)

  await notify(`Cycle #${cycle.cycleId} ${status}`, `${conclusion}\nExperiment: #${cycle.experimentId}\n\nSync: bash scripts/sync-improvements.sh`)
  console.log(`[daemon] Cycle #${cycle.cycleId} ${status}: ${statsSummary}`)
  activeCycle = null
}

// Run crash recovery on import
await recoverActiveCycle()
