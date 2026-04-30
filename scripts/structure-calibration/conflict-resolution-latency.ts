// Pattern 33 — Conflict resolution latency (P18 follow-up).
//
// For each adjacent chapter pair (N, N+1) within each book where
// primary_conflict_N != primary_conflict_{N+1}, characterize whether the
// chapter-N conflict was resolved / transitioned / paused at the boundary.
//
// Methodology (binary-collapse-aware, calibration-gated, per the
// 2026-04-30 binary-collapse SOP):
//
//   1. Bind the labeling task to a 3-way tag {resolved, transitioned, paused}.
//      If calibration Jaccard < 0.7, fall back to binary {resolved: y/n}.
//      If still < 0.7, STOP and emit a methodological negative result.
//
//   2. Calibration: sample n=10 random rotation pairs (rotation = chapters
//      where primary_conflict differs from prior chapter, taken from the P18
//      taxonomy). Run DeepSeek V4 Flash twice (temperature 0, two independent
//      API calls). Compute Jaccard agreement on the categorical label.
//
//   3. Full pass: ~50-60 LLM calls (rotation pairs only — same-conflict pairs
//      are skipped because there is no boundary to characterize).
//
// Inputs to each LLM call:
//   - last 3 beats of chapter N (most recent prose-level signal of how the
//     chapter-N conflict landed at its end)
//   - first 2 beats of chapter N+1 (signal of how the prior conflict re-shows
//     up, or doesn't, in the new chapter's opening)
//
// Output:
//   - Timestamped JSON: novels/salvatore-icewind-dale/structure-calibration/
//                       crystal_shard.<TS>.conflict-resolution-latency.json
//   - Conclusions appended to crystal_shard-conclusions.md (append-only)

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// ----- types -----------------------------------------------------------------

type Beat = {
  beat_idx: number
  words: number
  kind: string
  boundary_signal?: string
  summary: string
  first_sentence?: string
  last_sentence?: string
  text?: string
  scene_id: string
  book: string
  chapter: number | string
}

type ChapterEntry = {
  book: string
  chapter: number | string
  primary_conflict: string
  secondary_conflict: string
  rationale: string
  confidence: number
  rotation_signal: "yes" | "no" | "first"
}

type P18File = {
  timestamp: string
  n_chapters: number
  chapters: ChapterEntry[]
}

type Pair = {
  book: string
  chN_id: string | number
  chN1_id: string | number
  primary_conflict_N: string
  primary_conflict_N1: string
  // chapter-N tail beats (last 3, in story order)
  tailBeats: Beat[]
  // chapter-N+1 head beats (first 2, in story order)
  headBeats: Beat[]
}

// ----- chapter ordering helpers ---------------------------------------------

const SPECIAL_ORDER: Record<string, number> = {
  prelude: -1,
  epilogue: 1000,
  epilogue2: 1001,
  epilogue3: 1002,
  part1: 100,
  part2: 200,
  part3: 300,
}

function chapterSortKey(c: number | string): number {
  if (typeof c === "number") return c
  const s = String(c)
  if (s in SPECIAL_ORDER) return SPECIAL_ORDER[s]!
  const n = Number(s)
  if (Number.isFinite(n)) return n
  return 9999
}

function sortBeatsInChapter(beats: Beat[]): Beat[] {
  return [...beats].sort((a, b) => {
    if (a.scene_id !== b.scene_id) return a.scene_id.localeCompare(b.scene_id)
    return a.beat_idx - b.beat_idx
  })
}

// ----- load data -------------------------------------------------------------

const ROOT = "/Users/andre/Desktop/personal_projects/novel-harness"
const BEATS_PATH = join(ROOT, "novels/salvatore-icewind-dale/beats.jsonl")
const P18_PATH = join(
  ROOT,
  "novels/salvatore-icewind-dale/structure-calibration/crystal_shard.20260430T115702.conflict-type-taxonomy.json",
)
const OUT_DIR = join(ROOT, "novels/salvatore-icewind-dale/structure-calibration")
const CONCLUSIONS_PATH = join(OUT_DIR, "crystal_shard-conclusions.md")

function loadBeats(): Map<string, Beat[]> {
  const lines = readFileSync(BEATS_PATH, "utf8").trim().split("\n")
  const byKey = new Map<string, Beat[]>()
  for (const line of lines) {
    const r = JSON.parse(line) as Beat
    const k = `${r.book}|${r.chapter}`
    let arr = byKey.get(k)
    if (!arr) {
      arr = []
      byKey.set(k, arr)
    }
    arr.push(r)
  }
  for (const [k, arr] of byKey) {
    byKey.set(k, sortBeatsInChapter(arr))
  }
  return byKey
}

function loadP18(): ChapterEntry[] {
  const data = JSON.parse(readFileSync(P18_PATH, "utf8")) as P18File
  return data.chapters
}

// ----- pair builder ----------------------------------------------------------

function buildAdjacentPairs(p18: ChapterEntry[], beats: Map<string, Beat[]>): Pair[] {
  // Group by book, sort by chapter sort key
  const byBook = new Map<string, ChapterEntry[]>()
  for (const ch of p18) {
    let arr = byBook.get(ch.book)
    if (!arr) {
      arr = []
      byBook.set(ch.book, arr)
    }
    arr.push(ch)
  }
  for (const arr of byBook.values()) {
    arr.sort((a, b) => chapterSortKey(a.chapter) - chapterSortKey(b.chapter))
  }

  const pairs: Pair[] = []
  for (const [book, arr] of byBook) {
    for (let i = 0; i < arr.length - 1; i++) {
      const chN = arr[i]!
      const chN1 = arr[i + 1]!
      // Skip same-conflict pairs (no boundary to characterize)
      if (chN.primary_conflict === chN1.primary_conflict) continue
      const beatsN = beats.get(`${book}|${chN.chapter}`)
      const beatsN1 = beats.get(`${book}|${chN1.chapter}`)
      if (!beatsN || !beatsN1) {
        console.warn(`missing beats for ${book}|${chN.chapter} or ${book}|${chN1.chapter}`)
        continue
      }
      pairs.push({
        book,
        chN_id: chN.chapter,
        chN1_id: chN1.chapter,
        primary_conflict_N: chN.primary_conflict,
        primary_conflict_N1: chN1.primary_conflict,
        tailBeats: beatsN.slice(-3),
        headBeats: beatsN1.slice(0, 2),
      })
    }
  }
  return pairs
}

