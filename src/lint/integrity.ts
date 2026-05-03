/**
 * Post-fix integrity guard for lint rewrites.
 *
 * The lint fixer is allowed to change local wording, but it must not create
 * malformed prose. Keep this deterministic and conservative: if a suspicious
 * artifact is newly introduced by the fixed text, reject the whole lint pass
 * and keep the raw draft.
 */

export interface LintFixIntegrityIssue {
  kind: "fused-boundary" | "camel-fusion" | "duplicate-sentence" | "duplicate-fragment" | "quote-integrity"
  excerpt: string
  /**
   * For `duplicate-sentence` and `duplicate-fragment`, the text of the FIRST occurrence
   * of the collision; `excerpt` carries the SECOND occurrence's context window. Set
   * for duplicate-* kinds (L63 / Lever A); undefined for fused-boundary, camel-fusion,
   * and quote-integrity. Used by writer retry-context to render both halves of the
   * collision so the writer can paraphrase one side instead of regenerating fresh
   * prose that may collide elsewhere.
   */
  firstExcerpt?: string
  /**
   * Char offset on the SECOND occurrence (or only occurrence for non-duplicate kinds)
   * within the text passed to the detector. L70b / Lever I-D form (a): the drafting
   * integrity branch maps this back to the originating beat index via
   * `offsetToBeatIndex`, which lets `runSettleLoop` route the duplicate-bearing
   * beat(s) to a per-beat targeted rewrite instead of a chapter-wide regenerate.
   * Optional for back-compat with callers that don't need routing.
   */
  offset?: number
  /**
   * Char offset of the FIRST occurrence for duplicate-* kinds. Mirrors `firstExcerpt`.
   * When the second occurrence sits at the chapter end (e.g. last beat, no later prose),
   * the routing layer falls back to `firstOffset` as the rewrite target.
   */
  firstOffset?: number
}

export interface LintFixIntegrityResult {
  pass: boolean
  issues: LintFixIntegrityIssue[]
}

export function validateLintFixIntegrity(original: string, fixed: string): LintFixIntegrityResult {
  const issues: LintFixIntegrityIssue[] = []

  for (const issue of detectFusedBoundaries(fixed)) {
    if (!original.includes(issue.excerpt)) issues.push(issue)
  }
  for (const issue of detectCamelFusions(fixed)) {
    if (!original.includes(issue.excerpt)) issues.push(issue)
  }
  for (const issue of detectNewDuplicateSentences(original, fixed)) {
    issues.push(issue)
  }

  return { pass: issues.length === 0, issues }
}

export function detectProseIntegrityIssues(text: string): LintFixIntegrityIssue[] {
  return dedupeIssues([
    ...detectFusedBoundaries(text),
    ...detectCamelFusions(text),
    ...detectAdjacentDuplicateSentences(text),
    ...detectNearbyDuplicateFragments(text),
    ...detectQuoteIntegrity(text),
  ])
}

function detectFusedBoundaries(text: string): LintFixIntegrityIssue[] {
  const issues: LintFixIntegrityIssue[] = []
  const allCapsDottedSpans = collectAllCapsDottedSpans(text)
  for (let i = 0; i < text.length - 1; i++) {
    const ch = text[i]
    const next = text[i + 1]
    if (!".!?".includes(ch)) continue
    if (!/[A-Za-z]/.test(next)) continue
    if (ch === "." && text[i - 1] === ".") continue
    if (ch === "." && spanContains(allCapsDottedSpans, i)) continue
    issues.push({ kind: "fused-boundary", excerpt: contextExcerpt(text, i), offset: i })
  }
  return dedupeIssues(issues)
}

// LitRPG System path identifiers (e.g. SCRIBE.GUILD.VALDRIS.MARET.ANNUAL) are a
// legitimate genre construct: their internal dots are part of the token, not
// sentence terminators. Match runs of ≥2 all-caps segments joined by `.`,
// each segment ≥2 chars so single-letter abbreviations like "O.She" still fuse.
const ALL_CAPS_DOTTED_RE = /[A-Z][A-Z0-9_]+(?:\.[A-Z][A-Z0-9_]+)+/g

function collectAllCapsDottedSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = []
  for (const match of text.matchAll(ALL_CAPS_DOTTED_RE)) {
    const start = match.index ?? 0
    spans.push({ start, end: start + match[0].length })
  }
  return spans
}

function spanContains(spans: Array<{ start: number; end: number }>, index: number): boolean {
  for (const span of spans) {
    if (index >= span.start && index < span.end) return true
  }
  return false
}

function detectCamelFusions(text: string): LintFixIntegrityIssue[] {
  const issues: LintFixIntegrityIssue[] = []
  const re = /\b[a-z]{4,}[A-Z][a-z]{2,}\b/g
  for (const match of text.matchAll(re)) {
    issues.push({ kind: "camel-fusion", excerpt: match[0], offset: match.index ?? 0 })
  }
  return dedupeIssues(issues)
}

function detectNewDuplicateSentences(original: string, fixed: string): LintFixIntegrityIssue[] {
  const originalNorm = normalizeSentenceStream(original)
  const issues = detectAdjacentDuplicateSentences(fixed)
  return issues.filter(issue => !originalNorm.includes((issue as any).pairNorm ?? ""))
}

function detectAdjacentDuplicateSentences(text: string): Array<LintFixIntegrityIssue & { pairNorm?: string }> {
  const issues: Array<LintFixIntegrityIssue & { pairNorm?: string }> = []
  const sentences = extractSentences(text)
  for (let i = 1; i < sentences.length; i++) {
    const prev = normalizeSentence(sentences[i - 1].text)
    const cur = normalizeSentence(sentences[i].text)
    if (!prev || prev !== cur) continue
    const pairNorm = `${prev} ${cur}`
    issues.push({
      kind: "duplicate-sentence",
      excerpt: sentences[i].text.trim().slice(0, 120),
      firstExcerpt: sentences[i - 1].text.trim().slice(0, 120),
      offset: sentences[i].offset,
      firstOffset: sentences[i - 1].offset,
      pairNorm,
    })
  }
  return dedupeIssues(issues) as Array<LintFixIntegrityIssue & { pairNorm?: string }>
}

