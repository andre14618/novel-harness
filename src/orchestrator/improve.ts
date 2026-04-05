/**
 * Improvement iteration logic — proposal generation and evaluation.
 * Uses harness service layer for all data access.
 */

import { readFileSync, writeFileSync } from "node:fs"
import * as harness from "../harness"
import { validateProposal, type Proposal } from "./guardrails"
import { MODELS, PROVIDERS, getApiKey } from "../../models/registry"
import { getModelForAgent } from "../../models/roles"
import { extractJSON } from "../llm"

const HARNESS_ROOT = process.env.HARNESS_ROOT ?? "/home/andre/apps/novel-harness"
const MAX_GIT_COMMITS = 5

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
 * Uses harness service layer — no inline SQL.
 */
export async function buildImproverContext(
  cycleId: number,
  target: string,
  dimension: string,
  promptFilePath: string,
): Promise<ImproverContext> {
  const [previousAttempts, gitDiffs, otherDimensions, experimentConclusions] = await Promise.all([

    // 1. Previous attempts across all cycles
    (async () => {
      try {
        const attempts = await harness.cycles.getPreviousAttempts(target, dimension)
        if (attempts.length === 0) return ""

        const byCycle = new Map<number, typeof attempts>()
        for (const a of attempts) {
          const list = byCycle.get(a.cycleId) ?? []
          list.push(a)
          byCycle.set(a.cycleId, list)
        }

        const sections: string[] = []
        for (const [cId, items] of byCycle) {
          const date = items[0]?.cycleDate ?? "unknown"
          const current = cId === cycleId ? " (current)" : ""
          const lines = items.reverse().map(i => {
            const deltaStr = i.delta !== null ? `, ${i.delta >= 0 ? "+" : ""}${i.delta}` : ""
            return `  ${i.result}${deltaStr}: ${i.proposalExplanation ?? "no explanation"}`
          })
          sections.push(`Cycle #${cId} (${date}${current}):\n${lines.join("\n")}`)
        }
        return sections.join("\n\n")
      } catch (err) {
        console.log(`[context] Previous attempts query failed: ${err instanceof Error ? err.message : err}`)
        return ""
      }
    })(),

    // 2. Git diffs for this file
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

    // 3. Dimension scores + per-seed breakdown
    (async () => {
      try {
        const latestScores = await harness.scores.getLatestScores(target, dimension)
        if (!latestScores) return ""

        const [dimScores, seedScores] = await Promise.all([
          harness.scores.getAllDimensionScoresForRun(latestScores.runId),
          harness.scores.getSeedScores(target, dimension),
        ])

        const parts: string[] = []

        if (dimScores.length > 0) {
          const targetScore = dimScores.find(s => s.dimension === dimension)
          const others = dimScores.filter(s => s.dimension !== dimension)
          if (targetScore) {
            parts.push(`Target dimension (${dimension}): ${targetScore.avgScore} (higher=better)`)
          }
          if (others.length > 0) {
            parts.push(`Other dimensions (don't regress): ${others.map(s => `${s.dimension}: ${s.avgScore}`).join(", ")}`)
          }
        }

        if (seedScores.length > 0) {
          parts.push(`Per-seed scores for ${dimension}: ${seedScores.map(s => `${s.seed}: ${s.avgScore}`).join(", ")}`)
          const weakest = seedScores[0]
          if (seedScores.length > 1 && weakest.avgScore < seedScores[seedScores.length - 1].avgScore - 1) {
            parts.push(`Weakest seed: ${weakest.seed} (${weakest.avgScore}) — focus improvements here`)
          }
        }

        return parts.join("\n")
      } catch (err) {
        console.log(`[context] Dimension scores query failed: ${err instanceof Error ? err.message : err}`)
        return ""
      }
    })(),

    // 4. Experiment conclusions
    (async () => {
      try {
        const [exactMatches, sameTarget, linked] = await Promise.all([
          harness.experiments.getExactExperiments(target, dimension),
          harness.experiments.getSameTargetExperiments(target, dimension),
          harness.experiments.getLinkedExperiments(target, dimension),
        ])

        const sections: string[] = []

        if (exactMatches.length > 0) {
          sections.push(`Prior experiments on ${target}/${dimension}:`)
          for (const e of exactMatches) {
            const conclusion = (e.conclusion ?? "").slice(0, 400)
            sections.push(`  [#${e.id}] ${(e.description ?? "").slice(0, 100)}\n  Result: ${conclusion}`)
          }
        }

        if (linked.length > 0) {
          const linkedIds = new Set(exactMatches.map(e => e.id))
          const uniqueLinked = linked.filter(e => !linkedIds.has(e.id))
          if (uniqueLinked.length > 0) {
            sections.push(`\nLinked experiments:`)
            for (const e of uniqueLinked) {
              sections.push(`  [#${e.id}, ${e.relationship}] ${(e.description ?? "").slice(0, 100)}\n  ${(e.conclusion ?? "").slice(0, 300)}`)
            }
          }
        }

        if (sameTarget.length > 0) {
          sections.push(`\nOther ${target} experiments (tradeoff awareness):`)
          for (const e of sameTarget) {
            sections.push(`  [#${e.id}, ${e.dimension}] ${(e.conclusion ?? "").slice(0, 200)}`)
          }
        }

        return sections.join("\n")
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
  consecutiveFailures: number = 0,
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

  const systemPrompt = `You are an expert at improving LLM agent prompts for a novel-writing harness. You will be given:
1. The current prompt(s) for one or more agents
2. The benchmark dimension being measured and its current score (higher=better for all dimensions)
3. Judge reasoning explaining WHY the score is low
4. Context: previous attempts, git history, per-seed scores, experiment conclusions

## Scoring
All scores are higher=better. For prose penalty dimensions (telling, dead-weight, dialogue-problems), the score is the negated issue count — e.g., -5 means 5 issues found, -2 means 2 issues (better). For other dimensions (completeness, accuracy, beat-specificity, etc.), scores are 1-10 scale.

## What good changes look like
- Add a specific rule that directly addresses the judge's criticism, with a concrete example of desired vs. undesired output
- Restructure existing instructions for clarity when the agent appears confused about priorities
- Remove or reword conflicting instructions that cause the weakness
- Add a "do not" constraint when the agent repeatedly makes the same mistake

## Anti-patterns — do NOT do these
- Do NOT rewrite the entire prompt (guardrails reject >50% change — be surgical)
- Do NOT add vague instructions like "ensure high quality" or "be more careful"
- Do NOT duplicate existing instructions in different words
- Do NOT remove unrelated sections to make room for new ones
- Do NOT add meta-instructions about "thinking step by step" or "being thorough"

## Strategy
- If the judge cites a specific pattern (e.g., "filter words like 'seemed to'"), add a rule targeting that exact pattern with a before/after example
- If multiple judge entries cluster around one weakness, a structural change (reordering, adding a section header) may work better than another bullet point
- If previous attempts for this dimension all failed, try a fundamentally different approach — don't keep adding more rules when rules aren't working
- Consider whether the issue is in the system prompt's rules or in how the agent's context/input is presented

Respond with ONLY valid JSON:
{
  "agentName": "which agent's prompt to change",
  "newPrompt": "the complete new prompt (not a diff — the full replacement)",
  "explanation": "1-2 sentences on what you changed and why"
}`

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
## Current Score: ${currentScore} (higher=better)

## Judge Reasoning (why the score is low):

${reasoningSection}${contextBlock}

Propose a targeted prompt change to improve the ${dimension} score. Focus on the specific weaknesses the judge identified.${consecutiveFailures >= 2 ? `\n\nIMPORTANT: ${consecutiveFailures} previous attempts failed to improve the score. Try a fundamentally different approach — restructure the prompt, remove conflicting rules, or add concrete before/after examples instead of abstract rules.` : ""}`

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
        temperature: Math.min(0.7 + consecutiveFailures * 0.1, 1.0),
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

// ── Apply/revert changes ──────────────────────────────────────────────

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

// ── Run benchmark (subprocess) ────────────────────────────────────────

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

export async function synthesizeConclusion(
  cycleId: number,
  target: string,
  dimension: string,
  baselineScore: number,
  finalScore: number,
): Promise<string | null> {
  const iters = await harness.cycles.getCycleIterations(cycleId)
  if (iters.length === 0) return null

  const attemptSections: string[] = []
  for (const iter of iters) {
    const header = `Attempt ${iter.iterationNum} — ${iter.result} (${iter.baselineScore} → ${iter.newScore ?? "?"}, delta: ${iter.delta ?? "?"})`
    const explanation = iter.proposalExplanation ?? "no explanation"

    let diff = ""
    if (iter.backupContent && iter.proposedContent) {
      diff = buildCompactDiff(iter.backupContent, iter.proposedContent)
    }

    const parts = [header, `Explanation: ${explanation}`]
    if (diff) parts.push(`Diff:\n${diff}`)
    attemptSections.push(parts.join("\n"))
  }

  // Get judge reasoning for weakest generations
  let judgeContext = ""
  try {
    const latestScores = await harness.scores.getLatestScores(target, dimension)
    if (latestScores) {
      const reasoning = await harness.scores.getJudgeReasoningForRun(latestScores.runId, dimension, 3)
      if (reasoning.length > 0) {
        judgeContext = reasoning.map(r => `[${r.seed}, score ${r.score}]: ${r.reasoning.slice(0, 300)}`).join("\n")
      }
    }
  } catch { /* non-critical */ }

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
Baseline: ${baselineScore} → Final: ${finalScore} (${finalScore >= baselineScore ? "+" : ""}${(finalScore - baselineScore).toFixed(1)}, higher=better)
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

function buildCompactDiff(original: string, modified: string): string {
  const origLines = original.split("\n")
  const modLines = modified.split("\n")
  const diff: string[] = []

  let i = 0, j = 0
  while (i < origLines.length || j < modLines.length) {
    if (i < origLines.length && j < modLines.length && origLines[i] === modLines[j]) {
      i++; j++
      continue
    }
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
