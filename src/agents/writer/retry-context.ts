/**
 * retry-context.ts — Production retry-context builder for the beat-writer.
 *
 * Extracted from src/phases/drafting.ts (the adherence-retry site at the
 * inner beat-writing loop, lines ~279-295). The purpose is to give the
 * parity harness a callable function that returns the exact prompt bytes
 * production would send on a checker-failure retry, so arm (b) of the
 * rewrite-capability-probe can invoke the real retry shape without
 * copy-pasting the logic from drafting.ts.
 *
 * The inner `retryContext` string is appended to `beatCtx.userPrompt` just
 * as the drafting loop does; the system prompt is passed through unchanged
 * from the writerPack or BEAT_WRITER_PROMPT default.
 *
 * Design decisions made beyond the brief:
 *   - The alignment-note heuristic (detecting "not enacted" in the issues
 *     array to inject a "prior-beat already covers some actions" note) is
 *     preserved here verbatim. The brief said "match byte-for-byte" and this
 *     branch is part of production.
 *   - `priorBeatProse` is optional. When null/undefined, the alignment note
 *     is suppressed even if the issues mention "not enacted", matching the
 *     drafting loop's `bi > 0` guard.
 *   - The function is pure (no DB calls, no side effects). Context
 *     assembly (buildBeatContext) is the caller's responsibility.
 */

import type { BeatContextResult } from "./beat-context"

const RETRY_PRIOR_PROSE_CHAR_LIMIT = 8000

export interface RetryPromptInput {
  /** Output of buildBeatContext for this beat. */
  beatContext: BeatContextResult
  /** The system prompt string (packPrompt ?? BEAT_WRITER_PROMPT). */
  systemPrompt: string
  /** The prior-attempt prose that failed checks. Truncated to 8,000 chars. */
  v1Prose: string
  /** Checker/detector issue strings — the retryLines from BeatCheckResult. */
  issues: string[]
  /** 1-based attempt number. Purely for logging; does not alter prompt bytes. */
  attempt: number
  /**
   * The last beat's prose, if this is not the first beat in the chapter.
   * Used to inject an alignment note when the issues mention "not enacted"
   * (legacy single-line) or "Beat event missing" (per-event two-stage,
   * 2026-05-01) — both phrases indicate the adherence-events checker
   * found at least one required action missing on-page.
   * Pass undefined or null to suppress the note regardless of issue content.
   */
  priorBeatProse?: string | null
}

export interface RetryPromptOutput {
  systemPrompt: string
  userPrompt: string
}

/**
 * Build the exact prompt bytes the production beat-writer retry path sends
 * after a checker failure.
 *
 * The returned `userPrompt` is `beatCtx.userPrompt + retryContext`, exactly
 * matching drafting.ts lines ~285-292. The `systemPrompt` field is returned
 * unchanged from the input (the caller resolves it).
 *
 * IMPORTANT: If the `issues` array is empty or `v1Prose` is empty/missing,
 * this function returns the vanilla (no-retry) prompt — i.e., identical to
 * `beatContext.userPrompt`. Callers should only invoke this when `retry > 0`
 * and there is real prior prose to include.
 */
export function buildRetryPrompt(input: RetryPromptInput): RetryPromptOutput {
  const { beatContext, systemPrompt, v1Prose, issues, priorBeatProse } = input

  if (!v1Prose || issues.length === 0) {
    // No prior prose or no issues → return vanilla prompt unchanged.
    return {
      systemPrompt,
      userPrompt: beatContext.userPrompt,
    }
  }

  const hasEventIssue = issues.some(i => i.includes("not enacted") || i.includes("Beat event missing"))
  const alignmentNote =
    hasEventIssue && priorBeatProse
      ? `\nNote: The previous beat's prose (below) may already cover some of this beat's actions — this is natural prose flow. Focus on actions NOT yet dramatized. Do not duplicate what the prior beat already covered. If the prior bridge conflicts with the required event or actor named in the issue, obey this beat's task and issue, not the conflicting handoff.\n\nPrevious beat's prose (last 500 chars):\n---\n${priorBeatProse.slice(-500)}\n---\n`
      : ""

  const retryContext =
    `\n\n--- TARGETED REWRITE ---\nYour previous prose for this beat:\n---\n${v1Prose.slice(0, RETRY_PRIOR_PROSE_CHAR_LIMIT)}\n---\nIssues found:\n${issues.map(i => `- ${i}`).join("\n")}${alignmentNote}\nRewrite this beat to address the issues above while preserving what works.`

  return {
    systemPrompt,
    userPrompt: beatContext.userPrompt + retryContext,
  }
}

