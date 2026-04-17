#!/usr/bin/env bun
/**
 * Run an LLM-based Stage-5 analyzer on a novel bundle's beats.
 *
 * Supported analyzers (validated against Sonnet on 10-sample head-to-head):
 *   tension         — 90% within ±0.2 — PRODUCTION
 *   chapter-hooks   — 40% exact (category ambiguity) — PILOT
 *   sensory         — 50% top-sense — PILOT (needs prompt refinement)
 *
 * Writes to novels/<key>/analysis/<analyzer>.jsonl + .report.json
 *
 * Usage:
 *   bun scripts/analysis/run-llm-analyzer.ts --novel salvatore-icewind-dale --analyzer tension --concurrency 30
 *   bun scripts/analysis/run-llm-analyzer.ts --novel salvatore-icewind-dale --analyzer chapter-hooks
 */

import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const API_KEY = process.env.DEEPSEEK_API_KEY
if (!API_KEY) { console.error("DEEPSEEK_API_KEY not set"); process.exit(1) }

const REPO_ROOT = new URL("../..", import.meta.url).pathname

function arg(flag: string, fb?: string) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fb
}

const PROMPTS = {
  tension: `Rate the dramatic tension of this passage on a scale from 0 to 1.
  0.0 = calm description, exposition, reflection with no stakes
  0.3 = mild tension, character dynamics, mounting unease
  0.6 = active conflict, stakes visible, obstacles present
  0.9 = life-or-death, climactic pressure, outcomes uncertain

Return ONLY this JSON: {"tension": 0.X, "reason": "<one short phrase>"}`,

  "chapter-hooks": `Classify the hook type of this chapter-closing passage. Pick EXACTLY ONE from:
  cliffhanger — unresolved imminent danger or sudden reversal
  tease — partial reveal hinting at what's next
  promise — explicit setup for upcoming conflict/journey
  reflection — introspective settling after action
  mystery — unexplained phenomenon raising questions
  resolution — emotional or plot closure of a thread
  reveal — information that recontextualizes prior events

Return ONLY this JSON: {"hook_type": "..."}`,

  sensory: `Rate how strongly each sense is engaged in this passage, 0 to 1.
  visual — what the POV sees (shapes, light, color, motion)
  auditory — sounds, voices, silence
  tactile — touch, temperature, texture, pain, physical contact
  olfactory — smell (includes taste)
  kinesthetic — body movement, posture, exertion, spatial awareness

Default to the strongest senses for this specific passage — do NOT default to visual for all beats.

Return ONLY this JSON: {"visual": 0.X, "auditory": 0.X, "tactile": 0.X, "olfactory": 0.X, "kinesthetic": 0.X}`,
}

interface Beat {
  scene_id: string
  beat_idx: number
  book: string
  chapter: any
  kind: string
  words: number
  text: string
}

async function callDeepSeek(system: string, user: string, retries = 2, maxTokens = 256): Promise<any> {
  let lastErr: any
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
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
      if (!resp.ok) {
        if (resp.status === 429 || resp.status >= 500) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          lastErr = new Error(`${resp.status}: ${(await resp.text()).slice(0, 200)}`)
          continue
        }
        throw new Error(`${resp.status}: ${(await resp.text()).slice(0, 200)}`)
      }
      const data = await resp.json() as any
      return { text: data.choices[0].message.content, tokens: data.usage?.total_tokens ?? 0 }
    } catch (err) { lastErr = err; if (attempt < retries) await new Promise(r => setTimeout(r, 500 * (attempt + 1))) }
  }
  throw lastErr
}

function extractJSON(raw: string): any {
  let s = raw.trim()
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "")
  const startIdx = s.indexOf("{"); const endIdx = s.lastIndexOf("}")
  if (startIdx < 0) throw new Error(`no JSON in: ${s.slice(0, 100)}`)
  return JSON.parse(s.slice(startIdx, endIdx + 1))
}

function selectBeats(analyzer: string, beats: Beat[]): Beat[] {
  if (analyzer === "chapter-hooks") {
    // Only the last beat of each chapter
    const byChapter: Record<string, Beat[]> = {}
    for (const b of beats) {
      const key = `${b.book}_ch${b.chapter}`
      ;(byChapter[key] ??= []).push(b)
    }
    return Object.values(byChapter).map(seq => {
      seq.sort((a, b) => a.beat_idx - b.beat_idx)
      return seq[seq.length - 1]
    })
  }
  return beats
}

