/**
 * Experiment-family rollups.
 *
 * An "experiment family" is a charter (or charter-equivalent grouping) that
 * ties together a set of tuning_experiments rows via
 * `config->>experiment_family`. The rollup gives the UI a per-family card:
 * charter row, child runs, verdict summary.
 *
 * Data shape:
 *   - `charter` row: config->>kind = 'charter'. One per family.
 *   - child rows: all other tuning_experiments with the same family.
 */

import db from "../db/connection"

export interface FamilyExperimentRow {
  id: number
  timestamp: string
  description: string
  status: string | null
  conclusion: string | null
  experimentType: string | null
  kind: string | null
}

export interface FamilySummary {
  family: string
  charter: FamilyExperimentRow | null
  runs: FamilyExperimentRow[]
  totalExperiments: number
  latestAt: string | null
  concludedCount: number
}

function rowToExp(r: any): FamilyExperimentRow {
  const cfg = typeof r.config === "string" ? JSON.parse(r.config) : (r.config ?? {})
  return {
    id: r.id,
    timestamp: new Date(r.timestamp).toISOString(),
    description: r.description,
    status: r.status ?? null,
    conclusion: r.conclusion ?? null,
    experimentType: r.experiment_type ?? null,
    kind: cfg?.kind ?? null,
  }
}

export async function listFamilies(): Promise<FamilySummary[]> {
  const rows = (await db`
    SELECT id, timestamp, description, status, conclusion, experiment_type, config,
           config->>'experiment_family' AS family
    FROM tuning_experiments
    WHERE config ? 'experiment_family'
    ORDER BY timestamp ASC
  `) as any[]

  const byFamily = new Map<string, FamilyExperimentRow[]>()
  for (const r of rows) {
    const fam = r.family as string
    if (!fam) continue
    const exp = rowToExp(r)
    const list = byFamily.get(fam) ?? []
    list.push(exp)
    byFamily.set(fam, list)
  }

  const summaries: FamilySummary[] = []
  for (const [family, exps] of byFamily) {
    const charter = exps.find(e => e.kind === "charter") ?? null
    const runs = exps.filter(e => e.kind !== "charter")
    const latestAt = exps.reduce<string | null>((acc, e) => !acc || e.timestamp > acc ? e.timestamp : acc, null)
    summaries.push({
      family,
      charter,
      runs,
      totalExperiments: exps.length,
      latestAt,
      concludedCount: exps.filter(e => e.conclusion != null).length,
    })
  }

  summaries.sort((a, b) => (b.latestAt ?? "").localeCompare(a.latestAt ?? ""))
  return summaries
}

export async function getFamily(family: string): Promise<FamilySummary | null> {
  const all = await listFamilies()
  return all.find(f => f.family === family) ?? null
}
