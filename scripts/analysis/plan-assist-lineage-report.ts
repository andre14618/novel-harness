#!/usr/bin/env bun
/**
 * Read-only diagnostic over `planning_mutation_lineage` rows whose
 * `source_table` is `chapter_exhaustions` (plan-assist edit/override gate
 * decisions) or `chapter_revisions` (chapter-plan-reviser accepted outline
 * replacements). Mirrors the pattern of `diagnostics:plan-drift` and
 * `diagnostics:checker-warnings`; produces a per-chapter summary plus
 * decision-level events for each of the three lineage kinds, so operators can
 * inspect plan-assist activity without ad-hoc SQL before any envelope-wrap
 * decision on the deferred higher-risk slices.
 */

export type PlanAssistLineageEventKind =
  | "plan_assist_edit"
  | "plan_assist_override"
  | "reviser_accepted"
  | "unknown"

export interface PlanAssistLineageRow {
  id: string
  novel_id: string | null
  source_table: string
  field_path: string
  source: string | null
  actor_kind: string
  actor_ref: string | null
  previous_ref: string
  next_ref: string
  previous_version: string | null
  next_version: string | null
  changed_at: string | Date | null
  reason: string | null
  metadata?: unknown
}

export interface PlanAssistLineageEvent {
  id: string
  kind: PlanAssistLineageEventKind
  sourceTable: string
  fieldPath: string
  source: string | null
  actorKind: string
  actorRef: string | null
  chapter: number | null
  attempt: number | null
  changedAt: string | null
  previousRef: string
  nextRef: string
  previousVersion: string | null
  nextVersion: string | null
  reason: string | null
  decision: string | null
  planAssistKind: string | null
  reviserSource: string | null
  revisionId: number | null
  issueCount: number | null
  unresolvedDeviationCount: number | null
  previousBeatIds: string[]
  nextBeatIds: string[]
  beatsAdded: string[]
  beatsRemoved: string[]
  beatsRetained: string[]
  previousValue: unknown
  nextValue: unknown
}

export interface PlanAssistLineageChapterSummary {
  chapter: number | null
  totalEvents: number
  planAssistEdits: number
  planAssistOverrides: number
  reviserAccepted: number
  unknown: number
  events: PlanAssistLineageEvent[]
}

export interface PlanAssistLineageReport {
  novelId: string | null
  totalEvents: number
  planAssistEdits: number
  planAssistOverrides: number
  reviserAccepted: number
  unknown: number
  chapters: PlanAssistLineageChapterSummary[]
}

interface Args {
  novelId: string | null
  json: boolean
}

export function buildPlanAssistLineageReport(
  rows: PlanAssistLineageRow[],
  novelId: string | null = null,
): PlanAssistLineageReport {
  const events = rows.map(rowToEvent).sort((a, b) => {
    const chapterDelta = compareNullableNumber(a.chapter, b.chapter)
    if (chapterDelta !== 0) return chapterDelta
    const attemptDelta = compareNullableNumber(a.attempt, b.attempt)
    if (attemptDelta !== 0) return attemptDelta
    return compareTimestamps(a.changedAt, b.changedAt) || a.id.localeCompare(b.id)
  })

  const byChapter = new Map<string, PlanAssistLineageEvent[]>()
  for (const event of events) {
    const key = event.chapter === null ? "null" : String(event.chapter)
    const list = byChapter.get(key) ?? []
    list.push(event)
    byChapter.set(key, list)
  }

  const chapters: PlanAssistLineageChapterSummary[] = [...byChapter.values()].map((chapterEvents) => {
    const first = chapterEvents[0]!
    return {
      chapter: first.chapter,
      totalEvents: chapterEvents.length,
      planAssistEdits: chapterEvents.filter((e) => e.kind === "plan_assist_edit").length,
      planAssistOverrides: chapterEvents.filter((e) => e.kind === "plan_assist_override").length,
      reviserAccepted: chapterEvents.filter((e) => e.kind === "reviser_accepted").length,
      unknown: chapterEvents.filter((e) => e.kind === "unknown").length,
      events: chapterEvents,
    }
  })

  return {
    novelId,
    totalEvents: events.length,
    planAssistEdits: events.filter((e) => e.kind === "plan_assist_edit").length,
    planAssistOverrides: events.filter((e) => e.kind === "plan_assist_override").length,
    reviserAccepted: events.filter((e) => e.kind === "reviser_accepted").length,
    unknown: events.filter((e) => e.kind === "unknown").length,
    chapters,
  }
}

