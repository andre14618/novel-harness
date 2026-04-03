/**
 * Per-experiment limits and real cost tracking.
 *
 * Replaces the old daily budget system. Limits are set per-experiment
 * at cycle start. Costs come from llm_calls (actual API pricing).
 */

import { getExperimentCost } from "../../data/db"

export interface ExperimentLimits {
  maxIterations: number
  maxCostUsd: number | null    // null = no cap
  maxConsecutiveFailures: number
}

const DEFAULT_MAX_ITERATIONS = parseInt(process.env.IMPROVEMENT_MAX_ITERATIONS ?? "15")
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3

export function resolveDefaults(input?: Partial<ExperimentLimits>): ExperimentLimits {
  return {
    maxIterations: input?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    maxCostUsd: input?.maxCostUsd ?? null,
    maxConsecutiveFailures: input?.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES,
  }
}

export async function getExperimentActualCost(experimentId: number): Promise<number> {
  const rows = await getExperimentCost(experimentId)
  return rows.reduce((sum, r) => sum + r.totalCost, 0)
}

export async function checkLimits(
  experimentId: number,
  iterationCount: number,
  consecutiveFailures: number,
  limits: ExperimentLimits,
): Promise<{ allowed: boolean; reason?: string; totalCost: number }> {
  const totalCost = await getExperimentActualCost(experimentId)

  if (iterationCount >= limits.maxIterations) {
    return { allowed: false, reason: `Max iterations (${limits.maxIterations})`, totalCost }
  }

  if (consecutiveFailures >= limits.maxConsecutiveFailures) {
    return { allowed: false, reason: `${limits.maxConsecutiveFailures} consecutive failures`, totalCost }
  }

  if (limits.maxCostUsd !== null && totalCost >= limits.maxCostUsd) {
    return { allowed: false, reason: `Cost cap reached: $${totalCost.toFixed(4)}/$${limits.maxCostUsd.toFixed(2)}`, totalCost }
  }

  return { allowed: true, totalCost }
}
