-- 034_llm_call_ner_prepass.sql
--
-- Persist NER-prepass findings from halluc-ungrounded into llm_calls.
--
-- Context (L16, 2026-05-01):
--   The halluc-ungrounded agent runs a deterministic NER prepass BEFORE the LLM
--   call. The prepass result (`nerFindings`, `nerOnlyFindings`, AND-gate decision)
--   is computed in-process after the LLM returns and was NOT previously serialized
--   to any DB column. This made it impossible to audit AND-gate firing rates
--   (NER∩LLM / NER-only / LLM-only) from `llm_calls` alone.
--
--   New column `ner_prepass_json` stores the post-call aggregation as JSONB.
--   Shape (written by checkHallucUngrounded after callAgent returns):
--     {
--       nerEnabled: boolean,
--       nerFindings: [{ phrase: string, class: string }, ...],
--       nerOnlyFindings: [{ phrase: string, class: string }, ...],
--       andGateDecision: "ner+llm-blocker" | "ner-only-warning"
--                       | "llm-only-blocker" | "pass" | "disabled"
--     }
--
--   NULL for all non-halluc-ungrounded agents and for halluc-ungrounded calls
--   on variants v0/v2 (where the NER prepass is disabled). Backward-compatible:
--   existing rows retain NULL, all existing analyses are unaffected.

ALTER TABLE llm_calls
  ADD COLUMN IF NOT EXISTS ner_prepass_json JSONB;

-- Partial index: only halluc-ungrounded rows where NER actually ran are worth
-- indexing. Use GIN for JSONB containment queries (e.g. finding all rows where
-- andGateDecision = 'ner+llm-blocker' or nerFindings is non-empty).
CREATE INDEX IF NOT EXISTS idx_llm_calls_ner_prepass
  ON llm_calls USING GIN (ner_prepass_json)
  WHERE ner_prepass_json IS NOT NULL;
