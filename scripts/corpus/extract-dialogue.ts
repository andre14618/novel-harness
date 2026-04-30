#!/usr/bin/env bun
/**
 * Programmatic dialogue extraction via DeepSeek V3.2.
 *
 * Processes every beat in a novel bundle, attributes quoted dialogue
 * to target characters (from the bundle's config.yml character registry),
 * writes results to `novels/<key>/analysis/dialogue-extract.jsonl`.
 *
 * Replaces the Sonnet-subagent approach for corpus-wide runs. Same
 * extraction prompt, validated 100% attribution agreement with Sonnet on
 * a 10-beat head-to-head (see scripts/corpus/test-deepseek-dialogue.ts).
 *
 * Usage:
 *   bun scripts/corpus/extract-dialogue.ts --novel salvatore-icewind-dale
 *   bun scripts/corpus/extract-dialogue.ts --novel salvatore-icewind-dale --concurrency 12
 */

import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { parse as parseYaml } from "yaml"

const API_KEY = process.env.DEEPSEEK_API_KEY
if (!API_KEY) { console.error("DEEPSEEK_API_KEY not set"); process.exit(1) }

const REPO_ROOT = new URL("../..", import.meta.url).pathname

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback
}

interface Character {
  name: string
  aliases?: string[]
  role?: string
  archetype?: string
  pov?: boolean
}

interface Beat {
  scene_id: string
  beat_idx: number
  book: string
  chapter: string | number
  kind: string
  words: number
  text: string
}

interface DialogueLine {
  char: string
  quote: string
  beat_id: string
  attribution_method: "named" | "role" | "flow" | "pronoun"
}

function buildSystemPrompt(bundleKey: string, targets: Character[]): string {
  const targetNames = targets.map(c => c.name).join(", ")
  const roleMap = targets
    .filter(c => (c.aliases ?? []).length > 1)
    .map(c => {
      const roleAliases = (c.aliases ?? []).filter(a => a.toLowerCase().startsWith("the "))
      if (roleAliases.length === 0) return null
      return `  ${roleAliases.map(a => `"${a}"`).join(" / ")} → ${c.name}`
    })
    .filter(Boolean)
    .join("\n")

  return `You extract dialogue lines from fantasy prose with character attribution. Precision matters more than recall — when in doubt, DROP the line.

TARGETS (use these exact canonical spellings):
  ${targetNames}

Role-description attribution MAP (these ARE named attribution):
${roleMap}

Attribution rules:
  (a) Named attribution (explicit name OR role-description from map) → ALWAYS WORKS, regardless of how many target characters are in the beat
  (b) Flow attribution — a sentence clearly describes ONE target character acting/speaking, then emits a quote → HIGH confidence
  (c) Pronoun attribution — pronoun's referent is unambiguous in the immediately preceding sentence AND only one target character is in the beat's characters list → HIGH
  (d) Anything ambiguous → SKIP

Quality filters — SKIP:
  - Quotes under 3 words
  - Quotes over 50 words
  - Song lyrics, prayers, written letters, inscriptions, narration inside quotes
  - Speakers not in the TARGETS list

Emit ONLY a JSON array. Each object: {"char": "...", "quote": "...", "beat_id": "...", "attribution_method": "named" | "role" | "flow" | "pronoun"}.

If no dialogue attributable to TARGETS, emit [].

Return ONLY the JSON array — no commentary, no markdown fences.`
}

function buildUserPrompt(beat: Beat): string {
  const beat_id = `${beat.scene_id}_b${beat.beat_idx}`
  return `Beat ${beat_id} (${beat.words}w, kind=${beat.kind}):

${beat.text}

Extract dialogue lines attributed to TARGET characters. Return ONLY a JSON array.`
}

async function callDeepSeek(
  system: string, user: string, retries = 2,
): Promise<{ text: string; tokens: number; latency_ms: number }> {
  const t0 = Date.now()
  let lastErr: any
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: "deepseek-v4-flash",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.1,
          max_tokens: 1024,
        }),
      })
      if (!resp.ok) {
        const body = await resp.text()
        if (resp.status === 429 || resp.status >= 500) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          lastErr = new Error(`${resp.status}: ${body.slice(0, 200)}`)
          continue
        }
        throw new Error(`DeepSeek ${resp.status}: ${body.slice(0, 200)}`)
      }
      const data = await resp.json() as any
      return {
        text: data.choices[0].message.content,
        tokens: data.usage.total_tokens,
        latency_ms: Date.now() - t0,
      }
    } catch (err) {
      lastErr = err
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
      }
    }
  }
  throw lastErr
}

function extractJSON(raw: string): DialogueLine[] {
  let s = raw.trim()
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "")
  }
  const startIdx = s.indexOf("[")
  const endIdx = s.lastIndexOf("]")
  if (startIdx < 0 || endIdx < startIdx) {
    if (s.trim() === "[]" || s.trim() === "") return []
    throw new Error(`No JSON array in: ${s.slice(0, 150)}`)
  }
  return JSON.parse(s.slice(startIdx, endIdx + 1))
}

