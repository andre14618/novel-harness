#!/usr/bin/env bun
/**
 * Score and filter tonal training pairs by contrast quality.
 *
 * Low-contrast pairs (where bland ≈ Howard) dilute the style signal.
 * This script scores each pair on multiple divergence dimensions
 * and removes the weakest ones to concentrate training on the most
 * distinctive Howard passages.
 *
 * Metrics:
 *   1. Word-level edit distance (normalized) — how many words changed
 *   2. Vocabulary divergence — unique words in Howard but not in bland
 *   3. Sentence length shift — Howard's avg sentence length vs bland's
 *   4. Verb concreteness proxy — ratio of short strong verbs (≤6 chars)
 *
 * Usage:
 *   bun scripts/curate-tonal-pairs.ts                    # default 30% cut
 *   CUT_PERCENT=40 bun scripts/curate-tonal-pairs.ts     # more aggressive
 */

import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const INPUT_FILE = join(import.meta.dir, "../lora-data/howard-tonal-pairs.jsonl")
const OUTPUT_FILE = join(import.meta.dir, "../lora-data/howard-tonal-pairs-curated.jsonl")
const CUT_PERCENT = parseInt(process.env.CUT_PERCENT ?? "30")

interface Pair {
  messages: Array<{ role: string; content: string }>
}

interface ScoredPair {
  pair: Pair
  score: number
  editDist: number
  vocabDiv: number
  sentLenShift: number
  verbScore: number
  blandWords: number
  howardWords: number
}

// ── Metrics ─────────────────────────────────────────────────────────────────

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^\w\s']/g, "").split(/\s+/).filter(w => w.length > 0)
}

function sentences(text: string): string[] {
  return text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0)
}

/** Normalized word-level edit distance (Levenshtein on word arrays, capped for perf) */
function wordEditDistance(a: string[], b: string[]): number {
  // For long texts, use a fast approximation: set difference ratio
  const setA = new Set(a)
  const setB = new Set(b)
  let shared = 0
  for (const w of setA) if (setB.has(w)) shared++
  const union = new Set([...setA, ...setB]).size
  return union > 0 ? 1 - (shared / union) : 0
}

/** Words unique to Howard that aren't in bland */
function vocabularyDivergence(blandWords: string[], howardWords: string[]): number {
  const blandSet = new Set(blandWords)
  const howardUnique = howardWords.filter(w => !blandSet.has(w))
  return howardWords.length > 0 ? howardUnique.length / howardWords.length : 0
}

/** Difference in average sentence length (words per sentence) */
function sentenceLengthShift(bland: string, howard: string): number {
  const blandSents = sentences(bland)
  const howardSents = sentences(howard)
  if (blandSents.length === 0 || howardSents.length === 0) return 0

  const blandAvg = words(bland).length / blandSents.length
  const howardAvg = words(howard).length / howardSents.length

  // Positive = Howard has shorter sentences (desirable for this style)
  return (blandAvg - howardAvg) / Math.max(blandAvg, 1)
}

