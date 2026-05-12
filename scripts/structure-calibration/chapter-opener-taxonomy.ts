// Build a taxonomy of CHAPTER OPENINGS across the 3 Icewind Dale books.
//
// For each (book, chapter) pair, the FIRST beat (lowest beat_idx within chapter)
// is the opener. Classify each opener into one of seven buckets:
//   - in-media-res-action
//   - scene-set-description
//   - dialogue-first
//   - interior-reflection
//   - time-cut-announcement
//   - callback-or-summary
//   - other
//
// Pipeline: regex pre-pass for low-hanging fruit (dialogue-first / time-cut),
// then DeepSeek V4 Flash for the residual. Cost <$1.
//
// Output: timestamped JSON at
//   novels/salvatore-icewind-dale/structure-calibration/crystal_shard.<TS>.chapter-opener-taxonomy.json
//
// Mirrors the forward-hook-shape taxonomy
// (crystal_shard.20260430T113934.forward-hook-shape.json) for opener-side priors
// in the planner.

import { readFileSync, writeFileSync } from "node:fs"
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
  // Mostly numeric chapter index, but the corpus also uses string IDs
  // ("prelude", "epilogue", "epilogue2", "epilogue3", "part1"–"part3") for
  // Salvatore's structural divisions. Keep it as a free string for routing.
  chapter: number | string
}

const BUCKETS = [
  "in-media-res-action",
  "scene-set-description",
  "dialogue-first",
  "interior-reflection",
  "time-cut-announcement",
  "callback-or-summary",
  "other",
] as const
type Bucket = typeof BUCKETS[number]

type ChapterEntry = {
  book: string
  chapter: number | string
  opener_text_excerpt: string
  first_sentence: string
  classification: Bucket
  source: "regex" | "llm"
  confidence: "high" | "medium" | "low"
  note?: string
  regex_flags: { dialogueFirst: boolean; timeCutOpener: boolean }
}

// ----- regex pre-pass --------------------------------------------------------

// Sentence-initial dialogue: first non-whitespace char is " or “
function isDialogueFirst(firstSentence: string): boolean {
  const s = firstSentence.trim()
  if (!s) return false
  const c = s[0]
  return c === '"' || c === "“" /* “ */ || c === "‘" /* ' */ || c === "'"
}

