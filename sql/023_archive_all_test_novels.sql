-- 023_archive_all_test_novels.sql
--
-- Archive all 70 existing novels and their content. Per user directive
-- 2026-04-16: every novel generated to date was testing harness behavior,
-- not production. `public.novels` should contain only novels being actively
-- worked on; historical test runs muddy distributional queries and the
-- "what is the pipeline producing right now" signal.
--
-- Scope:
--   ARCHIVED wholesale (all rows): novels, chapter_drafts, chapter_outlines,
--   characters, world_bibles, story_spines, validation_passes
--   ARCHIVED all remaining rows: facts, character_states, relationship_states,
--   character_knowledge, timeline_events, event_causes, knowledge_propagation,
--   character_system_awareness, world_systems, cultures, character_cultures,
--   chapter_summaries, retrieval_config, deterministic_config
--     (these are novel-scoped state; after archiving all novels, they have
--      no valid parent)
--
-- NOT touched:
--   tuning_experiments + tuning_results + experiment_lineage (never delete)
--   llm_calls + pipeline_events (analytical telemetry, novel_id is plain text
--     not FK, so records survive novel archiving; they are the substrate for
--     "what is the current pipeline producing" analyses)
--   runs + run_agents (linked to experiments)
--
-- Append-only archive: migration 022 already created archive.* tables for
-- some of these. This migration inserts into the existing archive tables
-- (via CREATE TABLE IF NOT EXISTS then INSERT) to preserve all historical
-- data in one place.
--
-- FK ordering: content tables with novel_id FK go to archive before novels.

BEGIN;

-- ─── Move content tables first (novel_id FK dependents) ─────────────────

CREATE TABLE IF NOT EXISTS archive.chapter_drafts (LIKE public.chapter_drafts INCLUDING DEFAULTS);
INSERT INTO archive.chapter_drafts SELECT * FROM public.chapter_drafts;
DELETE FROM public.chapter_drafts;

CREATE TABLE IF NOT EXISTS archive.chapter_outlines (LIKE public.chapter_outlines INCLUDING DEFAULTS);
INSERT INTO archive.chapter_outlines SELECT * FROM public.chapter_outlines;
DELETE FROM public.chapter_outlines;

CREATE TABLE IF NOT EXISTS archive.characters (LIKE public.characters INCLUDING DEFAULTS);
INSERT INTO archive.characters SELECT * FROM public.characters;
DELETE FROM public.characters;

CREATE TABLE IF NOT EXISTS archive.world_bibles (LIKE public.world_bibles INCLUDING DEFAULTS);
INSERT INTO archive.world_bibles SELECT * FROM public.world_bibles;
DELETE FROM public.world_bibles;

CREATE TABLE IF NOT EXISTS archive.story_spines (LIKE public.story_spines INCLUDING DEFAULTS);
INSERT INTO archive.story_spines SELECT * FROM public.story_spines;
DELETE FROM public.story_spines;

CREATE TABLE IF NOT EXISTS archive.validation_passes (LIKE public.validation_passes INCLUDING DEFAULTS);
INSERT INTO archive.validation_passes SELECT * FROM public.validation_passes;
DELETE FROM public.validation_passes;

-- ─── Remaining state-table rows for post-cutoff novels ──────────────────

INSERT INTO archive.facts SELECT * FROM public.facts;
DELETE FROM public.facts;

INSERT INTO archive.character_states SELECT * FROM public.character_states;
DELETE FROM public.character_states;

INSERT INTO archive.relationship_states SELECT * FROM public.relationship_states;
DELETE FROM public.relationship_states;

-- event_causes + knowledge_propagation FK to timeline_events/character_knowledge → archive first
INSERT INTO archive.event_causes SELECT * FROM public.event_causes;
DELETE FROM public.event_causes;

INSERT INTO archive.knowledge_propagation SELECT * FROM public.knowledge_propagation;
DELETE FROM public.knowledge_propagation;

INSERT INTO archive.timeline_events SELECT * FROM public.timeline_events;
DELETE FROM public.timeline_events;

INSERT INTO archive.character_knowledge SELECT * FROM public.character_knowledge;
DELETE FROM public.character_knowledge;

-- character_cultures FK to cultures → archive first
INSERT INTO archive.character_cultures SELECT * FROM public.character_cultures;
DELETE FROM public.character_cultures;

INSERT INTO archive.cultures SELECT * FROM public.cultures;
DELETE FROM public.cultures;

-- character_system_awareness FK to world_systems → archive first
INSERT INTO archive.character_system_awareness SELECT * FROM public.character_system_awareness;
DELETE FROM public.character_system_awareness;

INSERT INTO archive.world_systems SELECT * FROM public.world_systems;
DELETE FROM public.world_systems;

INSERT INTO archive.chapter_summaries SELECT * FROM public.chapter_summaries;
DELETE FROM public.chapter_summaries;

-- retrieval_config + deterministic_config are per-novel config tables
CREATE TABLE IF NOT EXISTS archive.retrieval_config (LIKE public.retrieval_config INCLUDING DEFAULTS);
INSERT INTO archive.retrieval_config SELECT * FROM public.retrieval_config;
DELETE FROM public.retrieval_config;

CREATE TABLE IF NOT EXISTS archive.deterministic_config (LIKE public.deterministic_config INCLUDING DEFAULTS);
INSERT INTO archive.deterministic_config SELECT * FROM public.deterministic_config;
DELETE FROM public.deterministic_config;

-- ─── Finally, novels ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS archive.novels (LIKE public.novels INCLUDING DEFAULTS);
INSERT INTO archive.novels SELECT * FROM public.novels;
DELETE FROM public.novels;

COMMIT;

-- Reclaim space separately via VACUUM FULL (cannot run inside a transaction).
