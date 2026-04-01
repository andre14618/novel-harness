/**
 * Unified experiment runner.
 *
 * Runs variant sweeps (prompt, temperature, model) and stores all results
 * in the standard generations + scores tables. Each variant gets its own
 * run_id, all linked to a tuning_experiment.
 *
 * Supports both explicit Variant[] and matrix definitions (cartesian product).
 *
 * Usage: import { runBatch } from "./experiment-runner" in batch files.
 */

import { readFileSync } from "node:fs"
import { getWriter, getJudges, type WriterConfig, type JudgeConfig } from "../config"
import { DIMENSIONS, DIMENSION_LABELS, type Dimension } from "./judges/schema"
import {
  getDB, createRun, saveGeneration, saveScore,
  createTuningExperiment, concludeExperiment,
} from "../db"
import { MODELS, PROVIDERS, getApiKey } from "../../models/registry"
import { loadSeeds, generateProse, judgeDimension, mean, stddev } from "./shared"
import { lintProse, saveLintIssues } from "../../src/lint/index"
import { generateExperimentSummary } from "./summary"
import type { ExperimentBatch, Variant, VariantScore } from "./experiments/types"

// ── Writer resolution for variants ──────────────────────────────────────

function resolveVariantWriter(variant: Variant): WriterConfig {
  if (variant.model) {
    const m = MODELS.find(m => m.id === variant.model!.id && m.provider === variant.model!.provider)
    if (!m) throw new Error(`Model ${variant.model.id} (${variant.model.provider}) not found`)
    const p = PROVIDERS[m.provider]
    return {
      label: m.label,
      apiUrl: p.apiUrl,
      apiKey: getApiKey(m.provider),
      model: m.id,
      maxTokens: Math.min(m.maxOutput ?? 16384, 16384),
      extraBody: p.extraBody?.(),
      needsNothink: m.needsNothink,
    }
  }
  return getWriter()
}

// ── Matrix expansion ────────────────────────────────────────────────────

function expandMatrix(batch: ExperimentBatch): Variant[] {
  if (batch.variants?.length) return batch.variants
  if (!batch.matrix) throw new Error("ExperimentBatch must have either variants or matrix")

  const prompts = batch.matrix.prompts ?? [{
    label: "default",
    systemPrompt: readFileSync(new URL("../../src/agents/writer/prompt.md", import.meta.url).pathname, "utf-8"),
  }]
  const models = batch.matrix.models ?? [undefined]
  const temps = batch.matrix.temperatures ?? [0.8]

  const variants: Variant[] = []
  for (const model of models) {
    for (const prompt of prompts) {
      for (const temp of temps) {
        const parts: string[] = []
        if (model) parts.push(model.label)
        if (prompts.length > 1) parts.push(prompt.label)
        if (temps.length > 1) parts.push(`T=${temp}`)
        const label = parts.join(" / ") || prompt.label

        variants.push({
          label,
          systemPrompt: prompt.systemPrompt,
          temperature: temp,
          model: model ? { id: model.id, provider: model.provider } : undefined,
        })
      }
    }
  }

  return variants
}

// ── Main runner ─────────────────────────────────────────────────────────

