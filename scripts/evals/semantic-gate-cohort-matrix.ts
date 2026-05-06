#!/usr/bin/env bun
/**
 * Cohort-level semantic-gate matrix runner/aggregator.
 *
 * Use this when a single source novel or one matrix run is not enough evidence
 * to judge a runtime lever. It can either aggregate existing matrix summaries
 * with `--summary <path>` or run the same variant set across multiple sources
 * / replicates and then aggregate the child matrix artifacts.
 */

import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"

import {
  parseVariantSpec,
  runBounded,
  type MatrixVariant,
  type MatrixVariantResult,
  type RiskScoreComponent,
  type SemanticGateMatrixReport,
} from "./semantic-gate-matrix"

const DEFAULT_VARIANT_SPECS = ["beats=4", "beats=5", "beats=6"]

export interface Args {
  sources: string[]
  summaries: string[]
  candidateReports: string[]
  candidateLimit: number | null
  chapters: number
  outputBase: string
  variantSpecs: string[]
  variants: MatrixVariant[]
  replicates: number
  parallelSources: number
  parallelVariants: number
  keepNovels: boolean
  continuityEditorialFlagProposals: boolean
}

export interface CohortMatrixRun {
  sourceNovelId: string
  replicate: number | null
  status: "reported" | "failed"
  outputBase: string
  command: string[]
  stdoutPath: string | null
  stderrPath: string | null
  summaryPath: string
  reportPath: string
  error: string | null
  matrix: SemanticGateMatrixReport | null
}

export interface CohortVariantAggregate {
  variantId: string
  label: string
  runs: number
  reported: number
  completed: number
  failed: number
  cleanPass: number
  meanRiskScore: number | null
  meanWordRatio: number | null
  totalCostUsd: number
  totalLlmCalls: number
  semanticSignals: Record<string, number>
  riskDrivers: Record<string, number>
  terminalStatuses: Record<string, number>
  reasons: Record<string, number>
}

export interface SemanticGateCohortMatrixReport {
  generatedAt: string
  chapters: number
  outputBase: string
  variantSpecs: string[]
  runs: CohortMatrixRun[]
  variants: CohortVariantAggregate[]
  ranking: Array<{
    variantId: string
    label: string
    meanRiskScore: number | null
    completed: number
    runs: number
    cleanPass: number
    meanWordRatio: number | null
    totalCostUsd: number
    topReasons: string[]
    topRiskDrivers: string[]
  }>
  totals: {
    matrixRuns: number
    reportedMatrices: number
    failedMatrices: number
    variantRuns: number
    completedVariantRuns: number
    failedVariantRuns: number
    cleanPass: number
    costUsd: number
    llmCalls: number
  }
}

