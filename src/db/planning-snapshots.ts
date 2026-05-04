/**
 * Persistence for planning snapshots (Phase 4 commit 2).
 *
 * Charter: docs/charters/world-bible-architecture.md
 * Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 4 — Planning Snapshot Review Before Drafting"
 *
 * Phase 4 commit 1 (bda04a4) shipped the pure compute helper. This
 * module adds the storage layer:
 *
 *   record   — idempotent INSERT keyed on the snapshot hash itself.
 *   find     — point lookup by hash.
 *   list     — newest-first per novel.
 *   getLocked— the (single, most-recent) locked snapshot for a novel.
 *   lock     — flip a recorded snapshot from observed → locked.
 *
 * Locking is a one-way transition. Once locked_at is non-null, the
 * lock guard (`WHERE locked_at IS NULL`) makes re-lock attempts a
 * no-op (returns false). To "re-lock" a different snapshot, callers
 * record + lock the new one; the old one stays locked in the audit
 * trail (multiple locked snapshots can coexist per novel).
 */

import db from "./connection"

type Executor = typeof db

export type PlanningSnapshotLockedByKind = "human" | "policy" | "script" | "test"

export interface PlanningSnapshotRow {
  id: string
  novel_id: string
  version: string
  created_at: string | Date
  locked_at: string | Date | null
  locked_by_kind: string | null
  locked_by_ref: string | null
  locked_note: string | null
}

/**
 * Record a planning snapshot. Idempotent: rerunning with the same hash
 * is a no-op (`ON CONFLICT (id) DO NOTHING`). Returns true if a row
 * was actually inserted, false if it was skipped.
 *
 * The id IS the snapshot hash (commit 1's `computePlanningSnapshotHash`),
 * so the conflict-skip path is correct: the row exists because some
 * earlier call recorded an unchanged planning state.
 */
export async function recordPlanningSnapshot(
  args: { hash: string; novelId: string; version: string },
  executor: Executor = db,
): Promise<boolean> {
  const result = await executor`
    INSERT INTO planning_snapshots (id, novel_id, version)
    VALUES (${args.hash}, ${args.novelId}, ${args.version})
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `
  return Array.isArray(result) ? result.length > 0 : false
}

/** Point lookup by hash. Returns null when not found. */
export async function findPlanningSnapshot(
  hash: string,
  executor: Executor = db,
): Promise<PlanningSnapshotRow | null> {
  const rows = (await executor`
    SELECT * FROM planning_snapshots WHERE id = ${hash}
  `) as PlanningSnapshotRow[]
  return rows.length > 0 ? rows[0] : null
}

/** List snapshots for a novel newest-first. Default limit 50 (audit view). */
export async function listPlanningSnapshots(
  novelId: string,
  opts: { limit?: number } = {},
  executor: Executor = db,
): Promise<PlanningSnapshotRow[]> {
  const limit = opts.limit ?? 50
  return (await executor`
    SELECT * FROM planning_snapshots
    WHERE novel_id = ${novelId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as PlanningSnapshotRow[]
}

/**
 * The most-recently-locked snapshot for a novel, or null. Drafting
 * (Phase 4 commit 5) reads this at draft start to detect drift between
 * the locked planning state and the current planning state.
 */
export async function getLockedPlanningSnapshot(
  novelId: string,
  executor: Executor = db,
): Promise<PlanningSnapshotRow | null> {
  const rows = (await executor`
    SELECT * FROM planning_snapshots
    WHERE novel_id = ${novelId} AND locked_at IS NOT NULL
    ORDER BY locked_at DESC
    LIMIT 1
  `) as PlanningSnapshotRow[]
  return rows.length > 0 ? rows[0] : null
}

/**
 * Flip a recorded snapshot from observed → locked. Returns true if a
 * row transitioned, false if the snapshot wasn't found or was already
 * locked. The `WHERE locked_at IS NULL` guard makes re-lock idempotent
 * (no error, just no-op) — callers can detect via the boolean return.
 *
 * The actual `locked_at` value is set on the server via NOW() so the
 * audit timestamp comes from the DB clock, not the caller's clock.
 */
export async function lockPlanningSnapshot(
  args: {
    hash: string
    lockedByKind: PlanningSnapshotLockedByKind
    lockedByRef: string | null
    lockedNote: string | null
  },
  executor: Executor = db,
): Promise<boolean> {
  const result = (await executor`
    UPDATE planning_snapshots
    SET locked_at = NOW(),
        locked_by_kind = ${args.lockedByKind},
        locked_by_ref = ${args.lockedByRef},
        locked_note = ${args.lockedNote}
    WHERE id = ${args.hash} AND locked_at IS NULL
    RETURNING id
  `) as { id: string }[]
  return result.length > 0
}

/** Test helper / orphan cleanup. */
export async function deletePlanningSnapshotsForNovel(
  novelId: string,
  executor: Executor = db,
): Promise<void> {
  await executor`DELETE FROM planning_snapshots WHERE novel_id = ${novelId}`
}
