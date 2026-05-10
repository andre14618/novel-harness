---
status: active
date: 2026-05-09
role: decision-record
---

# L097: Scene-Call Writer Context Rendering + Retry-Short-Scenes-v1 (Wiring Shipped, Default-Off)

## Decision

Ship the scene-call writer rendering + `retry-short-scenes-v1` expansion **wiring** behind two new flags (default off): `sceneCallWriterV1` and `writerExpansionMode`. Unit tests + `phase-parity-smoke` byte-parity replay validate that off-flag is byte-identical to today and on-flag wiring is structurally correct. The LXC drafting fixed-plan A/B (POC's evidence shape) is **explicitly deferred** to a future slice that builds the necessary `test-drafting-isolated` scaffolding.

This slice continues L094's incremental writer-context promotion path. L094 promoted the per-character capsule shape; L097 promotes the scene-contract surface and the expansion-retry path. Both are L092 non-goal retirements at the wiring layer, not at default-on.

## Changed Layer

Writer prompt rendering (per-entry SCENE CONTRACT block surfacing planner-emitted scene-contract fields), drafting orchestration (post-checker expansion-retry path with best-attempt retention), and trace event types (`writer-expansion`). Two new pipeline flags + their resolvers + their `SeedInput.pipelineOverrides` entries. Default flag state is off; legacy callers see byte-identical behavior.

## Exact Change

Already committed at `4bd884e`:

- `src/config/pipeline.ts` — adds `sceneCallWriterV1: false` and `writerExpansionMode: "off" | "retry-short-scenes-v1"` defaults plus `resolveSceneCallWriterV1` and `resolveWriterExpansionMode` helpers.
- `src/types.ts` — extends `SeedInput.pipelineOverrides` with the two new optional flags.
- `src/agents/writer/beat-context.ts` — adds `SceneContractBlock` typed slot; `buildSceneContractBlock(beat)` extracts planner-emitted scene-contract fields (`goal`, `opposition`, `turningPoint`, `crisisChoice`, `choiceAlternatives`, `outcome`, `consequence`, `povPersonalStake`, `valueIn`, `valueOut`, `targetWords`); returns `null` when no fields are populated so legacy outlines round-trip unchanged. `buildBeatContext` prefers per-entry `sceneContract.targetWords` over the chapter-divided default when present.
- `src/agents/writer/beat-context-render.ts` — adds `renderSceneContract` that emits the `SCENE CONTRACT` block immediately after the `BEAT N of M` block and before the transition bridge. Off-flag the slot is null and the section is suppressed.
- `src/agents/writer/retry-context.ts` — adds `buildExpansionPrompt(input)` that appends a `SCENE EXPANSION (attempt N)` suffix to the beat-context prompt. Suffix names actual word count and advisory floor, instructs the writer to expand through dramatized action / dialogue / interiority / consequence without padding, and embeds the prior prose (8000-char cap). Sourced from POC `corpus-recreation-poc.ts:1902-1907`.
- `src/phases/drafting.ts` — under `sceneCallWriterV1=true && writerExpansionMode === "retry-short-scenes-v1"`, after the existing checker-retry loop accepts `beatProse`, runs up to three expansion attempts when actual word count is below `Math.max(120, Math.round(targetWords * 0.7))`. Best-attempt retention: highest-word-count attempt across original + expansion attempts is kept. Each expansion call writes its own `llm_calls` row tagged with `attempt: pipeline.maxBeatRetries + 1 + exp` plus `expansion: true` and `expansionAttempt` metadata so cost/quality analysis can split expansion calls from checker-driven retries. A `writer-expansion` trace event records start words, best words, advisory floor, target, and which attempt was retained.
- `src/trace.ts` — adds `writer-expansion` to `TraceEventType`.
- `src/phases/drafting-reviser-escalation.test.ts` and `src/phases/drafting-revision-used-persistence.test.ts` — extend their `mock.module("../config/pipeline")` shape to include the two new flags + resolvers (without these the mocked module fails to surface the new exports drafting now imports).
- New test: `src/agents/writer/scene-context-rendering.test.ts` covers the `SCENE CONTRACT` block rendering, omitted-fields handling, ordering between `BEAT` spec and transition bridge, and `buildExpansionPrompt` suffix shape.

## Expected Benefit

POC fixed-plan A/B (`docs/sessions/2026-05-09-corpus-structure-recreation-poc.md`) showed 0.60 → 0.79 mean word-ratio improvement when the writer received explicit scene contracts and the expansion-retry path was active, with no semantic-review regression and no new checker-blocker class. Per-chapter improvement: ch1 0.65 → 0.90; ch2 0.65 → 0.78; ch5 0.40 → 0.66; ch8 0.64 → 0.84.

The wiring lets production capture that gain when a future evidence run validates the same shape on production planner output. Off-flag the surface is dormant and the existing beat-writer behaviour is preserved.

## Evidence

Local verification:

- `bun test src/agents/writer/scene-context-rendering.test.ts` — 6 tests passing, 26 expect calls.
- `bun run test:fast` — full fast tier passes (1900+ tests). Two existing drafting tests required mock-shape updates because they `mock.module("../config/pipeline")` and now need the new resolver exports.
- `./node_modules/.bin/tsc --noEmit` — clean.
- `bun run test:replay` — `phase-parity-smoke` byte-parity green (1 pass / 1 skip / 0 fail) — confirms off-flag byte parity.

POC ancestry:

- POC scene-call writer: `scripts/evals/corpus-recreation-poc.ts:1850-1923` (`writeChapterBySceneCalls`).
- POC retry-short-scenes-v1: `scripts/evals/corpus-recreation-poc.ts:1925-1935` (`shouldRetryShortScene`).
- POC expansion prompt language: `scripts/evals/corpus-recreation-poc.ts:1902-1907`.
- POC fixed-plan A/B evidence: `docs/sessions/2026-05-09-corpus-structure-recreation-poc.md` (Causal-Materiality v2 vs writer expansion + thread-character-context cohort).

## Deferred LXC Evidence — Explicit

The original Slice 2 plan named a fixed-plan A/B as the evidence gate: hold a Slice 1 flag-on plan constant, run drafting twice (`sceneCallWriterV1`+`retry-short-scenes-v1` ON vs OFF), measure word-ratio delta. Production has no `test-drafting-isolated` harness today — only `test-planner-isolated.ts` exists, and it stops before drafting. Building the drafting-isolated harness was deemed out of scope for this commit.

The wiring ships at default-off with explicit deferral of empirical evidence. Promotion to default-on requires:

- A `test-drafting-isolated.ts` (or equivalent) that takes a planning-done novel id and runs only drafting with controllable flags.
- A fixed-plan A/B on a multi-chapter cohort (≥4 chapters) showing ≥0.10 mean word-ratio improvement, no semantic-review regression, no new checker-blocker class.

Until that work clears, `sceneCallWriterV1` and `writerExpansionMode` remain default-off; setting them per-novel via `pipelineOverrides` is the supported path for opt-in evaluation.

## L092 Amendment Scope

This decision retires L092's "do not promote corpus-recreation POC behavior into production runtime yet" non-goal **only for the writer-rendering and expansion-retry wiring**: the writer prompt now surfaces scene-contract fields under flag, the drafting orchestrator can run expansion-retries under flag, and per-call telemetry is in place. L092's non-goal is **NOT** retired for default-on promotion — that remains contingent on the deferred evidence above.

Other L092 non-goals unchanged:

- Do not promote POC checker behavior (Slice 3 remains diagnostic).
- Do not rename `SceneBeat`, `outline.scenes`, or any persisted field.
- Do not use corpus structural fit as proof of story quality.
- Do not create new in-line LLM-backed semantic checkers.

## Non-Goals

- Do not flip `sceneCallWriterV1` or `writerExpansionMode` defaults to true. Promotion requires the deferred evidence above.
- Do not run the LXC drafting A/B in this slice. The harness scaffolding is the prerequisite; build it as a follow-up before the next promotion attempt.
- Do not weaken the off-flag byte-parity guarantee. Every Slice 2 surface is gated; existing beat-writer call paths produce identical bytes when the flag is off.
- Do not remove the existing checker-retry loop. Expansion-retry is parallel to checker-retry, not a replacement.

## Follow-Up

- Slice 2.5 (deferred evidence): build `test-drafting-isolated.ts` that takes a planning-done novel id and runs only drafting with `sceneCallWriterV1` + `writerExpansionMode` controllable. Then run a fixed-plan A/B against an existing planning-done novel from the L096 smoke runs. If results match POC's 0.60 → 0.79 ratio gain with no regression, propose flipping `sceneCallWriterV1` to default-on in a separate decision.
- Slice 3 (L098): scene-satisfaction LLM diagnostic + scene-keyed checker fields + parity panel. Diagnostic only; does not depend on Slice 2 evidence.
