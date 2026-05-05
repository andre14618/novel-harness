-- 042_proposal_resolution_outcomes.sql
--
-- Phase 7 — stable downstream-impact source for ApprovalPolicy replay.
--
-- The proposal resolution tables record what was decided and who/what resolved
-- it. They should remain an immutable audit surface. Downstream impact is
-- observed after resolution by later checks: checker fires, edit churn, canon
-- conflicts, and future replay-quality signals.
--
-- Keep that observation in a separate keyed table so Phase 7 replay can join a
-- durable signal without inferring behavior from logs or rewriting resolution
-- rows after the fact.

CREATE TABLE IF NOT EXISTS proposal_resolution_outcomes (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  proposal_kind TEXT NOT NULL CHECK (
    proposal_kind IN ('artifact_patch', 'prose_edit', 'editorial_flag', 'canon_update')
  ),
  novel_id TEXT NOT NULL,
  source_table TEXT NOT NULL CHECK (source_table IN ('proposal_envelopes', 'canon_proposals')),
  resolved_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  downstream_checker_fired BOOLEAN,
  downstream_edit_churn INTEGER CHECK (
    downstream_edit_churn IS NULL OR downstream_edit_churn >= 0
  ),
  downstream_canon_conflict BOOLEAN,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_proposal_resolution_outcomes_source_proposal
  ON proposal_resolution_outcomes (source_table, proposal_id);

CREATE INDEX IF NOT EXISTS idx_proposal_resolution_outcomes_novel_observed
  ON proposal_resolution_outcomes (novel_id, observed_at DESC);