/** Ratio of short, strong verbs (proxy for concrete/visceral writing) */
function verbConcretenessProxy(text: string): number {
  const ws = words(text)
  // Short words (≤6 chars) that aren't articles/prepositions — crude but useful
  const stopwords = new Set(["the", "a", "an", "in", "on", "at", "to", "for", "of", "and", "but", "or", "is", "was", "were", "are", "be", "been", "has", "had", "have", "with", "from", "by", "not", "this", "that", "his", "her", "its", "their", "he", "she", "it", "they", "him", "who", "which"])
  const shortStrong = ws.filter(w => w.length >= 3 && w.length <= 6 && !stopwords.has(w))
  return ws.length > 0 ? shortStrong.length / ws.length : 0
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const lines = readFileSync(INPUT_FILE, "utf-8").trim().split("\n")
  const pairs: Pair[] = lines.map(l => JSON.parse(l))

  console.log(`=== Tonal Pair Curation ===`)
  console.log(`Input: ${pairs.length} pairs`)
  console.log(`Cut: bottom ${CUT_PERCENT}%\n`)

  // Score each pair
  const scored: ScoredPair[] = pairs.map((pair, i) => {
    const bland = pair.messages[1].content
    const howard = pair.messages[2].content
    const blandW = words(bland)
    const howardW = words(howard)

    const editDist = wordEditDistance(blandW, howardW)
    const vocabDiv = vocabularyDivergence(blandW, howardW)
    const sentLenShift = sentenceLengthShift(bland, howard)
    const verbBland = verbConcretenessProxy(bland)
    const verbHoward = verbConcretenessProxy(howard)
    const verbScore = verbHoward - verbBland  // positive = Howard uses more concrete verbs

    // Composite score: weight each dimension
    // Higher = more contrast = better training signal
    const score = (editDist * 0.3) + (vocabDiv * 0.3) + (Math.abs(sentLenShift) * 0.2) + (Math.max(verbScore, 0) * 0.2)

    return {
      pair, score, editDist, vocabDiv, sentLenShift, verbScore,
      blandWords: blandW.length, howardWords: howardW.length,
    }
  })

  // Sort by score (ascending — worst first)
  scored.sort((a, b) => a.score - b.score)

  // Print distribution
  const scores = scored.map(s => s.score)
  const p25 = scores[Math.floor(scores.length * 0.25)]
  const p50 = scores[Math.floor(scores.length * 0.50)]
  const p75 = scores[Math.floor(scores.length * 0.75)]
  console.log(`Score distribution:`)
  console.log(`  min:  ${scores[0].toFixed(4)}`)
  console.log(`  p25:  ${p25.toFixed(4)}`)
  console.log(`  p50:  ${p50.toFixed(4)}`)
  console.log(`  p75:  ${p75.toFixed(4)}`)
  console.log(`  max:  ${scores[scores.length - 1].toFixed(4)}`)

  // Cut bottom N%
  const cutIndex = Math.floor(scored.length * (CUT_PERCENT / 100))
  const kept = scored.slice(cutIndex)
  const removed = scored.slice(0, cutIndex)

  console.log(`\nRemoved: ${removed.length} pairs (bottom ${CUT_PERCENT}%)`)
  console.log(`Kept:    ${kept.length} pairs`)

  // Show examples of what was cut
  console.log(`\n--- Lowest scored (removed) ---`)
  for (let i = 0; i < Math.min(3, removed.length); i++) {
    const s = removed[i]
    console.log(`  Score ${s.score.toFixed(4)} | edit=${s.editDist.toFixed(3)} vocab=${s.vocabDiv.toFixed(3)} sent=${s.sentLenShift.toFixed(3)} verb=${s.verbScore.toFixed(3)}`)
    console.log(`    BLAND:  ${s.pair.messages[1].content.slice(0, 100)}...`)
    console.log(`    HOWARD: ${s.pair.messages[2].content.slice(0, 100)}...`)
    console.log()
  }

  console.log(`--- Highest scored (kept) ---`)
  for (let i = kept.length - 1; i >= Math.max(0, kept.length - 3); i--) {
    const s = kept[i]
    console.log(`  Score ${s.score.toFixed(4)} | edit=${s.editDist.toFixed(3)} vocab=${s.vocabDiv.toFixed(3)} sent=${s.sentLenShift.toFixed(3)} verb=${s.verbScore.toFixed(3)}`)
    console.log(`    BLAND:  ${s.pair.messages[1].content.slice(0, 100)}...`)
    console.log(`    HOWARD: ${s.pair.messages[2].content.slice(0, 100)}...`)
    console.log()
  }

  // Write curated output
  const output = kept.map(s => JSON.stringify(s.pair)).join("\n") + "\n"
  writeFileSync(OUTPUT_FILE, output)

  // Stats
  const keptTokens = kept.reduce((sum, s) => {
    const totalWords = s.pair.messages.reduce((ws, m) => ws + m.content.split(/\s+/).length, 0)
    return sum + Math.round(totalWords * 1.3)
  }, 0)

  console.log(`\n${"=".repeat(60)}`)
  console.log(`OUTPUT STATS`)
  console.log(`${"=".repeat(60)}`)
  console.log(`Curated pairs:     ${kept.length}`)
  console.log(`Est. tokens:       ~${keptTokens.toLocaleString()}`)
  console.log(`Est. train cost:   ~$${(keptTokens * 2 * 0.48 / 1_000_000).toFixed(2)} (2 epochs)`)
  console.log(`Output:            ${OUTPUT_FILE}`)
}

main()
