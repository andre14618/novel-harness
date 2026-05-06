#!/usr/bin/env bun
/**
 * Read-only roll-up for Drafting semantic gate diagnosis.
 *
 * This intentionally composes existing diagnostics instead of changing planner,
 * writer, or checker behavior. Use it to distinguish Chapter Plan shape,
 * writer expansion, Plan Adherence drift, Continuity/checker blockers, and
 * Plan-Assist Gate lineage before proposing a runtime lever.
 */

import {
  buildCheckerWarningReport,
  type CheckerWarningReport,
  type ContinuityCallRow,
  type FunctionalEventRow,
} from "./checker-warning-report"
import {
  buildPlanAssistLineageReport,
  type PlanAssistLineageReport,
  type PlanAssistLineageRow,
} from "./plan-assist-lineage-report"
import {
  buildPlanDriftReport,
  type PlanCheckCallRow,
  type PlanDriftReport,
} from "./plan-drift-report"
import {
  buildWriterExpansionReport,
  type WriterExpansionDraftRow,
  type WriterExpansionOutlineRow,
  type WriterExpansionReport,
} from "./writer-expansion-report"
import { parseJsonbArray } from "../../src/db/jsonb"

export type SemanticGateSignal =
  | "no_draft"
  | "outline_shape"
  | "writer_expansion"
  | "plan_adherence_drift"
  | "checker_blocker"
  | "plan_assist_gate"

export interface SemanticGateChapter {
  chapter: number | null
  signals: SemanticGateSignal[]
  targetWords: number | null
  plannedBeats: number
  draftWords: number | null
  wordRatio: number | null
  wordsPerBeat: number | null
  expansionFlags: string[]
  planDrift: {
    totalCalls: number
    finalPass: boolean | null
    recovered: boolean
    unresolved: boolean
    deviationCount: number
    driftedBeatRefs: string[]
  }
  checker: {
    totalItems: number
    blockers: number
    warnings: number
    positivePolarityBlockers: number
    ambiguousPolarityBlockers: number
    sources: string[]
  }
  planAssist: {
    totalEvents: number
    gateCount: number
    pendingGates: number
    planAssistEdits: number
    planAssistOverrides: number
    reviserAccepted: number
  }
}

export interface SemanticGateReport {
  novelId: string | null
  chapters: SemanticGateChapter[]
  totals: {
    chapters: number
    bySignal: Record<SemanticGateSignal, number>
  }
}

interface Args {
  novelId: string | null
  json: boolean
}

interface SemanticGateInputs {
  writerExpansion: WriterExpansionReport
  planDrift: PlanDriftReport
  checkerWarnings: CheckerWarningReport
  planAssistLineage: PlanAssistLineageReport
  planAssistGates?: readonly SemanticPlanAssistGateRow[]
}

export interface SemanticPlanAssistGateRow {
  chapter: number | null
  attempt: number | null
  kind: string
  pending: boolean
  unresolvedCount: number
}