export function renderPlanAssistLineageReport(report: PlanAssistLineageReport): string {
  const lines: string[] = []
  lines.push(`Plan-assist lineage report${report.novelId ? ` for ${report.novelId}` : ""}`)
  lines.push(
    `Events: ${report.totalEvents} total — ` +
      `plan-assist edits: ${report.planAssistEdits}, ` +
      `plan-assist overrides: ${report.planAssistOverrides}, ` +
      `reviser-accepted: ${report.reviserAccepted}` +
      (report.unknown > 0 ? `, unknown: ${report.unknown}` : ""),
  )
  if (report.chapters.length === 0) {
    lines.push("No plan-assist or reviser lineage rows found.")
    return lines.join("\n")
  }

  for (const chapter of report.chapters) {
    const label = chapter.chapter === null ? "chapter ?" : `chapter ${chapter.chapter}`
    lines.push("")
    lines.push(
      `${label}: events=${chapter.totalEvents}, edits=${chapter.planAssistEdits}, ` +
        `overrides=${chapter.planAssistOverrides}, reviser=${chapter.reviserAccepted}` +
        (chapter.unknown > 0 ? `, unknown=${chapter.unknown}` : ""),
    )
    for (const event of chapter.events) {
      lines.push(`  - ${formatEvent(event)}`)
    }
  }
  return lines.join("\n")
}

function formatEvent(event: PlanAssistLineageEvent): string {
  const ts = event.changedAt ?? "?"
  const attempt = event.attempt === null ? "?" : String(event.attempt)
  const head = `${ts} attempt ${attempt} ${kindLabel(event)}`
  const tail: string[] = []
  if (event.kind === "plan_assist_edit") {
    if (event.unresolvedDeviationCount !== null) tail.push(`unresolved=${event.unresolvedDeviationCount}`)
    if (event.beatsRemoved.length > 0) tail.push(`removed=${event.beatsRemoved.length}`)
    if (event.beatsAdded.length > 0) tail.push(`added=${event.beatsAdded.length}`)
    if (event.beatsRetained.length > 0) tail.push(`retained=${event.beatsRetained.length}`)
  } else if (event.kind === "plan_assist_override") {
    tail.push(`previous=${stringifyValue(event.previousValue)} → next=${stringifyValue(event.nextValue)}`)
  } else if (event.kind === "reviser_accepted") {
    if (event.reviserSource) tail.push(`source=${event.reviserSource}`)
    if (event.revisionId !== null) tail.push(`revision=${event.revisionId}`)
    if (event.issueCount !== null) tail.push(`issues=${event.issueCount}`)
    if (event.beatsRemoved.length > 0) tail.push(`removed=${event.beatsRemoved.length}`)
    if (event.beatsAdded.length > 0) tail.push(`added=${event.beatsAdded.length}`)
  }
  return tail.length > 0 ? `${head} (${tail.join(", ")})` : head
}

function kindLabel(event: PlanAssistLineageEvent): string {
  switch (event.kind) {
    case "plan_assist_edit":
      return `plan-assist edit-plan${event.planAssistKind ? ` [${event.planAssistKind}]` : ""}`
    case "plan_assist_override":
      return `plan-assist override${event.planAssistKind ? ` [${event.planAssistKind}]` : ""}`
    case "reviser_accepted":
      return "chapter-plan-reviser accepted"
    default:
      return `${event.sourceTable}:${event.fieldPath}`
  }
}

