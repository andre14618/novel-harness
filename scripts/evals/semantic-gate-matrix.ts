#!/usr/bin/env bun
/**
 * Parallel disposable matrix runner for semantic-gate evidence.
 *
 * Each variant invokes `semantic-gate-baseline.ts` as an isolated child
 * process. The parent owns bounded concurrency and the combined artifact
 * contract; the baseline runner owns clone/cap/run/report/cleanup.
 */

import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"

import type { SemanticGateBaselineReport } from "./semantic-gate-baseline"

export interface Args {
  source: string
  chapters: number
  outputBase: string
  variants: MatrixVariant[]
  parallel: number
  keepNovels: boolean
  continuityEditorialFlagProposals: boolean
}

export interface MatrixVariant {
  id: string
  label: string
  maxBeatsPerChapter: number | null
}

export interface MatrixVariantResult {
  variant: MatrixVariant
  status: "reported" | "failed"
  exitCode: number | null
  signal: string | null
  outputBase: string
  targetNovelId: string
  command: string[]
  stdoutPath: string
  stderrPath: string
  summaryPath: string
  reportPath: string
  error: string | null
  baseline: SemanticGateBaselineReport | null
  assessment: MatrixVariantAssessment
}

export interface MatrixVariantAssessment {
  completed: boolean
  approvedChapters: number
  requestedChapters: number
  terminalStatus: string
  totalWords: number
  draftedTargetWords: number
  wordRatio: number | null
  meanChapterWordRatio: number | null
  semanticSignals: Record<string, number>
  pendingPlanAssistGate: boolean
  proposalCount: number
  actionCount: number
  llmCalls: number
  failedLlmCalls: number
  costUsd: number
  riskScore: number
  reasons: string[]
}

export interface SemanticGateMatrixReport {
  generatedAt: string
  sourceNovelId: string
  chapters: number
  outputBase: string
  parallel: number
  variants: MatrixVariantResult[]
  ranking: Array<{
    variantId: string
    label: string
    riskScore: number
    completed: boolean
    wordRatio: number | null
    costUsd: number
    reasons: string[]
  }>
  totals: {
    variants: number
    completed: number
    failed: number
    cleanPass: number
    costUsd: number
    llmCalls: number
  }
}

const DEFAULT_VARIANTS = ["beats=4", "beats=5", "beats=6"]

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

  const source = lastString(map.source)
  if (!source) throw new Error("--source is required")
  const chapters = positiveInt(lastValue(map.chapters), "--chapters", 2)
  const parallel = positiveInt(lastValue(map.parallel), "--parallel", 2)
  const variantSpecs = (map.variant ?? DEFAULT_VARIANTS) as Array<string | true>
  const variants = variantSpecs.map((value, index) => parseVariantSpec(value, index))
  const duplicate = firstDuplicate(variants.map(variant => variant.id))
  if (duplicate) throw new Error(`duplicate variant id: ${duplicate}`)

  const rawOutput = lastString(map["output-base"]) ??
    join("output", "evals", "semantic-gate-matrix", `${safeSlug(source)}-${stamp()}`)
  return {
    source,
    chapters,
    outputBase: isAbsolute(rawOutput) ? rawOutput : resolve(process.cwd(), rawOutput),
    variants,
    parallel,
    keepNovels: boolOpt(lastValue(map["keep-novels"])),
    continuityEditorialFlagProposals:
      boolOpt(lastValue(map["continuity-editorial-flags"]) ?? lastValue(map["continuity-editorial-flag-proposals"])),
  }
}

export function parseVariantSpec(value: string | true, index = 0): MatrixVariant {
  if (value === true) throw new Error("--variant requires a value")
  const raw = value.trim()
  if (raw.length === 0) throw new Error("--variant cannot be empty")
  const [maybeLabel, spec] = raw.includes(":")
    ? raw.split(/:(.*)/s).filter(Boolean) as [string, string]
    : [`variant-${index + 1}`, raw]
  const trimmedSpec = spec.trim()
  const labelPrefix = maybeLabel.trim()

  if (trimmedSpec === "source" || trimmedSpec === "source-outline" || trimmedSpec === "beats=source") {
    const label = labelPrefix.startsWith("variant-") ? "source outline" : labelPrefix
    return {
      id: safeSlug(label),
      label,
      maxBeatsPerChapter: null,
    }
  }

  const beats = trimmedSpec.match(/^beats=(\d+)$/)
  if (beats) {
    const maxBeats = Number.parseInt(beats[1]!, 10)
    const label = labelPrefix.startsWith("variant-") ? `beats ${maxBeats}` : labelPrefix
    return {
      id: safeSlug(label),
      label,
      maxBeatsPerChapter: maxBeats,
    }
  }

  throw new Error(`unsupported variant spec: ${raw}`)
}

