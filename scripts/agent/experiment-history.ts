/**
 * Show prior experiment conclusions and improvement iterations for a target/dimension.
 *
 * Usage:
 *   bun scripts/agent/experiment-history.ts --target prose --dimension telling
 *   bun scripts/agent/experiment-history.ts --target prose --dimension telling --limit 5
 */

import { parseArgs } from "node:util"
import { getRelatedExperiments } from "../../data/db"
import db from "../../data/connection"

const { values } = parseArgs({
  options: {
    target: { type: "string" },
    dimension: { type: "string" },
    limit: { type: "string" },
  },
})

if (!values.target || !values.dimension) {
  console.error("Usage: bun scripts/agent/experiment-history.ts --target <target> --dimension <dimension>")
  process.exit(1)
}

const limit = parseInt(values.limit ?? "10")
const experiments = await getRelatedExperiments(values.target, values.dimension, limit)

if (experiments.length === 0) {
  console.log(`No prior experiments for ${values.target}/${values.dimension}`)
  process.exit(0)
}

console.log(`Prior experiments for ${values.target}/${values.dimension}:\n`)

for (const exp of experiments) {
  console.log(`--- Experiment #${exp.id} (${new Date(exp.timestamp).toISOString().slice(0, 10)}) ---`)
  console.log(`Description: ${exp.description}`)
  if (exp.conclusion) {
    console.log(`Conclusion: ${exp.conclusion}`)
  } else {
    console.log(`Conclusion: (none)`)
  }

  // Show iterations if this was an improvement cycle
  const iterations = await db`
    SELECT iteration_num, result, delta, proposal_explanation, agent_name
    FROM improvement_iterations
    WHERE cycle_id IN (SELECT id FROM improvement_cycles WHERE experiment_id = ${exp.id})
    ORDER BY iteration_num
  `

  if (iterations.length > 0) {
    console.log(`  Iterations:`)
    for (const iter of iterations as any[]) {
      const delta = iter.delta !== null ? `${parseFloat(iter.delta) >= 0 ? "+" : ""}${parseFloat(iter.delta).toFixed(1)}` : "—"
      console.log(`    #${iter.iteration_num}: ${(iter.result ?? "?").padEnd(8)} ${delta.padStart(6)}  ${(iter.proposal_explanation ?? "").slice(0, 70)}`)
    }
  }
  console.log()
}

process.exit(0)
