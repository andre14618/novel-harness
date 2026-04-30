/**
 * Pattern 39 — Sentence-opener distribution.
 *
 * Pure compute on beats.jsonl. Zero LLM cost.
 *
 * For each sentence in each beat:
 *  - Classify the first word/phrase by structural role:
 *      subject-first  — name, pronoun, or noun phrase ("Drizzt drew his scimitars.")
 *      adverbial-first — adverb or prepositional phrase ("Carefully, he stepped forward.")
 *      participial-first — -ing/-ed participle leading the clause ("Stepping back, he raised his blade.")
 *      conjunction-first — sentence-initial coordinating/subordinating conjunction ("And yet, he hesitated.")
 *      dialogue-first — sentence is a direct quote (first non-space char is a quote mark)
 *      interjection-first — sentence-initial interjection ("Oh, the cold!")
 *      other            — fallthrough
 *
 * Per-book distribution + per-kind breakdown + cross-book directional comparison.
 *
 * Output (NEVER overwrite):
 *   crystal_shard.<TS>.sentence-opener-distribution.json
 */

import { readFileSync, writeFileSync } from "node:fs"

const BEATS = "/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale/beats.jsonl"
const OUT_DIR = "/Users/andre/Desktop/personal_projects/novel-harness/novels/salvatore-icewind-dale/structure-calibration"

type Beat = {
  book: string
  chapter: string | number
  beat_idx: number
  kind: string
  words: number
  text: string
}

const lines = readFileSync(BEATS, "utf-8").trim().split("\n")
const beats: Beat[] = lines.map(l => JSON.parse(l))

const BOOKS = ["crystal_shard", "streams_of_silver", "halflings_gem"] as const
const KINDS = ["action", "dialogue", "interiority", "description"] as const

const OPENER_KINDS = [
  "subject-first",
  "adverbial-first",
  "participial-first",
  "conjunction-first",
  "dialogue-first",
  "interjection-first",
  "other",
] as const
type OpenerKind = (typeof OPENER_KINDS)[number]

// ─────────────────────────────────────────────────────────────────────────────
// Sentence splitter (matches sibling P29/P34a convention)

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

// ─────────────────────────────────────────────────────────────────────────────
// Lexicons

// Sentence-initial pronouns and demonstratives. We treat these as subject-first
// (very common Salvatore opener).
const PRONOUNS = new Set([
  "i", "you", "he", "she", "it", "we", "they",
  "his", "her", "its", "their", "our", "my", "your",
  "this", "that", "these", "those",
  "who", "whom", "whose", "which", "what",
  // Reflexive / emphatic — rare opener but cover them
  "himself", "herself", "itself", "themselves",
])

// Articles and quantifiers that begin a noun-phrase subject:
//   "The dwarf grinned." / "A shadow moved." / "Some men live for the gold."
const NP_DETERMINERS = new Set([
  "the", "a", "an",
  "some", "many", "few", "several", "all", "any", "every", "each",
  "both", "neither", "either", "no",
  "more", "most", "less", "least",
  "another", "other", "such", "much",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
])

// Coordinating + sentence-initial subordinating conjunctions. We exclude common
// adverbs that double as connectors ("then", "still", "yet" — those go in the
// adverbial bucket since opener function is closer to adverbial there).
const CONJUNCTIONS = new Set([
  "and", "but", "or", "nor", "so", "for",  // coordinating
  "because", "although", "though", "whereas", "while", "since", "until",
  "if", "unless", "when", "whenever", "where", "wherever", "as",
])

// Common manner / time / frequency / sentence adverbs we want to catch as
// adverbial-first when they open a sentence. -ly tail is also caught later.
const ADVERBS_NON_LY = new Set([
  "now", "then", "here", "there", "today", "yesterday", "tomorrow", "soon",
  "later", "afterward", "afterwards", "before", "again", "still", "yet",
  "ever", "never", "always", "often", "sometimes", "seldom", "rarely",
  "perhaps", "maybe", "indeed", "instead", "however", "moreover", "thus",
  "therefore", "meanwhile", "anyway", "anyhow", "so", "well",
  "once", "twice", "thrice", "first", "second", "third", "next", "finally",
  "everywhere", "anywhere", "somewhere", "nowhere",
  "outside", "inside", "above", "below", "ahead", "behind", "around",
  "down", "up", "off", "on", "in", "out", "back", "forward",
])

// Sentence-initial prepositions. If sentence opens with one of these followed
// by a noun-phrase (likely an adjunct PP), we tag adverbial-first.
const PREPOSITIONS = new Set([
  "in", "on", "at", "by", "with", "without", "from", "to", "into", "onto",
  "upon", "under", "underneath", "over", "above", "below", "beneath",
  "behind", "before", "after", "between", "among", "amongst", "through",
  "throughout", "across", "around", "near", "beside", "besides", "within",
  "during", "since", "until", "till", "toward", "towards", "against",
  "about", "of", "off", "out", "amid", "amidst", "despite", "because",
])

// Common interjections / exclamations
const INTERJECTIONS = new Set([
  "oh", "ah", "ow", "ouch", "wow", "hey", "ho", "hush", "alas", "behold",
  "lo", "yes", "no", "well", "aye", "nay", "indeed", "bah", "pah", "hmm",
  "huh", "what", "shh", "ssh", "phew", "ha", "haha", "heh", "hark", "huzzah",
  "egads", "gods", "by-the-gods", "damn",
])

// Auxiliaries / common verb forms that begin imperatives, questions, or
// inverted clauses. We treat sentence-initial auxiliary as "other" by default
// since it's neither subject-first nor adverbial.
const AUXILIARIES = new Set([
  "is", "am", "are", "was", "were", "be", "been", "being",
  "have", "has", "had",
  "do", "does", "did",
  "will", "would", "shall", "should", "may", "might", "must", "can", "could",
  "let", "lets",
])

// Strip a token to lowercase alphabetic core (drop quote marks, punctuation, dashes etc.)
function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, "")
}

// Detect dialogue-first: sentence's first non-whitespace character is a quote mark.
const QUOTE_OPENERS = new Set(["\"", "“", "”", "'", "‘", "’", "`"])
function startsWithQuote(s: string): boolean {
  if (s.length === 0) return false
  const c = s[0]!
  return QUOTE_OPENERS.has(c)
}

// Capitalized-word check — used to detect proper-noun subjects.
function isCapitalized(rawToken: string): boolean {
  if (!rawToken) return false
  // Find first letter character (skip leading punctuation like quotes, dashes).
  for (const c of rawToken) {
    if (/[A-Za-z]/.test(c)) return /[A-Z]/.test(c)
  }
  return false
}

// Participle test:
//  - present participle: ends -ing on a 4+-letter token
//  - past participle:    ends -ed on a 4+-letter token
// We then check that the token is followed by a comma OR by a sentence
// continuation that fits a participle phrase. We use a comma-presence heuristic
// to avoid mis-tagging "Stepping" as participial when the sentence is actually
// "Stepping was difficult." (rare in narrative prose).
function looksLikeParticiple(rawToken: string): boolean {
  const norm = normalizeToken(rawToken)
  if (norm.length < 4) return false
  if (norm.endsWith("ing")) return true
  if (norm.endsWith("ed")) return true
  return false
}

// A handful of common -ed/-ing words that are NOT participles (or that the
// classifier should treat as something else when they open a sentence).
const FALSE_PARTICIPLES = new Set([
  "during", "according", "regarding", "concerning",  // prepositions
  "indeed", "instead",                                // not -ed/-ing but for safety
])

// ─────────────────────────────────────────────────────────────────────────────
// Classifier

type Classification = {
  kind: OpenerKind
  reason: string  // short rationale, useful for spot-checking later
}

function classifyOpener(sentence: string): Classification {
  if (startsWithQuote(sentence)) {
    return { kind: "dialogue-first", reason: "starts-with-quote-mark" }
  }

  // Strip leading non-letters before tokenizing (handles em-dash starts, etc.)
  const stripped = sentence.replace(/^[\s—–\-]+/, "")
  // Tokenize on whitespace, keep raw form for capitalization check
  const rawTokens = stripped.split(/\s+/).filter(t => t.length > 0)
  if (rawTokens.length === 0) return { kind: "other", reason: "empty-after-strip" }

  const t0Raw = rawTokens[0]!
  const t1Raw = rawTokens[1] ?? ""
  const t0 = normalizeToken(t0Raw)
  const t1 = normalizeToken(t1Raw)

  // 1. Conjunctions take precedence over adverbial detection
  if (CONJUNCTIONS.has(t0)) {
    return { kind: "conjunction-first", reason: `conjunction[${t0}]` }
  }

  // 2. Interjections — usually followed by comma or exclamation
  if (INTERJECTIONS.has(t0)) {
    // Disambiguate "Well" + verb (rare but possible)
    return { kind: "interjection-first", reason: `interjection[${t0}]` }
  }

  // 3. Participial phrase: leading -ing or -ed verb followed by a comma in
  //    the next ~4 tokens. We require the comma to disambiguate from cases
  //    where the participle-shaped word is the subject ("Running was hard.").
  if (!FALSE_PARTICIPLES.has(t0) && looksLikeParticiple(t0Raw)) {
    // Check whether a comma appears within the first ~6 raw tokens (typical
    // participial phrase: "Stepping back, he raised his blade.")
    const head = rawTokens.slice(0, 6).join(" ")
    if (head.includes(",")) {
      return { kind: "participial-first", reason: `participle-with-comma[${t0}]` }
    }
    // Without a comma, it's usually a subject ("Running through the forest he saw...")
    // We fall through to subject-first / other classification.
  }

  // 4. Adverbial-first:
  //    a. token ends in -ly (manner adverb)
  //    b. token in non-ly adverb whitelist
  //    c. token is a preposition (likely an opening prepositional phrase)
  //    For (a) and (b), we want "Carefully, he stepped" — comma optional but common.
  //    For (c), we require that the next token doesn't immediately make a clause
  //    subject (i.e., we treat "In the dark, he stepped" as adverbial).
  if (/^[a-z]{3,}ly$/.test(t0) && !PREPOSITIONS.has(t0)) {
    return { kind: "adverbial-first", reason: `adverb-ly[${t0}]` }
  }
  if (ADVERBS_NON_LY.has(t0)) {
    return { kind: "adverbial-first", reason: `adverb-list[${t0}]` }
  }
  if (PREPOSITIONS.has(t0)) {
    // Treat sentence-initial preposition as adverbial-first PP.
    return { kind: "adverbial-first", reason: `preposition[${t0}]` }
  }

  // 5. Subject-first: pronouns, NP determiners, capitalized proper nouns.
  if (PRONOUNS.has(t0)) {
    return { kind: "subject-first", reason: `pronoun[${t0}]` }
  }
  if (NP_DETERMINERS.has(t0)) {
    return { kind: "subject-first", reason: `np-determiner[${t0}]` }
  }
  if (isCapitalized(t0Raw) && !AUXILIARIES.has(t0)) {
    // A capitalized first word at sentence start is normal — but we want to
    // count proper-noun subjects ("Drizzt rose."). Sentence-initial cap is
    // ALWAYS true at sentence start, so the discriminator must be something
    // else: most subjects are nouns, not auxiliaries / verbs.
    // We treat capitalized + non-aux + non-conj + non-prep + non-adverb as
    // subject-first (default narrative subject opener).
    return { kind: "subject-first", reason: `proper-noun[${t0}]` }
  }

  // 6. Auxiliary-led inversion / imperative — bucket as "other"
  if (AUXILIARIES.has(t0)) {
    return { kind: "other", reason: `auxiliary[${t0}]` }
  }

  // 7. Fall-through: treat as "other" with the token recorded.
  return { kind: "other", reason: `unclassified[${t0}]` }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main analysis

type CountTable = Record<OpenerKind, number>
function emptyCountTable(): CountTable {
  return Object.fromEntries(OPENER_KINDS.map(k => [k, 0])) as CountTable
}

function shareTable(counts: CountTable): Record<OpenerKind, number> {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (total === 0) return Object.fromEntries(OPENER_KINDS.map(k => [k, 0])) as Record<OpenerKind, number>
  return Object.fromEntries(
    OPENER_KINDS.map(k => [k, Math.round((counts[k] / total) * 10000) / 10000]),
  ) as Record<OpenerKind, number>
}

function modal(counts: CountTable): { kind: OpenerKind; share: number } {
  let bestKind: OpenerKind = "other"
  let bestCount = -1
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  for (const k of OPENER_KINDS) {
    if (counts[k] > bestCount) {
      bestCount = counts[k]
      bestKind = k
    }
  }
  return { kind: bestKind, share: total > 0 ? Math.round((bestCount / total) * 10000) / 10000 : 0 }
}

const perBookCounts: Record<string, CountTable> = {}
const perBookKindCounts: Record<string, Record<string, CountTable>> = {}
const perKindAllBooksCounts: Record<string, CountTable> = {}
const perBookSentenceCounts: Record<string, number> = {}

// Spot-check buckets — keep the first ~3 examples per (book, opener-kind) for review
const examples: Record<string, Record<OpenerKind, string[]>> = {}

// Token frequency tables per opener-kind per book — useful for QA
const tokenFreq: Record<string, Record<OpenerKind, Record<string, number>>> = {}

for (const book of BOOKS) {
  perBookCounts[book] = emptyCountTable()
  perBookKindCounts[book] = {}
  perBookSentenceCounts[book] = 0
  examples[book] = Object.fromEntries(OPENER_KINDS.map(k => [k, []])) as Record<OpenerKind, string[]>
  tokenFreq[book] = Object.fromEntries(OPENER_KINDS.map(k => [k, {} as Record<string, number>])) as Record<OpenerKind, Record<string, number>>
  for (const kind of KINDS) perBookKindCounts[book]![kind] = emptyCountTable()
}
for (const kind of KINDS) perKindAllBooksCounts[kind] = emptyCountTable()

let totalSentences = 0
for (const b of beats) {
  if (!BOOKS.includes(b.book as typeof BOOKS[number])) continue
  if (!KINDS.includes(b.kind as typeof KINDS[number])) continue  // skip stakes_recalibration

  const sentences = splitSentences(b.text)
  perBookSentenceCounts[b.book] = (perBookSentenceCounts[b.book] ?? 0) + sentences.length
  totalSentences += sentences.length

  for (const s of sentences) {
    const cls = classifyOpener(s)

    perBookCounts[b.book]![cls.kind]++
    perBookKindCounts[b.book]![b.kind]![cls.kind]++
    perKindAllBooksCounts[b.kind]![cls.kind]++

    // Track first 3 examples per (book, opener-kind) for spot-check
    const ex = examples[b.book]![cls.kind]
    if (ex.length < 3) ex.push(s.length > 200 ? s.slice(0, 200) + "..." : s)

    // Token frequency: just the first normalized token
    const stripped = s.replace(/^[\s—–\-]+/, "")
    const t0Raw = stripped.split(/\s+/)[0] ?? ""
    const t0 = normalizeToken(t0Raw)
    if (t0) {
      tokenFreq[b.book]![cls.kind][t0] = (tokenFreq[b.book]![cls.kind][t0] ?? 0) + 1
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-book summary

const perBookSummary: Record<string, {
  total_sentences: number
  counts: CountTable
  shares: Record<OpenerKind, number>
  modal: { kind: OpenerKind; share: number }
}> = {}

for (const book of BOOKS) {
  perBookSummary[book] = {
    total_sentences: perBookSentenceCounts[book]!,
    counts: perBookCounts[book]!,
    shares: shareTable(perBookCounts[book]!),
    modal: modal(perBookCounts[book]!),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-(book, kind) summary

const perBookKindSummary: Record<string, Record<string, {
  total_sentences: number
  counts: CountTable
  shares: Record<OpenerKind, number>
  modal: { kind: OpenerKind; share: number }
}>> = {}
for (const book of BOOKS) {
  perBookKindSummary[book] = {}
  for (const kind of KINDS) {
    const counts = perBookKindCounts[book]![kind]!
    const total = Object.values(counts).reduce((a, b) => a + b, 0)
    perBookKindSummary[book]![kind] = {
      total_sentences: total,
      counts,
      shares: shareTable(counts),
      modal: modal(counts),
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate per-kind across all 3 books

const perKindAggregateSummary: Record<string, {
  total_sentences: number
  counts: CountTable
  shares: Record<OpenerKind, number>
  modal: { kind: OpenerKind; share: number }
}> = {}
for (const kind of KINDS) {
  const counts = perKindAllBooksCounts[kind]!
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  perKindAggregateSummary[kind] = {
    total_sentences: total,
    counts,
    shares: shareTable(counts),
    modal: modal(counts),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-book directional comparison

// For each opener-kind, compute the share spread (max - min) across the 3 books.
// Spread <= 0.05 = stable; spread <= 0.10 = mild drift; > 0.10 = directional drift.
const openerSpread: Record<OpenerKind, {
  shares_per_book: Record<string, number>
  min: number
  max: number
  spread: number
  verdict: string
}> = {} as Record<OpenerKind, {
  shares_per_book: Record<string, number>
  min: number
  max: number
  spread: number
  verdict: string
}>
for (const ok of OPENER_KINDS) {
  const sharesPerBook: Record<string, number> = {}
  const values: number[] = []
  for (const book of BOOKS) {
    sharesPerBook[book] = perBookSummary[book]!.shares[ok]
    values.push(perBookSummary[book]!.shares[ok])
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const spread = Math.round((max - min) * 10000) / 10000
  let verdict: string
  if (spread <= 0.05) verdict = "stable"
  else if (spread <= 0.10) verdict = "mild-drift"
  else verdict = "directional-drift"
  openerSpread[ok] = { shares_per_book: sharesPerBook, min, max, spread, verdict }
}

// Modal opener stability — does each book have the same modal opener kind?
const modalsPerBook: Record<string, OpenerKind> = {}
for (const book of BOOKS) modalsPerBook[book] = perBookSummary[book]!.modal.kind
const modalsAgree = new Set(Object.values(modalsPerBook)).size === 1

// Per-kind modal stability — does each beat-kind have the same modal opener across books?
const perKindModalStability: Record<string, {
  modal_per_book: Record<string, OpenerKind>
  stable: boolean
}> = {}
for (const kind of KINDS) {
  const m: Record<string, OpenerKind> = {}
  for (const book of BOOKS) m[book] = perBookKindSummary[book]![kind]!.modal.kind
  const stable = new Set(Object.values(m)).size === 1
  perKindModalStability[kind] = { modal_per_book: m, stable }
}

// Subject-first vs participial directional check by kind:
// craft hypothesis: action beats lean MORE participial-first than other kinds.
const participialShareByKind: Record<string, Record<string, number>> = {}
for (const kind of KINDS) {
  participialShareByKind[kind] = {}
  for (const book of BOOKS) {
    participialShareByKind[kind]![book] = perBookKindSummary[book]![kind]!.shares["participial-first"]
  }
}

// Hypothesis check: in every book, action beats have a higher participial-first
// share than dialogue/description/interiority? (cross-book reproducibility test)
const actionMostParticipialInEveryBook = BOOKS.every(book => {
  const actionShare = perBookKindSummary[book]!.action!.shares["participial-first"]
  return KINDS.filter(k => k !== "action").every(otherKind =>
    actionShare > perBookKindSummary[book]![otherKind]!.shares["participial-first"],
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Top 10 token list per opener-kind per book — useful QA artifact

function topTokensForKind(book: string, kind: OpenerKind, n = 10): { token: string; count: number }[] {
  const freq = tokenFreq[book]?.[kind] ?? {}
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([token, count]) => ({ token, count }))
}

const topTokensPerBookPerKind: Record<string, Record<OpenerKind, { token: string; count: number }[]>> = {}
for (const book of BOOKS) {
  topTokensPerBookPerKind[book] = Object.fromEntries(
    OPENER_KINDS.map(k => [k, topTokensForKind(book, k, 10)]),
  ) as Record<OpenerKind, { token: string; count: number }[]>
}

// ─────────────────────────────────────────────────────────────────────────────
// Directional summary — written as text for the conclusions doc

const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")

const out = {
  pattern: "39",
  name: "Sentence-opener distribution",
  computedAt: new Date().toISOString(),
  corpus: "salvatore-icewind-dale",
  books: BOOKS,
  rationale:
    "Tests how Salvatore opens his sentences — subject-first (the default English narrative shape), adverbial-first, participial-first, conjunction-first, dialogue-first, interjection-first, or other. Per-book stability, per-kind breakdown (does action lean participial / does interiority lean conjunction-first 'And he wondered...'), and cross-book reproducibility. Output informs (a) writer-prompt voice priors (target opener-mix), (b) lint targets (e.g., flag prose with > X% participial-first if Salvatore stays under that), and (c) cross-corpus comparison with future authors.",
  methodology: {
    sentence_split: "regex (?<=[.!?])\\s+",
    opener_classifier: "rule-based first-word lookup against curated lexicons (pronouns, NP determiners, conjunctions, prepositions, adverbs, interjections, auxiliaries) + morphological suffix detection (-ly for adverbs, -ing/-ed + early-comma for participles) + capitalization (proper-noun subject) + sentence-initial quote-mark for dialogue-first",
    decision_order: [
      "1. starts-with-quote-mark → dialogue-first",
      "2. first token in CONJUNCTIONS lexicon → conjunction-first",
      "3. first token in INTERJECTIONS lexicon → interjection-first",
      "4. first token matches participle morphology (-ing/-ed) AND a comma appears in first 6 tokens → participial-first",
      "5. first token ends in -ly OR is in ADVERBS_NON_LY OR is in PREPOSITIONS → adverbial-first",
      "6. first token is pronoun/NP-determiner OR is capitalized (proper noun) → subject-first",
      "7. first token is auxiliary verb → other",
      "8. fall-through → other",
    ],
    caveats: [
      "Sentence-initial capitalization is always true at sentence start, so the proper-noun subject test relies on the negative space — the token wasn't a conjunction, interjection, participle, adverb, preposition, pronoun, NP-determiner, or auxiliary, AND it's a normal capitalized word.",
      "Participle detection requires a comma within the first 6 tokens to avoid mis-tagging '-ing' subjects ('Running was hard.'). This means participial phrases without a setting-off comma will be mis-classified as subject-first. Salvatore's prose almost always uses the comma, so the loss is small.",
      "'No', 'Yes', 'Well', 'Indeed' all appear in both the interjection list AND the adverb list — interjection wins by decision order (rule 3 before rule 5).",
      "Sentence-initial 'And', 'But', 'Or' is widely flagged as conjunction-first — this is intentional; it's a stylistic opener (King, Cormac McCarthy) and we want to count it.",
      "'In', 'On', 'At', 'By', 'With' opening a PP (e.g., 'In the gloom, he saw a shadow.') is bucketed as adverbial-first.",
      "False-positives flow into 'other' — its share is the residual diagnostic.",
    ],
  },
  total_sentences: totalSentences,
  per_book: perBookSummary,
  per_book_kind: perBookKindSummary,
  per_kind_aggregate: perKindAggregateSummary,
  cross_book_directional: {
    opener_share_spread: openerSpread,
    modal_per_book: modalsPerBook,
    modal_stable_across_books: modalsAgree,
    per_kind_modal_stability: perKindModalStability,
    action_most_participial_in_every_book: actionMostParticipialInEveryBook,
    participial_first_share_by_kind: participialShareByKind,
  },
  top_tokens_per_book_per_kind: topTokensPerBookPerKind,
  examples,
}

const path = `${OUT_DIR}/crystal_shard.${ts}.sentence-opener-distribution.json`
writeFileSync(path, JSON.stringify(out, null, 2))
console.log(`wrote ${path}`)
console.log(`total sentences classified: ${totalSentences}`)

// Print per-book summary table
console.log("\n=== Per-book opener distribution (% of sentences) ===")
const header = ["book", ...OPENER_KINDS, "n", "modal"].join("\t")
console.log(header)
for (const book of BOOKS) {
  const row = [
    book,
    ...OPENER_KINDS.map(k => `${(perBookSummary[book]!.shares[k] * 100).toFixed(1)}%`),
    perBookSummary[book]!.total_sentences.toString(),
    perBookSummary[book]!.modal.kind,
  ].join("\t")
  console.log(row)
}

// Print per-kind aggregate
console.log("\n=== Per-kind opener distribution (3-book aggregate, % of sentences) ===")
console.log(["kind", ...OPENER_KINDS, "n", "modal"].join("\t"))
for (const kind of KINDS) {
  const row = [
    kind,
    ...OPENER_KINDS.map(k => `${(perKindAggregateSummary[kind]!.shares[k] * 100).toFixed(1)}%`),
    perKindAggregateSummary[kind]!.total_sentences.toString(),
    perKindAggregateSummary[kind]!.modal.kind,
  ].join("\t")
  console.log(row)
}

// Cross-book directional verdict
console.log("\n=== Cross-book directional ===")
console.log(`Modal opener per book: ${JSON.stringify(modalsPerBook)} — agree = ${modalsAgree}`)
console.log(`Action beats most participial in every book: ${actionMostParticipialInEveryBook}`)
for (const ok of OPENER_KINDS) {
  console.log(`  ${ok}: spread = ${openerSpread[ok].spread} — ${openerSpread[ok].verdict}`)
}
