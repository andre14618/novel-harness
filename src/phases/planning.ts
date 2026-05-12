import { type ChapterOutline, type SeedInput } from "../types"
import {
  getNovel, getWorldBible, getCharacters, getStorySpine,
  saveChapterOutline, updateTotalChapters, updatePhase,
  getChapterOutlines,
} from "../db"
import type { Phase, PhaseResult, PlanningOutput, ConceptOutput } from "./contract"
import { callAgent } from "../llm"
import { enrichOutlineIds } from "../harness/ids"
import { PLANNING_PLOTTER_PROMPT } from "../prompts"
import { buildContext as buildPlanningContext } from "../agents/planning-plotter/context"
import { chapterSkeletonsSchema, type ChapterSkeleton } from "../agents/planning-plotter/schema"
import { buildContext as buildBeatContext } from "../agents/planning-beats/context"
import { beatExpansionSchema, prompt as PLANNING_BEATS_PROMPT } from "../agents/planning-beats"
import { buildContext as buildStateMapperContext } from "../agents/planning-state-mapper/context"
import { schema as stateMapperSchema, prompt as PLANNING_STATE_MAPPER_PROMPT, type PlanningStateMapperOutput } from "../agents/planning-state-mapper"
import { buildContext as buildStateRepairContext } from "../agents/planning-state-repair/context"
import { schema as stateRepairSchema, prompt as PLANNING_STATE_REPAIR_PROMPT, type PlanningStateRepairOutput } from "../agents/planning-state-repair"
import { displayPhaseHeader, presentForApproval, formatChapterOutlines } from "../cli"
import { emit } from "../events"
import { log } from "../logger"
import {
  pipeline,
  resolveNativePlanningContractV1,
  resolvePlanningMaterialPressureV1,
  resolvePlanningSceneTurnShapingV1,
  resolveScenePlanContractV1,
} from "../config/pipeline"
import * as harness from "../harness"
import { autogenPlannerProposalsAfterPlanning } from "../harness/planner-canon-proposals"
import type { BeatObligationsContract, SceneBeat } from "../types"
import type { BeatObligationCoverageValidation } from "../harness/beat-obligations"
import { assessBeatCountForTarget, minimumBeatCountForTarget, planningBeatCountPolicy } from "../harness/beat-counts"

const PLANNING_OBLIGATION_WARNING_LIMIT = 8
const PLANNING_OBLIGATION_COVERAGE_MAX_RETRIES = 2
const PLANNING_OBLIGATION_COVERAGE_RETRY_BASE_ATTEMPT = 3

/** Planning phase implementation. Kept exported for scripts that compose
 *  phases outside the runNovel driver (3 callers:
 *  scripts/archive/fork-writer-test.ts, scripts/archive/fork-writer-v4-llama.ts,
 *  test-planner-isolated.ts). Driver consumers should use `planningPhase`
 *  (the Phase<I,O> wrapper) instead. */
