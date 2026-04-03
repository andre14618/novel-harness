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
import { checkBudget, recordSpend } from "./budget"
import { validateProposal, type Proposal } from "./guardrails"
import { MODELS, PROVIDERS, getApiKey } from "../../models/registry"
import { getModelForAgent } from "../../models/roles"
import { extractJSON } from "../llm"
import { getBatchProvider } from "../../benchmark/batch/providers"
import { createBatch, addBatchRequest, updateBatchSubmitted } from "../../data/db"
import type { BatchRequest } from "../../benchmark/batch/types"

const HARNESS_ROOT = process.env.HARNESS_ROOT ?? "/home/andre/apps/novel-harness"

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

// ── Propose a change via LLM ────────────────────────────────────────────

export async function proposeChange(
  currentPrompts: Array<{ agentName: string; content: string }>,
  dimension: string,
  currentScore: number,
  judgeReasoning: string[],
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

  const userPrompt = `## Current Prompts

${promptSection}

## Target Dimension: ${dimension}
## Current Score: ${currentScore}

## Judge Reasoning (why the score is low):

${reasoningSection}

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
