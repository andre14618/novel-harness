---
status: active
date: 2026-05-09
role: decision-record
---

# L096: Scene Contract Planner Behavior (Wiring Shipped, Default-Off, Calibration Debt)

## Decision

Ship the scene plan contract planner behavior **wiring** behind `scenePlanContractV1` (default off). Two LXC disposable-novel runs validated that the wiring fires correctly; the second run surfaced a real LLM prompt-fidelity gap that calibration must close before the flag flips on. L096 ships the wiring plus an explicit calibration-debt entry; default-on promotion is deferred to a follow-up slice (provisionally Slice 1.5) that hardens planner-prompt fidelity.

The substrate (L095) and wiring (L096) together let Slice 2 (writer scene context rendering) and Slice 3 (scene satisfaction diagnostic) proceed without depending on perfect planner-prompt fidelity under flag-on, because both target slices operate on whatever shape the planner produces (current or scene-shaped) without a hard gate.

## Changed Layer

Planner-beats user prompt + state-mapper user prompt + planning-phase orchestration. Default flag state is off; legacy callers see byte-identical behavior.

## Exact Change

Already committed:

- `0797282` — wired scene plan contract into planner-beats / state-mapper / planning phase. Under flag, planner-beats user prompt appends a causal-motivation-v3 contract block (port from POC `corpus-recreation-poc.ts:1234-1307` + variant tail at 1454-1493). State-mapper user prompt appends the materialityTest + seven-stage `storyDebtStage` block. Planning phase resolves `scenePlanContractV1`, runs `enforceScenePlanContract` after the obligation-coverage retry loop clears, and on failure runs one structural-v1 retry of `expandChapter` per failing chapter; if still failing, throws so drafting cannot proceed against a broken contract.
- `c9e037a` — added `--scene-plan-contract` flag to `scripts/test-planner-isolated.ts` for evidence runs.
- `137b91c` — calibration fixes after the first LXC smoke: (a) skip `mustNotReveal` items in materialityTest enforcement (no upstream `sourceId` by design); (b) gate "≥1 sourced obligation per scene" on `crisisChoice` being declared (transit/establishment beats remain valid); (c) sharpen structural-v1 retry feedback to enumerate the rule per error class (payoffEventId → required when storyDebtStage in {partial_payoff, final_payoff}; materialityTest → required on every source-grounded obligation; choiceAlternatives → ≥2; consequence ≠ outcome).

## Evidence

Control arm (fantasy-cartographer, scenePlanContractV1=false): ✓ PASS. 10 chapters, 59 total beats, all calls finished cleanly with ≥30% headroom.

V1 arm round 1 (scenePlanContractV1=true, prior to calibration): FAILED structural-v1 retry. Three failure modes:

1. `mustNotReveal` obligations failed materialityTest. Real validator bug — `mustNotReveal` items have no upstream sourceId by design (per `harness/ids.ts:194`); they are avoidance constraints, not source-grounded materials.
2. "≥1 obligation with sourceId per scene" too strict. Real validator bug — production beats include legitimate transit/establishment entries with no story-debt obligations; POC scenes were uniformly major dramatic units.
3. `payoffEventId` missing when planner emits `partial_payoff`/`final_payoff`. Real LLM prompt-fidelity gap.

V1 arm round 2 (after `137b91c` calibration): FAILED structural-v1 retry, but failure shape collapsed substantially. The two validator-bug failure modes are gone. What remained:

- 6 scenes / 4 chapters declare `crisisChoice` but the LLM didn't attach a sourced obligation. The planner-prompt instructs it; the LLM is partially compliant.
- 1 scene emitted zero `choiceAlternatives`. Same prompt-fidelity gap.

The structural-v1 retry surfaced these on the first pass and re-emitted, but the planner returned a similarly-non-compliant plan. The validator and retry mechanism work; the gap is in LLM compliance with the prompt under DeepSeek V4 Flash.

Cost: ~$0.10 cumulative across both LXC runs.

## Calibration Debt — Explicit

Before `scenePlanContractV1` can flip to default-on, the following calibration work must close (provisional Slice 1.5):

- **Planner-prompt fidelity for "crisisChoice → sourced obligation"**. Add a worked-example block to `beat-expansion-system.md` showing a complete scene contract entry (crisisChoice + choiceAlternatives + sourced obligations + materialityTest) so the LLM has an unambiguous template. Re-run the smoke and confirm ≥95% per-scene compliance.
- **Planner-prompt fidelity for `payoffEventId`**. The state-mapper prompt instructs the LLM to mint `payoffEventId` for payoff stages, but compliance is uneven. Either (a) sharpen the prompt with an example, or (b) deterministic-mint `payoffEventId` in `enrichOutlineIds` when `payoffId` + payoff-stage are present without it. Path (b) keeps the ID-as-code invariant from `harness/ids.ts` cleaner and is the recommended fix.
- **Per-chapter vs per-entry contract**. If post-calibration runs still surface partial compliance, consider relaxing the validator from per-entry-with-crisisChoice to per-chapter-aggregate ("at least one sourced obligation in this chapter"), accepting mixed-granularity reality.

Until that work clears, L096 ships only the wiring at default-off.

## L092 Amendment Scope

This decision retires L092's "do not promote corpus-recreation POC behavior into production runtime yet" non-goal **only for the planner-behavior wiring**: the prompt language is in place, the enforcement helper is wired, the structural-v1 retry path exists. L092's non-goal is **NOT** retired for default-on promotion of scene-shape planning — that remains contingent on the calibration debt above.

Other L092 non-goals unchanged:

- Do not promote POC writer/checker behavior in this slice.
- Do not rename `SceneBeat`, `outline.scenes`, or any persisted field.
- Do not use corpus structural fit as proof of story quality.
- Do not create new semantic checkers until the existing narrow LLM-call shape is tried against scene contract plus scene prose.

## Verification

- `bun test src/harness/enforce-scene-plan-contract.test.ts src/harness/ids-propagation.test.ts src/schemas/shared.test.ts src/agents/planning-beats/context.test.ts src/agents/planning-state-mapper/context.test.ts` — 37 tests passing.
- `bun run test:fast` — full fast tier passes; no regressions on touched surfaces.
- `./node_modules/.bin/tsc --noEmit` — clean.
- `bun run test:replay` — `phase-parity-smoke` byte-parity green (1 pass / 1 skip / 0 fail) — confirms off-flag byte parity.

LXC evidence:

- `/tmp/sliceI-control.log` (LXC 307) — control arm clean.
- `/tmp/sliceI-v1.log` (LXC 307) — round 1 failure with three mode breakdown.
- `/tmp/sliceI-v1-r2.log` (LXC 307) — round 2 failure with collapsed mode set; remaining gap is planner-prompt fidelity.

## Non-Goals

- Do not flip `scenePlanContractV1` default to true. That requires the calibration debt above.
- Do not weaken the validator to make Slice 1 pass; the validator surfaces real prompt-fidelity gaps and is doing its job.
- Do not block Slice 2 / Slice 3 on this calibration debt. Both target slices operate on whatever planner output exists today and can be evaluated independently.

## Follow-Up

- Slice 1.5 (calibration): planner-prompt worked example + deterministic `payoffEventId` mint in `enrichOutlineIds` + re-run the LXC smoke. Promotion to default-on contingent on ≥95% per-scene compliance and clean structural-v1 retry behavior.
- Slice 2 (L097): writer scene context rendering + retry-short-scenes-v1 + clean per-entry telemetry. Operates on planner output as-is; doesn't require flag-on planner.
- Slice 3 (L098): scene satisfaction diagnostic + parity panel. Diagnostic only.