export function buildSemanticGateReport(input: SemanticGateInputs, novelId: string | null = null): SemanticGateReport {
  const chapterKeys = new Set<string>()
  for (const chapter of input.writerExpansion.chapters) chapterKeys.add(chapterKey(chapter.chapter))
  for (const chapter of input.planDrift.chapters) chapterKeys.add(chapterKey(chapter.chapter))
  for (const chapter of input.checkerWarnings.chapters) chapterKeys.add(chapterKey(chapter.chapter))
  for (const chapter of input.planAssistLineage.chapters) chapterKeys.add(chapterKey(chapter.chapter))
  for (const gate of input.planAssistGates ?? []) chapterKeys.add(chapterKey(gate.chapter))

  const expansionByChapter = new Map(input.writerExpansion.chapters.map(chapter => [chapterKey(chapter.chapter), chapter]))
  const driftByChapter = new Map(input.planDrift.chapters.map(chapter => [chapterKey(chapter.chapter), chapter]))
  const checkerByChapter = new Map(input.checkerWarnings.chapters.map(chapter => [chapterKey(chapter.chapter), chapter]))
  const assistByChapter = new Map(input.planAssistLineage.chapters.map(chapter => [chapterKey(chapter.chapter), chapter]))
  const gatesByChapter = groupGatesByChapter(input.planAssistGates ?? [])

  const chapters = [...chapterKeys]
    .map((key): SemanticGateChapter => {
      const expansion = expansionByChapter.get(key)
      const drift = driftByChapter.get(key)
      const checker = checkerByChapter.get(key)
      const assist = assistByChapter.get(key)
      const gates = gatesByChapter.get(key) ?? []
      const chapter = parseChapterKey(key)
      const checkerItems = checker?.items ?? []
      const blockers = checkerItems.filter(item => item.severity === "blocker").length
      const warnings = checkerItems.filter(item => item.severity === "warning").length
      const positivePolarityBlockers = checkerItems.filter(item => item.severity === "blocker" && item.polarity === "positive").length
      const ambiguousPolarityBlockers = checkerItems.filter(item => item.severity === "blocker" && item.polarity === "ambiguous").length
      const expansionFlags = expansion?.flags ?? []
      const signals = semanticGateSignals({
        expansionFlags,
        unresolvedPlanDrift: drift?.unresolved ?? false,
        recoveredPlanDrift: drift?.recovered ?? false,
        checkerBlockers: blockers,
        planAssistEvents: (assist?.totalEvents ?? 0) + gates.length,
      })

      return {
        chapter,
        signals,
        targetWords: expansion?.targetWords ?? null,
        plannedBeats: expansion?.plannedBeats ?? 0,
        draftWords: expansion?.draft?.wordCount ?? null,
        wordRatio: expansion?.wordRatio ?? null,
        wordsPerBeat: expansion?.wordsPerBeat ?? null,
        expansionFlags,
        planDrift: {
          totalCalls: drift?.totalCalls ?? 0,
          finalPass: drift?.finalPass ?? null,
          recovered: drift?.recovered ?? false,
          unresolved: drift?.unresolved ?? false,
          deviationCount: drift?.deviationCount ?? 0,
          driftedBeatRefs: drift?.driftedBeatRefs ?? [],
        },
        checker: {
          totalItems: checkerItems.length,
          blockers,
          warnings,
          positivePolarityBlockers,
          ambiguousPolarityBlockers,
          sources: uniqueSorted(checkerItems.map(item => item.source)),
        },
        planAssist: {
          totalEvents: assist?.totalEvents ?? 0,
          gateCount: gates.length,
          pendingGates: gates.filter(gate => gate.pending).length,
          planAssistEdits: assist?.planAssistEdits ?? 0,
          planAssistOverrides: assist?.planAssistOverrides ?? 0,
          reviserAccepted: assist?.reviserAccepted ?? 0,
        },
      }
    })
    .sort((a, b) => compareNullableNumber(a.chapter, b.chapter))

  const bySignal = emptySignalCounts()
  for (const chapter of chapters) {
    for (const signal of chapter.signals) bySignal[signal]++
  }

  return {
    novelId,
    chapters,
    totals: {
      chapters: chapters.length,
      bySignal,
    },
  }
}

