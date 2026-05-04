/**
 * Persistence for review proposal envelopes (Phase 3 commit 4).
 *
 * Charter: docs/designs/collaborative-proposal-workflow.md §"Phase 3"
 *
 * Phase 3 commits 1-3 + 5a shipped envelope mechanics (build / per-patch
 * resolve / regenerate / bulk) with envelopes body-carried by the UI.
 * This module adds the smallest persistence shape that covers:
 *
 *   1. Cross-session resumability — UI loads pending envelopes on session
 *      open instead of expecting them in volatile state.
 *   2. Audit trail — `status` + `resolved_at` + `resolved_by_*` survive
 *      across processes.
 *   3. Server-side regen provenance (`parent_envelope_id`, deferred to a
 *      sub-commit) — the column exists so the resolve-route /regen
 *      paths can adopt it without a follow-up migration.
 *
 * The schema is generic across `kind`. This module provides typed
 * helpers for `artifact_patch` envelopes (the only kind alive today);
 * future canon_update / prose_edit / editorial_flag kinds add their own
 * coercion helpers in their own modules but share this storage.
 */

import db from "./connection"
import type { ArtifactPatchEnvelope } from "../canon/proposal-envelope"

type Executor = typeof db

// Storage row shape. Matches sql/037 column-by-column.
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
  resolution_policy_decision: string | null
  resolution_policy_version: string | null
  resolution_policy_reasons: unknown | null
  created_at: string | Date
}

export function rowToArtifactPatchEnvelope(row: ProposalEnvelopeRow): ArtifactPatchEnvelope {
  if (row.kind !== "artifact_patch") {
    throw new Error(
      `rowToArtifactPatchEnvelope: row ${row.id} has kind=${row.kind}, expected artifact_patch`,
    )
  }
  const evidence = (typeof row.evidence === "string"
    ? JSON.parse(row.evidence)
    : row.evidence) as ArtifactPatchEnvelope["evidence"]
  const payload = (typeof row.payload === "string"
    ? JSON.parse(row.payload)
    : row.payload) as ArtifactPatchEnvelope["payload"]
  const policyReasons = ((typeof row.policy_reasons === "string"
    ? JSON.parse(row.policy_reasons)
    : row.policy_reasons) as string[]).slice()
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  const env: ArtifactPatchEnvelope = {
    id: row.id,
    kind: "artifact_patch",
    novelId: row.novel_id,
    target: {
      kind: row.target_kind as ArtifactPatchEnvelope["target"]["kind"],
      ref: row.target_ref,
      ...(row.target_field_path != null ? { fieldPath: row.target_field_path } : {}),
      currentVersion: row.target_current_version,
    },
    source: {
      agent: row.source_agent,
      ...(row.source_user_message != null ? { userMessage: row.source_user_message } : {}),
      ...(row.parent_envelope_id != null ? { parentEnvelopeId: row.parent_envelope_id } : {}),
    },
    status: row.status as ArtifactPatchEnvelope["status"],
    risk: row.risk as ArtifactPatchEnvelope["risk"],
    summary: row.summary,
    rationale: row.rationale,
    evidence,
    payload,
    precondition: {
      kind: row.precondition_kind as ArtifactPatchEnvelope["precondition"]["kind"],
      hash: row.precondition_hash,
    },
    policyRecommendation: {
      decision: row.policy_decision as ArtifactPatchEnvelope["policyRecommendation"]["decision"],
      reasons: policyReasons,
    },
    createdAt,
  }
  if (row.resolved_at != null) {
    env.resolvedAt = row.resolved_at instanceof Date ? row.resolved_at.toISOString() : row.resolved_at
  }
  if (row.resolved_by_kind != null) {
    env.resolvedBy = row.resolved_by_kind as NonNullable<ArtifactPatchEnvelope["resolvedBy"]>
  }
  return env
}

/**
 * Insert an artifact-patch envelope. Idempotent: rerunning with the same
 * deterministic id is a no-op (`ON CONFLICT (id) DO NOTHING`). Returns
 * `true` if a row was actually inserted, `false` if it was skipped.
 *
 * Why idempotent: the `/adjust` route can theoretically be retried by
 * the UI after a partial failure (e.g., the response was received but
 * the connection dropped before the UI rendered). The id is the stable
 * sha256 over canonical(payload + target.currentVersion + index), so
 * the same patch+target combination produces the same id and the
 * second insert is dropped cleanly.
 */
