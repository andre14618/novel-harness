---
status: cleared
updated: 2026-05-03
role: lane
session: 2026-05-03-collaborative-proposal-workflow-phase-1-5-autowire
charter: docs/charters/world-bible-architecture.md
design: docs/designs/collaborative-proposal-workflow.md
parent-lane: docs/sessions/2026-05-03-collaborative-proposal-workflow-phase-1.md
---

# Lane — Phase 1.5 Auto-Wire: Planner → Proposals at Planning Phase Boundary

## Session-Start Contract

### 1. Goal + component

Auto-fire `generatePlannerCanonProposals` at the end of the planning phase
so the operator-review queue exists by default after planning, without
requiring a manual `POST /api/novel/:id/canon-proposals/generate-from-outline`
call.

Component scope:

- `src/harness/planner-canon-proposals.ts` — new helper
  `autogenPlannerProposalsAfterPlanning(novelId, outlines)` that wraps
  `generatePlannerCanonProposals` with error-swallowing semantics
  (returns counts, never throws). Wraps so the planning phase can call it
  without try/catch boilerplate and without risking that a transient DB
  blip blocks the planning → drafting transition.
- `src/phases/planning.ts` — call the helper after `saveChapterOutline`
  + `updateTotalChapters`, before the "Planning phase complete → drafting"
  log. Log success/failure summary to the novel-run log.
- `src/harness/planner-canon-proposals.test.ts` — extend with 3 helper-
  level tests (clean / broken-graph / empty-outlines).

No-ghost-canon means pending proposals are invisible to canon reads, so
this does NOT change drafting behavior. The only new effect is: every
planning-phase exit produces a pending review queue.

### 2. Why

Phase 2A (commit `9cf6238`) shipped a `POST .../generate-from-outline`
endpoint that operators must call manually. Phase 2A telemetry (`1bec94e`)
shipped lifecycle events. Auto-wiring closes the last gap: operators don't
have to know to call the endpoint. After planning completes, pending
proposals are already in `canon_proposals`; the Studio review UI (Phase 2B)
will surface them automatically.

Idempotency is load-bearing here: planning may be re-run after a `reject`
decision at the outline-approval gate. Phase 1's deterministic id +
`ON CONFLICT DO NOTHING` makes the auto-wire safe across replanning.

### 3. What is measurable

- 3 new helper tests pass.
- Existing canon + harness + orchestrator suites stay green.
- `bunx tsc --noEmit` clean.
- `bun scripts/audits/run-salvatore-recall.ts` — gate clear, recall ≥ 0.92.
- The planning-phase tsc still compiles (the new import + call path are
  type-checked).

### 4. Validated gates

- **(a) Clean pass:** helper ships; tests green; planning.ts hook
  compiles; no canon regressions.
- **(b) New dominant blocker:** if a real production planning re-run
  surfaces an error path I missed (e.g., outlines fetched are
  schema-stale), bail and add the right schema-validation guard before
  shipping. Working hypothesis: the helper just calls
  `generatePlannerCanonProposals(novelId, outlines)` with the same
  outlines the test suite has been hammering all session — no new schema
  surface.
- **(c) Regression:** existing canon tests fail. Stop, fix, re-verify.
- **(d) Infrastructure failure:** auto-wire failure is intentionally
  non-fatal. The helper swallows DB errors; planning still advances.
- **(e) Budget cap:** $0; local DB only.

### 5. Cost-threshold autonomy

Local code + tests; no LXC deploy unless the user explicitly asks. Per
CLAUDE.md §"Cost-threshold autonomy", proceed.

## Command Plan

1. Add `autogenPlannerProposalsAfterPlanning` to
   `src/harness/planner-canon-proposals.ts` — wraps `generatePlannerCanonProposals`,
   never throws, returns counts.
2. Hook the helper into `runPlanningPhase` in `src/phases/planning.ts`
   after `saveChapterOutline` + `updateTotalChapters`.
3. Add 3 helper-level tests to
   `src/harness/planner-canon-proposals.test.ts`.
4. Verify: bun test src/canon/ + src/harness/ +
   src/orchestrator/canon-proposal-routes.test.ts + tsc + recall.
5. Docs sweep: this lane doc, decisions entry, current-state amendment,
   lane-queue advance.

## Results

Phase 1.5 auto-wire cleared. The planning phase now auto-fires
`generatePlannerCanonProposals` after outlines are saved and the total-
chapters count is updated. Errors are logged but never block the
planning → drafting transition. Idempotent on replanning.

Helper API:

```ts
autogenPlannerProposalsAfterPlanning(
  novelId: string,
  outlines: readonly ChapterOutline[],
): Promise<{
  created: number
  skipped: number
  gateClear: boolean
  error: string | null
}>
```

The planning-phase log captures one of three outcomes: clean
(`auto-canon-proposals: N created / M already existed`), gate-refused
(`mechanical gate refused; 0 proposals written`), or error
(`auto-canon-proposals failed: <message>`).

## Stop gate fired

Gate (a) — clean pass. 3 new helper tests, full sweep stays green
(275-test sweep), tsc clean, recall holds.

## Evidence

- `bun test src/harness/planner-canon-proposals.test.ts` — **21/21 pass / 454 expects**
  (was 18; +3 helper tests for autogen).
- `bun test src/canon/ src/harness/ src/orchestrator/canon-proposal-routes.test.ts` — **275/275 pass / 1,462 expects**.
- `bunx tsc --noEmit` — clean.
- `bun scripts/audits/run-salvatore-recall.ts` — `meanRecall=0.927, recallGateClear=YES`.
- Commit SHA: filled by commit step.

## Cost

| line | spend |
|---|---|
| (no LLM/API calls — local only) | 0 |
| **total** | **0** |

## Commits

(to be filled)
