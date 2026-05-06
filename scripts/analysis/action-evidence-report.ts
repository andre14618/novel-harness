#!/usr/bin/env bun
/**
 * Read-only action evidence for a novel run.
 *
 * This answers "what did the harness do?" without rerunning the novel:
 * targeted beat rewrites, mechanical lint/integrity repairs, Chapter Plan
 * Reviser attempts, and Plan-Assist gates.
 */

import db from "../../src/db/connection"
import { parseJsonbArray } from "../../src/db/jsonb"

export interface ActionEvidenceItem {
  source: "llm_calls" | "pipeline_events" | "chapter_revisions" | "chapter_exhaustions" | "stdout"
  sourceId: string
  kind: string
  chapter: number | null
  beat: number | null
  attempt: number | null
  summary: string
  timestamp: string | null
}

export interface ActionEvidenceSummary {
  total: number
  byKind: Record<string, number>
  items: ActionEvidenceItem[]
}

interface Args {
  novelId: string | null
  json: boolean
}

export function extractTargetedRewriteIssueSamples(userPrompt: string, limit = 3): string[] {
  const section = userPrompt.match(/(?:Chapter-plan|Validation|Integrity) issues found:\n([\s\S]*?)(?:\nRewrite this beat\b|$)/i)?.[1]
  if (!section) return []
  return section
    .split(/\r?\n/)
    .flatMap(line => {
      const match = line.match(/^\s*-\s+(.+)$/)
      return match ? [snippet(match[1]!, 180)] : []
    })
    .slice(0, limit)
}

export function buildActionEvidenceSummary(items: readonly ActionEvidenceItem[]): ActionEvidenceSummary {
  const sorted = [...items].sort((a, b) => {
    const at = a.timestamp ? Date.parse(a.timestamp) : Number.MAX_SAFE_INTEGER
    const bt = b.timestamp ? Date.parse(b.timestamp) : Number.MAX_SAFE_INTEGER
    if (at !== bt) return at - bt
    return a.sourceId.localeCompare(b.sourceId)
  })
  const byKind: Record<string, number> = {}
  for (const item of sorted) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1
  return { total: sorted.length, byKind, items: sorted }
}

export function renderActionEvidenceReport(summary: ActionEvidenceSummary, novelId: string | null = null): string {
  const lines: string[] = []
  lines.push(`Action evidence${novelId ? ` for ${novelId}` : ""}`)
  lines.push(`Actions: total=${summary.total}; ${formatRecord(summary.byKind)}`)
  if (summary.items.length === 0) {
    lines.push("No targeted rewrites, repair actions, Reviser rows, or Plan-Assist gates found.")
    return lines.join("\n")
  }
  for (const item of summary.items) {
    lines.push(`- ${formatActionEvidenceItem(item)}`)
  }
  return lines.join("\n")
}

export function formatActionEvidenceItem(item: ActionEvidenceItem): string {
  const loc = [
    item.chapter == null ? null : `ch${item.chapter}`,
    item.beat == null ? null : `beat${item.beat}`,
    item.attempt == null ? null : `attempt${item.attempt}`,
  ].filter(Boolean).join(" ")
  return `${item.kind}${loc ? ` (${loc})` : ""}: ${item.summary} [${item.source}#${item.sourceId}]`
}

export async function loadActionEvidenceSummary(novelId: string): Promise<ActionEvidenceSummary> {
  return buildActionEvidenceSummary([
    ...await loadTargetedRewriteActionEvidence(novelId),
    ...await loadPipelineActionEvidence(novelId),
    ...await loadChapterRevisionActionEvidence(novelId),
    ...await loadPlanAssistGateActionEvidence(novelId),
  ])
}

