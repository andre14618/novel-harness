-- 050_canon_fact_roles.sql
--
-- Symmetric to sql/049: add a `role` dimension to `canon_facts` so the canon
-- substrate carries the same writing/checking participation flag as the legacy
-- `facts` table. See sql/049 for the role taxonomy and rationale.
--
-- Additive only. No agent prompt, checker, or writer-context consumer reads
-- this column yet. Default `operational` keeps current behavior bit-identical.

ALTER TABLE canon_facts
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'operational'
    CHECK (role IN ('operational', 'reference', 'hidden'));

CREATE INDEX IF NOT EXISTS idx_canon_facts_novel_role
  ON canon_facts (novel_id, role)
  WHERE superseded_by_version IS NULL;

COMMENT ON COLUMN canon_facts.role IS
  'How this canon fact participates in writing/checking: operational (enforced), reference (background, advisory), hidden (canon-only, never in writer context). Default operational matches pre-migration behavior. Symmetric with facts.role from sql/049.';
