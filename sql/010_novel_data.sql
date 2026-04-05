-- Migration 010: Move all per-novel data from SQLite to Postgres
-- Previously each novel had its own SQLite file at output/{novelId}/novel.db
-- Now all novel data lives in the central Postgres DB, partitioned by novel_id

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Core Novel Tables ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS novels (
  id              TEXT PRIMARY KEY,
  phase           TEXT NOT NULL DEFAULT 'concept',
  seed_json       JSONB NOT NULL,
  current_chapter INTEGER DEFAULT 1,
  total_chapters  INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS world_bibles (
  novel_id     TEXT PRIMARY KEY REFERENCES novels(id),
  content_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id           TEXT PRIMARY KEY,
  novel_id     TEXT NOT NULL REFERENCES novels(id),
  name         TEXT NOT NULL,
  profile_json JSONB NOT NULL
);
CREATE INDEX idx_characters_novel ON characters (novel_id);

CREATE TABLE IF NOT EXISTS story_spines (
  novel_id     TEXT PRIMARY KEY REFERENCES novels(id),
  content_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS chapter_outlines (
  novel_id       TEXT NOT NULL REFERENCES novels(id),
  chapter_number INTEGER NOT NULL,
  outline_json   JSONB NOT NULL,
  PRIMARY KEY (novel_id, chapter_number)
);

CREATE TABLE IF NOT EXISTS chapter_drafts (
  novel_id       TEXT NOT NULL REFERENCES novels(id),
  chapter_number INTEGER NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  prose          TEXT NOT NULL,
  word_count     INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'draft',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (novel_id, chapter_number, version)
);

-- ── Extraction Tables (with vector + full-text columns) ───────────────────

CREATE TABLE IF NOT EXISTS chapter_summaries (
  novel_id         TEXT NOT NULL REFERENCES novels(id),
  chapter_number   INTEGER NOT NULL,
  summary          TEXT NOT NULL,
  key_events_json  JSONB NOT NULL,
  emotional_state  TEXT NOT NULL DEFAULT '',
  open_threads_json JSONB NOT NULL DEFAULT '[]',
  embedding        vector(3072),
  tsv              tsvector,
  PRIMARY KEY (novel_id, chapter_number)
);

CREATE TABLE IF NOT EXISTS facts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  novel_id               TEXT NOT NULL REFERENCES novels(id),
  fact                   TEXT NOT NULL,
  category               TEXT NOT NULL,
  established_in_chapter INTEGER NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  embedding              vector(3072),
  tsv                    tsvector
);
CREATE INDEX idx_facts_novel ON facts (novel_id);
CREATE INDEX idx_facts_novel_chapter ON facts (novel_id, established_in_chapter);

CREATE TABLE IF NOT EXISTS character_states (
  novel_id       TEXT NOT NULL REFERENCES novels(id),
  character_id   TEXT NOT NULL,
  chapter_number INTEGER NOT NULL,
  state_json     JSONB NOT NULL,
  embedding      vector(3072),
  tsv            tsvector,
  PRIMARY KEY (novel_id, character_id, chapter_number)
);

CREATE TABLE IF NOT EXISTS issues (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  novel_id       TEXT NOT NULL REFERENCES novels(id),
  severity       TEXT NOT NULL,
  description    TEXT NOT NULL,
  chapter        INTEGER NOT NULL,
  conflicts_with TEXT,
  suggested_fix  TEXT,
  status         TEXT NOT NULL DEFAULT 'open',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_issues_novel ON issues (novel_id);
CREATE INDEX idx_issues_novel_status ON issues (novel_id, status);

CREATE TABLE IF NOT EXISTS validation_passes (
  novel_id       TEXT NOT NULL REFERENCES novels(id),
  pass_number    INTEGER NOT NULL,
  chapter_number INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  issues_found   INTEGER DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (novel_id, pass_number, chapter_number)
);

-- ── World Knowledge Graph ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS world_systems (
  id                  TEXT NOT NULL,
  novel_id            TEXT NOT NULL REFERENCES novels(id),
  name                TEXT NOT NULL,
  type                TEXT NOT NULL,
  description         TEXT NOT NULL,
  rules_json          JSONB NOT NULL DEFAULT '[]',
  manifestations_json JSONB NOT NULL DEFAULT '[]',
  vocabulary_json     JSONB NOT NULL DEFAULT '[]',
  constraints_json    JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (novel_id, id)
);

CREATE TABLE IF NOT EXISTS cultures (
  id                TEXT NOT NULL,
  novel_id          TEXT NOT NULL REFERENCES novels(id),
  name              TEXT NOT NULL,
  description       TEXT NOT NULL,
  values_json       JSONB NOT NULL DEFAULT '[]',
  taboos_json       JSONB NOT NULL DEFAULT '[]',
  speech_influences TEXT NOT NULL DEFAULT '',
  customs_json      JSONB NOT NULL DEFAULT '[]',
  system_views_json JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (novel_id, id)
);

CREATE TABLE IF NOT EXISTS character_cultures (
  novel_id     TEXT NOT NULL,
  character_id TEXT NOT NULL,
  culture_id   TEXT NOT NULL,
  relationship TEXT NOT NULL DEFAULT 'native',
  PRIMARY KEY (novel_id, character_id, culture_id)
);

CREATE TABLE IF NOT EXISTS character_system_awareness (
  novel_id            TEXT NOT NULL,
  character_id        TEXT NOT NULL,
  system_id           TEXT NOT NULL,
  awareness_level     TEXT NOT NULL DEFAULT 'ignorant',
  perspective         TEXT NOT NULL DEFAULT '',
  chapter_established INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (novel_id, character_id, system_id)
);

CREATE TABLE IF NOT EXISTS relationship_states (
  novel_id       TEXT NOT NULL REFERENCES novels(id),
  character_a    TEXT NOT NULL,
  character_b    TEXT NOT NULL,
  chapter_number INTEGER NOT NULL,
  trust_level    TEXT NOT NULL DEFAULT 'neutral',
  dynamic        TEXT NOT NULL,
  tension        TEXT NOT NULL DEFAULT '',
  recent_shift   TEXT NOT NULL DEFAULT '',
  embedding      vector(3072),
  tsv            tsvector,
  PRIMARY KEY (novel_id, character_a, character_b, chapter_number)
);

CREATE TABLE IF NOT EXISTS timeline_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  novel_id          TEXT NOT NULL REFERENCES novels(id),
  chapter_number    INTEGER NOT NULL,
  event             TEXT NOT NULL,
  location          TEXT NOT NULL DEFAULT '',
  participants_json JSONB NOT NULL DEFAULT '[]',
  witnesses_json    JSONB NOT NULL DEFAULT '[]',
  consequences      TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  embedding         vector(3072),
  tsv               tsvector
);
CREATE INDEX idx_timeline_novel ON timeline_events (novel_id);
CREATE INDEX idx_timeline_novel_chapter ON timeline_events (novel_id, chapter_number);

CREATE TABLE IF NOT EXISTS character_knowledge (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  novel_id            TEXT NOT NULL REFERENCES novels(id),
  character_id        TEXT NOT NULL,
  knowledge           TEXT NOT NULL,
  source              TEXT NOT NULL DEFAULT '',
  chapter_learned     INTEGER NOT NULL,
  category            TEXT NOT NULL DEFAULT 'event',
  is_false            BOOLEAN NOT NULL DEFAULT false,
  source_character_id TEXT,
  source_event_id     UUID,
  embedding           vector(3072),
  tsv                 tsvector
);
CREATE INDEX idx_knowledge_novel ON character_knowledge (novel_id);
CREATE INDEX idx_knowledge_novel_char ON character_knowledge (novel_id, character_id);
CREATE INDEX idx_knowledge_novel_chapter ON character_knowledge (novel_id, chapter_learned);

-- ── HNSW Vector Indexes (halfvec for >2000 dims) ─────────────────────────

CREATE INDEX idx_facts_embedding_hnsw ON facts
  USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 200);

