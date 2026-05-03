/**
 * harvest-v4-candidates.ts — Scoping stub for halluc-ungrounded-v4 active-learning harvest.
 *
 * Does NOT emit training files. Prints a candidate count + per-class breakdown when run.
 *
 * Usage:
 *   bun scripts/hallucination/harvest-v4-candidates.ts
 *
 * Optional flags:
 *   --min-date <ISO date>   filter to fires after this date (default: 2026-04-18)
 *   --max-per-novel <N>     cap per-novel solo fires (default: 20)
 *   --target <N>            target harvest size (default: 200)
 *
 * DB: reads llm_calls via ORCHESTRATOR_DB_URL (SSH tunnel to LXC required locally).
 *
 * See docs/scoping/halluc-ungrounded-v4-harvest.md for full methodology.
 */

import { parseArgs } from "util"
import db from "../../../src/db/connection"

// ── CLI args ────────────────────────────────────────────────────────────────

const { values: flags } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "min-date":      { type: "string",  default: "2026-04-18" },
    "max-per-novel": { type: "string",  default: "20" },
    "target":        { type: "string",  default: "200" },
    "verbose":       { type: "boolean", default: false },
  },
  strict: true,
  allowPositionals: false,
})

const MIN_DATE       = flags["min-date"] as string
const MAX_PER_NOVEL  = parseInt(flags["max-per-novel"] as string, 10)
const TARGET         = parseInt(flags["target"] as string, 10)
const VERBOSE        = flags["verbose"] as boolean

// ── Types ────────────────────────────────────────────────────────────────────

interface CandidateRow {
  id: number
  novel_id: string
  chapter: number
  beat_index: number
  attempt: number
  variant: string | null
  bible: string[]
  from_brief: string[]
  planner_emitted: string[]
  derived_outline_fact: string[]
  derived_prior_beat: string[]
  fired_entities: string[]
  response_content: string
  user_prompt: string
}

type CandidateClass =
  | "charter-v0"
  | "charter-v1"
  | "production-panel-7"
  | "production-other"

interface ClassBCandidate extends CandidateRow {
  matching_entities: string[]  // entities that appear in grounded sources
}

// ── SQL helpers ──────────────────────────────────────────────────────────────

/**
 * fetchSoloUngroundedFires
 *
 * SQL joins needed (see docs/scoping/halluc-ungrounded-v4-harvest.md §2):
 *
 *   FROM  llm_calls u                        -- the halluc-ungrounded call
 *
 *   WHERE u.agent = 'halluc-ungrounded'
 *     AND u.timestamp >= $minDate
 *     AND (u.response_content::jsonb)->>'pass' = 'false'
 *
 *     -- no co-fire: adherence-events must have PASSED on same tuple
 *     AND NOT EXISTS (
 *       SELECT 1 FROM llm_calls a
 *       WHERE a.novel_id    = u.novel_id
 *         AND a.agent       = 'adherence-events'
 *         AND a.chapter     = u.chapter
 *         AND a.beat_index  = u.beat_index
 *         AND a.attempt     = u.attempt
 *         AND (a.response_content::jsonb)->>'pass' = 'false'
 *     )
 *
 *     -- no co-fire: halluc-leak-salvatore must have PASSED on same tuple
 *     AND NOT EXISTS (
 *       SELECT 1 FROM llm_calls l
 *       WHERE l.novel_id    = u.novel_id
 *         AND l.agent       = 'halluc-leak-salvatore'
 *         AND l.chapter     = u.chapter
 *         AND l.beat_index  = u.beat_index
 *         AND l.attempt     = u.attempt
 *         AND (l.response_content::jsonb)->>'has_leak' = 'true'
 *     )
 *
 * Returns groundedSources bucket arrays and fired entities from response_content.
 */
