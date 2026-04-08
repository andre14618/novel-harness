#!/usr/bin/env bun
/**
 * Style scoring comparison: V3 (Together AI, Qwen 3.5 9B) vs V4 (W&B Inference, Qwen3 14B).
 *
 * Same 15 test paragraphs and four scoring dimensions as score-lora-style.ts.
 * V4 artifact URI is read from LORA_V4_URI env var (printed at end of train-lora.py).
 *
 * Usage:
 *   TOGETHER_API_KEY=... WANDB_API_KEY=... LORA_V4_URI=wandb-artifact:///... \
 *     bun scripts/score-lora-style-v4.ts
 *
 * If LORA_V4_URI is not set, falls back to probing the expected latest artifact:
 *   wandb-artifact:///andre14618-/novel-harness/howard-tonal-v4:latest
 */

import { readFileSync } from "fs"
import { join } from "path"

const TOGETHER_KEY = process.env.TOGETHER_API_KEY!
const WANDB_KEY    = process.env.WANDB_API_KEY!
const V4_URI       = process.env.LORA_V4_URI ?? "wandb-artifact:///andre14618-/novel-harness/howard-tonal-v4:latest"

if (!TOGETHER_KEY) throw new Error("TOGETHER_API_KEY not set")
if (!WANDB_KEY)    throw new Error("WANDB_API_KEY not set")

console.log(`V4 artifact: ${V4_URI}\n`)

const SYSTEM = "Rewrite this paragraph. Make the prose vivid, concrete, and direct."

// ── Model roster ─────────────────────────────────────────────────────────────

type Model = { label: string; api: "together" | "wandb"; modelId: string; lora: string | null }

const MODELS: Model[] = [
  {
    label: "V3 (Together 9B)",
    api: "together",
    modelId: "Qwen/Qwen3.5-9B",
    lora: "andre14618_2c8c/Qwen3.5-9B-howard-tonal-v3-5d040ad5",
  },
  {
    label: "V4 (W&B 14B)",
    api: "wandb",
    modelId: V4_URI,
    lora: null,  // for W&B, artifact URI IS the model field — no separate lora field
  },
]

// ── Load Howard corpus for reference distributions ────────────────────────────

const HOWARD_FILE = join(import.meta.dir, "../lora-data/howard-training.jsonl")
const PAIRS_FILE  = join(import.meta.dir, "../lora-data/howard-tonal-pairs.jsonl")

const howardChunks = readFileSync(HOWARD_FILE, "utf-8").trim().split("\n").map(l => JSON.parse(l).text as string)
const howardParagraphs: string[] = []
for (const chunk of howardChunks.slice(0, 300)) {
  const paras = chunk.split(/\n{2,}/).map(p => p.trim()).filter(p => p.split(/\s+/).length >= 20)
  howardParagraphs.push(...paras)
}
console.log(`Loaded ${howardParagraphs.length} Howard reference paragraphs`)

const blandPairs = readFileSync(PAIRS_FILE, "utf-8").trim().split("\n")
  .slice(0, 2000)
  .map(l => {
    const p = JSON.parse(l)
    return { bland: p.messages[1].content as string, howard: p.messages[2].content as string }
  })
console.log(`Loaded ${blandPairs.length} bland/howard pairs for vocabulary\n`)

// ── Test inputs (same 15 paragraphs as score-lora-style.ts) ──────────────────

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

// ── Scoring utilities (identical to score-lora-style.ts) ─────────────────────

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

// 1. Style classifier
function buildVocab() {
  const howardFreq = new Map<string, number>()
  const blandFreq  = new Map<string, number>()
  let howardTotal = 0, blandTotal = 0
  for (const pair of blandPairs) {
    for (const w of words(pair.howard)) { howardFreq.set(w, (howardFreq.get(w) ?? 0) + 1); howardTotal++ }
    for (const w of words(pair.bland))  { blandFreq.set(w,  (blandFreq.get(w)  ?? 0) + 1); blandTotal++ }
  }
  const allWords = new Set([...howardFreq.keys(), ...blandFreq.keys()])
  const ratios: Array<{ word: string; ratio: number }> = []
  for (const w of allWords) {
    const hf = (howardFreq.get(w) ?? 0) / howardTotal
    const bf = (blandFreq.get(w)  ?? 0) / blandTotal
    if ((howardFreq.get(w) ?? 0) >= 5 || (blandFreq.get(w) ?? 0) >= 5)
      ratios.push({ word: w, ratio: (hf + 0.0001) / (bf + 0.0001) })
  }
  ratios.sort((a, b) => b.ratio - a.ratio)
  return {
    howardWords: new Set(ratios.slice(0, 100).map(r => r.word)),
    blandWords:  new Set(ratios.slice(-100).map(r => r.word)),
  }
}
const vocab = buildVocab()

