/**
 * Context-aware lint fix — model sweep.
 *
 * Tests creative pattern fixing (AI clichés, declared emotions) with
 * scene context across multiple models. Uses "scene" context level
 * (flagged sentence + 2 surrounding paragraphs) since that won in
 * experiment #71.
 *
 * Usage: SOURCE_RUN=204 bun benchmark/prose/lint-fix-context-model-sweep.ts
 */

import db from "../../data/connection"
import { createTuningExperiment, concludeExperiment } from "../../data/db"
import { lintProse, type LintIssue } from "../../src/lint"
import { getTransport } from "../../src/transport"
import { mean } from "./shared"

const CREATIVE_CATEGORIES = ["AI_CLICHE", "DECLARED_EMOTION", "SAID_BOOKISM"]

interface ModelConfig {
  label: string
  provider: string
  model: string
}

const MODELS: ModelConfig[] = [
  { label: "Kimi K2 (Groq)", provider: "groq", model: "moonshotai/kimi-k2-instruct-0905" },
  { label: "DeepSeek V3.2", provider: "deepseek", model: "deepseek-chat" },
  { label: "Qwen3 32B (Groq)", provider: "groq", model: "qwen/qwen3-32b" },
  { label: "Qwen3 235B (Cerebras)", provider: "cerebras", model: "qwen-3-235b-a22b-instruct-2507" },
]

const SYSTEM_PROMPT = `You are a prose copy editor. Fix the flagged pattern in the marked sentence by replacing it with a concrete, specific alternative that fits the scene context.

Rules:
- Replace the flagged phrase with something grounded in the physical scene — use sensory details (sounds, textures, smells) already present in the surrounding text
- The replacement must fit the emotional tone of the moment
- Change as few words as possible — preserve the sentence structure
- Do NOT add new information, characters, or plot points
- Do NOT use other AI fiction clichés as replacements

Return ONLY the fixed sentence. No explanation, no quotes, no JSON.`

function getScene(prose: string, sentence: string): string {
  const paragraphs = prose.split(/\n\n+/)
  const idx = paragraphs.findIndex(p => p.includes(sentence))
  if (idx === -1) return sentence
  const start = Math.max(0, idx - 1)
  const end = Math.min(paragraphs.length, idx + 2)
  return paragraphs.slice(start, end).join("\n\n")
}

