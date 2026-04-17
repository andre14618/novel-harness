#!/usr/bin/env bun
/**
 * Head-to-head validation for 3 LLM-dependent Stage-5 analyzers:
 *   - chapter-hooks  (end-of-chapter hook type classification)
 *   - tension        (0-1 tension score per beat)
 *   - sensory        (5-sense distribution per beat)
 *
 * Runs DeepSeek V3.2 on 10 samples per task. Sonnet subagent produces the
 * reference labels separately. Agreement metrics per task:
 *   - chapter-hooks: exact category match
 *   - tension:       absolute score difference ≤0.2 = agreement
 *   - sensory:       top sense match + Jaccard overlap on ≥0.3 senses
 */

import { readFileSync, writeFileSync } from "fs"

const API_KEY = process.env.DEEPSEEK_API_KEY
if (!API_KEY) { console.error("DEEPSEEK_API_KEY not set"); process.exit(1) }

const HOOK_TYPES = ["cliffhanger", "tease", "promise", "reflection", "mystery", "resolution", "reveal"]

const HOOK_PROMPT = `Classify the hook type of this chapter-closing passage. Pick EXACTLY ONE from:
  cliffhanger — unresolved imminent danger or sudden reversal
  tease — partial reveal hinting at what's next
  promise — explicit setup for upcoming conflict/journey
  reflection — introspective settling after action
  mystery — unexplained phenomenon raising questions
  resolution — emotional or plot closure of a thread
  reveal — information that recontextualizes prior events

Return ONLY this JSON: {"hook_type": "..."}`

const TENSION_PROMPT = `Rate the dramatic tension of this passage on a scale from 0 to 1.
  0.0 = calm description, exposition, reflection with no stakes
  0.3 = mild tension, character dynamics, mounting unease
  0.6 = active conflict, stakes visible, obstacles present
  0.9 = life-or-death, climactic pressure, outcomes uncertain

Return ONLY this JSON: {"tension": 0.X, "reason": "<one short phrase>"}`

const SENSORY_PROMPT = `Rate how strongly each sense is engaged in this passage, 0 to 1.
  visual — what the POV sees (shapes, light, color, motion)
  auditory — sounds, voices, silence
  tactile — touch, temperature, texture, pain, physical contact
  olfactory — smell (includes taste)
  kinesthetic — body movement, posture, exertion, spatial awareness

Return ONLY this JSON: {"visual": 0.X, "auditory": 0.X, "tactile": 0.X, "olfactory": 0.X, "kinesthetic": 0.X}`

interface Beat {
  scene_id: string
  beat_idx: number
  book: string
  chapter: any
  kind: string
  words: number
  text: string
  summary?: string
}

async function callDeepSeek(system: string, user: string, maxTokens = 256): Promise<string> {
  const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.1,
      max_tokens: maxTokens,
    }),
  })
  if (!resp.ok) throw new Error(`${resp.status}: ${(await resp.text()).slice(0, 200)}`)
  const data = await resp.json() as any
  return data.choices[0].message.content
}

function extractJSON(raw: string): any {
  let s = raw.trim()
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "")
  const startIdx = s.indexOf("{"); const endIdx = s.lastIndexOf("}")
  if (startIdx < 0) throw new Error(`No JSON in: ${s.slice(0, 100)}`)
  return JSON.parse(s.slice(startIdx, endIdx + 1))
}

