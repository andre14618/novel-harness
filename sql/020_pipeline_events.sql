-- Pipeline event trace — persistent timeline of every pipeline step (LLM + deterministic).
-- Replaces ephemeral SSE-only events with a queryable audit trail.

CREATE TABLE pipeline_events (
  id SERIAL PRIMARY KEY,
  novel_id TEXT NOT NULL,
  run_id INTEGER,
  chapter INTEGER,
  beat_index INTEGER,
  event_type TEXT NOT NULL,
  agent TEXT,
  llm_call_id INTEGER,
  duration_ms INTEGER,
  payload JSONB NOT NULL DEFAULT '{}',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary query path: timeline for a novel run
CREATE INDEX idx_pipeline_events_novel_ts ON pipeline_events (novel_id, timestamp);

-- Filter by chapter for chapter-level trace view
CREATE INDEX idx_pipeline_events_novel_chapter ON pipeline_events (novel_id, chapter, timestamp);

-- Filter by event type for aggregation queries (e.g., all lint-detect events)
CREATE INDEX idx_pipeline_events_type ON pipeline_events (event_type, timestamp);

-- Link back to llm_calls for drill-down
CREATE INDEX idx_pipeline_events_llm_call ON pipeline_events (llm_call_id) WHERE llm_call_id IS NOT NULL;

-- Also make logLLMCall return the inserted row ID so trace can link to it
-- (No schema change needed — just needs RETURNING id in the INSERT)
