/**
 * Adapter registry queries — one row per LoRA adapter, grouped by slot/status.
 *
 * Used by /api/adapters and FinetunePage. Replaces the hard-coded adapter
 * slate that previously lived in the UI.
 */

import db from "../db/connection"

export type AdapterStatus = "deployed" | "candidate" | "retired" | "rejected"

export interface AdapterRow {
  uri: string
  name: string
  slot: string | null
  baseModel: string | null
  status: AdapterStatus
  trainingExperimentId: number | null
  evalExperimentIds: number[]
  deployedAt: string | null
  retiredAt: string | null
  headlineMetrics: Record<string, any> | null
  trainingDataPath: string | null
  trainingDataSha256: string | null
  supersedes: string | null
  notes: string | null
  trainingConclusion: string | null
}

function rowToAdapter(r: any): AdapterRow {
  const hm = r.headline_metrics
  return {
    uri: r.uri,
    name: r.name,
    slot: r.slot,
    baseModel: r.base_model,
    status: r.status,
    trainingExperimentId: r.training_experiment_id,
    evalExperimentIds: r.eval_experiment_ids ?? [],
    deployedAt: r.deployed_at ? new Date(r.deployed_at).toISOString() : null,
    retiredAt: r.retired_at ? new Date(r.retired_at).toISOString() : null,
    headlineMetrics: typeof hm === "string" ? JSON.parse(hm) : (hm ?? null),
    trainingDataPath: r.training_data_path,
    trainingDataSha256: r.training_data_sha256,
    supersedes: r.supersedes,
    notes: r.notes,
    trainingConclusion: r.training_conclusion ?? null,
  }
}

/** All adapters, joined to tuning_experiments for the training conclusion. */
export async function listAdapters(): Promise<AdapterRow[]> {
  const rows = await db`
    SELECT r.uri, r.name, r.slot, r.base_model, r.status,
           r.training_experiment_id, r.eval_experiment_ids,
           r.deployed_at, r.retired_at, r.headline_metrics,
           r.training_data_path, r.training_data_sha256,
           r.supersedes, r.notes,
           t.conclusion AS training_conclusion
    FROM adapter_registry r
    LEFT JOIN tuning_experiments t ON t.id = r.training_experiment_id
    ORDER BY CASE r.status
               WHEN 'deployed'  THEN 1
               WHEN 'candidate' THEN 2
               WHEN 'retired'   THEN 3
               WHEN 'rejected'  THEN 4
               ELSE 5 END,
             r.slot NULLS LAST, r.name
  ` as any[]
  return rows.map(rowToAdapter)
}

export async function getAdapter(uri: string): Promise<AdapterRow | null> {
  const rows = await db`
    SELECT r.uri, r.name, r.slot, r.base_model, r.status,
           r.training_experiment_id, r.eval_experiment_ids,
           r.deployed_at, r.retired_at, r.headline_metrics,
           r.training_data_path, r.training_data_sha256,
           r.supersedes, r.notes,
           t.conclusion AS training_conclusion
    FROM adapter_registry r
    LEFT JOIN tuning_experiments t ON t.id = r.training_experiment_id
    WHERE r.uri = ${uri}
  ` as any[]
  return rows.length ? rowToAdapter(rows[0]) : null
}

/** Deployed adapters grouped by slot. Slot keys match src/models/roles.ts. */
export async function listDeployedBySlot(): Promise<Record<string, AdapterRow[]>> {
  const all = await listAdapters()
  const out: Record<string, AdapterRow[]> = {}
  for (const a of all) {
    if (a.status !== "deployed") continue
    const slot = a.slot ?? "(unassigned)"
    ;(out[slot] ??= []).push(a)
  }
  return out
}

/** Resolve lineage: follow `supersedes` pointers until null. Newest first. */
export async function getLineage(uri: string): Promise<AdapterRow[]> {
  const chain: AdapterRow[] = []
  let cursor: string | null = uri
  const seen = new Set<string>()
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const row = await getAdapter(cursor)
    if (!row) break
    chain.push(row)
    cursor = row.supersedes
  }
  return chain
}
