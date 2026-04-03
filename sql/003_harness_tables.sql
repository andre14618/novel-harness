-- Harness tables: migrated from SQLite (data/harness.db) to Postgres.
-- These tables store all benchmark runs, LLM calls, scores, experiments,
-- lint patterns, batch processing, and pairwise comparison data.

CREATE TABLE IF NOT EXISTS tuning_experiments (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  experiment_type TEXT NOT NULL,
  description TEXT NOT NULL,
  config JSONB NOT NULL,
  conclusion TEXT,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id SERIAL PRIMARY KEY,
  run_type TEXT NOT NULL,
  run_ref TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  model_config JSONB NOT NULL,
  label TEXT,
  experiment_id INTEGER REFERENCES tuning_experiments(id)
);

CREATE TABLE IF NOT EXISTS run_agents (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  agent TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_calls (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  agent TEXT NOT NULL,
  phase TEXT,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  temperature REAL,
  max_tokens INTEGER,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  tokens_per_sec INTEGER NOT NULL DEFAULT 0,
  cost NUMERIC(10,6) NOT NULL DEFAULT 0,
  chapter INTEGER,
  seed TEXT,
  dimension TEXT,
  json_extraction_success BOOLEAN DEFAULT true,
  json_extraction_retried BOOLEAN DEFAULT false,
  zod_validation_success BOOLEAN DEFAULT true,
  zod_errors TEXT,
  http_attempts INTEGER DEFAULT 1,
  retry_errors TEXT
);

CREATE TABLE IF NOT EXISTS generations (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  seed TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  prose TEXT,
  word_count INTEGER,
  latency_ms INTEGER,
  tokens_per_sec REAL,
  completion_tokens INTEGER,
  passed BOOLEAN NOT NULL DEFAULT false,
  variant_label TEXT
);

CREATE TABLE IF NOT EXISTS scores (
  id SERIAL PRIMARY KEY,
  generation_id INTEGER NOT NULL REFERENCES generations(id),
  judge TEXT NOT NULL,
  dimension TEXT NOT NULL,
  score INTEGER NOT NULL,
  reasoning TEXT
);

CREATE TABLE IF NOT EXISTS baselines (
  id SERIAL PRIMARY KEY,
  benchmark_type TEXT NOT NULL UNIQUE,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  set_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lint_patterns (
  id SERIAL PRIMARY KEY,
  tier INTEGER NOT NULL,
  category TEXT NOT NULL,
  pattern TEXT NOT NULL,
  flags TEXT NOT NULL DEFAULT 'gi',
  fix_template TEXT NOT NULL,
  dialogue_ok BOOLEAN NOT NULL DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT true,
  rationale TEXT,
  edge_cases TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lint_issues (
  id SERIAL PRIMARY KEY,
  generation_id INTEGER NOT NULL REFERENCES generations(id),
  pattern_id INTEGER NOT NULL REFERENCES lint_patterns(id),
  char_offset INTEGER NOT NULL,
  match TEXT NOT NULL,
  sentence TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  rewrite_result TEXT
);

CREATE TABLE IF NOT EXISTS batches (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES runs(id),
  provider TEXT NOT NULL,
  provider_batch_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  judge_model TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  input_file TEXT,
  output_file TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS batch_requests (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES batches(id),
  custom_id TEXT NOT NULL,
  generation_id INTEGER NOT NULL REFERENCES generations(id),
  dimension TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  score INTEGER,
  issues_json TEXT
);

CREATE TABLE IF NOT EXISTS pairwise_matchups (
  id SERIAL PRIMARY KEY,
  experiment_id INTEGER REFERENCES tuning_experiments(id),
  generation_a INTEGER NOT NULL REFERENCES generations(id),
  generation_b INTEGER NOT NULL REFERENCES generations(id),
  label_a TEXT NOT NULL,
  label_b TEXT NOT NULL,
  seed TEXT NOT NULL,
  judge_model TEXT NOT NULL,
  winner TEXT NOT NULL,
  confidence TEXT,
  reasoning TEXT,
  position TEXT NOT NULL,
  latency_ms INTEGER,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tuning_results (
  id SERIAL PRIMARY KEY,
  experiment_id INTEGER NOT NULL REFERENCES tuning_experiments(id),
  model TEXT NOT NULL,
  rubric TEXT NOT NULL,
  sample TEXT NOT NULL,
  run INTEGER NOT NULL,
  score REAL,
  issues TEXT,
  reasoning TEXT,
  latency_ms INTEGER,
  failed BOOLEAN NOT NULL DEFAULT false
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_runs_type ON runs(run_type);
CREATE INDEX IF NOT EXISTS idx_runs_experiment ON runs(experiment_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_run ON llm_calls(run_id);
CREATE INDEX IF NOT EXISTS idx_generations_run ON generations(run_id);
CREATE INDEX IF NOT EXISTS idx_scores_generation ON scores(generation_id);
CREATE INDEX IF NOT EXISTS idx_scores_dimension ON scores(dimension);
CREATE INDEX IF NOT EXISTS idx_lint_issues_generation ON lint_issues(generation_id);
CREATE INDEX IF NOT EXISTS idx_batch_requests_batch ON batch_requests(batch_id);
CREATE INDEX IF NOT EXISTS idx_pairwise_experiment ON pairwise_matchups(experiment_id);
