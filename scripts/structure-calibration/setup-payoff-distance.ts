// Pattern 28 — Setup-to-payoff distance distribution across the 3 IWD books.
//
// Methodology (defensive, per task brief):
// 1. CALIBRATION: n=50 random beats per book × 2 runs (binary "is this a setup
//    that pays off in a later chapter: y/n"). Measure Jaccard. If J < 0.7,
//    STOP and report — the binary itself is too noisy to ship.
// 2. SETUP LABELS (always run): full pass, every beat gets the binary tag.
// 3. PAYOFF PAIRS (only if calibration passes AND --pairs flag set): for each
//    setup beat, run a second LLM call asking the model to find the closest
//    matching payoff in subsequent beats of the same book.
//
// Stage 3 is gated on calibration PASS to avoid spending money on a metric
// the labeler can't even produce reliably for the easier case.
//
// Provider: DeepSeek V4 Flash, thinking disabled, T=0.
// Cost cap: $5.
//
// Output: timestamped JSON at
//   novels/salvatore-icewind-dale/structure-calibration/
//     crystal_shard.<TS>.setup-payoff-distance.json
//
// Usage:
//   bun scripts/structure-calibration/setup-payoff-distance.ts            # full run (calibration + labels [+ pairs if PASS])
//   bun scripts/structure-calibration/setup-payoff-distance.ts --calibrate-only
//   bun scripts/structure-calibration/setup-payoff-distance.ts --skip-pairs

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

// ----- types -----------------------------------------------------------------

type Beat = {
  beat_idx: number
  words: number
  kind: string
  boundary_signal: string
  summary: string
  first_sentence: string
  last_sentence: string
  text: string
  scene_id: string
  book: string
  chapter: number | string
}

type SetupLabel = {
  is_setup: boolean
  confidence: "high" | "medium" | "low"
  what_is_planted: string  // short clause; empty if is_setup=false
}

type PayoffMatch = {
  setup_beat_id: string
  setup_book: string
  setup_chapter: number | string
  setup_beat_idx: number
  payoff_beat_id: string | null
  payoff_chapter: number | string | null
  payoff_beat_idx: number | null
  distance_chapters: number | null  // null if no payoff found in same book
  match_confidence: "high" | "medium" | "low" | null
  match_note: string
}

// ----- paths -----------------------------------------------------------------

const ROOT = "/Users/andre/Desktop/personal_projects/novel-harness"
const BEATS_PATH = join(ROOT, "novels/salvatore-icewind-dale/beats.jsonl")
const ENV_PATH = join(ROOT, ".env")
const OUT_DIR = join(ROOT, "novels/salvatore-icewind-dale/structure-calibration")
const CONCLUSIONS_PATH = join(OUT_DIR, "crystal_shard-conclusions.md")

// ----- env loading -----------------------------------------------------------

function loadEnvKey(): string {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY
  if (existsSync(ENV_PATH)) {
    const env = readFileSync(ENV_PATH, "utf8")
    const m = env.match(/^DEEPSEEK_API_KEY\s*=\s*"?([^"\n]+)"?\s*$/m)
    if (m) return m[1].trim()
  }
  throw new Error("DEEPSEEK_API_KEY not set in env or .env file")
}

// ----- CLI flags -------------------------------------------------------------

const argv = process.argv.slice(2)
const CALIBRATE_ONLY = argv.includes("--calibrate-only")
const SKIP_PAIRS = argv.includes("--skip-pairs") || CALIBRATE_ONLY

// ----- timestamp -------------------------------------------------------------

function tsStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  )
}

// ----- chapter ordering ------------------------------------------------------

// Convert chapter to a numeric ordering key. Salvatore uses "prelude",
// "epilogue", "epilogue2", "epilogue3", "part1"–"part3" alongside numeric
// chapter ids. Preludes come first; numeric chapters in order; epilogues last.
// The keys are ordered globally so a setup→payoff distance is well-defined.
function chapterOrderKey(chapter: number | string): number {
  if (typeof chapter === "number") return chapter
  const s = String(chapter).toLowerCase()
  if (s === "prelude") return -1
  if (s.startsWith("part")) {
    const m = s.match(/(\d+)/)
    return m ? -1 + Number(m[1]) * 0.001 : -0.5
  }
  if (s === "epilogue") return 9999
  if (s.startsWith("epilogue")) {
    const m = s.match(/(\d+)/)
    return m ? 9999 + Number(m[1]) : 9999
  }
  // unknown string-chapter; sort at end
  return 99999
}

function chapterDistance(a: number | string, b: number | string): number {
  return chapterOrderKey(b) - chapterOrderKey(a)
}

// ----- LLM call --------------------------------------------------------------

const SETUP_SYSTEM_PROMPT = `You are classifying whether a SINGLE BEAT plants information that will likely be load-bearing for a LATER chapter in the same book.

A "setup" / "foreshadow" beat is one that plants:
- A concrete object (a magic item, a weapon, a hidden artifact) that the same character or an adjacent one will USE in a later chapter.
- A character knowledge gap (what someone does or does not know — a secret, a deception, a hidden identity) that will be RESOLVED or EXPLOITED later.
- A capability or rule (a magical mechanic, a creature's vulnerability, a plot-relevant skill) that will be APPLIED later under stakes.
- A character commitment, vow, or promise that the same character will be CALLED ON to honor or break later.
- A foreshadowed threat or arrival (named villain, approaching army, prophecy) that will MATERIALIZE in a later chapter.

A beat is NOT a setup if:
- It only describes mood / scenery / current state with no plant-and-payoff structure.
- It is itself the payoff of a prior setup (information BEING USED, not information being planted).
- It is dialogue that only restates known information.
- The "planted" information is paid off WITHIN the same scene/beat (no chapter-distance payoff).

Be CONSERVATIVE. The threshold is "would a reader looking back from a later chapter think 'that was set up here'?" — NOT "could this hypothetically matter someday."

Output JSON only:
{
  "is_setup": true | false,
  "confidence": "high" | "medium" | "low",
  "what_is_planted": "<short clause naming the object/knowledge/rule planted, OR empty string if is_setup is false>"
}`

