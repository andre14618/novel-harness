/**
 * Split halluc-checker-v2-pairs-raw.jsonl into 20 batches for Claude Code
 * subagent labeling (Stage 4). Each batch is written to:
 *   /tmp/halluc-label/batch_NN.json    (input for subagent NN)
 *
 * Subagent output location:
 *   /tmp/halluc-label/results_NN.jsonl (aggregated after all complete)
 *
 * Batch size: 25 pairs × 20 batches = 500 pairs. Matches the chapter-plan
 * methodology (see docs/synthetic-labeling-sop.md).
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "fs"
import { join } from "path"

const IN_PATH = "finetune-data/halluc-checker-v2-pairs-raw.jsonl"
const OUT_DIR = "/tmp/halluc-label"
const BATCH_SIZE = 25

const lines = readFileSync(IN_PATH, "utf8").trim().split("\n").filter(Boolean)
const pairs = lines.map((l, i) => ({ ...JSON.parse(l), _idx: i }))
console.log(`Loaded ${pairs.length} pairs`)

mkdirSync(OUT_DIR, { recursive: true })

// Wipe any previous batches/results to avoid stale files
if (existsSync(OUT_DIR)) {
  for (const f of readdirSync(OUT_DIR)) {
    if (f.startsWith("batch_") || f.startsWith("results_")) unlinkSync(join(OUT_DIR, f))
  }
}

let batchNum = 0
for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
  const batch = pairs.slice(i, i + BATCH_SIZE)
  const fname = join(OUT_DIR, `batch_${String(batchNum).padStart(2, "0")}.json`)
  writeFileSync(fname, JSON.stringify(batch, null, 2))
  batchNum++
}
console.log(`Wrote ${batchNum} batches to ${OUT_DIR}`)
console.log(`Each batch has ${BATCH_SIZE} pairs (last has ${pairs.length % BATCH_SIZE || BATCH_SIZE}).`)
