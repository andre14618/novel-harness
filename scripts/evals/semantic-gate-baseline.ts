#!/usr/bin/env bun
/**
 * Disposable current-runtime baseline for semantic-gate investigation.
 *
 * Clones a frozen planning/drafting source, optionally caps chapters/beats on
 * the disposable clone, resumes drafting in auto mode, then writes the same
 * semantic-gate evidence used by the diagnostics lane. This is intentionally a
 * one-arm baseline runner, not a production runtime change.
 */

import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"

import db from "../../src/db/connection"
import {
  buildCheckerWarningReport,
  type CheckerWarningReport,
  type ContinuityCallRow,
  type FunctionalEventRow,
} from "../analysis/checker-warning-report"
import {
  buildPlanAssistLineageReport,
  type PlanAssistLineageReport,
  type PlanAssistLineageRow,
} from "../analysis/plan-assist-lineage-report"
import {
  buildPlanDriftReport,
  type PlanCheckCallRow,
  type PlanDriftReport,
} from "../analysis/plan-drift-report"
import {
  buildSemanticGateReport,
  type SemanticGateReport,
  type SemanticPlanAssistGateRow,
} from "../analysis/semantic-gate-report"
import {
  buildWriterExpansionReport,
  type WriterExpansionDraftRow,
  type WriterExpansionOutlineRow,
  type WriterExpansionReport,
} from "../analysis/writer-expansion-report"

export interface Args {
  source: string
  chapters: number
  outputBase: string
  keepNovel: boolean
  target: string | null
  maxBeatsPerChapter: number | null
}

export interface SourcePreflight {
  sourceNovelId: string
  phase: string
  totalChapters: number
  outlineCount: number
}

export interface BaselineProcessSummary {
  exitCode: number | null
  signal: string | null
  stdoutPath: string
  stderrPath: string
}

export interface DraftSummary {
  latestChapters: number
  approvedChapters: number
  totalWords: number
  rows: Array<{
    chapter: number
    version: number
    status: string
    wordCount: number
  }>
}

export interface LlmSummary {
  calls: number
  failedCalls: number
  costUsd: number
  agents: Array<{
    agent: string
    calls: number
    failedCalls: number
    costUsd: number
  }>
}

export interface PlanAssistGateSummary {
  id: number
  chapter: number
  attempt: number
  kind: string
  resolverMode: string
  decision: string | null
  pending: boolean
  unresolvedCount: number
  unresolvedSamples: string[]
}

export interface PlanAssistGateLogEvidence {
  unresolvedCount: number | null
  unresolvedSamples: string[]
}

export interface BaselineTerminalSummary {
  status: "completed" | "pending-plan-assist" | "process-exit" | "incomplete"
  reason: string
  latestPlanAssistGate: PlanAssistGateSummary | null
  planAssistLogEvidence: PlanAssistGateLogEvidence | null
}

export interface SemanticGateBaselineReport {
  generatedAt: string
  sourceNovelId: string
  novelId: string
  chapters: number
  outputBase: string
  maxBeatsPerChapter: number | null
  keptNovel: boolean
  sourcePreflight: SourcePreflight
  process: BaselineProcessSummary
  novel: {
    phase: string | null
    currentChapter: number | null
    totalChapters: number | null
    completed: boolean
  }
  terminal: BaselineTerminalSummary
  drafts: DraftSummary
  llm: LlmSummary
  checker: {
    semanticGate: SemanticGateReport
    writerExpansion: WriterExpansionReport
    planDrift: PlanDriftReport
    warnings: CheckerWarningReport
    planAssistLineage: PlanAssistLineageReport
    hallucUngrounded: {
      calls: number
      blockerIssues: number
    }
  }
}

export function parseArgs(argv: string[]): Args {
  const map: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const eq = arg.match(/^--([^=]+)=(.*)$/)
    if (eq) {
      map[eq[1]!] = eq[2]!
      continue
    }
    if (!arg.startsWith("--")) throw new Error(`unknown arg: ${arg}`)
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith("--")) {
      map[key] = next
      i++
    } else {
      map[key] = true
    }
  }

  const source = stringOpt(map.source)
  if (!source) throw new Error("--source is required")
  const chapters = positiveInt(map.chapters, "--chapters", 2)
  const rawOutput = stringOpt(map["output-base"]) ??
    join("output", "evals", "semantic-gate-baseline", `${safeSlug(source)}-${stamp()}`)
  return {
    source,
    chapters,
    outputBase: isAbsolute(rawOutput) ? rawOutput : resolve(process.cwd(), rawOutput),
    keepNovel: boolOpt(map["keep-novel"]),
    target: stringOpt(map.target) ?? null,
    maxBeatsPerChapter: optionalPositiveInt(map["max-beats-per-chapter"], "--max-beats-per-chapter"),
  }
}

