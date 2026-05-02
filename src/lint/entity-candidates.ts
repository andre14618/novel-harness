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
 * Five candidate classes:
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
 *   4. `x-of-y-capitalized` (L15) — An "X of Y" connector pattern where X
 *      and Y are Capitalized Words. Catches realm/artifact/institution names
 *      like "Crown of Hyran", "Order of Vesh", "Vale of Whispers" where the
 *      lowercase preposition "of" would break the consecutive-capitalization
 *      detector. Optional leading article ("the") is matched and included.
 *      See L15 (commit context, exp #TBD).
 *
 *   5. `number-word-tail` (L15) — A Capitalized Word (optionally article-
 *      prefixed) ending in an English number-word (Zero, One, ..., Eight,
 *      ..., Hundred). Catches faction/artifact names like "the Veiled Eight",
 *      "the Sigil of Eight" (x-of-y also fires for the latter), "Council of
 *      Seven", "the Forty-Seven Tongues" where the numeric tail is not in the
 *      existing suffix vocabulary.
 *      See L15 (commit context, exp #TBD).
 *
 * Filters (do NOT emit):
 *   - Sentence-initial capitalization (the first capitalized token after
 *     ., !, ?, paragraph break, or string start) — applies to the
 *     `capitalized-multi-word` and `suffix-class` passes only. The
 *     `title-pair`, `x-of-y-capitalized`, and `number-word-tail` passes are
 *     EXEMPT because their patterns are structurally high-signal (a
 *     "CapWord of CapWord" or "the CapWord NumberWord" pattern can only
 *     match a proper-noun-like construct regardless of position).
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
 *   - `x-of-y-capitalized` matches "King of England" — that is intentional;
 *     it is likely a proper proper-noun in fantasy prose and the downstream
 *     grounded-surface check suppresses it if it appears in the bible.
 *   - `number-word-tail` matches any CapWord ending in a number-word,
 *     including grounded entities. The downstream grounded-surface check
 *     suppresses those; the extractor's job is recall-floor coverage.
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
 * English number-word tokens that, when used as a tail of a Capitalized
 * phrase, signal a faction/artifact name like "the Veiled Eight" or
 * "the Council of Forty-Seven". These are treated like suffix-class tokens
 * for the `number-word-tail` extractor class (L15).
 *
 * Includes cardinal words one through twenty, round-number words (Thirty,
 * Forty, ..., Ninety), and large magnitudes (Hundred, Thousand, Million,
 * Billion). Does NOT include ordinals ("First", "Second", ...) because
 * those are also common adjectives; ordinal matching would require
 * stricter context.
 *
 * Hyphenated composites like "Forty-Seven" are handled by the regex
 * allowing an optional `-NumberWord` suffix after the primary word.
 */
export const NUMBER_WORD_TOKENS: readonly string[] = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
  "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
  "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty", "Thirty",
  "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
  "Hundred", "Thousand", "Million", "Billion",
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

/**
 * X-of-Y capitalized regex (L15): matches "Cap[Word] of Cap[Word[(Word)]?]"
 * where the two sides of "of" are each one or two Capitalized Words. An
 * optional leading article "the" or "The" is captured as part of the match
 * so the full phrase (including the article) is returned.
 *
 * Examples that MUST fire:
 *   "Crown of Hyran", "the Crown of Hyran"
 *   "Order of Vesh", "Vale of Whispers"
 *   "Sigil of Eight"           (the number-word-tail class also fires)
 *   "Council of Forty-Seven Tongues"  (multi-word Y)
 *   "King of England"          (intentional; grounded-surface check suppresses)
 *
 * Examples that MUST NOT fire:
 *   "out of nowhere"           (lowercase x and y)
 *   "part of the plan"         (lowercase)
 *   "piece of cake"            (lowercase)
 *
 * Construction:
 *   - Optional leading (?:the|The)\s+
 *   - X: one Capitalized Word [A-Z][a-z][a-zA-Z'-]*
 *   - connector: \s+of\s+
 *   - Y: one or two Capitalized Words (first mandatory, second optional
 *     via (?: \s+[A-Z][a-z][a-zA-Z'-]*)? )
 *     Y's first word may also be a number-word (Eight, Seven, ...) so we
 *     allow [A-Z][a-zA-Z-]* for Y's first token (handles "Eight", "Forty-
 *     Seven", etc. — they start with a capital but the second char may also
 *     be uppercase for some locales — using [a-z] would exclude "Forty-
 *     Seven" where the hyphenated part starts lowercase, but we want to
 *     match the whole hyphenated token as one word).
 *
 * The sentence-initial filter is intentionally NOT applied to this class
 * (same rationale as title-pair): an "X of Y" pattern is structurally
 * high-signal regardless of sentence position.
 */
export function xOfYCapitalizedRegex(): RegExp {
  // Y's first word: allow [A-Z] followed by one or more [a-zA-Z'-] (covers
  // both "Hyran" and "Eight" and "Forty-Seven"). Must start with uppercase.
  // Y's optional second word: same pattern.
  // X: must have at least one lowercase letter after the initial cap (so
  // "THE" or "A" is not X; all-caps words are skipped).
  return /(?:(?:the|The)\s+)?[A-Z][a-z][a-zA-Z'-]*\s+of\s+[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?/g
}

/**
 * Number-word-tail regex (L15): matches a Capitalized Word (1-2 words)
 * ending in one of the English NUMBER_WORD_TOKENS. An optional leading
 * article "the" / "The" is captured. An optional hyphenated number-word
 * composite is handled (e.g. "Forty-Seven").
 *
 * Examples that MUST fire:
 *   "the Veiled Eight"
 *   "the Silent Twelve"
 *   "Council of Seven"   (x-of-y also fires here; both classes may emit)
 *   "the Forty-Seven Tongues"   (number word in the middle; captured as
 *                                "the Forty-Seven" if "Tongues" does not
 *                                follow a number-word — see note below)
 *
 * Note: the pattern anchors on the NUMBER_WORD_TOKEN as the LAST word of
 * the phrase. "the Forty-Seven Tongues" has "Tongues" after the number;
 * the number-word-tail class fires on "Forty-Seven" if the preceding cap
 * word is present — but the whole phrase "the Forty-Seven Tongues" is
 * better caught by x-of-y + capitalized-multi-word (from the fixture the
 * institution name "Council of Forty-Seven Tongues" was already caught).
 * The primary target here is "the Veiled Eight" / "the Sigil of Eight"
 * (the trailing number-word).
 *
 * Pattern:
 *   Optional: (?:the|The)\s+
 *   One Capitalized Word: [A-Z][a-z][a-zA-Z'-]* (must have lowercase, so
 *     articles "The" / bare caps are excluded)
 *   Single space
 *   The number word (possibly hyphenated composite):
 *     (?:Twenty|Thirty|...|Ninety)-(?:One|Two|...|Nine)  OR
 *     simple token from NUMBER_WORD_TOKENS
 *   Word boundary \b
 *
 * The sentence-initial filter is NOT applied (same rationale as x-of-y).
 */
export function numberWordTailRegex(): RegExp {
  // Build hyphenated composite alternatives: Tens-Ones (e.g. "Twenty-One")
  const tensWords = ["Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]
  const onesWords = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"]
  const hyphenated = tensWords.flatMap(t => onesWords.map(o => `${t}-${o}`))
  // Full list: hyphenated composites first (longer match), then simple tokens
  const allNumbers = [...hyphenated, ...NUMBER_WORD_TOKENS].join("|")
  // Pattern: optional article + mandatory cap-word + space + number-word-tail
  return new RegExp(
    `(?:(?:the|The)\\s+)?[A-Z][a-z][a-zA-Z'-]*\\s+(?:${allNumbers})\\b`,
    "g"
  )
}

// ── Public types ────────────────────────────────────────────────────────────

export type EntityCandidateClass =
  | "title-pair"
  | "capitalized-multi-word"
  | "suffix-class"
  | "x-of-y-capitalized"
  | "number-word-tail"

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
  //
  // Sentence-initial filter is INTENTIONALLY OMITTED here. A TITLE_TOKEN
  // followed by a Capitalized Word ("Arbiter Vesh", "Captain Brevus") is
  // high-signal regardless of position; the L4-followup calibration showed
  // the filter was sweeping real positives (e.g. paragraph-initial title
  // mentions) with no precision benefit, since titles never collide with
  // generic sentence-initial articles. The `capitalized-multi-word` and
  // `suffix-class` passes still keep the filter because their leading
  // tokens are not lexicon-bound and DO collide with sentence-start noise.
  const titleRe = titlePairRegex()
  let m: RegExpExecArray | null
  while ((m = titleRe.exec(prose)) !== null) {
    const start = m.index
    const end = start + m[0].length
    if (offsetIsInsideAnySpan(start, italics)) continue
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

  // 4. x-of-y-capitalized (L15)
  //
  // Sentence-initial filter is INTENTIONALLY OMITTED. An "X of Y" pattern
  // (e.g. "Crown of Hyran") is structurally high-signal regardless of
  // position — it is never a generic sentence-starting article like "The".
  // The match may include a leading article ("the Crown of Hyran"); in that
  // case the reported offset and phrase include the article so the full
  // canonical name is surfaced.
  const xOfYRe = xOfYCapitalizedRegex()
  while ((m = xOfYRe.exec(prose)) !== null) {
    const start = m.index
    const end = start + m[0].length
    if (offsetIsInsideAnySpan(start, italics)) continue
    candidates.push({
      phrase: m[0],
      class: "x-of-y-capitalized",
      offsetStart: start,
      offsetEnd: end,
    })
  }

  // 5. number-word-tail (L15)
  //
  // Sentence-initial filter OMITTED for same reason as x-of-y-capitalized.
  // A "Cap NumberWord" or "the Cap NumberWord" pattern (e.g. "the Veiled
  // Eight") is high-signal; it never collides with generic sentence-initial
  // articles like "The captain entered."
  const numberWordRe = numberWordTailRegex()
  while ((m = numberWordRe.exec(prose)) !== null) {
    const start = m.index
    const end = start + m[0].length
    if (offsetIsInsideAnySpan(start, italics)) continue
    candidates.push({
      phrase: m[0],
      class: "number-word-tail",
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
    case "x-of-y-capitalized": return 3
    case "number-word-tail": return 4
  }
}

// ── Grounded-surface match normalization ────────────────────────────────────

/**
 * Normalize a phrase for case/article/possessive/plural-insensitive matching
 * against a grounded-surface entry. Used by the calibration loop (and any
 * future pre-pass) to decide whether a NER candidate is "the same entity"
 * as a name in the bible / brief / derived facts.
 *
 * Closes the only NER-FP class observed in the L4-followup calibration
 * loop (commit `3f7e8d7`, exp #319): `Scribe's Guildhall` (in prose) ≠
 * `The Scribes' Guildhall` (in bible) under naive lowercase compare. They
 * are the same entity; the difference is only article + plural-vs-singular
 * possessive surface form.
 *
 * Steps applied (in order):
 *   1. Lowercase + collapse whitespace.
 *   2. Strip leading article (`the`, `a`, `an`) and any whitespace after.
 *   3. Strip trailing/leading possessive `'s` and `s'` from each token.
 *      (`scribe's` → `scribe`; `scribes'` → `scribes`; `maret’s` → `maret`,
 *      including the curly apostrophe `’` used by the writer.)
 *   4. Strip a trailing `s` from each token (singular/plural collapse).
 *      `scribes` → `scribe`; `guildhalls` → `guildhall`. We keep tokens of
 *      length ≤ 2 untouched ("us", "is" etc. are not plural targets).
 *
 * Pure function. Returns "" for empty/whitespace-only input.
 *
 * Apply to BOTH sides of any comparison (candidate AND grounded entry).
 *
 * Known limitations (deliberate punts):
 *   - English-only. Non-English plurals (e.g. `criteria`/`criterion`,
 *     `data`/`datum`, foreign-language plural rules) are not handled.
 *   - Naive `s`-stripping over-collapses `Bess` → `Bes`, `Chris` → `Chri`.
 *     For the calibration domain (fantasy proper nouns mixed with English
 *     plurals) this is acceptable; both sides of the compare are
 *     stripped, so a perfect-name match still succeeds.
 *   - Does NOT handle irregular plurals (`men`/`man`, `children`/`child`).
 *   - The `s'` strip happens before the trailing-`s` strip, so
 *     `scribes'` → `scribes` → `scribe` collapses cleanly.
 */
export function normalizeForGroundedMatch(phrase: string): string {
  if (!phrase) return ""
  // 1. lowercase + collapse whitespace
  let s = phrase.toLowerCase().trim().replace(/\s+/g, " ")
  if (s.length === 0) return ""
  // 2. strip leading article
  s = s.replace(/^(the|a|an)\s+/, "")
  if (s.length === 0) return ""
  // Tokenize for per-token possessive + plural collapse.
  const tokens = s.split(" ").filter(t => t.length > 0)
  const normalized = tokens.map(tok => {
    let t = tok
    // 3a. trailing possessive: `'s`, `’s`, `s'`, `s’`
    t = t.replace(/['’]s$/, "")
    t = t.replace(/s['’]$/, "s") // `scribes'` → `scribes` (keep the s, drop the apostrophe)
    // 3b. trailing bare apostrophe (e.g. `Maret'`) — rare but harmless
    t = t.replace(/['’]$/, "")
    // 4. trailing-s strip for plural collapse, but only if the token would
    //    still have ≥3 chars left. `us`, `is`, `as` stay as-is.
    if (t.length > 3 && t.endsWith("s")) {
      t = t.slice(0, -1)
    }
    return t
  })
  return normalized.join(" ")
}
