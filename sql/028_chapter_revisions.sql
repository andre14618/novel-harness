-- 028_chapter_revisions.sql
--
-- Telemetry for chapter-plan-reviser invocations. Per-invocation row
-- captures outcome, issue signature, pre/post scene snapshots, plus
-- skip-telemetry rows for control-flow exits that didn't invoke the agent
-- (already revised, duplicate signature, no beat state available).
--
-- Used by /api/novel/:id/revisions to answer:
--   - How often does the reviser fire?
--   - What % of invocations produce an accepted plan?
--   - Is it disproportionately firing on specific chapters/seeds/issue types?
--
-- No FK to llm_calls — the JOIN on (novel_id, chapter, agent='chapter-plan-reviser',
-- timestamp) is unique enough and decoupling avoids infrastructure surgery.

CREATE TABLE IF NOT EXISTS chapter_revisions (
  id                   SERIAL PRIMARY KEY,
  novel_id             TEXT NOT NULL,
  chapter              INT  NOT NULL,
  attempt              INT  NOT NULL,
  invoked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Issue context
  issue_sig            TEXT NOT NULL,          -- SHA256 hash of sorted deviation descriptions
  issue_count          INT  NOT NULL,
  original_beat_count  INT  NOT NULL,

  -- Revision output (nullable on any non-accepted outcome)
  revised_beat_count   INT,
  outline_before       JSONB,                  -- scenes snapshot before revision
  outline_after        JSONB,                  -- scenes snapshot after revision (null if rejected)

  outcome              TEXT NOT NULL CHECK (outcome IN (
    'accepted',
    'rejected_beat_floor',
    'rejected_new_characters',
    'error',
    'skip_already_revised',
    'skip_duplicate_sig',
    'skip_no_beat_state'
  )),
  rejection_reason     TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chapter_revisions_novel ON chapter_revisions(novel_id);
CREATE INDEX IF NOT EXISTS idx_chapter_revisions_novel_chapter ON chapter_revisions(novel_id, chapter);
CREATE INDEX IF NOT EXISTS idx_chapter_revisions_outcome ON chapter_revisions(outcome);

COMMENT ON TABLE chapter_revisions IS
  'Chapter-plan-reviser invocation telemetry — one row per invocation or skip decision. Populated by src/phases/drafting.ts. Queried via src/harness/chapter-revisions.ts.';
