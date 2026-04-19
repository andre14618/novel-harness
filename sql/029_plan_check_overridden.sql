-- 029_plan_check_overridden.sql
--
-- Per-chapter override flag for plan-assist gate decisions. When the user
-- picks "override" at a plan-assist exhaustion gate (see
-- docs/exhaustion-handler-design.md), we record it durably so subsequent
-- drafting attempts skip the blocking check instead of re-firing the gate.
--
-- Scoped to a single boolean (plan-check AND validation share the override).
-- Rationale: the user's intent at the gate is "accept the current prose and
-- move past blocking checks"; one decision covers both surfaces. A future
-- split into per-check flags is trivial (add columns, backfill NULLs) if
-- the UX demands it.

ALTER TABLE chapter_outlines
  ADD COLUMN IF NOT EXISTS plan_check_overridden BOOLEAN NOT NULL DEFAULT FALSE;
