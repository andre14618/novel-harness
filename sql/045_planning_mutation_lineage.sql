-- 045_planning_mutation_lineage.sql
--
-- Append-only lineage for approved planning edits.
--
-- Planning targets can be mutated by human/operator proposals and, later,
-- guarded agent proposals. The current target map derives live dependency
-- edges from artifacts; this table preserves the historical mutation edge so
-- old refs and superseded refs remain explainable after the artifact changes.

CREATE TABLE IF NOT EXISTS planning_mutation_lineage (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  proposal_kind TEXT NOT NULL CHECK (
    proposal_kind IN ('planning_edit')
  ),
  novel_id TEXT NOT NULL,
  source_table TEXT NOT NULL CHECK (source_table IN ('proposal_envelopes')),
  actor_kind TEXT NOT NULL,
  actor_ref TEXT,
  source TEXT,
  target_kind TEXT NOT NULL,
  previous_ref TEXT NOT NULL,
  next_ref TEXT NOT NULL,
  field_path TEXT NOT NULL,
  previous_version TEXT,
  next_version TEXT,
  precondition_kind TEXT,
  precondition_hash TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,
  affected_downstream_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS planning_mutation_lineage_novel_changed_idx
  ON planning_mutation_lineage (novel_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS planning_mutation_lineage_proposal_idx
  ON planning_mutation_lineage (source_table, proposal_id);

CREATE INDEX IF NOT EXISTS planning_mutation_lineage_previous_ref_idx
  ON planning_mutation_lineage (novel_id, previous_ref, changed_at DESC);

CREATE INDEX IF NOT EXISTS planning_mutation_lineage_next_ref_idx
  ON planning_mutation_lineage (novel_id, next_ref, changed_at DESC);

CREATE INDEX IF NOT EXISTS planning_mutation_lineage_target_idx
  ON planning_mutation_lineage (novel_id, target_kind, next_ref, changed_at DESC);
