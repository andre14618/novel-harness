---
status: active
date: 2026-05-09
role: decision-record
---

# L098: Scene Satisfaction Diagnostic — Wiring Shipped, LLM Judge Deferred

## Decision

Ship the structural wiring for scene-satisfaction diagnostic findings: optional `obligationIds` on `ChapterPlanDeviation` and `ValidationFinding`, a new `sceneSatisfactionCheckerV1` flag, and an obligation-aware routing helper in `validation-routing` that closes the silent-no-op risk where a scene-keyed finding without `beatIndex` would default to beat 0. The LLM-backed scene-satisfaction judge + parity panel — the diagnostic surface that would consume this wiring — is **explicitly deferred** to a Slice 3.5 follow-up so the load-bearing routing fix can ship without scope creep.

This decision keeps L092's "do not promote POC scene-satisfaction behavior into production runtime yet" non-goal **fully in place** for blocker promotion. Slice 3 adds the structural surface; promotion of any scene-satisfaction signal to a blocker remains contingent on parity-panel evidence.

## Changed Layer

Schema (additive optional field on `ChapterPlanDeviation` + `ValidationFinding`), pipeline flag, validation-routing helper. Default flag state is off; legacy callers see byte-identical behavior. The forward-looking surface lets future scene-satisfaction work attach exact obligation refs to findings without hitting the silent-no-op routing bug.

## Exact Change

Already committed at `01bef1f`:

- `src/config/pipeline.ts` — adds `sceneSatisfactionCheckerV1: false` default + `resolveSceneSatisfactionCheckerV1` resolver helper.
- `src/types.ts` — extends `ValidationFinding` with optional `obligationIds: string[]`; extends `SeedInput.pipelineOverrides` with optional `sceneSatisfactionCheckerV1`.
- `src/agents/chapter-plan-checker/schema.ts` — extends `ChapterPlanDeviation` with optional `obligationIds: string[]`; the Zod schema accepts the new field as `z.array(z.string().min(1)).optional()` so legacy deviations round-trip and empty-string entries are rejected.
- `src/phases/validation-routing.ts` — adds `findEntryByObligationIds(outline, obligationIds)` deterministic helper; `routeValidationFindings` now prefers obligation-ID lookup when a finding has no `beatIndex` and carries `obligationIds`. Falls through to the legacy `code`-switch + beat-0 default only when neither `beatIndex` nor a matching obligation is present. Closes the silent-no-op risk where a future scene-keyed finding would silently route to beat 0 and the rewrite would hit the wrong entry.
- Tests:
  - `src/phases/validation-routing.test.ts` — covers (a) obligation-keyed routing to the matching entry, not beat-0; (b) `beatIndex` wins when both refs are present; (c) unknown obligationId falls through to legacy default.
  - `src/agents/chapter-plan-checker/schema.test.ts` — covers the new optional `obligationIds` field accepting populated arrays, preserving legacy deviations without the field, and rejecting empty-string entries.

## Expected Benefit

Two concrete benefits independent of the deferred LLM judge:

- **Closes a real silent-no-op bug.** The original `validation-routing.ts:42-46` default routed every finding without `beatIndex` to beat 0 with a generic prefix. A scene-keyed finding from any future obligation-aware checker would have hit the wrong entry. The fix routes deterministically to the entry whose obligations include the matching ID; only generic findings without any ref still hit the beat-0 default.
- **Provides the surface the LLM judge will consume.** When Slice 3.5 ships the scene-satisfaction LLM judge, it can emit findings with `obligationIds` set and trust the routing infrastructure already exists.

## Evidence

Local verification:

- `bun test src/agents/chapter-plan-checker/schema.test.ts src/phases/validation-routing.test.ts` — 12 tests passing, 21 expect calls.
- `bun run test:fast` — full fast tier passes (1900+ tests). No existing test broke.
- `./node_modules/.bin/tsc --noEmit` — clean.
- `bun run test:replay` — `phase-parity-smoke` byte-parity green (1 pass / 1 skip / 0 fail) — confirms off-flag byte parity.

POC ancestry — for reference when Slice 3.5 builds the judge:

- POC narrow scene-semantic judge: `scripts/evals/corpus-recreation-semantic-review.ts`. Six dimensions: `sceneDramaturgy`, `threadProgression`, `promisePayoff`, `motivationSpecificity`, `worldFactPressure`, `relationshipDelta`. 1-5 ordinal labels, evidence-first mode, applicability skips by exact ID.
- POC scene-shape contract checks: `scripts/evals/corpus-recreation-poc.ts:748-1034` (`assessSceneContract`).

## Deferred LXC Evidence — Explicit

The original Slice 3 plan named two diagnostic deliverables that are not in this commit:

1. **`scripts/evals/scene-semantic-review.ts`** — port the POC narrow scene-semantic LLM judge to a replay-only harness that runs against persisted production drafts. Six narrow LLM calls per scene; persists via `eval_briefs` + `eval_results` with `set_name='scene-semantic-review:<date>'`.
2. **`scripts/evals/scene-checker-parity-panel.ts`** — paired-replay harness that runs the same drafts through both today's beat-level chapter-plan-checker and the new scene-satisfaction prompt; emits an agreement matrix to `output/scene-checker-parity/<date>/`.

Both are diagnostic-only by design and require N≥20 persisted production drafts to generate useful signal. The wiring shipped in this slice is the prerequisite both will consume; building them is a separate scope (~30-60 min + ~$0.40 LXC per evidence run). They are tracked as Slice 3.5.

