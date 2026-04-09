/**
 * Prose benchmark metadata.
 *
 * The prose benchmark does NOT use the shared engine — it has its own runner
 * (run.ts) with batch mode, lint integration, and custom penalty reporting.
 * This file provides only the metadata the benchmark registry needs.
 */

import { penaltySchema, DIMENSIONS, DIMENSION_LABELS } from "./judges/schema"
import type { BenchmarkConfig } from "../engine"

export const config: BenchmarkConfig<typeof DIMENSIONS[number]> = {
  name: "prose",
  displayName: "Prose Benchmark",
  dimensions: DIMENSIONS,
  dimensionLabels: DIMENSION_LABELS,
  judgesDir: new URL("./judges", import.meta.url).pathname,
  judgeSchema: penaltySchema,
  scoring: "penalty",
  loadInputs: () => { throw new Error("Prose benchmark uses its own runner — run benchmark/prose/run.ts directly") },
  generate: () => { throw new Error("Prose benchmark uses its own runner — run benchmark/prose/run.ts directly") },
  promptTargets: [
    { path: "src/agents/writer/prose-writer-system.md", agentName: "writer" },
    { path: "src/agents/rewriter/prose-rewriter-system.md", agentName: "rewriter" },
  ],
  runCmd: "bun benchmark/prose/run.ts",
  daemonEnv: { BENCHMARK_SEEDS: "romance-drama", BENCHMARK_RUNS: "2" },
}
