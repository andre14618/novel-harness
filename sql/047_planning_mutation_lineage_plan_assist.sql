-- 047_planning_mutation_lineage_plan_assist.sql
--
-- Allow planning mutation lineage to cite plan-assist gate telemetry rows.
-- The mutation is still categorized as planning_edit because it changes
-- planning state, but source_table distinguishes proposal-backed edits from
-- manual exhaustion-gate decisions.

ALTER TABLE planning_mutation_lineage
  DROP CONSTRAINT IF EXISTS planning_mutation_lineage_source_table_check;

ALTER TABLE planning_mutation_lineage
  ADD CONSTRAINT planning_mutation_lineage_source_table_check
  CHECK (source_table IN ('proposal_envelopes', 'chapter_exhaustions'));
