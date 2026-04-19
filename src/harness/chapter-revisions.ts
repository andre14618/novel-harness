/**
 * Chapter-revision telemetry service — read-side queries over the
 * chapter_revisions table (see sql/028). Scoped per-novel; cross-novel
 * aggregation is out of scope for this layer (would belong in an
 * experiment-family rollup if ever needed).
 */

import db from "../db/connection"
import { listRevisionsForNovel, type RevisionRow, type RevisionOutcome } from "../db/chapter-revisions"

export { listRevisionsForNovel, type RevisionRow, type RevisionOutcome }

export interface RevisionStats {
  novelId: string
  total: number                // all rows (invocations + skips)
  invocations: number          // accepted | rejected_* | error
  accepted: number
  rejectedBeatFloor: number
  rejectedNewCharacters: number
  errors: number
  skipAlreadyRevised: number
  skipDuplicateSig: number
  skipNoBeatState: number
  /** Fraction of invocations that produced an accepted revision. Null when
   *  there are zero invocations. */
  acceptanceRate: number | null
  /** Set of chapters touched by at least one revision row. */
  affectedChapters: number[]
}

export async function revisionStats(novelId: string): Promise<RevisionStats> {
  const rows = (await db`
    SELECT outcome, chapter
    FROM chapter_revisions
    WHERE novel_id = ${novelId}
  `) as Array<{ outcome: RevisionOutcome; chapter: number }>

  const counts: Record<RevisionOutcome, number> = {
    accepted: 0,
    rejected_beat_floor: 0,
    rejected_new_characters: 0,
    error: 0,
    skip_already_revised: 0,
    skip_duplicate_sig: 0,
    skip_no_beat_state: 0,
  }
  const chapters = new Set<number>()
  for (const r of rows) {
    counts[r.outcome]++
    chapters.add(r.chapter)
  }

  const invocations =
    counts.accepted + counts.rejected_beat_floor + counts.rejected_new_characters + counts.error

  return {
    novelId,
    total: rows.length,
    invocations,
    accepted: counts.accepted,
    rejectedBeatFloor: counts.rejected_beat_floor,
    rejectedNewCharacters: counts.rejected_new_characters,
    errors: counts.error,
    skipAlreadyRevised: counts.skip_already_revised,
    skipDuplicateSig: counts.skip_duplicate_sig,
    skipNoBeatState: counts.skip_no_beat_state,
    acceptanceRate: invocations === 0 ? null : counts.accepted / invocations,
    affectedChapters: [...chapters].sort((a, b) => a - b),
  }
}