// L097 Slice 2: expansion-retry prompt for retry-short-scenes-v1.
//
// When sceneCallWriterV1 is on and the writer's accepted prose comes in
// below the advisory floor (70% of target, min 120w), drafting runs up to
// three expansion attempts. Each attempt receives the prior best-attempt
// prose plus an instruction to expand through dramatized action, dialogue,
// interiority, and consequence — without padding or restating. Sourced
// from POC `corpus-recreation-poc.ts:1902-1907` ("expand the existing
// scene through dramatized action, dialogue, interiority, and consequence
// without padding"). Word count remains advisory; the expansion path
// adds attempts but never converts the floor into a hard gate.

const EXPANSION_PRIOR_PROSE_CHAR_LIMIT = 8000

export interface ExpansionPromptInput {
  /** Output of buildBeatContext for this beat. */
  beatContext: BeatContextResult
  /** The system prompt string (BEAT_WRITER_PROMPT). */
  systemPrompt: string
  /** The best-attempt prose so far that came in under the advisory floor. */
  priorProse: string
  /** Word count of priorProse. */
  actualWords: number
  /** Advisory floor (70% of targetWords, min 120). */
  advisoryFloor: number
  /** 1-based expansion attempt number (1, 2, or 3). */
  attempt: number
}

export interface ExpansionPromptOutput {
  systemPrompt: string
  userPrompt: string
}

export function buildExpansionPrompt(input: ExpansionPromptInput): ExpansionPromptOutput {
  const { beatContext, systemPrompt, priorProse, actualWords, advisoryFloor, attempt } = input
  const expansionContext =
    `\n\n--- SCENE EXPANSION (attempt ${attempt}) ---\n`
    + `Your previous prose for this entry came in at ${actualWords} words; the advisory floor is ${advisoryFloor} words. `
    + `The shape is right — do NOT rewrite or restart. Expand the existing scene through dramatized action, dialogue, interiority, and consequence without padding. `
    + `Keep the same goal, opposition, turning point, crisis choice, outcome, and consequence; do not change them. `
    + `Add the missing pressure: more concrete action beats, more dialogue, more interiority that reveals choice pressure, more observable consequence on the page.\n\n`
    + `Previous prose (treat as the starting frame; rewrite expanding it):\n---\n${priorProse.slice(0, EXPANSION_PRIOR_PROSE_CHAR_LIMIT)}\n---`
  return {
    systemPrompt,
    userPrompt: beatContext.userPrompt + expansionContext,
  }
}

/**
 * Format chapter-level prose-integrity issues from a prior chapter-attempt
 * into a context block to append to every beat's userPrompt in the next
 * chapter-attempt.
 *
 * Returns an empty string when `issues` is empty (no chapter retry, or the
 * prior attempt's integrity passed). The block is intended to be appended
 * to each beat's `userPrompt` AFTER any beat-level retry context, so the
 * writer reads a chapter-wide structural reminder alongside their per-beat
 * brief.
 *
 * L41 (exp #368): closes the prose-integrity-instability cluster surfaced
 * by L43-validation. Chapter retries previously discarded the prior
 * attempt's integrity issue list — the writer never saw what they had to
 * avoid. The convergence pattern in L43-val (3 → 2 → 1 issues across
 * attempts) suggests the writer was making stochastic progress without
 * guidance; explicit issue carry-over should accelerate convergence.
 *
 * Issue shape from `detectProseIntegrityIssues` in `src/lint/integrity.ts`:
 *   { kind: "fused-boundary" | "camel-fusion" | "duplicate-sentence" |
 *           "duplicate-fragment" | "quote-integrity"
 *   , excerpt: string }
 *
 * Format is bounded by capping the issue list at 12 entries and slicing
 * excerpts to 200 chars to limit prompt growth on long-quoted issues.
 */
export function formatChapterIntegrityRetryContext(
  issues: Array<{ kind: string; excerpt: string; firstExcerpt?: string }>,
): string {
  if (issues.length === 0) return ""
  const lines = issues
    .slice(0, 12) // bound — typical attempt has 1-5 issues; cap protects extreme cases
    .map(formatIssueLine)
    .join("\n")
  return (
    "\n\n--- AVOID THESE INTEGRITY ISSUES FROM YOUR PRIOR DRAFT ---\n" +
    lines +
    "\n\nKeep sentence boundaries clean (period + space + capital). " +
    "Do not repeat the same phrase verbatim across paragraphs. " +
    "For duplicate-sentence / duplicate-fragment, the two excerpts shown are the colliding pair — paraphrase one side; do not delete a beat. " +
    "Pair and attribute every quote mark."
  )
}