export function parseArgs(argv: string[]): Args {
  const map: Record<string, Array<string | true>> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const eq = arg.match(/^--([^=]+)=(.*)$/)
    if (eq) {
      pushArg(map, eq[1]!, eq[2]!)
      continue
    }
    if (!arg.startsWith("--")) throw new Error(`unknown arg: ${arg}`)
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith("--")) {
      pushArg(map, key, next)
      i++
    } else {
      pushArg(map, key, true)
    }
  }

  const sources = stringValues(map.source)
  const summaries = stringValues(map.summary).map(path => isAbsolute(path) ? path : resolve(process.cwd(), path))
  const candidateReports = stringValues(map["candidate-report"]).map(path =>
    isAbsolute(path) ? path : resolve(process.cwd(), path)
  )
  if (sources.length === 0 && summaries.length === 0 && candidateReports.length === 0) {
    throw new Error("at least one --source, --summary, or --candidate-report is required")
  }
  const variantSpecs = stringValues(map.variant)
  const effectiveVariantSpecs = variantSpecs.length > 0 ? variantSpecs : DEFAULT_VARIANT_SPECS
  const variants = effectiveVariantSpecs.map((value, index) => parseVariantSpec(value, index))
  const duplicate = firstDuplicate(variants.map(variant => variant.id))
  if (duplicate) throw new Error(`duplicate variant id: ${duplicate}`)

  const rawOutput = lastString(map["output-base"]) ??
    join("output", "evals", "semantic-gate-cohort-matrix", `cohort-${stamp()}`)
  return {
    sources,
    summaries,
    candidateReports,
    candidateLimit: optionalPositiveInt(lastValue(map["candidate-limit"]), "--candidate-limit"),
    chapters: positiveInt(lastValue(map.chapters), "--chapters", 2),
    outputBase: isAbsolute(rawOutput) ? rawOutput : resolve(process.cwd(), rawOutput),
    variantSpecs: effectiveVariantSpecs,
    variants,
    replicates: positiveInt(lastValue(map.replicates), "--replicates", 1),
    parallelSources: positiveInt(lastValue(map["parallel-sources"]), "--parallel-sources", 2),
    parallelVariants: positiveInt(lastValue(map["parallel-variants"]), "--parallel-variants", 2),
    keepNovels: boolOpt(lastValue(map["keep-novels"])),
    continuityEditorialFlagProposals:
      boolOpt(lastValue(map["continuity-editorial-flags"]) ?? lastValue(map["continuity-editorial-flag-proposals"])),
  }
}

export function buildCohortReport(input: {
  chapters: number
  outputBase: string
  variantSpecs: string[]
  runs: CohortMatrixRun[]
  generatedAt?: string
}): SemanticGateCohortMatrixReport {
  const variants = aggregateVariants(input.runs)
  const ranking = [...variants]
    .sort((a, b) =>
      nullableSort(a.meanRiskScore, b.meanRiskScore) ||
      b.completed - a.completed ||
      a.totalCostUsd - b.totalCostUsd ||
      a.variantId.localeCompare(b.variantId)
    )
    .map(variant => ({
      variantId: variant.variantId,
      label: variant.label,
      meanRiskScore: variant.meanRiskScore,
      completed: variant.completed,
      runs: variant.runs,
      cleanPass: variant.cleanPass,
      meanWordRatio: variant.meanWordRatio,
      totalCostUsd: variant.totalCostUsd,
      topReasons: topEntries(variant.reasons, 4),
      topRiskDrivers: topEntries(variant.riskDrivers, 4),
    }))

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    chapters: input.chapters,
    outputBase: input.outputBase,
    variantSpecs: input.variantSpecs,
    runs: input.runs,
    variants,
    ranking,
    totals: {
      matrixRuns: input.runs.length,
      reportedMatrices: input.runs.filter(run => run.status === "reported").length,
      failedMatrices: input.runs.filter(run => run.status === "failed").length,
      variantRuns: variants.reduce((sum, variant) => sum + variant.runs, 0),
      completedVariantRuns: variants.reduce((sum, variant) => sum + variant.completed, 0),
      failedVariantRuns: variants.reduce((sum, variant) => sum + variant.failed, 0),
      cleanPass: variants.reduce((sum, variant) => sum + variant.cleanPass, 0),
      costUsd: variants.reduce((sum, variant) => sum + variant.totalCostUsd, 0),
      llmCalls: variants.reduce((sum, variant) => sum + variant.totalLlmCalls, 0),
    },
  }
}

