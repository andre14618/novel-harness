#!/usr/bin/env bun
/**
 * Read-only candidate chooser for semantic-gate investigation.
 *
 * `diagnostics:semantic-gate` explains one novel. This report ranks novels
 * that are worth inspecting next, so long-running harness work can choose the
 * next evidence target without ad hoc SQL or creative-runtime changes.
 */

import {
  buildSemanticGateReport,
  type SemanticGateReport,
  type SemanticGateSignal,
  type SemanticPlanAssistGateRow,
} from "./semantic-gate-report"
import {
  buildCheckerWarningReport,
  type ContinuityCallRow,
  type FunctionalEventRow,
} from "./checker-warning-report"
import {
  buildPlanAssistLineageReport,
  type PlanAssistLineageRow,
} from "./plan-assist-lineage-report"
import {
  buildPlanDriftReport,
  type PlanCheckCallRow,
} from "./plan-drift-report"
import {
  buildWriterExpansionReport,
  type WriterExpansionDraftRow,
  type WriterExpansionOutlineRow,
} from "./writer-expansion-report"

export type SemanticGateCandidatePriority = "critical" | "high" | "medium" | "low"
export type SemanticGateCandidateLens =
  | "plan_shape"
  | "writer_expansion"
  | "checker_gate"
  | "plan_drift"
  | "missing_draft"
  | "mixed"

export interface SemanticGateCandidateNovelRow {
  id: string
  phase: string | null
  current_chapter: number | null
  total_chapters: number | null
  created_at?: string | Date | null
  updated_at?: string | Date | null
}

export interface SemanticGateCandidate {
  novelId: string
  phase: string | null
  currentChapter: number | null
  totalChapters: number | null
  score: number
  priority: SemanticGateCandidatePriority
  primaryLens: SemanticGateCandidateLens
  reasons: string[]
  diagnosticsCommand: string
  sourceDiagnosticsCommands: string[]
  signalCounts: Record<SemanticGateSignal, number>
  chapters: {
    total: number
    drafted: number
    withSignals: number
  }
  evidence: {
    pendingPlanAssistGates: number
    checkerBlockers: number
    effectiveCheckerBlockers: number
    positivePolarityBlockers: number
    ambiguousPolarityBlockers: number
    unresolvedPlanDriftChapters: number
    recoveredPlanDriftChapters: number
    writerExpansionChapters: number
    outlineShapeChapters: number
    noDraftChapters: number
  }
}

export interface SemanticGateCandidateReport {
  candidates: SemanticGateCandidate[]
  totals: {
    scannedNovels: number
    returnedCandidates: number
    byPriority: Record<SemanticGateCandidatePriority, number>
  }
}

interface Args {
  json: boolean
  includeArchived: boolean
  limit: number
  scanLimit: number
}

interface CandidateReportInput {
  novels: readonly SemanticGateCandidateNovelRow[]
  reports: readonly SemanticGateReport[]
  limit?: number
}

interface NovelScopedRow {
  novel_id: string
}

interface CandidateOutlineRow extends NovelScopedRow, WriterExpansionOutlineRow {}
interface CandidateDraftRow extends NovelScopedRow, WriterExpansionDraftRow {}
interface CandidatePlanCheckRow extends NovelScopedRow, PlanCheckCallRow {}
interface CandidateFunctionalEventRow extends NovelScopedRow, FunctionalEventRow {}
interface CandidateContinuityCallRow extends NovelScopedRow, ContinuityCallRow {}
interface CandidateLineageRow extends NovelScopedRow, PlanAssistLineageRow {}
interface CandidatePlanAssistGateRow extends NovelScopedRow, SemanticPlanAssistGateRow {}

const DEFAULT_LIMIT = 10
const DEFAULT_SCAN_LIMIT = 50

const SIGNAL_WEIGHTS: Record<SemanticGateSignal, number> = {
  no_draft: 0.5,
  outline_shape: 1.5,
  writer_expansion: 3,
  plan_adherence_drift: 4,
  checker_blocker: 5,
  plan_assist_gate: 5,
}

