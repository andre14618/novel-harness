#!/usr/bin/env bun
/**
 * Comprehensive style scoring: measures how much the LoRA shifts prose toward
 * the target style (Howard) and away from AI patterns.
 *
 * Four scoring dimensions:
 *   1. Style classifier — logistic regression on TF-IDF features (Howard vs bland)
 *   2. Perplexity proxy — bigram model trained on Howard, measures surprise
 *   3. Feature KL divergence — sentence length, word length distributions vs Howard
 *   4. Content preservation — n-gram overlap between input and output (BERTScore proxy)
 *
 * Usage:
 *   TOGETHER_API_KEY=... bun scripts/score-lora-style.ts
 */

import { readFileSync } from "fs"
import { join } from "path"

const API_KEY = process.env.TOGETHER_API_KEY!
const SYSTEM = "Rewrite this paragraph. Make the prose vivid, concrete, and direct."

const MODELS = [
  { label: "BASE", lora: null },
  { label: "V2", lora: "andre14618_2c8c/Qwen3.5-9B-howard-tonal-v2-b139cbad" },
  { label: "V3", lora: "andre14618_2c8c/Qwen3.5-9B-howard-tonal-v3-5d040ad5" },
]

// ── Load Howard corpus for reference distributions ──────────────────────────

const HOWARD_FILE = join(import.meta.dir, "../lora-data/howard-training.jsonl")
const howardChunks = readFileSync(HOWARD_FILE, "utf-8").trim().split("\n").map(l => JSON.parse(l).text as string)

// Take a representative sample of paragraphs from the corpus
const howardParagraphs: string[] = []
for (const chunk of howardChunks.slice(0, 300)) {
  const paras = chunk.split(/\n{2,}/).map(p => p.trim()).filter(p => p.split(/\s+/).length >= 20)
  howardParagraphs.push(...paras)
}
console.log(`Loaded ${howardParagraphs.length} Howard reference paragraphs\n`)

// ── Test inputs ─────────────────────────────────────────────────────────────

const INPUTS = [
  "The soldier moved carefully through the dark corridor, his sword held ready in front of him. He could hear strange sounds coming from somewhere deeper in the ruins, and the air felt cold and damp against his skin. He was starting to feel uncomfortable about the whole situation, but he knew he had to keep going.",
  "The two warriors circled each other slowly, looking for an opening. Rain fell steadily on the stone courtyard, making the footing treacherous. The taller man attacked first, swinging his blade in a wide arc. The shorter one stepped back quickly and countered with a thrust that was barely deflected. They were both breathing hard now, and it was clear that neither would give up easily.",
  "The battle had been going on for hours. Bodies lay everywhere on the muddy field. The defenders were exhausted but they refused to retreat. Their leader stood on the wall, shouting encouragement despite the arrow wound in his shoulder.",
  "He drew his sword and charged at the creature. It was larger than a man, covered in dark scales, and its eyes glowed with an unnatural light. The beast swiped at him with enormous claws, and he barely managed to dodge to the side. He struck back, aiming for the exposed throat, and felt his blade bite into flesh.",
  "She climbed the crumbling tower stairs, testing each step before putting her full weight on it. The moonlight came through gaps in the stone walls, creating patches of silver light on the dusty floor. From somewhere above, she could hear a rhythmic tapping sound that she could not identify. Her torch was getting low, and she considered turning back, but curiosity drove her forward.",
  "The castle had been abandoned for many years. Weeds grew through cracks in the courtyard stones, and most of the windows were broken. But something about the place suggested that it was not entirely empty. There were fresh marks in the dust on the floor.",
  "The swamp stretched endlessly in every direction. Mist hung low over the dark water, and strange lights flickered in the distance. The trees here were dead, their branches reaching up like skeletal fingers. Every now and then something splashed in the murky water nearby, but he could never see what caused it.",
  "The city was quiet at this hour. Most of the shops were closed, their shutters drawn tight. Only a few torches still burned along the main street, casting pools of orange light on the cobblestones. A cat ran across the road ahead of her, disappearing into a narrow alley.",
  "The woman stood at the edge of the cliff, looking down at the churning sea below. The wind was strong and cold, pulling at her cloak. She had come here to make a decision, and she knew there was no going back once she chose.",
  "He woke up in a dark room with no memory of how he had gotten there. His hands were bound and his head was throbbing with pain. Somewhere nearby, he could hear voices speaking in a language he did not understand.",
  "Dawn broke over the battlefield. The survivors began to stir, checking their wounds and looking for fallen companions. The enemy had retreated during the night, leaving behind only their dead. Victory felt hollow in the cold morning light.",
  "The tavern was crowded and noisy. Men were drinking and arguing at every table. In the corner, a hooded figure sat alone, watching the room with careful attention. Nobody seemed to notice him, which was exactly what he wanted.",
  "The old man looked at him for a long time before speaking. His eyes were sharp despite his age, and there was something unsettling about the way he studied the younger mans face. Finally, he leaned back in his chair and let out a long breath.",
  "The ship rocked violently as the storm grew worse. Waves crashed over the deck, and the crew struggled to keep the sails from tearing apart. The captain stood at the wheel, his face grim and determined as he fought to keep the vessel from capsizing.",
  "The assassin waited on the rooftop, perfectly still. Below, the target walked through the market square, surrounded by guards. She counted them carefully and calculated her approach. The window of opportunity would be very small.",
]

