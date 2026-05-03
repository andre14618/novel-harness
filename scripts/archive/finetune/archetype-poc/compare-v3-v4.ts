/**
 * Direct v3 vs v4 comparison on held-out val beats.
 *
 * For each sampled val row, send the SAME system + user prompt to both
 * adapters via W&B Inference and print the two prose outputs alongside
 * the reference. Eyeball dialogue voice differentiation.
 *
 * Input:  finetune-data/salvatore-1988-v4-sft-val.jsonl
 *   (the v4 user prompt includes the Example voiced lines block. v3 was
 *    never trained on that block but it's compatible context — v3 will
 *    just ignore it or fold it into prose. This lets us feed both
 *    adapters the exact same prompt and measure the delta cleanly.)
 */

import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const HERE = new URL(".", import.meta.url).pathname
const VAL  = "/home/andre/apps/novel-harness/finetune-data/salvatore-1988-v4-sft-val.jsonl"
const OUT  = join(HERE, "v3-v4-eval.json")

const V3 = "wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v3"
const V4 = "wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v4"

const SAMPLE_SIZE = 8  // small; eyeball

interface ChatMsg { role: string; content: string }
interface Row { messages: ChatMsg[]; _meta: { beat_id: string; variant: number; kind: string; chapter_key: string } }

async function call(model: string, system: string, user: string): Promise<string> {
  const key = process.env.WANDB_API_KEY!
  const r = await fetch("https://api.inference.wandb.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.8,
      max_tokens: 600,
    }),
  })
  if (!r.ok) return `ERROR ${r.status}: ${(await r.text()).slice(0, 150)}`
  const j = await r.json() as any
  return (j.choices?.[0]?.message?.content ?? "").trim()
}

async function main() {
  // Prefer variant-0 (original, no renames) base rows with at least 2 speakers (dialogue-rich)
  const all = readFileSync(VAL, "utf8").trim().split("\n").map(l => JSON.parse(l)) as Row[]
  const dialogueRich = all.filter(r =>
    r._meta.variant === 0 &&
    r._meta.kind === "base" &&
    r.messages[1].content.split("Example voiced lines:").length >= 3  // at least 2 speakers with examples
  )
  console.log(`Total val rows: ${all.length}`)
  console.log(`Variant-0 base rows with ≥2 speakers with examples: ${dialogueRich.length}`)

  // Deterministic sample
  const step = Math.max(1, Math.floor(dialogueRich.length / SAMPLE_SIZE))
  const picks = Array.from({ length: SAMPLE_SIZE }, (_, i) => dialogueRich[i * step]).filter(Boolean)
  console.log(`Sampled ${picks.length} rows for eval\n`)

  const results = []
  for (let i = 0; i < picks.length; i++) {
    const row = picks[i]
    const sys = row.messages[0].content
    const usr = row.messages[1].content
    const ref = row.messages[2].content

    process.stdout.write(`[${i + 1}/${picks.length}] ${row._meta.beat_id}... `)
    const [v3, v4] = await Promise.all([
      call(V3, sys, usr).catch(e => `ERROR: ${e.message}`),
      call(V4, sys, usr).catch(e => `ERROR: ${e.message}`),
    ])
    process.stdout.write("done\n")

    const speakers = Array.from(usr.matchAll(/\n([A-Z][A-Za-z'-]+):\n  Voice:/g)).map(m => m[1])
    results.push({ beat_id: row._meta.beat_id, chapter_key: row._meta.chapter_key, speakers, user: usr, reference: ref, v3, v4 })
  }

  writeFileSync(OUT, JSON.stringify(results, null, 2))
  console.log(`\nWrote ${OUT}`)

  // Print side-by-side
  for (const r of results) {
    console.log(`\n═══════════════════════ ${r.beat_id} (${r.chapter_key}) ═══════════════════════`)
    console.log(`Speakers: ${r.speakers.join(", ")}`)
    console.log(`\n── REFERENCE ──`)
    console.log(r.reference.slice(0, 1200))
    console.log(`\n── v3 (current fantasy default) ──`)
    console.log(r.v3.slice(0, 1200))
    console.log(`\n── v4 (voice-baked) ──`)
    console.log(r.v4.slice(0, 1200))
  }
}

main()
