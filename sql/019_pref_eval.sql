-- Pairwise preference ratings for LLM output comparison
-- Used to generate DPO training pairs from human preference data

CREATE TABLE IF NOT EXISTS pref_eval (
  id              SERIAL PRIMARY KEY,
  eval_name       TEXT        NOT NULL,
  paragraph_index INTEGER     NOT NULL,
  input_text      TEXT        NOT NULL,
  chosen_text     TEXT        NOT NULL,
  rejected_text   TEXT        NOT NULL,
  chosen_model    TEXT        NOT NULL,
  rejected_model  TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (eval_name, paragraph_index)
);

CREATE INDEX IF NOT EXISTS pref_eval_name_idx ON pref_eval (eval_name);
