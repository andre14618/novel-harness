-- 031_chapter_outlines_revision_used.sql
--
-- Persistent per-chapter guard flag for chapter-plan-reviser invocations.
-- Mirrors chapter_outlines.plan_check_overridden (sql/029). Set to TRUE
-- BEFORE the reviser call in drafting.ts so a restart mid-call can't
-- allow a duplicate invocation on resume. The reviser hard cap is "one
-- per chapter across the novel's lifetime" and must survive process
-- boundary.
--
-- Codex review a252aecbb785a0eb3 flagged this as the main production-
-- hardness gap. Observed anomaly: novel-1776616563937 had 2 non-skip
-- chapter_revisions rows on chapter 1 after a session restart reset
-- the in-memory let.
--
-- See docs/next-session-plan.md §Tier 1a and
-- docs/patterns/in-memory-state-restart-data-loss.md.

ALTER TABLE chapter_outlines
  ADD COLUMN IF NOT EXISTS revision_used BOOLEAN NOT NULL DEFAULT FALSE;
