/**
 * Workbench experiment runner.
 *
 * Reads experiment config from DB, executes generation + evaluation
 * using existing infrastructure. Launched as a subprocess by the
 * orchestrator via POST /api/experiments/create.
 *
 * Supports batch judging: generation is always real-time (we need the prose),
 * but judge calls can be queued via batch API for 50% savings.
 *
 * Usage: EXPERIMENT_ID=N bun benchmark/workbench/runner.ts
 */

import db from "../../data/connection"
import type { WorkbenchConfig } from "./types"
import { DIMENSIONS, DIMENSION_LABELS, QUALITY_DIMENSIONS, QUALITY_LABELS } from "../prose/judges/schema"
import { createRun, saveGeneration, saveScore, saveLLMCall } from "../db"
import { concludeExperiment, createBatch, addBatchRequest, updateBatchSubmitted } from "../../data/db"
import { loadSeeds, generateProse, judgeDimension, judgeQualityDimension, mean } from "../prose/shared"
import { getTransport, setTransport, BatchTransport } from "../../src/transport"
import { extractJSON } from "../../src/llm"
import { lintProse, saveLintIssues } from "../../src/lint"
import { runMatchup } from "../pairwise/judge"
import { savePairwiseMatchup } from "../../data/db"
import { getBatchProvider, listBatchProviders } from "../batch/providers"
import { PROVIDERS } from "../../models/registry"
import { readFileSync } from "node:fs"

const WRITER_PROMPT = readFileSync(new URL("../../src/agents/writer/prompt.md", import.meta.url).pathname, "utf-8")

const experimentId = parseInt(process.env.EXPERIMENT_ID ?? "")
if (!experimentId) { console.error("EXPERIMENT_ID required"); process.exit(1) }