// ── Utility functions ───────────────────────────────────────────────────────

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^\w\s']/g, "").split(/\s+/).filter(w => w.length > 0)
}

function sentences(text: string): string[] {
  return text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0)
}

function sentenceLengths(text: string): number[] {
  return sentences(text).map(s => s.split(/\s+/).filter(w => w.length > 0).length)
}

function wordLengths(text: string): number[] {
  return words(text).map(w => w.length)
}

// ── 1. Style Classifier (Logistic Regression on word features) ──────────────

// Build vocabulary from Howard + bland pairs
const BLAND_FILE = join(import.meta.dir, "../lora-data/howard-tonal-pairs.jsonl")
const blandPairs = readFileSync(BLAND_FILE, "utf-8").trim().split("\n")
  .slice(0, 2000)
  .map(l => {
    const p = JSON.parse(l)
    return { bland: p.messages[1].content as string, howard: p.messages[2].content as string }
  })

// Feature extraction: word frequencies for discriminative words
function buildVocab() {
  const howardFreq = new Map<string, number>()
  const blandFreq = new Map<string, number>()
  let howardTotal = 0, blandTotal = 0

  for (const pair of blandPairs) {
    for (const w of words(pair.howard)) { howardFreq.set(w, (howardFreq.get(w) ?? 0) + 1); howardTotal++ }
    for (const w of words(pair.bland)) { blandFreq.set(w, (blandFreq.get(w) ?? 0) + 1); blandTotal++ }
  }

  // Find words with highest frequency ratio (Howard / bland)
  const allWords = new Set([...howardFreq.keys(), ...blandFreq.keys()])
  const ratios: Array<{ word: string; ratio: number }> = []
  for (const w of allWords) {
    const hf = (howardFreq.get(w) ?? 0) / howardTotal
    const bf = (blandFreq.get(w) ?? 0) / blandTotal
    if ((howardFreq.get(w) ?? 0) >= 5 || (blandFreq.get(w) ?? 0) >= 5) {
      ratios.push({ word: w, ratio: (hf + 0.0001) / (bf + 0.0001) })
    }
  }

  // Top 200 most discriminative words (high ratio = Howard, low ratio = bland)
  ratios.sort((a, b) => b.ratio - a.ratio)
  const howardWords = ratios.slice(0, 100).map(r => r.word)
  const blandWords = ratios.slice(-100).map(r => r.word)
  return { howardWords: new Set(howardWords), blandWords: new Set(blandWords), allDiscriminative: [...howardWords, ...blandWords] }
}

const vocab = buildVocab()

