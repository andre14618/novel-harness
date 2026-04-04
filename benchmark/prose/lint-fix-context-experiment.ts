/**
 * Context-aware lint fix experiment.
 *
 * Tests whether giving the LLM surrounding context enables it to fix
 * creative patterns (AI clichés, declared emotions) that fail with
 * isolated sentences.
 *
 * Three context levels:
 *   - sentence-only: just the flagged sentence (baseline — this failed before)
 *   - paragraph: flagged sentence + its paragraph
 *   - scene: flagged sentence + paragraph + 2 surrounding paragraphs
 *
 * Only tests the "hard" patterns that deterministic can't handle.
 *
 * Usage: SOURCE_RUN=204 bun benchmark/prose/lint-fix-context-experiment.ts
 */

import db from "../../data/connection"
import { createRun, saveGeneration, saveLLMCall } from "../db"
import { createTuningExperiment, concludeExperiment } from "../../data/db"
import { lintProse, saveLintIssues, type LintIssue } from "../../src/lint"
import { getTransport } from "../../src/transport"
import { mean } from "./shared"

// Only test creative patterns that deterministic can't handle
const CREATIVE_CATEGORIES = ["AI_CLICHE", "DECLARED_EMOTION", "SAID_BOOKISM"]

interface ContextLevel {
  label: string
  buildContext: (prose: string, sentence: string) => string
}

function getParagraph(prose: string, sentence: string): string {
  const paragraphs = prose.split(/\n\n+/)
  return paragraphs.find(p => p.includes(sentence)) ?? sentence
}

function getScene(prose: string, sentence: string): string {
  const paragraphs = prose.split(/\n\n+/)
  const idx = paragraphs.findIndex(p => p.includes(sentence))
  if (idx === -1) return sentence
  const start = Math.max(0, idx - 1)
  const end = Math.min(paragraphs.length, idx + 2)
  return paragraphs.slice(start, end).join("\n\n")
}

const CONTEXT_LEVELS: ContextLevel[] = [
  {
    label: "sentence-only",
    buildContext: (_prose, sentence) => sentence,
  },
  {
    label: "paragraph",
    buildContext: (prose, sentence) => {
      const para = getParagraph(prose, sentence)
      return `PARAGRAPH:\n${para}\n\nFIX THIS SENTENCE:\n${sentence}`
    },
  },
  {
    label: "scene",
    buildContext: (prose, sentence) => {
      const scene = getScene(prose, sentence)
      return `SURROUNDING SCENE:\n${scene}\n\nFIX THIS SENTENCE:\n${sentence}`
    },
  },
]

const LLM = { provider: "cerebras", model: "qwen-3-235b-a22b-instruct-2507" }

const SYSTEM_PROMPT = `You are a prose copy editor. Fix the flagged pattern in the marked sentence by replacing it with a concrete, specific alternative that fits the scene context.

Rules:
- Replace the flagged phrase with something grounded in the physical scene — use sensory details (sounds, textures, smells) already present in the surrounding text
- The replacement must fit the emotional tone of the moment
- Change as few words as possible — preserve the sentence structure
- Do NOT add new information, characters, or plot points
- Do NOT use other AI fiction clichés as replacements

Return ONLY the fixed sentence. No explanation, no quotes, no JSON.`

