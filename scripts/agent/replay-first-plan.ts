#!/usr/bin/env bun
/**
 * Replay-first plan helper (L59 MVP).
 *
 * Inventories saved checker/prompt panels so a candidate change can be killed
 * or narrowed on stored evidence rows before live LXC smoke spend. The helper
 * never makes model calls; it only reads JSONL rows and prints a plan.
 *
 * Usage:
 *   bun scripts/agent/replay-first-plan.ts <panel.jsonl> [more.jsonl ...] [options]
 *
 * Options:
 *   --label <text>           Probe-family or candidate label, surfaced in the
 *                            recommended replay command.
 *   --exp-id <n>             EXPERIMENT_ID for the replay command.
 *   --note <text>            Free-form note attached to the replay command.
 *   --cost-per-call <usd>    Per-call cost estimate (default 0.0). Used only to
 *                            print an estimated upper-bound cost; this helper
 *                            never spends money.
 *   --json                   Emit a JSON document instead of human text.
 *
 * Exit codes:
 *   0 every supplied panel was inventoried with a known shape
 *   2 at least one panel was missing or had an unsupported row schema
 */

import { existsSync, readFileSync, statSync } from "node:fs"
import { resolve, basename } from "node:path"

export interface ReplayFirstArgs {
  paths: string[]
  label: string | null
  expId: number | null
  note: string | null
  costPerCall: number
  json: boolean
}

export interface PanelSummary {
  path: string
  rowCount: number
  /** Distinct values of the `checker` field. */
  checkers: string[]
  /** Distinct values of the `source` field, if present. */
  sources: string[]
  /** Distribution of `oracle_label` (or `gold.oracle_label`) values. */
  oracleLabels: Record<string, number>
  /** First identifier-bearing key on each row (case_id or fixture_id). */
  idField: "case_id" | "fixture_id" | null
  /** The replay row schema this helper recognised, or null when unknown. */
  shape: "halluc-ungrounded-fixture" | "adherence-events-fixture" | null
  /** Estimated number of model calls if this panel were replayed. */
  estimatedCalls: number
  /** Estimated upper-bound cost in USD given args.costPerCall. */
  estimatedCostUsd: number
  /** Suggested replay command if a known shape was matched. */
  recommendedCommand: string | null
  /** Reason the helper could not classify a panel, when applicable. */
  warning: string | null
}

export interface ReplayFirstPlan {
  generatedAt: string
  label: string | null
  expId: number | null
  note: string | null
  costPerCall: number
  panels: PanelSummary[]
  totals: {
    rowCount: number
    estimatedCalls: number
    estimatedCostUsd: number
    unsupportedPanels: number
  }
}

const SHAPE_TO_RUNNER: Record<NonNullable<PanelSummary["shape"]>, {
  callsPerRow: number
  buildCommand: (panelPath: string, args: ReplayFirstArgs) => string
}> = {
  "halluc-ungrounded-fixture": {
    callsPerRow: 1,
    buildCommand: (panelPath, args) => {
      const out = `/tmp/replay-${basename(panelPath, ".jsonl")}`
      const parts = [
        "bun scripts/hallucination/run-expanded-class-panel.ts",
        `--in ${panelPath}`,
        `--out ${out}`,
      ]
      if (args.expId != null) parts.push("--persist", `--exp-id ${args.expId}`)
      if (args.note) parts.push(`--note ${JSON.stringify(args.note)}`)
      return parts.join(" ")
    },
  },
  "adherence-events-fixture": {
    callsPerRow: 2,
    buildCommand: (panelPath, args) => {
      const parts = [
        "bun scripts/hallucination/run-partial-enactment-panel.ts",
        `--in ${panelPath}`,
      ]
      if (args.expId != null) parts.push("--persist", `--exp-id ${args.expId}`)
      return parts.join(" ")
    },
  },
}

