-- 022_archive_stale_data.sql
--
-- Move pre-2026-04-15 telemetry and state-table data into an `archive` schema.
--
-- Cutoff rationale:
--   DeepSeek V3.2 + Howard primer was promoted to pipeline-wide default on
--   2026-04-15 (docs/decisions.md). Data created before that reflects a
--   materially different writer/context assembly and muddies calibration
--   for the current pipeline. Per user directive 2026-04-16: archive pre-
--   cutoff data out so future analyses and training-data mining see only
--   current-pipeline shape.
--
-- Scope:
--   ARCHIVED by timestamp (< 2026-04-15):
--     llm_calls, pipeline_events, issues, finetune_training_data
--   ARCHIVED by novel_id (novels created < 2026-04-15):
--     facts, timeline_events, event_causes, knowledge_propagation,
--     character_system_awareness, world_systems, cultures, character_cultures,
--     character_states, relationship_states, character_knowledge,
--     chapter_summaries
--   ARCHIVED wholesale (100% pre-cutoff):
--     batch_requests, pairwise_matchups, lint_issues, scores, generations
--
-- FK ordering note: deletion must happen leaves-first. All tables that FK
-- to generations (scores, lint_issues, pairwise_matchups, batch_requests)
-- get archived+deleted before generations itself. Similarly event_causes
-- and knowledge_propagation get archived before timeline_events and
-- character_knowledge.
--
-- NOT touched (kept in public):
--   tuning_experiments, tuning_results, experiment_lineage, runs, run_agents
--     (rule: never delete experiments)
--   novels, chapter_drafts, chapter_outlines, characters, world_bibles,
--     story_spines
--     (novel content — reader may reference historical novels)
--
-- Reversible: all archived rows live in archive.* schema. To restore:
-- INSERT INTO public.X SELECT * FROM archive.X WHERE ...

BEGIN;

CREATE SCHEMA IF NOT EXISTS archive;

CREATE TEMP TABLE _old_novels AS
  SELECT id FROM novels WHERE created_at < '2026-04-15';

-- ─── Telemetry (by timestamp) ────────────────────────────────────────────

CREATE TABLE archive.llm_calls AS
  SELECT * FROM llm_calls WHERE timestamp < '2026-04-15';
DELETE FROM llm_calls WHERE timestamp < '2026-04-15';

CREATE TABLE archive.pipeline_events AS
  SELECT * FROM pipeline_events WHERE timestamp < '2026-04-15';
DELETE FROM pipeline_events WHERE timestamp < '2026-04-15';

CREATE TABLE archive.issues AS
  SELECT * FROM issues WHERE created_at < '2026-04-15';
DELETE FROM issues WHERE created_at < '2026-04-15';

CREATE TABLE archive.finetune_training_data AS
  SELECT * FROM finetune_training_data WHERE created_at < '2026-04-15';
DELETE FROM finetune_training_data WHERE created_at < '2026-04-15';

-- ─── State tables (by pre-cutoff novel_id; FK leaves first) ──────────────

-- event_causes FKs to timeline_events → archive first
CREATE TABLE archive.event_causes AS
  SELECT * FROM event_causes WHERE novel_id IN (SELECT id FROM _old_novels);
DELETE FROM event_causes WHERE novel_id IN (SELECT id FROM _old_novels);

-- knowledge_propagation FKs to timeline_events + character_knowledge → archive first
CREATE TABLE archive.knowledge_propagation AS
  SELECT * FROM knowledge_propagation WHERE novel_id IN (SELECT id FROM _old_novels);
DELETE FROM knowledge_propagation WHERE novel_id IN (SELECT id FROM _old_novels);

-- Now safe to archive timeline_events + character_knowledge
CREATE TABLE archive.timeline_events AS
  SELECT * FROM timeline_events WHERE novel_id IN (SELECT id FROM _old_novels);
DELETE FROM timeline_events WHERE novel_id IN (SELECT id FROM _old_novels);

CREATE TABLE archive.character_knowledge AS
  SELECT * FROM character_knowledge WHERE novel_id IN (SELECT id FROM _old_novels);
DELETE FROM character_knowledge WHERE novel_id IN (SELECT id FROM _old_novels);

-- character_cultures FKs to cultures → archive first
CREATE TABLE archive.character_cultures AS
  SELECT * FROM character_cultures WHERE novel_id IN (SELECT id FROM _old_novels);
DELETE FROM character_cultures WHERE novel_id IN (SELECT id FROM _old_novels);

CREATE TABLE archive.cultures AS
  SELECT * FROM cultures WHERE novel_id IN (SELECT id FROM _old_novels);
DELETE FROM cultures WHERE novel_id IN (SELECT id FROM _old_novels);

-- character_system_awareness FKs to world_systems → archive first
CREATE TABLE archive.character_system_awareness AS
  SELECT * FROM character_system_awareness WHERE novel_id IN (SELECT id FROM _old_novels);
DELETE FROM character_system_awareness WHERE novel_id IN (SELECT id FROM _old_novels);

CREATE TABLE archive.world_systems AS
  SELECT * FROM world_systems WHERE novel_id IN (SELECT id FROM _old_novels);
DELETE FROM world_systems WHERE novel_id IN (SELECT id FROM _old_novels);

-- Remaining state tables (no intra-group FKs)
CREATE TABLE archive.character_states AS
  SELECT * FROM character_states WHERE novel_id IN (SELECT id FROM _old_novels);
DELETE FROM character_states WHERE novel_id IN (SELECT id FROM _old_novels);

CREATE TABLE archive.relationship_states AS
  SELECT * FROM relationship_states WHERE novel_id IN (SELECT id FROM _old_novels);
DELETE FROM relationship_states WHERE novel_id IN (SELECT id FROM _old_novels);

CREATE TABLE archive.facts AS
  SELECT * FROM facts WHERE novel_id IN (SELECT id FROM _old_novels);
DELETE FROM facts WHERE novel_id IN (SELECT id FROM _old_novels);

CREATE TABLE archive.chapter_summaries AS
  SELECT * FROM chapter_summaries WHERE novel_id IN (SELECT id FROM _old_novels);
DELETE FROM chapter_summaries WHERE novel_id IN (SELECT id FROM _old_novels);

-- ─── Wholesale (FK leaves → generations last) ────────────────────────────

CREATE TABLE archive.batch_requests AS SELECT * FROM batch_requests;
DELETE FROM batch_requests;

CREATE TABLE archive.pairwise_matchups AS SELECT * FROM pairwise_matchups;
DELETE FROM pairwise_matchups;

CREATE TABLE archive.lint_issues AS SELECT * FROM lint_issues;
DELETE FROM lint_issues;

CREATE TABLE archive.scores AS SELECT * FROM scores;
DELETE FROM scores;

CREATE TABLE archive.generations AS SELECT * FROM generations;
DELETE FROM generations;

COMMIT;

-- Reclaim space (run VACUUM FULL separately; cannot run inside a transaction).
