#!/usr/bin/env bun
/**
 * Read-only production report for the planning-to-drafting context contract.
 *
 * It compares upstream artifact availability (World Bible, characters, Story
 * Spine, Chapter Plans) with downstream writer-context telemetry. The report is
 * diagnostic only: it does not gate drafting and does not mutate Canon or plans.
 */

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
  | "setting"
  | "storySpine"
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
  anchorOnlySceneContracts: number
  scenesWithObligations: number
  scenesWithImplicitReferences: number
  chaptersWithSetting: number
  chaptersWithCharactersPresentIds: number
  readerInfoSourceChapters: number
  obligationIds: number
  obligationSourceRefs: number
  activeStoryRefIds: number
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

export interface PlanContinuitySummary {
  futureEventAnchors: FutureEventAnchorFinding[]
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
}

interface Args {
  novelId: string | null
  json: boolean
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

  const scenes = outlines.flatMap(outline => outline.scenes ?? [])
  const sceneContractShapes = scenes.map(scene => summarizeSceneContractShape(readRecord(scene)))
  const obligationItems = scenes.flatMap(scene => obligationItemsForScene(scene))
  const sceneLoad = summarizeSceneLoad(outlines)
  const planContinuity = summarizePlanContinuity(outlines)

  return {
    worldBibleAvailable: args.worldBibleAvailable,
    storySpineAvailable: args.storySpineAvailable,
    characterCount: args.characters.length,
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
    anchorOnlySceneContracts: sceneContractShapes.filter(shape => shape.isAnchorOnly).length,
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
  }
}

export function renderPlanningToDraftingContextReport(report: PlanningToDraftingContextReport): string {
  const lines: string[] = []
  lines.push(`Planning-to-drafting context contract${report.novelId ? ` for ${report.novelId}` : ""}`)
  lines.push(
    `Upstream: worldBible=${report.upstream.worldBibleAvailable ? "yes" : "no"}, ` +
      `storySpine=${report.upstream.storySpineAvailable ? "yes" : "no"}, ` +
      `characters=${report.upstream.characterCount}, chapterPlans=${report.upstream.chapterPlanCount}, ` +
      `scenes=${report.upstream.plannedSceneCount}`,
  )
  lines.push(
      `Plan shape: sceneIds=${report.upstream.scenesWithSceneIds}/${report.upstream.plannedSceneCount}, ` +
      `sceneContracts=${report.upstream.scenesWithSceneContract} ` +
      `(dramatic=${report.upstream.sceneContractsWithDramaticShape}, anchorOnly=${report.upstream.anchorOnlySceneContracts}, ` +
      `temporal=${report.upstream.scenesWithTemporalAnchor}, place=${report.upstream.scenesWithPlaceAnchor}), ` +
      `obligations=${report.upstream.scenesWithObligations}, ` +
      `obligationIds=${report.upstream.obligationIds}, sourceRefs=${report.upstream.obligationSourceRefs}, ` +
      `storyRefs=${report.upstream.activeStoryRefIds}, implicitRefs=${report.upstream.scenesWithImplicitReferences}, ` +
      `readerInfoSourceChapters=${report.upstream.readerInfoSourceChapters}`,
  )
  lines.push(
    `Scene load: maxScenesPerChapter=${report.upstream.sceneLoad.maxScenesPerChapter}, ` +
      `minTargetWordsPerScene=${formatNullableNumber(report.upstream.sceneLoad.minTargetWordsPerScene)}, ` +
      `denseChapters=${report.upstream.sceneLoad.denseChapterCount}, ` +
      `overloadedChapters=${report.upstream.sceneLoad.overloadedChapterCount}`,
  )
  lines.push(
    `Plan continuity: futureEventAnchors=${report.upstream.planContinuity.futureEventAnchors.length}`,
  )
  for (const finding of report.upstream.planContinuity.futureEventAnchors.slice(0, 5)) {
    lines.push(
      `- ${finding.label}: ${finding.sourceChapterId} -> ${finding.targetSceneRef}; ` +
        `source="${finding.sourceText}"`,
    )
  }
  if (report.upstream.sceneLoad.chapters.length > 0) {
    lines.push(
      `Scene load by chapter: ${report.upstream.sceneLoad.chapters.map(chapter =>
        `ch${chapter.chapterNumber}=${chapter.sceneCount}sc/${formatNullableNumber(chapter.targetWordsPerScene)}wps/${chapter.signal}`
      ).join(", ")}`,
    )
  }
  lines.push(
    `Downstream writer-context events: ${report.downstream.events}; ` +
      `character=${report.downstream.withCharacterContext}, world=${report.downstream.withWorldContext}, ` +
      `story=${report.downstream.withStoryContext}, readerInfo=${report.downstream.withReaderInfoState}, ` +
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

  return { futureEventAnchors: findings }
}

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
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--novel") {
      const value = argv[++i]
      if (!value) throw new Error("--novel requires a value")
      novelId = value
    } else if (arg === "--json") {
      json = true
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }
  return { novelId, json }
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
    console.error("usage: bun scripts/analysis/planning-drafting-context-report.ts --novel <novelId> [--json]")
    return 2
  }

  if (!args.novelId) {
    console.error("usage: bun scripts/analysis/planning-drafting-context-report.ts --novel <novelId> [--json]")
    return 2
  }

  const report = await loadPlanningToDraftingContextReport(args.novelId)
  console.log(args.json ? JSON.stringify(report, null, 2) : renderPlanningToDraftingContextReport(report))
  await db.end().catch(() => {})
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
