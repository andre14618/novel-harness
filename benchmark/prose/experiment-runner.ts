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
      provider: m.provider,
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
    systemPrompt: readFileSync(new URL("../../src/agents/writer/prose-writer-system.md", import.meta.url).pathname, "utf-8"),
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

  const expId = await createTuningExperiment("experiment", batch.description, {
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
    const runId = await createRun("prose", null, variant.label, expId)

    console.log(`\n── Variant: ${variant.label} (Run ${runId}) ──`)

    for (const seed of seeds) {
      for (let run = 1; run <= runsPerSeed; run++) {
        console.log(`  [${variant.label}] ${seed.name} run ${run}`)

        const prompt = variant.contextModifier ? variant.contextModifier(seed.prompt) : seed.prompt
        const temperature = variant.temperature ?? 0.8

        const result = await generateProse(writerConfig, variant.systemPrompt, prompt, runId, seed.name, run, temperature)
        if (!result) {
          await saveGeneration(runId, seed.name, run, { passed: false, variantLabel: variant.label })
          console.log(`    FAIL`)
          continue
        }

        const words = result.prose.split(/\s+/).length
        const genId = await saveGeneration(runId, seed.name, run, {
          prose: result.prose, wordCount: words, latencyMs: result.latencyMs,
          tokensPerSec: result.tps, completionTokens: result.tokens,
          passed: true, variantLabel: variant.label,
        })

        console.log(`    ${words}w ${result.tps}tok/s`)

        // Auto-lint
        const lintResult = await lintProse(result.prose)
        if (lintResult.totalIssues > 0) {
          await saveLintIssues(genId, lintResult.issues)
        }

        // Judge all dimensions concurrently
        const judgeJobs = DIMENSIONS.map(async (dim) => {
          const penalty = await judgeDimension(judge, dim, result.prose, runId, seed.name)
          if (penalty) {
            await saveScore(genId, judge.label, dim, penalty.count, JSON.stringify(penalty.issues))
            allScores.push({ variant: variant.label, seed: seed.name, run, dim, count: penalty.count, wordCount: words })
            console.log(`    ${DIMENSION_LABELS[dim]}: ${Math.abs(penalty.count)} issues`)
          }
        })
        await Promise.all(judgeJobs)

        await Bun.sleep(300)
      }
    }
  }

  // ── Results ────────────────────────────────────────────────────────────

  console.log(`\n${"=".repeat(70)}`)
  console.log(`  RESULTS — ${batch.name}`)
  console.log(`${"=".repeat(70)}`)

  const abs = (n: number) => Math.abs(n)
  const per1k = (s: VariantScore) => s.wordCount > 0 ? abs(s.count) / s.wordCount * 1000 : 0

  // Raw scores table
  const colW = 14
  console.log(`\n  ${"Variant".padEnd(28)} ${DIMENSIONS.map(d => DIMENSION_LABELS[d].padEnd(colW)).join("")}${"OVERALL".padEnd(colW)}${"Avg Words".padEnd(colW)}`)
  console.log(`  ${"-".repeat(28 + (DIMENSIONS.length + 2) * colW)}`)

  const variantOveralls: Array<{ label: string; overall: number; telling: number; normTelling: number; normOverall: number }> = []

  for (const variant of variants) {
    const cols: string[] = []
    let tellingAvg = 0, normTellingAvg = 0
    for (const dim of DIMENSIONS) {
      const dimScores = allScores.filter(s => s.variant === variant.label && s.dim === dim)
      const avg = mean(dimScores.map(s => abs(s.count)))
      const std = stddev(dimScores.map(s => abs(s.count)))
      if (dim === "telling") { tellingAvg = avg; normTellingAvg = mean(dimScores.map(per1k)) }
      cols.push(`${avg.toFixed(1)} ±${std.toFixed(1)}`.padEnd(colW))
    }
    const varScores = allScores.filter(s => s.variant === variant.label)
    const overall = mean(varScores.map(s => abs(s.count)))
    const normOverall = mean(varScores.map(per1k))
    const avgWords = mean(varScores.map(s => s.wordCount))
    cols.push(`${overall.toFixed(1)}`.padEnd(colW))
    cols.push(`${avgWords.toFixed(0)}`.padEnd(colW))
    variantOveralls.push({ label: variant.label, overall, telling: tellingAvg, normTelling: normTellingAvg, normOverall })

    console.log(`  ${variant.label.padEnd(28)} ${cols.join("")}`)
  }

  // Normalized table
  console.log(`\n  Normalized (issues per 1k words):`)
  console.log(`  ${"Variant".padEnd(28)} ${DIMENSIONS.map(d => DIMENSION_LABELS[d].padEnd(colW)).join("")}${"OVERALL".padEnd(colW)}`)
  console.log(`  ${"-".repeat(28 + (DIMENSIONS.length + 1) * colW)}`)

  for (const variant of variants) {
    const cols: string[] = []
    for (const dim of DIMENSIONS) {
      const dimScores = allScores.filter(s => s.variant === variant.label && s.dim === dim)
      const normAvg = mean(dimScores.map(per1k))
      const normStd = stddev(dimScores.map(per1k))
      cols.push(`${normAvg.toFixed(1)} ±${normStd.toFixed(1)}`.padEnd(colW))
    }
    const varScores = allScores.filter(s => s.variant === variant.label)
    cols.push(`${mean(varScores.map(per1k)).toFixed(1)}`.padEnd(colW))
    console.log(`  ${variant.label.padEnd(28)} ${cols.join("")}`)
  }

  // Ranking
  console.log(`\n  Ranked by Telling (raw → normalized):`)
  const ranked = [...variantOveralls].sort((a, b) => a.normTelling - b.normTelling)
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i]
    const marker = i === 0 ? ">>>" : "   "
    console.log(`  ${marker} ${r.label.padEnd(28)} Telling: ${r.telling.toFixed(1)} (${r.normTelling.toFixed(1)}/1k)  Overall: ${r.overall.toFixed(1)} (${r.normOverall.toFixed(1)}/1k)`)
  }

  // Per-seed for best variant
  const best = ranked[0]
  console.log(`\n  Per-seed breakdown for best variant (${best.label}):`)
  for (const seed of seeds) {
    const seedScores = allScores.filter(s => s.variant === best.label && s.seed === seed.name)
    const seedWords = mean(seedScores.map(s => s.wordCount))
    const dimStr = DIMENSIONS.map(dim => {
      const dimScores = seedScores.filter(s => s.dim === dim)
      return `${DIMENSION_LABELS[dim]}:${mean(dimScores.map(s => abs(s.count))).toFixed(1)}(${mean(dimScores.map(per1k)).toFixed(1)}/1k)`
    }).join("  ")
    console.log(`    ${seed.name.padEnd(24)} ${dimStr}  (${seedWords.toFixed(0)}w)`)
  }

  // Auto-generate and persist summary
  const summaryMd = generateExperimentSummary(expId, allScores, variants, seeds, judge.label)
  console.log(`\n  Summary saved to experiment #${expId}`)
  console.log()

  return { expId, allScores, ranked }
}
