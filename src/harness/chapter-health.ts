import { createHash } from "node:crypto"

import { stableHash } from "../canon/proposal-envelope"
import db from "../db/connection"
import { parseJsonbArray } from "../db/jsonb"
import { getNovel } from "../db/novels"
import { getChapterOutlines } from "../db/outlines"
import { validateChapterDraft } from "../validation"
import { enrichOutlineIds } from "./ids"
import { loadPlanningTargetMap, type PlanningTarget, type PlanningTargetMap } from "./planning-targets"
import type { ChapterOutline, ValidationFinding } from "../types"

export type ChapterHealthStatus =
  | "missing_outline"
  | "missing_draft"
  | "fail"
  | "warn"
  | "pass"

export type ChapterHealthFindingSource =
  | "validation"
  | "issue"
  | "exhaustion"
  | "proposal"

export type ChapterHealthSeverity = "blocker" | "warning" | "info"

export interface ChapterHealthStableRef {
  kind: string
  ref: string
  label?: string
}

export interface ChapterHealthStableSource {
  kind: "computed" | "table"
  name?: string
  table?: string
  rowId?: string | number
  inputHash?: string
}

export interface ChapterHealthFinding {
  source: ChapterHealthFindingSource
  severity: ChapterHealthSeverity
  code: string
  description: string
  chapterNumber: number
  chapterId?: string
  beatIndex?: number
  beatId?: string
  refs: ChapterHealthStableRef[]
  metadata?: Record<string, unknown>
  stableSource: ChapterHealthStableSource
}

export interface ChapterHealthDraftSummary {
  version: number
  status: string
  wordCount: number
  hash: string
}

export interface ChapterHealthOutlineSummary {
  targetRef: string
  currentVersion: string
  beatCount: number
  beatRefs: string[]
  obligationRefs: string[]
}

export interface ChapterHealthTraceEvent {
  id: number
  eventType: string
  beatIndex?: number
  agent?: string
  llmCallId?: number
  durationMs?: number
  timestamp: string
  payload: unknown
}

export interface ChapterHealthCheckerCall {
  id: number
  agent: string
  beatIndex?: number
  beatId?: string
  attempt?: number
  failed: boolean
  zodValidationSuccess: boolean
  jsonExtractionSuccess: boolean
  timestamp: string
  nerPrepass?: {
    andGateDecision?: string
    nerFindings: number
    nerOnlyFindings: number
  }
}

export interface ChapterHealthProposalSummary {
  id: string
  kind: string
  targetKind: string
  targetRef: string
  status: string
  risk: string
  summary: string
  preconditionHash: string
  createdAt: string
  resolvedAt?: string
}

export interface ChapterHealthCheckerObservation {
  id: string
  proposalId: string
  proposalKind: string
  targetKind: string
  targetRef: string
  checkerName: string
  fired: boolean
  observedAt: string
  resultHash?: string
  details: unknown
}

export interface ChapterHealthChapter {
  chapterNumber: number
  chapterRef: string
  chapterId?: string
  title?: string
  status: ChapterHealthStatus
  draft?: ChapterHealthDraftSummary
  outline?: ChapterHealthOutlineSummary
  health: {
    blockerCount: number
    warningCount: number
    infoCount: number
    proposalCount: number
    pendingProposalCount: number
    latestValidationPassed?: boolean
  }
  findings: ChapterHealthFinding[]
  trace: {
    latestEvents: ChapterHealthTraceEvent[]
    checkerCalls: ChapterHealthCheckerCall[]
  }
  proposals: {
    envelopes: ChapterHealthProposalSummary[]
    checkerObservations: ChapterHealthCheckerObservation[]
  }
}

export interface ChapterHealthReport {
  ok: true
  novelId: string
  generatedAt: string
  chapters: ChapterHealthChapter[]
  summary: {
    chapterCount: number
    pass: number
    warn: number
    fail: number
    missingDraft: number
    missingOutline: number
    blockerFindings: number
    warningFindings: number
    infoFindings: number
    pendingProposals: number
  }
}

export interface ChapterHealthDraftInput {
  chapterNumber: number
  prose: string
  wordCount: number
  version: number
  status: string
}

export interface ChapterHealthIssueInput {
  id: number | string
  chapterNumber: number
  severity: string
  description: string
  conflictsWith?: string | null
  suggestedFix?: string | null
}

