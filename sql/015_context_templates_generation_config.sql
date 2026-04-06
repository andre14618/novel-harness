-- Migration 015: Context templates + agent generation config
--
-- context_templates: tunable text formats used in writer context assembly.
-- Scene query determines what gets retrieved. Per-item formats control how
-- the writer sees facts, events, knowledge. All autoresearcher-tunable.
--
-- agent_generation_config: per-agent temperature and maxTokens overrides.
-- Autoresearcher can tune these to balance creativity vs precision per agent.

-- ── Context Templates ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS context_templates (
  key         TEXT PRIMARY KEY,
  template    TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO context_templates (key, template, description) VALUES
  ('scene_query',
   '{pov} in {setting}. {purpose}. {beats}',
   'Embedded as the search query for hybrid RRF retrieval across all 6 tables'),
  ('fact_line',
   'ch{chapter}: [{category}] {fact}',
   'How each fact appears in the ESTABLISHED FACTS context section'),
  ('event_line',
   'Ch{chapter}: {event} → {consequences}',
   'How each event appears in the RELEVANT EVENTS context section'),
  ('causal_chain',
   'Caused by: {chain}',
   'How causal backtrace is appended to events. {chain} is " ← "-joined events'),
  ('summary_line',
   'Chapter {chapter}: {summary}\n   Emotional throughline: {emotionalState}',
   'How each chapter summary appears in RELEVANT PRIOR CHAPTERS'),
  ('knowledge_line',
   '{knowledge} ({source}ch{chapter})',
   'How each knowledge entry appears in WHAT POV KNOWS'),
  ('section_facts',
   'ESTABLISHED FACTS ({count} most relevant):',
   'Header for the facts section'),
  ('section_events',
   'RELEVANT EVENTS:',
   'Header for the events section'),
  ('section_summaries',
   'RELEVANT PRIOR CHAPTERS:',
   'Header for the summaries section'),
  ('section_knowledge',
   'WHAT {povName} KNOWS:',
   'Header for the knowledge section'),
  ('section_threads',
   'OPEN THREADS:',
   'Header for the open threads section'),
  ('section_issues',
   'ISSUES TO ADDRESS:',
   'Header for the issues section')
ON CONFLICT (key) DO NOTHING;

-- ── Agent Generation Config ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_generation_config (
  agent_name  TEXT PRIMARY KEY,
  temperature REAL,
  max_tokens  INTEGER,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with current values from roles.ts (only agents where tuning matters)
INSERT INTO agent_generation_config (agent_name, temperature, max_tokens) VALUES
  ('writer',               0.8,  8000),
  ('rewriter',             0.5,  8000),
  ('planning-plotter',     0.6,  8192),
  ('fact-extractor',       0.1,  8192),
  ('summary-extractor',    0.2,  8192),
  ('character-state',      0.1,  8192),
  ('relationship-timeline', 0.2, 8192),
  ('graph-linker',         0.2,  4096)
ON CONFLICT (agent_name) DO NOTHING;
