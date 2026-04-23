-- 032_drift_checks.sql
--
-- Calibration-substrate drift detector telemetry.
--
-- One row per (run_id, adapter) per drift-detector invocation.
-- The detector replays checker adapters over frozen eval_results baselines
-- and emits a verdict: did the adapter's precision or F1 degrade beyond
-- the gate thresholds (>5pt precision OR >3pt F1)?
--
-- Frozen baseline comes from eval_results rows with a specific
-- frozen_run_id (experiment_id) — the eval run that established the
-- baseline metrics for that adapter.
--
-- See scripts/autonomous-loop/drift-detector.ts for the driver.
-- Part of the autonomous-harness-loop Phase 0 prerequisite #2.

CREATE TABLE IF NOT EXISTS drift_checks (
  id               SERIAL PRIMARY KEY,

  -- Identifies this invocation of the drift detector
  -- (a UUID or "YYYYMMDD-HHMMSS" string set once per run across all adapters)
  run_id           TEXT NOT NULL,

  -- Short name matching adapter_registry.name or the --adapters CLI arg
  adapter          TEXT NOT NULL,

  -- experiment_id of the frozen baseline rows in eval_results
  frozen_run_id    INT  REFERENCES tuning_experiments(id),

  -- Metrics from the frozen baseline (read from eval_results / adapter_registry)
  frozen_precision NUMERIC(6,4),
  frozen_recall    NUMERIC(6,4),
  frozen_f1        NUMERIC(6,4),

  -- Metrics from the current replay
  current_precision NUMERIC(6,4),
  current_recall    NUMERIC(6,4),
  current_f1        NUMERIC(6,4),

  -- Signed deltas: current − frozen (negative = regression)
  precision_delta  NUMERIC(6,4),
  recall_delta     NUMERIC(6,4),
  f1_delta         NUMERIC(6,4),

  -- Whether the gate thresholds fired:
  --   precision_delta < -0.05  (>5pt drop)
  --   OR f1_delta < -0.03      (>3pt drop)
  trips_gate       BOOLEAN NOT NULL DEFAULT FALSE,
  gate_reason      TEXT,           -- human-readable reason string when trips_gate = TRUE

  -- How many eval_briefs rows were replayed
  brief_count      INT,

  -- Error context (null on success)
  error_text       TEXT,

  ran_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drift_checks_run_id   ON drift_checks(run_id);
CREATE INDEX IF NOT EXISTS idx_drift_checks_adapter  ON drift_checks(adapter);
CREATE INDEX IF NOT EXISTS idx_drift_checks_ran_at   ON drift_checks(ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_drift_checks_trips     ON drift_checks(trips_gate) WHERE trips_gate = TRUE;

COMMENT ON TABLE drift_checks IS
  'Per-adapter drift detector verdicts. Populated by scripts/autonomous-loop/drift-detector.ts. '
  'trips_gate=TRUE opens Sub-loop 3 in the autonomous harness loop. '
  'Thresholds: precision_delta < -0.05 OR f1_delta < -0.03.';

COMMENT ON COLUMN drift_checks.run_id IS
  'UUID shared across all adapter rows from a single detector invocation.';
COMMENT ON COLUMN drift_checks.frozen_run_id IS
  'experiment_id of the eval_results rows that constitute the frozen baseline.';
COMMENT ON COLUMN drift_checks.trips_gate IS
  'TRUE when precision drops >5pt or F1 drops >3pt vs the frozen baseline. '
  'Triggers Sub-loop 3 (checker recalibration) in the autonomous harness loop.';
