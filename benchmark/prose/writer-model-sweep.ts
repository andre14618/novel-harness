/**
 * Writer model comparison.
 *
 * Generates prose with multiple writer models on the same seeds,
 * judges all with the same judge, lints all. Direct quality comparison.
 *
 * Usage:
 *   BENCHMARK_SEEDS=romance-drama BENCHMARK_RUNS=2 bun benchmark/prose/writer-model-sweep.ts
 */

import { readFileSync } from "node:fs"
import { WRITER_AGENT_PROMPT } from "../../src/prompts"
import { getJudges } from "../config"
import { DIMENSIONS, DIMENSION_LABELS, type Dimension } from "./judges/schema"
import { createRun, saveGeneration, saveScore, getCallSummary, saveLLMCall } from "../db"
import { createTuningExperiment, concludeExperiment } from "../../data/db"
import { loadSeeds, judgeDimension, mean } from "./shared"
import { getTransport } from "../../src/transport"
import { extractJSON } from "../../src/llm"
import { lintProse, saveLintIssues } from "../../src/lint"

interface ModelVariant {
  label: string
  provider: string
  model: string
  temperature: number
  maxTokens: number
}

const WRITER_MODELS: ModelVariant[] = [
  { label: "Kimi K2 (Groq)", provider: "groq", model: "moonshotai/kimi-k2-instruct-0905", temperature: 0.8, maxTokens: 16384 },
  { label: "DeepSeek V3.2", provider: "deepseek", model: "deepseek-chat", temperature: 0.8, maxTokens: 8192 },
  { label: "Qwen3 32B (Groq)", provider: "groq", model: "qwen/qwen3-32b", temperature: 0.8, maxTokens: 16384 },
]

const RUNS = parseInt(process.env.BENCHMARK_RUNS ?? "2")

interface ScoreEntry { seed: string; dim: Dimension; count: number; wordCount: number }

const WRITER_PROMPT = readFileSync(new URL("../../src/agents/writer/prompt.md", import.meta.url).pathname, "utf-8")

