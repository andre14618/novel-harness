-- 049_world_fact_roles.sql
--
-- Add a `role` dimension to the legacy `facts` table to distinguish how each
-- fact participates in writing and checking, independent of its `category`
-- shape tag (physical / rule / knowledge / etc.).
--
-- Roles:
--   - operational : the writer must obey AND the checker must enforce. Drives
--                   behavior. This is the default and matches existing runtime
--                   behavior so the migration is bit-identical for current
--                   data.
--   - reference   : background info, true but not enforceable. Informs flavor;
--                   should not by itself produce continuity blockers.
--   - hidden      : exists in canon but should not appear in the writer's
--                   prompt context (mystery reveals, off-page secrets).
--
-- This migration is intentionally additive only. No agent prompt, no checker
-- threshold, no writer-context assembly, and no fact-extraction pipeline reads
-- this column yet. Future slices that consume the role live in separate
-- experiments and lane docs (see docs/authoring-harness-refinement-plan.md
-- Richness Backlog → World fact roles).
--
-- `canon_facts.role` is deliberately deferred to a follow-up slice — that
-- table has its own migration cadence and a different consumer surface.

ALTER TABLE facts
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'operational'
    CHECK (role IN ('operational', 'reference', 'hidden'));

CREATE INDEX IF NOT EXISTS idx_facts_novel_role
  ON facts (novel_id, role);

COMMENT ON COLUMN facts.role IS
  'How this fact participates in writing/checking: operational (enforced), reference (background, advisory), hidden (canon-only, never in writer context). Default operational matches pre-migration behavior.';
