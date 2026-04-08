/**
 * Thorough v4 LoRA diagnostic: base vs fine-tuned vs V3
 *
 * Adds over score-lora-style-v4.ts:
 *   1. Base model control (OpenPipe/Qwen3-14B-Instruct, no adapter) — confirms adapter is applied
 *   2. Adapter effectiveness: unigram Jaccard similarity between base and v4 outputs
 *      If similarity > 0.80 the fine-tune probably isn't being applied
 *   3. Word count / verbosity metric per output
 *   4. Think tag detection — strips <think>...</think> and flags leakage
 *   5. DB persistence — creates tuning_experiment, saves all results in conclusion
 *   6. Full output dump for all 15 paragraphs (not just P1)
 *
 * Usage:
 *   TOGETHER_API_KEY=... WANDB_API_KEY=... [LORA_V4_URI=wandb-artifact:///...] \
 *     bun scripts/score-lora-v4-thorough.ts
 */

import { readFileSync } from "fs"
import { join } from "path"
import { createTuningExperiment, concludeExperiment } from "../data/db"

const TOGETHER_KEY = process.env.TOGETHER_API_KEY!
const WANDB_KEY    = process.env.WANDB_API_KEY!
const V4_URI       = process.env.LORA_V4_URI ?? "wandb-artifact:///andre14618-/novel-harness/howard-tonal-v4:latest"

if (!TOGETHER_KEY) throw new Error("TOGETHER_API_KEY not set")
if (!WANDB_KEY)    throw new Error("WANDB_API_KEY not set")

const SYSTEM = "Rewrite this paragraph. Make the prose vivid, concrete, and direct."

// ── Model roster ──────────────────────────────────────────────────────────────

type Api = "together" | "wandb"
interface Model {
  label: string
  api: Api
  modelId: string
  lora: string | null
}

const MODELS: Model[] = [
  {
    label: "Base (W&B 14B, no adapter)",
    api: "wandb",
    modelId: "OpenPipe/Qwen3-14B-Instruct",
    lora: null,
  },
  {
    label: "V4 (W&B 14B, fine-tuned)",
    api: "wandb",
    modelId: V4_URI,
    lora: null,
  },
  {
    label: "V3 (Together 9B)",
    api: "together",
    modelId: "Qwen/Qwen3.5-9B",
    lora: "andre14618_2c8c/Qwen3.5-9B-howard-tonal-v3-5d040ad5",
  },
]

// ── Load reference data ───────────────────────────────────────────────────────

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

// ── Test inputs (same 15 as score-lora-style.ts) ─────────────────────────────

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

// ── Scoring utilities ─────────────────────────────────────────────────────────

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

// Style classifier
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

// Bigram perplexity
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

// Feature KL
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

// Content preservation
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

// Unigram Jaccard — adapter effectiveness check
function jaccardSimilarity(a: string, b: string): number {
  const wa = new Set(words(a))
  const wb = new Set(words(b))
  let intersection = 0
  for (const w of wa) if (wb.has(w)) intersection++
  const union = new Set([...wa, ...wb]).size
  return union === 0 ? 1 : intersection / union
}

// ── API calls ─────────────────────────────────────────────────────────────────

// Strip any leaked <think>...</think> blocks and return { text, hadThinking }
function stripThinking(raw: string): { text: string; hadThinking: boolean } {
  const hadThinking = /<think>[\s\S]*?<\/think>/i.test(raw)
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim()
  return { text, hadThinking }
}

async function rewrite(text: string, model: Model): Promise<{ text: string; hadThinking: boolean; rawLen: number }> {
  let raw = ""

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
    if (!res.ok) throw new Error(`Together ${res.status}: ${JSON.stringify(data).slice(0, 300)}`)
    raw = data.choices?.[0]?.message?.content ?? "ERROR"
  } else {
    // W&B Inference — OpenPipe/Qwen3-14B-Instruct has non-thinking-default chat template,
    // so no thinking suppression flag needed. If the fine-tuned artifact overrides this,
    // hadThinking will catch it.
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
    if (!res.ok) throw new Error(`W&B ${res.status}: ${JSON.stringify(data).slice(0, 300)}`)
    raw = data.choices?.[0]?.message?.content ?? "ERROR"
  }

  const rawLen = raw.length
  const { text: stripped, hadThinking } = stripThinking(raw)
  return { text: stripped, hadThinking, rawLen }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const avg   = (arr: number[]) => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length