const PAYOFF_SYSTEM_PROMPT = `You are matching a SETUP BEAT to its closest matching PAYOFF in subsequent beats from the same book.

Given:
- A setup beat (with text + summary + what_is_planted clause).
- A list of candidate later beats from the same book (summaries + first/last sentences only, with their chapter and beat_idx).

Find the SINGLE closest beat where the planted information becomes load-bearing. Load-bearing means: the object is used, the secret is revealed, the rule is applied, the vow is honored or broken, the threat materializes.

If multiple candidates are plausible, pick the FIRST chronological one where the payoff is clear and material — not later restatements.

If NO candidate genuinely pays off the setup within the candidate list, return null.

Output JSON only:
{
  "payoff_beat_id": "<beat_id of matched payoff, or null>",
  "match_confidence": "high" | "medium" | "low",
  "note": "<one short clause explaining the link>"
}`

async function callDeepSeekJson(
  systemPrompt: string,
  userPrompt: string,
  key: string,
  maxTokens = 300,
): Promise<{ raw: string; promptTokens: number; completionTokens: number }> {
  const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
    }),
  })
  if (!r.ok) throw new Error(`DeepSeek HTTP ${r.status}: ${(await r.text()).slice(0, 400)}`)
  const j = (await r.json()) as any
  const raw = (j.choices?.[0]?.message?.content ?? "").trim()
  const usage = j.usage ?? {}
  return {
    raw,
    promptTokens: Number(usage.prompt_tokens ?? 0),
    completionTokens: Number(usage.completion_tokens ?? 0),
  }
}

function parseSetupLabel(raw: string): SetupLabel {
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`non-JSON response: ${raw.slice(0, 200)}`)
  }
  return {
    is_setup: Boolean(parsed.is_setup),
    confidence:
      parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
        ? parsed.confidence
        : "medium",
    what_is_planted: String(parsed.what_is_planted ?? "").slice(0, 200),
  }
}

// ----- beat loader -----------------------------------------------------------

function loadBeats(): Beat[] {
  const lines = readFileSync(BEATS_PATH, "utf8").trim().split("\n")
  const beats: Beat[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    beats.push(JSON.parse(line) as Beat)
  }
  // Stable order: book → chapter ordering → beat_idx.
  const bookOrder = ["crystal_shard", "streams_of_silver", "halflings_gem"]
  beats.sort((a, b) => {
    const bo = bookOrder.indexOf(a.book) - bookOrder.indexOf(b.book)
    if (bo !== 0) return bo
    const co = chapterOrderKey(a.chapter) - chapterOrderKey(b.chapter)
    if (co !== 0) return co
    return a.beat_idx - b.beat_idx
  })
  return beats
}

// ----- prompts ---------------------------------------------------------------

function buildSetupUserPrompt(beat: Beat, surroundingContext: string): string {
  const text = (beat.text || "").slice(0, 1500)
  return `BOOK: ${beat.book}
CHAPTER: ${beat.chapter}
BEAT INDEX (within book): ${beat.beat_idx}
BEAT KIND: ${beat.kind}

BEAT SUMMARY: ${beat.summary || "(none)"}

${surroundingContext}

BEAT TEXT:
${text}

---
Classify whether this beat plants information that will likely be load-bearing in a LATER chapter of the same book. Be conservative.`
}

function buildPayoffUserPrompt(setup: Beat, plantedClause: string, candidates: Beat[]): string {
  const lines = candidates
    .map((c) => {
      const fs = (c.first_sentence || "").slice(0, 160).replace(/\n/g, " ")
      const ls = (c.last_sentence || "").slice(0, 160).replace(/\n/g, " ")
      const sm = (c.summary || "").slice(0, 240).replace(/\n/g, " ")
      const id = `${c.scene_id}_b${c.beat_idx}`
      return `- ${id} | ch=${c.chapter} idx=${c.beat_idx} | summary: ${sm} | first: "${fs}" | last: "${ls}"`
    })
    .join("\n")

  const setupId = `${setup.scene_id}_b${setup.beat_idx}`
  return `SETUP BEAT (id=${setupId}, book=${setup.book}, ch=${setup.chapter}, idx=${setup.beat_idx})

WHAT WAS PLANTED: ${plantedClause}

SETUP BEAT SUMMARY: ${setup.summary || "(none)"}

SETUP BEAT TEXT:
${(setup.text || "").slice(0, 1200)}

---
CANDIDATE LATER BEATS (chronological, all from book ${setup.book}):

${lines}

---
Pick the SINGLE closest beat where the planted information becomes load-bearing, or null if none qualifies. Output the beat_id (e.g. "${setupId}" format), not the chapter or index alone.`
}

// ----- jaccard ---------------------------------------------------------------

function jaccard(setA: Set<string>, setB: Set<string>): number {
  const union = new Set([...setA, ...setB])
  let intersect = 0
  for (const x of setA) if (setB.has(x)) intersect += 1
  return union.size === 0 ? 1 : intersect / union.size
}

function beatId(b: Beat): string {
  return `${b.scene_id}_b${b.beat_idx}`
}