export function capOutlineBeats<T extends { scenes?: unknown[] }>(outline: T, maxBeats: number): T {
  if (!Number.isInteger(maxBeats) || maxBeats <= 0) {
    throw new Error(`maxBeats must be a positive integer, got ${maxBeats}`)
  }
  if (!Array.isArray(outline.scenes) || outline.scenes.length <= maxBeats) return outline
  return {
    ...outline,
    scenes: outline.scenes.slice(0, maxBeats),
  }
}

export function scopeWriterExpansionRows(
  outlines: readonly WriterExpansionOutlineRow[],
  drafts: readonly WriterExpansionDraftRow[],
  chapters: number,
): { outlines: WriterExpansionOutlineRow[]; drafts: WriterExpansionDraftRow[] } {
  return {
    outlines: outlines.filter(row => Number(row.chapter_number) <= chapters),
    drafts: drafts.filter(row => Number(row.chapter_number) <= chapters),
  }
}

export function buildBaselineTerminalSummary(
  processResult: Pick<BaselineProcessSummary, "exitCode" | "signal">,
  completed: boolean,
  planAssistGates: readonly PlanAssistGateSummary[],
  planAssistLogEvidence: PlanAssistGateLogEvidence | null = null,
): BaselineTerminalSummary {
  const latestGate = planAssistGates[0] ?? null
  if (completed) {
    return {
      status: "completed",
      reason: "completed requested chapters",
      latestPlanAssistGate: latestGate,
      planAssistLogEvidence,
    }
  }

  const pendingGate = planAssistGates.find(gate => gate.pending) ?? null
  if (pendingGate) {
    return {
      status: "pending-plan-assist",
      reason: `stopped at pending plan-assist gate: chapter ${pendingGate.chapter}, kind ${pendingGate.kind}`,
      latestPlanAssistGate: pendingGate,
      planAssistLogEvidence,
    }
  }

  if (processResult.exitCode !== 0 || processResult.signal) {
    return {
      status: "process-exit",
      reason: `process exited before completion: exit=${String(processResult.exitCode)}, signal=${processResult.signal ?? "none"}`,
      latestPlanAssistGate: latestGate,
      planAssistLogEvidence,
    }
  }

  return {
    status: "incomplete",
    reason: "process exited cleanly but requested chapters were not approved",
    latestPlanAssistGate: latestGate,
    planAssistLogEvidence,
  }
}

export function extractPlanAssistGateLogEvidence(stdout: string): PlanAssistGateLogEvidence | null {
  const gateStart = stdout.lastIndexOf("PLAN-ASSIST GATE")
  if (gateStart < 0) return null
  const section = stdout.slice(gateStart)
  const countMatch = section.match(/Unresolved issues \((\d+)\):/)
  const sampleStart = countMatch?.index === undefined ? 0 : countMatch.index + countMatch[0].length
  const samples = section
    .slice(sampleStart)
    .split(/\r?\n/)
    .flatMap(line => {
      const match = line.match(/^\s*-\s+(.+)$/)
      return match ? [snippet(match[1]!, 180)] : []
    })
    .slice(0, 3)
  return {
    unresolvedCount: countMatch ? Number(countMatch[1]) : null,
    unresolvedSamples: samples,
  }
}

