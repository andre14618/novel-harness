---
status: active
date: 2026-05-09
role: decision-record
---

# L095: Scene Contract Substrate

## Decision

Add the substrate scene contract methodology needs in production — schema fields, flag, enforcement helper, ID-propagation regression test — without changing any prompt, phase orchestration, or runtime behavior. This is the first slice of the four-slice promotion lane that retires L092's "do not promote corpus-recreation POC behavior into production runtime yet" non-goal layer-by-layer.

L094 already promoted the writer-context layer (`thread-character-context-v1`). L095 promotes the substrate. L096 will promote planner behavior, L097 writer scene-context rendering, and L098 a scene-satisfaction diagnostic.

## Substrate Decisions

### `sceneId` is the durable per-entry identity for `outline.scenes[]`

Amendment, 2026-05-10: production now assigns `sceneId` to each `outline.scenes[]` entry and treats it as the durable identity for scene-first planning, writing, checking, telemetry, traceability, and planning-edit targets. `beatId` is reserved for actual beat hints, legacy beat-shaped entries, and beat-specific records. Legacy rows may still carry `beatId`; compatibility readers resolve `sceneId` first and fall back to `beatId` only when needed.

The original L095 substrate chose to keep `beatId` as the entry identity to reduce churn. User review rejected that terminology because scene-level entries should not be keyed by a field named `beatId`. The migration is additive:

- `src/harness/ids.ts` mints `sceneId` for every entry, preserves existing legacy `beatId`s, and only mints new `beatId`s for non-scene-contract legacy entries.
- `src/schemas/shared.ts` accepts both fields; scene contracts use `sceneId`, while `beatHints[]` may carry beat-specific `beatId`s.
- `llm_calls.scene_id` records the scene-first call target; `beat_id` remains compatibility/beat-specific telemetry.
- Planning repair, proposal lookup, traceability, health, validation, and checker routing prefer `sceneId` and fall back to `beatId` for legacy data.

Non-goal retained: no rename of the `SceneBeat` type alias or `outline.scenes[]` property in this slice. Those names remain compatibility debt until a narrower naming cleanup is worth the churn.

### `storyDebtStage` enum widened from 5 to 7 values

Production schema before L095:
`["open", "progress", "partial_payoff", "final_payoff", "aftermath"]` (`src/schemas/shared.ts:70`).

L095 widens additively to:
`["open", "progress", "complicate", "partial_payoff", "final_payoff", "aftermath", "escalation"]`.

The two new values (`complicate`, `escalation`) come from the POC sequence-owned story-debt model where a parent thread/promise can carry intermediate complications and post-payoff escalations rather than reusing the same final payoff ID. Existing rows still validate; new POC-shaped plans validate too. The mapper accepts any of the seven; the planner emits the new values only when `scenePlanContractV1` is on.

### All new schema fields are `.optional()` regardless of flag

Every field this slice adds — scene-contract fields on `sceneBeatSchema` (`goal`, `opposition`, `turningPoint`, `crisisChoice`, `choiceAlternatives`, `outcome`, `consequence`, `valueIn`, `valueOut`, `beatHints`, `targetWords`) and `materialityTest` on `beatObligationItemSchema` — is `.optional()` in Zod regardless of flag state. Required-when-flag-on logic lives only in `enforceScenePlanContract`, never in the schema. This preserves backwards compatibility for any persisted outline that predates the substrate, and keeps the schema honest about what's structurally optional.

## Changed Layer

Schema, pipeline flag resolver, harness enforcement helper, and ID-propagation regression test only. No prompt change, no phase orchestration change, no UI change. Default flag state is off, and with the flag off the runtime path is byte-identical to today (verified by `test:replay`).

## Exact Change

