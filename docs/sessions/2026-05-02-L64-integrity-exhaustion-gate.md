---
status: closed
updated: 2026-05-02
role: lane-result
lane: 2026-05-02-L64-integrity-exhaustion-gate
experiment: 388
session: 2026-05-02-runner-archive-and-litrpg-validate
phase: lint-integrity-guard + chapter-attempt-retry
---

# L64 Integrity-Exhaustion Plan-Assist Gate (Lever B)

## Loop Contract

- Objective: route final-attempt chapter integrity exhaustion through `presentForExhaustion` with a new `integrity-exhausted` kind so the operator sees the same edit-plan / override / abort decision they get for plan-check exhaustion. Today integrity exhaustion silently `continue`s into `chapter-attempts-exhausted:ch${ch}` and pauses the run.
- Starting commit: `ca80f1c`
- Experiment ID: 388
- Budget cap: $0 — code-only change.
- Primary lane: chapter-attempt-retry dispatch for integrity exhaustion.
- Causal hypothesis: integrity exhaustion is operator-invisible because no `pendingExhaustion` is set. Setting one and dispatching gives the same human-in-the-loop signal that plan-check / continuity exhaustion already gets.
- Baseline: phase brief evidence (`docs/sessions/2026-05-02-integrity-retry-phase-brief.md`) — only 9 chapters in 14 days exhaust this way, but they're invisible to smoke-stop-classifier (returned `human_needed` for L61 only because `gates_total=0`).
- Changed runtime lever:
  - `src/gates.ts`: `PlanAssistGatePayload.kind` includes `"integrity-exhausted"`.
  - `src/db/chapter-exhaustions.ts` + `src/phases/contract.ts`: `ExhaustionKind` includes `"integrity-exhausted"`.
  - `src/phases/drafting.ts`: integrity-fail branch on the final attempt sets a payload + dispatches edit-plan / override / abort, mirroring the existing `plan-check-exhausted` site (lines 1161–1190).
  - No SQL migration: the `chapter_exhaustions.kind` column is `TEXT NOT NULL` with no CHECK constraint.
- Feedback signal: existing `drafting-reviser-escalation.test.ts` "plan-check override suppresses..." test would have failed because its mock prose tripped duplicate-fragment, surfacing an integrity gate. Updated the mock prose generator to emit unique letter-only words per call so it no longer triggers the detector. After fix: 1018 tests run, 1014 pass (4 pre-existing DB-reachability failures, verified by stash-comparison).
- Stop gate:
  - **(a) Clean pass:** runtime change wired, full unit suite + tsc clean (with pre-existing failures unchanged).
  - **(b) New dominant blocker:** an existing test asserts behavior that L64's gate breaks, and the test's intent doesn't accept the new gate semantics.
  - **(c) Regression:** previously-passing tests fail post-L64.
  - **(d) Infra failure:** tsc / test runner / DB unreachable.
  - **(e) Cost cap:** $0; code-only.
- Escalation rule: if a future smoke shows operators want the gate to actually retry within the same run rather than pause for resume, that's L64a (retry-budget extension). Out-of-scope here.
- Allowed parallel support work: docs sweep, lane-queue advancement.
- DeepSeek V4 Flash concurrency plan: none.
- Deferred out-of-lane runtime changes: Lever C (beat-attributed integrity + targeted beat-rewrite); within-run retry budget extension.
- Files/scripts expected to change: `src/gates.ts`, `src/db/chapter-exhaustions.ts`, `src/phases/contract.ts`, `src/phases/drafting.ts`, `src/phases/drafting-reviser-escalation.test.ts` (mock prose), `docs/current-state.md`, `docs/decisions.md`, `docs/todo.md`.
- Evidence artifact: `tuning_experiments.id=388`; commit hash to be set; this lane doc.
- Event log: output/agent-runs/2026-05-02-L64-integrity-exhaustion-gate/events.jsonl
- Captain command: bun scripts/agent/open-claude-captain.ts docs/sessions/2026-05-02-L64-integrity-exhaustion-gate.md

## Baseline

- Current behavior (pre-L64): integrity-fail on attempt 3 → `continue` → loop exits → `paused` with `chapter-attempts-exhausted:ch${ch}`. Smoke-stop-classifier returns `human_needed` only because `gates_total=0`.
- Baseline result: L61 e2e smoke (exp #384) bailed silently; phase brief documented this as the operator-visibility gap.

## Stop Gates

- (a) Clean pass: tsc green, unit suite passes (modulo pre-existing DB failures).
- (b) New dominant blocker: an unrelated test breaks because of the new dispatch.
- (c) Regression: previously-passing tests start failing.
- (d) Infra failure: tsc / test runner unavailable.
- (e) Cost cap: $0; code-only.

## Command Plan

- Sample shape / N: full repo unit test (1018 tests across 71 files).
- Probe-family key: existing test surfaces.
- Expected cost: $0.
- Command 1: `bunx tsc --noEmit`
- Command 2: `bun test`
- Verification: `git stash && bun test 2>&1 | grep -E "^(\\(fail\\)| [0-9]+ (pass|fail))" && git stash pop` to confirm pre-existing failures match.

## Progress Log

- 2026-05-02 — Lane opened from L62-validate session phase work. Experiment 388 created. PlanAssistGatePayload.kind, ExhaustionKind (both copies — db + contract), and drafting integrity-fail branch updated. tsc clean.
- 2026-05-02 — drafting-reviser-escalation.test.ts mock prose tripped duplicate-fragment because static repeating sentences tokenized to identical 8-grams. Updated mock to use letter-only counter-encoded unique words per call. 5/5 tests pass on that file.
- 2026-05-02 — Full suite: 1014 pass / 4 fail. Stash-verified the 4 failures are pre-existing DB-reachability artifacts (same count without L64 changes).

## Results

- Outcome: clean pass at unit-test gate. Integrity-exhaustion now sets `pendingExhaustion` with `kind: "integrity-exhausted"` on the final attempt and dispatches via `presentForExhaustion`. Mock prose updated for the one test that incidentally tripped duplicate-fragment detection.
- Stop gate fired: (a) clean pass.
- Evidence link/row/path: 1018 tests, 1014 pass; tsc clean; `tuning_experiments.id=388`. Pre-existing failures unaffected (stash-confirmed).
- Cost: $0.
- Commit(s): pending — same commit as docs sweep.
- Review: `impl-review` not required — change mirrors the existing `plan-check-exhausted` dispatch pattern with no novel control-flow shape; the only behavioral risk was the mock-prose collision, which was caught by the existing test and resolved with a dedicated unique-token generator. Recording as **review-waived: mirrors-existing-dispatch-pattern** (waiver reason: dispatch shape is byte-equivalent to the line 1161 pattern, payload kind + enum widening is type-checked, mock-prose interaction is captured by an existing assertion; reviewer = self).

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md` (lint guard line — L64 entry), `docs/todo.md` (close L64 candidate), `docs/decisions.md` (§L64), this lane doc.
- Experiment concluded: 388.
- Final checks: `bun test`, `bunx tsc --noEmit`, `bun scripts/preflight-docs-impact.ts --strict`, `git diff --check`.
- Independent review: waived per above reason.
- Final docs/cleanup commit before stop/queue handoff.
