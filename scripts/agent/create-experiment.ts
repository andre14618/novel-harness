/**
 * Create a tuning experiment and print its ID.
 *
 * Usage:
 *   bun scripts/agent/create-experiment.ts --desc "prose/telling: improve from -5.2" --target prose --dimension telling
 */

import { parseArgs } from "node:util"
import { createTuningExperiment } from "../../src/db/ops"

const { values } = parseArgs({
  options: {
    desc: { type: "string" },
    target: { type: "string" },
    dimension: { type: "string" },
  },
})

if (!values.desc || !values.target || !values.dimension) {
  console.error("Usage: bun scripts/agent/create-experiment.ts --desc <description> --target <target> --dimension <dimension>")
  process.exit(1)
}

const id = await createTuningExperiment(
  "improvement-agent",
  values.desc,
  { target: values.target, dimension: values.dimension, mode: "agent" },
  { target: values.target, dimension: values.dimension },
)

console.log(`Experiment created: ${id}`)
process.exit(0)