function detectQuoteIntegrity(text: string): LintFixIntegrityIssue[] {
  const issues: LintFixIntegrityIssue[] = []
  const splitRe = /\n{2,}/g
  let cursor = 0
  let lastEnd = 0
  const matches: Array<{ start: number; len: number; sepLen: number }> = []
  for (const m of text.matchAll(splitRe)) {
    matches.push({ start: lastEnd, len: (m.index ?? 0) - lastEnd, sepLen: m[0].length })
    lastEnd = (m.index ?? 0) + m[0].length
  }
  matches.push({ start: lastEnd, len: text.length - lastEnd, sepLen: 0 })

  for (const span of matches) {
    cursor = span.start
    const paragraph = text.slice(span.start, span.start + span.len)
    const p = paragraph.replace(/\s+/g, " ").trim()
    if (!p) continue

    const quoteCount = countMatches(p, /"/g)
    const curlyOpen = countMatches(p, /“/g)
    const curlyClose = countMatches(p, /”/g)
    const firstQuote = p.indexOf('"')

    if (quoteCount % 2 !== 0) {
      issues.push({ kind: "quote-integrity", excerpt: p.slice(0, 160), offset: cursor })
      continue
    }
    if (curlyOpen !== curlyClose) {
      issues.push({ kind: "quote-integrity", excerpt: p.slice(0, 160), offset: cursor })
      continue
    }
    if (p.includes('""') || p.includes("””")) {
      issues.push({ kind: "quote-integrity", excerpt: p.slice(0, 160), offset: cursor })
      continue
    }
    // Missing opening quote: paragraph begins with apparent dialogue and the
    // first quote closes a sentence rather than opening quoted speech.
    if (firstQuote > 0 && /[.!?]$/.test(p.slice(0, firstQuote))) {
      issues.push({ kind: "quote-integrity", excerpt: p.slice(0, 160), offset: cursor })
    }
  }
  return dedupeIssues(issues)
}

function detectNearbyDuplicateFragments(text: string): LintFixIntegrityIssue[] {
  const issues: LintFixIntegrityIssue[] = []
  const tokens = [...text.matchAll(/[A-Za-z']+/g)].map(m => ({ token: m[0].toLowerCase(), index: m.index ?? 0 }))
  const seen = new Map<string, { tokenIndex: number; charIndex: number }>()
  const gramSize = 8
  const maxTokenDistance = 120

  for (let i = 0; i <= tokens.length - gramSize; i++) {
    const gram = tokens.slice(i, i + gramSize).map(t => t.token).join(" ")
    const prev = seen.get(gram)
    if (prev && i - prev.tokenIndex <= maxTokenDistance) {
      issues.push({
        kind: "duplicate-fragment",
        excerpt: contextExcerpt(text, tokens[i].index),
        firstExcerpt: contextExcerpt(text, prev.charIndex),
        offset: tokens[i].index,
        firstOffset: prev.charIndex,
      })
      // One report per nearby duplicated span is enough to block approval;
      // suppress overlapping n-grams from the same repeated passage.
      i += maxTokenDistance
      continue
    }
    if (!prev) seen.set(gram, { tokenIndex: i, charIndex: tokens[i].index })
  }

  return dedupeIssues(issues)
}

function extractSentences(text: string): Array<{ text: string; offset: number }> {
  const sentences: Array<{ text: string; offset: number }> = []
  const re = /[^.!?]+[.!?]+/g
  for (const match of text.matchAll(re)) {
    sentences.push({ text: match[0], offset: match.index ?? 0 })
  }
  return sentences
}

function normalizeSentenceStream(text: string): string {
  return extractSentences(text).map(s => normalizeSentence(s.text)).filter(Boolean).join(" ")
}

function normalizeSentence(sentence: string): string {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function countMatches(text: string, re: RegExp): number {
  return text.match(re)?.length ?? 0
}

function contextExcerpt(text: string, index: number): string {
  return text.slice(Math.max(0, index - 20), Math.min(text.length, index + 24)).replace(/\s+/g, " ").trim()
}

function dedupeIssues(issues: LintFixIntegrityIssue[]): LintFixIntegrityIssue[] {
  const seen = new Set<string>()
  const result: LintFixIntegrityIssue[] = []
  for (const issue of issues) {
    const key = `${issue.kind}:${issue.excerpt}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(issue)
  }
  return result
}

/**
 * Map a char offset on `beatProses.join(separator)` back to the originating
 * beat index. L70b / Lever I-D form (a): the drafting integrity branch uses
 * this to route duplicate-bearing beats to per-beat targeted rewrite via
 * `runSettleLoop` instead of regenerating the whole chapter.
 *
 * - Offsets inside a beat's prose return that beat's index.
 * - Offsets inside the separator (e.g. "\n\n") are attributed to the LATER
 *   beat — the duplicate "manifests" once the second occurrence appears.
 * - Offsets past the end of the joined text clamp to the last beat.
 * - Negative offsets clamp to beat 0.
 */
export function offsetToBeatIndex(
  offset: number,
  beatProses: string[],
  separator: string = "\n\n",
): number {
  if (beatProses.length === 0) return -1
  if (offset <= 0) return 0
  let cursor = 0
  for (let i = 0; i < beatProses.length; i++) {
    const beatEnd = cursor + beatProses[i].length
    if (offset < beatEnd) return i
    // In the separator that follows beat i: attribute to the next beat.
    const sepEnd = beatEnd + separator.length
    if (offset < sepEnd) return Math.min(i + 1, beatProses.length - 1)
    cursor = sepEnd
  }
  return beatProses.length - 1
}