export function renderCohortReport(report: SemanticGateCohortMatrixReport): string {
  const lines: string[] = []
  lines.push("# Semantic Gate Cohort Matrix")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Chapters: ${report.chapters}`)
  lines.push(`Output: ${report.outputBase}`)
  lines.push(`Variants: ${report.variantSpecs.join(", ")}`)
  lines.push("")
  lines.push("## Totals")
  lines.push(
    `Matrix runs: ${report.totals.reportedMatrices}/${report.totals.matrixRuns} reported; ` +
      `variantRuns=${report.totals.variantRuns}; completed=${report.totals.completedVariantRuns}; ` +
      `cleanPass=${report.totals.cleanPass}; failed=${report.totals.failedVariantRuns}; ` +
      `calls=${report.totals.llmCalls}; cost=$${report.totals.costUsd.toFixed(4)}`,
  )
  lines.push("")
  lines.push("## Ranking")
  for (const ranked of report.ranking) {
    lines.push(
      `- ${ranked.label}: meanRisk=${formatNullable(ranked.meanRiskScore, 2)}, ` +
        `completed=${ranked.completed}/${ranked.runs}, cleanPass=${ranked.cleanPass}, ` +
        `meanWordRatio=${formatNullable(ranked.meanWordRatio, 2)}, ` +
        `cost=$${ranked.totalCostUsd.toFixed(4)}; ` +
        `drivers=${ranked.topRiskDrivers.join(", ") || "none"}; ` +
        `${ranked.topReasons.join("; ") || "no reasons"}`,
    )
  }
  lines.push("")
  lines.push("## Matrix Runs")
  for (const run of report.runs) {
    lines.push(
      `- ${run.sourceNovelId}${run.replicate === null ? "" : ` r${run.replicate}`}: ` +
        `${run.status}; summary=${run.summaryPath}${run.error ? `; error=${run.error}` : ""}`,
    )
  }
  return lines.join("\n")
}

export function candidateSourcesFromReportJson(text: string, limit: number | null = null): string[] {
  const parsed = JSON.parse(text) as { candidates?: unknown }
  if (!Array.isArray(parsed.candidates)) throw new Error("candidate report missing candidates array")
  const sources = parsed.candidates.flatMap(candidate => {
    if (!candidate || typeof candidate !== "object") return []
    const novelId = (candidate as Record<string, unknown>).novelId
    return typeof novelId === "string" && novelId.trim().length > 0 ? [novelId] : []
  })
  return limit === null ? sources : sources.slice(0, limit)
}

function aggregateVariants(runs: readonly CohortMatrixRun[]): CohortVariantAggregate[] {
  const buckets = new Map<string, {
    label: string
    results: MatrixVariantResult[]
  }>()

  for (const run of runs) {
    if (!run.matrix) continue
    for (const result of run.matrix.variants) {
      const bucket = buckets.get(result.variant.id) ?? { label: result.variant.label, results: [] }
      bucket.results.push(result)
      buckets.set(result.variant.id, bucket)
    }
  }

  return [...buckets.entries()].map(([variantId, bucket]) => {
    const risks = bucket.results.map(result => result.assessment.riskScore)
    const wordRatios = bucket.results.flatMap(result =>
      result.assessment.wordRatio === null ? [] : [result.assessment.wordRatio]
    )
    const semanticSignals: Record<string, number> = {}
    const riskDrivers: Record<string, number> = {}
    const terminalStatuses: Record<string, number> = {}
    const reasons: Record<string, number> = {}
    let cleanPass = 0

    for (const result of bucket.results) {
      increment(terminalStatuses, result.assessment.terminalStatus)
      for (const [signal, count] of Object.entries(result.assessment.semanticSignals)) {
        semanticSignals[signal] = (semanticSignals[signal] ?? 0) + count
      }
      for (const component of riskBreakdownForResult(result)) {
        riskDrivers[component.label] = (riskDrivers[component.label] ?? 0) + component.points
      }
      for (const reason of result.assessment.reasons) increment(reasons, reason)
      if (isCleanPass(result)) cleanPass++
    }

    return {
      variantId,
      label: bucket.label,
      runs: bucket.results.length,
      reported: bucket.results.filter(result => result.status === "reported").length,
      completed: bucket.results.filter(result => result.assessment.completed).length,
      failed: bucket.results.filter(result => result.status === "failed").length,
      cleanPass,
      meanRiskScore: mean(risks),
      meanWordRatio: mean(wordRatios),
      totalCostUsd: bucket.results.reduce((sum, result) => sum + result.assessment.costUsd, 0),
      totalLlmCalls: bucket.results.reduce((sum, result) => sum + result.assessment.llmCalls, 0),
      semanticSignals,
      riskDrivers,
      terminalStatuses,
      reasons,
    }
  })
}

function riskBreakdownForResult(result: MatrixVariantResult): RiskScoreComponent[] {
  const unknownAssessment = result.assessment as MatrixVariantResult["assessment"] & {
    riskBreakdown?: RiskScoreComponent[]
  }
  return unknownAssessment.riskBreakdown ?? []
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(
      "usage: bun scripts/evals/semantic-gate-cohort-matrix.ts " +
        "[--source <novel> ...] [--summary <matrix-summary.json> ...] [--candidate-report <json> ...] " +
        "[--chapters 2] [--replicates 1] [--variant beats=4] [--parallel-sources 2] [--parallel-variants 2]",
    )
    return 2
  }

  mkdirSync(args.outputBase, { recursive: true })
  writeFileSync(join(args.outputBase, "manifest.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    sources: args.sources,
    summaries: args.summaries,
    candidateReports: args.candidateReports,
    candidateLimit: args.candidateLimit,
    chapters: args.chapters,
    replicates: args.replicates,
    parallelSources: args.parallelSources,
    parallelVariants: args.parallelVariants,
    variantSpecs: args.variantSpecs,
    variants: args.variants,
    keepNovels: args.keepNovels,
    continuityEditorialFlagProposals: args.continuityEditorialFlagProposals,
  }, null, 2))

  const candidateSources = loadCandidateSources(args.candidateReports, args.candidateLimit)
  const liveSources = uniqueStrings([...args.sources, ...candidateSources])
  const summaryRuns = args.summaries.map(path => loadSummaryRun(path))
  const liveRuns = liveSources.length > 0
    ? await runLiveMatrices({ ...args, sources: liveSources })
    : []
  const report = buildCohortReport({
    chapters: args.chapters,
    outputBase: args.outputBase,
    variantSpecs: args.variantSpecs,
    runs: [...summaryRuns, ...liveRuns],
  })

  const jsonPath = join(args.outputBase, "summary.json")
  const markdownPath = join(args.outputBase, "report.md")
  writeFileSync(jsonPath, JSON.stringify(report, null, 2))
  writeFileSync(markdownPath, renderCohortReport(report))
  console.log(renderCohortReport(report))
  console.log(`\nWrote ${jsonPath}`)
  console.log(`Wrote ${markdownPath}`)
  return report.totals.failedMatrices > 0 ? 1 : 0
}

async function runLiveMatrices(args: Args): Promise<CohortMatrixRun[]> {
  const tasks = args.sources.flatMap(source =>
    Array.from({ length: args.replicates }, (_, index) => ({ source, replicate: index + 1 }))
  )
  return await runBounded(tasks, args.parallelSources, (task) => runMatrixChild(args, task.source, task.replicate))
}

async function runMatrixChild(args: Args, source: string, replicate: number): Promise<CohortMatrixRun> {
  const runId = `${safeSlug(source)}-r${replicate}`
  const outputBase = join(args.outputBase, "matrices", runId)
  mkdirSync(outputBase, { recursive: true })
  const stdoutPath = join(outputBase, "cohort-matrix.stdout.log")
  const stderrPath = join(outputBase, "cohort-matrix.stderr.log")
  const summaryPath = join(outputBase, "summary.json")
  const reportPath = join(outputBase, "report.md")
  const command = [
    "scripts/evals/semantic-gate-matrix.ts",
    "--source", source,
    "--chapters", String(args.chapters),
    "--output-base", outputBase,
    "--parallel", String(args.parallelVariants),
    ...args.variantSpecs.flatMap(spec => ["--variant", spec]),
    ...(args.keepNovels ? ["--keep-novels"] : []),
    ...(args.continuityEditorialFlagProposals ? ["--continuity-editorial-flag-proposals"] : []),
  ]
  const processResult = await spawnBun(command)
  writeFileSync(stdoutPath, processResult.stdout)
  writeFileSync(stderrPath, processResult.stderr)
  const loaded = loadMatrixSummary(summaryPath)
  return {
    sourceNovelId: loaded.matrix?.sourceNovelId ?? source,
    replicate,
    status: loaded.matrix ? "reported" : "failed",
    outputBase,
    command,
    stdoutPath,
    stderrPath,
    summaryPath,
    reportPath,
    error: loaded.error ?? (processResult.exitCode === 0 ? null : `matrix exited ${String(processResult.exitCode)}`),
    matrix: loaded.matrix,
  }
}

function loadSummaryRun(summaryPath: string): CohortMatrixRun {
  const loaded = loadMatrixSummary(summaryPath)
  const outputBase = summaryPath.replace(/\/summary\.json$/, "")
  return {
    sourceNovelId: loaded.matrix?.sourceNovelId ?? "unknown-source",
    replicate: null,
    status: loaded.matrix ? "reported" : "failed",
    outputBase,
    command: [],
    stdoutPath: null,
    stderrPath: null,
    summaryPath,
    reportPath: join(outputBase, "report.md"),
    error: loaded.error,
    matrix: loaded.matrix,
  }
}

function loadCandidateSources(paths: readonly string[], limit: number | null): string[] {
  return paths.flatMap(path => candidateSourcesFromReportJson(readFileSync(path, "utf8"), limit))
}

function loadMatrixSummary(summaryPath: string): { matrix: SemanticGateMatrixReport | null; error: string | null } {
  if (!existsSync(summaryPath)) return { matrix: null, error: "summary.json not found" }
  try {
    return { matrix: JSON.parse(readFileSync(summaryPath, "utf8")) as SemanticGateMatrixReport, error: null }
  } catch (err) {
    return { matrix: null, error: `failed to parse summary.json: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function spawnBun(command: string[]): Promise<{
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}> {
  return await new Promise(resolve => {
    const child = spawn("bun", command, {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", chunk => stdout.push(Buffer.from(chunk)))
    child.stderr.on("data", chunk => stderr.push(Buffer.from(chunk)))
    child.on("error", err => {
      stderr.push(Buffer.from(err.stack ?? err.message))
      resolve({
        exitCode: null,
        signal: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      })
    })
    child.on("close", (exitCode, signal) => {
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      })
    })
  })
}

function isCleanPass(result: MatrixVariantResult): boolean {
  return result.assessment.completed &&
    !result.assessment.pendingPlanAssistGate &&
    (result.assessment.semanticSignals.checker_blocker ?? 0) === 0 &&
    (result.assessment.semanticSignals.plan_adherence_drift ?? 0) === 0
}

function pushArg(map: Record<string, Array<string | true>>, key: string, value: string | true): void {
  ;(map[key] ??= []).push(value)
}

function lastValue(values: Array<string | true> | undefined): string | true | undefined {
  return values?.[values.length - 1]
}

function lastString(values: Array<string | true> | undefined): string | undefined {
  const value = lastValue(values)
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function stringValues(values: Array<string | true> | undefined): string[] {
  return (values ?? []).flatMap(value =>
    typeof value === "string" && value.trim().length > 0 ? [value] : []
  )
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

function firstDuplicate(values: readonly string[]): string | null {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) return value
    seen.add(value)
  }
  return null
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function nullableSort(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

function topEntries(record: Record<string, number>, limit: number): string[] {
  return Object.entries(record)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => `${key} (${count})`)
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "run"
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "").replace(/T/, "T").replace(/Z$/, "")
}

function formatNullable(value: number | null, digits: number): string {
  return value === null ? "?" : value.toFixed(digits)
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
