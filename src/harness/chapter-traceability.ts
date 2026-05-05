import db from "../db/connection"
import { getNovel } from "../db/novels"
import { getChapterOutlines } from "../db/outlines"
import { enrichOutlineIds } from "./ids"
import { loadPlanningTargetMap, type PlanningTargetMap, type PlanningTargetRef } from "./planning-targets"
import type { BeatObligationsContract, ChapterOutline, SceneBeat } from "../types"

export interface ChapterTraceabilityRef {
  kind: string
  ref: string
  label?: string
}

export interface ChapterTraceabilitySourceRegistryItem {
  kind: "world_fact" | "knowledge" | "state" | "character"
  ref: string
  label: string
  text?: string
  characterId?: string
}

export interface ChapterTraceabilityObligation {
  list: ObligationListKey
  obligationId?: string
  sourceKind?: string
  sourceId?: string
  characterId?: string
  text: string
  refs: ChapterTraceabilityRef[]
  sourceFound: boolean
}

export interface ChapterTraceabilityCall {
  id: number
  agent: string
  role: "writer" | "checker" | "other"
  linkEvidence: "beat_id" | "beat_index"
  beatIndex?: number
  beatId?: string
  attempt?: number
  failed: boolean
  timestamp: string
  promptTokens?: number
  completionTokens?: number
  metaRefs: ChapterTraceabilityRef[]
}

export interface ChapterTraceabilityEvent {
  id: number
  eventType: string
  agent?: string
  linkEvidence: "payload_beat_id" | "beat_index"
  beatIndex?: number
  llmCallId?: number
  durationMs?: number
  timestamp: string
  refs: ChapterTraceabilityRef[]
}

export interface ChapterTraceabilityBeat {
  beatIndex: number
  beatId?: string
  description: string
  kind: string
  characters: string[]
  refs: ChapterTraceabilityRef[]
  upstreamTargets: PlanningTargetRef[]
  obligations: ChapterTraceabilityObligation[]
  llmCalls: ChapterTraceabilityCall[]
  traceEvents: ChapterTraceabilityEvent[]
}

export interface ChapterTraceabilityReport {
  ok: true
  novelId: string
  generatedAt: string
  planningSnapshotHash: string
  chapterNumber: number
  chapterRef: string
  chapterId?: string
  title: string
  sourceRegistry: ChapterTraceabilitySourceRegistryItem[]
  beats: ChapterTraceabilityBeat[]
  summary: {
    beatCount: number
    obligationCount: number
    linkedObligationCount: number
    missingSourceCount: number
    writerCallCount: number
    checkerCallCount: number
    traceEventCount: number
  }
}

export interface ChapterTraceabilityCallInput {
  id: number
  agent: string
  beatIndex?: number | null
  beatId?: string | null
  attempt?: number | null
  failed: boolean
  timestamp: string
  promptTokens?: number | null
  completionTokens?: number | null
  requestJson?: unknown
}

export interface ChapterTraceabilityEventInput {
  id: number
  eventType: string
  agent?: string | null
  beatIndex?: number | null
  llmCallId?: number | null
  durationMs?: number | null
  timestamp: string
  payload?: unknown
}

export interface BuildChapterTraceabilityReportArgs {
  novelId: string
  chapterNumber: number
  generatedAt?: string
  outline: ChapterOutline
  targetMap: PlanningTargetMap
  llmCalls?: ChapterTraceabilityCallInput[]
  traceEvents?: ChapterTraceabilityEventInput[]
}

type ObligationListKey =
  | "mustEstablish"
  | "mustPayOff"
  | "mustTransferKnowledge"
  | "mustShowStateChange"
  | "mustNotReveal"

const OBLIGATION_LISTS: ObligationListKey[] = [
  "mustEstablish",
  "mustPayOff",
  "mustTransferKnowledge",
  "mustShowStateChange",
  "mustNotReveal",
]

const CHECKER_AGENTS = new Set([
  "chapter-plan-checker",
  "adherence-checker",
  "halluc-ungrounded",
  "continuity-checker",
  "functional-state-checker",
  "validation",
])

