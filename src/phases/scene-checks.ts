/**
 * Scene-level check aggregator.
 *
 * Runs every narrow checker that applies to a just-generated scene entry,
 * normalizes results into one `SceneIssue[]`, and formats the
 * unified "targeted rewrite" section that feeds back into the writer on
 * retry. Scene retries are OR-gated only for blocker-class checks; warnings
 * are logged but do not block acceptance.
 *
 * Current checkers:
 *   - adherence-events  (always)
 *   - halluc-ungrounded (optional; default off because it is paid and
 *     false-positive-heavy compared with deterministic plan fulfillment)
 */

import type { ChapterOutline, CharacterProfile, SceneBeat } from "../types"
import { checkSceneAdherence } from "../agents/writer/adherence-checker"
import { checkHallucUngrounded } from "../agents/halluc-ungrounded"
import type { HallucIssueMetadata, HallucUngroundedResult } from "../agents/halluc-ungrounded"
import { pipeline } from "../config/pipeline"

export type SceneIssueSource =
  | "adherence"
  | "halluc-ungrounded"

export interface SceneIssue {
  source: SceneIssueSource
  severity: "blocker" | "warning"
  description: string
  metadata?: {
    hallucUngrounded?: HallucIssueMetadata
    entityRefs?: HallucIssueMetadata["entityRefs"]
  }
}

export interface SceneCheckResult {
  pass: boolean              // true iff zero blockers
  issues: SceneIssue[]
  /** Convenience helper — the merged issue list as human-readable lines
   *  for the targeted-rewrite prompt and the retry log. */
  retryLines: string[]
}

export interface RunSceneChecksInput {
  prose: string
  scene: SceneBeat
  outline: ChapterOutline
  characters: CharacterProfile[]
  worldBible: any
  /** Immediately-preceding scene entry in the same chapter, if any.
   *  Consumed by the optional halluc-ungrounded checker to surface prior-scene
   *  entities as grounded when that paid checker is explicitly enabled. */
  prevScene?: SceneBeat
  entityGroundingMode?: "off" | "llm-blocking"
  tags?: { novelId?: string; chapter?: number; beatIndex?: number; sceneId?: string; beatId?: string; attempt?: number }
}

/**
 * Run all applicable scene-level checks in parallel and normalize
 * results into one `SceneIssue[]`. Every underlying helper already
 * converts transport/schema failures into issues instead of throwing,
 * so `Promise.all` is safe — no rejection path to handle.
 */
export async function runSceneChecks(input: RunSceneChecksInput): Promise<SceneCheckResult> {
  const {
    prose,
    scene,
    outline,
    characters,
    worldBible,
    prevScene,
    tags,
    entityGroundingMode = pipeline.sceneEntityGroundingMode,
  } = input

  const adhPromise = checkSceneAdherence(prose, scene, outline, characters, tags)
  const skippedEntityGrounding: HallucUngroundedResult = {
    pass: true,
    issues: [],
    issuesSeverity: [],
    issueMetadata: [],
  }
  const ungPromise = entityGroundingMode === "llm-blocking"
    ? checkHallucUngrounded(prose, scene, outline, characters, worldBible, tags, {
        prevBeat: prevScene,
        voteN: pipeline.hallucVoteN,
      })
    : Promise.resolve(skippedEntityGrounding)

  const [adh, ung] = await Promise.all([adhPromise, ungPromise])

  return aggregateIssues({
    adherence: adh.issues,
    ungrounded: ung.issues,
    // L31a: pass per-issue severity from the halluc checker so NER-only warnings
    // (severity: "warning") do not consume scene retry budget. When issuesSeverity
    // is absent (v0/v2 variant), aggregateIssues defaults all issues to "blocker".
    ungroundedSeverity: ung.issuesSeverity,
    ungroundedMetadata: ung.issueMetadata,
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
  ungroundedMetadata?: HallucIssueMetadata[]
}

/**
 * Pure, synchronous assembly of the `SceneIssue[]` from raw checker
 * string-lists. Exported separately from `runSceneChecks` so unit
 * tests can exercise OR-aggregation, severity tagging, and retry-
 * line formatting without an LLM call.
 *
 * L31a: warnings do NOT set `pass: false`. Only `severity: "blocker"` issues
 * block the scene. Warnings are included in `retryLines` so the writer has
 * awareness of NER-flagged entities, but the scene is not retried on their behalf.
 */
export function aggregateIssues(outputs: RawCheckerOutputs): SceneCheckResult {
  const issues: SceneIssue[] = []
  for (const s of outputs.adherence) issues.push({ source: "adherence", severity: "blocker", description: s })
  for (let idx = 0; idx < outputs.ungrounded.length; idx++) {
    const s = outputs.ungrounded[idx]!
    const severity = outputs.ungroundedSeverity?.[idx] ?? "blocker"
    const metadata = outputs.ungroundedMetadata?.[idx]
    issues.push({
      source: "halluc-ungrounded",
      severity,
      description: s,
      ...(metadata ? {
        metadata: {
          hallucUngrounded: metadata,
          entityRefs: metadata.entityRefs,
        },
      } : {}),
    })
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
 * grounded surface (scene brief, world bible, character roster, planner-
 * sanctioned new-entities list). Reframed from negative-prime "Do not invent"
 * to positive "use only [...]" per `feedback_priming_suppression_ab` (L21
 * showed negative-prime variants WORSEN compliance).
 */
export function formatRetryLine(issue: SceneIssue): string {
  switch (issue.source) {
    case "halluc-ungrounded":
      return `${issue.description} — Fix: use only entities from the scene brief, world bible, character roster, or planner-sanctioned new entities; otherwise remove the reference.`
    case "adherence":
    default:
      return issue.description
  }
}

/**
 * Group issues by source for the retry log — keeps the operator's
 * "what broke" summary readable when multiple checkers fire at once.
 */
export function summarizeIssues(issues: SceneIssue[]): string {
  if (issues.length === 0) return "no issues"
  const bySource: Record<string, string[]> = {}
  for (const i of issues) {
    ;(bySource[i.source] ??= []).push(i.description)
  }
  return Object.entries(bySource)
    .map(([src, descs]) => `${src}(${descs.length}): ${descs.join("; ")}`)
    .join(" | ")
}
