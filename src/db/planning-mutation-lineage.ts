import db from "./connection"
import type { ProposalEnvelopeKind } from "../canon/proposal-envelope"

type Executor = typeof db

export type PlanningMutationLineageSourceTable = "proposal_envelopes" | "chapter_exhaustions"

export interface PlanningMutationAffectedRef {
  kind: string
  ref: string
  fieldPath?: string
  reason?: string
  location?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface PlanningMutationLineage {
  id: string
  proposalId: string
  proposalKind: ProposalEnvelopeKind
  novelId: string
  sourceTable: PlanningMutationLineageSourceTable
  actorKind: string
  actorRef: string | null
  source: string | null
  targetKind: string
  previousRef: string
  nextRef: string
  fieldPath: string
  previousVersion: string | null
  nextVersion: string | null
  preconditionKind: string | null
  preconditionHash: string | null
  changedAt: string
  reason: string | null
  affectedDownstreamRefs: PlanningMutationAffectedRef[]
  metadata: Record<string, unknown>
}

interface PlanningMutationLineageRow {
  id: string
  proposal_id: string
  proposal_kind: string
  novel_id: string
  source_table: PlanningMutationLineageSourceTable
  actor_kind: string
  actor_ref: string | null
  source: string | null
  target_kind: string
  previous_ref: string
  next_ref: string
  field_path: string
  previous_version: string | null
  next_version: string | null
  precondition_kind: string | null
  precondition_hash: string | null
  changed_at: string | Date
  reason: string | null
  affected_downstream_refs: unknown
  metadata: unknown
}

export async function recordPlanningMutationLineage(
  lineage: {
    id: string
    proposalId: string
    proposalKind: ProposalEnvelopeKind
    novelId: string
    sourceTable: PlanningMutationLineageSourceTable
    actorKind: string
    actorRef?: string | null
    source?: string | null
    targetKind: string
    previousRef: string
    nextRef: string
    fieldPath: string
    previousVersion?: string | null
    nextVersion?: string | null
    preconditionKind?: string | null
    preconditionHash?: string | null
    changedAt: string
    reason?: string | null
    affectedDownstreamRefs?: PlanningMutationAffectedRef[]
    metadata?: Record<string, unknown>
  },
  executor: Executor = db,
): Promise<boolean> {
  const result = await executor`
    INSERT INTO planning_mutation_lineage (
      id, proposal_id, proposal_kind, novel_id, source_table,
      actor_kind, actor_ref, source,
      target_kind, previous_ref, next_ref, field_path,
      previous_version, next_version,
      precondition_kind, precondition_hash,
      changed_at, reason, affected_downstream_refs, metadata
    ) VALUES (
      ${lineage.id}, ${lineage.proposalId}, ${lineage.proposalKind}, ${lineage.novelId},
      ${lineage.sourceTable},
      ${lineage.actorKind}, ${lineage.actorRef ?? null}, ${lineage.source ?? null},
      ${lineage.targetKind}, ${lineage.previousRef}, ${lineage.nextRef}, ${lineage.fieldPath},
      ${lineage.previousVersion ?? null}, ${lineage.nextVersion ?? null},
      ${lineage.preconditionKind ?? null}, ${lineage.preconditionHash ?? null},
      ${lineage.changedAt}::timestamptz, ${lineage.reason ?? null},
      ${JSON.stringify(lineage.affectedDownstreamRefs ?? [])}::jsonb,
      ${JSON.stringify(lineage.metadata ?? {})}::jsonb
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `
  return Array.isArray(result) ? result.length > 0 : false
}

export async function findPlanningMutationLineageByProposal(
  proposalId: string,
  opts: { sourceTable?: PlanningMutationLineageSourceTable } = {},
  executor: Executor = db,
): Promise<PlanningMutationLineage | null> {
  const sourceTable = opts.sourceTable ?? "proposal_envelopes"
  const rows = (await executor`
    SELECT *
    FROM planning_mutation_lineage
    WHERE source_table = ${sourceTable}
      AND proposal_id = ${proposalId}
    ORDER BY changed_at DESC, id ASC
    LIMIT 1
  `) as PlanningMutationLineageRow[]
  return rows.length > 0 ? rowToPlanningMutationLineage(rows[0]!) : null
}

export async function listPlanningMutationLineageForRefs(
  novelId: string,
  refs: readonly string[],
  executor: Executor = db,
): Promise<PlanningMutationLineage[]> {
  const uniqueRefs = [...new Set(refs.filter(Boolean))]
  const out: PlanningMutationLineage[] = []
  for (const ref of uniqueRefs) {
    const rows = (await executor`
      SELECT *
      FROM planning_mutation_lineage
      WHERE novel_id = ${novelId}
        AND (previous_ref = ${ref} OR next_ref = ${ref})
      ORDER BY changed_at DESC, id ASC
      LIMIT 200
    `) as PlanningMutationLineageRow[]
    out.push(...rows.map(rowToPlanningMutationLineage))
  }
  return dedupeLineage(out)
}

export async function deletePlanningMutationLineageForNovel(
  novelId: string,
  executor: Executor = db,
): Promise<void> {
  await executor`DELETE FROM planning_mutation_lineage WHERE novel_id = ${novelId}`
}

function rowToPlanningMutationLineage(
  row: PlanningMutationLineageRow,
): PlanningMutationLineage {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    proposalKind: row.proposal_kind as ProposalEnvelopeKind,
    novelId: row.novel_id,
    sourceTable: row.source_table,
    actorKind: row.actor_kind,
    actorRef: row.actor_ref,
    source: row.source,
    targetKind: row.target_kind,
    previousRef: row.previous_ref,
    nextRef: row.next_ref,
    fieldPath: row.field_path,
    previousVersion: row.previous_version,
    nextVersion: row.next_version,
    preconditionKind: row.precondition_kind,
    preconditionHash: row.precondition_hash,
    changedAt: row.changed_at instanceof Date ? row.changed_at.toISOString() : row.changed_at,
    reason: row.reason,
    affectedDownstreamRefs: normalizeAffectedRefs(row.affected_downstream_refs),
    metadata: normalizeRecord(row.metadata),
  }
}

function normalizeAffectedRefs(raw: unknown): PlanningMutationAffectedRef[] {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw
  if (!Array.isArray(value)) return []
  return value.filter((item): item is PlanningMutationAffectedRef => {
    return (
      typeof item === "object" &&
      item !== null &&
      typeof (item as { kind?: unknown }).kind === "string" &&
      typeof (item as { ref?: unknown }).ref === "string"
    )
  })
}

function normalizeRecord(raw: unknown): Record<string, unknown> {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function dedupeLineage(rows: PlanningMutationLineage[]): PlanningMutationLineage[] {
  const seen = new Set<string>()
  const out: PlanningMutationLineage[] = []
  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out
}