async function main() {
  const novel = arg("--novel")
  const analyzer = arg("--analyzer")
  const concurrency = parseInt(arg("--concurrency", "30") ?? "30", 10)
  if (!novel || !analyzer || !(analyzer in PROMPTS)) {
    console.error("Usage: --novel <key> --analyzer {tension|chapter-hooks|sensory}")
    process.exit(1)
  }

  const bundleDir = join(REPO_ROOT, "novels", novel)
  const allBeats: Beat[] = readFileSync(join(bundleDir, "beats.jsonl"), "utf8")
    .trim().split("\n").map(l => JSON.parse(l))
  const target = selectBeats(analyzer, allBeats)

  console.log(`Bundle:     ${novel}`)
  console.log(`Analyzer:   ${analyzer}`)
  console.log(`Beats:      ${target.length} (from ${allBeats.length} total)`)
  console.log(`Concurrency: ${concurrency}\n`)

  const system = (PROMPTS as any)[analyzer]
  const results: any[] = []
  const errors: any[] = []
  let idx = 0
  let totalTokens = 0
  const t0 = Date.now()

  async function worker() {
    while (true) {
      const myIdx = idx++
      if (myIdx >= target.length) return
      const b = target[myIdx]
      const beat_id = `${b.scene_id}_b${b.beat_idx}`
      try {
        const { text, tokens } = await callDeepSeek(system, `Passage:\n\n${b.text}`)
        const out = extractJSON(text)
        results.push({ beat_id, book: b.book, chapter: b.chapter, kind: b.kind, ...out })
        totalTokens += tokens
      } catch (err) {
        errors.push({ beat_id, error: String(err) })
      }
      const done = results.length + errors.length
      if (done % 100 === 0) {
        const elapsed = (Date.now() - t0) / 1000
        const rate = done / elapsed
        const eta = (target.length - done) / rate
        console.log(`  [${done}/${target.length}] ${rate.toFixed(1)}/s, ETA ${eta.toFixed(0)}s, errors=${errors.length}`)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  const outDir = join(bundleDir, "analysis")
  const outPath = join(outDir, `${analyzer}.jsonl`)
  writeFileSync(outPath, results.map(r => JSON.stringify(r)).join("\n") + "\n")

  const report = {
    analyzer, novel,
    generated_at: new Date().toISOString(),
    model: "deepseek-chat",
    beats_processed: target.length,
    beats_failed: errors.length,
    results_written: results.length,
    total_tokens: totalTokens,
    estimated_cost_usd: (totalTokens * 0.85 / 1_000_000).toFixed(4),
    elapsed_seconds: Math.round((Date.now() - t0) / 1000),
    errors_sample: errors.slice(0, 10),
  }
  writeFileSync(join(outDir, `${analyzer}.report.json`), JSON.stringify(report, null, 2))

  console.log(`\n=== ${analyzer} complete ===`)
  console.log(`Processed: ${target.length} beats, ${errors.length} failures`)
  console.log(`Cost: $${report.estimated_cost_usd}, elapsed: ${report.elapsed_seconds}s`)
  console.log(`Output: ${outPath}`)

  // Quick distribution peek
  if (analyzer === "tension") {
    const vals = results.map(r => r.tension).filter(v => typeof v === "number")
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    console.log(`Mean tension: ${mean.toFixed(3)}`)
    const buckets: Record<string, number> = { "0.0-0.2": 0, "0.2-0.4": 0, "0.4-0.6": 0, "0.6-0.8": 0, "0.8-1.0": 0 }
    for (const v of vals) {
      if (v < 0.2) buckets["0.0-0.2"]++
      else if (v < 0.4) buckets["0.2-0.4"]++
      else if (v < 0.6) buckets["0.4-0.6"]++
      else if (v < 0.8) buckets["0.6-0.8"]++
      else buckets["0.8-1.0"]++
    }
    console.log("Distribution:", buckets)
  } else if (analyzer === "chapter-hooks") {
    const counts: Record<string, number> = {}
    for (const r of results) counts[r.hook_type] = (counts[r.hook_type] ?? 0) + 1
    console.log("Hook types:", Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1])))
  }
}

await main()
