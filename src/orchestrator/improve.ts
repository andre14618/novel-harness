/**
 * Improvement iteration logic — adapted for async batch judging.
 *
 * Core flow: propose change → apply → run benchmark (real-time writer) →
 * submit judge batch (async) → wait → evaluate → keep/revert.
 *
 * Adapted from scripts/improve-loop.ts. Key difference: judge calls are
 * batched instead of real-time, so the iteration is split across two
 * events (propose+benchmark, then evaluate on batch-complete).
 */

import { readFileSync, writeFileSync } from "node:fs"
import db from "./db"
import harnessDb from "../../data/connection"
import { validateProposal, type Proposal } from "./guardrails"
import { MODELS, PROVIDERS, getApiKey } from "../../models/registry"
import { getModelForAgent } from "../../models/roles"
import { extractJSON } from "../llm"
import { getBatchProvider } from "../../benchmark/batch/providers"
import { createBatch, addBatchRequest, updateBatchSubmitted } from "../../data/db"
import type { BatchRequest } from "../../benchmark/batch/types"

const HARNESS_ROOT = process.env.HARNESS_ROOT ?? "/home/andre/apps/novel-harness"
const MAX_GIT_COMMITS = 5
const MAX_EXPERIMENT_CONCLUSIONS = 5
const MAX_CROSS_CYCLE_ATTEMPTS = 20

// ── Target configs (derived from benchmark registry) ────────────────────

import { BENCHMARKS, getDaemonTarget } from "../../benchmark/registry"

export interface TargetConfig {
  promptFiles: Array<{ path: string; agentName: string }>
  benchmarkCmd: string
  runType: string
}

export const TARGETS: Record<string, TargetConfig> = Object.fromEntries(
  Object.keys(BENCHMARKS)
    .map(name => [name, getDaemonTarget(name)])
    .filter((entry): entry is [string, TargetConfig] => entry[1] !== undefined)
)

// ── Context engineering ─────────────────────────────────────────────────

export interface ImproverContext {
  previousAttempts: string
  gitDiffs: string
  otherDimensions: string
  experimentConclusions: string
}

/**
 * Build rich context for the improver from DB + git.
 * Deterministic — no LLM calls.
 */