export function renderSemanticGateReport(report: SemanticGateReport): string {
  const lines: string[] = []
  lines.push(`Semantic gate report${report.novelId ? ` for ${report.novelId}` : ""}`)
  lines.push(`Chapters: ${report.totals.chapters}; signals ${formatSignals(report.totals.bySignal)}`)
  if (report.chapters.length === 0) {
    lines.push("No outline, checker, drift, or plan-assist data found.")
    return lines.join("\n")
  }

  for (const chapter of report.chapters) {
    const label = chapter.chapter === null ? "chapter ?" : `chapter ${chapter.chapter}`
    const signals = chapter.signals.length > 0 ? chapter.signals.join(",") : "none"
    lines.push("")
    lines.push(
      `${label}: signals=${signals}; target=${chapter.targetWords ?? "?"}, ` +
        `beats=${chapter.plannedBeats}, draft=${chapter.draftWords ?? "none"}, ` +
        `ratio=${formatNullable(chapter.wordRatio, 2)}, wordsPerBeat=${formatNullable(chapter.wordsPerBeat, 0)}`,
    )
    if (chapter.expansionFlags.length > 0) {
      lines.push(`  - expansion: ${chapter.expansionFlags.join(",")}`)
    }
    if (chapter.planDrift.totalCalls > 0) {
      const final = chapter.planDrift.finalPass === null ? "unknown" : chapter.planDrift.finalPass ? "pass" : "fail"
      const refs = chapter.planDrift.driftedBeatRefs.length > 0
        ? ` refs=${chapter.planDrift.driftedBeatRefs.join(",")}`
        : ""
      lines.push(
        `  - plan drift: final=${final}, calls=${chapter.planDrift.totalCalls}, ` +
          `deviations=${chapter.planDrift.deviationCount}${refs}`,
      )
    }
    if (chapter.checker.totalItems > 0) {
      lines.push(
        `  - checker: blockers=${chapter.checker.blockers}, warnings=${chapter.checker.warnings}, ` +
          `positivePolarityBlockers=${chapter.checker.positivePolarityBlockers}, ` +
          `ambiguousPolarityBlockers=${chapter.checker.ambiguousPolarityBlockers}, sources=${chapter.checker.sources.join(",")}`,
      )
    }
    if (chapter.planAssist.totalEvents > 0) {
      lines.push(
        `  - plan assist lineage: events=${chapter.planAssist.totalEvents}, edits=${chapter.planAssist.planAssistEdits}, ` +
          `overrides=${chapter.planAssist.planAssistOverrides}, reviser=${chapter.planAssist.reviserAccepted}`,
      )
    }
    if (chapter.planAssist.gateCount > 0) {
      lines.push(
        `  - plan assist gates: total=${chapter.planAssist.gateCount}, pending=${chapter.planAssist.pendingGates}`,
      )
    }
  }
  return lines.join("\n")
}

function semanticGateSignals(input: {
  expansionFlags: readonly string[]
  unresolvedPlanDrift: boolean
  recoveredPlanDrift: boolean
  checkerBlockers: number
  planAssistEvents: number
}): SemanticGateSignal[] {
  const signals: SemanticGateSignal[] = []
  if (input.expansionFlags.includes("no_draft")) signals.push("no_draft")
  if (input.expansionFlags.includes("over_planned_beats")) signals.push("outline_shape")
  if (
    input.expansionFlags.includes("over_target") ||
    input.expansionFlags.includes("severe_over_target") ||
    input.expansionFlags.includes("high_words_per_beat")
  ) {
    signals.push("writer_expansion")
  }
  if (input.unresolvedPlanDrift || input.recoveredPlanDrift) signals.push("plan_adherence_drift")
  if (input.checkerBlockers > 0) signals.push("checker_blocker")
  if (input.planAssistEvents > 0) signals.push("plan_assist_gate")
  return signals
}

function emptySignalCounts(): Record<SemanticGateSignal, number> {
  return {
    no_draft: 0,
    outline_shape: 0,
    writer_expansion: 0,
    plan_adherence_drift: 0,
    checker_blocker: 0,
    plan_assist_gate: 0,
  }
}

function formatSignals(counts: Record<SemanticGateSignal, number>): string {
  return Object.entries(counts)
    .map(([signal, count]) => `${signal}=${count}`)
    .join(", ")
}

function chapterKey(chapter: number | null): string {
  return chapter === null ? "null" : String(chapter)
}

