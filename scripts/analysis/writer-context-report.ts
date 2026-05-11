#!/usr/bin/env bun
/**
 * Read-only production report for writer-context telemetry.
 *
 * This surfaces the context data captured by production drafting runs:
 * character/world/story context coverage, scene-contract coverage, and
 * writer-drafting-brief prompt-size telemetry.
 */

import db from "../../src/db/connection"

export interface WriterContextEventRow {
  id: number
  chapter: number | null
  beat_index: number | null
  payload: unknown
  timestamp: string | null
}

export interface WriterContextEventSummary {
  id: number
  chapter: number | null
  beatIndex: number | null
  path: string
  stage: string
  writerContextMode: string
  writerPromptIdRendering: string
  targetWords: number | null
  hasCharacterContext: boolean
  surfaces: {
    character: boolean
    characterProfiles: boolean
    characterSnapshots: boolean
    characterContextCapsules: boolean
    sceneContract: boolean
    canonFacts: boolean
    obligations: boolean
    world: boolean
    worldBible: boolean
    setting: boolean
    story: boolean
    implicitReferences: boolean
    readerInfoState: boolean
    resolvedReferences: boolean
    draftingBrief: boolean
  }
  draftingBrief: {
    mode: string
    selectedPromptChars: number
    fullContextPromptChars: number
    charsRatio: number
    charsDelta: number
    sections: {
      sceneContract: boolean
      sceneLoadControl: boolean
      obligations: boolean
      factContinuityAnchors: boolean
      characterSnapshots: boolean
      characterContextCapsules: boolean
      resolvedReferences: boolean
      readerInfoState: boolean
      setting: boolean
    }
    counts: {
      characters: number
      obligations: number
      canonSourceRefs: number
      storyRefIds: number
      activeThreadIds: number
      activePromiseIds: number
      activePayoffIds: number
      readerInfoStateChars: number
      sceneContractFields: number
      sceneContractAnchorFields: number
      sceneContractDramaticFields: number
      sceneContractBudgetFields: number
      choiceAlternatives: number
    }
    ids: {
      canonSourceRefs: string[]
      activeThreadIds: string[]
      activePromiseIds: string[]
      activePayoffIds: string[]
    }
  } | null
  sceneContractFields: number
  sceneContractAnchorFields: number
  sceneContractDramaticFields: number
  sceneContractBudgetFields: number
  canonSourceRefs: number
  canonSourceRefValues: string[]
  storyRefIds: number
  activeThreadIdValues: string[]
  activePromiseIdValues: string[]
  activePayoffIdValues: string[]
  readerInfoStateChars: number
  referenceLookups: number
  referenceLlmCalls: number
  missingCharacterIds: number
  missingCharacterIdValues: string[]
}

export interface WriterContextTelemetryReport {
  novelId: string | null
  events: WriterContextEventSummary[]
  totals: {
    events: number
    beatEvents: number
    chapterEvents: number
    targetWords: number
    withCharacterContext: number
    withCharacterProfiles: number
    withCharacterSnapshots: number
    withCharacterContextCapsules: number
    withSceneContract: number
    withSceneContractShapeCounts: number
    withSceneContractAnchors: number
    withDramaticSceneContract: number
    withAnchorOnlySceneContract: number
    sceneContractFields: number
    sceneContractAnchorFields: number
    sceneContractDramaticFields: number
    sceneContractBudgetFields: number
    withObligations: number
    withCanonFactContext: number
    withFactContinuityAnchors: number
    canonSourceRefs: number
    canonSourceRefCounts: Record<string, number>
    withWorldContext: number
    withWorldBible: number
    withSetting: number
    withStoryContext: number
    storyRefIds: number
    activeThreadIdCounts: Record<string, number>
    activePromiseIdCounts: Record<string, number>
    activePayoffIdCounts: Record<string, number>
    withImplicitReferences: number
    withReaderInfoState: number
    readerInfoStateChars: number
    withResolvedReferences: number
    referenceLookups: number
    referenceLlmCalls: number
    withDraftingBriefTrace: number
    draftingBriefEnabledEvents: number
    avgDraftingBriefCharsRatio: number | null
    avgSelectedPromptChars: number | null
    avgFullContextPromptChars: number | null
    totalDraftingBriefCharsDelta: number
    missingCharacterIds: number
    missingCharacterIdCounts: Record<string, number>
  }
  byPath: Record<string, number>
  byStage: Record<string, number>
  byWriterContextMode: Record<string, number>
  byDraftingBriefMode: Record<string, number>
}

