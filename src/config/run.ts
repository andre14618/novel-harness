/**
 * Unified run configuration.
 *
 * Single source of truth for all scope parameters across the entire harness:
 * novel runs, benchmarks, sweeps, scripts. Every entry point imports this
 * instead of parsing its own args/env.
 *
 * Resolution order: CLI args > env vars > defaults
 *
 * CLI args:
 *   --seed <name>         Seed name (default: "romance-drama")
 *   --seeds <csv>         Multiple seeds (comma-separated)
 *   --chapters <n>        Override chapter count from seed
 *   --runs <n>            Runs per seed/model (default: 2)
 *   --experiment <id>     Link to existing experiment
 *   --source-run <id>     Source run for re-analysis scripts
 *   --auto                Auto-approve all gates
 *   --resume <novelId>    Resume existing novel
 *   --batch               Use batch API for judging
 *
 * Env var fallbacks (for CI/remote execution):
 *   BENCHMARK_SEEDS  → --seeds
 *   BENCHMARK_RUNS   → --runs
 *   EXPERIMENT_ID    → --experiment
 *   SOURCE_RUN       → --source-run
 */

function arg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag)
  if (idx === -1 || !process.argv[idx + 1]) return undefined
  return process.argv[idx + 1]
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

export interface RunConfig {
  /** Single seed name (for novel runs). First seed if multiple. */
  seed: string
  /** All seeds (for benchmarks). */
  seeds: string[]
  /** Chapter count override. Null = use seed default. */
  chapters: number | null
  /** Runs per seed/model. */
  runs: number
  /** Experiment ID to link to. */
  experimentId: number | null
  /** Source run ID for re-analysis. */
  sourceRun: number | null
  /** Auto-approve gates. */
  auto: boolean
  /** Resume novel ID. */
  resumeId: string | null
  /** Use batch API. */
  batch: boolean
}

let _config: RunConfig | null = null

export function getRunConfig(): RunConfig {
  if (_config) return _config

  const seedArg = arg("--seed")
  const seedsArg = arg("--seeds") ?? process.env.BENCHMARK_SEEDS
  const seedList = seedsArg
    ? seedsArg.split(",").map(s => s.trim()).filter(Boolean)
    : seedArg ? [seedArg] : []

  const chaptersArg = arg("--chapters")
  const runsArg = arg("--runs") ?? process.env.BENCHMARK_RUNS
  const experimentArg = arg("--experiment") ?? process.env.EXPERIMENT_ID
  const sourceRunArg = arg("--source-run") ?? process.env.SOURCE_RUN

  _config = {
    seed: seedList[0] ?? seedArg ?? "romance-drama",
    seeds: seedList,
    chapters: chaptersArg ? parseInt(chaptersArg) : null,
    runs: runsArg ? parseInt(runsArg) : 2,
    experimentId: experimentArg ? parseInt(experimentArg) : null,
    sourceRun: sourceRunArg ? parseInt(sourceRunArg) : null,
    auto: hasFlag("--auto"),
    resumeId: arg("--resume") ?? null,
    batch: hasFlag("--batch"),
  }

  return _config
}

/** Reset config (for testing). */
export function resetRunConfig(): void {
  _config = null
}

/** Print config summary for logging. */
export function logRunConfig(config: RunConfig): void {
  const parts: string[] = []
  if (config.seeds.length > 0) parts.push(`Seeds: ${config.seeds.join(", ")}`)
  else parts.push(`Seed: ${config.seed}`)
  if (config.chapters) parts.push(`Chapters: ${config.chapters}`)
  parts.push(`Runs: ${config.runs}`)
  if (config.experimentId) parts.push(`Experiment: #${config.experimentId}`)
  if (config.sourceRun) parts.push(`Source run: ${config.sourceRun}`)
  if (config.auto) parts.push("Auto mode")
  if (config.batch) parts.push("Batch mode")
  if (config.resumeId) parts.push(`Resume: ${config.resumeId}`)
  console.log(`  Config: ${parts.join(" | ")}`)
}
