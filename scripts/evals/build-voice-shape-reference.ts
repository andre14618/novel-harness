#!/usr/bin/env bun
/**
 * Build the frozen voice-shape reference distribution for
 * `voice-shaping-ablation-v1` per charter §3.
 *
 * Samples 10 passages from the Salvatore Icewind Dale corpus
 * (`novels/salvatore-icewind-dale/pairs.jsonl`), stratified
 * proportionally to the ablation pool's beat-kind distribution,
 * computes per-passage voice-shape features, and writes the frozen
 * reference + 10 raw passages to
 * `scripts/evals/voice-shape-reference.json`.
 *
 * Also separately writes 5 shorter reference excerpts to
 * `scripts/evals/voice-reference-passages.json` for Arm D2
 * (few-shot voice exemplars in the system prompt).
 *
 * Both artifacts are committed; the run is deterministic via the
 * seed constant below.
 *
 * Usage: bun scripts/evals/build-voice-shape-reference.ts
 */

import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { computeFeatures, computeReferenceDistribution } from "./voice-shape-metrics"

const CORPUS_PATH = "novels/salvatore-icewind-dale/pairs.jsonl"
const REF_OUT = "scripts/evals/voice-shape-reference.json"
const PASSAGES_OUT = "scripts/evals/voice-reference-passages.json"
const SEED = "voice-shape-reference-v1-2026-04-21"

// Ablation pool's beat-kind distribution (from the 20-beat pool in
// arm-b-direct-pairwise-v1 / arm-d-writer-upgrade-v1 / voice-shaping-
// ablation-v1). Empirically-derived stratification targets.
const STRATUM_TARGETS: Record<string, number> = {
  action: 3,
  dialogue: 3,
  interiority: 2,
  description: 2,
}

// ── Utilities ─────────────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashToInt(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h >>> 0
}

interface Pair {
  brief: {
    beat_id: string
    book: string
    chapter: string | number
    kind: string
    characters?: string[]
    pov?: string
    setting?: string
    words: number
  }
  prose: string
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const raw = await readFile(path.resolve(CORPUS_PATH), "utf8")
  const lines = raw.split("\n").filter(Boolean)
  const pairs: Pair[] = lines.map(l => JSON.parse(l))
  console.log(`[ref-build] loaded ${pairs.length} pairs from ${CORPUS_PATH}`)

  // Filter passages to a reasonable length band (120-400 words) — short
  // enough to fit in few-shot prompts, long enough to be stylistically
  // representative.
  const eligible = pairs.filter(p => p.brief.words >= 120 && p.brief.words <= 400)
  console.log(`[ref-build] eligible (120-400 words): ${eligible.length}`)

  // Group by kind
  const byKind = new Map<string, Pair[]>()
  for (const p of eligible) {
    const k = p.brief.kind ?? "unknown"
    if (!byKind.has(k)) byKind.set(k, [])
    byKind.get(k)!.push(p)
  }
  console.log(`[ref-build] kinds available:`, Object.fromEntries([...byKind.entries()].map(([k, v]) => [k, v.length])))

  // Deterministic stratified sample
  const rng = mulberry32(hashToInt(SEED))
  const picked: Pair[] = []
  for (const [kind, target] of Object.entries(STRATUM_TARGETS)) {
    const pool = byKind.get(kind) ?? []
    if (pool.length === 0) {
      console.warn(`[ref-build] WARN: 0 pairs in stratum "${kind}"; skipping target ${target}`)
      continue
    }
    // Shuffle deterministically, take first N
    const shuffled = pool.slice().sort(() => rng() - 0.5)
    picked.push(...shuffled.slice(0, Math.min(target, shuffled.length)))
  }
  // If fewer than 10 picked, fill with highest-available stratum
  while (picked.length < 10) {
    const largestKind = [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)[0]
    if (!largestKind) break
    const pool = largestKind[1].filter(p => !picked.includes(p))
    if (pool.length === 0) break
    const shuffled = pool.slice().sort(() => rng() - 0.5)
    picked.push(shuffled[0])
  }
  console.log(`[ref-build] picked ${picked.length} reference passages`)
  console.log(`[ref-build] stratum breakdown:`,
    Object.fromEntries(
      Object.keys(STRATUM_TARGETS).map(k => [k, picked.filter(p => p.brief.kind === k).length])
    ))

  // Compute features + reference distribution
  const perPassage = picked.map(p => ({
    brief_summary: {
      beat_id: p.brief.beat_id,
      book: p.brief.book,
      chapter: p.brief.chapter,
      kind: p.brief.kind,
      words: p.brief.words,
    },
    prose_preview: p.prose.slice(0, 80) + "…",
    features: computeFeatures(p.prose),
  }))
  const ref = computeReferenceDistribution(perPassage.map(p => p.features))

  console.log(`[ref-build] reference distribution:`)
  for (const k of ["meanSentenceLength", "sentenceLengthStd", "dialogueRatio", "clauseComplexity", "sensoryDensity"] as const) {
    console.log(`  ${k}: mean=${ref.means[k].toFixed(3)}, std=${ref.stds[k].toFixed(3)}`)
  }

  await writeFile(REF_OUT, JSON.stringify({
    seed: SEED,
    corpus: CORPUS_PATH,
    stratum_targets: STRATUM_TARGETS,
    n: picked.length,
    reference: ref,
    passages: perPassage,
  }, null, 2))
  console.log(`[ref-build] reference written: ${REF_OUT}`)

  // Short few-shot passages for Arm D2 — pick 3-5 shorter ones (120-200 words)
  const fewShot = picked
    .filter(p => p.brief.words >= 120 && p.brief.words <= 200)
    .slice(0, 5)
    .map(p => ({
      attribution: `${p.brief.book} · ${p.brief.kind} beat`,
      prose: p.prose,
      words: p.brief.words,
    }))
  // If too few, relax — take shortest available
  if (fewShot.length < 3) {
    const sorted = picked.slice().sort((a, b) => a.brief.words - b.brief.words).slice(0, 5)
    for (const p of sorted) {
      if (fewShot.length >= 5) break
      if (!fewShot.find(f => f.prose === p.prose)) {
        fewShot.push({
          attribution: `${p.brief.book} · ${p.brief.kind} beat`,
          prose: p.prose,
          words: p.brief.words,
        })
      }
    }
  }
  console.log(`[ref-build] few-shot passages: ${fewShot.length}`)
  await writeFile(PASSAGES_OUT, JSON.stringify({
    seed: SEED,
    n: fewShot.length,
    passages: fewShot,
  }, null, 2))
  console.log(`[ref-build] few-shot passages written: ${PASSAGES_OUT}`)
}

if (import.meta.main) main().catch(e => { console.error(e); process.exit(1) })