export async function runPlanningPhase(novelId: string): Promise<PhaseResult<PlanningOutput>> {
  displayPhaseHeader("Planning — Creating chapter-by-chapter outline")
  log(novelId, "info", "Planning phase started")
  emit(novelId, { type: "phase:changed", data: { phase: "planning" } })

  const novel = await getNovel(novelId)
  const worldBible = await getWorldBible(novelId)
  const characters = await getCharacters(novelId)
  const spine = await getStorySpine(novelId)
  const targetChapters = novel.seed.chapterCount ?? null
  const planningMaxBeatsPerChapter = novel.seed.pipelineOverrides?.planningMaxBeatsPerChapter ?? pipeline.planningMaxBeatsPerChapter
  const nativePlanningContractV1 = resolveNativePlanningContractV1(novel.seed.pipelineOverrides)
  const planningSceneTurnShapingV1 = resolvePlanningSceneTurnShapingV1(novel.seed.pipelineOverrides)
  const scenePlanContractV1 = resolveScenePlanContractV1(novel.seed.pipelineOverrides)

  // ── Phase 1: chapter skeletons ──────────────────────────────────────
  const skeletonContext = buildPlanningContext(worldBible, characters, spine, novel.seed)
  console.log(`  Phase 1/3: chapter skeletons${targetChapters ? ` (target: ${targetChapters} chapters)` : ""}...`)
  emit(novelId, { type: "progress", data: { step: "planning-plotter", status: "running" } })

  let skeletons: ChapterOutline[] | null = null
  let lastError: string | null = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    let promptContext = skeletonContext
    if (attempt > 1 && lastError) {
      promptContext += `\n\n--- PREVIOUS ATTEMPT FAILED ---\n${lastError}\n\nFix the specific issue(s) above.`
      if (targetChapters) promptContext += ` Produce exactly ${targetChapters} chapters.`
    }

    try {
      const result = await callAgent({
        novelId, agentName: "planning-plotter",
        attempt,
        systemPrompt: PLANNING_PLOTTER_PROMPT,
        userPrompt: promptContext,
        schema: chapterSkeletonsSchema,
      })

      // Skeleton → ChapterOutline shape: beat fields start empty, Phase-2 fills them.
      const skeletonChapters = (result.output.chapters as ChapterSkeleton[]).map(s => ({
        ...s,
        scenes: [],
        establishedFacts: [],
        characterStateChanges: [],
        knowledgeChanges: [],
      })) as unknown as ChapterOutline[]

      const enforcement = harness.enforce.enforceSkeletons(
        skeletonChapters, targetChapters, characters,
      )
      for (const w of enforcement.warnings) {
        log(novelId, "warn", `Planning skeletons: ${w}`)
        console.log(`  Warning: ${w}`)
      }
      if (enforcement.valid) {
        skeletons = enforcement.chapters
        log(novelId, "info", `Skeletons attempt ${attempt}: ${skeletons.length} chapters`)
        break
      } else {
        for (const e of enforcement.errors) {
          log(novelId, "error", `Skeleton enforcement: ${e}`)
          console.log(`  Skeleton failure: ${e}`)
        }
        lastError = `Enforcement errors: ${enforcement.errors.join("; ")}`
        if (attempt === 2) {
          throw new Error(`Skeletons failed after 2 attempts: ${enforcement.errors.join("; ")}`)
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt === 2) throw err
      log(novelId, "warn", `Skeleton attempt ${attempt} failed: ${lastError}`)
    }
  }

  if (!skeletons) throw new Error("Skeleton phase produced no valid output")
  console.log(`  ${skeletons.length} skeletons ready.`)

  // ── Phase 2: per-chapter beat expansion + state mapping ─────────────
  console.log(`  Phase 2/3: expanding beats (parallel across ${skeletons.length} chapters)...`)
  emit(novelId, { type: "progress", data: { step: "planning-beats", status: "running", chapters: skeletons.length } })

  const expanded: ChapterOutline[] = new Array(skeletons.length)
  const expansions = skeletons.map((skeleton, idx) =>
    expandChapter(novelId, skeleton, skeletons!, worldBible, characters, spine, novel.seed)
      .then(full => { expanded[idx] = full })
      .catch(err => {
        log(novelId, "error", `Ch ${skeleton.chapterNumber} expansion failed: ${err.message}`)
        // fallback: keep the skeleton with an empty scenes array so downstream
        // enforcement surfaces the miss rather than crashing mid-parallel.
        expanded[idx] = skeleton
      })
  )
  await Promise.all(expansions)

  console.log(`  Phase 3/3: state mappings ready; enforcing obligation coverage...`)

  // Post-expansion enforcement — plan-entry structure, POV, setting. For
  // scene contracts, word-derived count guidance is advisory (L102).
  const postEnforcement = harness.enforce.enforcePlanningOutput(expanded, targetChapters, characters, {
    maxBeatsPerChapter: planningMaxBeatsPerChapter,
    nativePlanningContractV1,
    scenePlanContractV1,
  })
  for (const w of postEnforcement.warnings) {
    log(novelId, "warn", `Planning: ${w}`)
    console.log(`  Warning: ${w}`)
  }

  // Targeted retry: legacy/native beat-shaped chapters retry on count-shape
  // misses. Scene-contract chapters do not retry solely on word-derived count
  // guides; scope quality is evaluated downstream as diagnostics.
  const retryIdx: Array<{ index: number; reason: string }> = []
  for (let i = 0; i < expanded.length; i++) {
    const ch = expanded[i]
    const reason = planningBeatExpansionRetryReason(ch, {
      nativePlanningContractV1,
      planningSceneTurnShapingV1,
      scenePlanContractV1,
    })
    if (reason) {
      retryIdx.push({ index: i, reason })
      console.log(`  Ch ${ch.chapterNumber}: ${reason} — retrying expansion`)
    }
  }

  if (retryIdx.length > 0) {
    emit(novelId, { type: "progress", data: { step: "planning-beats", status: "retrying", chapters: retryIdx.length } })
    const retries = retryIdx.map(({ index: i, reason }) =>
      expandChapter(novelId, skeletons![i], skeletons!, worldBible, characters, spine, novel.seed, 2, reason)
        .then(full => {
          const retryReason = planningBeatExpansionRetryReason(full, {
            nativePlanningContractV1,
            planningSceneTurnShapingV1,
            scenePlanContractV1,
          })
          if (!retryReason) expanded[i] = full
          else log(novelId, "warn", `Ch ${full.chapterNumber}: retry still failed planning shape (${retryReason})`)
        })
        .catch(err => log(novelId, "warn", `Ch ${skeletons![i].chapterNumber} retry failed: ${err.message}`))
    )
    await Promise.all(retries)
  }

  let finalEnforcement = harness.enforce.enforcePlanningOutput(expanded, targetChapters, characters, {
    maxBeatsPerChapter: planningMaxBeatsPerChapter,
    nativePlanningContractV1,
    scenePlanContractV1,
  })
  if (!finalEnforcement.valid) {
    throw new Error(`Planning failed after beat expansion + retry: ${finalEnforcement.errors.join("; ")}`)
  }

  let chapters = finalEnforcement.chapters
  for (let coverageAttempt = 1; coverageAttempt <= PLANNING_OBLIGATION_COVERAGE_MAX_RETRIES; coverageAttempt++) {
    const coverageRetries = chapters
      .map((outline, idx) => ({ outline, idx, validation: harness.beatObligations.validateBeatObligationCoverage(outline) }))
      .filter(item => !item.validation.valid)
    if (coverageRetries.length === 0) break

    emit(novelId, { type: "progress", data: { step: "planning-obligations", status: "repairing", chapters: coverageRetries.length, attempt: coverageAttempt } })
    log(novelId, "info", `Planning obligation coverage repair attempt=${coverageAttempt}: chapters=${coverageRetries.length} errors=${coverageRetries.reduce((sum, item) => sum + item.validation.errors.length, 0)}`)
    for (const item of coverageRetries) {
      for (const error of item.validation.errors) {
        log(novelId, "warn", `Planning obligation coverage repair attempt ${coverageAttempt}: ${error}`)
        console.log(`  Ch ${item.outline.chapterNumber}: ${error} — trying incremental repair (${coverageAttempt}/${PLANNING_OBLIGATION_COVERAGE_MAX_RETRIES})`)
      }
    }

    const retries = coverageRetries.map(item => {
      return repairOrRemapChapterState(
        novelId, item.outline, item.validation, skeletons!, worldBible, characters, spine, novel.seed, coverageAttempt,
      ).then(full => {
        const floor = scenePlanContractV1 ? 1 : minimumBeatCountForTarget(full.targetWords)
        if (full.scenes && full.scenes.length >= floor) expanded[item.idx] = full
        else log(novelId, "warn", `Ch ${full.chapterNumber}: obligation repair/remap still short (${full.scenes?.length ?? 0} < ${floor})`)
      })
        .catch(err => log(novelId, "warn", `Ch ${item.outline.chapterNumber} obligation retry failed: ${err.message}`))
    })
    await Promise.all(retries)

    finalEnforcement = harness.enforce.enforcePlanningOutput(expanded, targetChapters, characters, {
      maxBeatsPerChapter: planningMaxBeatsPerChapter,
      nativePlanningContractV1,
      scenePlanContractV1,
    })
    if (!finalEnforcement.valid) {
      throw new Error(`Planning failed after obligation coverage retry: ${finalEnforcement.errors.join("; ")}`)
    }
    chapters = finalEnforcement.chapters
  }

  const remainingCoverageErrors = chapters.flatMap(outline =>
    harness.beatObligations.validateBeatObligationCoverage(outline).errors,
  )
  if (remainingCoverageErrors.length > 0) {
    throw new Error(`Planning obligation coverage failed after mapper retries: ${remainingCoverageErrors.join("; ")}`)
  }
  emit(novelId, { type: "progress", data: { step: "planning-obligations", status: "complete", chapters: chapters.length } })

  for (const ch of chapters) {
    auditPlanningMaterialPressureGaps(novelId, ch, novel.seed)
    auditSelectiveSceneTurnShapingGaps(novelId, ch, ch.scenes ?? [], novel.seed)
  }

  // L096 Slice 1.5: scene plan contract validator runs in ADVISORY mode
  // under `scenePlanContractV1`. Three LXC smokes (r1/r2/r3) showed that
  // DeepSeek V4 Flash does not reliably comply with the multi-field
  // contract on production-shape fantasy novels, even after a worked-
  // example block + deterministic payoffEventId mint + structural-v1
  // retry. The validator keeps surfacing real per-scene fidelity gaps,
  // but blocking on them produces non-converging retries and a hard
  // failure that prevents downstream evaluation. Demoting to advisory:
  // the validator still runs and logs every finding so calibration
  // signal is preserved; planning never throws on contract failures
  // and never re-issues planner calls for them. Promotion to blocking
  // mode is contingent on either a planner-model upgrade or further
  // compliance work; tracked via the L096 calibration-debt section.
  if (scenePlanContractV1) {
    emit(novelId, { type: "progress", data: { step: "planning-scene-contract", status: "running", chapters: chapters.length } })
    const sceneContractOptions = {
      requireMaterialityTests: true,
      requirePovPersonalStake: true,
    }
    let totalFindings = 0
    let chaptersWithFindings = 0
    for (const ch of chapters) {
      const result = harness.enforce.enforceScenePlanContract(ch, sceneContractOptions)
      if (!result.valid) {
        chaptersWithFindings += 1
        totalFindings += result.errors.length
        for (const finding of result.errors) {
          log(novelId, "warn", `scene-plan-contract advisory: Ch ${ch.chapterNumber}: ${finding}`)
        }
        emit(novelId, {
          type: "progress",
          data: {
            step: "planning-scene-contract",
            status: "advisory-finding",
            chapter: ch.chapterNumber,
            findings: result.errors.length,
          },
        })
      }
    }
    log(novelId, "info", `Scene plan contract advisory: ${totalFindings} finding(s) across ${chaptersWithFindings}/${chapters.length} chapter(s)`)
    emit(novelId, {
      type: "progress",
      data: {
        step: "planning-scene-contract",
        status: "complete",
        chapters: chapters.length,
        chaptersWithFindings,
        totalFindings,
      },
    })
  }

  for (const outline of chapters) {
    const obligationPlan = harness.beatObligations.deriveBeatObligations(outline)
    const s = obligationPlan.summary
    log(novelId, "info", `Planning obligations ch${outline.chapterNumber}: facts=${s.factCount} orphanFacts=${s.orphanFacts} knowledge=${s.knowledgeCount} orphanKnowledge=${s.orphanKnowledgeChanges} state=${s.stateChangeCount} orphanState=${s.orphanStateChanges} overloadedBeats=${s.overloadedBeats}`)
    for (const warning of obligationPlan.warnings.slice(0, PLANNING_OBLIGATION_WARNING_LIMIT)) {
      log(novelId, "warn", `Planning obligations: ${warning}`)
    }
    if (obligationPlan.warnings.length > PLANNING_OBLIGATION_WARNING_LIMIT) {
      log(novelId, "warn", `Planning obligations: ${obligationPlan.warnings.length - PLANNING_OBLIGATION_WARNING_LIMIT} additional warning(s) suppressed for chapter ${outline.chapterNumber}`)
    }
  }
  log(novelId, "info", `Planning complete: ${chapters.length} chapters, avg ${Math.round(chapters.reduce((s, c) => s + (c.scenes?.length ?? 0), 0) / chapters.length)} beats/chapter`)
  emit(novelId, { type: "progress", data: { step: "planning-beats", status: "complete", chapters: chapters.length } })

  console.log(`  ${chapters.length} chapter outlines.\n`)

  const decision = await presentForApproval(
    novelId,
    "planning:outlines",
    `Chapter Outline (${chapters.length} chapters)`,
    formatChapterOutlines(chapters),
  )

  if (decision === "reject") {
    console.log("  Regenerating chapter outline...")
    // On reject, we re-run the full two-phase pipeline from scratch.
    await updatePhase(novelId, "planning")
    return runPlanningPhase(novelId)
  }

  for (const outline of chapters) await saveChapterOutline(novelId, outline)
  await updateTotalChapters(novelId, chapters.length)
  log(novelId, "checkpoint", `${chapters.length} chapter outlines saved`)

  // Auto-generate planner-origin Canon proposals after outlines are saved.
  // Pending proposals are invisible to canon reads (no-ghost-canon), so this
  // doesn't change drafting behavior; it just makes the operator-review queue
  // exist by default. Idempotent on re-run (deterministic id + ON CONFLICT
  // DO NOTHING). Failures are swallowed so a transient DB blip cannot block
  // the planning → drafting transition. See
  // docs/sessions/2026-05-03-collaborative-proposal-workflow-phase-1-5-autowire.md.
  const autogen = await autogenPlannerProposalsAfterPlanning(novelId, chapters)
  if (autogen.error) {
    log(novelId, "warn", `auto-canon-proposals failed: ${autogen.error}`)
  } else if (autogen.gateClear) {
    log(
      novelId,
      "checkpoint",
      `auto-canon-proposals: ${autogen.created} created / ${autogen.skipped} already existed`,
    )
  } else {
    log(
      novelId,
      "warn",
      `auto-canon-proposals: mechanical gate refused (planner ID graph not clean); 0 proposals written. Inspect via run-live-planner-canon-delta.ts.`,
    )
  }

  // P6b1: phase transition is driver-owned.
  log(novelId, "checkpoint", "Planning phase complete → drafting")
  console.log("\n  Planning phase complete. Advancing to Drafting.\n")

  const output = await loadPlanningOutput(novelId)
  return { kind: "complete", output }
}