export function buildSemanticGateCandidateReport(input: CandidateReportInput): SemanticGateCandidateReport {
  const reportByNovel = new Map(input.reports.flatMap(report =>
    report.novelId ? [[report.novelId, report] as const] : [],
  ))
  const candidates = input.novels
    .map(novel => candidateForNovel(novel, reportByNovel.get(novel.id)))
    .filter((candidate): candidate is SemanticGateCandidate => candidate !== null)
    .sort((a, b) =>
      b.score - a.score ||
      priorityOrder(a.priority) - priorityOrder(b.priority) ||
      a.novelId.localeCompare(b.novelId)
    )
  const limited = candidates.slice(0, input.limit ?? DEFAULT_LIMIT)
  const byPriority: Record<SemanticGateCandidatePriority, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  }
  for (const candidate of limited) byPriority[candidate.priority]++

  return {
    candidates: limited,
    totals: {
      scannedNovels: input.novels.length,
      returnedCandidates: limited.length,
      byPriority,
    },
  }
}

export function renderSemanticGateCandidateReport(report: SemanticGateCandidateReport): string {
  const lines: string[] = []
  lines.push("Semantic gate candidate report")
  lines.push(
    `Candidates: ${report.totals.returnedCandidates}/${report.totals.scannedNovels}; ` +
      `priority ${formatPriorityCounts(report.totals.byPriority)}`,
  )
  if (report.candidates.length === 0) {
    lines.push("No candidate novels found with semantic-gate evidence.")
    return lines.join("\n")
  }

  report.candidates.forEach((candidate, index) => {
    lines.push("")
    lines.push(
      `${index + 1}. ${candidate.novelId}: ${candidate.priority}, score=${formatScore(candidate.score)}, ` +
        `lens=${candidate.primaryLens}, phase=${candidate.phase ?? "?"}, ` +
        `chapter=${candidate.currentChapter ?? "?"}/${candidate.totalChapters ?? "?"}`,
    )
    lines.push(`   signals: ${formatSignals(candidate.signalCounts)}`)
    lines.push(
      `   evidence: pendingGates=${candidate.evidence.pendingPlanAssistGates}, ` +
        `blockers=${candidate.evidence.checkerBlockers}, effectiveBlockers=${candidate.evidence.effectiveCheckerBlockers}, ` +
        `unresolvedDrift=${candidate.evidence.unresolvedPlanDriftChapters}, ` +
        `recoveredDrift=${candidate.evidence.recoveredPlanDriftChapters}, ` +
        `positiveBlockers=${candidate.evidence.positivePolarityBlockers}, drafted=${candidate.chapters.drafted}/${candidate.chapters.total}`,
    )
    if (candidate.reasons.length > 0) {
      lines.push(`   reasons: ${candidate.reasons.join("; ")}`)
    }
    lines.push(`   next: ${candidate.diagnosticsCommand}`)
    lines.push(`   sources: ${candidate.sourceDiagnosticsCommands.join("; ")}`)
  })

  return lines.join("\n")
}

function candidateForNovel(
  novel: SemanticGateCandidateNovelRow,
  report: SemanticGateReport | undefined,
): SemanticGateCandidate | null {
  if (!report || report.chapters.length === 0) return null
  const signalCounts = report.totals.bySignal
  const checkerBlockers = sum(report.chapters, chapter => chapter.checker.blockers)
  const positivePolarityBlockers = sum(report.chapters, chapter => chapter.checker.positivePolarityBlockers)
  const evidence = {
    pendingPlanAssistGates: sum(report.chapters, chapter => chapter.planAssist.pendingGates),
    checkerBlockers,
    effectiveCheckerBlockers: Math.max(0, checkerBlockers - positivePolarityBlockers),
    positivePolarityBlockers,
    ambiguousPolarityBlockers: sum(report.chapters, chapter => chapter.checker.ambiguousPolarityBlockers),
    unresolvedPlanDriftChapters: report.chapters.filter(chapter => chapter.planDrift.unresolved).length,
    recoveredPlanDriftChapters: report.chapters.filter(chapter => chapter.planDrift.recovered).length,
    writerExpansionChapters: signalCounts.writer_expansion,
    outlineShapeChapters: signalCounts.outline_shape,
    noDraftChapters: signalCounts.no_draft,
  }
  const chapters = {
    total: report.chapters.length,
    drafted: report.chapters.filter(chapter => chapter.draftWords !== null).length,
    withSignals: report.chapters.filter(chapter => chapter.signals.length > 0).length,
  }
  const score = scoreCandidate(signalCounts, evidence)
  if (score <= 0) return null
  const primaryLens = primaryLensForCandidate(evidence)

  return {
    novelId: novel.id,
    phase: novel.phase,
    currentChapter: novel.current_chapter,
    totalChapters: novel.total_chapters,
    score,
    priority: priorityForScore(score),
    primaryLens,
    reasons: candidateReasons(evidence),
    diagnosticsCommand: `bun run diagnostics:semantic-gate -- --novel ${novel.id}`,
    sourceDiagnosticsCommands: sourceDiagnosticsCommands(novel.id, primaryLens),
    signalCounts,
    chapters,
    evidence,
  }
}

