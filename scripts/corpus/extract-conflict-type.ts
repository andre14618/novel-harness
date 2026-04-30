#!/usr/bin/env bun
/**
 * Per-chapter conflict-type taxonomy across the 3-book IWD corpus.
 *
 * For each chapter, classifies primary + secondary conflict into:
 *   internal | interpersonal | external-physical | external-cosmic
 *
 * Aggregates beat summaries (sorted by beat_idx within each scene, scenes by id),
 * passes to DeepSeek V4 Flash, post-processes rotation_signal by comparing
 * consecutive chapters within each book.
 *
 * Cost target: <$0.10 (92 chapters × ~2K input × $0.14/1M ≈ $0.03).
 *
 * Output: novels/salvatore-icewind-dale/structure-calibration/
 *           crystal_shard.<ISO>.conflict-type-taxonomy.json
 */

import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const API_KEY = process.env.DEEPSEEK_API_KEY
if (!API_KEY) {
  console.error("DEEPSEEK_API_KEY not set in env")
  process.exit(1)
}

const REPO = "/Users/andre/Desktop/personal_projects/novel-harness"
const BEATS = join(REPO, "novels/salvatore-icewind-dale/beats.jsonl")
const OUTDIR = join(REPO, "novels/salvatore-icewind-dale/structure-calibration")

interface Beat {
  scene_id: string
  beat_idx: number
  book: string
  chapter: string | number
  kind: string
  boundary_signal?: string
  first_sentence?: string
  last_sentence?: string
  summary: string
  text?: string
  words: number
}

const VALID_LABELS = new Set([
  "internal",
  "interpersonal",
  "external-physical",
  "external-cosmic",
])

const SYSTEM_PROMPT = `You classify chapter-level PRIMARY conflict in fantasy prose into exactly one of four canonical labels:

- "internal" = character vs self (doubt, guilt, decision, identity, internal struggle without an external antagonist driving the chapter)
- "interpersonal" = character vs character WITHIN a coherent group (party tension, dialogue conflict, relationship friction; NOT enemy combat)
- "external-physical" = character vs antagonist / monster / siege / environment / hazard (combat, escape, traversal, physical threat)
- "external-cosmic" = character vs metaphysical / fated / lore-defined entity (the Crystal Shard / Crenshinibon, demonic or divine force, geas, magical compulsion exerted on the chapter's outcome)

Rules:
1. PRIMARY is the conflict that DRIVES the chapter — what's at stake and what the chapter spends most narrative energy on.
2. SECONDARY is the second-strongest conflict present (must differ from primary; if no meaningful secondary, repeat primary).
3. "external-cosmic" is reserved for chapters where the metaphysical / lore-defined force is materially driving events — e.g. Crenshinibon manipulating Kessell's mind, demonic compulsion controlling action. A chapter that simply features a magical artifact in the background but is structurally a battle/heist is "external-physical".
4. "interpersonal" is for tension WITHIN ostensibly-allied groups; combat against enemies is "external-physical".
5. Confidence: float 0.0-1.0 — your subjective certainty.

Respond with EXACTLY this JSON shape, no markdown fences, no commentary:
{
  "primary_conflict": "<one of: internal | interpersonal | external-physical | external-cosmic>",
  "secondary_conflict": "<one of: internal | interpersonal | external-physical | external-cosmic>",
  "rationale": "<one sentence>",
  "confidence": <0.0-1.0>
}`

interface ChapterClassification {
  book: string
  chapter: string | number
  primary_conflict: string
  secondary_conflict: string
  rationale: string
  confidence: number
  rotation_signal?: "yes" | "no" | "first"
  _tokens?: number
  _latency_ms?: number
}

function loadBeats(): Beat[] {
  return readFileSync(BEATS, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Beat)
}

function groupByBookChapter(beats: Beat[]): Map<string, Beat[]> {
  // Key: `${book}::${chapter}` (chapter may be string for prelude/epilogue)
  const map = new Map<string, Beat[]>()
  for (const b of beats) {
    const key = `${b.book}::${b.chapter}`
    let arr = map.get(key)
    if (!arr) {
      arr = []
      map.set(key, arr)
    }
    arr.push(b)
  }
  // Sort beats within each chapter by scene_id then beat_idx
  for (const arr of map.values()) {
    arr.sort((a, b) => {
      if (a.scene_id !== b.scene_id) return a.scene_id.localeCompare(b.scene_id)
      return a.beat_idx - b.beat_idx
    })
  }
  return map
}

