/**
 * Tonal pass test: can a cheap model fix lint-flagged issues?
 *
 * Pulls lint issues from a set of runs, sends each flagged sentence
 * + surrounding context to a small model with the fix template,
 * and prints before/after for human review.
 *
 * Usage:
 *   RUNS=323,324,325 bun scripts/tonal-pass-test.ts
 */

import db from "../data/connection"
import { getTransport } from "../src/transport"

const RUN_IDS = (process.env.RUNS ?? "323,324,325").split(",").map(Number)
const MAX_ISSUES = parseInt(process.env.MAX_ISSUES ?? "30")

interface LintIssue {
  id: number
  generation_id: number
  pattern_id: number
  match: string
  sentence: string
  pattern: string
  category: string
  tier: number
  fix_template: string
  run_id: number
}

// Models to test
const MODELS = [
  { label: "MiMo V2 Flash", provider: "mimo" as const, model: "mimo-v2-flash" },
  { label: "Llama 3.1 8B (Groq)", provider: "groq" as const, model: "llama-3.1-8b-instant" },
]

const SYSTEM_PROMPT = `You are a prose editor. You will receive a sentence from a fiction chapter that has been flagged for a specific writing issue. Your job is to fix ONLY the flagged issue while preserving the author's voice, style, and intent.

Rules:
- Fix the specific issue described. Do not rewrite the entire sentence unnecessarily.
- If the best fix is to DELETE the sentence entirely (because surrounding context already conveys the meaning), respond with just: [DELETE]
- Preserve the tone, tense, POV, and vocabulary level.
- Do not add new information or change the meaning.
- Respond with ONLY the fixed sentence (or [DELETE]). No explanation.`

async function getContext(genId: number, sentence: string): Promise<string> {
  const [gen] = await db`SELECT prose FROM generations WHERE id = ${genId}` as any[]
  if (!gen?.prose) return ""
  const idx = gen.prose.indexOf(sentence.slice(0, 40))
  if (idx === -1) return ""
  const start = Math.max(0, idx - 200)
  const end = Math.min(gen.prose.length, idx + sentence.length + 200)
  return gen.prose.slice(start, end)
}

async function main() {
  // Pull lint issues with fix templates
  const issues: LintIssue[] = await db`
    SELECT li.id, li.generation_id, li.pattern_id, li.match, li.sentence,
           lp.pattern, lp.category, lp.tier, lp.fix_template,
           g.run_id
    FROM lint_issues li
    JOIN lint_patterns lp ON lp.id = li.pattern_id
    JOIN generations g ON g.id = li.generation_id
    WHERE g.run_id IN ${db(RUN_IDS)}
      AND lp.fix_template IS NOT NULL
      AND li.sentence IS NOT NULL
      AND lp.tier = 2
    ORDER BY lp.category, li.id
    LIMIT ${MAX_ISSUES}
  ` as any[]

  console.log(`Loaded ${issues.length} lint issues from runs ${RUN_IDS.join(", ")}`)
  console.log(`Testing models: ${MODELS.map(m => m.label).join(", ")}\n`)

  let results: Array<{
    issue: LintIssue
    context: string
    fixes: Record<string, { output: string; latencyMs: number; deleted: boolean }>
  }> = []

  for (const issue of issues) {
    const context = await getContext(issue.generation_id, issue.sentence)

    const fixes: Record<string, { output: string; latencyMs: number; deleted: boolean }> = {}

    for (const model of MODELS) {
      const userPrompt = `CONTEXT (surrounding prose):
${context}

FLAGGED SENTENCE:
${issue.sentence}

ISSUE: ${issue.category} — ${issue.fix_template}

MATCHED PATTERN: "${issue.match}"

Fix the flagged sentence.`

      const start = Date.now()
      try {
        const response = await getTransport().execute({
          systemPrompt: SYSTEM_PROMPT,
          userPrompt,
          model: model.model,
          provider: model.provider,
          temperature: 0.3,
          maxTokens: 512,
          responseFormat: { type: "text" },
        })
        const output = response.content.trim()
        const latencyMs = Date.now() - start
        const deleted = output.includes("[DELETE]")
        fixes[model.label] = { output, latencyMs, deleted }
      } catch (err) {
        fixes[model.label] = { output: `ERROR: ${err instanceof Error ? err.message : err}`, latencyMs: Date.now() - start, deleted: false }
      }
    }

    results.push({ issue, context, fixes })

    // Print inline
    console.log(`${"=".repeat(80)}`)
    console.log(`[${issue.category}] pattern ${issue.pattern_id} | tier ${issue.tier} | gen ${issue.generation_id}`)
    console.log(`FIX TEMPLATE: ${issue.fix_template}`)
    console.log(`MATCHED: "${issue.match}"`)
    console.log(`ORIGINAL: ${issue.sentence.slice(0, 200)}`)
    for (const model of MODELS) {
      const fix = fixes[model.label]
      const tag = fix.deleted ? " [DELETE]" : ""
      console.log(`  ${model.label} (${fix.latencyMs}ms)${tag}: ${fix.output.slice(0, 200)}`)
    }
    console.log()
  }

  // Summary
  console.log("=".repeat(80))
  console.log("SUMMARY")
  console.log("=".repeat(80))
  for (const model of MODELS) {
    const modelResults = results.map(r => r.fixes[model.label])
    const deletes = modelResults.filter(r => r.deleted).length
    const errors = modelResults.filter(r => r.output.startsWith("ERROR")).length
    const avgLatency = modelResults.reduce((s, r) => s + r.latencyMs, 0) / modelResults.length
    console.log(`${model.label}: ${results.length} issues | ${deletes} deletes | ${errors} errors | avg ${avgLatency.toFixed(0)}ms`)
  }
}

main().then(() => process.exit(0))
