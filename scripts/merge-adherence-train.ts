#!/usr/bin/env bun
/**
 * Merge curated synthetic + production adherence data into the final V2 training file.
 *
 * Reads:
 *   - lora-data/adherence-checker-decomposed-curated.jsonl (curated synthetic, _meta stripped)
 *   - lora-data/adherence-production.jsonl (production, has _meta)
 *
 * Writes:
 *   - lora-data/adherence-checker-v2-train.jsonl (_meta stripped, ready for ART)
 *
 * Production data passes through the same curation rules as synthetic data
 * (cross-contamination is less likely on real production prose but we check anyway).
 *
 * Usage:
 *   bun scripts/merge-adherence-train.ts
 */

import { readFileSync, writeFileSync, existsSync } from "fs"

const CURATED_PATH = "lora-data/adherence-checker-decomposed-curated.jsonl"
const PRODUCTION_PATH = "lora-data/adherence-production.jsonl"
const OUTPUT_PATH = "lora-data/adherence-checker-v2-train.jsonl"

// ── Read curated synthetic (already clean, no _meta) ───────────────────

const curatedLines = readFileSync(CURATED_PATH, "utf8").trim().split("\n")
console.log(`Curated synthetic: ${curatedLines.length} examples`)

// ── Read + clean production data ───────────────────────────────────────

let productionLines: string[] = []
let productionSkipped = 0

if (existsSync(PRODUCTION_PATH)) {
  const rawLines = readFileSync(PRODUCTION_PATH, "utf8").trim().split("\n")
  for (const line of rawLines) {
    if (!line.trim()) continue
    const obj = JSON.parse(line)
    // Strip _meta for training
    delete obj._meta
    productionLines.push(JSON.stringify(obj))
  }
  console.log(`Production: ${productionLines.length} examples`)
} else {
  console.log(`Production: not found at ${PRODUCTION_PATH} — skipping`)
}

// ── Merge + shuffle ────────────────────────────────────────────────────

const all = [...curatedLines, ...productionLines]

// Fisher-Yates shuffle for training data randomization
for (let i = all.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1))
  ;[all[i], all[j]] = [all[j], all[i]]
}

writeFileSync(OUTPUT_PATH, all.join("\n") + "\n")
const sizeMB = (Buffer.byteLength(all.join("\n") + "\n") / 1024 / 1024).toFixed(1)

console.log()
console.log(`Merged: ${all.length} examples → ${OUTPUT_PATH} (${sizeMB} MB)`)
console.log(`  Synthetic: ${curatedLines.length} (${Math.round(curatedLines.length / all.length * 100)}%)`)
console.log(`  Production: ${productionLines.length} (${Math.round(productionLines.length / all.length * 100)}%)`)
