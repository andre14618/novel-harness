/**
 * §0a session-3b runner: load Salvatore canon + queries fixtures, run
 * validation, print missedIds first (the human-curated misses that drive
 * v2 scoping rule revisions if recall fails).
 *
 * Usage: bun scripts/audits/run-salvatore-recall.ts
 */

import {
  runValidation,
  validateCanonFixture,
  validateQueryFixture,
  type CanonFixture,
  type QueryFixture,
} from "../../src/canon/recall-validation"

const CANON_PATH = "tests/canon/fixtures/salvatore-crystal-shard.canon.json"
const QUERIES_PATH = "tests/canon/fixtures/salvatore-crystal-shard.queries.json"

async function main(): Promise<void> {
  const canonRaw = await Bun.file(CANON_PATH).json()
  validateCanonFixture(canonRaw, CANON_PATH)
  const canon: CanonFixture = canonRaw

  const queriesRaw = await Bun.file(QUERIES_PATH).json()
  validateQueryFixture(queriesRaw, QUERIES_PATH)
  const queries: QueryFixture = queriesRaw

  const report = runValidation(canon, queries)

  console.log("=".repeat(76))
  console.log(
    `§0a session-3b recall validation — ${canon.novelId} @ ${canon.snapshotVersion}`,
  )
  console.log("=".repeat(76))
  console.log()

  // Misses first — the actionable signal for v2 scoping rule iteration.
  console.log("MISSES (per query) — drives v2 scoping rule revisions if any")
  console.log("-".repeat(76))
  let missCount = 0
  for (const m of report.queries) {
    if (m.missedIds.length === 0) continue
    missCount++
    console.log(
      `  [${m.queryId}] ch${m.chapterN} ${m.category} — recall=${m.recall.toFixed(3)}`,
    )
    console.log(`    missed: ${m.missedIds.join(", ")}`)
  }
  if (missCount === 0) {
    console.log("  (no misses — every relevant ID was emitted)")
  } else {
    console.log(`\n  ${missCount} of ${report.queries.length} queries had misses`)
  }
  console.log()

  // Aggregate roll-up
  console.log("AGGREGATE")
  console.log("-".repeat(76))
  console.log(`  queryCount:           ${report.aggregate.queryCount}`)
  console.log(`  meanRecall (PRIMARY): ${report.aggregate.meanRecall.toFixed(3)}`)
  console.log(`  recallPassCount:      ${report.aggregate.recallPassCount}/${report.queries.length}`)
  console.log(`  meanPrecision (obs):  ${report.aggregate.meanPrecision.toFixed(3)}`)
  console.log(`  precisionPassCount:   ${report.aggregate.precisionPassCount}/${report.queries.length}`)
  console.log(`  tokenCapExceeded:     ${report.aggregate.tokenCapExceededCount} (chapter packets)`)
  console.log()
  console.log("  byCategory:")
  for (const [cat, stats] of Object.entries(report.aggregate.byCategory)) {
    console.log(
      `    ${cat.padEnd(32)} count=${stats.count}  recall=${stats.meanRecall.toFixed(3)}  precision=${stats.meanPrecision.toFixed(3)}`,
    )
  }
  console.log()

  // Stop gate
  console.log("STOP GATE")
  console.log("-".repeat(76))
  console.log(`  recallFloor:           ${report.thresholds.recallFloor}`)
  console.log(`  recallMinQueryCount:   ${report.thresholds.recallMinQueryCount}`)
  console.log(`  recallMinCategoryCnt:  ${report.thresholds.recallMinCategoryCount}`)
  console.log()
  console.log(
    `  recallGateClear:       ${report.thresholds.recallGateClear ? "YES — gate passes" : "NO — gate refuses"}`,
  )
  console.log(
    `  sanityCeilingClear:    ${report.thresholds.sanityCeilingClear ? "yes (observability)" : "FLAG — investigate scope rules"}`,
  )
  console.log()

  // Per-query summary table
  console.log("PER-QUERY SUMMARY")
  console.log("-".repeat(76))
  const header = `  ${"queryId".padEnd(34)} ${"ch".padEnd(3)} ${"recall".padStart(7)} ${"prec".padStart(7)}  ${"emitted".padStart(7)} ${"relevnt".padStart(7)} ${"missed".padStart(6)}`
  console.log(header)
  for (const m of report.queries) {
    console.log(
      `  ${m.queryId.padEnd(34)} ${String(m.chapterN).padEnd(3)} ${m.recall.toFixed(3).padStart(7)} ${m.precision.toFixed(3).padStart(7)}  ${String(m.emittedIds.length).padStart(7)} ${String(m.recalledIds.length + m.missedIds.length).padStart(7)} ${String(m.missedIds.length).padStart(6)}`,
    )
  }
  console.log()
}

void main()
