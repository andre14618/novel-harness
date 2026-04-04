/**
 * Hybrid lint fix experiment.
 *
 * Tests the deterministic + LLM per-sentence lint fixer against
 * existing prose. Measures:
 *   - How many fixes are deterministic vs LLM
 *   - Lint compliance after fixing
 *   - Collateral damage (character-level diff)
 *   - Cost (should be near-zero for deterministic, pennies for LLM)
 *
 * Usage: SOURCE_RUN=204 bun benchmark/prose/lint-fix-experiment.ts
 */

import db from "../../data/connection"
import { createRun, saveGeneration } from "../db"
import { createTuningExperiment, concludeExperiment } from "../../data/db"
import { lintProse, saveLintIssues } from "../../src/lint"
import { fixLintIssues } from "../../src/lint/fix"
import { mean } from "./shared"

interface ModelConfig {
  label: string
  provider: string
  model: string
}

const LLM_MODELS: ModelConfig[] = [
  { label: "Qwen3 32B", provider: "groq", model: "qwen/qwen3-32b" },
  { label: "Qwen3 235B", provider: "cerebras", model: "qwen-3-235b-a22b-instruct-2507" },
]

/** Count characters that were actually edited — not shifted by earlier edits. */
function measureCollateral(original: string, rewritten: string): number {
  // Split into words and count word-level changes for a shift-resistant metric
  const origWords = original.split(/\s+/)
  const rewriteWords = rewritten.split(/\s+/)
  let changed = 0
  const maxLen = Math.max(origWords.length, rewriteWords.length)
  // Simple LCS-based approach: count words present in one but not the other
  const origSet = new Map<string, number>()
  for (const w of origWords) origSet.set(w, (origSet.get(w) ?? 0) + 1)
  for (const w of rewriteWords) {
    const count = origSet.get(w) ?? 0
    if (count > 0) origSet.set(w, count - 1)
    else changed++
  }
  // Also count words removed from original
  for (const [, count] of origSet) changed += count
  return changed
}