async function fetchSoloUngroundedFires(minDate: string): Promise<CandidateRow[]> {
  const rows = await db`
    SELECT
      u.id,
      u.novel_id,
      u.chapter,
      u.beat_index,
      u.attempt,
      u.request_json->'groundedSources'->>'variant'                             AS variant,
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(u.request_json->'groundedSources'->'bible')),
        ARRAY[]::text[]
      )                                                                          AS bible,
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(u.request_json->'groundedSources'->'from_brief')),
        ARRAY[]::text[]
      )                                                                          AS from_brief,
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(u.request_json->'groundedSources'->'planner_emitted')),
        ARRAY[]::text[]
      )                                                                          AS planner_emitted,
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(u.request_json->'groundedSources'->'derived_outline_fact')),
        ARRAY[]::text[]
      )                                                                          AS derived_outline_fact,
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(u.request_json->'groundedSources'->'derived_prior_beat')),
        ARRAY[]::text[]
      )                                                                          AS derived_prior_beat,
      COALESCE(
        ARRAY(
          SELECT iss->>'entity'
          FROM jsonb_array_elements((u.response_content::jsonb)->'issues') iss
        ),
        ARRAY[]::text[]
      )                                                                          AS fired_entities,
      u.response_content,
      u.user_prompt
    FROM llm_calls u
    WHERE u.agent = 'halluc-ungrounded'
      AND u.timestamp >= ${minDate}::timestamptz
      AND (u.response_content::jsonb)->>'pass' = 'false'
      AND u.user_prompt IS NOT NULL
      AND u.user_prompt != ''
      AND NOT EXISTS (
        SELECT 1 FROM llm_calls a
        WHERE a.novel_id   = u.novel_id
          AND a.agent      = 'adherence-events'
          AND a.chapter    = u.chapter
          AND a.beat_index = u.beat_index
          AND a.attempt    = u.attempt
          AND (a.response_content::jsonb)->>'pass' = 'false'
      )
      AND NOT EXISTS (
        SELECT 1 FROM llm_calls l
        WHERE l.novel_id   = u.novel_id
          AND l.agent      = 'halluc-leak-salvatore'
          AND l.chapter    = u.chapter
          AND l.beat_index = u.beat_index
          AND l.attempt    = u.attempt
          AND (l.response_content::jsonb)->>'has_leak' = 'true'
      )
    ORDER BY u.timestamp, u.novel_id, u.chapter, u.beat_index, u.attempt
  `
  return rows as CandidateRow[]
}

/**
 * fetchClearedPassExamples
 *
 * SQL joins needed for PASS examples from cleared fires:
 *
 *   Find rows where:
 *   1. attempt N is a solo-ungrounded fire (same conditions as above)
 *   2. attempt N+1 exists with pass=true for halluc-ungrounded on the same tuple
 *
 *   Return the attempt N+1 row (user_prompt + pass=true) as the training pair.
 *
 *   SQL sketch:
 *
 *     SELECT clr.*
 *     FROM llm_calls clr
 *     JOIN llm_calls fire
 *       ON  fire.novel_id   = clr.novel_id
 *       AND fire.agent      = 'halluc-ungrounded'
 *       AND fire.chapter    = clr.chapter
 *       AND fire.beat_index = clr.beat_index
 *       AND fire.attempt    = clr.attempt - 1
 *       AND (fire.response_content::jsonb)->>'pass' = 'false'
 *     WHERE clr.agent     = 'halluc-ungrounded'
 *       AND clr.timestamp >= $minDate
 *       AND (clr.response_content::jsonb)->>'pass' = 'true'
 *       -- fire row must itself be a solo-ungrounded fire (no co-fire condition)
 *       AND NOT EXISTS ( ... adherence co-fire on fire row ... )
 *       AND NOT EXISTS ( ... leak co-fire on fire row ... )
 */