async function main() {
  // Load config from DB
  const [exp] = await db`SELECT config, description FROM tuning_experiments WHERE id = ${experimentId}` as any[]
  if (!exp) { console.error(`Experiment ${experimentId} not found`); process.exit(1) }

  const config: WorkbenchConfig = typeof exp.config === "string" ? JSON.parse(exp.config) : exp.config

  // Update status to running
  await db`UPDATE tuning_experiments SET summary = 'running' WHERE id = ${experimentId}`

  const batchJudging = config.transport?.judging === "batch"

  console.log(`\nWorkbench Experiment #${experimentId}`)
  console.log(`Suite: ${config.suite}`)
  console.log(`Models: ${config.models.map(m => m.label).join(", ")}`)
  console.log(`Seeds: ${config.seeds.length > 0 ? config.seeds.join(", ") : "all"}`)
  console.log(`Runs/seed: ${config.runsPerSeed}`)
  console.log(`Evaluations: ${Object.entries(config.evaluations).filter(([, v]) => v).map(([k]) => k).join(", ")}`)
  console.log(`Transport: generation=realtime, judging=${batchJudging ? "batch" : "realtime"}`)
  if (config.sourceRunId) console.log(`Source run: ${config.sourceRunId} (reusing prose)`)
  console.log()

  // Resolve seeds
  const seedFilter = config.seeds.length > 0 ? config.seeds : undefined
  const seeds = loadSeeds(seedFilter)

  // Resolve judge
  const { getJudges } = await import("../config")
  const judges = getJudges()
  const judge = config.judgeModel
    ? { ...judges[0], provider: config.judgeModel.provider as any, model: config.judgeModel.id, label: `${config.judgeModel.id}` }
    : judges[0]

  // Create runs per model
  const modelRuns: Record<string, number> = {}
  for (const model of config.models) {
    modelRuns[model.label] = await createRun("prose", seeds.length.toString(), `workbench-${model.label}`, experimentId)
  }

  const modelScores: Record<string, Array<{ dim: string; score: number }>> = {}
  const modelStats: Record<string, { words: number[]; lint: number[]; cost: number[] }> = {}
  for (const m of config.models) {
    modelScores[m.label] = []
    modelStats[m.label] = { words: [], lint: [], cost: [] }
  }

  // If source run specified, load existing prose
  let sourceGens: Array<{ seed: string; attempt: number; prose: string; wordCount: number }> = []
  if (config.sourceRunId) {
    sourceGens = await db`
      SELECT seed, attempt, prose, word_count as "wordCount"
      FROM generations WHERE run_id = ${config.sourceRunId} AND passed = true AND prose IS NOT NULL
      ORDER BY seed, attempt
    ` as any[]
    console.log(`Loaded ${sourceGens.length} generations from source run ${config.sourceRunId}`)
  }

  // Track generated prose for batch judging
  const allGens: Array<{ genId: number; runId: number; seed: string; prose: string; model: string }> = []

  // ── Phase 1: Generate prose (always real-time) ──────────────────────────

  for (const seed of seeds) {
    for (let run = 1; run <= config.runsPerSeed; run++) {
      console.log(`[${seed.name}] Run ${run}/${config.runsPerSeed}`)

      for (const model of config.models) {
        const runId = modelRuns[model.label]
        let prose: string
        let wordCount: number
        let latencyMs = 0
        let completionTokens = 0
        let cost = 0

        if (config.sourceRunId) {
          // Reuse existing prose
          const existing = sourceGens.find(g => g.seed === seed.name && g.attempt === run)
          if (!existing) { console.log(`  [${model.label}] No source gen for ${seed.name} run ${run}`); continue }
          prose = existing.prose
          wordCount = existing.wordCount
        } else {
          // Generate new prose
          const start = Date.now()
          try {
            const response = await getTransport().execute({
              systemPrompt: WRITER_PROMPT,
              userPrompt: seed.prompt,
              model: model.id,
              provider: model.provider as any,
              temperature: 0.8,
              maxTokens: model.maxTokens ?? 16384,
              responseFormat: { type: "json_object" },
            })
            latencyMs = Date.now() - start
            const json = extractJSON(response.content)
            const parsed = JSON.parse(json)
            prose = parsed.prose
            if (!prose) { console.log(`  [${model.label}] No prose in response`); continue }
            wordCount = prose.split(/\s+/).length
            completionTokens = response.usage?.completion_tokens ?? 0
            const promptTokens = response.usage?.prompt_tokens ?? 0
            const { getTokenCost } = await import("../../models/registry")
            cost = getTokenCost(model.provider as any, model.id, promptTokens, completionTokens)
            await saveLLMCall(runId, "writer", "writer", model.id, model.provider, promptTokens, completionTokens, latencyMs, cost, { seed: seed.name })
          } catch (err) {
            console.log(`  [${model.label}] Generation failed: ${err instanceof Error ? err.message : err}`)
            continue
          }
        }

        const genId = await saveGeneration(runId, seed.name, run, {
          prose, wordCount, passed: true, variantLabel: model.label,
          latencyMs, completionTokens,
          tokensPerSec: latencyMs > 0 ? Math.round(completionTokens / (latencyMs / 1000)) : 0,
        })

        modelStats[model.label].words.push(wordCount)
        modelStats[model.label].cost.push(cost)

        // Lint (always real-time — deterministic, no LLM cost)
        if (config.evaluations.lint) {
          const lintResult = await lintProse(prose)
          await saveLintIssues(genId, lintResult.issues)
          modelStats[model.label].lint.push(lintResult.totalIssues)
        }

        allGens.push({ genId, runId, seed: seed.name, prose, model: model.label })

        // Real-time judging (inline)
        if (!batchJudging && config.evaluations.penaltyJudges) {
          let dimSummary = ""

          for (const dim of DIMENSIONS) {
            const penalty = await judgeDimension(judge, dim, prose, runId, seed.name)
            if (penalty) {
              await saveScore(genId, judge.label, dim, penalty.count, JSON.stringify(penalty.issues))
              modelScores[model.label].push({ dim, score: penalty.count })
              dimSummary += `${DIMENSION_LABELS[dim]}:${Math.abs(penalty.count)} `
            }
          }

          for (const dim of QUALITY_DIMENSIONS) {
            const quality = await judgeQualityDimension(judge, dim, prose, runId, seed.name)
            if (quality) {
              await saveScore(genId, judge.label, dim, quality.score, quality.reasoning)
              dimSummary += `${QUALITY_LABELS[dim].slice(0, 3)}:${quality.score}/10 `
            }
          }

          const lintCount = modelStats[model.label].lint.at(-1) ?? 0
          console.log(`  [${model.label}] ${wordCount}w | ${latencyMs}ms | $${cost.toFixed(4)} | lint:${lintCount} ${dimSummary}`)
        } else {
          const lintCount = modelStats[model.label].lint.at(-1) ?? 0
          console.log(`  [${model.label}] ${wordCount}w | ${latencyMs}ms | $${cost.toFixed(4)} | lint:${lintCount}`)
        }
      }
      console.log()
    }
  }

  // ── Phase 2: Batch judging (if enabled) ──────────────────────────────────

  if (batchJudging && config.evaluations.penaltyJudges && allGens.length > 0) {
    const batchProvider = judge.provider
    const batchModel = judge.model

    // Validate provider supports batch API
    const providerDef = PROVIDERS[batchProvider as keyof typeof PROVIDERS]
    if (!providerDef?.batchApi?.available) {
      const available = listBatchProviders()
      console.log(`\n  Warning: '${batchProvider}' does not support batch API.`)
      console.log(`  Available batch providers: ${available.join(", ")}`)
      console.log(`  Falling back to real-time judging...\n`)

      // Fallback: judge in real-time
      for (const gen of allGens) {
        let dimSummary = ""
        for (const dim of DIMENSIONS) {
          const penalty = await judgeDimension(judge, dim, gen.prose, gen.runId, gen.seed)
          if (penalty) {
            await saveScore(gen.genId, judge.label, dim, penalty.count, JSON.stringify(penalty.issues))
            modelScores[gen.model].push({ dim, score: penalty.count })
            dimSummary += `${DIMENSION_LABELS[dim]}:${Math.abs(penalty.count)} `
          }
        }
        for (const dim of QUALITY_DIMENSIONS) {
          const quality = await judgeQualityDimension(judge, dim, gen.prose, gen.runId, gen.seed)
          if (quality) {
            await saveScore(gen.genId, judge.label, dim, quality.score, quality.reasoning)
            dimSummary += `${QUALITY_LABELS[dim].slice(0, 3)}:${quality.score}/10 `
          }
        }
        console.log(`  [${gen.model}/${gen.seed}] ${dimSummary}`)
      }
    } else {
      // Set up batch transport
      const batchTransport = new BatchTransport(getBatchProvider(batchProvider), batchModel)
      setTransport(batchTransport)

      const batchJudgeConfig = { ...judge, provider: batchProvider as any, model: batchModel }

      // Queue all judge calls (penalty + quality)
      for (const gen of allGens) {
        for (const dim of DIMENSIONS) {
          await judgeDimension(batchJudgeConfig, dim, gen.prose, gen.runId, gen.seed, `gen-${gen.genId}-${dim}`)
        }
        for (const dim of QUALITY_DIMENSIONS) {
          await judgeQualityDimension(batchJudgeConfig, dim, gen.prose, gen.runId, gen.seed, `gen-${gen.genId}-${dim}`)
        }
      }

      // Register batch in DB and flush
      const firstRunId = Object.values(modelRuns)[0]
      const batchId = await createBatch(firstRunId, batchProvider, batchModel)
      for (const q of batchTransport.getQueue()) {
        const parts = q.customId.match(/^gen-(\d+)-(.+)$/)
        if (parts) await addBatchRequest(batchId, q.customId, parseInt(parts[1]), parts[2])
      }

      const providerBatchId = await batchTransport.flush()
      const requestCount = batchTransport.queueSize()
      await updateBatchSubmitted(batchId, providerBatchId, `workbench-${experimentId}`, requestCount)

      console.log(`\n  Batch submitted: ${requestCount} judge calls via ${batchProvider}/${batchModel}`)
      console.log(`  Provider batch ID: ${providerBatchId}`)
      console.log(`  Local batch: #${batchId}`)
      console.log(`  Collect results: bun benchmark/batch/collect.ts`)

      // Update experiment status — scores arrive later
      await db`UPDATE tuning_experiments SET summary = 'batch-pending' WHERE id = ${experimentId}`

      console.log("\n" + "=".repeat(60))
      console.log("  WORKBENCH — GENERATION COMPLETE, JUDGING BATCHED")
      console.log("=".repeat(60))
      console.log(`  ${allGens.length} generations across ${config.models.length} model(s)`)
      console.log(`  ${requestCount} judge calls queued (batch ${batchProvider}/${batchModel})`)
      console.log(`  Experiment: #${experimentId}`)
      for (const m of config.models) console.log(`  ${m.label} run: ${modelRuns[m.label]}`)
      return // Exit — collection happens later via batch/collect.ts
    }
  }

  // ── Phase 3: Pairwise (always real-time) ─────────────────────────────────

  if (config.evaluations.pairwise && config.models.length >= 2) {
    const runA = modelRuns[config.models[0].label]
    const runB = modelRuns[config.models[1].label]
    console.log(`Pairwise: ${config.models[0].label} vs ${config.models[1].label}`)

    const gensA = await db`SELECT id, seed, prose FROM generations WHERE run_id = ${runA} AND passed = true AND prose IS NOT NULL ORDER BY seed, attempt` as any[]
    const gensB = await db`SELECT id, seed, prose FROM generations WHERE run_id = ${runB} AND passed = true AND prose IS NOT NULL ORDER BY seed, attempt` as any[]

    const { getPairwiseJudge } = await import("../config")
    const pairJudge = getPairwiseJudge()

    for (let i = 0; i < Math.min(gensA.length, gensB.length); i++) {
      if (gensA[i].seed !== gensB[i].seed) continue
      const matchup = await runMatchup(pairJudge, gensA[i].prose, gensB[i].prose)
      const canonical = matchup.canonical === "first" ? "A wins" : matchup.canonical === "second" ? "B wins" : matchup.canonical
      console.log(`  [${gensA[i].seed}] ${canonical}`)

      if (matchup.forward) {
        await savePairwiseMatchup({
          experimentId, generationA: gensA[i].id, generationB: gensB[i].id,
          labelA: config.models[0].label, labelB: config.models[1].label,
          seed: gensA[i].seed, judgeModel: pairJudge.label,
          winner: matchup.forward.winner as any, confidence: matchup.forward.confidence as any,
          reasoning: matchup.forward.reasoning, position: "ab", latencyMs: 0,
        })
      }
      if (matchup.reverse) {
        await savePairwiseMatchup({
          experimentId, generationA: gensA[i].id, generationB: gensB[i].id,
          labelA: config.models[0].label, labelB: config.models[1].label,
          seed: gensA[i].seed, judgeModel: pairJudge.label,
          winner: matchup.reverse.winner as any, confidence: matchup.reverse.confidence as any,
          reasoning: matchup.reverse.reasoning, position: "ba", latencyMs: 0,
        })
      }
    }
  }

  // ── Conclude ──────────────────────────────────────────────────────────────

  const conclusion = config.models.map(m => {
    const scores = modelScores[m.label]
    const avgScore = scores.length > 0 ? mean(scores.map(s => Math.abs(s.score))).toFixed(1) : "n/a"
    const avgCost = modelStats[m.label].cost.length > 0 ? mean(modelStats[m.label].cost).toFixed(4) : "0"
    const avgLint = modelStats[m.label].lint.length > 0 ? mean(modelStats[m.label].lint).toFixed(1) : "n/a"
    return `${m.label}: avg ${avgScore} issues, lint ${avgLint}, $${avgCost}/ch`
  }).join("; ")

  await concludeExperiment(experimentId, conclusion)
  await db`UPDATE tuning_experiments SET summary = 'completed' WHERE id = ${experimentId}`

  console.log("\n" + "=".repeat(60))
  console.log("  WORKBENCH EXPERIMENT COMPLETE")
  console.log("=".repeat(60))
  console.log(`  ${conclusion}`)
  console.log(`  Experiment: #${experimentId}`)
  for (const m of config.models) console.log(`  ${m.label} run: ${modelRuns[m.label]}`)
}

main().catch(async (err) => {
  console.error("Workbench runner failed:", err)
  await db`UPDATE tuning_experiments SET summary = 'failed' WHERE id = ${experimentId}`.catch(() => {})
  process.exit(1)
})