export interface ChapterHealthExhaustionInput {
  id: number | string
  chapterNumber: number
  kind: string
  attempt: number
  decidedAt?: string | null
  unresolvedDeviations: Array<{
    description: string
    beat_index?: number | null
    beatId?: string
    metadata?: Record<string, unknown>
  }>
}

export interface ChapterHealthProposalInput {
  id: string
  kind: string
  targetKind: string
  targetRef: string
  status: string
  risk: string
  summary: string
  preconditionHash: string
  createdAt: string
  resolvedAt?: string | null
  payload?: unknown
}

export interface ChapterHealthTraceEventInput {
  id: number
  chapterNumber: number
  beatIndex?: number | null
  eventType: string
  agent?: string | null
  llmCallId?: number | null
  durationMs?: number | null
  timestamp: string
  payload: unknown
}

export interface ChapterHealthCheckerCallInput {
  id: number
  chapterNumber: number
  agent: string
  beatIndex?: number | null
  beatId?: string | null
  attempt?: number | null
  failed: boolean
  zodValidationSuccess: boolean
  jsonExtractionSuccess: boolean
  timestamp: string
  nerPrepass?: unknown
}

export interface ChapterHealthCheckerObservationInput {
  id: string
  proposalId: string
  proposalKind: string
  targetKind: string
  targetRef: string
  chapterNumber?: number | null
  resultHash?: string | null
  checkerName: string
  fired: boolean
  observedAt: string
  details: unknown
}

export interface BuildChapterHealthReportArgs {
  novelId: string
  totalChapters?: number
  chapter?: number
  generatedAt?: string
  outlines: ChapterOutline[]
  drafts: ChapterHealthDraftInput[]
  issues?: ChapterHealthIssueInput[]
  exhaustions?: ChapterHealthExhaustionInput[]
  proposals?: ChapterHealthProposalInput[]
  traceEvents?: ChapterHealthTraceEventInput[]
  checkerCalls?: ChapterHealthCheckerCallInput[]
  checkerObservations?: ChapterHealthCheckerObservationInput[]
  planningTargetMap?: PlanningTargetMap | null
}

export interface LoadChapterHealthReportOptions {
  chapter?: number
}

const HEALTH_EVENT_TYPES = new Set([
  "validation-check",
  "functional-check",
  "prose-integrity-check",
  "lint-detect",
  "lint-prose-edit-proposals",
  "editorial-beat-coverage-proposals",
  "continuity-editorial-flag-proposals",
  "plan-check-outcome",
  "plan-check-drift-witness",
])

const CHECKER_AGENTS = new Set([
  "chapter-plan-checker",
  "halluc-ungrounded",
  "functional-state-checker",
  "continuity-facts",
  "continuity-state",
  "prose-integrity-checker",
  "lint-detector",
  "editorial-beat-coverage",
])

export async function loadChapterHealthReport(
  novelId: string,
  opts: LoadChapterHealthReportOptions = {},
): Promise<ChapterHealthReport> {
  const novel = await getNovel(novelId)
  const [
    outlines,
    drafts,
    issues,
    exhaustions,
    proposals,
    traceEvents,
    checkerCalls,
    checkerObservations,
    planningTargetMap,
  ] = await Promise.all([
    getChapterOutlines(novelId),
    loadLatestDrafts(novelId, opts.chapter),
    loadOpenIssues(novelId, opts.chapter),
    loadExhaustions(novelId, opts.chapter),
    loadEditorialProposalRows(novelId),
    loadHealthTraceEvents(novelId, opts.chapter),
    loadCheckerCalls(novelId, opts.chapter),
    loadCheckerObservations(novelId, opts.chapter),
    loadPlanningTargetMap(novelId).catch(() => null),
  ])

  return buildChapterHealthReport({
    novelId,
    totalChapters: novel.totalChapters,
    chapter: opts.chapter,
    outlines,
    drafts,
    issues,
    exhaustions,
    proposals,
    traceEvents,
    checkerCalls,
    checkerObservations,
    planningTargetMap,
  })
}

