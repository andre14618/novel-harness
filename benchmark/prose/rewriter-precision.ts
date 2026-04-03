/**
 * Rewriter precision measurement.
 *
 * Generates prose → judges it → rewrites using judge issues → re-judges → compares.
 * Measures whether the rewriter actually reduces penalty counts.
 *
 * Usage: BENCHMARK_SEEDS=romance-drama EXPERIMENT_ID=N bun benchmark/prose/rewriter-precision.ts
 */

import { readFileSync } from "node:fs"
import { WRITER_AGENT_PROMPT } from "../../src/prompts"
import { getWriter, getJudges } from "../config"
import { DIMENSIONS, DIMENSION_LABELS, type Dimension } from "./judges/schema"
import { createRun, saveGeneration, saveScore, getCallSummary } from "../db"
import { createTuningExperiment, concludeExperiment } from "../../data/db"
import { loadSeeds, generateProse, judgeDimension, mean, stddev } from "./shared"
import { getTransport } from "../../src/transport"
import { getAgentConfig } from "../../models/roles"
import { extractJSON } from "../../src/llm"

const REWRITER_PROMPT = readFileSync(new URL("../../src/agents/rewriter/prompt.md", import.meta.url).pathname, "utf-8")

const RUNS = parseInt(process.env.BENCHMARK_RUNS ?? "2")

interface ScoreEntry { seed: string; dim: Dimension; count: number; wordCount: number }

async function rewriteProse(
  prose: string,
  issues: Array<{ dim: string; issues: Array<{ quote: string; problem: string }> }>,
): Promise<string | null> {
  const issueList = issues
    .flatMap(d => d.issues.map(i => `[${d.dim}] "${i.quote}" — ${i.problem}`))
    .join("\n")

  const userPrompt = `ISSUES TO FIX:\n${issueList}\n\nORIGINAL PROSE:\n${prose}`

  const rewriterConfig = getAgentConfig("rewriter")

  try {
    const response = await getTransport().execute({
      systemPrompt: REWRITER_PROMPT,
      userPrompt,
      model: rewriterConfig.model,
      provider: rewriterConfig.provider,
      temperature: rewriterConfig.temperature,
      maxTokens: rewriterConfig.maxTokens,
      responseFormat: { type: "json_object" },
    })

    const json = extractJSON(response.content)
    const parsed = JSON.parse(json)
    return parsed.prose ?? null
  } catch (err) {
    console.error("  Rewrite failed:", err instanceof Error ? err.message : err)
    return null
  }
}

