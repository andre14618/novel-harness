/**
 * Shared benchmark engine.
 *
 * Eliminates boilerplate across benchmark suites. Each benchmark defines a
 * BenchmarkConfig with its unique generator and optional overrides, then
 * calls runBenchmark(config) to handle rubric loading, judging, scoring,
 * and reporting.
 *
 * Usage:
 *   import { runBenchmark, type BenchmarkConfig } from "../engine"
 *   runBenchmark(config)
 */

import { readFileSync } from "node:fs"
import { extractJSON } from "../src/llm"
import { getTokenCost } from "../src/config/pricing"
import { getTransport } from "../src/transport"
import { getWriter, getJudges, type WriterConfig, type JudgeConfig } from "./config"
import {
  getDB, createRun, saveGeneration, saveScore, saveLLMCall, getCallSummary,
  markBaseline, getRunAverages, getOverallAvg,
} from "./db"
import type { z } from "zod"

// ── Types ───────────────────────────────────────────────────────────────

export interface GenerationResult {
  output: string
  wordCount: number
  latencyMs: number
  tps?: number
  tokens?: number
  promptTokens?: number
}

export interface BenchmarkInput {
  name: string
  [key: string]: any
}

export interface BenchmarkConfig<D extends string = string> {
  /** Benchmark name used in DB ("prose", "planning", etc.) */
  name: string

  /** Display name for report header */
  displayName: string

  /** Dimensions array — drives rubric loading + judge loop */
  dimensions: readonly D[]

  /** Human labels for dimensions */
  dimensionLabels: Record<D, string>

  /** Path to judges/ dir containing {dimension}.md rubric files */
  judgesDir: string

  /** Zod schema to validate judge output */
  judgeSchema: z.ZodSchema

  /** Scoring mode — "score" (1-10) or "penalty" (negated issue count). Both are higher=better in DB. */
  scoring: "score" | "penalty"

  /** Load seeds/fixtures. Receives optional filter from BENCHMARK_SEEDS env. */
  loadInputs(filter?: string[]): BenchmarkInput[]

  /**
   * Generate output for one input. Returns result or null on failure.
   * The engine handles DB creation of the generation record.
   */
  generate(
    writer: WriterConfig, input: BenchmarkInput, runId: number, attempt: number,
  ): Promise<GenerationResult | null>

  /**
   * Build the user prompt sent to the judge.
   * Default: just the generated output string.
   * Override for benchmarks that need to include original prose, fixtures, etc.
   */
  buildJudgePrompt?(input: BenchmarkInput, generatedOutput: string): string

  /**
   * Extract the numeric score from a parsed judge response.
   * Default for "score" mode: parsed.score
   * Default for "penalty" mode: -(parsed.issues?.length ?? parsed.count)
   */
  scoreExtractor?(parsed: any, dimension: D): number

  /** Max score per dimension for the overall line (default: 10) */
  maxPerDimension?: number

  // ── Daemon metadata (used by improvement loop + registry) ───────────

  /** Agent prompts the daemon can modify to improve this benchmark. */
  promptTargets?: Array<{ path: string; agentName: string }>

  /** Shell command to run this benchmark. */
  runCmd?: string

  /** Default env overrides for daemon runs (reduced seeds/runs for speed). */
  daemonEnv?: Record<string, string>

  /**
   * For atomic operations — build the user prompt + transport params for a
   * single agent call. Returns null if this benchmark doesn't support atomic
   * generation (e.g. prose, which has its own runner).
   */
  buildAgentInput?(input: BenchmarkInput, agentName?: string): {
    userPrompt: string
    temperature: number
    maxTokens: number
    responseFormat?: { type: "json_object" }
  } | null
}

// ── Engine ──────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
}

