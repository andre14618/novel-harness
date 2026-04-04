-- Link experiments to the git commit they were run against.
-- Enables querying "what code produced this result" and reverting to exact state.
ALTER TABLE tuning_experiments ADD COLUMN IF NOT EXISTS commit_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_experiments_commit ON tuning_experiments(commit_hash);
