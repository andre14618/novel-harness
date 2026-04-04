/**
 * Lint-augmented rewriting experiment.
 *
 * Tests whether deterministic lint issues improve rewriter quality vs judge-only issues.
 *
 * 3-arm A/B/C from the SAME generated prose:
 *   A: Judge-only issues → rewrite → re-judge  (baseline, current behavior)
 *   B: Lint-only issues → rewrite → re-judge   (free issue source)
 *   C: Judge + Lint issues → rewrite → re-judge (combined signal)
 *
 * All arms re-judged by the same LLM judge. Only variable is what the rewriter sees.
 *
 * Usage: BENCHMARK_SEEDS=romance-drama bun benchmark/prose/lint-rewrite-experiment.ts
 */

import { readFileSync } from "node:fs"
import { WRITER_AGENT_PROMPT } from "../../src/prompts"
import { getWriter, getJudges } from "../config"
import { DIMENSIONS, DIMENSION_LABELS, type Dimension } from "./judges/schema"
import { createRun, saveGeneration, saveScore, getCallSummary } from "../db"
import { createTuningExperiment, concludeExperiment } from "../../data/db"
import { loadSeeds, generateProse, judgeDimension, mean } from "./shared"
import { getTransport } from "../../src/transport"
import { getAgentConfig } from "../../models/roles"
import { extractJSON } from "../../src/llm"
import { lintProse, saveLintIssues, type LintIssue } from "../../src/lint"

const REWRITER_PROMPT = readFileSync(new URL("../../src/agents/rewriter/prompt.md", import.meta.url).pathname, "utf-8")

const RUNS = parseInt(process.env.BENCHMARK_RUNS ?? "2")

interface ScoreEntry { seed: string; dim: Dimension; count: number; wordCount: number }

type Arm = "judge-only" | "lint-only" | "judge+lint"
const ARMS: Arm[] = ["judge-only", "lint-only", "judge+lint"]

// ── Rewriter call ─────────────────────────────────────────────────────

async function rewriteProse(prose: string, issueText: string): Promise<string | null> {
  if (!issueText.trim()) return null

  const userPrompt = `ISSUES TO FIX:\n${issueText}\n\nORIGINAL PROSE:\n${prose}`
  const config = getAgentConfig("rewriter")

  try {
    const response = await getTransport().execute({
      systemPrompt: REWRITER_PROMPT,
      userPrompt,
      model: config.model,
      provider: config.provider,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      responseFormat: { type: "json_object" },
    })
    const json = extractJSON(response.content)
    return JSON.parse(json).prose ?? null
  } catch (err) {
    console.error("  Rewrite failed:", err instanceof Error ? err.message : err)
    return null
  }
}

// ── Issue formatting ──────────────────────────────────────────────────

function formatJudgeIssues(
  judgeResults: Array<{ dim: string; issues: Array<{ quote: string; problem: string }> }>,
): string {
  return judgeResults
    .flatMap(d => d.issues.map(i => `[${d.dim}] "${i.quote}" — ${i.problem}`))
    .join("\n")
}

