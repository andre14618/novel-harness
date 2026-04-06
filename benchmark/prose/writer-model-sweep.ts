/**
 * Writer model comparison.
 *
 * Generates prose with multiple writer models on the same seeds,
 * judges all with the same judge, lints all. Direct quality comparison.
 *
 * Usage:
 *   BENCHMARK_SEEDS=romance-drama,dark-fantasy BENCHMARK_RUNS=2 bun benchmark/prose/writer-model-sweep.ts
 */

import { getJudges } from "../config"
import { DIMENSIONS, DIMENSION_LABELS, type Dimension } from "./judges/schema"
import { createRun, saveGeneration, saveScore, saveLLMCall } from "../db"
import { createTuningExperiment, concludeExperiment } from "../../data/db"
import { loadSeeds, generateProse, judgeDimension, mean, stddev } from "./shared"
import { lintProse, saveLintIssues } from "../../src/lint"
import { WRITER_AGENT_PROMPT } from "../../src/prompts"
import type { WriterConfig } from "../config"
import { PROVIDERS, type ProviderName } from "../../models/registry"

interface ModelVariant {
  label: string
  provider: ProviderName
  model: string
  temperature: number
  maxTokens: number
  needsNothink?: boolean
}

const WRITER_MODELS: ModelVariant[] = [
  { label: "Qwen3 235B (Cerebras)", provider: "cerebras", model: "qwen-3-235b-a22b-instruct-2507", temperature: 0.8, maxTokens: 8192 },
  { label: "DeepSeek V3.2", provider: "deepseek", model: "deepseek-chat", temperature: 0.8, maxTokens: 8192 },
  { label: "MiMo V2 Flash", provider: "mimo", model: "mimo-v2-flash", temperature: 0.8, maxTokens: 8192 },
]

const RUNS = parseInt(process.env.BENCHMARK_RUNS ?? "2")

function toWriterConfig(v: ModelVariant): WriterConfig {
  const providerDef = PROVIDERS[v.provider]
  return {
    label: v.label,
    provider: v.provider,
    model: v.model,
    maxTokens: v.maxTokens,
    needsNothink: v.needsNothink,
    extraBody: providerDef.extraBody?.(),
    apiUrl: providerDef.apiUrl,
    apiKey: process.env[providerDef.envKey] ?? "",
  }
}