/** Reconstruct PlanningOutput from chapter_outlines. Called on resume by
 *  the typed driver (P6b1+). Only invoked when novel.phase has advanced
 *  past planning — at that point chapter_outlines must contain the full
 *  set per `updateTotalChapters`. */
export async function loadPlanningOutput(novelId: string): Promise<PlanningOutput> {
  const outlines = await getChapterOutlines(novelId)
  return {
    totalChapters: outlines.length,
    chapters: outlines.map(o => ({
      number: o.chapterNumber,
      title: o.title,
      targetWords: o.targetWords ?? 0,
      beatCount: o.scenes?.length ?? 0,
    })),
  }
}

/** P3 — Phase<ConceptOutput, PlanningOutput> wrapper. Not yet consumed by
 *  the state-machine; P6b1 flips the driver to use it. */
export const planningPhase: Phase<ConceptOutput, PlanningOutput> = {
  name: "planning",
  async run(_input, ctx) {
    // Planning re-queries DB for predecessor artifacts (worldBible, characters,
    // spine) — the typed input is just a completion signal from Concept.
    return runPlanningPhase(ctx.novelId)
  },
  async loadOutput(novelId) {
    return loadPlanningOutput(novelId)
  },
}

async function expandChapter(
  novelId: string,
  skeleton: ChapterOutline,
  allSkeletons: ChapterOutline[],
  worldBible: any,
  characters: any[],
  spine: any,
  seed: any,
  attempt: number = 1,
  retryFeedback?: string,
): Promise<ChapterOutline> {
  const userPrompt = buildBeatContext({
    targetChapter: skeleton,
    allSkeletons,
    priorChapters: [], // cross-chapter coherence lives in the skeleton tier
    worldBible,
    characters,
    spine,
    seed,
    retryFeedback,
  })

  const result = await callAgent({
    novelId,
    agentName: "planning-beats",
    attempt,
    chapter: skeleton.chapterNumber,
    systemPrompt: PLANNING_BEATS_PROMPT,
    userPrompt,
    schema: beatExpansionSchema,
  })

  const scenes = capExpandedScenesForPlanning(
    novelId,
    skeleton,
    (result.output.scenes as SceneBeat[]).map(stripBeatMapperFields),
    seed,
  )
  return mapChapterState(novelId, skeleton, allSkeletons, worldBible, characters, spine, seed, scenes, attempt)
}

