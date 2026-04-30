-- 026_checker_eval_columns.sql
--
-- Extends eval_results to support checker-adapter evals alongside the
-- existing writer-voice evals (adherence-v4, chapter-plan-v2, continuity-v2,
-- hallucination-v1, etc.). Prior to this, checker eval numbers lived only in
-- terminal output / docs text, not in queryable rows. See conversation
-- 2026-04-18 — hallucination-checker-v1 is the first checker to land
-- row-level in this table.
--
-- All new columns are nullable: writer evals keep using style_features /
-- delta_sum / ngram_jaccard_vs_gt / etc.; checker evals use the new fields.
-- One spine, polymorphic.

ALTER TABLE eval_results
  ADD COLUMN IF NOT EXISTS expected_label_json JSONB,
  ADD COLUMN IF NOT EXISTS actual_label_json   JSONB,
  ADD COLUMN IF NOT EXISTS correct             BOOLEAN,
  ADD COLUMN IF NOT EXISTS latency_ms          INT;

COMMENT ON COLUMN eval_results.expected_label_json IS 'Ground-truth label JSON for checker-style evals (e.g. {pass, issues[]}).';
COMMENT ON COLUMN eval_results.actual_label_json   IS 'Adapter output JSON for checker-style evals.';
COMMENT ON COLUMN eval_results.correct             IS 'Whether actual_label matched expected_label on the primary key (pass/fail).';
COMMENT ON COLUMN eval_results.latency_ms          IS 'Per-call latency in milliseconds (writer or checker).';
