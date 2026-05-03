-- 036_canon_substrate_invariants.sql
--
-- Mechanical enforcement of canon-substrate invariants flagged in the Codex
-- round-2 review of `ba72e09`:
--
--   1. Partial unique indexes on (novel_id, logical_id) WHERE
--      superseded_by_version IS NULL for all four canon tables. The logical
--      invariant — "at most one currently-active version per logical id" —
--      was previously enforced only in application code (the
--      always-supersede-same-id rule in commitFact / commitEntity /
--      commitState / commitPromise). The Codex finding was correct:
--      Step 1 is a substrate/schema gate, and the invariant should be
--      schema-enforced. The existing snapshot indexes (sql/035) are
--      non-unique and stay in place — they exist for read-side performance
--      on the point-in-time snapshot query.
--
--   2. CHECK constraint pinning confidence to [0, 1]. The api.ts contract
--      documents `Provenance.confidence` as `[0, 1]`, but the column was
--      typed `NUMERIC(4,3)` which permits up to 9.999. A CHECK constraint
--      catches extractor bugs at the substrate boundary instead of letting
--      garbage propagate into reads.
--
-- The unique-index migration is safe to apply against an empty table set.
-- If non-conforming rows exist (two active versions for the same logical
-- id), index creation will fail and surface the violation explicitly.
-- That's the right outcome — the substrate would be lying about the
-- invariant otherwise. Local DB at the time of this migration has only
-- ephemeral test rows from the equivalence suite (cleaned per-test), so
-- the index can be created cleanly.

-- ── Active-version uniqueness ──────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uniq_canon_facts_active
  ON canon_facts (novel_id, logical_id)
  WHERE superseded_by_version IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_canon_entities_active
  ON canon_entities (novel_id, logical_id)
  WHERE superseded_by_version IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_canon_character_states_active
  ON canon_character_states (novel_id, character_id)
  WHERE superseded_by_version IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_canon_promises_active
  ON canon_promises (novel_id, logical_id)
  WHERE superseded_by_version IS NULL;

-- ── Confidence range check ────────────────────────────────────────────────
--
-- Each canon table carries the same `confidence NUMERIC(4,3)` column. The
-- type only bounds digit count; we want bounded value range. CHECK
-- constraints at the column level pin to [0, 1] and accept NULL (no
-- extractor confidence reported is fine; it's an optional field).

ALTER TABLE canon_facts
  ADD CONSTRAINT chk_canon_facts_confidence_range
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));

ALTER TABLE canon_entities
  ADD CONSTRAINT chk_canon_entities_confidence_range
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));

ALTER TABLE canon_character_states
  ADD CONSTRAINT chk_canon_character_states_confidence_range
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));

ALTER TABLE canon_promises
  ADD CONSTRAINT chk_canon_promises_confidence_range
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));

COMMENT ON INDEX uniq_canon_facts_active IS
  'Mechanical enforcement of "at most one active version per logical id". Codex round-2 hardening.';
COMMENT ON INDEX uniq_canon_entities_active IS
  'Mechanical enforcement of "at most one active version per logical id". Codex round-2 hardening.';
COMMENT ON INDEX uniq_canon_character_states_active IS
  'Mechanical enforcement of "at most one active version per character_id". Codex round-2 hardening.';
COMMENT ON INDEX uniq_canon_promises_active IS
  'Mechanical enforcement of "at most one active version per logical id". Codex round-2 hardening.';
