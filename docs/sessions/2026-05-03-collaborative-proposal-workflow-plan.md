---
status: stopped
updated: 2026-05-03
role: design-session
session: 2026-05-03-collaborative-proposal-workflow-plan
charter: docs/charters/world-bible-architecture.md
design: docs/designs/collaborative-proposal-workflow.md
---

# Collaborative Proposal Workflow Plan

## Session-Start Contract

### 1. Goal + component

Produce a detailed implementation plan for a collaborative proposal workflow that unifies human-guided planning, Canon review, editorial edits, and autonomous mode policy.

### 2. Why

User direction after Step 2C: planner direct auto-commit evaluation is too likely to become a blocking rabbit hole, while collaborative ideation/editing with reliable mechanics and optional autonomy is the more useful product direction.

### 3. What is measurable

The plan works if it identifies existing surfaces, cleanly narrows semantics into explicit review proposals, defines incremental slices, and leaves enough implementation detail to open independently-grabbable lanes without a big-bang refactor.

### 4. Validated gates

- **(a) Clean pass:** design doc lands with concrete phases, invariants, acceptance gates, and references to current code surfaces.
- **(b) New dominant blocker:** if the design requires a generic proposal-table refactor before any user-visible value, stop and narrow to a tracer-bullet path.
- **(c) Regression:** docs contradict the world-bible charter or Step 2 evidence; correct before declaring done.
- **(d) Infrastructure failure:** not applicable; no runtime actions.
- **(e) Budget cap:** not applicable; no LLM/API calls planned.

## Results

Created `docs/designs/collaborative-proposal-workflow.md` as the working plan. The plan keeps mechanics deterministic, moves semantic choices into explicit review proposals, and lets manual/assisted/autonomous/eval modes share one workflow through approval policy.

## Evidence

- Existing planning surfaces inspected: `src/orchestrator/novel-routes.ts` director chat/compile and adjust endpoints, `ui/src/components/DirectorChat.tsx`, `ui/src/components/ArtifactPreviews.tsx` adjust panel.
- Existing Canon proposal substrate inspected: `src/canon/api.ts`, `src/harness/canon-substrate.ts`, `src/db/canon-substrate.ts` references.
- Output design doc: `docs/designs/collaborative-proposal-workflow.md`.

## Cost

No runtime cost.