// ----- bounded concurrency runner --------------------------------------------

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let done = 0
  async function pump() {
    while (true) {
      const idx = next
      next += 1
      if (idx >= items.length) return
      try {
        results[idx] = await worker(items[idx], idx)
      } catch (err) {
        // Re-throw — caller's worker is expected to catch and mark.
        throw err
      }
      done += 1
      if (onProgress) onProgress(done, items.length)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => pump()))
  return results
}

// ----- random sample ---------------------------------------------------------

// Deterministic hash-based "random" so calibration is reproducible.
function deterministicHash(s: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function sampleN<T>(arr: T[], n: number, keyFn: (x: T) => string, salt: string): T[] {
  const scored = arr.map((x) => ({ x, score: deterministicHash(keyFn(x) + "|" + salt) }))
  scored.sort((a, b) => a.score - b.score)
  return scored.slice(0, n).map((s) => s.x)
}

// ----- surrounding context builder ------------------------------------------

// For the setup labeler, give the model 1 prior beat summary and 1 next beat
// summary to ground "is this load-bearing later" against immediate context.
function buildSurroundingContext(allBeats: Beat[], target: Beat): string {
  const sameBook = allBeats.filter((b) => b.book === target.book)
  const idx = sameBook.findIndex((b) => beatId(b) === beatId(target))
  if (idx < 0) return ""
  const prev = idx > 0 ? sameBook[idx - 1] : null
  const next = idx < sameBook.length - 1 ? sameBook[idx + 1] : null
  const lines: string[] = []
  if (prev) {
    lines.push(`PRIOR BEAT (ch=${prev.chapter} idx=${prev.beat_idx}) summary: ${(prev.summary || "").slice(0, 200)}`)
  }
  if (next) {
    lines.push(`NEXT BEAT (ch=${next.chapter} idx=${next.beat_idx}) summary: ${(next.summary || "").slice(0, 200)}`)
  }
  return lines.length > 0 ? lines.join("\n") + "\n" : ""
}

// ----- Stage 1: calibration --------------------------------------------------

type CalibrationBookResult = {
  book: string
  n: number
  jaccard: number
  pos_run1: number
  pos_run2: number
  agreement_count: number
  disagreement_count: number
  run1: { beat_id: string; is_setup: boolean }[]
  run2: { beat_id: string; is_setup: boolean }[]
}

async function runCalibration(
  beats: Beat[],
  key: string,
): Promise<{ perBook: CalibrationBookResult[]; aggregateJ: number; pass: boolean; tokens: { input: number; output: number } }> {
  const books = ["crystal_shard", "streams_of_silver", "halflings_gem"]
  const N_PER_BOOK = 50
  const CONCURRENCY = 6
  const results: CalibrationBookResult[] = []
  let totalIn = 0
  let totalOut = 0

  for (const book of books) {
    const bookBeats = beats.filter((b) => b.book === book)
    const sample = sampleN(bookBeats, N_PER_BOOK, beatId, "calibration_v1")
    console.log(`[calibration] ${book}: sampling ${sample.length} of ${bookBeats.length} beats`)

    // Run 1
    const run1Results: { beat_id: string; is_setup: boolean }[] = []
    await runWithConcurrency(
      sample,
      CONCURRENCY,
      async (b) => {
        const ctx = buildSurroundingContext(beats, b)
        const userPrompt = buildSetupUserPrompt(b, ctx)
        try {
          const { raw, promptTokens, completionTokens } = await callDeepSeekJson(
            SETUP_SYSTEM_PROMPT,
            userPrompt,
            key,
            300,
          )
          totalIn += promptTokens
          totalOut += completionTokens
          const label = parseSetupLabel(raw)
          run1Results.push({ beat_id: beatId(b), is_setup: label.is_setup })
        } catch (err) {
          console.error(`  run1 err on ${beatId(b)}:`, (err as Error).message.slice(0, 120))
          run1Results.push({ beat_id: beatId(b), is_setup: false })
        }
        return null
      },
      (done, total) => {
        if (done % 10 === 0) console.log(`  ${book} run1: ${done}/${total}`)
      },
    )

    // Run 2 — same beats, same prompt — measures self-consistency at T=0.
    // T=0 should be near-deterministic but is not guaranteed; this is the
    // gold-stability check from the task brief.
    const run2Results: { beat_id: string; is_setup: boolean }[] = []
    await runWithConcurrency(
      sample,
      CONCURRENCY,
      async (b) => {
        const ctx = buildSurroundingContext(beats, b)
        const userPrompt = buildSetupUserPrompt(b, ctx) + "\n"  // microscopic perturbation to break exact prompt cache, force genuine 2nd inference
        try {
          const { raw, promptTokens, completionTokens } = await callDeepSeekJson(
            SETUP_SYSTEM_PROMPT,
            userPrompt,
            key,
            300,
          )
          totalIn += promptTokens
          totalOut += completionTokens
          const label = parseSetupLabel(raw)
          run2Results.push({ beat_id: beatId(b), is_setup: label.is_setup })
        } catch (err) {
          console.error(`  run2 err on ${beatId(b)}:`, (err as Error).message.slice(0, 120))
          run2Results.push({ beat_id: beatId(b), is_setup: false })
        }
        return null
      },
      (done, total) => {
        if (done % 10 === 0) console.log(`  ${book} run2: ${done}/${total}`)
      },
    )

    // Index by beat_id for jaccard. Jaccard of "set of beat_ids tagged is_setup=true".
    const run1Pos = new Set(run1Results.filter((r) => r.is_setup).map((r) => r.beat_id))
    const run2Pos = new Set(run2Results.filter((r) => r.is_setup).map((r) => r.beat_id))
    const j = jaccard(run1Pos, run2Pos)

    let agree = 0
    let disagree = 0
    const map1 = new Map(run1Results.map((r) => [r.beat_id, r.is_setup]))
    const map2 = new Map(run2Results.map((r) => [r.beat_id, r.is_setup]))
    for (const id of map1.keys()) {
      const v1 = map1.get(id)!
      const v2 = map2.get(id) ?? false
      if (v1 === v2) agree += 1
      else disagree += 1
    }

    results.push({
      book,
      n: sample.length,
      jaccard: Math.round(j * 1000) / 1000,
      pos_run1: run1Pos.size,
      pos_run2: run2Pos.size,
      agreement_count: agree,
      disagreement_count: disagree,
      run1: run1Results,
      run2: run2Results,
    })
    console.log(`[calibration] ${book}: J=${j.toFixed(3)}, agree=${agree}/${sample.length}, pos_r1=${run1Pos.size}, pos_r2=${run2Pos.size}`)
  }

  // Aggregate jaccard over the 150-beat union of all books' positive sets.
  const allRun1Pos = new Set<string>()
  const allRun2Pos = new Set<string>()
  for (const r of results) {
    for (const x of r.run1) if (x.is_setup) allRun1Pos.add(x.beat_id)
    for (const x of r.run2) if (x.is_setup) allRun2Pos.add(x.beat_id)
  }
  const aggJ = jaccard(allRun1Pos, allRun2Pos)
  const minBookJ = Math.min(...results.map((r) => r.jaccard))
  const PASS_THRESHOLD = 0.7
  const pass = minBookJ >= PASS_THRESHOLD

  return { perBook: results, aggregateJ: Math.round(aggJ * 1000) / 1000, pass, tokens: { input: totalIn, output: totalOut } }
}

// ----- Stage 2: full setup labeling ------------------------------------------

type FullSetupRow = {
  beat_id: string
  book: string
  chapter: number | string
  beat_idx: number
  is_setup: boolean
  confidence: "high" | "medium" | "low"
  what_is_planted: string
}

async function runFullSetupLabeling(
  beats: Beat[],
  key: string,
): Promise<{ rows: FullSetupRow[]; tokens: { input: number; output: number } }> {
  const CONCURRENCY = 8
  const rows: FullSetupRow[] = new Array(beats.length)
  let totalIn = 0
  let totalOut = 0
  let tokenLockMutex = Promise.resolve()
  const addTokens = (i: number, o: number) => {
    tokenLockMutex = tokenLockMutex.then(() => {
      totalIn += i
      totalOut += o
    })
  }

  await runWithConcurrency(
    beats,
    CONCURRENCY,
    async (b, idx) => {
      const ctx = buildSurroundingContext(beats, b)
      const userPrompt = buildSetupUserPrompt(b, ctx)
      try {
        const { raw, promptTokens, completionTokens } = await callDeepSeekJson(
          SETUP_SYSTEM_PROMPT,
          userPrompt,
          key,
          300,
        )
        addTokens(promptTokens, completionTokens)
        const label = parseSetupLabel(raw)
        rows[idx] = {
          beat_id: beatId(b),
          book: b.book,
          chapter: b.chapter,
          beat_idx: b.beat_idx,
          is_setup: label.is_setup,
          confidence: label.confidence,
          what_is_planted: label.what_is_planted,
        }
      } catch (err) {
        console.error(`  setup-label err on ${beatId(b)}:`, (err as Error).message.slice(0, 120))
        rows[idx] = {
          beat_id: beatId(b),
          book: b.book,
          chapter: b.chapter,
          beat_idx: b.beat_idx,
          is_setup: false,
          confidence: "low",
          what_is_planted: `[label-error]`,
        }
      }
      return null
    },
    (done, total) => {
      if (done % 100 === 0) console.log(`  setup-labels: ${done}/${total}`)
    },
  )
  await tokenLockMutex
  return { rows, tokens: { input: totalIn, output: totalOut } }
}

// ----- Stage 3: payoff matching ----------------------------------------------

// For each setup beat in book B at chapter C, search subsequent beats in book B
// (chapter > C or same chapter but beat_idx > setup.beat_idx). Cap candidates
// to keep the prompt reasonable; we sample evenly across the remainder.
const PAYOFF_MAX_CANDIDATES = 60

async function runPayoffMatching(
  beats: Beat[],
  setupRows: FullSetupRow[],
  key: string,
): Promise<{ matches: PayoffMatch[]; tokens: { input: number; output: number } }> {
  const CONCURRENCY = 6
  // Only label high/medium-confidence setups to control noise.
  const setups = setupRows.filter((r) => r.is_setup && (r.confidence === "high" || r.confidence === "medium"))
  console.log(`[payoffs] running on ${setups.length} setup beats (high+medium confidence)`)

  // Precompute book→ordered beats for candidate selection.
  const beatsByBook = new Map<string, Beat[]>()
  for (const b of beats) {
    if (!beatsByBook.has(b.book)) beatsByBook.set(b.book, [])
    beatsByBook.get(b.book)!.push(b)
  }
  // Already sorted globally; per-book slice preserves order.

  const matches: PayoffMatch[] = new Array(setups.length)
  let totalIn = 0
  let totalOut = 0
  let tokenLockMutex = Promise.resolve()
  const addTokens = (i: number, o: number) => {
    tokenLockMutex = tokenLockMutex.then(() => {
      totalIn += i
      totalOut += o
    })
  }

  await runWithConcurrency(
    setups,
    CONCURRENCY,
    async (sr, idx) => {
      const setupBeat = beats.find((bb) => beatId(bb) === sr.beat_id)
      if (!setupBeat) {
        matches[idx] = {
          setup_beat_id: sr.beat_id,
          setup_book: sr.book,
          setup_chapter: sr.chapter,
          setup_beat_idx: sr.beat_idx,
          payoff_beat_id: null,
          payoff_chapter: null,
          payoff_beat_idx: null,
          distance_chapters: null,
          match_confidence: null,
          match_note: "[setup beat lookup failed]",
        }
        return null
      }
      const sameBook = beatsByBook.get(sr.book) ?? []
      const setupKey = chapterOrderKey(sr.chapter)
      // Strictly later beats: later chapter, OR same chapter but later beat_idx.
      const allLater = sameBook.filter((c) => {
        const ck = chapterOrderKey(c.chapter)
        if (ck > setupKey) return true
        if (ck === setupKey && c.beat_idx > sr.beat_idx) return true
        return false
      })
      if (allLater.length === 0) {
        matches[idx] = {
          setup_beat_id: sr.beat_id,
          setup_book: sr.book,
          setup_chapter: sr.chapter,
          setup_beat_idx: sr.beat_idx,
          payoff_beat_id: null,
          payoff_chapter: null,
          payoff_beat_idx: null,
          distance_chapters: null,
          match_confidence: null,
          match_note: "[no later beats in book]",
        }
        return null
      }
      // Cap candidates: keep all if <= cap, else sample uniformly chronologically.
      let candidates: Beat[]
      if (allLater.length <= PAYOFF_MAX_CANDIDATES) {
        candidates = allLater
      } else {
        const step = allLater.length / PAYOFF_MAX_CANDIDATES
        candidates = []
        for (let i = 0; i < PAYOFF_MAX_CANDIDATES; i++) {
          candidates.push(allLater[Math.floor(i * step)])
        }
      }

      const userPrompt = buildPayoffUserPrompt(setupBeat, sr.what_is_planted, candidates)
      try {
        const { raw, promptTokens, completionTokens } = await callDeepSeekJson(
          PAYOFF_SYSTEM_PROMPT,
          userPrompt,
          key,
          400,
        )
        addTokens(promptTokens, completionTokens)
        let parsed: any
        try {
          parsed = JSON.parse(raw)
        } catch {
          throw new Error(`non-JSON response: ${raw.slice(0, 200)}`)
        }
        const pid = parsed.payoff_beat_id
        if (!pid || pid === "null" || typeof pid !== "string") {
          matches[idx] = {
            setup_beat_id: sr.beat_id,
            setup_book: sr.book,
            setup_chapter: sr.chapter,
            setup_beat_idx: sr.beat_idx,
            payoff_beat_id: null,
            payoff_chapter: null,
            payoff_beat_idx: null,
            distance_chapters: null,
            match_confidence: parsed.match_confidence ?? null,
            match_note: String(parsed.note ?? "").slice(0, 200) || "[no payoff found]",
          }
          return null
        }
        const payoffBeat = candidates.find((c) => beatId(c) === pid)
        if (!payoffBeat) {
          matches[idx] = {
            setup_beat_id: sr.beat_id,
            setup_book: sr.book,
            setup_chapter: sr.chapter,
            setup_beat_idx: sr.beat_idx,
            payoff_beat_id: null,
            payoff_chapter: null,
            payoff_beat_idx: null,
            distance_chapters: null,
            match_confidence: null,
            match_note: `[hallucinated payoff_beat_id: ${pid.slice(0, 80)}]`,
          }
          return null
        }
        matches[idx] = {
          setup_beat_id: sr.beat_id,
          setup_book: sr.book,
          setup_chapter: sr.chapter,
          setup_beat_idx: sr.beat_idx,
          payoff_beat_id: beatId(payoffBeat),
          payoff_chapter: payoffBeat.chapter,
          payoff_beat_idx: payoffBeat.beat_idx,
          distance_chapters: chapterDistance(sr.chapter, payoffBeat.chapter),
          match_confidence:
            parsed.match_confidence === "high" || parsed.match_confidence === "medium" || parsed.match_confidence === "low"
              ? parsed.match_confidence
              : "medium",
          match_note: String(parsed.note ?? "").slice(0, 200),
        }
      } catch (err) {
        console.error(`  payoff err on ${sr.beat_id}:`, (err as Error).message.slice(0, 120))
        matches[idx] = {
          setup_beat_id: sr.beat_id,
          setup_book: sr.book,
          setup_chapter: sr.chapter,
          setup_beat_idx: sr.beat_idx,
          payoff_beat_id: null,
          payoff_chapter: null,
          payoff_beat_idx: null,
          distance_chapters: null,
          match_confidence: null,
          match_note: `[payoff-error]`,
        }
      }
      return null
    },
    (done, total) => {
      if (done % 25 === 0) console.log(`  payoffs: ${done}/${total}`)
    },
  )
  await tokenLockMutex
  return { matches, tokens: { input: totalIn, output: totalOut } }
}

// ----- aggregation -----------------------------------------------------------

function summarizeSetupDensity(rows: FullSetupRow[]): Record<string, any> {
  const byBook: Record<string, FullSetupRow[]> = {}
  for (const r of rows) {
    if (!byBook[r.book]) byBook[r.book] = []
    byBook[r.book].push(r)
  }
  const out: Record<string, any> = {}
  for (const [book, brows] of Object.entries(byBook)) {
    const setups = brows.filter((r) => r.is_setup)
    const setupRate = brows.length === 0 ? 0 : setups.length / brows.length
    // Per-chapter density.
    const byCh: Record<string, { total: number; setups: number }> = {}
    for (const r of brows) {
      const k = String(r.chapter)
      if (!byCh[k]) byCh[k] = { total: 0, setups: 0 }
      byCh[k].total += 1
      if (r.is_setup) byCh[k].setups += 1
    }
    const chapterDensities = Object.entries(byCh).map(([ch, v]) => ({
      chapter: ch,
      total_beats: v.total,
      setup_beats: v.setups,
      setup_rate: Math.round((v.setups / v.total) * 1000) / 1000,
    }))
    chapterDensities.sort((a, b) => chapterOrderKey(a.chapter) - chapterOrderKey(b.chapter))
    out[book] = {
      total_beats: brows.length,
      setup_beats: setups.length,
      setup_rate: Math.round(setupRate * 1000) / 1000,
      chapters: chapterDensities,
    }
  }
  return out
}

function summarizePayoffDistance(matches: PayoffMatch[]): Record<string, any> {
  const byBook: Record<string, PayoffMatch[]> = {}
  for (const m of matches) {
    if (!byBook[m.setup_book]) byBook[m.setup_book] = []
    byBook[m.setup_book].push(m)
  }
  const out: Record<string, any> = {}
  for (const [book, ms] of Object.entries(byBook)) {
    const matched = ms.filter((m) => m.distance_chapters !== null)
    const distances = matched.map((m) => m.distance_chapters!) as number[]
    distances.sort((a, b) => a - b)
    // Bucketed: 0 (same chapter), 1-3, 4-9, 10+
    const bucket = { same_chapter: 0, near_1_3: 0, mid_4_9: 0, far_10_plus: 0 }
    for (const d of distances) {
      if (d === 0) bucket.same_chapter += 1
      else if (d <= 3) bucket.near_1_3 += 1
      else if (d <= 9) bucket.mid_4_9 += 1
      else bucket.far_10_plus += 1
    }
    const stats = {
      n_setups: ms.length,
      n_matched: matched.length,
      match_rate: ms.length === 0 ? 0 : Math.round((matched.length / ms.length) * 1000) / 1000,
      mean_distance: distances.length === 0 ? null : Math.round((distances.reduce((a, b) => a + b, 0) / distances.length) * 100) / 100,
      median_distance: distances.length === 0 ? null : distances[Math.floor(distances.length / 2)],
      p25: distances.length === 0 ? null : distances[Math.floor(distances.length * 0.25)],
      p75: distances.length === 0 ? null : distances[Math.floor(distances.length * 0.75)],
      max_distance: distances.length === 0 ? null : distances[distances.length - 1],
      buckets: bucket,
    }
    out[book] = stats
  }
  // Cross-book aggregate.
  const allMatched = matches.filter((m) => m.distance_chapters !== null)
  const allD = allMatched.map((m) => m.distance_chapters!) as number[]
  allD.sort((a, b) => a - b)
  const aggBucket = { same_chapter: 0, near_1_3: 0, mid_4_9: 0, far_10_plus: 0 }
  for (const d of allD) {
    if (d === 0) aggBucket.same_chapter += 1
    else if (d <= 3) aggBucket.near_1_3 += 1
    else if (d <= 9) aggBucket.mid_4_9 += 1
    else aggBucket.far_10_plus += 1
  }
  out._aggregate = {
    n_setups: matches.length,
    n_matched: allMatched.length,
    match_rate: matches.length === 0 ? 0 : Math.round((allMatched.length / matches.length) * 1000) / 1000,
    mean_distance: allD.length === 0 ? null : Math.round((allD.reduce((a, b) => a + b, 0) / allD.length) * 100) / 100,
    median_distance: allD.length === 0 ? null : allD[Math.floor(allD.length / 2)],
    p25: allD.length === 0 ? null : allD[Math.floor(allD.length * 0.25)],
    p75: allD.length === 0 ? null : allD[Math.floor(allD.length * 0.75)],
    max_distance: allD.length === 0 ? null : allD[allD.length - 1],
    buckets: aggBucket,
  }
  return out
}

// ----- main ------------------------------------------------------------------

async function main() {
  const key = loadEnvKey()
  const beats = loadBeats()
  console.log(`loaded ${beats.length} beats across 3 IWD books`)

  const ts = tsStamp()
  const isoTs = new Date().toISOString()
  const outPath = join(OUT_DIR, `crystal_shard.${ts}.setup-payoff-distance.json`)

  const startMs = Date.now()
  const tokenLedger = { calibration_in: 0, calibration_out: 0, full_setup_in: 0, full_setup_out: 0, payoff_in: 0, payoff_out: 0 }

  // Stage 1 — calibration.
  console.log("\n=== STAGE 1: CALIBRATION ===")
  const cal = await runCalibration(beats, key)
  tokenLedger.calibration_in = cal.tokens.input
  tokenLedger.calibration_out = cal.tokens.output
  console.log(`calibration aggregate J = ${cal.aggregateJ.toFixed(3)}`)
  console.log(`calibration per-book min J = ${Math.min(...cal.perBook.map((r) => r.jaccard)).toFixed(3)}`)
  console.log(`calibration verdict: ${cal.pass ? "PASS (proceed to full pipeline)" : "FAIL (binary too noisy; setup-density-only fallback)"}`)

  if (CALIBRATE_ONLY) {
    const payload = {
      timestamp: isoTs,
      stage: "calibrate-only",
      calibration: cal,
      token_ledger: tokenLedger,
      setup_labels: null,
      payoff_pairs: null,
      setup_density: null,
      payoff_distance: null,
    }
    writeFileSync(outPath, JSON.stringify(payload, null, 2))
    console.log(`wrote ${outPath}`)
    appendConclusions(isoTs, ts, payload, beats.length, Date.now() - startMs)
    return
  }

  // Stage 2 — full setup labeling. Always run.
  console.log("\n=== STAGE 2: FULL SETUP LABELING ===")
  const full = await runFullSetupLabeling(beats, key)
  tokenLedger.full_setup_in = full.tokens.input
  tokenLedger.full_setup_out = full.tokens.output
  const setupDensity = summarizeSetupDensity(full.rows)
  console.log("setup density per-book:")
  for (const [book, info] of Object.entries(setupDensity)) {
    console.log(`  ${book}: ${(info as any).setup_beats}/${(info as any).total_beats} = ${(info as any).setup_rate}`)
  }

  // Stage 3 — payoff matching, GATED on calibration PASS and not --skip-pairs.
  let payoffMatches: PayoffMatch[] | null = null
  let payoffDistance: Record<string, any> | null = null

  if (!SKIP_PAIRS && cal.pass) {
    console.log("\n=== STAGE 3: PAYOFF MATCHING ===")
    const po = await runPayoffMatching(beats, full.rows, key)
    tokenLedger.payoff_in = po.tokens.input
    tokenLedger.payoff_out = po.tokens.output
    payoffMatches = po.matches
    payoffDistance = summarizePayoffDistance(po.matches)
    console.log("payoff distance per-book:")
    for (const [book, info] of Object.entries(payoffDistance)) {
      const s = info as any
      console.log(`  ${book}: matched=${s.n_matched}/${s.n_setups} (${s.match_rate}); med=${s.median_distance} mean=${s.mean_distance} max=${s.max_distance}`)
    }
  } else {
    console.log("\n=== STAGE 3 SKIPPED ===")
    console.log(cal.pass ? "(skipped per --skip-pairs)" : "(calibration FAILED — falling back to setup-density-only)")
  }

  const payload = {
    timestamp: isoTs,
    stage: payoffMatches ? "full" : (cal.pass ? "setup-only-skipped-pairs" : "setup-only-calibration-fail"),
    calibration: cal,
    token_ledger: tokenLedger,
    setup_labels: full.rows,
    setup_density: setupDensity,
    payoff_pairs: payoffMatches,
    payoff_distance: payoffDistance,
  }
  writeFileSync(outPath, JSON.stringify(payload, null, 2))
  console.log(`wrote ${outPath}`)
  appendConclusions(isoTs, ts, payload, beats.length, Date.now() - startMs)
}

// ----- conclusions append ----------------------------------------------------

function approxCostUsd(tokens: { calibration_in: number; calibration_out: number; full_setup_in: number; full_setup_out: number; payoff_in: number; payoff_out: number }): number {
  // V4 Flash pricing $0.14 in / $0.28 out per M (no cache assumption — system prompt should still hit)
  const inTotal = tokens.calibration_in + tokens.full_setup_in + tokens.payoff_in
  const outTotal = tokens.calibration_out + tokens.full_setup_out + tokens.payoff_out
  const inUsd = (inTotal / 1_000_000) * 0.14
  const outUsd = (outTotal / 1_000_000) * 0.28
  return Math.round((inUsd + outUsd) * 100) / 100
}

function appendConclusions(isoTs: string, ts: string, payload: any, totalBeats: number, elapsedMs: number) {
  const cal = payload.calibration as { perBook: CalibrationBookResult[]; aggregateJ: number; pass: boolean }
  const sd = payload.setup_density as Record<string, any> | null
  const pd = payload.payoff_distance as Record<string, any> | null
  const cost = approxCostUsd(payload.token_ledger)
  const elapsedMin = (elapsedMs / 60000).toFixed(1)

  const calibrationTable = cal.perBook
    .map(
      (r) =>
        `| ${r.book} | ${r.n} | ${r.jaccard.toFixed(3)} | ${r.pos_run1} | ${r.pos_run2} | ${r.agreement_count}/${r.n} |`,
    )
    .join("\n")

  let setupDensityBlock = ""
  if (sd) {
    setupDensityBlock = `

**Setup density (full pass, every beat tagged):**

| Book | Total beats | Setup beats | Setup rate |
|---|---:|---:|---:|
${Object.entries(sd)
  .map(([book, info]) => `| ${book} | ${(info as any).total_beats} | ${(info as any).setup_beats} | ${((info as any).setup_rate * 100).toFixed(1)}% |`)
  .join("\n")}
`
  }

  let payoffBlock = ""
  if (pd) {
    const agg = pd._aggregate
    const perBookRows = Object.entries(pd)
      .filter(([k]) => k !== "_aggregate")
      .map(([book, info]) => {
        const s = info as any
        return `| ${book} | ${s.n_matched}/${s.n_setups} | ${(s.match_rate * 100).toFixed(1)}% | ${s.median_distance} | ${s.mean_distance} | ${s.max_distance} | ${s.buckets.same_chapter}/${s.buckets.near_1_3}/${s.buckets.mid_4_9}/${s.buckets.far_10_plus} |`
      })
      .join("\n")
    payoffBlock = `

**Payoff distance (chapters between setup and matched payoff):**

| Book | Matched | Match rate | Median | Mean | Max | 0 / 1–3 / 4–9 / 10+ |
|---|---|---:|---:|---:|---:|---|
${perBookRows}
| **aggregate** | ${agg.n_matched}/${agg.n_setups} | ${(agg.match_rate * 100).toFixed(1)}% | ${agg.median_distance} | ${agg.mean_distance} | ${agg.max_distance} | ${agg.buckets.same_chapter}/${agg.buckets.near_1_3}/${agg.buckets.mid_4_9}/${agg.buckets.far_10_plus} |
`
  } else {
    payoffBlock = `

**Payoff matching:** ${cal.pass ? "skipped per --skip-pairs flag" : "**NOT RUN** — calibration FAILED. Setup-density-only fallback per task brief."}
`
  }

  const verdict = cal.pass
    ? `**Calibration PASS** (per-book min J = ${Math.min(...cal.perBook.map((r) => r.jaccard)).toFixed(3)} ≥ 0.70 threshold). The binary "is this a setup" tag is sufficiently stable to ship.`
    : `**Calibration FAIL** (per-book min J = ${Math.min(...cal.perBook.map((r) => r.jaccard)).toFixed(3)} < 0.70 threshold). The binary itself is too noisy. Pair-identification was NOT attempted; setup-density-only fallback is reported.`

  const md = `

## Session ${isoTs} — Pattern 28: Setup-to-payoff distance distribution (3-book)

### Methodology

Pattern 28 from the corpus pattern catalog. Defensive 3-stage design per task brief:

1. **Calibration** — n=50 random beats per book (deterministic hash-sampled, salt \`calibration_v1\`) × 2 runs of the binary "is this a setup that pays off in a later chapter" tag at T=0. Measure per-book and aggregate Jaccard on the positive set. **PASS gate: per-book min J ≥ 0.70.** If FAIL, stop and report setup-density only.
2. **Full setup labels** — every beat (n=${totalBeats}) tagged via the same prompt. Always run regardless of calibration verdict (still useful as setup-density planner prior).
3. **Payoff matching** — only if calibration PASS and \`--skip-pairs\` not set. For each high/medium-confidence setup, send the setup beat plus up to 60 chronologically-sampled later candidates from the SAME book to the LLM; ask it to pick the closest matching payoff beat_id or null.

Provider: DeepSeek V4 Flash, \`thinking: disabled\`, T=0, \`response_format: json_object\`. Cost cap $5; actual ≈ \$${cost.toFixed(2)} on this run.

### Calibration result

| Book | n | Jaccard (run1↔run2) | run1 positives | run2 positives | Agreement |
|---|---:|---:|---:|---:|---:|
${calibrationTable}

Aggregate J across 3 books: **${cal.aggregateJ.toFixed(3)}**.
${setupDensityBlock}${payoffBlock}

### Conclusion + Action

${verdict}

${cal.pass && pd
  ? `**Payoff distance signal.** Aggregate match rate ${((pd._aggregate.match_rate || 0) * 100).toFixed(1)}% (matched ${pd._aggregate.n_matched}/${pd._aggregate.n_setups} setups). Aggregate median distance ${pd._aggregate.median_distance} chapters; mean ${pd._aggregate.mean_distance}; max ${pd._aggregate.max_distance}. Distribution shape: ${pd._aggregate.buckets.same_chapter} same-chapter / ${pd._aggregate.buckets.near_1_3} near (1–3 ch) / ${pd._aggregate.buckets.mid_4_9} mid (4–9 ch) / ${pd._aggregate.buckets.far_10_plus} far (10+ ch). Per-book directional verdict requires reading the table above — match-rate stability across the 3 books is the stronger signal than absolute distance values, since the labeler has known noise on payoff identification.`
  : sd
    ? `**Setup density signal (fallback).** Per-book setup rate is the directional signal even without the payoff side. Cross-book stability of the setup rate informs whether "what fraction of beats plant something material" is a stable corpus property.`
    : ""}

**Methodological caveats** (per the task brief):
- **Pair-identification noise is the dominant risk.** Even at calibration PASS on the binary, the payoff-matching step is fundamentally harder because each LLM call must hold the planted clause in mind and scan up to 60 candidate summaries for a soft semantic match. Match-rate < 100% means the labeler said "no payoff in candidate list" for some setups — could be genuine open threads (series hooks) or labeler failure.
- **Anchor stability degrades with class count.** This run keeps the binary at the calibration-anchor level and reports raw chapter distance as a number rather than bucketing into 3+ classes. The 0 / 1–3 / 4–9 / 10+ buckets in the table are aggregation-only and do not have anchor-stability measurement.
- **Setup density is a defensible planner prior even if pair-matching is unstable.** Use the setup-rate per book as the cross-book directional check.

**Harness target.** If signal is stable across books, this becomes a per-chapter setup-density prior in \`src/agents/planning-scenes/scene-expansion-system.md\` ("typically 30–50% of beats per chapter plant something that pays off later in the book"). The distance distribution informs how the chapter-skeleton plotter should think about how far ahead to plant — but only ships as a planner constraint after the pair-identification step is validated against a Sonnet anchor (next experiment, deferred).

### Cost ledger

- Calibration: ${payload.token_ledger.calibration_in.toLocaleString()} input / ${payload.token_ledger.calibration_out.toLocaleString()} output
- Full setup: ${payload.token_ledger.full_setup_in.toLocaleString()} input / ${payload.token_ledger.full_setup_out.toLocaleString()} output
- Payoff: ${payload.token_ledger.payoff_in.toLocaleString()} input / ${payload.token_ledger.payoff_out.toLocaleString()} output
- **Approx total: \$${cost.toFixed(2)}** ($0.14/M input, $0.28/M output)
- Wallclock: ${elapsedMin} min

### Artifacts

\`crystal_shard.${ts}.setup-payoff-distance.json\` — full payload (calibration runs, setup labels, payoff pairs, density + distance summaries).

---
`
  const existing = readFileSync(CONCLUSIONS_PATH, "utf8")
  writeFileSync(CONCLUSIONS_PATH, existing + md)
  console.log(`appended conclusions section to ${CONCLUSIONS_PATH}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
