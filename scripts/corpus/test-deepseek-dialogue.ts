#!/usr/bin/env bun
/**
 * Head-to-head: DeepSeek V3.2 vs Sonnet on dialogue-extraction task.
 *
 * Runs the same prompt we used for Sonnet subagents against DeepSeek's
 * programmatic API. Output goes to /tmp/deepseek-dialogue-test.jsonl;
 * separate Sonnet subagent processes the same 10 beats for comparison.
 */

import { readFileSync, writeFileSync } from "fs"

const API_KEY = process.env.DEEPSEEK_API_KEY
if (!API_KEY) { console.error("DEEPSEEK_API_KEY not set"); process.exit(1) }

const SYSTEM_PROMPT = `You extract dialogue lines from fantasy prose with character attribution. Precision matters more than recall — when in doubt, DROP the line.

TARGETS (use these exact canonical spellings):
  Drizzt, Wulfgar, Bruenor, Regis, Catti-brie

Role-description attribution MAP (these ARE named attribution):
  "the dwarf" / "the red-bearded dwarf" → Bruenor
  "the drow" / "the dark elf" / "the ranger" → Drizzt
  "the barbarian" / "the young barbarian" → Wulfgar
  "the halfling" → Regis
  "the girl" / "the young woman" → Catti-brie (only if she is in the beat's characters list AND no ambiguity)

Attribution rules:
  (a) Named attribution (explicit name OR role-description from map) → ALWAYS WORKS, regardless of how many target characters are in the beat
  (b) Flow attribution — a sentence clearly describes ONE target character acting/speaking, then emits a quote → HIGH confidence
  (c) Pronoun attribution — pronoun's referent is unambiguous in the immediately preceding sentence AND only one target character is in the beat's characters list → HIGH
  (d) Anything ambiguous → SKIP

Quality filters — SKIP:
  - Quotes under 3 words
  - Quotes over 50 words
  - Song lyrics, prayers, written letters, inscriptions, narration inside quotes
  - Speakers not in our 5 TARGETS

Emit ONLY a JSON array. Each object: {"char": "...", "quote": "...", "beat_id": "...", "attribution_method": "named" | "role" | "flow" | "pronoun"}

Return ONLY the JSON array — no commentary, no markdown fences.`

interface Beat {
  scene_id: string
  beat_idx: number
  book: string
  kind: string
  words: number
  text: string
}

function buildUserPrompt(beat: Beat): string {
  const beat_id = `${beat.scene_id}_b${beat.beat_idx}`
  return `Beat ${beat_id} (book: ${beat.book}, kind: ${beat.kind}, ${beat.words}w):

${beat.text}

Extract dialogue lines attributed to the 5 TARGET characters. Return ONLY a JSON array.`
}

async function callDeepSeek(system: string, user: string): Promise<{ text: string; tokens: number; latency_ms: number }> {
  const t0 = Date.now()
  const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  })
  if (!resp.ok) throw new Error(`DeepSeek ${resp.status}: ${await resp.text()}`)
  const data = await resp.json() as any
  return {
    text: data.choices[0].message.content,
    tokens: data.usage.total_tokens,
    latency_ms: Date.now() - t0,
  }
}

function extractJSON(raw: string): any {
  // Strip markdown fences if present
  let s = raw.trim()
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "")
  }
  // Find JSON array
  const startIdx = s.indexOf("[")
  const endIdx = s.lastIndexOf("]")
  if (startIdx < 0 || endIdx < startIdx) throw new Error("No JSON array found")
  return JSON.parse(s.slice(startIdx, endIdx + 1))
}

async function main() {
  const beats: Beat[] = readFileSync("/tmp/dialogue-test-sample.jsonl", "utf8")
    .trim().split("\n").map(l => JSON.parse(l))

  console.log(`Running DeepSeek V3.2 on ${beats.length} dialogue beats…\n`)

  const results: any[] = []
  let totalTokens = 0, totalLatency = 0

  for (const beat of beats) {
    const beat_id = `${beat.scene_id}_b${beat.beat_idx}`
    try {
      const { text, tokens, latency_ms } = await callDeepSeek(
        SYSTEM_PROMPT,
        buildUserPrompt(beat),
      )
      const lines = extractJSON(text)
      results.push({ beat_id, status: "ok", lines, tokens, latency_ms })
      totalTokens += tokens
      totalLatency += latency_ms
      console.log(`  ${beat_id}: ${lines.length} lines (${tokens} tok, ${latency_ms}ms)`)
    } catch (err) {
      results.push({ beat_id, status: "error", error: String(err) })
      console.log(`  ${beat_id}: ERROR — ${err}`)
    }
  }

  writeFileSync("/tmp/deepseek-dialogue-test.jsonl",
    results.map(r => JSON.stringify(r)).join("\n"))

  const totalLines = results.filter(r => r.status === "ok").reduce((s, r) => s + r.lines.length, 0)
  console.log(`\nTotal: ${totalLines} dialogue lines extracted`)
  console.log(`Cost: ${totalTokens} tokens (~$${(totalTokens * 0.85 / 1_000_000).toFixed(4)} at DeepSeek V3.2 blended rate)`)
  console.log(`Mean latency: ${(totalLatency / results.length).toFixed(0)}ms`)
  console.log(`Output: /tmp/deepseek-dialogue-test.jsonl`)
}

await main()
