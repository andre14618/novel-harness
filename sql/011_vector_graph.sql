-- Migration 011: Graph structures + retrieval config for semantic context engine

-- ── Causal Chains Between Events ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_causes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  novel_id            TEXT NOT NULL REFERENCES novels(id),
  cause_event_id      UUID NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  effect_event_id     UUID NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
  relationship        TEXT NOT NULL DEFAULT 'causes',
  confidence          REAL NOT NULL DEFAULT 1.0,
  chapter_established INTEGER NOT NULL,
  UNIQUE (novel_id, cause_event_id, effect_event_id)
);

CREATE INDEX idx_ec_novel ON event_causes (novel_id);
CREATE INDEX idx_ec_cause ON event_causes (novel_id, cause_event_id);
CREATE INDEX idx_ec_effect ON event_causes (novel_id, effect_event_id);

-- ── Knowledge Propagation Graph ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knowledge_propagation (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  novel_id            TEXT NOT NULL REFERENCES novels(id),
  knowledge_id        UUID NOT NULL REFERENCES character_knowledge(id) ON DELETE CASCADE,
  from_character_id   TEXT,
  to_character_id     TEXT NOT NULL,
  via_event_id        UUID REFERENCES timeline_events(id) ON DELETE SET NULL,
  propagation_type    TEXT NOT NULL,
  confidence          REAL NOT NULL DEFAULT 1.0,
  chapter_number      INTEGER NOT NULL,
  UNIQUE (novel_id, knowledge_id, to_character_id)
);

CREATE INDEX idx_kp_novel ON knowledge_propagation (novel_id);
CREATE INDEX idx_kp_knowledge ON knowledge_propagation (novel_id, knowledge_id);
CREATE INDEX idx_kp_to_char ON knowledge_propagation (novel_id, to_character_id);
CREATE INDEX idx_kp_from_char ON knowledge_propagation (novel_id, from_character_id);

-- ── Thematic Tags ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS thematic_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  novel_id    TEXT NOT NULL REFERENCES novels(id),
  source_type TEXT NOT NULL,
  source_id   UUID NOT NULL,
  theme       TEXT NOT NULL,
  UNIQUE (novel_id, source_type, source_id, theme)
);

CREATE INDEX idx_tt_novel_theme ON thematic_tags (novel_id, theme);
CREATE INDEX idx_tt_source ON thematic_tags (novel_id, source_type, source_id);

-- ── Tunable Retrieval Config ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS retrieval_config (
  novel_id            TEXT PRIMARY KEY REFERENCES novels(id),
  max_facts           INTEGER NOT NULL DEFAULT 40,
  max_events          INTEGER NOT NULL DEFAULT 15,
  max_summaries       INTEGER NOT NULL DEFAULT 8,
  max_states          INTEGER NOT NULL DEFAULT 10,
  max_relationships   INTEGER NOT NULL DEFAULT 10,
  max_knowledge       INTEGER NOT NULL DEFAULT 15,
  min_similarity      REAL NOT NULL DEFAULT 0.25,
  rrf_k               INTEGER NOT NULL DEFAULT 60,
  fetch_per_leg       INTEGER NOT NULL DEFAULT 30,
  character_boost     REAL NOT NULL DEFAULT 2.0,
  location_boost      REAL NOT NULL DEFAULT 1.5,
  recency_half_life   INTEGER NOT NULL DEFAULT 10,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