function classifierScore(text: string): number {
  const ws = words(text)
  if (ws.length === 0) return 0.5
  let howardHits = 0, blandHits = 0
  for (const w of ws) {
    if (vocab.howardWords.has(w)) howardHits++
    if (vocab.blandWords.has(w)) blandHits++
  }
  const total = howardHits + blandHits
  if (total === 0) return 0.5
  return howardHits / total // 1.0 = fully Howard, 0.0 = fully bland
}

// ── 2. Bigram Perplexity (trained on Howard) ────────────────────────────────

// Build bigram model from Howard corpus
const bigramCounts = new Map<string, Map<string, number>>()
const unigramCounts = new Map<string, number>()
let totalBigrams = 0

for (const para of howardParagraphs) {
  const ws = words(para)
  for (let i = 0; i < ws.length; i++) {
    unigramCounts.set(ws[i], (unigramCounts.get(ws[i]) ?? 0) + 1)
    if (i > 0) {
      const prev = ws[i - 1]
      if (!bigramCounts.has(prev)) bigramCounts.set(prev, new Map())
      const bigrams = bigramCounts.get(prev)!
      bigrams.set(ws[i], (bigrams.get(ws[i]) ?? 0) + 1)
      totalBigrams++
    }
  }
}

const vocabSize = unigramCounts.size

function bigramPerplexity(text: string): number {
  const ws = words(text)
  if (ws.length < 2) return 1000

  let logProb = 0
  let count = 0

  for (let i = 1; i < ws.length; i++) {
    const prev = ws[i - 1]
    const curr = ws[i]
    const prevBigrams = bigramCounts.get(prev)
    const bigramCount = prevBigrams?.get(curr) ?? 0
    const prevCount = unigramCounts.get(prev) ?? 0

    // Laplace smoothing
    const prob = (bigramCount + 1) / (prevCount + vocabSize)
    logProb += Math.log2(prob)
    count++
  }

  // Perplexity = 2^(-avg_log_prob)
  return Math.pow(2, -logProb / count)
}

// ── 3. KL Divergence on feature distributions ──────────────────────────────

// Compute Howard reference distributions
function buildDistribution(values: number[], maxBucket: number): number[] {
  const dist = new Array(maxBucket + 1).fill(0)
  for (const v of values) {
    const bucket = Math.min(v, maxBucket)
    dist[bucket]++
  }
  // Normalize
  const total = dist.reduce((a, b) => a + b, 0)
  return dist.map(d => (d + 0.01) / (total + 0.01 * dist.length)) // smoothed
}

function klDivergence(p: number[], q: number[]): number {
  let kl = 0
  for (let i = 0; i < p.length; i++) {
    if (p[i] > 0) kl += p[i] * Math.log2(p[i] / q[i])
  }
  return kl
}

// Howard reference distributions
const howardSentLens: number[] = []
const howardWordLens: number[] = []
for (const para of howardParagraphs) {
  howardSentLens.push(...sentenceLengths(para))
  howardWordLens.push(...wordLengths(para))
}
const howardSentDist = buildDistribution(howardSentLens, 40)
const howardWordDist = buildDistribution(howardWordLens, 15)

function featureKL(text: string): { sentKL: number; wordKL: number; combined: number } {
  const sl = sentenceLengths(text)
  const wl = wordLengths(text)

  const sentDist = buildDistribution(sl, 40)
  const wordDist = buildDistribution(wl, 15)

  const sentKL = klDivergence(howardSentDist, sentDist)
  const wordKL = klDivergence(howardWordDist, wordDist)

  return { sentKL, wordKL, combined: (sentKL + wordKL) / 2 }
}

// ── 4. Content Preservation (n-gram overlap) ────────────────────────────────

function ngrams(ws: string[], n: number): Set<string> {
  const result = new Set<string>()
  for (let i = 0; i <= ws.length - n; i++) {
    result.add(ws.slice(i, i + n).join(" "))
  }
  return result
}

