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

  /** Scoring mode — "score" (1-10, higher=better) or "penalty" (count, lower=better) */
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
   * Default for "penalty" mode: parsed.issues?.length ?? parsed.count
   */
  scoreExtractor?(parsed: any, dimension: D): number

  /** Max score per dimension for the overall line (default: 10) */
  maxPerDimension?: number
}

// ── Engine ──────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
}

function detectProvider(apiUrl: string): string {
  if (apiUrl.includes("openai.com")) return "openai"
  if (apiUrl.includes("groq.com")) return "groq"
  if (apiUrl.includes("deepseek.com")) return "deepseek"
  if (apiUrl.includes("cerebras.ai")) return "cerebras"
  return "openrouter"
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

  const runId = createRun(
    config.name,
    inputs.length.toString(),
    `${writer.label} / ${judges.map(j => j.label).join(",")}`,
    experimentId,
  )

  const defaultScoreExtractor = config.scoring === "penalty"
    ? (parsed: any) => parsed.issues?.length ?? parsed.count ?? 0
    : (parsed: any) => parsed.score
  const extractScore = config.scoreExtractor ?? defaultScoreExtractor

  await Promise.all(
    inputs.map(async (input) => {
      for (let run = 1; run <= runsPerInput; run++) {
        console.log(`[${input.name}] Run ${run}/${runsPerInput}...`)

        const result = await config.generate(writer, input, runId, run)
        if (!result) {
          saveGeneration(runId, input.name, run, { passed: false })
          continue
        }

        const genId = saveGeneration(runId, input.name, run, {
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
              saveScore(genId, judge.label, dim, score.score, score.reasoning)
              console.log(`  [${input.name}:${run}] ${judge.label}/${config.dimensionLabels[dim]}: ${score.score}${config.scoring === "score" ? "/10" : " issues"}`)
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

  const dimAvgs = getRunAverages(runId)
  const overall = getOverallAvg(runId)

  console.log(`\n  Per-dimension averages:`)
  for (const dim of config.dimensions) {
    const avg = dimAvgs.find(d => d.dimension === dim)
    if (avg) {
      const suffix = config.scoring === "score" ? `/${maxPerDim}` : " issues"
      console.log(`    ${config.dimensionLabels[dim].padEnd(22)} ${avg.avg}${suffix} (+-${avg.stddev})`)
    }
  }
  console.log(`    ${"OVERALL".padEnd(22)} ${overall.mean}/${totalMax} (+-${overall.stddev})`)

  const callSummary = getCallSummary(runId)
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
    markBaseline(runId, config.name)
    console.log(`\n  Run ${runId} saved as baseline.`)
  }

  console.log(`\n  Run ID: ${runId}`)
  console.log(`  DB: data/harness.db`)
}

// ── Judge call (shared) ─────────────────────────────────────────────────

async function judgeOneDimension(
  judge: JudgeConfig,
  dimension: string,
  rubric: string,
  userContent: string,
  schema: z.ZodSchema,
  extractScore: (parsed: any, dim: string) => number,
  runId: number,
  seed: string,
): Promise<{ score: number; reasoning: string } | null> {
  const start = performance.now()

  try {
    const tokenParam = judge.useMaxCompletionTokens
      ? { max_completion_tokens: 4096 }
      : { max_tokens: 4096 }

    let res: Response | null = null
    for (let attempt = 0; attempt <= 2; attempt++) {
      res = await fetch(judge.apiUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${judge.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: judge.model,
          messages: [
            { role: "system", content: rubric },
            { role: "user", content: userContent },
          ],
          temperature: 0.1,
          ...tokenParam,
          response_format: { type: "json_object" },
          ...judge.extraBody,
        }),
      })
      if (res!.status === 429 || res!.status === 503) {
        if (attempt < 2) { await Bun.sleep(3000 * (attempt + 1)); continue }
      }
      break
    }

    if (!res!.ok) { console.log(`  ! ${judge.label}/${dimension} [http ${res!.status}]`); return null }
    const data = await res!.json() as any
    if (data.error) { console.log(`  ! ${judge.label}/${dimension} [api error]`); return null }

    const content = data.choices?.[0]?.message?.content
    if (!content) return null

    const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 }
    const elapsed = performance.now() - start
    const judgeProvider = detectProvider(judge.apiUrl)
    const cost = getTokenCost(judgeProvider as any, judge.model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0)
    saveLLMCall(runId, "judge", null, judge.model, judgeProvider, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, Math.round(elapsed), cost, { seed, dimension })

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