async function loadTargetedRewriteActionEvidence(novelId: string): Promise<ActionEvidenceItem[]> {
  const rows = await db<Array<{
    id: number
    chapter: number | null
    beat_index: number | null
    attempt: number | null
    request_json: unknown
    user_prompt: string | null
    timestamp: string
  }>>`
    SELECT id, chapter, beat_index, attempt, request_json, user_prompt, timestamp
    FROM llm_calls
    WHERE novel_id = ${novelId}
      AND agent = 'beat-writer'
      AND request_json->'meta'->>'rewriteSource' IS NOT NULL
    ORDER BY id
  `
  return rows.map(row => {
    const meta = readMeta(row.request_json)
    const source = typeof meta.rewriteSource === "string" ? meta.rewriteSource : "unknown"
    const samples = extractTargetedRewriteIssueSamples(row.user_prompt ?? "")
    return {
      source: "llm_calls",
      sourceId: String(row.id),
      kind: `targeted-rewrite:${source}`,
      chapter: row.chapter == null ? null : Number(row.chapter),
      beat: row.beat_index == null ? null : Number(row.beat_index) + 1,
      attempt: row.attempt == null ? null : Number(row.attempt),
      summary: samples.length > 0 ? samples.join(" | ") : "beat-writer targeted rewrite",
      timestamp: row.timestamp,
    }
  })
}

async function loadPipelineActionEvidence(novelId: string): Promise<ActionEvidenceItem[]> {
  const rows = await db<Array<{
    id: number
    chapter: number | null
    beat_index: number | null
    event_type: string
    payload: unknown
    timestamp: string
  }>>`
    SELECT id, chapter, beat_index, event_type, payload, timestamp
    FROM pipeline_events
    WHERE novel_id = ${novelId}
      AND event_type IN (
        'lint-fix-deterministic',
        'lint-fix-llm',
        'lint-fix-rejected',
        'lint-prose-edit-proposals',
        'editorial-beat-coverage-proposals',
        'continuity-editorial-flag-proposals',
        'plan-check-drift-witness',
        'prose-integrity-repair',
        'integrity-settle-complete',
        'plan-assist-wait',
        'plan-assist-resolve'
      )
    ORDER BY timestamp, id
  `
  return rows.map(row => {
    const payload = readRecord(row.payload)
    return {
      source: "pipeline_events",
      sourceId: String(row.id),
      kind: row.event_type,
      chapter: row.chapter == null ? null : Number(row.chapter),
      beat: row.beat_index == null ? null : Number(row.beat_index) + 1,
      attempt: null,
      summary: summarizePipelineActionPayload(payload),
      timestamp: row.timestamp,
    }
  })
}

async function loadChapterRevisionActionEvidence(novelId: string): Promise<ActionEvidenceItem[]> {
  const rows = await db<Array<{
    id: number
    chapter: number
    attempt: number
    issue_count: number
    original_beat_count: number
    revised_beat_count: number | null
    outcome: string
    rejection_reason: string | null
    invoked_at: string
  }>>`
    SELECT id, chapter, attempt, issue_count, original_beat_count, revised_beat_count,
           outcome, rejection_reason, invoked_at
    FROM chapter_revisions
    WHERE novel_id = ${novelId}
    ORDER BY invoked_at, id
  `
  return rows.map(row => ({
    source: "chapter_revisions",
    sourceId: String(row.id),
    kind: `chapter-plan-reviser:${row.outcome}`,
    chapter: Number(row.chapter),
    beat: null,
    attempt: Number(row.attempt),
    summary: row.outcome === "accepted"
      ? `accepted Chapter Plan replacement; issues=${row.issue_count}, beats=${row.original_beat_count}->${row.revised_beat_count ?? "?"}`
      : `outcome=${row.outcome}; issues=${row.issue_count}${row.rejection_reason ? `; reason=${row.rejection_reason}` : ""}`,
    timestamp: row.invoked_at,
  }))
}

