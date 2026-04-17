/**
 * Flatten each dialogue line to a semantically-equivalent neutral paraphrase
 * using DeepSeek directly. Training pair is (flat, char_name) → (voiced original).
 *
 * Replaces the Sonnet-subagent approach (flatten-lines.ts) — DeepSeek is on
 * LXC's .env, no subagent dispatch needed, ~20x cheaper.
 *
 * Input:  dialogue-lines.jsonl
 * Output: dialogue-pairs.jsonl  — { char, voiced: <original>, flat: <paraphrase> }
 */

import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"

const HERE = new URL(".", import.meta.url).pathname
const IN  = join(HERE, "dialogue-lines.jsonl")
const OUT = join(HERE, "dialogue-pairs.jsonl")
const CONCURRENCY = 10

const SYSTEM_PROMPT = `You rewrite dialogue lines to remove voice and style while preserving the speaker's semantic intent.

Take a voiced dialogue line and output a FLAT paraphrase that:
- Preserves every semantic claim, question, command, or emotional beat
- Strips distinctive dialect, vocabulary, rhythm, cadence
- Uses plain, functional Standard English
- Keeps roughly the same word count (±20%)
- Does NOT add new information
- Does NOT editorialize or summarize

Output ONLY the flat paraphrase. No quotes, no commentary, no attribution.

Examples:
  Voiced:  "Aye, but he's no the dwarf I fostered, not no more."
  Flat:    He is no longer the dwarf I raised.

  Voiced:  "By the gods and my own grave, I'll not stand and watch this."
  Flat:    I refuse to stand by and watch this happen.

  Voiced:  "A curious thing, the way fate has a habit of arriving on foot."
  Flat:    Interesting how fate so often shows up unexpectedly.`

interface DialogueRow { char: string; line: string; beat_id: string }
interface FlatPair { char: string; voiced: string; flat: string; beat_id: string }

async function flattenOne(line: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY missing")

  const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Voiced:\n"${line}"\n\nFlat:` },
      ],
      temperature: 0.3,
      max_tokens: 200,
    }),
  })

  if (!resp.ok) throw new Error(`DeepSeek ${resp.status}: ${await resp.text()}`)
  const json = await resp.json() as any
  const out = json.choices?.[0]?.message?.content?.trim() ?? ""
  return out.replace(/^["']|["']$/g, "").trim()
}

async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, idx: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function runner() {
    while (next < items.length) {
      const idx = next++
      results[idx] = await worker(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, runner))
  return results
}

async function main() {
  if (!existsSync(IN)) {
    console.error(`Input not found: ${IN}. Run extract-dialogue.py first.`)
    process.exit(1)
  }

  const rows: DialogueRow[] = readFileSync(IN, "utf8")
    .trim().split("\n").map(l => JSON.parse(l))
  console.log(`Loaded ${rows.length} dialogue lines. Flattening via DeepSeek (concurrency=${CONCURRENCY})...`)

  const startedAt = Date.now()
  let completed = 0
  let failed = 0

  const pairs = await runWithConcurrency(rows, async (r, idx) => {
    try {
      const flat = await flattenOne(r.line)
      completed++
      if (completed % 50 === 0) console.log(`  ${completed}/${rows.length} done`)
      return { char: r.char, voiced: r.line, flat, beat_id: r.beat_id } as FlatPair
    } catch (err) {
      failed++
      console.error(`  [${idx}] ${r.char} failed: ${err instanceof Error ? err.message : err}`)
      return { char: r.char, voiced: r.line, flat: "", beat_id: r.beat_id } as FlatPair
    }
  }, CONCURRENCY)

  const valid = pairs.filter(p => p.flat.length > 0)
  const body = valid.map(p => JSON.stringify(p)).join("\n") + "\n"
  writeFileSync(OUT, body)

  const elapsed = Math.round((Date.now() - startedAt) / 1000)
  console.log(`\n✓ ${valid.length}/${rows.length} pairs flattened in ${elapsed}s (${failed} failed)`)
  console.log(`  Output → ${OUT}`)

  // Sample output for eyeball
  console.log(`\nSample pairs:`)
  for (const p of valid.slice(0, 5)) {
    console.log(`  [${p.char}]`)
    console.log(`    voiced: ${p.voiced}`)
    console.log(`    flat  : ${p.flat}`)
  }
}

main()
