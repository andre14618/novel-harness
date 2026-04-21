/**
 * quality-detectors.ts — Per-beat quality defect detectors for the
 * rewrite-capability-probe charter.
 *
 * Three detectors:
 *   1. detectRepetition  — regex n-gram analysis, pure/sync
 *   2. detectUnderlength — word-count gate, pure/sync
 *   3. detectVoiceCollapse — STUB only; implementation is LLM-backed and
 *      intentionally deferred (see docs/evals/rewrite-probe-critique-schema.md).
 *
 * Design decisions beyond the brief:
 *   - Bigrams AND trigrams are both checked so the ch2-b12 "Would it also
 *     show false debts?" / "power allocations—they don't match" loop (which
 *     contains bigram-level repetition) is caught at ≥ bigram resolution.
 *   - Window size is per-function parameter (default 500 words). Prose beats
 *     are typically 100-400 words so this window captures the whole beat.
 *   - n-gram tokenisation is whitespace-split + lower-cased, same as the
 *     prose evaluation side of the harness (see src/lint/detectors/).
 *   - `span` offsets are character offsets into the original `prose` string,
 *     pointing to the first occurrence of the repeated n-gram.
 *   - The voice-collapse stub returns [] synchronously wrapped in a resolved
 *     promise so callers don't need special-casing. The stub is clearly
 *     documented to prevent accidental production use.
 */

// ── Shared types ─────────────────────────────────────────────────────────────

export interface QualityDefect {
  kind: "repetition" | "voice-collapse" | "underlength"
  severity: "high" | "medium" | "low"
  /** Human-readable string used as critique text passed to the writer. */
  description: string
  /** Character offsets into the original prose, pointing to the first
   *  occurrence of the defect. Optional — not all defects have a span. */
  span?: { start: number; end: number }
  metadata?: Record<string, unknown>
}

// ── detectRepetition ─────────────────────────────────────────────────────────

/**
 * Regex-based n-gram repetition checker.
 *
 * Tokenises `prose` into whitespace-delimited words (lower-cased), then
 * counts all bigrams and trigrams within a sliding window of `windowWords`
 * words. Any n-gram that appears ≥ `minCount` times within the window is
 * flagged as a defect.
 *
 * Returns one `QualityDefect` per repeated n-gram. The `span` field points
 * to the character offset of the FIRST occurrence of the n-gram in the
 * original prose string (case-insensitive search).
 *
 * Severity:
 *   - high: ≥ 5 occurrences
 *   - medium: 4 occurrences
 *   - low: 3 occurrences (default minCount)
 *
 * Known fixture: ch2-b12 rotation-arm prose containing the exchange
 * "Would it also show false debts? / I mean, the power allocations—they
 * don't match the verified marks, see?" repeated ≥ 3 times. This fixture
 * catches bigram "false debts" and "power allocations" as repeated.
 */
