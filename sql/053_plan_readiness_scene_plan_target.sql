-- 053_plan_readiness_scene_plan_target.sql
--
-- Allow scene-first readiness/proposal surfaces to name scene-level planning
-- targets as scene_plan while preserving existing beat_plan rows as legacy
-- aliases.

ALTER TABLE plan_readiness_items
  DROP CONSTRAINT IF EXISTS plan_readiness_items_target_kind_check;

ALTER TABLE plan_readiness_items
  ADD CONSTRAINT plan_readiness_items_target_kind_check
  CHECK (target_kind IN ('chapter_outline', 'scene_plan', 'beat_plan'));