export function renderSemanticGateBaselineReport(report: SemanticGateBaselineReport): string {
  const lines: string[] = []
  lines.push("# Semantic Gate Baseline")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Source: ${report.sourceNovelId}`)
  lines.push(`Disposable novel: ${report.novelId}${report.keptNovel ? " (kept)" : " (cleaned after report)"}`)
  lines.push(`Chapters: ${report.chapters}`)
  lines.push(`Max beats per chapter: ${report.maxBeatsPerChapter ?? "(source outline)"}`)
  lines.push(`Terminal status: ${report.terminal.status}`)
  lines.push(`Reason: ${report.terminal.reason}`)
  lines.push("")
  lines.push("## Drafts")
  lines.push(`Approved: ${report.drafts.approvedChapters}/${report.chapters}`)
  lines.push(`Words: ${report.drafts.totalWords}`)
  for (const row of report.drafts.rows) {
    lines.push(`- ch${row.chapter}: ${row.status} v${row.version}, ${row.wordCount}w`)
  }
  lines.push("")
  lines.push("## LLM")
  lines.push(`Calls: ${report.llm.calls}; failed=${report.llm.failedCalls}; cost=$${report.llm.costUsd.toFixed(4)}`)
  for (const agent of report.llm.agents.slice(0, 12)) {
    lines.push(`- ${agent.agent}: calls=${agent.calls}, failed=${agent.failedCalls}, cost=$${agent.costUsd.toFixed(4)}`)
  }
  lines.push("")
  lines.push("## Semantic Gate")
  lines.push(`Signals: ${formatSignals(report.checker.semanticGate.totals.bySignal)}`)
  for (const chapter of report.checker.semanticGate.chapters) {
    if (chapter.signals.length === 0) continue
    lines.push(
      `- ch${chapter.chapter ?? "?"}: ${chapter.signals.join(",")} ` +
        `(target=${chapter.targetWords ?? "?"}, beats=${chapter.plannedBeats}, draft=${chapter.draftWords ?? "none"})`,
    )
  }
  lines.push("")
  lines.push("## Checker")
  lines.push(
    `Warnings: total=${report.checker.warnings.totalItems}; ` +
      `severity=${formatRecord(report.checker.warnings.bySeverity)}; ` +
      `calibration=${formatRecord(report.checker.warnings.byCalibration)}`,
  )
  lines.push(`Halluc-ungrounded: calls=${report.checker.hallucUngrounded.calls}; blockerIssues=${report.checker.hallucUngrounded.blockerIssues}`)
  if (report.terminal.latestPlanAssistGate) {
    const gate = report.terminal.latestPlanAssistGate
    lines.push("")
    lines.push("## Latest Plan-Assist Gate")
    lines.push(`Chapter ${gate.chapter}, attempt ${gate.attempt}, kind=${gate.kind}, pending=${gate.pending}`)
    for (const sample of gate.unresolvedSamples) lines.push(`- ${sample}`)
  }
  return lines.join("\n")
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(
      "usage: bun scripts/evals/semantic-gate-baseline.ts --source <drafting-source-novel-id> " +
        "[--chapters 2] [--max-beats-per-chapter 5] [--output-base output/evals/...] [--keep-novel]",
    )
    return 2
  }

  mkdirSync(args.outputBase, { recursive: true })
  const targetNovelId = args.target ?? `semantic-gate-baseline-${stamp()}-${safeSlug(args.source)}`
  let cloned = false

  try {
    const preflight = await validateSource(args)
    cloneSource(args.source, targetNovelId)
    cloned = true
    await capNovelChapters(targetNovelId, args.chapters)
    if (args.maxBeatsPerChapter !== null) {
      await capNovelOutlineBeats(targetNovelId, args.chapters, args.maxBeatsPerChapter)
    }

    const processResult = runBaselineProcess(targetNovelId, args.outputBase)
    const report = await collectBaselineReport({
      sourceNovelId: args.source,
      novelId: targetNovelId,
      chapters: args.chapters,
      outputBase: args.outputBase,
      maxBeatsPerChapter: args.maxBeatsPerChapter,
      keptNovel: args.keepNovel,
      preflight,
      processResult,
    })

    const jsonPath = join(args.outputBase, "summary.json")
    const markdownPath = join(args.outputBase, "report.md")
    writeFileSync(jsonPath, JSON.stringify(report, null, 2))
    writeFileSync(markdownPath, renderSemanticGateBaselineReport(report))
    console.log(renderSemanticGateBaselineReport(report))
    console.log(`\nWrote ${jsonPath}`)
    console.log(`Wrote ${markdownPath}`)
    return report.novel.completed ? 0 : 1
  } catch (err) {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    return 1
  } finally {
    if (cloned && !args.keepNovel) await cleanupNovels([targetNovelId])
    else if (cloned) console.error(`Keeping disposable clone: ${targetNovelId}`)
    await db.end().catch(() => {})
  }
}

async function validateSource(args: Args): Promise<SourcePreflight> {
  const [novel] = await db<Array<{ id: string; phase: string; total_chapters: number }>>`
    SELECT id, phase, total_chapters FROM novels WHERE id = ${args.source}
  `
  if (!novel) throw new Error(`source novel not found: ${args.source}`)

  const [{ n: outlineCount } = { n: 0 }] = await db<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM chapter_outlines WHERE novel_id = ${args.source}
  `
  if (Number(outlineCount) < args.chapters) {
    throw new Error(`source has ${outlineCount} chapter outline(s), but --chapters=${args.chapters}`)
  }

  return {
    sourceNovelId: args.source,
    phase: novel.phase,
    totalChapters: Number(novel.total_chapters ?? 0),
    outlineCount: Number(outlineCount ?? 0),
  }
}

