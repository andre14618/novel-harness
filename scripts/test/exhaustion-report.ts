#!/usr/bin/env bun
/**
 * Exhaustion-handler telemetry report.
 * Summarises per-novel gate lifecycle after test campaigns have populated
 * chapter_exhaustions and chapter_revisions.
 *
 * Usage:
 *   bun scripts/test/exhaustion-report.ts                         # last 24h
 *   bun scripts/test/exhaustion-report.ts --novel-id=test-foo-123 # single novel
 *   bun scripts/test/exhaustion-report.ts --since=2026-04-19T00:00:00Z
 *   bun scripts/test/exhaustion-report.ts --json                  # machine-readable
 */

import db from "../../src/db/connection"
import type { ExhaustionKind, ExhaustionResolverMode, ExhaustionDecision } from "../../src/db/chapter-exhaustions"
import type { RevisionOutcome } from "../../src/db/chapter-revisions"

// ── ANSI colours ─────────────────────────────────────────────────────────────

const USE_COLOR = process.stdout.isTTY

const C = {
  reset:  USE_COLOR ? "\x1b[0m"  : "",
  dim:    USE_COLOR ? "\x1b[2m"  : "",
  red:    USE_COLOR ? "\x1b[31m" : "",
  bold:   USE_COLOR ? "\x1b[1m"  : "",
}

function dim(s: string): string  { return `${C.dim}${s}${C.reset}` }
function red(s: string): string  { return `${C.red}${s}${C.reset}` }
function bold(s: string): string { return `${C.bold}${s}${C.reset}` }

// ── Relative time ─────────────────────────────────────────────────────────────

function relTime(iso: string | null): string {
  if (!iso) return "—"
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < 0) return "in the future"
  const s = Math.floor(diffMs / 1000)
  if (s < 60)   return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60)   return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24)   return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function diffSecs(a: string | null, b: string | null): string {
  if (!a || !b) return "?"
  const diff = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000)
  return `+${diff}s`
}

function hhmm(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, "0")
  const mm = String(d.getMinutes()).padStart(2, "0")
  const ss = String(d.getSeconds()).padStart(2, "0")
  return `${hh}:${mm}:${ss}`
}

// ── Counter helpers ───────────────────────────────────────────────────────────

function countBy<T extends string>(arr: T[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const v of arr) m[v] = (m[v] ?? 0) + 1
  return m
}

