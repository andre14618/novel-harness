#!/usr/bin/env bun
/**
 * Quantitative measurement of LoRA tonal effects.
 *
 * Runs N bland paragraphs through base, v2, and v3 LoRA models,
 * then measures prose metrics and reports aggregate statistics.
 *
 * Metrics:
 *   - Word count (compression signal)
 *   - Sentence count & avg sentence length
 *   - Short sentence ratio (≤8 words — Howard's punchy style)
 *   - Adjective-like word density
 *   - Unique verb ratio (vocabulary diversity)
 *   - Concrete noun/verb ratio (short, strong words)
 *   - Longest sentence length (runaway complexity)
 *
 * Also captures raw outputs for qualitative review.
 *
 * Usage:
 *   TOGETHER_API_KEY=... bun scripts/measure-lora-effects.ts
 */

const API_KEY = process.env.TOGETHER_API_KEY!
const SYSTEM = "Rewrite this paragraph. Make the prose vivid, concrete, and direct."

const MODELS = [
  { label: "BASE", lora: null },
  { label: "V2 (full, 2ep)", lora: "andre14618_2c8c/Qwen3.5-9B-howard-tonal-v2-b139cbad" },
  { label: "V3 (curated, 2ep)", lora: "andre14618_2c8c/Qwen3.5-9B-howard-tonal-v3-5d040ad5" },
]

// 15 diverse bland paragraphs covering action, atmosphere, introspection, dialogue-adjacent
const INPUTS = [
  // Action
  "The soldier moved carefully through the dark corridor, his sword held ready in front of him. He could hear strange sounds coming from somewhere deeper in the ruins, and the air felt cold and damp against his skin. He was starting to feel uncomfortable about the whole situation, but he knew he had to keep going.",
  "The two warriors circled each other slowly, looking for an opening. Rain fell steadily on the stone courtyard, making the footing treacherous. The taller man attacked first, swinging his blade in a wide arc. The shorter one stepped back quickly and countered with a thrust that was barely deflected. They were both breathing hard now, and it was clear that neither would give up easily.",
  "The battle had been going on for hours. Bodies lay everywhere on the muddy field. The defenders were exhausted but they refused to retreat. Their leader stood on the wall, shouting encouragement despite the arrow wound in his shoulder.",
  "He drew his sword and charged at the creature. It was larger than a man, covered in dark scales, and its eyes glowed with an unnatural light. The beast swiped at him with enormous claws, and he barely managed to dodge to the side. He struck back, aiming for the exposed throat, and felt his blade bite into flesh.",
  // Atmosphere
  "She climbed the crumbling tower stairs, testing each step before putting her full weight on it. The moonlight came through gaps in the stone walls, creating patches of silver light on the dusty floor. From somewhere above, she could hear a rhythmic tapping sound that she could not identify. Her torch was getting low, and she considered turning back, but curiosity drove her forward.",
  "The castle had been abandoned for many years. Weeds grew through cracks in the courtyard stones, and most of the windows were broken. But something about the place suggested that it was not entirely empty. There were fresh marks in the dust on the floor.",
  "The swamp stretched endlessly in every direction. Mist hung low over the dark water, and strange lights flickered in the distance. The trees here were dead, their branches reaching up like skeletal fingers. Every now and then something splashed in the murky water nearby, but he could never see what caused it.",
  "The city was quiet at this hour. Most of the shops were closed, their shutters drawn tight. Only a few torches still burned along the main street, casting pools of orange light on the cobblestones. A cat ran across the road ahead of her, disappearing into a narrow alley.",
  // Introspection/character
  "The woman stood at the edge of the cliff, looking down at the churning sea below. The wind was strong and cold, pulling at her cloak. She had come here to make a decision, and she knew there was no going back once she chose.",
  "He woke up in a dark room with no memory of how he had gotten there. His hands were bound and his head was throbbing with pain. Somewhere nearby, he could hear voices speaking in a language he did not understand.",
  "Dawn broke over the battlefield. The survivors began to stir, checking their wounds and looking for fallen companions. The enemy had retreated during the night, leaving behind only their dead. Victory felt hollow in the cold morning light.",
  // Dialogue-adjacent narration
  "The tavern was crowded and noisy. Men were drinking and arguing at every table. In the corner, a hooded figure sat alone, watching the room with careful attention. Nobody seemed to notice him, which was exactly what he wanted.",
  "The old man looked at him for a long time before speaking. His eyes were sharp despite his age, and there was something unsettling about the way he studied the younger man's face. Finally, he leaned back in his chair and let out a long breath.",
  // Complex scene
  "The ship rocked violently as the storm grew worse. Waves crashed over the deck, and the crew struggled to keep the sails from tearing apart. The captain stood at the wheel, his face grim and determined as he fought to keep the vessel from capsizing.",
  "The assassin waited on the rooftop, perfectly still. Below, the target walked through the market square, surrounded by guards. She counted them carefully and calculated her approach. The window of opportunity would be very small.",
]

