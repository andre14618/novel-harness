#!/usr/bin/env bun
/**
 * Aggregate corpus recreation POC artifacts.
 *
 * Diagnostic-only. Reads ignored local output dirs and joins deterministic
 * plan/prose checks with scene semantic/prose review summaries. It does not
 * call an LLM, mutate plans, or promote runtime behavior.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import {
  buildRunManifest,
  existingArtifactRefs,
  manifestPathForSidecar,
  parentManifestForPocDir,
  writeRunManifest,
} from "./run-manifest"
import { corpusRecreationVariantLabel } from "./corpus-recreation-variant"

interface Args {
  pocDirs: string[]
  output: string | null
  json: string | null
}

interface DimensionSummary {
  dimension: string
  count: number
  meanOrdinal: number
  lowCount: number
  reviewCount: number
  labelCounts: Record<string, number>
}

interface LowFinding {
  sceneId: string
  dimension: string
  label: string
  missingForNextLevel: string
}

export interface CorpusRecreationAggregateRow {
  pocDir: string
  chapterLabel: string
  book: string
  plannerVariant: string
  writerContextMode: string
  expectedScenes: number | null
  actualScenes: number | null
  targetWords: number | null
  actualWords: number | null
  wordRatio: number | null
  sceneMinimumFailures: number
  planIssueCount: number
  chapterIssueCount: number
  chapterWarningCount: number
  forbiddenSourceTermCount: number
  contractTotal: number
  contractChoiceCount: number
  contractObligationCount: number
  contractKnownSourceIdCount: number
  contractKnownThreadRefCount: number
  contractOrphanPayoffRefCount: number
  contractPromiseThreadMismatchCount: number
  contractPayoffThreadMismatchCount: number
  contractObservableConsequenceCount: number
  semanticTaskCount: number
  semanticSkipCount: number
  semanticLowCount: number
  semanticSummaries: DimensionSummary[]
  lowFindings: LowFinding[]
  proseTaskCount: number
  proseLowCount: number
  proseReviewCount: number
  proseSummaries: DimensionSummary[]
  characterContextCount: number
  characterContextIssueCount: number
}

export interface CorpusRecreationAggregateReport {
  generatedAt: string
  rowCount: number
  rows: CorpusRecreationAggregateRow[]
}

export function buildCorpusRecreationAggregate(
  pocDirs: string[],
  generatedAt = new Date().toISOString(),
): CorpusRecreationAggregateReport {
  const rows = pocDirs.map(dir => readPocRow(dir))
    .sort((a, b) => compareChapterLabels(a.chapterLabel, b.chapterLabel) || a.pocDir.localeCompare(b.pocDir))
  return {
    generatedAt,
    rowCount: rows.length,
    rows,
  }
}

export function renderCorpusRecreationAggregate(report: CorpusRecreationAggregateReport): string {
  const lines: string[] = []
  lines.push("# Corpus Recreation Aggregate")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Rows: ${report.rowCount}`)
  lines.push("")
  lines.push("| Chapter | Variant | Scenes | Words | Contract | Issues | Warnings | Character Ctx | Semantic | Prose |")
  lines.push("| --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- |")
  for (const row of report.rows) {
    lines.push([
      `| ${escapeCell(row.chapterLabel || "?")}`,
      escapeCell(corpusRecreationVariantLabel({
        plannerVariant: row.plannerVariant,
        writerContextMode: row.writerContextMode,
      })),
      formatScenes(row),
      formatWords(row),
      escapeCell(formatContract(row)),
      escapeCell(formatIssues(row)),
      escapeCell(formatWarnings(row)),
      escapeCell(formatCharacterContext(row)),
      escapeCell(formatSemantic(row)),
      `${escapeCell(formatProse(row))} |`,
    ].join(" | "))
  }

  const lowRows = report.rows.filter(row => row.lowFindings.length > 0)
  if (lowRows.length) {
    lines.push("")
    lines.push("## Low-Signal Findings")
    for (const row of lowRows) {
      lines.push("")
      lines.push(`### Chapter ${row.chapterLabel}`)
      for (const finding of row.lowFindings) {
        lines.push(`- ${finding.sceneId} ${finding.dimension} ${finding.label}: ${finding.missingForNextLevel}`)
      }
    }
  }

  const issueRows = report.rows.filter(row => row.planIssueCount > 0 || row.chapterIssueCount > 0)
  if (issueRows.length) {
    lines.push("")
    lines.push("## Deterministic Issue Rows")
    for (const row of issueRows) {
      lines.push(`- Chapter ${row.chapterLabel}: plan=${row.planIssueCount}, chapter=${row.chapterIssueCount}`)
    }
  }

  lines.push("")
  lines.push("## Interpretation Boundary")
  lines.push("")
  lines.push("- Deterministic contract/prose rows show structure, IDs, consequences, word shape, and source-boundary checks.")
  lines.push("- Character-context rows show whether named characters are linked to required/source refs or downstream affected refs before writer-context experiments.")
  lines.push("- Semantic rows show diagnostic judge output for applicable exact-ID dimensions.")
  lines.push("- Prose rows show advisory prose-quality triage and operator-attention counts.")
  lines.push("- This aggregate is evidence for operator review and cohort design; it is not production promotion proof.")

  return `${lines.join("\n")}\n`
}

function readPocRow(pocDir: string): CorpusRecreationAggregateRow {
  const resolved = resolve(pocDir)
  const packet = readOptionalJson(`${resolved}/packet.json`) ?? {}
  const planComparison = readOptionalJson(`${resolved}/plan-comparison.json`) ?? {}
  const chapterComparison = readOptionalJson(`${resolved}/chapter-comparison.json`) ?? {}
  const semantic = readFirstOptionalJson([
    `${resolved}/semantic-review/semantic-review.json`,
    `${resolved}/semantic-review-live/semantic-review.json`,
  ]) ?? {}
  const prose = readOptionalJson(`${resolved}/prose-quality-live/prose-review.json`) ?? {}
  const characterContext = readOptionalJson(`${resolved}/character-context.json`) ?? {}
  const source = packet.sourceReference ?? {}
  const sceneContract = planComparison.sceneContract ?? {}
  const semanticSummaries = Array.isArray(semantic.summaries) ? semantic.summaries.map(normalizeSummary) : []
  const proseSummaries = Array.isArray(prose.summaries) ? prose.summaries.map(normalizeSummary) : []
  const lowFindings = Array.isArray(semantic.results)
    ? semantic.results
      .filter((result: any) => Number(result.ordinal ?? 0) <= 1)
      .map((result: any) => ({
        sceneId: String(result.sceneId ?? ""),
        dimension: String(result.dimension ?? ""),
        label: String(result.label ?? ""),
        missingForNextLevel: String(result.missingForNextLevel ?? result.output?.missingForNextLevel ?? ""),
      }))
    : []

  return {
    pocDir: resolved,
    chapterLabel: String(source.chapterLabel ?? ""),
    book: String(source.book ?? ""),
    plannerVariant: String(packet.diagnosticConfig?.plannerVariant ?? "baseline"),
    writerContextMode: String(packet.diagnosticConfig?.writerContextMode ?? "baseline"),
    expectedScenes: numberOrNull(planComparison.sceneCount?.expected),
    actualScenes: numberOrNull(planComparison.sceneCount?.actual ?? chapterComparison.sceneCount?.actual),
    targetWords: numberOrNull(chapterComparison.wordCount?.target),
    actualWords: numberOrNull(chapterComparison.wordCount?.actual),
    wordRatio: numberOrNull(chapterComparison.wordCount?.ratio),
    sceneMinimumFailures: Array.isArray(chapterComparison.sceneWordCounts)
      ? chapterComparison.sceneWordCounts.filter((row: any) => row?.meetsMinimum === false).length
      : 0,
    planIssueCount: Array.isArray(planComparison.issues) ? planComparison.issues.length : 0,
    chapterIssueCount: Array.isArray(chapterComparison.issues) ? chapterComparison.issues.length : 0,
    chapterWarningCount: Array.isArray(chapterComparison.warnings) ? chapterComparison.warnings.length : 0,
    forbiddenSourceTermCount: Array.isArray(chapterComparison.sourceBoundary?.forbiddenTermsPresent)
      ? chapterComparison.sourceBoundary.forbiddenTermsPresent.length
      : 0,
    contractTotal: numberOrZero(sceneContract.total),
    contractChoiceCount: numberOrZero(sceneContract.choiceAlternativeCount),
    contractObligationCount: numberOrZero(sceneContract.declaredObligationCount),
    contractKnownSourceIdCount: numberOrZero(sceneContract.knownSourceIdCount),
    contractKnownThreadRefCount: numberOrZero(sceneContract.knownThreadRefCount),
    contractOrphanPayoffRefCount: numberOrZero(sceneContract.orphanPayoffRefCount),
    contractPromiseThreadMismatchCount: numberOrZero(sceneContract.promiseThreadMismatchCount),
    contractPayoffThreadMismatchCount: numberOrZero(sceneContract.payoffThreadMismatchCount),
    contractObservableConsequenceCount: numberOrZero(sceneContract.observableConsequenceCount),
    semanticTaskCount: numberOrZero(semantic.taskCount),
    semanticSkipCount: numberOrZero(semantic.skipCount),
    semanticLowCount: semanticSummaries.reduce((sum, summary) => sum + summary.lowCount, 0),
    semanticSummaries,
    lowFindings,
    proseTaskCount: numberOrZero(prose.resultCount),
    proseLowCount: proseSummaries.reduce((sum, summary) => sum + summary.lowCount, 0),
    proseReviewCount: proseSummaries.reduce((sum, summary) => sum + summary.reviewCount, 0),
    proseSummaries,
    characterContextCount: numberOrZero(characterContext.contextCount),
    characterContextIssueCount: numberOrZero(characterContext.issueCount),
  }
}

function parseArgs(argv = process.argv.slice(2)): Args {
  const pocDirs: string[] = []
  let output: string | null = null
  let json: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--poc-dir") {
      const value = argv[index + 1]
      if (!value) throw new Error("--poc-dir requires a path")
      pocDirs.push(value)
      index += 1
    } else if (arg === "--output") {
      const value = argv[index + 1]
      if (!value) throw new Error("--output requires a path")
      output = value
      index += 1
    } else if (arg === "--json") {
      const value = argv[index + 1]
      if (!value) throw new Error("--json requires a path")
      json = value
      index += 1
    } else if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown arg: ${arg}`)
    } else {
      pocDirs.push(arg)
    }
  }

  if (pocDirs.length === 0) throw new Error("at least one --poc-dir or positional POC directory is required")
  return { pocDirs, output, json }
}

function printHelp(): void {
  console.log(`Usage:
  bun scripts/evals/corpus-recreation-aggregate.ts --poc-dir <dir> [--poc-dir <dir> ...]
  bun scripts/evals/corpus-recreation-aggregate.ts <dir> <dir> --output output/report.md --json output/report.json
`)
}

function readOptionalJson(path: string): any | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, "utf8"))
}

function readFirstOptionalJson(paths: string[]): any | null {
  for (const path of paths) {
    const value = readOptionalJson(path)
    if (value != null) return value
  }
  return null
}

function normalizeSummary(summary: any): DimensionSummary {
  return {
    dimension: String(summary.dimension ?? ""),
    count: numberOrZero(summary.count),
    meanOrdinal: numberOrZero(summary.meanOrdinal),
    lowCount: numberOrZero(summary.lowCount),
    reviewCount: numberOrZero(summary.reviewCount),
    labelCounts: typeof summary.labelCounts === "object" && summary.labelCounts !== null ? summary.labelCounts : {},
  }
}

function formatScenes(row: CorpusRecreationAggregateRow): string {
  if (row.expectedScenes === null || row.actualScenes === null) return "?"
  return `${row.actualScenes}/${row.expectedScenes}`
}

function formatWords(row: CorpusRecreationAggregateRow): string {
  if (row.actualWords === null || row.targetWords === null || row.wordRatio === null) return "?"
  return `${row.actualWords}/${row.targetWords} (${row.wordRatio.toFixed(2)})`
}

function formatContract(row: CorpusRecreationAggregateRow): string {
  if (row.contractTotal === 0) return "missing"
  return [
    `choices ${row.contractChoiceCount}/${row.contractTotal}`,
    `ids ${row.contractKnownSourceIdCount}/${row.contractTotal}`,
    `threads ${row.contractKnownThreadRefCount}/${row.contractTotal}`,
    ...(row.contractOrphanPayoffRefCount ? [`payoff-orphans ${row.contractOrphanPayoffRefCount}`] : []),
    ...(row.contractPromiseThreadMismatchCount || row.contractPayoffThreadMismatchCount
      ? [`thread-ref-mismatch p${row.contractPromiseThreadMismatchCount}/y${row.contractPayoffThreadMismatchCount}`]
      : []),
    `conseq ${row.contractObservableConsequenceCount}/${row.contractTotal}`,
  ].join("; ")
}

function formatIssues(row: CorpusRecreationAggregateRow): string {
  const parts: string[] = []
  if (row.planIssueCount) parts.push(`plan ${row.planIssueCount}`)
  if (row.chapterIssueCount) parts.push(`chapter ${row.chapterIssueCount}`)
  if (row.forbiddenSourceTermCount) parts.push(`source-leak ${row.forbiddenSourceTermCount}`)
  return parts.join("; ") || "none"
}

function formatWarnings(row: CorpusRecreationAggregateRow): string {
  const parts: string[] = []
  if (row.chapterWarningCount) parts.push(`chapter ${row.chapterWarningCount}`)
  if (row.sceneMinimumFailures) parts.push(`scene-floor ${row.sceneMinimumFailures}`)
  return parts.join("; ") || "none"
}

function formatCharacterContext(row: CorpusRecreationAggregateRow): string {
  if (!row.characterContextCount) return "not run"
  return row.characterContextIssueCount
    ? `${row.characterContextCount} packets; issues ${row.characterContextIssueCount}`
    : `${row.characterContextCount} packets; clean`
}

function formatSemantic(row: CorpusRecreationAggregateRow): string {
  if (!row.semanticTaskCount) return "not run"
  const means = row.semanticSummaries
    .map(summary => `${abbr(summary.dimension)} ${summary.meanOrdinal.toFixed(2)}`)
    .join(", ")
  const low = row.semanticLowCount ? `; low ${row.semanticLowCount}` : ""
  const skips = row.semanticSkipCount ? `; skips ${row.semanticSkipCount}` : ""
  return `${row.semanticTaskCount} tasks${low}${skips}${means ? `; ${means}` : ""}`
}

function formatProse(row: CorpusRecreationAggregateRow): string {
  if (!row.proseTaskCount) return "not run"
  const means = row.proseSummaries
    .map(summary => `${abbr(summary.dimension)} ${summary.meanOrdinal.toFixed(2)}`)
    .join(", ")
  const low = row.proseLowCount ? `; low ${row.proseLowCount}` : ""
  const review = row.proseReviewCount ? `; review ${row.proseReviewCount}` : ""
  return `${row.proseTaskCount} tasks${low}${review}${means ? `; ${means}` : ""}`
}

function abbr(dimension: string): string {
  const map: Record<string, string> = {
    commercialPacing: "pace",
    dramatization: "drama",
    sceneDramaturgy: "scene",
    motivationSpecificity: "motive",
    payoffPropulsion: "payoff",
    povVoice: "voice",
    worldFactPressure: "world",
    relationshipDelta: "rel",
  }
  return map[dimension] ?? dimension
}

function escapeCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ")
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function compareChapterLabels(a: string, b: string): number {
  const aNumber = Number(a)
  const bNumber = Number(b)
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber
  return a.localeCompare(b)
}

function writeOutput(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

if (import.meta.main) {
  try {
    const args = parseArgs()
    const report = buildCorpusRecreationAggregate(args.pocDirs)
    const rendered = renderCorpusRecreationAggregate(report)
    if (args.output) writeOutput(args.output, rendered)
    if (args.json) writeOutput(args.json, `${JSON.stringify(report, null, 2)}\n`)
    writeManifestIfArtifactProduced(args, report)
    console.log(rendered)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

function writeManifestIfArtifactProduced(args: Args, report: CorpusRecreationAggregateReport): void {
  const primaryOutput = args.json ?? args.output
  if (!primaryOutput) return
  const parentManifests = args.pocDirs
    .map(dir => parentManifestForPocDir(dir))
    .filter((manifest): manifest is NonNullable<typeof manifest> => Boolean(manifest))
  writeRunManifest(manifestPathForSidecar(primaryOutput), buildRunManifest({
    generatedAt: report.generatedAt,
    laneId: "run-thread-id-drafting-coherence",
    phase: "corpus-recreation-aggregate",
    variantId: "aggregate",
    parentRunId: parentManifests.length === 1 ? parentManifests[0]!.runId : null,
    rootRunId: parentManifests.length === 1 ? parentManifests[0]!.rootRunId : null,
    command: {
      name: "diagnostics:corpus-recreation-aggregate",
      argv: process.argv.slice(2),
    },
    inputs: aggregateInputRefs(args.pocDirs),
    outputs: existingArtifactRefs([
      ...(args.output ? [{ path: args.output, role: "aggregate-markdown" }] : []),
      ...(args.json ? [{ path: args.json, role: "aggregate-json" }] : []),
    ]),
    relatedRunIds: parentManifests.map(manifest => manifest.runId),
    discriminator: `rows-${report.rowCount}`,
    metadata: {
      pocDirs: args.pocDirs,
      rowCount: report.rowCount,
    },
  }))
}

function aggregateInputRefs(pocDirs: string[]) {
  return pocDirs.flatMap(dir => {
    const resolved = resolve(dir)
    return existingArtifactRefs([
      { path: `${resolved}/run-manifest.json`, role: "parent-run-manifest" },
      { path: `${resolved}/packet.json`, role: "packet" },
      { path: `${resolved}/plan-comparison.json`, role: "plan-comparison" },
      { path: `${resolved}/chapter-comparison.json`, role: "chapter-comparison" },
      { path: `${resolved}/character-context.json`, role: "character-context-json" },
      { path: `${resolved}/semantic-review/semantic-review.json`, role: "semantic-review-json" },
      { path: `${resolved}/semantic-review-live/semantic-review.json`, role: "semantic-review-json" },
      { path: `${resolved}/prose-quality-live/prose-review.json`, role: "prose-review-json" },
    ])
  })
}
