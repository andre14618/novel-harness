-- Durable beat identity for LLM-call inspection.
--
-- `beat_index` remains the operational selector and legacy filter. This
-- column records the stable beatId when the caller has one, so downstream
-- traceability can join checker/writer calls to planning targets without
-- reconstructing identity from chapter+position.

ALTER TABLE llm_calls
  ADD COLUMN IF NOT EXISTS beat_id TEXT;

CREATE INDEX IF NOT EXISTS idx_llm_calls_novel_beat_id
  ON llm_calls(novel_id, beat_id)
  WHERE novel_id IS NOT NULL AND beat_id IS NOT NULL;