CREATE INDEX idx_summaries_embedding_hnsw ON chapter_summaries
  USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 200);

CREATE INDEX idx_timeline_embedding_hnsw ON timeline_events
  USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 200);

CREATE INDEX idx_charstates_embedding_hnsw ON character_states
  USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 200);

CREATE INDEX idx_relationships_embedding_hnsw ON relationship_states
  USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 200);

CREATE INDEX idx_knowledge_embedding_hnsw ON character_knowledge
  USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
  WITH (m = 16, ef_construction = 200);

-- ── Full-Text Search Indexes ──────────────────────────────────────────────

CREATE INDEX idx_facts_tsv ON facts USING gin (tsv);
CREATE INDEX idx_summaries_tsv ON chapter_summaries USING gin (tsv);
CREATE INDEX idx_timeline_tsv ON timeline_events USING gin (tsv);
CREATE INDEX idx_charstates_tsv ON character_states USING gin (tsv);
CREATE INDEX idx_relationships_tsv ON relationship_states USING gin (tsv);
CREATE INDEX idx_knowledge_tsv ON character_knowledge USING gin (tsv);

-- ── tsvector Auto-Update Triggers ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION facts_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv := setweight(to_tsvector('english', coalesce(NEW.category, '')), 'B') ||
             setweight(to_tsvector('english', coalesce(NEW.fact, '')), 'A');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_facts_tsv
  BEFORE INSERT OR UPDATE OF fact, category ON facts
  FOR EACH ROW EXECUTE FUNCTION facts_tsv_trigger();

