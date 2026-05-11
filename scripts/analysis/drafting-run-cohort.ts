#!/usr/bin/env bun
/**
 * Aggregate read-only drafting-run comparison artifacts into cohort evidence.
 *
 * This consumes `diagnostics:drafting-run-compare` JSON reports. It does not call
 * an LLM, mutate plans, import readiness rows, or gate drafting.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import type { Dimension } from "../evals/planner-discernment-calibration"
import type { DraftingRunComparison, DraftingRunComparisonReport } from "./drafting-run-compare"

type CohortSignal = DraftingRunComparison["signal"] | "insufficient"

interface Args {
  comparisons: string[]
  output: string | null
  json: string | null
}

export interface DraftingRunCohortReportRef {
  path: string
  report: DraftingRunComparisonReport
}

export interface DraftingRunCohortPair {
  reportPath: string
  source: string
  baselineArm: string
  candidateArm: string
  cleanSource: boolean
  signal: DraftingRunComparison["signal"]
  totalWordsDelta: number
  meanRatioDelta: number
  proseLowDelta: number | null
  sceneLowDelta: number | null
  contextGapDelta: number | null
  readinessFindingDelta: number | null
  canonSourceRefsDelta: number | null
  storyRefIdsDelta: number | null
  readerInfoStateDelta: number | null
  readerInfoStateCharsDelta: number | null
  missingCharacterIdsDelta: number | null
}

export interface DraftingRunCohortDimensionSummary {
  dimension: Dimension
  comparisons: number
  meanDeltaSum: number
  lowDeltaSum: number
  resolvedLowRows: number
  regressedLowRows: number
  improvedRows: number
  worsenedRows: number
}

export interface DraftingRunCohortReport {
  generatedAt: string
  sourceReports: string[]
  comparisonCount: number
  cleanComparisonCount: number
  signal: CohortSignal
  signalCounts: Record<string, number>
  cleanSignalCounts: Record<string, number>
  aggregate: {
    meanWordsDelta: number | null
    meanRatioDelta: number | null
    proseLowDeltaSum: number
    sceneLowDeltaSum: number
    contextGapDeltaSum: number
    readinessFindingDeltaSum: number
    contextDeltas: {
      characterContext: number
      worldContext: number
      canonFactContext: number
      factContinuityAnchors: number
      canonSourceRefs: number
      storyContext: number
      storyRefIds: number
      readerInfoState: number
      readerInfoStateChars: number
      resolvedReferences: number
      missingCharacterIds: number
    }
  }
  dimensions: DraftingRunCohortDimensionSummary[]
  pairs: DraftingRunCohortPair[]
}

export function buildDraftingRunCohortReport(input: {
  refs: readonly DraftingRunCohortReportRef[]
  generatedAt?: string
}): DraftingRunCohortReport {
  const pairs = input.refs.flatMap(ref => pairRowsForReport(ref))
  const cleanPairs = pairs.filter(pair => pair.cleanSource)
  const dimensionMap = new Map<Dimension, DraftingRunCohortDimensionSummary>()
  for (const ref of input.refs) {
    for (const comparison of ref.report.comparisons) {
      if (!isCleanComparison(ref.report, comparison)) continue
      for (const dim of comparison.sceneSemantic.dimensions) {
        const current = dimensionMap.get(dim.dimension) ?? {
          dimension: dim.dimension,
          comparisons: 0,
          meanDeltaSum: 0,
          lowDeltaSum: 0,
          resolvedLowRows: 0,
          regressedLowRows: 0,
          improvedRows: 0,
          worsenedRows: 0,
        }
        current.comparisons += 1
        current.meanDeltaSum += numberOrZero(dim.meanDelta)
        current.lowDeltaSum += numberOrZero(dim.lowDelta)
        current.resolvedLowRows += numberOrZero(dim.resolvedLowRows)
        current.regressedLowRows += numberOrZero(dim.regressedLowRows)
        current.improvedRows += numberOrZero(dim.improvedRows)
        current.worsenedRows += numberOrZero(dim.worsenedRows)
        dimensionMap.set(dim.dimension, current)
      }
    }
  }
  const signalCounts = countBy(pairs, pair => pair.signal)
  const cleanSignalCounts = countBy(cleanPairs, pair => pair.signal)
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceReports: input.refs.map(ref => ref.path),
    comparisonCount: pairs.length,
    cleanComparisonCount: cleanPairs.length,
    signal: cohortSignal(cleanSignalCounts, cleanPairs.length),
    signalCounts,
    cleanSignalCounts,
    aggregate: {
      meanWordsDelta: mean(cleanPairs.map(pair => pair.totalWordsDelta)),
      meanRatioDelta: mean(cleanPairs.map(pair => pair.meanRatioDelta)),
      proseLowDeltaSum: sumNullable(cleanPairs.map(pair => pair.proseLowDelta)),
      sceneLowDeltaSum: sumNullable(cleanPairs.map(pair => pair.sceneLowDelta)),
      contextGapDeltaSum: sumNullable(cleanPairs.map(pair => pair.contextGapDelta)),
      readinessFindingDeltaSum: sumNullable(cleanPairs.map(pair => pair.readinessFindingDelta)),
      contextDeltas: {
        characterContext: sumComparisonDelta(input.refs, "characterContextDelta"),
        worldContext: sumComparisonDelta(input.refs, "worldContextDelta"),
        canonFactContext: sumComparisonDelta(input.refs, "canonFactContextDelta"),
        factContinuityAnchors: sumComparisonDelta(input.refs, "factContinuityAnchorDelta"),
        canonSourceRefs: sumComparisonDelta(input.refs, "canonSourceRefsDelta"),
        storyContext: sumComparisonDelta(input.refs, "storyContextDelta"),
        storyRefIds: sumComparisonDelta(input.refs, "storyRefIdsDelta"),
        readerInfoState: sumComparisonDelta(input.refs, "readerInfoStateDelta"),
        readerInfoStateChars: sumComparisonDelta(input.refs, "readerInfoStateCharsDelta"),
        resolvedReferences: sumComparisonDelta(input.refs, "resolvedReferencesDelta"),
        missingCharacterIds: sumComparisonDelta(input.refs, "missingCharacterIdsDelta"),
      },
    },
    dimensions: [...dimensionMap.values()].sort((a, b) => a.dimension.localeCompare(b.dimension)),
    pairs,
  }
}

export function renderDraftingRunCohortReport(report: DraftingRunCohortReport): string {
  const lines: string[] = []
  lines.push("# Drafting Run Cohort")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Reports: ${report.sourceReports.length}`)
  lines.push(`Comparisons: ${report.comparisonCount} (${report.cleanComparisonCount} clean-source)`)
  lines.push(`Signal: ${report.signal}`)
  lines.push(`Signals: ${formatCounts(report.cleanSignalCounts)}`)
  lines.push("")
  lines.push("## Aggregate")
  lines.push("")
  lines.push(`- mean words delta: ${formatNullableNumber(report.aggregate.meanWordsDelta, 1)}`)
  lines.push(`- mean ratio delta: ${formatNullableNumber(report.aggregate.meanRatioDelta, 3)}`)
  lines.push(`- prose low delta sum: ${formatSigned(report.aggregate.proseLowDeltaSum)}`)
  lines.push(`- scene low delta sum: ${formatSigned(report.aggregate.sceneLowDeltaSum)}`)
  lines.push(`- context gap delta sum: ${formatSigned(report.aggregate.contextGapDeltaSum)}`)
  lines.push(`- readiness finding delta sum: ${formatSigned(report.aggregate.readinessFindingDeltaSum)}`)
  lines.push(
    `- context deltas: canonSourceRefs=${formatSigned(report.aggregate.contextDeltas.canonSourceRefs)}, ` +
      `factAnchors=${formatSigned(report.aggregate.contextDeltas.factContinuityAnchors)}, ` +
      `storyRefs=${formatSigned(report.aggregate.contextDeltas.storyRefIds)}, ` +
      `reader=${formatSigned(report.aggregate.contextDeltas.readerInfoState)}, ` +
      `readerChars=${formatSigned(report.aggregate.contextDeltas.readerInfoStateChars)}, ` +
      `resolvedRefs=${formatSigned(report.aggregate.contextDeltas.resolvedReferences)}, ` +
      `missingChars=${formatSigned(report.aggregate.contextDeltas.missingCharacterIds)}`,
  )
  lines.push("")
  lines.push("## Semantic Dimensions")
  lines.push("")
  lines.push("| Dimension | Comparisons | Mean Delta Sum | Low Delta Sum | Resolved | Regressed | Improved | Worsened |")
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
  for (const dim of report.dimensions) {
    lines.push(
      `| ${dim.dimension} | ${dim.comparisons} | ${formatSignedNumber(dim.meanDeltaSum, 2)} | ` +
        `${formatSigned(dim.lowDeltaSum)} | ${dim.resolvedLowRows} | ${dim.regressedLowRows} | ` +
        `${dim.improvedRows} | ${dim.worsenedRows} |`,
    )
  }
  lines.push("")
  lines.push("## Comparisons")
  lines.push("")
  lines.push("| Source | Baseline | Candidate | Clean | Signal | Words | Scene Lows | Canon Refs | Story Refs | Reader | Reader Chars | Missing Chars |")
  lines.push("| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
  for (const pair of report.pairs) {
    lines.push(
      `| ${pair.source} | ${pair.baselineArm} | ${pair.candidateArm} | ${pair.cleanSource ? "yes" : "no"} | ` +
        `${pair.signal} | ${formatSigned(pair.totalWordsDelta)} | ${formatDelta(pair.sceneLowDelta)} | ` +
        `${formatDelta(pair.canonSourceRefsDelta)} | ${formatDelta(pair.storyRefIdsDelta)} | ` +
        `${formatDelta(pair.readerInfoStateDelta)} | ${formatDelta(pair.readerInfoStateCharsDelta)} | ` +
        `${formatDelta(pair.missingCharacterIdsDelta)} |`,
    )
  }
  lines.push("")
  lines.push("## Interpretation Boundary")
  lines.push("")
  lines.push("- This is advisory cohort evidence over existing production-path comparison artifacts.")
  lines.push("- Treat source-sensitive mixed/regressed rows as review prompts, not as automatic prompt or tag changes.")
  return `${lines.join("\n")}\n`
}

export function loadDraftingRunComparisonReportRef(path: string): DraftingRunCohortReportRef {
  const abs = resolve(path)
  if (!existsSync(abs)) throw new Error(`drafting-run comparison report not found: ${abs}`)
  return {
    path: abs,
    report: JSON.parse(readFileSync(abs, "utf8")) as DraftingRunComparisonReport,
  }
}

function pairRowsForReport(ref: DraftingRunCohortReportRef): DraftingRunCohortPair[] {
  return ref.report.comparisons.map(comparison => ({
    reportPath: ref.path,
    source: comparison.candidate.source,
    baselineArm: ref.report.baseline.arm,
    candidateArm: comparison.candidate.arm,
    cleanSource: isCleanComparison(ref.report, comparison),
    signal: comparison.signal,
    totalWordsDelta: comparison.length.totalWordsDelta,
    meanRatioDelta: comparison.length.meanRatioDelta,
    proseLowDelta: comparison.proseSemantic.lowRowsDelta,
    sceneLowDelta: comparison.sceneSemantic.lowRowsDelta,
    contextGapDelta: comparison.planningContext.gapDelta,
    readinessFindingDelta: comparison.planningContext.readinessFindingDelta,
    canonSourceRefsDelta: comparison.planningContext.canonSourceRefsDelta ?? null,
    storyRefIdsDelta: comparison.planningContext.storyRefIdsDelta ?? null,
    readerInfoStateDelta: comparison.planningContext.readerInfoStateDelta ?? null,
    readerInfoStateCharsDelta: comparison.planningContext.readerInfoStateCharsDelta ?? null,
    missingCharacterIdsDelta: comparison.planningContext.missingCharacterIdsDelta ?? null,
  }))
}

function isCleanComparison(report: DraftingRunComparisonReport, comparison: DraftingRunComparison): boolean {
  return report.baseline.cleanSource === true && comparison.candidate.cleanSource === true
}

function sumComparisonDelta(
  refs: readonly DraftingRunCohortReportRef[],
  key: keyof DraftingRunComparison["planningContext"],
): number {
  let sum = 0
  for (const ref of refs) {
    for (const comparison of ref.report.comparisons) {
      if (!isCleanComparison(ref.report, comparison)) continue
      const value = comparison.planningContext[key]
      if (typeof value === "number" && Number.isFinite(value)) sum += value
    }
  }
  return sum
}

function cohortSignal(counts: Record<string, number>, cleanCount: number): CohortSignal {
  if (cleanCount === 0) return "insufficient"
  if ((counts.regressed ?? 0) > 0) return "regressed"
  if ((counts.incomplete ?? 0) > 0) return "incomplete"
  if ((counts.mixed ?? 0) > 0) return "mixed"
  if ((counts.promising ?? 0) > 0) return "promising"
  if ((counts.unchanged ?? 0) > 0) return "unchanged"
  return "insufficient"
}

function countBy<T>(items: readonly T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const key = keyFn(item)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}

function sumNullable(values: readonly Array<number | null>): number {
  return values.reduce((sum, value) => sum + (value ?? 0), 0)
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
  return entries.length === 0 ? "(none)" : entries.map(([key, count]) => `${key}: ${count}`).join(", ")
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

function formatSignedNumber(value: number, digits: number): string {
  const rendered = value.toFixed(digits)
  return value > 0 ? `+${rendered}` : rendered
}

function formatNullableNumber(value: number | null, digits: number): string {
  return value === null ? "n/a" : value.toFixed(digits)
}

function formatDelta(value: number | null): string {
  return value === null ? "n/a" : formatSigned(value)
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const comparisons: string[] = []
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
    if (arg === "--comparison") { comparisons.push(next()); continue }
    if (arg === "--output") { output = next(); continue }
    if (arg === "--json") { json = next(); continue }
    if (arg.startsWith("-")) throw new Error(`unknown arg: ${arg}`)
    positional.push(arg)
  }
  comparisons.push(...positional)
  if (comparisons.length === 0) throw new Error("at least one --comparison or positional comparison JSON path is required")
  return { comparisons, output, json }
}

function writeOutput(path: string, content: string): void {
  const abs = resolve(path)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

async function main(): Promise<number> {
  let args: Args
  try {
    args = parseArgs()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/drafting-run-cohort.ts --comparison <drafting-run-compare.json> [--comparison ...] [--output report.md] [--json report.json]")
    return 2
  }

  const report = buildDraftingRunCohortReport({
    refs: args.comparisons.map(loadDraftingRunComparisonReportRef),
  })
  if (args.output) writeOutput(args.output, renderDraftingRunCohortReport(report))
  if (args.json) writeOutput(args.json, `${JSON.stringify(report, null, 2)}\n`)
  console.log(renderDraftingRunCohortReport(report))
  return 0
}

if (import.meta.main) {
  process.exit(await main())
}
