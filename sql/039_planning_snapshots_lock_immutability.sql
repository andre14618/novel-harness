-- OpenCode review LOW 1 (2026-05-04) — DB-level guard for the one-way lock.
--
-- The application layer already enforces the lock contract via
-- `UPDATE planning_snapshots ... WHERE locked_at IS NULL`
-- (src/db/planning-snapshots.ts:lockPlanningSnapshot), which makes
-- re-lock attempts a 0-row UPDATE. That works for the routes we ship
-- today, but it is purely a code-side discipline: anyone hitting the
-- DB out-of-band (psql, ad-hoc scripts, future module) could mutate
-- `locked_at`, `locked_by_kind`, `locked_by_ref`, or `locked_note`
-- on an already-locked row and silently break the audit trail.
--
-- This migration enforces immutability at the row level: once
-- `locked_at` is non-NULL, the lock fields cannot change. The first
-- lock transition (NULL -> non-NULL) is allowed; that's the whole
-- point of the lock action.
--
-- Schema/contract (cross-check 038_planning_snapshots.sql):
--   - locked_at IS NULL while observed-but-not-locked.
--   - locked_at non-NULL once locked; lock metadata is also written.
--   - No other column should be mutated post-lock either, but the
--     non-lock columns (id, novel_id, version, created_at) have no
--     legitimate UPDATE path anywhere in the codebase, so the
--     trigger only checks the four lock fields. If we ever start
--     mutating other columns post-lock, that is its own design
--     question.
--
-- DELETE is intentionally not blocked — `deletePlanningSnapshotsForNovel`
-- is the standard test/cleanup path and orphan reaping should remain
-- possible.

CREATE OR REPLACE FUNCTION planning_snapshots_lock_immutability()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when the row is already locked.
  IF OLD.locked_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.locked_at IS DISTINCT FROM OLD.locked_at
     OR NEW.locked_by_kind IS DISTINCT FROM OLD.locked_by_kind
     OR NEW.locked_by_ref  IS DISTINCT FROM OLD.locked_by_ref
     OR NEW.locked_note    IS DISTINCT FROM OLD.locked_note THEN
    RAISE EXCEPTION
      'planning_snapshots row % is already locked (locked_at=%); lock fields are immutable',
      OLD.id, OLD.locked_at
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS planning_snapshots_lock_immutability_trg
  ON planning_snapshots;

CREATE TRIGGER planning_snapshots_lock_immutability_trg
  BEFORE UPDATE ON planning_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION planning_snapshots_lock_immutability();