// ----- prompt + LLM call -----------------------------------------------------

const SYSTEM_PROMPT_3WAY = `You characterize how a chapter-level PRIMARY CONFLICT LANDS at the boundary between two chapters in fantasy prose. Pick exactly one of three labels:

- "resolved" = the chapter-N primary conflict CLOSED at the chapter break. Its driving question got an answer (the antagonist defeated, the choice made, the threat repelled, the metaphysical force banished, the relationship shift consummated). It does not need to be permanently solved — only that this chapter's instance of it reached a definite landing.
- "transitioned" = the chapter-N primary conflict MORPHED into a different surface in chapter N+1. The same underlying antagonism is still active, but takes a new shape (e.g., a battle conflict ends and immediately becomes a political negotiation between the same parties; an internal struggle externalizes into an interpersonal confrontation; one cosmic force is replaced by another with the same arc role).
- "paused" = the chapter-N primary conflict went OFF-STAGE at the chapter break. It is neither resolved nor reshaped — it is simply not in chapter N+1's foreground (the narrative cuts to a different POV, subplot, or thread, with the prior conflict implicitly waiting). The reader expects it will return.

Decision rules:
1. If the conflict is functionally CLOSED (defeat, decision made, choice consummated), label "resolved" even if the same characters keep showing up — the SPECIFIC conflict is over.
2. If the same characters/forces are still actively opposing each other but the SHAPE of the antagonism changed (combat → diplomacy, internal → interpersonal), label "transitioned".
3. If the chapter break feels like a POV cut or thread switch and the prior conflict is simply absent from the next chapter's opening, label "paused".
4. Resolved is reserved for genuine closure. Transitioned is the default for ongoing threads with a new surface. Paused is for genuine off-stage narrative cuts.

Output JSON only (no markdown, no commentary):
{ "label": "resolved" | "transitioned" | "paused", "confidence": "high" | "medium" | "low", "reason": "<one short clause, <=200 chars>" }`

const SYSTEM_PROMPT_BINARY = `You characterize whether a chapter-level PRIMARY CONFLICT was RESOLVED at the boundary between two chapters in fantasy prose. Pick exactly one of two labels:

- true (resolved) = the chapter-N primary conflict CLOSED at the chapter break. Its driving question got an answer (the antagonist defeated, the choice made, the threat repelled, the metaphysical force banished, the relationship shift consummated). It does not need to be permanently solved — only that this chapter's instance of it reached a definite landing.
- false (not resolved) = the chapter-N primary conflict did NOT close. It either continued in a different shape, went off-stage, or remains unresolved as the next chapter begins.

Output JSON only (no markdown, no commentary):
{ "resolved": true | false, "confidence": "high" | "medium" | "low", "reason": "<one short clause, <=200 chars>" }`

type ThreeLabel = "resolved" | "transitioned" | "paused"

type LlmLabel3 = { label: ThreeLabel; confidence: "high" | "medium" | "low"; reason: string }
type LlmLabelBin = { resolved: boolean; confidence: "high" | "medium" | "low"; reason: string }

const USAGE = { prompt: 0, completion: 0, calls: 0 }

function buildUserPrompt(pair: Pair): string {
  const conflictLabel = (c: string) => c.replace(/-/g, " ")
  const tailBlock = pair.tailBeats
    .map(
      (b, i) =>
        `[chapter ${pair.chN_id} tail beat ${i + 1}/${pair.tailBeats.length}, beat_idx=${b.beat_idx}, kind=${b.kind}]\nsummary: ${b.summary}\nlast_sentence: ${b.last_sentence ?? ""}`,
    )
    .join("\n\n")
  const headBlock = pair.headBeats
    .map(
      (b, i) =>
        `[chapter ${pair.chN1_id} head beat ${i + 1}/${pair.headBeats.length}, beat_idx=${b.beat_idx}, kind=${b.kind}]\nsummary: ${b.summary}\nfirst_sentence: ${b.first_sentence ?? ""}`,
    )
    .join("\n\n")
  return `BOOK: ${pair.book}
CHAPTER N: ${pair.chN_id} (primary_conflict: ${conflictLabel(pair.primary_conflict_N)})
CHAPTER N+1: ${pair.chN1_id} (primary_conflict: ${conflictLabel(pair.primary_conflict_N1)})

CHAPTER N (LAST 3 BEATS, in story order):

${tailBlock}

CHAPTER N+1 (FIRST 2 BEATS, in story order):

${headBlock}

---
Question: How did the chapter-${pair.chN_id} primary conflict ("${conflictLabel(pair.primary_conflict_N)}") land at the boundary? Respond JSON only.`
}

async function callDeepSeek3Way(pair: Pair, key: string): Promise<LlmLabel3> {
  const userPrompt = buildUserPrompt(pair)
  const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT_3WAY },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    }),
  })
  if (!r.ok) throw new Error(`DeepSeek HTTP ${r.status}: ${await r.text()}`)
  const j = (await r.json()) as any
  if (j.usage) {
    USAGE.prompt += j.usage.prompt_tokens || 0
    USAGE.completion += j.usage.completion_tokens || 0
  }
  USAGE.calls += 1
  const raw = (j.choices?.[0]?.message?.content ?? "").trim()
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`DeepSeek non-JSON: ${raw.slice(0, 200)}`)
  }
  const lbl = parsed.label
  if (lbl !== "resolved" && lbl !== "transitioned" && lbl !== "paused") {
    throw new Error(`label invalid: ${JSON.stringify(parsed).slice(0, 200)}`)
  }
  const conf =
    parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
      ? parsed.confidence
      : "medium"
  return {
    label: lbl,
    confidence: conf,
    reason: String(parsed.reason || "").slice(0, 280),
  }
}

async function callDeepSeekBinary(pair: Pair, key: string): Promise<LlmLabelBin> {
  const userPrompt = buildUserPrompt(pair)
  const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT_BINARY },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    }),
  })
  if (!r.ok) throw new Error(`DeepSeek HTTP ${r.status}: ${await r.text()}`)
  const j = (await r.json()) as any
  if (j.usage) {
    USAGE.prompt += j.usage.prompt_tokens || 0
    USAGE.completion += j.usage.completion_tokens || 0
  }
  USAGE.calls += 1
  const raw = (j.choices?.[0]?.message?.content ?? "").trim()
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`DeepSeek non-JSON: ${raw.slice(0, 200)}`)
  }
  if (typeof parsed.resolved !== "boolean") {
    throw new Error(`resolved not boolean: ${JSON.stringify(parsed).slice(0, 200)}`)
  }
  const conf =
    parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
      ? parsed.confidence
      : "medium"
  return {
    resolved: parsed.resolved,
    confidence: conf,
    reason: String(parsed.reason || "").slice(0, 280),
  }
}

