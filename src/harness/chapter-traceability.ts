import db from "../db/connection"
import { getNovel } from "../db/novels"
import { getChapterOutlines } from "../db/outlines"
import { listProposalResolutionImpactsByTargetRefs } from "../db/proposal-resolution-outcomes"
import { listPlanningMutationLineageForRefs } from "../db/planning-mutation-lineage"
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
  proposalEvidence: ChapterTraceabilityEvidence[]
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
  proposalEvidence: ChapterTraceabilityEvidence[]
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
  proposalEvidence: ChapterTraceabilityEvidence[]
  obligations: ChapterTraceabilityObligation[]
  llmCalls: ChapterTraceabilityCall[]
  traceEvents: ChapterTraceabilityEvent[]
}

export interface ChapterTraceabilityProposalEnvelopeEvidence {
  id: string
  kind: string
  targetKind: string
  targetRef: string
  targetFieldPath?: string
  status: string
  risk: string
  summary: string
  createdAt: string
  resolvedAt?: string
  matchedRefs: ChapterTraceabilityRef[]
}

export interface ChapterTraceabilityResolutionImpactEvidence {
  id: string
  proposalId: string
  proposalKind: string
  sourceTable: string
  targetKind: string
  targetRef: string
  chapterNumber?: number
  priorHash?: string
  resultHash?: string
  resultVersion?: string
  resolvedAt: string
  metadata: Record<string, unknown>
}

export interface ChapterTraceabilityCheckerObservationEvidence {
  id: string
  proposalId: string
  proposalKind: string
  sourceTable: string
  targetKind: string
  targetRef: string
  chapterNumber?: number
  resultHash?: string
  checkerName: string
  fired: boolean
  observedAt: string
  details: Record<string, unknown>
}

export interface ChapterTraceabilityMutationLineageEvidence {
  id: string
  proposalId: string
  proposalKind: string
  sourceTable: string
  actorKind: string
  actorRef?: string
  source?: string
  targetKind: string
  previousRef: string
  nextRef: string
  fieldPath: string
  previousVersion?: string
  nextVersion?: string
  preconditionKind?: string
  preconditionHash?: string
  changedAt: string
  reason?: string
  affectedDownstreamRefs: ChapterTraceabilityRef[]
  metadata: Record<string, unknown>
}

export interface ChapterTraceabilityEvidence {
  target: ChapterTraceabilityRef
  proposalEnvelopes: ChapterTraceabilityProposalEnvelopeEvidence[]
  resolutionImpacts: ChapterTraceabilityResolutionImpactEvidence[]
  checkerObservations: ChapterTraceabilityCheckerObservationEvidence[]
  mutationLineage: ChapterTraceabilityMutationLineageEvidence[]
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
  chapterEvidence: ChapterTraceabilityEvidence[]
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
    proposalEnvelopeCount: number
    resolutionImpactCount: number
    checkerObservationCount: number
    mutationLineageCount: number
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

export interface ChapterTraceabilityProposalEnvelopeInput {
  id: string
  kind: string
  targetKind: string
  targetRef: string
  targetFieldPath?: string | null
  status: string
  risk: string
  summary: string
  createdAt: string
  resolvedAt?: string | null
  targetRefs?: ChapterTraceabilityRef[]
}

export interface ChapterTraceabilityResolutionImpactInput {
  id: string
  proposalId: string
  proposalKind: string
  sourceTable: string
  targetKind: string
  targetRef: string
  chapterNumber?: number | null
  priorHash?: string | null
  resultHash?: string | null
  resultVersion?: string | null
  resolvedAt: string
  metadata?: Record<string, unknown>
}

export interface ChapterTraceabilityCheckerObservationInput {
  id: string
  proposalId: string
  proposalKind: string
  sourceTable: string
  targetKind: string
  targetRef: string
  chapterNumber?: number | null
  resultHash?: string | null
  checkerName: string
  fired: boolean
  observedAt: string
  details?: Record<string, unknown>
}

export interface ChapterTraceabilityMutationLineageInput {
  id: string
  proposalId: string
  proposalKind: string
  sourceTable: string
  actorKind: string
  actorRef?: string | null
  source?: string | null
  targetKind: string
  previousRef: string
  nextRef: string
  fieldPath: string
  previousVersion?: string | null
  nextVersion?: string | null
  preconditionKind?: string | null
  preconditionHash?: string | null
  changedAt: string
  reason?: string | null
  affectedDownstreamRefs?: ChapterTraceabilityRef[]
  metadata?: Record<string, unknown>
}

export interface BuildChapterTraceabilityReportArgs {
  novelId: string
  chapterNumber: number
  generatedAt?: string
  outline: ChapterOutline
  targetMap: PlanningTargetMap
  llmCalls?: ChapterTraceabilityCallInput[]
  traceEvents?: ChapterTraceabilityEventInput[]
  proposalEnvelopes?: ChapterTraceabilityProposalEnvelopeInput[]
  resolutionImpacts?: ChapterTraceabilityResolutionImpactInput[]
  checkerObservations?: ChapterTraceabilityCheckerObservationInput[]
  mutationLineage?: ChapterTraceabilityMutationLineageInput[]
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
  const sourceRegistryBase = buildSourceRegistry(outline)
  const sourceKeys = new Set(sourceRegistryBase.map((item) => sourceKey(item.kind, item.ref)))
  const targetLabels = new Map(args.targetMap.targets.map((target) => [
    `${target.kind}:${target.ref}`,
    target.label,
  ]))
  const evidenceIndex = buildEvidenceIndex(args)
  const chapterEvidence = evidenceForRefs(chapterEvidenceRefs(chapterRef, outline.chapterNumber, targetLabels), evidenceIndex)
  const sourceRegistry = sourceRegistryBase.map((item) => ({
    ...item,
    proposalEvidence: evidenceForRefs([ref(item.kind, item.ref, targetLabels)], evidenceIndex),
  }))