export async function runBenchmark<D extends string>(config: BenchmarkConfig<D>): Promise<void> {
  getDB()

  const writer = getWriter()
  const judges = getJudges()
  const seedFilter = process.env.BENCHMARK_SEEDS?.split(",").map(s => s.trim())
  const inputs = config.loadInputs(seedFilter)
  const runsPerInput = parseInt(process.env.BENCHMARK_RUNS ?? "3")
  const experimentId = process.env.EXPERIMENT_ID ? parseInt(process.env.EXPERIMENT_ID) : undefined

  if (!experimentId) console.log(`  (tip: set EXPERIMENT_ID to link this run to an experiment)`)
  if (judges.length === 0) { console.error("No judge API keys found"); process.exit(1) }
  if (inputs.length === 0) { console.error("No inputs found (check seed filter)"); process.exit(1) }

  // ── Header ──────────────────────────────────────────────────────────

  console.log(`\n${config.displayName}: ${writer.label}`)
  console.log(`Inputs: ${inputs.map(s => s.name).join(", ")}`)
  console.log(`Runs per input: ${runsPerInput}`)
  console.log(`Judges: ${judges.map(j => j.label).join(", ")}`)
  console.log(`Dimensions: ${config.dimensions.map(d => config.dimensionLabels[d]).join(", ")}`)
  console.log()

  // ── Load rubrics ────────────────────────────────────────────────────

  const rubrics: Record<string, string> = {}
  for (const dim of config.dimensions) {
    const path = `${config.judgesDir}/${dim}.md`
    rubrics[dim] = readFileSync(path, "utf-8")
  }

  // ── Run ─────────────────────────────────────────────────────────────

  const runId = await createRun(
    config.name,
    inputs.length.toString(),
    `${writer.label} / ${judges.map(j => j.label).join(",")}`,
    experimentId,
  )

  // Penalty scores are negated so higher=better universally
  const defaultScoreExtractor = config.scoring === "penalty"
    ? (parsed: any) => -(parsed.issues?.length ?? parsed.count ?? 0)
    : (parsed: any) => parsed.score
  const extractScore = config.scoreExtractor ?? defaultScoreExtractor

  await Promise.all(
    inputs.map(async (input) => {
      for (let run = 1; run <= runsPerInput; run++) {
        console.log(`[${input.name}] Run ${run}/${runsPerInput}...`)

        const result = await config.generate(writer, input, runId, run)
        if (!result) {
          await saveGeneration(runId, input.name, run, { passed: false })
          continue
        }

        const genId = await saveGeneration(runId, input.name, run, {
          prose: result.output,
          wordCount: result.wordCount,
          latencyMs: result.latencyMs,
          tokensPerSec: result.tps,
          completionTokens: result.tokens,
          passed: true,
        })

        const tpsStr = result.tps ? `${result.tps}tok/s` : ""
        console.log(`[${input.name}] Run ${run}: ${tpsStr} ${(result.latencyMs / 1000).toFixed(1)}s`)

        // Judge all dimensions concurrently
        const judgeJobs = judges.flatMap(judge =>
          config.dimensions.map(async (dim) => {
            const score = await judgeOneDimension(
              judge, dim, rubrics[dim],
              config.buildJudgePrompt
                ? config.buildJudgePrompt(input, result.output)
                : result.output,
              config.judgeSchema, extractScore,
              runId, input.name,
            )
            if (score) {
              await saveScore(genId, judge.label, dim, score.score, score.reasoning)
              const displayScore = config.scoring === "penalty" ? Math.abs(score.score) : score.score
              const suffix = config.scoring === "score" ? "/10" : " issues"
              console.log(`  [${input.name}:${run}] ${judge.label}/${config.dimensionLabels[dim]}: ${displayScore}${suffix}`)
            }
          })
        )
        await Promise.all(judgeJobs)
      }
    })
  )

  // ── Report ──────────────────────────────────────────────────────────

  const maxPerDim = config.maxPerDimension ?? 10
  const totalMax = maxPerDim * config.dimensions.length

  console.log("\n" + "=".repeat(60))
  console.log(`  ${config.displayName.toUpperCase()} RESULTS`)
  console.log("=".repeat(60))

  const dimAvgs = await getRunAverages(runId)
  const overall = await getOverallAvg(runId)

  console.log(`\n  Per-dimension averages:`)
  for (const dim of config.dimensions) {
    const avg = dimAvgs.find(d => d.dimension === dim)
    if (avg) {
      const displayAvg = config.scoring === "penalty" ? Math.abs(parseFloat(avg.avg)) : parseFloat(avg.avg)
      const suffix = config.scoring === "score" ? `/${maxPerDim}` : " issues"
      console.log(`    ${config.dimensionLabels[dim].padEnd(22)} ${displayAvg}${suffix} (+-${avg.stddev})`)
    }
  }
  const displayOverall = config.scoring === "penalty" ? Math.abs(parseFloat(overall.mean)) : parseFloat(overall.mean)
  console.log(`    ${"OVERALL".padEnd(22)} ${displayOverall}/${totalMax} (+-${overall.stddev})`)

  const callSummary = await getCallSummary(runId)
  if (callSummary.length > 0) {
    console.log(`\n  Cost & TPS:`)
    let totalCost = 0
    for (const c of callSummary) {
      totalCost += c.totalCost
      const tps = c.avgTps ? `${c.avgTps} tok/s` : "—"
      console.log(`    ${c.agent.padEnd(8)} ${c.model.padEnd(35)} ${`${c.calls}`.padStart(4)} calls  $${c.totalCost.toFixed(4).padStart(8)}  ${tps}`)
    }
    console.log(`    ${"TOTAL".padEnd(44)} $${totalCost.toFixed(4).padStart(8)}`)
  }

  if (process.argv.includes("--save-baseline")) {
    await markBaseline(runId, config.name)
    console.log(`\n  Run ${runId} saved as baseline.`)
  }

  console.log(`\n  Run ID: ${runId}`)
  console.log(`  DB: Postgres`)
}

