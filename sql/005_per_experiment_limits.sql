-- Replace daily budget tracking with per-experiment limits.
-- Real costs are already tracked in llm_calls via getTokenCost().

DROP INDEX IF EXISTS idx_bt_date;
DROP TABLE IF EXISTS budget_tracker;

-- Persist experiment config on the cycle row (was only in-memory before)
ALTER TABLE improvement_cycles ADD COLUMN IF NOT EXISTS experiment_id INTEGER;
ALTER TABLE improvement_cycles ADD COLUMN IF NOT EXISTS max_iterations INTEGER NOT NULL DEFAULT 15;
ALTER TABLE improvement_cycles ADD COLUMN IF NOT EXISTS max_cost_usd NUMERIC(8,4);
