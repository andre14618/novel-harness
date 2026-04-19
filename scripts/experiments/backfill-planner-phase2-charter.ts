/**
 * Backfill a tuning_experiments row for the planner-phase2-payoff-floor charter.
 *
 * The charter was drafted and a mini-pilot launched before an experiment row
 * existed. Idempotent on insert; pass --update to overwrite the existing row's
 * config/description (use this after editing the canonical block below).
 *
 * Usage:
 *   bun scripts/experiments/backfill-planner-phase2-charter.ts
 *   bun scripts/experiments/backfill-planner-phase2-charter.ts --update
 */

import db from "../../src/db/connection"
import { createTuningExperiment } from "../../src/db/ops"

const FAMILY = "planner-phase2-payoff-floor"
const CHARTER_SLUG = "planner-phase2-payoff-floor"

const DESCRIPTION = "Charter — planner-phase2-payoff-floor (mini-pilot: does an aggressive prompt-only setup/payoff floor on pre-planner-phase2-v1a recover enough of main V1a lift?)"

const CONFIG = {
  kind: "charter",
  experiment_family: FAMILY,
  charter_slug: CHARTER_SLUG,
  charter_path: `docs/charters/${CHARTER_SLUG}.md`,
  arms: ["baseline", "prompt", "mainv1a"],
  primary_metric: {
    name: "retry_ratio",
    formula: "COUNT(*) FILTER (WHERE attempt > 1) / COUNT(*) over beat-writer llm_calls per (arm, seed, chapter)",
    delta_sign: "Δ = baseline_retry_ratio − prompt_retry_ratio; positive Δ = prompt arm reduced retries (charter §7.a)",
    aggregation: "mean of paired cell deltas across 15 (3 seeds x 5 chapters) cells, unweighted",
  },
  decision_thresholds: {
    ship: { delta_min: 0.03, min_wins: 11, total_cells: 15 },
    justify: { delta_abs_max: 0.02 },
    kill: { delta_abs_max: 0.015, baseline_mean_max: 0.20 },
    otherwise: "iterate / inconclusive",
  },
  supersedes: "planner-phase2-contract-v1",
}

async function main() {
  const update = process.argv.includes("--update")

  const existing = (await db`
    SELECT id, description, status
    FROM tuning_experiments
    WHERE config->>'experiment_family' = ${FAMILY}
      AND config->>'kind' = 'charter'
    ORDER BY id
    LIMIT 1
  `) as any[]

  if (existing.length && !update) {
    const row = existing[0]
    console.log(`Charter experiment already backfilled: #${row.id} (${row.status ?? "no status"})`)
    console.log(`  description: ${row.description}`)
    console.log(`  pass --update to overwrite the row's description and config from this script`)
    return
  }

  if (existing.length && update) {
    const row = existing[0]
    await db`
      UPDATE tuning_experiments
      SET description = ${DESCRIPTION}, config = ${CONFIG}
      WHERE id = ${row.id}
    `
    console.log(`Updated charter experiment #${row.id} for family '${FAMILY}'.`)
    return
  }

  const id = await createTuningExperiment(
    "charter",
    DESCRIPTION,
    CONFIG,
    { target: FAMILY, dimension: "planning" },
  )

  console.log(`Backfilled charter experiment #${id} for family '${FAMILY}'.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
