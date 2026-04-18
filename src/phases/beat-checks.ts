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
 *   - halluc-leak-salvatore (only on the Salvatore writer-pack route)
 *
 * Gating decision — 2026-04-18:
 * Leak is gated by `writerPack.label === "salvatore-fantasy"`, not by
 * the inference model URI. Rationale: the leak check is about the
 * *corpus* a writer was trained on, which the WRITER_GENRE_PACKS label
 * uniquely identifies. Per-URI gating would break if we ever serve the
 * same LoRA under a different artifact name or introduce a sibling
 * pack trained on Salvatore data. Per Codex implementation plan §9
 * (docs/hallucination-v3-wire-in-plan.md).
 */

import type { ChapterOutline, CharacterProfile, SceneBeat } from "../types"
import { checkBeatAdherence } from "../agents/writer/adherence-checker"
import { checkHallucUngrounded } from "../agents/halluc-ungrounded"
import { checkHallucLeakSalvatore } from "../agents/halluc-leak-salvatore"

export type BeatIssueSource =
  | "adherence"
  | "halluc-ungrounded"
  | "halluc-leak-salvatore"

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
  /** The resolved writer pack label for this novel, or null if the
   *  default writer route is active. Only "salvatore-fantasy" enables
   *  the Salvatore leak checker. */
  writerPackLabel: string | null
  tags?: { novelId?: string; chapter?: number; beatIndex?: number; attempt?: number }
}

/**
 * Run all applicable beat-level checks in parallel and normalize
 * results into one `BeatIssue[]`. Every underlying helper already
 * converts transport/schema failures into issues instead of throwing,
 * so `Promise.all` is safe — no rejection path to handle.
 */
export async function runBeatChecks(input: RunBeatChecksInput): Promise<BeatCheckResult> {
  const { prose, beat, outline, characters, worldBible, writerPackLabel, tags } = input

  const runLeak = writerPackLabel === "salvatore-fantasy"

  // Parallelize the fan-out. All three helpers normalize failures into
  // issues and never throw, so Promise.all is safe here. If a future
  // checker violates that invariant, switch this site to allSettled.
  const [adh, ung, leak] = await Promise.all([
    checkBeatAdherence(prose, beat, outline, characters, tags),
    checkHallucUngrounded(prose, beat, outline, characters, worldBible, tags),
    runLeak
      ? checkHallucLeakSalvatore(prose, tags)
      : Promise.resolve({ pass: true, issues: [] as string[] }),
  ])

  return aggregateIssues({ adherence: adh.issues, ungrounded: ung.issues, leak: leak.issues })
}

export interface RawCheckerOutputs {
  adherence: string[]
  ungrounded: string[]
  leak: string[]
}

/**
 * Pure, synchronous assembly of the `BeatIssue[]` from raw checker
 * string-lists. Exported separately from `runBeatChecks` so unit
 * tests can exercise OR-aggregation, severity tagging, and retry-
 * line formatting without an LLM call.
 */
export function aggregateIssues(outputs: RawCheckerOutputs): BeatCheckResult {
  const issues: BeatIssue[] = []
  for (const s of outputs.adherence) issues.push({ source: "adherence", severity: "blocker", description: s })
  for (const s of outputs.ungrounded) issues.push({ source: "halluc-ungrounded", severity: "blocker", description: s })
  for (const s of outputs.leak) issues.push({ source: "halluc-leak-salvatore", severity: "blocker", description: s })

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
 */
export function formatRetryLine(issue: BeatIssue): string {
  switch (issue.source) {
    case "halluc-ungrounded":
      return issue.description
    case "halluc-leak-salvatore":
      return issue.description
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