async function fetchClearedPassExamples(minDate: string): Promise<Array<{
  id: number
  novel_id: string
  chapter: number
  beat_index: number
  attempt: number
  user_prompt: string
  response_content: string
}>> {
  const rows = await db`
    SELECT
      clr.id,
      clr.novel_id,
      clr.chapter,
      clr.beat_index,
      clr.attempt,
      clr.user_prompt,
      clr.response_content
    FROM llm_calls clr
    JOIN llm_calls fire
      ON  fire.novel_id   = clr.novel_id
      AND fire.agent      = 'halluc-ungrounded'
      AND fire.chapter    = clr.chapter
      AND fire.beat_index = clr.beat_index
      AND fire.attempt    = clr.attempt - 1
      AND (fire.response_content::jsonb)->>'pass' = 'false'
    WHERE clr.agent     = 'halluc-ungrounded'
      AND clr.timestamp >= ${minDate}::timestamptz
      AND (clr.response_content::jsonb)->>'pass' = 'true'
      AND clr.user_prompt IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM llm_calls a
        WHERE a.novel_id   = fire.novel_id
          AND a.agent      = 'adherence-events'
          AND a.chapter    = fire.chapter
          AND a.beat_index = fire.beat_index
          AND a.attempt    = fire.attempt
          AND (a.response_content::jsonb)->>'pass' = 'false'
      )
      AND NOT EXISTS (
        SELECT 1 FROM llm_calls l
        WHERE l.novel_id   = fire.novel_id
          AND l.agent      = 'halluc-leak-salvatore'
          AND l.chapter    = fire.chapter
          AND l.beat_index = fire.beat_index
          AND l.attempt    = fire.attempt
          AND (l.response_content::jsonb)->>'has_leak' = 'true'
      )
    ORDER BY clr.timestamp, clr.novel_id, clr.chapter, clr.beat_index
  `
  return rows as any[]
}

// ── Classification helpers ───────────────────────────────────────────────────

const PRODUCTION_PANEL_7 = new Set([
  "novel-1776608639218",
  "novel-1776608819617",
  "novel-1776609267761",
  "novel-1776611156855",
  "novel-1776612087459",
  "novel-1776614270831",
  "novel-1776627411728",
])

const CHARTER_V0 = "novel-1776698676238"
const CHARTER_V1 = "novel-1776698676238-v1"

function classifyCandidate(row: CandidateRow): CandidateClass {
  if (row.novel_id === CHARTER_V0 || row.variant === "v0") return "charter-v0"
  if (row.novel_id === CHARTER_V1 || row.variant === "v1") return "charter-v1"
  if (PRODUCTION_PANEL_7.has(row.novel_id))               return "production-panel-7"
  return "production-other"
}

/**
 * detectClassB
 *
 * An entity is a Class-B overfire candidate when it appears as a
 * case-insensitive substring of any token in the structured grounded-sources
 * buckets (from_brief, derived_outline_fact, planner_emitted).
 *
 * Only meaningful when groundedSources.variant is non-null (charter runs).
 * Returns matching entity names; empty array if none.
 */
function detectClassB(row: CandidateRow): string[] {
  if (row.variant === null) return []  // no structured provenance on prod-panel fires

  const groundedTokens = [
    ...(row.from_brief || []),
    ...(row.planner_emitted || []),
    ...(row.derived_outline_fact || []),
  ].map(t => t.toLowerCase())

  const matches: string[] = []
  for (const entity of row.fired_entities) {
    const entityLower = entity.toLowerCase()
    const inGrounded = groundedTokens.some(
      t => t.includes(entityLower) || entityLower.includes(t)
    )
    if (inGrounded) matches.push(entity)
  }
  return matches
}

// ── Per-novel cap application ────────────────────────────────────────────────