export async function buildImproverContext(
  cycleId: number,
  target: string,
  dimension: string,
  promptFilePath: string,
): Promise<ImproverContext> {
  // Run all four context sections in parallel — they're independent
  const [previousAttempts, gitDiffs, otherDimensions, experimentConclusions] = await Promise.all([

    // 1. Previous attempts — ALL cycles for this target/dimension, not just current
    (async () => {
      try {
        const iters = await db`
          SELECT ii.iteration_num, ii.proposal_explanation, ii.delta, ii.result,
                 ii.backup_content, ii.cycle_id,
                 ic.started_at::date as cycle_date
          FROM improvement_iterations ii
          JOIN improvement_cycles ic ON ic.id = ii.cycle_id
          WHERE ii.target = ${target} AND ii.dimension = ${dimension}
          AND ii.result IS NOT NULL
          ORDER BY ii.id DESC
          LIMIT ${MAX_CROSS_CYCLE_ATTEMPTS}
        ` as any[]
        if (iters.length === 0) return ""

        // Group by cycle for readability
        const byCycle = new Map<number, any[]>()
        for (const i of iters) {
          const list = byCycle.get(i.cycle_id) ?? []
          list.push(i)
          byCycle.set(i.cycle_id, list)
        }

        const sections: string[] = []
        for (const [cId, attempts] of byCycle) {
          const date = attempts[0]?.cycle_date ?? "unknown"
          const current = cId === cycleId ? " (current)" : ""
          const lines = attempts.reverse().map((i: any) => {
            const deltaStr = i.delta !== null ? `, ${i.delta >= 0 ? "+" : ""}${i.delta}` : ""
            return `  ${i.result}${deltaStr}: ${i.proposal_explanation ?? "no explanation"}`
          })
          sections.push(`Cycle #${cId} (${date}${current}):\n${lines.join("\n")}`)
        }
        return sections.join("\n\n")
      } catch (err) {
        console.log(`[context] Previous attempts query failed: ${err instanceof Error ? err.message : err}`)
        return ""
      }
    })(),

    // 2. Git diffs — per-commit diffs for THIS file only
    (async () => {
      try {
        const logProc = Bun.spawn(
          ["git", "log", "--oneline", `-${MAX_GIT_COMMITS}`, "--follow", "--", promptFilePath],
          { cwd: HARNESS_ROOT, stdout: "pipe", stderr: "pipe" },
        )
        const logOutput = await new Response(logProc.stdout).text()
        await logProc.exited

        const commits = logOutput.trim().split("\n").filter(Boolean)
        if (commits.length === 0) return ""

        const diffs: string[] = [`${commits.length} commits that changed this file:`]

        // Spawn all git diff processes in parallel
        const diffResults = await Promise.all(
          commits.slice(0, MAX_GIT_COMMITS).map(async (line) => {
            const sha = line.split(" ")[0]
            const msg = line.slice(sha.length + 1)
            const diffProc = Bun.spawn(
              ["git", "diff", `${sha}~1..${sha}`, "--", promptFilePath],
              { cwd: HARNESS_ROOT, stdout: "pipe", stderr: "pipe" },
            )
            const diffOutput = await new Response(diffProc.stdout).text()
            await diffProc.exited
            const trimmedDiff = diffOutput.trim().slice(0, 800)
            return trimmedDiff ? `--- ${sha} ${msg} ---\n${trimmedDiff}` : null
          }),
        )

        for (const diff of diffResults) {
          if (diff) diffs.push(diff)
        }
        return diffs.join("\n\n")
      } catch (err) {
        console.log(`[context] Git diff failed: ${err instanceof Error ? err.message : err}`)
        return ""
      }
    })(),

    // 3. Dimension scores — per-seed breakdown + tradeoff awareness
    (async () => {
      try {
        const latestRun = await harnessDb`
          SELECT id FROM runs WHERE run_type = ${target} ORDER BY id DESC LIMIT 1
        ` as any[]
        if (latestRun.length === 0) return ""
        const runId = latestRun[0].id

        // Run both score queries in parallel
        const [dimScores, seedScores] = await Promise.all([
          harnessDb`
            SELECT s.dimension, ROUND(AVG(s.score)::numeric, 1) as avg_score
            FROM scores s JOIN generations g ON s.generation_id = g.id
            WHERE g.run_id = ${runId} AND g.passed = true
            GROUP BY s.dimension
            ORDER BY avg_score ASC
          ` as Promise<any[]>,
          harnessDb`
            SELECT g.seed, ROUND(AVG(s.score)::numeric, 1) as avg_score
            FROM scores s JOIN generations g ON s.generation_id = g.id
            WHERE g.run_id = ${runId} AND g.passed = true AND s.dimension = ${dimension}
            GROUP BY g.seed
            ORDER BY avg_score ASC
          ` as Promise<any[]>,
        ])

        const parts: string[] = []

        if (dimScores.length > 0) {
          const targetScore = dimScores.find((s: any) => s.dimension === dimension)
          const others = dimScores.filter((s: any) => s.dimension !== dimension)
          if (targetScore) {
            parts.push(`Target dimension (${dimension}): ${targetScore.avg_score}/10`)
          }
          if (others.length > 0) {
            parts.push(`Other dimensions (don't regress): ${others.map((s: any) => `${s.dimension}: ${s.avg_score}/10`).join(", ")}`)
          }
        }

        if (seedScores.length > 0) {
          parts.push(`Per-seed scores for ${dimension}: ${seedScores.map((s: any) => `${s.seed}: ${s.avg_score}/10`).join(", ")}`)
          const weakest = seedScores[0]
          if (seedScores.length > 1 && parseFloat(weakest.avg_score) < parseFloat(seedScores[seedScores.length - 1].avg_score) - 1) {
            parts.push(`Weakest seed: ${weakest.seed} (${weakest.avg_score}/10) — focus improvements here`)
          }
        }

        return parts.join("\n")
      } catch (err) {
        console.log(`[context] Dimension scores query failed: ${err instanceof Error ? err.message : err}`)
        return ""
      }
    })(),

    // 4. Experiment conclusions — with what was actually tried
    (async () => {
      try {
        const experiments = await harnessDb`
          SELECT id, description, conclusion, config
          FROM tuning_experiments
          WHERE description LIKE ${"%" + target + "%"} AND conclusion IS NOT NULL
          ORDER BY id DESC LIMIT ${MAX_EXPERIMENT_CONCLUSIONS}
        ` as any[]
        if (experiments.length === 0) return ""

        return experiments
          .map((e: any, i: number) => {
            const desc = (e.description as string).slice(0, 100)
            const conclusion = (e.conclusion as string).slice(0, 300)
            return `${i + 1}. [Experiment #${e.id}] ${desc}\n   Result: ${conclusion}`
          })
          .join("\n\n")
      } catch (err) {
        console.log(`[context] Experiments query failed: ${err instanceof Error ? err.message : err}`)
        return ""
      }
    })(),
  ])

  return { previousAttempts, gitDiffs, otherDimensions, experimentConclusions }
}

