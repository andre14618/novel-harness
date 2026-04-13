/**
 * Split raw chapter-plan-checker pairs into batches for Sonnet subagent labeling.
 *
 * Reads:  lora-data/chapter-plan-checker-pairs.jsonl
 * Writes: /tmp/chapter-plan-label/batch_0.json through batch_N.json
 *
 * Each batch file is a JSON array of pair objects. Subagents read one batch
 * file and write results to /tmp/chapter-plan-label/results_N.jsonl.
 *
 * Usage:
 *   bun scripts/batch-chapter-plan-pairs.ts
 *   BATCH_SIZE=100 bun scripts/batch-chapter-plan-pairs.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"

const PAIRS_PATH = join(import.meta.dir, "../lora-data/chapter-plan-checker-pairs.jsonl")
const BATCH_DIR = "/tmp/chapter-plan-label"
const BATCH_SIZE = process.env.BATCH_SIZE ? parseInt(process.env.BATCH_SIZE) : 40

const lines = readFileSync(PAIRS_PATH, "utf8").trim().split("\n")

interface Pair {
  messages: Array<{ role: string; content: string }>
  _meta: { scenario: string; variant: string }
}

const pairs: Array<Pair & { _index: number }> = lines.map((l, i) => ({
  ...JSON.parse(l),
  _index: i,
}))

console.log(`Loaded ${pairs.length} pairs from ${PAIRS_PATH}`)

mkdirSync(BATCH_DIR, { recursive: true })

const numBatches = Math.ceil(pairs.length / BATCH_SIZE)

for (let i = 0; i < numBatches; i++) {
  const batch = pairs.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
  const batchPath = join(BATCH_DIR, `batch_${i}.json`)
  writeFileSync(batchPath, JSON.stringify(batch, null, 2))
}

console.log(`Split into ${numBatches} batches of ~${BATCH_SIZE} pairs each -> ${BATCH_DIR}/`)
console.log(`Batch files: batch_0.json through batch_${numBatches - 1}.json`)
console.log(`\nNext: spawn Sonnet subagents per scripts/chapter-plan-sonnet-labeling-instructions.md`)

// Also write a summary for the subagent instructions
const variantCounts: Record<string, number> = {}
for (const p of pairs) {
  const v = p._meta.variant
  variantCounts[v] = (variantCounts[v] ?? 0) + 1
}

console.log("\nVariant distribution:")
for (const [v, count] of Object.entries(variantCounts).sort()) {
  console.log(`  ${v}: ${count}`)
}