interface Args {
  novelId: string | null
  json: boolean
}

export function buildWriterContextTelemetryReport(
  rows: readonly WriterContextEventRow[],
  novelId: string | null = null,
): WriterContextTelemetryReport {
  const events = [...rows]
    .sort((a, b) => a.id - b.id)
    .map(normalizeWriterContextEvent)
  const draftingBriefEvents = events.flatMap(event => event.draftingBrief ? [event.draftingBrief] : [])
  const enabledDraftingBriefEvents = draftingBriefEvents.filter(event => event.mode !== "off")

  return {
    novelId,
    events,
    totals: {
      events: events.length,
      beatEvents: events.filter(event => event.path === "beat").length,
      chapterEvents: events.filter(event => event.path === "chapter").length,
      targetWords: events.reduce((sum, event) => sum + (event.targetWords ?? 0), 0),
      withCharacterContext: events.filter(event => event.surfaces.character).length,
      withCharacterProfiles: events.filter(event => event.surfaces.characterProfiles).length,
      withCharacterSnapshots: events.filter(event => event.surfaces.characterSnapshots).length,
      withCharacterContextCapsules: events.filter(event => event.surfaces.characterContextCapsules).length,
      withSceneContract: events.filter(event => event.surfaces.sceneContract).length,
      withSceneContractShapeCounts: events.filter(event =>
        event.sceneContractAnchorFields + event.sceneContractDramaticFields + event.sceneContractBudgetFields > 0
      ).length,
      withSceneContractAnchors: events.filter(event => event.sceneContractAnchorFields > 0).length,
      withDramaticSceneContract: events.filter(event => event.sceneContractDramaticFields > 0).length,
      withAnchorOnlySceneContract: events.filter(event =>
        event.sceneContractAnchorFields > 0 && event.sceneContractDramaticFields === 0
      ).length,
      sceneContractFields: events.reduce((sum, event) => sum + event.sceneContractFields, 0),
      sceneContractAnchorFields: events.reduce((sum, event) => sum + event.sceneContractAnchorFields, 0),
      sceneContractDramaticFields: events.reduce((sum, event) => sum + event.sceneContractDramaticFields, 0),
      sceneContractBudgetFields: events.reduce((sum, event) => sum + event.sceneContractBudgetFields, 0),
      withObligations: events.filter(event => event.surfaces.obligations).length,
      withCanonFactContext: events.filter(event => event.surfaces.canonFacts).length,
      withFactContinuityAnchors: events.filter(event => Boolean(event.draftingBrief?.sections.factContinuityAnchors)).length,
      canonSourceRefs: events.reduce((sum, event) => sum + event.canonSourceRefs, 0),
      canonSourceRefCounts: countBy(events.flatMap(event => event.canonSourceRefValues), value => value),
      withWorldContext: events.filter(event => event.surfaces.world).length,
      withWorldBible: events.filter(event => event.surfaces.worldBible).length,
      withSetting: events.filter(event => event.surfaces.setting).length,
      withStoryContext: events.filter(event => event.surfaces.story).length,
      storyRefIds: events.reduce((sum, event) => sum + event.storyRefIds, 0),
      activeThreadIdCounts: countBy(events.flatMap(event => event.activeThreadIdValues), value => value),
      activePromiseIdCounts: countBy(events.flatMap(event => event.activePromiseIdValues), value => value),
      activePayoffIdCounts: countBy(events.flatMap(event => event.activePayoffIdValues), value => value),
      withImplicitReferences: events.filter(event => event.surfaces.implicitReferences).length,
      withReaderInfoState: events.filter(event => event.surfaces.readerInfoState).length,
      readerInfoStateChars: events.reduce((sum, event) => sum + event.readerInfoStateChars, 0),
      withResolvedReferences: events.filter(event => event.surfaces.resolvedReferences).length,
      referenceLookups: events.reduce((sum, event) => sum + event.referenceLookups, 0),
      referenceLlmCalls: events.reduce((sum, event) => sum + event.referenceLlmCalls, 0),
      withDraftingBriefTrace: draftingBriefEvents.length,
      draftingBriefEnabledEvents: enabledDraftingBriefEvents.length,
      avgDraftingBriefCharsRatio: average(enabledDraftingBriefEvents.map(event => event.charsRatio)),
      avgSelectedPromptChars: average(enabledDraftingBriefEvents.map(event => event.selectedPromptChars)),
      avgFullContextPromptChars: average(enabledDraftingBriefEvents.map(event => event.fullContextPromptChars)),
      totalDraftingBriefCharsDelta: enabledDraftingBriefEvents.reduce((sum, event) => sum + event.charsDelta, 0),
      missingCharacterIds: events.reduce((sum, event) => sum + event.missingCharacterIds, 0),
      missingCharacterIdCounts: countBy(events.flatMap(event => event.missingCharacterIdValues), value => value),
    },
    byPath: countBy(events, event => event.path),
    byStage: countBy(events, event => event.stage),
    byWriterContextMode: countBy(events, event => event.writerContextMode),
    byDraftingBriefMode: countBy(draftingBriefEvents, event => event.mode),
  }
}

