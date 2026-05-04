/**
 * Step 2A runner: grade planner-like Canon claims against the Salvatore manual
 * Canon fixture. This uses the fixture's planned-origin provenance as a proxy
 * because no persisted live planner-output sample exists yet.
 *
 * Usage: bun scripts/audits/run-planner-integrity.ts [--json]
 */

import {
  canonReferenceItems,
  plannedOriginProxyItems,
  runPlannerIntegrity,
  type PlannerIntegrityBucketMetrics,
  type PlannerIntegrityItem,
  type PlannerIntegrityReport,
} from "../../src/canon/planner-integrity"
import {
  validateCanonFixture,
  type CanonFixture,
} from "../../src/canon/recall-validation"

const CANON_PATH = "tests/canon/fixtures/salvatore-crystal-shard.canon.json"

async function main(): Promise<void> {
  const canonRaw = await Bun.file(CANON_PATH).json()
  validateCanonFixture(canonRaw, CANON_PATH)
  const canon: CanonFixture = canonRaw

  const emitted = plannedOriginProxyItems(canon)
  const reference = canonReferenceItems(canon)
  const report = runPlannerIntegrity({
    sourceName: "salvatore-planned-origin-proxy",
    evidenceKind: "planned-origin-proxy",
    emitted,
    reference,
  })

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  printHumanReport(canon, report)
}

function printHumanReport(canon: CanonFixture, report: PlannerIntegrityReport): void {
  console.log("=".repeat(76))
  console.log(
    `Step 2A planner Canon integrity - ${canon.novelId} @ ${canon.snapshotVersion}`,
  )
  console.log("=".repeat(76))
  console.log()
  console.log("INPUT")
  console.log("-".repeat(76))
  console.log(`  sourceName:       ${report.sourceName}`)
  console.log(`  evidenceKind:     ${report.thresholds.evidenceKind}`)
  console.log(
    "  evidenceNote:     planned-origin proxy is diagnostic only; no live planner-output fixture was found",
  )
  console.log()

  console.log("AGGREGATE")
  console.log("-".repeat(76))
  printBucket(report.overall, "overall")
  console.log()

  console.log("STOP GATES")
  console.log("-".repeat(76))
  console.log(
    `  sourceEvidenceGate: ${gate(report.thresholds.sourceEvidenceGateClear)} (${report.thresholds.evidenceKind})`,
  )
  console.log(
    `  sampleGate:         ${gate(report.thresholds.sampleGateClear)} (${report.overall.gradedItemCount}/${report.thresholds.minGradedItems} graded, ${report.overall.distinctChapterCount}/${report.thresholds.minDistinctChapters} chapters)`,
  )
  console.log(
    `  precisionGate:      ${gate(report.thresholds.precisionGateClear)} (${rate(report.overall.precision)} >= ${report.thresholds.precisionFloor})`,
  )
  console.log(
    `  recallGate:         ${gate(report.thresholds.recallGateClear)} (${rate(report.overall.recall)} >= ${report.thresholds.recallFloor})`,
  )
  console.log(
    `  f1Gate:             ${gate(report.thresholds.f1GateClear)} (${rate(report.overall.f1)} >= ${report.thresholds.f1Floor})`,
  )
  console.log(
    `  allGatesClear:      ${gate(report.thresholds.allGatesClear)}`,
  )
  console.log(`  recommendation:      ${report.thresholds.recommendation}`)
  console.log()

  console.log("BY CATEGORY")
  console.log("-".repeat(76))
  const header = `  ${"category".padEnd(20)} ${"TP".padStart(4)} ${"FP".padStart(4)} ${"FN".padStart(4)} ${"emit".padStart(5)} ${"ref".padStart(5)} ${"prec".padStart(7)} ${"recall".padStart(7)} ${"f1".padStart(7)}`
  console.log(header)
  for (const bucket of Object.values(report.byCategory)) {
    console.log(
      `  ${bucket.category.padEnd(20)} ${String(bucket.truePositives.length).padStart(4)} ${String(bucket.falsePositives.length).padStart(4)} ${String(bucket.falseNegatives.length).padStart(4)} ${String(bucket.emittedCount).padStart(5)} ${String(bucket.referenceCount).padStart(5)} ${rate(bucket.precision).padStart(7)} ${rate(bucket.recall).padStart(7)} ${rate(bucket.f1).padStart(7)}`,
    )
  }
  console.log()

  printClusters("FALSE POSITIVES", report.overall.falsePositives)
  printClusters("FALSE NEGATIVES", report.overall.falseNegatives)
  printClusters("TRUE POSITIVES", report.overall.truePositives)
}

function printBucket(bucket: PlannerIntegrityBucketMetrics, label: string): void {
  console.log(`  ${label}:`)
  console.log(`    emittedCount:        ${bucket.emittedCount}`)
  console.log(`    referenceCount:      ${bucket.referenceCount}`)
  console.log(`    truePositives:       ${bucket.truePositives.length}`)
  console.log(`    falsePositives:      ${bucket.falsePositives.length}`)
  console.log(`    falseNegatives:      ${bucket.falseNegatives.length}`)
  console.log(`    gradedItemCount:     ${bucket.gradedItemCount}`)
  console.log(`    distinctChapterCnt:  ${bucket.distinctChapterCount}`)
  console.log(`    precision:           ${rate(bucket.precision)}`)
  console.log(`    recall:              ${rate(bucket.recall)}`)
  console.log(`    f1:                  ${rate(bucket.f1)}`)
}

function printClusters(title: string, items: readonly PlannerIntegrityItem[]): void {
  console.log(title)
  console.log("-".repeat(76))
  if (items.length === 0) {
    console.log("  (none)")
    console.log()
    return
  }

  const groups = groupByChapterCategory(items)
  for (const [key, group] of groups) {
    console.log(`  ${key} count=${group.length}`)
    for (const item of group) {
      console.log(`    ${item.id} - ${item.text}`)
    }
  }
  console.log()
}

function groupByChapterCategory(
  items: readonly PlannerIntegrityItem[],
): Array<[string, PlannerIntegrityItem[]]> {
  const groups = new Map<string, PlannerIntegrityItem[]>()
  for (const item of items) {
    const key = `ch${item.chapterN} ${item.category}`
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }
  return [...groups.entries()]
}

function rate(value: number): string {
  return value.toFixed(3)
}

function gate(clear: boolean): string {
  return clear ? "YES" : "NO"
}

void main()
