-- Shared batch orchestration state.
-- Local machine writes jobs here, LXC orchestrator polls + collects results.

CREATE TABLE orchestrator_batches (
  id                SERIAL PRIMARY KEY,
  provider          TEXT NOT NULL DEFAULT 'openai',
  provider_batch_id TEXT,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'submitted',
  request_count     INTEGER NOT NULL DEFAULT 0,
  completed_count   INTEGER NOT NULL DEFAULT 0,
  failed_count      INTEGER NOT NULL DEFAULT 0,
  error             TEXT,
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  last_polled_at    TIMESTAMPTZ,
  imported_at       TIMESTAMPTZ,        -- set when local machine imports results
  -- Link back to local harness SQLite
  local_run_id      INTEGER,
  local_batch_id    INTEGER,
  judge_model       TEXT
);

CREATE TABLE orchestrator_requests (
  id                SERIAL PRIMARY KEY,
  batch_id          INTEGER NOT NULL REFERENCES orchestrator_batches(id) ON DELETE CASCADE,
  custom_id         TEXT NOT NULL,
  generation_id     INTEGER NOT NULL,   -- local generation_id in harness SQLite
  dimension         TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  content           TEXT,               -- raw LLM response JSON
  error             TEXT,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER
);

CREATE TABLE orchestrator_state (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_poll_at    TIMESTAMPTZ,
  total_polls     INTEGER NOT NULL DEFAULT 0,
  total_collected INTEGER NOT NULL DEFAULT 0
);
INSERT INTO orchestrator_state (id) VALUES (1);

CREATE INDEX idx_ob_active ON orchestrator_batches (status)
  WHERE status NOT IN ('completed', 'failed', 'expired', 'cancelled');
CREATE INDEX idx_or_batch ON orchestrator_requests (batch_id);
CREATE INDEX idx_or_custom_id ON orchestrator_requests (custom_id);