async function fixWithContext(
  contextLevel: ContextLevel, issue: LintIssue, prose: string,
): Promise<{ fixed: string | null; tokens: number; latencyMs: number; cost: number }> {
  const context = contextLevel.buildContext(prose, issue.sentence)
  const userPrompt = `PATTERN TO FIX: "${issue.match}" → ${issue.fixTemplate}\n\n${context}`

  const start = Date.now()
  try {
    const response = await getTransport().execute({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      model: LLM.model,
      provider: LLM.provider as any,
      temperature: 0.3,
      maxTokens: 512,
      responseFormat: { type: "text" },
    })
    const latencyMs = Date.now() - start
    const fixed = response.content.trim().replace(/^["']|["']$/g, "")

    const promptTokens = response.usage?.prompt_tokens ?? 0
    const completionTokens = response.usage?.completion_tokens ?? 0
    const { getTokenCost } = await import("../../models/registry")
    const cost = getTokenCost(LLM.provider as any, LLM.model, promptTokens, completionTokens)

    // Check if the fix actually changed the flagged pattern
    if (!fixed || fixed === issue.sentence || fixed.includes(issue.match)) {
      return { fixed: null, tokens: completionTokens, latencyMs, cost }
    }

    return { fixed, tokens: completionTokens, latencyMs, cost }
  } catch {
    return { fixed: null, tokens: 0, latencyMs: Date.now() - start, cost: 0 }
  }
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
    "context-aware-lint-fix",
    `Context-aware lint fixing for creative patterns. Levels: ${CONTEXT_LEVELS.map(l => l.label).join(", ")}. Model: Qwen3 235B.`,
  )

  console.log(`\nContext-Aware Lint Fix Experiment`)
  console.log(`Source: run ${sourceRunId} (${gens.length} generations)`)
  console.log(`Model: ${LLM.model}`)
  console.log(`Context levels: ${CONTEXT_LEVELS.map(l => l.label).join(", ")}`)
  console.log(`Experiment: #${experimentId}\n`)

  const stats: Record<string, { fixed: number; total: number; cost: number[]; latency: number[] }> = {}
  for (const level of CONTEXT_LEVELS) {
    stats[level.label] = { fixed: 0, total: 0, cost: [], latency: [] }
  }

  for (const gen of gens) {
    const lintResult = await lintProse(gen.prose)
    const creativeIssues = lintResult.issues.filter(i => CREATIVE_CATEGORIES.includes(i.category))

    console.log(`[${gen.seed}] gen ${gen.id} (${gen.word_count}w, ${creativeIssues.length} creative issues)`)

    if (creativeIssues.length === 0) { console.log("  No creative issues — skipping"); continue }

    for (const issue of creativeIssues) {
      console.log(`\n  [${issue.category}] "${issue.match}"`)
      console.log(`  Original: "${issue.sentence.slice(0, 100)}"`)

      for (const level of CONTEXT_LEVELS) {
        const result = await fixWithContext(level, issue, gen.prose)
        const s = stats[level.label]
        s.total++
        s.cost.push(result.cost)
        s.latency.push(result.latencyMs)

        if (result.fixed) {
          s.fixed++
          // Truncate for display
          const display = result.fixed.length > 100 ? result.fixed.slice(0, 100) + "..." : result.fixed
          console.log(`    [${level.label}] ✓ "${display}" (${result.latencyMs}ms, $${result.cost.toFixed(4)})`)
        } else {
          console.log(`    [${level.label}] ✗ no fix (${result.latencyMs}ms)`)
        }
      }
    }
    console.log()
  }

  // ── Report ──────��─────────────────────────────────────────────────────

  console.log("=".repeat(70))
  console.log("  CONTEXT-AWARE LINT FIX RESULTS")
  console.log("=".repeat(70))

  console.log(`\n  ${"Context Level".padEnd(20)} ${"Fixed".padStart(10)} ${"Rate".padStart(8)} ${"Avg Cost".padStart(10)} ${"Avg Time".padStart(10)}`)
  console.log("  " + "-".repeat(58))

  const conclusions: string[] = []
  for (const level of CONTEXT_LEVELS) {
    const s = stats[level.label]
    if (s.total === 0) continue
    const rate = ((s.fixed / s.total) * 100).toFixed(0)
    const avgCost = s.cost.length > 0 ? mean(s.cost).toFixed(4) : "0"
    const avgTime = s.latency.length > 0 ? mean(s.latency).toFixed(0) : "0"

    console.log(
      `  ${level.label.padEnd(20)} ` +
      `${s.fixed}/${s.total}`.padStart(10) + " " +
      `${rate}%`.padStart(8) + " " +
      `$${avgCost}`.padStart(10) + " " +
      `${avgTime}ms`.padStart(10),
    )
    conclusions.push(`${level.label}: ${s.fixed}/${s.total} (${rate}%)`)
  }

  console.log(`\n  Experiment: #${experimentId}`)
  await concludeExperiment(experimentId, conclusions.join("; "))
}

main()
