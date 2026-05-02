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

export interface RetryPromptInput {
  /** Output of buildBeatContext for this beat. */
  beatContext: BeatContextResult
  /** The system prompt string (packPrompt ?? BEAT_WRITER_PROMPT). */
  systemPrompt: string
  /** The prior-attempt prose that failed checks. Truncated to 2,000 chars. */
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
      ? `\nNote: The previous beat's prose (below) may already cover some of this beat's actions — this is natural prose flow. Focus on actions NOT yet dramatized. Do not duplicate what the prior beat already covered.\n\nPrevious beat's prose (last 500 chars):\n---\n${priorBeatProse.slice(-500)}\n---\n`
      : ""

  const retryContext =
    `\n\n--- TARGETED REWRITE ---\nYour previous prose for this beat:\n---\n${v1Prose.slice(0, 2000)}\n---\nIssues found:\n${issues.map(i => `- ${i}`).join("\n")}${alignmentNote}\nRewrite this beat to address the issues above while preserving what works.`

  return {
    systemPrompt,
    userPrompt: beatContext.userPrompt + retryContext,
  }
}