function scoreCandidate(
  signalCounts: Record<SemanticGateSignal, number>,
  evidence: SemanticGateCandidate["evidence"],
): number {
  let score = 0
  for (const [signal, count] of Object.entries(signalCounts) as Array<[SemanticGateSignal, number]>) {
    const cappedCount = signal === "no_draft" ? Math.min(count, 2) : count
    score += cappedCount * SIGNAL_WEIGHTS[signal]
  }
  score += evidence.pendingPlanAssistGates * 3
  score += evidence.effectiveCheckerBlockers * 2
  score += evidence.unresolvedPlanDriftChapters * 2
  return score
}

function priorityForScore(score: number): SemanticGateCandidatePriority {
  if (score >= 18) return "critical"
  if (score >= 10) return "high"
  if (score >= 3) return "medium"
  return "low"
}

function candidateReasons(evidence: SemanticGateCandidate["evidence"]): string[] {
  const reasons: string[] = []
  if (evidence.pendingPlanAssistGates > 0) reasons.push(`${evidence.pendingPlanAssistGates} pending plan-assist gate(s)`)
  if (evidence.checkerBlockers > 0) reasons.push(`${evidence.checkerBlockers} checker blocker(s)`)
  if (evidence.effectiveCheckerBlockers !== evidence.checkerBlockers) {
    reasons.push(`${evidence.effectiveCheckerBlockers} effective checker blocker(s) after support-echo discount`)
  }
  if (evidence.positivePolarityBlockers > 0) reasons.push(`${evidence.positivePolarityBlockers} support-echo checker blocker candidate(s)`)
  if (evidence.ambiguousPolarityBlockers > 0) reasons.push(`${evidence.ambiguousPolarityBlockers} ambiguous-polarity checker blocker(s)`)
  if (evidence.unresolvedPlanDriftChapters > 0) reasons.push(`${evidence.unresolvedPlanDriftChapters} unresolved plan-drift chapter(s)`)
  if (evidence.recoveredPlanDriftChapters > 0) reasons.push(`${evidence.recoveredPlanDriftChapters} recovered drift chapter(s)`)
  if (evidence.writerExpansionChapters > 0) reasons.push(`${evidence.writerExpansionChapters} writer-expansion chapter(s)`)
  if (evidence.outlineShapeChapters > 0) reasons.push(`${evidence.outlineShapeChapters} outline-shape chapter(s)`)
  if (evidence.noDraftChapters > 0) reasons.push(`${evidence.noDraftChapters} no-draft chapter(s)`)
  return reasons
}

function primaryLensForCandidate(evidence: SemanticGateCandidate["evidence"]): SemanticGateCandidateLens {
  const scores: Record<Exclude<SemanticGateCandidateLens, "mixed">, number> = {
    plan_shape: evidence.outlineShapeChapters * 2 + (evidence.outlineShapeChapters > 0 ? evidence.noDraftChapters : 0),
    writer_expansion: evidence.writerExpansionChapters * 3,
    checker_gate: evidence.pendingPlanAssistGates * 2 + evidence.effectiveCheckerBlockers,
    plan_drift: evidence.unresolvedPlanDriftChapters * 4 + evidence.recoveredPlanDriftChapters * 2,
    missing_draft: evidence.noDraftChapters,
  }
  const ranked = Object.entries(scores)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) as Array<[Exclude<SemanticGateCandidateLens, "mixed">, number]>
  const [top, topScore] = ranked[0]!
  const secondScore = ranked[1]?.[1] ?? 0
  if (topScore <= 0) return "mixed"
  return topScore === secondScore ? "mixed" : top
}

function sourceDiagnosticsCommands(novelId: string, primaryLens: SemanticGateCandidateLens): string[] {
  const commands = [
    `bun run diagnostics:writer-expansion -- --novel ${novelId}`,
    `bun run diagnostics:plan-drift -- --novel ${novelId}`,
    `bun run diagnostics:checker-warnings -- --novel ${novelId}`,
  ]
  if (primaryLens === "plan_shape" || primaryLens === "writer_expansion" || primaryLens === "missing_draft") {
    return commands
  }
  if (primaryLens === "checker_gate") return [commands[2]!, commands[0]!, commands[1]!]
  if (primaryLens === "plan_drift") return [commands[1]!, commands[0]!, commands[2]!]
  return commands
}

