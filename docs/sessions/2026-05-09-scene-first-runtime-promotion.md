---
status: active
updated: 2026-05-09
role: session-record
lane: upstream-planning-methodology
plan: /Users/andre/.claude/plans/velvet-riding-cascade.md
---

# Scene-First Runtime Promotion — Session Contract

## Goal And Component

Promote scene-first methodology from corpus-recreation POC into production runtime across four sequenced commits:

1. **Slice 0 — Scene contract substrate.** Schema, flag, enforcement helper, ID-propagation regression test. No behavior change. Decision: L095.
2. **Slice 1 — Planner behavior.** `causal-motivation-v3` prompt + `enforceScenePlanContract` + structural-v1 retry, gated by `scenePlanContractV1`. Decision: L096.
3. **Slice 2 — Writer scene context rendering.** Writer prompt surfaces scene contract; `retry-short-scenes-v1` expansion + best-attempt retention; clean per-entry telemetry. Decision: L097.
4. **Slice 3 — Scene satisfaction diagnostic.** Narrow LLM judge + scene-keyed checker fields + parity panel. Diagnostic only; no blocker promotion. Decision: L098.

Substrate decisions made up front:

- `beatId` remains the durable per-entry identity for `outline.scenes[]`. **Do not** add a parallel `sceneId` field. Renaming-debt is acknowledged.
- `storyDebtStage` enum extended additively to seven values: `open`, `progress`, `complicate`, `partial_payoff`, `final_payoff`, `aftermath`, `escalation`.
- All new schema fields are `.optional()` in Zod regardless of flag state. Required-when-flag-on lives only in `enforceScenePlanContract`.

## Why

L094 (2026-05-09) already promoted the writer-context layer (`thread-character-context-v1`) into production drafting after fixed-plan A/B evidence. The remaining unpromoted layers — planner contract, writer contract rendering, scene satisfaction — have accumulated POC evidence that should retire L092's "do not promote corpus-recreation POC behavior into production runtime yet" non-goal layer-by-layer. POC chapter-2 baseline ran 3 semantic lows + 0 thread refs; `causal-motivation-v3` ran 0 lows + 4 thread refs across the four-chapter cohort. Fixed-plan A/B with the same plans showed a 0.60 → 0.79 word-ratio improvement when the writer received explicit scene contracts and the `retry-short-scenes-v1` expansion path was active, with no semantic-review regression and no new checker-blocker class.

User instruction: "let's just add in each of them in the right order" + "make sure that the llm calls and semantic judgements and planner ids and deterministic piping and checks make it in." Plan revision after substrate verification corrected three implementation assumptions (`enrichOutlineIds` mints only `beatId`, not `sceneId`; production `storyDebtStage` enum is narrower than POC; production drafting already loops per `outline.scenes[]` entry).

## Signal

Each slice has its own evidence gate; Lane-level success means all four ship with default flags off and the post-promotion arms have signal:

- Slice 0: byte-parity replay green; ID-propagation test passes; new schema tests pass; type-check clean.
- Slice 1: planner-quality diagnostic on a 4-chapter disposable run shows clean materiality + personal-stake coverage and clean scene-contract validator output; **drafting smoke** on the same disposable run shows no new checker-blocker class and chapter-health within tolerance of the control (word-ratio regression up to -0.10 acceptable).
- Slice 2: fixed-plan A/B vs Slice 1 plans shows ≥0.10 mean word-ratio improvement, no semantic-review regression, no new blocker class, retry cost within autonomy budget.
- Slice 3: scene-semantic LLM judge runs cleanly on N≥20 persisted production drafts; parity panel emits a populated agreement matrix; validation-routing silent-no-op fix is exercised by tests.

## Stop Gates

a. Slice 0 byte-parity replay fails. Stop and audit before any other slice.
b. Slice 1 drafting smoke shows >-0.10 word-ratio regression OR a new checker-blocker class appears. Stop, hold flag at off, file regression evidence in the L096 record, do not move to Slice 2.
c. Slice 2 fixed-plan A/B shows <0.10 mean word-ratio improvement OR a semantic-review regression OR a new blocker class. Stop, hold flag at off, do not move to Slice 3.
d. Slice 3 parity panel surfaces a new false-positive class on the beat-vs-scene comparison. Stop and hold the diagnostic at default-off; do not propose a blocker promotion in this lane.
e. Any slice introduces a settle-loop silent no-op on real prose (e.g., findings routing to beat 0 when they should route to a scene-keyed entry). Stop immediately; the validation-routing test must explicitly cover this case.
f. Cumulative cost across slices exceeds the standing $26 overnight budget. Pause and check in before any further LXC run.

## Held Constants Across The Lane

- UI behavior. No new Planning Studio fields, no new traceability views.
- Autonomy posture. Manual review remains default; ApprovalPolicy and Canon flow are untouched.
- Model routing. DeepSeek V4 Flash for planner/writer/checker; no W&B, no fine-tunes.
- L094 character-context capsules. The promoted `thread-character-context-v1` writer-context shape is unchanged.
- Byte parity of legacy paths. Every flag defaults to `false` until that slice's evidence gate clears; legacy outlines round-trip unchanged.
- One commit per slice for code, one commit per slice for docs/decision record. No bundling.

## Plan Reference

Full plan: `/Users/andre/.claude/plans/velvet-riding-cascade.md`. The plan covers per-slice change packets, files-to-modify lists, decision-record companions, evidence gates, and the cross-cutting Signal Surfaces section (LLM call telemetry, semantic judgements, planner IDs, deterministic piping and checks).