function applyPerNovelCap(
  rows: CandidateRow[],
  maxPerNovel: number
): { capped: CandidateRow[]; capStats: Record<string, { total: number; kept: number }> } {
  const byNovel = new Map<string, CandidateRow[]>()
  for (const r of rows) {
    if (!byNovel.has(r.novel_id)) byNovel.set(r.novel_id, [])
    byNovel.get(r.novel_id)!.push(r)
  }

  const capStats: Record<string, { total: number; kept: number }> = {}
  const capped: CandidateRow[] = []

  for (const [novelId, novelRows] of byNovel) {
    const kept = novelRows.slice(0, maxPerNovel)
    capped.push(...kept)
    capStats[novelId] = { total: novelRows.length, kept: kept.length }
  }

  return { capped, capStats }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== halluc-ungrounded-v4 harvest candidate report ===")
  console.log(`Min date:       ${MIN_DATE}`)
  console.log(`Max per novel:  ${MAX_PER_NOVEL}`)
  console.log(`Target:         ${TARGET}`)
  console.log()

  // ── 1. Fetch all solo-ungrounded fires ──
  console.log("Fetching solo-ungrounded fires from DB...")
  let allFires: CandidateRow[]
  try {
    allFires = await fetchSoloUngroundedFires(MIN_DATE)
  } catch (err) {
    console.error("DB error (is SSH tunnel active?):", err)
    process.exit(1)
  }
  console.log(`Total solo-ungrounded fires: ${allFires.length}`)
  console.log()

  // ── 2. Classify by source set ──
  const byClass: Record<CandidateClass, CandidateRow[]> = {
    "charter-v0":         [],
    "charter-v1":         [],
    "production-panel-7": [],
    "production-other":   [],
  }
  for (const r of allFires) {
    byClass[classifyCandidate(r)].push(r)
  }

  console.log("=== By source class ===")
  for (const [cls, rows] of Object.entries(byClass)) {
    console.log(`  ${cls.padEnd(22)}: ${String(rows.length).padStart(4)} fires`)
  }
  console.log()

  // ── 3. Class-B detection (entity-in-grounded overfire) ──
  const classBCandidates: ClassBCandidate[] = []
  for (const r of allFires) {
    const matching = detectClassB(r)
    if (matching.length > 0) {
      classBCandidates.push({ ...r, matching_entities: matching })
    }
  }

  console.log("=== Class-B candidates (entity-in-grounded overfire) ===")
  console.log(`  Total:          ${classBCandidates.length}`)
  if (classBCandidates.length > 0) {
    const entityCounts: Record<string, number> = {}
    for (const c of classBCandidates) {
      for (const e of c.matching_entities) {
        entityCounts[e] = (entityCounts[e] ?? 0) + 1
      }
    }
    const sorted = Object.entries(entityCounts).sort((a, b) => b[1] - a[1])
    console.log("  Top entities:")
    for (const [entity, count] of sorted.slice(0, 5)) {
      console.log(`    ${entity.padEnd(30)}: ${count}x`)
    }
  }
  console.log()

  // ── 4. Apply per-novel cap ──
  const { capped, capStats } = applyPerNovelCap(allFires, MAX_PER_NOVEL)
  const cappedNovels = Object.values(capStats).filter(s => s.total > MAX_PER_NOVEL).length

  console.log("=== After per-novel cap ===")
  console.log(`  Capped from:    ${allFires.length}`)
  console.log(`  Capped to:      ${capped.length}`)
  console.log(`  Novels capped:  ${cappedNovels}`)

  if (VERBOSE) {
    for (const [novelId, s] of Object.entries(capStats)) {
      if (s.total > MAX_PER_NOVEL) {
        console.log(`    ${novelId}: ${s.total} → ${s.kept}`)
      }
    }
  }
  console.log()

  // ── 5. Fetch cleared PASS examples ──
  console.log("Fetching cleared-fire PASS examples...")
  let passExamples: Awaited<ReturnType<typeof fetchClearedPassExamples>>
  try {
    passExamples = await fetchClearedPassExamples(MIN_DATE)
  } catch (err) {
    console.error("DB error fetching PASS examples:", err)
    process.exit(1)
  }

  // Cap pass examples at 100 per harvest plan
  const cappedPassExamples = passExamples.slice(0, 100)
  console.log(`  Cleared PASS rows:   ${passExamples.length}`)
  console.log(`  Capped PASS rows:    ${cappedPassExamples.length}`)
  console.log()

  // ── 6. Final harvest composition ──
  // Select up to TARGET candidates from capped fires, prioritising charter runs first
  const charterFires = capped.filter(
    r => classifyCandidate(r) === "charter-v0" || classifyCandidate(r) === "charter-v1"
  )
  const panelFires = capped.filter(r => classifyCandidate(r) === "production-panel-7")
  const otherFires = capped.filter(r => classifyCandidate(r) === "production-other")

  // Fill target: all charter + panel fires, then random sample from other
  const selected: CandidateRow[] = [
    ...charterFires,
    ...panelFires,
  ]
  const remaining = TARGET - selected.length
  if (remaining > 0) {
    // Simple deterministic subsample (no shuffle needed — cap already applied per novel)
    const otherSample = otherFires.slice(0, remaining)
    selected.push(...otherSample)
  }

  const finalClassB = classBCandidates.filter(c =>
    selected.some(s => s.id === c.id)
  )

  console.log("=== Proposed harvest composition ===")
  console.log(`  charter-v0 fires:      ${charterFires.length}`)
  console.log(`  charter-v1 fires:      ${charterFires.length > 0 ? byClass["charter-v1"].length : 0}`)
  console.log(`  production-panel-7:    ${panelFires.length}`)
  console.log(`  production-other:      ${Math.min(otherFires.length, Math.max(0, remaining))}`)
  console.log(`  Class-B in selection:  ${finalClassB.length}`)
  console.log(`  PASS (cleared retry):  ${cappedPassExamples.length}`)
  console.log(`  ─────────────────────`)
  console.log(`  Total FAIL candidates: ${selected.length}`)
  console.log(`  Total PASS examples:   ${cappedPassExamples.length}`)
  console.log(`  Grand total:           ${selected.length + cappedPassExamples.length}`)
  console.log()

  // ── 7. Adjudication batch plan ──
  const BATCH_SIZE = 15
  const batches = Math.ceil(selected.length / BATCH_SIZE)
  const estimatedSubagents = batches
  const estimatedMinutes = Math.ceil(estimatedSubagents / 14) * 20  // 14 parallel, 20 min wall

  console.log("=== Adjudication batch plan ===")
  console.log(`  Candidates to label:   ${selected.length}`)
  console.log(`  Batch size:            ${BATCH_SIZE}`)
  console.log(`  Batches needed:        ${batches}`)
  console.log(`  Parallel subagents:    ${Math.min(batches, 14)}`)
  console.log(`  Est. wall time:        ~${estimatedMinutes} min`)
  console.log(`  Est. API cost:         $0 (Claude Code subscription)`)
  console.log()

  // ── 8. Blocker checks ──
  console.log("=== Blockers ===")

  const hasAdjudicationTable = await db`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'llm_call_adjudications'
    ) AS exists
  `.then(rows => (rows[0] as any).exists)

  if (!hasAdjudicationTable) {
    console.log("  [BLOCKER] No llm_call_adjudications table.")
    console.log("            Create sql/029_llm_call_adjudications.sql before training.")
    console.log("            See docs/scoping/halluc-ungrounded-v4-harvest.md §8.1.")
  } else {
    console.log("  [OK] llm_call_adjudications table exists.")
  }

  const hasVariantDefault = await db`
    SELECT COUNT(*) AS cnt
    FROM llm_calls
    WHERE agent = 'halluc-ungrounded'
      AND timestamp > NOW() - INTERVAL '1 hour'
      AND request_json->'groundedSources'->>'variant' IS NOT NULL
  `.then(rows => Number((rows[0] as any).cnt) > 0)

  if (!hasVariantDefault) {
    console.log("  [WARN] Recent halluc-ungrounded calls have null variant.")
    console.log("         BEAT_ENTITY_LIST_VARIANT=v1 not yet promoted to default.")
    console.log("         Class-B detection will only work on charter runs until promoted.")
  } else {
    console.log("  [OK] Recent calls have non-null groundedSources.variant.")
  }

  console.log()
  console.log("=== Next steps ===")
  console.log("  1. Resolve blockers above.")
  console.log("  2. Create sql/029 if option-A adjudication infrastructure chosen.")
  console.log("  3. Re-run this script with --verbose to see per-novel cap details.")
  console.log("  4. Write adjudication batch files (extend this script or new script).")
  console.log("  5. Spawn Sonnet subagents per docs/synthetic-labeling-sop.md pattern.")
  console.log("  6. Aggregate labels + build blend file (format-v4-sft.ts, to be written).")
  console.log("  7. Submit to W&B SFT — see docs/adapter-training-reference.md.")
  console.log()
  console.log("This script does NOT write training files. Run format-v4-sft.ts for that.")
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Fatal:", err)
    process.exit(1)
  })
