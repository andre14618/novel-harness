-- Migration 013: Drop thematic tags system and unify config defaults
--
-- Thematic tags are unused — graph-linker no longer produces them.
-- Config defaults aligned with TypeScript canonical values.

-- ── Drop thematic tags ──────────────────────────────────────────────────

DROP TABLE IF EXISTS thematic_tags;

ALTER TABLE deterministic_config
  DROP COLUMN IF EXISTS theme_auto_threshold,
  DROP COLUMN IF EXISTS theme_candidate_threshold;

-- ── Unify retrieval config defaults with TS ─────────────────────────────

ALTER TABLE retrieval_config ALTER COLUMN max_facts SET DEFAULT 15;

-- ── Unify deterministic config defaults with TS ─────────────────────────

ALTER TABLE deterministic_config ALTER COLUMN causal_auto_threshold SET DEFAULT 0.65;
ALTER TABLE deterministic_config ALTER COLUMN causal_candidate_threshold SET DEFAULT 0.35;