export async function insertArtifactPatchEnvelope(
  envelope: ArtifactPatchEnvelope,
  executor: Executor = db,
): Promise<boolean> {
  if (envelope.kind !== "artifact_patch") {
    throw new Error(
      `insertArtifactPatchEnvelope: envelope ${envelope.id} has kind=${envelope.kind}`,
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

/** List artifact-patch envelopes for a novel filtered by status (default = pending). */
export async function listArtifactPatchEnvelopes(
  novelId: string,
  opts: { status?: string | "all"; limit?: number } = {},
): Promise<ArtifactPatchEnvelope[]> {
  const status = opts.status ?? "pending"
  const limit = opts.limit ?? 200
  const rows = (status === "all"
    ? await db`
        SELECT * FROM proposal_envelopes
        WHERE novel_id = ${novelId} AND kind = 'artifact_patch'
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    : await db`
        SELECT * FROM proposal_envelopes
        WHERE novel_id = ${novelId} AND kind = 'artifact_patch' AND status = ${status}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `) as ProposalEnvelopeRow[]
  return rows.map(rowToArtifactPatchEnvelope)
}

/** Look up a single envelope by id (any kind). Returns null when not found. */
export async function findEnvelopeById(
  id: string,
  executor: Executor = db,
): Promise<ProposalEnvelopeRow | null> {
  const rows = (await executor`SELECT * FROM proposal_envelopes WHERE id = ${id}`) as ProposalEnvelopeRow[]
  return rows.length > 0 ? rows[0] : null
}

/**
 * Mark an envelope resolved. Returns `true` if a row was updated. The
 * `WHERE status = 'pending'` guard mirrors the canon_proposals lifecycle —
 * a re-resolve attempt against a non-pending row is silently a no-op
 * (caller can detect this by inspecting the return value).
 *
 * Phase 6 commit 2: optional `policyDecision` / `policyVersion` /
 * `policyReasons` capture what the active `ApprovalPolicy` decided at the
 * moment of resolution. Pre-Phase-6 callers that don't pass them leave the
 * columns NULL (sql/040 migration). The operator's `status` remains the
 * load-bearing field; the policy fields are an audit trail surface for
 * Phase 7's replay metrics.
 */
export async function updateEnvelopeResolution(
  args: {
    id: string
    status: "approved" | "rejected" | "modified" | "shadowed" | "expired"
    resolvedAt: string
    resolvedByKind: string | null
    resolvedByRef: string | null
    resolvedNote: string | null
    modifiedPayload: unknown | null
    policyDecision?: string | null
    policyVersion?: string | null
    policyReasons?: ReadonlyArray<string> | null
  },
  executor: Executor = db,
): Promise<boolean> {
  const policyReasonsJson =
    args.policyReasons != null ? JSON.stringify([...args.policyReasons]) : null
  const result = (await executor`
    UPDATE proposal_envelopes
    SET status = ${args.status},
        resolved_at = ${args.resolvedAt}::timestamptz,
        resolved_by_kind = ${args.resolvedByKind},
        resolved_by_ref = ${args.resolvedByRef},
        resolved_note = ${args.resolvedNote},
        modified_payload = ${args.modifiedPayload != null ? JSON.stringify(args.modifiedPayload) : null}::jsonb,
        resolution_policy_decision = ${args.policyDecision ?? null},
        resolution_policy_version = ${args.policyVersion ?? null},
        resolution_policy_reasons = ${policyReasonsJson}::jsonb
    WHERE id = ${args.id} AND status = 'pending'
    RETURNING id
  `) as { id: string }[]
  return result.length > 0
}

/** Test helper / orphan cleanup. */
export async function deleteEnvelopesForNovel(
  novelId: string,
  executor: Executor = db,
): Promise<void> {
  await executor`DELETE FROM proposal_envelopes WHERE novel_id = ${novelId}`
}