async function main() {
  const writer = getWriter()
  const judges = getJudges()
  const judge = judges[0]
  const seedFilter = process.env.BENCHMARK_SEEDS?.split(",").map(s => s.trim())
  const seeds = loadSeeds(seedFilter)
  const experimentId = process.env.EXPERIMENT_ID ? parseInt(process.env.EXPERIMENT_ID) : undefined

  if (!experimentId) {
    console.error("EXPERIMENT_ID required")
    process.exit(1)
  }

  console.log(`\nRewriter Precision Measurement`)
  console.log(`Writer: ${writer.label}`)
  console.log(`Judge: ${judge.label}`)
  console.log(`Seeds: ${seeds.map(s => s.name).join(", ")}`)
  console.log(`Runs per seed: ${RUNS}`)
  console.log(`Experiment: #${experimentId}\n`)

  const preRunId = await createRun("prose", seeds.length.toString(), `rewriter-precision-pre / ${writer.label}`, experimentId)
  const postRunId = await createRun("prose", seeds.length.toString(), `rewriter-precision-post / ${writer.label}`, experimentId)

  const preScores: ScoreEntry[] = []
  const postScores: ScoreEntry[] = []

  for (const seed of seeds) {
    for (let run = 1; run <= RUNS; run++) {
      console.log(`[${seed.name}] Run ${run}/${RUNS}`)

      // 1. Generate
      const result = await generateProse(writer, WRITER_AGENT_PROMPT, seed.prompt, preRunId, seed.name, run)
      if (!result) { console.log("  Generation failed, skipping"); continue }
      const words = result.prose.split(/\s+/).length
      const preGenId = await saveGeneration(preRunId, seed.name, run, {
        prose: result.prose, wordCount: words, latencyMs: result.latencyMs,
        tokensPerSec: result.tps, completionTokens: result.tokens, passed: true,
      })
      console.log(`  Generated: ${words}w`)

      // 2. Judge original
      const allIssues: Array<{ dim: string; issues: Array<{ quote: string; problem: string }> }> = []
      for (const dim of DIMENSIONS) {
        const penalty = await judgeDimension(judge, dim, result.prose, preRunId, seed.name)
        if (penalty) {
          await saveScore(preGenId, judge.label, dim, penalty.count, JSON.stringify(penalty.issues))
          preScores.push({ seed: seed.name, dim, count: penalty.count, wordCount: words })
          allIssues.push({ dim, issues: penalty.issues })
          console.log(`  Pre  ${DIMENSION_LABELS[dim]}: ${Math.abs(penalty.count)} issues`)
        }
      }

      const totalPreIssues = allIssues.reduce((s, d) => s + d.issues.length, 0)
      if (totalPreIssues === 0) {
        console.log("  No issues found — skipping rewrite")
        continue
      }

      // 3. Rewrite
      const rewritten = await rewriteProse(result.prose, allIssues)
      if (!rewritten) { console.log("  Rewrite failed"); continue }
      const rewrittenWords = rewritten.split(/\s+/).length
      const postGenId = await saveGeneration(postRunId, seed.name, run, {
        prose: rewritten, wordCount: rewrittenWords, passed: true,
        variantLabel: "rewritten",
      })
      console.log(`  Rewritten: ${rewrittenWords}w`)

      // 4. Re-judge
      for (const dim of DIMENSIONS) {
        const penalty = await judgeDimension(judge, dim, rewritten, postRunId, seed.name)
        if (penalty) {
          await saveScore(postGenId, judge.label, dim, penalty.count, JSON.stringify(penalty.issues))
          postScores.push({ seed: seed.name, dim, count: penalty.count, wordCount: rewrittenWords })
          console.log(`  Post ${DIMENSION_LABELS[dim]}: ${Math.abs(penalty.count)} issues`)
        }
      }
      console.log()
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────

  console.log("=".repeat(60))
  console.log("  REWRITER PRECISION RESULTS")
  console.log("=".repeat(60))

  console.log(`\n  Per-dimension (issue counts):`)
  const abs = (n: number) => Math.abs(n)
  const results: Array<{ dim: string; pre: number; post: number; delta: number }> = []
  for (const dim of DIMENSIONS) {
    const pre = preScores.filter(s => s.dim === dim)
    const post = postScores.filter(s => s.dim === dim)
    if (pre.length === 0) continue
    const preAvg = mean(pre.map(s => abs(s.count)))
    const postAvg = mean(post.map(s => abs(s.count)))
    const delta = postAvg - preAvg
    results.push({ dim, pre: preAvg, post: postAvg, delta })
    const arrow = delta < 0 ? "improved" : delta > 0 ? "worse" : "same"
    console.log(`    ${DIMENSION_LABELS[dim].padEnd(14)} ${preAvg.toFixed(1)} → ${postAvg.toFixed(1)} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}) ${arrow}`)
  }

  const totalPre = mean(preScores.map(s => abs(s.count)))
  const totalPost = mean(postScores.map(s => abs(s.count)))
  const totalDelta = totalPost - totalPre
  console.log(`    ${"TOTAL".padEnd(14)} ${totalPre.toFixed(1)} → ${totalPost.toFixed(1)} (${totalDelta >= 0 ? "+" : ""}${totalDelta.toFixed(1)})`)

  // Cost
  const preCost = await getCallSummary(preRunId)
  const postCost = await getCallSummary(postRunId)
  const totalCost = [...preCost, ...postCost].reduce((s, c) => s + c.totalCost, 0)
  console.log(`\n  Total cost: $${totalCost.toFixed(4)}`)

  // Conclude experiment
  const conclusion = results.map(r =>
    `${r.dim}: ${r.pre.toFixed(1)} → ${r.post.toFixed(1)} (${r.delta >= 0 ? "+" : ""}${r.delta.toFixed(1)})`
  ).join(", ")
  await concludeExperiment(experimentId, `Rewriter precision: ${conclusion}. Total delta: ${totalDelta >= 0 ? "+" : ""}${totalDelta.toFixed(1)}. Cost: $${totalCost.toFixed(4)}`)

  console.log(`\n  Pre run ID: ${preRunId}`)
  console.log(`  Post run ID: ${postRunId}`)
  console.log(`  Experiment: #${experimentId}`)
}

main()
