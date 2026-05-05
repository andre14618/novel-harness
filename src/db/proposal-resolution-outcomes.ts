/**
 * Downstream-impact observations for resolved proposals.
 *
 * This table is intentionally separate from the resolution audit tables. A
 * proposal is resolved first; later checker/edit/canon systems may attach
 * outcome observations keyed by the original proposal id and source table.
 */

import db from "./connection"
import type { ProposalEnvelopeKind } from "../canon/proposal-envelope"

type Executor = typeof db

export type ProposalResolutionOutcomeSourceTable = "proposal_envelopes" | "canon_proposals"
export type ProposalResolutionImpactTargetKind = "draft" | "artifact" | "canon"

export interface ProposalResolutionOutcome {
  id: string
  proposalId: string
  proposalKind: ProposalEnvelopeKind
  novelId: string
  sourceTable: ProposalResolutionOutcomeSourceTable
  resolvedAt: string | null
  observedAt: string
  downstreamCheckerFired: boolean | null
  downstreamEditChurn: number | null
  downstreamCanonConflict: boolean | null
  notes: string | null
  metadata: Record<string, unknown>
}

interface ProposalResolutionOutcomeRow {
  id: string
  proposal_id: string
  proposal_kind: string
  novel_id: string
  source_table: ProposalResolutionOutcomeSourceTable
  resolved_at: string | Date | null
  observed_at: string | Date
  downstream_checker_fired: boolean | null
  downstream_edit_churn: number | null
  downstream_canon_conflict: boolean | null
  notes: string | null
  metadata: unknown
}

export interface ProposalResolutionImpact {
  id: string
  proposalId: string
  proposalKind: ProposalEnvelopeKind
  novelId: string
  sourceTable: ProposalResolutionOutcomeSourceTable
  targetKind: ProposalResolutionImpactTargetKind
  targetRef: string
  chapterNumber: number | null
  priorHash: string | null
  resultHash: string | null
  resultVersion: string | null
  resolvedAt: string
  metadata: Record<string, unknown>
}

export interface ProposalCheckerObservation {
  id: string
  proposalId: string
  proposalKind: ProposalEnvelopeKind
  novelId: string
  sourceTable: ProposalResolutionOutcomeSourceTable
  targetKind: ProposalResolutionImpactTargetKind
  targetRef: string
  chapterNumber: number | null
  resultHash: string | null
  checkerName: string
  fired: boolean
  observedAt: string
  details: Record<string, unknown>
}

interface ProposalResolutionImpactRow {
  id: string
  proposal_id: string
  proposal_kind: string
  novel_id: string
  source_table: ProposalResolutionOutcomeSourceTable
  target_kind: ProposalResolutionImpactTargetKind
  target_ref: string
  chapter_number: number | null
  prior_hash: string | null
  result_hash: string | null
  result_version: string | null
  resolved_at: string | Date
  metadata: unknown
}

interface ProposalCheckerObservationRow {
  id: string
  proposal_id: string
  proposal_kind: string
  novel_id: string
  source_table: ProposalResolutionOutcomeSourceTable
  target_kind: ProposalResolutionImpactTargetKind
  target_ref: string
  chapter_number: number | null
  result_hash: string | null
  checker_name: string
  fired: boolean
  observed_at: string | Date
  details: unknown
}

