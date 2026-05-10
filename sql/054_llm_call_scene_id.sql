-- Durable scene identity for LLM-call inspection.
--
-- `scene_id` is the canonical per-entry identity for scene-level
-- plan/write/check surfaces. `beat_id` remains for legacy beat-shaped entries
-- and true beat-specific records; callers should not stuff scene IDs into
-- beat_id for scene-first telemetry.

ALTER TABLE llm_calls
  ADD COLUMN IF NOT EXISTS scene_id TEXT;

CREATE INDEX IF NOT EXISTS idx_llm_calls_novel_scene_id
  ON llm_calls(novel_id, scene_id)
  WHERE novel_id IS NOT NULL AND scene_id IS NOT NULL;
