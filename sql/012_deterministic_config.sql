-- Migration 012: Deterministic pre-processing config
-- Tunable thresholds for heuristic graph linking, knowledge propagation, and theme tagging.
-- Each parameter is independently adjustable by the autoresearcher.

CREATE TABLE IF NOT EXISTS deterministic_config (
  novel_id                    TEXT PRIMARY KEY REFERENCES novels(id),

  -- Theme tagging (embedding similarity thresholds)
  theme_auto_threshold        REAL NOT NULL DEFAULT 0.5,
  theme_candidate_threshold   REAL NOT NULL DEFAULT 0.3,

  -- Causal link scoring weights (must sum to ~1.0 for interpretability)
  causal_participant_weight   REAL NOT NULL DEFAULT 0.4,
  causal_location_weight      REAL NOT NULL DEFAULT 0.2,
  causal_temporal_weight      REAL NOT NULL DEFAULT 0.15,
  causal_consequence_weight   REAL NOT NULL DEFAULT 0.25,

  -- Causal link acceptance thresholds
  causal_auto_threshold       REAL NOT NULL DEFAULT 0.85,
  causal_candidate_threshold  REAL NOT NULL DEFAULT 0.5,

  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
