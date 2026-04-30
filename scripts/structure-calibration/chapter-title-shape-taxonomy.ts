// Build a taxonomy of CHAPTER TITLE SHAPES across the 3 Icewind Dale books.
//
// For each (book, chapter) pair, classify the chapter_title into one of:
//   - character-name       — names a specific character ("The Halfling", "Errtu")
//   - place-name           — names a location ("Mithril Hall", "Calimport")
//   - action-verb          — verb-led or gerund action phrase ("Hunting", "The Hunt")
//   - concept-or-theme     — abstract noun phrase ("The Reckoning", "Trust", "Vengeance")
//   - object-or-artifact   — names an item ("The Crystal Shard", "Aegis-fang")
//   - quote-or-dialogue    — feels like a line of dialogue ("There Is No Honor")
//   - metaphorical-image   — a vivid image / metaphor that doesn't fit other buckets
//                            ("Lavender Eyes", "On the Wings of Doom", "Shallow Graves")
//   - other                — structural markers ("Prelude", "Epilogue", "Part 1 - Searches")
//                            or any title that doesn't fit the above.
//
// Pipeline: regex pre-pass for unambiguous structural markers (=== Prelude ===,
// === Epilogue ===, === Part N - ... ===) then DeepSeek V4 Flash for the rest.
// The body chapters (CS 30 + SoS 24 + HG 25 = 79) all carry the form
// "CHAPTER N — <title>"; the script strips the "CHAPTER N — " prefix before
// classification so the LLM sees the actual title text only.
//
// Cost target <$0.20 (~92 titles × ~250 input tokens × $0.14/1M ≈ $0.003 + cache benefits).
//
// Output: timestamped JSON at
//   novels/salvatore-icewind-dale/structure-calibration/crystal_shard.<TS>.chapter-title-shape.json
//
// Mirrors chapter-opener-taxonomy and forward-hook-shape — reusable shape for
// planner-prompt prior research.

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// ----- types -----------------------------------------------------------------

type SceneRow = {
  chapter: number | string
  chapter_title: string
  scene_idx: number
  book: string
}

const BUCKETS = [
  "character-name",
  "place-name",
  "action-verb",
  "concept-or-theme",
  "object-or-artifact",
  "quote-or-dialogue",
  "metaphorical-image",
  "other",
] as const
type Bucket = typeof BUCKETS[number]

type ChapterEntry = {
  book: string
  chapter: number | string
  raw_title: string
  cleaned_title: string
  classification: Bucket
  is_structural_marker: boolean
  source: "regex" | "llm"
  confidence: "high" | "medium" | "low"
  compositional?: { primary: Bucket; secondary: Bucket } | null
  note?: string
}

// ----- title cleaning --------------------------------------------------------

const STRUCTURAL_PRELUDE = /^=+\s*Prelude\s*=+$/i
const STRUCTURAL_EPILOGUE = /^=+\s*Epilogue\s*=+$/i
const STRUCTURAL_PART = /^=+\s*Part\s+\d+\s*-\s*(.+?)\s*=+$/i
// Body-chapter title prefix: "CHAPTER 12 — " or "CHAPTER 12 - " (em-dash or hyphen).
const CHAPTER_PREFIX = /^CHAPTER\s+\d+\s*[—\-–]\s*/i

function cleanTitle(rawTitle: string): { cleaned: string; isStructural: boolean; structuralLabel?: string } {
  const t = (rawTitle || "").trim()
  if (STRUCTURAL_PRELUDE.test(t)) return { cleaned: "Prelude", isStructural: true, structuralLabel: "prelude" }
  if (STRUCTURAL_EPILOGUE.test(t)) return { cleaned: "Epilogue", isStructural: true, structuralLabel: "epilogue" }
  const partMatch = t.match(STRUCTURAL_PART)
  if (partMatch) return { cleaned: partMatch[1].trim(), isStructural: true, structuralLabel: "part" }
  // Strip the "CHAPTER N — " prefix from body chapters.
  const stripped = t.replace(CHAPTER_PREFIX, "").trim()
  return { cleaned: stripped, isStructural: false }
}

// ----- LLM labeller (DeepSeek V4 Flash) --------------------------------------

const SYSTEM_PROMPT = `You classify chapter TITLES in fantasy fiction into one of eight shape buckets:

- character-name — title names or refers to a specific character. Includes proper names ("Errtu", "Drizzt") and definite descriptors that point to a single character ("The Halfling", "The Stooge", "The Guide"). Group epithets that name a known cast role ("Comrades", when "The Comrades" is the cast) also count.
- place-name — title names a location, real or invented (city, region, fortress, geographic feature). "Mithril Hall", "Bryn Shander", "Silverymoon", "Conyberry's Pride" (a place possessed by Conyberry), "On the Banks of Maer Dualdon" (locative phrase). Multi-word locative phrases that foreground a named place count here.
- action-verb — verb-led or gerund action phrase: "The Hunt", "Hunting", "The Conjuring", "Stirrings", "Besieged" (past participle as state-action). Active verbs or verb-derived nouns of action. NOT abstract themes.
- concept-or-theme — abstract noun phrase pointing at an idea, virtue, vice, or thematic motif: "Vengeance", "Trust", "The Reckoning", "Shadows", "Comrades" (when used as theme not character group). Single abstract nouns or short abstract noun phrases.
- object-or-artifact — title names a specific physical item: "The Crystal Shard", "Aegis-fang", "The Broken Helm", "A Plain Brown Wrapper". The item itself is the title's referent.
- quote-or-dialogue — title reads as a line a character would speak: "There Is No Honor", "If Ever You Loved Catti-brie", "Someday", "A Slave to No Man", "As the Wielder Bids". First person, second person, or imperative phrasing common.
- metaphorical-image — vivid sensory or figurative image not literal to a place/object/character/action: "Lavender Eyes", "On the Wings of Doom", "Shallow Graves", "Hot Winds", "A Thousand Thousand Little Candles", "Black and White", "Where No Sun Shines". Atmospheric / poetic / impressionistic.
- other — structural markers ("Prelude", "Epilogue", "Part 1") or titles that genuinely fit none of the above.

Pick the SINGLE most dominant shape. If a title compositionally combines two shapes (e.g., "The Defenders of Mithril Hall" = group + place; "The Battle of Icewind Dale" = action + place), record the dominant shape as classification AND emit a compositional pair indicating primary + secondary. The dominant shape is the one named first or carrying the syntactic head of the noun phrase.

Output JSON only:
{ "classification": "<bucket>", "confidence": "high"|"medium"|"low", "compositional": {"primary": "<bucket>", "secondary": "<bucket>"} | null, "note": "<one short clause>" }

Set "compositional" to null when the title is single-shape. Set it to {primary, secondary} when the title clearly combines two shapes; primary should equal classification.`

type LlmLabel = {
  classification: Bucket
  confidence: "high" | "medium" | "low"
  compositional: { primary: Bucket; secondary: Bucket } | null
  note: string
}