// Order chapters within a book: numeric chapters by number, then prelude before epilogue,
// epilogue before epilogue2 etc, parts after numeric.
function chapterSortKey(ch: string | number): [number, string] {
  const s = String(ch)
  if (s === "prelude") return [-1, ""]
  if (s.startsWith("epilogue")) return [1e6, s] // after all numeric
  if (s.startsWith("part")) return [1e7, s]
  const n = Number(s)
  if (Number.isFinite(n)) return [n, ""]
  return [1e8, s]
}

function compareChapters(a: string | number, b: string | number): number {
  const [aN, aS] = chapterSortKey(a)
  const [bN, bS] = chapterSortKey(b)
  if (aN !== bN) return aN - bN
  return aS.localeCompare(bS)
}

interface DSResp {
  text: string
  tokens: number
  latency_ms: number
  inputTokens?: number
  outputTokens?: number
}

async function callDeepSeek(system: string, user: string, attempts = 3): Promise<DSResp> {
  let lastErr: any
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const t0 = Date.now()
    try {
      const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: "deepseek-v4-flash",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: 0.0,
          max_tokens: 512,
          response_format: { type: "json_object" },
          // V4 Flash defaults to thinking-on; this is a one-shot classification so
          // we disable thinking to keep latency + cost low (3-5x speedup observed).
          thinking: { type: "disabled" },
        }),
      })
      if (!resp.ok) throw new Error(`DeepSeek ${resp.status}: ${await resp.text()}`)
      const data = (await resp.json()) as any
      return {
        text: data.choices[0].message.content,
        tokens: data.usage.total_tokens,
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        latency_ms: Date.now() - t0,
      }
    } catch (err) {
      lastErr = err
      if (attempt < attempts) {
        const wait = 1000 * attempt
        console.warn(`  retry ${attempt}/${attempts}: ${err}. Waiting ${wait}ms`)
        await new Promise((r) => setTimeout(r, wait))
      }
    }
  }
  throw lastErr
}

function buildUserPrompt(book: string, chapter: string | number, beats: Beat[]): string {
  const summaries = beats
    .map((b, i) => `${i + 1}. (${b.kind}) ${b.summary}`)
    .join("\n")
  return `Book: ${book}
Chapter: ${chapter}
Beat count: ${beats.length}

Beat summaries (in story order):
${summaries}

Classify the chapter's PRIMARY and SECONDARY conflict per the taxonomy. Respond with the specified JSON shape only.`
}

function safeParseJSON(raw: string): any {
  let s = raw.trim()
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "")
  }
  // Try direct parse first
  try {
    return JSON.parse(s)
  } catch {}
  // Try to find an object
  const start = s.indexOf("{")
  const end = s.lastIndexOf("}")
  if (start < 0 || end < start) throw new Error(`No JSON object: ${raw.slice(0, 200)}`)
  return JSON.parse(s.slice(start, end + 1))
}

function validateLabel(label: any, field: string, beat_id: string): string {
  if (typeof label !== "string") throw new Error(`${field} not a string in ${beat_id}: ${label}`)
  if (!VALID_LABELS.has(label)) throw new Error(`${field} invalid in ${beat_id}: ${label}`)
  return label
}

interface PoolItem {
  book: string
  chapter: string | number
  beats: Beat[]
}

async function classifyOne(item: PoolItem): Promise<ChapterClassification> {
  const user = buildUserPrompt(item.book, item.chapter, item.beats)
  const ds = await callDeepSeek(SYSTEM_PROMPT, user)
  const parsed = safeParseJSON(ds.text)
  const id = `${item.book}::${item.chapter}`
  const primary = validateLabel(parsed.primary_conflict, "primary_conflict", id)
  const secondary = validateLabel(parsed.secondary_conflict, "secondary_conflict", id)
  const rationale = String(parsed.rationale ?? "").slice(0, 600)
  const confidence = Number(parsed.confidence ?? 0.5)
  return {
    book: item.book,
    chapter: item.chapter,
    primary_conflict: primary,
    secondary_conflict: secondary,
    rationale,
    confidence,
    _tokens: ds.tokens,
    _latency_ms: ds.latency_ms,
  }
}