async function main() {
  const sourceRunId = parseInt(process.env.SOURCE_RUN ?? "")
  if (!sourceRunId) { console.error("SOURCE_RUN=<run_id> required"); process.exit(1) }

  const gens = await db`
    SELECT id, seed, prose, word_count, attempt
    FROM generations
    WHERE run_id = ${sourceRunId} AND passed = true AND prose IS NOT NULL
    ORDER BY seed, attempt
  ` as Array<{ id: number; seed: string; prose: string; word_count: number; attempt: number }>

  if (gens.length === 0) { console.error(`No generations in run ${sourceRunId}`); process.exit(1) }

  const experimentId = await createTuningExperiment(
    "lint-fix",
    "hybrid-lint-fix",
    `Hybrid lint fixer: deterministic + LLM per-sentence. Source run: ${sourceRunId}. LLM models: ${LLM_MODELS.map(m => m.label).join(", ")}.`,
  )

  console.log(`\nHybrid Lint Fix Experiment`)
  console.log(`Source: run ${sourceRunId} (${gens.length} generations)`)
  console.log(`LLM fallback models: ${LLM_MODELS.map(m => m.label).join(", ")}`)
  console.log(`Experiment: #${experimentId}\n`)

  // Arms: deterministic-only, then each LLM model as fallback
  const arms = ["deterministic-only", ...LLM_MODELS.map(m => m.label)]
  const armRuns: Record<string, number> = {}
  for (const arm of arms) {
    armRuns[arm] = await createRun("prose", "1", `lint-fix-${arm}`, experimentId)
  }

  const armStats: Record<string, {
    detFixes: number[]; llmFixes: number[]; llmCalls: number[]; unfixed: number[]
    totalIssues: number[]; lintPost: number[]; collateral: number[]; totalChars: number[]
    wordDelta: number[]; cost: number[]; latency: number[]
  }> = {}
  for (const arm of arms) {
    armStats[arm] = { detFixes: [], llmFixes: [], llmCalls: [], unfixed: [], totalIssues: [], lintPost: [], collateral: [], totalChars: [], wordDelta: [], cost: [], latency: [] }
  }

  for (const gen of gens) {
    const lintResult = await lintProse(gen.prose)
    console.log(`[${gen.seed}] gen ${gen.id} (${gen.word_count}w, ${lintResult.totalIssues} lint issues)`)

    if (lintResult.totalIssues === 0) { console.log("  No issues — skipping"); continue }

    // Arm 1: deterministic only (no LLM)
    {
      const fix = await fixLintIssues(gen.prose, lintResult.issues)
      const postLint = await lintProse(fix.prose)
      const collateral = measureCollateral(gen.prose, fix.prose)
      const wordDelta = fix.prose.split(/\s+/).length - gen.word_count
      const collateralPct = ((collateral / gen.prose.length) * 100).toFixed(1)

      const s = armStats["deterministic-only"]
      s.detFixes.push(fix.deterministicFixes)
      s.llmFixes.push(0)
      s.llmCalls.push(0)
      s.unfixed.push(fix.unfixed)
      s.totalIssues.push(lintResult.totalIssues)
      s.lintPost.push(postLint.totalIssues)
      s.collateral.push(collateral)
      s.totalChars.push(gen.prose.length)
      s.wordDelta.push(wordDelta)
      s.cost.push(0)
      s.latency.push(fix.latencyMs)

      const genId = await saveGeneration(armRuns["deterministic-only"], gen.seed, gen.attempt, {
        prose: fix.prose, wordCount: fix.prose.split(/\s+/).length, passed: true, variantLabel: "deterministic-only",
      })
      await saveLintIssues(genId, postLint.issues)

      console.log(`  [det-only] det:${fix.deterministicFixes} unfixed:${fix.unfixed}/${lintResult.totalIssues} | lint:${lintResult.totalIssues}→${postLint.totalIssues} | collateral:${collateralPct}% words | words:${wordDelta >= 0 ? "+" : ""}${wordDelta} | ${fix.latencyMs}ms | $0`)
    }

    // Arm 2+: deterministic + LLM fallback
    for (const model of LLM_MODELS) {
      const fix = await fixLintIssues(gen.prose, lintResult.issues, {
        provider: model.provider, model: model.model, temperature: 0.2,
      })
      const postLint = await lintProse(fix.prose)
      const collateral = measureCollateral(gen.prose, fix.prose)
      const wordDelta = fix.prose.split(/\s+/).length - gen.word_count
      const collateralPct = ((collateral / gen.prose.length) * 100).toFixed(1)

      const s = armStats[model.label]
      s.detFixes.push(fix.deterministicFixes)
      s.llmFixes.push(fix.llmFixes)
      s.llmCalls.push(fix.llmCalls)
      s.unfixed.push(fix.unfixed)
      s.totalIssues.push(lintResult.totalIssues)
      s.lintPost.push(postLint.totalIssues)
      s.collateral.push(collateral)
      s.totalChars.push(gen.prose.length)
      s.wordDelta.push(wordDelta)
      s.cost.push(fix.costUsd)
      s.latency.push(fix.latencyMs)

      const genId = await saveGeneration(armRuns[model.label], gen.seed, gen.attempt, {
        prose: fix.prose, wordCount: fix.prose.split(/\s+/).length, passed: true, variantLabel: model.label,
      })
      await saveLintIssues(genId, postLint.issues)

      console.log(`  [${model.label}] det:${fix.deterministicFixes} llm:${fix.llmFixes} (${fix.llmCalls} calls) unfixed:${fix.unfixed}/${lintResult.totalIssues} | lint:${lintResult.totalIssues}→${postLint.totalIssues} | collateral:${collateralPct}% words | words:${wordDelta >= 0 ? "+" : ""}${wordDelta} | ${fix.latencyMs}ms | $${fix.costUsd.toFixed(4)}`)
    }
    console.log()
  }

  // ── Report ────────────────────────────────────────────────────────────

  console.log("=".repeat(85))
  console.log("  HYBRID LINT FIX RESULTS")
  console.log("=".repeat(85))

  console.log(`\n  ${"Arm".padEnd(20)} ${"Det/LLM/Unfixed".padStart(18)} ${"Lint Δ".padStart(10)} ${"Collateral".padStart(12)} ${"Word Δ".padStart(10)} ${"Cost".padStart(10)} ${"Time".padStart(8)}`)
  console.log("  " + "-".repeat(82))

  const conclusions: string[] = []
  for (const arm of arms) {
    const s = armStats[arm]
    if (s.totalIssues.length === 0) continue

    const det = mean(s.detFixes).toFixed(1)
    const llm = mean(s.llmFixes).toFixed(1)
    const unf = mean(s.unfixed).toFixed(1)
    const lintPre = mean(s.totalIssues).toFixed(1)
    const lintPost = mean(s.lintPost).toFixed(1)
    const collPct = ((mean(s.collateral) / mean(s.totalChars)) * 100).toFixed(1)
    const wordD = mean(s.wordDelta).toFixed(0)
    const cost = mean(s.cost).toFixed(4)
    const time = mean(s.latency).toFixed(0)

    console.log(
      `  ${arm.padEnd(20)} ` +
      `${det}/${llm}/${unf}`.padStart(18) + " " +
      `${lintPre}→${lintPost}`.padStart(10) + " " +
      `${collPct}% words`.padStart(12) + " " +
      `${Number(wordD) >= 0 ? "+" : ""}${wordD}w`.padStart(10) + " " +
      `$${cost}`.padStart(10) + " " +
      `${time}ms`.padStart(8),
    )

    conclusions.push(`${arm}: det=${det} llm=${llm} unfixed=${unf}, lint ${lintPre}→${lintPost}, collateral ${collPct}%, $${cost}`)
  }

  console.log(`\n  Experiment: #${experimentId}`)
  for (const arm of arms) console.log(`  ${arm} run: ${armRuns[arm]}`)

  await concludeExperiment(experimentId, conclusions.join("; "))
}

main()