function cloneSource(source: string, target: string): void {
  const result = spawnSync("bun", [
    "scripts/variant/clone-for-variant.ts",
    "--source", source,
    "--target", target,
    "--target-phase", "drafting",
  ], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.status !== 0) {
    throw new Error(`clone-for-variant failed for ${target}: exit=${result.status}`)
  }
}

async function capNovelChapters(novelId: string, chapters: number): Promise<void> {
  await db`
    UPDATE novels
    SET total_chapters = ${chapters},
        seed_json = jsonb_set(seed_json, '{chapterCount}', to_jsonb(${chapters}::int), true),
        updated_at = now()
    WHERE id = ${novelId}
  `
}

async function capNovelOutlineBeats(novelId: string, chapters: number, maxBeats: number): Promise<void> {
  const rows = await db<Array<{ chapter_number: number; outline_json: { scenes?: unknown[] } }>>`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${novelId}
      AND chapter_number <= ${chapters}
    ORDER BY chapter_number
  `
  for (const row of rows) {
    const originalCount = Array.isArray(row.outline_json?.scenes) ? row.outline_json.scenes.length : 0
    const capped = capOutlineBeats(row.outline_json, maxBeats)
    const cappedCount = Array.isArray(capped.scenes) ? capped.scenes.length : 0
    if (cappedCount === originalCount) continue
    await db`
      UPDATE chapter_outlines
      SET outline_json = ${capped}
      WHERE novel_id = ${novelId}
        AND chapter_number = ${row.chapter_number}
    `
    console.log(`  capped ${novelId} chapter ${row.chapter_number}: ${originalCount} -> ${cappedCount} beats`)
  }
}

function runBaselineProcess(novelId: string, outputBase: string): BaselineProcessSummary {
  const stdoutPath = join(outputBase, "baseline.stdout.log")
  const stderrPath = join(outputBase, "baseline.stderr.log")
  const result = spawnSync("bun", ["src/index.ts", "--resume", novelId, "--auto"], {
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
    env: { ...process.env },
  })
  writeFileSync(stdoutPath, result.stdout ?? "")
  writeFileSync(stderrPath, result.stderr ?? "")
  return {
    exitCode: result.status,
    signal: result.signal,
    stdoutPath,
    stderrPath,
  }
}

async function collectBaselineReport(input: {
  sourceNovelId: string
  novelId: string
  chapters: number
  outputBase: string
  maxBeatsPerChapter: number | null
  keptNovel: boolean
  preflight: SourcePreflight
  processResult: BaselineProcessSummary
}): Promise<SemanticGateBaselineReport> {
  const [novel] = await db<Array<{ phase: string; current_chapter: number; total_chapters: number }>>`
    SELECT phase, current_chapter, total_chapters FROM novels WHERE id = ${input.novelId}
  `
  const drafts = await loadDraftSummary(input.novelId)
  const llm = await loadLlmSummary(input.novelId)
  const writerExpansionRows = scopeWriterExpansionRows(
    await loadWriterExpansionOutlines(input.novelId),
    await loadWriterExpansionDrafts(input.novelId),
    input.chapters,
  )
  const writerExpansion = buildWriterExpansionReport(
    writerExpansionRows.outlines,
    writerExpansionRows.drafts,
    input.novelId,
  )
  const planDrift = buildPlanDriftReport(await loadPlanCheckRows(input.novelId), input.novelId)
  const warnings = buildCheckerWarningReport(await loadCheckerWarningInputs(input.novelId), input.novelId)
  const planAssistLineage = buildPlanAssistLineageReport(await loadPlanAssistLineageRows(input.novelId), input.novelId)
  const hallucUngrounded = await loadHallucSummary(input.novelId)
  const planAssistGates = await loadPlanAssistGates(input.novelId)
  const semanticGate = buildSemanticGateReport({
    writerExpansion,
    planDrift,
    checkerWarnings: warnings,
    planAssistLineage,
    planAssistGates,
  }, input.novelId)
  const logEvidence = await loadPlanAssistGateLogEvidence(input.processResult.stdoutPath)
  const completed = novel?.phase === "done" && drafts.approvedChapters >= input.chapters
  const terminal = buildBaselineTerminalSummary(input.processResult, completed, planAssistGates, logEvidence)

  return {
    generatedAt: new Date().toISOString(),
    sourceNovelId: input.sourceNovelId,
    novelId: input.novelId,
    chapters: input.chapters,
    outputBase: input.outputBase,
    maxBeatsPerChapter: input.maxBeatsPerChapter,
    keptNovel: input.keptNovel,
    sourcePreflight: input.preflight,
    process: input.processResult,
    novel: {
      phase: novel?.phase ?? null,
      currentChapter: novel?.current_chapter ?? null,
      totalChapters: novel?.total_chapters ?? null,
      completed,
    },
    terminal,
    drafts,
    llm,
    checker: {
      semanticGate,
      writerExpansion,
      planDrift,
      warnings,
      planAssistLineage,
      hallucUngrounded,
    },
  }
}

