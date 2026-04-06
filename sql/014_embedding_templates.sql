-- Migration 014: Embedding templates in DB
-- Moves hardcoded text templates to a tunable table so the autoresearcher can optimize them.
-- Templates use {placeholder} syntax interpolated at runtime.

CREATE TABLE IF NOT EXISTS embedding_templates (
  source_type   TEXT PRIMARY KEY, -- fact, event, summary, char_state, relationship, knowledge
  template      TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with current hardcoded templates
INSERT INTO embedding_templates (source_type, template) VALUES
  ('fact',         '[{category}] {fact}'),
  ('event',        '{event}. at {location}. Participants: {participants}. Consequences: {consequences}'),
  ('summary',      'Chapter {chapterNum}: {summary}. Key events: {keyEvents}. Emotional state: {emotionalState}'),
  ('char_state',   '{name} in {location}: {emotionalState}. Knows: {knows}. Doesn''t know: {doesNotKnow}'),
  ('relationship', '{charA} and {charB}: [{trustLevel}] {dynamic}. Tension: {tension}. Shift: {recentShift}'),
  ('knowledge',    '{characterName} {source} that {knowledge}{isFalseTag}')
ON CONFLICT (source_type) DO NOTHING;
