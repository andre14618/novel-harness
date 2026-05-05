-- 043_proposal_resolution_impacts.sql
--
-- Phase 7 — explicit correlation context for downstream checker attribution.
--
-- proposal_resolution_outcomes stores the observed result. This table stores
-- the concrete surface produced by a resolved proposal so later checker runs
-- can attribute outcomes by exact state, not by timing guesswork.

CREATE TABLE IF NOT EXISTS proposal_resolution_impacts (
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
  prior_hash TEXT,
  result_hash TEXT,
  result_version TEXT,
  resolved_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_proposal_resolution_impacts_source_proposal
  ON proposal_resolution_impacts (source_table, proposal_id);

CREATE INDEX IF NOT EXISTS idx_proposal_resolution_impacts_draft_result
  ON proposal_resolution_impacts (novel_id, chapter_number, result_hash)
  WHERE target_kind = 'draft' AND result_hash IS NOT NULL;