- `src/schemas/shared.ts` extends `sceneBeatSchema` with `sceneId`, optional scene-contract fields, exports a new `beatHintSchema` and `BeatHint` type, exports `BeatObligationItem` (the inferred type from `beatObligationItemSchema`), widens `storyDebtStage` to seven values, and adds optional `materialityTest` on obligations.
- `src/types.ts` extends `SeedInput.pipelineOverrides` with optional `scenePlanContractV1`.
- `src/config/pipeline.ts` adds `scenePlanContractV1: false` and `resolveScenePlanContractV1(overrides)` mirroring `resolveNativePlanningContractV1`.
- `src/harness/enforce.ts` adds `enforceScenePlanContract(chapter, options)`, a pure function that ports the POC's `assessSceneContract` checks (choice alternatives ≥2, optional POV personal stake floor, ≥1 obligation with sourceId, observable consequence ≠ outcome, optional materiality-test floor, payoff-stage / `payoffEventId` / `payoffId` consistency). Not wired into any phase yet — Slice 1 wires it.
- New tests:
  - `src/schemas/shared.test.ts` covers round-trip of optional scene-contract fields, all seven `storyDebtStage` values, and `materialityTest`.
  - `src/harness/enforce-scene-plan-contract.test.ts` ports POC fixtures for each validator class.
  - `src/harness/ids-propagation.test.ts` is the ID-flow regression baseline. It parses an outline carrying every ID class (`sceneId`, beat-hint `beatId`, `obligationId`, `sourceId`, `sourceKind`, `threadId`, `promiseId`, `payoffId`, `payoffEventId`, `storyDebtStage`, `characterId`, `sceneTurnId`) and verifies each survives `enrichOutlineIds`. Slice 1 must preserve this invariant.

## Expected Benefit

The substrate carries the schema and enforcement shape Slice 1 needs without bundling a behavior change. Slice 1 becomes a single concern (planner prompt + enforcement wiring) instead of a multi-step bundle. Default-off flag means an immediate rollback path with zero schema-rollback debt: even if Slice 1 is rolled back, the substrate stays useful for diagnostic comparisons.

## Evidence

Local verification:

- `bun test src/schemas/shared.test.ts src/harness/enforce-scene-plan-contract.test.ts src/harness/ids-propagation.test.ts` — 24 tests passing, 56 expect calls.
- `bun run test:fast` — full fast tier passes; no regressions on touched surfaces.
- `./node_modules/.bin/tsc --noEmit` — clean.
- `bun run test:replay` — `phase-parity-smoke` byte-parity green (1 pass / 1 skip / 0 fail).

POC ancestry:

- POC scene contract: `scripts/evals/corpus-recreation-poc.ts:195-217` (`recreationScenePlanSchema`).
- POC validators: `scripts/evals/corpus-recreation-poc.ts:748-1034` (`assessSceneContract`, `hasChoiceAlternatives`, `hasMaterialityTest`, `hasObservableConsequence`, payoff-stage consistency at lines 945-1002).
- POC enum source: `scripts/evals/corpus-recreation-poc.ts:185` (`storyDebtStageSchema` listing all seven values).
- POC chapter cohort + sequence-context evidence in `docs/sessions/2026-05-09-corpus-structure-recreation-poc.md`.

## L092 Amendment Scope

This decision retires L092's "do not promote corpus-recreation POC behavior into production runtime yet" non-goal **only for the substrate layer**: schema fields, flag plumbing, and the enforcement helper. The remaining L092 non-goals are unchanged:

- Do not promote POC writer/checker behavior in this slice.
- Do not rename `SceneBeat`, `outline.scenes`, or any persisted field.
- Do not use corpus structural fit as proof of story quality.
- Do not create new semantic checkers until the existing narrow LLM-call shape is tried against scene contract plus scene prose.

## Non-Goals

- No rename of `SceneBeat`/`outline.scenes`.
- No prompt edits, no phase orchestration changes.
- No mapper behavior change beyond schema acceptance of the wider `storyDebtStage` enum and optional `materialityTest`.
- No UI surface change.
- No autonomy posture change.
- Telemetry identity addition is limited to `llm_calls.scene_id`; no external telemetry or CI surface is added.

## Follow-Up

- Slice 1 (L096) wires the `causal-motivation-v3` planner prompt and `enforceScenePlanContract` into `runPlanningPhase` under the flag, with a 4-chapter disposable run for planner-quality + drafting smoke evidence.
- Slice 2 (L097) renders the scene contract in the writer prompt, adds `retry-short-scenes-v1` expansion with best-attempt retention, and ships scene telemetry (no fake beat-id stuffing).
- Slice 3 (L098) ports the narrow scene-semantic LLM judge as a diagnostic, adds scene-keyed checker finding fields behind a flag, and builds the parity panel — diagnostic only, no blocker promotion.

Plan reference: `docs/sessions/2026-05-09-scene-first-runtime-promotion.md` and the lane plan at `/Users/andre/.claude/plans/velvet-riding-cascade.md`.
