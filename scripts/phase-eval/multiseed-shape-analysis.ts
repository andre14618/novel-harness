/** L6 multi-seed probe-shape variance analysis (one-shot, not committed
 *  to runtime defaults — this is the analysis CLI for the result doc).
 *
 *  Usage: bun scripts/phase-eval/multiseed-shape-analysis.ts <probe-row-id>
 *
 *  Reads the probe row's persisted summary_json + the exp #311 baseline
 *  rows (17-21) and prints the variance comparison table that backs the
 *  recommendation in docs/multi-seed-probe-shape-2026-05-01.md. */

import db from "../../src/db/connection"

const probeRowId = Number(process.argv[2])
if (!probeRowId) { console.error("usage: bun scripts/phase-eval/multiseed-shape-analysis.ts <phase_eval_runs.id>"); process.exit(2) }

const stddev = (xs: number[]) => {
  if (xs.length < 2) return 0
  const mu = xs.reduce((a, x) => a + x, 0) / xs.length
  return Math.sqrt(xs.reduce((a, x) => a + (x - mu) ** 2, 0) / (xs.length - 1))
}
const mean = (xs: number[]) => xs.length === 0 ? 0 : xs.reduce((a, x) => a + x, 0) / xs.length
const range = (xs: number[]) => xs.length === 0 ? 0 : Math.max(...xs) - Math.min(...xs)

const probeRows = await db`SELECT summary_json FROM phase_eval_runs WHERE id = ${probeRowId}`
if (probeRows.length === 0) { console.error(`no row id=${probeRowId}`); process.exit(2) }
const sj = (probeRows[0] as any).summary_json

console.log(`=== Multi-seed probe-shape variance — phase_eval_runs.id=${probeRowId} ===\n`)
console.log(`Variant: ${sj.variant}  seeds=${sj.seeds.join(",")}  chapters/seed=${sj.chaptersPerSeed}  reruns/seed=${sj.rerunsPerSeed}\n`)
console.log(`Per-cell metrics:`)
for (const c of sj.cells) {
  console.log(`  ${c.seed} r${c.rerun}: facts=${c.facts_median} know=${c.knowledge_median} beats=${c.total_beats} chapters=${c.chapters_total} ok=${c.ok}${c.reason ? ` (${c.reason})` : ""}`)
}
console.log()

const okCells = sj.cells.filter((c: any) => c.ok)
const allFacts = okCells.map((c: any) => c.facts_median)
const allKnow = okCells.map((c: any) => c.knowledge_median)
const allBeats = okCells.map((c: any) => c.total_beats)

console.log(`Config B (3 seeds × ${sj.chaptersPerSeed} chapters × ${sj.rerunsPerSeed} reruns; ${okCells.length}/${sj.cells.length} ok cells):`)
console.log(`  facts_median across-cell:    σ=${stddev(allFacts).toFixed(3)}  μ=${mean(allFacts).toFixed(2)}  range=${range(allFacts)}`)
console.log(`  know_median across-cell:     σ=${stddev(allKnow).toFixed(3)}  μ=${mean(allKnow).toFixed(2)}  range=${range(allKnow)}`)
console.log(`  total_beats across-cell:     σ=${stddev(allBeats).toFixed(2)}  μ=${mean(allBeats).toFixed(1)}  range=${range(allBeats)}`)

const seedMeansFacts = sj.seedAggregates.map((s: any) => s.facts_median_mean)
const seedMeansKnow = sj.seedAggregates.map((s: any) => s.knowledge_median_mean)
const seedMeansBeats = sj.seedAggregates.map((s: any) => s.total_beats_mean)
console.log(`  facts_median across-seed:    σ=${stddev(seedMeansFacts).toFixed(3)}`)
console.log(`  know_median across-seed:     σ=${stddev(seedMeansKnow).toFixed(3)}`)
console.log(`  total_beats across-seed:     σ=${stddev(seedMeansBeats).toFixed(2)}`)
console.log()
console.log(`Per-seed (within-rerun) aggregates:`)
for (const s of sj.seedAggregates) {
  console.log(`  ${s.seed} (n=${s.ok_count}): facts μ=${s.facts_median_mean.toFixed(2)} σ=${s.facts_median_stddev.toFixed(2)} range=${s.facts_median_range} | know μ=${s.knowledge_median_mean.toFixed(2)} σ=${s.knowledge_median_stddev.toFixed(2)} range=${s.knowledge_median_range} | beats μ=${s.total_beats_mean.toFixed(1)} σ=${s.total_beats_stddev.toFixed(2)} range=${s.total_beats_range}`)
}

