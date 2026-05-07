#!/usr/bin/env bun
/**
 * Multi-concept planner-only cohort for method-pack diagnostics.
 *
 * This stays upstream: concept/planning contracts only, no drafting, no
 * checker policy, no UI. Replicates are independent live planner samples
 * against frozen concepts so we can see whether a method pack consistently
 * improves plan shape instead of overfitting one example.
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"

import {
  buildDiagnosticReport,
  loadFixture,
  loadFixtureArms,
  renderDiagnosticReport,
  runLiveArms,
  type DiagnosticReport,
} from "./method-pack-planner-diagnostic"

interface Args {
  live: boolean
  json: boolean
  fixtureDir: string
  fixturePaths: string[]
  outputDir: string | null
  replicates: number
  concurrency: number
  scenesPerChapter: number
  obligationsPerChapter: number
  includePro: boolean
  proReplicates: number
}

interface CohortCell {
  fixturePath: string
  diagnosticId: string
  replicate: number
  reportPath: string | null
  report: DiagnosticReport
}

interface ArmAggregate {
  armId: string
  methodPackEnabled: boolean
  cells: number
  meanTotalRatio: number
  meanTotalPassed: number
  meanTotalPossible: number
  dimensionMeans: Record<string, number | null>
}

export interface CohortReport {
  generatedAt: string
  mode: "fixture" | "live"
  fixtureDir: string
  fixturePaths: string[]
  outputDir: string | null
  replicates: number
  concurrency: number
  scenesPerChapter: number
  obligationsPerChapter: number
  includePro: boolean
  proReplicates: number
  cellCount: number
  cells: Array<{
    fixturePath: string
    diagnosticId: string
    replicate: number
    reportPath: string | null
    verdict: string
    reason: string
    totalRatioDelta: number | null
    arms: Array<{
      armId: string
      methodPackEnabled: boolean
      totalRatio: number
      totalPassed: number
      totalPossible: number
      structuralIssueCount: number
    }>
  }>
  aggregate: {
    controlArmId: string | null
    testArmId: string | null
    meanDelta: number | null
    medianDelta: number | null
    winRate: number | null
    structuralIssueRate: number | null
    verdict: string
    reason: string
    arms: ArmAggregate[]
  }
}

const DEFAULT_FIXTURE_DIR = "docs/fixtures/method-packs/commercial-fantasy-adventure-v0/cohort"
const DEFAULT_REPLICATES = 3
const DEFAULT_CONCURRENCY = 4
const DEFAULT_SCENES_PER_CHAPTER = 2
const DEFAULT_OBLIGATIONS_PER_CHAPTER = 2

export async function buildCohortReport(args: Args, generatedAt = new Date().toISOString()): Promise<CohortReport> {
  const fixturePaths = args.fixturePaths.length > 0
    ? args.fixturePaths
    : collectFixturePaths(args.fixtureDir)
  if (fixturePaths.length === 0) throw new Error(`no fixture JSON files found in ${args.fixtureDir}`)

  const tasks: Array<() => Promise<CohortCell>> = []
  for (const fixturePath of fixturePaths) {
    for (let replicate = 0; replicate < args.replicates; replicate++) {
      tasks.push(() => runCell(args, fixturePath, replicate, generatedAt))
    }
  }

  const cells = await runBounded(tasks, args.concurrency)
  return summarizeCohort(args, fixturePaths, cells, generatedAt)
}

export function renderCohortReport(report: CohortReport): string {
  const lines: string[] = []
  lines.push(`Method-pack planner cohort: ${report.mode}`)
  lines.push(`fixtures=${report.fixturePaths.length}; replicates=${report.replicates}; cells=${report.cellCount}; scenes/chapter=${report.scenesPerChapter}`)
  lines.push(`proArms=${report.includePro}; proReplicates=${report.proReplicates}`)
  lines.push("")
  lines.push(`Aggregate verdict: ${report.aggregate.verdict}`)
  lines.push(`Reason: ${report.aggregate.reason}`)
  if (report.aggregate.meanDelta !== null) {
    lines.push(`Mean delta: ${formatSignedPct(report.aggregate.meanDelta)}; median delta: ${formatSignedPct(report.aggregate.medianDelta ?? 0)}; win rate: ${formatPct(report.aggregate.winRate ?? 0)}`)
  }
  if (report.aggregate.structuralIssueRate !== null) {
    lines.push(`Method structural issue rate: ${formatPct(report.aggregate.structuralIssueRate)}`)
  }
  lines.push("")
  for (const arm of report.aggregate.arms) {
    lines.push(`${arm.armId}: mean=${formatPct(arm.meanTotalRatio)} (${arm.cells} cells)`)
    const dimensionText = Object.entries(arm.dimensionMeans)
      .filter(([, value]) => value !== null)
      .map(([name, value]) => `${name}=${formatPct(value ?? 0)}`)
      .join("; ")
    lines.push(`  ${dimensionText}`)
  }
  lines.push("")
  lines.push("Cells:")
  for (const cell of report.cells) {
    const delta = cell.totalRatioDelta === null ? "n/a" : formatSignedPct(cell.totalRatioDelta)
    lines.push(`- r${cell.replicate + 1} ${cell.diagnosticId}: ${cell.verdict}; delta=${delta}`)
  }
  if (report.outputDir) {
    lines.push("")
    lines.push(`Artifacts: ${resolve(process.cwd(), report.outputDir)}`)
  }
  return lines.join("\n")
}

async function runCell(args: Args, fixturePath: string, replicate: number, generatedAt: string): Promise<CohortCell> {
  const fixture = loadFixture(fixturePath)
  const arms = args.live
    ? await runLiveArms(fixture, {
      scenesPerChapter: args.scenesPerChapter,
      obligationsPerChapter: args.obligationsPerChapter,
      replicateIndex: replicate,
      includePro: args.includePro && replicate < args.proReplicates,
    })
    : loadFixtureArms(fixture)
  if (arms.length === 0) throw new Error(`${fixturePath} has no offline arms; pass --live`)

  const report = buildDiagnosticReport(fixture, arms, {
    mode: args.live ? "live" : "fixture",
    fixturePath,
    generatedAt,
  })
  let reportPath: string | null = null
  if (args.outputDir) {
    reportPath = join(args.outputDir, "cells", `${safeName(fixture.diagnosticId)}-r${String(replicate + 1).padStart(2, "0")}.json`)
    const abs = resolve(process.cwd(), reportPath)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, JSON.stringify(report, null, 2))
    writeFileSync(abs.replace(/\.json$/, ".md"), renderDiagnosticReport(report))
  }
  return { fixturePath, diagnosticId: fixture.diagnosticId, replicate, reportPath, report }
}

function summarizeCohort(args: Args, fixturePaths: string[], cells: CohortCell[], generatedAt: string): CohortReport {
  const deltas = cells
    .map(cell => cell.report.comparison.totalRatioDelta)
    .filter((value): value is number => typeof value === "number")
  const wins = deltas.filter(delta => delta > 0).length
  const meanDelta = deltas.length ? mean(deltas) : null
  const medianDelta = deltas.length ? median(deltas) : null
  const winRate = deltas.length ? wins / deltas.length : null
  const testStructuralIssues = cells.map(cell => {
    const test = cell.report.arms.find(arm => arm.methodPackEnabled)
    if (!test) return 0
    return structuralIssueCount(test.score.dimensions)
  })
  const structuralIssueRate = testStructuralIssues.length
    ? testStructuralIssues.filter(count => count > 0).length / testStructuralIssues.length
    : null

  const arms = aggregateArms(cells)
  const controlArmId = cells[0]?.report.comparison.controlArmId ?? null
  const testArmId = cells[0]?.report.comparison.testArmId ?? null
  const { verdict, reason } = cohortVerdict(meanDelta, winRate, structuralIssueRate)

  return {
    generatedAt,
    mode: args.live ? "live" : "fixture",
    fixtureDir: args.fixtureDir,
    fixturePaths,
    outputDir: args.outputDir,
    replicates: args.replicates,
    concurrency: args.concurrency,
    scenesPerChapter: args.scenesPerChapter,
    obligationsPerChapter: args.obligationsPerChapter,
    includePro: args.includePro,
    proReplicates: args.proReplicates,
    cellCount: cells.length,
    cells: cells.map(cell => ({
      fixturePath: cell.fixturePath,
      diagnosticId: cell.diagnosticId,
      replicate: cell.replicate,
      reportPath: cell.reportPath,
      verdict: cell.report.comparison.verdict,
      reason: cell.report.comparison.reason,
      totalRatioDelta: cell.report.comparison.totalRatioDelta,
      arms: cell.report.arms.map(arm => ({
        armId: arm.armId,
        methodPackEnabled: arm.methodPackEnabled,
        totalRatio: arm.score.totalRatio,
        totalPassed: arm.score.totalPassed,
        totalPossible: arm.score.totalPossible,
        structuralIssueCount: structuralIssueCount(arm.score.dimensions),
      })),
    })),
    aggregate: {
      controlArmId,
      testArmId,
      meanDelta,
      medianDelta,
      winRate,
      structuralIssueRate,
      verdict,
      reason,
      arms,
    },
  }
}

function aggregateArms(cells: CohortCell[]): ArmAggregate[] {
  const byArm = new Map<string, Array<CohortCell["report"]["arms"][number]>>()
  for (const cell of cells) {
    for (const arm of cell.report.arms) {
      const rows = byArm.get(arm.armId) ?? []
      rows.push(arm)
      byArm.set(arm.armId, rows)
    }
  }
  return [...byArm.entries()].map(([armId, rows]) => {
    const dimensionNames = new Set(rows.flatMap(row => Object.keys(row.score.dimensions)))
    const dimensionMeans: Record<string, number | null> = {}
    for (const name of dimensionNames) {
      const ratios = rows
        .map(row => row.score.dimensions[name]?.ratio ?? null)
        .filter((value): value is number => value !== null)
      dimensionMeans[name] = ratios.length ? mean(ratios) : null
    }
    return {
      armId,
      methodPackEnabled: rows[0]?.methodPackEnabled ?? false,
      cells: rows.length,
      meanTotalRatio: mean(rows.map(row => row.score.totalRatio)),
      meanTotalPassed: mean(rows.map(row => row.score.totalPassed)),
      meanTotalPossible: mean(rows.map(row => row.score.totalPossible)),
      dimensionMeans,
    }
  })
}

function cohortVerdict(meanDelta: number | null, winRate: number | null, structuralIssueRate: number | null): { verdict: string; reason: string } {
  if (meanDelta === null || winRate === null) {
    return { verdict: "HOLD", reason: "Need paired control and method cells before drawing a conclusion." }
  }
  if ((structuralIssueRate ?? 0) > 0.25) {
    return { verdict: "HOLD", reason: "Method arm has structural/ID issues in more than 25% of cells." }
  }
  if (meanDelta >= 0.03 && winRate >= 0.67) {
    return { verdict: "DIRECTIONAL-PASS", reason: "Method arm improves mean plan-contract score by at least 3 points and wins at least two-thirds of cells." }
  }
  if (meanDelta < 0 && winRate < 0.5) {
    return { verdict: "NO-PROMOTION", reason: "Method arm underperforms the no-method control across the cohort." }
  }
  return { verdict: "HOLD", reason: "Cohort ran, but method lift is too small or inconsistent for promotion." }
}

function structuralIssueCount(dimensions: Record<string, { issues: string[] }>): number {
  return (dimensions.idCompleteness?.issues.length ?? 0)
    + (dimensions.sceneContractComplete?.issues.length ?? 0)
}

function collectFixturePaths(dir: string): string[] {
  const root = resolve(process.cwd(), dir)
  if (!existsSync(root)) throw new Error(`fixture dir not found: ${root}`)
  const out: string[] = []
  const walk = (absDir: string) => {
    for (const entry of readdirSync(absDir).sort()) {
      const abs = join(absDir, entry)
      const stat = statSync(abs)
      if (stat.isDirectory()) walk(abs)
      else if (entry.endsWith(".json")) out.push(relative(process.cwd(), abs))
    }
  }
  walk(root)
  return out
}

async function runBounded<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let next = 0
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), tasks.length) }, async () => {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]!()
    }
  })
  await Promise.all(workers)
  return results
}

function parseArgs(argv: string[]): Args {
  let live = false
  let json = false
  let fixtureDir = DEFAULT_FIXTURE_DIR
  const fixturePaths: string[] = []
  let outputDir: string | null = null
  let replicates = DEFAULT_REPLICATES
  let concurrency = DEFAULT_CONCURRENCY
  let scenesPerChapter = DEFAULT_SCENES_PER_CHAPTER
  let obligationsPerChapter = DEFAULT_OBLIGATIONS_PER_CHAPTER
  let includePro = false
  let proReplicates = 0
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--live") live = true
    else if (arg === "--json") json = true
    else if (arg === "--fixture-dir") fixtureDir = requireValue(argv, ++i, "--fixture-dir")
    else if (arg.startsWith("--fixture-dir=")) fixtureDir = arg.slice("--fixture-dir=".length)
    else if (arg === "--fixture") fixturePaths.push(requireValue(argv, ++i, "--fixture"))
    else if (arg.startsWith("--fixture=")) fixturePaths.push(arg.slice("--fixture=".length))
    else if (arg === "--output-dir") outputDir = requireValue(argv, ++i, "--output-dir")
    else if (arg.startsWith("--output-dir=")) outputDir = arg.slice("--output-dir=".length)
    else if (arg === "--replicates") replicates = parsePositiveInt(requireValue(argv, ++i, "--replicates"), "--replicates")
    else if (arg.startsWith("--replicates=")) replicates = parsePositiveInt(arg.slice("--replicates=".length), "--replicates")
    else if (arg === "--concurrency") concurrency = parsePositiveInt(requireValue(argv, ++i, "--concurrency"), "--concurrency")
    else if (arg.startsWith("--concurrency=")) concurrency = parsePositiveInt(arg.slice("--concurrency=".length), "--concurrency")
    else if (arg === "--scenes-per-chapter") scenesPerChapter = parsePositiveInt(requireValue(argv, ++i, "--scenes-per-chapter"), "--scenes-per-chapter")
    else if (arg.startsWith("--scenes-per-chapter=")) scenesPerChapter = parsePositiveInt(arg.slice("--scenes-per-chapter=".length), "--scenes-per-chapter")
    else if (arg === "--obligations-per-chapter") obligationsPerChapter = parsePositiveInt(requireValue(argv, ++i, "--obligations-per-chapter"), "--obligations-per-chapter")
    else if (arg.startsWith("--obligations-per-chapter=")) obligationsPerChapter = parsePositiveInt(arg.slice("--obligations-per-chapter=".length), "--obligations-per-chapter")
    else if (arg === "--include-pro") includePro = true
    else if (arg === "--pro-replicates") proReplicates = parsePositiveInt(requireValue(argv, ++i, "--pro-replicates"), "--pro-replicates")
    else if (arg.startsWith("--pro-replicates=")) proReplicates = parsePositiveInt(arg.slice("--pro-replicates=".length), "--pro-replicates")
    else throw new Error(`unknown arg: ${arg}`)
  }
  if (includePro && proReplicates === 0) proReplicates = replicates
  proReplicates = Math.min(proReplicates, replicates)
  return { live, json, fixtureDir, fixturePaths, outputDir, replicates, concurrency, scenesPerChapter, obligationsPerChapter, includePro, proReplicates }
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index]
  if (!value) throw new Error(`${flag} requires a value`)
  return value
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

function safeName(value: string): string {
  return basename(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cell"
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatSignedPct(value: number): string {
  const sign = value >= 0 ? "+" : ""
  return `${sign}${(value * 100).toFixed(1)} points`
}

function defaultOutputDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  return `output/method-pack-diagnostics/${stamp}/cohort`
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/evals/method-pack-planner-cohort.ts [--live] [--fixture-dir <dir>] [--fixture <path> ...] [--replicates <n>] [--concurrency <n>] [--include-pro] [--pro-replicates <n>] [--output-dir <dir>] [--json]")
    return 2
  }
  if (args.live && !args.outputDir) args.outputDir = defaultOutputDir()
  const report = await buildCohortReport(args)
  if (args.outputDir) {
    const abs = resolve(process.cwd(), args.outputDir)
    mkdirSync(abs, { recursive: true })
    writeFileSync(join(abs, "cohort-report.json"), JSON.stringify(report, null, 2))
    writeFileSync(join(abs, "cohort-report.md"), renderCohortReport(report))
    console.error(`wrote ${abs}`)
  }
  console.log(args.json ? JSON.stringify(report, null, 2) : renderCohortReport(report))
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
