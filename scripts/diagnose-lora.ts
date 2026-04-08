#!/usr/bin/env bun
/**
 * Diagnostic: measure prose metrics across base vs LoRA rewrites.
 * Runs 10 bland paragraphs through both models and compares:
 *   - Average sentence length
 *   - Short sentence ratio (≤8 words)
 *   - Adjective-like word ratio
 *   - Total word count
 */

const API_KEY = process.env.TOGETHER_API_KEY!
const SYSTEM = "Rewrite this paragraph. Make the prose vivid, concrete, and direct."
const V2_LORA = "andre14618_2c8c/Qwen3.5-9B-howard-tonal-v2-b139cbad"

const inputs = [
  "The warrior moved through the forest carefully, watching for any signs of danger. The trees were very old and their branches blocked most of the sunlight. He felt increasingly uneasy as he went deeper into the woods.",
  "The woman stood at the edge of the cliff, looking down at the churning sea below. The wind was strong and cold, pulling at her cloak. She had come here to make a decision, and she knew there was no going back once she chose.",
  "The tavern was crowded and noisy. Men were drinking and arguing at every table. In the corner, a hooded figure sat alone, watching the room with careful attention. Nobody seemed to notice him, which was exactly what he wanted.",
  "The battle had been going on for hours. Bodies lay everywhere on the muddy field. The defenders were exhausted but they refused to retreat. Their leader stood on the wall, shouting encouragement despite the arrow wound in his shoulder.",
  "She found the old book hidden behind a loose stone in the library wall. The pages were yellowed and fragile, covered in writing she could barely read. As she carefully turned the pages, she began to realize that this was something very important and possibly dangerous.",
  "The ship rocked violently as the storm grew worse. Waves crashed over the deck, and the crew struggled to keep the sails from tearing apart. The captain stood at the wheel, his face grim and determined as he fought to keep the vessel from capsizing.",
  "He woke up in a dark room with no memory of how he had gotten there. His hands were bound and his head was throbbing with pain. Somewhere nearby, he could hear voices speaking in a language he did not understand.",
  "The castle had been abandoned for many years. Weeds grew through cracks in the courtyard stones, and most of the windows were broken. But something about the place suggested that it was not entirely empty. There were fresh marks in the dust on the floor.",
  "The assassin waited on the rooftop, perfectly still. Below, the target walked through the market square, surrounded by guards. She counted them carefully and calculated her approach. The window of opportunity would be very small.",
  "Dawn broke over the battlefield. The survivors began to stir, checking their wounds and looking for fallen companions. The enemy had retreated during the night, leaving behind only their dead. Victory felt hollow in the cold morning light.",
]

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

function analyze(text: string) {
  const sents = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0)
  const ws = text.split(/\s+/).filter(w => w.length > 0)
  const avgSentLen = sents.length > 0 ? ws.length / sents.length : 0
  const shortSents = sents.filter(s => s.split(/\s+/).length <= 8).length
  const shortSentRatio = sents.length > 0 ? shortSents / sents.length : 0
  const adjLike = ws.filter(w => /(?:ly|ous|ful|ive|ish|ent|ant)$/i.test(w)).length
  const adjRatio = ws.length > 0 ? adjLike / ws.length : 0
  return {
    words: ws.length,
    sentences: sents.length,
    avgSentLen: Math.round(avgSentLen * 10) / 10,
    shortSentRatio: Math.round(shortSentRatio * 100),
    adjRatio: Math.round(adjRatio * 1000) / 10,
  }
}

const results: Array<{ input: any; base: any; v2: any }> = []

for (let i = 0; i < inputs.length; i++) {
  console.log(`  Processing ${i + 1}/${inputs.length}...`)
  const baseOut = await rewrite(inputs[i], null)
  const v2Out = await rewrite(inputs[i], V2_LORA)
  results.push({
    input: analyze(inputs[i]),
    base: { text: baseOut, ...analyze(baseOut) },
    v2: { text: v2Out, ...analyze(v2Out) },
  })
}

const avg = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10

console.log("\n" + "=".repeat(70))
console.log("DIAGNOSTIC: PROSE METRICS (10 rewrites, base vs v2 LoRA)")
console.log("=".repeat(70))
console.log("")
console.log("AVERAGES:")
console.log("                    Input      Base       V2 LoRA")
console.log(`Avg sent length:   ${String(avg(results.map(r => r.input.avgSentLen))).padStart(5)}     ${String(avg(results.map(r => r.base.avgSentLen))).padStart(5)}     ${String(avg(results.map(r => r.v2.avgSentLen))).padStart(5)}`)
console.log(`Short sent %:      ${String(avg(results.map(r => r.input.shortSentRatio))).padStart(4)}%     ${String(avg(results.map(r => r.base.shortSentRatio))).padStart(4)}%     ${String(avg(results.map(r => r.v2.shortSentRatio))).padStart(4)}%`)
console.log(`Adj-like %:        ${String(avg(results.map(r => r.input.adjRatio))).padStart(4)}%     ${String(avg(results.map(r => r.base.adjRatio))).padStart(4)}%     ${String(avg(results.map(r => r.v2.adjRatio))).padStart(4)}%`)
console.log(`Word count:        ${String(avg(results.map(r => r.input.words))).padStart(5)}     ${String(avg(results.map(r => r.base.words))).padStart(5)}     ${String(avg(results.map(r => r.v2.words))).padStart(5)}`)

console.log("\nPER-PARAGRAPH COMPARISON:")
for (let i = 0; i < results.length; i++) {
  const r = results[i]
  console.log(`\n--- Paragraph ${i + 1} (avgSent: input=${r.input.avgSentLen} base=${r.base.avgSentLen} v2=${r.v2.avgSentLen}) ---`)
  console.log(`BASE: ${r.base.text.slice(0, 250)}`)
  console.log(`V2:   ${r.v2.text.slice(0, 250)}`)
}
