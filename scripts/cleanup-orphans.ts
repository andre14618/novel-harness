/**
 * cleanup-orphans.ts
 *
 * Delete stale test novels and their cascading rows from all novel-scoped tables.
 * Default mode is DRY RUN — nothing is deleted unless --apply is passed.
 *
 * Usage:
 *   bun scripts/cleanup-orphans.ts [--dry-run] [--apply] [--older-than=24h] [--pattern=test-exhaustion-*] [--verbose]
 *
 * Flags:
 *   --dry-run      (implied unless --apply given) Show what WOULD be deleted; touch nothing
 *   --apply        Actually delete. Required for live deletions.
 *   --older-than   Age cutoff. Accepts Nh (hours) or Nd (days). Default: 24h.
 *   --pattern      Glob-like pattern matched against both novel.id and seed_json->>'title'.
 *                  Supports leading/trailing wildcards only (e.g. test-exhaustion-* or *foo*).
 *                  Default: test-* (matches id LIKE 'test-%' OR title LIKE 'test-%').
 *   --verbose      Print every candidate and per-table row counts.
 *
 * Safety:
 *   - Never deletes novels with active phases unless updated_at is older than 2 hours.
 *   - Never deletes novels with approved chapter drafts.
 *   - Default pattern only matches test-* IDs/titles.
 *   - Every delete runs in a per-novel transaction.
 *   - Does NOT touch the archive schema.
 */

import db from "../src/db/connection"

// ── Argument parsing ────────────────────────────────────────────────────────

interface Args {
  dryRun: boolean
  olderThanHours: number
  pattern: string
  verbose: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let dryRun = true
  let olderThanHours = 24
  let pattern = "test-*"
  let verbose = false

  for (const arg of argv) {
    if (arg === "--apply") {
      dryRun = false
    } else if (arg === "--dry-run") {
      dryRun = true
    } else if (arg === "--verbose") {
      verbose = true
    } else if (arg.startsWith("--older-than=")) {
      const val = arg.replace("--older-than=", "").trim()
      const match = val.match(/^(\d+)(h|d)$/)
      if (!match) {
        console.error(`Invalid --older-than value: "${val}". Use Nh or Nd (e.g. 24h, 7d).`)
        process.exit(1)
      }
      const n = parseInt(match[1], 10)
      olderThanHours = match[2] === "d" ? n * 24 : n
    } else if (arg.startsWith("--pattern=")) {
      pattern = arg.replace("--pattern=", "")
    } else {
      console.error(`Unknown argument: ${arg}`)
      process.exit(1)
    }
  }

  return { dryRun, olderThanHours, pattern, verbose }
}

// ── Pattern → SQL LIKE conversion ──────────────────────────────────────────

/**
 * Convert a simple glob-like pattern (leading/trailing * only) to a SQL LIKE pattern.
 * e.g. "test-*"  → "test-%"
 *      "*foo*"   → "%foo%"
 *      "test-x"  → "test-x" (exact match)
 */
function globToLike(pattern: string): string {
  // Replace leading/trailing * with %. Do NOT allow mid-pattern wildcards to
  // prevent accidental broad matches.
  let p = pattern
  const leadingWild = p.startsWith("*")
  const trailingWild = p.endsWith("*")
  if (leadingWild) p = p.slice(1)
  if (trailingWild) p = p.slice(0, -1)
  // Escape any SQL special chars in the literal portion
  p = p.replace(/%/g, "\\%").replace(/_/g, "\\_")
  if (leadingWild) p = "%" + p
  if (trailingWild) p = p + "%"
  return p
}

// ── Active-phase check ──────────────────────────────────────────────────────

const ACTIVE_PHASES = new Set(["concept", "planning", "drafting", "validation"])
const STALE_ACTIVE_THRESHOLD_HOURS = 2

// ── Row-counting helpers ────────────────────────────────────────────────────

interface TableCount {
  table: string
  count: number
}

/** Count rows for a given table and novel_id. Returns 0 on missing table (graceful). */
async function countRows(table: string, novelId: string): Promise<number> {
  try {
    // Using db.unsafe here because table name is from our controlled list — never user input.
    const rows = await db.unsafe(`SELECT COUNT(*)::int AS cnt FROM ${table} WHERE novel_id = $1`, [novelId])
    return rows[0]?.cnt ?? 0
  } catch (err: any) {
    if (err?.message?.includes("does not exist")) return 0
    throw err
  }
}

