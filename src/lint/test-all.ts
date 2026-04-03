/**
 * Lint ALL prose runs and persist results. Shows every flag with context.
 *
 * Usage: bun src/lint/test-all.ts
 */

import db from "../../data/connection"
import { lintRun, getPatternStats } from "./index"

const runs = await db`
  SELECT id, label, timestamp FROM runs WHERE run_type = 'prose' ORDER BY id
` as { id: number; label: string; timestamp: string }[]

console.log(`\n═══ Linting ${runs.length} prose runs ═══\n`)

let grandTotal = 0
let grandWords = 0

for (const run of runs) {
  const results = await lintRun(run.id)

  const [wordRow] = await db`
    SELECT COALESCE(SUM(word_count), 0) as w FROM generations WHERE run_id = ${run.id} AND prose IS NOT NULL
  ` as any[]

  let runTotal = 0
  for (const { generationId, seed, result } of results) {
    runTotal += result.totalIssues
    if (result.totalIssues > 0) {
      for (const issue of result.issues) {
        console.log(`[Run ${run.id} / ${seed}] @${issue.charOffset} [${issue.category}] (pattern #${issue.patternId})`)
        console.log(`  "${issue.match}"`)
        console.log(`  → ${issue.sentence}`)
        console.log(`  Fix: ${issue.fixTemplate}`)
        console.log()
      }
    }
  }

  grandTotal += runTotal
  grandWords += parseInt(wordRow.w ?? "0")
  console.log(`Run ${run.id} (${run.label}): ${runTotal} issues / ${wordRow.w} words`)
}

console.log(`\n═══ GRAND TOTAL ═══`)
console.log(`Runs: ${runs.length}`)
console.log(`Words: ${grandWords.toLocaleString()}`)
console.log(`Issues: ${grandTotal}`)
console.log(`Per 1000 words: ${grandWords > 0 ? ((grandTotal / grandWords) * 1000).toFixed(2) : "0.00"}`)

console.log(`\n═══ PATTERN HIT RATES (from DB) ═══`)
const stats = await getPatternStats() as any[]
for (const s of stats) {
  if (s.hit_count > 0) {
    console.log(`  #${s.id} [${s.category}] ${s.pattern.slice(0, 40)}... → ${s.hit_count} hits, ${s.skip_count} skips`)
  }
}

const [totalRow] = await db`SELECT COUNT(*) as c FROM lint_issues` as any[]
console.log(`\nTotal persisted in DB: ${totalRow.c}`)