function contentPreservation(input: string, output: string): { unigram: number; bigram: number; combined: number } {
  const inputWords = words(input)
  const outputWords = words(output)

  // Unigram overlap (F1)
  const inputUni = ngrams(inputWords, 1)
  const outputUni = ngrams(outputWords, 1)
  let uniOverlap = 0
  for (const g of inputUni) if (outputUni.has(g)) uniOverlap++
  const uniPrecision = outputUni.size > 0 ? uniOverlap / outputUni.size : 0
  const uniRecall = inputUni.size > 0 ? uniOverlap / inputUni.size : 0
  const uniF1 = (uniPrecision + uniRecall) > 0 ? 2 * uniPrecision * uniRecall / (uniPrecision + uniRecall) : 0

  // Bigram overlap (F1)
  const inputBi = ngrams(inputWords, 2)
  const outputBi = ngrams(outputWords, 2)
  let biOverlap = 0
  for (const g of inputBi) if (outputBi.has(g)) biOverlap++
  const biPrecision = outputBi.size > 0 ? biOverlap / outputBi.size : 0
  const biRecall = inputBi.size > 0 ? biOverlap / inputBi.size : 0
  const biF1 = (biPrecision + biRecall) > 0 ? 2 * biPrecision * biRecall / (biPrecision + biRecall) : 0

  return { unigram: uniF1, bigram: biF1, combined: (uniF1 + biF1) / 2 }
}

// ── API ─────────────────────────────────────────────────────────────────────