export function detectRepetition(
  prose: string,
  options?: {
    /** Minimum number of occurrences to flag. Default 3. */
    minCount?: number
    /** Sliding window size in words. Default 500. */
    windowWords?: number
    /** Include bigrams (n=2). Default true. */
    bigrams?: boolean
    /** Include trigrams (n=3). Default true. */
    trigrams?: boolean
  },
): QualityDefect[] {
  const minCount = options?.minCount ?? 3
  const windowWords = options?.windowWords ?? 500
  const includeBigrams = options?.bigrams ?? true
  const includeTrigrams = options?.trigrams ?? true

  const words = prose.split(/\s+/).filter(w => w.length > 0)
  if (words.length < 2) return []

  const limit = Math.min(words.length, windowWords)
  const windowTokens = words.slice(0, limit).map(w => w.toLowerCase().replace(/[^\w'-]/g, ""))

  const counts = new Map<string, number>()

  const countNgrams = (n: number): void => {
    for (let i = 0; i <= windowTokens.length - n; i++) {
      const gram = windowTokens.slice(i, i + n).join(" ")
      // Skip n-grams that are mostly stop words or very short
      const meaningful = windowTokens.slice(i, i + n).some(w => w.length >= 4)
      if (!meaningful) continue
      counts.set(gram, (counts.get(gram) ?? 0) + 1)
    }
  }

  if (includeBigrams) countNgrams(2)
  if (includeTrigrams) countNgrams(3)

  const defects: QualityDefect[] = []

  for (const [gram, count] of counts) {
    if (count < minCount) continue

    // Find character offset of first occurrence (case-insensitive)
    const pattern = gram.split(" ").join("\\s+")
    const regex = new RegExp(pattern, "i")
    const match = regex.exec(prose)
    const span = match ? { start: match.index, end: match.index + match[0].length } : undefined

    const severity: QualityDefect["severity"] = count >= 5 ? "high" : count === 4 ? "medium" : "low"
    const words_label = gram.split(" ").length === 2 ? "bigram" : "trigram"

    defects.push({
      kind: "repetition",
      severity,
      description: `Repeated ${words_label} "${gram}" appears ${count} times within ${limit}-word window — rephrase or restructure to avoid the loop.`,
      span,
      metadata: { gram, count, windowWords: limit, n: gram.split(" ").length },
    })
  }

  // Sort by count descending so the worst offenders come first.
  defects.sort((a, b) => {
    const ca = (a.metadata?.count as number) ?? 0
    const cb = (b.metadata?.count as number) ?? 0
    return cb - ca
  })

  return defects
}

// ── detectUnderlength ─────────────────────────────────────────────────────────

/**
 * Simple word-count gate. Returns a single `QualityDefect` of kind
 * "underlength" if the prose word count is below `minWords`. Otherwise
 * returns [].
 *
 * Severity is always "high" — underlength prose is a hard signal the model
 * aborted early (matching `resolveLossShortCircuit` in the replay runner).
 */
export function detectUnderlength(
  prose: string,
  minWords = 50,
): QualityDefect[] {
  const wordCount = prose.trim().split(/\s+/).filter(w => w.length > 0).length
  if (wordCount >= minWords) return []
  return [
    {
      kind: "underlength",
      severity: "high",
      description: `Prose is ${wordCount} words (minimum ${minWords}) — the beat draft is too short; expand with additional description, interiority, or dialogue.`,
      metadata: { wordCount, minWords },
    },
  ]
}

// ── detectVoiceCollapse (STUB) ────────────────────────────────────────────────

/**
 * Voice-collapse detector — STUB ONLY.
 *
 * This detector requires a pairwise LLM judgment call (Sonnet subagent) to
 * determine whether two speaking characters in the same beat sound too
 * similar. The actual implementation depends on the Agent subagent mechanism
 * in the Claude Code plugin, which cannot be called from within this module
 * without introducing a plugin dependency that would make the detector
 * unusable in standalone scripts and tests.
 *
 * CONTRACT FOR THE REAL IMPLEMENTATION:
 *   The caller (critique-artifact generator, charter run top-level) should:
 *   1. Pass `prose` and `speakingCharacters` to a Sonnet subagent with the
 *      following prompt shape (modeled on the frozen judge prompt in
 *      docs/evals/rewrite-capability-judge-prompt.md §Voice-distinctness):
 *        "Given the following prose, do any two of these characters
 *         ({speakingCharacters.join(', ')}) sound like the same voice?
 *         If yes, name the pair and cite a specific line. Output JSON:
 *         [{pair: ['A', 'B'], description: '<cite>'}]"
 *   2. Map each returned pair to a QualityDefect with kind="voice-collapse",
 *      severity="medium", description=<cite>.
 *   3. The caller must NOT use the same model family as the judge (per §10.1
 *      round-1 RED finding #4 — Sonnet-as-both-critique-and-judge is circular
 *      if Sonnet is also the judge). Use DeepSeek V3.2 for critique generation
 *      if Sonnet is the judge, or vice versa.
 *
 * This stub always returns [] so it is safe to call in any context.
 */
export function detectVoiceCollapse(
  _prose: string,
  _speakingCharacters: string[],
): Promise<QualityDefect[]> {
  // STUB — see contract above. Returns empty so callers don't branch on null.
  return Promise.resolve([])
}

// ── Convenience: run all sync detectors ─────────────────────────────────────

/**
 * Run detectRepetition + detectUnderlength on a prose string and return the
 * combined list. Does NOT invoke detectVoiceCollapse (LLM-backed, async,
 * expensive — caller must decide whether to include it).
 */
export function detectSyncDefects(
  prose: string,
  options?: {
    minWords?: number
    repetition?: Parameters<typeof detectRepetition>[1]
  },
): QualityDefect[] {
  return [
    ...detectRepetition(prose, options?.repetition),
    ...detectUnderlength(prose, options?.minWords),
  ]
}