export function renderWriterContextTelemetryReport(report: WriterContextTelemetryReport): string {
  const lines: string[] = []
  lines.push(`Writer context telemetry${report.novelId ? ` for ${report.novelId}` : ""}`)
  lines.push(
    `Events: total=${report.totals.events}, beat=${report.totals.beatEvents}, chapter=${report.totals.chapterEvents}; ` +
      `targetWords=${report.totals.targetWords}`,
  )
  lines.push(
    `Context surfaces: character=${formatCoverage(report.totals.withCharacterContext, report.totals.events)} ` +
      `(profiles=${report.totals.withCharacterProfiles}, snapshots=${report.totals.withCharacterSnapshots}, capsules=${report.totals.withCharacterContextCapsules}), ` +
      `sceneContract=${formatCoverage(report.totals.withSceneContract, report.totals.events)} ` +
      `(shapeCounts=${report.totals.withSceneContractShapeCounts}, dramatic=${report.totals.withDramaticSceneContract}, ` +
      `anchorOnly=${report.totals.withAnchorOnlySceneContract}, anchors=${report.totals.withSceneContractAnchors}), ` +
      `obligations=${formatCoverage(report.totals.withObligations, report.totals.events)}, ` +
      `canon=${formatCoverage(report.totals.withCanonFactContext, report.totals.events)} ` +
      `(sourceRefs=${report.totals.canonSourceRefs}${recordSuffix(report.totals.canonSourceRefCounts)}, ` +
      `factAnchors=${report.totals.withFactContinuityAnchors}), ` +
      `world=${formatCoverage(report.totals.withWorldContext, report.totals.events)} ` +
      `(bible=${report.totals.withWorldBible}, setting=${report.totals.withSetting}), ` +
      `story=${formatCoverage(report.totals.withStoryContext, report.totals.events)} ` +
      `(refs=${report.totals.storyRefIds}, threads=${formatRecordOrNone(report.totals.activeThreadIdCounts)}, ` +
      `promises=${formatRecordOrNone(report.totals.activePromiseIdCounts)}, ` +
      `payoffs=${formatRecordOrNone(report.totals.activePayoffIdCounts)}), ` +
      `implicitRefs=${formatCoverage(report.totals.withImplicitReferences, report.totals.events)}, ` +
      `readerInfo=${formatCoverage(report.totals.withReaderInfoState, report.totals.events)} ` +
      `(chars=${report.totals.readerInfoStateChars}), ` +
      `refs=${formatCoverage(report.totals.withResolvedReferences, report.totals.events)}, ` +
      `refLookups=${report.totals.referenceLookups}, refLlm=${report.totals.referenceLlmCalls}, ` +
      `missingCharacterIds=${report.totals.missingCharacterIds}` +
      `${Object.keys(report.totals.missingCharacterIdCounts).length > 0 ? ` (${formatRecord(report.totals.missingCharacterIdCounts)})` : ""}`,
  )
  lines.push(
    `Drafting brief: traced=${formatCoverage(report.totals.withDraftingBriefTrace, report.totals.events)}, ` +
      `enabled=${formatCoverage(report.totals.draftingBriefEnabledEvents, report.totals.events)}, ` +
      `modes=${formatRecord(report.byDraftingBriefMode)}, ` +
      `avgChars=${formatNullable(report.totals.avgSelectedPromptChars, 0)}/${formatNullable(report.totals.avgFullContextPromptChars, 0)}, ` +
      `avgRatio=${formatNullable(report.totals.avgDraftingBriefCharsRatio, 3)}, ` +
      `delta=${report.totals.totalDraftingBriefCharsDelta}`,
  )
  lines.push(`Stages: ${formatRecord(report.byStage)}`)
  lines.push(`Writer context modes: ${formatRecord(report.byWriterContextMode)}`)

  if (report.events.length === 0) {
    lines.push("No writer-context events found.")
    return lines.join("\n")
  }

  for (const event of report.events) {
    const surfaces = [
      event.surfaces.character ? "char" : null,
      event.surfaces.sceneContract ? "scene" : null,
      event.surfaces.canonFacts ? "canon" : null,
      event.surfaces.obligations ? "obligations" : null,
      event.surfaces.world ? "world" : null,
      event.surfaces.story ? "story" : null,
      event.surfaces.implicitReferences ? "implicitRefs" : null,
      event.surfaces.readerInfoState ? "reader" : null,
      event.surfaces.resolvedReferences ? "refs" : null,
    ].filter(Boolean).join(",") || "none"
    const brief = event.draftingBrief
      ? `${event.draftingBrief.mode} ${event.draftingBrief.selectedPromptChars}/${event.draftingBrief.fullContextPromptChars} (${event.draftingBrief.charsRatio.toFixed(3)})`
      : "none"
    lines.push(
      `- #${event.id} ch${event.chapter ?? "?"}` +
        `${event.beatIndex == null ? "" : ` beat${event.beatIndex + 1}`} ` +
        `${event.path}/${event.stage}: surfaces=${surfaces}; target=${event.targetWords ?? "?"}; brief=${brief}`,
    )
    if (event.missingCharacterIdValues.length > 0) {
      lines.push(`  missingCharacterIds=${event.missingCharacterIdValues.join(",")}`)
    }
    const traceIds = formatEventTraceIds(event)
    if (traceIds) lines.push(`  traceIds=${traceIds}`)
  }

  return lines.join("\n")
}

