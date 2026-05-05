-- 044_proposal_checker_observations.sql
--
-- Phase 7 — checker observations attributed through proposal impacts.
--
-- A checker observation is only written after matching a checker run to an
-- exact proposal impact surface, such as a draft result hash. This avoids
-- guessing that a nearby checker fire was caused by a proposal.

CREATE TABLE IF NOT EXISTS proposal_checker_observations (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  proposal_kind TEXT NOT NULL CHECK (
    proposal_kind IN ('artifact_patch', 'prose_edit', 'editorial_flag', 'canon_update')
  ),
  novel_id TEXT NOT NULL,
  source_table TEXT NOT NULL CHECK (source_table IN ('proposal_envelopes', 'canon_proposals')),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('draft', 'artifact', 'canon')),
  target_ref TEXT NOT NULL,
  chapter_number INTEGER,
  result_hash TEXT,
  checker_name TEXT NOT NULL,
  fired BOOLEAN NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_proposal_checker_observations_unique_surface
  ON proposal_checker_observations (
    source_table, proposal_id, target_kind, checker_name, result_hash
  );

CREATE INDEX IF NOT EXISTS idx_proposal_checker_observations_proposal
  ON proposal_checker_observations (source_table, proposal_id, observed_at DESC);