async function main() {
  const judges = getJudges()
  const judge = judges[0]
  const seedFilter = process.env.BENCHMARK_SEEDS?.split(",").map(s => s.trim())
  const seeds = loadSeeds(seedFilter)

  const experimentId = await createTuningExperiment(
    "writer",
    "writer-model-sweep",
    `Writer model comparison: ${WRITER_MODELS.map(m => m.label).join(", ")}. Seeds: ${seeds.map(s => s.name).join(", ")}. Runs: ${RUNS}. Judge: ${judge.label}.`,
  )

  console.log(`\nWriter Model Comparison`)
  console.log(`Models: ${WRITER_MODELS.map(m => m.label).join(", ")}`)
  console.log(`Judge: ${judge.label}`)
  console.log(`Seeds: ${seeds.map(s => s.name).join(", ")}`)
  console.log(`Runs per seed: ${RUNS}`)
  console.log(`Experiment: #${experimentId}\n`)

  const modelRuns: Record<string, number> = {}
  for (const v of WRITER_MODELS) {
    modelRuns[v.label] = await createRun("prose", seeds.length.toString(), `writer-sweep-${v.label}`, experimentId)
  }

  // Score accumulators
  const penaltyScores: Record<string, Array<{ seed: string; dim: Dimension; count: number; wordCount: number }>> = {}
  const modelStats: Record<string, { words: number[]; lint: number[]; cost: number[]; latency: number[]; tps: number[] }> = {}

  for (const v of WRITER_MODELS) {
    penaltyScores[v.label] = []
    modelStats[v.label] = { words: [], lint: [], cost: [], latency: [], tps: [] }
  }

  for (const seed of seeds) {
    for (let run = 1; run <= RUNS; run++) {
      console.log(`[${seed.name}] Run ${run}/${RUNS}`)

      for (const variant of WRITER_MODELS) {
        const writerConfig = toWriterConfig(variant)
        const result = await generateProse(writerConfig, WRITER_AGENT_PROMPT, seed.prompt, modelRuns[variant.label], seed.name, run, variant.temperature)
        if (!result) { console.log(`  [${variant.label}] FAILED`); continue }

        const wordCount = result.prose.split(/\s+/).length
        const genId = await saveGeneration(modelRuns[variant.label], seed.name, run, {
          prose: result.prose, wordCount, passed: true,
          variantLabel: variant.label, latencyMs: result.latencyMs,
          completionTokens: result.tokens, tokensPerSec: result.tps,
        })

        // Lint
        const lintResult = await lintProse(result.prose)
        await saveLintIssues(genId, lintResult.issues)
        modelStats[variant.label].lint.push(lintResult.totalIssues)
        modelStats[variant.label].words.push(wordCount)
        modelStats[variant.label].latency.push(result.latencyMs)
        modelStats[variant.label].tps.push(result.tps)

        // Cost
        const { getTokenCost } = await import("../../models/registry")
        const cost = getTokenCost(variant.provider, variant.model, result.promptTokens, result.tokens)
        modelStats[variant.label].cost.push(cost)

        // Judge — all dimensions concurrent
        const judgeJobs = DIMENSIONS.map(async (dim) => {
          const penalty = await judgeDimension(judge, dim, result.prose, modelRuns[variant.label], seed.name)
          if (penalty) {
            await saveScore(genId, judge.label, dim, penalty.count, JSON.stringify(penalty.issues))
            penaltyScores[variant.label].push({ seed: seed.name, dim, count: penalty.count, wordCount })
          }
        })
        await Promise.all(judgeJobs)

        const dimSummary = DIMENSIONS.map(dim => {
          const s = penaltyScores[variant.label].filter(x => x.seed === seed.name && x.dim === dim).slice(-1)[0]
          return s ? `${DIMENSION_LABELS[dim]}:${Math.abs(s.count)}` : ""
        }).filter(Boolean).join(" ")

        console.log(`  [${variant.label}] ${wordCount}w | ${result.tps}tok/s | ${result.latencyMs}ms | $${cost.toFixed(4)} | lint:${lintResult.totalIssues} | ${dimSummary}`)
      }
      console.log()
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────

  console.log("=".repeat(90))
  console.log("  WRITER MODEL COMPARISON")
  console.log("=".repeat(90))

  const modelLabels = WRITER_MODELS.map(m => m.label)

  // Penalty table
  console.log(`\n  Dimensions (avg issues per chapter, lower = better):`)
  console.log(`  ${"Dimension".padEnd(16)} ${modelLabels.map(l => l.padStart(24)).join("  ")}`)
  console.log("  " + "-".repeat(16 + modelLabels.length * 26))

  for (const dim of DIMENSIONS) {
    const cells = [DIMENSION_LABELS[dim].padEnd(16)]
    for (const label of modelLabels) {
      const scores = penaltyScores[label].filter(s => s.dim === dim)
      if (scores.length === 0) { cells.push("n/a".padStart(24)); continue }
      const avg = mean(scores.map(s => Math.abs(s.count)))
      const std = stddev(scores.map(s => Math.abs(s.count)))
      cells.push(`${avg.toFixed(1)} (+-${std.toFixed(1)})`.padStart(24))
    }
    console.log("  " + cells.join("  "))
  }

  // Stats table
  console.log(`\n  Other metrics:`)
  console.log(`  ${"Metric".padEnd(18)} ${modelLabels.map(l => l.padStart(24)).join("  ")}`)
  console.log("  " + "-".repeat(18 + modelLabels.length * 26))

  const metricRows = [
    { label: "Avg words", fn: (l: string) => mean(modelStats[l].words).toFixed(0) + "w" },
    { label: "Avg lint issues", fn: (l: string) => mean(modelStats[l].lint).toFixed(1) },
    { label: "Avg cost/chapter", fn: (l: string) => "$" + mean(modelStats[l].cost).toFixed(4) },
    { label: "Avg latency", fn: (l: string) => (mean(modelStats[l].latency) / 1000).toFixed(1) + "s" },
    { label: "Avg tok/s", fn: (l: string) => mean(modelStats[l].tps).toFixed(0) },
  ]

  for (const row of metricRows) {
    const cells = [row.label.padEnd(18)]
    for (const label of modelLabels) {
      cells.push(row.fn(label).padStart(24))
    }
    console.log("  " + cells.join("  "))
  }

  // Run IDs
  console.log(`\n  Experiment: #${experimentId}`)
  for (const label of modelLabels) console.log(`  ${label} run: ${modelRuns[label]}`)

  // Conclude
  const conclusion = modelLabels.map(label => {
    const penalties = penaltyScores[label]
    const penAvg = penalties.length > 0 ? mean(penalties.map(s => Math.abs(s.count))).toFixed(1) : "n/a"
    const cost = mean(modelStats[label].cost).toFixed(4)
    const tps = mean(modelStats[label].tps).toFixed(0)
    return `${label}: pen ${penAvg}, $${cost}/ch, ${tps}tok/s`
  }).join("; ")
  await concludeExperiment(experimentId, conclusion)
}

main()
