#!/usr/bin/env bun
/**
 * Extract a stratified sample of continuity findings (continuity-facts
 * contradictions and continuity-state violations) from `llm_calls` for offline
 * adjudication. Emits one JSONL record per finding with the originating
 * chapter prose excerpt, the finding payload, and provenance fields.
 *
 * Adjudication itself is a downstream step (Sonnet subagent labeling); this
 * script is read-only and does not change runtime behavior.
 */

import { classifyFindingPolarity, type CheckerWarningPolarity } from "./checker-warning-report"

export type ContinuityAgent = "continuity-facts" | "continuity-state"
export type Severity = "blocker" | "warning" | "nit"

export interface ContinuityCallRow {
  id: number
  agent: ContinuityAgent
  novel_id: string | null
  chapter: number | null
  attempt: number | null
  timestamp: string | Date | null
  user_prompt: string | null
  response_content: string | null
}

export interface ContinuityFinding {
  /** stable id derived from llm_call id + finding index */
  findingId: string
  llmCallId: number
  agent: ContinuityAgent
  novelId: string | null
  chapter: number | null
  attempt: number | null
  timestamp: string | null
  severity: Severity
  polarity: CheckerWarningPolarity
  /** continuity-facts: the alleged broken fact; continuity-state: the character name */
  subject: string
  /** continuity-state: location | knowledge; null for facts */
  stateType: string | null
  evidence: string
  reasoning: string
  /** trimmed slice of the originating user_prompt that contained the chapter prose */
  proseExcerpt: string
}

export interface StratumKey {
  agent: ContinuityAgent
  severity: Severity
}

export interface PanelStratum {
  key: StratumKey
  total: number
  sampled: number
  findings: ContinuityFinding[]
}

export interface ContinuityGrayzonePanel {
  generatedAt: string
  totalFindings: number
  sampledFindings: number
  perStratumTarget: number
  proseExcerptCharCap: number
  polarityFilter: CheckerWarningPolarity | "all"
  byPolarity: Record<CheckerWarningPolarity, number>
  strata: PanelStratum[]
}

interface BuildOptions {
  perStratumTarget?: number
  proseExcerptCharCap?: number
  generatedAt?: string
  /** deterministic per-stratum order via this seed mod (default 7) */
  seed?: number
  polarityFilter?: CheckerWarningPolarity | "all"
}

const DEFAULT_PER_STRATUM = 5
const DEFAULT_PROSE_CAP = 4000
const ALL_AGENTS: ContinuityAgent[] = ["continuity-facts", "continuity-state"]
const ALL_SEVERITIES: Severity[] = ["blocker", "warning", "nit"]

export function extractFindings(rows: ContinuityCallRow[], proseCharCap = DEFAULT_PROSE_CAP): ContinuityFinding[] {
  const out: ContinuityFinding[] = []
  for (const row of rows) {
    const parsed = safeParseJson(row.response_content)
    if (!parsed) continue
    const proseExcerpt = extractProseExcerpt(row.user_prompt ?? "", proseCharCap)
    if (row.agent === "continuity-facts") {
      const items = Array.isArray((parsed as { contradictions?: unknown }).contradictions)
        ? ((parsed as { contradictions: unknown[] }).contradictions)
        : []
      items.forEach((item, index) => {
        const finding = factFinding(row, item, index, proseExcerpt)
        if (finding) out.push(finding)
      })
    } else if (row.agent === "continuity-state") {
      const items = Array.isArray((parsed as { violations?: unknown }).violations)
        ? ((parsed as { violations: unknown[] }).violations)
        : []
      items.forEach((item, index) => {
        const finding = stateFinding(row, item, index, proseExcerpt)
        if (finding) out.push(finding)
      })
    }
  }
  return out
}

export function buildPanel(findings: ContinuityFinding[], opts: BuildOptions = {}): ContinuityGrayzonePanel {
  const perStratum = Math.max(1, opts.perStratumTarget ?? DEFAULT_PER_STRATUM)
  const proseCap = Math.max(200, opts.proseExcerptCharCap ?? DEFAULT_PROSE_CAP)
  const seed = opts.seed ?? 7
  const generatedAt = opts.generatedAt ?? new Date().toISOString()
  const polarityFilter = opts.polarityFilter ?? "all"
  const filteredFindings = polarityFilter === "all"
    ? findings
    : findings.filter(finding => finding.polarity === polarityFilter)
  const byPolarity = polarityCounts(filteredFindings)
  const strata: PanelStratum[] = []

  for (const agent of ALL_AGENTS) {
    for (const severity of ALL_SEVERITIES) {
      const all = filteredFindings.filter((f) => f.agent === agent && f.severity === severity)
      const sampled = stridedSample(all, perStratum, seed)
      strata.push({
        key: { agent, severity },
        total: all.length,
        sampled: sampled.length,
        findings: sampled,
      })
    }
  }

  const sampledFindings = strata.reduce((acc, s) => acc + s.sampled, 0)
  return {
    generatedAt,
    totalFindings: filteredFindings.length,
    sampledFindings,
    perStratumTarget: perStratum,
    proseExcerptCharCap: proseCap,
    polarityFilter,
    byPolarity,
    strata,
  }
}