export function buildChapterHealthReport(args: BuildChapterHealthReportArgs): ChapterHealthReport {
  const outlinesByChapter = new Map<number, ChapterOutline>()
  for (const outline of args.outlines) {
    const normalized = normalizeOutline(outline)
    outlinesByChapter.set(normalized.chapterNumber, normalized)
  }

  const draftsByChapter = new Map(args.drafts.map((draft) => [draft.chapterNumber, draft]))
  const issuesByChapter = groupByChapter(args.issues ?? [], (issue) => issue.chapterNumber)
  const exhaustionsByChapter = groupByChapter(args.exhaustions ?? [], (row) => row.chapterNumber)
  const eventsByChapter = groupByChapter(args.traceEvents ?? [], (event) => event.chapterNumber)
  const callsByChapter = groupByChapter(args.checkerCalls ?? [], (call) => call.chapterNumber)
  const observationsByChapter = groupByChapter(
    args.checkerObservations ?? [],
    (observation) => observation.chapterNumber ?? null,
  )
  const targetMap = new Map<string, PlanningTarget>()
  for (const target of args.planningTargetMap?.targets ?? []) {
    targetMap.set(`${target.kind}:${target.ref}`, target)
  }

  const chapterNumbers = collectChapterNumbers(args, outlinesByChapter, draftsByChapter)
  const chapters = chapterNumbers.map((chapterNumber) => {
    const outline = outlinesByChapter.get(chapterNumber)
    const draftInput = draftsByChapter.get(chapterNumber)
    const chapterRef = `chapter:${chapterNumber}`
    const chapterId = outline?.chapterId
    const draft = draftInput ? summarizeDraft(draftInput) : undefined
    const proposals = (args.proposals ?? []).filter((proposal) =>
      proposalBelongsToChapter(proposal, chapterRef, chapterId),
    )
    const checkerObservations = (observationsByChapter.get(chapterNumber) ?? [])
      .filter((observation) => !draft?.hash || !observation.resultHash || observation.resultHash === draft.hash)
      .slice(0, 50)
      .map(toCheckerObservation)
    const findings: ChapterHealthFinding[] = []
    let latestValidationPassed: boolean | undefined

    if (outline && draftInput && draft) {
      const validation = validateChapterDraft(draftInput.prose, outline, "validation")
      latestValidationPassed = validation.passed
      for (const finding of validation.findings ?? fallbackValidationFindings(validation, outline)) {
        findings.push(validationFindingToHealthFinding(finding, chapterNumber, chapterId, draft.hash))
      }
    }

    for (const issue of issuesByChapter.get(chapterNumber) ?? []) {
      findings.push(issueToFinding(issue, chapterNumber, chapterId))
    }

    for (const exhaustion of exhaustionsByChapter.get(chapterNumber) ?? []) {
      if (exhaustion.decidedAt) continue
      for (const deviation of exhaustion.unresolvedDeviations) {
        findings.push(exhaustionToFinding(exhaustion, deviation, chapterNumber, chapterId))
      }
    }

    for (const proposal of proposals) {
      if (proposal.status !== "pending") continue
      findings.push(proposalToFinding(proposal, chapterNumber, chapterId))
    }

    const blockerCount = findings.filter((finding) => finding.severity === "blocker").length
    const warningCount = findings.filter((finding) => finding.severity === "warning").length
    const infoCount = findings.filter((finding) => finding.severity === "info").length
    const status = chapterStatus({ outline, draft, blockerCount, warningCount })
    const outlineSummary = outline
      ? summarizeOutline(outline, targetMap.get(`chapter_outline:${outline.chapterId ?? chapterRef}`))
      : undefined

    return {
      chapterNumber,
      chapterRef,
      ...(chapterId ? { chapterId } : {}),
      ...(outline?.title ? { title: outline.title } : {}),
      status,
      ...(draft ? { draft } : {}),
      ...(outlineSummary ? { outline: outlineSummary } : {}),
      health: {
        blockerCount,
        warningCount,
        infoCount,
        proposalCount: proposals.length,
        pendingProposalCount: proposals.filter((proposal) => proposal.status === "pending").length,
        ...(latestValidationPassed !== undefined ? { latestValidationPassed } : {}),
      },
      findings: findings.sort(compareFindings),
      trace: {
        latestEvents: (eventsByChapter.get(chapterNumber) ?? [])
          .filter((event) => HEALTH_EVENT_TYPES.has(event.eventType))
          .slice(0, 30)
          .map(toTraceEvent),
        checkerCalls: (callsByChapter.get(chapterNumber) ?? [])
          .filter((call) => CHECKER_AGENTS.has(call.agent))
          .slice(0, 50)
          .map(toCheckerCall),
      },
      proposals: {
        envelopes: proposals.slice(0, 50).map(toProposalSummary),
        checkerObservations,
      },
    } satisfies ChapterHealthChapter
  })

  return {
    ok: true,
    novelId: args.novelId,
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    chapters,
    summary: summarizeChapters(chapters),
  }
}

