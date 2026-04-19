/**
 * Backfill a tuning_experiments row for the planner-phase2-payoff-floor charter.
 *
 * The charter was drafted and a mini-pilot launched before an experiment row
 * existed. This script is idempotent — if a row already exists with
 * config->>experiment_family = 'planner-phase2-payoff-floor' and
 * config->>kind = 'charter', it no-ops.
 *
 * Usage:
 *   bun scripts/experiments/backfill-planner-phase2-charter.ts
 */

import db from "../../src/db/connection"
import { createTuningExperiment } from "../../src/db/ops"

const FAMILY = "planner-phase2-payoff-floor"
const CHARTER_SLUG = "planner-phase2-payoff-floor"

async function main() {
  const existing = (await db`
    SELECT id, description, status
    FROM tuning_experiments
    WHERE config->>'experiment_family' = ${FAMILY}
      AND config->>'kind' = 'charter'
    ORDER BY id
    LIMIT 1
  `) as any[]

  if (existing.length) {
    const row = existing[0]
    console.log(`Charter experiment already backfilled: #${row.id} (${row.status ?? "no status"})`)
    console.log(`  description: ${row.description}`)
    return
  }

  const id = await createTuningExperiment(
    "charter",
    "Charter — planner-phase2-payoff-floor (mini-pilot: does an aggressive prompt-only setup/payoff floor on pre-planner-phase2-v1a recover enough of main V1a lift?)",
    {
      kind: "charter",
      experiment_family: FAMILY,
      charter_slug: CHARTER_SLUG,
      charter_path: `docs/charters/${CHARTER_SLUG}.md`,
      arms: ["baseline", "prompt", "mainv1a"],
      primary_metric: "retry_ratio",
      decision_thresholds: { ship: 0.03, justify: 0.02, kill: 0.015 },
      supersedes: "planner-phase2-contract-v1",
    },
    { target: FAMILY, dimension: "planning" },
  )

  console.log(`Backfilled charter experiment #${id} for family '${FAMILY}'.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
