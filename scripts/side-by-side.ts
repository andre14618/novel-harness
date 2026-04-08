#!/usr/bin/env bun
/**
 * Generate an HTML side-by-side comparison of base vs V3 LoRA rewrites.
 * Opens in browser for scrollable reading.
 *
 * Usage:
 *   TOGETHER_API_KEY=... bun scripts/side-by-side.ts
 *   # Then open lora-data/comparison.html in browser
 */

import { writeFileSync } from "fs"
import { join } from "path"

const API_KEY = process.env.TOGETHER_API_KEY!
const SYSTEM = "Rewrite this paragraph. Make the prose vivid, concrete, and direct."
const OUTPUT = join(import.meta.dir, "../lora-data/comparison.html")

const MODELS = [
  { label: "Input (bland)", lora: null, skip: true },
  { label: "Base Qwen 3.5 9B", lora: null },
  { label: "V3 LoRA (curated, 2ep)", lora: "andre14618_2c8c/Qwen3.5-9B-howard-tonal-v3-5d040ad5" },
]

const INPUTS = [
  { category: "Action", text: "The soldier moved carefully through the dark corridor, his sword held ready in front of him. He could hear strange sounds coming from somewhere deeper in the ruins, and the air felt cold and damp against his skin. He was starting to feel uncomfortable about the whole situation, but he knew he had to keep going." },
  { category: "Action", text: "The two warriors circled each other slowly, looking for an opening. Rain fell steadily on the stone courtyard, making the footing treacherous. The taller man attacked first, swinging his blade in a wide arc. The shorter one stepped back quickly and countered with a thrust that was barely deflected. They were both breathing hard now, and it was clear that neither would give up easily." },
  { category: "Action", text: "The battle had been going on for hours. Bodies lay everywhere on the muddy field. The defenders were exhausted but they refused to retreat. Their leader stood on the wall, shouting encouragement despite the arrow wound in his shoulder." },
  { category: "Action", text: "He drew his sword and charged at the creature. It was larger than a man, covered in dark scales, and its eyes glowed with an unnatural light. The beast swiped at him with enormous claws, and he barely managed to dodge to the side. He struck back, aiming for the exposed throat, and felt his blade bite into flesh." },
  { category: "Atmosphere", text: "She climbed the crumbling tower stairs, testing each step before putting her full weight on it. The moonlight came through gaps in the stone walls, creating patches of silver light on the dusty floor. From somewhere above, she could hear a rhythmic tapping sound that she could not identify. Her torch was getting low, and she considered turning back, but curiosity drove her forward." },
  { category: "Atmosphere", text: "The castle had been abandoned for many years. Weeds grew through cracks in the courtyard stones, and most of the windows were broken. But something about the place suggested that it was not entirely empty. There were fresh marks in the dust on the floor." },
  { category: "Atmosphere", text: "The swamp stretched endlessly in every direction. Mist hung low over the dark water, and strange lights flickered in the distance. The trees here were dead, their branches reaching up like skeletal fingers. Every now and then something splashed in the murky water nearby, but he could never see what caused it." },
  { category: "Atmosphere", text: "The city was quiet at this hour. Most of the shops were closed, their shutters drawn tight. Only a few torches still burned along the main street, casting pools of orange light on the cobblestones. A cat ran across the road ahead of her, disappearing into a narrow alley." },
  { category: "Character", text: "The woman stood at the edge of the cliff, looking down at the churning sea below. The wind was strong and cold, pulling at her cloak. She had come here to make a decision, and she knew there was no going back once she chose." },
  { category: "Character", text: "He woke up in a dark room with no memory of how he had gotten there. His hands were bound and his head was throbbing with pain. Somewhere nearby, he could hear voices speaking in a language he did not understand." },
  { category: "Character", text: "Dawn broke over the battlefield. The survivors began to stir, checking their wounds and looking for fallen companions. The enemy had retreated during the night, leaving behind only their dead. Victory felt hollow in the cold morning light." },
  { category: "Dialogue-adjacent", text: "The tavern was crowded and noisy. Men were drinking and arguing at every table. In the corner, a hooded figure sat alone, watching the room with careful attention. Nobody seemed to notice him, which was exactly what he wanted." },
  { category: "Dialogue-adjacent", text: "The old man looked at him for a long time before speaking. His eyes were sharp despite his age, and there was something unsettling about the way he studied the younger mans face. Finally, he leaned back in his chair and let out a long breath." },
  { category: "Complex", text: "The ship rocked violently as the storm grew worse. Waves crashed over the deck, and the crew struggled to keep the sails from tearing apart. The captain stood at the wheel, his face grim and determined as he fought to keep the vessel from capsizing." },
  { category: "Complex", text: "The assassin waited on the rooftop, perfectly still. Below, the target walked through the market square, surrounded by guards. She counted them carefully and calculated her approach. The window of opportunity would be very small." },
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

async function main() {
  console.log("Generating rewrites for side-by-side comparison...")

  const rows: Array<{ category: string; input: string; base: string; v3: string }> = []

  for (let i = 0; i < INPUTS.length; i++) {
    console.log(`  ${i + 1}/${INPUTS.length} (${INPUTS[i].category})...`)
    const base = await rewrite(INPUTS[i].text, null)
    const v3 = await rewrite(INPUTS[i].text, "andre14618_2c8c/Qwen3.5-9B-howard-tonal-v3-5d040ad5")
    rows.push({ category: INPUTS[i].category, input: INPUTS[i].text, base, v3 })
  }

  // Build HTML
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

  const rowsHtml = rows.map((r, i) => `
    <tr class="category-row"><td colspan="3"><strong>${escape(r.category)}</strong> — Paragraph ${i + 1}</td></tr>
    <tr>
      <td class="input">${escape(r.input)}</td>
      <td class="base">${escape(r.base)}</td>
      <td class="v3">${escape(r.v3)}</td>
    </tr>
  `).join("")

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>LoRA Style Comparison: Base vs V3</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Georgia, 'Times New Roman', serif; background: #1a1a1a; color: #e0e0e0; padding: 20px; }
    h1 { text-align: center; margin-bottom: 8px; color: #fff; font-size: 1.6em; }
    .subtitle { text-align: center; color: #888; margin-bottom: 24px; font-size: 0.9em; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th { position: sticky; top: 0; background: #2a2a2a; padding: 12px 16px; text-align: left; font-size: 0.85em; color: #aaa; text-transform: uppercase; letter-spacing: 1px; border-bottom: 2px solid #444; z-index: 10; }
    td { padding: 16px; vertical-align: top; line-height: 1.7; font-size: 0.95em; border-bottom: 1px solid #333; }
    .category-row td { background: #252525; padding: 8px 16px; font-size: 0.8em; color: #888; border-bottom: 1px solid #333; }
    .input { color: #999; background: #1e1e1e; width: 33%; }
    .base { color: #c4a882; background: #1e1e1e; width: 33%; }
    .v3 { color: #82c4a8; background: #1e1e1e; width: 33%; }
    tr:hover td:not(.category-row td) { background: #252525; }
    .legend { display: flex; justify-content: center; gap: 32px; margin-bottom: 16px; font-size: 0.85em; }
    .legend span { display: flex; align-items: center; gap: 6px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .dot-input { background: #999; }
    .dot-base { background: #c4a882; }
    .dot-v3 { background: #82c4a8; }
  </style>
</head>
<body>
  <h1>LoRA Style Comparison</h1>
  <p class="subtitle">Base Qwen 3.5 9B vs V3 LoRA (4,497 curated Howard pairs, 2 epochs) — ${new Date().toISOString().split("T")[0]}</p>
  <div class="legend">
    <span><span class="dot dot-input"></span> Input (bland)</span>
    <span><span class="dot dot-base"></span> Base model</span>
    <span><span class="dot dot-v3"></span> V3 LoRA</span>
  </div>
  <table>
    <thead>
      <tr>
        <th>Input (bland AI prose)</th>
        <th>Base Qwen 3.5 9B</th>
        <th>V3 LoRA (curated)</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`

  writeFileSync(OUTPUT, html)
  console.log(`\nWritten to ${OUTPUT}`)
  console.log("Open in browser to view side-by-side comparison.")
}

main().catch(console.error)