function classifierScore(text: string): number {
  const ws = words(text)
  if (ws.length === 0) return 0.5
  let howardHits = 0, blandHits = 0
  for (const w of ws) {
    if (vocab.howardWords.has(w)) howardHits++
    if (vocab.blandWords.has(w))  blandHits++
  }
  const total = howardHits + blandHits
  return total === 0 ? 0.5 : howardHits / total
}

// 2. Bigram perplexity
const bigramCounts  = new Map<string, Map<string, number>>()
const unigramCounts = new Map<string, number>()
for (const para of howardParagraphs) {
  const ws = words(para)
  for (let i = 0; i < ws.length; i++) {
    unigramCounts.set(ws[i], (unigramCounts.get(ws[i]) ?? 0) + 1)
    if (i > 0) {
      const prev = ws[i - 1]
      if (!bigramCounts.has(prev)) bigramCounts.set(prev, new Map())
      const bg = bigramCounts.get(prev)!
      bg.set(ws[i], (bg.get(ws[i]) ?? 0) + 1)
    }
  }
}
const vocabSize = unigramCounts.size

function bigramPerplexity(text: string): number {
  const ws = words(text)
  if (ws.length < 2) return 1000
  let logProb = 0, count = 0
  for (let i = 1; i < ws.length; i++) {
    const prev = ws[i - 1], curr = ws[i]
    const bigramCount = bigramCounts.get(prev)?.get(curr) ?? 0
    const prevCount   = unigramCounts.get(prev) ?? 0
    logProb += Math.log2((bigramCount + 1) / (prevCount + vocabSize))
    count++
  }
  return Math.pow(2, -logProb / count)
}

// 3. KL divergence
function buildDistribution(values: number[], maxBucket: number): number[] {
  const dist = new Array(maxBucket + 1).fill(0)
  for (const v of values) dist[Math.min(v, maxBucket)]++
  const total = dist.reduce((a, b) => a + b, 0)
  return dist.map(d => (d + 0.01) / (total + 0.01 * dist.length))
}
function klDivergence(p: number[], q: number[]): number {
  let kl = 0
  for (let i = 0; i < p.length; i++) if (p[i] > 0) kl += p[i] * Math.log2(p[i] / q[i])
  return kl
}
const howardSentLens: number[] = [], howardWordLens: number[] = []
for (const para of howardParagraphs) {
  howardSentLens.push(...sentenceLengths(para))
  howardWordLens.push(...wordLengths(para))
}
const howardSentDist = buildDistribution(howardSentLens, 40)
const howardWordDist = buildDistribution(howardWordLens, 15)

function featureKL(text: string): number {
  const sentKL = klDivergence(howardSentDist, buildDistribution(sentenceLengths(text), 40))
  const wordKL = klDivergence(howardWordDist, buildDistribution(wordLengths(text), 15))
  return (sentKL + wordKL) / 2
}

// 4. Content preservation
function ngrams(ws: string[], n: number): Set<string> {
  const result = new Set<string>()
  for (let i = 0; i <= ws.length - n; i++) result.add(ws.slice(i, i + n).join(" "))
  return result
}
function contentPreservation(input: string, output: string): number {
  const iw = words(input), ow = words(output)
  function f1(a: Set<string>, b: Set<string>) {
    let overlap = 0
    for (const g of a) if (b.has(g)) overlap++
    const prec = b.size > 0 ? overlap / b.size : 0
    const rec  = a.size > 0 ? overlap / a.size : 0
    return (prec + rec) > 0 ? 2 * prec * rec / (prec + rec) : 0
  }
  return (f1(ngrams(iw, 1), ngrams(ow, 1)) + f1(ngrams(iw, 2), ngrams(ow, 2))) / 2
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function rewrite(text: string, model: Model): Promise<string> {
  if (model.api === "together") {
    const body: any = {
      model: model.modelId,
      temperature: 0.6,
      max_tokens: 400,
      chat_template_kwargs: { enable_thinking: false },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user",   content: text },
      ],
    }
    if (model.lora) body.lora = model.lora
    const res = await fetch("https://api.together.xyz/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOGETHER_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json() as any
    if (!res.ok) throw new Error(`Together ${res.status}: ${JSON.stringify(data).slice(0, 200)}`)
    return data.choices?.[0]?.message?.content ?? "ERROR"
  } else {
    // W&B Inference: artifact URI goes in the model field
    const res = await fetch("https://api.inference.wandb.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${WANDB_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.modelId,
        temperature: 0.6,
        max_tokens: 400,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user",   content: text },
        ],
      }),
    })
    const data = await res.json() as any
    if (!res.ok) throw new Error(`W&B ${res.status}: ${JSON.stringify(data).slice(0, 200)}`)
    return data.choices?.[0]?.message?.content ?? "ERROR"
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const avg   = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
const round = (n: number, d = 3) => Math.round(n * Math.pow(10, d)) / Math.pow(10, d)