export function buildChapterTraceabilityReport(
  args: BuildChapterTraceabilityReportArgs,
): ChapterTraceabilityReport {
  const outline = clone(args.outline)
  enrichOutlineIds(outline)

  const chapterRef = outline.chapterId ?? `chapter-${outline.chapterNumber}`
  const sourceRegistry = buildSourceRegistry(outline)
  const sourceKeys = new Set(sourceRegistry.map((item) => sourceKey(item.kind, item.ref)))
  const targetLabels = new Map(args.targetMap.targets.map((target) => [
    `${target.kind}:${target.ref}`,
    target.label,
  ]))

  const callsByBeat = groupCallsByBeat(args.llmCalls ?? [])
  const eventsByBeat = groupEventsByBeat(args.traceEvents ?? [])

  const beats = (outline.scenes ?? []).map((beat, beatIndex) => {
    const beatId = beat.beatId
    const refs = [
      ref("chapter_outline", chapterRef, targetLabels),
      ...(beatId ? [ref("beat_plan", beatId, targetLabels)] : []),
    ]
    const obligations = collectTraceableObligations(beat, sourceKeys, targetLabels)
    const llmCalls = callsForBeat(callsByBeat, beatIndex, beatId).map(mapCall)
    const traceEvents = eventsForBeat(eventsByBeat, beatIndex, beatId).map(mapEvent)

    return {
      beatIndex,
      beatId,
      description: beat.description,
      kind: beat.kind,
      characters: [...(beat.characters ?? [])],
      refs,
      upstreamTargets: dedupeTargetRefs([
        { kind: "chapter_outline", ref: chapterRef },
        ...collectBeatUpstreamTargets(beat),
      ]),
      obligations,
      llmCalls,
      traceEvents,
    }
  })

  const obligationCount = beats.reduce((sum, beat) => sum + beat.obligations.length, 0)
  const linkedObligationCount = beats.reduce(
    (sum, beat) => sum + beat.obligations.filter((item) => item.sourceFound).length,
    0,
  )
  const writerCallCount = beats.reduce(
    (sum, beat) => sum + beat.llmCalls.filter((call) => call.role === "writer").length,
    0,
  )
  const checkerCallCount = beats.reduce(
    (sum, beat) => sum + beat.llmCalls.filter((call) => call.role === "checker").length,
    0,
  )
  const traceEventCount = beats.reduce((sum, beat) => sum + beat.traceEvents.length, 0)

  return {
    ok: true,
    novelId: args.novelId,
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    planningSnapshotHash: args.targetMap.planningSnapshotHash,
    chapterNumber: args.chapterNumber,
    chapterRef,
    chapterId: outline.chapterId,
    title: outline.title,
    sourceRegistry,
    beats,
    summary: {
      beatCount: beats.length,
      obligationCount,
      linkedObligationCount,
      missingSourceCount: obligationCount - linkedObligationCount,
      writerCallCount,
      checkerCallCount,
      traceEventCount,
    },
  }
}

export async function loadChapterTraceabilityReport(
  novelId: string,
  chapterNumber: number,
): Promise<ChapterTraceabilityReport> {
  await getNovel(novelId).catch((err) => {
    throw new Error(`Novel ${novelId} not found: ${String(err)}`)
  })
  const outlines = await getChapterOutlines(novelId)
  const outline = outlines.find((candidate) => candidate.chapterNumber === chapterNumber)
  if (!outline) {
    throw new ChapterTraceabilityLookupError(
      `chapter outline not found: ${novelId} chapter ${chapterNumber}`,
      404,
    )
  }
  const [targetMap, llmCalls, traceEvents] = await Promise.all([
    loadPlanningTargetMap(novelId),
    loadTraceabilityCalls(novelId, chapterNumber),
    loadTraceabilityEvents(novelId, chapterNumber),
  ])
  return buildChapterTraceabilityReport({
    novelId,
    chapterNumber,
    outline,
    targetMap,
    llmCalls,
    traceEvents,
  })
}