export function buildVariantAssessment(
  baseline: SemanticGateBaselineReport | null,
  requestedChapters: number,
): MatrixVariantAssessment {
  if (!baseline) {
    return {
      completed: false,
      approvedChapters: 0,
      requestedChapters,
      terminalStatus: "missing-summary",
      totalWords: 0,
      draftedTargetWords: 0,
      wordRatio: null,
      meanChapterWordRatio: null,
      semanticSignals: {},
      pendingPlanAssistGate: false,
      proposalCount: 0,
      actionCount: 0,
      llmCalls: 0,
      failedLlmCalls: 0,
      costUsd: 0,
      riskScore: 1000,
      reasons: ["missing baseline summary"],
    }
  }

  const chapters = baseline.checker.semanticGate.chapters
  const draftedTargets = chapters
    .filter(chapter => chapter.draftWords !== null && chapter.targetWords !== null)
    .reduce((sum, chapter) => sum + (chapter.targetWords ?? 0), 0)
  const chapterRatios = chapters
    .flatMap(chapter => chapter.wordRatio === null ? [] : [chapter.wordRatio])
  const pendingPlanAssistGate = baseline.terminal.status === "pending-plan-assist" ||
    Boolean(baseline.terminal.latestPlanAssistGate?.pending)
  const completed = baseline.novel.completed &&
    baseline.drafts.approvedChapters >= requestedChapters
  const reasons = assessmentReasons({
    baseline,
    completed,
    pendingPlanAssistGate,
    chapterRatios,
  })
  const meanChapterWordRatio = chapterRatios.length === 0
    ? null
    : chapterRatios.reduce((sum, ratio) => sum + ratio, 0) / chapterRatios.length
  const wordRatio = draftedTargets > 0 ? baseline.drafts.totalWords / draftedTargets : null
  const riskScore = riskScoreFor({
    completed,
    pendingPlanAssistGate,
    signalCounts: baseline.checker.semanticGate.totals.bySignal,
    wordRatio,
    failedLlmCalls: baseline.llm.failedCalls,
  })

  return {
    completed,
    approvedChapters: baseline.drafts.approvedChapters,
    requestedChapters,
    terminalStatus: baseline.terminal.status,
    totalWords: baseline.drafts.totalWords,
    draftedTargetWords: draftedTargets,
    wordRatio,
    meanChapterWordRatio,
    semanticSignals: baseline.checker.semanticGate.totals.bySignal,
    pendingPlanAssistGate,
    proposalCount: baseline.proposals.total,
    actionCount: baseline.checker.actionEvidence.total,
    llmCalls: baseline.llm.calls,
    failedLlmCalls: baseline.llm.failedCalls,
    costUsd: baseline.llm.costUsd,
    riskScore,
    reasons,
  }
}

export function buildMatrixReport(input: {
  sourceNovelId: string
  chapters: number
  outputBase: string
  parallel: number
  variants: MatrixVariantResult[]
  generatedAt?: string
}): SemanticGateMatrixReport {
  const ranking = [...input.variants]
    .sort((a, b) =>
      a.assessment.riskScore - b.assessment.riskScore ||
      a.assessment.costUsd - b.assessment.costUsd ||
      a.variant.id.localeCompare(b.variant.id)
    )
    .map(result => ({
      variantId: result.variant.id,
      label: result.variant.label,
      riskScore: result.assessment.riskScore,
      completed: result.assessment.completed,
      wordRatio: result.assessment.wordRatio,
      costUsd: result.assessment.costUsd,
      reasons: result.assessment.reasons,
    }))

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    sourceNovelId: input.sourceNovelId,
    chapters: input.chapters,
    outputBase: input.outputBase,
    parallel: input.parallel,
    variants: input.variants,
    ranking,
    totals: {
      variants: input.variants.length,
      completed: input.variants.filter(result => result.assessment.completed).length,
      failed: input.variants.filter(result => result.status === "failed").length,
      cleanPass: input.variants.filter(result =>
        result.assessment.completed &&
        !result.assessment.pendingPlanAssistGate &&
        (result.assessment.semanticSignals.checker_blocker ?? 0) === 0 &&
        (result.assessment.semanticSignals.plan_adherence_drift ?? 0) === 0
      ).length,
      costUsd: input.variants.reduce((sum, result) => sum + result.assessment.costUsd, 0),
      llmCalls: input.variants.reduce((sum, result) => sum + result.assessment.llmCalls, 0),
    },
  }
}