function normalizeOutline(outline: ChapterOutline): ChapterOutline {
  const normalized = JSON.parse(JSON.stringify(outline)) as ChapterOutline
  enrichOutlineIds(normalized)
  return normalized
}

function collectChapterNumbers(
  args: BuildChapterHealthReportArgs,
  outlinesByChapter: Map<number, ChapterOutline>,
  draftsByChapter: Map<number, ChapterHealthDraftInput>,
): number[] {
  if (args.chapter !== undefined) return [args.chapter]
  const numbers = new Set<number>()
  if (args.totalChapters && args.totalChapters > 0) {
    for (let i = 1; i <= args.totalChapters; i++) numbers.add(i)
  }
  for (const chapter of outlinesByChapter.keys()) numbers.add(chapter)
  for (const chapter of draftsByChapter.keys()) numbers.add(chapter)
  for (const issue of args.issues ?? []) numbers.add(issue.chapterNumber)
  for (const exhaustion of args.exhaustions ?? []) numbers.add(exhaustion.chapterNumber)
  for (const event of args.traceEvents ?? []) numbers.add(event.chapterNumber)
  for (const call of args.checkerCalls ?? []) numbers.add(call.chapterNumber)
  for (const observation of args.checkerObservations ?? []) {
    if (observation.chapterNumber != null) numbers.add(observation.chapterNumber)
  }
  return [...numbers].sort((a, b) => a - b)
}

function summarizeDraft(draft: ChapterHealthDraftInput): ChapterHealthDraftSummary {
  return {
    version: draft.version,
    status: draft.status,
    wordCount: draft.wordCount,
    hash: createHash("sha256").update(draft.prose, "utf8").digest("hex"),
  }
}

function summarizeOutline(
  outline: ChapterOutline,
  target?: PlanningTarget,
): ChapterHealthOutlineSummary {
  const beatRefs = (outline.scenes ?? [])
    .map((beat, index) => beat.beatId ?? `${outline.chapterId ?? `chapter:${outline.chapterNumber}`}-beat-${index + 1}`)
  return {
    targetRef: outline.chapterId ?? `chapter:${outline.chapterNumber}`,
    currentVersion: target?.currentVersion ?? stableHash(outline),
    beatCount: outline.scenes?.length ?? 0,
    beatRefs,
    obligationRefs: collectObligationRefs(outline),
  }
}

function collectObligationRefs(outline: ChapterOutline): string[] {
  const refs: string[] = []
  for (const beat of outline.scenes ?? []) {
    const obligations = beat.obligations as Record<string, unknown> | undefined
    if (!obligations) continue
    for (const value of Object.values(obligations)) {
      if (!Array.isArray(value)) continue
      for (const item of value) {
        if (typeof item !== "object" || item === null || Array.isArray(item)) continue
        const obligationId = (item as { obligationId?: unknown }).obligationId
        if (typeof obligationId === "string" && obligationId.length > 0) refs.push(obligationId)
      }
    }
  }
  return [...new Set(refs)].sort()
}

function validationFindingToHealthFinding(
  finding: ValidationFinding,
  chapterNumber: number,
  chapterId: string | undefined,
  draftHash: string,
): ChapterHealthFinding {
  const beatId = finding.beatId
  return {
    source: "validation",
    severity: finding.severity,
    code: finding.code,
    description: finding.description,
    chapterNumber,
    ...(chapterId ? { chapterId } : {}),
    ...(finding.beatIndex !== undefined ? { beatIndex: finding.beatIndex } : {}),
    ...(beatId ? { beatId } : {}),
    refs: refsForChapterAndBeat(chapterNumber, chapterId, beatId),
    ...(finding.metadata ? { metadata: finding.metadata } : {}),
    stableSource: {
      kind: "computed",
      name: "validateChapterDraft",
      inputHash: draftHash,
    },
  }
}

function fallbackValidationFindings(
  validation: { blockers: string[]; warnings: string[] },
  outline: ChapterOutline,
): ValidationFinding[] {
  return [
    ...validation.blockers.map((description) => ({
      severity: "blocker" as const,
      code: "legacy_blocker",
      description,
      chapterNumber: outline.chapterNumber,
      ...(outline.chapterId ? { chapterId: outline.chapterId } : {}),
    })),
    ...validation.warnings.map((description) => ({
      severity: "warning" as const,
      code: "legacy_warning",
      description,
      chapterNumber: outline.chapterNumber,
      ...(outline.chapterId ? { chapterId: outline.chapterId } : {}),
    })),
  ]
}

