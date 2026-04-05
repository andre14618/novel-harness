/**
 * Context quality benchmark runner.
 *
 * Evaluates the retrieval system's ability to assemble relevant context
 * for the writer agent. Requires a multi-chapter novel (10+) in Postgres.
 *
 * Usage:
 *   EXPERIMENT_ID=N bun benchmark/context/run.ts
 *   BENCHMARK_SEEDS=novel-123 bun benchmark/context/run.ts  # filter to specific novel
 */

import { config, loadContextInputs } from "./generate"
import { runBenchmark } from "../engine"

async function main() {
  const seedFilter = process.env.BENCHMARK_SEEDS?.split(",").map(s => s.trim())
  const inputs = await loadContextInputs(seedFilter)

  if (inputs.length === 0) {
    console.error("No context benchmark inputs found.")
    console.error("Requires a novel with 10+ chapters in Postgres.")
    console.error("Tip: set BENCHMARK_SEEDS=novel-id to target a specific novel.")
    process.exit(1)
  }

  console.log(`Loaded ${inputs.length} context test points from ${new Set(inputs.map(i => i.novelId)).size} novel(s)`)

  // Patch loadInputs to return pre-loaded async inputs
  const patchedConfig = {
    ...config,
    loadInputs: () => inputs,
  }

  await runBenchmark(patchedConfig)
}

main()
