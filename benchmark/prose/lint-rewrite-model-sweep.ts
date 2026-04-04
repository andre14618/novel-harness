/**
 * Lint-only rewriting model sweep.
 *
 * Pulls existing prose from a previous experiment's pre-run, then runs
 * lint-only rewrites across multiple models to compare quality and cost.
 * No new prose generation — reuses existing generations.
 *
 * Usage:
 *   SOURCE_RUN=204 bun benchmark/prose/lint-rewrite-model-sweep.ts
 *   SOURCE_RUN=204 BENCHMARK_JUDGES="DeepSeek V3.2 Reasoner" bun benchmark/prose/lint-rewrite-model-sweep.ts
 */

import { readFileSync } from "node:fs"
import db from "../../data/connection"
import { getJudges } from "../config"
import { DIMENSIONS, DIMENSION_LABELS, type Dimension } from "./judges/schema"
import { createRun, saveGeneration, saveScore, getCallSummary, saveLLMCall } from "../db"
import { createTuningExperiment, concludeExperiment } from "../../data/db"
import { judgeDimension, mean } from "./shared"
import { getTransport } from "../../src/transport"
import { extractJSON } from "../../src/llm"
import { lintProse, saveLintIssues, type LintIssue } from "../../src/lint"

const REWRITER_PROMPT = readFileSync(new URL("../../src/agents/rewriter/prompt.md", import.meta.url).pathname, "utf-8")

interface ModelVariant {
  label: string
  provider: string
  model: string
  temperature: number
}

const MODELS: ModelVariant[] = [
  { label: "Kimi K2 (Groq)", provider: "groq", model: "moonshotai/kimi-k2-instruct-0905", temperature: 0.5 },
  { label: "Qwen3 32B (Groq)", provider: "groq", model: "qwen/qwen3-32b", temperature: 0.5 },
  { label: "Qwen3 235B (Cerebras)", provider: "cerebras", model: "qwen-3-235b-a22b-instruct-2507", temperature: 0.5 },
]

interface ScoreEntry { seed: string; dim: Dimension; count: number; wordCount: number }

// ── Rewriter call ─────────────────────────────────────────────────────

async function rewriteWithModel(
  variant: ModelVariant, prose: string, issueText: string, runId: number, seed: string,
): Promise<{ prose: string; tokens: number; latencyMs: number } | null> {
  if (!issueText.trim()) return null
  const userPrompt = `ISSUES TO FIX:\n${issueText}\n\nORIGINAL PROSE:\n${prose}`

  const start = Date.now()
  try {
    const response = await getTransport().execute({
      systemPrompt: REWRITER_PROMPT,
      userPrompt,
      model: variant.model,
      provider: variant.provider as any,
      temperature: variant.temperature,
      maxTokens: 16384,
      responseFormat: { type: "json_object" },
    })
    const latencyMs = Date.now() - start
    const json = extractJSON(response.content)
    const parsed = JSON.parse(json)
    const rewritten = parsed.prose ?? null
    if (!rewritten) return null

    // Log the LLM call for cost tracking
    const promptTokens = response.usage?.prompt_tokens ?? 0
    const completionTokens = response.usage?.completion_tokens ?? 0
    const { getTokenCost } = await import("../../models/registry")
    const cost = getTokenCost(variant.provider as any, variant.model, promptTokens, completionTokens)
    await saveLLMCall(runId, "rewriter", null, variant.model, variant.provider, promptTokens, completionTokens, latencyMs, cost, { seed })

    return { prose: rewritten, tokens: completionTokens, latencyMs }
  } catch (err) {
    console.error(`  [${variant.label}] Rewrite failed:`, err instanceof Error ? err.message : err)
    return null
  }
}