function issueToFinding(
  issue: ChapterHealthIssueInput,
  chapterNumber: number,
  chapterId: string | undefined,
): ChapterHealthFinding {
  return {
    source: "issue",
    severity: normalizeSeverity(issue.severity),
    code: "open_issue",
    description: issue.description,
    chapterNumber,
    ...(chapterId ? { chapterId } : {}),
    refs: refsForChapterAndBeat(chapterNumber, chapterId),
    metadata: {
      ...(issue.conflictsWith ? { conflictsWith: issue.conflictsWith } : {}),
      ...(issue.suggestedFix ? { suggestedFix: issue.suggestedFix } : {}),
    },
    stableSource: { kind: "table", table: "issues", rowId: issue.id },
  }
}

function exhaustionToFinding(
  exhaustion: ChapterHealthExhaustionInput,
  deviation: ChapterHealthExhaustionInput["unresolvedDeviations"][number],
  chapterNumber: number,
  chapterId: string | undefined,
): ChapterHealthFinding {
  const beatIndex = deviation.beat_index ?? undefined
  return {
    source: "exhaustion",
    severity: "blocker",
    code: exhaustion.kind,
    description: deviation.description,
    chapterNumber,
    ...(chapterId ? { chapterId } : {}),
    ...(beatIndex !== undefined ? { beatIndex } : {}),
    ...(deviation.beatId ? { beatId: deviation.beatId } : {}),
    refs: refsForChapterAndBeat(chapterNumber, chapterId, deviation.beatId),
    metadata: {
      attempt: exhaustion.attempt,
      ...(deviation.metadata ? deviation.metadata : {}),
    },
    stableSource: { kind: "table", table: "chapter_exhaustions", rowId: exhaustion.id },
  }
}

function proposalToFinding(
  proposal: ChapterHealthProposalInput,
  chapterNumber: number,
  chapterId: string | undefined,
): ChapterHealthFinding {
  const payload = safeRecord(proposal.payload)
  const severity = normalizeSeverity(
    typeof payload?.severity === "string" ? payload.severity : proposal.risk,
  )
  const code = typeof payload?.issueType === "string" ? payload.issueType : proposal.kind
  const beatRef = typeof payload?.beatRef === "string" ? payload.beatRef : undefined
  return {
    source: "proposal",
    severity,
    code,
    description: proposal.summary,
    chapterNumber,
    ...(chapterId ? { chapterId } : {}),
    ...(beatRef ? { beatId: beatRef } : {}),
    refs: [
      ...refsForChapterAndBeat(chapterNumber, chapterId, beatRef),
      { kind: proposal.targetKind, ref: proposal.targetRef },
    ],
    metadata: {
      proposalId: proposal.id,
      proposalKind: proposal.kind,
      status: proposal.status,
      risk: proposal.risk,
    },
    stableSource: { kind: "table", table: "proposal_envelopes", rowId: proposal.id },
  }
}

function refsForChapterAndBeat(
  chapterNumber: number,
  chapterId?: string,
  beatId?: string,
): ChapterHealthStableRef[] {
  const refs: ChapterHealthStableRef[] = [
    { kind: "chapter", ref: `chapter:${chapterNumber}` },
  ]
  if (chapterId) refs.push({ kind: "chapter_outline", ref: chapterId })
  if (beatId) refs.push({ kind: "beat_plan", ref: beatId })
  return refs
}

function chapterStatus(args: {
  outline?: ChapterOutline
  draft?: ChapterHealthDraftSummary
  blockerCount: number
  warningCount: number
}): ChapterHealthStatus {
  if (!args.outline) return "missing_outline"
  if (!args.draft) return "missing_draft"
  if (args.blockerCount > 0) return "fail"
  if (args.warningCount > 0) return "warn"
  return "pass"
}

function proposalBelongsToChapter(
  proposal: ChapterHealthProposalInput,
  chapterRef: string,
  chapterId: string | undefined,
): boolean {
  const refs = new Set([chapterRef])
  if (chapterId) refs.add(chapterId)
  if (refs.has(proposal.targetRef)) return true
  const payload = safeRecord(proposal.payload)
  const payloadChapterRef = readNestedString(payload, ["chapterRef"])
    ?? readNestedString(payload, ["target", "chapterRef"])
  if (payloadChapterRef && refs.has(payloadChapterRef)) return true
  if (proposal.targetRef.includes(chapterRef)) return true
  if (chapterId && proposal.targetRef.includes(chapterId)) return true
  return false
}

