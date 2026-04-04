/**
 * Lint-only rewriting model sweep — inline edits only.
 *
 * Pulls existing prose from a previous run, runs lint, then rewrites
 * with each model using a constrained "inline fix only" prompt.
 *
 * Measures:
 *   - Lint compliance: did the model fix the flagged patterns?
 *   - Collateral damage: how many non-flagged characters changed?
 *   - Word count delta: should be near-zero for true inline edits
 *
 * Usage:
 *   SOURCE_RUN=204 bun benchmark/prose/lint-rewrite-model-sweep.ts
 */

import { readFileSync } from "node:fs"
import db from "../../data/connection"
import { createRun, saveGeneration, saveLLMCall } from "../db"
import { createTuningExperiment, concludeExperiment } from "../../data/db"
import { getTransport } from "../../src/transport"
import { extractJSON } from "../../src/llm"
import { lintProse, saveLintIssues, type LintIssue } from "../../src/lint"
import { mean } from "./shared"

const LINT_REWRITER_PROMPT = readFileSync(
  new URL("../../src/agents/lint-rewriter/prompt.md", import.meta.url).pathname, "utf-8",
)

interface ModelVariant {
  label: string
  provider: string
  model: string
  temperature: number
}

const MODELS: ModelVariant[] = [
  { label: "Kimi K2", provider: "groq", model: "moonshotai/kimi-k2-instruct-0905", temperature: 0.3 },
  { label: "Qwen3 32B", provider: "groq", model: "qwen/qwen3-32b", temperature: 0.3 },
  { label: "Qwen3 235B", provider: "cerebras", model: "qwen-3-235b-a22b-instruct-2507", temperature: 0.3 },
]

// ── Rewriter call ─────────────────────────────────────────────────────