const round = (n: number, d = 3) => Math.round(n * Math.pow(10, d)) / Math.pow(10, d)

interface ParaResult {
  inputWords: number
  text: string
  outputWords: number
  hadThinking: boolean
  classifier: number
  perplexity: number
  featureKL: number
  contentPres: number
  latencyMs: number
  error: string | null
}

interface ModelResult {
  label: string
  paras: ParaResult[]
  errors: number
  thinkingLeaks: number
}

async function main() {
  const expId = await createTuningExperiment(
    "lora",
    `Qwen3-14B LoRA v4 thorough diagnostic: base vs fine-tuned vs V3 — ${INPUTS.length} inputs × ${MODELS.length} models`,
    {
      models: MODELS.map(m => ({ label: m.label, api: m.api, modelId: m.modelId, lora: m.lora })),
      v4Uri: V4_URI,
      inputCount: INPUTS.length,
      diagnostics: ["adapter_effectiveness", "verbosity", "think_leak_detection"],
    },
    { target: "tonal-pass", dimension: "style" },
  )
  console.log(`Created tuning_experiment id=${expId}\n`)
  console.log(`V4 artifact: ${V4_URI}\n`)

  // Reference scores
  const howardClassifier = howardParagraphs.slice(0, 100).map(classifierScore)
  const howardPerplexity = howardParagraphs.slice(0, 100).map(bigramPerplexity)
  const howardKL         = howardParagraphs.slice(0, 100).map(featureKL)
  const inputClassifier  = INPUTS.map(classifierScore)
  const inputPerplexity  = INPUTS.map(bigramPerplexity)
  const inputKL          = INPUTS.map(featureKL)
  const inputWords       = INPUTS.map(t => words(t).length)

  console.log("REFERENCE SCORES (Howard's actual prose):")
  console.log(`  Classifier: ${round(avg(howardClassifier))}  Perplexity: ${round(avg(howardPerplexity), 1)}  Feature KL: ${round(avg(howardKL))}`)
  console.log("INPUT SCORES (bland test paragraphs):")
  console.log(`  Classifier: ${round(avg(inputClassifier))}  Perplexity: ${round(avg(inputPerplexity), 1)}  Feature KL: ${round(avg(inputKL))}  Avg words: ${round(avg(inputWords), 1)}`)
  console.log()

  const results: ModelResult[] = MODELS.map(m => ({ label: m.label, paras: [], errors: 0, thinkingLeaks: 0 }))

  console.log(`Generating rewrites (${INPUTS.length} paragraphs × ${MODELS.length} models)...`)
  for (let i = 0; i < INPUTS.length; i++) {
    process.stdout.write(`  P${(i + 1).toString().padStart(2)}: `)
    for (let m = 0; m < MODELS.length; m++) {
      const t0 = performance.now()
      let para: ParaResult = {
        inputWords: inputWords[i],
        text: "",
        outputWords: 0,
        hadThinking: false,
        classifier: 0,
        perplexity: 9999,
        featureKL: 9999,
        contentPres: 0,
        latencyMs: 0,
        error: null,
      }
      try {
        const { text, hadThinking } = await rewrite(INPUTS[i], MODELS[m])
        para.text       = text
        para.hadThinking = hadThinking
        para.outputWords = words(text).length
        para.classifier  = classifierScore(text)
        para.perplexity  = bigramPerplexity(text)
        para.featureKL   = featureKL(text)
        para.contentPres = contentPreservation(INPUTS[i], text)
        if (hadThinking) results[m].thinkingLeaks++
      } catch (e: any) {
        para.error = e.message
        results[m].errors++
      }
      para.latencyMs = Math.round(performance.now() - t0)
      results[m].paras.push(para)
      const flag = para.error ? "ERR" : (para.hadThinking ? "THINK!" : "ok")
      process.stdout.write(`${MODELS[m].label.split(" ")[0]} ${para.latencyMs}ms [${flag}]  `)
    }
    console.log()
  }

  // ── Summary table ───────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(100))
  console.log("AGGREGATE METRICS")
  console.log("=".repeat(100))

  const padL = (s: string, n: number) => s.padEnd(n)
  const padR = (s: string, n: number) => s.padStart(n)

  const COLS = results.map(r => r.label.slice(0, 22).padEnd(24))
  console.log("\n" + " ".repeat(26) + "Howard ref   Input      " + COLS.join(""))
  const row = (label: string, ref: number, inp: number, vals: number[], fmt = (n: number) => round(n, 3).toString()) => {
    const winner = vals.indexOf(Math.max(...vals))
    const cells = vals.map((v, i) => {
      const s = fmt(v)
      return (i === winner ? `*${s}` : ` ${s}`).padStart(10)
    })
    console.log(padL(label, 26) + padR(fmt(ref), 10) + "   " + padR(fmt(inp), 8) + "   " + cells.join("  "))
  }
  const rowMin = (label: string, ref: number, inp: number, vals: number[], fmt = (n: number) => round(n, 3).toString()) => {
    const winner = vals.indexOf(Math.min(...vals))
    const cells = vals.map((v, i) => {
      const s = fmt(v)
      return (i === winner ? `*${s}` : ` ${s}`).padStart(10)
    })
    console.log(padL(label, 26) + padR(fmt(ref), 10) + "   " + padR(fmt(inp), 8) + "   " + cells.join("  "))
  }

  row   ("Classifier (↑)",    avg(howardClassifier), avg(inputClassifier),  results.map(r => avg(r.paras.filter(p => !p.error).map(p => p.classifier))))
  rowMin("Perplexity (↓)",    avg(howardPerplexity), avg(inputPerplexity),  results.map(r => avg(r.paras.filter(p => !p.error).map(p => p.perplexity))), n => round(n, 1).toString())
  rowMin("Feature KL (↓)",    avg(howardKL),         avg(inputKL),          results.map(r => avg(r.paras.filter(p => !p.error).map(p => p.featureKL))))
  row   ("Content pres (↑)",  NaN,                   NaN,                   results.map(r => avg(r.paras.filter(p => !p.error).map(p => p.contentPres))), n => isNaN(n) ? "n/a" : round(n, 3).toString())
  console.log(padL("Avg output words",  26) + " ".repeat(14) + padR(round(avg(inputWords), 1).toString(), 8) + "   " +
    results.map(r => padR(round(avg(r.paras.filter(p => !p.error).map(p => p.outputWords)), 1).toString(), 10)).join("  "))
  console.log(padL("Avg latency (ms)",  26) + " ".repeat(22) + "   " +
    results.map(r => padR(Math.round(avg(r.paras.map(p => p.latencyMs))).toString(), 10)).join("  "))
  console.log(padL("Thinking leaks",    26) + " ".repeat(22) + "   " +
    results.map(r => padR(r.thinkingLeaks.toString(), 10)).join("  "))
  console.log(padL("Errors",            26) + " ".repeat(22) + "   " +
    results.map(r => padR(r.errors.toString(), 10)).join("  "))

  // ── Adapter effectiveness ───────────────────────────────────────────────────

  const baseIdx  = results.findIndex(r => r.label.includes("no adapter"))
  const v4Idx    = results.findIndex(r => r.label.includes("fine-tuned"))
  let adapterNote = ""
  if (baseIdx >= 0 && v4Idx >= 0) {
    console.log("\n" + "=".repeat(100))
    console.log("ADAPTER EFFECTIVENESS (base vs fine-tuned Jaccard similarity)")
    console.log("=".repeat(100))
    console.log("  If similarity is consistently high (>0.80), the fine-tuned adapter is not being applied.\n")
    const similarities: number[] = []
    for (let i = 0; i < INPUTS.length; i++) {
      const bp = results[baseIdx].paras[i]
      const vp = results[v4Idx].paras[i]
      if (bp.error || vp.error) {
        console.log(`  P${(i + 1).toString().padStart(2)}  [skipped — error in base or v4]`)
        continue
      }
      const sim = jaccardSimilarity(bp.text, vp.text)
      similarities.push(sim)
      const flag = sim > 0.80 ? " ← HIGH (adapter may not be applied)" : (sim > 0.60 ? " ← moderate" : " ← distinct")
      console.log(`  P${(i + 1).toString().padStart(2)}  Jaccard ${round(sim, 3)}${flag}`)
    }
    const avgSim = avg(similarities)
    adapterNote = `avg Jaccard base↔v4: ${round(avgSim, 3)}`
    console.log(`\n  Avg Jaccard: ${round(avgSim, 3)}`)
    if (avgSim > 0.80) {
      console.log("  ⚠ WARNING: outputs are nearly identical — adapter likely not applied or artifact not found")
    } else if (avgSim > 0.60) {
      console.log("  ⚠ Moderate similarity — adapter applied but effect is weak, or adapter trained poorly")
    } else {
      console.log("  ✓ Distinct outputs — adapter is being applied")
    }
  }

  // ── Per-paragraph classifier table ─────────────────────────────────────────

  console.log("\n" + "=".repeat(100))
  console.log("PER-PARAGRAPH CLASSIFIER SCORES (* = best)")
  console.log("=".repeat(100))
  const colHdrs = results.map(r => r.label.slice(0, 8).padStart(9))
  console.log("     Input  " + colHdrs.join("  ") + "   Winner")
  for (let i = 0; i < INPUTS.length; i++) {
    const scores = results.map(r => r.paras[i]?.error ? -1 : (r.paras[i]?.classifier ?? -1))
    const maxScore = Math.max(...scores.filter(s => s >= 0))
    const winnerIdx = scores.indexOf(maxScore)
    const winnerLabel = winnerIdx >= 0 ? results[winnerIdx].label.split(" ")[0] : "?"
    const cells = scores.map((s, idx) => {
      const str = s < 0 ? " ERR " : round(s, 3).toString().padStart(5)
      return (idx === winnerIdx ? `*${str}` : ` ${str}`).padStart(9)
    })
    console.log(`P${(i + 1).toString().padStart(2)}  ${round(inputClassifier[i], 3).toString().padStart(5)}  ${cells.join("  ")}   ${winnerLabel}`)
  }

  // ── Full output dump ────────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(100))
  console.log("FULL OUTPUT DUMP — all 15 paragraphs")
  console.log("=".repeat(100))
  for (let i = 0; i < INPUTS.length; i++) {
    console.log(`\n── P${i + 1} (input ${inputWords[i]} words) ` + "─".repeat(60))
    console.log(`INPUT: ${INPUTS[i]}`)
    for (const r of results) {
      const p = r.paras[i]
      const label = r.label
      if (p.error) {
        console.log(`\n${label}:\n  ERROR: ${p.error}`)
      } else {
        const thinking = p.hadThinking ? " [THINKING STRIPPED]" : ""
        console.log(`\n${label} [${p.outputWords}w, ${p.latencyMs}ms, cls=${round(p.classifier, 3)}]${thinking}:\n${p.text}`)
      }
    }
  }

  // ── Persist to DB ───────────────────────────────────────────────────────────

  const summary = results.map(r => {
    const valid = r.paras.filter(p => !p.error)
    return {
      label: r.label,
      classifier:   round(avg(valid.map(p => p.classifier)), 4),
      perplexity:   round(avg(valid.map(p => p.perplexity)), 1),
      featureKL:    round(avg(valid.map(p => p.featureKL)), 4),
      contentPres:  round(avg(valid.map(p => p.contentPres)), 4),
      avgWords:     round(avg(valid.map(p => p.outputWords)), 1),
      avgLatencyMs: Math.round(avg(r.paras.map(p => p.latencyMs))),
      thinkingLeaks: r.thinkingLeaks,
      errors:       r.errors,
    }
  })

  const baseResult  = summary.find(s => s.label.includes("no adapter"))
  const v4Result    = summary.find(s => s.label.includes("fine-tuned"))
  const v3Result    = summary.find(s => s.label.includes("Together"))

  let verdict = ""
  if (v4Result && baseResult) {
    const classifierDelta = round(v4Result.classifier - baseResult.classifier, 4)
    const wordsDelta      = round(v4Result.avgWords - baseResult.avgWords, 1)
    verdict = `V4 vs base: classifier delta=${classifierDelta > 0 ? "+" : ""}${classifierDelta}, avg words delta=${wordsDelta > 0 ? "+" : ""}${wordsDelta}. ${adapterNote}.`
    if (v3Result) {
      const v4vsV3 = round(v4Result.classifier - v3Result.classifier, 4)
      verdict += ` V4 vs V3: classifier delta=${v4vsV3 > 0 ? "+" : ""}${v4vsV3}.`
    }
  }

  const conclusion = JSON.stringify({ summary, verdict }, null, 2)
  await concludeExperiment(expId, conclusion)

  console.log("\n" + "=".repeat(100))
  console.log(`Results saved to tuning_experiment id=${expId}`)
  console.log(`Verdict: ${verdict || "see experiment record"}`)
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })
