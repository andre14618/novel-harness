/**
 * Pattern 40 — Per-character dialogue mass across the 3-book Icewind Dale corpus.
 *
 * Pure compute, $0. Combines two attribution sources:
 *  1. AUTHORITATIVE (preferred): analysis/dialogue-extract.jsonl —
 *     LLM-attributed quotes for the 5 Companions (Drizzt, Wulfgar, Bruenor,
 *     Catti-brie, Regis). 2,447 lines, 100% coverage of Companion speech.
 *     Schema: {char, quote, beat_id, attribution_method}.
 *  2. REGEX FALLBACK: per-beat regex on beats.jsonl text to capture
 *     non-Companion speakers (antagonists, allies, minor characters)
 *     who fall outside the Companion-only LLM extract.
 *     Catches: "...quote..." said NAME / NAME said "..." / "..." NAME said.
 *     Speakers must match the config.yml character registry (full names + aliases)
 *     to count. Other proper-noun matches are bucketed as `unattributed_named`.
 *     Quotes with no attribution tag are bucketed as `unattributed`.
 *
 * Combined per-book stats:
 *   - words spoken per character
 *   - quote count per character
 *   - share of total attributed dialogue mass (%)
 *   - top 10 by words
 *   - cross-book speaker stability (Companions present in all 3, antagonists per-book)
 *
 * Output: timestamped JSON at
 *   novels/salvatore-icewind-dale/structure-calibration/
 *     crystal_shard.<TS>.per-character-dialogue-mass.json
 */

import { readFileSync, writeFileSync } from "node:fs"
import { parse as parseYaml } from "yaml"

const BUNDLE = "/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale"
const BEATS_PATH = `${BUNDLE}/beats.jsonl`
const DIALOGUE_EXTRACT_PATH = `${BUNDLE}/analysis/dialogue-extract.jsonl`
const CONFIG_PATH = `${BUNDLE}/config.yml`

type Beat = {
  beat_idx: number
  book: string
  chapter: string | number
  scene_id: string
  kind: string
  text: string
  words: number
}

type DialogueLine = {
  char: string
  quote: string
  beat_id: string
  attribution_method: "named" | "role" | "flow" | "pronoun"
}

type Character = {
  name: string
  full_name?: string
  aliases?: string[]
  role?: string
  archetype?: string
  pov?: boolean
  books?: string[]
}

// ----- Load corpus -----------------------------------------------------------

const beats: Beat[] = readFileSync(BEATS_PATH, "utf-8")
  .trim().split("\n").map(l => JSON.parse(l))

const dialogueLines: DialogueLine[] = readFileSync(DIALOGUE_EXTRACT_PATH, "utf-8")
  .trim().split("\n").map(l => JSON.parse(l))

const config = parseYaml(readFileSync(CONFIG_PATH, "utf-8")) as { characters: Character[] }
const charRegistry = config.characters

// Build alias → canonical-name map. Restrict to single-token primary aliases
// for the regex matcher (multi-word like "Captain Deudermont" handled separately).
const aliasToName = new Map<string, string>()
for (const c of charRegistry) {
  aliasToName.set(c.name, c.name)
  if (c.full_name) aliasToName.set(c.full_name.split(" ")[0]!, c.name)
  for (const alias of c.aliases ?? []) {
    // Only single-token capitalized names — role descriptors ("the dwarf") are
    // ambiguous in raw text (multiple dwarves can speak), so we only match
    // single-token name aliases via regex.
    if (/^[A-Z][a-zA-Z'-]+$/.test(alias)) aliasToName.set(alias, c.name)
  }
}

// ----- Helper: word count ----------------------------------------------------

function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(w => w.length > 0).length
}

// ----- Source 1: dialogue-extract.jsonl (Companions only, LLM-attributed) ---

type CharSpeech = { quotes: number; words: number }
type BookStats = { speakers: Map<string, CharSpeech>; total_dialogue_words: number; total_dialogue_quotes: number }

const bookStats: Record<string, BookStats> = {
  crystal_shard:      { speakers: new Map(), total_dialogue_words: 0, total_dialogue_quotes: 0 },
  streams_of_silver:  { speakers: new Map(), total_dialogue_words: 0, total_dialogue_quotes: 0 },
  halflings_gem:      { speakers: new Map(), total_dialogue_words: 0, total_dialogue_quotes: 0 },
}

// Extract book from beat_id like "crystal_shard_ch12_s1_b8"
function bookFromBeatId(bid: string): string | null {
  const m = bid.match(/^(crystal_shard|streams_of_silver|halflings_gem)_/)
  return m ? m[1]! : null
}

function addSpeaker(book: string, name: string, words: number) {
  const stats = bookStats[book]!
  const cur = stats.speakers.get(name) ?? { quotes: 0, words: 0 }
  cur.quotes += 1
  cur.words += words
  stats.speakers.set(name, cur)
  stats.total_dialogue_words += words
  stats.total_dialogue_quotes += 1
}

// Track which beats already had quotes attributed by the LLM extract — when
// we run the regex fallback we'll skip these to avoid double-counting
// Companion speech. (Other speakers in the same beat that the LLM didn't
// touch will still be picked up by the fallback.)
const beatIdToCompanionQuotes: Map<string, Set<string>> = new Map()
function noteCompanionQuote(bid: string, quote: string) {
  if (!beatIdToCompanionQuotes.has(bid)) beatIdToCompanionQuotes.set(bid, new Set())
  beatIdToCompanionQuotes.get(bid)!.add(normalizeQuote(quote))
}

function normalizeQuote(s: string): string {
  return s.toLowerCase().replace(/[\s\W]+/g, " ").trim()
}

let llmQuotesIngested = 0
for (const dl of dialogueLines) {
  const book = bookFromBeatId(dl.beat_id)
  if (!book) continue
  const w = countWords(dl.quote)
  addSpeaker(book, dl.char, w)
  noteCompanionQuote(dl.beat_id, dl.quote)
  llmQuotesIngested++
}

// ----- Source 2: regex fallback on beats.jsonl --------------------------------

// Dialogue verb list — common reporting clauses across English fiction.
const VERBS = [
  "said", "asked", "replied", "answered", "growled", "muttered", "shouted",
  "cried", "declared", "spat", "grunted", "hissed", "whispered", "huffed",
  "chuckled", "laughed", "exclaimed", "insisted", "continued", "added",
  "called", "yelled", "screamed", "snapped", "agreed", "argued", "begged",
  "boomed", "remarked", "retorted", "demanded", "responded", "explained",
  "stammered", "stuttered", "murmured", "barked", "snarled", "roared",
  "smiled", "grinned", "scoffed", "warned", "taunted", "promised", "noted",
  "pleaded", "snickered", "snorted", "sighed", "groaned", "moaned", "began",
  "stated", "mused", "reasoned", "echoed", "concluded", "chided", "scolded",
  "corrected", "pressed", "interjected", "interrupted", "queried", "inquired",
  "commented", "thundered", "bellowed", "lamented", "swore", "cursed",
  "complained", "grumbled", "huffed", "informed", "observed", "offered",
  "ordered", "praised", "prayed", "protested", "rejoined", "repeated",
  "returned", "shot back", "snapped back", "spoke", "ventured",
  "vowed", "wailed", "wept", "wondered", "blurted", "boasted", "breathed",
  "called out", "cackled", "challenged",
].sort((a, b) => b.length - a.length) // longest first to avoid prefix-shadow

// Build regex group of verbs (escape spaces).
const verbAlt = VERBS.map(v => v.replace(/ /g, "\\s+")).join("|")

// Pattern A: "...quote..." VERB NAME  →  e.g. `"Hold," said Drizzt.`
// Pattern B: "...quote..." NAME VERB  →  e.g. `"Hold," Drizzt said.`
// Pattern C: NAME VERB, "...quote..." →  pre-tag form (less common in Salvatore)
//
// IMPORTANT: case-sensitive (no `i` flag) on the NAME group — proper nouns are
// always capitalized, and the case-insensitive form was matching pronouns
// like "he", "she", "had" embedded in attribution clauses.
const PAT_POST_VERB_NAME = new RegExp(`"([^"]{2,})"[\\s,]*(?:${verbAlt})\\s+([A-Z][a-zA-Z'-]+)`, "g")
const PAT_POST_NAME_VERB = new RegExp(`"([^"]{2,})"[\\s,]*([A-Z][a-zA-Z'-]+)\\s+(?:${verbAlt})\\b`, "g")
const PAT_PRE_NAME_VERB  = new RegExp(`([A-Z][a-zA-Z'-]+)\\s+(?:${verbAlt})[,]?\\s+"([^"]{2,})"`, "g")

// Track regex-vs-extract overlap.
let regexQuotesNew = 0
let regexQuotesSkippedDuplicate = 0
let regexQuotesUnregistered = 0
const unregisteredNameCounts: Map<string, number> = new Map()
let unattributedQuoteCount = 0
let unattributedQuoteWords = 0

// Helper: extract every "..." chunk in the beat text and try to attribute it.
// We sweep the full text with the three patterns to capture attributed quotes,
// then sweep for any remaining "..." that didn't match.
function* iterAllQuotes(text: string): Generator<{ q: string; idx: number }> {
  const re = /"([^"]{2,})"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) yield { q: m[1]!, idx: m.index }
}

for (const beat of beats) {
  const book = beat.book
  if (!bookStats[book]) continue

  // Build a set of attributed-quote signatures (post + pre form combined).
  const attrInThisBeat: Map<string, string> = new Map() // normQuote → name (canonical or unregistered)

  function tryAttrFromRegex(pat: RegExp, role: "post-verb-name" | "post-name-verb" | "pre-name-verb") {
    pat.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pat.exec(beat.text)) !== null) {
      let quote: string, name: string
      if (role === "pre-name-verb") {
        name = m[1]!; quote = m[2]!
      } else {
        quote = m[1]!; name = m[2]!
      }
      const norm = normalizeQuote(quote)
      // Skip stop-word names that are common false positives for sentence-start capitals.
      if (/^(He|She|They|We|I|It|And|But|That|The|This|There|Then|When|Where|Why|How|What|Who|If|As|Now|Even|Still|Once|Yet|Yes|No|All|Some|Each|One|Two|Three|For|To|From|At|In|Of|On|By|Out|Up|Down|Back|Off|So|Or|Nor|Just|Only|Why|Indeed|Like|Such|Also|However|Though|Although|Therefore|Thus|Hence|Meanwhile|Indeed|Sure|Maybe|Perhaps|Right|Wrong|True|False|Aye|Nay)$/.test(name)) continue
      // De-dupe: if this beat already attributed this quote-text to someone, keep first.
      if (attrInThisBeat.has(norm)) continue
      attrInThisBeat.set(norm, name)
    }
  }

  tryAttrFromRegex(PAT_POST_VERB_NAME, "post-verb-name")
  tryAttrFromRegex(PAT_POST_NAME_VERB, "post-name-verb")
  tryAttrFromRegex(PAT_PRE_NAME_VERB, "pre-name-verb")

  // Walk all quotes in the beat. For each:
  //  - If the LLM-extract already attributed it, SKIP (counted in source 1).
  //  - Else if regex attributed it to a registered character, COUNT it.
  //  - Else if regex attributed to an unknown proper noun, COUNT under that name (top-10 still possible).
  //  - Else, count as unattributed.
  const beatId = `${beat.scene_id}_b${beat.beat_idx}`
  const llmAttr = beatIdToCompanionQuotes.get(beatId) ?? new Set()
  for (const { q } of iterAllQuotes(beat.text)) {
    const norm = normalizeQuote(q)
    // Skip if the LLM extract already attributed this quote to a Companion.
    if (llmAttr.has(norm)) continue
    // Also skip if any LLM-attributed quote in this beat starts with this quote
    // (handles cases where regex captures a fragment that the LLM saw as a longer quote).
    let llmCovered = false
    for (const llmNorm of llmAttr) {
      if (llmNorm === norm || llmNorm.startsWith(norm) || norm.startsWith(llmNorm)) { llmCovered = true; break }
    }
    if (llmCovered) continue

    const rawName = attrInThisBeat.get(norm)
    const w = countWords(q)
    if (rawName) {
      const canon = aliasToName.get(rawName)
      if (canon) {
        // Skip Companions for cs/sos/hg — the LLM extract should have caught them;
        // but if a regex match for a Companion sneaks past LLM coverage (e.g. a
        // beat the LLM marked with a different speaker), we still want it.
        // De-dupe protection: noteCompanionQuote() already filtered LLM-attributed
        // text. We can safely add.
        addSpeaker(book, canon, w)
        regexQuotesNew++
      } else {
        // Unregistered proper noun. Count under the literal name so that
        // characters who don't appear in the registry (lieutenants, soldiers,
        // unnamed NPCs) still show up. Top-10 will surface them if they speak enough.
        addSpeaker(book, `(other) ${rawName}`, w)
        regexQuotesUnregistered++
        unregisteredNameCounts.set(rawName, (unregisteredNameCounts.get(rawName) ?? 0) + 1)
      }
    } else {
      unattributedQuoteCount++
      unattributedQuoteWords += w
      addSpeaker(book, "(unattributed)", w)
    }
  }
}

// ----- Aggregate ---------------------------------------------------------------

type Row = { name: string; quotes: number; words: number; share: number }
function topN(book: string, n: number): Row[] {
  const stats = bookStats[book]!
  const all: Row[] = []
  let totalAttributedWords = 0
  for (const [name, s] of stats.speakers.entries()) {
    if (name === "(unattributed)") continue
    totalAttributedWords += s.words
  }
  for (const [name, s] of stats.speakers.entries()) {
    if (name === "(unattributed)") continue   // exclude from top-N rankings — reported separately
    all.push({
      name,
      quotes: s.quotes,
      words: s.words,
      share: totalAttributedWords > 0 ? Math.round((s.words / totalAttributedWords) * 1000) / 10 : 0,
    })
  }
  return all.sort((a, b) => b.words - a.words).slice(0, n)
}

const books = ["crystal_shard", "streams_of_silver", "halflings_gem"]
const top10: Record<string, Row[]> = {}
const top20: Record<string, Row[]> = {}
for (const book of books) {
  top10[book] = topN(book, 10)
  top20[book] = topN(book, 20)
}

// ----- Cross-book directional comparisons --------------------------------------

const companions = ["Drizzt", "Bruenor", "Wulfgar", "Catti-brie", "Regis"]

const companionShareByBook: Record<string, Record<string, number>> = {}
const companionWordsByBook: Record<string, Record<string, number>> = {}
const companionQuotesByBook: Record<string, Record<string, number>> = {}
for (const c of companions) {
  companionShareByBook[c] = {}
  companionWordsByBook[c] = {}
  companionQuotesByBook[c] = {}
  for (const book of books) {
    const stats = bookStats[book]!
    let totalAttributedWords = 0
    for (const [name, s] of stats.speakers.entries()) if (name !== "(unattributed)") totalAttributedWords += s.words
    const cs = stats.speakers.get(c)
    companionShareByBook[c]![book] = cs && totalAttributedWords > 0
      ? Math.round((cs.words / totalAttributedWords) * 1000) / 10
      : 0
    companionWordsByBook[c]![book] = cs?.words ?? 0
    companionQuotesByBook[c]![book] = cs?.quotes ?? 0
  }
}

// Stability score: coefficient of variation across books for each Companion's share.
function stdev(xs: number[]): number {
  if (xs.length === 0) return 0
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length
  return Math.sqrt(v)
}

const companionStability: Record<string, { mean_share: number; stdev_share: number; cv: number; range: [number, number] }> = {}
for (const c of companions) {
  const shares = books.map(b => companionShareByBook[c]![b]!)
  const m = shares.reduce((a, b) => a + b, 0) / shares.length
  const sd = stdev(shares)
  companionStability[c] = {
    mean_share: Math.round(m * 10) / 10,
    stdev_share: Math.round(sd * 10) / 10,
    cv: m > 0 ? Math.round((sd / m) * 1000) / 1000 : 0,
    range: [Math.min(...shares), Math.max(...shares)],
  }
}

// Leading-speaker reproducibility: who is #1 in each book?
const leadByBook: Record<string, string> = {}
for (const book of books) leadByBook[book] = top10[book]![0]?.name ?? "(none)"

// Antagonist signal: which non-Companion speakers crack the top 10 per book?
const nonCompanionTop10: Record<string, Row[]> = {}
for (const book of books) {
  nonCompanionTop10[book] = top10[book]!.filter(r =>
    !companions.includes(r.name) && r.name !== "(unattributed)" && !r.name.startsWith("(other)")
  )
}

// Cross-book overlap: Companions of the Hall stable across all 3 books?
const companionsInTop10: Record<string, string[]> = {}
for (const book of books) {
  companionsInTop10[book] = top10[book]!.map(r => r.name).filter(n => companions.includes(n))
}

// ----- Audit / coverage stats --------------------------------------------------

const totalQuotesByBook: Record<string, { attributed: number; unattributed: number; coverage_pct: number }> = {}
for (const book of books) {
  const stats = bookStats[book]!
  let attr = 0; let unattr = 0
  for (const [name, s] of stats.speakers.entries()) {
    if (name === "(unattributed)") unattr += s.quotes
    else attr += s.quotes
  }
  totalQuotesByBook[book] = {
    attributed: attr,
    unattributed: unattr,
    coverage_pct: attr + unattr > 0 ? Math.round((attr / (attr + unattr)) * 1000) / 10 : 0,
  }
}

// Top unregistered proper nouns (catches characters not in config.yml)
const topUnregistered = [...unregisteredNameCounts.entries()]
  .sort((a, b) => b[1] - a[1]).slice(0, 15)
  .map(([name, cnt]) => ({ name, quotes: cnt }))

// ----- Output -----------------------------------------------------------------

const output = {
  pattern: "Pattern 40 — per-character dialogue mass",
  computed_at: new Date().toISOString(),
  rationale: "Words spoken per character per book + share of total dialogue mass + cross-book stability of leading speakers. Feeds the planning-plotter prior on how `charactersPresent` per chapter should imply dialogue distribution; checks whether Drizzt, Bruenor, Wulfgar dominate equally across all 3 books or whether the books rotate POV emphasis.",
  methodology: {
    primary_source: "analysis/dialogue-extract.jsonl (LLM-attributed, 5 Companions only, 2,447 lines)",
    fallback_source: "regex on beats.jsonl text — 3 patterns: post-verb-name, post-name-verb, pre-name-verb. ~100 reporting verbs. Names cross-checked against config.yml character registry; unregistered proper nouns kept as `(other) NAME` so non-Companion antagonists can crack top-10.",
    deduplication: "regex matches that overlap with LLM-extract Companion attribution are skipped to avoid double-counting Companion speech.",
    word_definition: "whitespace-split on the quote text only (excludes attribution tags and speaker names).",
    unattributed_handling: "quotes with no matched speaker tag in their beat go into an `(unattributed)` bucket, NOT counted toward attributed-mass shares.",
  },
  summary: {
    total_beats: beats.length,
    llm_extract_quotes: llmQuotesIngested,
    regex_added_quotes_registered: regexQuotesNew,
    regex_added_quotes_unregistered: regexQuotesUnregistered,
    regex_unattributed_quotes: unattributedQuoteCount,
    coverage_by_book: totalQuotesByBook,
  },
  per_book_top_10: top10,
  per_book_top_20: top20,
  per_book_non_companion_top_10: nonCompanionTop10,
  per_book_companions_in_top_10: companionsInTop10,
  cross_book: {
    leading_speaker_by_book: leadByBook,
    companion_share_pct_by_book: companionShareByBook,
    companion_words_by_book: companionWordsByBook,
    companion_quote_count_by_book: companionQuotesByBook,
    companion_stability: companionStability,
    notes: {
      catti_brie_book_1_absence: "Catti-brie has 0 quotes in crystal_shard if the corpus extract reflects her late introduction; verify in companion_words_by_book[Catti-brie][crystal_shard].",
      entreri_only_book_3: "Entreri appears as antagonist in halflings_gem only — should NOT appear in book 1/2 top-10s.",
      kessell_only_book_1: "Kessell is the book-1 antagonist only.",
      pook_only_book_3: "Pasha Pook is the book-3 antagonist only.",
      dendybar_sydney_only_book_2: "Dendybar + Sydney appear in streams_of_silver only.",
    },
  },
  unregistered_top_proper_nouns: topUnregistered,
  totals_per_book: Object.fromEntries(books.map(b => [b, {
    total_quotes: bookStats[b]!.total_dialogue_quotes,
    total_dialogue_words: bookStats[b]!.total_dialogue_words,
  }])),
}

const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")
const path = `${BUNDLE}/structure-calibration/crystal_shard.${ts}.per-character-dialogue-mass.json`
writeFileSync(path, JSON.stringify(output, null, 2))
console.log(`wrote ${path}`)

// Console summary
console.log(`\n=== TOP 10 SPEAKERS PER BOOK ===`)
for (const book of books) {
  console.log(`\n${book}:`)
  for (const r of top10[book]!) {
    console.log(`  ${r.name.padEnd(30)} ${String(r.quotes).padStart(4)} quotes  ${String(r.words).padStart(6)}w  ${String(r.share).padStart(5)}%`)
  }
}
console.log(`\n=== COMPANION CROSS-BOOK STABILITY ===`)
for (const c of companions) {
  const s = companionStability[c]!
  console.log(`  ${c.padEnd(15)} mean_share=${s.mean_share}%  stdev=${s.stdev_share}  cv=${s.cv}  range=[${s.range[0]}%, ${s.range[1]}%]`)
}
console.log(`\n=== LEADING SPEAKER PER BOOK ===`)
for (const book of books) console.log(`  ${book}: ${leadByBook[book]}`)
console.log(`\n=== ATTRIBUTION COVERAGE ===`)
for (const book of books) {
  const c = totalQuotesByBook[book]!
  console.log(`  ${book}: ${c.coverage_pct}% (${c.attributed} attributed / ${c.attributed + c.unattributed} total quotes)`)
}
