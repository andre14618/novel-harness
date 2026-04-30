#!/usr/bin/env bun
/**
 * Head-to-head validation for beat segmentation.
 *
 * Harder task than brief extraction — requires:
 *   1. Verbatim text preservation ("every word of scene in exactly one beat")
 *   2. Reasonable beat boundaries (~80-140w, POV/action/dialogue shifts)
 *   3. Schema compliance (beat_idx, words, kind, boundary_signal, etc.)
 *
 * Sample: 5 scenes of varied sizes from novels/salvatore-icewind-dale/scenes.jsonl
 * Metrics:
 *   - Reconstruction fidelity (combined beat text word-count / scene words)
 *   - Schema compliance (required fields present)
 *   - Beat size distribution
 *   - Median size vs target 105w
 */

import { readFileSync, writeFileSync } from "fs"

const SYSTEM_PROMPT = `You are segmenting a scene from fantasy prose into dramatic beats for training data.

## Task
Split the scene text into sequential beats. Each beat is one unit of dramatic action — a single shift in attention, one exchange, one action sequence.

## Beat boundaries
A new beat starts when you detect:
- POV attention shift
- Action shift (physical movement direction change)
- Narration↔dialogue transition
- Stakes recalibration
- Speaker change in dialogue
- Sensory channel change

## Target size
~80–140 words per beat. Median ~105. If under 60, merge with previous. If over 170, look harder for a boundary.

## Output
Return ONLY a JSON array. Each beat object:
  beat_idx (int, starting at 0)
  words (int)
  kind: "dialogue" | "action" | "interiority" | "description"
  boundary_signal: "scene_start" | "pov_attention_shift" | "action_shift" | "narration_to_dialogue" | "dialogue_to_narration" | "stakes_recalibration" | "speaker_change" | "sensory_channel_change"
  summary: one sentence
  first_sentence: exact first sentence of beat
  last_sentence: exact last sentence of beat
  text: FULL VERBATIM text of beat — every word, no omissions

First beat: boundary_signal="scene_start". Every word of the scene must appear in exactly one beat. Beats must be sequential.

Return ONLY the JSON array — no markdown fences, no commentary.`

interface Scene {
  scene_id: string
  book: string
  chapter: string | number
  words: number
  text: string
}

const MODELS: Record<string, { url: string; key: string; model: string; maxTokens: number }> = {
  deepseek: {
    url: "https://api.deepseek.com/v1/chat/completions",
    key: process.env.DEEPSEEK_API_KEY!,
    model: "deepseek-v4-flash",
    maxTokens: 8192,
  },
  cerebras: {
    url: "https://api.cerebras.ai/v1/chat/completions",
    key: process.env.CEREBRAS_API_KEY!,
    model: "qwen-3-235b-a22b-instruct-2507",
    maxTokens: 8192,
  },
  // Skipping Mimo for this test — verbatim-long-output shape is outside its comfort zone
}

function buildUserPrompt(scene: Scene): string {
  return `Scene ${scene.scene_id} (${scene.words} words):

${scene.text}

Return ONLY the JSON array.`
}

async function callModel(
  cfg: typeof MODELS[string], system: string, user: string,
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
    if (!resp.ok) return { error: `${resp.status}: ${(await resp.text()).slice(0, 300)}` }
    const data = await resp.json() as any
    return {
      text: data.choices[0].message.content,
      tokens: data.usage?.total_tokens ?? 0,
      latency_ms: Date.now() - t0,
    }
  } catch (err) { return { error: String(err) } }
}

function extractJSON(raw: string): any[] {
  let s = raw.trim()
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "")
  const startIdx = s.indexOf("[")
  const endIdx = s.lastIndexOf("]")
  if (startIdx < 0 || endIdx < startIdx) throw new Error(`No JSON array`)
  return JSON.parse(s.slice(startIdx, endIdx + 1))
}

function analyze(scene: Scene, beats: any[]): any {
  const REQ = ["beat_idx", "words", "kind", "boundary_signal", "summary", "first_sentence", "last_sentence", "text"]
  const missing = beats.map((b, i) => {
    const m = REQ.filter(f => !(f in b))
    return m.length ? { beat_idx: i, missing: m } : null
  }).filter(Boolean)

  const combinedText = beats.map(b => b.text ?? "").join(" ")
  const reconWords = combinedText.split(/\s+/).filter(Boolean).length
  const sceneWords = scene.words
  const reconRatio = reconWords / Math.max(1, sceneWords)

  // Verbatim check: how much of scene text appears in combined beat text?
  const sceneTokens = scene.text.toLowerCase().split(/\s+/).filter(Boolean)
  const combinedLower = combinedText.toLowerCase()
  const preservedTokens = sceneTokens.filter(t => combinedLower.includes(t)).length
  const verbatimRatio = preservedTokens / Math.max(1, sceneTokens.length)

  const sizes = beats.map(b => b.words ?? 0).sort((a, b) => a - b)
  const median = sizes[Math.floor(sizes.length / 2)] ?? 0
  const under60 = sizes.filter(s => s < 60).length
  const over170 = sizes.filter(s => s > 170).length

  const kinds: Record<string, number> = {}
  for (const b of beats) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1

  return {
    beats: beats.length,
    schema_errors: missing.length,
    missing_details: missing.slice(0, 3),
    scene_words: sceneWords,
    recon_words: reconWords,
    recon_ratio: reconRatio.toFixed(3),
    verbatim_token_ratio: verbatimRatio.toFixed(3),
    median_size: median,
    size_under_60: under60,
    size_over_170: over170,
    kinds,
  }
}