async function callDeepSeek(cleanedTitle: string, key: string): Promise<LlmLabel> {
  const userPrompt = `CHAPTER TITLE: "${cleanedTitle}"

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
      // Disable thinking-mode chain-of-thought; this is a tight JSON-only label task.
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
  let compositional: { primary: Bucket; secondary: Bucket } | null = null
  if (parsed.compositional && typeof parsed.compositional === "object") {
    const p = String(parsed.compositional.primary || "").trim() as Bucket
    const s = String(parsed.compositional.secondary || "").trim() as Bucket
    if (BUCKETS.includes(p) && BUCKETS.includes(s) && p !== s) {
      compositional = { primary: p, secondary: s }
    }
  }
  return { classification: cls, confidence: conf, compositional, note: String(parsed.note || "").slice(0, 240) }
}

// ----- main ------------------------------------------------------------------

const ROOT = "/Users/andre/Desktop/personal_projects/novel-harness"
const SCENES_PATH = join(ROOT, "novels/salvatore-icewind-dale/scenes.jsonl")
const OUT_DIR = join(ROOT, "novels/salvatore-icewind-dale/structure-calibration")
const CONCLUSIONS_PATH = join(OUT_DIR, "crystal_shard-conclusions.md")

function tsStamp(d = new Date()): string {
  // YYYYMMDDTHHMMSS in UTC for filename consistency with other artifacts.
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  )
}

function loadUniqueChapters(): Array<{ book: string; chapter: number | string; chapter_title: string }> {
  const lines = readFileSync(SCENES_PATH, "utf8").trim().split("\n")
  const seen = new Map<string, { book: string; chapter: number | string; chapter_title: string }>()
  for (const line of lines) {
    const r = JSON.parse(line) as SceneRow
    const k = `${r.book}|${r.chapter}`
    if (!seen.has(k)) seen.set(k, { book: r.book, chapter: r.chapter, chapter_title: r.chapter_title })
  }
  const arr = [...seen.values()]
  const bookOrder = ["crystal_shard", "streams_of_silver", "halflings_gem"]
  arr.sort((a, b) => {
    const bo = bookOrder.indexOf(a.book) - bookOrder.indexOf(b.book)
    if (bo !== 0) return bo
    const an = typeof a.chapter === "number"
    const bn = typeof b.chapter === "number"
    if (an && bn) return (a.chapter as number) - (b.chapter as number)
    if (an && !bn) return -1
    if (!an && bn) return 1
    return String(a.chapter).localeCompare(String(b.chapter))
  })
  return arr
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

  const chapters = loadUniqueChapters()
  console.log(`loaded ${chapters.length} unique (book, chapter) pairs`)
  if (chapters.length !== 92) {
    console.warn(`WARN: expected 92 chapters (34+29+29), got ${chapters.length}`)
  }

  // Regex pre-pass for structural markers; everything else routes to LLM.
  const entries: ChapterEntry[] = []
  let regexResolved = 0
  const needLlm: Array<{ book: string; chapter: number | string; raw: string; cleaned: string }> = []

  for (const c of chapters) {
    const { cleaned, isStructural } = cleanTitle(c.chapter_title)
    if (isStructural) {
      // Structural markers (Prelude, Epilogue, Part N) are bucket=other with high
      // confidence. The "Part N - <name>" series carries a name fragment we still
      // surface in cleaned_title for traceability, but we don't classify the
      // fragment — Part headers exist as structural divisions, not as
      // chapter-title-shape data.
      entries.push({
        book: c.book,
        chapter: c.chapter,
        raw_title: c.chapter_title,
        cleaned_title: cleaned,
        classification: "other",
        is_structural_marker: true,
        source: "regex",
        confidence: "high",
        compositional: null,
        note: "Structural division marker (prelude / epilogue / part header), not a chapter title.",
      })
      regexResolved += 1
      continue
    }
    if (!cleaned) {
      // Empty cleaned title — defensive bucket as other.
      entries.push({
        book: c.book,
        chapter: c.chapter,
        raw_title: c.chapter_title,
        cleaned_title: "",
        classification: "other",
        is_structural_marker: false,
        source: "regex",
        confidence: "low",
        compositional: null,
        note: "Empty cleaned title (after CHAPTER prefix strip).",
      })
      regexResolved += 1
      continue
    }
    needLlm.push({ book: c.book, chapter: c.chapter, raw: c.chapter_title, cleaned })
  }
  console.log(`regex pre-pass: ${regexResolved}/${chapters.length} resolved (${needLlm.length} -> LLM)`)

  // LLM pass with bounded concurrency.
  const CONCURRENCY = 4
  const queue = [...needLlm]
  const llmResults = new Map<string, ChapterEntry>()
  let calls = 0

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) return
      try {
        const label = await callDeepSeek(item.cleaned, key!)
        const e: ChapterEntry = {
          book: item.book,
          chapter: item.chapter,
          raw_title: item.raw,
          cleaned_title: item.cleaned,
          classification: label.classification,
          is_structural_marker: false,
          source: "llm",
          confidence: label.confidence,
          compositional: label.compositional,
          note: label.note,
        }
        llmResults.set(`${item.book}|${item.chapter}`, e)
        calls += 1
        if (calls % 10 === 0) console.log(`  llm progress: ${calls}/${needLlm.length}`)
      } catch (err) {
        console.error(`LLM error on ${item.book} ch${item.chapter}:`, (err as Error).message)
        llmResults.set(`${item.book}|${item.chapter}`, {
          book: item.book,
          chapter: item.chapter,
          raw_title: item.raw,
          cleaned_title: item.cleaned,
          classification: "other",
          is_structural_marker: false,
          source: "llm",
          confidence: "low",
          compositional: null,
          note: `LLM error: ${(err as Error).message.slice(0, 120)}`,
        })
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  console.log(`llm pass: ${calls}/${needLlm.length} calls completed`)

  // Stitch llm results back into entries, preserving original chapter ordering.
  const regexByKey = new Map<string, ChapterEntry>()
  for (const e of entries) regexByKey.set(`${e.book}|${e.chapter}`, e)
  const finalEntries: ChapterEntry[] = []
  for (const c of chapters) {
    const k = `${c.book}|${c.chapter}`
    const fromRegex = regexByKey.get(k)
    if (fromRegex) {
      finalEntries.push(fromRegex)
      continue
    }
    const fromLlm = llmResults.get(k)
    if (!fromLlm) throw new Error(`missing classification for ${k}`)
    finalEntries.push(fromLlm)
  }

  // Two scopes for distribution: (a) all 92 (including structural markers)
  // and (b) body chapters only (excludes prelude/epilogue/part headers).
  const bodyEntries = finalEntries.filter((e) => !e.is_structural_marker)

  const aggDistAll = tally(finalEntries)
  const aggDistBody = tally(bodyEntries)

  const perBookAll: Record<string, { n: number; distribution: Record<Bucket, { count: number; pct: number }> }> = {}
  const perBookBody: Record<string, { n: number; distribution: Record<Bucket, { count: number; pct: number }> }> = {}
  for (const book of ["crystal_shard", "streams_of_silver", "halflings_gem"]) {
    const subAll = finalEntries.filter((e) => e.book === book)
    const subBody = bodyEntries.filter((e) => e.book === book)
    perBookAll[book] = { n: subAll.length, distribution: tally(subAll) }
    perBookBody[book] = { n: subBody.length, distribution: tally(subBody) }
  }

  function modalOf(d: Record<Bucket, { count: number; pct: number }>): Bucket {
    let best: Bucket = "other"
    let bestPct = -1
    for (const b of BUCKETS) {
      if (d[b].pct > bestPct) {
        bestPct = d[b].pct
        best = b
      }
    }
    return best
  }
  function top3Of(d: Record<Bucket, { count: number; pct: number }>): Bucket[] {
    return [...BUCKETS].sort((a, b) => d[b].pct - d[a].pct).slice(0, 3)
  }

  const modalPerBookBody: Record<string, Bucket> = {}
  const top3PerBookBody: Record<string, Bucket[]> = {}
  for (const [book, info] of Object.entries(perBookBody)) {
    modalPerBookBody[book] = modalOf(info.distribution)
    top3PerBookBody[book] = top3Of(info.distribution)
  }

  const modalSetBody = new Set(Object.values(modalPerBookBody))
  let directional: string
  if (modalSetBody.size === 1) {
    directional = `Modal class holds across all 3 books (body-chapter scope): ${[...modalSetBody][0]}.`
  } else {
    directional = `Modal class diverges by book (body-chapter scope): ${JSON.stringify(modalPerBookBody)}.`
  }
  const intersectAll = top3PerBookBody.crystal_shard.filter(
    (b) => top3PerBookBody.streams_of_silver.includes(b) && top3PerBookBody.halflings_gem.includes(b),
  )
  directional += ` Top-3 sets (body): cs=${top3PerBookBody.crystal_shard.join("/")}, ss=${top3PerBookBody.streams_of_silver.join("/")}, hg=${top3PerBookBody.halflings_gem.join("/")}. Intersection of all three top-3 sets has ${intersectAll.length} buckets: ${intersectAll.join(", ") || "(none)"}.`

  // Compositional pattern summary.
  const compositional = finalEntries
    .filter((e) => e.compositional)
    .map((e) => ({
      book: e.book,
      chapter: e.chapter,
      cleaned_title: e.cleaned_title,
      primary: e.compositional!.primary,
      secondary: e.compositional!.secondary,
    }))
  // Pair frequency (primary -> secondary, ordered).
  const pairCount = new Map<string, number>()
  for (const c of compositional) {
    const k = `${c.primary}+${c.secondary}`
    pairCount.set(k, (pairCount.get(k) || 0) + 1)
  }
  const pairTop = [...pairCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)

  const ts = tsStamp()
  const isoTs = new Date().toISOString()
  const outPath = join(OUT_DIR, `crystal_shard.${ts}.chapter-title-shape.json`)

  const payload = {
    timestamp: isoTs,
    n_chapters: finalEntries.length,
    n_body_chapters: bodyEntries.length,
    buckets: BUCKETS,
    method: {
      regex_pre_pass: {
        structural_markers:
          "=== Prelude ===, === Epilogue ===, and === Part N - <name> === routed to bucket=other (is_structural_marker=true)",
        title_strip: "CHAPTER N — / CHAPTER N - prefix stripped before LLM classification",
      },
      llm_residual: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        temperature: 0,
        response_format: "json_object",
        max_tokens: 300,
        thinking: "disabled",
      },
    },
    aggregate_all: { n: finalEntries.length, distribution: aggDistAll },
    aggregate_body: { n: bodyEntries.length, distribution: aggDistBody },
    perBook_all: perBookAll,
    perBook_body: perBookBody,
    modal_per_book_body: modalPerBookBody,
    top3_per_book_body: top3PerBookBody,
    directional_assessment: directional,
    compositional_titles: compositional,
    compositional_pair_top: pairTop.map(([k, n]) => ({ pair: k, count: n })),
    chapters: finalEntries,
  }
  writeFileSync(outPath, JSON.stringify(payload, null, 2))
  console.log(`wrote ${outPath}`)

  // Append to conclusions doc — append-only, never overwrite.
  const distLineBody = (book: string) => {
    const d = perBookBody[book].distribution
    return `${book} (n=${perBookBody[book].n}): ${BUCKETS.map((b) => `${b} ${d[b].pct}%`).join(" · ")}`
  }
  const md = `

## Session 2026-04-30 ~${tsStamp().slice(9, 11)}:${tsStamp().slice(11, 13)} UTC — Pattern 26: Chapter-title shape taxonomy (3-book IWD)

**Methodology.** For each (book, chapter) the \`chapter_title\` field of \`scenes.jsonl\` is taken as the canonical title. Regex pre-pass routes structural markers (\`=== Prelude ===\`, \`=== Epilogue ===\`, \`=== Part N - <name> ===\`) into bucket=\`other\` with \`is_structural_marker=true\`. Body-chapter titles have the \`CHAPTER N — \` / \`CHAPTER N - \` prefix stripped, then DeepSeek V4 Flash (temperature 0, JSON-mode, thinking disabled) classifies the cleaned title into one of eight shape buckets, with optional compositional primary+secondary annotation when the title combines two shapes (e.g., "The Battle of Icewind Dale" = action-verb + place-name).

The 8 buckets are: \`character-name\`, \`place-name\`, \`action-verb\`, \`concept-or-theme\`, \`object-or-artifact\`, \`quote-or-dialogue\`, \`metaphorical-image\`, \`other\`. n=${finalEntries.length} total titles (${bodyEntries.length} body chapters + ${finalEntries.length - bodyEntries.length} structural markers).

**All-titles aggregate (${finalEntries.length}, includes structural markers):**

| Bucket | Count | Pct |
|---|---:|---:|
${BUCKETS.map((b) => `| ${b} | ${aggDistAll[b].count} | ${aggDistAll[b].pct}% |`).join("\n")}

**Body-chapter aggregate (${bodyEntries.length}, the planner-relevant scope):**

| Bucket | Count | Pct |
|---|---:|---:|
${BUCKETS.map((b) => `| ${b} | ${aggDistBody[b].count} | ${aggDistBody[b].pct}% |`).join("\n")}

**Per-book distribution (body chapters only):**

- ${distLineBody("crystal_shard")}
- ${distLineBody("streams_of_silver")}
- ${distLineBody("halflings_gem")}

**Per-book modal class (body):** crystal_shard=${modalPerBookBody.crystal_shard}, streams_of_silver=${modalPerBookBody.streams_of_silver}, halflings_gem=${modalPerBookBody.halflings_gem}.

**Directional verdict.** ${directional}

**Compositional patterns.** ${compositional.length} of ${bodyEntries.length} body titles (${bodyEntries.length === 0 ? 0 : Math.round((compositional.length / bodyEntries.length) * 1000) / 10}%) carry a clear two-shape composition. Top primary→secondary pairs:
${pairTop.length === 0 ? "_(no compositional pairs identified)_" : pairTop.map(([k, n]) => `- \`${k}\` × ${n}`).join("\n")}

