---
status: active
updated: 2026-05-02
role: primary-lane-context
---

# L54 Pre-Loop Gate

## Loop Contract

- Objective: Build a pre-loop gate that validates lane context and commit discipline before unattended Claude/OpenCode runs.
- Starting commit: 81397bf
- Experiment ID: 378
- Budget cap: $1 local/test budget.
- Primary lane: L54 pre-loop gate script.
- Causal hypothesis: Unattended loops remain easier to mislaunch than necessary because context completeness, experiment id, starting commit, budget cap, deploy statement, docs-impact plan, and worktree state are checked informally by humans instead of a script.
- Baseline: `docs/todo.md` line 203 keeps the pre-loop gate item open.
- Changed runtime lever: None. This is outer-loop guardrail tooling only.
- Feedback signal: A script exits non-zero on missing required launch conditions and passes on complete fixture lane docs; tests cover clean, dirty, and incomplete contexts.
- Stop gate: Stop on (a) gate script implemented and tested, (b) requirements need user policy decisions, (c) script would block valid existing lane docs without an override, (d) test infrastructure blocks validation, or (e) budget cap is exceeded.
- Escalation rule: If the gate needs to enforce git cleanliness more strictly than current workflow permits, stop and document the policy choice instead of hard-coding it.
- Allowed parallel support work: fixture docs, tests, docs/runbook updates, docs-finalizer handoff when complete.
- DeepSeek V4 Flash concurrency plan: None planned.
- Deferred out-of-lane runtime changes: runner behavior changes, queue semantics changes, deployment automation.
- Files/scripts expected to change: `scripts/agent/**`, tests, runbook/protocol docs.
- Evidence artifact: Experiment #378 plus focused test output.
- Event log: output/agent-runs/2026-05-02-L54-pre-loop-gate/events.jsonl
- Dashboard command: monitor docs/sessions/2026-05-02-L54-pre-loop-gate.md
- Runner command: bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L54-pre-loop-gate.md --engine claude --model opus --permission-mode auto --worker-role captain --worker-id captain-claude --max-cycles 30 --max-hours 8 --max-no-change-cycles 3 --queue docs/sessions/lane-queue.md

## Baseline

- Current behavior: Pending first-cycle inspection.
- Baseline command(s): Inspect lane-runner, lane-status, lane docs, and current runbook requirements.
- Baseline result: Pending.

## Stop Gates

- (a) Clean pass: pre-loop gate implemented and tested.
- (b) Scope split: launch policy needs user decision.
- (c) Regression: valid lane docs become impossible to launch without good reason.
- (d) Infrastructure failure: test setup prevents interpretation.
- (e) Cost cap: budget exceeded before readable result.

## Command Plan

- Sample shape / N: local unit tests with fixture lane docs.
- Probe-family key or fixed panel: `L54-pre-loop-gate`.
- Expected cost: $0.
- Command 1: Identify enforceable launch checks.
- Command 2: Add script and fixture tests.
- Verification command(s): focused tests, `bun scripts/preflight-docs-impact.ts --strict`, `git diff --check`.

## Progress Log

- Pending. Queued as lane 4 of 6 in the bounded post-L50 harness/eval loop.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L54-pre-loop-gate.md --actor <actor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L54-pre-loop-gate.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L54-pre-loop-gate.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome:
- Stop gate fired:
- Evidence link/row/path:
- Cost:
- Commit(s):

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 378 --conclusion "<summary>"`.
- Final checks run: `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- Last safe command: `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L54-pre-loop-gate.md --json`
- If failed, failure fingerprint:
- Next action: Define the minimal enforceable pre-loop checks from current lane/runbook rules.
