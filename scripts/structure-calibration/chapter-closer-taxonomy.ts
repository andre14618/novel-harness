// Build a taxonomy of CHAPTER CLOSERS across the 3 Icewind Dale books.
//
// For each (book, chapter) pair, the LAST beat (largest beat_idx within chapter)
// is the closer. Classify each closer into one of nine buckets:
//   - physical_cliffhanger
//   - info_reveal
//   - arrival
//   - departure
//   - decision_point
//   - unanswered_question
//   - reflection_pause
//   - time_leap_tease
//   - tableau_close
//
// Pipeline: lightweight regex pre-pass for low-hanging fruit
// (unanswered_question on trailing '?', time_leap_tease on canonical markers),
// then DeepSeek V4 Flash for the residual. Cost <$1.
//
// Output: timestamped JSON at
//   novels/salvatore-icewind-dale/structure-calibration/crystal_shard.<TS>.chapter-closer-taxonomy.json
//
// Mirror of chapter-opener-taxonomy.ts (Pattern 17). This is Pattern 50 — the
// closer-side counterpart to the chapter opener taxonomy. Distinct from the
// scene-level forward-hook taxonomy (Pattern 14) which classifies
// rhetorical-shape of scene endings; here we measure the LAST BEAT (action
// granularity) of each chapter into a more concrete 9-bucket taxonomy keyed
// to chapter-outline planner priors.
//
// Critical: atomic file append for conclusions.md and roadmap.md uses Python
// + fcntl.flock since multiple subagents may write concurrently. See the
// `appendConclusionsAtomic` and `injectRoadmapRowAtomic` helpers below.

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

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
  "physical_cliffhanger",
  "info_reveal",
  "arrival",
  "departure",
  "decision_point",
  "unanswered_question",
  "reflection_pause",
  "time_leap_tease",
  "tableau_close",
] as const
type Bucket = typeof BUCKETS[number]

type ChapterEntry = {
  book: string
  chapter: number | string
  closer_text_excerpt: string
  last_sentence: string
  classification: Bucket
  source: "regex" | "llm"
  confidence: "high" | "medium" | "low"
  rationale?: string
  regex_flags: { trailingQuestion: boolean; timeLeapMarker: boolean }
}

// ----- regex pre-pass --------------------------------------------------------

