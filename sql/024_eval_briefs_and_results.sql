-- 024_eval_briefs_and_results.sql
--
-- Persistent eval infrastructure: brief sets and per-beat results.
--
-- Replaces /tmp/salvatore-*-briefs.jsonl files and the practice of
-- running phase-c3-*.py against them. Moves the eval surface into the DB
-- so we can:
--   - query adapter leaderboards directly (SELECT avg(delta_sum) FROM
--     eval_results GROUP BY adapter_uri)
--   - track per-brief results across versions
--   - add new brief sets without shell-script file management
--   - join evals to tuning_experiments for full experiment lineage

CREATE TABLE IF NOT EXISTS eval_briefs (
  id          SERIAL PRIMARY KEY,
  set_name    TEXT NOT NULL,         -- e.g. 'salvatore-original-v1', 'salvatore-val-stratified-v1'
  beat_id     TEXT NOT NULL,         -- e.g. 'orig_tavern_ch1_s1_b0' (stable identifier)
  brief_json  JSONB NOT NULL,        -- full brief: characters, pov, setting, tone, kind, summary, words, etc.
  ground_truth_prose TEXT,           -- real corpus prose when available (val-mode evals)
  ground_truth_style JSONB,          -- precomputed style features on ground truth
  notes       TEXT,                  -- free-form context ("original-character probe, no Salvatore lore")
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(set_name, beat_id)
);

CREATE INDEX IF NOT EXISTS idx_eval_briefs_set ON eval_briefs(set_name);

CREATE TABLE IF NOT EXISTS eval_results (
  id            SERIAL PRIMARY KEY,
  experiment_id INT REFERENCES tuning_experiments(id),
  set_name      TEXT NOT NULL,       -- matches eval_briefs.set_name
  beat_id       TEXT NOT NULL,
  adapter_uri   TEXT NOT NULL,       -- full URI, e.g. wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v3
  cell_label    TEXT,                -- 'A-deepseek-bare' / 'B-deepseek-primer' / 'C-salvatore-lora-v3' etc.
  generated_prose TEXT,
  style_features  JSONB,             -- {avg_sentence_words, dialogue_ratio, clause_complexity, sensory_density}
  delta_sum       NUMERIC(8,4),
  ngram_jaccard_vs_gt NUMERIC(6,4),
  paragraph_breaks_count INT,
  word_count      INT,
  bridge_repeat_detected BOOLEAN,    -- set by post-hoc analysis scripts
  lore_leak_tokens TEXT[],           -- array of blocklisted tokens found in generated prose
  error_text      TEXT,              -- populated when the call errored
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eval_results_experiment ON eval_results(experiment_id);
CREATE INDEX IF NOT EXISTS idx_eval_results_set_adapter ON eval_results(set_name, adapter_uri);
CREATE INDEX IF NOT EXISTS idx_eval_results_adapter ON eval_results(adapter_uri);

COMMENT ON TABLE eval_briefs IS 'Versioned eval brief sets — primary source of truth for Phase C.3-style evals.';
COMMENT ON TABLE eval_results IS 'Per-beat eval results, joinable to tuning_experiments for lineage.';