// ── Metrics ─────────────────────────────────────────────────────────────────

const STOPWORDS = new Set(["the", "a", "an", "in", "on", "at", "to", "for", "of", "and", "but", "or", "is", "was", "were", "are", "be", "been", "has", "had", "have", "with", "from", "by", "not", "this", "that", "his", "her", "its", "their", "he", "she", "it", "they", "him", "who", "which", "as", "if", "so", "no", "up", "out", "into", "than", "then", "each", "all", "both", "more", "some", "such", "only", "own", "just", "about", "would", "could", "should", "did", "do", "does", "will", "shall"])

function analyze(text: string) {
  const ws = text.split(/\s+/).filter(w => w.length > 0)
  const sents = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0)
  const sentLengths = sents.map(s => s.split(/\s+/).filter(w => w.length > 0).length)

  const avgSentLen = sents.length > 0 ? ws.length / sents.length : 0
  const shortSents = sentLengths.filter(l => l <= 8).length
  const shortSentRatio = sents.length > 0 ? shortSents / sents.length : 0
  const maxSentLen = sentLengths.length > 0 ? Math.max(...sentLengths) : 0

  // Adjective-like words
  const adjLike = ws.filter(w => /(?:ly|ous|ful|ive|ish|ent|ant)$/i.test(w)).length
  const adjRatio = ws.length > 0 ? adjLike / ws.length : 0

  // Content words (non-stopwords)
  const contentWords = ws.map(w => w.toLowerCase().replace(/[^\w]/g, "")).filter(w => w.length > 0 && !STOPWORDS.has(w))
  const uniqueContent = new Set(contentWords)
  const vocabDiversity = contentWords.length > 0 ? uniqueContent.size / contentWords.length : 0

  // Short strong words (3-6 chars, non-stopwords) — proxy for concrete verbs/nouns
  const shortStrong = contentWords.filter(w => w.length >= 3 && w.length <= 6)
  const shortStrongRatio = contentWords.length > 0 ? shortStrong.length / contentWords.length : 0

  return {
    words: ws.length,
    sentences: sents.length,
    avgSentLen: round(avgSentLen),
    shortSentRatio: round(shortSentRatio * 100),
    maxSentLen,
    adjRatio: round(adjRatio * 100),
    vocabDiversity: round(vocabDiversity * 100),
    shortStrongRatio: round(shortStrongRatio * 100),
  }
}

