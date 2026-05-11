#!/usr/bin/env bun
/**
 * Read-only production report for the planning-to-drafting context contract.
 *
 * It compares upstream artifact availability (World Bible, characters, Story
 * Spine, Chapter Plans) with downstream writer-context telemetry. The report is
 * diagnostic only: it does not gate drafting and does not mutate Canon or plans.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import db from "../../src/db/connection"
import type { ChapterOutline, CharacterProfile } from "../../src/types"
import { enrichOutlineIds } from "../../src/harness/ids"
import { beatDescriptionHasImplicitReference } from "../../src/agents/writer/reference-resolver"
import { summarizeSceneContractShape } from "../../src/agents/writer/scene-contract-shape"
import {
  buildWriterContextTelemetryReport,
  type WriterContextEventRow,
  type WriterContextTelemetryReport,
} from "./writer-context-report"

export type ContextContractSurface =
  | "characterProfiles"
  | "characterSnapshots"
  | "characterContextCapsules"
  | "worldBible"
  | "canonFacts"
  | "setting"
  | "storySpine"
  | "storyRefLineage"
  | "readerInfoState"
  | "resolvedReferences"
  | "sceneContract"
  | "obligations"
  | "draftingBrief"

export type ContextContractStatus =
  | "covered"
  | "missing_downstream"
  | "not_observed"
  | "not_available"
  | "attempted_no_context"
  | "represented_without_upstream"

export interface PlanningArtifactSummary {
  worldBibleAvailable: boolean
  storySpineAvailable: boolean
  characterCount: number
  canonFactCount: number
  canonKnowledgeChangeCount: number
  canonCharacterStateChangeCount: number
  canonChangeCount: number
  chapterPlanCount: number
  plannedSceneCount: number
  sceneLoad: SceneLoadSummary
  planContinuity: PlanContinuitySummary
  scenesWithCharacters: number
  scenesWithSceneIds: number
  scenesWithSceneContract: number
  scenesWithTemporalAnchor: number
  scenesWithPlaceAnchor: number
  sceneContractsWithDramaticShape: number
  sceneContractsWithChoiceShape: number
  sceneContractsWithEndpointShape: number
  sceneContractsWithFullDramaticShape: number
  anchorOnlySceneContracts: number
  sceneContractShape: SceneContractShapeSummary
  scenesWithObligations: number
  scenesWithImplicitReferences: number
  chaptersWithSetting: number
  chaptersWithCharactersPresentIds: number
  readerInfoSourceChapters: number
  obligationIds: number
  obligationSourceRefs: number
  activeStoryRefIds: number
  implicitReferenceScenes: ImplicitReferenceSceneSummary[]
}

export interface ImplicitReferenceSceneSummary {
  chapterNumber: number
  chapterId: string
  beatIndex: number
  sceneRef: string
  descriptionExcerpt: string
}

export type SceneLoadSignal = "balanced" | "dense" | "overloaded" | "unknown"

export interface ChapterSceneLoad {
  chapterNumber: number
  chapterId: string
  sceneRefs: string[]
  sceneCount: number
  targetWords: number | null
  targetWordsPerScene: number | null
  signal: SceneLoadSignal
}

export interface SceneLoadSummary {
  chapters: ChapterSceneLoad[]
  maxScenesPerChapter: number
  minTargetWordsPerScene: number | null
  denseChapterCount: number
  overloadedChapterCount: number
}

export interface FutureEventAnchorFinding {
  label: "FUTURE-EVENT-ANCHOR-MISSING"
  severity: "medium"
  sourceChapterNumber: number
  sourceChapterId: string
  targetChapterNumber: number
  targetChapterId: string
  sourceRef: string
  targetSceneRef: string
  sourceText: string
  targetTextExcerpt: string
  eventTokens: string[]
  requiredTemporalCue: string
}

export interface PlanFactContradictionFinding {
  label: "PLAN-FACT-STATUS-CONTRADICTION"
  severity: "high" | "medium"
  sourceChapterNumber: number
  sourceChapterId: string
  targetChapterNumber: number
  targetChapterId: string
  sourceRef: string
  targetSceneRef: string
  sourceText: string
  targetTextExcerpt: string
  sharedAnchors: string[]
  conflictTokens: string[]
  requiredFactStatus: string
}

export interface PlanContinuitySummary {
  futureEventAnchors: FutureEventAnchorFinding[]
  factContradictions: PlanFactContradictionFinding[]
}

export interface DramaticSceneContractGap {
  label:
    | "DRAMATIC-SCENE-CONTRACT-MISSING"
    | "ANCHOR-ONLY-SCENE-CONTRACT"
    | "SCENE-CONTRACT-CHOICE-SHAPE-INCOMPLETE"
    | "SCENE-CONTRACT-FULL-SHAPE-INCOMPLETE"
  severity: "medium" | "low"
  chapterNumber: number
  chapterId: string
  sceneRef: string
  descriptionExcerpt: string
  hasTemporalAnchor: boolean
  hasPlaceAnchor: boolean
  hasObligations: boolean
  hasChoiceShape: boolean
  hasEndpointShape: boolean
  hasFullDramaticShape: boolean
  characterCount: number
  obligationIds: string[]
  characterIds: string[]
  sourceIds: string[]
  threadIds: string[]
  promiseIds: string[]
  payoffIds: string[]
  missingFields: string[]
}

export interface SceneContractShapeSummary {
  missingDramaticShape: DramaticSceneContractGap[]
  missingChoiceShape: DramaticSceneContractGap[]
  missingFullDramaticShape: DramaticSceneContractGap[]
  anchorOnly: DramaticSceneContractGap[]
}

export interface PlanningToDraftingContextAuditRow {
  surface: ContextContractSurface
  upstreamAvailable: boolean
  upstreamCount: number
  downstreamRepresented: boolean
  downstreamCount: number
  status: ContextContractStatus
  note: string
}

export interface PlanningToDraftingContextReport {
  novelId: string | null
  upstream: PlanningArtifactSummary
  downstream: WriterContextTelemetryReport["totals"]
  surfaces: PlanningToDraftingContextAuditRow[]
  gaps: PlanningToDraftingContextAuditRow[]
  referenceContextAttempts?: ReferenceContextAttemptSummary[]
}

export interface ReferenceContextAttemptSummary {
  eventIds: number[]
  eventCount: number
  chapter: number | null
  beatIndex: number | null
  stages: string[]
  sceneRef: string | null
  descriptionExcerpt: string | null
  referenceLookups: number
  referenceLlmCalls: number
  canonSourceRefs: number
  storyRefIds: number
  readerInfoStateChars: number
  missingCharacterIds: number
}

interface Args {
  novelId: string | null
  json: boolean
  outputPath: string | null
  jsonOutputPath: string | null
}

export function summarizePlanningArtifacts(args: {
  worldBibleAvailable: boolean
  storySpineAvailable: boolean
  characters: readonly Pick<CharacterProfile, "id" | "name">[]
  outlines: readonly ChapterOutline[]
}): PlanningArtifactSummary {
  const outlines = [...args.outlines].sort((a, b) => a.chapterNumber - b.chapterNumber)
  const previousContextByChapter = new Map<number, boolean>()
  for (const outline of outlines) {
    const prior = outlines.filter(row => row.chapterNumber < outline.chapterNumber)
    previousContextByChapter.set(outline.chapterNumber, prior.some(hasReaderInfoSource))
  }

  const sceneRows = outlines.flatMap(outline =>
    (outline.scenes ?? []).map((scene, sceneIndex) => ({ outline, scene, sceneIndex }))
  )
  const scenes = sceneRows.map(row => row.scene)
  const sceneContractShapes = scenes.map(scene => summarizeSceneContractShape(readRecord(scene)))
  const obligationItems = scenes.flatMap(scene => obligationItemsForScene(scene))
  const sceneLoad = summarizeSceneLoad(outlines)
  const planContinuity = summarizePlanContinuity(outlines)
  const sceneContractShape = summarizeSceneContractShapeGaps(sceneRows)

  return {
    worldBibleAvailable: args.worldBibleAvailable,
    storySpineAvailable: args.storySpineAvailable,
    characterCount: args.characters.length,
    canonFactCount: outlines.reduce((sum, outline) => sum + (outline.establishedFacts ?? []).length, 0),
    canonKnowledgeChangeCount: outlines.reduce((sum, outline) => sum + (outline.knowledgeChanges ?? []).length, 0),
    canonCharacterStateChangeCount: outlines.reduce((sum, outline) => sum + (outline.characterStateChanges ?? []).length, 0),
    canonChangeCount: outlines.reduce((sum, outline) =>
      sum +
      (outline.establishedFacts ?? []).length +
      (outline.knowledgeChanges ?? []).length +
      (outline.characterStateChanges ?? []).length,
    0),
    chapterPlanCount: outlines.length,
    plannedSceneCount: scenes.length,
    sceneLoad,
    planContinuity,
    scenesWithCharacters: scenes.filter(scene => stringArray((scene as Record<string, unknown>).characters).length > 0).length,
    scenesWithSceneIds: scenes.filter(scene => hasText((scene as Record<string, unknown>).sceneId)).length,
    scenesWithSceneContract: sceneContractShapes.filter(shape => shape.hasAny).length,
    scenesWithTemporalAnchor: scenes.filter(scene => hasText(readRecord(scene).temporalAnchor)).length,
    scenesWithPlaceAnchor: scenes.filter(scene => hasText(readRecord(scene).placeAnchor)).length,
    sceneContractsWithDramaticShape: sceneContractShapes.filter(shape => shape.hasDramaticShape).length,
    sceneContractsWithChoiceShape: sceneContractShapes.filter(shape => shape.hasChoiceShape).length,
    sceneContractsWithEndpointShape: sceneContractShapes.filter(shape => shape.hasEndpointShape).length,
    sceneContractsWithFullDramaticShape: sceneContractShapes.filter(shape => shape.hasFullDramaticShape).length,
    anchorOnlySceneContracts: sceneContractShapes.filter(shape => shape.isAnchorOnly).length,
    sceneContractShape,
    scenesWithObligations: scenes.filter(scene => obligationItemsForScene(scene).length > 0).length,
    scenesWithImplicitReferences: scenes.filter(scene =>
      beatDescriptionHasImplicitReference(String((scene as Record<string, unknown>).description ?? ""))
    ).length,
    chaptersWithSetting: outlines.filter(outline => hasText(outline.setting)).length,
    chaptersWithCharactersPresentIds: outlines.filter(outline => (outline.charactersPresentIds ?? []).length > 0).length,
    readerInfoSourceChapters: outlines.filter(outline =>
      outline.chapterNumber > 1 && previousContextByChapter.get(outline.chapterNumber) === true
    ).length,
    obligationIds: obligationItems.filter(item => hasText(item.obligationId)).length,
    obligationSourceRefs: obligationItems.filter(item =>
      hasText(item.sourceId) || hasText(item.characterId)
    ).length,
    activeStoryRefIds: obligationItems.filter(item =>
      hasText(item.threadId) || hasText(item.promiseId) || hasText(item.payoffId)
    ).length,
    implicitReferenceScenes: summarizeImplicitReferenceScenes(sceneRows),
  }
}

export function buildPlanningToDraftingContextReport(args: {
  novelId?: string | null
  upstream: PlanningArtifactSummary
  writerContext: WriterContextTelemetryReport
}): PlanningToDraftingContextReport {
  const upstream = args.upstream
  const downstream = args.writerContext.totals
  const eventCount = downstream.events
  const surfaces: PlanningToDraftingContextAuditRow[] = [
    auditSurface({
      surface: "characterProfiles",
      upstreamAvailable: upstream.characterCount > 0,
      upstreamCount: upstream.characterCount,
      downstreamCount: downstream.withCharacterProfiles,
      eventCount,
      note: "Character Profiles exist upstream and should be visible when planned characters reach Beat Context.",
    }),
    auditSurface({
      surface: "characterSnapshots",
      upstreamAvailable: upstream.characterCount > 0 && upstream.scenesWithCharacters > 0,
      upstreamCount: upstream.scenesWithCharacters,
      downstreamCount: downstream.withCharacterSnapshots,
      eventCount,
      note: "Character Snapshots are the Beat-scoped character profile/state representation.",
    }),
    auditSurface({
      surface: "characterContextCapsules",
      upstreamAvailable: upstream.characterCount > 0 && upstream.scenesWithCharacters > 0,
      upstreamCount: upstream.scenesWithCharacters,
      downstreamCount: downstream.withCharacterContextCapsules,
      eventCount,
      note: "Thread-character capsules carry active thread/promise/payoff refs for present characters.",
    }),
    auditSurface({
      surface: "worldBible",
      upstreamAvailable: upstream.worldBibleAvailable,
      upstreamCount: upstream.worldBibleAvailable ? 1 : 0,
      downstreamCount: downstream.withWorldBible,
      eventCount,
      note: "Writer telemetry currently observes World-Bible-derived context through selected world/setting slots.",
    }),
    auditSurface({
      surface: "canonFacts",
      upstreamAvailable: upstream.canonChangeCount > 0 || upstream.obligationSourceRefs > 0,
      upstreamCount: upstream.canonChangeCount,
      downstreamCount: downstream.withCanonFactContext,
      eventCount,
      note: "Planner canon facts, knowledge changes, and character state changes should reach the writer as source-refed obligations, reader-state, or fact-continuity anchors.",
    }),
    auditSurface({
      surface: "setting",
      upstreamAvailable: upstream.worldBibleAvailable && upstream.chaptersWithSetting > 0,
      upstreamCount: upstream.chaptersWithSetting,
      downstreamCount: downstream.withSetting,
      eventCount,
      note: "Setting coverage means the writer saw a selected location/setting block, not the whole World Bible.",
    }),
    auditSurface({
      surface: "storySpine",
      upstreamAvailable: upstream.storySpineAvailable,
      upstreamCount: upstream.storySpineAvailable ? 1 : 0,
      downstreamCount: downstream.withStoryContext,
      eventCount,
      note: "Downstream story coverage is represented by obligations and active thread/promise/payoff refs, not a full Story Spine dump.",
    }),
    auditStoryRefLineageSurface({
      storySpineAvailable: upstream.storySpineAvailable,
      upstreamStoryRefCount: upstream.activeStoryRefIds,
      downstreamStoryRefCount: downstream.storyRefIds,
      eventCount,
    }),
    auditSurface({
      surface: "readerInfoState",
      upstreamAvailable: upstream.readerInfoSourceChapters > 0,
      upstreamCount: upstream.readerInfoSourceChapters,
      downstreamCount: downstream.withReaderInfoState,
      eventCount,
      note: "Reader-info state should appear when later chapters have prior facts/knowledge/state to protect.",
    }),
    auditResolvedReferencesSurface({
      surface: "resolvedReferences",
      upstreamAvailable: upstream.scenesWithImplicitReferences > 0,
      upstreamCount: upstream.scenesWithImplicitReferences,
      downstreamCount: downstream.withResolvedReferences,
      eventCount,
      note: "Resolved references are selected only when a Beat description carries implicit-reference markers.",
      implicitReferenceEvents: downstream.withImplicitReferences,
      referenceLookups: downstream.referenceLookups,
      referenceLlmCalls: downstream.referenceLlmCalls,
    }),
    auditSurface({
      surface: "sceneContract",
      upstreamAvailable: upstream.scenesWithSceneContract > 0,
      upstreamCount: upstream.scenesWithSceneContract,
      downstreamCount: downstream.withSceneContract,
      eventCount,
      note: "Scene contract coverage includes anchors, budgets, and dramatic fields; shape counts separate anchor-only from goal/turn/outcome coverage.",
    }),
    auditSurface({
      surface: "obligations",
      upstreamAvailable: upstream.scenesWithObligations > 0,
      upstreamCount: upstream.scenesWithObligations,
      downstreamCount: downstream.withObligations,
      eventCount,
      note: "Obligations are the traceable plan requirements the writer/checkers share.",
    }),
    auditSurface({
      surface: "draftingBrief",
      upstreamAvailable: eventCount > 0,
      upstreamCount: eventCount,
      downstreamCount: downstream.withDraftingBriefTrace,
      eventCount,
      note: "Drafting brief trace records whether the selected writer prompt used the compact production brief or full context.",
    }),
  ]

  return {
    novelId: args.novelId ?? args.writerContext.novelId ?? null,
    upstream,
    downstream,
    surfaces,
    gaps: surfaces.filter(row =>
      row.status === "missing_downstream" ||
      row.status === "not_observed" ||
      row.status === "represented_without_upstream"
    ),
    referenceContextAttempts: summarizeReferenceContextAttempts(upstream, args.writerContext),
  }
}

export function renderPlanningToDraftingContextReport(report: PlanningToDraftingContextReport): string {
  const lines: string[] = []
  lines.push(`Planning-to-drafting context contract${report.novelId ? ` for ${report.novelId}` : ""}`)
  lines.push(
    `Upstream: worldBible=${report.upstream.worldBibleAvailable ? "yes" : "no"}, ` +
      `storySpine=${report.upstream.storySpineAvailable ? "yes" : "no"}, ` +
      `characters=${report.upstream.characterCount}, chapterPlans=${report.upstream.chapterPlanCount}, ` +
      `scenes=${report.upstream.plannedSceneCount}, ` +
      `canonFacts=${report.upstream.canonFactCount}, canonKnowledge=${report.upstream.canonKnowledgeChangeCount}, ` +
      `canonStates=${report.upstream.canonCharacterStateChangeCount}`,
  )
  lines.push(
      `Plan shape: sceneIds=${report.upstream.scenesWithSceneIds}/${report.upstream.plannedSceneCount}, ` +
      `sceneContracts=${report.upstream.scenesWithSceneContract} ` +
      `(dramatic=${report.upstream.sceneContractsWithDramaticShape}, choice=${report.upstream.sceneContractsWithChoiceShape}, ` +
      `endpoint=${report.upstream.sceneContractsWithEndpointShape}, full=${report.upstream.sceneContractsWithFullDramaticShape}, ` +
      `anchorOnly=${report.upstream.anchorOnlySceneContracts}, ` +
      `temporal=${report.upstream.scenesWithTemporalAnchor}, place=${report.upstream.scenesWithPlaceAnchor}), ` +
      `obligations=${report.upstream.scenesWithObligations}, ` +
      `obligationIds=${report.upstream.obligationIds}, sourceRefs=${report.upstream.obligationSourceRefs}, ` +
      `storyRefs=${report.upstream.activeStoryRefIds}, implicitRefs=${report.upstream.scenesWithImplicitReferences}, ` +
      `readerInfoSourceChapters=${report.upstream.readerInfoSourceChapters}`,
  )
  const sceneContractShape = report.upstream.sceneContractShape
  const missingDramaticShape = sceneContractShape?.missingDramaticShape ?? []
  const missingChoiceShape = sceneContractShape?.missingChoiceShape ?? []
  const missingFullDramaticShape = sceneContractShape?.missingFullDramaticShape ?? []
  const anchorOnly = sceneContractShape?.anchorOnly ?? []
  lines.push(
    `Scene contract shape gaps: missingDramatic=${missingDramaticShape.length}, ` +
      `missingChoice=${missingChoiceShape.length}, missingFull=${missingFullDramaticShape.length}, ` +
      `anchorOnly=${anchorOnly.length}`,
  )
  for (const gap of [...missingDramaticShape, ...missingChoiceShape, ...missingFullDramaticShape].slice(0, 5)) {
    lines.push(
      `- ${gap.label}: ${gap.sceneRef}; missing=${gap.missingFields.join(",")}; ` +
        `obligations=${gap.hasObligations ? "yes" : "no"}; "${gap.descriptionExcerpt}"`,
    )
  }
  lines.push(
    `Scene load: maxScenesPerChapter=${report.upstream.sceneLoad.maxScenesPerChapter}, ` +
      `minTargetWordsPerScene=${formatNullableNumber(report.upstream.sceneLoad.minTargetWordsPerScene)}, ` +
      `denseChapters=${report.upstream.sceneLoad.denseChapterCount}, ` +
      `overloadedChapters=${report.upstream.sceneLoad.overloadedChapterCount}`,
  )
  lines.push(
    `Plan continuity: futureEventAnchors=${report.upstream.planContinuity.futureEventAnchors.length}, ` +
      `factContradictions=${report.upstream.planContinuity.factContradictions.length}`,
  )
  for (const finding of report.upstream.planContinuity.futureEventAnchors.slice(0, 5)) {
    lines.push(
      `- ${finding.label}: ${finding.sourceChapterId} -> ${finding.targetSceneRef}; ` +
        `source="${finding.sourceText}"`,
    )
  }
  for (const finding of report.upstream.planContinuity.factContradictions.slice(0, 5)) {
    lines.push(
      `- ${finding.label}: ${finding.sourceRef} -> ${finding.targetSceneRef}; ` +
        `anchors=${finding.sharedAnchors.join(",")}; source="${finding.sourceText}"`,
    )
  }
  if (report.upstream.sceneLoad.chapters.length > 0) {
    lines.push(
      `Scene load by chapter: ${report.upstream.sceneLoad.chapters.map(chapter =>
        `ch${chapter.chapterNumber}=${chapter.sceneCount}sc/${formatNullableNumber(chapter.targetWordsPerScene)}wps/${chapter.signal}`
      ).join(", ")}`,
    )
  }
  const referenceContextAttempts = report.referenceContextAttempts ?? []
  if (referenceContextAttempts.length > 0) {
    const eventCount = referenceContextAttempts.reduce((sum, attempt) => sum + attempt.eventCount, 0)
    lines.push(`Reference context attempts: scenes=${referenceContextAttempts.length}, events=${eventCount}`)
    for (const attempt of referenceContextAttempts.slice(0, 8)) {
      lines.push(
        `- REF-ATTEMPT: events=${attempt.eventIds.map(id => `#${id}`).join(",")} ` +
          `ch${attempt.chapter ?? "?"}` +
          `${attempt.beatIndex == null ? "" : ` beat${attempt.beatIndex + 1}`} stages=${attempt.stages.join(",")}; ` +
          `scene=${attempt.sceneRef ?? "unknown"}; lookups=${attempt.referenceLookups}; llm=${attempt.referenceLlmCalls}; ` +
          `canonRefs=${attempt.canonSourceRefs}; storyRefs=${attempt.storyRefIds}; ` +
          `readerChars=${attempt.readerInfoStateChars}; missingChars=${attempt.missingCharacterIds}` +
          `${attempt.descriptionExcerpt ? `; "${attempt.descriptionExcerpt}"` : ""}`,
      )
    }
  }
  lines.push(
    `Downstream writer-context events: ${report.downstream.events}; ` +
      `character=${report.downstream.withCharacterContext}, world=${report.downstream.withWorldContext}, ` +
      `canon=${report.downstream.withCanonFactContext} (sourceRefs=${report.downstream.canonSourceRefs}, factAnchors=${report.downstream.withFactContinuityAnchors}), ` +
      `story=${report.downstream.withStoryContext} (storyRefs=${report.downstream.storyRefIds}), ` +
      `readerInfo=${report.downstream.withReaderInfoState} (readerChars=${report.downstream.readerInfoStateChars}), ` +
      `implicitRefs=${report.downstream.withImplicitReferences}, refs=${report.downstream.withResolvedReferences}, ` +
      `refLookups=${report.downstream.referenceLookups}, sceneContract=${report.downstream.withSceneContract} ` +
      `(shapeCounts=${report.downstream.withSceneContractShapeCounts}, dramatic=${report.downstream.withDramaticSceneContract}, anchorOnly=${report.downstream.withAnchorOnlySceneContract}, ` +
      `anchors=${report.downstream.withSceneContractAnchors}), ` +
      `obligations=${report.downstream.withObligations}, draftingBrief=${report.downstream.withDraftingBriefTrace}`,
  )
  lines.push(`Gaps: ${report.gaps.length}`)
  for (const row of report.surfaces) {
    lines.push(
      `- ${row.surface}: ${row.status}; upstream=${row.upstreamCount}; ` +
        `downstream=${row.downstreamCount}; ${row.note}`,
    )
  }
  return lines.join("\n")
}

function auditResolvedReferencesSurface(args: {
  surface: "resolvedReferences"
  upstreamAvailable: boolean
  upstreamCount: number
  downstreamCount: number
  eventCount: number
  note: string
  implicitReferenceEvents: number
  referenceLookups: number
  referenceLlmCalls: number
}): PlanningToDraftingContextAuditRow {
  const attemptedResolution =
    args.implicitReferenceEvents > 0 &&
    (args.referenceLookups > 0 || args.referenceLlmCalls > 0)
  if (args.upstreamAvailable && args.downstreamCount === 0 && attemptedResolution) {
    return {
      surface: args.surface,
      upstreamAvailable: true,
      upstreamCount: args.upstreamCount,
      downstreamRepresented: false,
      downstreamCount: 0,
      status: "attempted_no_context",
      note: `${args.note} The resolver observed implicit markers and attempted lookups, but no retrievable context was rendered.`,
    }
  }
  return auditSurface(args)
}

function auditStoryRefLineageSurface(args: {
  storySpineAvailable: boolean
  upstreamStoryRefCount: number
  downstreamStoryRefCount: number
  eventCount: number
}): PlanningToDraftingContextAuditRow {
  const note = args.upstreamStoryRefCount > 0
    ? "Explicit thread/promise/payoff refs emitted by the plan should reach writer telemetry as story-ref lineage."
    : args.storySpineAvailable
      ? "Story Spine exists, but the plan emitted no explicit thread/promise/payoff refs; broad story context is audited separately."
      : "No upstream Story Spine or explicit thread/promise/payoff refs were available for lineage."
  return auditSurface({
    surface: "storyRefLineage",
    upstreamAvailable: args.upstreamStoryRefCount > 0,
    upstreamCount: args.upstreamStoryRefCount,
    downstreamCount: args.downstreamStoryRefCount,
    eventCount: args.eventCount,
    note,
  })
}

function summarizeImplicitReferenceScenes(
  rows: Array<{ outline: ChapterOutline; scene: unknown; sceneIndex: number }>,
): ImplicitReferenceSceneSummary[] {
  return rows
    .filter(row => beatDescriptionHasImplicitReference(String(readRecord(row.scene).description ?? "")))
    .map(row => {
      const record = readRecord(row.scene)
      const chapterId = row.outline.chapterId ?? `chapter:${row.outline.chapterNumber}`
      return {
        chapterNumber: row.outline.chapterNumber,
        chapterId,
        beatIndex: row.sceneIndex,
        sceneRef: sceneRef(row.scene) ?? `${chapterId}-scene-${row.sceneIndex + 1}`,
        descriptionExcerpt: truncateForEvidence(String(record.description ?? "")),
      }
    })
}

function summarizeReferenceContextAttempts(
  upstream: PlanningArtifactSummary,
  writerContext: WriterContextTelemetryReport,
): ReferenceContextAttemptSummary[] {
  const sceneByKey = new Map(
    upstream.implicitReferenceScenes.map(scene => [`${scene.chapterNumber}:${scene.beatIndex}`, scene] as const),
  )
  const attempts = writerContext.events
    .filter(event =>
      event.surfaces.implicitReferences &&
      !event.surfaces.resolvedReferences &&
      (event.referenceLookups > 0 || event.referenceLlmCalls > 0)
    )
    .map(event => {
      const scene = event.chapter !== null && event.beatIndex !== null
        ? sceneByKey.get(`${event.chapter}:${event.beatIndex}`)
        : undefined
      return {
        eventId: event.id,
        chapter: event.chapter,
        beatIndex: event.beatIndex,
        stage: event.stage,
        sceneRef: scene?.sceneRef ?? null,
        descriptionExcerpt: scene?.descriptionExcerpt ?? null,
        referenceLookups: event.referenceLookups,
        referenceLlmCalls: event.referenceLlmCalls,
        canonSourceRefs: event.canonSourceRefs,
        storyRefIds: event.storyRefIds,
        readerInfoStateChars: event.readerInfoStateChars,
        missingCharacterIds: event.missingCharacterIds,
      }
    })
  const grouped = new Map<string, ReferenceContextAttemptSummary>()
  for (const attempt of attempts) {
    const key = [
      attempt.chapter ?? "?",
      attempt.beatIndex ?? "?",
      attempt.sceneRef ?? "unknown",
    ].join(":")
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, {
        eventIds: [attempt.eventId],
        eventCount: 1,
        chapter: attempt.chapter,
        beatIndex: attempt.beatIndex,
        stages: [attempt.stage],
        sceneRef: attempt.sceneRef,
        descriptionExcerpt: attempt.descriptionExcerpt,
        referenceLookups: attempt.referenceLookups,
        referenceLlmCalls: attempt.referenceLlmCalls,
        canonSourceRefs: attempt.canonSourceRefs,
        storyRefIds: attempt.storyRefIds,
        readerInfoStateChars: attempt.readerInfoStateChars,
        missingCharacterIds: attempt.missingCharacterIds,
      })
      continue
    }
    existing.eventIds.push(attempt.eventId)
    existing.eventCount += 1
    if (!existing.stages.includes(attempt.stage)) existing.stages.push(attempt.stage)
    existing.referenceLookups += attempt.referenceLookups
    existing.referenceLlmCalls += attempt.referenceLlmCalls
    existing.canonSourceRefs = Math.max(existing.canonSourceRefs, attempt.canonSourceRefs)
    existing.storyRefIds = Math.max(existing.storyRefIds, attempt.storyRefIds)
    existing.readerInfoStateChars = Math.max(existing.readerInfoStateChars, attempt.readerInfoStateChars)
    existing.missingCharacterIds = Math.max(existing.missingCharacterIds, attempt.missingCharacterIds)
  }
  return [...grouped.values()]
}

function auditSurface(args: {
  surface: ContextContractSurface
  upstreamAvailable: boolean
  upstreamCount: number
  downstreamCount: number
  eventCount: number
  note: string
}): PlanningToDraftingContextAuditRow {
  const downstreamRepresented = args.downstreamCount > 0
  let status: ContextContractStatus
  if (args.upstreamAvailable && downstreamRepresented) status = "covered"
  else if (args.upstreamAvailable && args.eventCount === 0) status = "not_observed"
  else if (args.upstreamAvailable) status = "missing_downstream"
  else if (downstreamRepresented) status = "represented_without_upstream"
  else status = "not_available"

  return {
    surface: args.surface,
    upstreamAvailable: args.upstreamAvailable,
    upstreamCount: args.upstreamCount,
    downstreamRepresented,
    downstreamCount: args.downstreamCount,
    status,
    note: args.note,
  }
}

function summarizeSceneLoad(outlines: readonly ChapterOutline[]): SceneLoadSummary {
  const chapters = outlines.map(outline => {
    const normalized = canonicalOutlineForSceneLoad(outline)
    const sceneCount = (normalized.scenes ?? []).length
    const sceneRefs = (normalized.scenes ?? [])
      .map(scene => sceneRef(scene))
      .filter((ref): ref is string => ref !== null)
    const targetWords = positiveNumber(normalized.targetWords) ? normalized.targetWords : null
    const targetWordsPerScene = targetWords !== null && sceneCount > 0
      ? targetWords / sceneCount
      : null
    return {
      chapterNumber: normalized.chapterNumber,
      chapterId: normalized.chapterId ?? `chapter:${normalized.chapterNumber}`,
      sceneRefs,
      sceneCount,
      targetWords,
      targetWordsPerScene,
      signal: sceneLoadSignal(sceneCount, targetWordsPerScene),
    }
  })
  const targetWordsPerSceneValues = chapters
    .map(chapter => chapter.targetWordsPerScene)
    .filter((value): value is number => value !== null)
  return {
    chapters,
    maxScenesPerChapter: chapters.reduce((max, chapter) => Math.max(max, chapter.sceneCount), 0),
    minTargetWordsPerScene: targetWordsPerSceneValues.length > 0
      ? Math.min(...targetWordsPerSceneValues)
      : null,
    denseChapterCount: chapters.filter(chapter => chapter.signal === "dense").length,
    overloadedChapterCount: chapters.filter(chapter => chapter.signal === "overloaded").length,
  }
}

function summarizePlanContinuity(outlines: readonly ChapterOutline[]): PlanContinuitySummary {
  const normalized = outlines
    .map(canonicalOutlineForSceneLoad)
    .sort((a, b) => a.chapterNumber - b.chapterNumber)
  const futureSources = normalized.flatMap(futureEventSources)
  const findings: FutureEventAnchorFinding[] = []
  const seen = new Set<string>()

  for (const source of futureSources) {
    for (const targetChapter of normalized) {
      if (targetChapter.chapterNumber <= source.chapterNumber) continue
      const match = firstFutureEventTarget(source, targetChapter)
      if (!match) continue
      const key = [
        source.chapterId,
        targetChapter.chapterId ?? `chapter:${targetChapter.chapterNumber}`,
        "future-event-anchor",
      ].join("::")
      if (seen.has(key)) break
      seen.add(key)
      findings.push({
        label: "FUTURE-EVENT-ANCHOR-MISSING",
        severity: "medium",
        sourceChapterNumber: source.chapterNumber,
        sourceChapterId: source.chapterId,
        targetChapterNumber: targetChapter.chapterNumber,
        targetChapterId: targetChapter.chapterId ?? `chapter:${targetChapter.chapterNumber}`,
        sourceRef: source.ref,
        targetSceneRef: match.sceneRef,
        sourceText: source.text,
        targetTextExcerpt: truncateForEvidence(match.text),
        eventTokens: source.eventTokens,
        requiredTemporalCue: temporalCueRequirement(source.text),
      })
      break
    }
  }

  return {
    futureEventAnchors: findings,
    factContradictions: summarizePlanFactContradictions(normalized),
  }
}

interface PlanFactStatusSource {
  chapterNumber: number
  chapterId: string
  ref: string
  text: string
  anchors: string[]
  tokens: string[]
}

function summarizePlanFactContradictions(
  outlines: readonly ChapterOutline[],
): PlanFactContradictionFinding[] {
  const sources = outlines.flatMap(planFactStatusSources)
  const findings: PlanFactContradictionFinding[] = []
  const seen = new Set<string>()

  for (const source of sources) {
    for (const targetChapter of outlines) {
      if (targetChapter.chapterNumber <= source.chapterNumber) continue
      for (const target of planFactStatusTargets(targetChapter)) {
        const conflict = factStatusConflict(source, target.text)
        if (!conflict) continue
        const sharedAnchors = source.anchors.filter(anchor => target.anchors.includes(anchor))
        if (sharedAnchors.length === 0) continue
        const key = [source.ref, target.sceneRef, conflict.tokens.join("|")].join("::")
        if (seen.has(key)) continue
        seen.add(key)
        findings.push({
          label: "PLAN-FACT-STATUS-CONTRADICTION",
          severity: conflict.severity,
          sourceChapterNumber: source.chapterNumber,
          sourceChapterId: source.chapterId,
          targetChapterNumber: targetChapter.chapterNumber,
          targetChapterId: targetChapter.chapterId ?? `chapter:${targetChapter.chapterNumber}`,
          sourceRef: source.ref,
          targetSceneRef: target.sceneRef,
          sourceText: source.text,
          targetTextExcerpt: truncateForEvidence(target.text),
          sharedAnchors,
          conflictTokens: conflict.tokens,
          requiredFactStatus: `Preserve ${source.ref}: ${source.text}`,
        })
      }
    }
  }

  return findings
}

function planFactStatusSources(outline: ChapterOutline): PlanFactStatusSource[] {
  const chapterId = outline.chapterId ?? `chapter:${outline.chapterNumber}`
  return (outline.establishedFacts ?? [])
    .map(fact => ({
      chapterNumber: outline.chapterNumber,
      chapterId,
      ref: fact.id ?? chapterId,
      text: fact.fact,
      anchors: salientEntityAnchors(fact.fact),
      tokens: liabilityStatusTokens(fact.fact),
    }))
    .filter(source => source.anchors.length > 0 && source.tokens.length > 0)
}

function planFactStatusTargets(outline: ChapterOutline): Array<{ sceneRef: string; text: string; anchors: string[] }> {
  const targets: Array<{ sceneRef: string; text: string; anchors: string[] }> = []
  for (const scene of outline.scenes ?? []) {
    const sceneReference = sceneRef(scene)
    if (!sceneReference) continue
    const text = scenePlanningText(scene)
    if (!text) continue
    targets.push({ sceneRef: sceneReference, text, anchors: salientEntityAnchors(text) })
  }
  return targets
}

function factStatusConflict(
  source: PlanFactStatusSource,
  targetText: string,
): { severity: "high" | "medium"; tokens: string[] } | null {
  const target = normalizedText(targetText)
  const tokens: string[] = []
  if (source.tokens.some(token => token === "debt" || token === "imprisoned")) {
    if (/\b(?:clean|clear|free)\s+of\b[^.]{0,80}\b(?:debt|crime|criminal)\b/.test(target) ||
      /\bno\s+(?:significant\s+)?(?:debt|crime|criminal\s+record)\b/.test(target) ||
      /\bwithout\s+(?:significant\s+)?(?:debt|crime|criminal\s+record)\b/.test(target)
    ) {
      tokens.push("clean-record-vs-debt")
    }
  }
  return tokens.length > 0
    ? { severity: source.tokens.includes("imprisoned") ? "high" : "medium", tokens }
    : null
}

function liabilityStatusTokens(text: string): string[] {
  const normalized = normalizedText(text)
  const tokens: string[] = []
  if (/\b(?:imprisoned|prison|jailed|incarcerated)\b/.test(normalized)) tokens.push("imprisoned")
  if (/\b(?:debt|debtor|owed|owes|owing|ruin)\b/.test(normalized)) tokens.push("debt")
  if (/\b(?:crime|criminal|convicted|record)\b/.test(normalized)) tokens.push("criminal")
  return unique(tokens)
}

function salientEntityAnchors(text: string): string[] {
  const anchors = new Set<string>()
  for (const match of text.matchAll(/\b[A-Z][a-zA-Z']{2,}\b/g)) {
    const token = match[0].toLowerCase()
    if (!ENTITY_ANCHOR_STOPWORDS.has(token)) anchors.add(token)
  }
  const normalized = normalizedText(text)
  for (const role of ENTITY_ROLE_ANCHORS) {
    if (new RegExp(`\\b${role}\\b`).test(normalized)) anchors.add(role)
  }
  return [...anchors]
}

const ENTITY_ROLE_ANCHORS = [
  "foreman",
  "chancellor",
  "sergeant",
  "prisoner",
  "debtor",
  "bearer",
  "clerk",
  "warden",
  "arbiter",
] as const

const ENTITY_ANCHOR_STOPWORDS = new Set([
  "a",
  "an",
  "chapter",
  "maren",
  "the",
  "treasury",
  "counting",
  "house",
  "office",
  "keep",
])

interface FutureEventSource {
  chapterNumber: number
  chapterId: string
  ref: string
  text: string
  eventTokens: string[]
}

function futureEventSources(outline: ChapterOutline): FutureEventSource[] {
  const chapterId = outline.chapterId ?? `chapter:${outline.chapterNumber}`
  const sources: Array<{ ref: string; text: string }> = []
  for (const fact of outline.establishedFacts ?? []) {
    sources.push({ ref: fact.id ?? chapterId, text: fact.fact })
  }
  for (const knowledge of outline.knowledgeChanges ?? []) {
    sources.push({ ref: knowledge.id ?? chapterId, text: knowledge.knowledge })
  }
  for (const scene of outline.scenes ?? []) {
    const sceneReference = sceneRef(scene) ?? chapterId
    const record = readRecord(scene)
    if (hasText(record.description)) sources.push({ ref: sceneReference, text: record.description as string })
    for (const item of obligationItemsForScene(scene)) {
      const ref = hasText(item.obligationId) ? item.obligationId as string : sceneReference
      if (hasText(item.text)) sources.push({ ref, text: item.text as string })
    }
  }
  const out: FutureEventSource[] = []
  const seen = new Set<string>()
  for (const source of sources) {
    if (!hasFutureSchedulingCue(source.text)) continue
    const eventTokens = futureEventTokens(source.text)
    if (eventTokens.length === 0) continue
    const key = eventTokens.join("|")
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      chapterNumber: outline.chapterNumber,
      chapterId,
      ref: source.ref,
      text: source.text.trim(),
      eventTokens,
    })
  }
  return out
}

function firstFutureEventTarget(
  source: FutureEventSource,
  targetChapter: ChapterOutline,
): { sceneRef: string; text: string } | null {
  for (const scene of targetChapter.scenes ?? []) {
    const sceneReference = sceneRef(scene)
    if (!sceneReference) continue
    const text = scenePlanningText(scene)
    if (!text) continue
    if (!mentionsSameFutureEvent(text, source)) continue
    if (hasTemporalLandingCue(text, source.text)) return null
    return { sceneRef: sceneReference, text }
  }
  return null
}

function mentionsSameFutureEvent(text: string, source: FutureEventSource): boolean {
  const target = normalizedText(text)
  if (source.eventTokens.some(token => target.includes(token))) return true
  const sourceText = normalizedText(source.text)
  return (sourceText.includes("verification") && /\btest\b/.test(target)) ||
    (sourceText.includes("test") && /\bverification\b/.test(target))
}

function scenePlanningText(scene: unknown): string {
  const record = readRecord(scene)
  const parts = [
    hasText(record.description) ? record.description as string : "",
    hasText(record.temporalAnchor) ? record.temporalAnchor as string : "",
    hasText(record.placeAnchor) ? record.placeAnchor as string : "",
    ...obligationItemsForScene(scene).map(item => hasText(item.text) ? item.text as string : ""),
  ].filter(Boolean)
  return parts.join(" ")
}

function hasFutureSchedulingCue(text: string): boolean {
  return /\b(tomorrow|next\s+(?:morning|day|dawn)|following\s+(?:morning|day|dawn)|scheduled\s+for)\b/i.test(text)
}

function hasTemporalLandingCue(targetText: string, sourceText: string): boolean {
  const target = normalizedText(targetText)
  if (/\bdawn\b/i.test(sourceText) && /\b(dawn|daybreak|sunrise)\b/.test(target)) return true
  return /\b(tomorrow|next\s+(?:morning|day|dawn)|following\s+(?:morning|day|dawn)|daybreak|sunrise|that\s+morning|at\s+dawn)\b/.test(target)
}

function temporalCueRequirement(sourceText: string): string {
  if (/\bdawn\b/i.test(sourceText)) return "Carry the dawn timing into the later scene or explicitly revise the schedule."
  if (/\btomorrow\b/i.test(sourceText)) return "Carry the next-day timing into the later scene or explicitly revise the schedule."
  return "Carry the scheduled future timing into the later scene or explicitly revise the schedule."
}

function futureEventTokens(text: string): string[] {
  const stop = new Set([
    "about",
    "after",
    "before",
    "during",
    "event",
    "following",
    "mandatory",
    "scheduled",
    "system",
    "their",
    "there",
    "tomorrow",
    "upcoming",
  ])
  return unique(
    normalizedText(text)
      .split(/[^a-z0-9]+/)
      .filter(token => token.length >= 5 && !stop.has(token)),
  ).slice(0, 6)
}

function normalizedText(text: string): string {
  return text.toLowerCase()
}

function truncateForEvidence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ")
  return trimmed.length > 260 ? `${trimmed.slice(0, 257)}...` : trimmed
}

function canonicalOutlineForSceneLoad(outline: ChapterOutline): ChapterOutline {
  const normalized = JSON.parse(JSON.stringify(outline)) as ChapterOutline
  enrichOutlineIds(normalized)
  return normalized
}

function sceneRef(scene: unknown): string | null {
  if (scene === null || typeof scene !== "object" || Array.isArray(scene)) return null
  const record = scene as Record<string, unknown>
  return hasText(record.sceneId) ? record.sceneId as string : hasText(record.beatId) ? record.beatId as string : null
}

function sceneLoadSignal(sceneCount: number, targetWordsPerScene: number | null): SceneLoadSignal {
  if (sceneCount === 0 || targetWordsPerScene === null) return "unknown"
  if (sceneCount >= 8 && targetWordsPerScene < 180) return "overloaded"
  if (sceneCount >= 8 || targetWordsPerScene < 250) return "dense"
  return "balanced"
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "n/a" : Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function hasReaderInfoSource(outline: ChapterOutline): boolean {
  return (outline.establishedFacts ?? []).length > 0 ||
    (outline.characterStateChanges ?? []).length > 0 ||
    (outline.knowledgeChanges ?? []).length > 0
}

const DRAMATIC_SCENE_CONTRACT_FIELDS = [
  "goal",
  "opposition",
  "turningPoint",
  "outcome",
  "consequence",
  "povPersonalStake",
  "valueIn",
  "valueOut",
] as const

const FULL_DRAMATIC_SCENE_CONTRACT_FIELDS = [
  "goal",
  "opposition",
  "turningPoint",
  "crisisChoice",
  "choiceAlternatives",
  "outcome",
  "consequence",
  "povPersonalStake",
  "valueIn",
  "valueOut",
] as const

function summarizeSceneContractShapeGaps(
  rows: Array<{ outline: ChapterOutline; scene: unknown }>,
): SceneContractShapeSummary {
  const missingDramaticShape: DramaticSceneContractGap[] = []
  const missingChoiceShape: DramaticSceneContractGap[] = []
  const missingFullDramaticShape: DramaticSceneContractGap[] = []
  const anchorOnly: DramaticSceneContractGap[] = []

  for (const row of rows) {
    const record = readRecord(row.scene)
    const shape = summarizeSceneContractShape(record)
    const sceneReference = sceneRef(row.scene)
    if (!sceneReference) continue
    const obligationItems = obligationItemsForScene(row.scene)

    if (!shape.hasDramaticShape) {
      const gap = sceneContractGap({
        row,
        sceneReference,
        record,
        shape,
        obligationItems,
        label: shape.isAnchorOnly ? "ANCHOR-ONLY-SCENE-CONTRACT" : "DRAMATIC-SCENE-CONTRACT-MISSING",
        missingFields: missingDramaticFields(record),
      })
      missingDramaticShape.push(gap)
      if (shape.isAnchorOnly) anchorOnly.push(gap)
      continue
    }

    if (!shape.hasChoiceShape && shouldFlagSceneContractCompletenessGap(shape, obligationItems)) {
      missingChoiceShape.push(sceneContractGap({
        row,
        sceneReference,
        record,
        shape,
        obligationItems,
        label: "SCENE-CONTRACT-CHOICE-SHAPE-INCOMPLETE",
        missingFields: missingChoiceShapeFields(record),
      }))
    }

    if (!shape.hasFullDramaticShape && shouldFlagSceneContractCompletenessGap(shape, obligationItems)) {
      missingFullDramaticShape.push(sceneContractGap({
        row,
        sceneReference,
        record,
        shape,
        obligationItems,
        label: "SCENE-CONTRACT-FULL-SHAPE-INCOMPLETE",
        missingFields: missingFullDramaticFields(record),
      }))
    }
  }

  return { missingDramaticShape, missingChoiceShape, missingFullDramaticShape, anchorOnly }
}

function missingDramaticFields(scene: Record<string, unknown>): string[] {
  return DRAMATIC_SCENE_CONTRACT_FIELDS.filter(field => !hasText(scene[field]))
}

function missingChoiceShapeFields(scene: Record<string, unknown>): string[] {
  const fields: string[] = []
  if (!hasText(scene.crisisChoice)) fields.push("crisisChoice")
  if (stringArray(scene.choiceAlternatives).length < 2) fields.push("choiceAlternatives")
  return fields
}

function missingFullDramaticFields(scene: Record<string, unknown>): string[] {
  return FULL_DRAMATIC_SCENE_CONTRACT_FIELDS.filter(field =>
    field === "choiceAlternatives"
      ? stringArray(scene.choiceAlternatives).length < 2
      : !hasText(scene[field])
  )
}

function shouldFlagSceneContractCompletenessGap(
  shape: ReturnType<typeof summarizeSceneContractShape>,
  obligationItems: Array<Record<string, unknown>>,
): boolean {
  return shape.hasEndpointShape || shape.hasChoiceShape || shape.dramaticFields >= 4 || obligationItems.length > 0
}

function sceneContractGap(args: {
  row: { outline: ChapterOutline; scene: unknown }
  sceneReference: string
  record: Record<string, unknown>
  shape: ReturnType<typeof summarizeSceneContractShape>
  obligationItems: Array<Record<string, unknown>>
  label: DramaticSceneContractGap["label"]
  missingFields: string[]
}): DramaticSceneContractGap {
  return {
    label: args.label,
    severity: args.shape.hasAnchor || args.obligationItems.length > 0 || args.shape.hasEndpointShape ? "medium" : "low",
    chapterNumber: args.row.outline.chapterNumber,
    chapterId: args.row.outline.chapterId ?? `chapter:${args.row.outline.chapterNumber}`,
    sceneRef: args.sceneReference,
    descriptionExcerpt: truncateForEvidence(String(args.record.description ?? "")),
    hasTemporalAnchor: hasText(args.record.temporalAnchor),
    hasPlaceAnchor: hasText(args.record.placeAnchor),
    hasObligations: args.obligationItems.length > 0,
    hasChoiceShape: args.shape.hasChoiceShape,
    hasEndpointShape: args.shape.hasEndpointShape,
    hasFullDramaticShape: args.shape.hasFullDramaticShape,
    characterCount: stringArray(args.record.characters).length,
    obligationIds: idsFromRecords(args.obligationItems, "obligationId"),
    characterIds: unique([
      ...stringArray(args.record.requiredCharacterIds),
      ...stringArray(args.record.affectedCharacterIds),
      ...idsFromRecords(args.obligationItems, "characterId"),
    ]),
    sourceIds: idsFromRecords(args.obligationItems, "sourceId"),
    threadIds: idsFromRecords(args.obligationItems, "threadId"),
    promiseIds: idsFromRecords(args.obligationItems, "promiseId"),
    payoffIds: idsFromRecords(args.obligationItems, "payoffId"),
    missingFields: args.missingFields,
  }
}

function idsFromRecords(records: Array<Record<string, unknown>>, key: string): string[] {
  return unique(records.map(record => record[key]).filter(hasText) as string[])
}

function obligationItemsForScene(scene: unknown): Array<Record<string, unknown>> {
  const obligations = readRecord(readRecord(scene).obligations)
  const rows: Array<Record<string, unknown>> = []
  for (const value of Object.values(obligations)) {
    if (!Array.isArray(value)) continue
    for (const item of value) {
      const record = readRecord(item)
      if (hasText(record.text) || hasText(record.obligationId) || hasText(record.sourceId)) {
        rows.push(record)
      }
    }
  }
  const allowed = stringArray(obligations.allowedNewEntities)
  for (const entity of allowed) rows.push({ text: entity, allowedNewEntity: true })
  return rows
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(item => typeof item === "string" && item.trim().length > 0)
    : []
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0
}

function positiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function parseArgs(argv: string[]): Args {
  let novelId: string | null = null
  let json = false
  let outputPath: string | null = null
  let jsonOutputPath: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--novel") {
      const value = argv[++i]
      if (!value) throw new Error("--novel requires a value")
      novelId = value
    } else if (arg === "--json") {
      json = true
    } else if (arg === "--output") {
      const value = argv[++i]
      if (!value) throw new Error("--output requires a value")
      outputPath = value
    } else if (arg === "--json-output") {
      const value = argv[++i]
      if (!value) throw new Error("--json-output requires a value")
      jsonOutputPath = value
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }
  return { novelId, json, outputPath, jsonOutputPath }
}

export async function loadPlanningToDraftingContextReport(novelId: string): Promise<PlanningToDraftingContextReport> {
  const [upstream, writerRows] = await Promise.all([
    loadPlanningArtifacts(novelId),
    loadWriterContextRows(novelId),
  ])
  const writerContext = buildWriterContextTelemetryReport(writerRows, novelId)
  return buildPlanningToDraftingContextReport({
    novelId,
    upstream,
    writerContext,
  })
}

async function loadPlanningArtifacts(novelId: string): Promise<PlanningArtifactSummary> {
  const [worldRows, storyRows, characterRows, outlineRows] = await Promise.all([
    db<Array<{ present: boolean }>>`
      SELECT EXISTS(SELECT 1 FROM world_bibles WHERE novel_id = ${novelId}) AS present
    `,
    db<Array<{ present: boolean }>>`
      SELECT EXISTS(SELECT 1 FROM story_spines WHERE novel_id = ${novelId}) AS present
    `,
    db<Array<{ profile_json: CharacterProfile }>>`
      SELECT profile_json FROM characters WHERE novel_id = ${novelId} ORDER BY id
    `,
    db<Array<{ outline_json: ChapterOutline }>>`
      SELECT outline_json FROM chapter_outlines WHERE novel_id = ${novelId} ORDER BY chapter_number
    `,
  ])

  return summarizePlanningArtifacts({
    worldBibleAvailable: worldRows[0]?.present === true,
    storySpineAvailable: storyRows[0]?.present === true,
    characters: characterRows.map(row => row.profile_json),
    outlines: outlineRows.map(row => row.outline_json),
  })
}

async function loadWriterContextRows(novelId: string): Promise<WriterContextEventRow[]> {
  const rows = await db<Array<{
    id: number
    chapter: number | null
    beat_index: number | null
    payload: unknown
    timestamp: string | null
  }>>`
    SELECT id, chapter, beat_index, payload, timestamp
    FROM pipeline_events
    WHERE novel_id = ${novelId}
      AND event_type = 'writer-context'
    ORDER BY id
  `
  return rows
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    printUsage()
    return 2
  }

  if (!args.novelId) {
    printUsage()
    return 2
  }

  const report = await loadPlanningToDraftingContextReport(args.novelId)
  const rendered = renderPlanningToDraftingContextReport(report)
  const json = JSON.stringify(report, null, 2)
  if (args.outputPath) writeOutput(args.outputPath, `${rendered}\n`)
  if (args.jsonOutputPath) writeOutput(args.jsonOutputPath, `${json}\n`)
  console.log(args.json ? json : rendered)
  await db.end().catch(() => {})
  return 0
}

function writeOutput(path: string, content: string): void {
  const abs = resolve(path)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

function printUsage(): void {
  console.error("usage: bun scripts/analysis/planning-drafting-context-report.ts --novel <novelId> [--json] [--output <report.md>] [--json-output <report.json>]")
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