async function rewrite(text: string, lora: string | null): Promise<string> {
  const body: any = {
    model: "Qwen/Qwen3.5-9B",
    temperature: 0.6,
    max_tokens: 400,
    chat_template_kwargs: { enable_thinking: false },
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: text },
    ],
  }
  if (lora) body.lora = lora
  const res = await fetch("https://api.together.xyz/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await res.json() as any
  return data.choices?.[0]?.message?.content ?? "ERROR"
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // First, compute Howard reference scores
  const howardClassifier = howardParagraphs.slice(0, 100).map(classifierScore)
  const howardPerplexity = howardParagraphs.slice(0, 100).map(bigramPerplexity)
  const howardKL = howardParagraphs.slice(0, 100).map(p => featureKL(p).combined)

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
  const round = (n: number, d = 3) => Math.round(n * Math.pow(10, d)) / Math.pow(10, d)

  console.log("REFERENCE SCORES (Howard's actual prose):")
  console.log(`  Classifier:  ${round(avg(howardClassifier))} (1.0 = fully Howard)`)
  console.log(`  Perplexity:  ${round(avg(howardPerplexity), 1)} (lower = more Howard-like)`)
  console.log(`  Feature KL:  ${round(avg(howardKL))} (lower = closer to Howard distributions)`)
  console.log()

  // Input reference scores
  const inputClassifier = INPUTS.map(classifierScore)
  const inputPerplexity = INPUTS.map(bigramPerplexity)
  const inputKL = INPUTS.map(i => featureKL(i).combined)

  console.log("INPUT SCORES (bland test paragraphs):")
  console.log(`  Classifier:  ${round(avg(inputClassifier))}`)
  console.log(`  Perplexity:  ${round(avg(inputPerplexity), 1)}`)
  console.log(`  Feature KL:  ${round(avg(inputKL))}`)
  console.log()

  // Generate rewrites
  console.log("Generating rewrites...")
  type ModelResult = {
    label: string
    texts: string[]
    classifier: number[]
    perplexity: number[]
    featureKL: number[]
    contentPres: number[]
  }

  const modelResults: ModelResult[] = MODELS.map(m => ({
    label: m.label, texts: [], classifier: [], perplexity: [], featureKL: [], contentPres: [],
  }))

  for (let i = 0; i < INPUTS.length; i++) {
    console.log(`  Paragraph ${i + 1}/${INPUTS.length}...`)
    for (let m = 0; m < MODELS.length; m++) {
      const text = await rewrite(INPUTS[i], MODELS[m].lora)
      const r = modelResults[m]
      r.texts.push(text)
      r.classifier.push(classifierScore(text))
      r.perplexity.push(bigramPerplexity(text))
      r.featureKL.push(featureKL(text).combined)
      r.contentPres.push(contentPreservation(INPUTS[i], text).combined)
    }
  }

  // ── Results ─────────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(80))
  console.log("STYLE SCORING RESULTS (15 paragraphs)")
  console.log("=".repeat(80))

  console.log("\n1. STYLE CLASSIFIER (higher = more Howard-like)")
  console.log("   Howard reference:  " + round(avg(howardClassifier)))
  console.log("   Bland input:       " + round(avg(inputClassifier)))
  for (const r of modelResults) {
    console.log(`   ${r.label.padEnd(20)} ${round(avg(r.classifier))}`)
  }

  console.log("\n2. BIGRAM PERPLEXITY (lower = more Howard-like)")
  console.log("   Howard reference:  " + round(avg(howardPerplexity), 1))
  console.log("   Bland input:       " + round(avg(inputPerplexity), 1))
  for (const r of modelResults) {
    console.log(`   ${r.label.padEnd(20)} ${round(avg(r.perplexity), 1)}`)
  }

  console.log("\n3. FEATURE KL DIVERGENCE (lower = closer to Howard distributions)")
  console.log("   Howard reference:  " + round(avg(howardKL)))
  console.log("   Bland input:       " + round(avg(inputKL)))
  for (const r of modelResults) {
    console.log(`   ${r.label.padEnd(20)} ${round(avg(r.featureKL))}`)
  }

  console.log("\n4. CONTENT PRESERVATION (higher = better meaning retention)")
  console.log("   (n-gram F1 between input and output)")
  for (const r of modelResults) {
    console.log(`   ${r.label.padEnd(20)} ${round(avg(r.contentPres))}`)
  }

  // ── Summary dashboard ───────────────────────────────────────────────────

  console.log("\n" + "=".repeat(80))
  console.log("SUMMARY DASHBOARD")
  console.log("=".repeat(80))
  console.log("\n                     Howard ref    Input       BASE        V2          V3")
  console.log(`Classifier (↑)       ${round(avg(howardClassifier)).toString().padStart(6)}        ${round(avg(inputClassifier)).toString().padStart(6)}      ${round(avg(modelResults[0].classifier)).toString().padStart(6)}      ${round(avg(modelResults[1].classifier)).toString().padStart(6)}      ${round(avg(modelResults[2].classifier)).toString().padStart(6)}`)
  console.log(`Perplexity (↓)       ${round(avg(howardPerplexity), 1).toString().padStart(6)}        ${round(avg(inputPerplexity), 1).toString().padStart(6)}      ${round(avg(modelResults[0].perplexity), 1).toString().padStart(6)}      ${round(avg(modelResults[1].perplexity), 1).toString().padStart(6)}      ${round(avg(modelResults[2].perplexity), 1).toString().padStart(6)}`)
  console.log(`Feature KL (↓)       ${round(avg(howardKL)).toString().padStart(6)}        ${round(avg(inputKL)).toString().padStart(6)}      ${round(avg(modelResults[0].featureKL)).toString().padStart(6)}      ${round(avg(modelResults[1].featureKL)).toString().padStart(6)}      ${round(avg(modelResults[2].featureKL)).toString().padStart(6)}`)
  console.log(`Content pres (↑)       n/a           n/a      ${round(avg(modelResults[0].contentPres)).toString().padStart(6)}      ${round(avg(modelResults[1].contentPres)).toString().padStart(6)}      ${round(avg(modelResults[2].contentPres)).toString().padStart(6)}`)

  // ── Per-paragraph detail ────────────────────────────────────────────────

  console.log("\n" + "=".repeat(80))
  console.log("PER-PARAGRAPH CLASSIFIER SCORES")
  console.log("=".repeat(80))
  console.log("\n     Input   BASE    V2      V3      Winner")
  for (let i = 0; i < INPUTS.length; i++) {
    const scores = modelResults.map(r => r.classifier[i])
    const maxScore = Math.max(...scores)
    const winner = modelResults[scores.indexOf(maxScore)].label
    console.log(`P${(i + 1).toString().padStart(2)}  ${round(inputClassifier[i]).toString().padStart(5)}  ${scores.map(s => round(s).toString().padStart(5)).join("   ")}   ${winner}`)
  }
}

main().catch(console.error)
