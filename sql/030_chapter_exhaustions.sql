-- 030_chapter_exhaustions.sql
--
-- Telemetry for plan-assist gate lifecycle — one row per gate fire,
-- updated in-place on resolution. Parallels the chapter_revisions table
-- (sql/028) but tracks the GATE lifecycle specifically, not reviser
-- invocations. Rationale for the parallel table: the two concepts have
-- distinct lifetimes — a single chapter may fire multiple gates across
-- attempts, and gates can resolve via edit/override/abort decisions
-- that don't map cleanly onto the revision-outcome enum.
--
-- Writes land from src/gates.ts (requestPlanAssist fires the row,
-- resolvePlanAssist updates it). Per Codex review aab899143d8326c77
-- the divergence with chapter_revisions' drafting-owned write path is
-- intentional — gates own the gate-lifecycle concept.
--
-- Used by:
--   - /api/novel/:id/exhaustions endpoint → Studio ExhaustionsPanel
--   - future cross-novel analytics (how often each seed exhausts, by kind)
--
-- No FK to novels — matches chapter_revisions convention; orphan-cleanup
-- is deferred. No FK to llm_calls — this table isn't about an LLM call.

CREATE TABLE IF NOT EXISTS chapter_exhaustions (
  id                    SERIAL PRIMARY KEY,
  novel_id              TEXT NOT NULL,
  chapter               INT  NOT NULL,
  attempt               INT  NOT NULL,
  fired_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind                  TEXT NOT NULL,   -- 'plan-check-exhausted' | 'reviser-rejected'
  resolver_mode         TEXT NOT NULL,   -- 'auto' | 'cli' | 'web'
  unresolved_deviations JSONB NOT NULL DEFAULT '[]',
  reviser_history       JSONB,           -- null when no reviser was invoked on this site
  decided_at            TIMESTAMPTZ,     -- null until gate resolves
  decision              TEXT,            -- 'edit-plan' | 'override' | 'abort' | NULL when pending
  decision_details      JSONB            -- edited outline blob for edit-plan; NULL otherwise
);

CREATE INDEX IF NOT EXISTS idx_chapter_exhaustions_novel
  ON chapter_exhaustions(novel_id, chapter, fired_at);