function normalizeWriterContextEvent(row: WriterContextEventRow): WriterContextEventSummary {
  const payload = readRecord(row.payload)
  const contextSurface = readRecord(payload.contextSurface)
  const surfaces = readRecord(contextSurface.surfaces)
  const counts = readRecord(contextSurface.counts)
  const contextSurfaceIds = readRecord(contextSurface.ids)
  const characterContext = readRecord(payload.characterContext)
  const draftingBrief = readDraftingBrief(payload.draftingBrief)
  const path = readString(payload.path) ?? "unknown"
  const stage = readString(payload.stage) ?? "unknown"
  const writerContextMode = readString(payload.writerContextMode) ?? "unknown"
  const writerPromptIdRendering = readString(payload.writerPromptIdRendering) ?? "raw"
  const hasCharacterProfiles = readBoolean(surfaces.characterProfiles)
  const hasCharacterSnapshots = readBoolean(surfaces.characterSnapshots)
    || Boolean(draftingBrief?.sections.characterSnapshots)
  const hasCharacterContextCapsules = readBoolean(surfaces.characterContextCapsules)
    || Boolean(draftingBrief?.sections.characterContextCapsules)
    || readArray(characterContext.characterIds).length > 0
  const hasCharacterContext = readBoolean(payload.hasCharacterContext)
    || hasCharacterProfiles
    || hasCharacterSnapshots
    || hasCharacterContextCapsules
    || positiveNumber(draftingBrief?.counts.characters)
  const targetWords = readFiniteNumber(payload.targetWords)
  const hasObligations = positiveNumber(counts.obligations)
    || Boolean(draftingBrief?.sections.obligations)
    || positiveNumber(draftingBrief?.counts.obligations)
  const canonSourceRefValues = uniqueStrings([
    ...cleanStringArray(contextSurfaceIds.canonSourceRefs),
    ...(draftingBrief?.ids.canonSourceRefs ?? []),
  ])
  const canonSourceRefs = maxNumber(
    readFiniteNumber(counts.canonSourceRefs),
    draftingBrief?.counts.canonSourceRefs,
    canonSourceRefValues.length,
  )
  const hasCanonFacts = readBoolean(surfaces.canonFacts)
    || canonSourceRefs > 0
    || Boolean(draftingBrief?.sections.factContinuityAnchors)
  const hasWorldBible = readBoolean(surfaces.worldBible)
  const hasSetting = readBoolean(surfaces.setting) || Boolean(draftingBrief?.sections.setting)
  const activeThreadIdValues = uniqueStrings([
    ...cleanStringArray(contextSurfaceIds.activeThreadIds),
    ...(draftingBrief?.ids.activeThreadIds ?? []),
    ...cleanStringArray(characterContext.activeThreadIds),
  ])
  const activePromiseIdValues = uniqueStrings([
    ...cleanStringArray(contextSurfaceIds.activePromiseIds),
    ...(draftingBrief?.ids.activePromiseIds ?? []),
    ...cleanStringArray(characterContext.activePromiseIds),
  ])
  const activePayoffIdValues = uniqueStrings([
    ...cleanStringArray(contextSurfaceIds.activePayoffIds),
    ...(draftingBrief?.ids.activePayoffIds ?? []),
    ...cleanStringArray(characterContext.activePayoffIds),
  ])
  const storyRefIds = maxNumber(
    readFiniteNumber(counts.storyRefIds),
    draftingBrief?.counts.storyRefIds,
    sumNumbers(
      readFiniteNumber(counts.activeThreadIds),
      readFiniteNumber(counts.activePromiseIds),
      readFiniteNumber(counts.activePayoffIds),
    ),
    sumNumbers(
      draftingBrief?.counts.activeThreadIds,
      draftingBrief?.counts.activePromiseIds,
      draftingBrief?.counts.activePayoffIds,
    ),
    readArray(characterContext.activeThreadIds).length +
      readArray(characterContext.activePromiseIds).length +
      readArray(characterContext.activePayoffIds).length,
    activeThreadIdValues.length + activePromiseIdValues.length + activePayoffIdValues.length,
  )
  const readerInfoStateChars = maxNumber(
    readFiniteNumber(counts.readerInfoStateChars),
    draftingBrief?.counts.readerInfoStateChars,
  )
  const story = readBoolean(surfaces.storySpine)
    || storyRefIds > 0
    || hasObligations
  const sceneContractFields = maxNumber(
    readFiniteNumber(counts.sceneContractFields),
    draftingBrief?.counts.sceneContractFields,
  )
  const sceneContractAnchorFields = maxNumber(
    readFiniteNumber(counts.sceneContractAnchorFields),
    draftingBrief?.counts.sceneContractAnchorFields,
  )
  const sceneContractDramaticFields = maxNumber(
    readFiniteNumber(counts.sceneContractDramaticFields),
    draftingBrief?.counts.sceneContractDramaticFields,
  )
  const sceneContractBudgetFields = maxNumber(
    readFiniteNumber(counts.sceneContractBudgetFields),
    draftingBrief?.counts.sceneContractBudgetFields,
  )
  const hasSceneContract = readBoolean(surfaces.sceneContract)
    || Boolean(draftingBrief?.sections.sceneContract)
    || sceneContractFields > 0
  const referenceLookups = readFiniteNumber(counts.referenceLookups) ?? 0
  const referenceLlmCalls = readFiniteNumber(counts.referenceLlmCalls) ?? 0
  const missingCharacterIdValues = cleanStringArray(characterContext.missingCharacterIds)

  return {
    id: Number(row.id),
    chapter: row.chapter == null ? null : Number(row.chapter),
    beatIndex: row.beat_index == null ? null : Number(row.beat_index),
    path,
    stage,
    writerContextMode,
    writerPromptIdRendering,
    targetWords,
    hasCharacterContext,
    surfaces: {
      character: hasCharacterContext,
      characterProfiles: hasCharacterProfiles,
      characterSnapshots: hasCharacterSnapshots,
      characterContextCapsules: hasCharacterContextCapsules,
      sceneContract: hasSceneContract,
      canonFacts: hasCanonFacts,
      obligations: hasObligations,
      world: hasWorldBible || hasSetting,
      worldBible: hasWorldBible,
      setting: hasSetting,
      story,
      implicitReferences: readBoolean(surfaces.implicitReferences) || positiveNumber(counts.implicitReferenceMarkers),
      readerInfoState: readBoolean(surfaces.readerInfoState) || Boolean(draftingBrief?.sections.readerInfoState),
      resolvedReferences: readBoolean(surfaces.resolvedReferences) || Boolean(draftingBrief?.sections.resolvedReferences),
      draftingBrief: draftingBrief !== null,
    },
    draftingBrief,
    sceneContractFields,
    sceneContractAnchorFields,
    sceneContractDramaticFields,
    sceneContractBudgetFields,
    canonSourceRefs,
    canonSourceRefValues,
    storyRefIds,
    activeThreadIdValues,
    activePromiseIdValues,
    activePayoffIdValues,
    readerInfoStateChars,
    referenceLookups,
    referenceLlmCalls,
    missingCharacterIds: readFiniteNumber(counts.missingCharacterIds) ?? missingCharacterIdValues.length,
    missingCharacterIdValues,
  }
}