async function fixWithModel(
  model: ModelConfig, issue: LintIssue, prose: string,
): Promise<{ fixed: string | null; latencyMs: number; cost: number; promptTokens: number; completionTokens: number }> {
  const scene = getScene(prose, issue.sentence)
  const userPrompt = `PATTERN TO FIX: "${issue.match}" → ${issue.fixTemplate}\n\nSURROUNDING SCENE:\n${scene}\n\nFIX THIS SENTENCE:\n${issue.sentence}`

  const start = Date.now()
  try {
    const response = await getTransport().execute({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      model: model.model,
      provider: model.provider as any,
      temperature: 0.3,
      maxTokens: 512,
      responseFormat: { type: "text" },
    })
    const latencyMs = Date.now() - start
    const fixed = response.content.trim().replace(/^["']|["']$/g, "")

    const promptTokens = response.usage?.prompt_tokens ?? 0
    const completionTokens = response.usage?.completion_tokens ?? 0
    const { getTokenCost } = await import("../../models/registry")
    const cost = getTokenCost(model.provider as any, model.model, promptTokens, completionTokens)

    if (!fixed || fixed === issue.sentence || fixed.includes(issue.match)) {
      return { fixed: null, latencyMs, cost, promptTokens, completionTokens }
    }
    return { fixed, latencyMs, cost, promptTokens, completionTokens }
  } catch (err) {
    return { fixed: null, latencyMs: Date.now() - start, cost: 0, promptTokens: 0, completionTokens: 0 }
  }
}

async function main() {
  const sourceRunId = parseInt(process.env.SOURCE_RUN ?? "")
  if (!sourceRunId) { console.error("SOURCE_RUN=<run_id> required"); process.exit(1) }

  const gens = await db`
    SELECT id, seed, prose, word_count, attempt
    FROM generations WHERE run_id = ${sourceRunId} AND passed = true AND prose IS NOT NULL
    ORDER BY seed, attempt
  ` as Array<{ id: number; seed: string; prose: string; word_count: number; attempt: number }>

  if (gens.length === 0) { console.error(`No generations in run ${sourceRunId}`); process.exit(1) }

  const experimentId = await createTuningExperiment(
    "lint-fix",
    "context-fix-model-sweep",
    `Context-aware creative lint fix model sweep. Scene context. Models: ${MODELS.map(m => m.label).join(", ")}. Source run: ${sourceRunId}.`,
  )

  console.log(`\nContext-Aware Lint Fix — Model Sweep`)
  console.log(`Source: run ${sourceRunId} (${gens.length} generations)`)
  console.log(`Models: ${MODELS.map(m => m.label).join(", ")}`)
  console.log(`Context: scene (paragraph + 2 surrounding)`)
  console.log(`Experiment: #${experimentId}\n`)

  const stats: Record<string, { fixed: number; total: number; cost: number[]; latency: number[] }> = {}
  for (const m of MODELS) stats[m.label] = { fixed: 0, total: 0, cost: [], latency: [] }

  for (const gen of gens) {
    const lintResult = await lintProse(gen.prose)
    const creativeIssues = lintResult.issues.filter(i => CREATIVE_CATEGORIES.includes(i.category))
    if (creativeIssues.length === 0) { console.log(`[${gen.seed}] gen ${gen.id} — no creative issues`); continue }

    console.log(`[${gen.seed}] gen ${gen.id} (${gen.word_count}w, ${creativeIssues.length} creative issues)`)

    for (const issue of creativeIssues) {
      console.log(`\n  [${issue.category}] "${issue.match}"`)
      console.log(`  Original: "${issue.sentence.slice(0, 100)}"`)

      for (const model of MODELS) {
        const result = await fixWithModel(model, issue, gen.prose)
        const s = stats[model.label]
        s.total++
        s.cost.push(result.cost)
        s.latency.push(result.latencyMs)

        if (result.fixed) {
          s.fixed++
          const display = result.fixed.length > 110 ? result.fixed.slice(0, 110) + "..." : result.fixed
          console.log(`    [${model.label}] ✓ "${display}"`)
          console.log(`      ${result.latencyMs}ms | ${result.promptTokens}+${result.completionTokens} tok | $${result.cost.toFixed(4)}`)
        } else {
          console.log(`    [${model.label}] ✗ no fix (${result.latencyMs}ms)`)
        }
      }
    }
    console.log()
  }

  // Report
  console.log("=".repeat(80))
  console.log("  CONTEXT-AWARE LINT FIX — MODEL COMPARISON")
  console.log("=".repeat(80))

  console.log(`\n  ${"Model".padEnd(26)} ${"Fixed".padStart(8)} ${"Rate".padStart(6)} ${"Avg Cost".padStart(10)} ${"Avg Time".padStart(10)}`)
  console.log("  " + "-".repeat(62))

  const conclusions: string[] = []
  for (const m of MODELS) {
    const s = stats[m.label]
    if (s.total === 0) continue
    const rate = ((s.fixed / s.total) * 100).toFixed(0)
    const avgCost = mean(s.cost).toFixed(4)
    const avgTime = mean(s.latency).toFixed(0)
    console.log(`  ${m.label.padEnd(26)} ${`${s.fixed}/${s.total}`.padStart(8)} ${`${rate}%`.padStart(6)} ${`$${avgCost}`.padStart(10)} ${`${avgTime}ms`.padStart(10)}`)
    conclusions.push(`${m.label}: ${s.fixed}/${s.total} (${rate}%), $${avgCost}/fix, ${avgTime}ms`)
  }

  console.log(`\n  Experiment: #${experimentId}`)
  await concludeExperiment(experimentId, conclusions.join("; "))
}

main()
