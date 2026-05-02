---
status: active
updated: 2026-05-02
role: primary-lane-context
---

# L52 Checker Calibration Persist Default

## Loop Contract

- Objective: Ensure checker calibration scripts can persist by default and expose checker-specific columns consistently.
- Starting commit: 81397bf
- Experiment ID: 376
- Budget cap: $1 local/test budget; no live checker panel rerun unless a deterministic dry-run fixture exists.
- Primary lane: L52 default persistence for checker calibration scripts.
- Causal hypothesis: Calibration findings are easy to lose or compare incorrectly because some checker scripts still require bespoke persistence flags or do not surface checker-specific fields in list output.
- Baseline: `docs/todo.md` line 180 keeps this gap open for `run-synthetic-checkers.ts`, `probe-obligation-aware-adherence.ts`, and `list-runs.ts`.
- Changed runtime lever: None. This lane changes eval script persistence/reporting only.
- Feedback signal: Focused tests show calibration scripts support consistent `--persist` behavior or a safe default, and `list-runs.ts` surfaces checker-specific columns without breaking legacy output.
- Stop gate: Stop on (a) persistence/reporting implemented and tested, (b) persistence schema changes are required, (c) script behavior would trigger unintended live LLM calls by default, (d) DB/test infrastructure blocks validation, or (e) budget cap is exceeded.
- Escalation rule: If making persistence default would run live calls unexpectedly, keep default dry/local and document explicit `--persist` instead of changing runtime behavior.
- Allowed parallel support work: test fixture creation, DB reachability gating, docs-impact audit, docs-finalizer handoff when complete.
- DeepSeek V4 Flash concurrency plan: None planned.
- Deferred out-of-lane runtime changes: checker prompt edits, production severity changes, convergence sweeps.
- Files/scripts expected to change: `scripts/hallucination/**`, `scripts/phase-eval/list-runs.ts`, tests, durable docs if todo closes.
- Evidence artifact: Experiment #376 plus focused test output.
- Event log: output/agent-runs/2026-05-02-L52-checker-calibration-persist-default/events.jsonl
- Dashboard command: monitor docs/sessions/2026-05-02-L52-checker-calibration-persist-default.md
- Runner command: bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L52-checker-calibration-persist-default.md --engine claude --model opus --permission-mode auto --worker-role captain --worker-id captain-claude --max-cycles 30 --max-hours 8 --max-no-change-cycles 3 --queue docs/sessions/lane-queue.md

## Baseline

- Current behavior: Pending first-cycle inspection.
- Baseline command(s): Inspect target scripts and existing phase-eval tests.
- Baseline result: Pending.

## Stop Gates

- (a) Clean pass: persistence/reporting behavior implemented and tested.
- (b) Scope split: DB schema or live-run policy needs a separate lane.
- (c) Regression: legacy list-runs or dry-run behavior breaks.
- (d) Infrastructure failure: DB/test setup prevents interpretation.
- (e) Cost cap: budget exceeded before readable result.

## Command Plan

- Sample shape / N: local parser/unit tests first.
- Probe-family key or fixed panel: `L52-checker-calibration-persist-default`.
- Expected cost: $0 by default.
- Command 1: Find current `--persist` and list-runs behavior.
- Command 2: Add focused tests around args/report rendering.
- Verification command(s): focused tests, `bun scripts/preflight-docs-impact.ts --strict`, `git diff --check`.

## Progress Log

- Pending. Queued as lane 2 of 6 in the bounded post-L50 harness/eval loop.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L52-checker-calibration-persist-default.md --actor <actor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L52-checker-calibration-persist-default.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L52-checker-calibration-persist-default.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome:
- Stop gate fired:
- Evidence link/row/path:
- Cost:
- Commit(s):

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 376 --conclusion "<summary>"`.
- Final checks run: `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- Last safe command: `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L52-checker-calibration-persist-default.md --json`
- If failed, failure fingerprint:
- Next action: Inspect target checker calibration scripts and identify the smallest persistence/reporting seam.
