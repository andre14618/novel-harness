/**
 * Budget tracking and enforcement.
 *
 * Prevents runaway spending by tracking daily costs in Postgres
 * and rejecting operations that would exceed the budget.
 */

import db from "./db"

const MAX_BUDGET_USD = parseFloat(process.env.IMPROVEMENT_BUDGET ?? "0.80")
const MAX_ITERATIONS = parseInt(process.env.IMPROVEMENT_MAX_ITERATIONS ?? "15")
const MAX_CONSECUTIVE_FAILURES = 3
const BUDGET_ALERT_THRESHOLD = 0.75  // notify at 75% spent

export { MAX_ITERATIONS, MAX_CONSECUTIVE_FAILURES, BUDGET_ALERT_THRESHOLD }

async function ensureToday(): Promise<void> {
  await db`
    INSERT INTO budget_tracker (period_date, budget_usd)
    VALUES (CURRENT_DATE, ${MAX_BUDGET_USD})
    ON CONFLICT (period_date) DO NOTHING
  `
}

export async function checkBudget(estimatedCost: number): Promise<{
  allowed: boolean
  remaining: number
  spent: number
  iterationCount: number
}> {
  await ensureToday()
  const rows = await db`
    SELECT spent_usd, budget_usd, iteration_count
    FROM budget_tracker WHERE period_date = CURRENT_DATE
  `
  const row = rows[0] as any
  const spent = parseFloat(row.spent_usd)
  const budget = parseFloat(row.budget_usd)
  const remaining = budget - spent

  return {
    allowed: spent + estimatedCost <= budget && row.iteration_count < MAX_ITERATIONS,
    remaining,
    spent,
    iterationCount: row.iteration_count,
  }
}

export async function recordSpend(cost: number): Promise<void> {
  await ensureToday()
  await db`
    UPDATE budget_tracker
    SET spent_usd = spent_usd + ${cost}, iteration_count = iteration_count + 1
    WHERE period_date = CURRENT_DATE
  `
}

export async function getTodayBudget(): Promise<{
  spent: number
  budget: number
  remaining: number
  iterations: number
}> {
  await ensureToday()
  const rows = await db`
    SELECT spent_usd, budget_usd, iteration_count
    FROM budget_tracker WHERE period_date = CURRENT_DATE
  `
  const row = rows[0] as any
  const spent = parseFloat(row.spent_usd)
  const budget = parseFloat(row.budget_usd)
  return { spent, budget, remaining: budget - spent, iterations: row.iteration_count }
}