function parseChapterKey(key: string): number | null {
  return key === "null" ? null : Number(key)
}

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function groupGatesByChapter(gates: readonly SemanticPlanAssistGateRow[]): Map<string, SemanticPlanAssistGateRow[]> {
  const grouped = new Map<string, SemanticPlanAssistGateRow[]>()
  for (const gate of gates) {
    const key = chapterKey(gate.chapter)
    const list = grouped.get(key) ?? []
    list.push(gate)
    grouped.set(key, list)
  }
  return grouped
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

async function loadInputs(novelId: string): Promise<SemanticGateInputs> {
  const { default: db } = await import("../../src/db/connection")
  try {
    const outlines = await db`
      SELECT chapter_number, outline_json
      FROM chapter_outlines
      WHERE novel_id = ${novelId}
      ORDER BY chapter_number
    ` as WriterExpansionOutlineRow[]
    const drafts = await db`
      SELECT DISTINCT ON (chapter_number) chapter_number, version, status, word_count
      FROM chapter_drafts
      WHERE novel_id = ${novelId}
      ORDER BY chapter_number, version DESC
    ` as WriterExpansionDraftRow[]
    const planChecks = await db`
      SELECT id, novel_id, chapter, attempt, response_content, timestamp
      FROM llm_calls
      WHERE novel_id = ${novelId}
        AND agent = 'chapter-plan-checker'
      ORDER BY chapter, attempt NULLS LAST, id
    ` as PlanCheckCallRow[]
    const functionalEvents = await db`
      SELECT id, chapter, payload, timestamp
      FROM pipeline_events
      WHERE novel_id = ${novelId}
        AND event_type = 'functional-check'
      ORDER BY chapter, id
    ` as FunctionalEventRow[]
    const continuityRows = await db`
      SELECT id, agent, chapter, attempt, response_content, timestamp
      FROM llm_calls
      WHERE novel_id = ${novelId}
        AND agent IN ('continuity-facts', 'continuity-state')
      ORDER BY chapter, attempt NULLS LAST, agent, id
    ` as ContinuityCallRow[]
    const lineageRows = await db`
      SELECT id, novel_id, source_table, field_path, source, actor_kind, actor_ref,
             previous_ref, next_ref, previous_version, next_version,
             changed_at, reason, metadata
      FROM planning_mutation_lineage
      WHERE novel_id = ${novelId}
        AND source_table IN ('chapter_exhaustions', 'chapter_revisions')
      ORDER BY changed_at ASC, id ASC
    ` as PlanAssistLineageRow[]
    const gateRows = await db`
      SELECT chapter, attempt, kind, decided_at IS NULL AS pending, unresolved_deviations
      FROM chapter_exhaustions
      WHERE novel_id = ${novelId}
      ORDER BY fired_at DESC, id DESC
    ` as Array<{
      chapter: number | null
      attempt: number | null
      kind: string
      pending: boolean
      unresolved_deviations: unknown
    }>

    return {
      writerExpansion: buildWriterExpansionReport(outlines, drafts, novelId),
      planDrift: buildPlanDriftReport(planChecks, novelId),
      checkerWarnings: buildCheckerWarningReport({ functionalEvents, continuityRows }, novelId),
      planAssistLineage: buildPlanAssistLineageReport(lineageRows, novelId),
      planAssistGates: gateRows.map(row => ({
        chapter: row.chapter,
        attempt: row.attempt,
        kind: row.kind,
        pending: Boolean(row.pending),
        unresolvedCount: parseJsonbArray(row.unresolved_deviations).length,
      })),
    }
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
    console.error("usage: bun scripts/analysis/semantic-gate-report.ts --novel <novelId> [--json]")
    return 2
  }

  if (!args.novelId) {
    console.error("usage: bun scripts/analysis/semantic-gate-report.ts --novel <novelId> [--json]")
    return 2
  }

  const report = buildSemanticGateReport(await loadInputs(args.novelId), args.novelId)
  console.log(args.json ? JSON.stringify(report, null, 2) : renderSemanticGateReport(report))
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
