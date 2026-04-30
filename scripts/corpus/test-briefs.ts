#!/usr/bin/env bun
/**
 * Head-to-head validation for brief extraction.
 *
 * Task: given a beat's prose, extract {characters, pov, setting, tone,
 * transition_in}. Tests DeepSeek V3.2, Cerebras Qwen 235B, Mimo Flash,
 * and Kimi K2 (Groq) against a Sonnet subagent baseline.
 *
 * Sample: 10 beats from novels/salvatore-icewind-dale/beats.jsonl
 *   mixed kinds (action/dialogue/interiority/description), mixed books.
 *
 * Metric: field-level agreement with Sonnet. Writes
 *   /tmp/brief-test-<model>.jsonl per model
 *   /tmp/brief-test-sample.jsonl (the beats used)
 *   /tmp/brief-test-sonnet.json (ground truth, written by separate agent dispatch)
 */

import { readFileSync, writeFileSync } from "fs"

const SYSTEM_PROMPT = `Extract structured briefs from fantasy prose beats.

For each beat, extract:
  characters: array of named characters present or mentioned in action
  pov: POV character name, or "omniscient" if no single character's interiority drives the beat
  setting: brief location (e.g., "Bryn Shander gates", "dark alley in Easthaven", "tundra")
  tone: 1-3 words (e.g., "tense", "grim humor", "desperate fury")
  transition_in: how this beat connects from the previous (e.g., "continues dialogue", "cuts to new location", "time skip"). First beat of scene = "scene_start".

Return ONLY a JSON array of objects, one per beat, each with a beat_id matching the input. No markdown fences, no commentary.`

interface Beat {
  scene_id: string
  beat_idx: number
  book: string
  kind: string
  words: number
  text: string
  summary?: string
}

interface Brief {
  beat_id: string
  characters: string[]
  pov: string
  setting: string
  tone: string
  transition_in: string
}

const MODELS: Record<string, { url: string; key: string; model: string; maxTokens: number }> = {
  deepseek: {
    url: "https://api.deepseek.com/v1/chat/completions",
    key: process.env.DEEPSEEK_API_KEY!,
    model: "deepseek-v4-flash",
    maxTokens: 2048,
  },
  cerebras: {
    url: "https://api.cerebras.ai/v1/chat/completions",
    key: process.env.CEREBRAS_API_KEY!,
    model: "qwen-3-235b-a22b-instruct-2507",
    maxTokens: 2048,
  },
  kimi: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: process.env.GROQ_API_KEY!,
    model: "moonshotai/kimi-k2-instruct-0905",
    maxTokens: 2048,
  },
  mimo: {
    url: "https://api.xiaomimimo.com/v1/chat/completions",
    key: process.env.MIMO_API_KEY!,
    model: "mimo-v2-flash",
    maxTokens: 2048,
  },
}

function buildUserPrompt(beats: Beat[]): string {
  const body = beats.map(b => {
    const beat_id = `${b.scene_id}_b${b.beat_idx}`
    return `### Beat ${beat_id} (${b.words}w, ${b.kind})
Summary: ${b.summary ?? "(none)"}
Text:
${b.text}`
  }).join("\n\n")
  return `Extract briefs for these ${beats.length} beats. Return a JSON array with one object per beat, each including beat_id.\n\n${body}`
}

async function callModel(
  key: string, cfg: typeof MODELS[string], system: string, user: string,
): Promise<{ text: string; tokens: number; latency_ms: number } | { error: string }> {
  const t0 = Date.now()
  try {
    const resp = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cfg.key}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        max_tokens: cfg.maxTokens,
      }),
    })
    if (!resp.ok) {
      return { error: `${resp.status}: ${(await resp.text()).slice(0, 300)}` }
    }
    const data = await resp.json() as any
    return {
      text: data.choices[0].message.content,
      tokens: data.usage?.total_tokens ?? 0,
      latency_ms: Date.now() - t0,
    }
  } catch (err) {
    return { error: String(err) }
  }
}

function extractJSON(raw: string): Brief[] {
  let s = raw.trim()
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "")
  const startIdx = s.indexOf("[")
  const endIdx = s.lastIndexOf("]")
  if (startIdx < 0 || endIdx < startIdx) throw new Error(`No JSON array in: ${s.slice(0, 150)}`)
  return JSON.parse(s.slice(startIdx, endIdx + 1))
}

async function main() {
  // Pick 10 beats: mixed kinds + books + sizes
  const allBeats: Beat[] = readFileSync("novels/salvatore-icewind-dale/beats.jsonl", "utf8")
    .trim().split("\n").map(l => JSON.parse(l))

  // Stratified sample: at least 2 of each kind, spanning all 3 books
  const byKind: Record<string, Beat[]> = {}
  for (const b of allBeats) (byKind[b.kind] ??= []).push(b)
  // deterministic seed
  function seeded(i: number) { return Math.sin(i * 9999) * 10000 % 1 }
  const sample: Beat[] = []
  for (const kind of ["action", "dialogue", "interiority", "description"]) {
    const pool = byKind[kind] ?? []
    const byBook: Record<string, Beat[]> = {}
    for (const b of pool) (byBook[b.book] ??= []).push(b)
    for (const book of Object.keys(byBook).slice(0, 3)) {
      const p = byBook[book]
      if (!p.length) continue
      const idx = Math.floor(Math.abs(seeded(sample.length * 31 + kind.length)) * p.length)
      sample.push(p[idx % p.length])
    }
  }
  const picked = sample.slice(0, 10)
  writeFileSync("/tmp/brief-test-sample.jsonl",
    picked.map(b => JSON.stringify(b)).join("\n"))

  console.log(`Sample: ${picked.length} beats`)
  for (const b of picked) console.log(`  ${b.scene_id}_b${b.beat_idx} (${b.kind}, ${b.words}w, ${b.book})`)
  console.log()

  const userPrompt = buildUserPrompt(picked)

  // Run each model
  for (const [name, cfg] of Object.entries(MODELS)) {
    if (!cfg.key) { console.log(`  ${name}: skipped (no API key)`); continue }
    console.log(`\n=== ${name} (${cfg.model}) ===`)
    const result = await callModel(name, cfg, SYSTEM_PROMPT, userPrompt)
    if ("error" in result) {
      console.log(`  ERROR: ${result.error}`)
      continue
    }
    try {
      const briefs = extractJSON(result.text)
      writeFileSync(`/tmp/brief-test-${name}.json`, JSON.stringify(briefs, null, 2))
      console.log(`  ${briefs.length} briefs, ${result.tokens} tokens, ${result.latency_ms}ms`)
      console.log(`  cost est: $${(result.tokens * 0.0000005).toFixed(5)} (rough)`)
      // Spot-check first brief
      if (briefs[0]) {
        console.log(`  sample: ${briefs[0].beat_id} chars=${JSON.stringify(briefs[0].characters)} pov=${briefs[0].pov}`)
      }
    } catch (err) {
      console.log(`  PARSE ERROR: ${err}`)
      writeFileSync(`/tmp/brief-test-${name}-raw.txt`, result.text)
      console.log(`  raw saved to /tmp/brief-test-${name}-raw.txt`)
    }
  }

  console.log("\nNext: dispatch Sonnet subagent against /tmp/brief-test-sample.jsonl to produce /tmp/brief-test-sonnet.json as reference.")
}

await main()
