/**
 * Persistence for editorial proposal envelopes (Phase 5 commit 3).
 *
 * Charter: docs/designs/collaborative-proposal-workflow.md §"Phase 5"
 *
 * Phase 5 commit 1 shipped the `EditorialFlagEnvelope` /
 * `ProseEditEnvelope` payload schemas. Phase 5 commit 2 shipped the
 * first LLM editorial producer. This commit adds the typed persistence
 * helpers — both kinds ride on the same `proposal_envelopes` table from
 * Phase 3 commit 4 (the column shape is generic across envelope `kind`),
 * but a typed insert + list + row-coercion layer keeps callers from
 * having to hand-thread JSONB payload casts and `target.kind` literals.
 *
 * **No new migration.** `sql/037_proposal_envelopes.sql` already
 * declares `target_kind` / `precondition_kind` / `payload` as TEXT /
 * JSONB and lists `editorial_flag` / `prose_edit` as supported `kind`
 * values in its header comment. The migration was designed for this
 * extension; this module exercises it.
 *
 * **Same idempotent shape.** Both inserts use `ON CONFLICT (id) DO
 * NOTHING` and return `true`/`false` based on whether a new row was
 * actually written, mirroring `insertArtifactPatchEnvelope` from
 * `proposal-envelopes.ts`. Producer-side determinism (Phase 5 commit 1
 * id seeds exclude `parentEnvelopeId`) means re-running a producer
 * against the same draft+payload+index is a safe no-op write.
 *
 * **Shared lifecycle helpers.** `findEnvelopeById`,
 * `updateEnvelopeResolution`, and `deleteEnvelopesForNovel` live in
 * `proposal-envelopes.ts` and are kind-agnostic (they read/write the
 * lifecycle columns by id, not by kind). This module re-exports them so
 * a caller working only with editorial envelopes can import everything
 * from one place; it does not redefine them.
 */

import db from "./connection"
import type {
  EditorialFlagEnvelope,
  ProseEditEnvelope,
} from "../canon/editorial-proposal"
import type { ProposalEvidence } from "../canon/proposal-envelope"

type Executor = typeof db

// Storage row shape — matches sql/037 column-by-column. Duplicated from
// proposal-envelopes.ts deliberately (see `_canonical-row.ts` follow-on
// idea in Phase 5 commit 6 if duplication becomes load-bearing).
interface ProposalEnvelopeRow {
  id: string
  novel_id: string
  kind: string
  target_kind: string
  target_ref: string
  target_field_path: string | null
  target_current_version: string
  source_agent: string
  source_user_message: string | null
  parent_envelope_id: string | null
  status: string
  risk: string
  summary: string
  rationale: string
  evidence: unknown
  payload: unknown
  precondition_kind: string
  precondition_hash: string
  policy_decision: string
  policy_reasons: unknown
  resolved_at: string | Date | null
  resolved_by_kind: string | null
  resolved_by_ref: string | null
  resolved_note: string | null
  modified_payload: unknown | null
  created_at: string | Date
}

function parseEvidenceArray(raw: unknown): ProposalEvidence[] {
  const arr = (typeof raw === "string" ? JSON.parse(raw) : raw) as ProposalEvidence[]
  return Array.isArray(arr) ? arr.slice() : []
}

function parsePolicyReasons(raw: unknown): string[] {
  const arr = (typeof raw === "string" ? JSON.parse(raw) : raw) as string[]
  return Array.isArray(arr) ? arr.slice() : []
}

function parsePayload<T>(raw: unknown): T {
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as T
}

function tsToIso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : v
}

// ── editorial_flag ──────────────────────────────────────────────────────

function rowToEditorialFlagEnvelope(row: ProposalEnvelopeRow): EditorialFlagEnvelope {
  if (row.kind !== "editorial_flag") {
    throw new Error(
      `rowToEditorialFlagEnvelope: row ${row.id} has kind=${row.kind}, expected editorial_flag`,
    )
  }
  const env: EditorialFlagEnvelope = {
    id: row.id,
    kind: "editorial_flag",
    novelId: row.novel_id,
    target: {
      kind: row.target_kind as EditorialFlagEnvelope["target"]["kind"],
      ref: row.target_ref,
      ...(row.target_field_path != null ? { fieldPath: row.target_field_path } : {}),
      currentVersion: row.target_current_version,
    },
    source: {
      agent: row.source_agent,
      ...(row.source_user_message != null ? { userMessage: row.source_user_message } : {}),
      ...(row.parent_envelope_id != null ? { parentEnvelopeId: row.parent_envelope_id } : {}),
    },
    status: row.status as EditorialFlagEnvelope["status"],
    risk: row.risk as EditorialFlagEnvelope["risk"],
    summary: row.summary,
    rationale: row.rationale,
    evidence: parseEvidenceArray(row.evidence),
    payload: parsePayload<EditorialFlagEnvelope["payload"]>(row.payload),
    precondition: {
      kind: row.precondition_kind as EditorialFlagEnvelope["precondition"]["kind"],
      hash: row.precondition_hash,
    },
    policyRecommendation: {
      decision: row.policy_decision as EditorialFlagEnvelope["policyRecommendation"]["decision"],
      reasons: parsePolicyReasons(row.policy_reasons),
    },
    createdAt: tsToIso(row.created_at),
  }
  if (row.resolved_at != null) env.resolvedAt = tsToIso(row.resolved_at)
  if (row.resolved_by_kind != null) {
    env.resolvedBy = row.resolved_by_kind as NonNullable<EditorialFlagEnvelope["resolvedBy"]>
  }
  return env
}