async function generateWithModel(
  variant: ModelVariant, seedPrompt: string, runId: number, seed: string,
): Promise<{ prose: string; wordCount: number; latencyMs: number; tokens: number; cost: number } | null> {
  const start = Date.now()
  try {
    const response = await getTransport().execute({
      systemPrompt: WRITER_PROMPT,
      userPrompt: seedPrompt,
      model: variant.model,
      provider: variant.provider as any,
      temperature: variant.temperature,
      maxTokens: variant.maxTokens,
      responseFormat: { type: "json_object" },
    })
    const latencyMs = Date.now() - start
    const json = extractJSON(response.content)
    const parsed = JSON.parse(json)
    const prose = parsed.prose
    if (!prose) return null

    const wordCount = prose.split(/\s+/).length
    const promptTokens = response.usage?.prompt_tokens ?? 0
    const completionTokens = response.usage?.completion_tokens ?? 0
    const { getTokenCost } = await import("../../models/registry")
    const cost = getTokenCost(variant.provider as any, variant.model, promptTokens, completionTokens)
    await saveLLMCall(runId, "writer", "writer", variant.model, variant.provider, promptTokens, completionTokens, latencyMs, cost, { seed })

    return { prose, wordCount, latencyMs, tokens: completionTokens, cost }
  } catch (err) {
    console.error(`  [${variant.label}] Generation failed:`, err instanceof Error ? err.message : err)
    return null
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

  const modelScores: Record<string, ScoreEntry[]> = {}
  const modelStats: Record<string, { words: number[]; lint: number[]; cost: number[]; latency: number[] }> = {}
  for (const v of WRITER_MODELS) {
    modelScores[v.label] = []
    modelStats[v.label] = { words: [], lint: [], cost: [], latency: [] }
  }

  for (const seed of seeds) {
    for (let run = 1; run <= RUNS; run++) {
      console.log(`[${seed.name}] Run ${run}/${RUNS}`)

      for (const variant of WRITER_MODELS) {
        const result = await generateWithModel(variant, seed.prompt, modelRuns[variant.label], seed.name)
        if (!result) { console.log(`  [${variant.label}] FAILED`); continue }

        const genId = await saveGeneration(modelRuns[variant.label], seed.name, run, {
          prose: result.prose, wordCount: result.wordCount, passed: true,
          variantLabel: variant.label, latencyMs: result.latencyMs,
          completionTokens: result.tokens, tokensPerSec: Math.round(result.tokens / (result.latencyMs / 1000)),
        })

        // Lint
        const lintResult = await lintProse(result.prose)
        await saveLintIssues(genId, lintResult.issues)
        modelStats[variant.label].lint.push(lintResult.totalIssues)
        modelStats[variant.label].words.push(result.wordCount)
        modelStats[variant.label].cost.push(result.cost)
        modelStats[variant.label].latency.push(result.latencyMs)

        // Judge
        for (const dim of DIMENSIONS) {
          const penalty = await judgeDimension(judge, dim, result.prose, modelRuns[variant.label], seed.name)
          if (penalty) {
            await saveScore(genId, judge.label, dim, penalty.count, JSON.stringify(penalty.issues))
            modelScores[variant.label].push({ seed: seed.name, dim, count: penalty.count, wordCount: result.wordCount })
          }
        }

        const dimSummary = DIMENSIONS.map(dim => {
          const s = modelScores[variant.label].filter(x => x.seed === seed.name && x.dim === dim).slice(-1)[0]
          return s ? `${DIMENSION_LABELS[dim]}:${Math.abs(s.count)}` : ""
        }).filter(Boolean).join(" ")

        console.log(`  [${variant.label}] ${result.wordCount}w | ${result.latencyMs}ms | $${result.cost.toFixed(4)} | lint:${lintResult.totalIssues} | ${dimSummary}`)
      }
      console.log()
    }
  }

  // Report
  console.log("=".repeat(85))
  console.log("  WRITER MODEL COMPARISON")
  console.log("=".repeat(85))

  const modelLabels = WRITER_MODELS.map(m => m.label)
  console.log(`\n  Judge penalties (avg issues per chapter):`)
  console.log(`  ${"Dimension".padEnd(16)} ${modelLabels.map(l => l.padStart(22)).join("  ")}`)
  console.log("  " + "-".repeat(16 + modelLabels.length * 24))

  for (const dim of DIMENSIONS) {
    const cells = [DIMENSION_LABELS[dim].padEnd(16)]
    for (const label of modelLabels) {
      const scores = modelScores[label].filter(s => s.dim === dim)
      if (scores.length === 0) { cells.push("n/a".padStart(22)); continue }
      const avg = mean(scores.map(s => Math.abs(s.count)))
      cells.push(avg.toFixed(1).padStart(22))
    }
    console.log("  " + cells.join("  "))
  }

  console.log(`\n  Other metrics:`)
  console.log(`  ${"Metric".padEnd(16)} ${modelLabels.map(l => l.padStart(22)).join("  ")}`)
  console.log("  " + "-".repeat(16 + modelLabels.length * 24))

  const metricRows = [
    { label: "Avg words", fn: (l: string) => mean(modelStats[l].words).toFixed(0) + "w" },
    { label: "Avg lint issues", fn: (l: string) => mean(modelStats[l].lint).toFixed(1) },
    { label: "Avg cost/chapter", fn: (l: string) => "$" + mean(modelStats[l].cost).toFixed(4) },
    { label: "Avg latency", fn: (l: string) => mean(modelStats[l].latency).toFixed(0) + "ms" },
  ]

  for (const row of metricRows) {
    const cells = [row.label.padEnd(16)]
    for (const label of modelLabels) {
      cells.push(row.fn(label).padStart(22))
    }
    console.log("  " + cells.join("  "))
  }

  // Run IDs for pairwise follow-up
  console.log(`\n  Experiment: #${experimentId}`)
  for (const label of modelLabels) console.log(`  ${label} run: ${modelRuns[label]}`)

  const conclusion = modelLabels.map(label => {
    const scores = modelScores[label]
    const totalAvg = scores.length > 0 ? mean(scores.map(s => Math.abs(s.count))).toFixed(1) : "n/a"
    const cost = mean(modelStats[label].cost).toFixed(4)
    return `${label}: avg ${totalAvg} issues, $${cost}/ch`
  }).join("; ")
  await concludeExperiment(experimentId, conclusion)
}

main()
