/**
 * entity-candidates.ts — Deterministic named-entity candidate extractor for
 * the §7 hallucination grounding loop.
 *
 * TELEMETRY ONLY. This module is NOT wired into the production checker
 * pipeline. It does NOT block, does NOT change checker pass/fail, and does
 * NOT call any LLM. It emits a flat list of capitalized-phrase candidates
 * that a future calibration loop can compare against the LLM-based
 * `halluc-ungrounded` checker (see `src/agents/halluc-ungrounded/`).
 *
 * Design rationale:
 *   - The live `halluc-ungrounded` checker runs at ~70% recall and is
 *     stochastic. A deterministic NER pre-pass gives (a) a recall floor that
 *     is not dependent on LLM sampling, (b) a way to measure where the LLM
 *     checker disagrees with deterministic candidates, and (c) eventual
 *     blocker behavior on EXACT misses while keeping the LLM as a softer
 *     layer.
 *   - This module BUILDS the extractor only. Calibration vs the LLM checker
 *     and any blocker promotion are separate loops (see `docs/todo.md` §7).
 *
 * Three candidate classes, mirrored from
 * `src/agents/halluc-ungrounded/halluc-ungrounded-system.md`:
 *
 *   1. `title-pair` — A title token (Master, Lord, Captain, Arbiter, ...)
 *      followed by a Capitalized Word. e.g. "Master Orin", "Castellan Vesh".
 *
 *   2. `capitalized-multi-word` — 2+ consecutive capitalized words that are
 *      NOT at the start of a sentence and NOT entirely composed of
 *      common-words (the/a/and/...). e.g. "Sundered Crown", "Veyr Dominion",
 *      "Halrune Vale".
 *
 *   3. `suffix-class` — A capitalized phrase ending with a known
 *      institutional/place/faction suffix (Order, Concord, Vale, Dominion,
 *      ...) immediately preceded by a Capitalized Word. e.g.
 *      "Bellward Order", "Briar Pass". The suffix MUST be preceded by a
 *      capitalized non-article word.
 *
 * Filters (do NOT emit):
 *   - Sentence-initial capitalization (the first capitalized token after
 *     ., !, ?, paragraph break, or string start).
 *   - Single capitalized words (the LLM checker handles bare names well).
 *   - Phrases composed entirely of common-words.
 *   - Anything inside `*italics*` markdown spans (per the existing
 *     `halluc-ungrounded` rule that excludes in-prose written-document
 *     content).
 *
 * Pure function. No I/O, no DB, no LLM. Returns offsets into the original
 * `prose` string (not into a normalized form).
 *
 * Known limitations (deliberate punts):
 *   - Italics detection uses a single-line `*...*` pattern. Multi-line
 *     italics or escaped asterisks are NOT handled. If the writer ever
 *     emits true emphasis-vs-italics distinction, this needs to be
 *     revisited. For the calibration loop's purposes, the asterisk-pair
 *     heuristic catches the dominant in-prose-document case.
 *   - Underscore italics (`_..._`) and HTML `<em>` are not supported.
 *   - Sentence-initial detection is regex-based on `[.!?]` followed by
 *     whitespace + capital; quoted dialogue with sentence-final `?"` is
 *     handled, but complex nested quotes may misclassify.
 *   - The capitalized-multi-word class can OVER-emit on adjacent proper
 *     nouns that are in fact a single grounded entity ("Aldric Venn" if
 *     both names are grounded separately). De-duplication against the
 *     grounded surface happens in the downstream calibration step, not
 *     here.
 *   - Title-pair tokens are matched case-sensitively against the exact
 *     forms in `TITLE_TOKENS`; lowercase or pluralized titles ("masters",
 *     "lords") are NOT detected.
 */

// ── Lexicons ─────────────────────────────────────────────────────────────────

/**
 * Title tokens that bind to a following Capitalized Word to form a
 * `title-pair` candidate. Sourced from
 * `src/agents/halluc-ungrounded/halluc-ungrounded-system.md` section 13
 * (title + name pairs) and the synthetic fixture set in `docs/todo.md` §7.
 */
export const TITLE_TOKENS: readonly string[] = [
  "Master",
  "Lord",
  "Lady",
  "Sir",
  "Captain",
  "Arbiter",
  "Castellan",
  "Guildmaster",
  "Magister",
  "Father",
  "Brother",
  "Sister",
  "Doctor",
  "Professor",
  "King",
  "Queen",
  "Prince",
  "Princess",
  "Duke",
  "Duchess",
  "General",
] as const

/**
 * Suffix tokens that, when preceded by a Capitalized Word, form a
 * `suffix-class` candidate. Sourced from
 * `src/agents/halluc-ungrounded/halluc-ungrounded-system.md` sections 14
 * (institutions) and 15 (places/realms).
 */
export const SUFFIX_TOKENS: readonly string[] = [
  "Order",
  "Concord",
  "Vale",
  "Dominion",
  "Coast",
  "Pass",
  "Crown",
  "Quill",
  "Vault",
  "Council",
  "Senate",
  "Empire",
  "Kingdom",
  "League",
  "Confederacy",
  "Reach",
  "March",
  "Watch",
] as const

/**
 * Common (closed-class) words that must NOT be the entire content of a
 * candidate. A `capitalized-multi-word` candidate composed only of these
 * is filtered. Capitalized articles/conjunctions at sentence-start are
 * also filtered by the sentence-initial check.
 */
const COMMON_WORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "so", "yet",
  "of", "to", "in", "on", "at", "by", "for", "with", "from", "into",
  "is", "are", "was", "were", "be", "been", "being",
  "this", "that", "these", "those",
  "he", "she", "it", "they", "we", "you", "i",
  "his", "her", "its", "their", "our", "your", "my",
  "as", "than", "while", "when", "where", "why", "how",
])

// ── Class regexes ────────────────────────────────────────────────────────────

/**
 * Title-pair regex: a TITLE token followed by whitespace and a single
 * Capitalized Word (with optional internal apostrophe/hyphen).
 *
 * Exported so callers can introspect or reuse. Each call site should
 * construct its own RegExp instance (or reset `.lastIndex`) because the
 * `g` flag carries state.
 */
export function titlePairRegex(): RegExp {
  const titles = TITLE_TOKENS.join("|")
  return new RegExp(`\\b(?:${titles})\\s+[A-Z][a-zA-Z'-]+`, "g")
}

/**
 * Capitalized-multi-word regex: 2+ consecutive Capitalized Words separated
 * by single spaces. Each word starts with [A-Z] followed by ≥1 lowercase
 * letter (this excludes ALL-CAPS shouts like "STOP" and single-letter
 * initials).
 *
 * Sentence-initial filtering happens in the consumer; this regex matches
 * candidates anywhere in the string.
 */
export function capitalizedMultiWordRegex(): RegExp {
  return /\b[A-Z][a-z][a-zA-Z'-]*(?:\s+[A-Z][a-z][a-zA-Z'-]*)+/g
}

/**
 * Suffix-class regex: a Capitalized Word followed by whitespace and one of
 * the SUFFIX tokens. The capitalized prefix word excludes the COMMON_WORDS
 * articles by requiring at least one lowercase letter (covers "The" via
 * the post-filter; covers "And"/"Or" via word-list filter).
 */
export function suffixClassRegex(): RegExp {
  const suffixes = SUFFIX_TOKENS.join("|")
  return new RegExp(`\\b[A-Z][a-z][a-zA-Z'-]*\\s+(?:${suffixes})\\b`, "g")
}

// ── Public types ────────────────────────────────────────────────────────────

export type EntityCandidateClass = "title-pair" | "capitalized-multi-word" | "suffix-class"

export interface EntityCandidate {
  /** The matched phrase, exact substring of the original prose. */
  phrase: string
  /** Which extractor class fired this candidate. */
  class: EntityCandidateClass
  /** Inclusive character offset of the first character of the phrase. */
  offsetStart: number
  /** Exclusive character offset one past the last character of the phrase. */
  offsetEnd: number
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute the set of [start, end) character spans inside `prose` that lie
 * within `*...*` italics. Single-line only — does not span paragraph
 * breaks. See module-level "Known limitations".
 */
function italicsSpans(prose: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  // Non-greedy `*...*` on a single line. We match `[^*\n]+` to avoid
  // consuming asterisks (so adjacent `*a* *b*` parses as two spans, not one)
  // and newlines (so the italics span doesn't accidentally swallow a whole
  // paragraph if a writer leaves an unbalanced asterisk).
  const re = /\*([^*\n]+)\*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(prose)) !== null) {
    spans.push([m.index, m.index + m[0].length])
  }
  return spans
}