export function renderMatrixReport(report: SemanticGateMatrixReport): string {
  const lines: string[] = []
  lines.push("# Semantic Gate Matrix")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Source: ${report.sourceNovelId}`)
  lines.push(`Chapters: ${report.chapters}`)
  lines.push(`Parallel: ${report.parallel}`)
  lines.push(`Output: ${report.outputBase}`)
  lines.push("")
  lines.push("## Totals")
  lines.push(
    `Variants: ${report.totals.variants}; completed=${report.totals.completed}; ` +
      `cleanPass=${report.totals.cleanPass}; failed=${report.totals.failed}; ` +
      `calls=${report.totals.llmCalls}; cost=$${report.totals.costUsd.toFixed(4)}`,
  )
  lines.push("")
  lines.push("## Ranking")
  for (const ranked of report.ranking) {
    lines.push(
      `- ${ranked.label}: risk=${formatNullable(ranked.riskScore, 2)}, ` +
        `completed=${ranked.completed}, wordRatio=${formatNullable(ranked.wordRatio, 2)}, ` +
        `cost=$${ranked.costUsd.toFixed(4)}; ${ranked.reasons.join("; ")}`,
    )
  }
  lines.push("")
  lines.push("## Variants")
  for (const result of report.variants) {
    const a = result.assessment
    const signals = Object.entries(a.semanticSignals)
      .map(([key, value]) => `${key}=${value}`)
      .join(", ")
    lines.push("")
    lines.push(`### ${result.variant.label}`)
    lines.push(`Status: ${result.status}; exit=${String(result.exitCode)}; terminal=${a.terminalStatus}`)
    lines.push(
      `Approved: ${a.approvedChapters}/${a.requestedChapters}; words=${a.totalWords}; ` +
        `wordRatio=${formatNullable(a.wordRatio, 2)}; actions=${a.actionCount}; proposals=${a.proposalCount}`,
    )
    lines.push(`Signals: ${signals || "(none)"}`)
    lines.push(`Artifact: ${result.reportPath}`)
    if (result.error) lines.push(`Error: ${result.error}`)
  }
  return lines.join("\n")
}

export async function runBounded<T, R>(
  items: readonly T[],
  parallel: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(parallel, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index]!, index)
    }
  })
  await Promise.all(workers)
  return results
}

async function runVariant(args: Args, variant: MatrixVariant, index: number): Promise<MatrixVariantResult> {
  const variantOutputBase = join(args.outputBase, "variants", variant.id)
  mkdirSync(variantOutputBase, { recursive: true })
  const targetNovelId = `semantic-gate-matrix-${stamp()}-${safeSlug(args.source)}-${index + 1}-${variant.id}`
  const summaryPath = join(variantOutputBase, "summary.json")
  const reportPath = join(variantOutputBase, "report.md")
  const stdoutPath = join(variantOutputBase, "matrix.stdout.log")
  const stderrPath = join(variantOutputBase, "matrix.stderr.log")
  const command = [
    "scripts/evals/semantic-gate-baseline.ts",
    "--source", args.source,
    "--chapters", String(args.chapters),
    "--output-base", variantOutputBase,
    "--target", targetNovelId,
    ...(variant.maxBeatsPerChapter == null ? [] : ["--max-beats-per-chapter", String(variant.maxBeatsPerChapter)]),
    ...(args.keepNovels ? ["--keep-novel"] : []),
    ...(args.continuityEditorialFlagProposals ? ["--continuity-editorial-flag-proposals"] : []),
  ]

  const processResult = await spawnBun(command)
  writeFileSync(stdoutPath, processResult.stdout)
  writeFileSync(stderrPath, processResult.stderr)

  let baseline: SemanticGateBaselineReport | null = null
  let error: string | null = null
  if (existsSync(summaryPath)) {
    try {
      baseline = JSON.parse(readFileSync(summaryPath, "utf8")) as SemanticGateBaselineReport
    } catch (err) {
      error = `failed to parse summary.json: ${err instanceof Error ? err.message : String(err)}`
    }
  } else {
    error = `missing summary.json; exit=${String(processResult.exitCode)}, signal=${processResult.signal ?? "none"}`
  }

  return {
    variant,
    status: baseline ? "reported" : "failed",
    exitCode: processResult.exitCode,
    signal: processResult.signal,
    outputBase: variantOutputBase,
    targetNovelId,
    command,
    stdoutPath,
    stderrPath,
    summaryPath,
    reportPath,
    error,
    baseline,
    assessment: buildVariantAssessment(baseline, args.chapters),
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

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(
      "usage: bun scripts/evals/semantic-gate-matrix.ts --source <novel> " +
        "[--chapters 2] [--variant beats=4] [--variant beats=5] [--variant source] " +
        "[--parallel 2] [--output-base output/evals/...] [--keep-novels]",
    )
    return 2
  }

  mkdirSync(args.outputBase, { recursive: true })
  writeFileSync(join(args.outputBase, "manifest.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceNovelId: args.source,
    chapters: args.chapters,
    parallel: args.parallel,
    variants: args.variants,
    keepNovels: args.keepNovels,
    continuityEditorialFlagProposals: args.continuityEditorialFlagProposals,
  }, null, 2))

  const results = await runBounded(args.variants, args.parallel, (variant, index) => runVariant(args, variant, index))
  const report = buildMatrixReport({
    sourceNovelId: args.source,
    chapters: args.chapters,
    outputBase: args.outputBase,
    parallel: args.parallel,
    variants: results,
  })
  const jsonPath = join(args.outputBase, "summary.json")
  const markdownPath = join(args.outputBase, "report.md")
  writeFileSync(jsonPath, JSON.stringify(report, null, 2))
  writeFileSync(markdownPath, renderMatrixReport(report))
  console.log(renderMatrixReport(report))
  console.log(`\nWrote ${jsonPath}`)
  console.log(`Wrote ${markdownPath}`)
  return results.some(result => result.status === "failed") ? 1 : 0
}

function assessmentReasons(input: {
  baseline: SemanticGateBaselineReport
  completed: boolean
  pendingPlanAssistGate: boolean
  chapterRatios: readonly number[]
}): string[] {
  const reasons: string[] = []
  if (!input.completed) reasons.push(`terminal=${input.baseline.terminal.status}`)
  if (input.pendingPlanAssistGate) reasons.push("pending plan-assist gate")
  const signals = input.baseline.checker.semanticGate.totals.bySignal
  if ((signals.plan_adherence_drift ?? 0) > 0) reasons.push(`${signals.plan_adherence_drift} plan-drift chapter(s)`)
  if ((signals.checker_blocker ?? 0) > 0) reasons.push(`${signals.checker_blocker} checker-blocker chapter(s)`)
  if ((signals.writer_expansion ?? 0) > 0) reasons.push(`${signals.writer_expansion} writer-expansion chapter(s)`)
  if ((signals.outline_shape ?? 0) > 0) reasons.push(`${signals.outline_shape} outline-shape chapter(s)`)
  if ((signals.no_draft ?? 0) > 0) reasons.push(`${signals.no_draft} no-draft chapter(s)`)
  if (input.baseline.llm.failedCalls > 0) reasons.push(`${input.baseline.llm.failedCalls} failed LLM call(s)`)
  if (reasons.length === 0) reasons.push("completed without semantic-gate signals")
  return reasons
}

function riskScoreFor(input: {
  completed: boolean
  pendingPlanAssistGate: boolean
  signalCounts: Record<string, number>
  wordRatio: number | null
  failedLlmCalls: number
}): number {
  let score = 0
  if (!input.completed) score += 1000
  if (input.pendingPlanAssistGate) score += 500
  score += (input.signalCounts.checker_blocker ?? 0) * 100
  score += (input.signalCounts.plan_adherence_drift ?? 0) * 80
  score += (input.signalCounts.no_draft ?? 0) * 60
  score += (input.signalCounts.writer_expansion ?? 0) * 15
  score += (input.signalCounts.outline_shape ?? 0) * 5
  score += input.failedLlmCalls * 25
  if (input.wordRatio !== null) score += Math.abs(input.wordRatio - 1) * 10
  return score
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

function firstDuplicate(values: readonly string[]): string | null {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) return value
    seen.add(value)
  }
  return null
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "variant"
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
