-- Autonomous improvement cycle tracking + budget management.
-- The daemon runs improvement iterations, tracks results here.

CREATE TABLE improvement_cycles (
  id              SERIAL PRIMARY KEY,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'active',   -- active, completed, failed, budget-exhausted
  trigger_type    TEXT NOT NULL,                     -- scheduled, event, manual
  total_iterations INTEGER NOT NULL DEFAULT 0,
  kept_count      INTEGER NOT NULL DEFAULT 0,
  total_cost_usd  NUMERIC(8,4) NOT NULL DEFAULT 0,
  summary         TEXT
);

CREATE TABLE improvement_iterations (
  id              SERIAL PRIMARY KEY,
  cycle_id        INTEGER NOT NULL REFERENCES improvement_cycles(id),
  iteration_num   INTEGER NOT NULL,
  target          TEXT NOT NULL,           -- prose, planning, extraction, continuity
  dimension       TEXT NOT NULL,
  phase           TEXT NOT NULL DEFAULT 'proposing',
  baseline_score  NUMERIC(6,2),
  new_score       NUMERIC(6,2),
  delta           NUMERIC(6,2),
  result          TEXT,                    -- kept, reverted, failed, no-proposal
  proposal_explanation TEXT,
  agent_name      TEXT,
  file_path       TEXT,
  batch_id        INTEGER,
  run_id          INTEGER,
  cost_usd        NUMERIC(8,4) NOT NULL DEFAULT 0,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  backup_content  TEXT                     -- original file content for revert
);

CREATE TABLE budget_tracker (
  id              SERIAL PRIMARY KEY,
  period_date     DATE NOT NULL UNIQUE DEFAULT CURRENT_DATE,
  spent_usd       NUMERIC(8,4) NOT NULL DEFAULT 0,
  budget_usd      NUMERIC(8,4) NOT NULL DEFAULT 0.80,
  iteration_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_ic_active ON improvement_cycles (status) WHERE status = 'active';
CREATE INDEX idx_ii_cycle ON improvement_iterations (cycle_id);
CREATE INDEX idx_ii_phase ON improvement_iterations (phase) WHERE phase NOT IN ('done');
CREATE INDEX idx_bt_date ON budget_tracker (period_date);