async function loadDraftSummary(novelId: string): Promise<DraftSummary> {
  const rows = await db<Array<{ chapter_number: number; version: number; status: string; word_count: number }>>`
    SELECT DISTINCT ON (chapter_number) chapter_number, version, status, word_count
    FROM chapter_drafts
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number, version DESC
  `
  const mapped = rows.map(row => ({
    chapter: Number(row.chapter_number),
    version: Number(row.version),
    status: row.status,
    wordCount: Number(row.word_count),
  }))
  return {
    latestChapters: mapped.length,
    approvedChapters: mapped.filter(row => row.status === "approved").length,
    totalWords: mapped.reduce((sum, row) => sum + row.wordCount, 0),
    rows: mapped,
  }
}

async function loadLlmSummary(novelId: string): Promise<LlmSummary> {
  const [totals] = await db<Array<{ calls: number; failed_calls: number; cost: string }>>`
    SELECT COUNT(*)::int AS calls,
           COUNT(*) FILTER (WHERE failed)::int AS failed_calls,
           COALESCE(SUM(cost), 0)::text AS cost
    FROM llm_calls
    WHERE novel_id = ${novelId}
  `
  const agents = await db<Array<{ agent: string; calls: number; failed_calls: number; cost: string }>>`
    SELECT agent,
           COUNT(*)::int AS calls,
           COUNT(*) FILTER (WHERE failed)::int AS failed_calls,
           COALESCE(SUM(cost), 0)::text AS cost
    FROM llm_calls
    WHERE novel_id = ${novelId}
    GROUP BY agent
    ORDER BY calls DESC, agent
  `
  return {
    calls: Number(totals?.calls ?? 0),
    failedCalls: Number(totals?.failed_calls ?? 0),
    costUsd: Number(totals?.cost ?? 0),
    agents: agents.map(row => ({
      agent: row.agent,
      calls: Number(row.calls),
      failedCalls: Number(row.failed_calls),
      costUsd: Number(row.cost),
    })),
  }
}

async function loadPlanCheckRows(novelId: string): Promise<PlanCheckCallRow[]> {
  return await db`
    SELECT id, novel_id, chapter, attempt, response_content, timestamp
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND agent = 'chapter-plan-checker'
    ORDER BY chapter, attempt NULLS LAST, id
  ` as PlanCheckCallRow[]
}

async function loadWriterExpansionOutlines(novelId: string): Promise<WriterExpansionOutlineRow[]> {
  return await db`
    SELECT chapter_number, outline_json
    FROM chapter_outlines
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number
  ` as WriterExpansionOutlineRow[]
}

async function loadWriterExpansionDrafts(novelId: string): Promise<WriterExpansionDraftRow[]> {
  return await db`
    SELECT DISTINCT ON (chapter_number) chapter_number, version, status, word_count
    FROM chapter_drafts
    WHERE novel_id = ${novelId}
    ORDER BY chapter_number, version DESC
  ` as WriterExpansionDraftRow[]
}