// Also pool the per-seed within-rerun stddevs into a single "typical
// within-seed across-rerun σ" for direct comparison to Config A's
// across-rerun σ.
const okSeeds = sj.seedAggregates.filter((s: any) => s.ok_count >= 2)
const pooledFacts = okSeeds.length === 0 ? 0 : Math.sqrt(mean(okSeeds.map((s: any) => s.facts_median_stddev ** 2)))
const pooledKnow = okSeeds.length === 0 ? 0 : Math.sqrt(mean(okSeeds.map((s: any) => s.knowledge_median_stddev ** 2)))
const pooledBeats = okSeeds.length === 0 ? 0 : Math.sqrt(mean(okSeeds.map((s: any) => s.total_beats_stddev ** 2)))
console.log()
console.log(`Pooled within-seed across-rerun σ (RMS of per-seed stddevs, n_seeds=${okSeeds.length}):`)
console.log(`  facts_median pooled-within-seed σ=${pooledFacts.toFixed(3)}`)
console.log(`  know_median pooled-within-seed σ=${pooledKnow.toFixed(3)}`)
console.log(`  total_beats pooled-within-seed σ=${pooledBeats.toFixed(2)}`)
console.log()

// === Config A baseline (exp #311 r1-r5 default control) ===
const baselineRows = await db`SELECT id, summary_json -> 'g_metrics' -> 'control' AS control FROM phase_eval_runs WHERE id IN (17,18,19,20,21) ORDER BY id`
const baseFacts = baselineRows.map((r: any) => Number(r.control.facts_median))
const baseKnow = baselineRows.map((r: any) => Number(r.control.knowledge_median))
const baseBeats = baselineRows.map((r: any) => Number(r.control.total_beats))

console.log(`Config A (1 seed × 10 chapters × 5 reruns; default control of #311 r1-r5):`)
console.log(`  facts_median across-rerun:   σ=${stddev(baseFacts).toFixed(3)}  μ=${mean(baseFacts).toFixed(2)}  range=${range(baseFacts)}`)
console.log(`  know_median across-rerun:    σ=${stddev(baseKnow).toFixed(3)}  μ=${mean(baseKnow).toFixed(2)}  range=${range(baseKnow)}`)
console.log(`  total_beats across-rerun:    σ=${stddev(baseBeats).toFixed(2)}  μ=${mean(baseBeats).toFixed(1)}  range=${range(baseBeats)}`)
console.log()

// === Comparison table ===
console.log(`=== Variance comparison ===`)
console.log(`metric            | Config A across-rerun σ | Config B across-cell σ | Config B across-seed-mean σ | Config B pooled within-seed σ`)
const fmt = (n: number, w: number = 6) => n.toFixed(3).padStart(w)
console.log(`facts_median      |          ${fmt(stddev(baseFacts))}         |         ${fmt(stddev(allFacts))}        |             ${fmt(stddev(seedMeansFacts))}        |             ${fmt(pooledFacts)}`)
console.log(`know_median       |          ${fmt(stddev(baseKnow))}         |         ${fmt(stddev(allKnow))}        |             ${fmt(stddev(seedMeansKnow))}        |             ${fmt(pooledKnow)}`)
console.log(`total_beats       |          ${stddev(baseBeats).toFixed(2).padStart(7)}        |        ${stddev(allBeats).toFixed(2).padStart(7)}         |            ${stddev(seedMeansBeats).toFixed(2).padStart(7)}         |            ${pooledBeats.toFixed(2).padStart(7)}`)
console.log()
console.log(`Note: total_beats is sensitive to chapter count (Config A: 10ch novels; Config B: 5ch novels).`)
console.log(`The medians (facts_median, know_median) are per-chapter and so are direct comparisons.`)
console.log(`Use facts_median + know_median as the primary directionality signal.`)

process.exit(0)
