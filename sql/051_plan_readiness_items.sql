-- 051_plan_readiness_items.sql
--
-- Human-in-the-loop readiness review between planner diagnostics and drafting.
-- Readiness items are not plan mutations. They capture diagnostic findings,
-- operator dispositions, and optional links to manual planning_edit proposals.

CREATE TABLE IF NOT EXISTS plan_readiness_items (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('chapter_outline', 'scene_plan', 'beat_plan')),
  target_ref TEXT NOT NULL,
  target_field_path TEXT,
  source_hash TEXT NOT NULL,
  source_hash_kind TEXT NOT NULL CHECK (
    source_hash_kind IN ('target_current_version', 'diagnostic_excerpt')
  ),
  diagnostic_label TEXT NOT NULL,
  dimension TEXT NOT NULL,
  fix_intent TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low', 'info')),
  explanation TEXT NOT NULL,
  missing_for_next_level TEXT,
  preserve_ids JSONB NOT NULL DEFAULT '{"obligationIds":[],"characterIds":[],"worldFactIds":[],"sourceIds":[]}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_report_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN (
      'open',
      'accepted_as_is',
      'not_applicable',
      'deferred',
      'proposal_created',
      'fixed',
      'stale'
    )
  ),
  operator_disposition TEXT CHECK (
    operator_disposition IS NULL OR operator_disposition IN (
      'real_issue',
      'false_positive',
      'not_applicable',
      'acceptable_choice',
      'defer_to_drafting',
      'fixed'
    )
  ),
  operator_note TEXT,
  proposal_envelope_id TEXT,
  imported_by_kind TEXT NOT NULL DEFAULT 'script' CHECK (
    imported_by_kind IN ('human', 'agent', 'script', 'test')
  ),
  imported_by_ref TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS plan_readiness_items_novel_status_idx
  ON plan_readiness_items (novel_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS plan_readiness_items_target_idx
  ON plan_readiness_items (novel_id, target_kind, target_ref, status);

CREATE INDEX IF NOT EXISTS plan_readiness_items_proposal_idx
  ON plan_readiness_items (proposal_envelope_id)
  WHERE proposal_envelope_id IS NOT NULL;
