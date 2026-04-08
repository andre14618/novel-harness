-- Inspection columns for llm_calls
--
-- Until now `llm_calls` only stored metadata (token counts, latency, cost)
-- and `contentPreview` was kept in memory but never persisted. That made
-- context engineering impossible without SSH + raw SQL: you couldn't see
-- what the beat-writer (or any other agent) actually received.
--
-- This migration adds the full prompt/response text plus a few tag columns
-- that let the inspector view drill down to a specific novel / chapter /
-- beat / attempt. See `docs/llm-call-inspector.md` for usage.

ALTER TABLE llm_calls
  ADD COLUMN IF NOT EXISTS system_prompt    TEXT,
  ADD COLUMN IF NOT EXISTS user_prompt      TEXT,
  ADD COLUMN IF NOT EXISTS response_content TEXT,
  ADD COLUMN IF NOT EXISTS novel_id         TEXT,
  ADD COLUMN IF NOT EXISTS beat_index       INTEGER,
  ADD COLUMN IF NOT EXISTS attempt          INTEGER;

-- Drill-down indexes for the inspector page filters
CREATE INDEX IF NOT EXISTS idx_llm_calls_novel
  ON llm_calls(novel_id, chapter, beat_index)
  WHERE novel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_llm_calls_agent
  ON llm_calls(agent, timestamp DESC);
