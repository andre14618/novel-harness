-- Store the proposed prompt content for every iteration (kept AND reverted).
-- Enables synthesizeConclusion() to show diffs for reverted attempts,
-- which is where most of the learning happens.

ALTER TABLE improvement_iterations ADD COLUMN proposed_content TEXT;