export function panelToJsonl(panel: ContinuityGrayzonePanel): string {
  const lines: string[] = []
  for (const stratum of panel.strata) {
    for (const finding of stratum.findings) {
      lines.push(JSON.stringify({ ...finding, stratum: stratum.key }))
    }
  }
  return lines.join("\n") + (lines.length > 0 ? "\n" : "")
}

export function renderPanelSummary(panel: ContinuityGrayzonePanel): string {
  const lines: string[] = []
  lines.push(`Continuity gray-zone panel — generated ${panel.generatedAt}`)
  lines.push(
    `Findings: ${panel.totalFindings} total, ${panel.sampledFindings} sampled across ` +
      `${panel.strata.length} strata (target ${panel.perStratumTarget} per stratum, prose cap ${panel.proseExcerptCharCap} chars)`,
  )
  lines.push(`Polarity filter: ${panel.polarityFilter}; counts ${formatPolarityCounts(panel.byPolarity)}`)
  for (const stratum of panel.strata) {
    const counts = polarityCounts(stratum.findings)
    lines.push(
      `  - ${stratum.key.agent}/${stratum.key.severity}: ${stratum.sampled}/${stratum.total} sampled ` +
        `(${formatPolarityCounts(counts)})`,
    )
  }
  return lines.join("\n")
}

// ── helpers ──────────────────────────────────────────────────────────────────

function safeParseJson(value: string | null): unknown {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function extractProseExcerpt(userPrompt: string, charCap: number): string {
  const marker = "CHAPTER DRAFT:"
  const start = userPrompt.indexOf(marker)
  if (start < 0) return userPrompt.slice(0, charCap)
  const after = userPrompt.slice(start + marker.length).trimStart()
  return after.slice(0, charCap)
}

function factFinding(
  row: ContinuityCallRow,
  item: unknown,
  index: number,
  proseExcerpt: string,
): ContinuityFinding | null {
  if (!item || typeof item !== "object") return null
  const r = item as Record<string, unknown>
  const fact = typeof r.fact === "string" ? r.fact : null
  const evidence = typeof r.evidence === "string" ? r.evidence : null
  const reasoning = typeof r.reasoning === "string" ? r.reasoning : null
  const severity = normalizeSeverity(r.severity)
  if (!fact || !evidence || !reasoning || !severity) return null
  return {
    findingId: `${row.id}:facts:${index}`,
    llmCallId: row.id,
    agent: "continuity-facts",
    novelId: row.novel_id,
    chapter: row.chapter,
    attempt: row.attempt,
    timestamp: normalizeTimestamp(row.timestamp),
    severity,
    polarity: classifyFindingPolarity(reasoning),
    subject: fact,
    stateType: null,
    evidence,
    reasoning,
    proseExcerpt,
  }
}

function stateFinding(
  row: ContinuityCallRow,
  item: unknown,
  index: number,
  proseExcerpt: string,
): ContinuityFinding | null {
  if (!item || typeof item !== "object") return null
  const r = item as Record<string, unknown>
  const character = typeof r.character === "string" ? r.character : null
  const evidence = typeof r.evidence === "string" ? r.evidence : null
  const reasoning = typeof r.reasoning === "string" ? r.reasoning : null
  const stateType = typeof r.type === "string" ? r.type : null
  const severity = normalizeSeverity(r.severity ?? "warning")
  if (!character || !evidence || !reasoning || !stateType || !severity) return null
  return {
    findingId: `${row.id}:state:${index}`,
    llmCallId: row.id,
    agent: "continuity-state",
    novelId: row.novel_id,
    chapter: row.chapter,
    attempt: row.attempt,
    timestamp: normalizeTimestamp(row.timestamp),
    severity,
    polarity: classifyFindingPolarity(reasoning),
    subject: character,
    stateType,
    evidence,
    reasoning,
    proseExcerpt,
  }
}

function normalizeSeverity(value: unknown): Severity | null {
  if (value === "blocker" || value === "warning" || value === "nit") return value
  return null
}

function normalizeTimestamp(value: string | Date | null | undefined): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string" && value.length > 0) return value
  return null
}

function polarityCounts(findings: readonly ContinuityFinding[]): Record<CheckerWarningPolarity, number> {
  const counts: Record<CheckerWarningPolarity, number> = {
    negative: 0,
    positive: 0,
    ambiguous: 0,
  }
  for (const finding of findings) counts[finding.polarity]++
  return counts
}

