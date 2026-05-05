/**
 * DB loader for Phase 7 ApprovalPolicy replay reports.
 *
 * Read-only by construction: this module only selects resolved audit rows from
 * the two proposal stores that Phase 6 writes (`proposal_envelopes` and
 * `canon_proposals`).
 */

import db from "./connection"
import type {
  PolicyDecision,
} from "../canon/approval-policy"
import type {
  PolicyReplayRow,
} from "../canon/approval-policy-replay"
import type {
  ProposalEnvelopeKind,
  ProposalEnvelopeResolvedBy,
  ProposalEnvelopeRisk,
  ProposalEnvelopeStatus,
} from "../canon/proposal-envelope"

export interface ListPolicyReplayRowsOptions {
  novelId?: string
  since?: string
  limit?: number
}

interface RawReplayRow {
  id: string
  novel_id: string
  kind: string
  risk: string
  status: string
  resolved_by_kind: string | null
  resolution_policy_decision: string
  resolution_policy_version: string
  resolved_at: string | Date
  source_table: "proposal_envelopes" | "canon_proposals"
  downstream_checker_fired: boolean | null
  downstream_edit_churn: number | null
  downstream_canon_conflict: boolean | null
}

export async function listPolicyReplayRows(
  opts: ListPolicyReplayRowsOptions = {},
): Promise<PolicyReplayRow[]> {
  const limit = clampLimit(opts.limit ?? 500)
  const since = opts.since ?? "1970-01-01T00:00:00.000Z"
  const rows = opts.novelId
    ? await listForNovel(opts.novelId, since, limit)
    : await listForAllNovels(since, limit)

  return rows.map(rowToPolicyReplayRow)
}

function rowToPolicyReplayRow(row: RawReplayRow): PolicyReplayRow {
  const resolvedAt = row.resolved_at instanceof Date
    ? row.resolved_at.toISOString()
    : row.resolved_at
  return {
    id: row.id,
    novelId: row.novel_id,
    kind: row.kind as ProposalEnvelopeKind,
    risk: row.risk as ProposalEnvelopeRisk,
    status: row.status as ProposalEnvelopeStatus,
    resolvedByKind: row.resolved_by_kind as ProposalEnvelopeResolvedBy | null,
    policyDecision: row.resolution_policy_decision as PolicyDecision,
    policyVersion: row.resolution_policy_version,
    resolvedAt,
    sourceTable: row.source_table,
    downstreamCheckerFired: row.downstream_checker_fired,
    downstreamEditChurn: row.downstream_edit_churn,
    downstreamCanonConflict: row.downstream_canon_conflict,
  }
}

