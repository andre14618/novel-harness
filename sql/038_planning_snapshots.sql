-- Phase 4 commit 2 — planning_snapshots persistence.
--
-- Charter: docs/charters/world-bible-architecture.md
-- Design:  docs/designs/collaborative-proposal-workflow.md §"Phase 4 — Planning Snapshot Review Before Drafting"
--
-- Phase 4 commit 1 (bda04a4) shipped the pure compute helper for the
-- snapshot hash. This migration adds the storage layer: one row per
-- (novel, planning state) snapshot, with a lock pointer that flips a
-- snapshot from "computed/observed" to "drafting may proceed against
-- this state."
--
-- Schema notes:
--
--   * `id` is the snapshot hash itself (deterministic; same input ↔
--     same row). PRIMARY KEY makes the insert naturally idempotent —
--     repeated `recordPlanningSnapshot` calls for an unchanged novel
--     are no-ops.
--   * `novel_id` is included even though `id` already encodes the
--     novel state; querying "all snapshots for novel X" via the
--     composite (novel_id, created_at) index is the hot path for
--     the audit-history view (commit 4 follow-up).
--   * `version` mirrors the `version` parameter in
--     computePlanningSnapshotHash. v1 hashes can coexist with future
--     v2 hashes for the same novel; the version byte is in the
--     digest, so id collisions across versions are impossible by
--     construction.
--   * `locked_at` IS NULL while the snapshot is observed-but-not-locked.
--     `lockPlanningSnapshot(...)` flips it via WHERE locked_at IS NULL
--     so a re-lock attempt on an already-locked row returns 0 rows
--     affected (same guard pattern as canon_proposals' WHERE
--     status='pending').
--   * `locked_by_kind` mirrors proposal_envelopes.resolved_by_kind —
--     enum values are "human" | "policy" | "script" | "test"; Phase 4
--     commit 3 will fill this from the route handler.
--   * No FK to `novels` — matches the canon_* / chapter_revisions /
--     proposal_envelopes convention. Orphan cleanup is its own concern.

CREATE TABLE IF NOT EXISTS planning_snapshots (
  id              TEXT NOT NULL PRIMARY KEY,
  novel_id        TEXT NOT NULL,
  version         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at       TIMESTAMPTZ,
  locked_by_kind  TEXT,
  locked_by_ref   TEXT,
  locked_note     TEXT
);

-- Hot path: list snapshots for a novel ordered by recency.
CREATE INDEX IF NOT EXISTS planning_snapshots_novel_created_idx
  ON planning_snapshots (novel_id, created_at DESC);

-- "Find the locked snapshot for novel X" — partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS planning_snapshots_novel_locked_idx
  ON planning_snapshots (novel_id, locked_at DESC)
  WHERE locked_at IS NOT NULL;
