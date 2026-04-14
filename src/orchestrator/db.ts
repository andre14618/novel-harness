/**
 * Orchestrator DB layer.
 *
 * Uses the shared Postgres connection from data/connection.ts.
 * Orchestrator-specific tables (improvement_cycles, budget_tracker, etc.)
 * live alongside the harness tables in the same database.
 */

import db from "../db/connection"
export { migrate } from "../db/connection"
export default db

// ── Batch queries ───────────────────────────────────────────────────────

export interface OrchestratorBatch {
  id: number
  provider: string
  provider_batch_id: string | null
  description: string | null
  status: string
  request_count: number
  completed_count: number
  failed_count: number
  error: string | null
  submitted_at: string
  completed_at: string | null
  last_polled_at: string | null
  imported_at: string | null
  local_run_id: number | null
  local_batch_id: number | null
  judge_model: string | null
}

export async function getActiveBatches(): Promise<OrchestratorBatch[]> {
  return db`SELECT * FROM orchestrator_batches WHERE status IN ('submitted', 'validating', 'processing') ORDER BY submitted_at ASC` as any
}

export async function getAllBatches(limit = 20): Promise<OrchestratorBatch[]> {
  return db`SELECT * FROM orchestrator_batches ORDER BY submitted_at DESC LIMIT ${limit}` as any
}

export async function getBatchById(id: number): Promise<OrchestratorBatch | null> {
  const rows = await db`SELECT * FROM orchestrator_batches WHERE id = ${id}`
  return (rows[0] as any) ?? null
}

export async function updateBatchStatus(id: number, status: string, completedCount: number, failedCount: number, error?: string) {
  const isTerminal = ["completed", "failed", "expired", "cancelled"].includes(status)
  if (isTerminal) {
    await db`UPDATE orchestrator_batches SET status = ${status}, completed_count = ${completedCount}, failed_count = ${failedCount}, error = ${error ?? null}, completed_at = now(), last_polled_at = now() WHERE id = ${id}`
  } else {
    await db`UPDATE orchestrator_batches SET status = ${status}, completed_count = ${completedCount}, failed_count = ${failedCount}, last_polled_at = now() WHERE id = ${id}`
  }
}

export async function saveRequestResult(customId: string, status: "completed" | "failed", content?: string, error?: string, promptTokens?: number, completionTokens?: number) {
  await db`UPDATE orchestrator_requests SET status = ${status}, content = ${content ?? null}, error = ${error ?? null}, prompt_tokens = ${promptTokens ?? null}, completion_tokens = ${completionTokens ?? null} WHERE custom_id = ${customId}`
}

export async function getState() {
  const rows = await db`SELECT * FROM orchestrator_state WHERE id = 1`
  return rows[0] as any
}

export async function updateState(collected: number) {
  await db`UPDATE orchestrator_state SET last_poll_at = now(), total_polls = total_polls + 1, total_collected = total_collected + ${collected} WHERE id = 1`
}

export async function getRequestsForBatch(batchId: number) {
  return db`SELECT * FROM orchestrator_requests WHERE batch_id = ${batchId} ORDER BY id ASC` as any
}

export async function createOrchestratorBatch(providerBatchId: string, provider: string, judgeModel: string, requestCount: number, localRunId: number, localBatchId: number, description?: string): Promise<number> {
  const rows = await db`INSERT INTO orchestrator_batches (provider_batch_id, provider, judge_model, request_count, local_run_id, local_batch_id, description) VALUES (${providerBatchId}, ${provider}, ${judgeModel}, ${requestCount}, ${localRunId}, ${localBatchId}, ${description ?? null}) RETURNING id`
  return (rows[0] as any).id
}

export async function addOrchestratorRequest(batchId: number, customId: string, generationId: number, dimension: string) {
  await db`INSERT INTO orchestrator_requests (batch_id, custom_id, generation_id, dimension) VALUES (${batchId}, ${customId}, ${generationId}, ${dimension})`
}