// L63 / Lever A: render duplicate-sentence and duplicate-fragment as a matched
// pair so the writer sees both halves of the collision. Other kinds keep the
// single-excerpt rendering since their carry-over guidance is generator-level
// (boundaries / quote-pair), not literal-pair.
function formatIssueLine(i: { kind: string; excerpt: string; firstExcerpt?: string }): string {
  const second = i.excerpt.trim().slice(0, 200)
  if ((i.kind === "duplicate-sentence" || i.kind === "duplicate-fragment") && i.firstExcerpt) {
    const first = i.firstExcerpt.trim().slice(0, 200)
    return `- ${i.kind} (paraphrase one side):\n    first:  "${first}"\n    second: "${second}"`
  }
  return `- ${i.kind}: "${second}"`
}

/**
 * Extract structured `{entity, excerpt}` payloads from raw halluc-ungrounded
 * issue description strings, deduplicating by lowercase entity. Inverse of the
 * agent's printf at `src/agents/halluc-ungrounded/index.ts:520` and `:602`:
 *
 *   `Ungrounded entity "<entity>"[ — context: "<excerpt>"][ \[NER prepass\]]`
 *
 * NER-only-warning lines carry the `[NER-only warning — LLM passed]` suffix
 * and severity `"warning"`; callers should pre-filter to severity `"blocker"`
 * before passing strings here. The parser is permissive: lines that don't
 * match the format are dropped (defensive — surface drift gets caught by the
 * test suite, never by silently emitting garbage to the writer).
 *
 * Used by the L65 chapter-attempt carry-over path in `src/phases/drafting.ts`.
 */
export function extractUngroundedEntitiesFromDescriptions(
  descriptions: string[],
): Array<{ entity: string; excerpt?: string }> {
  const seen = new Map<string, { entity: string; excerpt?: string }>()
  const re = /^Ungrounded entity "([^"]+)"(?:\s*—\s*context:\s*"([^"]*)")?(?:\s*\[NER prepass\])?\s*$/
  for (const desc of descriptions) {
    const m = re.exec(desc)
    if (!m) continue
    const entity = m[1]!
    const key = entity.toLowerCase()
    if (seen.has(key)) continue
    const excerpt = m[2] && m[2].length > 0 ? m[2] : undefined
    seen.set(key, excerpt ? { entity, excerpt } : { entity })
  }
  return [...seen.values()]
}

/**
 * Format chapter-level halluc-ungrounded issues from a prior chapter-attempt
 * into a context block to append to every beat's userPrompt in the next
 * chapter-attempt.
 *
 * L65 / Lever G-A (exp #391): mirrors `formatChapterIntegrityRetryContext`.
 * Closes the architectural gap surfaced by exp #389 — chapter-attempt retries
 * for halluc-ungrounded had no writer-side carry-over surface, so all 3
 * attempts on a grounding-blocked chapter produced byte-identical prose
 * including the same ungrounded entity references. With this block in place,
 * the writer sees the chapter-wide list of LLM-confirmed ungrounded entities
 * the prior attempt emitted and can rephrase to avoid them.
 *
 * Bounds: 12 entities cap (typical attempts have 1–5; cap protects extreme
 * cases) and excerpt slicing to 200 chars to limit prompt growth on long
 * surrounding-sentence quotes.
 */
export function formatChapterUngroundedRetryContext(
  entities: Array<{ entity: string; excerpt?: string }>,
): string {
  if (entities.length === 0) return ""
  const lines = entities
    .slice(0, 12)
    .map(e => {
      const ex = e.excerpt?.trim().slice(0, 200) ?? ""
      return ex
        ? `- "${e.entity}" — appeared in: "${ex}"`
        : `- "${e.entity}"`
    })
    .join("\n")
  return (
    "\n\n--- AVOID THESE UNGROUNDED ENTITIES FROM YOUR PRIOR DRAFT ---\n" +
    lines +
    "\n\nThese names were not in the world bible, character roster, beat brief, " +
    "or planner-sanctioned new entities, and the prior draft used them anyway. " +
    "Use only entities from those sources; otherwise rephrase to avoid the named reference."
  )
}