function offsetIsInsideAnySpan(offset: number, spans: Array<[number, number]>): boolean {
  for (const [start, end] of spans) {
    if (offset >= start && offset < end) return true
  }
  return false
}

/**
 * Compute the set of character offsets that are sentence-initial. An
 * offset is sentence-initial if the first non-whitespace, non-quote
 * character at or after the offset is preceded (skipping whitespace and
 * closing quotes) by `.`, `!`, `?`, a paragraph break, or the string
 * start.
 *
 * Implementation: we scan forward and remember the most recent sentence
 * boundary; any candidate whose start offset matches the next
 * capital-letter position after that boundary is considered
 * sentence-initial.
 */
function isSentenceInitial(prose: string, offset: number): boolean {
  if (offset === 0) return true
  // Walk backward over whitespace and opening quotes/parens.
  let i = offset - 1
  while (i >= 0 && /[\s"'`(\[“‘]/.test(prose[i])) i--
  if (i < 0) return true // only whitespace/quotes precede us
  const prev = prose[i]
  return prev === "." || prev === "!" || prev === "?" || prev === "\n"
}

/** True if every space-separated token in `phrase` is in COMMON_WORDS. */
function isAllCommonWords(phrase: string): boolean {
  const tokens = phrase.split(/\s+/).filter(t => t.length > 0)
  if (tokens.length === 0) return true
  return tokens.every(t => COMMON_WORDS.has(t.toLowerCase()))
}

// ── Main extractor ──────────────────────────────────────────────────────────

/**
 * Extract deterministic named-entity candidates from prose.
 *
 * Returns one candidate per match, sorted by `offsetStart` ascending. A
 * single string position may produce multiple candidates if it satisfies
 * multiple class regexes (e.g. "Master Orin" emits a `title-pair`;
 * "Bellward Order" emits both `capitalized-multi-word` AND `suffix-class`).
 * The downstream calibration loop is responsible for de-duplication.
 *
 * @param prose The raw beat prose to scan. Pure read; not mutated.
 * @returns Sorted list of EntityCandidate. Empty array on empty input.
 */
export function extractEntityCandidates(prose: string): EntityCandidate[] {
  if (!prose || prose.length === 0) return []

  const italics = italicsSpans(prose)
  const candidates: EntityCandidate[] = []

  // 1. title-pair
  const titleRe = titlePairRegex()
  let m: RegExpExecArray | null
  while ((m = titleRe.exec(prose)) !== null) {
    const start = m.index
    const end = start + m[0].length
    if (offsetIsInsideAnySpan(start, italics)) continue
    if (isSentenceInitial(prose, start)) continue
    candidates.push({
      phrase: m[0],
      class: "title-pair",
      offsetStart: start,
      offsetEnd: end,
    })
  }

  // 2. capitalized-multi-word
  const multiRe = capitalizedMultiWordRegex()
  while ((m = multiRe.exec(prose)) !== null) {
    const start = m.index
    const end = start + m[0].length
    if (offsetIsInsideAnySpan(start, italics)) continue
    if (isSentenceInitial(prose, start)) continue
    if (isAllCommonWords(m[0])) continue
    candidates.push({
      phrase: m[0],
      class: "capitalized-multi-word",
      offsetStart: start,
      offsetEnd: end,
    })
  }

  // 3. suffix-class
  const suffixRe = suffixClassRegex()
  while ((m = suffixRe.exec(prose)) !== null) {
    const start = m.index
    const end = start + m[0].length
    if (offsetIsInsideAnySpan(start, italics)) continue
    if (isSentenceInitial(prose, start)) continue
    // Suffix-class is by construction multi-word and starts with a real
    // capitalized word; no all-common-words check needed.
    candidates.push({
      phrase: m[0],
      class: "suffix-class",
      offsetStart: start,
      offsetEnd: end,
    })
  }

  candidates.sort((a, b) => {
    if (a.offsetStart !== b.offsetStart) return a.offsetStart - b.offsetStart
    // Stable secondary order: title-pair < capitalized-multi-word < suffix-class
    return classOrder(a.class) - classOrder(b.class)
  })

  return candidates
}

function classOrder(c: EntityCandidateClass): number {
  switch (c) {
    case "title-pair": return 0
    case "capitalized-multi-word": return 1
    case "suffix-class": return 2
  }
}