function rowToEvent(row: PlanAssistLineageRow): PlanAssistLineageEvent {
  const metadata = normalizeMetadata(row.metadata)
  const kind = classifyKind(row, metadata)
  const previousBeatIds = stringArray(metadata["previousBeatIds"])
  const nextBeatIds = stringArray(metadata["nextBeatIds"])
  const previousSet = new Set(previousBeatIds)
  const nextSet = new Set(nextBeatIds)
  const beatsAdded = nextBeatIds.filter((id) => !previousSet.has(id))
  const beatsRemoved = previousBeatIds.filter((id) => !nextSet.has(id))
  const beatsRetained = nextBeatIds.filter((id) => previousSet.has(id))

  return {
    id: row.id,
    kind,
    sourceTable: row.source_table,
    fieldPath: row.field_path,
    source: row.source,
    actorKind: row.actor_kind,
    actorRef: row.actor_ref,
    chapter: optionalNumber(metadata["chapter"]),
    attempt: optionalNumber(metadata["attempt"]),
    changedAt: normalizeTimestamp(row.changed_at),
    previousRef: row.previous_ref,
    nextRef: row.next_ref,
    previousVersion: row.previous_version,
    nextVersion: row.next_version,
    reason: row.reason,
    decision: optionalString(metadata["decision"]),
    planAssistKind: optionalString(metadata["planAssistKind"]),
    reviserSource: optionalString(metadata["source"]),
    revisionId: optionalNumber(metadata["revisionId"]),
    issueCount: optionalNumber(metadata["issueCount"]),
    unresolvedDeviationCount: optionalNumber(metadata["unresolvedDeviationCount"]),
    previousBeatIds,
    nextBeatIds,
    beatsAdded,
    beatsRemoved,
    beatsRetained,
    previousValue: metadata["previousValue"] ?? null,
    nextValue: metadata["nextValue"] ?? null,
  }
}

function classifyKind(row: PlanAssistLineageRow, metadata: Record<string, unknown>): PlanAssistLineageEventKind {
  if (row.source_table === "chapter_exhaustions") {
    if (row.field_path === "planCheckOverridden" || metadata["decision"] === "override") {
      return "plan_assist_override"
    }
    if (row.field_path === "outline" || metadata["decision"] === "edit-plan") {
      return "plan_assist_edit"
    }
    return "unknown"
  }
  if (row.source_table === "chapter_revisions") {
    return "reviser_accepted"
  }
  return "unknown"
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // fall through
    }
  }
  return {}
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry === "string" && entry.length > 0) out.push(entry)
  }
  return out
}

function optionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function normalizeTimestamp(value: string | Date | null | undefined): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string" && value.length > 0) return value
  return null
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "null"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

function compareTimestamps(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a.localeCompare(b)
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

async function loadRows(novelId: string): Promise<PlanAssistLineageRow[]> {
  const { default: db } = await import("../../src/db/connection")
  return (await db`
    SELECT id, novel_id, source_table, field_path, source, actor_kind, actor_ref,
           previous_ref, next_ref, previous_version, next_version,
           changed_at, reason, metadata
    FROM planning_mutation_lineage
    WHERE novel_id = ${novelId}
      AND source_table IN ('chapter_exhaustions', 'chapter_revisions')
    ORDER BY changed_at ASC, id ASC
  `) as PlanAssistLineageRow[]
}

async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgs(argv)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    console.error(
      "usage: bun scripts/analysis/plan-assist-lineage-report.ts --novel <novelId> [--json]",
    )
    return 2
  }

  if (!args.novelId) {
    console.error(
      "usage: bun scripts/analysis/plan-assist-lineage-report.ts --novel <novelId> [--json]",
    )
    return 2
  }

  const rows = await loadRows(args.novelId)
  const report = buildPlanAssistLineageReport(rows, args.novelId)
  console.log(args.json ? JSON.stringify(report, null, 2) : renderPlanAssistLineageReport(report))
  return 0
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)))
}
