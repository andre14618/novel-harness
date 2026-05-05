-- 048_planning_mutation_lineage_reviser.sql
--
-- Accepted chapter-plan-reviser outline mutations are not proposal-envelope
-- rows, but they are durable planning mutations. Allow lineage rows to cite
-- the chapter_revisions telemetry row that caused the outline replacement.

ALTER TABLE planning_mutation_lineage
DROP CONSTRAINT IF EXISTS planning_mutation_lineage_source_table_check;

ALTER TABLE planning_mutation_lineage
ADD CONSTRAINT planning_mutation_lineage_source_table_check
CHECK (source_table IN ('proposal_envelopes', 'chapter_exhaustions', 'chapter_revisions'));
