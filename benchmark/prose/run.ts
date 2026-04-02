import { WRITER_AGENT_PROMPT } from "../../src/prompts"
import { getWriter, getJudges } from "../config"
import { DIMENSIONS, DIMENSION_LABELS, type Dimension } from "./judges/schema"
import {
  getDB, createRun, saveGeneration, saveScore, getCallSummary, markBaseline,
  getRunAverages, getBaselineAverages, getOverallAvg,
  getWeakestGenerations, getScoresForGeneration, getPerSeedAverages,
} from "../db"
import { loadSeeds, generateProse, judgeDimension, JUDGE_RUBRICS, mean, stddev } from "./shared"
import { lintRun } from "../../src/lint/index"
import { getBatchProvider } from "../batch/providers"
import { createBatch, addBatchRequest, updateBatchSubmitted } from "../../data/db"
import { MODELS } from "../../models/registry"
import { setTransport, BatchTransport } from "../../src/transport"

// ── Config ───────────────────────────────────────────────────────────────

const RUNS_PER_SEED = parseInt(process.env.BENCHMARK_RUNS ?? "3")
const BATCH_MODE = process.argv.includes("--batch")
const BATCH_PROVIDER = process.env.BATCH_PROVIDER ?? "openai"
const BATCH_MODEL = process.env.BATCH_MODEL ?? "gpt-5.4-mini"

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
    console.log(`Mode: BATCH (${BATCH_PROVIDER} / ${BATCH_MODEL})`)
  } else {
    console.log(`Judge: ${judges.map(j => j.label).join(", ")}`)
  }
  console.log(`Penalty dimensions: ${DIMENSIONS.map(d => DIMENSION_LABELS[d]).join(", ")}`)
  if (!BATCH_MODE) console.log(`Judge calls per generation: ${judges.length} x ${DIMENSIONS.length} = ${judges.length * DIMENSIONS.length}`)
  if (experimentId) console.log(`Experiment: #${experimentId}`)
  console.log()

  const runId = createRun("prose", seeds.length.toString(), `${writer.label} / ${judges.map(j => j.label).join(",")}`, experimentId)

  // Track all scores in memory for reporting
  const allScores: Array<{ seed: string; run: number; dim: Dimension; count: number; wordCount: number }> = []

  // Track generations for batch mode
  const generatedProse: Array<{ genId: number; seed: string; prose: string; words: number }> = []

  // ── Generate + judge all seeds ───────────────────────────────────────

  await Promise.all(
    seeds.map(async (seed) => {
      for (let run = 1; run <= RUNS_PER_SEED; run++) {
        console.log(`[${seed.name}] Run ${run}/${RUNS_PER_SEED}...`)

        const result = await generateProse(writer, WRITER_AGENT_PROMPT, seed.prompt, runId, seed.name, run)
        if (!result) {
          saveGeneration(runId, seed.name, run, { passed: false })
          console.log(`[${seed.name}] Run ${run}: FAIL`)
          continue
        }

        const words = result.prose.split(/\s+/).length
        const genId = saveGeneration(runId, seed.name, run, {
          prose: result.prose, wordCount: words, latencyMs: result.latencyMs,
          tokensPerSec: result.tps, completionTokens: result.tokens, passed: true,
        })

        console.log(`[${seed.name}] Run ${run}: ${words}w ${result.tps}tok/s ${(result.latencyMs / 1000).toFixed(1)}s`)

        if (BATCH_MODE) {
          generatedProse.push({ genId, seed: seed.name, prose: result.prose, words })
        } else {
          // Judge — all judges x all dimensions concurrently
          const judgeJobs = judges.flatMap(judge =>
            DIMENSIONS.map(async (dim) => {
              const penalty = await judgeDimension(judge, dim, result.prose, runId, seed.name)
              if (penalty) {
                saveScore(genId, judge.label, dim, penalty.count, JSON.stringify(penalty.issues))
                allScores.push({ seed: seed.name, run, dim, count: penalty.count, wordCount: words })
                console.log(`  [${seed.name}:${run}] ${DIMENSION_LABELS[dim]}: ${penalty.count} issues`)
              }
              return { judge: judge.label, dim, penalty }
            })
          )
          await Promise.all(judgeJobs)
        }
      }
    })
  )

  // ── Auto-lint ─────────────────────────────────────────────────────────

  const lintResults = lintRun(runId)
  const totalLintIssues = lintResults.reduce((s, r) => s + r.result.totalIssues, 0)
  if (totalLintIssues > 0) {
    console.log(`\n  Lint: ${totalLintIssues} deterministic issues flagged`)
  }

  // ── Batch submission (if --batch) ─────────────────────────────────────
  // Swap to BatchTransport, run judgeDimension() for each generation×dimension.
  // judgeDimension() builds the same prompts as real-time mode — transport queues them.

  if (BATCH_MODE && generatedProse.length > 0) {
    const batchTransport = new BatchTransport(getBatchProvider(BATCH_PROVIDER), BATCH_MODEL)
    setTransport(batchTransport)

    const batchModelDef = MODELS.find(m => m.id === BATCH_MODEL)
    const batchJudge = {
      label: batchModelDef?.label ?? BATCH_MODEL,
      provider: (batchModelDef?.provider ?? BATCH_PROVIDER) as any,
      model: BATCH_MODEL,
      apiUrl: "", apiKey: "",
      useMaxCompletionTokens: batchModelDef?.useMaxCompletionTokens,
    }

    // Queue all judge calls through the transport
    for (const gen of generatedProse) {
      for (const dim of DIMENSIONS) {
        await judgeDimension(batchJudge, dim, gen.prose, runId, gen.seed, `gen-${gen.genId}-${dim}`)
      }
    }

    // Register in DB and flush
    const batchId = createBatch(runId, BATCH_PROVIDER, BATCH_MODEL)
    for (const q of batchTransport.getQueue()) {
      const parts = q.customId.match(/^gen-(\d+)-(.+)$/)
      if (parts) addBatchRequest(batchId, q.customId, parseInt(parts[1]), parts[2])
    }

    const providerBatchId = await batchTransport.flush()
    const requestCount = batchTransport.queueSize()
    updateBatchSubmitted(batchId, providerBatchId, `data/batches/input-*.jsonl`, requestCount)

    console.log(`\n  Batch submitted: ${requestCount} judge calls via ${BATCH_PROVIDER}/${BATCH_MODEL}`)
    console.log(`  Provider batch ID: ${providerBatchId}`)
    console.log(`  Local batch: #${batchId}`)
    console.log(`  Check status: bun benchmark/batch/status.ts`)
    console.log(`  Collect results: bun benchmark/batch/collect.ts`)
    console.log(`\n  Run ID: ${runId}`)
    console.log(`  DB: data/harness.db`)
    return
  }

  // ── Report (only in non-batch mode) ────────────────────────────────────

  console.log("\n" + "=".repeat(60))
  console.log("  BENCHMARK RESULTS (penalty — lower = better)")
  console.log("=".repeat(60))

  console.log(`\n  Writer: ${writer.label}`)
  console.log(`  Judge: ${judges.map(j => j.label).join(", ")}`)
  console.log(`  Seeds: ${seeds.length} x ${RUNS_PER_SEED} runs`)

  // Per-dimension averages (raw + normalized)
  const per1k = (s: { count: number; wordCount: number }) => s.wordCount > 0 ? s.count / s.wordCount * 1000 : 0
  const avgWords = mean(allScores.map(s => s.wordCount))

  console.log(`\n  Per-dimension averages (raw issues | per 1k words):`)
  const dimStats: Array<{ dim: Dimension; avg: number; std: number; normAvg: number; normStd: number }> = []
  for (const dim of DIMENSIONS) {
    const dimScores = allScores.filter(s => s.dim === dim)
    const counts = dimScores.map(s => s.count)
    const norms = dimScores.map(per1k)
    const avg = mean(counts), std = stddev(counts)
    const normAvg = mean(norms), normStd = stddev(norms)
    dimStats.push({ dim, avg, std, normAvg, normStd })
    console.log(`    ${DIMENSION_LABELS[dim].padEnd(14)} ${avg.toFixed(1)} issues (+-${std.toFixed(1)})  |  ${normAvg.toFixed(1)}/1k (+-${normStd.toFixed(1)})`)
  }
  const totalAvg = mean(allScores.map(s => s.count))
  const totalStd = stddev(allScores.map(s => s.count))
  const totalNormAvg = mean(allScores.map(per1k))
  const totalNormStd = stddev(allScores.map(per1k))
  console.log(`    ${"TOTAL".padEnd(14)} ${totalAvg.toFixed(1)} issues/dim (+-${totalStd.toFixed(1)})  |  ${totalNormAvg.toFixed(1)}/1k (+-${totalNormStd.toFixed(1)})`)
  console.log(`    Avg word count: ${avgWords.toFixed(0)}`)

  // Per-seed breakdown
  console.log(`\n  Per-seed breakdown:`)
  for (const seed of seeds) {
    const seedScores = allScores.filter(s => s.seed === seed.name)
    const seedWords = mean(seedScores.map(s => s.wordCount))
    const dimStr = DIMENSIONS.map(dim => {
      const dimScores = seedScores.filter(s => s.dim === dim)
      return `${DIMENSION_LABELS[dim]}:${mean(dimScores.map(s => s.count)).toFixed(1)}(${mean(dimScores.map(per1k)).toFixed(1)}/1k)`
    }).join(" ")
    const seedAvg = mean(seedScores.map(s => s.count))
    console.log(`    ${seed.name.padEnd(24)} ${dimStr} (avg ${seedAvg.toFixed(1)}, ${seedWords.toFixed(0)}w)`)
  }

  // Commit-ready summary
  const dimShort = dimStats.map(d => {
    const label = d.dim === "telling" ? "T" : d.dim === "dead-weight" ? "W" : "D"
    return `${label}:${d.avg.toFixed(1)}`
  }).join(" ")
  const normShort = dimStats.map(d => {
    const label = d.dim === "telling" ? "T" : d.dim === "dead-weight" ? "W" : "D"
    return `${label}:${d.normAvg.toFixed(1)}`
  }).join(" ")
  const summary = `benchmark: ${totalAvg.toFixed(1)} issues/dim (+-${totalStd.toFixed(1)}) ${dimShort} | norm: ${totalNormAvg.toFixed(1)}/1k ${normShort}`
  console.log(`\n  Commit line:\n  ${summary}\n  ${seeds.length} seeds x ${RUNS_PER_SEED} runs | penalty mode`)

  // ── Compare to baseline ────────────────────────────────────────────────

  const baselineAvgs = getBaselineAverages("prose")
  if (baselineAvgs) {
    console.log(`\n  vs Baseline:`)
    for (const dim of DIMENSIONS) {
      const current = dimStats.find(d => d.dim === dim)
      const baseline = baselineAvgs.find(d => d.dimension === dim)
      if (current && baseline) {
        const delta = Math.round((current.avg - baseline.avg) * 10) / 10
        if (Math.abs(delta) >= 0.2) {
          const arrow = delta < 0 ? "" : "+"
          const quality = delta < 0 ? "(better)" : "(worse)"
          console.log(`    ${DIMENSION_LABELS[dim]}: ${arrow}${delta} issues (${baseline.avg} -> ${current.avg.toFixed(1)}) ${quality}`)
        }
      }
    }
  }

  // ── Cost & TPS summary ─────────────────────────────────────────────────

  const callSummary = getCallSummary(runId)
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
    markBaseline(runId, "prose")
    console.log(`\n  Run ${runId} saved as baseline.`)
  }

  console.log(`\n  Run ID: ${runId}`)
  console.log(`  DB: data/harness.db`)
}

main()