export class ChapterTraceabilityLookupError extends Error {
  readonly status: number
  constructor(message: string, status = 404) {
    super(message)
    this.name = "ChapterTraceabilityLookupError"
    this.status = status
  }
}

async function loadTraceabilityCalls(
  novelId: string,
  chapterNumber: number,
): Promise<ChapterTraceabilityCallInput[]> {
  const rows = await db`
    SELECT id, agent, beat_index, beat_id, attempt, failed, timestamp,
           prompt_tokens, completion_tokens, request_json
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND chapter = ${chapterNumber}
    ORDER BY timestamp DESC, id DESC
    LIMIT 300
  `
  return rows.map((row: any) => ({
    id: row.id,
    agent: row.agent,
    beatIndex: row.beat_index,
    beatId: row.beat_id,
    attempt: row.attempt,
    failed: row.failed === true,
    timestamp: dateString(row.timestamp),
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    requestJson: row.request_json,
  }))
}

async function loadTraceabilityEvents(
  novelId: string,
  chapterNumber: number,
): Promise<ChapterTraceabilityEventInput[]> {
  const rows = await db`
    SELECT id, event_type, agent, beat_index, llm_call_id, duration_ms,
           payload, timestamp
    FROM pipeline_events
    WHERE novel_id = ${novelId}
      AND chapter = ${chapterNumber}
    ORDER BY timestamp DESC, id DESC
    LIMIT 300
  `
  return rows.map((row: any) => ({
    id: row.id,
    eventType: row.event_type,
    agent: row.agent,
    beatIndex: row.beat_index,
    llmCallId: row.llm_call_id,
    durationMs: row.duration_ms,
    timestamp: dateString(row.timestamp),
    payload: row.payload,
  }))
}

function buildSourceRegistry(outline: ChapterOutline): ChapterTraceabilitySourceRegistryItem[] {
  const items: ChapterTraceabilitySourceRegistryItem[] = []
  for (const fact of outline.establishedFacts ?? []) {
    if (!fact.id) continue
    items.push({
      kind: "world_fact",
      ref: fact.id,
      label: `Fact: ${fact.fact}`,
      text: fact.fact,
    })
  }
  for (const knowledge of outline.knowledgeChanges ?? []) {
    if (!knowledge.id) continue
    items.push({
      kind: "knowledge",
      ref: knowledge.id,
      label: `Knowledge: ${knowledge.characterName}`,
      text: knowledge.knowledge,
      characterId: knowledge.characterId,
    })
  }
  for (const state of outline.characterStateChanges ?? []) {
    if (!state.id) continue
    items.push({
      kind: "state",
      ref: state.id,
      label: `State: ${state.name}`,
      text: state.emotionalState,
      characterId: state.characterId,
    })
  }
  for (const characterId of outline.charactersPresentIds ?? []) {
    if (!characterId) continue
    items.push({
      kind: "character",
      ref: characterId,
      label: `Character: ${characterId}`,
    })
  }
  return dedupeRegistry(items)
}

function collectTraceableObligations(
  beat: SceneBeat,
  sourceKeys: Set<string>,
  targetLabels: Map<string, string>,
): ChapterTraceabilityObligation[] {
  const obligations = beat.obligations
  if (!obligations) return []
  const out: ChapterTraceabilityObligation[] = []
  for (const list of OBLIGATION_LISTS) {
    for (const item of obligations[list] ?? []) {
      const sourceKind = item.sourceKind
      const sourceId = item.sourceId
      const sourceRefKind = sourceKindToRegistryKind(sourceKind)
      const refs = [
        ...(item.obligationId ? [ref("beat_obligation", item.obligationId, targetLabels)] : []),
        ...(sourceId && sourceRefKind ? [ref(sourceRefKind, sourceId, targetLabels)] : []),
        ...(item.characterId ? [ref("character", item.characterId, targetLabels)] : []),
      ]
      const sourceFound = Boolean(
        sourceId &&
        sourceRefKind &&
        sourceKeys.has(sourceKey(sourceRefKind, sourceId)),
      )
      out.push({
        list,
        obligationId: item.obligationId,
        sourceKind,
        sourceId,
        characterId: item.characterId,
        text: item.text,
        refs: dedupeRefs(refs),
        sourceFound,
      })
    }
  }
  return out
}

