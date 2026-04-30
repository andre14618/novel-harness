/**
 * Phase parity — DB snapshot.
 *
 * Captures the full per-novel state of every table the phase pipeline
 * persists into, plus normalized telemetry. Returned object is RAW (no
 * normalization yet); pipe through `normalize.ts` for comparable output.
 *
 * Table scope is the §"Parity harness — full table scope" in
 * docs/designs/phase-modularization.md (R3). Adding a table here MUST
 * be reflected in normalize.ts and the design doc in the same commit.
 */

import db from "../../src/db/connection"

export interface RawSnapshot {
  novelId: string
  capturedAt: string
  tables: Record<string, ReadonlyArray<Record<string, unknown>>>
}

/** Order is deterministic: PK fields ascending. */
const TABLE_ORDERS: Record<string, string> = {
  novels:                          "id",
  world_bibles:                    "novel_id",
  characters:                      "novel_id, id",
  story_spines:                    "novel_id",
  world_systems:                   "novel_id, id",
  cultures:                        "novel_id, id",
  character_cultures:              "novel_id, character_id, culture_id",
  character_system_awareness:      "novel_id, character_id, system_id",
  chapter_outlines:                "novel_id, chapter_number",
  chapter_drafts:                  "novel_id, chapter_number, version",
  facts:                           "novel_id, established_in_chapter, fact",
  character_states:                "novel_id, character_id, chapter_number",
  character_knowledge:             "novel_id, chapter_learned, character_id, knowledge",
  chapter_revisions:               "novel_id, chapter, attempt",
  chapter_exhaustions:             "novel_id, chapter, attempt",
  validation_passes:               "novel_id, pass_number, chapter_number",
  issues:                          "novel_id, chapter, description",
  // Ordering avoids timestamp tie-breakers — duplicate-key rows (same
  // agent+chapter+beat_index+attempt for llm_calls; same key fields for
  // pipeline_events) should sort by SERIAL `id` (insertion order). Two
  // runs that produce the same logical sequence get the same relative
  // positions even when wall-clock millis differ or collide.
  llm_calls:                       "novel_id, chapter NULLS FIRST, beat_index NULLS FIRST, attempt NULLS FIRST, agent, id",
  pipeline_events:                 "novel_id, id",
}

/** Columns that contain large text/JSONB and should be hashed in normalize.ts
 *  rather than compared verbatim. Listed here for documentation; the snapshot
 *  itself returns full content, normalize.ts decides what to hash. */
export const HASHED_FIELDS: ReadonlyArray<{ table: string; field: string }> = [
  { table: "world_bibles",     field: "content_json" },
  { table: "story_spines",     field: "content_json" },
  { table: "characters",       field: "profile_json" },
  { table: "chapter_outlines", field: "scenes_json" },
  { table: "chapter_drafts",   field: "prose" },
  { table: "chapter_revisions", field: "outline_before" },
  { table: "chapter_revisions", field: "outline_after" },
  { table: "chapter_exhaustions", field: "unresolved_deviations" },
  { table: "chapter_exhaustions", field: "reviser_history" },
  { table: "chapter_exhaustions", field: "decision_details" },
  { table: "llm_calls",        field: "system_prompt" },
  { table: "llm_calls",        field: "user_prompt" },
  { table: "llm_calls",        field: "request_json" },
  { table: "llm_calls",        field: "response_content" },
  { table: "pipeline_events",  field: "payload" },
]

/** Capture the full per-novel state. Reads only — no mutation. */
export async function captureSnapshot(novelId: string): Promise<RawSnapshot> {
  const tables: Record<string, ReadonlyArray<Record<string, unknown>>> = {}
  for (const [table, orderBy] of Object.entries(TABLE_ORDERS)) {
    const idCol = table === "novels" ? "id" : "novel_id"
    // Bun.sql's tagged-template doesn't expand identifiers, so we build the
    // statement string. Inputs are static (table/column names from this file's
    // own constants) so this is not user-controlled SQL.
    const stmt = `SELECT * FROM ${table} WHERE ${idCol} = $1 ORDER BY ${orderBy}`
    const rows = await db.unsafe(stmt, [novelId])
    tables[table] = rows as ReadonlyArray<Record<string, unknown>>
  }
  return {
    novelId,
    capturedAt: new Date().toISOString(),
    tables,
  }
}

/** Convenience for tests that want to drop everything for a novel. */
export async function clearNovelState(novelId: string): Promise<void> {
  // Ordered to respect FK constraints. Tables without FKs to novels (e.g.
  // pipeline_events, chapter_revisions, chapter_exhaustions) still scope by
  // novel_id so a partial clear is safe.
  const tables = [
    "pipeline_events", "llm_calls",
    "issues", "validation_passes",
    "chapter_exhaustions", "chapter_revisions",
    "character_knowledge", "character_states", "facts",
    "chapter_drafts", "chapter_outlines",
    "character_system_awareness", "character_cultures",
    "cultures", "world_systems",
    "story_spines", "characters", "world_bibles",
    "novels",
  ]
  for (const t of tables) {
    const idCol = t === "novels" ? "id" : "novel_id"
    const stmt = `DELETE FROM ${t} WHERE ${idCol} = $1`
    await db.unsafe(stmt, [novelId])
  }
}