// Time-cut announcement at sentence start. Borrowed from
// crystal_shard.20260430T073305.time-cut-markers.json `between_chapter` set
// plus the `that_*` family for opening-position usage.
const TIME_CUT_OPENER_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "the_next_morning", re: /^[\s"'“‘]*The next morning\b/i },
  { label: "the_next_day", re: /^[\s"'“‘]*The next day\b/i },
  { label: "the_next_night", re: /^[\s"'“‘]*The next night\b/i },
  { label: "the_next_evening", re: /^[\s"'“‘]*The next evening\b/i },
  { label: "the_next_afternoon", re: /^[\s"'“‘]*The next afternoon\b/i },
  { label: "the_following", re: /^[\s"'“‘]*The following (?:day|morning|night|week|month|year|evening|afternoon)\b/i },
  { label: "that_night", re: /^[\s"'“‘]*That night\b/i },
  { label: "that_morning", re: /^[\s"'“‘]*That morning\b/i },
  { label: "that_evening", re: /^[\s"'“‘]*That evening\b/i },
  { label: "that_afternoon", re: /^[\s"'“‘]*That afternoon\b/i },
  { label: "that_same", re: /^[\s"'“‘]*That same (?:night|morning|evening|afternoon|day)\b/i },
  { label: "later_that", re: /^[\s"'“‘]*Later that (?:night|morning|evening|afternoon|day|same day|week|month)\b/i },
  { label: "hours_later", re: /^[\s"'“‘]*(?:An?\s+)?Hours? (?:had )?(?:later|passed)\b/i },
  { label: "moments_later", re: /^[\s"'“‘]*Moments? later\b/i },
  { label: "a_moment_later", re: /^[\s"'“‘]*A moment later\b/i },
  { label: "minutes_later", re: /^[\s"'“‘]*(?:A few )?Minutes? later\b/i },
  { label: "days_later", re: /^[\s"'“‘]*(?:Two |Three |Four |Five |Six |Seven |Eight |Nine |Ten |Several |Many |A few |Some )?Days? (?:had )?(?:later|passed)\b/i },
  { label: "weeks_later", re: /^[\s"'“‘]*(?:Two |Three |Four |Five |Six |Several |Many |A few |Some )?Weeks? (?:had )?(?:later|passed)\b/i },
  { label: "months_later", re: /^[\s"'“‘]*(?:Two |Three |Four |Five |Six |Several |Many |A few |Some |A )?Months? (?:had )?(?:later|passed)\b/i },
  { label: "years_later", re: /^[\s"'“‘]*(?:Two |Three |Four |Five |Many |Several )?Years? (?:had )?(?:later|passed)\b/i },
  { label: "by_dawn", re: /^[\s"'“‘]*By (?:the )?(?:dawn|morning|nightfall|dusk|midday|sunrise|sunset|midnight)\b/i },
  { label: "at_dawn", re: /^[\s"'“‘]*At (?:dawn|dusk|sunrise|sunset|midnight|noon|first light)\b/i },
  { label: "when_dawn", re: /^[\s"'“‘]*When (?:the )?(?:dawn|morning|sun rose|sun set|night fell|day broke)\b/i },
  { label: "as_the_sun", re: /^[\s"'“‘]*As (?:the )?(?:sun rose|sun set|dawn broke|night fell|day broke)\b/i },
  { label: "shortly_after", re: /^[\s"'“‘]*Shortly (?:after(?:ward)?|thereafter)\b/i },
  { label: "soon_after", re: /^[\s"'“‘]*Soon (?:after(?:ward)?|thereafter)\b/i },
  { label: "fortnight", re: /^[\s"'“‘]*A fortnight\b/i },
  { label: "long_after", re: /^[\s"'“‘]*(?:Long |Not long )(?:after|later)\b/i },
  { label: "presently", re: /^[\s"'“‘]*Presently,?\s/i },
]

function timeCutOpenerLabel(text: string): string | null {
  const t = text.trimStart()
  for (const p of TIME_CUT_OPENER_PATTERNS) {
    if (p.re.test(t)) return p.label
  }
  return null
}

// ----- LLM labeller (DeepSeek V4 Flash) --------------------------------------

const SYSTEM_PROMPT = `You classify chapter OPENINGS in fiction prose into one of seven buckets:

- in-media-res-action — opens with characters mid-action / mid-conflict / mid-movement; no scene-setting first; we are dropped into the middle of a physical event.
- scene-set-description — opens with setting / atmosphere / world description first (place, weather, geography, building, terrain), characters arrive later in the opener.
- dialogue-first — opens with a line of spoken dialogue (first sentence is quoted speech).
- interior-reflection — opens inside a character's POV — thoughts, memory, emotion, philosophical reflection — before any external action.
- time-cut-announcement — opens with explicit time-jump phrasing ("That night,", "The next morning,", "Three weeks later,", "By dawn,") that marks a temporal gap from the previous chapter.
- callback-or-summary — opens by referencing or summarizing prior events / off-page happenings (recap-style narration, "Since the events of...", historical summary, narrator-distant narration of recent past).
- other — fits none of the above.

Output JSON only:
{ "classification": "<bucket>", "confidence": "high"|"medium"|"low", "note": "<one short clause>" }

Pick the SINGLE most dominant opening rhetorical move. If a chapter opens with a time-cut phrase ("That night,") AND continues into description, classify as time-cut-announcement only if the time-cut phrase is the foreground move; otherwise pick the bucket that better describes what the rest of the opener does. If the opener mixes description and action, pick the move that takes the first 1-2 sentences. "in-media-res-action" requires that the opener throws us into ongoing physical action; if action only appears after a paragraph of setup, the bucket is scene-set-description or interior-reflection.`

type LlmLabel = { classification: Bucket; confidence: "high" | "medium" | "low"; note: string }

async function callDeepSeek(opener: string, key: string): Promise<LlmLabel> {
  const userPrompt = `OPENING TEXT (first beat of chapter, may be truncated):

${opener}

---
Classify into one bucket. Respond JSON only.`

  const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
      // DeepSeek V4 Flash defaults to thinking-mode; without an explicit
      // disable the chain-of-thought consumes max_tokens before any answer
      // content is emitted. Off here for a tight JSON-only labeling task.
      thinking: { type: "disabled" },
    }),
  })
  if (!r.ok) throw new Error(`DeepSeek HTTP ${r.status}: ${await r.text()}`)
  const j = (await r.json()) as any
  const raw = (j.choices?.[0]?.message?.content ?? "").trim()
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`DeepSeek returned non-JSON: ${raw.slice(0, 200)}`)
  }
  const cls = String(parsed.classification || "").trim() as Bucket
  if (!BUCKETS.includes(cls)) {
    throw new Error(`unrecognized bucket from LLM: ${cls}`)
  }
  const conf = parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
    ? parsed.confidence
    : "medium"
  return { classification: cls, confidence: conf, note: String(parsed.note || "").slice(0, 240) }
}

// ----- main ------------------------------------------------------------------

const ROOT = "/Users/andre/Desktop/personal_projects/novel-harness"
const BEATS_PATH = join(ROOT, "novels/salvatore-icewind-dale/beats.jsonl")
const OUT_DIR = join(ROOT, "novels/salvatore-icewind-dale/structure-calibration")
const CONCLUSIONS_PATH = join(OUT_DIR, "crystal_shard-conclusions.md")

function tsStamp(d = new Date()): string {
  // YYYYMMDDTHHMMSS in UTC for filename consistency with other artifacts
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  )
}

function loadOpeners(): Beat[] {
  const lines = readFileSync(BEATS_PATH, "utf8").trim().split("\n")
  const byBookCh = new Map<string, Beat[]>()
  for (const line of lines) {
    const r = JSON.parse(line) as Beat
    const k = `${r.book}|${r.chapter}`
    let arr = byBookCh.get(k)
    if (!arr) {
      arr = []
      byBookCh.set(k, arr)
    }
    arr.push(r)
  }
  const openers: Beat[] = []
  for (const beats of byBookCh.values()) {
    beats.sort((a, b) => a.beat_idx - b.beat_idx)
    openers.push(beats[0])
  }
  // Sort openers by book then chapter for stable output order. Chapter IDs are
  // numeric for body chapters and string for prelude/epilogue/parts; numeric
  // first, then strings alphabetically.
  const bookOrder = ["crystal_shard", "streams_of_silver", "halflings_gem"]
  openers.sort((a, b) => {
    const bo = bookOrder.indexOf(a.book) - bookOrder.indexOf(b.book)
    if (bo !== 0) return bo
    const an = typeof a.chapter === "number"
    const bn = typeof b.chapter === "number"
    if (an && bn) return (a.chapter as number) - (b.chapter as number)
    if (an && !bn) return -1
    if (!an && bn) return 1
    return String(a.chapter).localeCompare(String(b.chapter))
  })
  return openers
}

function buildOpenerExcerpt(beat: Beat, maxChars = 1200): string {
  const text = (beat.text || "").trim()
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars).trimEnd() + " […]"
}

function emptyDistribution(): Record<Bucket, { count: number; pct: number }> {
  const out = {} as Record<Bucket, { count: number; pct: number }>
  for (const b of BUCKETS) out[b] = { count: 0, pct: 0 }
  return out
}

function tally(entries: ChapterEntry[]): Record<Bucket, { count: number; pct: number }> {
  const dist = emptyDistribution()
  for (const e of entries) dist[e.classification].count += 1
  const n = entries.length
  for (const b of BUCKETS) {
    dist[b].pct = n === 0 ? 0 : Math.round((dist[b].count / n) * 1000) / 10
  }
  return dist
}

async function main() {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw new Error("DEEPSEEK_API_KEY not set in env")

  const openers = loadOpeners()
  console.log(`loaded ${openers.length} chapter-opener beats`)
  if (openers.length !== 92) {
    console.warn(`WARN: expected 92 openers (34+29+29), got ${openers.length}`)
  }

  // Regex pre-pass.
  const entries: ChapterEntry[] = []
  let regexResolved = 0
  let needLlm: Beat[] = []
  for (const b of openers) {
    const dialogueFirst = isDialogueFirst(b.first_sentence || b.text || "")
    const tcLabel = timeCutOpenerLabel(b.text || "")
    const flags = { dialogueFirst, timeCutOpener: tcLabel !== null }

    // Resolution priority: dialogue-first (visually unambiguous) wins over time-cut
    // even if both fire (e.g. chapter that opens with a quoted "That night...").
    // In practice these almost never co-fire on chapter openers.
    if (dialogueFirst) {
      entries.push({
        book: b.book,
        chapter: b.chapter,
        opener_text_excerpt: buildOpenerExcerpt(b),
        first_sentence: (b.first_sentence || "").slice(0, 240),
        classification: "dialogue-first",
        source: "regex",
        confidence: "high",
        note: "First sentence opens with a quoted line of dialogue.",
        regex_flags: flags,
      })
      regexResolved += 1
      continue
    }
    if (tcLabel) {
      entries.push({
        book: b.book,
        chapter: b.chapter,
        opener_text_excerpt: buildOpenerExcerpt(b),
        first_sentence: (b.first_sentence || "").slice(0, 240),
        classification: "time-cut-announcement",
        source: "regex",
        confidence: "high",
        note: `Sentence-initial time-cut marker (${tcLabel}).`,
        regex_flags: flags,
      })
      regexResolved += 1
      continue
    }
    needLlm.push(b)
  }
  console.log(`regex pre-pass: ${regexResolved}/${openers.length} resolved (${needLlm.length} -> LLM)`)

  // LLM pass with bounded concurrency.
  const CONCURRENCY = 4
  const queue = [...needLlm]
  const llmResults = new Map<string, ChapterEntry>()
  let calls = 0

  async function worker() {
    while (queue.length > 0) {
      const b = queue.shift()
      if (!b) return
      const opener = buildOpenerExcerpt(b)
      try {
        const label = await callDeepSeek(opener, key!)
        const e: ChapterEntry = {
          book: b.book,
          chapter: b.chapter,
          opener_text_excerpt: opener,
          first_sentence: (b.first_sentence || "").slice(0, 240),
          classification: label.classification,
          source: "llm",
          confidence: label.confidence,
          note: label.note,
          regex_flags: { dialogueFirst: false, timeCutOpener: false },
        }
        llmResults.set(`${b.book}|${b.chapter}`, e)
        calls += 1
        if (calls % 10 === 0) console.log(`  llm progress: ${calls}/${needLlm.length}`)
      } catch (err) {
        console.error(`LLM error on ${b.book} ch${b.chapter}:`, (err as Error).message)
        // mark as "other" with low confidence so the run still produces output.
        llmResults.set(`${b.book}|${b.chapter}`, {
          book: b.book,
          chapter: b.chapter,
          opener_text_excerpt: opener,
          first_sentence: (b.first_sentence || "").slice(0, 240),
          classification: "other",
          source: "llm",
          confidence: "low",
          note: `LLM error: ${(err as Error).message.slice(0, 120)}`,
          regex_flags: { dialogueFirst: false, timeCutOpener: false },
        })
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  console.log(`llm pass: ${calls}/${needLlm.length} calls completed`)

  // Stitch llm results back into entries, preserving original order.
  const regexByKey = new Map<string, ChapterEntry>()
  for (const e of entries) regexByKey.set(`${e.book}|${e.chapter}`, e)
  const finalEntries: ChapterEntry[] = []
  for (const b of openers) {
    const k = `${b.book}|${b.chapter}`
    const fromRegex = regexByKey.get(k)
    if (fromRegex) {
      finalEntries.push(fromRegex)
      continue
    }
    const fromLlm = llmResults.get(k)
    if (!fromLlm) throw new Error(`missing classification for ${k}`)
    finalEntries.push(fromLlm)
  }

  // Aggregate.
  const aggDist = tally(finalEntries)
  const perBook: Record<string, { n: number; distribution: Record<Bucket, { count: number; pct: number }> }> = {}
  for (const book of ["crystal_shard", "streams_of_silver", "halflings_gem"]) {
    const sub = finalEntries.filter((e) => e.book === book)
    perBook[book] = { n: sub.length, distribution: tally(sub) }
  }

  // Cheap directional check: does the modal class hold across all 3 books?
  const modalPerBook: Record<string, Bucket> = {}
  for (const [book, info] of Object.entries(perBook)) {
    let best: Bucket = "other"
    let bestPct = -1
    for (const b of BUCKETS) {
      if (info.distribution[b].pct > bestPct) {
        bestPct = info.distribution[b].pct
        best = b
      }
    }
    modalPerBook[book] = best
  }
  const modalSet = new Set(Object.values(modalPerBook))
  let directional: string
  if (modalSet.size === 1) {
    directional = `Modal class holds across all 3 books: ${[...modalSet][0]}.`
  } else {
    directional = `Modal class diverges by book: ${JSON.stringify(modalPerBook)}.`
  }
  // Ordering check: do top-3 ranks agree pairwise?
  function top3(d: Record<Bucket, { count: number; pct: number }>): Bucket[] {
    return [...BUCKETS].sort((a, b) => d[b].pct - d[a].pct).slice(0, 3)
  }
  const t3 = {
    crystal_shard: top3(perBook.crystal_shard.distribution),
    streams_of_silver: top3(perBook.streams_of_silver.distribution),
    halflings_gem: top3(perBook.halflings_gem.distribution),
  }
  const intersectAll = t3.crystal_shard.filter(
    (b) => t3.streams_of_silver.includes(b) && t3.halflings_gem.includes(b),
  )
  directional += ` Top-3 buckets: cs=${t3.crystal_shard.join("/")}, ss=${t3.streams_of_silver.join("/")}, hg=${t3.halflings_gem.join("/")}. Intersection of all three top-3 sets has ${intersectAll.length} buckets: ${intersectAll.join(", ") || "(none)"}.`

  const ts = tsStamp()
  const isoTs = new Date().toISOString()
  const outPath = join(OUT_DIR, `crystal_shard.${ts}.chapter-opener-taxonomy.json`)

  const payload = {
    timestamp: isoTs,
    n_chapters: finalEntries.length,
    buckets: BUCKETS,
    method: {
      regex_pre_pass: {
        dialogue_first: "first non-whitespace char is straight or smart double/single quote",
        time_cut_announcement:
          "sentence-initial match against the time-cut markers vocabulary (between_chapter set + that_* family)",
      },
      llm_residual: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        temperature: 0,
        response_format: "json_object",
        max_tokens: 200,
      },
      excerpt_max_chars: 1200,
    },
    aggregate: { n: finalEntries.length, distribution: aggDist },
    perBook,
    modal_per_book: modalPerBook,
    top3_per_book: t3,
    directional_assessment: directional,
    chapters: finalEntries,
  }
  writeFileSync(outPath, JSON.stringify(payload, null, 2))
  console.log(`wrote ${outPath}`)

  // Append to conclusions doc.
  const distLine = (book: string) => {
    const d = perBook[book].distribution
    return `${book} (n=${perBook[book].n}): ${BUCKETS.map((b) => `${b} ${d[b].pct}%`).join(" · ")}`
  }
  const md = `

### Pattern — Chapter opener rhetorical shape (cross-book) — ${isoTs}

**Methodology.** For each (book, chapter) the FIRST beat (lowest beat_idx) is the opener. Regex pre-pass on \`first_sentence\` / opening-position markers resolves dialogue-first (sentence-initial quote) and time-cut-announcement (sentence-initial time markers — \`The next morning\`, \`That night\`, \`Three weeks later\`, etc.). Residual openers are labeled by DeepSeek V4 Flash (temperature 0, JSON-mode) into one of seven buckets, with text capped at 1,200 chars. n=${finalEntries.length} across 3 IWD books.

**Aggregate distribution (${finalEntries.length} chapter openers, all 3 books):**

| Bucket | Count | Pct |
|---|---:|---:|
${BUCKETS.map((b) => `| ${b} | ${aggDist[b].count} | ${aggDist[b].pct}% |`).join("\n")}

**Per-book distribution:**

- ${distLine("crystal_shard")}
- ${distLine("streams_of_silver")}
- ${distLine("halflings_gem")}

**Directional verdict.** ${directional}

**Harness target.** Add an *opener rhetorical shape* prior to \`src/agents/planning-scenes/scene-expansion-system.md\` alongside the existing line ("Open with action or description. Do NOT open with interiority unless the POV character is alone."). The corpus distribution should drive the planner toward the modal opener kinds and away from rare ones; specifics depend on the per-book rank stability captured above. The chapter-skeleton plotter (\`chapter-outline-system.md\`) does not currently emit per-chapter opener-shape commitments — extending the schema with an optional \`openerKind\` enum field is a follow-up if cross-book ranks are stable.

Artifact: \`crystal_shard.${ts}.chapter-opener-taxonomy.json\`

---
`
  // Append (never overwrite).
  const existing = readFileSync(CONCLUSIONS_PATH, "utf8")
  writeFileSync(CONCLUSIONS_PATH, existing + md)
  console.log(`appended conclusions section to ${CONCLUSIONS_PATH}`)

  console.log("\n--- summary ---")
  console.log("aggregate:", aggDist)
  console.log("per-book modal:", modalPerBook)
  console.log("directional:", directional)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
