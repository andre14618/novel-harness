-- 027_adapter_registry.sql
--
-- Single row-per-adapter registry. Before this, "what's deployed and how was
-- it built" required grepping src/models/roles.ts + docs/adapter-changelog.md
-- + joining tuning_experiments by hand. Registry is the one-stop answer.
--
-- Row-level state:
--   status: deployed | candidate | retired | rejected
-- Provenance:
--   training_experiment_id → tuning_experiments.id
--   eval_experiment_ids    → array of eval experiments that measured it
-- Lineage:
--   supersedes → previous version's URI (null for v1)

CREATE TABLE IF NOT EXISTS adapter_registry (
  uri                    TEXT PRIMARY KEY,          -- full W&B artifact URI
  name                   TEXT NOT NULL,             -- e.g. hallucination-checker-v1
  slot                   TEXT,                      -- pipeline slot: adherence-events, chapter-plan-checker, writer/fantasy, tonal-pass, hallucination, etc. NULL for experimental
  base_model             TEXT,                      -- e.g. OpenPipe/Qwen3-14B-Instruct
  training_experiment_id INT REFERENCES tuning_experiments(id),
  eval_experiment_ids    INT[] DEFAULT '{}',
  status                 TEXT NOT NULL CHECK (status IN ('deployed', 'candidate', 'retired', 'rejected')),
  deployed_at            TIMESTAMPTZ,
  retired_at             TIMESTAMPTZ,
  headline_metrics       JSONB,                     -- checker: {precision, recall, f1, accuracy, latency_ms}; writer: {delta_sum, max_jaccard, paragraph_breaks}
  training_data_path     TEXT,
  training_data_sha256   TEXT,
  supersedes             TEXT REFERENCES adapter_registry(uri),
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adapter_registry_slot ON adapter_registry(slot) WHERE status = 'deployed';
CREATE INDEX IF NOT EXISTS idx_adapter_registry_status ON adapter_registry(status);
CREATE INDEX IF NOT EXISTS idx_adapter_registry_training_exp ON adapter_registry(training_experiment_id);

COMMENT ON TABLE adapter_registry IS
  'One row per LoRA adapter — serving slate + provenance + headline metrics. Queried by scripts/finetune/adapter-status.ts.';
COMMENT ON COLUMN adapter_registry.slot IS
  'Pipeline slot the adapter fills when deployed. Must match a key used in src/models/roles.ts for deployed rows.';
COMMENT ON COLUMN adapter_registry.supersedes IS
  'URI of the predecessor version — builds a linked list of adapter lineage without touching tuning_experiments.';

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION adapter_registry_touch_updated() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_adapter_registry_touch ON adapter_registry;
CREATE TRIGGER trg_adapter_registry_touch BEFORE UPDATE ON adapter_registry
  FOR EACH ROW EXECUTE FUNCTION adapter_registry_touch_updated();
