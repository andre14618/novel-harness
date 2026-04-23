/**
 * Improvement method for halluc-leak-salvatore-v1: vocabulary expansion + rebalance.
 *
 * v1 isolated natural-val recall: 40% — model only catches leaks it has seen
 * repeated. v1 train covers a small subset of §A tokens 1–2× each.
 *
 * This script:
 *   1. Merges v1 train (237 pairs, 79 FAIL / 158 PASS) with the vocab
 *      expansion (245 FAIL, 5× per §A token × 49 tokens).
 *   2. After merge: 324 FAIL / 158 PASS — FAIL-heavy (67/33), which pushes
 *      recall up but risks false-positive explosion.
 *   3. Rebalances by oversampling PASS to 324 → 50/50 at 648 pairs total.
 *
 * Output: finetune-data/halluc-leak-salvatore-v2-train.jsonl
 */

import { readFileSync, writeFileSync } from "fs"

const V1 = "finetune-data/halluc-leak-salvatore-v1-train.jsonl"
const EXP = "finetune-data/halluc-leak-vocab-expansion.jsonl"
const OUT = "finetune-data/halluc-leak-salvatore-v2-train.jsonl"

type Pair = { messages: any[]; _meta?: Record<string, any> }

function load(path: string): Pair[] {
  return readFileSync(path, "utf8").trim().split("\n").map(l => JSON.parse(l))
}

function isFail(p: Pair): boolean {
  const m = p._meta ?? {}
  if (typeof m.has_leak === "boolean") return m.has_leak
  if (typeof m.pass === "boolean") return !m.pass
  // infer from assistant response
  const asst = p.messages.find(x => x.role === "assistant")?.content ?? ""
  return /"has_leak"\s*:\s*true/.test(asst)
}

const v1 = load(V1)
const exp = load(EXP)
console.log(`v1: ${v1.length} (${v1.filter(isFail).length} FAIL)`)
console.log(`expansion: ${exp.length} (${exp.filter(isFail).length} FAIL)`)

const merged = [...v1, ...exp]
const fails = merged.filter(isFail)
const passes = merged.filter(p => !isFail(p))
console.log(`Merged: ${merged.length} — ${fails.length} FAIL / ${passes.length} PASS`)

const target = fails.length
const ratio = target / passes.length
console.log(`Target: 50/50 → oversample PASS ${passes.length} → ${target} (${ratio.toFixed(2)}×)`)

const oversampled: Pair[] = []
for (let i = 0; i < target; i++) {
  const base = passes[i % passes.length]
  oversampled.push({
    ...base,
    _meta: { ...(base._meta ?? {}), oversample_copy: Math.floor(i / passes.length) },
  })
}

const rng = (() => { let s = 42; return () => (s = (s * 9301 + 49297) % 233280) / 233280 })()
const combined = [...fails, ...oversampled].sort(() => rng() - 0.5)

writeFileSync(OUT, combined.map(p => JSON.stringify(p)).join("\n") + "\n")
console.log(`Wrote ${OUT}: ${combined.length} pairs (${fails.length} FAIL / ${oversampled.length} PASS)`)