async function main() {
  // Howard reference scores
  const howardClassifier = howardParagraphs.slice(0, 100).map(classifierScore)
  const howardPerplexity = howardParagraphs.slice(0, 100).map(bigramPerplexity)
  const howardKL         = howardParagraphs.slice(0, 100).map(featureKL)
  const inputClassifier  = INPUTS.map(classifierScore)
  const inputPerplexity  = INPUTS.map(bigramPerplexity)
  const inputKL          = INPUTS.map(featureKL)

  console.log("REFERENCE SCORES (Howard's actual prose):")
  console.log(`  Classifier: ${round(avg(howardClassifier))}  Perplexity: ${round(avg(howardPerplexity), 1)}  Feature KL: ${round(avg(howardKL))}`)
  console.log("INPUT SCORES (bland test paragraphs):")
  console.log(`  Classifier: ${round(avg(inputClassifier))}  Perplexity: ${round(avg(inputPerplexity), 1)}  Feature KL: ${round(avg(inputKL))}`)
  console.log()

  type ModelResult = {
    label: string
    texts: string[]
    classifier: number[]
    perplexity: number[]
    featureKL: number[]
    contentPres: number[]
    latencies: number[]
    errors: number
  }

  const results: ModelResult[] = MODELS.map(m => ({
    label: m.label, texts: [], classifier: [], perplexity: [], featureKL: [],
    contentPres: [], latencies: [], errors: 0,
  }))

  console.log("Generating rewrites (15 paragraphs × 2 models)...")
  for (let i = 0; i < INPUTS.length; i++) {
    process.stdout.write(`  P${(i + 1).toString().padStart(2)}: `)
    for (let m = 0; m < MODELS.length; m++) {
      const t0 = performance.now()
      let text = ""
      try {
        text = await rewrite(INPUTS[i], MODELS[m])
      } catch (e: any) {
        text = `ERROR: ${e.message}`
        results[m].errors++
      }
      const ms = Math.round(performance.now() - t0)
      process.stdout.write(`${MODELS[m].label} ${ms}ms  `)
      const r = results[m]
      r.texts.push(text)
      r.latencies.push(ms)
      r.classifier.push(text.startsWith("ERROR") ? 0 : classifierScore(text))
      r.perplexity.push(text.startsWith("ERROR") ? 9999 : bigramPerplexity(text))
      r.featureKL.push(text.startsWith("ERROR") ? 9999 : featureKL(text))
      r.contentPres.push(text.startsWith("ERROR") ? 0 : contentPreservation(INPUTS[i], text))
    }
    console.log()
  }

  console.log("\n" + "=".repeat(80))
  console.log("STYLE SCORING: V3 (Together 9B) vs V4 (W&B 14B)")
  console.log("=".repeat(80))

  const hdr = "                      Howard ref    Input       " +
    results.map(r => r.label.padEnd(18)).join("  ")
  console.log("\n" + hdr)
  console.log(`Classifier (↑)         ${round(avg(howardClassifier)).toString().padStart(6)}        ${round(avg(inputClassifier)).toString().padStart(6)}      ` +
    results.map(r => round(avg(r.classifier)).toString().padStart(6)).join("              "))
  console.log(`Perplexity (↓)         ${round(avg(howardPerplexity), 1).toString().padStart(6)}        ${round(avg(inputPerplexity), 1).toString().padStart(6)}      ` +
    results.map(r => round(avg(r.perplexity), 1).toString().padStart(6)).join("              "))
  console.log(`Feature KL (↓)         ${round(avg(howardKL)).toString().padStart(6)}        ${round(avg(inputKL)).toString().padStart(6)}      ` +
    results.map(r => round(avg(r.featureKL)).toString().padStart(6)).join("              "))
  console.log(`Content pres (↑)          n/a           n/a      ` +
    results.map(r => round(avg(r.contentPres)).toString().padStart(6)).join("              "))
  console.log(`Avg latency (ms)          n/a           n/a      ` +
    results.map(r => Math.round(avg(r.latencies)).toString().padStart(6)).join("              "))
  console.log(`Errors                    n/a           n/a      ` +
    results.map(r => r.errors.toString().padStart(6)).join("              "))

  console.log("\n" + "=".repeat(80))
  console.log("PER-PARAGRAPH CLASSIFIER SCORES")
  console.log("=".repeat(80))
  console.log("\n     Input   " + results.map(r => r.label.slice(0, 6).padStart(7)).join("   ") + "   Winner")
  for (let i = 0; i < INPUTS.length; i++) {
    const scores = results.map(r => r.classifier[i])
    const maxScore = Math.max(...scores)
    const winner = results[scores.indexOf(maxScore)].label
    console.log(`P${(i + 1).toString().padStart(2)}  ${round(inputClassifier[i]).toString().padStart(5)}  ${scores.map(s => round(s).toString().padStart(5)).join("   ")}   ${winner}`)
  }

  // Sample outputs for qualitative check
  console.log("\n" + "=".repeat(80))
  console.log("SAMPLE OUTPUTS (P1)")
  console.log("=".repeat(80))
  console.log(`\nINPUT:\n${INPUTS[0]}\n`)
  for (const r of results) {
    console.log(`${r.label}:\n${r.texts[0]}\n`)
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })
