/**
 * Experiment lifecycle management.
 * Replaces direct calls to data/db.ts experiment functions and inline SQL.
 */

import db from "../../data/connection"
import { createTuningExperiment, concludeExperiment, linkExperiment, getRelatedExperiments } from "../../data/db"

export { createTuningExperiment, concludeExperiment, linkExperiment, getRelatedExperiments }

export interface ExperimentSummary {
  id: number
  description: string
  conclusion: string | null
  target: string | null
  dimension: string | null
  timestamp: string
}

/** Get experiments matching a specific target/dimension */
export async function getExactExperiments(target: string, dimension: string, limit: number = 5): Promise<ExperimentSummary[]> {
  const rows = await db`
    SELECT id, description, conclusion, target, dimension, timestamp
    FROM tuning_experiments
    WHERE target = ${target} AND dimension = ${dimension} AND conclusion IS NOT NULL
    ORDER BY id DESC LIMIT ${limit}
  `
  return rows as ExperimentSummary[]
}

/** Get experiments on the same target but different dimension (for tradeoff awareness) */
export async function getSameTargetExperiments(target: string, excludeDimension: string, limit: number = 3): Promise<ExperimentSummary[]> {
  const rows = await db`
    SELECT id, description, conclusion, dimension, timestamp
    FROM tuning_experiments
    WHERE target = ${target} AND dimension != ${excludeDimension} AND conclusion IS NOT NULL
    ORDER BY id DESC LIMIT ${limit}
  `
  return rows as ExperimentSummary[]
}

/** Get experiments linked to experiments on this target/dimension */
export async function getLinkedExperiments(target: string, dimension: string, limit: number = 5): Promise<Array<ExperimentSummary & { relationship: string }>> {
  const rows = await db`
    SELECT te.id, te.description, te.conclusion, el.relationship
    FROM experiment_lineage el
    JOIN tuning_experiments te ON te.id = el.parent_experiment_id
    WHERE el.experiment_id IN (
      SELECT id FROM tuning_experiments
      WHERE target = ${target} AND dimension = ${dimension}
      ORDER BY id DESC LIMIT 5
    ) AND te.conclusion IS NOT NULL
    ORDER BY te.id DESC LIMIT ${limit}
  `
  return rows as Array<ExperimentSummary & { relationship: string }>
}

/** Auto-link new experiment to most recent on same target/dimension */
export async function autoLinkToPrior(experimentId: number, target: string, dimension: string): Promise<number | null> {
  const related = await getRelatedExperiments(target, dimension, 1)
  if (related.length > 0 && related[0].id !== experimentId) {
    await linkExperiment(experimentId, related[0].id, "continuation")
    return related[0].id
  }
  return null
}
