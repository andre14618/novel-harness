import db from "./connection"
import type {
  PlanReadinessImporterKind,
  PlanReadinessItemDraft,
  PlanReadinessOperatorDisposition,
  PlanReadinessPreserveIds,
  PlanReadinessSeverity,
  PlanReadinessSourceHashKind,
  PlanReadinessStatus,
  PlanReadinessTargetKind,
} from "../harness/plan-readiness"

type Executor = typeof db

export interface PlanReadinessItemRow {
  id: string
  novel_id: string
  target_kind: string
  target_ref: string
  target_field_path: string | null
  source_hash: string
  source_hash_kind: string
  diagnostic_label: string
  dimension: string
  fix_intent: string
  severity: string
  explanation: string
  missing_for_next_level: string | null
  preserve_ids: unknown
  evidence: unknown
  source_report_paths: unknown
  status: string
  operator_disposition: string | null
  operator_note: string | null
  proposal_envelope_id: string | null
  imported_by_kind: string
  imported_by_ref: string | null
  resolved_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
  metadata: unknown
}

export interface PlanReadinessItem {
  id: string
  novelId: string
  target: {
    kind: PlanReadinessTargetKind
    ref: string
    fieldPath?: string
  }
  sourceHash: string
  sourceHashKind: PlanReadinessSourceHashKind
  diagnosticLabel: string
  dimension: string
  fixIntent: string
  severity: PlanReadinessSeverity
  explanation: string
  missingForNextLevel: string | null
  preserveIds: PlanReadinessPreserveIds
  evidence: Record<string, string>
  sourceReportPaths: string[]
  status: PlanReadinessStatus
  operatorDisposition: PlanReadinessOperatorDisposition | null
  operatorNote: string | null
  proposalEnvelopeId: string | null
  importedByKind: PlanReadinessImporterKind
  importedByRef: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
  metadata: Record<string, unknown>
}

export interface PlanReadinessDispositionUpdate {
  id: string
  novelId: string
  status: PlanReadinessStatus
  operatorDisposition: PlanReadinessOperatorDisposition | null
  operatorNote: string | null
  proposalEnvelopeId: string | null
}

export interface PlanReadinessTargetVersion {
  targetKind: PlanReadinessTargetKind
  targetRef: string
  sourceHash: string
}

export async function upsertPlanReadinessItem(
  draft: PlanReadinessItemDraft,
  executor: Executor = db,
): Promise<{ item: PlanReadinessItem; inserted: boolean }> {
  const inserted = (await executor`
    INSERT INTO plan_readiness_items (
      id,
      novel_id,
      target_kind,
      target_ref,
      target_field_path,
      source_hash,
      source_hash_kind,
      diagnostic_label,
      dimension,
      fix_intent,
      severity,
      explanation,
      missing_for_next_level,
      preserve_ids,
      evidence,
      source_report_paths,
      imported_by_kind,
      imported_by_ref,
      metadata
    ) VALUES (
      ${draft.id},
      ${draft.novelId},
      ${draft.target.kind},
      ${draft.target.ref},
      ${draft.target.fieldPath ?? null},
      ${draft.sourceHash},
      ${draft.sourceHashKind},
      ${draft.diagnosticLabel},
      ${draft.dimension},
      ${draft.fixIntent},
      ${draft.severity},
      ${draft.explanation},
      ${draft.missingForNextLevel},
      ${draft.preserveIds},
      ${draft.evidence},
      ${draft.sourceReportPaths},
      ${draft.importedByKind},
      ${draft.importedByRef},
      ${draft.metadata}
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING *
  `) as PlanReadinessItemRow[]
  if (inserted.length > 0) return { item: rowToPlanReadinessItem(inserted[0]!), inserted: true }

  const updated = (await executor`
    UPDATE plan_readiness_items
    SET explanation = ${draft.explanation},
        missing_for_next_level = ${draft.missingForNextLevel},
        preserve_ids = ${draft.preserveIds},
        evidence = ${draft.evidence},
        source_report_paths = ${draft.sourceReportPaths},
        imported_by_kind = ${draft.importedByKind},
        imported_by_ref = ${draft.importedByRef},
        metadata = ${draft.metadata},
        updated_at = now()
    WHERE id = ${draft.id}
    RETURNING *
  `) as PlanReadinessItemRow[]
  return { item: rowToPlanReadinessItem(updated[0]!), inserted: false }
}

export async function upsertPlanReadinessItems(
  drafts: readonly PlanReadinessItemDraft[],
  executor: Executor = db,
): Promise<{ inserted: number; updated: number; items: PlanReadinessItem[] }> {
  let inserted = 0
  let updated = 0
  const items: PlanReadinessItem[] = []
  for (const draft of drafts) {
    const result = await upsertPlanReadinessItem(draft, executor)
    if (result.inserted) inserted++
    else updated++
    items.push(result.item)
  }
  return { inserted, updated, items }
}