// Trailing question mark (after stripping any closing-quote punctuation) signals
// an explicit unanswered question.
function hasTrailingQuestion(lastSentence: string): boolean {
  // Strip trailing close-quotes / spaces, then check for '?' at end.
  const s = (lastSentence || "").trim().replace(/["'”’\s]+$/u, "")
  return s.endsWith("?")
}

// Time-leap-tease markers — explicit foreshadow of a time jump. Drawn from the
// time-cut markers vocabulary plus a few foreshadow-shape phrases.
const TIME_LEAP_PATTERNS: Array<{ label: string; re: RegExp }> = [
  // "the night would be long" / "morning would bring" family
  { label: "would_be_long", re: /\b(?:night|day|hours?|wait|journey|road|path|battle|war|silence|winter|march)\s+would\s+be\s+(?:long|hard|cold|dark|the\s+last|endless)\b/i },
  { label: "morning_would", re: /\b(?:morning|dawn|nightfall|dusk|sunrise|sunset|midnight|the\s+next\s+day|the\s+next\s+morning)\s+would\s+(?:bring|come|find|see|reveal|change|tell|prove)\b/i },
  { label: "tomorrow_would", re: /\btomorrow\s+would\s+(?:be|bring|come|find|see|tell|change|prove)\b/i },
  { label: "soon_enough", re: /\bsoon(?:\s+enough)?\b.*\bwould\b/i },
  { label: "before_dawn", re: /\bbefore\s+(?:the\s+)?(?:dawn|morning|nightfall|dusk|sunrise|night\s+was\s+through|sun\s+rose|sun\s+set)\b/i },
  { label: "ere_long", re: /\b(?:ere\s+long|ere\s+the\s+(?:morn|night|dawn|dusk))\b/i },
  // anaphoric closers about the future of the journey/danger
  { label: "long_road_ahead", re: /\b(?:long\s+(?:road|journey|march|path|night|wait)\s+(?:ahead|before\s+them|to\s+come|still))\b/i },
  { label: "many_miles", re: /\bmany\s+(?:miles|leagues|days|weeks|months|years)\s+(?:ahead|before|of)\b/i },
]

function timeLeapMarkerLabel(text: string): string | null {
  // Operate on the trailing portion (last 320 chars) to avoid matching
  // unrelated mid-beat phrasing — closers most often place the foreshadow at
  // the final paragraph.
  const tail = (text || "").slice(-320)
  for (const p of TIME_LEAP_PATTERNS) {
    if (p.re.test(tail)) return p.label
  }
  return null
}

// ----- LLM labeller (DeepSeek V4 Flash) --------------------------------------

const SYSTEM_PROMPT = `You classify chapter CLOSERS in fiction prose into one of nine buckets:

- physical_cliffhanger — character is in immediate physical danger / unresolved combat / mid-action peril at the chapter break ("the blade fell"; "to be continued" mid-strike). The chapter cuts mid-fight or mid-fall, with the resolution deferred to a later chapter.
- info_reveal — major plot information is revealed at chapter's end (a twist, secret, identity, bombshell). The closer's emotional payload is "we now know X."
- arrival — character or group ARRIVES at a new place / encounter / threshold. The closer's beat sets up next chapter by placing characters at a new locale or in front of a new entity.
- departure — character or group LEAVES (sails, walks away, breaks up, parts ways). The closer's beat closes a unit by ending the present scene/relationship; movement away.
- decision_point — POV character (or party) makes a clear-cut DECISION that frames the next chapter. Resolution by choice, not action; the choice itself is the rhetorical close.
- unanswered_question — closer poses an explicit question (often punctuated with '?') OR a strongly-implicit question ("would they ever?") that frames forward expectation.
- reflection_pause — closer is interior — POV thinks, remembers, mourns, hopes. Quiet emotional landing; no external action.
- time_leap_tease — closer foreshadows a coming temporal jump ("the night would be long," "morning would bring," "before dawn") — a temporal rhetorical bridge, not an information reveal.
- tableau_close — closer is descriptive — a setting/atmosphere image holds the final frame (sun setting on the field, snow falling on bodies, the ship dwindling on the horizon). No action, no interiority — just a held image.

Output JSON only:
{ "classification": "<bucket>", "confidence": "high"|"medium"|"low", "rationale": "<one short clause>" }

Pick the SINGLE most dominant closing rhetorical move. Decision rules:
1. If the closer ends with a literal '?' AND the question frames forward expectation, pick unanswered_question.
2. If multiple categories apply (common — e.g. arrival into a new place that ALSO is a tableau image), pick the one that the FINAL paragraph most strongly executes. The closing paragraph weight matters more than middle paragraphs.
3. physical_cliffhanger requires that the character be in unresolved physical danger AT THE CHAPTER BREAK — not simply that violent action occurred earlier in the closer.
4. arrival vs departure: ask which way the camera/scene is moving. Toward something new = arrival; away from something present = departure.
5. info_reveal requires that NEW information change the reader's understanding — not merely a character expressing existing emotion.
6. decision_point requires a clear-cut intention/commitment ("he would go alone" / "they agreed: dawn"). Vague resolutions don't qualify — those are reflection_pause.
7. reflection_pause is the catchall for interiority closes that aren't a question and don't carry decisive forward action.
8. tableau_close is descriptive-only with no character interiority active in the final paragraph.
9. time_leap_tease is specifically about a temporal-bridge phrasing ("morning would bring..."); it is NOT every foreshadow.`

type LlmLabel = { classification: Bucket; confidence: "high" | "medium" | "low"; rationale: string }

async function callDeepSeek(closer: string, key: string): Promise<LlmLabel> {
  const userPrompt = `CLOSING TEXT (last beat of chapter, may be truncated):

${closer}

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
      max_tokens: 350,
      response_format: { type: "json_object" },
      // Disable thinking-mode: tight JSON-only labeling task; extended
      // reasoning would consume max_tokens before answer content emits.
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
  return { classification: cls, confidence: conf, rationale: String(parsed.rationale || "").slice(0, 240) }
}

// ----- main ------------------------------------------------------------------

const ROOT = "/Users/andre/Desktop/personal_projects/novel-harness"
const BEATS_PATH = join(ROOT, "novels/salvatore-icewind-dale/beats.jsonl")
const OUT_DIR = join(ROOT, "novels/salvatore-icewind-dale/structure-calibration")
const CONCLUSIONS_PATH = join(OUT_DIR, "crystal_shard-conclusions.md")
const ROADMAP_PATH = join(ROOT, "docs/harness-tuning-roadmap.md")
const ENV_PATH = join(ROOT, ".env")

function tsStamp(d = new Date()): string {
  // YYYYMMDDTHHMMSS in UTC for filename consistency with other artifacts
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  )
}

function loadDeepSeekKey(): string {
  const envKey = process.env.DEEPSEEK_API_KEY
  if (envKey) return envKey
  // Fall back to .env file (the file may not be loaded automatically when
  // invoked via plain `bun script.ts`).
  try {
    const envText = readFileSync(ENV_PATH, "utf8")
    for (const line of envText.split("\n")) {
      const m = line.match(/^\s*DEEPSEEK_API_KEY\s*=\s*(.+?)\s*$/)
      if (m) return m[1]!.replace(/^['"]|['"]$/g, "")
    }
  } catch (e) {
    // ignore
  }
  throw new Error("DEEPSEEK_API_KEY not found in env or .env")
}

function loadClosers(): Beat[] {
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
  const closers: Beat[] = []
  for (const beats of byBookCh.values()) {
    beats.sort((a, b) => a.beat_idx - b.beat_idx)
    closers.push(beats[beats.length - 1]!) // LAST beat (largest beat_idx)
  }
  // Sort closers by book then chapter for stable output order.
  const bookOrder = ["crystal_shard", "streams_of_silver", "halflings_gem"]
  closers.sort((a, b) => {
    const bo = bookOrder.indexOf(a.book) - bookOrder.indexOf(b.book)
    if (bo !== 0) return bo
    const an = typeof a.chapter === "number"
    const bn = typeof b.chapter === "number"
    if (an && bn) return (a.chapter as number) - (b.chapter as number)
    if (an && !bn) return -1
    if (!an && bn) return 1
    return String(a.chapter).localeCompare(String(b.chapter))
  })
  return closers
}

function buildCloserExcerpt(beat: Beat, maxChars = 1500): string {
  // Closers benefit from a slightly longer window than openers — the
  // foregrounded rhetorical move often lives in the FINAL paragraph, and
  // truncating from the front is preferable to truncating from the back.
  const text = (beat.text || "").trim()
  if (text.length <= maxChars) return text
  // Keep the LAST maxChars (the close-end of the closer is what we classify).
  return "[…] " + text.slice(text.length - maxChars).trimStart()
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

// Atomic, flock-protected append to the conclusions doc.
function appendConclusionsAtomic(section: string) {
  const py = `
import fcntl
target = ${JSON.stringify(CONCLUSIONS_PATH)}
section = ${JSON.stringify(section)}
with open(target, "a") as f:
    fcntl.flock(f, fcntl.LOCK_EX)
    f.write(section)
    fcntl.flock(f, fcntl.LOCK_UN)
print("appended")
`
  const r = spawnSync("python3", ["-c", py], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`conclusions append failed: ${r.stderr}`)
}

// Atomic, flock-protected read-modify-write to inject one Pattern-50 row into
// docs/harness-tuning-roadmap.md just before the `**Sequencing` anchor.
function injectRoadmapRowAtomic(row: string) {
  const py = `
import fcntl
target = ${JSON.stringify(ROADMAP_PATH)}
new_row = ${JSON.stringify(row)}
with open(target, "r+") as f:
    fcntl.flock(f, fcntl.LOCK_EX)
    text = f.read()
    anchor = "\\n**Sequencing"
    ip = text.find(anchor)
    if ip < 0:
        fcntl.flock(f, fcntl.LOCK_UN)
        raise SystemExit("anchor '**Sequencing' not found in roadmap")
    f.seek(0)
    f.write(text[:ip] + new_row + text[ip:])
    f.truncate()
    fcntl.flock(f, fcntl.LOCK_UN)
print("injected")
`
  const r = spawnSync("python3", ["-c", py], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`roadmap inject failed: ${r.stderr}`)
}

async function main() {
  const key = loadDeepSeekKey()
  const closers = loadClosers()
  console.log(`loaded ${closers.length} chapter-closer beats`)
  if (closers.length !== 92) {
    console.warn(`WARN: expected 92 closers (34+29+29), got ${closers.length}`)
  }

  // Regex pre-pass.
  const entries: ChapterEntry[] = []
  let regexResolved = 0
  let needLlm: Beat[] = []
  for (const b of closers) {
    const trailingQ = hasTrailingQuestion(b.last_sentence || b.text || "")
    const tlLabel = timeLeapMarkerLabel(b.text || "")
    const flags = { trailingQuestion: trailingQ, timeLeapMarker: tlLabel !== null }

    // Resolution priority: trailing '?' (visually unambiguous) wins over
    // time_leap_tease even when both fire — a literal question mark is
    // structurally explicit; time-leap is a softer rhetorical bridge.
    if (trailingQ) {
      entries.push({
        book: b.book,
        chapter: b.chapter,
        closer_text_excerpt: buildCloserExcerpt(b),
        last_sentence: (b.last_sentence || "").slice(0, 240),
        classification: "unanswered_question",
        source: "regex",
        confidence: "high",
        rationale: "Last sentence ends with explicit question mark.",
        regex_flags: flags,
      })
      regexResolved += 1
      continue
    }
    if (tlLabel) {
      entries.push({
        book: b.book,
        chapter: b.chapter,
        closer_text_excerpt: buildCloserExcerpt(b),
        last_sentence: (b.last_sentence || "").slice(0, 240),
        classification: "time_leap_tease",
        source: "regex",
        confidence: "high",
        rationale: `Closer-tail time-leap marker (${tlLabel}).`,
        regex_flags: flags,
      })
      regexResolved += 1
      continue
    }
    needLlm.push(b)
  }
  console.log(`regex pre-pass: ${regexResolved}/${closers.length} resolved (${needLlm.length} -> LLM)`)

  // LLM pass with bounded concurrency.
  const CONCURRENCY = 4
  const queue = [...needLlm]
  const llmResults = new Map<string, ChapterEntry>()
  let calls = 0

  async function worker() {
    while (queue.length > 0) {
      const b = queue.shift()
      if (!b) return
      const closer = buildCloserExcerpt(b)
      try {
        const label = await callDeepSeek(closer, key!)
        const e: ChapterEntry = {
          book: b.book,
          chapter: b.chapter,
          closer_text_excerpt: closer,
          last_sentence: (b.last_sentence || "").slice(0, 240),
          classification: label.classification,
          source: "llm",
          confidence: label.confidence,
          rationale: label.rationale,
          regex_flags: { trailingQuestion: false, timeLeapMarker: false },
        }
        llmResults.set(`${b.book}|${b.chapter}`, e)
        calls += 1
        if (calls % 10 === 0) console.log(`  llm progress: ${calls}/${needLlm.length}`)
      } catch (err) {
        console.error(`LLM error on ${b.book} ch${b.chapter}:`, (err as Error).message)
        // Mark as reflection_pause with low confidence so the run still produces output.
        // (Conservative fallback — the dominant residual class historically.)
        llmResults.set(`${b.book}|${b.chapter}`, {
          book: b.book,
          chapter: b.chapter,
          closer_text_excerpt: closer,
          last_sentence: (b.last_sentence || "").slice(0, 240),
          classification: "reflection_pause",
          source: "llm",
          confidence: "low",
          rationale: `LLM error fallback: ${(err as Error).message.slice(0, 120)}`,
          regex_flags: { trailingQuestion: false, timeLeapMarker: false },
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
  for (const b of closers) {
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

  // Cross-book stability: modal class agree, top-3 set membership, always-present classes.
  const modalPerBook: Record<string, Bucket> = {}
  for (const [book, info] of Object.entries(perBook)) {
    let best: Bucket = "reflection_pause"
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
  const modalClassAgree = modalSet.size === 1

  function top3(d: Record<Bucket, { count: number; pct: number }>): Bucket[] {
    return [...BUCKETS].sort((a, b) => d[b].pct - d[a].pct).slice(0, 3)
  }
  const t3 = {
    crystal_shard: top3(perBook.crystal_shard.distribution),
    streams_of_silver: top3(perBook.streams_of_silver.distribution),
    halflings_gem: top3(perBook.halflings_gem.distribution),
  }
  const top3Intersection = t3.crystal_shard.filter(
    (b) => t3.streams_of_silver.includes(b) && t3.halflings_gem.includes(b),
  )
  // Always-present classes: classes used (count >= 1) in ALL 3 books.
  const alwaysPresent: Bucket[] = []
  for (const b of BUCKETS) {
    if (
      perBook.crystal_shard.distribution[b].count >= 1 &&
      perBook.streams_of_silver.distribution[b].count >= 1 &&
      perBook.halflings_gem.distribution[b].count >= 1
    ) {
      alwaysPresent.push(b)
    }
  }

  // Directional verdict: PASS / PASS_PARTIAL / DIVERGE / KILL.
  // Same definitions as P49 / similar prior patterns.
  let directionalVerdict: "PASS" | "PASS_PARTIAL" | "DIVERGE" | "KILL"
  let directionalNote: string
  if (modalClassAgree && top3Intersection.length >= 2) {
    directionalVerdict = "PASS"
    directionalNote = `Modal class (${[...modalSet][0]}) holds in all 3 books AND ≥2 buckets in top-3 intersection.`
  } else if (modalClassAgree && top3Intersection.length < 2) {
    directionalVerdict = "PASS_PARTIAL"
    directionalNote = `Modal class (${[...modalSet][0]}) holds in all 3 books but top-3 sets diverge (intersection=${top3Intersection.length}).`
  } else if (!modalClassAgree && top3Intersection.length >= 2) {
    directionalVerdict = "PASS_PARTIAL"
    directionalNote = `Modal class diverges across books (${JSON.stringify(modalPerBook)}) but top-3 set has ${top3Intersection.length} cross-book reproducible buckets: ${top3Intersection.join(", ")}.`
  } else if (!modalClassAgree && top3Intersection.length < 2) {
    directionalVerdict = "DIVERGE"
    directionalNote = `Modal classes ${JSON.stringify(modalPerBook)}; top-3 intersection ${top3Intersection.length} buckets.`
  } else {
    // Reserved (no fallthrough should reach KILL on observed data; KILL would mean
    // class distribution literally inverts).
    directionalVerdict = "KILL"
    directionalNote = "Distributions invert across books."
  }

  const ts = tsStamp()
  const isoTs = new Date().toISOString()
  const outPath = join(OUT_DIR, `crystal_shard.${ts}.chapter-closer-taxonomy.json`)

  const payload = {
    pattern: 50,
    timestamp: isoTs,
    n_chapters: finalEntries.length,
    buckets: BUCKETS,
    method: {
      regex_pre_pass: {
        unanswered_question: "trailing '?' (after stripping closing-quote / whitespace)",
        time_leap_tease: "tail-of-text match against canonical time-leap markers (would be long, would bring, before dawn, ere long, etc.)",
      },
      llm_residual: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        temperature: 0,
        response_format: "json_object",
        max_tokens: 350,
        thinking_disabled: true,
      },
      excerpt_max_chars: 1500,
      excerpt_strategy: "tail-truncate (preserve closing prose)",
    },
    aggregate: { n: finalEntries.length, distribution: aggDist },
    perBook,
    cross_book_stability: {
      modal_class_per_book: modalPerBook,
      modal_class_agree: modalClassAgree,
      top3_per_book: t3,
      top3_intersection: top3Intersection,
      always_present_classes: alwaysPresent,
    },
    directional_verdict: directionalVerdict,
    directional_note: directionalNote,
    chapters: finalEntries,
  }
  writeFileSync(outPath, JSON.stringify(payload, null, 2))
  console.log(`wrote ${outPath}`)

  // ----- Append conclusions section (atomic, flock-protected) ---------------
  const distLine = (book: string) => {
    const d = perBook[book].distribution
    const top = [...BUCKETS]
      .sort((a, b) => d[b].pct - d[a].pct)
      .slice(0, 5)
      .map((b) => `${b} ${d[b].pct}%`)
      .join(" · ")
    return `${book} (n=${perBook[book].n}): ${top}`
  }
  const md = `

## Pattern 50: Chapter-closer hook taxonomy

**Methodology.** For each (book, chapter) the LAST beat (largest beat_idx) is the closer. Regex pre-pass on \`last_sentence\` (trailing '?') / closer-tail (canonical time-leap markers) resolves the visually unambiguous cases. Residual closers are labeled by DeepSeek V4 Flash (temperature 0, thinking-mode disabled, JSON-mode) into one of nine buckets, with the LAST 1,500 chars of the closer fed to the LLM (tail-truncation preserves the closing rhetorical move). n=${finalEntries.length} across 3 IWD books.

**Buckets.** physical_cliffhanger · info_reveal · arrival · departure · decision_point · unanswered_question · reflection_pause · time_leap_tease · tableau_close

**Aggregate distribution (${finalEntries.length} chapter closers, all 3 books):**

| Bucket | Count | Pct |
|---|---:|---:|
${[...BUCKETS].sort((a, b) => aggDist[b].pct - aggDist[a].pct).map((b) => `| ${b} | ${aggDist[b].count} | ${aggDist[b].pct}% |`).join("\n")}

**Per-book top-5:**

- ${distLine("crystal_shard")}
- ${distLine("streams_of_silver")}
- ${distLine("halflings_gem")}

**Cross-book stability:**

- Modal class per book: ${JSON.stringify(modalPerBook)} — modal_class_agree=${modalClassAgree}
- Top-3 per book: cs=${t3.crystal_shard.join("/")}, ss=${t3.streams_of_silver.join("/")}, hg=${t3.halflings_gem.join("/")}
- Top-3 intersection (buckets in ALL 3 top-3 sets): ${top3Intersection.length} buckets — ${top3Intersection.join(", ") || "(none)"}
- Always-present classes (count ≥ 1 in every book): ${alwaysPresent.length} buckets — ${alwaysPresent.join(", ") || "(none)"}

**Directional verdict.** **${directionalVerdict}** — ${directionalNote}

**Harness target.** Add a *closer rhetorical shape* prior to \`src/agents/planning/chapter-outline-system.md\` for the \`purpose\` field. Where Pattern 14 (forward-hook taxonomy at scene granularity) describes the rhetorical shape of how chapters end as scenes, Pattern 50 describes the concrete action-level taxonomy of the LAST BEAT — the unit the writer actually drafts. Distinct lever: planner can default the chapter-outline closer beat to the modal class with permitted alternates; chapter-plan-checker can check beat-${alwaysPresent.length}-present-class-coverage as a soft prior. The planner-prompt edit is independent of and additive to Pattern 17 (opener taxonomy) — opener+closer pairing is a candidate cross-pattern interaction (cf. Pattern 32 chapter-seam transitions).

Artifact: \`crystal_shard.${ts}.chapter-closer-taxonomy.json\`
`
  appendConclusionsAtomic(md)
  console.log(`appended Pattern 50 section to ${CONCLUSIONS_PATH}`)

  // ----- Inject roadmap row (atomic, flock-protected) ----------------------
  // Format: 7 columns matching existing P17/P18-style new-pattern rows.
  // | # | Pattern | Harness target | Variant drafted? | Probe run? | Cross-book? | Point-estimate verdict | Directional verdict |
  // The orchestrator will fill in the commit hash on commit; we leave a
  // descriptive identifier so the row is interpretable without it.
  const aggSorted = [...BUCKETS].sort((a, b) => aggDist[b].pct - aggDist[a].pct)
  const aggLine = aggSorted
    .filter((b) => aggDist[b].pct > 0)
    .slice(0, 5)
    .map((b) => `${b.replace(/_/g, "-")} ${aggDist[b].pct}%`)
    .join(" / ")
  const modalDetail = modalClassAgree
    ? `**Modal class (${[...modalSet][0]}) holds in all 3 books** (CS ${perBook.crystal_shard.distribution[modalPerBook.crystal_shard].pct}%, SoS ${perBook.streams_of_silver.distribution[modalPerBook.streams_of_silver].pct}%, HG ${perBook.halflings_gem.distribution[modalPerBook.halflings_gem].pct}%).`
    : `Modal class diverges (CS=${modalPerBook.crystal_shard}, SoS=${modalPerBook.streams_of_silver}, HG=${modalPerBook.halflings_gem}).`
  const top3Detail = `Top-3 intersection has ${top3Intersection.length} cross-book buckets${top3Intersection.length ? `: ${top3Intersection.join(", ")}` : ""}.`
  const alwaysPresentDetail = `Always-present classes: ${alwaysPresent.length}/9${alwaysPresent.length ? ` (${alwaysPresent.join(", ")})` : ""}.`

  const cellPattern = `**Chapter-closer hook taxonomy** (\`<commit>\`): aggregate ${aggLine}. ${modalDetail} ${top3Detail} ${alwaysPresentDetail} Distinct from Pattern 14 (scene-level forward-hook rhetoric) — Pattern 50 measures the action-level LAST BEAT taxonomy, the unit the writer drafts.`
  const cellTarget = `\`chapter-outline-system.md\` \`purpose\` field — closer-beat rhetorical-shape prior; default to modal class with permitted alternates from the always-present set; orthogonal to Pattern 17 (opener) and complementary to Pattern 14 (forward-hook scene-level)`
  const verdictShip = directionalVerdict === "PASS"
    ? "**PASS** — strong NEW ship candidate"
    : directionalVerdict === "PASS_PARTIAL"
      ? "**PASS_PARTIAL** — modal-class or top-3-set ships; specific ranking does not"
      : directionalVerdict === "DIVERGE"
        ? "**DIVERGE** — do not ship as planner prior"
        : "**KILL** — distributions invert"
  const newRow = `| 50 | ${cellPattern} | ${cellTarget} | NEW — DRAFT pending | — | **DONE (3 books)** | n/a | ${verdictShip} |\n`
  injectRoadmapRowAtomic(newRow)
  console.log(`injected Pattern 50 row to ${ROADMAP_PATH}`)

  // ----- Final console summary ---------------------------------------------
  console.log("\n--- summary ---")
  console.log("aggregate:", aggDist)
  console.log("per-book modal:", modalPerBook)
  console.log("modal_class_agree:", modalClassAgree)
  console.log("top3 intersection:", top3Intersection)
  console.log("always-present classes:", alwaysPresent)
  console.log("directional_verdict:", directionalVerdict)
  console.log("directional_note:", directionalNote)
  console.log("\n--- artifact ---")
  console.log("JSON:", outPath)
  console.log("conclusions:", CONCLUSIONS_PATH)
  console.log("roadmap:", ROADMAP_PATH)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
