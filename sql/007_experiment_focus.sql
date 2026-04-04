-- Dimension locking: store target/dimension at the cycle level
ALTER TABLE improvement_cycles ADD COLUMN IF NOT EXISTS target TEXT;
ALTER TABLE improvement_cycles ADD COLUMN IF NOT EXISTS dimension TEXT;
ALTER TABLE improvement_cycles ADD COLUMN IF NOT EXISTS dimension_locked BOOLEAN NOT NULL DEFAULT true;

-- Cross-experiment linking
CREATE TABLE IF NOT EXISTS experiment_lineage (
  id SERIAL PRIMARY KEY,
  experiment_id INTEGER NOT NULL REFERENCES tuning_experiments(id),
  parent_experiment_id INTEGER NOT NULL REFERENCES tuning_experiments(id),
  relationship TEXT NOT NULL DEFAULT 'continuation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lineage_experiment ON experiment_lineage(experiment_id);
CREATE INDEX IF NOT EXISTS idx_lineage_parent ON experiment_lineage(parent_experiment_id);

-- Structured target/dimension on experiments for querying
ALTER TABLE tuning_experiments ADD COLUMN IF NOT EXISTS target TEXT;
ALTER TABLE tuning_experiments ADD COLUMN IF NOT EXISTS dimension TEXT;

-- Backfill from config JSON where possible
UPDATE tuning_experiments
SET target = config->>'target', dimension = config->>'dimension'
WHERE config->>'target' IS NOT NULL AND target IS NULL;

-- Indexes for cross-experiment queries
CREATE INDEX IF NOT EXISTS idx_experiments_target_dim ON tuning_experiments(target, dimension);
CREATE INDEX IF NOT EXISTS idx_cycles_target_dim ON improvement_cycles(target, dimension);