export async function recordProposalResolutionOutcome(
  outcome: {
    id: string
    proposalId: string
    proposalKind: ProposalEnvelopeKind
    novelId: string
    sourceTable: ProposalResolutionOutcomeSourceTable
    resolvedAt?: string | null
    observedAt: string
    downstreamCheckerFired?: boolean | null
    downstreamEditChurn?: number | null
    downstreamCanonConflict?: boolean | null
    notes?: string | null
    metadata?: Record<string, unknown>
  },
  executor: Executor = db,
): Promise<void> {
  await executor`
    INSERT INTO proposal_resolution_outcomes (
      id, proposal_id, proposal_kind, novel_id, source_table,
      resolved_at, observed_at,
      downstream_checker_fired, downstream_edit_churn, downstream_canon_conflict,
      notes, metadata
    ) VALUES (
      ${outcome.id}, ${outcome.proposalId}, ${outcome.proposalKind}, ${outcome.novelId},
      ${outcome.sourceTable},
      ${outcome.resolvedAt ?? null}::timestamptz,
      ${outcome.observedAt}::timestamptz,
      ${outcome.downstreamCheckerFired ?? null},
      ${outcome.downstreamEditChurn ?? null},
      ${outcome.downstreamCanonConflict ?? null},
      ${outcome.notes ?? null},
      ${JSON.stringify(outcome.metadata ?? {})}::jsonb
    )
    ON CONFLICT (source_table, proposal_id) DO UPDATE
    SET proposal_kind = EXCLUDED.proposal_kind,
        novel_id = EXCLUDED.novel_id,
        resolved_at = EXCLUDED.resolved_at,
        observed_at = EXCLUDED.observed_at,
        downstream_checker_fired = EXCLUDED.downstream_checker_fired,
        downstream_edit_churn = EXCLUDED.downstream_edit_churn,
        downstream_canon_conflict = EXCLUDED.downstream_canon_conflict,
        notes = EXCLUDED.notes,
        metadata = EXCLUDED.metadata
  `
}

export async function findProposalResolutionOutcome(
  sourceTable: ProposalResolutionOutcomeSourceTable,
  proposalId: string,
  executor: Executor = db,
): Promise<ProposalResolutionOutcome | null> {
  const rows = (await executor`
    SELECT *
    FROM proposal_resolution_outcomes
    WHERE source_table = ${sourceTable}
      AND proposal_id = ${proposalId}
  `) as ProposalResolutionOutcomeRow[]
  return rows.length > 0 ? rowToProposalResolutionOutcome(rows[0]!) : null
}

export async function recordProposalResolutionImpact(
  impact: {
    id: string
    proposalId: string
    proposalKind: ProposalEnvelopeKind
    novelId: string
    sourceTable: ProposalResolutionOutcomeSourceTable
    targetKind: ProposalResolutionImpactTargetKind
    targetRef: string
    chapterNumber?: number | null
    priorHash?: string | null
    resultHash?: string | null
    resultVersion?: string | null
    resolvedAt: string
    metadata?: Record<string, unknown>
  },
  executor: Executor = db,
): Promise<void> {
  await executor`
    INSERT INTO proposal_resolution_impacts (
      id, proposal_id, proposal_kind, novel_id, source_table,
      target_kind, target_ref, chapter_number,
      prior_hash, result_hash, result_version, resolved_at, metadata
    ) VALUES (
      ${impact.id}, ${impact.proposalId}, ${impact.proposalKind}, ${impact.novelId},
      ${impact.sourceTable}, ${impact.targetKind}, ${impact.targetRef},
      ${impact.chapterNumber ?? null},
      ${impact.priorHash ?? null}, ${impact.resultHash ?? null},
      ${impact.resultVersion ?? null},
      ${impact.resolvedAt}::timestamptz,
      ${JSON.stringify(impact.metadata ?? {})}::jsonb
    )
    ON CONFLICT (source_table, proposal_id) DO UPDATE
    SET proposal_kind = EXCLUDED.proposal_kind,
        novel_id = EXCLUDED.novel_id,
        target_kind = EXCLUDED.target_kind,
        target_ref = EXCLUDED.target_ref,
        chapter_number = EXCLUDED.chapter_number,
        prior_hash = EXCLUDED.prior_hash,
        result_hash = EXCLUDED.result_hash,
        result_version = EXCLUDED.result_version,
        resolved_at = EXCLUDED.resolved_at,
        metadata = EXCLUDED.metadata
  `
}

export async function findProposalResolutionImpact(
  sourceTable: ProposalResolutionOutcomeSourceTable,
  proposalId: string,
  executor: Executor = db,
): Promise<ProposalResolutionImpact | null> {
  const rows = (await executor`
    SELECT *
    FROM proposal_resolution_impacts
    WHERE source_table = ${sourceTable}
      AND proposal_id = ${proposalId}
  `) as ProposalResolutionImpactRow[]
  return rows.length > 0 ? rowToProposalResolutionImpact(rows[0]!) : null
}

