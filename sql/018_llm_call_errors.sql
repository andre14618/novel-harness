-- Failure capture for llm_calls
--
-- The original llm_calls schema only stored a row when a call succeeded —
-- if the LLM provider returned a 5xx, the request timed out, the JSON
-- couldn't be parsed, or schema validation failed deep in the stack, no
-- row was written. The exact moment you most need the log is exactly when
-- it didn't exist.
--
-- This migration adds three columns so every attempt — successful or
-- failed — produces exactly one row:
--
--   request_json — full LLMRequest envelope (model, temperature, prompts,
--                  responseFormat, extraBody, useMaxCompletionTokens, ...).
--                  Stored as JSONB so the call is fully reproducible from
--                  the row alone.
--   failed       — true if the call threw at any layer (HTTP, JSON, schema)
--   error_text   — the error message + stack when failed=true
--
-- Combined with sql/017_llm_call_inspection.sql, the inspector view at
-- /app/llm-calls becomes an append-only audit log: every attempt produces
-- one row containing the full request, the response (or the error), and
-- enough tags to find it later.

ALTER TABLE llm_calls
  ADD COLUMN IF NOT EXISTS request_json JSONB,
  ADD COLUMN IF NOT EXISTS failed       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS error_text   TEXT;

-- Failed calls are the primary thing you query for during troubleshooting.
-- A partial index keeps the index small while making "failed only" filters
-- effectively free.
CREATE INDEX IF NOT EXISTS idx_llm_calls_failed
  ON llm_calls(timestamp DESC)
  WHERE failed = true;