  const callsByBeat = groupCallsByBeat(args.llmCalls ?? [])
  const eventsByBeat = groupEventsByBeat(args.traceEvents ?? [])

  const beats = (outline.scenes ?? []).map((beat, beatIndex) => {
    const beatId = beat.beatId
    const refs = [
      ref("chapter_outline", chapterRef, targetLabels),
      ...(beatId ? [ref("beat_plan", beatId, targetLabels)] : []),
    ]
    const obligations = collectTraceableObligations(beat, sourceKeys, targetLabels, evidenceIndex)
    const llmCalls = callsForBeat(callsByBeat, beatIndex, beatId).map(mapCall)
    const traceEvents = eventsForBeat(eventsByBeat, beatIndex, beatId).map(mapEvent)
    const proposalEvidence = evidenceForRefs(
      beatId ? [ref("beat_plan", beatId, targetLabels)] : [],
      evidenceIndex,
    )

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
      proposalEvidence,
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
  const evidenceSummary = summarizeEvidence([
    ...chapterEvidence,
    ...sourceRegistry.flatMap((item) => item.proposalEvidence),
    ...beats.flatMap((beat) => [
      ...beat.proposalEvidence,
      ...beat.obligations.flatMap((item) => item.proposalEvidence),
    ]),
  ])

  return {
    ok: true,
    novelId: args.novelId,
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    planningSnapshotHash: args.targetMap.planningSnapshotHash,
    chapterNumber: args.chapterNumber,
    chapterRef,
    chapterId: outline.chapterId,
    title: outline.title,
    chapterEvidence,
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
      proposalEnvelopeCount: evidenceSummary.proposalEnvelopeCount,
      resolutionImpactCount: evidenceSummary.resolutionImpactCount,
      checkerObservationCount: evidenceSummary.checkerObservationCount,
      mutationLineageCount: evidenceSummary.mutationLineageCount,
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
  const evidenceRefs = collectReportEvidenceRefs(outline)
  const evidenceRefValues = collectEvidenceRefValues(evidenceRefs)
  const [targetMap, llmCalls, traceEvents, proposalEnvelopes, resolutionImpacts, checkerObservations, mutationLineage] = await Promise.all([
    loadPlanningTargetMap(novelId),
    loadTraceabilityCalls(novelId, chapterNumber),
    loadTraceabilityEvents(novelId, chapterNumber),
    loadTraceabilityProposalEnvelopes(novelId, evidenceRefValues),
    listProposalResolutionImpactsByTargetRefs(novelId, evidenceRefValues),
    loadTraceabilityCheckerObservations(novelId, evidenceRefValues),
    listPlanningMutationLineageForRefs(novelId, evidenceRefValues),
  ])
  return buildChapterTraceabilityReport({
    novelId,
    chapterNumber,
    outline,
    targetMap,
    llmCalls,
    traceEvents,
    proposalEnvelopes,
    resolutionImpacts,
    checkerObservations,
    mutationLineage,
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

async function loadTraceabilityProposalEnvelopes(
  novelId: string,
  targetRefs: readonly string[],
): Promise<ChapterTraceabilityProposalEnvelopeInput[]> {
  const uniqueRefs = [...new Set(targetRefs.filter(Boolean))]
  const rowsById = new Map<string, any>()
  for (const targetRef of uniqueRefs) {
    const rows = await db`
      SELECT id, kind, target_kind, target_ref, target_field_path,
             status, risk, summary, created_at, resolved_at, payload
      FROM proposal_envelopes
      WHERE novel_id = ${novelId}
        AND (
          target_ref = ${targetRef}
          OR payload #>> '{chapterRef}' = ${targetRef}
          OR payload #>> '{beatRef}' = ${targetRef}
          OR payload #>> '{obligationId}' = ${targetRef}
          OR payload #>> '{characterId}' = ${targetRef}
          OR payload #>> '{target,chapterRef}' = ${targetRef}
          OR payload #>> '{target,beatRef}' = ${targetRef}
          OR payload #>> '{target,obligationId}' = ${targetRef}
          OR payload #>> '{target,characterId}' = ${targetRef}
        )
      ORDER BY created_at DESC, id ASC
      LIMIT 50
    `
    for (const row of rows) rowsById.set((row as any).id, row)
    if (rowsById.size >= 500) break
  }
  return [...rowsById.values()].slice(0, 500).map(rowToProposalEnvelopeEvidenceInput)
}

async function loadTraceabilityCheckerObservations(
  novelId: string,
  targetRefs: readonly string[],
): Promise<ChapterTraceabilityCheckerObservationInput[]> {
  const uniqueRefs = [...new Set(targetRefs.filter(Boolean))]
  const out: ChapterTraceabilityCheckerObservationInput[] = []
  const seen = new Set<string>()
  for (const targetRef of uniqueRefs) {
    const rows = await db`
      SELECT id, proposal_id, proposal_kind, source_table, target_kind, target_ref,
             chapter_number, result_hash, checker_name, fired, observed_at, details
      FROM proposal_checker_observations
      WHERE novel_id = ${novelId}
        AND target_ref = ${targetRef}
      ORDER BY observed_at DESC, id ASC
      LIMIT 50
    `
    for (const row of rows as any[]) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      out.push({
        id: row.id,
        proposalId: row.proposal_id,
        proposalKind: row.proposal_kind,
        sourceTable: row.source_table,
        targetKind: row.target_kind,
        targetRef: row.target_ref,
        chapterNumber: row.chapter_number,
        resultHash: row.result_hash,
        checkerName: row.checker_name,
        fired: row.fired === true,
        observedAt: dateString(row.observed_at),
        details: normalizeRecord(row.details),
      })
      if (out.length >= 500) return out
    }
  }
  return out
}

function rowToProposalEnvelopeEvidenceInput(row: any): ChapterTraceabilityProposalEnvelopeInput {
  const payload = row.payload
  const targetRefs = dedupeRefs([
    { kind: row.target_kind, ref: row.target_ref },
    ...proposalRefsFromPayload(payload),
  ])
  return {
    id: row.id,
    kind: row.kind,
    targetKind: row.target_kind,
    targetRef: row.target_ref,
    targetFieldPath: row.target_field_path,
    status: row.status,
    risk: row.risk,
    summary: row.summary,
    createdAt: dateString(row.created_at),
    resolvedAt: row.resolved_at ? dateString(row.resolved_at) : null,
    targetRefs,
  }
}

function collectReportEvidenceRefs(outlineInput: ChapterOutline): ChapterTraceabilityRef[] {
  const outline = clone(outlineInput)
  enrichOutlineIds(outline)
  const chapterRef = outline.chapterId ?? `chapter-${outline.chapterNumber}`
  const refs: ChapterTraceabilityRef[] = [
    ...chapterEvidenceRefs(chapterRef, outline.chapterNumber),
  ]
  for (const item of buildSourceRegistry(outline)) {
    refs.push({ kind: item.kind, ref: item.ref })
  }
  for (const beat of outline.scenes ?? []) {
    if (beat.beatId) refs.push({ kind: "beat_plan", ref: beat.beatId })
    forEachObligation(beat.obligations, (item) => {
      refs.push(...obligationEvidenceRefs(item))
    })
  }
  return dedupeRefs(refs)
}

function collectEvidenceRefValues(refs: ChapterTraceabilityRef[]): string[] {
  const values = new Set<string>()
  for (const item of refs) {
    values.add(item.ref)
    values.add(refKey(item))
  }
  return [...values]
}

function chapterEvidenceRefs(
  chapterRef: string,
  chapterNumber: number,
  labels?: Map<string, string>,
): ChapterTraceabilityRef[] {
  const legacyChapterRef = `chapter:${chapterNumber}`
  return dedupeRefs([
    ref("chapter_outline", chapterRef, labels),
    ref("chapter_outline", legacyChapterRef, labels),
    ref("chapter", legacyChapterRef, labels),
  ])
}

function obligationEvidenceRefs(
  item: BeatObligationsContract[ObligationListKey][number],
  labels?: Map<string, string>,
): ChapterTraceabilityRef[] {
  const sourceRefKind = sourceKindToRegistryKind(item.sourceKind)
  return dedupeRefs([
    ...(item.obligationId ? [ref("beat_obligation", item.obligationId, labels)] : []),
    ...(item.sourceId && sourceRefKind ? [ref(sourceRefKind, item.sourceId, labels)] : []),
    ...(item.characterId ? [ref("character", item.characterId, labels)] : []),
  ])
}

interface EvidenceIndex {
  proposalEnvelopesByRef: Map<string, ChapterTraceabilityProposalEnvelopeInput[]>
  resolutionImpactsByRef: Map<string, ChapterTraceabilityResolutionImpactInput[]>
  checkerObservationsByRef: Map<string, ChapterTraceabilityCheckerObservationInput[]>
  mutationLineageByRef: Map<string, ChapterTraceabilityMutationLineageInput[]>
}

function buildEvidenceIndex(args: BuildChapterTraceabilityReportArgs): EvidenceIndex {
  const proposalEnvelopesByRef = new Map<string, ChapterTraceabilityProposalEnvelopeInput[]>()
  for (const proposal of args.proposalEnvelopes ?? []) {
    const refs = proposal.targetRefs && proposal.targetRefs.length > 0
      ? proposal.targetRefs
      : [{ kind: proposal.targetKind, ref: proposal.targetRef }]
    for (const target of dedupeRefs(refs)) {
      addGrouped(proposalEnvelopesByRef, [refKey(target)], proposal)
    }
  }

  const resolutionImpactsByRef = new Map<string, ChapterTraceabilityResolutionImpactInput[]>()
  for (const impact of args.resolutionImpacts ?? []) {
    addGrouped(resolutionImpactsByRef, [impact.targetRef], impact)
  }

  const checkerObservationsByRef = new Map<string, ChapterTraceabilityCheckerObservationInput[]>()
  for (const observation of args.checkerObservations ?? []) {
    addGrouped(checkerObservationsByRef, [observation.targetRef], observation)
  }

  const mutationLineageByRef = new Map<string, ChapterTraceabilityMutationLineageInput[]>()
  for (const lineage of args.mutationLineage ?? []) {
    const keys = [
      `${lineage.targetKind}:${lineage.previousRef}`,
      `${lineage.targetKind}:${lineage.nextRef}`,
      ...(lineage.affectedDownstreamRefs ?? []).map(refKey),
    ]
    addGrouped(mutationLineageByRef, [...new Set(keys)], lineage)
  }

  return {
    proposalEnvelopesByRef,
    resolutionImpactsByRef,
    checkerObservationsByRef,
    mutationLineageByRef,
  }
}

function evidenceForRefs(
  refs: ChapterTraceabilityRef[],
  index: EvidenceIndex,
): ChapterTraceabilityEvidence[] {
  const out: ChapterTraceabilityEvidence[] = []
  for (const target of dedupeRefs(refs)) {
    const evidence: ChapterTraceabilityEvidence = {
      target,
      proposalEnvelopes: (index.proposalEnvelopesByRef.get(refKey(target)) ?? [])
        .map(toProposalEnvelopeEvidence),
      resolutionImpacts: (index.resolutionImpactsByRef.get(target.ref) ?? [])
        .map(toResolutionImpactEvidence),
      checkerObservations: (index.checkerObservationsByRef.get(target.ref) ?? [])
        .map(toCheckerObservationEvidence),
      mutationLineage: (index.mutationLineageByRef.get(refKey(target)) ?? [])
        .map(toMutationLineageEvidence),
    }
    if (
      evidence.proposalEnvelopes.length > 0 ||
      evidence.resolutionImpacts.length > 0 ||
      evidence.checkerObservations.length > 0 ||
      evidence.mutationLineage.length > 0
    ) {
      out.push(evidence)
    }
  }
  return out
}

function toProposalEnvelopeEvidence(
  input: ChapterTraceabilityProposalEnvelopeInput,
): ChapterTraceabilityProposalEnvelopeEvidence {
  return {
    id: input.id,
    kind: input.kind,
    targetKind: input.targetKind,
    targetRef: input.targetRef,
    ...(input.targetFieldPath ? { targetFieldPath: input.targetFieldPath } : {}),
    status: input.status,
    risk: input.risk,
    summary: input.summary,
    createdAt: input.createdAt,
    ...(input.resolvedAt ? { resolvedAt: input.resolvedAt } : {}),
    matchedRefs: dedupeRefs(input.targetRefs ?? [{ kind: input.targetKind, ref: input.targetRef }]),
  }
}

function toResolutionImpactEvidence(
  input: ChapterTraceabilityResolutionImpactInput,
): ChapterTraceabilityResolutionImpactEvidence {
  return {
    id: input.id,
    proposalId: input.proposalId,
    proposalKind: input.proposalKind,
    sourceTable: input.sourceTable,
    targetKind: input.targetKind,
    targetRef: input.targetRef,
    ...(input.chapterNumber != null ? { chapterNumber: input.chapterNumber } : {}),
    ...(input.priorHash ? { priorHash: input.priorHash } : {}),
    ...(input.resultHash ? { resultHash: input.resultHash } : {}),
    ...(input.resultVersion ? { resultVersion: input.resultVersion } : {}),
    resolvedAt: input.resolvedAt,
    metadata: input.metadata ?? {},
  }
}

function toCheckerObservationEvidence(
  input: ChapterTraceabilityCheckerObservationInput,
): ChapterTraceabilityCheckerObservationEvidence {
  return {
    id: input.id,
    proposalId: input.proposalId,
    proposalKind: input.proposalKind,
    sourceTable: input.sourceTable,
    targetKind: input.targetKind,
    targetRef: input.targetRef,
    ...(input.chapterNumber != null ? { chapterNumber: input.chapterNumber } : {}),
    ...(input.resultHash ? { resultHash: input.resultHash } : {}),
    checkerName: input.checkerName,
    fired: input.fired,
    observedAt: input.observedAt,
    details: input.details ?? {},
  }
}

function toMutationLineageEvidence(
  input: ChapterTraceabilityMutationLineageInput,
): ChapterTraceabilityMutationLineageEvidence {
  return {
    id: input.id,
    proposalId: input.proposalId,
    proposalKind: input.proposalKind,
    sourceTable: input.sourceTable,
    actorKind: input.actorKind,
    ...(input.actorRef ? { actorRef: input.actorRef } : {}),
    ...(input.source ? { source: input.source } : {}),
    targetKind: input.targetKind,
    previousRef: input.previousRef,
    nextRef: input.nextRef,
    fieldPath: input.fieldPath,
    ...(input.previousVersion ? { previousVersion: input.previousVersion } : {}),
    ...(input.nextVersion ? { nextVersion: input.nextVersion } : {}),
    ...(input.preconditionKind ? { preconditionKind: input.preconditionKind } : {}),
    ...(input.preconditionHash ? { preconditionHash: input.preconditionHash } : {}),
    changedAt: input.changedAt,
    ...(input.reason ? { reason: input.reason } : {}),
    affectedDownstreamRefs: dedupeRefs(input.affectedDownstreamRefs ?? []),
    metadata: input.metadata ?? {},
  }
}

function summarizeEvidence(items: ChapterTraceabilityEvidence[]): {
  proposalEnvelopeCount: number
  resolutionImpactCount: number
  checkerObservationCount: number
  mutationLineageCount: number
} {
  const proposalIds = new Set<string>()
  const impactIds = new Set<string>()
  const observationIds = new Set<string>()
  const lineageIds = new Set<string>()
  for (const item of items) {
    for (const proposal of item.proposalEnvelopes) proposalIds.add(proposal.id)
    for (const impact of item.resolutionImpacts) impactIds.add(impact.id)
    for (const observation of item.checkerObservations) observationIds.add(observation.id)
    for (const lineage of item.mutationLineage) lineageIds.add(lineage.id)
  }
  return {
    proposalEnvelopeCount: proposalIds.size,
    resolutionImpactCount: impactIds.size,
    checkerObservationCount: observationIds.size,
    mutationLineageCount: lineageIds.size,
  }
}

function buildSourceRegistry(
  outline: ChapterOutline,
): Array<Omit<ChapterTraceabilitySourceRegistryItem, "proposalEvidence">> {
  const items: Array<Omit<ChapterTraceabilitySourceRegistryItem, "proposalEvidence">> = []
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
  evidenceIndex: EvidenceIndex,
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
        proposalEvidence: evidenceForRefs(refs, evidenceIndex),
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

function proposalRefsFromPayload(payload: unknown): ChapterTraceabilityRef[] {
  const root = safeRecord(payload)
  if (!root) return []
  const target = safeRecord(root.target)
  const refs: ChapterTraceabilityRef[] = []
  addChapterPayloadRef(refs, readString(root.chapterRef))
  addChapterPayloadRef(refs, readString(target?.chapterRef))
  addPayloadRef(refs, "beat_plan", readString(root.beatRef))
  addPayloadRef(refs, "beat_plan", readString(target?.beatRef))
  addPayloadRef(refs, "beat_obligation", readString(root.obligationId))
  addPayloadRef(refs, "beat_obligation", readString(target?.obligationId))
  addPayloadRef(refs, "character", readString(root.characterId))
  addPayloadRef(refs, "character", readString(target?.characterId))
  addSourcePayloadRef(refs, root)
  if (target) addSourcePayloadRef(refs, target)
  for (const entityRef of Array.isArray(root.entityRefs) ? root.entityRefs : []) {
    const record = safeRecord(entityRef)
    const kind = readString(record?.kind)
    const value = readString(record?.ref)
    if (kind && value) refs.push({ kind, ref: value })
  }
  return dedupeRefs(refs)
}

function addChapterPayloadRef(refs: ChapterTraceabilityRef[], value: string | undefined): void {
  if (!value) return
  refs.push({ kind: "chapter_outline", ref: value })
  refs.push({ kind: "chapter", ref: value })
}

function addSourcePayloadRef(refs: ChapterTraceabilityRef[], value: Record<string, unknown>): void {
  const sourceId = readString(value.sourceId)
  const sourceKind = sourceKindToRegistryKind(readString(value.sourceKind))
  if (sourceId && sourceKind) refs.push({ kind: sourceKind, ref: sourceId })
}

function addPayloadRef(
  refs: ChapterTraceabilityRef[],
  kind: string,
  value: string | undefined,
): void {
  if (value) refs.push({ kind, ref: value })
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function safeRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
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

function refKey(item: Pick<ChapterTraceabilityRef, "kind" | "ref">): string {
  return `${item.kind}:${item.ref}`
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
  items: Array<Omit<ChapterTraceabilitySourceRegistryItem, "proposalEvidence">>,
): Array<Omit<ChapterTraceabilitySourceRegistryItem, "proposalEvidence">> {
  const seen = new Set<string>()
  const out: Array<Omit<ChapterTraceabilitySourceRegistryItem, "proposalEvidence">> = []
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

function normalizeRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    const parsed = JSON.parse(raw)
    return safeRecord(parsed) ?? {}
  }
  return safeRecord(raw) ?? {}
}