async function listForNovel(
  novelId: string,
  since: string,
  limit: number,
): Promise<RawReplayRow[]> {
  return (await db`
    SELECT *
    FROM (
      SELECT id,
             novel_id,
             kind,
             risk,
             status,
             resolved_by_kind,
             resolution_policy_decision,
             resolution_policy_version,
             resolved_at,
             source_table,
             downstream_checker_fired,
             downstream_edit_churn,
             downstream_canon_conflict
      FROM (
        SELECT pe.id,
               pe.novel_id,
               pe.kind,
               pe.risk,
               pe.status,
               pe.resolved_by_kind,
               pe.resolution_policy_decision,
               pe.resolution_policy_version,
               pe.resolved_at,
               'proposal_envelopes' AS source_table,
               pro.downstream_checker_fired,
               pro.downstream_edit_churn,
               pro.downstream_canon_conflict
        FROM proposal_envelopes pe
        LEFT JOIN proposal_resolution_outcomes pro
          ON pro.source_table = 'proposal_envelopes'
         AND pro.proposal_id = pe.id
        WHERE pe.novel_id = ${novelId}
          AND pe.resolved_at IS NOT NULL
          AND pe.resolved_at >= ${since}::timestamptz
          AND pe.resolution_policy_decision IS NOT NULL
      ) proposal_rows

      UNION ALL

      SELECT id,
             novel_id,
             kind,
             risk,
             status,
             resolved_by_kind,
             resolution_policy_decision,
             resolution_policy_version,
             resolved_at,
             source_table,
             downstream_checker_fired,
             downstream_edit_churn,
             downstream_canon_conflict
      FROM (
        SELECT cp.id,
               cp.novel_id,
               'canon_update' AS kind,
               'high' AS risk,
               cp.status,
               cp.resolved_by_kind,
               cp.resolution_policy_decision,
               cp.resolution_policy_version,
               cp.resolved_at,
               'canon_proposals' AS source_table,
               pro.downstream_checker_fired,
               pro.downstream_edit_churn,
               pro.downstream_canon_conflict
        FROM canon_proposals cp
        LEFT JOIN proposal_resolution_outcomes pro
          ON pro.source_table = 'canon_proposals'
         AND pro.proposal_id = cp.id
        WHERE cp.novel_id = ${novelId}
          AND cp.resolved_at IS NOT NULL
          AND cp.resolved_at >= ${since}::timestamptz
          AND cp.resolution_policy_decision IS NOT NULL
      ) canon_rows
    ) replay_rows
    ORDER BY resolved_at DESC, id ASC
    LIMIT ${limit}
  `) as RawReplayRow[]
}

async function listForAllNovels(
  since: string,
  limit: number,
): Promise<RawReplayRow[]> {
  return (await db`
    SELECT *
    FROM (
      SELECT id,
             novel_id,
             kind,
             risk,
             status,
             resolved_by_kind,
             resolution_policy_decision,
             resolution_policy_version,
             resolved_at,
             source_table,
             downstream_checker_fired,
             downstream_edit_churn,
             downstream_canon_conflict
      FROM (
        SELECT pe.id,
               pe.novel_id,
               pe.kind,
               pe.risk,
               pe.status,
               pe.resolved_by_kind,
               pe.resolution_policy_decision,
               pe.resolution_policy_version,
               pe.resolved_at,
               'proposal_envelopes' AS source_table,
               pro.downstream_checker_fired,
               pro.downstream_edit_churn,
               pro.downstream_canon_conflict
        FROM proposal_envelopes pe
        LEFT JOIN proposal_resolution_outcomes pro
          ON pro.source_table = 'proposal_envelopes'
         AND pro.proposal_id = pe.id
        WHERE pe.resolved_at IS NOT NULL
          AND pe.resolved_at >= ${since}::timestamptz
          AND pe.resolution_policy_decision IS NOT NULL
      ) proposal_rows

      UNION ALL

      SELECT id,
             novel_id,
             kind,
             risk,
             status,
             resolved_by_kind,
             resolution_policy_decision,
             resolution_policy_version,
             resolved_at,
             source_table,
             downstream_checker_fired,
             downstream_edit_churn,
             downstream_canon_conflict
      FROM (
        SELECT cp.id,
               cp.novel_id,
               'canon_update' AS kind,
               'high' AS risk,
               cp.status,
               cp.resolved_by_kind,
               cp.resolution_policy_decision,
               cp.resolution_policy_version,
               cp.resolved_at,
               'canon_proposals' AS source_table,
               pro.downstream_checker_fired,
               pro.downstream_edit_churn,
               pro.downstream_canon_conflict
        FROM canon_proposals cp
        LEFT JOIN proposal_resolution_outcomes pro
          ON pro.source_table = 'canon_proposals'
         AND pro.proposal_id = cp.id
        WHERE cp.resolved_at IS NOT NULL
          AND cp.resolved_at >= ${since}::timestamptz
          AND cp.resolution_policy_decision IS NOT NULL
      ) canon_rows
    ) replay_rows
    ORDER BY resolved_at DESC, id ASC
    LIMIT ${limit}
  `) as RawReplayRow[]
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 500
  return Math.min(Math.floor(limit), 5000)
}