async function main() {
  const beats: Beat[] = readFileSync("novels/salvatore-icewind-dale/beats.jsonl", "utf8")
    .trim().split("\n").map(l => JSON.parse(l))

  // SAMPLE 1: Chapter-closing beats (last beat per chapter). Pick 10.
  const byChapter: Record<string, Beat[]> = {}
  for (const b of beats) {
    const key = `${b.book}_ch${b.chapter}`
    ;(byChapter[key] ??= []).push(b)
  }
  for (const seq of Object.values(byChapter)) seq.sort((a, b) => a.beat_idx - b.beat_idx)
  const chapterKeys = Object.keys(byChapter).filter(k => byChapter[k].length >= 3)
  const hookSample: Beat[] = []
  // Stratify: 4 from Crystal Shard, 3 from Streams, 3 from Halfling's Gem
  function pick(book: string, n: number) {
    const keys = chapterKeys.filter(k => k.startsWith(book)).sort()
    for (let i = 0; i < n && i < keys.length; i++) {
      const idx = Math.floor((i / n) * keys.length)
      hookSample.push(byChapter[keys[idx]][byChapter[keys[idx]].length - 1])
    }
  }
  pick("crystal_shard", 4); pick("streams_of_silver", 3); pick("halflings_gem", 3)

  // SAMPLE 2+3: Mixed beats for tension + sensory (10 diverse)
  const byKind: Record<string, Beat[]> = {}
  for (const b of beats) (byKind[b.kind] ??= []).push(b)
  function seeded(i: number) { return Math.abs(Math.sin(i * 9999) * 10000 % 1) }
  const diverseSample: Beat[] = []
  for (const kind of ["action", "dialogue", "interiority", "description"]) {
    const pool = byKind[kind] ?? []
    for (let j = 0; j < 3 && j < pool.length; j++) {
      const idx = Math.floor(seeded(diverseSample.length + j * 17) * pool.length)
      diverseSample.push(pool[idx])
    }
  }
  const tensionSample = diverseSample.slice(0, 10)
  const sensorySample = diverseSample.slice(0, 10) // same sample, different analyzer

  writeFileSync("/tmp/analyzer-test-hook-sample.jsonl",
    hookSample.map(b => JSON.stringify(b)).join("\n"))
  writeFileSync("/tmp/analyzer-test-diverse-sample.jsonl",
    tensionSample.map(b => JSON.stringify(b)).join("\n"))

  console.log(`Hook sample: ${hookSample.length} chapter-closing beats`)
  console.log(`Tension+sensory sample: ${tensionSample.length} diverse beats\n`)

  const results: any = { hooks: [], tension: [], sensory: [] }

  // Task 1: hooks
  console.log("=== chapter-hooks (DeepSeek) ===")
  for (const b of hookSample) {
    const id = `${b.scene_id}_b${b.beat_idx}`
    try {
      const raw = await callDeepSeek(HOOK_PROMPT, `Passage:\n\n${b.text}`)
      const out = extractJSON(raw)
      results.hooks.push({ beat_id: id, ...out })
      console.log(`  ${id}: ${out.hook_type}`)
    } catch (err) {
      console.log(`  ${id}: ERROR ${err}`)
      results.hooks.push({ beat_id: id, error: String(err) })
    }
  }

  // Task 2: tension
  console.log("\n=== tension (DeepSeek) ===")
  for (const b of tensionSample) {
    const id = `${b.scene_id}_b${b.beat_idx}`
    try {
      const raw = await callDeepSeek(TENSION_PROMPT, `Passage:\n\n${b.text}`)
      const out = extractJSON(raw)
      results.tension.push({ beat_id: id, kind: b.kind, ...out })
      console.log(`  ${id} (${b.kind}): ${out.tension} — ${out.reason}`)
    } catch (err) {
      console.log(`  ${id}: ERROR ${err}`)
    }
  }

  // Task 3: sensory
  console.log("\n=== sensory (DeepSeek) ===")
  for (const b of sensorySample) {
    const id = `${b.scene_id}_b${b.beat_idx}`
    try {
      const raw = await callDeepSeek(SENSORY_PROMPT, `Passage:\n\n${b.text}`)
      const out = extractJSON(raw)
      results.sensory.push({ beat_id: id, kind: b.kind, ...out })
      const top = Object.entries(out).filter(([k]) => k !== "beat_id" && k !== "kind")
        .sort((a, b) => (b[1] as number) - (a[1] as number))[0]
      console.log(`  ${id} (${b.kind}): top=${top?.[0]}(${top?.[1]})`)
    } catch (err) {
      console.log(`  ${id}: ERROR ${err}`)
    }
  }

  writeFileSync("/tmp/analyzer-test-deepseek.json", JSON.stringify(results, null, 2))
  console.log(`\nOutput: /tmp/analyzer-test-deepseek.json`)
  console.log(`Samples: /tmp/analyzer-test-hook-sample.jsonl + /tmp/analyzer-test-diverse-sample.jsonl`)
}

await main()
