#!/usr/bin/env bun
/**
 * Compare production scene-semantic replay artifacts.
 *
 * Diagnostic-only. This reads persisted `scene-semantic-review.json` files,
 * aligns rows by scene + dimension, and reports whether a candidate artifact
 * improved or regressed low semantic labels. It does not call an LLM, mutate
 * plans, import readiness items, or gate drafting.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import type { Dimension } from "./planner-discernment-calibration"
import type { SceneSemanticReplayReport, SceneSemanticReplayResult } from "./scene-semantic-review"

type RowStatus =
  | "resolved_low"
  | "regressed_low"
  | "improved"
  | "worsened"
  | "unchanged"

interface Args {
  baseline: string | null
  candidates: string[]
  output: string | null
  json: string | null
}

export interface SceneSemanticReportRef {
  path: string
  report: SceneSemanticReplayReport
}

export interface SceneSemanticComparisonReport {
  generatedAt: string
  baseline: ReportSummary
  comparisons: SceneSemanticComparison[]
}

interface ReportSummary {
  path: string
  novelId: string
  setName: string
  taskCount: number
  skipCount: number
  errorRows: number
  dimensions: Dimension[]
}

export interface SceneSemanticComparison {
  candidate: ReportSummary
  verdict: "improved" | "regressed" | "mixed" | "unchanged" | "incomplete"
  comparedRows: number
  missingInCandidate: string[]
  missingInBaseline: string[]
  dimensions: DimensionDelta[]
  rowChanges: RowDelta[]
}

export interface DimensionDelta {
  dimension: Dimension
  comparedRows: number
  baselineMean: number | null
  candidateMean: number | null
  meanDelta: number | null
  baselineLowRows: number
  candidateLowRows: number
  lowDelta: number
  resolvedLowRows: number
  regressedLowRows: number
  improvedRows: number
  worsenedRows: number
}

export interface RowDelta {
  key: string
  chapterNumber: number
  sceneId: string
  dimension: Dimension
  baselineLabel: string
  candidateLabel: string
  baselineOrdinal: number
  candidateOrdinal: number
  ordinalDelta: number
  status: RowStatus
  traceIds: SceneSemanticTraceIds
  baselineTraceIds: SceneSemanticTraceIds
  candidateTraceIds: SceneSemanticTraceIds
  baselineConfidence: number
  candidateConfidence: number
  baselineMissingForNextLevel: string
  candidateMissingForNextLevel: string
}

export interface SceneSemanticTraceIds {
  obligationIds: string[]
  relevantCharacterIds: string[]
  relevantWorldFactIds: string[]
  sceneTurnIds: string[]
  threadIds: string[]
  promiseIds: string[]
  payoffIds: string[]
  sourceIds: string[]
}

export function buildSceneSemanticComparisonReport(input: {
  baseline: SceneSemanticReportRef
  candidates: SceneSemanticReportRef[]
  generatedAt?: string
}): SceneSemanticComparisonReport {
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    baseline: summarizeReport(input.baseline),
    comparisons: input.candidates.map(candidate => compareCandidate(input.baseline, candidate)),
  }
}

export function renderSceneSemanticComparisonReport(report: SceneSemanticComparisonReport): string {
  const lines: string[] = []
  lines.push("# Scene Semantic Comparison")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Baseline: ${report.baseline.setName} (${report.baseline.path})`)
  lines.push(`Candidates: ${report.comparisons.length}`)
  lines.push("")
  for (const comparison of report.comparisons) {
    lines.push(`## ${comparison.candidate.setName}`)
    lines.push("")
    lines.push(`Candidate: ${comparison.candidate.path}`)
    lines.push(`Verdict: ${comparison.verdict}`)
    lines.push(`Compared rows: ${comparison.comparedRows}`)
    if (report.baseline.errorRows > 0 || comparison.candidate.errorRows > 0) {
      lines.push(`Judge errors: baseline=${report.baseline.errorRows}, candidate=${comparison.candidate.errorRows}`)
    }
    if (comparison.missingInCandidate.length > 0) {
      lines.push(`Missing in candidate: ${comparison.missingInCandidate.length}`)
    }
    if (comparison.missingInBaseline.length > 0) {
      lines.push(`Missing in baseline: ${comparison.missingInBaseline.length}`)
    }
    lines.push("")
    lines.push("| Dimension | Rows | Mean Delta | Low Delta | Resolved | Regressed | Improved | Worsened |")
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
    for (const dim of comparison.dimensions) {
      lines.push(`| ${dim.dimension} | ${dim.comparedRows} | ${formatNumber(dim.meanDelta)} | ${formatSigned(dim.lowDelta)} | ${dim.resolvedLowRows} | ${dim.regressedLowRows} | ${dim.improvedRows} | ${dim.worsenedRows} |`)
    }
    const changedRows = comparison.rowChanges.filter(row => row.status !== "unchanged")
    lines.push("")
    lines.push("### Changed Rows")
    lines.push("")
    if (changedRows.length === 0) {
      lines.push("- none")
    } else {
      for (const row of changedRows) {
        const trace = formatTraceIds(row.traceIds)
        const missing = truncateForMarkdown(row.candidateMissingForNextLevel)
        lines.push(
          `- ch${row.chapterNumber} ${row.sceneId} ${row.dimension}: ` +
            `${row.baselineLabel} -> ${row.candidateLabel} ` +
            `(${formatSigned(row.ordinalDelta)}; ${row.status})` +
            `${trace ? `; ids=${trace}` : ""}` +
            `${missing ? `; next=${missing}` : ""}`,
        )
      }
    }
    lines.push("")
  }
  lines.push("## Interpretation Boundary")
  lines.push("")
  lines.push("- This is advisory replay telemetry, not a drafting gate.")
  lines.push("- Positive mean deltas and resolved lows are useful only when rows align by exact scene and dimension.")
  lines.push("- `incomplete` means at least one report has unpaired rows; inspect missing rows before treating deltas as improvement.")
  return `${lines.join("\n")}\n`
}

function compareCandidate(
  baseline: SceneSemanticReportRef,
  candidate: SceneSemanticReportRef,
): SceneSemanticComparison {
  const baselineResults = comparableResults(baseline.report.results)
  const candidateResults = comparableResults(candidate.report.results)
  const baselineRows = new Map(baselineResults.map(row => [rowKey(row), row]))
  const candidateRows = new Map(candidateResults.map(row => [rowKey(row), row]))
  const comparedKeys = [...baselineRows.keys()].filter(key => candidateRows.has(key)).sort()
  const missingInCandidate = [...baselineRows.keys()].filter(key => !candidateRows.has(key)).sort()
  const missingInBaseline = [...candidateRows.keys()].filter(key => !baselineRows.has(key)).sort()
  const rowChanges = comparedKeys.map(key => rowDelta(key, baselineRows.get(key)!, candidateRows.get(key)!))
  const dimensions = summarizeDimensionDeltas(rowChanges)
  return {
    candidate: summarizeReport(candidate),
    verdict: comparisonVerdict(
      dimensions,
      missingInCandidate.length + missingInBaseline.length + errorRowCount(baseline) + errorRowCount(candidate),
    ),
    comparedRows: rowChanges.length,
    missingInCandidate,
    missingInBaseline,
    dimensions,
    rowChanges,
  }
}

function summarizeDimensionDeltas(rows: RowDelta[]): DimensionDelta[] {
  const dimensions = unique(rows.map(row => row.dimension)).sort((a, b) => a.localeCompare(b))
  return dimensions.map(dimension => {
    const dimRows = rows.filter(row => row.dimension === dimension)
    const baselineValues = dimRows.map(row => row.baselineOrdinal)
    const candidateValues = dimRows.map(row => row.candidateOrdinal)
    const baselineMean = average(baselineValues)
    const candidateMean = average(candidateValues)
    return {
      dimension,
      comparedRows: dimRows.length,
      baselineMean,
      candidateMean,
      meanDelta: baselineMean === null || candidateMean === null ? null : candidateMean - baselineMean,
      baselineLowRows: dimRows.filter(row => row.baselineOrdinal <= 1).length,
      candidateLowRows: dimRows.filter(row => row.candidateOrdinal <= 1).length,
      lowDelta: dimRows.filter(row => row.candidateOrdinal <= 1).length - dimRows.filter(row => row.baselineOrdinal <= 1).length,
      resolvedLowRows: dimRows.filter(row => row.status === "resolved_low").length,
      regressedLowRows: dimRows.filter(row => row.status === "regressed_low").length,
      improvedRows: dimRows.filter(row => row.ordinalDelta > 0).length,
      worsenedRows: dimRows.filter(row => row.ordinalDelta < 0).length,
    }
  })
}

function rowDelta(key: string, baseline: SceneSemanticReplayResult, candidate: SceneSemanticReplayResult): RowDelta {
  const ordinalDelta = candidate.ordinal - baseline.ordinal
  return {
    key,
    chapterNumber: baseline.chapterNumber,
    sceneId: baseline.sceneId,
    dimension: baseline.dimension,
    baselineLabel: baseline.label,
    candidateLabel: candidate.label,
    baselineOrdinal: baseline.ordinal,
    candidateOrdinal: candidate.ordinal,
    ordinalDelta,
    status: rowStatus(baseline.ordinal, candidate.ordinal),
    traceIds: mergeTraceIds(traceIdsForResult(baseline), traceIdsForResult(candidate)),
    baselineTraceIds: traceIdsForResult(baseline),
    candidateTraceIds: traceIdsForResult(candidate),
    baselineConfidence: baseline.confidence,
    candidateConfidence: candidate.confidence,
    baselineMissingForNextLevel: baseline.missingForNextLevel ?? "",
    candidateMissingForNextLevel: candidate.missingForNextLevel ?? "",
  }
}

function rowStatus(baselineOrdinal: number, candidateOrdinal: number): RowStatus {
  if (baselineOrdinal <= 1 && candidateOrdinal > 1) return "resolved_low"
  if (baselineOrdinal > 1 && candidateOrdinal <= 1) return "regressed_low"
  if (candidateOrdinal > baselineOrdinal) return "improved"
  if (candidateOrdinal < baselineOrdinal) return "worsened"
  return "unchanged"
}

function comparisonVerdict(
  dimensions: DimensionDelta[],
  missingRows: number,
): SceneSemanticComparison["verdict"] {
  if (missingRows > 0) return "incomplete"
  const resolved = dimensions.reduce((sum, dim) => sum + dim.resolvedLowRows, 0)
  const regressed = dimensions.reduce((sum, dim) => sum + dim.regressedLowRows, 0)
  const lowDelta = dimensions.reduce((sum, dim) => sum + dim.lowDelta, 0)
  const meanDelta = average(dimensions.map(dim => dim.meanDelta).filter((value): value is number => value !== null))
  if (regressed > 0 && resolved > 0) return "mixed"
  if (regressed > 0 || lowDelta > 0) return "regressed"
  if (resolved > 0 || lowDelta < 0 || (meanDelta !== null && meanDelta > 0)) return "improved"
  if (dimensions.some(dim => dim.improvedRows > 0 || dim.worsenedRows > 0)) return "mixed"
  return "unchanged"
}

function summarizeReport(ref: SceneSemanticReportRef): ReportSummary {
  return {
    path: ref.path,
    novelId: ref.report.novelId,
    setName: ref.report.setName,
    taskCount: ref.report.taskCount,
    skipCount: ref.report.skipCount,
    errorRows: errorRowCount(ref),
    dimensions: ref.report.dimensions,
  }
}

function comparableResults(results: SceneSemanticReplayResult[]): SceneSemanticReplayResult[] {
  return results.filter(row => !row.error)
}

function errorRowCount(ref: SceneSemanticReportRef): number {
  return ref.report.results.filter(row => row.error).length
}

function rowKey(row: SceneSemanticReplayResult): string {
  return `ch${row.chapterNumber}:${row.sceneId}:${row.dimension}`
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function traceIdsForResult(row: SceneSemanticReplayResult): SceneSemanticTraceIds {
  return {
    obligationIds: cleanStrings(row.obligationIds),
    relevantCharacterIds: cleanStrings(row.relevantCharacterIds),
    relevantWorldFactIds: cleanStrings(row.relevantWorldFactIds),
    sceneTurnIds: cleanStrings(row.sceneTurnIds),
    threadIds: cleanStrings(row.threadIds),
    promiseIds: cleanStrings(row.promiseIds),
    payoffIds: cleanStrings(row.payoffIds),
    sourceIds: cleanStrings(row.sourceIds),
  }
}

function mergeTraceIds(...rows: SceneSemanticTraceIds[]): SceneSemanticTraceIds {
  return {
    obligationIds: unique(rows.flatMap(row => row.obligationIds)).sort(),
    relevantCharacterIds: unique(rows.flatMap(row => row.relevantCharacterIds)).sort(),
    relevantWorldFactIds: unique(rows.flatMap(row => row.relevantWorldFactIds)).sort(),
    sceneTurnIds: unique(rows.flatMap(row => row.sceneTurnIds)).sort(),
    threadIds: unique(rows.flatMap(row => row.threadIds)).sort(),
    promiseIds: unique(rows.flatMap(row => row.promiseIds)).sort(),
    payoffIds: unique(rows.flatMap(row => row.payoffIds)).sort(),
    sourceIds: unique(rows.flatMap(row => row.sourceIds)).sort(),
  }
}

function cleanStrings(values: readonly string[] | undefined): string[] {
  return unique((values ?? [])
    .map(value => typeof value === "string" ? value.trim() : "")
    .filter(value => value.length > 0 && value !== "null" && value !== "undefined"))
    .sort()
}

function formatTraceIds(traceIds: SceneSemanticTraceIds): string {
  const groups = [
    ["obligations", traceIds.obligationIds],
    ["characters", traceIds.relevantCharacterIds],
    ["worldFacts", traceIds.relevantWorldFactIds],
    ["sceneTurns", traceIds.sceneTurnIds],
    ["threads", traceIds.threadIds],
    ["promises", traceIds.promiseIds],
    ["payoffs", traceIds.payoffIds],
    ["sources", traceIds.sourceIds],
  ] as const
  return groups
    .filter(([, ids]) => ids.length > 0)
    .map(([label, ids]) => `${label}:${ids.slice(0, 4).join(",")}${ids.length > 4 ? `+${ids.length - 4}` : ""}`)
    .join("; ")
}

function truncateForMarkdown(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim()
  if (!clean) return ""
  return clean.length > 140 ? `${clean.slice(0, 137)}...` : clean
}

function formatNumber(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2)
}

function formatSigned(value: number): string {
  if (value > 0) return `+${value}`
  return `${value}`
}

function parseArgs(argv: string[]): Args {
  let baseline: string | null = null
  const candidates: string[] = []
  let output: string | null = null
  let json: string | null = null
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const next = (): string => {
      const value = argv[++i]
      if (!value) throw new Error(`${arg} requires a value`)
      return value
    }
    if (arg === "--baseline") { baseline = next(); continue }
    if (arg === "--candidate") { candidates.push(next()); continue }
    if (arg === "--output") { output = next(); continue }
    if (arg === "--json") { json = next(); continue }
    if (arg.startsWith("--")) throw new Error(`unknown arg: ${arg}`)
    positional.push(arg)
  }
  if (!baseline && positional.length > 0) baseline = positional.shift() ?? null
  candidates.push(...positional)
  return { baseline, candidates, output, json }
}

function readReport(path: string): SceneSemanticReportRef {
  const resolved = resolve(path)
  if (!existsSync(resolved)) throw new Error(`scene-semantic report not found: ${path}`)
  return {
    path: resolved,
    report: JSON.parse(readFileSync(resolved, "utf8")) as SceneSemanticReplayReport,
  }
}

function writeText(path: string, text: string): void {
  const resolved = resolve(path)
  mkdirSync(dirname(resolved), { recursive: true })
  writeFileSync(resolved, text)
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
    if (!args.baseline || args.candidates.length === 0) throw new Error("baseline and at least one candidate are required")
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/evals/scene-semantic-compare.ts --baseline <scene-semantic-review.json> --candidate <scene-semantic-review.json> [--candidate ...] [--output report.md] [--json report.json]")
    return 2
  }

  const report = buildSceneSemanticComparisonReport({
    baseline: readReport(args.baseline),
    candidates: args.candidates.map(readReport),
  })
  const rendered = renderSceneSemanticComparisonReport(report)
  if (args.output) writeText(args.output, rendered)
  if (args.json) writeText(args.json, `${JSON.stringify(report, null, 2)}\n`)
  console.log(args.json && !args.output ? JSON.stringify(report, null, 2) : rendered)
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
