/**
 * Improvement cycle and iteration management.
 * Replaces inline SQL in daemon-loop.ts for cycle/iteration CRUD.
 */

import db from "../../data/connection"

// The orchestrator DB is now the same Postgres connection
const orchDb = db

export interface CycleRow {
  id: number
  target: string
  dimension: string
  status: string
  experimentId: number
  keptCount: number
  totalIterations: number
  totalCostUsd: number
}

/** Create a new improvement cycle */
export async function createCycle(params: {
  trigger: string
  experimentId: number
  maxIterations: number
  maxCostUsd: number | null
  target: string
  dimension: string
  dimensionLocked: boolean
}): Promise<number> {
  const rows = await orchDb`
    INSERT INTO improvement_cycles (trigger_type, status, experiment_id, max_iterations, max_cost_usd, target, dimension, dimension_locked)
    VALUES (${params.trigger}, 'active', ${params.experimentId}, ${params.maxIterations}, ${params.maxCostUsd}, ${params.target}, ${params.dimension}, ${params.dimensionLocked})
    RETURNING id
  `
  return rows[0].id
}

/** Create a new iteration row */
export async function createIteration(cycleId: number, iterationNum: number, target: string, dimension: string, baselineScore: number): Promise<number> {
  const rows = await orchDb`
    INSERT INTO improvement_iterations (cycle_id, iteration_num, target, dimension, phase, baseline_score)
    VALUES (${cycleId}, ${iterationNum}, ${target}, ${dimension}, 'proposing', ${baselineScore})
    RETURNING id
  `
  return rows[0].id
}

/** Update iteration with proposal details */
export async function setIterationProposal(iterationId: number, proposal: {
  explanation: string
  agentName: string
  filePath: string
  proposedContent: string
  backupContent: string
}): Promise<void> {
  await orchDb`
    UPDATE improvement_iterations
    SET phase = 'benchmarking', proposal_explanation = ${proposal.explanation},
        agent_name = ${proposal.agentName}, file_path = ${proposal.filePath},
        proposed_content = ${proposal.proposedContent}, backup_content = ${proposal.backupContent}
    WHERE id = ${iterationId}
  `
}

/** Update iteration phase */
export async function setIterationPhase(iterationId: number, phase: string): Promise<void> {
  await orchDb`UPDATE improvement_iterations SET phase = ${phase} WHERE id = ${iterationId}`
}

/** Update iteration with run ID */
export async function setIterationRunId(iterationId: number, runId: number): Promise<void> {
  await orchDb`UPDATE improvement_iterations SET run_id = ${runId}, phase = 'evaluating' WHERE id = ${iterationId}`
}

/** Update iteration with batch ID */
export async function setIterationBatchId(iterationId: number, batchId: number): Promise<void> {
  await orchDb`UPDATE improvement_iterations SET batch_id = ${batchId} WHERE id = ${iterationId}`
}

/** Mark iteration as done with result */
export async function completeIteration(iterationId: number, result: {
  newScore?: number
  delta?: number
  outcome: "kept" | "reverted" | "failed" | "no-proposal"
}): Promise<void> {
  await orchDb`
    UPDATE improvement_iterations
    SET new_score = ${result.newScore ?? null}, delta = ${result.delta ?? null},
        result = ${result.outcome}, phase = 'done', finished_at = now()
    WHERE id = ${iterationId}
  `
}

/** Update iteration backup content (for crash recovery) */
export async function setIterationBackup(iterationId: number, backupContent: string): Promise<void> {
  await orchDb`UPDATE improvement_iterations SET backup_content = ${backupContent} WHERE id = ${iterationId}`
}

/** Update cycle stats */
export async function updateCycleStats(cycleId: number, stats: {
  totalIterations: number
  totalCostUsd: number
}): Promise<void> {
  await orchDb`UPDATE improvement_cycles SET total_iterations = ${stats.totalIterations}, total_cost_usd = ${stats.totalCostUsd} WHERE id = ${cycleId}`
}

/** Increment cycle kept count */
export async function incrementCycleKept(cycleId: number): Promise<void> {
  await orchDb`UPDATE improvement_cycles SET kept_count = kept_count + 1 WHERE id = ${cycleId}`
}

/** Finish a cycle */
export async function finishCycle(cycleId: number, status: string, summary: string, stats: {
  totalIterations: number
  totalCostUsd: number
}): Promise<void> {
  await orchDb`
    UPDATE improvement_cycles
    SET status = ${status}, finished_at = now(), summary = ${summary},
        total_iterations = ${stats.totalIterations}, total_cost_usd = ${stats.totalCostUsd}
    WHERE id = ${cycleId}
  `
}

