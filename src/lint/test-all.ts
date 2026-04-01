/**
 * Lint ALL prose runs and persist results. Shows every flag with context.
 *
 * Usage: bun src/lint/test-all.ts
 */

import { getCentralDB } from "../../data/db"
import { lintRun, getLintSummary, getPatternStats } from "./index"

const db = getCentralDB()

const runs = db.query(
  "SELECT id, label, timestamp FROM runs WHERE run_type = 'prose' ORDER BY id"
).all() as { id: number; label: string; timestamp: string }[]

console.log(`\n═══ Linting ${runs.length} prose runs ═══\n`)

let grandTotal = 0
let grandWords = 0

for (const run of runs) {
  const results = lintRun(run.id)

  const wordCount = db.query(
    "SELECT COALESCE(SUM(word_count), 0) as w FROM generations WHERE run_id = ? AND prose IS NOT NULL"
  ).get(run.id) as any

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
  grandWords += wordCount.w
  console.log(`Run ${run.id} (${run.label}): ${runTotal} issues / ${wordCount.w} words`)
}

console.log(`\n═══ GRAND TOTAL ═══`)
console.log(`Runs: ${runs.length}`)
console.log(`Words: ${grandWords.toLocaleString()}`)
console.log(`Issues: ${grandTotal}`)
console.log(`Per 1000 words: ${((grandTotal / grandWords) * 1000).toFixed(2)}`)

console.log(`\n═══ PATTERN HIT RATES (from DB) ═══`)
const stats = getPatternStats() as any[]
for (const s of stats) {
  if (s.hit_count > 0) {
    console.log(`  #${s.id} [${s.category}] ${s.pattern.slice(0, 40)}... → ${s.hit_count} hits, ${s.skip_count} skips`)
  }
}

const totalPersisted = (db.query("SELECT COUNT(*) as c FROM lint_issues").get() as any).c
console.log(`\nTotal persisted in DB: ${totalPersisted}`)