/**
 * All novel-scoped tables in deletion order (children before parents where FK exists).
 * Tables with FK REFERENCES novels(id) must come before the novels row itself.
 * Tables without FK (chapter_revisions, chapter_exhaustions, llm_calls, pipeline_events,
 * finetune_training_data) have no ordering constraint but are included for completeness.
 *
 * Source of truth audit (verified against information_schema.constraint_column_usage
 * on the live DB — Codex review C, HIGH: prior list omitted 4 FK tables that
 * would cause DELETE FROM novels to throw an FK-constraint error):
 *   sql/010_novel_data.sql          → characters, world_bibles, story_spines,
 *                                      chapter_outlines, chapter_drafts, chapter_summaries,
 *                                      facts, character_states, issues, validation_passes
 *   sql/011_vector_graph.sql        → world_systems, cultures, character_cultures,
 *                                      character_system_awareness, relationship_states,
 *                                      timeline_events, character_knowledge,
 *                                      event_causes, knowledge_propagation,
 *                                      retrieval_config
 *   sql/012_deterministic_config.sql → deterministic_config
 *   sql/016_finetune_training_data.sql → finetune_training_data (novel_id nullable, no FK)
 *   sql/017_llm_call_inspection.sql    → llm_calls.novel_id (no FK)
 *   sql/020_pipeline_events.sql        → pipeline_events (no FK)
 *   sql/028_chapter_revisions.sql      → chapter_revisions (no FK, explicit Codex note)
 *   sql/030_chapter_exhaustions.sql    → chapter_exhaustions (no FK, explicit Codex note)
 */
const NOVEL_SCOPED_TABLES: string[] = [
  // No-FK telemetry tables — delete first (no constraint issues either way, but
  // deleting before the novel row is cleaner and mirrors what a CASCADE would do)
  "chapter_exhaustions",
  "chapter_revisions",
  "pipeline_events",
  "llm_calls",
  "finetune_training_data",
  // FK tables: leaf → parent order within each FK chain
  "event_causes",
  "knowledge_propagation",
  "character_knowledge",
  "timeline_events",
  "relationship_states",
  "character_system_awareness",
  "character_cultures",
  "cultures",
  "world_systems",
  "retrieval_config",
  "deterministic_config",
  "validation_passes",
  "issues",
  "character_states",
  "facts",
  "chapter_summaries",
  "chapter_drafts",
  "chapter_outlines",
  "characters",
  "story_spines",
  "world_bibles",
]

// ── Candidate selection ─────────────────────────────────────────────────────

interface Candidate {
  id: string
  phase: string
  createdAt: Date
  updatedAt: Date
  ageHours: number
  title: string | null
}

async function findCandidates(args: Args): Promise<Candidate[]> {
  const like = globToLike(args.pattern)

  // Two patterns: one for the novel id, one for the seed title extracted from JSONB.
  // If the glob has a leading wildcard we use it as-is; otherwise prefix it for the
  // id match only when the default "test-*" pattern is in use.
  const rows = await db.unsafe(
    `
    SELECT
      n.id,
      n.phase,
      n.created_at,
      n.updated_at,
      EXTRACT(EPOCH FROM (now() - n.created_at)) / 3600 AS age_hours,
      n.seed_json->>'title' AS title
    FROM novels n
    WHERE
      (n.id LIKE $1 OR n.seed_json->>'title' LIKE $1)
      AND n.created_at < now() - ($2 || ' hours')::INTERVAL
    ORDER BY n.created_at ASC
    `,
    [like, String(args.olderThanHours)],
  )

  return rows.map((r: any) => ({
    id: r.id,
    phase: r.phase,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    ageHours: parseFloat(r.age_hours),
    title: r.title ?? null,
  }))
}

async function hasApprovedDrafts(novelId: string): Promise<boolean> {
  const rows = await db`
    SELECT 1 FROM chapter_drafts
    WHERE novel_id = ${novelId} AND status = 'approved'
    LIMIT 1
  `
  return rows.length > 0
}

function isActivePhase(candidate: Candidate): boolean {
  if (!ACTIVE_PHASES.has(candidate.phase)) return false
  const updatedAgeHours = (Date.now() - candidate.updatedAt.getTime()) / 3_600_000
  // If updated_at is stale (> 2h), treat as safe to kill even in active phase
  return updatedAgeHours < STALE_ACTIVE_THRESHOLD_HOURS
}

// ── Deletion (single transaction per novel) ─────────────────────────────────

async function deleteNovel(novelId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}

  await db.unsafe("BEGIN")
  try {
    for (const table of NOVEL_SCOPED_TABLES) {
      let deleted: any[]
      if (table === "llm_calls") {
        // llm_calls.novel_id is nullable — only delete where novel_id matches
        deleted = await db.unsafe(
          `DELETE FROM ${table} WHERE novel_id = $1 RETURNING id`,
          [novelId],
        )
      } else {
        deleted = await db.unsafe(
          `DELETE FROM ${table} WHERE novel_id = $1 RETURNING 1`,
          [novelId],
        )
      }
      counts[table] = deleted.length
    }
    // Finally delete the novel itself
    const novelRows = await db.unsafe(`DELETE FROM novels WHERE id = $1 RETURNING 1`, [novelId])
    counts["novels"] = novelRows.length
    await db.unsafe("COMMIT")
  } catch (err) {
    await db.unsafe("ROLLBACK")
    throw err
  }

  return counts
}

// ── Count rows per table (dry-run) ──────────────────────────────────────────