function readDraftingBrief(value: unknown): WriterContextEventSummary["draftingBrief"] {
  const row = readRecord(value)
  const mode = readString(row.mode)
  const selectedPromptChars = readFiniteNumber(row.selectedPromptChars)
  const fullContextPromptChars = readFiniteNumber(row.fullContextPromptChars)
  const charsRatio = readFiniteNumber(row.charsRatio)
  const charsDelta = readFiniteNumber(row.charsDelta)
  if (!mode || selectedPromptChars === null || fullContextPromptChars === null || charsRatio === null || charsDelta === null) {
    return null
  }
  const sections = readRecord(row.sections)
  const counts = readRecord(row.counts)
  const ids = readRecord(row.ids)
  return {
    mode,
    selectedPromptChars,
    fullContextPromptChars,
    charsRatio,
    charsDelta,
    sections: {
      sceneContract: readBoolean(sections.sceneContract),
      sceneLoadControl: readBoolean(sections.sceneLoadControl),
      obligations: readBoolean(sections.obligations),
      factContinuityAnchors: readBoolean(sections.factContinuityAnchors),
      characterSnapshots: readBoolean(sections.characterSnapshots),
      characterContextCapsules: readBoolean(sections.characterContextCapsules),
      resolvedReferences: readBoolean(sections.resolvedReferences),
      readerInfoState: readBoolean(sections.readerInfoState),
      setting: readBoolean(sections.setting),
    },
    counts: {
      characters: readFiniteNumber(counts.characters) ?? 0,
      obligations: readFiniteNumber(counts.obligations) ?? 0,
      canonSourceRefs: readFiniteNumber(counts.canonSourceRefs) ?? 0,
      storyRefIds: readFiniteNumber(counts.storyRefIds) ?? 0,
      activeThreadIds: readFiniteNumber(counts.activeThreadIds) ?? 0,
      activePromiseIds: readFiniteNumber(counts.activePromiseIds) ?? 0,
      activePayoffIds: readFiniteNumber(counts.activePayoffIds) ?? 0,
      readerInfoStateChars: readFiniteNumber(counts.readerInfoStateChars) ?? 0,
      sceneContractFields: readFiniteNumber(counts.sceneContractFields) ?? 0,
      sceneContractAnchorFields: readFiniteNumber(counts.sceneContractAnchorFields) ?? 0,
      sceneContractDramaticFields: readFiniteNumber(counts.sceneContractDramaticFields) ?? 0,
      sceneContractBudgetFields: readFiniteNumber(counts.sceneContractBudgetFields) ?? 0,
      choiceAlternatives: readFiniteNumber(counts.choiceAlternatives) ?? 0,
    },
    ids: {
      canonSourceRefs: cleanStringArray(ids.canonSourceRefs),
      activeThreadIds: cleanStringArray(ids.activeThreadIds),
      activePromiseIds: cleanStringArray(ids.activePromiseIds),
      activePayoffIds: cleanStringArray(ids.activePayoffIds),
    },
  }
}

