/**
 * Find the weakest benchmark dimension to improve.
 *
 * Usage:
 *   bun scripts/agent/diagnose.ts                           # auto-select weakest
 *   bun scripts/agent/diagnose.ts --target prose --dimension telling  # specific
 */

import { parseArgs } from "node:util"
import { diagnose, diagnoseFor } from "../../src/orchestrator/diagnose"

const { values } = parseArgs({
  options: {
    target: { type: "string" },
    dimension: { type: "string" },
  },
})

const result = (values.target && values.dimension)
  ? await diagnoseFor(values.target, values.dimension)
  : await diagnose()

if (!result) {
  console.log("No diagnosis available. Run benchmarks first.")
  process.exit(1)
}

console.log(`Target: ${result.target}`)
console.log(`Dimension: ${result.dimension}`)
console.log(`Current score: ${result.currentScore}`)
console.log(`Baseline score: ${result.baselineScore ?? "none"}`)
console.log(`Delta from baseline: ${result.delta ?? "n/a"}`)

if (result.judgeReasoning.length > 0) {
  console.log(`\nJudge reasoning (weakest ${result.judgeReasoning.length} generations):`)
  for (const [i, reasoning] of result.judgeReasoning.entries()) {
    console.log(`\n--- Generation ${i + 1} ---`)
    console.log(reasoning)
  }
}

process.exit(0)