/**
 * Insert an editorial-flag envelope. Idempotent: rerunning with the
 * same deterministic id is a no-op. Returns `true` if a row was
 * actually inserted, `false` if it was skipped.
 */
export async function insertEditorialFlagEnvelope(
  envelope: EditorialFlagEnvelope,
  executor: Executor = db,
): Promise<boolean> {
  if (envelope.kind !== "editorial_flag") {
    throw new Error(
      `insertEditorialFlagEnvelope: envelope ${envelope.id} has kind=${envelope.kind}`,
    )
  }
  const result = await executor`
    INSERT INTO proposal_envelopes (
      id, novel_id, kind,
      target_kind, target_ref, target_field_path, target_current_version,
      source_agent, source_user_message, parent_envelope_id,
      status, risk, summary, rationale, evidence, payload,
      precondition_kind, precondition_hash,
      policy_decision, policy_reasons,
      created_at
    ) VALUES (
      ${envelope.id}, ${envelope.novelId}, ${envelope.kind},
      ${envelope.target.kind}, ${envelope.target.ref},
      ${envelope.target.fieldPath ?? null}, ${envelope.target.currentVersion},
      ${envelope.source.agent}, ${envelope.source.userMessage ?? null},
      ${envelope.source.parentEnvelopeId ?? null},
      ${envelope.status}, ${envelope.risk}, ${envelope.summary}, ${envelope.rationale},
      ${JSON.stringify(envelope.evidence)}::jsonb,
      ${JSON.stringify(envelope.payload)}::jsonb,
      ${envelope.precondition.kind}, ${envelope.precondition.hash},
      ${envelope.policyRecommendation.decision},
      ${JSON.stringify(envelope.policyRecommendation.reasons)}::jsonb,
      ${envelope.createdAt}::timestamptz
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `
  return Array.isArray(result) ? result.length > 0 : false
}

/**
 * List editorial-flag envelopes for a novel filtered by status (default
 * = pending).
 *
 * OpenCode review LOW (2026-05-04): returns `{ envelopes, hasMore }`
 * so callers can detect truncation. We over-fetch by one row and set
 * `hasMore = true` if the extra row exists; the caller never sees it.
 * Routes / UI consumers that need pagination can re-query with a
 * cursor (deferred until a UI surface for editorial lists ships).
 */
export interface ListEditorialFlagEnvelopesResult {
  envelopes: EditorialFlagEnvelope[]
  hasMore: boolean
}

export async function listEditorialFlagEnvelopes(
  novelId: string,
  opts: { status?: string | "all"; limit?: number } = {},
): Promise<ListEditorialFlagEnvelopesResult> {
  const status = opts.status ?? "pending"
  const limit = opts.limit ?? 200
  const overFetch = limit + 1
  const rows = (status === "all"
    ? await db`
        SELECT * FROM proposal_envelopes
        WHERE novel_id = ${novelId} AND kind = 'editorial_flag'
        ORDER BY created_at DESC
        LIMIT ${overFetch}
      `
    : await db`
        SELECT * FROM proposal_envelopes
        WHERE novel_id = ${novelId} AND kind = 'editorial_flag' AND status = ${status}
        ORDER BY created_at DESC
        LIMIT ${overFetch}
      `) as ProposalEnvelopeRow[]
  const hasMore = rows.length > limit
  const visible = hasMore ? rows.slice(0, limit) : rows
  return { envelopes: visible.map(rowToEditorialFlagEnvelope), hasMore }
}

// ── prose_edit ─────────────────────────────────────────────────────────

