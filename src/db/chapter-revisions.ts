import db from "./connection"
import type { ChapterPlanDeviation } from "../agents/chapter-plan-checker/schema"
import type { SceneBeat } from "../schemas/shared"
import { createHash } from "node:crypto"

export type RevisionOutcome =
  | "accepted"
  | "rejected_beat_floor"
  | "rejected_new_characters"
  | "error"
  | "skip_already_revised"
  | "skip_duplicate_sig"
  | "skip_no_beat_state"

export interface LogRevisionInput {
  novelId: string
  chapter: number
  attempt: number
  deviations: ChapterPlanDeviation[]
  originalBeats: SceneBeat[]
  revisedBeats?: SceneBeat[] | null
  outcome: RevisionOutcome
  rejectionReason?: string | null
}

/** Canonicalize deviations into a SHA256 hash that's stable across prompt-
 *  wording jitter but changes when the underlying issue set changes. */
export function hashIssueSig(deviations: ChapterPlanDeviation[]): string {
  const canonical = deviations
    .map(d => `${d.beat_index ?? "c"}:${d.description.trim().toLowerCase()}`)
    .sort()
    .join("|")
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16)
}

export async function logRevision(input: LogRevisionInput): Promise<void> {
  const sig = hashIssueSig(input.deviations)
  await db`
    INSERT INTO chapter_revisions (
      novel_id, chapter, attempt,
      issue_sig, issue_count, original_beat_count,
      revised_beat_count, outline_before, outline_after,
      outcome, rejection_reason
    )
    VALUES (
      ${input.novelId}, ${input.chapter}, ${input.attempt},
      ${sig}, ${input.deviations.length}, ${input.originalBeats.length},
      ${input.revisedBeats?.length ?? null},
      ${JSON.stringify(input.originalBeats)}::jsonb,
      ${input.revisedBeats ? JSON.stringify(input.revisedBeats) : null}::jsonb,
      ${input.outcome}, ${input.rejectionReason ?? null}
    )
  `
}

export interface RevisionRow {
  id: number
  novelId: string
  chapter: number
  attempt: number
  invokedAt: string
  issueSig: string
  issueCount: number
  originalBeatCount: number
  revisedBeatCount: number | null
  outlineBefore: SceneBeat[] | null
  outlineAfter: SceneBeat[] | null
  outcome: RevisionOutcome
  rejectionReason: string | null
}

export async function listRevisionsForNovel(novelId: string): Promise<RevisionRow[]> {
  const rows = (await db`
    SELECT id, novel_id, chapter, attempt, invoked_at,
           issue_sig, issue_count, original_beat_count, revised_beat_count,
           outline_before, outline_after, outcome, rejection_reason
    FROM chapter_revisions
    WHERE novel_id = ${novelId}
    ORDER BY chapter, invoked_at
  `) as any[]
  return rows.map(r => ({
    id: r.id,
    novelId: r.novel_id,
    chapter: r.chapter,
    attempt: r.attempt,
    invokedAt: new Date(r.invoked_at).toISOString(),
    issueSig: r.issue_sig,
    issueCount: r.issue_count,
    originalBeatCount: r.original_beat_count,
    revisedBeatCount: r.revised_beat_count,
    outlineBefore: r.outline_before,
    outlineAfter: r.outline_after,
    outcome: r.outcome,
    rejectionReason: r.rejection_reason,
  }))
}
