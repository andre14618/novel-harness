-- 055_plan_readiness_beat_obligation_target.sql
-- Allow Plan Readiness items to target a single obligation when a diagnostic is
-- narrower than the containing scene plan.

ALTER TABLE plan_readiness_items
  DROP CONSTRAINT IF EXISTS plan_readiness_items_target_kind_check;

ALTER TABLE plan_readiness_items
  ADD CONSTRAINT plan_readiness_items_target_kind_check
  CHECK (target_kind IN ('chapter_outline', 'scene_plan', 'beat_plan', 'beat_obligation'));
