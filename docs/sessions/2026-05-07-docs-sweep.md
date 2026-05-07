---
status: active
updated: 2026-05-07
role: session-record
---

# Docs Sweep

## Scope

Active documentation only: current state, decision index/details, lane queue,
todo, current how-tos, and the authoring refinement plan. Archived docs were
left untouched unless directly referenced by active files.

## Findings

- L086 still read as if calibrated obligation packing were the next planning
  lever, even though L088 superseded it as the product direction.
- `docs/how-to/semantic-gate-experiments.md` still told agents to run the next
  experiment as control/hard-caps/calibrated-packing, which could steer future
  work back into a known wrong layer.
- Current state mentioned semantic-gate diagnostics but not the new
  planner-quality report surface.

## Changes

- Marked L086 as superseded by L088 while preserving the cohort evidence.
- Updated the decision index so L088 is the active direction and L086 is
  historical diagnostic evidence.
- Updated the semantic-gate experiment how-to: hard caps and
  `calibrated:packed` are diagnostic-only; product-relevant experiments now
  belong upstream in concept/planning and must score endpoint landing,
  character materiality, obligation health, drafting length, and semantic
  stability.
- Updated the authoring refinement plan to record the planner-quality lesson:
  beat count is not the target by itself; semantic allocation is.
- Updated current state to include planner-quality reports as part of the
  authoring diagnostics surface.

## Verification

Passed after edits:

```bash
bun run docs:weight
git diff --check
```