function formatLintIssues(issues: LintIssue[]): string {
  return issues
    .map(i => `[lint:${i.category}] "${i.match}" — ${i.fixTemplate} (in: "${i.sentence.slice(0, 80)}")`)
    .join("\n")
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const sourceRunId = parseInt(process.env.SOURCE_RUN ?? "")
  if (!sourceRunId) {
    console.error("SOURCE_RUN=<run_id> required (the pre-run with existing prose)")
    process.exit(1)
  }

  const judges = getJudges()
  const judge = judges[0]

  // Load existing generations from source run
  const gens = await db`
    SELECT id, seed, prose, word_count, attempt
    FROM generations
    WHERE run_id = ${sourceRunId} AND passed = true AND prose IS NOT NULL
    ORDER BY seed, attempt
  ` as Array<{ id: number; seed: string; prose: string; word_count: number; attempt: number }>

  if (gens.length === 0) {
    console.error(`No generations found in run ${sourceRunId}`)
    process.exit(1)
  }

  const seeds = [...new Set(gens.map(g => g.seed))]

  const experimentId = await createTuningExperiment(
    "rewriter",
    "lint-rewrite-model-sweep",
    `Lint-only rewriting across ${MODELS.length} models. Source run: ${sourceRunId}. Seeds: ${seeds.join(", ")}. Models: ${MODELS.map(m => m.label).join(", ")}.`,
  )

  console.log(`\nLint-Only Rewriting Model Sweep`)
  console.log(`Source run: ${sourceRunId} (${gens.length} generations)`)
  console.log(`Judge: ${judge.label}`)
  console.log(`Seeds: ${seeds.join(", ")}`)
  console.log(`Models: ${MODELS.map(m => m.label).join(", ")}`)
  console.log(`Experiment: #${experimentId}\n`)

  // Create a run per model
  const modelRuns: Record<string, number> = {}
  for (const variant of MODELS) {
    modelRuns[variant.label] = await createRun("prose", seeds.length.toString(), `lint-sweep-${variant.label}`, experimentId)
  }

  const modelScores: Record<string, ScoreEntry[]> = {}
  const modelLintDeltas: Record<string, { pre: number; post: number }[]> = {}
  const modelWordCounts: Record<string, { pre: number; post: number }[]> = {}
  for (const v of MODELS) {
    modelScores[v.label] = []
    modelLintDeltas[v.label] = []
    modelWordCounts[v.label] = []
  }

  for (const gen of gens) {
    console.log(`[${gen.seed}] gen ${gen.id} (${gen.word_count}w)`)

    // Lint the original
    const lintResult = await lintProse(gen.prose)
    const lintIssueText = formatLintIssues(lintResult.issues)
    console.log(`  Lint: ${lintResult.totalIssues} issues`)

    if (!lintIssueText.trim()) {
      console.log(`  No lint issues — skipping all models`)
      continue
    }

    // Rewrite with each model
    for (const variant of MODELS) {
      const runId = modelRuns[variant.label]
      const result = await rewriteWithModel(variant, gen.prose, lintIssueText, runId, gen.seed)

      if (!result) { console.log(`  [${variant.label}] FAILED`); continue }

      const rewrittenWords = result.prose.split(/\s+/).length
      const genId = await saveGeneration(runId, gen.seed, gen.attempt, {
        prose: result.prose, wordCount: rewrittenWords, passed: true,
        variantLabel: variant.label, latencyMs: result.latencyMs,
        completionTokens: result.tokens, tokensPerSec: Math.round(result.tokens / (result.latencyMs / 1000)),
      })

      modelWordCounts[variant.label].push({ pre: gen.word_count, post: rewrittenWords })

      // Re-lint
      const postLint = await lintProse(result.prose)
      await saveLintIssues(genId, postLint.issues)
      modelLintDeltas[variant.label].push({ pre: lintResult.totalIssues, post: postLint.totalIssues })

      // Judge
      for (const dim of DIMENSIONS) {
        const penalty = await judgeDimension(judge, dim, result.prose, runId, gen.seed)
        if (penalty) {
          await saveScore(genId, judge.label, dim, penalty.count, JSON.stringify(penalty.issues))
          modelScores[variant.label].push({ seed: gen.seed, dim, count: penalty.count, wordCount: rewrittenWords })
        }
      }

      console.log(`  [${variant.label}] ${rewrittenWords}w (${result.latencyMs}ms) lint: ${lintResult.totalIssues}→${postLint.totalIssues}`)
    }
    console.log()
  }

  // ── Also judge the originals for baseline comparison ────────────────
  console.log("Judging originals for baseline...")
  const sourceRunForJudge = await createRun("prose", seeds.length.toString(), `lint-sweep-original / baseline`, experimentId)
  const origScores: ScoreEntry[] = []
  for (const gen of gens) {
    const origGenId = await saveGeneration(sourceRunForJudge, gen.seed, gen.attempt, {
      prose: gen.prose, wordCount: gen.word_count, passed: true, variantLabel: "original",
    })
    for (const dim of DIMENSIONS) {
      const penalty = await judgeDimension(judge, dim, gen.prose, sourceRunForJudge, gen.seed)
      if (penalty) {
        await saveScore(origGenId, judge.label, dim, penalty.count, JSON.stringify(penalty.issues))
        origScores.push({ seed: gen.seed, dim, count: penalty.count, wordCount: gen.word_count })
      }
    }
  }

  // ── Report ────────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(80))
  console.log("  LINT-ONLY REWRITING MODEL SWEEP")
  console.log("=".repeat(80))

  // Header
  const modelLabels = MODELS.map(m => m.label)
  console.log(`\n  Judge penalties (pre → post):`)
  console.log(`  ${"Dimension".padEnd(16)}${"Original".padStart(10)}  ${modelLabels.map(l => l.padStart(22)).join("  ")}`)
  console.log("  " + "-".repeat(16 + 10 + modelLabels.length * 24))

  for (const dim of DIMENSIONS) {
    const orig = origScores.filter(s => s.dim === dim)
    if (orig.length === 0) continue
    const origAvg = mean(orig.map(s => Math.abs(s.count)))

    const cells = [DIMENSION_LABELS[dim].padEnd(16), origAvg.toFixed(1).padStart(10)]
    for (const label of modelLabels) {
      const post = modelScores[label].filter(s => s.dim === dim)
      if (post.length === 0) { cells.push("n/a".padStart(22)); continue }
      const postAvg = mean(post.map(s => Math.abs(s.count)))
      const delta = postAvg - origAvg
      const arrow = delta < -0.5 ? " ✓" : delta > 0.5 ? " ✗" : ""
      cells.push(`${postAvg.toFixed(1)} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)})${arrow}`.padStart(22))
    }
    console.log("  " + cells.join("  "))
  }

  // Lint compliance
  console.log(`\n  Lint compliance:`)
  for (const label of modelLabels) {
    const d = modelLintDeltas[label]
    if (d.length === 0) continue
    const pre = mean(d.map(x => x.pre))
    const post = mean(d.map(x => x.post))
    console.log(`    ${label.padEnd(24)} ${pre.toFixed(1)} → ${post.toFixed(1)} (${(post - pre >= 0 ? "+" : "")}${(post - pre).toFixed(1)})`)
  }

  // Word count
  console.log(`\n  Word count preservation:`)
  for (const label of modelLabels) {
    const wc = modelWordCounts[label]
    if (wc.length === 0) continue
    const pre = mean(wc.map(x => x.pre))
    const post = mean(wc.map(x => x.post))
    console.log(`    ${label.padEnd(24)} ${pre.toFixed(0)}w → ${post.toFixed(0)}w (${((post / pre) * 100).toFixed(0)}%)`)
  }

  // Cost
  const allRunIds = [sourceRunForJudge, ...Object.values(modelRuns)]
  let totalCost = 0
  for (const rid of allRunIds) {
    const summary = await getCallSummary(rid)
    totalCost += summary.reduce((s, c) => s + c.totalCost, 0)
  }
  console.log(`\n  Total cost: $${totalCost.toFixed(4)}`)

  // Run IDs for pairwise follow-up
  console.log(`\n  Experiment: #${experimentId}`)
  console.log(`  Original baseline run: ${sourceRunForJudge}`)
  for (const label of modelLabels) console.log(`  ${label} run: ${modelRuns[label]}`)

  await concludeExperiment(experimentId, `Lint-sweep: ${modelLabels.join(", ")}. Cost: $${totalCost.toFixed(4)}`)
}

main()