export function planningBeatExpansionRetryReason(
  outline: Pick<ChapterOutline, "chapterNumber" | "targetWords" | "scenes">,
  options: {
    nativePlanningContractV1?: boolean
    planningSceneTurnShapingV1?: boolean
    scenePlanContractV1?: boolean
  } = {},
): string | null {
  if (options.scenePlanContractV1) return null
  const target = outline.targetWords ?? 1000
  const count = outline.scenes?.length ?? 0
  const floor = minimumBeatCountForTarget(target)
  if (count < floor) return `${count} beats < floor ${floor} for ${target}w target`
  if (options.nativePlanningContractV1) {
    const assessment = assessBeatCountForTarget(target, count)
    if (assessment.overPlanned) {
      return `${count} beats > native planning budget ${assessment.recommendedBeats}+1 for ${target}w target`
    }
  }
  if (options.planningSceneTurnShapingV1) {
    const reason = selectiveSceneTurnShapingRetryReason(outline.scenes ?? [])
    if (reason) return reason
  }
  return null
}

function selectiveSceneTurnShapingRetryReason(scenes: readonly SceneBeat[]): string | null {
  const finalScene = scenes.at(-1)
  if (!finalScene) return null
  if (!hasText(finalScene.outcome) || !hasText(finalScene.consequence)) {
    return "planningSceneTurnShapingV1 final entry missing outcome/consequence endpoint fields"
  }
  const missingTurnShape = scenes
    .slice(0, -1)
    .filter(sceneHasSourceRefedHardObligation)
    .filter(scene => !hasNonFinalSceneTurnShape(scene))
  if (missingTurnShape.length > 0) {
    return `planningSceneTurnShapingV1 ${missingTurnShape.length} source-refed non-final entries missing goal/opposition/outcome/consequence fields`
  }
  return null
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0
}

function hasNonFinalSceneTurnShape(scene: SceneBeat): boolean {
  return hasText(scene.goal)
    && hasText(scene.opposition)
    && hasText(scene.outcome)
    && hasText(scene.consequence)
}

