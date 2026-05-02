/**
 * Beat-level check aggregator.
 *
 * Runs every narrow checker that applies to a just-generated beat in
 * parallel, normalizes results into one `BeatIssue[]`, and formats the
 * unified "targeted rewrite" section that feeds back into the writer on
 * retry. Beat retries are OR-gated: any blocker issue from any checker
 * forces a retry; warnings are logged but don't block accept.
 *
 * Current checkers:
 *   - adherence-events  (always)
 *   - halluc-ungrounded (always)
 */

import type { ChapterOutline, CharacterProfile, SceneBeat } from "../types"
import { checkBeatAdherence } from "../agents/writer/adherence-checker"
import { checkHallucUngrounded } from "../agents/halluc-ungrounded"

export type BeatIssueSource =
  | "adherence"
  | "halluc-ungrounded"

export interface BeatIssue {
  source: BeatIssueSource
  severity: "blocker" | "warning"
  description: string
}

export interface BeatCheckResult {
  pass: boolean              // true iff zero blockers
  issues: BeatIssue[]
  /** Convenience helper — the merged issue list as human-readable lines
   *  for the targeted-rewrite prompt and the retry log. */
  retryLines: string[]
}

export interface RunBeatChecksInput {
  prose: string
  beat: SceneBeat
  outline: ChapterOutline
  characters: CharacterProfile[]
  worldBible: any
  /** Immediately-preceding scene beat in the same chapter, if any.
   *  Consumed by the halluc-ungrounded checker under the beat-entity-list
   *  charter (v1/v3) to surface prior-beat entities as grounded. */
  prevBeat?: SceneBeat
  tags?: { novelId?: string; chapter?: number; beatIndex?: number; attempt?: number }
}

/**
 * Run all applicable beat-level checks in parallel and normalize
 * results into one `BeatIssue[]`. Every underlying helper already
 * converts transport/schema failures into issues instead of throwing,
 * so `Promise.all` is safe — no rejection path to handle.
 */
export async function runBeatChecks(input: RunBeatChecksInput): Promise<BeatCheckResult> {
  const { prose, beat, outline, characters, worldBible, prevBeat, tags } = input

  // Parallelize the fan-out. Both helpers normalize failures into
  // issues and never throw, so Promise.all is safe here. If a future
  // checker violates that invariant, switch this site to allSettled.
  const [adh, ung] = await Promise.all([
    checkBeatAdherence(prose, beat, outline, characters, tags),
    checkHallucUngrounded(prose, beat, outline, characters, worldBible, tags, { prevBeat }),
  ])

  return aggregateIssues({
    adherence: adh.issues,
    ungrounded: ung.issues,
    // L31a: pass per-issue severity from the halluc checker so NER-only warnings
    // (severity: "warning") do not consume beat retry budget. When issuesSeverity
    // is absent (v0/v2 variant), aggregateIssues defaults all issues to "blocker".
    ungroundedSeverity: ung.issuesSeverity,
  })
}

export interface RawCheckerOutputs {
  adherence: string[]
  /**
   * Ungrounded issues from the halluc-ungrounded checker.
   * When `ungroundedSeverity` is provided, it is a parallel array giving the
   * severity of each entry in `ungrounded`. When absent (legacy callers or
   * v0/v2 variant), all ungrounded issues are treated as "blocker".
   *
   * L31a: NER-only-warning issues carry severity "warning" — they are surfaced
   * in retryLines (writer awareness) but do NOT contribute to `pass: false`.
   */
  ungrounded: string[]
  ungroundedSeverity?: Array<"blocker" | "warning">
}

/**
 * Pure, synchronous assembly of the `BeatIssue[]` from raw checker
 * string-lists. Exported separately from `runBeatChecks` so unit
 * tests can exercise OR-aggregation, severity tagging, and retry-
 * line formatting without an LLM call.
 *
 * L31a: warnings do NOT set `pass: false`. Only `severity: "blocker"` issues
 * block the beat. Warnings are included in `retryLines` so the writer has
 * awareness of NER-flagged entities, but the beat is not retried on their behalf.
 */
export function aggregateIssues(outputs: RawCheckerOutputs): BeatCheckResult {
  const issues: BeatIssue[] = []
  for (const s of outputs.adherence) issues.push({ source: "adherence", severity: "blocker", description: s })
  for (let idx = 0; idx < outputs.ungrounded.length; idx++) {
    const s = outputs.ungrounded[idx]!
    const severity = outputs.ungroundedSeverity?.[idx] ?? "blocker"
    issues.push({ source: "halluc-ungrounded", severity, description: s })
  }

  return {
    pass: issues.every(i => i.severity !== "blocker"),
    issues,
    retryLines: issues.map(i => formatRetryLine(i)),
  }
}

/**
 * Shape each issue into the hint the writer receives in the targeted
 * rewrite prompt. The source-specific verb nudges the writer toward
 * the right fix without exposing checker internals.
 *
 * Retry-wording expansion — 2026-04-20: the raw
 * "Ungrounded entity X — context: ..." descriptions told the writer *what*
 * was wrong but not *how* to fix it. The appended guidance tells the writer
 * the valid resolution space: replace with a brief/bible entity or remove the
 * reference.
 *
 * 2026-05-01 (L29): expanded source enumeration to match the L9/L20-era
 * grounded surface (beat brief, world bible, character roster, planner-
 * sanctioned new-entities list). Reframed from negative-prime "Do not invent"
 * to positive "use only [...]" per `feedback_priming_suppression_ab` (L21
 * showed negative-prime variants WORSEN compliance).
 */
export function formatRetryLine(issue: BeatIssue): string {
  switch (issue.source) {
    case "halluc-ungrounded":
      return `${issue.description} — Fix: use only entities from the beat brief, world bible, character roster, or planner-sanctioned new entities; otherwise remove the reference.`
    case "adherence":
    default:
      return issue.description
  }
}

/**
 * Group issues by source for the retry log — keeps the operator's
 * "what broke" summary readable when multiple checkers fire at once.
 */
export function summarizeIssues(issues: BeatIssue[]): string {
  if (issues.length === 0) return "no issues"
  const bySource: Record<string, string[]> = {}
  for (const i of issues) {
    ;(bySource[i.source] ??= []).push(i.description)
  }
  return Object.entries(bySource)
    .map(([src, descs]) => `${src}(${descs.length}): ${descs.join("; ")}`)
    .join(" | ")
}