function priorityOrder(priority: SemanticGateCandidatePriority): number {
  return priority === "critical" ? 0 : priority === "high" ? 1 : priority === "medium" ? 2 : 3
}

function formatPriorityCounts(counts: Record<SemanticGateCandidatePriority, number>): string {
  return (["critical", "high", "medium", "low"] as const)
    .map(priority => `${priority}=${counts[priority]}`)
    .join(", ")
}

function formatSignals(counts: Record<SemanticGateSignal, number>): string {
  return Object.entries(counts)
    .map(([signal, count]) => `${signal}=${count}`)
    .join(", ")
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}

function sum<T>(values: readonly T[], fn: (value: T) => number): number {
  return values.reduce((total, value) => total + fn(value), 0)
}

function groupByNovel<T extends NovelScopedRow>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const list = grouped.get(row.novel_id) ?? []
    list.push(row)
    grouped.set(row.novel_id, list)
  }
  return grouped
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    json: false,
    includeArchived: false,
    limit: DEFAULT_LIMIT,
    scanLimit: DEFAULT_SCAN_LIMIT,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--json") {
      args.json = true
    } else if (arg === "--include-archived") {
      args.includeArchived = true
    } else if (arg === "--limit") {
      args.limit = parsePositiveInt(argv[++i], "--limit")
    } else if (arg === "--scan-limit") {
      args.scanLimit = parsePositiveInt(argv[++i], "--scan-limit")
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }
  return args
}