function sceneHasSourceRefedHardObligation(scene: SceneBeat): boolean {
  for (const list of MATERIAL_PRESSURE_OBLIGATION_LISTS) {
    if (scene.obligations[list].some(item => hasText(item.sourceId))) return true
  }
  return false
}

export interface SelectiveSceneTurnShapingGapAudit {
  active: boolean
  finalMissingFields: string[]
  sourceRefedNonFinalEntriesMissing: number
  sourceRefedNonFinalFieldsMissing: number
}

export function auditSelectiveSceneTurnShapingGaps(
  novelId: string,
  skeleton: Pick<ChapterOutline, "chapterNumber" | "purpose">,
  scenes: readonly SceneBeat[],
  seed: Pick<SeedInput, "pipelineOverrides">,
): SelectiveSceneTurnShapingGapAudit {
  if (
    !resolvePlanningSceneTurnShapingV1(seed.pipelineOverrides) ||
    resolveScenePlanContractV1(seed.pipelineOverrides)
  ) {
    return {
      active: false,
      finalMissingFields: [],
      sourceRefedNonFinalEntriesMissing: 0,
      sourceRefedNonFinalFieldsMissing: 0,
    }
  }
  const finalScene = scenes.at(-1)
  const finalMissingFields = finalScene ? missingFinalEndpointFields(finalScene) : []
  let sourceRefedNonFinalEntriesMissing = 0
  let sourceRefedNonFinalFieldsMissing = 0
  for (const scene of scenes.slice(0, -1)) {
    if (!sceneHasSourceRefedHardObligation(scene)) continue
    const missingFields = missingNonFinalSceneTurnFields(scene)
    if (missingFields.length > 0) {
      sourceRefedNonFinalEntriesMissing += 1
      sourceRefedNonFinalFieldsMissing += missingFields.length
    }
  }
  if (finalMissingFields.length > 0) {
    log(
      novelId,
      "warn",
      `Planning scene-turn gap ch${skeleton.chapterNumber}: final entry missing ${finalMissingFields.join("+")} endpoint fields; retry/readiness must repair rather than fallback-fill from existing plan text`,
    )
  }
  if (sourceRefedNonFinalEntriesMissing > 0) {
    log(
      novelId,
      "warn",
      `Planning scene-turn gap ch${skeleton.chapterNumber}: ${sourceRefedNonFinalEntriesMissing} source-refed non-final entries missing ${sourceRefedNonFinalFieldsMissing} minimal turn fields; retry/readiness must repair rather than fallback-fill writer-facing context`,
    )
  }
  return {
    active: true,
    finalMissingFields,
    sourceRefedNonFinalEntriesMissing,
    sourceRefedNonFinalFieldsMissing,
  }
}

function missingFinalEndpointFields(scene: SceneBeat): string[] {
  const missing: string[] = []
  if (!hasText(scene.outcome)) missing.push("outcome")
  if (!hasText(scene.consequence)) missing.push("consequence")
  return missing
}

function missingNonFinalSceneTurnFields(scene: SceneBeat): string[] {
  const missing: string[] = []
  if (!hasText(scene.goal)) missing.push("goal")
  if (!hasText(scene.opposition)) missing.push("opposition")
  if (!hasText(scene.outcome)) missing.push("outcome")
  if (!hasText(scene.consequence)) missing.push("consequence")
  return missing
}

export interface PlanningMaterialPressureGapAudit {
  active: boolean
  sourceRefedNonFinalObligationsMissing: number
  sourceRefedNonFinalScenesMissing: number
}

export function auditPlanningMaterialPressureGaps(
  novelId: string,
  outline: ChapterOutline,
  seed: Pick<SeedInput, "pipelineOverrides">,
): PlanningMaterialPressureGapAudit {
  if (
    !resolvePlanningMaterialPressureV1(seed.pipelineOverrides) ||
    resolveScenePlanContractV1(seed.pipelineOverrides)
  ) {
    return {
      active: false,
      sourceRefedNonFinalObligationsMissing: 0,
      sourceRefedNonFinalScenesMissing: 0,
    }
  }
  const scenes = outline.scenes ?? []
  if (scenes.length <= 1) {
    return {
      active: true,
      sourceRefedNonFinalObligationsMissing: 0,
      sourceRefedNonFinalScenesMissing: 0,
    }
  }

  let sourceRefedNonFinalObligationsMissing = 0
  let sourceRefedNonFinalScenesMissing = 0
  for (const scene of scenes.slice(0, -1)) {
    let sceneMissing = false
    for (const list of MATERIAL_PRESSURE_OBLIGATION_LISTS) {
      for (const item of scene.obligations[list]) {
        if (!hasText(item.sourceId) || hasText(item.materialityTest)) continue
        sourceRefedNonFinalObligationsMissing += 1
        sceneMissing = true
      }
    }
    if (sceneMissing) sourceRefedNonFinalScenesMissing += 1
  }

  if (sourceRefedNonFinalObligationsMissing > 0) {
    log(
      novelId,
      "warn",
      `Planning material-pressure gap ch${outline.chapterNumber}: ${sourceRefedNonFinalObligationsMissing} source-refed non-final obligations across ${sourceRefedNonFinalScenesMissing} scenes missing materialityTest; readiness must repair rather than fallback-fill semantic pressure`,
    )
  }
  return {
    active: true,
    sourceRefedNonFinalObligationsMissing,
    sourceRefedNonFinalScenesMissing,
  }
}

const MATERIAL_PRESSURE_OBLIGATION_LISTS = [
  "mustEstablish",
  "mustPayOff",
  "mustTransferKnowledge",
  "mustShowStateChange",
] as const