async function loadPlanAssistLineageRows(novelId: string): Promise<PlanAssistLineageRow[]> {
  return await db`
    SELECT id, novel_id, source_table, field_path, source, actor_kind, actor_ref,
           previous_ref, next_ref, previous_version, next_version,
           changed_at, reason, metadata
    FROM planning_mutation_lineage
    WHERE novel_id = ${novelId}
      AND source_table IN ('chapter_exhaustions', 'chapter_revisions')
    ORDER BY changed_at ASC, id ASC
  ` as PlanAssistLineageRow[]
}

async function loadCheckerWarningInputs(novelId: string): Promise<{
  functionalEvents: FunctionalEventRow[]
  continuityRows: ContinuityCallRow[]
}> {
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
  return { functionalEvents, continuityRows }
}

async function loadHallucSummary(novelId: string): Promise<SemanticGateBaselineReport["checker"]["hallucUngrounded"]> {
  const rows = await db<Array<{ response_content: string | null }>>`
    SELECT response_content
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND agent = 'halluc-ungrounded'
  `
  let blockerIssues = 0
  for (const row of rows) {
    if (!row.response_content) continue
    try {
      const parsed = JSON.parse(row.response_content)
      if (parsed?.pass === false && Array.isArray(parsed.issues)) {
        blockerIssues += parsed.issues.filter((issue: any) => issue?.severity === "blocker" || issue?.severity === undefined).length
      }
    } catch {}
  }
  return { calls: rows.length, blockerIssues }
}

async function loadPlanAssistGates(novelId: string): Promise<PlanAssistGateSummary[]> {
  const rows = await db<Array<{
    id: number
    chapter: number
    attempt: number
    kind: string
    resolver_mode: string
    decision: string | null
    pending: boolean
    unresolved_deviations: unknown
  }>>`
    SELECT id, chapter, attempt, kind, resolver_mode, decision,
           decided_at IS NULL AS pending,
           unresolved_deviations
    FROM chapter_exhaustions
    WHERE novel_id = ${novelId}
    ORDER BY fired_at DESC, id DESC
  `

  return rows.map(row => {
    const deviations = Array.isArray(row.unresolved_deviations) ? row.unresolved_deviations : []
    return {
      id: Number(row.id),
      chapter: Number(row.chapter),
      attempt: Number(row.attempt),
      kind: row.kind,
      resolverMode: row.resolver_mode,
      decision: row.decision,
      pending: Boolean(row.pending),
      unresolvedCount: deviations.length,
      unresolvedSamples: deviations.slice(0, 3).map(deviationSummary),
    }
  })
}

async function loadPlanAssistGateLogEvidence(stdoutPath: string): Promise<PlanAssistGateLogEvidence | null> {
  try {
    return extractPlanAssistGateLogEvidence(await readFile(stdoutPath, "utf8"))
  } catch {
    return null
  }
}

async function cleanupNovels(novelIds: readonly string[]): Promise<void> {
  if (novelIds.length === 0) return
  const { clearNovelState } = await import("../../tests/phase-parity/db-snapshot")
  for (const novelId of novelIds) {
    try {
      await clearNovelState(novelId)
      console.error(`cleaned ${novelId}`)
    } catch (err) {
      console.error(`cleanup failed for ${novelId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

function deviationSummary(value: unknown): string {
  if (!value || typeof value !== "object") return snippet(String(value), 180)
  const record = value as Record<string, unknown>
  const beat = record.beat_index === null || record.beat_index === undefined
    ? "chapter-level"
    : `beat ${Number(record.beat_index) + 1}`
  return snippet(`[${beat}] ${String(record.description ?? JSON.stringify(value))}`, 180)
}

function formatSignals(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([signal, count]) => `${signal}=${count}`)
    .join(", ")
}

function formatRecord(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
  return entries.length === 0
    ? "(none)"
    : entries.map(([key, count]) => `${key}=${count}`).join(", ")
}

function stringOpt(value: string | true | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function boolOpt(value: string | true | undefined): boolean {
  if (value === true) return true
  if (typeof value !== "string") return false
  return value === "1" || value === "true" || value === "yes"
}

function positiveInt(value: string | true | undefined, name: string, defaultValue: number): number {
  if (value === undefined) return defaultValue
  if (typeof value !== "string") throw new Error(`${name} requires a value`)
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

function optionalPositiveInt(value: string | true | undefined, name: string): number | null {
  if (value === undefined) return null
  if (typeof value !== "string") throw new Error(`${name} requires a value`)
  const parsed = Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "source"
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "").replace(/T/, "T").replace(/Z$/, "")
}

function snippet(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