function maxNumber(...values: Array<number | null | undefined>): number {
  return Math.max(0, ...values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)))
}

function sumNumbers(...values: Array<number | null | undefined>): number {
  return values.reduce((sum, value) => sum + (typeof value === "number" && Number.isFinite(value) ? value : 0), 0)
}

function countBy<T>(items: readonly T[], keyFn: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) {
    const key = keyFn(item)
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

function average(values: readonly number[]): number | null {
  const clean = values.filter(value => Number.isFinite(value))
  if (clean.length === 0) return null
  return clean.reduce((sum, value) => sum + value, 0) / clean.length
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return readRecord(JSON.parse(value))
    } catch {
      return {}
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

function readBoolean(value: unknown): boolean {
  return value === true
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function positiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return uniqueStrings(value
    .map(item => typeof item === "string" ? item.trim() : "")
    .filter(item => item.length > 0 && item !== "null" && item !== "undefined"))
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function recordSuffix(record: Record<string, number>): string {
  const rendered = formatRecordOrNone(record)
  return rendered === "none" ? "" : `; ${rendered}`
}

function formatRecordOrNone(record: Record<string, number>): string {
  return Object.keys(record).length > 0 ? formatRecord(record) : "none"
}

function formatEventTraceIds(event: WriterContextEventSummary): string {
  const parts = [
    event.canonSourceRefValues.length > 0 ? `canon:${event.canonSourceRefValues.join(",")}` : null,
    event.activeThreadIdValues.length > 0 ? `threads:${event.activeThreadIdValues.join(",")}` : null,
    event.activePromiseIdValues.length > 0 ? `promises:${event.activePromiseIdValues.join(",")}` : null,
    event.activePayoffIdValues.length > 0 ? `payoffs:${event.activePayoffIdValues.join(",")}` : null,
  ].filter((part): part is string => part !== null)
  return parts.join("; ")
}

function formatCoverage(count: number, total: number): string {
  return `${count}/${total}`
}

function formatRecord(record: Record<string, number>): string {
  const entries = Object.entries(record).sort(([a], [b]) => a.localeCompare(b))
  return entries.length > 0
    ? entries.map(([key, value]) => `${key}=${value}`).join(", ")
    : "none"
}

function formatNullable(value: number | null, digits: number): string {
  return value === null ? "?" : value.toFixed(digits)
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

async function loadRows(novelId: string): Promise<WriterContextEventRow[]> {
  const rows = await db<Array<{
    id: number
    chapter: number | null
    beat_index: number | null
    payload: unknown
    timestamp: string
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
    console.error("usage: bun scripts/analysis/writer-context-report.ts --novel <novelId> [--json]")
    return 2
  }

  if (!args.novelId) {
    console.error("usage: bun scripts/analysis/writer-context-report.ts --novel <novelId> [--json]")
    return 2
  }

  const rows = await loadRows(args.novelId)
  const report = buildWriterContextTelemetryReport(rows, args.novelId)
  console.log(args.json ? JSON.stringify(report, null, 2) : renderWriterContextTelemetryReport(report))
  await db.end().catch(() => {})
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
