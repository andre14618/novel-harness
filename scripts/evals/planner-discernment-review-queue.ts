#!/usr/bin/env bun
/**
 * Build an operator calibration queue from planner-discernment real-data reports.
 *
 * This is review scaffolding only. It does not score, promote, reject, rewrite,
 * or change runtime planner behavior.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"

const DEFAULT_LABELS = [
  "REL-1",
  "MOTIVE-1",
  "MOTIVE-2",
  "STAKES-2",
  "MATERIAL-1",
  "WFACT-1",
]

interface Args {
  reports: string[]
  labels: string[]
  outputDir: string | null
  limit: number | null
  json: boolean
}

interface QueueRow {
  queueId: string
  reportPath: string
  promptMode: string
  dimension: string
  label: string
  armId: string
  methodPackEnabled: boolean
  fixtureId: string
  chapterId: string
  sceneId: string | null
  evidence: Record<string, string>
  missingForNextLevel: string
  excerpt: string
  operatorQuestion: string
  operatorDisposition: string
  plannerContractImplication: string
}

interface QueueReport {
  generatedAt: string
  sourceReports: string[]
  labels: string[]
  rowCount: number
  rows: QueueRow[]
}

export function buildReviewQueue(args: Args, generatedAt = new Date().toISOString()): QueueReport {
  const sourceReports = args.reports.map(resolveReportPath)
  const rows: QueueRow[] = []
  for (const reportPath of sourceReports) {
    const report = JSON.parse(readFileSync(reportPath, "utf-8")) as any
    for (const result of report.results ?? []) {
      if (!args.labels.includes(String(result.label))) continue
      rows.push({
        queueId: `${rows.length + 1}`.padStart(3, "0"),
        reportPath,
        promptMode: String(report.promptMode ?? result.promptMode ?? ""),
        dimension: String(result.dimension ?? ""),
        label: String(result.label ?? ""),
        armId: String(result.armId ?? ""),
        methodPackEnabled: Boolean(result.methodPackEnabled),
        fixtureId: String(result.fixtureId ?? ""),
        chapterId: String(result.chapterId ?? ""),
        sceneId: result.sceneId ? String(result.sceneId) : null,
        evidence: normalizeEvidence(result.output?.evidence),
        missingForNextLevel: String(result.missingForNextLevel ?? result.output?.missingForNextLevel ?? ""),
        excerpt: String(result.text ?? ""),
        operatorQuestion: operatorQuestion(String(result.dimension ?? ""), String(result.label ?? "")),
        operatorDisposition: "",
        plannerContractImplication: "",
      })
    }
  }
  rows.sort((a, b) => (
    a.dimension.localeCompare(b.dimension)
    || a.label.localeCompare(b.label)
    || a.fixtureId.localeCompare(b.fixtureId)
    || a.armId.localeCompare(b.armId)
    || a.chapterId.localeCompare(b.chapterId)
    || String(a.sceneId ?? "").localeCompare(String(b.sceneId ?? ""))
  ))
  const limited = args.limit === null ? rows : rows.slice(0, args.limit)
  limited.forEach((row, index) => {
    row.queueId = `${index + 1}`.padStart(3, "0")
  })
  return {
    generatedAt,
    sourceReports,
    labels: args.labels,
    rowCount: limited.length,
    rows: limited,
  }
}

export function renderReviewQueue(report: QueueReport): string {
  const lines: string[] = []
  lines.push("# Planner Discernment Operator Queue")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt}`)
  lines.push(`Rows: ${report.rowCount}`)
  lines.push(`Labels: ${report.labels.join(", ")}`)
  lines.push("")
  lines.push("## Source Reports")
  for (const source of report.sourceReports) lines.push(`- ${source}`)
  lines.push("")
  for (const row of report.rows) {
    lines.push(`## ${row.queueId} ${row.label} ${row.dimension}`)
    lines.push("")
    lines.push(`Source: ${row.fixtureId}; ${row.chapterId}${row.sceneId ? `/${row.sceneId}` : ""}; ${row.armId}; mode=${row.promptMode}`)
    lines.push("")
    lines.push(`Operator question: ${row.operatorQuestion}`)
    lines.push("")
    lines.push("Judge evidence:")
    for (const [key, value] of Object.entries(row.evidence)) {
      if (value) lines.push(`- ${key}: ${value}`)
    }
    if (row.missingForNextLevel) lines.push(`- missingForNextLevel: ${row.missingForNextLevel}`)
    lines.push("")
    lines.push("Operator disposition:")
    lines.push("")
    lines.push("Planner contract implication:")
    lines.push("")
    lines.push("Excerpt:")
    lines.push("")
    lines.push("```text")
    lines.push(row.excerpt.trim() || "(excerpt unavailable)")
    lines.push("```")
    lines.push("")
  }
  return lines.join("\n")
}

function normalizeEvidence(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) out[key] = String(value ?? "")
  return out
}

function operatorQuestion(dimension: string, label: string): string {
  if (dimension === "relationshipDelta") return "Should this relationship-applicable scene require a concrete relationship state change, or is static co-presence acceptable here?"
  if (dimension === "motivationSpecificity") return label === "MOTIVE-1"
    ? "Is the character motivation too generic to drive the scene?"
    : "Does this motivation need an internal tradeoff, or is specific motivation enough for this scene?"
  if (dimension === "stakesValueShift") return "Does this STAKES-2 scene feel merely functional, or should it require sharper cost, irreversibility, or next-conflict pressure?"
  if (dimension === "characterMateriality") return "Should this required character be removed from the scene contract or given material influence over choice, conflict, turn, or outcome?"
  if (dimension === "worldFactPressure") return "Should this required world fact be removed from the scene contract or made operational in action, cost, constraint, or outcome?"
  return "Should this label change the planner contract, stay diagnostic, or be ignored?"
}

function resolveReportPath(path: string): string {
  const abs = resolve(process.cwd(), path)
  if (!existsSync(abs)) throw new Error(`report not found: ${abs}`)
  if (abs.endsWith(".json")) return abs
  const reportPath = join(abs, "planner-discernment-real-data-report.json")
  if (!existsSync(reportPath)) throw new Error(`report directory missing planner-discernment-real-data-report.json: ${abs}`)
  return reportPath
}

function parseArgs(argv: string[]): Args {
  const reports: string[] = []
  const labels: string[] = []
  let outputDir: string | null = null
  let limit: number | null = null
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--report") reports.push(requireValue(argv, ++i, "--report"))
    else if (arg.startsWith("--report=")) reports.push(arg.slice("--report=".length))
    else if (arg === "--label") labels.push(requireValue(argv, ++i, "--label"))
    else if (arg.startsWith("--label=")) labels.push(arg.slice("--label=".length))
    else if (arg === "--output-dir") outputDir = requireValue(argv, ++i, "--output-dir")
    else if (arg.startsWith("--output-dir=")) outputDir = arg.slice("--output-dir=".length)
    else if (arg === "--limit") limit = parsePositiveInt(requireValue(argv, ++i, "--limit"), "--limit")
    else if (arg.startsWith("--limit=")) limit = parsePositiveInt(arg.slice("--limit=".length), "--limit")
    else if (arg === "--json") json = true
    else throw new Error(`unknown arg: ${arg}`)
  }
  if (reports.length === 0) throw new Error("--report is required")
  return {
    reports,
    labels: labels.length > 0 ? labels : DEFAULT_LABELS,
    outputDir,
    limit,
    json,
  }
}

function defaultOutputDir(reports: string[]): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const source = reports.length === 1 ? basename(reports[0]!).replace(/\.json$/, "") : "multi-report"
  return `output/method-pack-diagnostics/${stamp}/planner-discernment-review-queue-${source}`
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

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/evals/planner-discernment-review-queue.ts --report <report-json-or-dir> [--label <LABEL> ...] [--limit <n>] [--output-dir <dir>] [--json]")
    return 2
  }
  if (!args.outputDir) args.outputDir = defaultOutputDir(args.reports)
  const report = buildReviewQueue(args)
  const abs = resolve(process.cwd(), args.outputDir)
  mkdirSync(abs, { recursive: true })
  writeFileSync(join(abs, "planner-discernment-review-queue.json"), JSON.stringify(report, null, 2))
  writeFileSync(join(abs, "planner-discernment-review-queue.md"), renderReviewQueue(report))
  console.log(args.json ? JSON.stringify(report, null, 2) : renderReviewQueue(report))
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