function capExpandedScenesForPlanning(
  novelId: string,
  skeleton: ChapterOutline,
  scenes: SceneBeat[],
  seed: SeedInput,
): SceneBeat[] {
  const explicitSceneContractCap = resolveScenePlanContractV1(seed.pipelineOverrides)
    ? normalizePlanningMaxEntries(seed.pipelineOverrides?.planningMaxBeatsPerChapter)
    : null
  if (explicitSceneContractCap !== null) {
    if (scenes.length <= explicitSceneContractCap) return scenes
    const capped = scenes.slice(0, explicitSceneContractCap)
    log(
      novelId,
      "info",
      `Planning scene contracts ch${skeleton.chapterNumber}: capped ${scenes.length} -> ${capped.length} by explicit planningMaxBeatsPerChapter`,
    )
    return capped
  }
  const policy = planningBeatCountPolicy(
    skeleton.targetWords,
    seed.pipelineOverrides?.planningMaxBeatsPerChapter,
  )
  if (policy.effectiveMaxBeats === null || scenes.length <= policy.effectiveMaxBeats) return scenes
  const capped = scenes.slice(0, policy.effectiveMaxBeats)
  const note = policy.capRaisedToFloor ? `; configured cap ${policy.configuredMaxBeats} raised to floor` : ""
  log(
    novelId,
    "info",
    `Planning beats ch${skeleton.chapterNumber}: capped ${scenes.length} -> ${capped.length} by planningMaxBeatsPerChapter${note}`,
  )
  return capped
}

function normalizePlanningMaxEntries(value: number | null | undefined): number | null {
  if (typeof value !== "number") return null
  if (!Number.isInteger(value) || value <= 0) return null
  return value
}

// Per-chapter ceiling on planning-state-repair LLM calls within a single
// coverage attempt. The first call is the primary patch; the second exists
// to let a partial-but-progressing patch try once more on the
// already-improved outline before we give up and fall back to a full
// mapper retry. Higher values just burn tokens — by attempt 3 the agent
// is either looping or the contract is unsatisfiable from prompts alone.
const MAX_REPAIR_AGENT_CALLS_PER_COVERAGE_ATTEMPT = 2

async function repairOrRemapChapterState(
  novelId: string,
  outline: ChapterOutline,
  validation: BeatObligationCoverageValidation,
  allSkeletons: ChapterOutline[],
  worldBible: any,
  characters: any[],
  spine: any,
  seed: any,
  coverageAttempt: number,
): Promise<ChapterOutline> {
  // Track the best (most-repaired) outline + its validation across repair
  // calls. If the agent makes partial progress (errors strictly decrease)
  // we keep that progress and either recurse once more or hand it to the
  // mapper retry. The pre-fix behavior discarded partial progress on
  // every non-passing patch, wasting both the repair tokens and forcing
  // mapper retry to redo the entire chapter from scratch.
  let workingOutline = outline
  let workingValidation = validation

  for (let repairCall = 1; repairCall <= MAX_REPAIR_AGENT_CALLS_PER_COVERAGE_ATTEMPT; repairCall++) {
    emit(novelId, { type: "progress", data: { step: "planning-state-repair", status: "running", chapter: workingOutline.chapterNumber, attempt: coverageAttempt, repairCall } })
    let repairResult: ReturnType<typeof harness.beatObligations.applyBeatObligationRepairPatch> | null = null
    try {
      const result = await callAgent({
        novelId,
        agentName: "planning-state-repair",
        attempt: coverageAttempt,
        chapter: workingOutline.chapterNumber,
        systemPrompt: PLANNING_STATE_REPAIR_PROMPT,
        userPrompt: buildStateRepairContext({ outline: workingOutline, validation: workingValidation }),
        schema: stateRepairSchema,
        logMetadata: {
          chapterId: workingOutline.chapterId,
          repairCall,
          missingSourceIds: workingValidation.missingSourceIds,
          unknownSourceIds: workingValidation.unknownObligations.map(item => item.sourceId),
        },
      })
      const patch = result.output as PlanningStateRepairOutput
      repairResult = harness.beatObligations.applyBeatObligationRepairPatch(workingOutline, patch)
      for (const applied of repairResult.applied) log(novelId, "info", `Planning state repair applied (call ${repairCall}): ${applied}`)
      for (const rejected of repairResult.rejected) log(novelId, "warn", `Planning state repair rejected (call ${repairCall}): ${rejected}`)
      log(novelId, "info", `Planning state repair ch${workingOutline.chapterNumber} call ${repairCall}: applied=${repairResult.applied.length} rejected=${repairResult.rejected.length} ops=${(patch.operations ?? []).length} priorErrors=${workingValidation.errors.length} postErrors=${repairResult.validation.errors.length}`)
    } catch (err) {
      log(novelId, "warn", `Planning state repair ch${workingOutline.chapterNumber} call ${repairCall} failed: ${err instanceof Error ? err.message : err}`)
      break
    }

    if (repairResult.validation.valid) {
      emit(novelId, { type: "progress", data: { step: "planning-state-repair", status: "complete", chapter: workingOutline.chapterNumber, attempt: coverageAttempt, repairCall, applied: repairResult.applied.length, rejected: repairResult.rejected.length } })
      return repairResult.outline
    }

    // Partial progress: keep the improved outline + validation as the new
    // baseline so the next loop iteration (or the mapper fallback below)
    // sees the smaller error set. Threshold is strict decrease — equal or
    // worse means the agent is spinning, so stop calling it.
    if (repairResult.validation.errors.length < workingValidation.errors.length) {
      workingOutline = repairResult.outline
      workingValidation = repairResult.validation
      log(novelId, "info", `Planning state repair ch${workingOutline.chapterNumber} call ${repairCall} made partial progress; continuing with reduced error set`)
      continue
    }

    log(novelId, "warn", `Planning state repair ch${workingOutline.chapterNumber} call ${repairCall} did not strictly reduce errors; stopping repair loop`)
    break
  }

  emit(novelId, { type: "progress", data: { step: "planning-state-repair", status: "failed", chapter: workingOutline.chapterNumber, attempt: coverageAttempt } })

  // Hand the partially-repaired outline (not the original) to the mapper
  // fallback. Without this the mapper redoes the chapter from scratch
  // and any obligations the agent successfully added are lost.
  const feedback = harness.beatObligations.formatObligationCoverageRetryFeedback(workingOutline, workingValidation)
  return mapChapterState(
    novelId,
    workingOutline,
    allSkeletons,
    worldBible,
    characters,
    spine,
    seed,
    workingOutline.scenes ?? [],
    PLANNING_OBLIGATION_COVERAGE_RETRY_BASE_ATTEMPT + coverageAttempt - 1,
    feedback,
  )
}