async function main() {
  const allScenes: Scene[] = readFileSync("novels/salvatore-icewind-dale/scenes.jsonl", "utf8")
    .trim().split("\n").map(l => JSON.parse(l))

  // Sample 5 scenes: small/medium/large/large/dialogue-heavy
  function seeded(i: number) { return Math.abs(Math.sin(i * 9999) * 10000 % 1) }
  const buckets = [
    allScenes.filter(s => s.words >= 200 && s.words < 500),   // small
    allScenes.filter(s => s.words >= 500 && s.words < 1000),  // medium
    allScenes.filter(s => s.words >= 1000 && s.words < 2000), // large
    allScenes.filter(s => s.words >= 2000 && s.words < 3500), // big
  ]
  const picked: Scene[] = []
  for (const bucket of buckets) {
    if (!bucket.length) continue
    picked.push(bucket[Math.floor(seeded(picked.length * 7) * bucket.length)])
  }
  // One more medium
  picked.push(buckets[1]?.[Math.floor(seeded(99) * (buckets[1]?.length ?? 1))])
  const sample = picked.slice(0, 5).filter(Boolean)

  writeFileSync("/tmp/segment-test-sample.jsonl",
    sample.map(s => JSON.stringify(s)).join("\n"))

  console.log(`Sample: ${sample.length} scenes`)
  for (const s of sample) console.log(`  ${s.scene_id} (${s.words}w)`)

  const results: Record<string, any> = {}

  for (const [name, cfg] of Object.entries(MODELS)) {
    if (!cfg.key) { console.log(`\n${name}: skipped (no key)`); continue }
    console.log(`\n=== ${name} (${cfg.model}) ===`)
    const perScene: any[] = []
    let totalTokens = 0, totalLatency = 0, totalErrors = 0
    for (const scene of sample) {
      const r = await callModel(cfg, SYSTEM_PROMPT, buildUserPrompt(scene))
      if ("error" in r) {
        console.log(`  ${scene.scene_id}: ERROR ${r.error.slice(0, 100)}`)
        perScene.push({ scene_id: scene.scene_id, error: r.error })
        totalErrors++
        continue
      }
      try {
        const beats = extractJSON(r.text)
        const a = analyze(scene, beats)
        a.scene_id = scene.scene_id
        a.tokens = r.tokens
        a.latency_ms = r.latency_ms
        perScene.push(a)
        totalTokens += r.tokens
        totalLatency += r.latency_ms
        console.log(`  ${scene.scene_id}: ${a.beats} beats, recon=${a.recon_ratio}, verbatim=${a.verbatim_token_ratio}, schema_err=${a.schema_errors}, median=${a.median_size}w, ${r.latency_ms}ms`)
      } catch (err) {
        console.log(`  ${scene.scene_id}: PARSE ERROR ${err}`)
        perScene.push({ scene_id: scene.scene_id, parse_error: String(err) })
        totalErrors++
      }
    }
    writeFileSync(`/tmp/segment-test-${name}.json`, JSON.stringify(perScene, null, 2))
    results[name] = {
      scenes: sample.length,
      errors: totalErrors,
      total_tokens: totalTokens,
      mean_latency_ms: Math.round(totalLatency / Math.max(1, sample.length - totalErrors)),
      per_scene: perScene,
    }
  }

  console.log("\n=== Summary ===")
  console.log(`${"Model".padEnd(12)} ${"Avg recon".padEnd(12)} ${"Avg verbatim".padEnd(14)} ${"Schema err".padEnd(12)} ${"Median sz".padEnd(11)} ${"Mean lat".padEnd(12)} Cost`)
  for (const [name, r] of Object.entries(results)) {
    const scenes = r.per_scene.filter((s: any) => !s.error && !s.parse_error)
    const avgRecon = scenes.reduce((x: number, s: any) => x + parseFloat(s.recon_ratio), 0) / Math.max(1, scenes.length)
    const avgVerbatim = scenes.reduce((x: number, s: any) => x + parseFloat(s.verbatim_token_ratio), 0) / Math.max(1, scenes.length)
    const totalSchemaErr = scenes.reduce((x: number, s: any) => x + s.schema_errors, 0)
    const avgMedian = scenes.reduce((x: number, s: any) => x + s.median_size, 0) / Math.max(1, scenes.length)
    console.log(`${name.padEnd(12)} ${avgRecon.toFixed(3).padEnd(12)} ${avgVerbatim.toFixed(3).padEnd(14)} ${String(totalSchemaErr).padEnd(12)} ${String(Math.round(avgMedian)).padEnd(11)} ${String(r.mean_latency_ms).padEnd(12)} ~$${(r.total_tokens * 0.85e-6).toFixed(4)}`)
  }

  console.log("\nNext: dispatch Sonnet subagent against /tmp/segment-test-sample.jsonl to produce /tmp/segment-test-sonnet.json as reference.")
}

await main()