export async function findDraftProposalResolutionImpactsByResultHash(
  novelId: string,
  chapterNumber: number,
  resultHash: string,
  executor: Executor = db,
): Promise<ProposalResolutionImpact[]> {
  const rows = (await executor`
    SELECT *
    FROM proposal_resolution_impacts
    WHERE novel_id = ${novelId}
      AND target_kind = 'draft'
      AND chapter_number = ${chapterNumber}
      AND result_hash = ${resultHash}
    ORDER BY resolved_at DESC, id ASC
  `) as ProposalResolutionImpactRow[]
  return rows.map(rowToProposalResolutionImpact)
}

export async function listProposalResolutionImpactsByTargetRefs(
  novelId: string,
  targetRefs: readonly string[],
  executor: Executor = db,
): Promise<ProposalResolutionImpact[]> {
  const uniqueRefs = [...new Set(targetRefs.filter(Boolean))]
  const out: ProposalResolutionImpact[] = []
  for (const targetRef of uniqueRefs) {
    const rows = (await executor`
      SELECT *
      FROM proposal_resolution_impacts
      WHERE novel_id = ${novelId}
        AND target_ref = ${targetRef}
      ORDER BY resolved_at DESC, id ASC
      LIMIT 200
    `) as ProposalResolutionImpactRow[]
    out.push(...rows.map(rowToProposalResolutionImpact))
  }
  return out
}

export async function recordDraftCheckerObservationForHash(
  args: {
    novelId: string
    chapterNumber: number
    resultHash: string
    checkerName: string
    fired: boolean
    observedAt: string
    details?: Record<string, unknown>
  },
  executor: Executor = db,
): Promise<ProposalCheckerObservation[]> {
  const impacts = await findDraftProposalResolutionImpactsByResultHash(
    args.novelId,
    args.chapterNumber,
    args.resultHash,
    executor,
  )
  const observations: ProposalCheckerObservation[] = []

  for (const impact of impacts) {
    const id = [
      "checker",
      impact.sourceTable,
      impact.proposalId,
      args.checkerName,
      args.resultHash.slice(0, 16),
    ].join(":")
    await executor`
      INSERT INTO proposal_checker_observations (
        id, proposal_id, proposal_kind, novel_id, source_table,
        target_kind, target_ref, chapter_number, result_hash,
        checker_name, fired, observed_at, details
      ) VALUES (
        ${id}, ${impact.proposalId}, ${impact.proposalKind}, ${impact.novelId},
        ${impact.sourceTable}, ${impact.targetKind}, ${impact.targetRef},
        ${impact.chapterNumber}, ${impact.resultHash},
        ${args.checkerName}, ${args.fired}, ${args.observedAt}::timestamptz,
        ${JSON.stringify(args.details ?? {})}::jsonb
      )
      ON CONFLICT (
        source_table, proposal_id, target_kind, checker_name, result_hash
      ) DO UPDATE
      SET fired = EXCLUDED.fired,
          observed_at = EXCLUDED.observed_at,
          details = EXCLUDED.details
    `
    await refreshDownstreamCheckerRollup(
      impact.sourceTable,
      impact.proposalId,
      executor,
    )
  }

  return listCheckerObservationsForDraftHash(
    args.novelId,
    args.chapterNumber,
    args.resultHash,
    executor,
  ).then((rows) =>
    rows.filter((row) => impacts.some((impact) => impact.proposalId === row.proposalId)),
  )
}

export async function listCheckerObservationsForDraftHash(
  novelId: string,
  chapterNumber: number,
  resultHash: string,
  executor: Executor = db,
): Promise<ProposalCheckerObservation[]> {
  const rows = (await executor`
    SELECT *
    FROM proposal_checker_observations
    WHERE novel_id = ${novelId}
      AND target_kind = 'draft'
      AND chapter_number = ${chapterNumber}
      AND result_hash = ${resultHash}
    ORDER BY observed_at DESC, id ASC
  `) as ProposalCheckerObservationRow[]
  return rows.map(rowToProposalCheckerObservation)
}

