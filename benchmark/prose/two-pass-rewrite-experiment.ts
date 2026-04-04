/**
 * Two-pass rewriting experiment.
 *
 * Tests a lint-first, judge-second rewriting strategy:
 *   1. Generate prose
 *   2. Lint → rewrite (surgical, free issue detection)
 *   3. Judge the lint-rewritten prose
 *   4. Judge issues → rewrite again (handles telling/dialogue)
 *   5. Re-judge final prose
 *
 * Compared against single-pass baselines (judge-only, lint-only) from same source prose.
 *
 * Usage: BENCHMARK_SEEDS=romance-drama bun benchmark/prose/two-pass-rewrite-experiment.ts
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

type Arm = "judge-only" | "lint-only" | "two-pass"
const ARMS: Arm[] = ["judge-only", "lint-only", "two-pass"]

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
  results: Array<{ dim: string; issues: Array<{ quote: string; problem: string }> }>,
): string {
  return results
    .flatMap(d => d.issues.map(i => `[${d.dim}] "${i.quote}" — ${i.problem}`))
    .join("\n")
}

function formatLintIssues(issues: LintIssue[]): string {
  return issues
    .map(i => `[lint:${i.category}] "${i.match}" — ${i.fixTemplate} (in: "${i.sentence.slice(0, 80)}")`)
    .join("\n")
}

// ── Judge all dimensions ──────────────────────────────────────────────

async function judgeAll(
  judge: ReturnType<typeof getJudges>[0],
  prose: string,
  runId: number,
  genId: number,
  seed: string,
  label: string,
): Promise<{ scores: ScoreEntry[]; judgeResults: Array<{ dim: Dimension; issues: Array<{ quote: string; problem: string }>; count: number }> }> {
  const words = prose.split(/\s+/).length
  const scores: ScoreEntry[] = []
  const judgeResults: Array<{ dim: Dimension; issues: Array<{ quote: string; problem: string }>; count: number }> = []

  for (const dim of DIMENSIONS) {
    const penalty = await judgeDimension(judge, dim, prose, runId, seed)
    if (penalty) {
      await saveScore(genId, judge.label, dim, penalty.count, JSON.stringify(penalty.issues))
      scores.push({ seed, dim, count: penalty.count, wordCount: words })
      judgeResults.push({ dim, issues: penalty.issues, count: penalty.count })
      console.log(`  ${label} ${DIMENSION_LABELS[dim]}: ${Math.abs(penalty.count)} issues`)
    }
  }
  return { scores, judgeResults }
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
    "two-pass",
    `Two-pass rewriting (lint→judge): judge-only vs lint-only vs two-pass(lint+judge). Seeds: ${seeds.map(s => s.name).join(", ")}. Runs: ${RUNS}.`,
  )

  console.log(`\nTwo-Pass Rewriting Experiment`)
  console.log(`Writer: ${writer.label}`)
  console.log(`Judge: ${judge.label}`)
  console.log(`Seeds: ${seeds.map(s => s.name).join(", ")}`)
  console.log(`Runs per seed: ${RUNS}`)
  console.log(`Experiment: #${experimentId}\n`)

  // Create runs
  const preRunId = await createRun("prose", seeds.length.toString(), `two-pass-pre / ${writer.label}`, experimentId)
  const armRunIds: Record<Arm, number> = {
    "judge-only": await createRun("prose", seeds.length.toString(), `two-pass-judge-only / ${writer.label}`, experimentId),
    "lint-only": await createRun("prose", seeds.length.toString(), `two-pass-lint-only / ${writer.label}`, experimentId),
    "two-pass": await createRun("prose", seeds.length.toString(), `two-pass-lint-then-judge / ${writer.label}`, experimentId),
  }

  const preScores: ScoreEntry[] = []
  const armScores: Record<Arm, ScoreEntry[]> = { "judge-only": [], "lint-only": [], "two-pass": [] }
  const armLintDeltas: Record<Arm, { pre: number; post: number }[]> = { "judge-only": [], "lint-only": [], "two-pass": [] }
  const armWordCounts: Record<Arm, { pre: number; post: number }[]> = { "judge-only": [], "lint-only": [], "two-pass": [] }

  for (const seed of seeds) {
    for (let run = 1; run <= RUNS; run++) {
      console.log(`\n[${seed.name}] Run ${run}/${RUNS}`)

      // 1. Generate prose
      const result = await generateProse(writer, WRITER_AGENT_PROMPT, seed.prompt, preRunId, seed.name, run)
      if (!result) { console.log("  Generation failed, skipping"); continue }
      const words = result.prose.split(/\s+/).length
      const preGenId = await saveGeneration(preRunId, seed.name, run, {
        prose: result.prose, wordCount: words, latencyMs: result.latencyMs,
        tokensPerSec: result.tps, completionTokens: result.tokens, passed: true,
      })
      console.log(`  Generated: ${words}w`)

      // 2. Judge original
      const { scores: preS, judgeResults } = await judgeAll(judge, result.prose, preRunId, preGenId, seed.name, "Pre ")
      preScores.push(...preS)

      // 3. Lint original
      const lintResult = await lintProse(result.prose)
      await saveLintIssues(preGenId, lintResult.issues)
      console.log(`  Pre  Lint: ${lintResult.totalIssues} issues`)

      const judgeIssueText = formatJudgeIssues(judgeResults)
      const lintIssueText = formatLintIssues(lintResult.issues)

      // ── Arm A: Judge-only ───────────────────────────────────────────
      {
        console.log(`\n  [judge-only]`)
        if (!judgeIssueText.trim()) { console.log("    No judge issues, skipping"); }
        else {
          const rewritten = await rewriteProse(result.prose, judgeIssueText)
          if (rewritten) {
            const rw = rewritten.split(/\s+/).length
            const genId = await saveGeneration(armRunIds["judge-only"], seed.name, run, {
              prose: rewritten, wordCount: rw, passed: true, variantLabel: "judge-only",
            })
            console.log(`    Rewritten: ${rw}w`)
            armWordCounts["judge-only"].push({ pre: words, post: rw })

            const { scores } = await judgeAll(judge, rewritten, armRunIds["judge-only"], genId, seed.name, "   ")
            armScores["judge-only"].push(...scores)

            const postLint = await lintProse(rewritten)
            await saveLintIssues(genId, postLint.issues)
            armLintDeltas["judge-only"].push({ pre: lintResult.totalIssues, post: postLint.totalIssues })
          }
        }
      }

      // ── Arm B: Lint-only ────────────────────────────────────────────
      {
        console.log(`\n  [lint-only]`)
        if (!lintIssueText.trim()) { console.log("    No lint issues, skipping"); }
        else {
          const rewritten = await rewriteProse(result.prose, lintIssueText)
          if (rewritten) {
            const rw = rewritten.split(/\s+/).length
            const genId = await saveGeneration(armRunIds["lint-only"], seed.name, run, {
              prose: rewritten, wordCount: rw, passed: true, variantLabel: "lint-only",
            })
            console.log(`    Rewritten: ${rw}w`)
            armWordCounts["lint-only"].push({ pre: words, post: rw })

            const { scores } = await judgeAll(judge, rewritten, armRunIds["lint-only"], genId, seed.name, "   ")
            armScores["lint-only"].push(...scores)

            const postLint = await lintProse(rewritten)
            await saveLintIssues(genId, postLint.issues)
            armLintDeltas["lint-only"].push({ pre: lintResult.totalIssues, post: postLint.totalIssues })
          }
        }
      }

      // ── Arm C: Two-pass (lint → judge) ──────────────────────────────
      {
        console.log(`\n  [two-pass] Pass 1: lint`)
        let intermediate = result.prose
        let intermediateWords = words

        // Pass 1: lint rewrite
        if (lintIssueText.trim()) {
          const lintRewritten = await rewriteProse(result.prose, lintIssueText)
          if (lintRewritten) {
            intermediate = lintRewritten
            intermediateWords = intermediate.split(/\s+/).length
            console.log(`    After lint pass: ${intermediateWords}w`)
          }
        } else {
          console.log(`    No lint issues, skipping lint pass`)
        }

        // Judge the intermediate prose
        console.log(`  [two-pass] Judging intermediate...`)
        const intermediateGenId = await saveGeneration(armRunIds["two-pass"], seed.name, run, {
          prose: intermediate, wordCount: intermediateWords, passed: true, variantLabel: "two-pass-intermediate",
        })
        const { judgeResults: pass2JudgeResults } = await judgeAll(
          judge, intermediate, armRunIds["two-pass"], intermediateGenId, seed.name, "    Mid",
        )

        // Pass 2: judge rewrite
        const pass2IssueText = formatJudgeIssues(pass2JudgeResults)
        console.log(`  [two-pass] Pass 2: judge (${pass2IssueText.split("\n").length} issues)`)

        if (pass2IssueText.trim()) {
          const finalProse = await rewriteProse(intermediate, pass2IssueText)
          if (finalProse) {
            const fw = finalProse.split(/\s+/).length
            const finalGenId = await saveGeneration(armRunIds["two-pass"], seed.name, run, {
              prose: finalProse, wordCount: fw, passed: true, variantLabel: "two-pass",
            })
            console.log(`    Final: ${fw}w`)
            armWordCounts["two-pass"].push({ pre: words, post: fw })

            const { scores } = await judgeAll(judge, finalProse, armRunIds["two-pass"], finalGenId, seed.name, "    Final")
            armScores["two-pass"].push(...scores)

            const postLint = await lintProse(finalProse)
            await saveLintIssues(finalGenId, postLint.issues)
            armLintDeltas["two-pass"].push({ pre: lintResult.totalIssues, post: postLint.totalIssues })
          }
        } else {
          console.log(`    No judge issues after lint pass — lint-only was sufficient`)
          // Use intermediate as final
          armWordCounts["two-pass"].push({ pre: words, post: intermediateWords })
          const postLint = await lintProse(intermediate)
          armLintDeltas["two-pass"].push({ pre: lintResult.totalIssues, post: postLint.totalIssues })
          // Scores already captured from intermediate judging
          const intScores = DIMENSIONS.map(dim => {
            const found = pass2JudgeResults.find(j => j.dim === dim)
            if (!found) return null
            return { seed: seed.name, dim, count: found.count, wordCount: intermediateWords } as ScoreEntry
          }).filter(Boolean) as ScoreEntry[]
          armScores["two-pass"].push(...intScores)
        }
      }
    }
  }

  // ── Report ────────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(70))
  console.log("  TWO-PASS REWRITING RESULTS")
  console.log("=".repeat(70))

  console.log(`\n  Judge penalty delta (pre → post, negative = improved):`)
  console.log(`  ${"Dimension".padEnd(16)}${"Pre".padStart(6)}  ${"Judge-Only".padStart(12)}  ${"Lint-Only".padStart(12)}  ${"Two-Pass".padStart(12)}`)
  console.log("  " + "-".repeat(62))

  const armTotals: Record<Arm, { pre: number; post: number }> = {
    "judge-only": { pre: 0, post: 0 },
    "lint-only": { pre: 0, post: 0 },
    "two-pass": { pre: 0, post: 0 },
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
      armTotals[arm].pre += preAvg
      armTotals[arm].post += postAvg
      const arrow = delta < -0.5 ? " ✓" : delta > 0.5 ? " ✗" : ""
      cells.push(`${postAvg.toFixed(1)} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)})${arrow}`.padStart(12))
    }
    console.log("  " + cells.join("  "))
  }

  console.log("  " + "-".repeat(62))
  const totalCells = ["TOTAL".padEnd(16), mean(preScores.map(s => Math.abs(s.count))).toFixed(1).padStart(6)]
  for (const arm of ARMS) {
    const r = armTotals[arm]
    const delta = r.post - r.pre
    totalCells.push(`${r.post.toFixed(1)} (${delta >= 0 ? "+" : ""}${delta.toFixed(1)})`.padStart(12))
  }
  console.log("  " + totalCells.join("  "))

  // Lint delta
  console.log(`\n  Lint issue delta (deterministic):`)
  for (const arm of ARMS) {
    const deltas = armLintDeltas[arm]
    if (deltas.length === 0) continue
    const preAvg = mean(deltas.map(d => d.pre))
    const postAvg = mean(deltas.map(d => d.post))
    console.log(`    ${arm.padEnd(12)} ${preAvg.toFixed(1)} → ${postAvg.toFixed(1)} (${(postAvg - preAvg >= 0 ? "+" : "")}${(postAvg - preAvg).toFixed(1)})`)
  }

  // Word count
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

  // Run IDs for pairwise follow-up
  console.log(`\n  Experiment: #${experimentId}`)
  console.log(`  Pre run: ${preRunId}`)
  for (const arm of ARMS) console.log(`  ${arm} run: ${armRunIds[arm]}`)

  // Conclude
  const parts = ARMS.map(arm => {
    const r = armTotals[arm]
    const delta = r.post - r.pre
    return `${arm}: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`
  })
  await concludeExperiment(experimentId, `Two-pass: ${parts.join(", ")}. Cost: $${totalCost.toFixed(4)}`)
}

main()
