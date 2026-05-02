---
status: active
updated: 2026-05-02
role: primary-lane-context
---

# L53 Phase-Eval Family Key

## Loop Contract

- Objective: Define and wire a probe-family key for phase eval runs so comparable reruns group reliably.
- Starting commit: 81397bf
- Experiment ID: 377
- Budget cap: $1 local/test budget; no live phase-eval probe run unless existing tests require a fixture-only command.
- Primary lane: L53 phase-eval probe-family key.
- Causal hypothesis: Promotion decisions remain noisy because run grouping can mix incomparable probes or hide comparable reruns when seed, variants, metrics, route, prompt hashes, or chapter count differ.
- Baseline: `docs/todo.md` line 134 keeps the probe-family key item open.
- Changed runtime lever: None. This lane changes eval metadata/reporting only.
- Feedback signal: Focused tests show phase-eval rows or list output compute a stable family key from seed, control/test variants, metric set, prompt override path/hash, model route, and chapter count.
- Stop gate: Stop on (a) family key implemented and tested, (b) DB schema migration is required, (c) grouping behavior conflicts with existing list-runs semantics, (d) DB/test infrastructure blocks validation, or (e) budget cap is exceeded.
- Escalation rule: If persistence requires a migration, stop after documenting the proposed schema and queue a migration lane.
- Allowed parallel support work: unit tests, fixture row construction, docs-impact audit, docs-finalizer handoff when complete.
- DeepSeek V4 Flash concurrency plan: None planned.
- Deferred out-of-lane runtime changes: planner prompt changes, promotion-threshold changes, live phase-eval probes.
- Files/scripts expected to change: `scripts/phase-eval/**`, phase-eval persistence helpers/tests, durable docs if todo closes.
- Evidence artifact: Experiment #377 plus focused test output.
- Event log: output/agent-runs/2026-05-02-L53-phase-eval-family-key/events.jsonl
- Dashboard command: monitor docs/sessions/2026-05-02-L53-phase-eval-family-key.md
- Runner command: bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L53-phase-eval-family-key.md --engine claude --model opus --permission-mode auto --worker-role captain --worker-id captain-claude --max-cycles 30 --max-hours 8 --max-no-change-cycles 3 --queue docs/sessions/lane-queue.md

## Baseline

- Current behavior: Pending first-cycle inspection.
- Baseline command(s): Inspect `scripts/phase-eval/list-runs.ts`, promotion-check helpers, and persist helpers.
- Baseline result: Pending.

## Stop Gates

- (a) Clean pass: family key implemented and tested.
- (b) Scope split: persistence migration is required.
- (c) Regression: existing family rollup/list behavior breaks.
- (d) Infrastructure failure: DB/test setup prevents interpretation.
- (e) Cost cap: budget exceeded before readable result.

## Command Plan

- Sample shape / N: local unit/fixture tests.
- Probe-family key or fixed panel: `L53-phase-eval-family-key`.
- Expected cost: $0 by default.
- Command 1: Establish current family grouping inputs.
- Command 2: Add/extend helper tests for stable family key calculation.
- Verification command(s): focused tests, `bun scripts/preflight-docs-impact.ts --strict`, `git diff --check`.

## Progress Log

- Pending. Queued as lane 3 of 6 in the bounded post-L50 harness/eval loop.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L53-phase-eval-family-key.md --actor <actor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L53-phase-eval-family-key.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L53-phase-eval-family-key.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome:
- Stop gate fired:
- Evidence link/row/path:
- Cost:
- Commit(s):

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 377 --conclusion "<summary>"`.
- Final checks run: `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- Last safe command: `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L53-phase-eval-family-key.md --json`
- If failed, failure fingerprint:
- Next action: Inspect phase-eval grouping helpers and add a stable family-key test.