// ----- bounded-parallel runner -----------------------------------------------

async function labelPairs3<T extends Pair>(
  pairs: T[],
  key: string,
  concurrency = 6,
): Promise<Map<string, LlmLabel3>> {
  const out = new Map<string, LlmLabel3>()
  const queue = pairs.slice()
  let done = 0
  async function worker() {
    while (queue.length > 0) {
      const p = queue.shift()
      if (!p) return
      const k = `${p.book}|${p.chN_id}->${p.chN1_id}`
      try {
        const lbl = await callDeepSeek3Way(p, key)
        out.set(k, lbl)
      } catch (err) {
        console.error(`LLM error on ${k}: ${(err as Error).message.slice(0, 200)}`)
        out.set(k, { label: "paused", confidence: "low", reason: `LLM error: ${(err as Error).message.slice(0, 120)}` })
      }
      done += 1
      if (done % 5 === 0) console.log(`  3-way progress: ${done}/${pairs.length}`)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return out
}

async function labelPairsBinary<T extends Pair>(
  pairs: T[],
  key: string,
  concurrency = 6,
): Promise<Map<string, LlmLabelBin>> {
  const out = new Map<string, LlmLabelBin>()
  const queue = pairs.slice()
  let done = 0
  async function worker() {
    while (queue.length > 0) {
      const p = queue.shift()
      if (!p) return
      const k = `${p.book}|${p.chN_id}->${p.chN1_id}`
      try {
        const lbl = await callDeepSeekBinary(p, key)
        out.set(k, lbl)
      } catch (err) {
        console.error(`LLM error on ${k}: ${(err as Error).message.slice(0, 200)}`)
        out.set(k, { resolved: false, confidence: "low", reason: `LLM error: ${(err as Error).message.slice(0, 120)}` })
      }
      done += 1
      if (done % 5 === 0) console.log(`  binary progress: ${done}/${pairs.length}`)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return out
}

// ----- Jaccard ---------------------------------------------------------------

// For 3-way labels: macro Jaccard = mean over labels of (intersection / union).
function jaccard3Way(
  run1: Map<string, LlmLabel3>,
  run2: Map<string, LlmLabel3>,
): { agree: number; n: number; agreeRate: number; jaccardMacro: number; perLabel: Record<string, { intersect: number; union: number; jaccard: number }>; classes: any } {
  const keys = new Set([...run1.keys(), ...run2.keys()])
  let agree = 0
  const labels: ThreeLabel[] = ["resolved", "transitioned", "paused"]
  const perLabel: Record<string, { intersect: number; union: number; jaccard: number }> = {}
  const classes: any = {}
  for (const lbl of labels) {
    let intersect = 0
    let union = 0
    let r1Count = 0
    let r2Count = 0
    for (const k of keys) {
      const a = run1.get(k)?.label
      const b = run2.get(k)?.label
      if (a === lbl) r1Count += 1
      if (b === lbl) r2Count += 1
      if (a === lbl && b === lbl) intersect += 1
      if (a === lbl || b === lbl) union += 1
    }
    perLabel[lbl] = {
      intersect,
      union,
      jaccard: union === 0 ? 1.0 : intersect / union,
    }
    classes[lbl] = { run1: r1Count, run2: r2Count }
  }
  for (const k of keys) {
    if (run1.get(k)?.label === run2.get(k)?.label) agree += 1
  }
  const macro =
    Object.values(perLabel).reduce((acc, v) => acc + v.jaccard, 0) / labels.length
  return {
    agree,
    n: keys.size,
    agreeRate: keys.size === 0 ? 0 : agree / keys.size,
    jaccardMacro: macro,
    perLabel,
    classes,
  }
}

function jaccardBinary(
  run1: Map<string, LlmLabelBin>,
  run2: Map<string, LlmLabelBin>,
): { agree: number; n: number; agreeRate: number; jaccard: number; classes: any } {
  const keys = new Set([...run1.keys(), ...run2.keys()])
  let agree = 0
  let intersectTrue = 0
  let unionTrue = 0
  let r1True = 0
  let r2True = 0
  for (const k of keys) {
    const a = run1.get(k)?.resolved
    const b = run2.get(k)?.resolved
    if (a === b) agree += 1
    if (a === true) r1True += 1
    if (b === true) r2True += 1
    if (a === true && b === true) intersectTrue += 1
    if (a === true || b === true) unionTrue += 1
  }
  const n = keys.size
  return {
    agree,
    n,
    agreeRate: n === 0 ? 0 : agree / n,
    jaccard: unionTrue === 0 ? 1.0 : intersectTrue / unionTrue,
    classes: {
      true: { run1: r1True, run2: r2True },
      false: { run1: n - r1True, run2: n - r2True },
    },
  }
}

// ----- sampling --------------------------------------------------------------

// Deterministic-ish sample: take n=10 evenly-distributed pairs across all books.
function sampleForCalibration(pairs: Pair[], n = 10): Pair[] {
  if (pairs.length <= n) return pairs.slice()
  // Stratify by book: take roughly n/3 from each book, evenly spaced.
  const byBook = new Map<string, Pair[]>()
  for (const p of pairs) {
    let arr = byBook.get(p.book)
    if (!arr) {
      arr = []
      byBook.set(p.book, arr)
    }
    arr.push(p)
  }
  const sample: Pair[] = []
  const books = ["crystal_shard", "streams_of_silver", "halflings_gem"]
  // Distribute n across books proportional to count, min 3 each if possible
  const totals = books.map((b) => byBook.get(b)?.length ?? 0)
  const totalSum = totals.reduce((a, b) => a + b, 0)
  const allocs = books.map((_, i) => Math.max(1, Math.round((n * totals[i]!) / totalSum)))
  // Adjust to sum to n
  let sumAlloc = allocs.reduce((a, b) => a + b, 0)
  while (sumAlloc > n) {
    const idx = allocs.indexOf(Math.max(...allocs))
    allocs[idx] -= 1
    sumAlloc -= 1
  }
  while (sumAlloc < n) {
    const idx = allocs.indexOf(Math.min(...allocs))
    allocs[idx] += 1
    sumAlloc += 1
  }
  for (let bi = 0; bi < books.length; bi++) {
    const arr = byBook.get(books[bi]!) ?? []
    const take = Math.min(allocs[bi]!, arr.length)
    if (take === 0) continue
    const step = arr.length / take
    const seen = new Set<number>()
    for (let i = 0; i < take; i++) {
      const idx = Math.min(arr.length - 1, Math.floor(i * step))
      if (seen.has(idx)) continue
      seen.add(idx)
      sample.push(arr[idx]!)
    }
  }
  return sample
}

// ----- main ------------------------------------------------------------------

function tsStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  )
}

function estCostUSD(promptTok: number, completionTok: number): number {
  const inUSD = (promptTok / 1_000_000) * 0.14
  const outUSD = (completionTok / 1_000_000) * 0.28
  return Math.round((inUSD + outUSD) * 10000) / 10000
}

function distribution3(items: ThreeLabel[]): Record<ThreeLabel, number> {
  const counts: Record<string, number> = { resolved: 0, transitioned: 0, paused: 0 }
  for (const x of items) counts[x] = (counts[x] || 0) + 1
  const total = items.length
  const out: any = {}
  for (const k of ["resolved", "transitioned", "paused"]) {
    out[k] = total === 0 ? 0 : Math.round((counts[k]! / total) * 10000) / 10000
  }
  return out as Record<ThreeLabel, number>
}

async function main() {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw new Error("DEEPSEEK_API_KEY not set in env")

  const beats = loadBeats()
  console.log(`loaded beats for ${beats.size} chapter buckets`)
  const p18 = loadP18()
  console.log(`loaded P18: ${p18.length} chapters`)

  const allPairs = buildAdjacentPairs(p18, beats)
  console.log(`adjacent rotation pairs (primary_conflict differs): ${allPairs.length}`)
  const perBookRotationPairs: Record<string, number> = {}
  for (const p of allPairs) {
    perBookRotationPairs[p.book] = (perBookRotationPairs[p.book] || 0) + 1
  }
  console.log(`  per book: ${JSON.stringify(perBookRotationPairs)}`)

  // ----- CALIBRATION (3-way) -----
  console.log("\n=== Calibration phase: n=10 pairs, 3-way labels, 2 runs ===")
  const calibPairs = sampleForCalibration(allPairs, 10)
  console.log(`calibration pairs: ${calibPairs.length}`)
  for (const p of calibPairs) {
    console.log(`  ${p.book}|${p.chN_id}->${p.chN1_id} (${p.primary_conflict_N} → ${p.primary_conflict_N1})`)
  }

  console.log("calibration 3-way run 1...")
  const run1_3way = await labelPairs3(calibPairs, key, 6)
  console.log("calibration 3-way run 2...")
  const run2_3way = await labelPairs3(calibPairs, key, 6)

  const jac3 = jaccard3Way(run1_3way, run2_3way)
  console.log(
    `3-way calibration: agree ${jac3.agree}/${jac3.n} (${(jac3.agreeRate * 100).toFixed(1)}%), Jaccard-macro=${jac3.jaccardMacro.toFixed(3)}`,
  )
  console.log(`  per-label Jaccard: ${JSON.stringify(jac3.perLabel)}`)

  const calibTokens3 = { prompt: USAGE.prompt, completion: USAGE.completion, calls: USAGE.calls }
  const calibCostUSD3 = estCostUSD(calibTokens3.prompt, calibTokens3.completion)
  console.log(`calibration cost so far: $${calibCostUSD3}`)

  let mode: "3way" | "binary" | "fail" = jac3.jaccardMacro >= 0.7 ? "3way" : "fail"
  let binaryCalib: any = null
  let run1_bin: Map<string, LlmLabelBin> | null = null
  let run2_bin: Map<string, LlmLabelBin> | null = null
  if (mode === "fail") {
    // Binary fallback
    console.log("\n3-way calibration failed; falling back to binary {resolved: y/n}...")
    console.log("calibration binary run 1...")
    run1_bin = await labelPairsBinary(calibPairs, key, 6)
    console.log("calibration binary run 2...")
    run2_bin = await labelPairsBinary(calibPairs, key, 6)
    const jacB = jaccardBinary(run1_bin, run2_bin)
    console.log(
      `binary calibration: agree ${jacB.agree}/${jacB.n} (${(jacB.agreeRate * 100).toFixed(1)}%), Jaccard=${jacB.jaccard.toFixed(3)}`,
    )
    binaryCalib = jacB
    mode = jacB.jaccard >= 0.7 ? "binary" : "fail"
  }

  const ts = tsStamp()
  const isoTs = new Date().toISOString()
  const outPath = join(OUT_DIR, `crystal_shard.${ts}.conflict-resolution-latency.json`)

  const calibPayload3 = {
    sampleSize: calibPairs.length,
    sampleKeys: calibPairs.map((p) => `${p.book}|${p.chN_id}->${p.chN1_id}`),
    jaccardMacro: jac3.jaccardMacro,
    perLabelJaccard: jac3.perLabel,
    agreeRate: jac3.agreeRate,
    classes: jac3.classes,
    threshold: 0.7,
    verdict3way: jac3.jaccardMacro >= 0.7 ? "PASS" : "FAIL",
    run1: Object.fromEntries(run1_3way),
    run2: Object.fromEntries(run2_3way),
    tokens: calibTokens3,
    estCostUSD: calibCostUSD3,
  }

  const calibPayloadBinary = binaryCalib
    ? {
        jaccard: binaryCalib.jaccard,
        agreeRate: binaryCalib.agreeRate,
        classes: binaryCalib.classes,
        threshold: 0.7,
        verdictBinary: binaryCalib.jaccard >= 0.7 ? "PASS" : "FAIL",
        run1: run1_bin ? Object.fromEntries(run1_bin) : null,
        run2: run2_bin ? Object.fromEntries(run2_bin) : null,
      }
    : null

  if (mode === "fail") {
    const totalTokens = { prompt: USAGE.prompt, completion: USAGE.completion, calls: USAGE.calls }
    const totalCost = estCostUSD(totalTokens.prompt, totalTokens.completion)
    const failPayload = {
      pattern: "33",
      name: "Conflict resolution latency (P18 follow-up)",
      timestamp: isoTs,
      stage: "calibration_failed",
      reason: `3-way Jaccard ${jac3.jaccardMacro.toFixed(3)} < 0.7 AND binary fallback Jaccard ${binaryCalib?.jaccard.toFixed(3) ?? "n/a"} < 0.7; latency labeling is too unstable to ship`,
      calibration_3way: calibPayload3,
      calibration_binary: calibPayloadBinary,
      total_tokens: totalTokens,
      total_cost_usd: totalCost,
      method: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        thinking: "disabled",
        temperature: 0,
        responseFormat: "json_object",
        labelTaxonomy3way: ["resolved", "transitioned", "paused"],
        binaryTag: "resolved",
        calibrationSample: "n=10 evenly-distributed rotation pairs across 3 books (~3-4 per book)",
        notes:
          "Per the 2026-04-30 binary-collapse SOP, this rubric attempted 3-way first then binary. Both gates failed.",
      },
    }
    writeFileSync(outPath, JSON.stringify(failPayload, null, 2))
    console.log(`wrote ${outPath}`)

    const md = `

## 2026-04-30 — Pattern 33 (Conflict resolution latency, P18 follow-up) — METHODOLOGICAL NEGATIVE RESULT

### Methodology

For each adjacent chapter pair (N, N+1) within each Icewind Dale book where \`primary_conflict_N != primary_conflict_{N+1}\` (per the P18 conflict-type taxonomy), characterize how the chapter-N primary conflict landed at the boundary. Three candidate labels: \`resolved\` (chapter closed it), \`transitioned\` (same antagonism took a new shape), \`paused\` (off-stage cut). Inputs to each LLM call: chapter-N's last 3 beat summaries + last_sentences + chapter-N+1's first 2 beat summaries + first_sentences. DeepSeek V4 Flash, temperature 0, JSON mode, thinking disabled.

**Per the 2026-04-30 binary-collapse SOP**, the rubric was a-priori designed with a binary fallback (\`resolved: y/n\`).

**Calibration gate.** Sample n=10 evenly-distributed rotation pairs across the 3 books, run DeepSeek V4 Flash twice (two independent API calls, same prompt). Ship gate: macro-Jaccard >= 0.7 on the 3-way label. If 3-way fails, fall back to binary; ship gate: Jaccard >= 0.7 on \`resolved\` y/n.

### Calibration result — FAIL

**3-way:** macro-Jaccard ${jac3.jaccardMacro.toFixed(3)}, agree ${jac3.agree}/${jac3.n} (${(jac3.agreeRate * 100).toFixed(1)}%). Per-label Jaccard: resolved ${jac3.perLabel.resolved!.jaccard.toFixed(3)}, transitioned ${jac3.perLabel.transitioned!.jaccard.toFixed(3)}, paused ${jac3.perLabel.paused!.jaccard.toFixed(3)}.

**Binary fallback:** Jaccard ${binaryCalib?.jaccard.toFixed(3) ?? "n/a"}, agree ${binaryCalib?.agree ?? "n/a"}/${binaryCalib?.n ?? "n/a"} (${binaryCalib ? (binaryCalib.agreeRate * 100).toFixed(1) : "n/a"}%).

### Conclusion + Action

Conflict-resolution latency at chapter boundaries is **too subjective to ship as a planner prior**, even after binary collapse. Two independent DeepSeek V4 Flash labelings disagreed substantially on the same chapter pairs, replicating the failure mode from the mice rubric and Pattern 27 try-fail-cycles binary fallback.

**No harness target shipped.** This pattern does not produce a planner prior. Recorded as a load-bearing methodological negative result.

### Cost & telemetry

- ${totalTokens.calls} LLM calls, $${totalCost.toFixed(4)} total
- ${totalTokens.prompt} prompt tokens / ${totalTokens.completion} completion tokens
- Full corpus pass NOT run (calibration gate failed)

Artifact: \`crystal_shard.${ts}.conflict-resolution-latency.json\`
Script: \`scripts/structure-calibration/conflict-resolution-latency.ts\`

---
`
    const existing = readFileSync(CONCLUSIONS_PATH, "utf8")
    writeFileSync(CONCLUSIONS_PATH, existing + md)
    console.log(`appended FAILURE conclusions section to ${CONCLUSIONS_PATH}`)
    return
  }

  // ----- FULL PASS -----
  const usingBinary = mode === "binary"
  console.log(
    `\n=== Calibration PASSED (${usingBinary ? "BINARY" : "3-WAY"}) — full corpus labeling ===`,
  )

  // Reuse the calibration labels for sample pairs; only label the residual.
  const sampleKeys = new Set(calibPairs.map((p) => `${p.book}|${p.chN_id}->${p.chN1_id}`))
  const residual = allPairs.filter(
    (p) => !sampleKeys.has(`${p.book}|${p.chN_id}->${p.chN1_id}`),
  )
  console.log(`residual pairs: ${residual.length}`)

  const all3: Map<string, LlmLabel3> = new Map()
  const allBin: Map<string, LlmLabelBin> = new Map()

  if (!usingBinary) {
    for (const [k, v] of run1_3way.entries()) all3.set(k, v)
    const residual3 = await labelPairs3(residual, key, 6)
    for (const [k, v] of residual3.entries()) all3.set(k, v)
  } else {
    for (const [k, v] of run1_bin!.entries()) allBin.set(k, v)
    const residualBin = await labelPairsBinary(residual, key, 6)
    for (const [k, v] of residualBin.entries()) allBin.set(k, v)
  }

  const totalTokens = { prompt: USAGE.prompt, completion: USAGE.completion, calls: USAGE.calls }
  const totalCost = estCostUSD(totalTokens.prompt, totalTokens.completion)
  console.log(`total cost: $${totalCost} (${totalTokens.calls} calls)`)

  // Cost cap guard
  if (totalCost > 1.0) {
    console.warn(`!!! cost $${totalCost} exceeded $1.00 cap; continuing but flagging`)
  }

  // Build per-pair record + per-book distribution + by-conflict-type distribution.
  type PairRecord = {
    key: string
    book: string
    chN: string | number
    chN1: string | number
    primary_conflict_N: string
    primary_conflict_N1: string
    label_3way: ThreeLabel | null
    resolved_binary: boolean | null
    confidence: string
    reason: string
  }
  const records: PairRecord[] = allPairs.map((p) => {
    const k = `${p.book}|${p.chN_id}->${p.chN1_id}`
    if (usingBinary) {
      const b = allBin.get(k)
      return {
        key: k,
        book: p.book,
        chN: p.chN_id,
        chN1: p.chN1_id,
        primary_conflict_N: p.primary_conflict_N,
        primary_conflict_N1: p.primary_conflict_N1,
        label_3way: null,
        resolved_binary: b?.resolved ?? null,
        confidence: b?.confidence ?? "low",
        reason: b?.reason ?? "",
      }
    } else {
      const t = all3.get(k)
      return {
        key: k,
        book: p.book,
        chN: p.chN_id,
        chN1: p.chN1_id,
        primary_conflict_N: p.primary_conflict_N,
        primary_conflict_N1: p.primary_conflict_N1,
        label_3way: t?.label ?? null,
        resolved_binary: t?.label === "resolved" ? true : t?.label ? false : null,
        confidence: t?.confidence ?? "low",
        reason: t?.reason ?? "",
      }
    }
  })

  // Aggregate distributions
  type AggBlock = {
    n: number
    distribution_3way: Record<ThreeLabel, number> | null
    distribution_binary: { resolved_pct: number; not_resolved_pct: number }
  }
  function blockOf(recs: PairRecord[]): AggBlock {
    const n = recs.length
    const dist3 = usingBinary ? null : distribution3(recs.map((r) => r.label_3way!).filter((x) => !!x))
    const resolvedCount = recs.filter((r) => r.resolved_binary === true).length
    const distBin = {
      resolved_pct: n === 0 ? 0 : Math.round((resolvedCount / n) * 10000) / 100,
      not_resolved_pct: n === 0 ? 0 : Math.round(((n - resolvedCount) / n) * 10000) / 100,
    }
    return { n, distribution_3way: dist3, distribution_binary: distBin }
  }

  const aggregate = blockOf(records)
  const perBook: Record<string, AggBlock> = {}
  for (const book of ["crystal_shard", "streams_of_silver", "halflings_gem"]) {
    perBook[book] = blockOf(records.filter((r) => r.book === book))
  }

  // By chapter-N primary conflict type
  const conflictTypes = ["external-physical", "external-cosmic", "interpersonal", "internal"]
  const byPrimaryConflict: Record<string, AggBlock> = {}
  for (const ct of conflictTypes) {
    byPrimaryConflict[ct] = blockOf(records.filter((r) => r.primary_conflict_N === ct))
  }

  // Cross-book directional comparison: stability of resolved-rate
  const resolvedRates = ["crystal_shard", "streams_of_silver", "halflings_gem"].map(
    (b) => perBook[b]!.distribution_binary.resolved_pct,
  )
  const resolvedRateRange = Math.max(...resolvedRates) - Math.min(...resolvedRates)
  const resolvedRateStable = resolvedRateRange <= 15

  let directionalVerdict: string
  if (usingBinary) {
    directionalVerdict = resolvedRateStable
      ? `Cross-book resolved-rate STABLE: range ${resolvedRateRange.toFixed(1)}pt across 3 books (${resolvedRates.map((r, i) => `${["crystal_shard", "streams_of_silver", "halflings_gem"][i]}=${r}%`).join(", ")}). Latency signal is corpus-real and ships as a planner prior.`
      : `Cross-book resolved-rate DIVERGES: range ${resolvedRateRange.toFixed(1)}pt > 15pt threshold (${resolvedRates.map((r, i) => `${["crystal_shard", "streams_of_silver", "halflings_gem"][i]}=${r}%`).join(", ")}). Latency varies meaningfully by book; do NOT ship as a uniform planner prior.`
  } else {
    const transitionedRates = ["crystal_shard", "streams_of_silver", "halflings_gem"].map(
      (b) => perBook[b]!.distribution_3way?.transitioned ?? 0,
    )
    const pausedRates = ["crystal_shard", "streams_of_silver", "halflings_gem"].map(
      (b) => perBook[b]!.distribution_3way?.paused ?? 0,
    )
    directionalVerdict = `3-way modal across all 3 books: ${(() => {
      const a = aggregate.distribution_3way!
      const top = Object.entries(a).sort((x, y) => y[1] - x[1])[0]!
      return `${top[0]} (${(top[1] * 100).toFixed(1)}%)`
    })()}. Per-book resolved-rate ${resolvedRates.map((r, i) => `${["cs", "ss", "hg"][i]}=${r}%`).join(", ")} (range ${resolvedRateRange.toFixed(1)}pt; ${resolvedRateStable ? "stable" : "diverges"}). Per-book transitioned-rate ${transitionedRates.map((r, i) => `${["cs", "ss", "hg"][i]}=${(r * 100).toFixed(1)}%`).join(", ")}. Per-book paused-rate ${pausedRates.map((r, i) => `${["cs", "ss", "hg"][i]}=${(r * 100).toFixed(1)}%`).join(", ")}.`
  }

  const successPayload = {
    pattern: "33",
    name: "Conflict resolution latency (P18 follow-up)",
    timestamp: isoTs,
    stage: usingBinary ? "binary_calibration_passed" : "3way_calibration_passed",
    mode: usingBinary ? "binary" : "3way",
    calibration_3way: calibPayload3,
    calibration_binary: calibPayloadBinary,
    method: {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      thinking: "disabled",
      temperature: 0,
      responseFormat: "json_object",
      label_taxonomy: usingBinary ? ["resolved", "not_resolved"] : ["resolved", "transitioned", "paused"],
      input_shape: "chapter-N last 3 beats (summary + last_sentence) + chapter-N+1 first 2 beats (summary + first_sentence)",
      pair_filter: "primary_conflict_N != primary_conflict_{N+1} (rotation pairs only)",
      calibrationSample: "n=10 evenly-distributed rotation pairs across 3 books",
      shipGate: "macro-Jaccard >= 0.7 (3-way) or Jaccard >= 0.7 (binary fallback)",
    },
    counts: {
      total_chapter_pairs: 92 - 3, // 92 chapters minus 1 first-of-book per book
      same_conflict_pairs_skipped: 92 - 3 - allPairs.length,
      rotation_pairs_labeled: allPairs.length,
    },
    aggregate,
    per_book: perBook,
    by_primary_conflict_chN: byPrimaryConflict,
    cross_book_directional: {
      resolvedRates: Object.fromEntries(
        ["crystal_shard", "streams_of_silver", "halflings_gem"].map((b, i) => [b, resolvedRates[i]]),
      ),
      resolvedRateRange,
      resolvedRateStable,
      verdict: directionalVerdict,
    },
    pair_records: records,
    cost_telemetry: {
      total_calls: totalTokens.calls,
      prompt_tokens: totalTokens.prompt,
      completion_tokens: totalTokens.completion,
      total_cost_usd: totalCost,
    },
  }

  writeFileSync(outPath, JSON.stringify(successPayload, null, 2))
  console.log(`wrote ${outPath}`)

  // Markdown conclusions
  const fmtBinPct = (b: AggBlock) =>
    `resolved ${b.distribution_binary.resolved_pct}% / not-resolved ${b.distribution_binary.not_resolved_pct}% (n=${b.n})`
  const fmt3Pct = (b: AggBlock) => {
    if (!b.distribution_3way) return fmtBinPct(b)
    const d = b.distribution_3way
    return `resolved ${(d.resolved * 100).toFixed(1)}% / transitioned ${(d.transitioned * 100).toFixed(1)}% / paused ${(d.paused * 100).toFixed(1)}% (n=${b.n})`
  }
  const fmt = usingBinary ? fmtBinPct : fmt3Pct

  const md = `

## 2026-04-30 — Pattern 33 (Conflict resolution latency, P18 follow-up)

### Methodology

For each adjacent chapter pair (N, N+1) within each Icewind Dale book where \`primary_conflict_N != primary_conflict_{N+1}\` (rotation pair, per the P18 conflict-type taxonomy at \`crystal_shard.20260430T115702.conflict-type-taxonomy.json\`), characterize how the chapter-N primary conflict landed at the chapter break.

**Label taxonomy.** ${
    usingBinary
      ? `Binary fallback (calibration on the 3-way taxonomy did not meet the J>=0.7 ship gate): \`resolved\` y/n.`
      : `Three-way: \`resolved\` (chapter closed it), \`transitioned\` (same antagonism took a new shape, e.g. combat → diplomacy), \`paused\` (off-stage cut, prior conflict simply absent from chapter N+1's foreground).`
  }

**Input.** For each pair, the model was given chapter N's last 3 beats (summary + last_sentence) and chapter N+1's first 2 beats (summary + first_sentence). Provider: DeepSeek V4 Flash, temperature 0, JSON mode, thinking disabled.

**Calibration.** Sample n=${calibPairs.length} evenly-distributed rotation pairs across the 3 books, run DeepSeek twice (two independent API calls). Ship gate: macro-Jaccard >= 0.7 on the 3-way label, falling back to binary on failure.

| Metric | Value |
|---|---|
| 3-way macro-Jaccard | ${jac3.jaccardMacro.toFixed(3)} |
| 3-way exact-agreement | ${jac3.agree}/${jac3.n} (${(jac3.agreeRate * 100).toFixed(1)}%) |
| Per-label Jaccard | resolved ${jac3.perLabel.resolved!.jaccard.toFixed(3)}, transitioned ${jac3.perLabel.transitioned!.jaccard.toFixed(3)}, paused ${jac3.perLabel.paused!.jaccard.toFixed(3)} |
| 3-way verdict | ${jac3.jaccardMacro >= 0.7 ? "**PASS**" : "FAIL"} |
${
    binaryCalib
      ? `| Binary Jaccard | ${binaryCalib.jaccard.toFixed(3)} |\n| Binary agreement | ${binaryCalib.agree}/${binaryCalib.n} (${(binaryCalib.agreeRate * 100).toFixed(1)}%) |\n| Binary verdict | ${binaryCalib.jaccard >= 0.7 ? "**PASS**" : "FAIL"} |`
      : ""
  }

**Mode used for full pass:** \`${usingBinary ? "binary" : "3-way"}\` (J=${(usingBinary ? binaryCalib!.jaccard : jac3.jaccardMacro).toFixed(3)}).

### Pair counts

- Total chapter pairs (within-book, adjacent): 89 (92 chapters − 3 first-of-book entries)
- Same-conflict pairs (skipped — no boundary): ${92 - 3 - allPairs.length}
- Rotation pairs (labeled): ${allPairs.length} (cs=${perBookRotationPairs.crystal_shard ?? 0} / ss=${perBookRotationPairs.streams_of_silver ?? 0} / hg=${perBookRotationPairs.halflings_gem ?? 0})

### Aggregate distribution

- All books: ${fmt(aggregate)}
- crystal_shard: ${fmt(perBook.crystal_shard!)}
- streams_of_silver: ${fmt(perBook.streams_of_silver!)}
- halflings_gem: ${fmt(perBook.halflings_gem!)}

### Distribution by chapter-N primary conflict type

| chN primary conflict | n | ${usingBinary ? "resolved %" : "resolved % / transitioned % / paused %"} |
|---|---:|---|
| external-physical | ${byPrimaryConflict["external-physical"]!.n} | ${
    usingBinary
      ? `${byPrimaryConflict["external-physical"]!.distribution_binary.resolved_pct}%`
      : `${(byPrimaryConflict["external-physical"]!.distribution_3way!.resolved * 100).toFixed(1)}% / ${(byPrimaryConflict["external-physical"]!.distribution_3way!.transitioned * 100).toFixed(1)}% / ${(byPrimaryConflict["external-physical"]!.distribution_3way!.paused * 100).toFixed(1)}%`
  } |
| external-cosmic | ${byPrimaryConflict["external-cosmic"]!.n} | ${
    usingBinary
      ? `${byPrimaryConflict["external-cosmic"]!.distribution_binary.resolved_pct}%`
      : `${(byPrimaryConflict["external-cosmic"]!.distribution_3way!.resolved * 100).toFixed(1)}% / ${(byPrimaryConflict["external-cosmic"]!.distribution_3way!.transitioned * 100).toFixed(1)}% / ${(byPrimaryConflict["external-cosmic"]!.distribution_3way!.paused * 100).toFixed(1)}%`
  } |
| interpersonal | ${byPrimaryConflict["interpersonal"]!.n} | ${
    usingBinary
      ? `${byPrimaryConflict["interpersonal"]!.distribution_binary.resolved_pct}%`
      : `${(byPrimaryConflict["interpersonal"]!.distribution_3way!.resolved * 100).toFixed(1)}% / ${(byPrimaryConflict["interpersonal"]!.distribution_3way!.transitioned * 100).toFixed(1)}% / ${(byPrimaryConflict["interpersonal"]!.distribution_3way!.paused * 100).toFixed(1)}%`
  } |
| internal | ${byPrimaryConflict["internal"]!.n} | ${
    usingBinary
      ? `${byPrimaryConflict["internal"]!.distribution_binary.resolved_pct}%`
      : `${(byPrimaryConflict["internal"]!.distribution_3way!.resolved * 100).toFixed(1)}% / ${(byPrimaryConflict["internal"]!.distribution_3way!.transitioned * 100).toFixed(1)}% / ${(byPrimaryConflict["internal"]!.distribution_3way!.paused * 100).toFixed(1)}%`
  } |

### Cross-book directional verdict

Resolved-rate per book: ${resolvedRates.map((r, i) => `${["crystal_shard", "streams_of_silver", "halflings_gem"][i]} ${r}%`).join(", ")} — range ${resolvedRateRange.toFixed(1)}pt — **${resolvedRateStable ? "STABLE" : "DIVERGES"}** vs the 15pt threshold.

${directionalVerdict}

### Conclusion + Action

${
    resolvedRateStable
      ? `**Directionally stable cross-book signal.** The Salvatore IWD trilogy resolves the chapter-N primary conflict at roughly ${(aggregate.distribution_binary.resolved_pct).toFixed(0)}% of rotation boundaries; this is consistent across all 3 books to within ${resolvedRateRange.toFixed(1)}pt.`
      : `**Cross-book directional split.** Resolved-rate varies by ${resolvedRateRange.toFixed(1)}pt across the 3 books, which exceeds the 15pt stability threshold; the signal does NOT collapse to a uniform planner prior.`
  }

**Harness target:**

${
    resolvedRateStable
      ? usingBinary
        ? `- **Resolved-at-rotation prior:** when the planner schedules a primary-conflict rotation between adjacent chapters, ~${(aggregate.distribution_binary.resolved_pct).toFixed(0)}% of those rotations should be paired with chapter-N having genuinely closed its conflict (vs ~${(aggregate.distribution_binary.not_resolved_pct).toFixed(0)}% where N+1 simply opens a new front while N's tension remains live). Encode this as a soft prior on chapter-outline transitions.\n- **Per-conflict-type breakdown:** rotations OUT of \`external-physical\` chapters resolve ${byPrimaryConflict["external-physical"]!.distribution_binary.resolved_pct.toFixed(0)}% of the time; OUT of \`interpersonal\` ${byPrimaryConflict["interpersonal"]!.distribution_binary.resolved_pct.toFixed(0)}%; OUT of \`internal\` ${byPrimaryConflict["internal"]!.distribution_binary.resolved_pct.toFixed(0)}%; OUT of \`external-cosmic\` ${byPrimaryConflict["external-cosmic"]!.distribution_binary.resolved_pct.toFixed(0)}%. Use these as a per-source-conflict prior.`
        : `- **Latency taxonomy as a planner prior:** a rotation is most likely to be \`${(() => { const a = aggregate.distribution_3way!; const top = Object.entries(a).sort((x, y) => y[1] - x[1])[0]!; return top[0] })()}\` at the chapter break. Concrete corpus rates: resolved ${(aggregate.distribution_3way!.resolved * 100).toFixed(0)}% / transitioned ${(aggregate.distribution_3way!.transitioned * 100).toFixed(0)}% / paused ${(aggregate.distribution_3way!.paused * 100).toFixed(0)}%. Encode as a 3-way distribution on the chapter-outline rotation field.\n- **Per-conflict-type breakdown:** transitions OUT of \`external-physical\` resolve ${(byPrimaryConflict["external-physical"]!.distribution_3way!.resolved * 100).toFixed(0)}% / transition ${(byPrimaryConflict["external-physical"]!.distribution_3way!.transitioned * 100).toFixed(0)}% / pause ${(byPrimaryConflict["external-physical"]!.distribution_3way!.paused * 100).toFixed(0)}%; OUT of \`interpersonal\` ${(byPrimaryConflict["interpersonal"]!.distribution_3way!.resolved * 100).toFixed(0)}% / ${(byPrimaryConflict["interpersonal"]!.distribution_3way!.transitioned * 100).toFixed(0)}% / ${(byPrimaryConflict["interpersonal"]!.distribution_3way!.paused * 100).toFixed(0)}%; OUT of \`internal\` ${(byPrimaryConflict["internal"]!.distribution_3way!.resolved * 100).toFixed(0)}% / ${(byPrimaryConflict["internal"]!.distribution_3way!.transitioned * 100).toFixed(0)}% / ${(byPrimaryConflict["internal"]!.distribution_3way!.paused * 100).toFixed(0)}%; OUT of \`external-cosmic\` ${(byPrimaryConflict["external-cosmic"]!.distribution_3way!.resolved * 100).toFixed(0)}% / ${(byPrimaryConflict["external-cosmic"]!.distribution_3way!.transitioned * 100).toFixed(0)}% / ${(byPrimaryConflict["external-cosmic"]!.distribution_3way!.paused * 100).toFixed(0)}%.`
      : `- Per-book resolved-rate range exceeds 15pt; the latency signal does **not** ship as a uniform planner prior. The directional split is real corpus information for a future analysis (e.g., book-position-aware variants), but does not yield a single number to encode.`
  }

This pattern is **complementary to P18** (which characterizes the conflict TYPE per chapter) — P33 characterizes how each rotation BOUNDARY behaves. Together: P18 says "what kind of conflict drives chapter N", P33 says "how the chapter-N conflict lands when the next chapter opens with a different conflict".

### Cost & telemetry

- ${totalTokens.calls} LLM calls (${calibTokens3.calls + (binaryCalib ? (calibTokens3.calls) : 0)} calibration / ${totalTokens.calls - (calibTokens3.calls + (binaryCalib ? calibTokens3.calls : 0))} residual)
- $${totalCost.toFixed(4)} total cost (cap $1.00)
- ${totalTokens.prompt} prompt tokens / ${totalTokens.completion} completion tokens

Artifact: \`crystal_shard.${ts}.conflict-resolution-latency.json\`
Script: \`scripts/structure-calibration/conflict-resolution-latency.ts\`

---
`

  const existing = readFileSync(CONCLUSIONS_PATH, "utf8")
  writeFileSync(CONCLUSIONS_PATH, existing + md)
  console.log(`appended SUCCESS conclusions section to ${CONCLUSIONS_PATH}`)
  console.log("\n=== Done ===")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