function round(n: number, d = 1): number {
  const f = Math.pow(10, d)
  return Math.round(n * f) / f
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
  console.log("=== LoRA Effects Measurement ===")
  console.log(`Paragraphs: ${INPUTS.length}`)
  console.log(`Models: ${MODELS.map(m => m.label).join(", ")}\n`)

  type Result = { label: string; metrics: ReturnType<typeof analyze>; text: string }
  const allResults: Array<{ inputMetrics: ReturnType<typeof analyze>; results: Result[] }> = []

  for (let i = 0; i < INPUTS.length; i++) {
    console.log(`  Processing paragraph ${i + 1}/${INPUTS.length}...`)
    const inputMetrics = analyze(INPUTS[i])
    const results: Result[] = []

    for (const m of MODELS) {
      const text = await rewrite(INPUTS[i], m.lora)
      const metrics = analyze(text)
      results.push({ label: m.label, metrics, text })
    }

    allResults.push({ inputMetrics, results })
  }

  // ── Aggregate stats ─────────────────────────────────────────────────────

  const avg = (arr: number[]) => round(arr.reduce((a, b) => a + b, 0) / arr.length)

  console.log("\n" + "=".repeat(80))
  console.log("AGGREGATE METRICS (averaged across 15 paragraphs)")
  console.log("=".repeat(80))

  const header = ["Metric", "Input", ...MODELS.map(m => m.label)]
  const rows: string[][] = []

  const metricNames: Array<{ key: string; label: string; unit: string }> = [
    { key: "words", label: "Word count", unit: "" },
    { key: "sentences", label: "Sentence count", unit: "" },
    { key: "avgSentLen", label: "Avg sent length", unit: "w" },
    { key: "shortSentRatio", label: "Short sent (≤8w)", unit: "%" },
    { key: "maxSentLen", label: "Max sent length", unit: "w" },
    { key: "adjRatio", label: "Adj-like density", unit: "%" },
    { key: "vocabDiversity", label: "Vocab diversity", unit: "%" },
    { key: "shortStrongRatio", label: "Short strong words", unit: "%" },
  ]

  for (const mn of metricNames) {
    const inputAvg = avg(allResults.map(r => (r.inputMetrics as any)[mn.key]))
    const modelAvgs = MODELS.map((_, mi) =>
      avg(allResults.map(r => (r.results[mi].metrics as any)[mn.key]))
    )

    const row = [
      mn.label.padEnd(20),
      `${inputAvg}${mn.unit}`.padStart(8),
      ...modelAvgs.map(v => `${v}${mn.unit}`.padStart(12)),
    ]
    rows.push(row)
  }

  // Print table
  console.log(`${"".padEnd(20)} ${"Input".padStart(8)} ${MODELS.map(m => m.label.padStart(12)).join(" ")}`)
  console.log("-".repeat(80))
  for (const row of rows) {
    console.log(row.join(" "))
  }

  // ── Per-paragraph comparison (abbreviated) ──────────────────────────────

  console.log("\n" + "=".repeat(80))
  console.log("PER-PARAGRAPH OUTPUTS")
  console.log("=".repeat(80))

  for (let i = 0; i < allResults.length; i++) {
    const r = allResults[i]
    console.log(`\n--- Paragraph ${i + 1} ---`)
    console.log(`INPUT (${r.inputMetrics.words}w): ${INPUTS[i].slice(0, 80)}...`)
    for (const res of r.results) {
      console.log(`${res.label} (${res.metrics.words}w, sent=${res.metrics.avgSentLen}): ${res.text.slice(0, 200)}`)
    }
  }

  // ── Delta analysis ──────────────────────────────────────────────────────

  console.log("\n" + "=".repeat(80))
  console.log("DELTA FROM BASE (positive = V3 improved vs base)")
  console.log("=".repeat(80))

  const baseAvgs: Record<string, number> = {}
  const v3Avgs: Record<string, number> = {}
  for (const mn of metricNames) {
    baseAvgs[mn.key] = avg(allResults.map(r => (r.results[0].metrics as any)[mn.key]))
    v3Avgs[mn.key] = avg(allResults.map(r => (r.results[2].metrics as any)[mn.key]))
  }

  console.log(`Word count:        ${baseAvgs.words} → ${v3Avgs.words} (${v3Avgs.words < baseAvgs.words ? "tighter" : "longer"} by ${round(Math.abs(v3Avgs.words - baseAvgs.words))} words)`)
  console.log(`Avg sent length:   ${baseAvgs.avgSentLen} → ${v3Avgs.avgSentLen} (${v3Avgs.avgSentLen < baseAvgs.avgSentLen ? "shorter sentences" : "longer sentences"})`)
  console.log(`Short sent ratio:  ${baseAvgs.shortSentRatio}% → ${v3Avgs.shortSentRatio}% (${v3Avgs.shortSentRatio > baseAvgs.shortSentRatio ? "more punchy" : "fewer punchy"} sentences)`)
  console.log(`Max sent length:   ${baseAvgs.maxSentLen} → ${v3Avgs.maxSentLen} (${v3Avgs.maxSentLen < baseAvgs.maxSentLen ? "less runaway complexity" : "more complex max"})`)
  console.log(`Adj-like density:  ${baseAvgs.adjRatio}% → ${v3Avgs.adjRatio}% (${v3Avgs.adjRatio < baseAvgs.adjRatio ? "fewer adjectives" : "more adjectives"})`)
  console.log(`Short strong words: ${baseAvgs.shortStrongRatio}% → ${v3Avgs.shortStrongRatio}% (${v3Avgs.shortStrongRatio > baseAvgs.shortStrongRatio ? "more concrete" : "less concrete"})`)
}

main().catch(console.error)