function parsePositiveInt(value: string | undefined, name: string): number {
  if (!value) throw new Error(`${name} requires a value`)
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

async function loadCandidateReports(args: Args): Promise<SemanticGateCandidateReport> {
  const { default: db } = await import("../../src/db/connection")
  try {
    const novels = await db`
      SELECT n.id, n.phase, n.current_chapter, n.total_chapters, n.created_at, n.updated_at
      FROM novels n
      WHERE (${args.includeArchived} OR n.phase != 'archived')
        AND (
          EXISTS (SELECT 1 FROM chapter_outlines co WHERE co.novel_id = n.id)
          OR EXISTS (SELECT 1 FROM chapter_drafts cd WHERE cd.novel_id = n.id)
          OR EXISTS (SELECT 1 FROM chapter_exhaustions ce WHERE ce.novel_id = n.id)
          OR EXISTS (SELECT 1 FROM llm_calls lc WHERE lc.novel_id = n.id AND lc.agent IN ('chapter-plan-checker', 'continuity-facts', 'continuity-state'))
          OR EXISTS (SELECT 1 FROM pipeline_events pe WHERE pe.novel_id = n.id AND pe.event_type = 'functional-check')
        )
      ORDER BY n.updated_at DESC, n.created_at DESC
      LIMIT ${args.scanLimit}
    ` as SemanticGateCandidateNovelRow[]

    const outlines = await db`
      WITH candidate_novels AS (
        SELECT n.id
        FROM novels n
        WHERE (${args.includeArchived} OR n.phase != 'archived')
          AND (
            EXISTS (SELECT 1 FROM chapter_outlines co WHERE co.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM chapter_drafts cd WHERE cd.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM chapter_exhaustions ce WHERE ce.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM llm_calls lc WHERE lc.novel_id = n.id AND lc.agent IN ('chapter-plan-checker', 'continuity-facts', 'continuity-state'))
            OR EXISTS (SELECT 1 FROM pipeline_events pe WHERE pe.novel_id = n.id AND pe.event_type = 'functional-check')
          )
        ORDER BY n.updated_at DESC, n.created_at DESC
        LIMIT ${args.scanLimit}
      )
      SELECT co.novel_id, co.chapter_number, co.outline_json
      FROM chapter_outlines co
      JOIN candidate_novels c ON c.id = co.novel_id
      ORDER BY co.novel_id, co.chapter_number
    ` as CandidateOutlineRow[]

    const drafts = await db`
      WITH candidate_novels AS (
        SELECT n.id
        FROM novels n
        WHERE (${args.includeArchived} OR n.phase != 'archived')
          AND (
            EXISTS (SELECT 1 FROM chapter_outlines co WHERE co.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM chapter_drafts cd WHERE cd.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM chapter_exhaustions ce WHERE ce.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM llm_calls lc WHERE lc.novel_id = n.id AND lc.agent IN ('chapter-plan-checker', 'continuity-facts', 'continuity-state'))
            OR EXISTS (SELECT 1 FROM pipeline_events pe WHERE pe.novel_id = n.id AND pe.event_type = 'functional-check')
          )
        ORDER BY n.updated_at DESC, n.created_at DESC
        LIMIT ${args.scanLimit}
      )
      SELECT DISTINCT ON (cd.novel_id, cd.chapter_number)
        cd.novel_id, cd.chapter_number, cd.version, cd.status, cd.word_count
      FROM chapter_drafts cd
      JOIN candidate_novels c ON c.id = cd.novel_id
      ORDER BY cd.novel_id, cd.chapter_number, cd.version DESC
    ` as CandidateDraftRow[]

    const planChecks = await db`
      WITH candidate_novels AS (
        SELECT n.id
        FROM novels n
        WHERE (${args.includeArchived} OR n.phase != 'archived')
          AND (
            EXISTS (SELECT 1 FROM chapter_outlines co WHERE co.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM chapter_drafts cd WHERE cd.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM chapter_exhaustions ce WHERE ce.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM llm_calls lc WHERE lc.novel_id = n.id AND lc.agent IN ('chapter-plan-checker', 'continuity-facts', 'continuity-state'))
            OR EXISTS (SELECT 1 FROM pipeline_events pe WHERE pe.novel_id = n.id AND pe.event_type = 'functional-check')
          )
        ORDER BY n.updated_at DESC, n.created_at DESC
        LIMIT ${args.scanLimit}
      )
      SELECT lc.id, lc.novel_id, lc.chapter, lc.attempt, lc.response_content, lc.timestamp
      FROM llm_calls lc
      JOIN candidate_novels c ON c.id = lc.novel_id
      WHERE lc.agent = 'chapter-plan-checker'
      ORDER BY lc.novel_id, lc.chapter, lc.attempt NULLS LAST, lc.id
    ` as CandidatePlanCheckRow[]

    const functionalEvents = await db`
      WITH candidate_novels AS (
        SELECT n.id
        FROM novels n
        WHERE (${args.includeArchived} OR n.phase != 'archived')
          AND (
            EXISTS (SELECT 1 FROM chapter_outlines co WHERE co.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM chapter_drafts cd WHERE cd.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM chapter_exhaustions ce WHERE ce.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM llm_calls lc WHERE lc.novel_id = n.id AND lc.agent IN ('chapter-plan-checker', 'continuity-facts', 'continuity-state'))
            OR EXISTS (SELECT 1 FROM pipeline_events pe WHERE pe.novel_id = n.id AND pe.event_type = 'functional-check')
          )
        ORDER BY n.updated_at DESC, n.created_at DESC
        LIMIT ${args.scanLimit}
      )
      SELECT pe.id, pe.novel_id, pe.chapter, pe.payload, pe.timestamp
      FROM pipeline_events pe
      JOIN candidate_novels c ON c.id = pe.novel_id
      WHERE pe.event_type = 'functional-check'
      ORDER BY pe.novel_id, pe.chapter, pe.id
    ` as CandidateFunctionalEventRow[]

    const continuityRows = await db`
      WITH candidate_novels AS (
        SELECT n.id
        FROM novels n
        WHERE (${args.includeArchived} OR n.phase != 'archived')
          AND (
            EXISTS (SELECT 1 FROM chapter_outlines co WHERE co.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM chapter_drafts cd WHERE cd.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM chapter_exhaustions ce WHERE ce.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM llm_calls lc WHERE lc.novel_id = n.id AND lc.agent IN ('chapter-plan-checker', 'continuity-facts', 'continuity-state'))
            OR EXISTS (SELECT 1 FROM pipeline_events pe WHERE pe.novel_id = n.id AND pe.event_type = 'functional-check')
          )
        ORDER BY n.updated_at DESC, n.created_at DESC
        LIMIT ${args.scanLimit}
      )
      SELECT lc.id, lc.novel_id, lc.agent, lc.chapter, lc.attempt, lc.response_content, lc.timestamp
      FROM llm_calls lc
      JOIN candidate_novels c ON c.id = lc.novel_id
      WHERE lc.agent IN ('continuity-facts', 'continuity-state')
      ORDER BY lc.novel_id, lc.chapter, lc.attempt NULLS LAST, lc.agent, lc.id
    ` as CandidateContinuityCallRow[]

    const lineageRows = await db`
      WITH candidate_novels AS (
        SELECT n.id
        FROM novels n
        WHERE (${args.includeArchived} OR n.phase != 'archived')
          AND (
            EXISTS (SELECT 1 FROM chapter_outlines co WHERE co.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM chapter_drafts cd WHERE cd.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM chapter_exhaustions ce WHERE ce.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM llm_calls lc WHERE lc.novel_id = n.id AND lc.agent IN ('chapter-plan-checker', 'continuity-facts', 'continuity-state'))
            OR EXISTS (SELECT 1 FROM pipeline_events pe WHERE pe.novel_id = n.id AND pe.event_type = 'functional-check')
          )
        ORDER BY n.updated_at DESC, n.created_at DESC
        LIMIT ${args.scanLimit}
      )
      SELECT pml.id, pml.novel_id, pml.source_table, pml.field_path, pml.source, pml.actor_kind,
             pml.actor_ref, pml.previous_ref, pml.next_ref, pml.previous_version, pml.next_version,
             pml.changed_at, pml.reason, pml.metadata
      FROM planning_mutation_lineage pml
      JOIN candidate_novels c ON c.id = pml.novel_id
      WHERE pml.source_table IN ('chapter_exhaustions', 'chapter_revisions')
      ORDER BY pml.novel_id, pml.changed_at ASC, pml.id ASC
    ` as CandidateLineageRow[]

    const gateRows = await db`
      WITH candidate_novels AS (
        SELECT n.id
        FROM novels n
        WHERE (${args.includeArchived} OR n.phase != 'archived')
          AND (
            EXISTS (SELECT 1 FROM chapter_outlines co WHERE co.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM chapter_drafts cd WHERE cd.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM chapter_exhaustions ce WHERE ce.novel_id = n.id)
            OR EXISTS (SELECT 1 FROM llm_calls lc WHERE lc.novel_id = n.id AND lc.agent IN ('chapter-plan-checker', 'continuity-facts', 'continuity-state'))
            OR EXISTS (SELECT 1 FROM pipeline_events pe WHERE pe.novel_id = n.id AND pe.event_type = 'functional-check')
          )
        ORDER BY n.updated_at DESC, n.created_at DESC
        LIMIT ${args.scanLimit}
      )
      SELECT ce.novel_id, ce.chapter, ce.attempt, ce.kind,
             ce.decided_at IS NULL AS pending, ce.unresolved_deviations
      FROM chapter_exhaustions ce
      JOIN candidate_novels c ON c.id = ce.novel_id
      ORDER BY ce.novel_id, ce.fired_at DESC, ce.id DESC
    ` as Array<CandidatePlanAssistGateRow & { unresolved_deviations: unknown }>

    const outlinesByNovel = groupByNovel(outlines)
    const draftsByNovel = groupByNovel(drafts)
    const planChecksByNovel = groupByNovel(planChecks)
    const functionalByNovel = groupByNovel(functionalEvents)
    const continuityByNovel = groupByNovel(continuityRows)
    const lineageByNovel = groupByNovel(lineageRows)
    const gatesByNovel = groupByNovel(gateRows)
    const reports = novels.map(novel => buildSemanticGateReport({
      writerExpansion: buildWriterExpansionReport(outlinesByNovel.get(novel.id) ?? [], draftsByNovel.get(novel.id) ?? [], novel.id),
      planDrift: buildPlanDriftReport(planChecksByNovel.get(novel.id) ?? [], novel.id),
      checkerWarnings: buildCheckerWarningReport({
        functionalEvents: functionalByNovel.get(novel.id) ?? [],
        continuityRows: continuityByNovel.get(novel.id) ?? [],
      }, novel.id),
      planAssistLineage: buildPlanAssistLineageReport(lineageByNovel.get(novel.id) ?? [], novel.id),
      planAssistGates: (gatesByNovel.get(novel.id) ?? []).map(row => ({
        chapter: row.chapter,
        attempt: row.attempt,
        kind: row.kind,
        pending: Boolean(row.pending),
        unresolvedCount: Array.isArray(row.unresolved_deviations) ? row.unresolved_deviations.length : 0,
      })),
    }, novel.id))

    return buildSemanticGateCandidateReport({ novels, reports, limit: args.limit })
  } finally {
    await db.end().catch(() => {})
  }
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/semantic-gate-candidates.ts [--limit N] [--scan-limit N] [--include-archived] [--json]")
    return 2
  }

  const report = await loadCandidateReports(args)
  console.log(args.json ? JSON.stringify(report, null, 2) : renderSemanticGateCandidateReport(report))
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