async function refreshDownstreamCheckerRollup(
  sourceTable: ProposalResolutionOutcomeSourceTable,
  proposalId: string,
  executor: Executor,
): Promise<void> {
  await executor`
    UPDATE proposal_resolution_outcomes pro
    SET downstream_checker_fired = COALESCE(obs.any_fired, false),
        observed_at = GREATEST(pro.observed_at, obs.latest_observed_at)
    FROM (
      SELECT BOOL_OR(fired) AS any_fired,
             MAX(observed_at) AS latest_observed_at
      FROM proposal_checker_observations
      WHERE source_table = ${sourceTable}
        AND proposal_id = ${proposalId}
    ) obs
    WHERE pro.source_table = ${sourceTable}
      AND pro.proposal_id = ${proposalId}
  `
}

export async function deleteProposalResolutionOutcomesForNovel(
  novelId: string,
  executor: Executor = db,
): Promise<void> {
  await executor`DELETE FROM proposal_resolution_outcomes WHERE novel_id = ${novelId}`
}

export async function deleteProposalResolutionImpactsForNovel(
  novelId: string,
  executor: Executor = db,
): Promise<void> {
  await executor`DELETE FROM proposal_resolution_impacts WHERE novel_id = ${novelId}`
}

export async function deleteProposalCheckerObservationsForNovel(
  novelId: string,
  executor: Executor = db,
): Promise<void> {
  await executor`DELETE FROM proposal_checker_observations WHERE novel_id = ${novelId}`
}

function rowToProposalResolutionOutcome(row: ProposalResolutionOutcomeRow): ProposalResolutionOutcome {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    proposalKind: row.proposal_kind as ProposalEnvelopeKind,
    novelId: row.novel_id,
    sourceTable: row.source_table,
    resolvedAt: row.resolved_at instanceof Date ? row.resolved_at.toISOString() : row.resolved_at,
    observedAt: row.observed_at instanceof Date ? row.observed_at.toISOString() : row.observed_at,
    downstreamCheckerFired: row.downstream_checker_fired,
    downstreamEditChurn: row.downstream_edit_churn,
    downstreamCanonConflict: row.downstream_canon_conflict,
    notes: row.notes,
    metadata: normalizeMetadata(row.metadata),
  }
}

function rowToProposalResolutionImpact(row: ProposalResolutionImpactRow): ProposalResolutionImpact {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    proposalKind: row.proposal_kind as ProposalEnvelopeKind,
    novelId: row.novel_id,
    sourceTable: row.source_table,
    targetKind: row.target_kind,
    targetRef: row.target_ref,
    chapterNumber: row.chapter_number,
    priorHash: row.prior_hash,
    resultHash: row.result_hash,
    resultVersion: row.result_version,
    resolvedAt: row.resolved_at instanceof Date ? row.resolved_at.toISOString() : row.resolved_at,
    metadata: normalizeMetadata(row.metadata),
  }
}

function rowToProposalCheckerObservation(row: ProposalCheckerObservationRow): ProposalCheckerObservation {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    proposalKind: row.proposal_kind as ProposalEnvelopeKind,
    novelId: row.novel_id,
    sourceTable: row.source_table,
    targetKind: row.target_kind,
    targetRef: row.target_ref,
    chapterNumber: row.chapter_number,
    resultHash: row.result_hash,
    checkerName: row.checker_name,
    fired: row.fired,
    observedAt: row.observed_at instanceof Date ? row.observed_at.toISOString() : row.observed_at,
    details: normalizeMetadata(row.details),
  }
}

function normalizeMetadata(metadata: unknown): Record<string, unknown> {
  if (typeof metadata === "string") {
    const parsed = JSON.parse(metadata)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {}
  }
  return typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {}
}