function collectBeatUpstreamTargets(beat: SceneBeat): PlanningTargetRef[] {
  const refs: PlanningTargetRef[] = []
  forEachObligation(beat.obligations, (item) => {
    const sourceTarget = sourceTargetRef(item)
    if (sourceTarget) refs.push(sourceTarget)
    if (item.characterId) refs.push({ kind: "character", ref: item.characterId })
  })
  return refs
}

function mapCall(input: ChapterTraceabilityCallInput): ChapterTraceabilityCall {
  return {
    id: input.id,
    agent: input.agent,
    role: input.agent === "beat-writer"
      ? "writer"
      : CHECKER_AGENTS.has(input.agent) ? "checker" : "other",
    linkEvidence: input.beatId ? "beat_id" : "beat_index",
    beatIndex: numberOrUndefined(input.beatIndex),
    beatId: input.beatId ?? undefined,
    attempt: numberOrUndefined(input.attempt),
    failed: input.failed,
    timestamp: input.timestamp,
    promptTokens: numberOrUndefined(input.promptTokens),
    completionTokens: numberOrUndefined(input.completionTokens),
    metaRefs: refsFromMeta(readMeta(input.requestJson)),
  }
}

function mapEvent(input: ChapterTraceabilityEventInput): ChapterTraceabilityEvent {
  const meta = readMeta(input.payload) as Record<string, unknown> | undefined
  return {
    id: input.id,
    eventType: input.eventType,
    agent: input.agent ?? undefined,
    linkEvidence: typeof meta?.beatId === "string" ? "payload_beat_id" : "beat_index",
    beatIndex: numberOrUndefined(input.beatIndex),
    llmCallId: numberOrUndefined(input.llmCallId),
    durationMs: numberOrUndefined(input.durationMs),
    timestamp: input.timestamp,
    refs: refsFromMeta(meta),
  }
}

function refsFromMeta(meta: unknown): ChapterTraceabilityRef[] {
  if (!meta || typeof meta !== "object") return []
  const value = meta as Record<string, unknown>
  const refs: ChapterTraceabilityRef[] = []
  if (typeof value.chapterId === "string") refs.push({ kind: "chapter_outline", ref: value.chapterId })
  if (typeof value.beatId === "string") refs.push({ kind: "beat_plan", ref: value.beatId })
  for (const id of stringArray(value.obligationIds)) refs.push({ kind: "beat_obligation", ref: id })
  for (const id of stringArray(value.sourceIds)) refs.push({ kind: "source", ref: id })
  for (const id of stringArray(value.characterIds)) refs.push({ kind: "character", ref: id })
  return dedupeRefs(refs)
}

function readMeta(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined
  const obj = value as Record<string, unknown>
  if (obj.meta && typeof obj.meta === "object") return obj.meta
  if (
    typeof obj.chapterId === "string" ||
    typeof obj.beatId === "string" ||
    Array.isArray(obj.obligationIds) ||
    Array.isArray(obj.sourceIds) ||
    Array.isArray(obj.characterIds)
  ) {
    return obj
  }
  return undefined
}

function groupCallsByBeat(
  calls: ChapterTraceabilityCallInput[],
): Map<string, ChapterTraceabilityCallInput[]> {
  const grouped = new Map<string, ChapterTraceabilityCallInput[]>()
  for (const call of calls) {
    addGrouped(grouped, beatGroupKeys(call.beatIndex, call.beatId), call)
  }
  return grouped
}

function groupEventsByBeat(
  events: ChapterTraceabilityEventInput[],
): Map<string, ChapterTraceabilityEventInput[]> {
  const grouped = new Map<string, ChapterTraceabilityEventInput[]>()
  for (const event of events) {
    const meta = readMeta(event.payload) as Record<string, unknown> | undefined
    const beatId = event.beatIndex == null && typeof meta?.beatId === "string"
      ? meta.beatId
      : undefined
    addGrouped(grouped, beatGroupKeys(event.beatIndex, beatId), event)
  }
  return grouped
}

