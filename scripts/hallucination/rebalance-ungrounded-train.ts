/**
 * Improvement method for halluc-ungrounded-v2: class rebalance.
 *
 * v2 isolated natural-val: 90.3% precision / 68.3% recall — precision
 * is already strong; recall is the bottleneck. Current train is 62/38
 * PASS/FAIL (62% PASS) — the model is biased toward predicting PASS.
 *
 * This script oversamples FAIL pairs to achieve a 50/50 balance,
 * which pushes the decision boundary toward catching more FAILs at
 * modest precision cost.
 *
 * Output: finetune-data/halluc-ungrounded-v3-train.jsonl (balanced)
 */

import { readFileSync, writeFileSync } from "fs"

const IN = "finetune-data/halluc-ungrounded-v1-train.jsonl"
const OUT = "finetune-data/halluc-ungrounded-v3-train.jsonl"

const lines = readFileSync(IN, "utf8").trim().split("\n")
const pairs = lines.map(l => JSON.parse(l))

const passPairs = pairs.filter(p => p._meta?.pass === true)
const failPairs = pairs.filter(p => p._meta?.pass === false)
console.log(`Input: ${pairs.length} total — ${passPairs.length} PASS (${(passPairs.length / pairs.length * 100).toFixed(0)}%) / ${failPairs.length} FAIL`)

// Oversample FAIL to reach 50/50 balance
const targetFailCount = passPairs.length
const oversampleRatio = targetFailCount / failPairs.length
console.log(`Target: 50/50 balance → ${targetFailCount} FAIL (${oversampleRatio.toFixed(2)}× oversample)`)

// Deterministic oversample: rotate through failPairs with incrementing tag to
// avoid literal duplicates causing bad gradient.
const oversampled: any[] = []
for (let i = 0; i < targetFailCount; i++) {
  const base = failPairs[i % failPairs.length]
  oversampled.push({
    ...base,
    _meta: { ...base._meta, oversample_copy: Math.floor(i / failPairs.length) },
  })
}

// Shuffle the combined set deterministically
const rng = (() => { let s = 42; return () => (s = (s * 9301 + 49297) % 233280) / 233280 })()
const combined = [...passPairs, ...oversampled].sort(() => rng() - 0.5)

writeFileSync(OUT, combined.map(p => JSON.stringify(p)).join("\n") + "\n")
console.log(`Wrote ${OUT}: ${combined.length} pairs (${passPairs.length} PASS / ${oversampled.length} FAIL)`)
