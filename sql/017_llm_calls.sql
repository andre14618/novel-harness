-- Per-call LLM timing dataset for queryable latency analysis across runs.
-- Populated by transport.ts after every successful HTTP call (fire-and-forget).
-- novel_id and agent_name are nullable because some callers (lint fixers,
-- orchestrator atomic) don't currently propagate them — those rows still
-- carry useful model/latency/token data for slicing.

CREATE TABLE IF NOT EXISTS llm_calls (
  id BIGSERIAL PRIMARY KEY,
  novel_id TEXT,
  agent_name TEXT,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  http_attempts INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS llm_calls_novel_idx ON llm_calls (novel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS llm_calls_agent_idx ON llm_calls (agent_name, created_at DESC);
CREATE INDEX IF NOT EXISTS llm_calls_model_idx ON llm_calls (model, created_at DESC);
