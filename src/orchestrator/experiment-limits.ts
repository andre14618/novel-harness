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
  minDeltaThreshold: number    // minimum score delta to keep a change (filters noise)
}

const DEFAULT_MAX_ITERATIONS = parseInt(process.env.IMPROVEMENT_MAX_ITERATIONS ?? "15")
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5
const DEFAULT_MIN_DELTA_THRESHOLD = 0.3

export function resolveDefaults(input?: Partial<ExperimentLimits>, dimensionLocked?: boolean): ExperimentLimits {
  // When dimension-locked, allow more consecutive failures since focused work
  // on a hard dimension will naturally hit more dead ends
  const failureCap = dimensionLocked ? 8 : DEFAULT_MAX_CONSECUTIVE_FAILURES
  return {
    maxIterations: input?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    maxCostUsd: input?.maxCostUsd ?? null,
    maxConsecutiveFailures: input?.maxConsecutiveFailures ?? failureCap,
    minDeltaThreshold: input?.minDeltaThreshold ?? DEFAULT_MIN_DELTA_THRESHOLD,
  }
}

export async function getExperimentActualCost(experimentId: number): Promise<number> {
  const rows = await getExperimentCost(experimentId)
  return rows.reduce((sum, r) => sum + r.totalCost, 0)
}

export function checkLimits(
  totalCost: number,
  iterationCount: number,
  consecutiveFailures: number,
  limits: ExperimentLimits,
): { allowed: boolean; reason?: string } {
  if (iterationCount >= limits.maxIterations) {
    return { allowed: false, reason: `Max iterations (${limits.maxIterations})` }
  }

  if (consecutiveFailures >= limits.maxConsecutiveFailures) {
    return { allowed: false, reason: `${limits.maxConsecutiveFailures} consecutive failures` }
  }

  if (limits.maxCostUsd !== null && totalCost >= limits.maxCostUsd) {
    return { allowed: false, reason: `Cost cap reached: $${totalCost.toFixed(4)}/$${limits.maxCostUsd.toFixed(2)}` }
  }

  return { allowed: true }
}