function formatLintIssues(lintIssues: LintIssue[]): string {
  return lintIssues
    .map(i => `[lint:${i.category}] "${i.match}" — ${i.fixTemplate} (in: "${i.sentence.slice(0, 80)}")`)
    .join("\n")
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const writer = getWriter()
  const judges = getJudges()
  const judge = judges[0]
  const seedFilter = process.env.BENCHMARK_SEEDS?.split(",").map(s => s.trim())
  const seeds = loadSeeds(seedFilter)

  const experimentId = await createTuningExperiment(
    "rewriter",
    "lint-rewrite",
    `Lint-augmented rewriting: 3-arm A/B/C (judge-only vs lint-only vs judge+lint). Seeds: ${seeds.map(s => s.name).join(", ")}. Runs: ${RUNS}.`,
  )

  console.log(`\nLint-Augmented Rewriting Experiment`)
  console.log(`Writer: ${writer.label}`)
  console.log(`Judge: ${judge.label}`)
  console.log(`Seeds: ${seeds.map(s => s.name).join(", ")}`)
  console.log(`Runs per seed: ${RUNS}`)
  console.log(`Experiment: #${experimentId}\n`)

  // Create runs: 1 pre + 3 post (one per arm)
  const preRunId = await createRun("prose", seeds.length.toString(), `lint-rewrite-pre / ${writer.label}`, experimentId)
  const armRunIds: Record<Arm, number> = {
    "judge-only": await createRun("prose", seeds.length.toString(), `lint-rewrite-post-judge-only / ${writer.label}`, experimentId),
    "lint-only": await createRun("prose", seeds.length.toString(), `lint-rewrite-post-lint-only / ${writer.label}`, experimentId),
    "judge+lint": await createRun("prose", seeds.length.toString(), `lint-rewrite-post-judge+lint / ${writer.label}`, experimentId),
  }

  const preScores: ScoreEntry[] = []
  const armScores: Record<Arm, ScoreEntry[]> = { "judge-only": [], "lint-only": [], "judge+lint": [] }
  const armLintDeltas: Record<Arm, { pre: number; post: number }[]> = { "judge-only": [], "lint-only": [], "judge+lint": [] }
  const armWordCounts: Record<Arm, { pre: number; post: number }[]> = { "judge-only": [], "lint-only": [], "judge+lint": [] }

  for (const seed of seeds) {
    for (let run = 1; run <= RUNS; run++) {
      console.log(`[${seed.name}] Run ${run}/${RUNS}`)

      // 1. Generate prose (shared across all arms)
      const result = await generateProse(writer, WRITER_AGENT_PROMPT, seed.prompt, preRunId, seed.name, run)
      if (!result) { console.log("  Generation failed, skipping"); continue }
      const words = result.prose.split(/\s+/).length
      const preGenId = await saveGeneration(preRunId, seed.name, run, {
        prose: result.prose, wordCount: words, latencyMs: result.latencyMs,
        tokensPerSec: result.tps, completionTokens: result.tokens, passed: true,
      })
      console.log(`  Generated: ${words}w`)

      // 2. Judge original prose
      const judgeResults: Array<{ dim: Dimension; issues: Array<{ quote: string; problem: string }>; count: number }> = []
      for (const dim of DIMENSIONS) {
        const penalty = await judgeDimension(judge, dim, result.prose, preRunId, seed.name)
        if (penalty) {
          await saveScore(preGenId, judge.label, dim, penalty.count, JSON.stringify(penalty.issues))
          preScores.push({ seed: seed.name, dim, count: penalty.count, wordCount: words })
          judgeResults.push({ dim, issues: penalty.issues, count: penalty.count })
          console.log(`  Pre  ${DIMENSION_LABELS[dim]}: ${Math.abs(penalty.count)} issues`)
        }
      }

      // 3. Lint original prose
      const lintResult = await lintProse(result.prose)
      await saveLintIssues(preGenId, lintResult.issues)
      console.log(`  Pre  Lint: ${lintResult.totalIssues} issues (${Object.entries(lintResult.counts).map(([k, v]) => `${k}:${v}`).join(", ")})`)

      // 4. Build issue text for each arm
      const judgeIssueText = formatJudgeIssues(judgeResults)
      const lintIssueText = formatLintIssues(lintResult.issues)

      const armIssueText: Record<Arm, string> = {
        "judge-only": judgeIssueText,
        "lint-only": lintIssueText,
        "judge+lint": [judgeIssueText, lintIssueText].filter(Boolean).join("\n"),
      }

      // 5. Rewrite + re-judge each arm
      for (const arm of ARMS) {
        const issueText = armIssueText[arm]
        if (!issueText.trim()) {
          console.log(`  [${arm}] No issues — skipping`)
          continue
        }

        const issueCount = issueText.split("\n").length
        const rewritten = await rewriteProse(result.prose, issueText)
        if (!rewritten) { console.log(`  [${arm}] Rewrite failed`); continue }

        const rewrittenWords = rewritten.split(/\s+/).length
        const postGenId = await saveGeneration(armRunIds[arm], seed.name, run, {
          prose: rewritten, wordCount: rewrittenWords, passed: true, variantLabel: arm,
        })

        armWordCounts[arm].push({ pre: words, post: rewrittenWords })
        console.log(`  [${arm}] Rewritten: ${rewrittenWords}w (${issueCount} issues given)`)

        // Re-judge
        for (const dim of DIMENSIONS) {
          const penalty = await judgeDimension(judge, dim, rewritten, armRunIds[arm], seed.name)
          if (penalty) {
            await saveScore(postGenId, judge.label, dim, penalty.count, JSON.stringify(penalty.issues))
            armScores[arm].push({ seed: seed.name, dim, count: penalty.count, wordCount: rewrittenWords })
          }
        }

        // Re-lint
        const postLint = await lintProse(rewritten)
        await saveLintIssues(postGenId, postLint.issues)
        armLintDeltas[arm].push({ pre: lintResult.totalIssues, post: postLint.totalIssues })

        const judgeDelta = DIMENSIONS.map(dim => {
          const pre = judgeResults.find(j => j.dim === dim)
          const post = armScores[arm].filter(s => s.seed === seed.name && s.dim === dim).slice(-1)[0]
          if (!pre || !post) return ""
          return `${DIMENSION_LABELS[dim]}:${Math.abs(pre.count)}→${Math.abs(post.count)}`
        }).filter(Boolean).join(" ")

        console.log(`  [${arm}] Judge: ${judgeDelta} | Lint: ${lintResult.totalIssues}→${postLint.totalIssues}`)
      }
      console.log()
    }
  }

  // ── Report ────────────────────────────────────────────────────────────

  console.log("=".repeat(70))
  console.log("  LINT-AUGMENTED REWRITING RESULTS")
  console.log("=".repeat(70))

  // Per-dimension judge delta by arm
  console.log(`\n  Judge penalty delta (pre → post, negative = improved):`)
  console.log(`  ${"Dimension".padEnd(16)}${"Pre".padStart(6)}  ${"Judge-Only".padStart(12)}  ${"Lint-Only".padStart(12)}  ${"Judge+Lint".padStart(12)}`)
  console.log("  " + "-".repeat(62))

  const armResults: Record<Arm, { totalPre: number; totalPost: number }> = {
    "judge-only": { totalPre: 0, totalPost: 0 },
    "lint-only": { totalPre: 0, totalPost: 0 },
    "judge+lint": { totalPre: 0, totalPost: 0 },
  }

  for (const dim of DIMENSIONS) {
    const pre = preScores.filter(s => s.dim === dim)
    if (pre.length === 0) continue
    const preAvg = mean(pre.map(s => Math.abs(s.count)))

    const cells = [DIMENSION_LABELS[dim].padEnd(16), preAvg.toFixed(1).padStart(6)]
    for (const arm of ARMS) {
      const post = armScores[arm].filter(s => s.dim === dim)
      if (post.length === 0) { cells.push("n/a".padStart(12)); continue }
      const postAvg = mean(post.map(s => Math.abs(s.count)))
      const delta = postAvg - preAvg
      armResults[arm].totalPre += preAvg
      armResults[arm].totalPost += postAvg
      const arrow = delta < -0.5 ? " ✓" : delta > 0.5 ? " ✗" : ""
      cells.push(`${postAvg.toFixed(1)} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)})${arrow}`.padStart(12))
    }
    console.log("  " + cells.join("  "))
  }

  // Totals
  console.log("  " + "-".repeat(62))
  const totalCells = ["TOTAL".padEnd(16), mean(preScores.map(s => Math.abs(s.count))).toFixed(1).padStart(6)]
  for (const arm of ARMS) {
    const r = armResults[arm]
    const delta = r.totalPost - r.totalPre
    totalCells.push(`${r.totalPost.toFixed(1)} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)})`.padStart(12))
  }
  console.log("  " + totalCells.join("  "))

  // Lint delta by arm
  console.log(`\n  Lint issue delta (deterministic):`)
  for (const arm of ARMS) {
    const deltas = armLintDeltas[arm]
    if (deltas.length === 0) continue
    const preAvg = mean(deltas.map(d => d.pre))
    const postAvg = mean(deltas.map(d => d.post))
    console.log(`    ${arm.padEnd(12)} ${preAvg.toFixed(1)} → ${postAvg.toFixed(1)} (${(postAvg - preAvg >= 0 ? "+" : "")}${(postAvg - preAvg).toFixed(1)})`)
  }

  // Word count preservation
  console.log(`\n  Word count preservation:`)
  for (const arm of ARMS) {
    const wc = armWordCounts[arm]
    if (wc.length === 0) continue
    const preAvg = mean(wc.map(d => d.pre))
    const postAvg = mean(wc.map(d => d.post))
    const pct = ((postAvg / preAvg) * 100).toFixed(0)
    console.log(`    ${arm.padEnd(12)} ${preAvg.toFixed(0)}w → ${postAvg.toFixed(0)}w (${pct}%)`)
  }

  // Cost
  const allRunIds = [preRunId, ...Object.values(armRunIds)]
  let totalCost = 0
  for (const rid of allRunIds) {
    const summary = await getCallSummary(rid)
    totalCost += summary.reduce((s, c) => s + c.totalCost, 0)
  }
  console.log(`\n  Total cost: $${totalCost.toFixed(4)}`)

  // Conclude
  const conclusionParts = ARMS.map(arm => {
    const r = armResults[arm]
    const judgeDelta = r.totalPost - r.totalPre
    const lintDeltas = armLintDeltas[arm]
    const lintDelta = lintDeltas.length > 0
      ? mean(lintDeltas.map(d => d.post)) - mean(lintDeltas.map(d => d.pre))
      : 0
    return `${arm}: judge ${judgeDelta >= 0 ? "+" : ""}${judgeDelta.toFixed(1)}, lint ${lintDelta >= 0 ? "+" : ""}${lintDelta.toFixed(1)}`
  })
  await concludeExperiment(experimentId, `Lint-rewrite 3-arm: ${conclusionParts.join("; ")}. Cost: $${totalCost.toFixed(4)}`)

  console.log(`\n  Experiment: #${experimentId}`)
  console.log(`  Pre run: ${preRunId}`)
  for (const arm of ARMS) console.log(`  ${arm} run: ${armRunIds[arm]}`)
}

main()