export async function runBatch(batch: ExperimentBatch) {
  getDB()

  const judge = getJudges()[0]
  const seedFilter = batch.seedFilter ?? process.env.BENCHMARK_SEEDS?.split(",").map(s => s.trim())
  const seeds = loadSeeds(seedFilter)
  const runsPerSeed = batch.runsPerSeed ?? 2
  const variants = expandMatrix(batch)

  const expId = createTuningExperiment("experiment", batch.description, {
    name: batch.name,
    variants: variants.map(v => ({ label: v.label, temperature: v.temperature ?? 0.8, model: v.model })),
    judge: judge.label,
    seeds: seeds.map(s => s.name),
    runsPerSeed,
    dimensions: [...DIMENSIONS],
  })

  console.log(`\n${"=".repeat(70)}`)
  console.log(`  ${batch.name} (Experiment #${expId})`)
  console.log(`${"=".repeat(70)}`)
  console.log(`  Variants: ${variants.map(v => v.label).join(", ")}`)
  console.log(`  Judge: ${judge.label}`)
  console.log(`  Seeds: ${seeds.map(s => s.name).join(", ")}`)
  console.log(`  Runs per seed: ${runsPerSeed}`)
  console.log(`  Total cells: ${variants.length} variants x ${seeds.length} seeds x ${runsPerSeed} runs = ${variants.length * seeds.length * runsPerSeed}`)
  console.log()

  const allScores: VariantScore[] = []

  for (const variant of variants) {
    const writerConfig = resolveVariantWriter(variant)
    const runId = createRun("prose", null, variant.label, expId)

    console.log(`\n── Variant: ${variant.label} (Run ${runId}) ──`)

    for (const seed of seeds) {
      for (let run = 1; run <= runsPerSeed; run++) {
        console.log(`  [${variant.label}] ${seed.name} run ${run}`)

        const prompt = variant.contextModifier ? variant.contextModifier(seed.prompt) : seed.prompt
        const temperature = variant.temperature ?? 0.8

        const result = await generateProse(writerConfig, variant.systemPrompt, prompt, runId, seed.name, run, temperature)
        if (!result) {
          saveGeneration(runId, seed.name, run, { passed: false, variantLabel: variant.label })
          console.log(`    FAIL`)
          continue
        }

        const words = result.prose.split(/\s+/).length
        const genId = saveGeneration(runId, seed.name, run, {
          prose: result.prose, wordCount: words, latencyMs: result.latencyMs,
          tokensPerSec: result.tps, completionTokens: result.tokens,
          passed: true, variantLabel: variant.label,
        })

        console.log(`    ${words}w ${result.tps}tok/s`)

        // Auto-lint
        const lintResult = lintProse(result.prose)
        if (lintResult.totalIssues > 0) {
          saveLintIssues(genId, lintResult.issues)
        }

        // Judge all dimensions concurrently
        const judgeJobs = DIMENSIONS.map(async (dim) => {
          const penalty = await judgeDimension(judge, dim, result.prose, runId, seed.name)
          if (penalty) {
            saveScore(genId, judge.label, dim, penalty.count, JSON.stringify(penalty.issues))
            allScores.push({ variant: variant.label, seed: seed.name, run, dim, count: penalty.count })
            console.log(`    ${DIMENSION_LABELS[dim]}: ${penalty.count}`)
          }
        })
        await Promise.all(judgeJobs)

        await Bun.sleep(300)
      }
    }
  }

  // ── Results ────────────────────────────────────────────────────────────

  console.log(`\n${"=".repeat(70)}`)
  console.log(`  RESULTS — ${batch.name} (lower = better)`)
  console.log(`${"=".repeat(70)}`)

  const colW = 14
  console.log(`\n  ${"Variant".padEnd(28)} ${DIMENSIONS.map(d => DIMENSION_LABELS[d].padEnd(colW)).join("")}${"OVERALL".padEnd(colW)}`)
  console.log(`  ${"-".repeat(28 + (DIMENSIONS.length + 1) * colW)}`)

  const variantOveralls: Array<{ label: string; overall: number; telling: number }> = []

  for (const variant of variants) {
    const cols: string[] = []
    let tellingAvg = 0
    for (const dim of DIMENSIONS) {
      const counts = allScores.filter(s => s.variant === variant.label && s.dim === dim).map(s => s.count)
      const avg = mean(counts)
      const std = stddev(counts)
      if (dim === "telling") tellingAvg = avg
      cols.push(`${avg.toFixed(1)} ±${std.toFixed(1)}`.padEnd(colW))
    }
    const allCounts = allScores.filter(s => s.variant === variant.label).map(s => s.count)
    const overall = mean(allCounts)
    cols.push(`${overall.toFixed(1)}`.padEnd(colW))
    variantOveralls.push({ label: variant.label, overall, telling: tellingAvg })

    console.log(`  ${variant.label.padEnd(28)} ${cols.join("")}`)
  }

  // Ranking
  console.log(`\n  Ranked by Telling (primary target):`)
  const ranked = [...variantOveralls].sort((a, b) => a.telling - b.telling)
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i]
    const marker = i === 0 ? ">>>" : "   "
    console.log(`  ${marker} ${r.label.padEnd(28)} Telling: ${r.telling.toFixed(1)}  Overall: ${r.overall.toFixed(1)}`)
  }

  // Per-seed for best variant
  const best = ranked[0]
  console.log(`\n  Per-seed breakdown for best variant (${best.label}):`)
  for (const seed of seeds) {
    const seedScores = allScores.filter(s => s.variant === best.label && s.seed === seed.name)
    const dimStr = DIMENSIONS.map(dim => {
      const counts = seedScores.filter(s => s.dim === dim).map(s => s.count)
      return `${DIMENSION_LABELS[dim]}:${mean(counts).toFixed(1)}`
    }).join("  ")
    console.log(`    ${seed.name.padEnd(24)} ${dimStr}`)
  }

  // Auto-generate and persist summary
  const summaryMd = generateExperimentSummary(expId, allScores, variants, seeds, judge.label)
  console.log(`\n  Summary saved to experiment #${expId}`)
  console.log()

  return { expId, allScores, ranked }
}