async function rewriteWithModel(
  variant: ModelVariant, prose: string, issueText: string, runId: number, seed: string,
): Promise<{ prose: string; tokens: number; latencyMs: number; cost: number } | null> {
  if (!issueText.trim()) return null
  const userPrompt = `FLAGGED PATTERNS TO FIX:\n${issueText}\n\nPROSE:\n${prose}`

  const start = Date.now()
  try {
    const response = await getTransport().execute({
      systemPrompt: LINT_REWRITER_PROMPT,
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

    const promptTokens = response.usage?.prompt_tokens ?? 0
    const completionTokens = response.usage?.completion_tokens ?? 0
    const { getTokenCost } = await import("../../models/registry")
    const cost = getTokenCost(variant.provider as any, variant.model, promptTokens, completionTokens)
    await saveLLMCall(runId, "lint-rewriter", null, variant.model, variant.provider, promptTokens, completionTokens, latencyMs, cost, { seed })

    return { prose: rewritten, tokens: completionTokens, latencyMs, cost }
  } catch (err) {
    console.error(`  [${variant.label}] Failed:`, err instanceof Error ? err.message : err)
    return null
  }
}

// ── Collateral damage measurement ─────────────────────────────────────

function measureCollateral(original: string, rewritten: string): { editDistance: number; changedChars: number; totalChars: number } {
  // Simple character-level diff: count characters that differ
  const maxLen = Math.max(original.length, rewritten.length)
  let changed = 0
  for (let i = 0; i < maxLen; i++) {
    if (original[i] !== rewritten[i]) changed++
  }
  return { editDistance: changed, changedChars: changed, totalChars: original.length }
}

function formatLintIssues(issues: LintIssue[]): string {
  return issues
    .map(i => `- "${i.match}" → ${i.fixTemplate} (in sentence: "${i.sentence.slice(0, 100)}")`)
    .join("\n")
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const sourceRunId = parseInt(process.env.SOURCE_RUN ?? "")
  if (!sourceRunId) {
    console.error("SOURCE_RUN=<run_id> required")
    process.exit(1)
  }

  const gens = await db`
    SELECT id, seed, prose, word_count, attempt
    FROM generations
    WHERE run_id = ${sourceRunId} AND passed = true AND prose IS NOT NULL
    ORDER BY seed, attempt
  ` as Array<{ id: number; seed: string; prose: string; word_count: number; attempt: number }>

  if (gens.length === 0) { console.error(`No generations in run ${sourceRunId}`); process.exit(1) }
  const seeds = [...new Set(gens.map(g => g.seed))]

  const experimentId = await createTuningExperiment(
    "lint-rewriter",
    "lint-rewrite-inline-sweep",
    `Inline lint rewriting: ${MODELS.map(m => m.label).join(", ")}. Source run: ${sourceRunId}. Measures: lint compliance, collateral damage, word delta.`,
  )

  console.log(`\nLint Inline Rewrite Model Sweep`)
  console.log(`Source: run ${sourceRunId} (${gens.length} generations)`)
  console.log(`Models: ${MODELS.map(m => m.label).join(", ")}`)
  console.log(`Experiment: #${experimentId}\n`)

  const modelRuns: Record<string, number> = {}
  for (const v of MODELS) {
    modelRuns[v.label] = await createRun("prose", seeds.length.toString(), `lint-inline-${v.label}`, experimentId)
  }

  // Accumulators
  const stats: Record<string, {
    lintPre: number[]; lintPost: number[]; wordPre: number[]; wordPost: number[]
    collateral: number[]; totalChars: number[]; latency: number[]; cost: number[]
  }> = {}
  for (const v of MODELS) {
    stats[v.label] = { lintPre: [], lintPost: [], wordPre: [], wordPost: [], collateral: [], totalChars: [], latency: [], cost: [] }
  }

  for (const gen of gens) {
    const lintResult = await lintProse(gen.prose)
    const issueText = formatLintIssues(lintResult.issues)
    console.log(`[${gen.seed}] gen ${gen.id} (${gen.word_count}w, ${lintResult.totalIssues} lint issues)`)

    if (!issueText.trim()) {
      console.log(`  No lint issues — skipping`)
      continue
    }

    for (const variant of MODELS) {
      const result = await rewriteWithModel(variant, gen.prose, issueText, modelRuns[variant.label], gen.seed)
      if (!result) { console.log(`  [${variant.label}] FAILED`); continue }

      const rewrittenWords = result.prose.split(/\s+/).length
      const postLint = await lintProse(result.prose)
      const collateral = measureCollateral(gen.prose, result.prose)

      await saveGeneration(modelRuns[variant.label], gen.seed, gen.attempt, {
        prose: result.prose, wordCount: rewrittenWords, passed: true,
        variantLabel: variant.label, latencyMs: result.latencyMs,
        completionTokens: result.tokens,
      })
      await saveLintIssues(
        (await db`SELECT id FROM generations WHERE run_id = ${modelRuns[variant.label]} ORDER BY id DESC LIMIT 1` as any[])[0].id,
        postLint.issues,
      )

      const s = stats[variant.label]
      s.lintPre.push(lintResult.totalIssues)
      s.lintPost.push(postLint.totalIssues)
      s.wordPre.push(gen.word_count)
      s.wordPost.push(rewrittenWords)
      s.collateral.push(collateral.changedChars)
      s.totalChars.push(collateral.totalChars)
      s.latency.push(result.latencyMs)
      s.cost.push(result.cost)

      const collateralPct = ((collateral.changedChars / collateral.totalChars) * 100).toFixed(1)
      console.log(`  [${variant.label}] lint: ${lintResult.totalIssues}→${postLint.totalIssues} | words: ${gen.word_count}→${rewrittenWords} | collateral: ${collateralPct}% chars changed | ${result.latencyMs}ms | $${result.cost.toFixed(4)}`)
    }
    console.log()
  }

  // ── Report ────────────────────────────────────────────────────────────

  console.log("=".repeat(80))
  console.log("  LINT INLINE REWRITE — MODEL COMPARISON")
  console.log("=".repeat(80))

  console.log(`\n  ${"Model".padEnd(20)} ${"Lint Fix".padStart(10)} ${"Word Δ".padStart(10)} ${"Collateral".padStart(12)} ${"Latency".padStart(10)} ${"Cost/call".padStart(10)}`)
  console.log("  " + "-".repeat(74))

  const conclusions: string[] = []
  for (const variant of MODELS) {
    const s = stats[variant.label]
    if (s.lintPre.length === 0) continue

    const lintFixed = mean(s.lintPre) - mean(s.lintPost)
    const lintPct = ((lintFixed / mean(s.lintPre)) * 100).toFixed(0)
    const wordDelta = mean(s.wordPost) - mean(s.wordPre)
    const wordPct = ((mean(s.wordPost) / mean(s.wordPre)) * 100).toFixed(0)
    const collateralPct = ((mean(s.collateral) / mean(s.totalChars)) * 100).toFixed(1)
    const avgLatency = mean(s.latency).toFixed(0)
    const avgCost = mean(s.cost).toFixed(4)

    console.log(
      `  ${variant.label.padEnd(20)} ` +
      `${lintFixed.toFixed(1)}/${mean(s.lintPre).toFixed(1)} (${lintPct}%)`.padStart(10) + " " +
      `${wordDelta >= 0 ? "+" : ""}${wordDelta.toFixed(0)}w (${wordPct}%)`.padStart(10) + " " +
      `${collateralPct}% chars`.padStart(12) + " " +
      `${avgLatency}ms`.padStart(10) + " " +
      `$${avgCost}`.padStart(10),
    )

    conclusions.push(`${variant.label}: ${lintPct}% fixed, ${collateralPct}% collateral, ${wordPct}% words, $${avgCost}/call`)
  }

  console.log(`\n  Experiment: #${experimentId}`)
  for (const v of MODELS) console.log(`  ${v.label} run: ${modelRuns[v.label]}`)

  await concludeExperiment(experimentId, conclusions.join("; "))
}

main()
