-- Experiment status tracking for workbench-created experiments
ALTER TABLE tuning_experiments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';
CREATE INDEX IF NOT EXISTS idx_experiments_status ON tuning_experiments(status) WHERE status != 'completed';
