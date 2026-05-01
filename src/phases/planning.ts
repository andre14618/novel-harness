import { type ChapterOutline } from "../types"
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
import { displayPhaseHeader, presentForApproval, formatChapterOutlines } from "../cli"
import { emit } from "../events"
import { log } from "../logger"
import * as harness from "../harness"
import type { BeatObligationsContract, SceneBeat } from "../types"

const PLANNING_OBLIGATION_WARNING_LIMIT = 8
const PLANNING_OBLIGATION_COVERAGE_MAX_RETRIES = 2
const PLANNING_OBLIGATION_COVERAGE_RETRY_BASE_ATTEMPT = 3

/** Planning phase implementation. Kept exported for scripts that compose
 *  phases outside the runNovel driver (3 callers:
 *  scripts/fork-writer-test.ts, fork-writer-v4-llama.ts,
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
      })) as ChapterOutline[]

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

  // Post-expansion enforcement — beat count floor, POV, setting
  const postEnforcement = harness.enforce.enforcePlanningOutput(expanded, targetChapters, characters)
  for (const w of postEnforcement.warnings) {
    log(novelId, "warn", `Planning: ${w}`)
    console.log(`  Warning: ${w}`)
  }

  // Targeted retry: any chapter under its beat-count floor gets re-expanded once
  const retryIdx: number[] = []
  for (let i = 0; i < expanded.length; i++) {
    const ch = expanded[i]
    const floor = Math.max(3, Math.ceil((ch.targetWords ?? 1000) / 150))
    if (!ch.scenes || ch.scenes.length < floor) {
      retryIdx.push(i)
      console.log(`  Ch ${ch.chapterNumber}: ${ch.scenes?.length ?? 0} beats < floor ${floor} — retrying expansion`)
    }
  }

  if (retryIdx.length > 0) {
    emit(novelId, { type: "progress", data: { step: "planning-beats", status: "retrying", chapters: retryIdx.length } })
    const retries = retryIdx.map(i =>
      expandChapter(novelId, skeletons![i], skeletons!, worldBible, characters, spine, novel.seed, 2)
        .then(full => {
          const floor = Math.max(3, Math.ceil((full.targetWords ?? 1000) / 150))
          if (full.scenes && full.scenes.length >= floor) expanded[i] = full
          else log(novelId, "warn", `Ch ${full.chapterNumber}: retry still short (${full.scenes?.length ?? 0} < ${floor})`)
        })
        .catch(err => log(novelId, "warn", `Ch ${skeletons![i].chapterNumber} retry failed: ${err.message}`))
    )
    await Promise.all(retries)
  }

  let finalEnforcement = harness.enforce.enforcePlanningOutput(expanded, targetChapters, characters)
  if (!finalEnforcement.valid) {
    throw new Error(`Planning failed after beat expansion + retry: ${finalEnforcement.errors.join("; ")}`)
  }

  let chapters = finalEnforcement.chapters
  for (let coverageAttempt = 1; coverageAttempt <= PLANNING_OBLIGATION_COVERAGE_MAX_RETRIES; coverageAttempt++) {
    const coverageRetries = chapters
      .map((outline, idx) => ({ outline, idx, validation: harness.beatObligations.validateBeatObligationCoverage(outline) }))
      .filter(item => !item.validation.valid)
    if (coverageRetries.length === 0) break

    emit(novelId, { type: "progress", data: { step: "planning-obligations", status: "retrying", chapters: coverageRetries.length, attempt: coverageAttempt } })
    log(novelId, "info", `Planning obligation coverage retry attempt=${coverageAttempt}: chapters=${coverageRetries.length} errors=${coverageRetries.reduce((sum, item) => sum + item.validation.errors.length, 0)}`)
    for (const item of coverageRetries) {
      for (const error of item.validation.errors) {
        log(novelId, "warn", `Planning obligation coverage attempt ${coverageAttempt}: ${error}`)
        console.log(`  Ch ${item.outline.chapterNumber}: ${error} — retrying state mapping (${coverageAttempt}/${PLANNING_OBLIGATION_COVERAGE_MAX_RETRIES})`)
      }
    }

    const retries = coverageRetries.map(item => {
      const feedback = harness.beatObligations.formatObligationCoverageRetryFeedback(item.outline, item.validation)
      return mapChapterState(
        novelId,
        item.outline,
        skeletons!,
        worldBible,
        characters,
        spine,
        novel.seed,
        item.outline.scenes ?? [],
        PLANNING_OBLIGATION_COVERAGE_RETRY_BASE_ATTEMPT + coverageAttempt - 1,
        feedback,
      )
        .then(full => {
          const floor = Math.max(3, Math.ceil((full.targetWords ?? 1000) / 150))
          if (full.scenes && full.scenes.length >= floor) expanded[item.idx] = full
          else log(novelId, "warn", `Ch ${full.chapterNumber}: obligation retry still short (${full.scenes?.length ?? 0} < ${floor})`)
        })
        .catch(err => log(novelId, "warn", `Ch ${item.outline.chapterNumber} obligation retry failed: ${err.message}`))
    })
    await Promise.all(retries)

    finalEnforcement = harness.enforce.enforcePlanningOutput(expanded, targetChapters, characters)
    if (!finalEnforcement.valid) {
      throw new Error(`Planning failed after obligation coverage retry: ${finalEnforcement.errors.join("; ")}`)
    }
    chapters = finalEnforcement.chapters
  }

  const coverageRepairs = chapters
    .map((outline, idx) => ({ outline, idx, validation: harness.beatObligations.validateBeatObligationCoverage(outline) }))
    .filter(item => !item.validation.valid)
  let autoRepairCount = 0
  if (coverageRepairs.length > 0) {
    emit(novelId, { type: "progress", data: { step: "planning-obligations", status: "repairing", chapters: coverageRepairs.length } })
    for (const item of coverageRepairs) {
      const repaired = harness.beatObligations.repairBeatObligationCoverage(item.outline)
      enrichOutlineIds(repaired.outline)
      expanded[item.idx] = repaired.outline
      autoRepairCount += repaired.repairs.length
      for (const repair of repaired.repairs) {
        log(novelId, "warn", `Planning obligation auto-repair: ${repair}`)
        console.log(`  ${repair}`)
      }
    }
    finalEnforcement = harness.enforce.enforcePlanningOutput(expanded, targetChapters, characters)
    if (!finalEnforcement.valid) {
      throw new Error(`Planning failed after obligation coverage auto-repair: ${finalEnforcement.errors.join("; ")}`)
    }
    chapters = finalEnforcement.chapters
  }
  log(novelId, "info", `Planning obligation auto-repair summary: chapters=${coverageRepairs.length} repairs=${autoRepairCount}`)

  const remainingCoverageErrors = chapters.flatMap(outline =>
    harness.beatObligations.validateBeatObligationCoverage(outline).errors,
  )
  if (remainingCoverageErrors.length > 0) {
    throw new Error(`Planning obligation coverage failed after retry + auto-repair: ${remainingCoverageErrors.join("; ")}`)
  }
  emit(novelId, { type: "progress", data: { step: "planning-obligations", status: "complete", chapters: chapters.length, repairs: autoRepairCount } })

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
): Promise<ChapterOutline> {
  const userPrompt = buildBeatContext({
    targetChapter: skeleton,
    allSkeletons,
    priorChapters: [], // cross-chapter coherence lives in the skeleton tier
    worldBible,
    characters,
    spine,
    seed,
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

  const scenes = (result.output.scenes as SceneBeat[]).map(stripBeatMapperFields)
  return mapChapterState(novelId, skeleton, allSkeletons, worldBible, characters, spine, seed, scenes, attempt)
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
    logStateMapperTelemetry(novelId, outline, mapping, validation.summary, attempt)
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
): void {
  const validMappings = (mapping.beatMappings ?? [])
    .filter(m => Number.isInteger(m.beatIndex) && m.beatIndex >= 0 && m.beatIndex < outline.scenes.length)
  const mappedBeatCount = new Set(validMappings.map(m => m.beatIndex)).size
  const ignoredMappingCount = (mapping.beatMappings ?? []).length - validMappings.length
  log(novelId, "info", `Planning state mapper ch${outline.chapterNumber} attempt=${attempt}: mappedBeats=${mappedBeatCount}/${outline.scenes.length} ignoredMappings=${ignoredMappingCount} facts=${summary.factCount} orphanFacts=${summary.orphanFacts} knowledge=${summary.knowledgeCount} orphanKnowledge=${summary.orphanKnowledgeChanges} state=${summary.stateChangeCount} orphanState=${summary.orphanStateChanges} overloadedBeats=${summary.overloadedBeats}`)
}
