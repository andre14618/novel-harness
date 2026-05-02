---
status: complete
updated: 2026-05-02
role: primary-lane-context
---

# L56 Smoke-Stop Classifier

## Loop Contract

- Objective: Automate stop-condition classification for LXC smoke runs from operator-summary, plan-assist gates, and checker telemetry.
- Starting commit: 81397bf
- Experiment ID: 380
- Budget cap: $1 local/test budget; no new LXC smoke run in this lane.
- Primary lane: L56 smoke-stop classifier.
- Causal hypothesis: Result docs take too long and are inconsistent because stop condition (clean pass, new blocker, regression, infrastructure failure) is reconstructed manually after each smoke.
- Baseline: `docs/todo.md` line 205 keeps the smoke-stop classifier item open.
- Changed runtime lever: None. This is evidence classification tooling only.
- Feedback signal: A helper can classify saved/current smoke evidence into (a) clean pass, (b) new design-class blocker, (c) regression, or (d) infra failure with evidence refs; tests cover representative synthetic summaries/gates.
- Stop gate: Stop on (a) classifier implemented and tested, (b) evidence sources lack required fields and a telemetry lane is needed, (c) classifier would mask ambiguity instead of reporting human-needed, (d) DB/test infrastructure blocks validation, or (e) budget cap is exceeded.
- Escalation rule: If classification needs new pipeline telemetry, stop and queue telemetry instrumentation separately.
- Allowed parallel support work: fixture summaries, tests, docs/runbook updates, docs-finalizer handoff when complete.
- DeepSeek V4 Flash concurrency plan: None planned.
- Deferred out-of-lane runtime changes: LXC smoke execution, checker prompt changes, plan-assist policy changes.
- Files/scripts expected to change: `scripts/agent/**` or `scripts/**`, tests, docs.
- Evidence artifact: Experiment #380 plus focused test output.
- Event log: output/agent-runs/2026-05-02-L56-smoke-stop-classifier/events.jsonl
- Dashboard command: monitor docs/sessions/2026-05-02-L56-smoke-stop-classifier.md
- Runner command: bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L56-smoke-stop-classifier.md --engine claude --model opus --permission-mode auto --worker-role captain --worker-id captain-claude --max-cycles 30 --max-hours 8 --max-no-change-cycles 3 --queue docs/sessions/lane-queue.md

## Baseline

- Current behavior: Result docs (e.g. `2026-05-02-L31d-resmoke.md`, `2026-05-01-L17-smoke-v4-validation.md`) reconstruct stop condition (a/b/c/d) by hand from `operator-summary --json` plus `chapter_exhaustions` rows.
- Baseline command(s): Inspected `scripts/operator-summary.ts` (novel/agentCosts/exhaustions/failedCalls JSON shape) and the four most recent smoke result docs.
- Baseline result: All four signals are already in `operator-summary --json`; classifier needs no new telemetry.

## Stop Gates

- (a) Clean pass: smoke-stop classifier implemented and tested.
- (b) Scope split: telemetry fields are missing and need separate instrumentation.
- (c) Regression: ambiguous evidence is over-classified instead of human-needed.
- (d) Infrastructure failure: DB/test setup prevents interpretation.
- (e) Cost cap: budget exceeded before readable result.

## Command Plan

- Sample shape / N: synthetic fixtures and existing saved summaries only.
- Probe-family key or fixed panel: `L56-smoke-stop-classifier`.
- Expected cost: $0.
- Command 1: Identify available operator-summary and gate fields.
- Command 2: Add classifier helper and representative tests.
- Verification command(s): focused tests, `bun scripts/preflight-docs-impact.ts --strict`, `git diff --check`.

## Progress Log

- 2026-05-02 cycle 6: Inspected `scripts/operator-summary.ts` JSON shape and recent smoke result docs. Added `scripts/agent/smoke-stop-classifier.ts` (pure `classifySmokeStop()` + CLI that reads `operator-summary --json` from stdin or `--input`). Conservative bias: ambiguous signals report `human_needed` rather than guessing (protects stop-gate (c)). Added 15 tests in `scripts/agent/smoke-stop-classifier.test.ts` — all pass.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L56-smoke-stop-classifier.md --actor <actor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L56-smoke-stop-classifier.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L56-smoke-stop-classifier.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome: PASS — smoke-stop classifier implemented and tested.
- Stop gate fired: (a) clean pass — classifier helper + tests landed.
- Evidence link/row/path: `scripts/agent/smoke-stop-classifier.ts`, `scripts/agent/smoke-stop-classifier.test.ts` (15/15 pass), tuning_experiments.id=380.
- Cost: $0 (no LLM calls; local-only tests).
- Commit(s): 2b49e75 `[infra] L56 smoke-stop classifier over operator-summary JSON`.

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 380 --conclusion "<summary>"`.
- Final checks run: `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- Last safe command: `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L56-smoke-stop-classifier.md --json`
- If failed, failure fingerprint:
- Next action: Inspect operator-summary JSON and recent stop-gate docs to define classifier input.