async function countAllTables(novelId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of NOVEL_SCOPED_TABLES) {
    counts[table] = await countRows(table, novelId)
  }
  counts["novels"] = 1 // The novel row itself
  return counts
}

// ── Formatting ──────────────────────────────────────────────────────────────

function fmtAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 48) return `${Math.round(hours)}h`
  return `${Math.round(hours / 24)}d`
}

function fmtTable(label: string, count: number, indent = "  "): string {
  return `${indent}${label.padEnd(30)} ${String(count).padStart(5)} rows`
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()

  console.log(`\n=== cleanup-orphans ===`)
  console.log(`  mode:         ${args.dryRun ? "DRY RUN (pass --apply to delete)" : "APPLY"}`)
  console.log(`  pattern:      ${args.pattern}  (→ LIKE ${globToLike(args.pattern)})`)
  console.log(`  older-than:   ${args.olderThanHours}h`)
  console.log(`  verbose:      ${args.verbose}`)
  console.log()

  const candidates = await findCandidates(args)
  console.log(`Found ${candidates.length} novels matching pattern + age cutoff.\n`)

  const totals: Record<string, number> = {}
  for (const t of [...NOVEL_SCOPED_TABLES, "novels"]) totals[t] = 0
  let skippedCount = 0
  let appliedCount = 0
  const eligibleNovels: Candidate[] = []

  for (const candidate of candidates) {
    const ageStr = fmtAge(candidate.ageHours)

    // Safety check 1: active phase + recently updated
    if (isActivePhase(candidate)) {
      console.log(`SKIP: ${candidate.id} — active phase '${candidate.phase}' (updated <2h ago)`)
      skippedCount++
      continue
    }

    // Safety check 2: has approved drafts
    const hasApproved = await hasApprovedDrafts(candidate.id)
    if (hasApproved) {
      console.log(`SKIP: ${candidate.id} — has approved chapter drafts`)
      skippedCount++
      continue
    }

    eligibleNovels.push(candidate)

    if (args.dryRun || args.verbose) {
      // Count rows for display
      const counts = await countAllTables(candidate.id)

      const titleSuffix = candidate.title ? `, title="${candidate.title}"` : ""
      const phaseSuffix = ACTIVE_PHASES.has(candidate.phase) ? ` [stale active: ${candidate.phase}]` : ``
      console.log(
        `\n=== ${candidate.id} (age ${ageStr}${titleSuffix}${phaseSuffix}) ===`,
      )

      const displayTables = [...NOVEL_SCOPED_TABLES, "novels"]
      for (const t of displayTables) {
        const cnt = counts[t] ?? 0
        if (args.verbose || cnt > 0) {
          console.log(fmtTable(t + ":", cnt))
        }
        totals[t] = (totals[t] ?? 0) + cnt
      }

      if (args.dryRun) {
        console.log(`  [DRY RUN: would delete]`)
      }
    } else {
      // Non-verbose apply path — accumulate totals without per-table count queries
      // (counts come from DELETE RETURNING in the transaction)
    }

    if (!args.dryRun) {
      try {
        const counts = await deleteNovel(candidate.id)
        appliedCount++
        for (const [t, c] of Object.entries(counts)) {
          totals[t] = (totals[t] ?? 0) + c
        }
        const titleSuffix = candidate.title ? `, title="${candidate.title}"` : ""
        if (args.verbose) {
          console.log(`  [DELETED]`)
        } else {
          const displayTables = [...NOVEL_SCOPED_TABLES, "novels"]
          console.log(`\n=== ${candidate.id} (age ${ageStr}${titleSuffix}) ===`)
          for (const t of displayTables) {
            const cnt = counts[t] ?? 0
            if (cnt > 0) console.log(fmtTable(t + ":", cnt))
          }
          console.log(`  [DELETED]`)
        }
      } catch (err: any) {
        console.error(`ERROR deleting ${candidate.id}: ${err.message}`)
      }
    }
  }

  // ── Totals ────────────────────────────────────────────────────────────────

  const totalCascadeRows = Object.entries(totals)
    .filter(([t]) => t !== "novels")
    .reduce((sum, [, c]) => sum + c, 0)
  const totalNovelRows = totals["novels"] ?? 0

  console.log(`\n=== TOTALS ===`)
  console.log(`  candidates:   ${candidates.length} matched pattern + age cutoff`)
  console.log(`  skipped:      ${skippedCount} (active or has approved drafts)`)
  console.log(`  eligible:     ${eligibleNovels.length} novels`)
  console.log(`  novel rows:   ${totalNovelRows}`)
  console.log(`  cascade rows: ${totalCascadeRows} total across ${NOVEL_SCOPED_TABLES.length} tables`)
  console.log(`  dry-run:      ${args.dryRun ? "yes" : "no"}`)
  console.log(`  applied:      ${appliedCount} deletions`)
  console.log()

  if (args.dryRun && eligibleNovels.length > 0) {
    console.log(`Re-run with --apply to execute deletions.`)
  }
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
