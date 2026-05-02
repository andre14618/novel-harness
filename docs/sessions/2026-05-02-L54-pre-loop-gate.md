---
status: concluded
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

- 2026-05-02: Inspected `lane-core.REQUIRED_LOOP_FIELDS` (15 fields) and confirmed `lane-status` already validates lane-doc context completeness but not commit linkage, experiment-id shape, deploy implication, or worktree state. Designed the gate as a thin layer that adds those four checks plus an exit-code vocabulary aligned with `lane-runner` (10/20/22).
- 2026-05-02: Implemented `scripts/agent/preflight-loop.ts` with pure-functional `runPreflightChecks(ctx, opts)` core. Side-effecting CLI shells out to `git status --porcelain=v1` and `git rev-parse --verify <sha>^{commit}`.
- 2026-05-02: Added 14 fixture-based tests in `scripts/agent/preflight-loop.test.ts` covering complete pass, missing required field, non-numeric experiment id, missing files/scripts scope, unresolvable commit, empty starting commit, dirty worktree (default + `--allow-dirty`), and multi-failure exit-code precedence (`git-infra` > `lane-context` > `dirty-worktree`).
- 2026-05-02: Smoke-validated against live lane docs L51–L54 (all pass with `--allow-dirty`) and confirmed dirty-worktree default fails L54 with exit 20.
- 2026-05-02: Updated `docs/overnight-runbook.md` (precondition #6) and `docs/agent-lane-protocol.md` to point at the new gate.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L54-pre-loop-gate.md --actor <actor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L54-pre-loop-gate.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L54-pre-loop-gate.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome: Pre-loop gate shipped. `scripts/agent/preflight-loop.ts` enforces lane-contract completeness (15 required fields), starting-commit resolution, experiment-id shape, declared file/script scope (deploy implication), and worktree state. Exit codes 0/10/20/22 match `lane-runner` vocabulary so the runner can interpret a non-zero gate without ambiguity.
- Stop gate fired: (a) Clean pass — gate script implemented and tested; no policy decisions required, no valid lane docs blocked.
- Evidence link/row/path: `scripts/agent/preflight-loop.ts`, `scripts/agent/preflight-loop.test.ts` (14 tests, 38 expects, all green); smoke output captured in Progress Log.
- Cost: $0 (local script + unit tests only).
- Commit(s): `00aed6e` on `synthesis-bundle-v1`.

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 378 --conclusion "<summary>"`.
- Final checks run: `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- Last safe command: `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L54-pre-loop-gate.md --json`
- If failed, failure fingerprint:
- Next action: Define the minimal enforceable pre-loop checks from current lane/runbook rules.