export async function listPlanReadinessItems(
  novelId: string,
  opts: { status?: PlanReadinessStatus | "all"; limit?: number; targetRef?: string } = {},
  executor: Executor = db,
): Promise<PlanReadinessItem[]> {
  const status = opts.status ?? "open"
  const limit = opts.limit ?? 200
  const rows = status === "all"
    ? opts.targetRef
      ? await executor`
          SELECT * FROM plan_readiness_items
          WHERE novel_id = ${novelId} AND target_ref = ${opts.targetRef}
          ORDER BY updated_at DESC, created_at DESC
          LIMIT ${limit}
        `
      : await executor`
          SELECT * FROM plan_readiness_items
          WHERE novel_id = ${novelId}
          ORDER BY updated_at DESC, created_at DESC
          LIMIT ${limit}
        `
    : opts.targetRef
      ? await executor`
          SELECT * FROM plan_readiness_items
          WHERE novel_id = ${novelId} AND status = ${status} AND target_ref = ${opts.targetRef}
          ORDER BY updated_at DESC, created_at DESC
          LIMIT ${limit}
        `
      : await executor`
          SELECT * FROM plan_readiness_items
          WHERE novel_id = ${novelId} AND status = ${status}
          ORDER BY updated_at DESC, created_at DESC
          LIMIT ${limit}
        `
  return (rows as PlanReadinessItemRow[]).map(rowToPlanReadinessItem)
}

export async function findPlanReadinessItem(
  novelId: string,
  id: string,
  executor: Executor = db,
): Promise<PlanReadinessItem | null> {
  const rows = (await executor`
    SELECT * FROM plan_readiness_items
    WHERE novel_id = ${novelId} AND id = ${id}
  `) as PlanReadinessItemRow[]
  return rows.length > 0 ? rowToPlanReadinessItem(rows[0]!) : null
}

export async function updatePlanReadinessDisposition(
  update: PlanReadinessDispositionUpdate,
  executor: Executor = db,
): Promise<PlanReadinessItem | null> {
  const resolved = update.status === "open" || update.status === "stale" ? null : new Date().toISOString()
  const rows = (await executor`
    UPDATE plan_readiness_items
    SET status = ${update.status},
        operator_disposition = ${update.operatorDisposition},
        operator_note = ${update.operatorNote},
        proposal_envelope_id = ${update.proposalEnvelopeId},
        resolved_at = ${resolved},
        updated_at = now()
    WHERE novel_id = ${update.novelId} AND id = ${update.id}
    RETURNING *
  `) as PlanReadinessItemRow[]
  return rows.length > 0 ? rowToPlanReadinessItem(rows[0]!) : null
}

export async function markStalePlanReadinessItems(
  novelId: string,
  targetVersions: readonly PlanReadinessTargetVersion[],
  executor: Executor = db,
): Promise<{ staleCount: number; staleIds: string[] }> {
  const staleIds: string[] = []
  for (const target of targetVersions) {
    const rows = (await executor`
      UPDATE plan_readiness_items
      SET status = 'stale',
          updated_at = now(),
          metadata = metadata || ${{
            stale: {
              reason: "target_hash_changed",
              currentSourceHash: target.sourceHash,
            },
          }}
      WHERE novel_id = ${novelId}
        AND target_kind = ${target.targetKind}
        AND target_ref = ${target.targetRef}
        AND status IN ('open', 'deferred')
        AND source_hash <> ${target.sourceHash}
      RETURNING id
    `) as Array<{ id: string }>
    staleIds.push(...rows.map(row => row.id))
  }
  return { staleCount: staleIds.length, staleIds }
}

export async function deletePlanReadinessItemsForNovel(
  novelId: string,
  executor: Executor = db,
): Promise<void> {
  await executor`DELETE FROM plan_readiness_items WHERE novel_id = ${novelId}`
}

export function rowToPlanReadinessItem(row: PlanReadinessItemRow): PlanReadinessItem {
  const preserveIds = parseJson<PlanReadinessPreserveIds>(row.preserve_ids, {
    obligationIds: [],
    characterIds: [],
    worldFactIds: [],
    sourceIds: [],
  })
  return {
    id: row.id,
    novelId: row.novel_id,
    target: {
      kind: row.target_kind as PlanReadinessTargetKind,
      ref: row.target_ref,
      ...(row.target_field_path != null ? { fieldPath: row.target_field_path } : {}),
    },
    sourceHash: row.source_hash,
    sourceHashKind: row.source_hash_kind as PlanReadinessSourceHashKind,
    diagnosticLabel: row.diagnostic_label,
    dimension: row.dimension,
    fixIntent: row.fix_intent,
    severity: row.severity as PlanReadinessSeverity,
    explanation: row.explanation,
    missingForNextLevel: row.missing_for_next_level,
    preserveIds,
    evidence: parseJson<Record<string, string>>(row.evidence, {}),
    sourceReportPaths: parseJson<string[]>(row.source_report_paths, []),
    status: row.status as PlanReadinessStatus,
    operatorDisposition: row.operator_disposition as PlanReadinessOperatorDisposition | null,
    operatorNote: row.operator_note,
    proposalEnvelopeId: row.proposal_envelope_id,
    importedByKind: row.imported_by_kind as PlanReadinessImporterKind,
    importedByRef: row.imported_by_ref,
    resolvedAt: toIsoOrNull(row.resolved_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
  }
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback
  if (typeof value === "string") return JSON.parse(value) as T
  return value as T
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value
}

function toIsoOrNull(value: string | Date | null): string | null {
  return value == null ? null : toIso(value)
}