async function loadPlanAssistGateActionEvidence(novelId: string): Promise<ActionEvidenceItem[]> {
  const rows = await db<Array<{
    id: number
    chapter: number
    attempt: number
    kind: string
    decision: string | null
    pending: boolean
    unresolved_deviations: unknown
    fired_at: string
  }>>`
    SELECT id, chapter, attempt, kind, decision,
           decided_at IS NULL AS pending,
           unresolved_deviations,
           fired_at
    FROM chapter_exhaustions
    WHERE novel_id = ${novelId}
    ORDER BY fired_at, id
  `
  return rows.map(row => {
    const deviations = parseJsonbArray(row.unresolved_deviations)
    const samples = deviations.slice(0, 3).map(deviationSummary)
    return {
      source: "chapter_exhaustions",
      sourceId: String(row.id),
      kind: `plan-assist:${row.kind}`,
      chapter: Number(row.chapter),
      beat: null,
      attempt: Number(row.attempt),
      summary: `${Boolean(row.pending) ? "pending" : row.decision ?? "resolved"} gate; unresolved=${deviations.length}` +
        (samples.length > 0 ? `; ${samples.join(" | ")}` : ""),
      timestamp: row.fired_at,
    }
  })
}

function readMeta(value: unknown): Record<string, unknown> {
  return readRecord(readRecord(value).meta)
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return readRecord(parsed)
    } catch {
      return {}
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function summarizePipelineActionPayload(payload: Record<string, unknown>): string {
  const issues = Array.isArray(payload.issues) ? payload.issues : []
  const deviations = Array.isArray(payload.deviations) ? payload.deviations : []
  const witnesses = Array.isArray(payload.witnesses) ? payload.witnesses : []
  const primitives = [
    "kind",
    "settleKind",
    "outcome",
    "rewritePass",
    "rewritePassCount",
    "unresolvedCount",
    "deviationCount",
    "fixed",
    "passed",
    "failed",
    "llmCalls",
    "cost",
    "settled",
    "passes",
    "initialBeatCount",
  ]
    .flatMap(key => payload[key] === undefined ? [] : [`${key}=${String(payload[key])}`])
  if (issues.length > 0) {
    const first = deviationSummary(issues[0])
    return [...primitives, `issues=${issues.length}`, first].join("; ")
  }
  if (deviations.length > 0) {
    const first = deviationSummary(deviations[0])
    return [...primitives, `deviations=${deviations.length}`, first].join("; ")
  }
  if (witnesses.length > 0) {
    const first = deviationSummary(witnesses[0])
    return [...primitives, `witnesses=${witnesses.length}`, first].join("; ")
  }
  return primitives.length > 0 ? primitives.join("; ") : snippet(JSON.stringify(payload), 180)
}

function deviationSummary(value: unknown): string {
  if (!value || typeof value !== "object") return snippet(String(value), 180)
  const record = value as Record<string, unknown>
  const beatIndex = record.beat_index ?? record.beatIndex
  const beat = beatIndex === null || beatIndex === undefined
    ? "chapter-level"
    : `beat ${Number(beatIndex) + 1}`
  return snippet(`[${beat}] ${String(record.description ?? JSON.stringify(value))}`, 180)
}

function snippet(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`
}

function formatRecord(record: Record<string, number>): string {
  const entries = Object.entries(record)
  return entries.length === 0
    ? "none"
    : entries.map(([key, value]) => `${key}=${value}`).join(", ")
}

function parseArgs(argv: string[]): Args {
  let novelId: string | null = null
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--novel") {
      const value = argv[++i]
      if (!value) throw new Error("--novel requires a value")
      novelId = value
    } else if (arg === "--json") {
      json = true
    } else {
      throw new Error(`unknown arg: ${arg}`)
    }
  }
  return { novelId, json }
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error("usage: bun scripts/analysis/action-evidence-report.ts --novel <novelId> [--json]")
    return 2
  }

  if (!args.novelId) {
    console.error("usage: bun scripts/analysis/action-evidence-report.ts --novel <novelId> [--json]")
    return 2
  }

  try {
    const report = await loadActionEvidenceSummary(args.novelId)
    console.log(args.json ? JSON.stringify(report, null, 2) : renderActionEvidenceReport(report, args.novelId))
    return 0
  } finally {
    await db.end().catch(() => {})
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