// ── Propose a change via LLM ────────────────────────────────────────────

export async function proposeChange(
  currentPrompts: Array<{ agentName: string; content: string }>,
  dimension: string,
  currentScore: number,
  judgeReasoning: string[],
  context?: ImproverContext,
): Promise<{ agentName: string; newPrompt: string; explanation: string } | null> {
  const assignment = getModelForAgent("improver")
  if (!assignment) throw new Error(`No model assigned for "improver" role in models/roles.ts`)
  const model = MODELS.find(m => m.id === assignment.model && m.provider === assignment.provider)
  if (!model) throw new Error(`Model ${assignment.model} (${assignment.provider}) not found in registry`)

  const provider = PROVIDERS[model.provider]
  const apiKey = getApiKey(model.provider)

  const promptSection = currentPrompts.map(p =>
    `### ${p.agentName}\n\`\`\`\n${p.content}\n\`\`\``
  ).join("\n\n")

  const reasoningSection = judgeReasoning.slice(0, 5).map((r, i) =>
    `${i + 1}. ${r.slice(0, 400)}`
  ).join("\n\n")

  const systemPrompt = `You are an expert at improving LLM agent prompts. You will be given:
1. The current prompt(s) for one or more agents
2. The benchmark dimension being measured and its current score
3. Judge reasoning explaining WHY the score is low

Your job: propose a SPECIFIC change to ONE of the agent prompts that will improve the score on this dimension. The change should be targeted — don't rewrite the whole prompt, just add or modify the section that addresses the weakness the judge identified.

Respond with ONLY valid JSON:
{
  "agentName": "which agent's prompt to change",
  "newPrompt": "the complete new prompt (not a diff — the full replacement)",
  "explanation": "1-2 sentences on what you changed and why"
}`

  // Build context sections
  const contextSections: string[] = []
  if (context?.previousAttempts) {
    contextSections.push(`## Previous Attempts (learn from these — don't repeat failed approaches)\n\n${context.previousAttempts}`)
  }
  if (context?.otherDimensions) {
    contextSections.push(`## ${context.otherDimensions}`)
  }
  if (context?.experimentConclusions) {
    contextSections.push(`## Past Experiment Conclusions\n\n${context.experimentConclusions}`)
  }
  if (context?.gitDiffs) {
    contextSections.push(`## Recent Prompt Changes (git history)\n\n${context.gitDiffs}`)
  }

  const contextBlock = contextSections.length > 0
    ? `\n\n${contextSections.join("\n\n")}`
    : ""

  const userPrompt = `## Current Prompts

${promptSection}

## Target Dimension: ${dimension}
## Current Score: ${currentScore}

## Judge Reasoning (why the score is low):

${reasoningSection}${contextBlock}

Propose a targeted prompt change to improve the ${dimension} score. Focus on the specific weaknesses the judge identified.`

  const needsNothink = model.needsNothink
  const finalUserPrompt = needsNothink ? `/nothink\n${userPrompt}` : userPrompt

  try {
    const res = await fetch(provider.apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.id,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: finalUserPrompt },
        ],
        temperature: 0.7,
        max_tokens: 8192,
        response_format: { type: "json_object" },
        ...provider.extraBody?.(),
      }),
    })

    if (!res.ok) {
      console.log(`  ! Improver LLM error: ${res.status}`)
      return null
    }

    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content
    if (!content) return null

    const jsonStr = extractJSON(content)
    const parsed = JSON.parse(jsonStr)

    if (!parsed.agentName || !parsed.newPrompt || !parsed.explanation) return null
    return parsed
  } catch (err) {
    console.log(`  ! Improver error: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

// ── Apply a proposed change ─────────────────────────────────────────────

export function applyChange(
  proposal: { agentName: string; newPrompt: string },
  targetConfig: TargetConfig,
): { filePath: string; originalContent: string } | null {
  const targetFile = targetConfig.promptFiles.find(f => f.agentName === proposal.agentName)
  if (!targetFile) return null

  const fullPath = `${HARNESS_ROOT}/${targetFile.path}`
  const originalContent = readFileSync(fullPath, "utf-8")
  writeFileSync(fullPath, proposal.newPrompt)

  return { filePath: targetFile.path, originalContent }
}

export function revertChange(filePath: string, originalContent: string): void {
  writeFileSync(`${HARNESS_ROOT}/${filePath}`, originalContent)
}

// ── Run benchmark (writer generation, real-time) ────────────────────────

export async function runBenchmark(cmd: string, experimentId?: number): Promise<{ runId: number; stdout: string } | null> {
  const fullCmd = experimentId ? `EXPERIMENT_ID=${experimentId} ${cmd}` : cmd
  console.log(`  [improve] Running: ${fullCmd}`)
  const bunPath = process.env.BUN_PATH ?? `${process.env.HOME}/.bun/bin`
  const proc = Bun.spawn(["bash", "-c", fullCmd], {
    stdout: "pipe", stderr: "pipe",
    cwd: HARNESS_ROOT,
    env: { ...process.env, PATH: `${bunPath}:${process.env.PATH ?? "/usr/bin:/bin"}` },
  })

  const stdout = await new Response(proc.stdout).text()
  const exitCode = await proc.exited

  if (exitCode !== 0) {
    console.log(`  [improve] Benchmark failed (exit ${exitCode})`)
    return null
  }

  const runIdMatch = stdout.match(/Run ID: (\d+)/)
  if (!runIdMatch) return null

  return { runId: parseInt(runIdMatch[1]), stdout }
}

// ── Synthesize conclusion via LLM ───────────────────────────────────────

/**
 * At cycle end, feed kept/reverted diffs + scores + judge reasoning to an LLM
 * to produce a strategic conclusion. One call, grounded in raw data only.
 */
export async function synthesizeConclusion(
  cycleId: number,
  target: string,
  dimension: string,
  baselineScore: number,
  finalScore: number,
): Promise<string | null> {
  // Gather all iterations for this cycle
  const iters = await db`
    SELECT iteration_num, result, delta, proposal_explanation, backup_content,
           proposed_content, file_path, new_score, baseline_score
    FROM improvement_iterations
    WHERE cycle_id = ${cycleId}
    ORDER BY iteration_num
  ` as any[]

  if (iters.length === 0) return null

  // Build per-attempt context with actual diffs for ALL attempts
  const attemptSections: string[] = []
  for (const iter of iters) {
    const header = `Attempt ${iter.iteration_num} — ${iter.result} (${iter.baseline_score} → ${iter.new_score ?? "?"}, delta: ${iter.delta ?? "?"})`
    const explanation = iter.proposal_explanation ?? "no explanation"

    let diff = ""
    if (iter.backup_content && iter.proposed_content) {
      // Both kept and reverted attempts have backup (original) + proposed (new)
      diff = buildCompactDiff(iter.backup_content, iter.proposed_content)
    }

    const parts = [header, `Explanation: ${explanation}`]
    if (diff) parts.push(`Diff:\n${diff}`)
    attemptSections.push(parts.join("\n"))
  }

  // Get judge reasoning for the weakest generations in the final run
  let judgeContext = ""
  try {
    const latestRun = await harnessDb`
      SELECT id FROM runs WHERE run_type = ${target} ORDER BY id DESC LIMIT 1
    ` as any[]
    if (latestRun.length > 0) {
      const reasoning = await harnessDb`
        SELECT s.reasoning, s.score, g.seed
        FROM scores s JOIN generations g ON s.generation_id = g.id
        WHERE g.run_id = ${latestRun[0].id} AND s.dimension = ${dimension}
          AND g.passed = true AND s.reasoning IS NOT NULL
        ORDER BY s.score ASC LIMIT 3
      ` as any[]
      if (reasoning.length > 0) {
        judgeContext = reasoning.map((r: any) =>
          `[${r.seed}, score ${r.score}]: ${(r.reasoning as string).slice(0, 300)}`
        ).join("\n")
      }
    }
  } catch { /* non-critical */ }

  // One LLM call to synthesize
  const assignment = getModelForAgent("improver")
  if (!assignment) return null
  const model = MODELS.find(m => m.id === assignment.model && m.provider === assignment.provider)
  if (!model) return null

  const provider = PROVIDERS[model.provider]
  const apiKey = getApiKey(model.provider)

  const systemPrompt = `You are analyzing the results of an automated prompt improvement cycle. You will see what changes were attempted, which were kept vs reverted, and the score impacts.

Write a concise conclusion (3-5 sentences) capturing:
1. What specific prompt changes actually improved scores and WHY they worked
2. What approaches were tried and FAILED — what principle explains the failure
3. Strategic guidance for future cycles targeting this dimension

Be specific about the prompt engineering principles at work. Don't just restate numbers — explain the causal mechanism. Your conclusion will be read by a future improvement cycle to avoid repeating mistakes.`

  const userPrompt = `## Cycle Summary
Target: ${target}/${dimension}
Baseline: ${baselineScore}/10 → Final: ${finalScore}/10 (${finalScore >= baselineScore ? "+" : ""}${(finalScore - baselineScore).toFixed(1)})
Iterations: ${iters.length}

## Attempts
${attemptSections.join("\n\n")}

${judgeContext ? `## Judge Reasoning (weakest remaining generations)\n${judgeContext}` : ""}

Write your conclusion.`

  const needsNothink = model.needsNothink
  const finalPrompt = needsNothink ? `/nothink\n${userPrompt}` : userPrompt

  try {
    const res = await fetch(provider.apiUrl, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.id,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: finalPrompt },
        ],
        temperature: 0.3,
        max_tokens: 512,
        ...provider.extraBody?.(),
      }),
    })

    if (!res.ok) {
      console.log(`[conclude] LLM error: ${res.status}`)
      return null
    }

    const data = await res.json() as any
    const content = data.choices?.[0]?.message?.content
    return content?.trim() ?? null
  } catch (err) {
    console.log(`[conclude] Error: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

/** Build a compact line-level diff (added/removed only, no context lines). */
function buildCompactDiff(original: string, modified: string): string {
  const origLines = original.split("\n")
  const modLines = modified.split("\n")

  const diff: string[] = []
  const maxLines = Math.max(origLines.length, modLines.length)

  // Simple line-by-line comparison — not a proper diff algorithm but good enough
  // for prompt files where changes are typically additions/modifications, not moves
  let i = 0, j = 0
  while (i < origLines.length || j < modLines.length) {
    if (i < origLines.length && j < modLines.length && origLines[i] === modLines[j]) {
      i++; j++
      continue
    }
    // Lines differ — show removed and added
    if (i < origLines.length && (j >= modLines.length || !modLines.includes(origLines[i]))) {
      diff.push(`- ${origLines[i]}`)
      i++
    } else if (j < modLines.length && (i >= origLines.length || !origLines.includes(modLines[j]))) {
      diff.push(`+ ${modLines[j]}`)
      j++
    } else {
      diff.push(`- ${origLines[i]}`)
      diff.push(`+ ${modLines[j]}`)
      i++; j++
    }
    if (diff.length > 30) { diff.push("... (truncated)"); break }
  }

  return diff.join("\n")
}

// ── Get scores from Postgres ────────────────────────────────────────────

export async function getLatestScores(runType: string, dimension: string): Promise<{
  avgScore: number; runId: number
} | null> {
  const runs = await harnessDb`SELECT id FROM runs WHERE run_type = ${runType} ORDER BY id DESC LIMIT 1`
  if (runs.length === 0) return null
  const runId = (runs[0] as any).id

  const scores = await harnessDb`
    SELECT s.score FROM scores s JOIN generations g ON g.id = s.generation_id
    WHERE g.run_id = ${runId} AND s.dimension = ${dimension}
  ` as Array<{ score: number }>

  if (scores.length === 0) return null
  const avg = scores.reduce((s, r) => s + r.score, 0) / scores.length
  return { avgScore: Math.round(avg * 10) / 10, runId }
}