function formatPolarityCounts(counts: Record<CheckerWarningPolarity, number>): string {
  return `negative=${counts.negative}, positive=${counts.positive}, ambiguous=${counts.ambiguous}`
}

/**
 * Deterministic stride-based sampling: picks evenly spaced findings across the
 * input list to avoid clustering on a single novel/chapter/attempt without
 * shuffling. Stable for the same input + seed.
 */
export function stridedSample<T>(items: readonly T[], targetSize: number, seed: number): T[] {
  if (items.length <= targetSize) return [...items]
  if (targetSize <= 0) return []
  const offset = ((seed % items.length) + items.length) % items.length
  const stride = items.length / targetSize
  const out: T[] = []
  const seen = new Set<number>()
  for (let i = 0; i < targetSize; i++) {
    const idx = Math.floor((offset + i * stride) % items.length)
    if (seen.has(idx)) continue
    seen.add(idx)
    out.push(items[idx]!)
  }
  // Backfill if Math.floor collisions left us short.
  let cursor = 0
  while (out.length < targetSize && cursor < items.length) {
    if (!seen.has(cursor)) {
      seen.add(cursor)
      out.push(items[cursor]!)
    }
    cursor++
  }
  return out
}

interface CliArgs {
  outDir: string
  perStratumTarget: number
  proseExcerptCharCap: number
  polarityFilter: CheckerWarningPolarity | "all"
  json: boolean
}

function parseArgs(argv: string[]): CliArgs {
  let outDir = "output/continuity-grayzone"
  let perStratum = DEFAULT_PER_STRATUM
  let proseCap = DEFAULT_PROSE_CAP
  let polarityFilter: CheckerWarningPolarity | "all" = "all"
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--out") {
      const value = argv[++i]
      if (!value) throw new Error("--out requires a value")
      outDir = value
    } else if (arg === "--per-stratum") {
      const value = argv[++i]
      if (!value) throw new Error("--per-stratum requires a value")
      const parsed = Number(value)
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("--per-stratum must be a positive number")
      perStratum = parsed
    } else if (arg === "--prose-cap") {
      const value = argv[++i]
      if (!value) throw new Error("--prose-cap requires a value")
      const parsed = Number(value)
      if (!Number.isFinite(parsed) || parsed < 200) throw new Error("--prose-cap must be >= 200")
      proseCap = parsed
    } else if (arg === "--json") {
      json = true
    } else if (arg === "--polarity") {
      const value = argv[++i]
      if (value !== "negative" && value !== "positive" && value !== "ambiguous" && value !== "all") {
        throw new Error("--polarity must be negative, positive, ambiguous, or all")
      }
      polarityFilter = value
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }
  return { outDir, perStratumTarget: perStratum, proseExcerptCharCap: proseCap, polarityFilter, json }
}

async function loadRows(): Promise<ContinuityCallRow[]> {
  const { default: db } = await import("../../src/db/connection")
  return (await db`
    SELECT id, agent, novel_id, chapter, attempt, timestamp, user_prompt, response_content
    FROM llm_calls
    WHERE agent IN ('continuity-facts', 'continuity-state')
      AND response_content IS NOT NULL
      AND response_content ~ '^\s*\{'
    ORDER BY id ASC
  `) as ContinuityCallRow[]
}

async function main(argv: string[]): Promise<number> {
  let args: CliArgs
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(
      "usage: bun scripts/analysis/continuity-grayzone-extract.ts " +
        "[--out <dir>] [--per-stratum N] [--prose-cap N] [--polarity all|negative|positive|ambiguous] [--json]",
    )
    return 2
  }

  const rows = await loadRows()
  const findings = extractFindings(rows, args.proseExcerptCharCap)
  const panel = buildPanel(findings, {
    perStratumTarget: args.perStratumTarget,
    proseExcerptCharCap: args.proseExcerptCharCap,
    polarityFilter: args.polarityFilter,
  })

  const fs = await import("node:fs/promises")
  const path = await import("node:path")
  await fs.mkdir(args.outDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, "").replace(/Z$/, "")
  const jsonlPath = path.join(args.outDir, `continuity-grayzone-${ts}.jsonl`)
  const summaryPath = path.join(args.outDir, `continuity-grayzone-${ts}.summary.txt`)
  await fs.writeFile(jsonlPath, panelToJsonl(panel))
  await fs.writeFile(summaryPath, renderPanelSummary(panel) + "\n")

  if (args.json) {
    console.log(JSON.stringify({ panel, jsonlPath, summaryPath }, null, 2))
  } else {
    console.log(renderPanelSummary(panel))
    console.log(`\nWrote ${panel.sampledFindings} findings to ${jsonlPath}`)
    console.log(`Summary: ${summaryPath}`)
  }
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