**Harness target.** Add a \`titleShape\` enum field guidance section to \`src/agents/planning-plotter/chapter-outline-system.md\`. Specifics depend on whether the modal class and top-3 set hold across the 3 books (read directional verdict above). If reproduction is strong, encode as a planner soft prior: "Chapter titles in fantasy adventure default to <modal class> (~XX% of corpus); avoid generic action-verbs and structural markers as titles." If a top-3 intersection of 2-3 buckets is stable, recommend a small enum (\`character-name | place-name | concept-or-theme | metaphorical-image | object-or-artifact\`) with the planner picking one per chapter. Compositional combos like place+character (e.g., "Bryn Shander" + character cast) are first-class — \`titleShape\` should support a compositional primary+secondary pair.

Artifact: \`crystal_shard.${ts}.chapter-title-shape.json\` — per-chapter labels (book, chapter, raw_title, cleaned_title, classification, is_structural_marker, confidence, source, optional compositional pair, note) + body-vs-all aggregates + per-book modal/top-3 + compositional-pair frequency.

---
`

  const existing = readFileSync(CONCLUSIONS_PATH, "utf8")
  writeFileSync(CONCLUSIONS_PATH, existing + md)
  console.log(`appended conclusions section to ${CONCLUSIONS_PATH}`)

  console.log("\n--- summary ---")
  console.log("body aggregate:", aggDistBody)
  console.log("body per-book modal:", modalPerBookBody)
  console.log("directional:", directional)
  console.log(`compositional pairs identified: ${compositional.length}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