/** Find active cycle (for crash recovery) */
export async function findActiveCycle(): Promise<number | null> {
  const rows = await orchDb`SELECT id FROM improvement_cycles WHERE status = 'active' LIMIT 1`
  return rows.length > 0 ? rows[0].id : null
}

/** Get pending iterations for a cycle (crash recovery) */
export async function getPendingIterations(cycleId: number): Promise<Array<{ id: number; filePath: string; backupContent: string }>> {
  const rows = await orchDb`
    SELECT id, file_path, backup_content FROM improvement_iterations
    WHERE cycle_id = ${cycleId} AND phase NOT IN ('done') AND backup_content IS NOT NULL
  `
  return rows.map(r => ({ id: r.id, filePath: r.file_path, backupContent: r.backup_content }))
}

/** Mark pending iteration as failed (crash recovery) */
export async function failIteration(iterationId: number): Promise<void> {
  await orchDb`UPDATE improvement_iterations SET result = 'failed', phase = 'done', finished_at = now() WHERE id = ${iterationId}`
}

/** Mark cycle as failed (crash recovery) */
export async function failCycle(cycleId: number, summary: string): Promise<void> {
  await orchDb`UPDATE improvement_cycles SET status = 'failed', finished_at = now(), summary = ${summary} WHERE id = ${cycleId}`
}

/** Get all iterations for a cycle (for conclusion synthesis) */
export async function getCycleIterations(cycleId: number): Promise<Array<{
  iterationNum: number
  result: string
  delta: number | null
  proposalExplanation: string | null
  backupContent: string | null
  proposedContent: string | null
  filePath: string | null
  newScore: number | null
  baselineScore: number
}>> {
  const rows = await orchDb`
    SELECT iteration_num, result, delta, proposal_explanation, backup_content,
           proposed_content, file_path, new_score, baseline_score
    FROM improvement_iterations WHERE cycle_id = ${cycleId} ORDER BY iteration_num
  `
  return rows.map(r => ({
    iterationNum: r.iteration_num,
    result: r.result,
    delta: r.delta,
    proposalExplanation: r.proposal_explanation,
    backupContent: r.backup_content,
    proposedContent: r.proposed_content,
    filePath: r.file_path,
    newScore: r.new_score,
    baselineScore: r.baseline_score,
  }))
}

/** Get previous attempts for a target/dimension across all cycles */
export async function getPreviousAttempts(target: string, dimension: string, limit: number = 20): Promise<Array<{
  cycleId: number
  cycleDate: string
  iterationNum: number
  result: string
  delta: number | null
  proposalExplanation: string | null
}>> {
  const rows = await orchDb`
    SELECT ii.iteration_num, ii.proposal_explanation, ii.delta, ii.result,
           ii.cycle_id, ic.started_at::date as cycle_date
    FROM improvement_iterations ii
    JOIN improvement_cycles ic ON ic.id = ii.cycle_id
    WHERE ii.target = ${target} AND ii.dimension = ${dimension} AND ii.result IS NOT NULL
    ORDER BY ii.id DESC LIMIT ${limit}
  `
  return rows.map(r => ({
    cycleId: r.cycle_id,
    cycleDate: r.cycle_date,
    iterationNum: r.iteration_num,
    result: r.result,
    delta: r.delta,
    proposalExplanation: r.proposal_explanation,
  }))
}

/** Get recently attempted target/dimension combinations */
export async function getRecentAttempts(hours: number): Promise<Set<string>> {
  const rows = await orchDb`
    SELECT DISTINCT target, dimension FROM improvement_iterations
    WHERE started_at > now() - ${hours + ' hours'}::interval
  `
  return new Set(rows.map(r => `${r.target}:${r.dimension}`))
}

/** Create orchestrator batch tracking row */
export async function createOrchestratorBatch(
  providerBatchId: string, provider: string, model: string, requestCount: number,
  localRunId: number, localBatchId: number, label?: string,
): Promise<number> {
  const rows = await orchDb`
    INSERT INTO orchestrator_batches (provider, provider_batch_id, status, request_count, local_run_id, local_batch_id)
    VALUES (${provider}, ${providerBatchId}, 'submitted', ${requestCount}, ${localRunId}, ${localBatchId})
    RETURNING id
  `
  return rows[0].id
}