async function mapChapterState(
  novelId: string,
  skeleton: ChapterOutline,
  allSkeletons: ChapterOutline[],
  worldBible: any,
  characters: any[],
  spine: any,
  seed: any,
  scenes: SceneBeat[],
  attempt: number = 1,
  retryFeedback?: string,
): Promise<ChapterOutline> {
  // Pre-assign chapterId + beatIds + characterId on chapter-level state so
  // the mapper context can render IDs and the mapper output can reference
  // them. enrichOutlineIds is idempotent — running it again after merge
  // preserves the IDs.
  const preEnrichOutline: ChapterOutline = {
    ...skeleton,
    scenes,
    establishedFacts: skeleton.establishedFacts ?? [],
    characterStateChanges: skeleton.characterStateChanges ?? [],
    knowledgeChanges: skeleton.knowledgeChanges ?? [],
  } as ChapterOutline
  enrichOutlineIds(preEnrichOutline)
  // Mutate scenes in place; preEnrichOutline.scenes is a reference to the
  // same array passed in.
  let userPrompt = buildStateMapperContext({
    targetChapter: preEnrichOutline,
    allSkeletons,
    priorChapters: [], // cross-chapter coherence lives in the skeleton tier
    scenes,
    worldBible,
    characters,
    spine,
    seed,
  })
  if (retryFeedback) {
    userPrompt += `\n\n--- EXISTING STATE MAPPING TO PRESERVE ---\n${renderExistingStateMapping(skeleton)}\n\n--- PREVIOUS STATE MAPPING FAILED COVERAGE VALIDATION ---\n${retryFeedback}\n\nReturn a complete replacement JSON object for this chapter's state mapping only. Keep the existing beat indexes unchanged. Preserve existing valid chapter-level state; fix missing coverage by adding or moving beat obligations rather than deleting valid facts, knowledge changes, or state changes.`
  }

  emit(novelId, { type: "progress", data: { step: "planning-state-mapper", status: "running", chapter: skeleton.chapterNumber, attempt } })
  try {
    const result = await callAgent({
      novelId,
      agentName: "planning-state-mapper",
      attempt,
      chapter: skeleton.chapterNumber,
      systemPrompt: PLANNING_STATE_MAPPER_PROMPT,
      userPrompt,
      schema: stateMapperSchema,
    })

    const mapping = result.output as PlanningStateMapperOutput
    const outline = mergeStateMapping(skeleton, scenes, mapping)
    const enrichment = enrichOutlineIds(outline)
    if (enrichment.obligationLinkFailures.length > 0) {
      for (const failure of enrichment.obligationLinkFailures.slice(0, 8)) {
        log(novelId, "warn", `Planning state mapper ch${outline.chapterNumber} unlinked obligation ${failure.obligationKey}#${failure.obligationIndex} on ${failure.beatId}: ${failure.reason} text="${failure.text.slice(0, 80)}"`)
      }
    }
    const validation = harness.beatObligations.validateBeatObligationCoverage(outline)
    const storyRefValidation = harness.storyRefs.validateOutlineStoryRefs(outline, seed.directives)
    for (const issue of storyRefValidation.issues.slice(0, 8)) {
      log(novelId, "warn", `Planning state mapper ch${outline.chapterNumber} story-ref warning: ${harness.storyRefs.formatStoryRefIssue(issue)}`)
    }
    logStateMapperTelemetry(novelId, outline, mapping, validation.summary, attempt, storyRefValidation.summary)
    emit(novelId, { type: "progress", data: { step: "planning-state-mapper", status: "complete", chapter: skeleton.chapterNumber, attempt, valid: validation.valid } })
    return outline
  } catch (err) {
    emit(novelId, { type: "progress", data: { step: "planning-state-mapper", status: "failed", chapter: skeleton.chapterNumber, attempt } })
    throw err
  }
}

function stripBeatMapperFields(scene: SceneBeat): SceneBeat {
  return {
    ...scene,
    requiredPayoffs: [],
    obligations: emptyBeatObligations(),
  }
}

function mergeStateMapping(
  skeleton: ChapterOutline,
  scenes: SceneBeat[],
  mapping: PlanningStateMapperOutput,
): ChapterOutline {
  const mappedScenes = scenes.map(stripBeatMapperFields)

  for (const beatMapping of mapping.beatMappings ?? []) {
    if (!Number.isInteger(beatMapping.beatIndex) || beatMapping.beatIndex < 0 || beatMapping.beatIndex >= mappedScenes.length) continue
    const scene = mappedScenes[beatMapping.beatIndex]
    // beatId mismatch: log+ignore the echoed beatId rather than crashing
    // the entire planning phase. beatIndex is the authoritative selector;
    // a stale beatId echo (e.g. mapper retry referencing an earlier
    // chapter's IDs) shouldn't take down a valid mapping. The mismatch is
    // surfaced as a planning-level warning so the operator can spot
    // mapper drift.
    if (beatMapping.beatId && scene.beatId && beatMapping.beatId !== scene.beatId) {
      console.warn(`  Planning state mapper beatId echo mismatch: beatIndex ${beatMapping.beatIndex} echoed ${beatMapping.beatId}, expected ${scene.beatId} — using beatIndex, ignoring echoed beatId`)
    }
    scene.obligations = mergeBeatObligations(scene.obligations, beatMapping.obligations)
    scene.requiredPayoffs = mergeRequiredPayoffs(scene.requiredPayoffs, beatMapping.requiredPayoffs)
  }

  return {
    ...skeleton,
    scenes: mappedScenes,
    establishedFacts: (mapping.establishedFacts ?? []) as ChapterOutline["establishedFacts"],
    characterStateChanges: (mapping.characterStateChanges ?? []) as ChapterOutline["characterStateChanges"],
    knowledgeChanges: (mapping.knowledgeChanges ?? []) as ChapterOutline["knowledgeChanges"],
  } as ChapterOutline
}