async function processBeatWithBudget(
  beat: Beat, system: string, stats: Stats,
): Promise<DialogueLine[]> {
  const beat_id = `${beat.scene_id}_b${beat.beat_idx}`
  try {
    const { text, tokens, latency_ms } = await callDeepSeek(system, buildUserPrompt(beat))
    const lines = extractJSON(text)
    stats.completed++
    stats.totalTokens += tokens
    stats.totalLatency += latency_ms
    stats.linesByBeat[beat_id] = lines.length
    // Tag each line with the canonical beat_id (model may use scene-level id)
    return lines.map(l => ({ ...l, beat_id }))
  } catch (err) {
    stats.failed++
    stats.errors.push({ beat_id, error: String(err) })
    return []
  }
}

interface Stats {
  completed: number
  failed: number
  totalTokens: number
  totalLatency: number
  errors: { beat_id: string; error: string }[]
  linesByBeat: Record<string, number>
}

async function main() {
  const novelKey = arg("--novel")
  if (!novelKey) { console.error("--novel <key> required"); process.exit(1) }
  const concurrency = parseInt(arg("--concurrency", "10") ?? "10", 10)

  const bundleDir = join(REPO_ROOT, "novels", novelKey)
  if (!existsSync(bundleDir)) { console.error(`bundle not found: ${bundleDir}`); process.exit(1) }

  // Load config + beats
  const config = parseYaml(readFileSync(join(bundleDir, "config.yml"), "utf8"))
  const characters: Character[] = config.characters ?? []
  const targets = characters.filter(c => c.pov) // POV characters are the dialogue targets
  if (targets.length === 0) {
    console.error("No POV characters in config — nothing to extract")
    process.exit(1)
  }
  const beats: Beat[] = readFileSync(join(bundleDir, "beats.jsonl"), "utf8")
    .trim().split("\n").map(l => JSON.parse(l))

  console.log(`Bundle:     ${novelKey}`)
  console.log(`Beats:      ${beats.length}`)
  console.log(`Targets:    ${targets.map(c => c.name).join(", ")}`)
  console.log(`Concurrency: ${concurrency}`)
  console.log()

  const system = buildSystemPrompt(novelKey, targets)
  const stats: Stats = {
    completed: 0, failed: 0, totalTokens: 0, totalLatency: 0,
    errors: [], linesByBeat: {},
  }

  // Concurrent queue with bounded parallelism
  const allLines: DialogueLine[] = []
  let idx = 0
  const t0 = Date.now()

  async function worker() {
    while (true) {
      const myIdx = idx++
      if (myIdx >= beats.length) return
      const beat = beats[myIdx]
      const lines = await processBeatWithBudget(beat, system, stats)
      allLines.push(...lines)
      if ((stats.completed + stats.failed) % 50 === 0) {
        const elapsed = (Date.now() - t0) / 1000
        const rate = (stats.completed + stats.failed) / elapsed
        const eta = (beats.length - stats.completed - stats.failed) / rate
        console.log(`  [${stats.completed + stats.failed}/${beats.length}] ` +
          `${rate.toFixed(1)}/s, ETA ${eta.toFixed(0)}s, ` +
          `lines=${allLines.length}, failed=${stats.failed}`)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  // Write output
  const outDir = join(bundleDir, "analysis")
  const outPath = join(outDir, "dialogue-extract.jsonl")
  writeFileSync(outPath, allLines.map(l => JSON.stringify(l)).join("\n") + "\n")

  // Per-character counts
  const byChar: Record<string, number> = {}
  for (const l of allLines) byChar[l.char] = (byChar[l.char] ?? 0) + 1

  // Report
  const report = {
    novel: novelKey,
    generated_at: new Date().toISOString(),
    model: "deepseek-v4-flash",
    beats_processed: beats.length,
    beats_failed: stats.failed,
    lines_extracted: allLines.length,
    by_character: byChar,
    attribution_method_counts: allLines.reduce((acc, l) => {
      acc[l.attribution_method] = (acc[l.attribution_method] ?? 0) + 1
      return acc
    }, {} as Record<string, number>),
    total_tokens: stats.totalTokens,
    estimated_cost_usd: (stats.totalTokens * 0.85 / 1_000_000).toFixed(4),
    mean_latency_ms: Math.round(stats.totalLatency / Math.max(1, stats.completed)),
    elapsed_seconds: Math.round((Date.now() - t0) / 1000),
    errors_sample: stats.errors.slice(0, 10),
  }
  writeFileSync(join(outDir, "dialogue-extract.report.json"), JSON.stringify(report, null, 2))

  console.log()
  console.log(`=== Complete ===`)
  console.log(`Beats: ${beats.length} processed, ${stats.failed} failed`)
  console.log(`Lines extracted: ${allLines.length}`)
  console.log(`Per character:`)
  for (const [c, n] of Object.entries(byChar).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c}: ${n}`)
  }
  console.log(`Cost: $${report.estimated_cost_usd} (${stats.totalTokens} tokens)`)
  console.log(`Elapsed: ${report.elapsed_seconds}s`)
  console.log(`Output: ${outPath}`)
  console.log(`Report: ${join(outDir, "dialogue-extract.report.json")}`)
}

await main()