Until that work clears, scene-satisfaction findings are a forward-looking schema surface only; no code in production emits them today.

## L092 Amendment Scope

This decision retires L092's "do not promote corpus-recreation POC behavior into production runtime yet" non-goal **only for the structural diagnostic wiring**: the optional `obligationIds` field, the `sceneSatisfactionCheckerV1` flag, and the obligation-aware routing helper. L092's non-goal is **NOT** retired for:

- Promoting any scene-satisfaction signal to blocker status (still requires parity-panel evidence per L092 standards).
- Creating new in-line LLM-backed semantic checkers (Slice 3.5's judge is replay-only against persisted drafts; not in-pipeline).
- Renaming `SceneBeat`, `outline.scenes`, or any persisted field.

## Non-Goals

- Do not flip `sceneSatisfactionCheckerV1` to default-on. There is no code consuming the flag yet; flipping it on would have no effect today.
- Do not weaken existing beat-level checkers. `chapter-plan-checker`, `adherence-events`, `halluc-ungrounded`, `continuity`, and `functional-state-checker` continue to operate exactly as today; the scene-satisfaction surface is additive.
- Do not promote scene-satisfaction findings to blocker routing. `routeValidationBlockers` continues to route every blocker through the existing beat-level path; the obligation-aware lookup only fires when the finding carries `obligationIds` AND lacks `beatIndex`.

## Follow-Up

- **Slice 3.5 (the diagnostic surface):** build `scripts/evals/scene-semantic-review.ts` (narrow LLM judge against persisted drafts) and `scripts/evals/scene-checker-parity-panel.ts` (paired-replay agreement matrix). Run on N≥20 persisted production drafts. Use the resulting evidence to decide whether to expose findings to operator review surfaces — still diagnostic, not blocking.
- **Slice 4 (eventually):** if Slice 3.5 evidence is positive, propose promoting scene-satisfaction findings to settle-loop input via a separate decision (L099 or later). Promotion to blocker remains the highest-bar step in the lane.
- **Slice 2.5 (parallel):** build `test-drafting-isolated.ts` and run the deferred Slice 2 fixed-plan A/B for `sceneCallWriterV1` + `writerExpansionMode` evidence.

## 2026-05-10 Amendment — Slice 3.5 Scripts Shipped

Both Slice 3.5 deliverables shipped (commits `575e418`, `6530dbf`):

1. **`scripts/evals/scene-semantic-review.ts`** — production-replay port of the POC narrow scene-semantic judge. Reads outlines + drafts from the DB, runs the existing `judgePlanningExcerpt` rubric per scene per dimension (six default dimensions: `sceneDramaturgy`, `threadProgression`, `promisePayoff`, `motivationSpecificity`, `worldFactPressure`, `relationshipDelta`), preserves POC applicability skips by exact ID. Optional `--persist` writes one `eval_briefs` + one `eval_results` row per task under `set_name='scene-semantic-review:<date>'`. Replay-only — never inline calls.

2. **`scripts/evals/scene-checker-parity-panel.ts`** — paired-replay harness that runs the same chapter prose through both today's `chapter-plan-checker` and a narrow per-scene satisfaction prompt with four boolean gates (goalPursued, crisisChoiceMade, outcomeLanded, obligationsCovered). Per scene it classifies agreement as `both-flagged` / `both-clean` / `beat-only` / `scene-only` and emits an agreement matrix to `output/scene-checker-parity/<date>-<novel>/`.

Both scripts default to dry mode for testing; `--live` makes the LLM calls. Unit tests cover the testable pure functions (applicability skips, task building, agreement classification, prompt rendering): 16 tests, 38 expects passing. LXC dry runs against `ab-2026-05-10-baseline` confirmed end-to-end DB → report → file write paths.

The actual N≥20 evidence run is **not** part of this commit. The L096-derived A/B novel that exists on LXC has only one fully-drafted chapter and lacks declared `threadId` / `promiseId` / `payoffId` obligations on most scenes (the L096 advisory novel's planner output does not exercise those refs), so applicability skips dominate. To produce useful diagnostic evidence the panel needs:

- A persisted novel with ≥20 chapter drafts that ran under `nativePlanningContractV1=true` so obligation refs are populated.
- Either `scenePlanContractV1=true` planning or post-hoc obligation enrichment, since most production novels today don't carry scene-contract fields like `goal` / `crisisChoice` / `outcome` (the new prompt's narrow gates fall back to "none declared" without them, which the prompt accepts as a true-by-default).

The wiring is in place; the live evidence run is a separate scope and should be authored against a fixture that satisfies both conditions.

## 2026-05-10 Post-Review Fix

Codex review found that `ValidationFinding.obligationIds` routed correctly,
but `ChapterPlanDeviation.obligationIds` did not yet have a shared settle-loop
router. A small `routeChapterPlanDeviations` helper now routes future
chapter-plan / scene-satisfaction deviations by exact `obligationId` before
falling back to legacy chapter-level beat 0 routing. The existing validation
helper remains shared by both paths.

## Status

L098 + Slice 3.5 wiring is shipped. L092's "do not promote scene-satisfaction to blocker" non-goal remains in place. Promotion to default-on `sceneSatisfactionCheckerV1` or to a blocker requires a separate decision after live parity evidence on a properly-shaped fixture.
