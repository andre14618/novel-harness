import { WRITER_AGENT_PROMPT } from "../../src/prompts"
import { getWriter, getJudges } from "../config"
import {
  ALL_DIMENSIONS,
  PENALTY_DIMENSIONS, QUALITY_DIMENSIONS, PENALTY_LABELS, QUALITY_LABELS,
  type PenaltyDimension, type QualityDimension,
} from "./judges/schema"
import {
  getDB, createRun, saveGeneration, saveScore, getCallSummary, markBaseline,
  getRunAverages, getBaselineAverages, getOverallAvg,
  getWeakestGenerations, getScoresForGeneration, getPerSeedAverages,
} from "../db"
import { loadSeeds, generateProse, judgeDimension, judgeQualityDimension, JUDGE_RUBRICS, mean, stddev } from "./shared"
import { lintRun } from "../../src/lint/index"
import { getBatchProvider, listBatchProviders } from "../batch/providers"
import { PROVIDERS } from "../../models/registry"
import { createBatch, addBatchRequest, updateBatchSubmitted } from "../../data/db"

import { setTransport, BatchTransport } from "../../src/transport"

// ── Config ───────────────────────────────────────────────────────────────

const RUNS_PER_SEED = parseInt(process.env.BENCHMARK_RUNS ?? "3")
const BATCH_MODE = process.argv.includes("--batch")

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  getDB()

  const writer = getWriter()
  const judges = getJudges()
  const seedFilter = process.env.BENCHMARK_SEEDS?.split(",").map(s => s.trim())
  const seeds = loadSeeds(seedFilter)
  const experimentId = process.env.EXPERIMENT_ID ? parseInt(process.env.EXPERIMENT_ID) : undefined

  if (!BATCH_MODE && judges.length === 0) { console.error("No judge API keys found"); process.exit(1) }

  console.log(`\nBenchmark: ${writer.label}`)
  console.log(`Seeds: ${seeds.map(s => s.name).join(", ")}`)
  console.log(`Runs per seed: ${RUNS_PER_SEED}`)
  if (BATCH_MODE) {
    const bp = process.env.BATCH_PROVIDER ?? judges[0]?.provider ?? "?"
    const bm = process.env.BATCH_MODEL ?? judges[0]?.model ?? "?"
    console.log(`Mode: BATCH (${bp} / ${bm})`)
  } else {
    console.log(`Judge: ${judges.map(j => j.label).join(", ")}`)
  }
  console.log(`Penalty dimensions: ${PENALTY_DIMENSIONS.map(d => PENALTY_LABELS[d]).join(", ")}`)
  console.log(`Quality dimensions: ${QUALITY_DIMENSIONS.map(d => QUALITY_LABELS[d]).join(", ")}`)
  if (!BATCH_MODE) console.log(`Judge calls per generation: ${judges.length} x ${ALL_DIMENSIONS.length} = ${judges.length * ALL_DIMENSIONS.length}`)
  if (experimentId) console.log(`Experiment: #${experimentId}`)
  console.log()

  const runId = await createRun("prose", seeds.length.toString(), `${writer.label} / ${judges.map(j => j.label).join(",")}`, experimentId)

  // Track all scores in memory for reporting
  const allPenaltyScores: Array<{ seed: string; run: number; dim: PenaltyDimension; count: number; wordCount: number }> = []
  const allQualityScores: Array<{ seed: string; run: number; dim: QualityDimension; score: number; wordCount: number }> = []

  // Track generations for batch mode
  const generatedProse: Array<{ genId: number; seed: string; prose: string; words: number }> = []

  // ── Generate + judge all seeds ───────────────────────────────────────

  await Promise.all(
    seeds.map(async (seed) => {
      for (let run = 1; run <= RUNS_PER_SEED; run++) {
        console.log(`[${seed.name}] Run ${run}/${RUNS_PER_SEED}...`)

        const result = await generateProse(writer, WRITER_AGENT_PROMPT, seed.prompt, runId, seed.name, run)
        if (!result) {
          await saveGeneration(runId, seed.name, run, { passed: false })
          console.log(`[${seed.name}] Run ${run}: FAIL`)
          continue
        }

        const words = result.prose.split(/\s+/).length
        const genId = await saveGeneration(runId, seed.name, run, {
          prose: result.prose, wordCount: words, latencyMs: result.latencyMs,
          tokensPerSec: result.tps, completionTokens: result.tokens, passed: true,
        })

        console.log(`[${seed.name}] Run ${run}: ${words}w ${result.tps}tok/s ${(result.latencyMs / 1000).toFixed(1)}s`)

        if (BATCH_MODE) {
          generatedProse.push({ genId, seed: seed.name, prose: result.prose, words })
        } else {
          // Judge — all judges x all penalty dimensions concurrently
          const penaltyJobs = judges.flatMap(judge =>
            PENALTY_DIMENSIONS.map(async (dim) => {
              const penalty = await judgeDimension(judge, dim, result.prose, runId, seed.name)
              if (penalty) {
                await saveScore(genId, judge.label, dim, penalty.count, JSON.stringify(penalty.issues))
                allPenaltyScores.push({ seed: seed.name, run, dim, count: penalty.count, wordCount: words })
                console.log(`  [${seed.name}:${run}] ${PENALTY_LABELS[dim]}: ${Math.abs(penalty.count)} issues`)
              }
            })
          )
          // Judge — all judges x all quality dimensions concurrently
          const qualityJobs = judges.flatMap(judge =>
            QUALITY_DIMENSIONS.map(async (dim) => {
              const quality = await judgeQualityDimension(judge, dim, result.prose, runId, seed.name)
              if (quality) {
                await saveScore(genId, judge.label, dim, quality.score, quality.reasoning)
                allQualityScores.push({ seed: seed.name, run, dim, score: quality.score, wordCount: words })
                console.log(`  [${seed.name}:${run}] ${QUALITY_LABELS[dim]}: ${quality.score}/10`)
              }
            })
          )
          await Promise.all([...penaltyJobs, ...qualityJobs])
        }
      }
    })
  )

  // ── Auto-lint ─────────────────────────────────────────────────────────

  const lintResults = await lintRun(runId)
  const totalLintIssues = lintResults.reduce((s, r) => s + r.result.totalIssues, 0)
  if (totalLintIssues > 0) {
    console.log(`\n  Lint: ${totalLintIssues} deterministic issues flagged`)
  }

  // ── Batch submission (if --batch) ─────────────────────────────────────
  // Swap to BatchTransport, run judgeDimension() for each generation×dimension.
  // judgeDimension() builds the same prompts as real-time mode — transport queues them.

  if (BATCH_MODE && generatedProse.length > 0) {
    // Use the judge from roles.ts by default. Env overrides for one-off batch experiments.
    const batchJudge = judges[0]
    const batchProvider = process.env.BATCH_PROVIDER ?? batchJudge.provider
    const batchModel = process.env.BATCH_MODEL ?? batchJudge.model

    // Validate the provider actually supports batch API
    const providerDef = PROVIDERS[batchProvider as keyof typeof PROVIDERS]
    if (!providerDef?.batchApi?.available) {
      const available = listBatchProviders()
      console.error(`\n  Error: '${batchProvider}' does not support batch API.`)
      console.error(`  Available batch providers: ${available.join(", ")}`)
      console.error(`  Use BATCH_PROVIDER=${available[0]} BATCH_MODEL=<model> bun benchmark/prose/run.ts --batch`)
      process.exit(1)
    }

    const batchTransport = new BatchTransport(getBatchProvider(batchProvider), batchModel)
    setTransport(batchTransport)

    const batchJudgeConfig = {
      ...batchJudge,
      provider: batchProvider as any,
      model: batchModel,
    }

    // Queue all judge calls through the transport (penalty + quality)
    for (const gen of generatedProse) {
      for (const dim of PENALTY_DIMENSIONS) {
        await judgeDimension(batchJudgeConfig, dim, gen.prose, runId, gen.seed, `gen-${gen.genId}-${dim}`)
      }
      for (const dim of QUALITY_DIMENSIONS) {
        await judgeQualityDimension(batchJudgeConfig, dim, gen.prose, runId, gen.seed, `gen-${gen.genId}-${dim}`)
      }
    }

    // Register in DB and flush
    const batchId = await createBatch(runId, batchProvider, batchModel)
    for (const q of batchTransport.getQueue()) {
      const parts = q.customId.match(/^gen-(\d+)-(.+)$/)
      if (parts) await addBatchRequest(batchId, q.customId, parseInt(parts[1]), parts[2])
    }

    const providerBatchId = await batchTransport.flush()
    const requestCount = batchTransport.queueSize()
    await updateBatchSubmitted(batchId, providerBatchId, `data/batches/input-*.jsonl`, requestCount)

    console.log(`\n  Batch submitted: ${requestCount} judge calls via ${batchProvider}/${batchModel}`)
    console.log(`  Provider batch ID: ${providerBatchId}`)
    console.log(`  Local batch: #${batchId}`)
    console.log(`  Check status: bun benchmark/batch/status.ts`)
    console.log(`  Collect results: bun benchmark/batch/collect.ts`)
    console.log(`\n  Run ID: ${runId}`)
    console.log(`  DB: Postgres`)
    return
  }

  // ── Report (only in non-batch mode) ────────────────────────────────────

  console.log("\n" + "=".repeat(60))
  console.log("  PROSE BENCHMARK RESULTS")
  console.log("=".repeat(60))

  console.log(`\n  Writer: ${writer.label}`)
  console.log(`  Judge: ${judges.map(j => j.label).join(", ")}`)
  console.log(`  Seeds: ${seeds.length} x ${RUNS_PER_SEED} runs`)

  // Per-dimension averages (raw + normalized)
  // count is negative (negated at extraction), use Math.abs for display
  const abs = (n: number) => Math.abs(n)
  const per1k = (s: { count: number; wordCount: number }) => s.wordCount > 0 ? abs(s.count) / s.wordCount * 1000 : 0
  const avgWords = mean(allPenaltyScores.map(s => s.wordCount))

  // ── Penalty results ──
  console.log(`\n  Penalty dimensions (issues | per 1k words):`)
  const penaltyStats: Array<{ dim: PenaltyDimension; avg: number; std: number; normAvg: number; normStd: number }> = []
  for (const dim of PENALTY_DIMENSIONS) {
    const dimScores = allPenaltyScores.filter(s => s.dim === dim)
    const counts = dimScores.map(s => abs(s.count))
    const norms = dimScores.map(per1k)
    const avg = mean(counts), std = stddev(counts)
    const normAvg = mean(norms), normStd = stddev(norms)
    penaltyStats.push({ dim, avg, std, normAvg, normStd })
    console.log(`    ${PENALTY_LABELS[dim].padEnd(14)} ${avg.toFixed(1)} issues (+-${std.toFixed(1)})  |  ${normAvg.toFixed(1)}/1k (+-${normStd.toFixed(1)})`)
  }
  const totalAvg = mean(allPenaltyScores.map(s => abs(s.count)))
  const totalStd = stddev(allPenaltyScores.map(s => abs(s.count)))
  const totalNormAvg = mean(allPenaltyScores.map(per1k))
  const totalNormStd = stddev(allPenaltyScores.map(per1k))
  console.log(`    ${"TOTAL".padEnd(14)} ${totalAvg.toFixed(1)} issues/dim (+-${totalStd.toFixed(1)})  |  ${totalNormAvg.toFixed(1)}/1k (+-${totalNormStd.toFixed(1)})`)
  console.log(`    Avg word count: ${avgWords.toFixed(0)}`)

  // ── Quality results ──
  if (allQualityScores.length > 0) {
    console.log(`\n  Quality dimensions (1-10 score):`)
    const qualityStats: Array<{ dim: QualityDimension; avg: number; std: number }> = []
    for (const dim of QUALITY_DIMENSIONS) {
      const dimScores = allQualityScores.filter(s => s.dim === dim)
      const scores = dimScores.map(s => s.score)
      const avg = mean(scores), std = stddev(scores)
      qualityStats.push({ dim, avg, std })
      console.log(`    ${QUALITY_LABELS[dim].padEnd(18)} ${avg.toFixed(1)}/10 (+-${std.toFixed(1)})`)
    }
    const qualityAvg = mean(allQualityScores.map(s => s.score))
    const qualityStd = stddev(allQualityScores.map(s => s.score))
    console.log(`    ${"AVERAGE".padEnd(18)} ${qualityAvg.toFixed(1)}/10 (+-${qualityStd.toFixed(1)})`)
  }

  // Per-seed breakdown
  console.log(`\n  Per-seed breakdown:`)
  for (const seed of seeds) {
    const seedPenalties = allPenaltyScores.filter(s => s.seed === seed.name)
    const seedQualities = allQualityScores.filter(s => s.seed === seed.name)
    const seedWords = mean(seedPenalties.map(s => s.wordCount))
    const penStr = PENALTY_DIMENSIONS.map(dim => {
      const dimScores = seedPenalties.filter(s => s.dim === dim)
      return `${PENALTY_LABELS[dim]}:${mean(dimScores.map(s => abs(s.count))).toFixed(1)}`
    }).join(" ")
    const qualStr = QUALITY_DIMENSIONS.map(dim => {
      const dimScores = seedQualities.filter(s => s.dim === dim)
      return dimScores.length > 0 ? `${QUALITY_LABELS[dim].slice(0, 3)}:${mean(dimScores.map(s => s.score)).toFixed(1)}` : ""
    }).filter(Boolean).join(" ")
    const seedPenAvg = mean(seedPenalties.map(s => abs(s.count)))
    console.log(`    ${seed.name.padEnd(24)} ${penStr} | ${qualStr} (pen ${seedPenAvg.toFixed(1)}, ${seedWords.toFixed(0)}w)`)
  }

  // Commit-ready summary
  const dimShort = penaltyStats.map(d => {
    const label = d.dim === "telling" ? "T" : d.dim === "dead-weight" ? "W" : "D"
    return `${label}:${d.avg.toFixed(1)}`
  }).join(" ")
  const qualShort = allQualityScores.length > 0
    ? ` | quality: ${mean(allQualityScores.map(s => s.score)).toFixed(1)}/10`
    : ""
  const summary = `benchmark: ${totalAvg.toFixed(1)} issues/dim (+-${totalStd.toFixed(1)}) ${dimShort}${qualShort}`
  console.log(`\n  Commit line:\n  ${summary}\n  ${seeds.length} seeds x ${RUNS_PER_SEED} runs`)

  // ── Compare to baseline ────────────────────────────────────────────────

  const baselineAvgs = await getBaselineAverages("prose")
  if (baselineAvgs) {
    console.log(`\n  vs Baseline:`)
    for (const dim of PENALTY_DIMENSIONS) {
      const current = penaltyStats.find(d => d.dim === dim)
      const baseline = baselineAvgs.find(d => d.dimension === dim)
      if (current && baseline) {
        // Both are issue counts (positive). Fewer issues = better.
        const baselineIssues = Math.abs(baseline.avg)
        const delta = Math.round((current.avg - baselineIssues) * 10) / 10
        if (Math.abs(delta) >= 0.2) {
          const arrow = delta < 0 ? "" : "+"
          const quality = delta < 0 ? "(better)" : "(worse)"
          console.log(`    ${PENALTY_LABELS[dim]}: ${arrow}${delta} issues (${baselineIssues} -> ${current.avg.toFixed(1)}) ${quality}`)
        }
      }
    }
  }

  // ── Cost & TPS summary ─────────────────────────────────────────────────

  const callSummary = await getCallSummary(runId)
  if (callSummary.length > 0) {
    console.log(`\n  Cost & TPS breakdown:`)
    let totalCost = 0
    for (const c of callSummary) {
      totalCost += c.totalCost
      const tps = c.avgTps ? `${c.avgTps} tok/s` : "—"
      console.log(`    ${c.agent.padEnd(8)} ${c.model.padEnd(35)} ${`${c.calls}`.padStart(4)} calls  $${c.totalCost.toFixed(4).padStart(8)}  ${tps.padStart(12)}  ${c.totalPrompt + c.totalCompletion} tokens`)
    }
    console.log(`    ${"TOTAL".padEnd(44)} ${callSummary.reduce((s, c) => s + c.calls, 0).toString().padStart(4)} calls  $${totalCost.toFixed(4).padStart(8)}`)
  }

  // ── Save baseline if requested ─────────────────────────────────────────

  if (process.argv.includes("--save-baseline")) {
    await markBaseline(runId, "prose")
    console.log(`\n  Run ${runId} saved as baseline.`)
  }

  console.log(`\n  Run ID: ${runId}`)
  console.log(`  DB: Postgres`)
}

main()