async function runPool<T>(items: T[], fn: (i: T) => Promise<ChapterClassification>, concurrency = 8): Promise<ChapterClassification[]> {
  const results: ChapterClassification[] = []
  let idx = 0
  let done = 0
  const total = items.length
  async function worker() {
    while (true) {
      const myIdx = idx++
      if (myIdx >= items.length) return
      try {
        const r = await fn(items[myIdx]!)
        results[myIdx] = r
        done++
        const tag = `${r.book}::${r.chapter}`
        process.stdout.write(`[${done}/${total}] ${tag} → ${r.primary_conflict} / ${r.secondary_conflict} (conf=${r.confidence.toFixed(2)})\n`)
      } catch (err) {
        done++
        const item: any = items[myIdx]
        process.stdout.write(`[${done}/${total}] ERROR ${item.book}::${item.chapter} — ${err}\n`)
        // Insert a placeholder so we keep array shape
        results[myIdx] = {
          book: item.book,
          chapter: item.chapter,
          primary_conflict: "internal",
          secondary_conflict: "internal",
          rationale: `ERROR: ${String(err).slice(0, 200)}`,
          confidence: 0,
        }
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

function distribution(items: string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const x of items) counts[x] = (counts[x] || 0) + 1
  const total = items.length
  const out: Record<string, number> = {}
  for (const k of Object.keys(counts).sort()) out[k] = +(counts[k]! / total).toFixed(4)
  return out
}

function rotationRate(perChapterPrimary: string[]): number {
  if (perChapterPrimary.length < 2) return 0
  let rotations = 0
  for (let i = 1; i < perChapterPrimary.length; i++) {
    if (perChapterPrimary[i] !== perChapterPrimary[i - 1]) rotations++
  }
  return +(rotations / (perChapterPrimary.length - 1)).toFixed(4)
}

async function main() {
  const beats = loadBeats()
  console.log(`Loaded ${beats.length} beats`)

  const grouped = groupByBookChapter(beats)
  console.log(`Found ${grouped.size} chapter buckets`)

  const items: PoolItem[] = []
  // Group by book, sorted in chapter order (so the per-book array we hand to rotation is correct)
  const byBook: Record<string, PoolItem[]> = {}
  for (const [key, beatArr] of grouped) {
    const [book, chapter] = key.split("::")
    if (!byBook[book!]) byBook[book!] = []
    byBook[book!]!.push({ book: book!, chapter, beats: beatArr })
  }
  for (const book of Object.keys(byBook)) {
    byBook[book]!.sort((a, b) => compareChapters(a.chapter, b.chapter))
  }

  // Flatten into a flat list for the pool (preserve per-book ordering inside)
  const bookOrder = ["crystal_shard", "streams_of_silver", "halflings_gem"]
  for (const b of bookOrder) {
    const arr = byBook[b]
    if (!arr) {
      console.error(`No beats for book ${b}`)
      process.exit(1)
    }
    items.push(...arr)
  }

  console.log(`Total chapters to classify: ${items.length}`)
  console.log(`Per-book counts: ${bookOrder.map((b) => `${b}=${byBook[b]!.length}`).join(", ")}`)

  const t0 = Date.now()
  const flatResults = await runPool(items, classifyOne, 8)
  const elapsed = (Date.now() - t0) / 1000

  // Group results back by book and sort
  const byBookResults: Record<string, ChapterClassification[]> = {}
  for (const r of flatResults) {
    if (!byBookResults[r.book]) byBookResults[r.book] = []
    byBookResults[r.book]!.push(r)
  }
  for (const b of Object.keys(byBookResults)) {
    byBookResults[b]!.sort((a, b) => compareChapters(a.chapter, b.chapter))
  }

  // Compute rotation_signal per book
  for (const b of Object.keys(byBookResults)) {
    const arr = byBookResults[b]!
    for (let i = 0; i < arr.length; i++) {
      if (i === 0) arr[i]!.rotation_signal = "first"
      else arr[i]!.rotation_signal = arr[i]!.primary_conflict !== arr[i - 1]!.primary_conflict ? "yes" : "no"
    }
  }

  // Aggregate
  const allChapters: ChapterClassification[] = []
  for (const b of bookOrder) allChapters.push(...byBookResults[b]!)

  const aggregate = {
    primary_distribution: distribution(allChapters.map((r) => r.primary_conflict)),
    secondary_distribution: distribution(allChapters.map((r) => r.secondary_conflict)),
    rotation_rate: 0,
    mean_confidence: +(
      allChapters.reduce((s, r) => s + r.confidence, 0) / allChapters.length
    ).toFixed(3),
  }
  // Rotation across the whole flat array would cross book boundaries — not meaningful.
  // Compute per-book then weighted average.
  const perBook: Record<string, any> = {}
  let weightedRotation = 0
  let totalWeight = 0
  for (const b of bookOrder) {
    const arr = byBookResults[b]!
    const primaries = arr.map((r) => r.primary_conflict)
    const rate = rotationRate(primaries)
    perBook[b] = {
      n: arr.length,
      primary_distribution: distribution(primaries),
      secondary_distribution: distribution(arr.map((r) => r.secondary_conflict)),
      rotation_rate: rate,
      mean_confidence: +(arr.reduce((s, r) => s + r.confidence, 0) / arr.length).toFixed(3),
    }
    weightedRotation += rate * (arr.length - 1)
    totalWeight += arr.length - 1
  }
  aggregate.rotation_rate = totalWeight > 0 ? +(weightedRotation / totalWeight).toFixed(4) : 0

  // Cost
  const totalTokens = flatResults.reduce((s, r) => s + (r._tokens ?? 0), 0)
  const totalLatency = flatResults.reduce((s, r) => s + (r._latency_ms ?? 0), 0) / flatResults.length

  const timestamp = new Date().toISOString()
  const stamp = timestamp.replace(/[-:.]/g, "").replace(/\.\d+Z$/, "").replace(/Z$/, "").slice(0, 15)
  const fname = `crystal_shard.${stamp}.conflict-type-taxonomy.json`
  const outpath = join(OUTDIR, fname)

  const directionalAssessment = (() => {
    const d = aggregate.primary_distribution
    const top = Object.entries(d).sort((a, b) => b[1] - a[1])[0]
    const rotation = aggregate.rotation_rate
    const perBookRotations = bookOrder.map((b) => `${b}=${(perBook[b].rotation_rate * 100).toFixed(0)}%`).join(", ")
    return `Modal primary across all 92 chapters: ${top![0]} (${(top![1] * 100).toFixed(0)}%). Cross-book rotation rate: ${(rotation * 100).toFixed(0)}% (chapter N differs from chapter N-1). Per-book rotation: ${perBookRotations}. Mean classifier confidence: ${aggregate.mean_confidence}.`
  })()

  const compareToMice = `Conflict-type taxonomy is ORTHOGONAL to mice (M=Milieu, I=Idea, C=Character, E=Event). Mice asks "what thread is being opened/closed", conflict-type asks "what kind of opposition drives the chapter". Mapping: external-physical and external-cosmic both partially overlap mice-E (event-thread). Internal partially overlaps mice-C (character-thread). Interpersonal cuts across both C and E. They do NOT collapse cleanly — conflict-type is a complementary axis, not a coarsening of mice.`

  const out = {
    timestamp,
    n_chapters: allChapters.length,
    aggregate,
    perBook,
    chapters: allChapters.map((r) => ({
      book: r.book,
      chapter: r.chapter,
      primary_conflict: r.primary_conflict,
      secondary_conflict: r.secondary_conflict,
      rationale: r.rationale,
      confidence: r.confidence,
      rotation_signal: r.rotation_signal,
    })),
    directional_assessment: directionalAssessment,
    compare_to_mice: compareToMice,
    cost_telemetry: {
      total_tokens: totalTokens,
      // DeepSeek V4 Flash: $0.14 input, $0.28 output per 1M (approx blended at 0.85% input ratio)
      // We don't break input/output here; conservative blend at $0.20/1M
      estimated_cost_usd: +(totalTokens * 0.20 / 1_000_000).toFixed(4),
      mean_latency_ms: Math.round(totalLatency),
      wall_clock_seconds: Math.round(elapsed),
    },
    methodology: "Beat summaries (sorted by scene_id then beat_idx) per chapter, passed to DeepSeek V4 Flash with strict JSON schema. rotation_signal computed post-hoc by comparing primary_conflict at chapter N vs N-1 within each book.",
  }

  writeFileSync(outpath, JSON.stringify(out, null, 2))
  console.log(`\nWrote ${outpath}`)
  console.log(`\nAggregate:`)
  console.log(`  primary distribution: ${JSON.stringify(aggregate.primary_distribution)}`)
  console.log(`  rotation rate (cross-book weighted): ${aggregate.rotation_rate}`)
  console.log(`  mean confidence: ${aggregate.mean_confidence}`)
  console.log(`  cost: $${out.cost_telemetry.estimated_cost_usd} (${totalTokens} tokens)`)
  console.log(`  wall clock: ${Math.round(elapsed)}s`)
}

await main()
