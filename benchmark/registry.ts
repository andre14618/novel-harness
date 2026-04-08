/**
 * Benchmark registry.
 *
 * Single source of truth for all benchmark suites. Import configs from each
 * benchmark's generate.ts and expose them as a typed record.
 *
 * The improvement daemon derives its TARGETS from this registry — adding a
 * benchmark here automatically makes it available for daemon improvement.
 */

import { config as planningConfig } from "./planning/generate"
import { config as extractionConfig } from "./extraction/generate"
import { config as proseConfig } from "./prose/generate"
import { config as contextConfig } from "./context/generate"
import type { BenchmarkConfig } from "./engine"

export const BENCHMARKS: Record<string, BenchmarkConfig> = {
  context: contextConfig,
  planning: planningConfig,
  extraction: extractionConfig,
  prose: proseConfig,
}

/** Derive daemon target config from a benchmark's metadata. */
export function getDaemonTarget(name: string): {
  promptFiles: Array<{ path: string; agentName: string }>
  benchmarkCmd: string
  runType: string
} | undefined {
  const bench = BENCHMARKS[name]
  if (!bench?.promptTargets || !bench?.runCmd) return undefined

  const envPrefix = bench.daemonEnv
    ? Object.entries(bench.daemonEnv).map(([k, v]) => `${k}=${v}`).join(" ") + " "
    : ""

  return {
    promptFiles: bench.promptTargets,
    benchmarkCmd: `${envPrefix}${bench.runCmd}`,
    runType: bench.name,
  }
}

/** All benchmark names that have daemon targets configured. */
export function getDaemonTargetNames(): string[] {
  return Object.keys(BENCHMARKS).filter(n => getDaemonTarget(n) !== undefined)
}

/** Extended daemon target with seeds, dimensions, and atomic support. */
export function getDaemonTargetFull(name: string): {
  promptFiles: Array<{ path: string; agentName: string }>
  benchmarkCmd: string
  runType: string
  dimensions: readonly string[]
  dimensionLabels: Record<string, string>
  scoring: "score" | "penalty"
  supportsAtomic: boolean
  loadInputs: (filter?: string[]) => import("./engine").BenchmarkInput[]
  buildAgentInput?: (input: import("./engine").BenchmarkInput, agentName?: string) => {
    userPrompt: string; temperature: number; maxTokens: number;
    responseFormat?: { type: "json_object" }
  } | null
  buildJudgePrompt?: (input: import("./engine").BenchmarkInput, output: string) => string
  judgesDir: string
  judgeSchema: import("zod").ZodSchema
  scoreExtractor?: (parsed: any, dim: string) => number
} | undefined {
  const bench = BENCHMARKS[name]
  if (!bench?.promptTargets || !bench?.runCmd) return undefined

  const envPrefix = bench.daemonEnv
    ? Object.entries(bench.daemonEnv).map(([k, v]) => `${k}=${v}`).join(" ") + " "
    : ""

  return {
    promptFiles: bench.promptTargets,
    benchmarkCmd: `${envPrefix}${bench.runCmd}`,
    runType: bench.name,
    dimensions: bench.dimensions,
    dimensionLabels: bench.dimensionLabels,
    scoring: bench.scoring,
    supportsAtomic: !!bench.buildAgentInput,
    loadInputs: bench.loadInputs,
    buildAgentInput: bench.buildAgentInput,
    buildJudgePrompt: bench.buildJudgePrompt,
    judgesDir: bench.judgesDir,
    judgeSchema: bench.judgeSchema,
    scoreExtractor: bench.scoreExtractor,
  }
}