function valueAfter(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

export function parseArgs(argv: string[]): ReplayFirstArgs {
  const out: ReplayFirstArgs = {
    paths: [],
    label: null,
    expId: null,
    note: null,
    costPerCall: 0,
    json: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--label") out.label = valueAfter(argv, i++, arg)
    else if (arg === "--exp-id") {
      const n = Number(valueAfter(argv, i++, arg))
      if (!Number.isInteger(n) || n <= 0) throw new Error("--exp-id must be a positive integer")
      out.expId = n
    } else if (arg === "--note") out.note = valueAfter(argv, i++, arg)
    else if (arg === "--cost-per-call") {
      const n = Number(valueAfter(argv, i++, arg))
      if (!Number.isFinite(n) || n < 0) throw new Error("--cost-per-call must be a non-negative number")
      out.costPerCall = n
    } else if (arg === "--json") out.json = true
    else if (arg === "--help" || arg === "-h") {
      console.log(USAGE)
      process.exit(0)
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option: ${arg}`)
    } else {
      out.paths.push(arg)
    }
  }
  return out
}

const USAGE =
  "Usage: bun scripts/agent/replay-first-plan.ts <panel.jsonl> [more.jsonl ...] [options]\n\n" +
  "Inventories saved checker/prompt panels for replay-first verification.\n" +
  "The helper reads JSONL only; it never launches model calls.\n\n" +
  "Options:\n" +
  "  --label <text>          Candidate or probe-family label\n" +
  "  --exp-id <n>            EXPERIMENT_ID to thread into the replay command\n" +
  "  --note <text>           Free-form note to forward to the replay runner\n" +
  "  --cost-per-call <usd>   Per-call cost estimate, default 0\n" +
  "  --json                  Emit JSON instead of human text\n"

function detectShape(row: any): { shape: PanelSummary["shape"]; idField: PanelSummary["idField"] } {
  if (row && typeof row === "object") {
    const checker = typeof row.checker === "string" ? row.checker : null
    if (checker === "halluc-ungrounded" && row.task?.checker_request_meta) {
      return { shape: "halluc-ungrounded-fixture", idField: "case_id" in row ? "case_id" : null }
    }
    if (checker === "adherence-events" && row.task?.writer_request_meta?.beatDescription) {
      return { shape: "adherence-events-fixture", idField: "fixture_id" in row ? "fixture_id" : null }
    }
  }
  return { shape: null, idField: null }
}

export function summarizePanel(panelPath: string, args: ReplayFirstArgs): PanelSummary {
  const summary: PanelSummary = {
    path: panelPath,
    rowCount: 0,
    checkers: [],
    sources: [],
    oracleLabels: {},
    idField: null,
    shape: null,
    estimatedCalls: 0,
    estimatedCostUsd: 0,
    recommendedCommand: null,
    warning: null,
  }

  if (!existsSync(panelPath)) {
    summary.warning = "panel file not found"
    return summary
  }
  const stat = statSync(panelPath)
  if (!stat.isFile()) {
    summary.warning = "panel path is not a file"
    return summary
  }

  const raw = readFileSync(panelPath, "utf-8")
  const lines = raw.split("\n").filter(line => line.trim().length > 0)
  if (lines.length === 0) {
    summary.warning = "panel file is empty"
    return summary
  }

  const checkers = new Set<string>()
  const sources = new Set<string>()
  const detected = new Set<NonNullable<PanelSummary["shape"]>>()
  const idFields = new Set<NonNullable<PanelSummary["idField"]>>()
  let parseFailures = 0

  for (const line of lines) {
    let row: any
    try {
      row = JSON.parse(line)
    } catch {
      parseFailures++
      continue
    }
    summary.rowCount++
    if (typeof row?.checker === "string") checkers.add(row.checker)
    if (typeof row?.source === "string") sources.add(row.source)
    const oracle =
      typeof row?.oracle_label === "string"
        ? row.oracle_label
        : typeof row?.gold?.oracle_label === "string"
          ? row.gold.oracle_label
          : typeof row?.gold?.expected_pass === "boolean"
            ? row.gold.expected_pass
              ? "expected_pass"
              : "expected_fail"
            : null
    if (oracle) summary.oracleLabels[oracle] = (summary.oracleLabels[oracle] ?? 0) + 1
    const detection = detectShape(row)
    if (detection.shape) detected.add(detection.shape)
    if (detection.idField) idFields.add(detection.idField)
  }

  summary.checkers = [...checkers].sort()
  summary.sources = [...sources].sort()
  if (idFields.size === 1) summary.idField = [...idFields][0]!

  if (parseFailures > 0) {
    summary.warning = `${parseFailures}/${lines.length} rows failed to parse as JSON`
  }
  if (detected.size === 1) {
    summary.shape = [...detected][0]!
    const runner = SHAPE_TO_RUNNER[summary.shape]
    summary.estimatedCalls = summary.rowCount * runner.callsPerRow
    summary.estimatedCostUsd = +(summary.estimatedCalls * args.costPerCall).toFixed(4)
    summary.recommendedCommand = runner.buildCommand(panelPath, args)
  } else if (detected.size > 1) {
    summary.warning =
      (summary.warning ? summary.warning + "; " : "") +
      `mixed row shapes detected (${[...detected].join(", ")}); split before replay`
  } else if (summary.rowCount > 0 && !summary.shape) {
    summary.warning =
      (summary.warning ? summary.warning + "; " : "") +
      `no supported row shape recognised (checkers=${summary.checkers.join(",") || "?"})`
  }

  return summary
}

export function buildPlan(args: ReplayFirstArgs): ReplayFirstPlan {
  const panels = args.paths.map(path => summarizePanel(resolve(path), args))
  const totals = panels.reduce(
    (acc, p) => {
      acc.rowCount += p.rowCount
      acc.estimatedCalls += p.estimatedCalls
      acc.estimatedCostUsd = +(acc.estimatedCostUsd + p.estimatedCostUsd).toFixed(4)
      if (!p.shape) acc.unsupportedPanels++
      return acc
    },
    { rowCount: 0, estimatedCalls: 0, estimatedCostUsd: 0, unsupportedPanels: 0 },
  )
  return {
    generatedAt: new Date().toISOString(),
    label: args.label,
    expId: args.expId,
    note: args.note,
    costPerCall: args.costPerCall,
    panels,
    totals,
  }
}

export function renderPlan(plan: ReplayFirstPlan): string {
  const lines: string[] = []
  lines.push(`# Replay-first plan (${plan.generatedAt})`)
  if (plan.label) lines.push(`Label: ${plan.label}`)
  if (plan.expId != null) lines.push(`Experiment ID: ${plan.expId}`)
  if (plan.note) lines.push(`Note: ${plan.note}`)
  lines.push(
    `Totals: panels=${plan.panels.length} rows=${plan.totals.rowCount} ` +
      `est-calls=${plan.totals.estimatedCalls} est-cost=$${plan.totals.estimatedCostUsd.toFixed(4)} ` +
      `unsupported=${plan.totals.unsupportedPanels}`,
  )
  lines.push("")
  for (const panel of plan.panels) {
    lines.push(`## ${panel.path}`)
    lines.push(`- rows: ${panel.rowCount}`)
    lines.push(`- shape: ${panel.shape ?? "(unknown)"}`)
    lines.push(`- id field: ${panel.idField ?? "(none)"}`)
    lines.push(`- checkers: ${panel.checkers.length ? panel.checkers.join(", ") : "(none)"}`)
    lines.push(`- sources: ${panel.sources.length ? panel.sources.join(", ") : "(none)"}`)
    const oracleEntries = Object.entries(panel.oracleLabels).sort(([, a], [, b]) => b - a)
    lines.push(
      `- oracle labels: ${
        oracleEntries.length ? oracleEntries.map(([k, v]) => `${k}=${v}`).join(", ") : "(none)"
      }`,
    )
    lines.push(`- estimated calls: ${panel.estimatedCalls}`)
    lines.push(`- estimated cost: $${panel.estimatedCostUsd.toFixed(4)}`)
    if (panel.warning) lines.push(`- warning: ${panel.warning}`)
    if (panel.recommendedCommand) {
      lines.push("- replay command:")
      lines.push(`    ${panel.recommendedCommand}`)
    } else {
      lines.push("- replay command: (none — schema unsupported; do not promote to live smoke until classified)")
    }
    lines.push("")
  }
  if (plan.totals.unsupportedPanels === 0) {
    lines.push(
      "Run the replay command(s) above on a workstation or LXC before any live smoke. " +
        "Confirm cost and EXPERIMENT_ID are recorded with the run output.",
    )
  } else {
    lines.push(
      "At least one panel had an unrecognised schema. Add a shape classifier or split the panel before promoting to smoke.",
    )
  }
  return lines.join("\n")
}

export function main(argv: string[]): { exitCode: number; output: string } {
  const args = parseArgs(argv)
  if (args.paths.length === 0) {
    return { exitCode: 2, output: USAGE }
  }
  const plan = buildPlan(args)
  const output = args.json ? JSON.stringify(plan, null, 2) : renderPlan(plan)
  const exitCode = plan.totals.unsupportedPanels === 0 ? 0 : 2
  return { exitCode, output }
}

if (import.meta.main) {
  try {
    const result = main(process.argv.slice(2))
    process.stdout.write(result.output.endsWith("\n") ? result.output : result.output + "\n")
    process.exit(result.exitCode)
  } catch (err) {
    console.error(`[replay-first-plan] error: ${err instanceof Error ? err.message : err}`)
    process.exit(2)
  }
}