function fmtCounts(m: Record<string, number>): string {
  return Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}:${v}`)
    .join(", ")
}

// ── DB row types ──────────────────────────────────────────────────────────────

interface ExhaustionRaw {
  id: number
  novel_id: string
  chapter: number
  attempt: number
  fired_at: string
  kind: ExhaustionKind
  resolver_mode: ExhaustionResolverMode
  unresolved_deviations: any
  reviser_history: any
  decided_at: string | null
  decision: ExhaustionDecision | null
  decision_details: any
}

interface RevisionRaw {
  id: number
  novel_id: string
  chapter: number
  attempt: number
  invoked_at: string
  issue_sig: string
  issue_count: number
  original_beat_count: number
  revised_beat_count: number | null
  outcome: RevisionOutcome
  rejection_reason: string | null
}

interface NovelMeta {
  id: string
  phase: string
  seed_json: any
  current_chapter: number
  total_chapters: number
  updated_at: string
}

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2)
  let novelId: string | null = null
  let since: string | null = null
  let json = false

  for (const a of argv) {
    if (a.startsWith("--novel-id=")) novelId = a.slice("--novel-id=".length)
    else if (a.startsWith("--since=")) since = a.slice("--since=".length)
    else if (a === "--json") json = true
  }

  // Default: last 24 hours
  if (!novelId && !since) {
    const d = new Date(Date.now() - 24 * 60 * 60 * 1000)
    since = d.toISOString()
  }

  return { novelId, since, json }
}

// ── Queries ───────────────────────────────────────────────────────────────────

// Bun.sql passes a JS string array as a comma-joined text parameter, not a
// Postgres array literal, so `ANY(${arr})` fails with "malformed array
// literal". Wrap via `string_to_array(${csv}, ',')` — safe because novel
// IDs are `novel-${Date.now()}-${rand}` format and never contain commas.
function idsClause(ids: string[]): string {
  return ids.join(",")
}

async function fetchNovelIds(args: { novelId: string | null; since: string | null }): Promise<string[]> {
  if (args.novelId) return [args.novelId]

  // All novel_ids from chapter_exhaustions within the time window
  const rows = await db`
    SELECT DISTINCT novel_id
    FROM chapter_exhaustions
    WHERE fired_at >= ${args.since!}
    ORDER BY novel_id
  ` as any[]
  return rows.map((r: any) => r.novel_id as string)
}

async function fetchExhaustions(novelIds: string[]): Promise<ExhaustionRaw[]> {
  if (novelIds.length === 0) return []
  const rows = await db`
    SELECT id, novel_id, chapter, attempt,
           fired_at::text AS fired_at,
           kind, resolver_mode,
           unresolved_deviations, reviser_history,
           decided_at::text AS decided_at,
           decision, decision_details
    FROM chapter_exhaustions
    WHERE novel_id = ANY(string_to_array(${idsClause(novelIds)}, ','))
    ORDER BY novel_id, chapter, fired_at
  ` as any[]
  return rows as ExhaustionRaw[]
}

async function fetchRevisions(novelIds: string[]): Promise<RevisionRaw[]> {
  if (novelIds.length === 0) return []
  const rows = await db`
    SELECT id, novel_id, chapter, attempt,
           invoked_at::text AS invoked_at,
           issue_sig, issue_count, original_beat_count, revised_beat_count,
           outcome, rejection_reason
    FROM chapter_revisions
    WHERE novel_id = ANY(string_to_array(${idsClause(novelIds)}, ','))
    ORDER BY novel_id, chapter, invoked_at
  ` as any[]
  return rows as RevisionRaw[]
}

async function fetchNovels(novelIds: string[]): Promise<NovelMeta[]> {
  if (novelIds.length === 0) return []
  const rows = await db`
    SELECT id, phase, seed_json, current_chapter, total_chapters,
           updated_at::text AS updated_at
    FROM novels
    WHERE id = ANY(string_to_array(${idsClause(novelIds)}, ','))
  ` as any[]
  return rows as NovelMeta[]
}

// ── Per-novel analysis ────────────────────────────────────────────────────────

interface NovelReport {
  novelId: string
  seed: string
  phase: string
  currentChapter: number
  totalChapters: number
  updatedAt: string
  exhaustions: ExhaustionRaw[]
  revisions: RevisionRaw[]
  anomalies: string[]
}

function buildNovelReport(
  novelId: string,
  meta: NovelMeta | undefined,
  exhaustions: ExhaustionRaw[],
  revisions: RevisionRaw[],
): NovelReport {
  const seed = meta?.seed_json?.genre
    ? `${meta.seed_json.genre}${meta.seed_json.title ? ` (${meta.seed_json.title})` : ""}`
    : "unknown"

  const anomalies: string[] = []

  // Anomaly 1: >1 non-skip reviser invocation on same chapter (hard-cap violation)
  const nonSkipOutcomes: RevisionOutcome[] = ["accepted", "rejected_beat_floor", "rejected_new_characters", "error"]
  const byChapter = new Map<number, RevisionRaw[]>()
  for (const r of revisions) {
    if (!byChapter.has(r.chapter)) byChapter.set(r.chapter, [])
    byChapter.get(r.chapter)!.push(r)
  }
  for (const [ch, rows] of byChapter) {
    const nonSkip = rows.filter(r => nonSkipOutcomes.includes(r.outcome))
    if (nonSkip.length > 1) {
      anomalies.push(`chapter ${ch}: ${nonSkip.length} reviser invocations with non-skip outcome (hard cap violated?)`)
    }
  }

  // Anomaly 2: reviser-rejected exhaustion with no matching chapter_revisions row
  const reviserRejectedExh = exhaustions.filter(e => e.kind === "reviser-rejected")
  for (const e of reviserRejectedExh) {
    const match = revisions.find(r =>
      r.chapter === e.chapter && r.attempt === e.attempt &&
      !r.outcome.startsWith("skip_")
    )
    if (!match) {
      anomalies.push(
        `ch${e.chapter} attempt${e.attempt}: kind=reviser-rejected but no matching chapter_revisions row (telemetry gap?)`
      )
    }
  }

  // Anomaly 3: stuck run — drafting phase, no pending gates, >1h since update
  if (meta) {
    const hasPendingGate = exhaustions.some(e => e.decided_at === null)
    const msSinceUpdate = Date.now() - new Date(meta.updated_at).getTime()
    if (meta.phase === "drafting" && !hasPendingGate && msSinceUpdate > 60 * 60 * 1000) {
      anomalies.push(`phase=drafting, no pending gates, last update ${relTime(meta.updated_at)} — possibly stuck`)
    }
  }

  return {
    novelId,
    seed,
    phase: meta?.phase ?? "unknown",
    currentChapter: meta?.current_chapter ?? 0,
    totalChapters: meta?.total_chapters ?? 0,
    updatedAt: meta?.updated_at ?? "",
    exhaustions,
    revisions,
    anomalies,
  }
}

// ── Pretty printer ────────────────────────────────────────────────────────────

function printNovelBlock(r: NovelReport): void {
  console.log()
  console.log(bold(`═══ ${r.novelId} ═══`))
  console.log(`  seed:     ${r.seed}`)
  console.log(`  phase:    ${r.phase}`)
  const chStr = r.totalChapters > 0
    ? `ch ${r.currentChapter} of ${r.totalChapters}`
    : `ch ${r.currentChapter}`
  console.log(`  chapters: ${chStr} · last update ${relTime(r.updatedAt)}`)

  // ── Exhaustion timeline ────────────────────────────────────────────────
  console.log()
  console.log("  Exhaustion timeline:")
  if (r.exhaustions.length === 0) {
    console.log(dim("    (none)"))
  } else {
    for (const e of r.exhaustions) {
      const decision = e.decided_at ? (e.decision ?? "?") : "pending"
      const resolved = e.decided_at ? ` (resolved ${diffSecs(e.fired_at, e.decided_at)})` : ""
      const decStr = decision === "pending"
        ? dim("→ pending")
        : `→ ${decision}${resolved}`
      console.log(
        `    ch${e.chapter} att${e.attempt}  ${hhmm(e.fired_at)}  ${e.kind.padEnd(22)}  ${e.resolver_mode.padEnd(4)}  ${decStr}`
      )
    }
  }

  // ── Reviser lifecycle ──────────────────────────────────────────────────
  console.log()
  console.log("  Reviser lifecycle:")
  if (r.revisions.length === 0) {
    console.log(dim("    (none)"))
  } else {
    for (const rev of r.revisions) {
      const noteRaw = rev.rejection_reason ?? ""
      const note = noteRaw.length > 80 ? noteRaw.slice(0, 77) + "…" : noteRaw
      const noteStr = note ? `  ${dim(note)}` : ""
      console.log(
        `    ch${rev.chapter} att${rev.attempt}  ${rev.outcome.padEnd(32)}${noteStr}`
      )
    }
  }

  // ── Counts ──────────────────────────────────────────────────────────────
  console.log()
  console.log("  Counts:")

  const fires = r.exhaustions.length
  const kindCounts = countBy(r.exhaustions.map(e => e.kind))
  console.log(`    gate fires:     ${fires}${fires > 0 ? ` (${fmtCounts(kindCounts)})` : ""}`)

  const resolved = r.exhaustions.filter(e => e.decided_at !== null)
  const pending  = r.exhaustions.filter(e => e.decided_at === null)
  const decCounts = countBy(resolved.map(e => e.decision ?? "unknown"))
  const decSummary = resolved.length > 0 ? ` (${fmtCounts(decCounts)})` : ""
  console.log(`    decisions:      ${resolved.length} resolved${decSummary}, ${pending.length} pending`)

  const nonSkipRevs = r.revisions.filter(rev => !rev.outcome.startsWith("skip_"))
  const skipRevs    = r.revisions.filter(rev => rev.outcome.startsWith("skip_"))
  const accepted    = nonSkipRevs.filter(rev => rev.outcome === "accepted").length
  const rejected    = nonSkipRevs.filter(rev => rev.outcome !== "accepted").length
  const skipCounts  = countBy(skipRevs.map(rev => rev.outcome))
  const skipStr     = skipRevs.length > 0 ? `; ${skipRevs.length} skip (${fmtCounts(skipCounts)})` : ""
  console.log(
    `    reviser calls:  ${nonSkipRevs.length} invocations, ${accepted} accepted, ${rejected} rejected${skipStr}`
  )

  const modeCounts = countBy(r.exhaustions.map(e => e.resolver_mode))
  console.log(`    resolver-mode split: ${fmtCounts(modeCounts)}`)

  // ── Anomalies ──────────────────────────────────────────────────────────
  if (r.anomalies.length > 0) {
    console.log()
    console.log(red("  Anomalies:"))
    for (const a of r.anomalies) {
      console.log(red(`    - ${a}`))
    }
  }
}

// ── Roll-up ───────────────────────────────────────────────────────────────────

interface RollupAnomaly {
  novelId: string
  message: string
}

function printRollup(reports: NovelReport[]): void {
  console.log()
  console.log(bold("═══ CAMPAIGN ROLL-UP ═══"))

  const allExh = reports.flatMap(r => r.exhaustions)
  const allRev = reports.flatMap(r => r.revisions)

  console.log(`  novels inspected: ${reports.length}`)
  console.log(`  total gate fires: ${allExh.length}`)

  if (allExh.length > 0) {
    const kindCounts = countBy(allExh.map(e => e.kind))
    const modeCounts = countBy(allExh.map(e => e.resolver_mode))
    const resolved   = allExh.filter(e => e.decided_at !== null)
    const pending    = allExh.filter(e => e.decided_at === null)
    const decCounts  = countBy([
      ...resolved.map(e => e.decision ?? "unknown"),
      ...pending.map(() => "pending"),
    ])
    console.log(`    by kind:       ${fmtCounts(kindCounts)}`)
    console.log(`    by mode:       ${fmtCounts(modeCounts)}`)
    console.log(`    by decision:   ${fmtCounts(decCounts)}`)
  }

  const nonSkipRevs = allRev.filter(r => !r.outcome.startsWith("skip_"))
  const skipRevs    = allRev.filter(r => r.outcome.startsWith("skip_"))
  const accepted    = nonSkipRevs.filter(r => r.outcome === "accepted").length
  const rejected    = nonSkipRevs.filter(r => r.outcome !== "accepted").length
  const skipCounts  = countBy(skipRevs.map(r => r.outcome))
  const skipStr     = skipRevs.length > 0 ? `\n    skip rows: ${skipRevs.length} (${fmtCounts(skipCounts)})` : ""
  console.log(
    `  total reviser invocations: ${nonSkipRevs.length} (${accepted} accepted, ${rejected} rejected)${skipStr}`
  )

  // Cross-novel anomalies
  const allAnomalies: RollupAnomaly[] = reports
    .flatMap(r => r.anomalies.map(a => ({ novelId: r.novelId, message: a })))

  if (allAnomalies.length > 0) {
    console.log()
    console.log(red("  Anomalies:"))
    for (const a of allAnomalies) {
      console.log(red(`    - ${a.novelId}: ${a.message}`))
    }
  } else {
    console.log()
    console.log(dim("  No anomalies."))
  }
}

// ── JSON output ───────────────────────────────────────────────────────────────

function emitJson(reports: NovelReport[]): void {
  const allExh = reports.flatMap(r => r.exhaustions)
  const allRev = reports.flatMap(r => r.revisions)
  const nonSkipRevs = allRev.filter(r => !r.outcome.startsWith("skip_"))
  const skipRevs    = allRev.filter(r => r.outcome.startsWith("skip_"))

  const output = {
    generatedAt: new Date().toISOString(),
    novelsInspected: reports.length,
    rollup: {
      totalGateFires: allExh.length,
      byKind:     countBy(allExh.map(e => e.kind)),
      byMode:     countBy(allExh.map(e => e.resolver_mode)),
      byDecision: countBy(allExh.map(e => e.decided_at ? (e.decision ?? "unknown") : "pending")),
      reviserInvocations: nonSkipRevs.length,
      reviserAccepted:    nonSkipRevs.filter(r => r.outcome === "accepted").length,
      reviserRejected:    nonSkipRevs.filter(r => r.outcome !== "accepted").length,
      skipRows:     skipRevs.length,
      skipByOutcome: countBy(skipRevs.map(r => r.outcome)),
    },
    novels: reports.map(r => ({
      novelId:       r.novelId,
      seed:          r.seed,
      phase:         r.phase,
      currentChapter: r.currentChapter,
      totalChapters: r.totalChapters,
      updatedAt:     r.updatedAt,
      exhaustionCount: r.exhaustions.length,
      revisionCount:   r.revisions.length,
      anomalies:       r.anomalies,
      exhaustions: r.exhaustions.map(e => ({
        id:          e.id,
        chapter:     e.chapter,
        attempt:     e.attempt,
        firedAt:     e.fired_at,
        kind:        e.kind,
        resolverMode: e.resolver_mode,
        decidedAt:   e.decided_at,
        decision:    e.decision,
      })),
      revisions: r.revisions.map(rev => ({
        id:               rev.id,
        chapter:          rev.chapter,
        attempt:          rev.attempt,
        invokedAt:        rev.invoked_at,
        outcome:          rev.outcome,
        rejectionReason:  rev.rejection_reason,
        originalBeatCount: rev.original_beat_count,
        revisedBeatCount:  rev.revised_beat_count,
      })),
    })),
  }
  console.log(JSON.stringify(output, null, 2))
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs()

  // Resolve novel IDs to inspect
  const novelIds = await fetchNovelIds(args)

  if (novelIds.length === 0) {
    const window = args.since
      ? `since ${args.since}`
      : args.novelId
        ? `novel-id=${args.novelId}`
        : "last 24h"
    console.log(`No novels found in chapter_exhaustions (${window}).`)
    process.exit(0)
  }

  // Bulk-fetch all data (3 queries total regardless of novel count)
  const [exhaustions, revisions, novelMetas] = await Promise.all([
    fetchExhaustions(novelIds),
    fetchRevisions(novelIds),
    fetchNovels(novelIds),
  ])

  // Index by novel_id for O(1) grouping
  const exhByNovel = new Map<string, ExhaustionRaw[]>()
  const revByNovel = new Map<string, RevisionRaw[]>()
  const metaById   = new Map<string, NovelMeta>()

  for (const id of novelIds) {
    exhByNovel.set(id, [])
    revByNovel.set(id, [])
  }
  for (const e of exhaustions) exhByNovel.get(e.novel_id)?.push(e)
  for (const r of revisions)   revByNovel.get(r.novel_id)?.push(r)
  for (const m of novelMetas)  metaById.set(m.id, m)

  // Build per-novel reports
  const reports: NovelReport[] = novelIds.map(id =>
    buildNovelReport(
      id,
      metaById.get(id),
      exhByNovel.get(id) ?? [],
      revByNovel.get(id) ?? [],
    )
  )

  if (args.json) {
    emitJson(reports)
    process.exit(0)
  }

  // Pretty-print
  for (const r of reports) {
    printNovelBlock(r)
  }

  if (reports.length > 1) {
    printRollup(reports)
  }

  console.log()
  process.exit(0)
}

main().catch(err => {
  console.error("exhaustion-report crashed:", err)
  process.exit(1)
})
