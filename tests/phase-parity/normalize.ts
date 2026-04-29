/**
 * Phase parity — snapshot normalization.
 *
 * Strips wall-clock-dependent values and remaps non-deterministic IDs so
 * two runs that differ only by timestamp/UUID/serial-PK produce equal
 * normalized snapshots.
 *
 * Hashes large text fields (prompts, prose, JSONB blobs) so the comparison
 * stays manageable while still catching content drift. The hash list lives
 * in `db-snapshot.ts:HASHED_FIELDS`.
 *
 * Output is a stable JSON object: keys sorted, arrays in PK order (already
 * sorted by db-snapshot). Two normalized snapshots are byte-equal iff the
 * runs are equivalent under the rules below.
 *
 * Rules:
 *   timestamps      → "<TS>"        (any TIMESTAMPTZ/created_at/timestamp/etc)
 *   UUID strings    → stable hash of (table, primary-key-fields, row-position)
 *   serial PKs      → row index within the table (0-based)
 *   floats          → rounded to 6 decimal places
 *   listed fields   → SHA-256 hash of stringified content
 */

import { createHash } from "node:crypto"
import type { RawSnapshot } from "./db-snapshot"
import { HASHED_FIELDS } from "./db-snapshot"

export interface NormalizedSnapshot {
  novelId: string
  tables: Record<string, ReadonlyArray<Record<string, unknown>>>
}

const TIMESTAMP_FIELDS = new Set([
  "timestamp", "captured_at", "created_at", "approved_at", "decided_at",
  "fired_at", "invoked_at", "updated_at",
])

/** Tables where the PK is a UUID/serial that must be remapped. The remap
 *  uses a stable hash of business-key-fields PLUS the row's position within
 *  the table (after PK ordering in db-snapshot). Including row position
 *  discriminates collisions where multiple rows share business keys (e.g.
 *  multiple llm_calls retries with same agent+chapter+beat_index+attempt).
 *
 *  IMPORTANT: do NOT include timestamp/created_at/fired_at columns here.
 *  The stable id computation reads raw row values (BEFORE timestamp scrub),
 *  so any timestamp field in the business key would make two otherwise-
 *  identical runs produce different stable ids — the very thing
 *  normalization is meant to defeat. Row-position-after-ordering is the
 *  cross-run-stable substitute. */
const REMAP_PK_CONFIG: Record<string, string[]> = {
  facts:                ["novel_id", "fact", "established_in_chapter"],
  character_knowledge:  ["novel_id", "character_id", "knowledge", "chapter_learned"],
  chapter_revisions:    ["novel_id", "chapter", "attempt"],
  chapter_exhaustions:  ["novel_id", "chapter", "attempt"],
  issues:               ["novel_id", "chapter", "description"],
  llm_calls:            ["novel_id", "chapter", "beat_index", "attempt", "agent"],
  // pipeline_events: tighter business key (chapter/beat_index/agent) so two
  // runs that produce the same event sequence get identical stable ids per
  // event, not just per (novel, event_type) bucket. rowIdx handles
  // intra-bucket discrimination for duplicates.
  pipeline_events:      ["novel_id", "chapter", "beat_index", "event_type", "agent"],
}

const HASHED_KEY = new Set(HASHED_FIELDS.map(({ table, field }) => `${table}.${field}`))

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16) // truncate for readability
}

function isUUIDLike(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

function stableId(
  table: string,
  businessKey: ReadonlyArray<string>,
  row: Record<string, unknown>,
  rowIdx: number,
): string {
  // Row position is part of the hash so multiple rows with identical business
  // keys (e.g. llm_calls retries) still get distinct ids. Position is stable
  // across runs because db-snapshot orders deterministically by PK. Business
  // keys must NOT include timestamp/fired_at columns — see REMAP_PK_CONFIG.
  const parts = [String(rowIdx), ...businessKey.map(k => String(row[k] ?? ""))]
  return `${table}:${sha256(parts.join("|"))}`
}

function roundFloat(v: unknown): unknown {
  if (typeof v === "number" && !Number.isInteger(v)) {
    return Math.round(v * 1e6) / 1e6
  }
  return v
}

function hashContent(v: unknown): string {
  if (v === null || v === undefined) return "<EMPTY>"
  const s = typeof v === "string" ? v : JSON.stringify(v)
  return `<HASH:${sha256(s)}>`
}

function normalizeRow(table: string, row: Record<string, unknown>, rowIdx: number): Record<string, unknown> {
  // Stable id is hashed from business-key fields (which exclude timestamps,
  // see REMAP_PK_CONFIG comment) plus row position.
  const remapKey = REMAP_PK_CONFIG[table]
  const newId = remapKey ? stableId(table, remapKey, row, rowIdx) : null

  const out: Record<string, unknown> = {}
  for (const [k, raw] of Object.entries(row)) {
    let v: unknown = raw

    if (TIMESTAMP_FIELDS.has(k)) {
      v = "<TS>"
    } else if (k === "id" && newId !== null) {
      v = newId
    } else if (k === "id" && typeof raw === "number") {
      // Serial PK with no business-key remap — fall back to row index
      v = `${table}:row-${rowIdx}`
    } else if (isUUIDLike(raw)) {
      // Foreign-key UUID — replace with hash of original (stable across runs
      // when the FK target is itself stably remapped, since the hash is over
      // the original UUID string).
      v = `<UUID:${sha256(raw)}>`
    } else if (HASHED_KEY.has(`${table}.${k}`)) {
      v = hashContent(raw)
    } else {
      v = roundFloat(raw)
    }
    out[k] = v
  }
  return out
}

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {}
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k]
  return sorted
}

export function normalize(raw: RawSnapshot): NormalizedSnapshot {
  const tables: Record<string, ReadonlyArray<Record<string, unknown>>> = {}
  for (const [t, rows] of Object.entries(raw.tables)) {
    tables[t] = rows.map((r, i) => sortKeys(normalizeRow(t, r, i)))
  }
  return { novelId: raw.novelId, tables }
}

/** Stable-stringify a normalized snapshot for byte-equal comparison. */
export function serialize(s: NormalizedSnapshot): string {
  const out: Record<string, unknown> = { novelId: s.novelId, tables: {} }
  const tables = (out.tables as Record<string, unknown>)
  for (const k of Object.keys(s.tables).sort()) tables[k] = s.tables[k]
  return JSON.stringify(out, null, 2)
}
