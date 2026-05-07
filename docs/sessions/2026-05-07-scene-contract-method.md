---
status: active
updated: 2026-05-07
role: session-record
---

# Scene Contract Method

## Decision Capture

The user identified that if Novel Harness stops planning and writing to beats,
then beat-level adherence is no longer the right primary checker contract. The
methodology should not keep old beat IDs as the load-bearing assertion surface
if scenes become the unit of planning and prose generation.

## Method Shape

- `sceneId` should become the candidate primary unit for planning, writing,
  prose spans, checking, and revision.
- `obligationId` and `sourceId` should become the durable traceability units
  inside a scene.
- `characterId`, `worldFactId`, `structureSlotId`, and future story-debt refs
  explain why obligations exist.
- `beatId` should be legacy compatibility or an optional internal planning
  hint under scene-first methodology, not the primary future contract.

## Adherence Implication

Scene-first adherence should ask:

- Does the scene satisfy its goal/conflict/outcome contract?
- Does it cover required obligations and source refs?
- Does it preserve required character/world/state changes?
- Does the scene outcome land?

It should not ask whether `beat 3` appeared exactly as `beat 3` unless that
specific experiment still plans and writes at beat granularity.

## Next Documentation Impact

`docs/authoring-methodology-hypotheses.md` H2 now frames scene as the
plan/write/adherence unit and moves beat IDs to legacy/internal status for new
methodology work.