CREATE OR REPLACE FUNCTION summaries_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv := setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'A') ||
             setweight(to_tsvector('english', coalesce(NEW.emotional_state, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_summaries_tsv
  BEFORE INSERT OR UPDATE OF summary, emotional_state ON chapter_summaries
  FOR EACH ROW EXECUTE FUNCTION summaries_tsv_trigger();

CREATE OR REPLACE FUNCTION timeline_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv := setweight(to_tsvector('english', coalesce(NEW.event, '')), 'A') ||
             setweight(to_tsvector('english', coalesce(NEW.location, '')), 'B') ||
             setweight(to_tsvector('english', coalesce(NEW.consequences, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_timeline_tsv
  BEFORE INSERT OR UPDATE OF event, location, consequences ON timeline_events
  FOR EACH ROW EXECUTE FUNCTION timeline_tsv_trigger();

CREATE OR REPLACE FUNCTION charstates_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv := setweight(to_tsvector('english', coalesce(NEW.state_json::text, '')), 'A');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_charstates_tsv
  BEFORE INSERT OR UPDATE OF state_json ON character_states
  FOR EACH ROW EXECUTE FUNCTION charstates_tsv_trigger();

CREATE OR REPLACE FUNCTION relationships_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv := setweight(to_tsvector('english', coalesce(NEW.dynamic, '')), 'A') ||
             setweight(to_tsvector('english', coalesce(NEW.tension, '')), 'B') ||
             setweight(to_tsvector('english', coalesce(NEW.recent_shift, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_relationships_tsv
  BEFORE INSERT OR UPDATE OF dynamic, tension, recent_shift ON relationship_states
  FOR EACH ROW EXECUTE FUNCTION relationships_tsv_trigger();

CREATE OR REPLACE FUNCTION knowledge_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv := setweight(to_tsvector('english', coalesce(NEW.knowledge, '')), 'A') ||
             setweight(to_tsvector('english', coalesce(NEW.category, '')), 'B') ||
             setweight(to_tsvector('english', coalesce(NEW.source, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_knowledge_tsv
  BEFORE INSERT OR UPDATE OF knowledge, category, source ON character_knowledge
  FOR EACH ROW EXECUTE FUNCTION knowledge_tsv_trigger();