function normalizeSeverity(value: string): ChapterHealthSeverity {
  const normalized = value.toLowerCase()
  if (normalized === "blocker" || normalized === "error" || normalized === "high") return "blocker"
  if (normalized === "warning" || normalized === "medium") return "warning"
  return "info"
}

function toTraceEvent(event: ChapterHealthTraceEventInput): ChapterHealthTraceEvent {
  return {
    id: event.id,
    eventType: event.eventType,
    ...(event.beatIndex != null ? { beatIndex: event.beatIndex } : {}),
    ...(event.agent ? { agent: event.agent } : {}),
    ...(event.llmCallId != null ? { llmCallId: event.llmCallId } : {}),
    ...(event.durationMs != null ? { durationMs: event.durationMs } : {}),
    timestamp: event.timestamp,
    payload: event.payload,
  }
}

function toCheckerCall(call: ChapterHealthCheckerCallInput): ChapterHealthCheckerCall {
  return {
    id: call.id,
    agent: call.agent,
    ...(call.beatIndex != null ? { beatIndex: call.beatIndex } : {}),
    ...(call.beatId ? { beatId: call.beatId } : {}),
    ...(call.attempt != null ? { attempt: call.attempt } : {}),
    failed: call.failed,
    zodValidationSuccess: call.zodValidationSuccess,
    jsonExtractionSuccess: call.jsonExtractionSuccess,
    timestamp: call.timestamp,
    ...summarizeNerPrepass(call.nerPrepass),
  }
}

function summarizeNerPrepass(value: unknown): { nerPrepass?: ChapterHealthCheckerCall["nerPrepass"] } {
  const record = safeRecord(value)
  if (!record) return {}
  return {
    nerPrepass: {
      ...(typeof record.andGateDecision === "string" ? { andGateDecision: record.andGateDecision } : {}),
      nerFindings: Array.isArray(record.nerFindings) ? record.nerFindings.length : 0,
      nerOnlyFindings: Array.isArray(record.nerOnlyFindings) ? record.nerOnlyFindings.length : 0,
    },
  }
}

function toProposalSummary(proposal: ChapterHealthProposalInput): ChapterHealthProposalSummary {
  return {
    id: proposal.id,
    kind: proposal.kind,
    targetKind: proposal.targetKind,
    targetRef: proposal.targetRef,
    status: proposal.status,
    risk: proposal.risk,
    summary: proposal.summary,
    preconditionHash: proposal.preconditionHash,
    createdAt: proposal.createdAt,
    ...(proposal.resolvedAt ? { resolvedAt: proposal.resolvedAt } : {}),
  }
}

function toCheckerObservation(
  observation: ChapterHealthCheckerObservationInput,
): ChapterHealthCheckerObservation {
  return {
    id: observation.id,
    proposalId: observation.proposalId,
    proposalKind: observation.proposalKind,
    targetKind: observation.targetKind,
    targetRef: observation.targetRef,
    checkerName: observation.checkerName,
    fired: observation.fired,
    observedAt: observation.observedAt,
    ...(observation.resultHash ? { resultHash: observation.resultHash } : {}),
    details: observation.details,
  }
}

function compareFindings(a: ChapterHealthFinding, b: ChapterHealthFinding): number {
  return (
    severityRank(a.severity) - severityRank(b.severity) ||
    (a.beatIndex ?? -1) - (b.beatIndex ?? -1) ||
    a.source.localeCompare(b.source) ||
    a.code.localeCompare(b.code)
  )
}

function severityRank(severity: ChapterHealthSeverity): number {
  if (severity === "blocker") return 0
  if (severity === "warning") return 1
  return 2
}

function summarizeChapters(chapters: ChapterHealthChapter[]): ChapterHealthReport["summary"] {
  return {
    chapterCount: chapters.length,
    pass: chapters.filter((chapter) => chapter.status === "pass").length,
    warn: chapters.filter((chapter) => chapter.status === "warn").length,
    fail: chapters.filter((chapter) => chapter.status === "fail").length,
    missingDraft: chapters.filter((chapter) => chapter.status === "missing_draft").length,
    missingOutline: chapters.filter((chapter) => chapter.status === "missing_outline").length,
    blockerFindings: chapters.reduce((sum, chapter) => sum + chapter.health.blockerCount, 0),
    warningFindings: chapters.reduce((sum, chapter) => sum + chapter.health.warningCount, 0),
    infoFindings: chapters.reduce((sum, chapter) => sum + chapter.health.infoCount, 0),
    pendingProposals: chapters.reduce((sum, chapter) => sum + chapter.health.pendingProposalCount, 0),
  }
}

