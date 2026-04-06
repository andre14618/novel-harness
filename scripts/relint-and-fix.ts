/**
 * Re-lint experiment generations with current enabled patterns,
 * then run Llama 8B tonal fixes on AI_CLICHE hits.
 *
 * Usage: RUNS=323,324,325 bun scripts/relint-and-fix.ts
 */

import db from "../data/connection"
import { lintProse, saveLintIssues } from "../src/lint/index"
import { getTransport } from "../src/transport"

const RUN_IDS = (process.env.RUNS ?? "323,324,325").split(",").map(Number)

const SYSTEM_PROMPT = `You are a prose editor. You will receive a sentence from a fiction chapter that has been flagged for a specific AI writing cliché. Your job is to fix ONLY the flagged issue while preserving the author's voice, style, and intent.

Rules:
- Replace the clichéd construction with something concrete and specific to the scene.
- If the best fix is to DELETE the sentence entirely (because surrounding context already conveys the meaning), respond with just: [DELETE]
- Preserve the tone, tense, POV, and vocabulary level.
- Do not add new information or change the plot.
- Respond with ONLY the fixed sentence (or [DELETE]). No explanation, no quotes around it.`

async function getContext(genId: number, sentence: string): Promise<string> {
  const [gen] = await db`SELECT prose FROM generations WHERE id = ${genId}` as any[]
  if (!gen?.prose) return ""
  const idx = gen.prose.indexOf(sentence.slice(0, 40))
  if (idx === -1) return sentence
  const start = Math.max(0, idx - 300)
  const end = Math.min(gen.prose.length, idx + sentence.length + 300)
  return gen.prose.slice(start, end)
}

async function main() {
  // Phase 1: Re-lint with trimmed pattern set
  console.log("=== PHASE 1: RE-LINT ===\n")

  const gens = await db`
    SELECT g.id, g.seed, g.prose, g.word_count, r.label
    FROM generations g
    JOIN runs r ON r.id = g.run_id
    WHERE g.run_id IN ${db(RUN_IDS)} AND g.passed = true AND g.prose IS NOT NULL
    ORDER BY g.id
  ` as any[]

  console.log(`Generations: ${gens.length}`)

  const genIds = gens.map((g: any) => g.id)
  await db`DELETE FROM lint_issues WHERE generation_id IN ${db(genIds)}`
  console.log("Cleared old lint issues\n")

  let totalIssues = 0
  for (const gen of gens) {
    const result = await lintProse(gen.prose)
    await saveLintIssues(gen.id, result.issues)
    totalIssues += result.totalIssues
    const label = gen.label?.replace("writer-sweep-", "") ?? "?"
    console.log(`  [${label}] gen ${gen.id} | ${gen.seed} | ${result.totalIssues} issues`)
  }

  console.log(`\nTotal issues: ${totalIssues}`)

  // Breakdown
  const breakdown = await db`
    SELECT lp.id, lp.category, lp.pattern, COUNT(*) as hits
    FROM lint_issues li
    JOIN lint_patterns lp ON lp.id = li.pattern_id
    WHERE li.generation_id IN ${db(genIds)}
    GROUP BY lp.id, lp.category, lp.pattern
    ORDER BY COUNT(*) DESC
  ` as any[]

  console.log("\nPattern breakdown:")
  for (const b of breakdown) {
    console.log(`  ${b.hits}x [${b.id}] ${b.category}: ${b.pattern?.slice(0, 55) || "(heuristic)"}`)
  }

  // Phase 2: Fix AI_CLICHE and HEDGE_QUALIFIER hits with Llama 8B
  console.log("\n=== PHASE 2: LLAMA 8B TONAL FIXES ===\n")

  const fixableIssues = await db`
    SELECT li.id, li.generation_id, li.match, li.sentence,
           lp.id as pattern_id, lp.category, lp.fix_template
    FROM lint_issues li
    JOIN lint_patterns lp ON lp.id = li.pattern_id
    WHERE li.generation_id IN ${db(genIds)}
      AND lp.category IN ('AI_CLICHE', 'HEDGE_QUALIFIER', 'DECLARED_EMOTION')
      AND li.sentence IS NOT NULL
    ORDER BY lp.category, li.id
  ` as any[]

  console.log(`Fixable issues: ${fixableIssues.length}\n`)

  let good = 0, deleted = 0, unchanged = 0, errors = 0

  for (const issue of fixableIssues) {
    const context = await getContext(issue.generation_id, issue.sentence)

    const userPrompt = `CONTEXT (surrounding prose):
${context}

FLAGGED SENTENCE:
${issue.sentence}

ISSUE: ${issue.category} — ${issue.fix_template}

MATCHED PATTERN: "${issue.match}"

Fix the flagged sentence.`

    try {
      const start = Date.now()
      const response = await getTransport().execute({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        model: "llama-3.1-8b-instant",
        provider: "groq",
        temperature: 0.3,
        maxTokens: 512,
        responseFormat: { type: "text" },
      })
      const output = response.content.trim()
      const latencyMs = Date.now() - start
      const isDelete = output.includes("[DELETE]")
      const isUnchanged = output.trim() === issue.sentence.trim()

      if (isDelete) deleted++
      else if (isUnchanged) unchanged++
      else good++

      const tag = isDelete ? "DEL" : isUnchanged ? "SAME" : "FIX"
      console.log(`[${tag}] [${issue.category}] (${latencyMs}ms)`)
      console.log(`  ORIGINAL: ${issue.sentence.slice(0, 120)}`)
      if (!isUnchanged) console.log(`  FIXED:    ${output.slice(0, 120)}`)
      console.log()
    } catch (err) {
      errors++
      console.log(`[ERR] [${issue.category}] ${err instanceof Error ? err.message : err}`)
      console.log(`  ORIGINAL: ${issue.sentence.slice(0, 120)}`)
      console.log()
    }
  }

  console.log("=".repeat(60))
  console.log("SUMMARY")
  console.log("=".repeat(60))
  console.log(`Total fixable: ${fixableIssues.length}`)
  console.log(`Good fixes: ${good}`)
  console.log(`Deletions: ${deleted}`)
  console.log(`Unchanged: ${unchanged}`)
  console.log(`Errors: ${errors}`)
}

main().then(() => process.exit(0))