// ── Judge call (shared) ─────────────────────────────────────────────────

export async function judgeOneDimension(
  judge: JudgeConfig,
  dimension: string,
  rubric: string,
  userContent: string,
  schema: z.ZodSchema,
  extractScore: (parsed: any, dim: string) => number,
  runId: number,
  seed: string,
): Promise<{ score: number; reasoning: string } | null> {
  try {
    // Content as system prompt (shared across dimensions → cacheable prefix),
    // rubric as user prompt (varies per dimension)
    const response = await getTransport().execute({
      systemPrompt: userContent,
      userPrompt: rubric,
      model: judge.model,
      provider: judge.provider,
      temperature: 0.1,
      maxTokens: 4096,
      useMaxCompletionTokens: judge.useMaxCompletionTokens,
      responseFormat: { type: "json_object" },
      extraBody: judge.extraBody,
      callerId: "judge",
    })

    const content = response.content
    if (!content) return null

    const promptTokens = response.usage.prompt_tokens ?? 0
    const completionTokens = response.usage.completion_tokens ?? 0
    const cost = getTokenCost(judge.provider, judge.model, promptTokens, completionTokens)
    await saveLLMCall(runId, "judge", null, judge.model, judge.provider, promptTokens, completionTokens, Math.round(response.latencyMs), cost, { seed, dimension })

    // Log cache hits when provider reports them
    const cacheHitTokens = response.usage.prompt_cache_hit_tokens ?? response.usage.cache_read_input_tokens ?? 0
    if (cacheHitTokens > 0) {
      console.log(`  [cache] ${judge.label}/${dimension}: ${cacheHitTokens} tokens cached (${Math.round(cacheHitTokens / (promptTokens || 1) * 100)}%)`)
    }

    const jsonStr = extractJSON(content)
    const parsed = JSON.parse(jsonStr)
    const result = schema.safeParse(parsed)
    if (!result.success) { console.log(`  ! ${judge.label}/${dimension} [zod]`); return null }

    const score = extractScore(result.data, dimension)
    const reasoning = result.data.reasoning ?? ""

    return { score, reasoning }
  } catch (err) {
    console.log(`  ! ${judge.label}/${dimension} [exception] ${err instanceof Error ? err.message : err}`)
    return null
  }
}