function rowToProseEditEnvelope(row: ProposalEnvelopeRow): ProseEditEnvelope {
  if (row.kind !== "prose_edit") {
    throw new Error(
      `rowToProseEditEnvelope: row ${row.id} has kind=${row.kind}, expected prose_edit`,
    )
  }
  const env: ProseEditEnvelope = {
    id: row.id,
    kind: "prose_edit",
    novelId: row.novel_id,
    target: {
      kind: row.target_kind as ProseEditEnvelope["target"]["kind"],
      ref: row.target_ref,
      ...(row.target_field_path != null ? { fieldPath: row.target_field_path } : {}),
      currentVersion: row.target_current_version,
    },
    source: {
      agent: row.source_agent,
      ...(row.source_user_message != null ? { userMessage: row.source_user_message } : {}),
      ...(row.parent_envelope_id != null ? { parentEnvelopeId: row.parent_envelope_id } : {}),
    },
    status: row.status as ProseEditEnvelope["status"],
    risk: row.risk as ProseEditEnvelope["risk"],
    summary: row.summary,
    rationale: row.rationale,
    evidence: parseEvidenceArray(row.evidence),
    payload: parsePayload<ProseEditEnvelope["payload"]>(row.payload),
    precondition: {
      kind: row.precondition_kind as ProseEditEnvelope["precondition"]["kind"],
      hash: row.precondition_hash,
    },
    policyRecommendation: {
      decision: row.policy_decision as ProseEditEnvelope["policyRecommendation"]["decision"],
      reasons: parsePolicyReasons(row.policy_reasons),
    },
    createdAt: tsToIso(row.created_at),
  }
  if (row.resolved_at != null) env.resolvedAt = tsToIso(row.resolved_at)
  if (row.resolved_by_kind != null) {
    env.resolvedBy = row.resolved_by_kind as NonNullable<ProseEditEnvelope["resolvedBy"]>
  }
  return env
}

/**
 * Insert a prose-edit envelope. Idempotent (`ON CONFLICT (id) DO
 * NOTHING`). Returns `true` if a row was actually inserted, `false`
 * if it was skipped.
 */
export async function insertProseEditEnvelope(
  envelope: ProseEditEnvelope,
  executor: Executor = db,
): Promise<boolean> {
  if (envelope.kind !== "prose_edit") {
    throw new Error(
      `insertProseEditEnvelope: envelope ${envelope.id} has kind=${envelope.kind}`,
    )
  }
  const result = await executor`
    INSERT INTO proposal_envelopes (
      id, novel_id, kind,
      target_kind, target_ref, target_field_path, target_current_version,
      source_agent, source_user_message, parent_envelope_id,
      status, risk, summary, rationale, evidence, payload,
      precondition_kind, precondition_hash,
      policy_decision, policy_reasons,
      created_at
    ) VALUES (
      ${envelope.id}, ${envelope.novelId}, ${envelope.kind},
      ${envelope.target.kind}, ${envelope.target.ref},
      ${envelope.target.fieldPath ?? null}, ${envelope.target.currentVersion},
      ${envelope.source.agent}, ${envelope.source.userMessage ?? null},
      ${envelope.source.parentEnvelopeId ?? null},
      ${envelope.status}, ${envelope.risk}, ${envelope.summary}, ${envelope.rationale},
      ${JSON.stringify(envelope.evidence)}::jsonb,
      ${JSON.stringify(envelope.payload)}::jsonb,
      ${envelope.precondition.kind}, ${envelope.precondition.hash},
      ${envelope.policyRecommendation.decision},
      ${JSON.stringify(envelope.policyRecommendation.reasons)}::jsonb,
      ${envelope.createdAt}::timestamptz
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `
  return Array.isArray(result) ? result.length > 0 : false
}

/**
 * List prose-edit envelopes for a novel filtered by status (default =
 * pending). Returns `{ envelopes, hasMore }` per the same truncation
 * contract as `listEditorialFlagEnvelopes`.
 */
export interface ListProseEditEnvelopesResult {
  envelopes: ProseEditEnvelope[]
  hasMore: boolean
}

export async function listProseEditEnvelopes(
  novelId: string,
  opts: { status?: string | "all"; limit?: number } = {},
): Promise<ListProseEditEnvelopesResult> {
  const status = opts.status ?? "pending"
  const limit = opts.limit ?? 200
  const overFetch = limit + 1
  const rows = (status === "all"
    ? await db`
        SELECT * FROM proposal_envelopes
        WHERE novel_id = ${novelId} AND kind = 'prose_edit'
        ORDER BY created_at DESC
        LIMIT ${overFetch}
      `
    : await db`
        SELECT * FROM proposal_envelopes
        WHERE novel_id = ${novelId} AND kind = 'prose_edit' AND status = ${status}
        ORDER BY created_at DESC
        LIMIT ${overFetch}
      `) as ProposalEnvelopeRow[]
  const hasMore = rows.length > limit
  const visible = hasMore ? rows.slice(0, limit) : rows
  return { envelopes: visible.map(rowToProseEditEnvelope), hasMore }
}

// Lifecycle helpers (`findEnvelopeById`, `updateEnvelopeResolution`,
// `deleteEnvelopesForNovel`) live in `proposal-envelopes.ts` and are
// kind-agnostic. Re-exported so callers can import everything from one
// place.
export {
  findEnvelopeById,
  updateEnvelopeResolution,
  deleteEnvelopesForNovel,
} from "./proposal-envelopes"
