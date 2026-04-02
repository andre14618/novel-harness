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
import { config as continuityConfig } from "./continuity/generate"
import { config as proseConfig } from "./prose/generate"
import type { BenchmarkConfig } from "./engine"

export const BENCHMARKS: Record<string, BenchmarkConfig> = {
  planning: planningConfig,
  extraction: extractionConfig,
  continuity: continuityConfig,
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