function callsForBeat(
  grouped: Map<string, ChapterTraceabilityCallInput[]>,
  beatIndex: number,
  beatId?: string,
): ChapterTraceabilityCallInput[] {
  return dedupeById([
    ...grouped.get(indexKey(beatIndex)) ?? [],
    ...(beatId ? grouped.get(idKey(beatId)) ?? [] : []),
  ])
}

function eventsForBeat(
  grouped: Map<string, ChapterTraceabilityEventInput[]>,
  beatIndex: number,
  beatId?: string,
): ChapterTraceabilityEventInput[] {
  return dedupeById([
    ...grouped.get(indexKey(beatIndex)) ?? [],
    ...(beatId ? grouped.get(idKey(beatId)) ?? [] : []),
  ])
}

function addGrouped<T>(grouped: Map<string, T[]>, keys: string[], value: T): void {
  for (const key of keys) {
    const list = grouped.get(key)
    if (list) list.push(value)
    else grouped.set(key, [value])
  }
}

function beatGroupKeys(beatIndex?: number | null, beatId?: string | null): string[] {
  const keys: string[] = []
  if (typeof beatIndex === "number") keys.push(indexKey(beatIndex))
  if (beatId) keys.push(idKey(beatId))
  return keys
}

function indexKey(index: number): string {
  return `idx:${index}`
}

function idKey(id: string): string {
  return `id:${id}`
}

function forEachObligation(
  obligations: BeatObligationsContract | undefined,
  fn: (item: BeatObligationsContract[ObligationListKey][number], key: ObligationListKey) => void,
): void {
  if (!obligations) return
  for (const key of OBLIGATION_LISTS) {
    for (const item of obligations[key] ?? []) fn(item, key)
  }
}

function sourceKindToRegistryKind(kind: string | undefined): ChapterTraceabilitySourceRegistryItem["kind"] | undefined {
  if (kind === "fact" || kind === "payoff") return "world_fact"
  if (kind === "knowledge") return "knowledge"
  if (kind === "state") return "state"
  return undefined
}

function sourceTargetRef(
  item: BeatObligationsContract[ObligationListKey][number],
): PlanningTargetRef | undefined {
  if ((item.sourceKind === "fact" || item.sourceKind === "payoff") && item.sourceId) {
    return { kind: "world_fact", ref: item.sourceId }
  }
  if ((item.sourceKind === "knowledge" || item.sourceKind === "state") && item.characterId) {
    return { kind: "character", ref: item.characterId }
  }
  return undefined
}

function ref(
  kind: string,
  value: string,
  labels?: Map<string, string>,
): ChapterTraceabilityRef {
  return { kind, ref: value, ...(labels?.get(`${kind}:${value}`) ? { label: labels.get(`${kind}:${value}`) } : {}) }
}

function sourceKey(kind: string, value: string): string {
  return `${kind}:${value}`
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function dedupeRefs(refs: ChapterTraceabilityRef[]): ChapterTraceabilityRef[] {
  const seen = new Set<string>()
  const out: ChapterTraceabilityRef[] = []
  for (const item of refs) {
    const key = `${item.kind}:${item.ref}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function dedupeTargetRefs(refs: PlanningTargetRef[]): PlanningTargetRef[] {
  const seen = new Set<string>()
  const out: PlanningTargetRef[] = []
  for (const item of refs) {
    const key = `${item.kind}:${item.ref}:${item.fieldPath ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function dedupeRegistry(
  items: ChapterTraceabilitySourceRegistryItem[],
): ChapterTraceabilitySourceRegistryItem[] {
  const seen = new Set<string>()
  const out: ChapterTraceabilitySourceRegistryItem[] = []
  for (const item of items) {
    const key = sourceKey(item.kind, item.ref)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function dedupeById<T extends { id: number }>(items: T[]): T[] {
  const seen = new Set<number>()
  const out: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

function numberOrUndefined(value: number | null | undefined): number | undefined {
  return typeof value === "number" ? value : undefined
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function dateString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value
}