function mergeBeatObligations(
  existing: BeatObligationsContract | undefined,
  incoming: BeatObligationsContract | undefined,
): BeatObligationsContract {
  return {
    mustEstablish: [...(existing?.mustEstablish ?? []), ...(incoming?.mustEstablish ?? [])],
    mustPayOff: [...(existing?.mustPayOff ?? []), ...(incoming?.mustPayOff ?? [])],
    mustTransferKnowledge: [...(existing?.mustTransferKnowledge ?? []), ...(incoming?.mustTransferKnowledge ?? [])],
    mustShowStateChange: [...(existing?.mustShowStateChange ?? []), ...(incoming?.mustShowStateChange ?? [])],
    mustNotReveal: [...(existing?.mustNotReveal ?? []), ...(incoming?.mustNotReveal ?? [])],
    allowedNewEntities: Array.from(new Set([...(existing?.allowedNewEntities ?? []), ...(incoming?.allowedNewEntities ?? [])])),
  }
}

function mergeRequiredPayoffs(
  existing: SceneBeat["requiredPayoffs"] | undefined,
  incoming: SceneBeat["requiredPayoffs"] | undefined,
): SceneBeat["requiredPayoffs"] {
  const seen = new Set<string>()
  const merged: SceneBeat["requiredPayoffs"] = []
  for (const link of [...(existing ?? []), ...(incoming ?? [])]) {
    const key = `${link.fact_id}:${link.payoff_beat}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(link)
  }
  return merged
}

function emptyBeatObligations(): BeatObligationsContract {
  return {
    mustEstablish: [],
    mustPayOff: [],
    mustTransferKnowledge: [],
    mustShowStateChange: [],
    mustNotReveal: [],
    allowedNewEntities: [],
  }
}

function renderExistingStateMapping(outline: ChapterOutline): string {
  const lines: string[] = []
  if ((outline.establishedFacts ?? []).length > 0) {
    lines.push("Established facts (preserve every id):")
    for (const fact of outline.establishedFacts ?? []) {
      lines.push(`- id=${fact.id || "(missing-id)"} [${fact.category}] ${fact.fact}`)
    }
  }
  if ((outline.knowledgeChanges ?? []).length > 0) {
    lines.push("Knowledge changes (preserve every id and characterId):")
    for (const change of outline.knowledgeChanges ?? []) {
      const id = (change as any).id ? `id=${(change as any).id} ` : ""
      const cid = (change as any).characterId ? `characterId=${(change as any).characterId} ` : ""
      lines.push(`- ${id}${cid}${change.characterName}: ${change.knowledge} (${change.source})`)
    }
  }
  if ((outline.characterStateChanges ?? []).length > 0) {
    lines.push("Character state changes (preserve every id and characterId):")
    for (const change of outline.characterStateChanges ?? []) {
      const knows = change.knows.length ? `; knows: ${change.knows.join(", ")}` : ""
      const doesNotKnow = change.doesNotKnow.length ? `; doesNotKnow: ${change.doesNotKnow.join(", ")}` : ""
      const id = (change as any).id ? `id=${(change as any).id} ` : ""
      const cid = (change as any).characterId ? `characterId=${(change as any).characterId} ` : ""
      lines.push(`- ${id}${cid}${change.name}: location: ${change.location || "?"}; state: ${change.emotionalState || "?"}${knows}${doesNotKnow}`)
    }
  }
  return lines.length ? lines.join("\n") : "No existing state mapping was available."
}

function logStateMapperTelemetry(
  novelId: string,
  outline: ChapterOutline,
  mapping: PlanningStateMapperOutput,
  summary: ReturnType<typeof harness.beatObligations.validateBeatObligationCoverage>["summary"],
  attempt: number,
  storyRefSummary?: ReturnType<typeof harness.storyRefs.validateOutlineStoryRefs>["summary"],
): void {
  const validMappings = (mapping.beatMappings ?? [])
    .filter(m => Number.isInteger(m.beatIndex) && m.beatIndex >= 0 && m.beatIndex < outline.scenes.length)
  const mappedBeatCount = new Set(validMappings.map(m => m.beatIndex)).size
  const ignoredMappingCount = (mapping.beatMappings ?? []).length - validMappings.length
  const storyRefs = storyRefSummary
    ? ` storyRefs=${storyRefSummary.threadRefCount}/${storyRefSummary.promiseRefCount}/${storyRefSummary.payoffRefCount} storyRefIssues=${storyRefSummary.issueCount}`
    : ""
  log(novelId, "info", `Planning state mapper ch${outline.chapterNumber} attempt=${attempt}: mappedBeats=${mappedBeatCount}/${outline.scenes.length} ignoredMappings=${ignoredMappingCount} facts=${summary.factCount} orphanFacts=${summary.orphanFacts} knowledge=${summary.knowledgeCount} orphanKnowledge=${summary.orphanKnowledgeChanges} state=${summary.stateChangeCount} orphanState=${summary.orphanStateChanges} overloadedBeats=${summary.overloadedBeats}${storyRefs}`)
}
