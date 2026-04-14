/**
 * Conclude a tuning experiment with a summary.
 *
 * Usage:
 *   bun scripts/agent/conclude-experiment.ts --id 42 --conclusion "Improved telling from -5.2 to -3.8 over 4 iterations..."
 */

import { parseArgs } from "node:util"
import { concludeExperiment } from "../../src/db/ops"

const { values } = parseArgs({
  options: {
    id: { type: "string" },
    conclusion: { type: "string" },
  },
})

if (!values.id || !values.conclusion) {
  console.error("Usage: bun scripts/agent/conclude-experiment.ts --id <experiment_id> --conclusion <text>")
  process.exit(1)
}

await concludeExperiment(parseInt(values.id), values.conclusion)
console.log(`Experiment #${values.id} concluded.`)
process.exit(0)