function groupByChapter<T>(
  rows: readonly T[],
  chapterOf: (row: T) => number | null | undefined,
): Map<number, T[]> {
  const grouped = new Map<number, T[]>()
  for (const row of rows) {
    const chapter = chapterOf(row)
    if (chapter == null) continue
    const bucket = grouped.get(chapter)
    if (bucket) bucket.push(row)
    else grouped.set(chapter, [row])
  }
  return grouped
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readNestedString(record: Record<string, unknown> | null, path: string[]): string | undefined {
  let cur: unknown = record
  for (const key of path) {
    const obj = safeRecord(cur)
    if (!obj) return undefined
    cur = obj[key]
  }
  return typeof cur === "string" ? cur : undefined
}

async function loadLatestDrafts(
  novelId: string,
  chapter?: number,
): Promise<ChapterHealthDraftInput[]> {
  const rows = chapter !== undefined
    ? await db`
        SELECT DISTINCT ON (chapter_number)
          chapter_number, prose, word_count, version, status
        FROM chapter_drafts
        WHERE novel_id = ${novelId}
          AND chapter_number = ${chapter}
        ORDER BY chapter_number, version DESC
      `
    : await db`
        SELECT DISTINCT ON (chapter_number)
          chapter_number, prose, word_count, version, status
        FROM chapter_drafts
        WHERE novel_id = ${novelId}
        ORDER BY chapter_number, version DESC
      `
  return rows.map((row: any) => ({
    chapterNumber: row.chapter_number,
    prose: row.prose,
    wordCount: row.word_count,
    version: row.version,
    status: row.status,
  }))
}

async function loadOpenIssues(
  novelId: string,
  chapter?: number,
): Promise<ChapterHealthIssueInput[]> {
  const rows = chapter !== undefined
    ? await db`
        SELECT id, chapter, severity, description, conflicts_with, suggested_fix
        FROM issues
        WHERE novel_id = ${novelId}
          AND status = 'open'
          AND chapter = ${chapter}
        ORDER BY created_at DESC
        LIMIT 200
      `
    : await db`
        SELECT id, chapter, severity, description, conflicts_with, suggested_fix
        FROM issues
        WHERE novel_id = ${novelId}
          AND status = 'open'
        ORDER BY created_at DESC
        LIMIT 500
      `
  return rows.map((row: any) => ({
    id: row.id,
    chapterNumber: row.chapter,
    severity: row.severity,
    description: row.description,
    conflictsWith: row.conflicts_with,
    suggestedFix: row.suggested_fix,
  }))
}

async function loadExhaustions(
  novelId: string,
  chapter?: number,
): Promise<ChapterHealthExhaustionInput[]> {
  const rows = chapter !== undefined
    ? await db`
        SELECT id, chapter, attempt, kind, unresolved_deviations, decided_at
        FROM chapter_exhaustions
        WHERE novel_id = ${novelId}
          AND chapter = ${chapter}
        ORDER BY fired_at DESC
        LIMIT 200
      `
    : await db`
        SELECT id, chapter, attempt, kind, unresolved_deviations, decided_at
        FROM chapter_exhaustions
        WHERE novel_id = ${novelId}
        ORDER BY fired_at DESC
        LIMIT 500
      `
  return rows.map((row: any) => ({
    id: row.id,
    chapterNumber: row.chapter,
    attempt: row.attempt,
    kind: row.kind,
    decidedAt: row.decided_at ? dateString(row.decided_at) : null,
    unresolvedDeviations: parseJsonbArray(row.unresolved_deviations),
  }))
}

async function loadEditorialProposalRows(novelId: string): Promise<ChapterHealthProposalInput[]> {
  const rows = await db`
    SELECT id, kind, target_kind, target_ref, status, risk, summary,
           precondition_hash, created_at, resolved_at, payload
    FROM proposal_envelopes
    WHERE novel_id = ${novelId}
      AND kind IN ('editorial_flag', 'prose_edit')
    ORDER BY created_at DESC
    LIMIT 500
  `
  return rows.map((row: any) => ({
    id: row.id,
    kind: row.kind,
    targetKind: row.target_kind,
    targetRef: row.target_ref,
    status: row.status,
    risk: row.risk,
    summary: row.summary,
    preconditionHash: row.precondition_hash,
    createdAt: dateString(row.created_at),
    resolvedAt: row.resolved_at ? dateString(row.resolved_at) : null,
    payload: row.payload,
  }))
}

async function loadHealthTraceEvents(
  novelId: string,
  chapter?: number,
): Promise<ChapterHealthTraceEventInput[]> {
  const rows = chapter !== undefined
    ? await db`
        SELECT id, chapter, beat_index, event_type, agent, llm_call_id,
               duration_ms, payload, timestamp
        FROM pipeline_events
        WHERE novel_id = ${novelId}
          AND chapter = ${chapter}
        ORDER BY timestamp DESC, id DESC
        LIMIT 200
      `
    : await db`
        SELECT id, chapter, beat_index, event_type, agent, llm_call_id,
               duration_ms, payload, timestamp
        FROM pipeline_events
        WHERE novel_id = ${novelId}
          AND chapter IS NOT NULL
        ORDER BY timestamp DESC, id DESC
        LIMIT 500
      `
  return rows
    .filter((row: any) => HEALTH_EVENT_TYPES.has(row.event_type))
    .map((row: any) => ({
      id: row.id,
      chapterNumber: row.chapter,
      beatIndex: row.beat_index,
      eventType: row.event_type,
      agent: row.agent,
      llmCallId: row.llm_call_id,
      durationMs: row.duration_ms,
      timestamp: dateString(row.timestamp),
      payload: row.payload,
    }))
}

async function loadCheckerCalls(
  novelId: string,
  chapter?: number,
): Promise<ChapterHealthCheckerCallInput[]> {
  const rows = chapter !== undefined
    ? await db`
        SELECT id, agent, chapter, beat_index, beat_id, attempt, failed,
               zod_validation_success, json_extraction_success,
               ner_prepass_json, timestamp
        FROM llm_calls
        WHERE novel_id = ${novelId}
          AND chapter = ${chapter}
        ORDER BY timestamp DESC, id DESC
        LIMIT 200
      `
    : await db`
        SELECT id, agent, chapter, beat_index, beat_id, attempt, failed,
               zod_validation_success, json_extraction_success,
               ner_prepass_json, timestamp
        FROM llm_calls
        WHERE novel_id = ${novelId}
          AND chapter IS NOT NULL
        ORDER BY timestamp DESC, id DESC
        LIMIT 500
      `
  return rows
    .filter((row: any) => CHECKER_AGENTS.has(row.agent))
    .map((row: any) => ({
      id: row.id,
      chapterNumber: row.chapter,
      agent: row.agent,
      beatIndex: row.beat_index,
      beatId: row.beat_id,
      attempt: row.attempt,
      failed: row.failed === true,
      zodValidationSuccess: row.zod_validation_success !== false,
      jsonExtractionSuccess: row.json_extraction_success !== false,
      timestamp: dateString(row.timestamp),
      nerPrepass: row.ner_prepass_json,
    }))
}

async function loadCheckerObservations(
  novelId: string,
  chapter?: number,
): Promise<ChapterHealthCheckerObservationInput[]> {
  const rows = chapter !== undefined
    ? await db`
        SELECT id, proposal_id, proposal_kind, target_kind, target_ref,
               chapter_number, result_hash, checker_name, fired, observed_at, details
        FROM proposal_checker_observations
        WHERE novel_id = ${novelId}
          AND chapter_number = ${chapter}
        ORDER BY observed_at DESC, id ASC
        LIMIT 200
      `
    : await db`
        SELECT id, proposal_id, proposal_kind, target_kind, target_ref,
               chapter_number, result_hash, checker_name, fired, observed_at, details
        FROM proposal_checker_observations
        WHERE novel_id = ${novelId}
        ORDER BY observed_at DESC, id ASC
        LIMIT 500
      `
  return rows.map((row: any) => ({
    id: row.id,
    proposalId: row.proposal_id,
    proposalKind: row.proposal_kind,
    targetKind: row.target_kind,
    targetRef: row.target_ref,
    chapterNumber: row.chapter_number,
    resultHash: row.result_hash,
    checkerName: row.checker_name,
    fired: row.fired === true,
    observedAt: dateString(row.observed_at),
    details: row.details,
  }))
}

function dateString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value
}
