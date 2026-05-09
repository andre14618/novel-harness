# 2026-05-09 Scene Plan Target Naming Sweep

## Summary

The scene-first naming slice is closed for public evidence surfaces. Planning
target evidence should now present scene-level plan targets as `scene_plan`.
The legacy `beat_plan` name remains accepted where it protects already-stored
proposal envelopes, structural action compatibility, and historical outline
storage.

## Changed

- `a8a36c8` normalized planning/readiness, traceability, chapter-health, and
  proposal target evidence toward `scene_plan`.
- `2f44fbe` extended the Plan Readiness data-loop evidence and focused tests so
  scene-plan target refs are visible in reports and proposal lineage.
- Comments/tests that describe the public target shape now prefer `scene_plan`
  and call out `beat_plan` as a legacy fallback.

## Boundary

- Do not remove persisted `beatId`, `SceneBeat`, `ChapterOutline.scenes`, or
  structural action names in this lane.
- Do not rename legacy storage columns or action payloads without a dedicated
  migration and compatibility plan.
- New user-facing/readiness/reporting target labels should use `scene_plan`
  unless they are explicitly documenting legacy data.

## Verification Notes

- Fast/unit, focused scene-plan readiness, typecheck, and docs-weight gates
  were green before this closure sweep.
- The DB-backed planning proposal smoke has a scene-plan replacement case, but
  the local run skipped because the DB was unreachable. Treat that as a DB
  environment gap, not a failed code path.

## Remaining

The next implementation lane should continue the run/thread lineage work or the
planner-quality methodology work. Broad UI work and broad beat-to-scene renames
remain lower priority unless a specific surface changes.
