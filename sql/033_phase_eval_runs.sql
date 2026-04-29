-- 033_phase_eval_runs.sql
--
-- Append-only mirror of `scripts/phase-eval/probe-planning-beats.ts` runs.
-- One row per probe invocation that was launched with `--persist`.
--
-- Designed per docs/designs/eval-testing-module-v1.md (R6) — the probe
-- stays the source of truth, this table is just a queryable mirror of
-- its summary + verdict so future Andre can answer "what was loud
-- variant's facts_median on the 2026-04-29 run?" without re-reading
-- commit logs and re-running scripts.
--
-- NO normalization of metrics into per-(run, metric) rows; NO per-cell
-- breakdown; NO suite registry. Those v2 shapes are explicitly deferred
-- behind the R6 §0 promotion-gate triggers (second probe, autonomous-
-- loop snapshot need, JSONB ergonomics breakdown, LLM-judge consumer).

CREATE TABLE IF NOT EXISTS phase_eval_runs (
  id                  SERIAL PRIMARY KEY,

  -- The probe's logical name. Today: 'phase-variant-comparison'. If a
  -- second probe shape ships with a different verdict contract, it
  -- picks a different probe_name (e.g. 'chapter-plan-screen').
  probe_name          TEXT NOT NULL,

  -- Captured at probe entry via `git rev-parse HEAD`. Code-identity
  -- provenance — two runs at different commits may produce different
  -- metric values; the row pins both to the row.
  git_commit          TEXT NOT NULL,

  -- Optional FK to the tuning_experiments row this run is part of.
  -- NULL when the probe runs ad-hoc without an experiment id.
  experiment_id       INT REFERENCES tuning_experiments(id),

  -- The seeds used in this probe run. For phase-variant-comparison
  -- this is a single-element array today (e.g. {fantasy-system-heretic}).
  seeds_used          TEXT[] NOT NULL,

  -- Variant labels used. Today: {default, loud}. Stored as a TEXT[]
  -- so cheap "which variants did this run cover" queries don't need
  -- JSONB extraction.
  variant_labels      TEXT[] NOT NULL,

  -- The probe's summary.json (paths to per-variant outlines.json) PLUS
  -- the computed g_metrics block from print-screen-verdict.ts. v1
  -- readers tolerate additive fields — when the probe gains a new
  -- metric or a new top-level field, old readers should silently skip
  -- the unknown keys.
  summary_json        JSONB NOT NULL,

  -- The verdict line from print-screen-verdict.ts. Today one of:
  --   'SCREEN-PASS'
  --   'SCREEN-FAIL (broken)'
  --   'SCREEN-FAIL (non-compliant)'
  -- Stored as free-text TEXT (not enum) so the probe's verdict
  -- contract can evolve without a migration.
  verdict             TEXT NOT NULL,

  ran_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Free-text notes the operator can pass via --note='...'. NULL if
  -- not provided. Useful for ad-hoc context ("first run after V4 Flash
  -- swap" etc.).
  notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_phase_eval_runs_probe ON phase_eval_runs(probe_name);
CREATE INDEX IF NOT EXISTS idx_phase_eval_runs_exp ON phase_eval_runs(experiment_id);
CREATE INDEX IF NOT EXISTS idx_phase_eval_runs_ran ON phase_eval_runs(ran_at DESC);
