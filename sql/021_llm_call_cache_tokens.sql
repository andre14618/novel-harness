-- Cache hit accounting for llm_calls
--
-- DeepSeek, OpenAI, MiniMax, Zai, and several others return a
-- `prompt_tokens_details.cached_tokens` field with every response — the
-- number of prompt tokens that hit the provider's automatic prefix cache.
-- Cached tokens bill at a steep discount (DeepSeek: ~90% off; OpenAI: 90%
-- off for GPT-5.4; others: 75-90% off depending on model).
--
-- Without this column, `cost` in llm_calls bills every prompt token at the
-- miss rate, overstating cost on any workload with repeated prefixes
-- (system prompts, long style primers, beat-writer shared context).
--
-- cached_tokens is a SUBSET of prompt_tokens. The effective billing is:
--   miss   = prompt_tokens - cached_tokens
--   cost   = miss * input_rate + cached_tokens * input_rate * (1 - discount) + completion_tokens * output_rate

ALTER TABLE llm_calls
  ADD COLUMN IF NOT EXISTS cached_tokens INT NOT NULL DEFAULT 0;
