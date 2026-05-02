---
status: completed
updated: 2026-05-02
role: primary-lane-context
---

# L57 Runner Review Gate

## Loop Contract

- Objective: Add an enforced review gate before queued runner advancement.
- Starting commit: 4d83241
- Experiment ID: 381
- Budget cap: $1 local/test budget.
- Primary lane: L57 runner review gate.
- Causal hypothesis: Autonomous lane advancement remains too self-referential because the worker can implement, summarize, and advance without a durable independent review or explicit waiver.
- Baseline: `lane-runner.ts` only requires Results outcome, stop gate, evidence, and commits before advancing to the next queue lane.
- Changed runtime lever: None. This is outer-loop guardrail tooling only.
- Feedback signal: Runner advancement checks require `Results: Review` by default; tests prove missing review blocks the gate and `--no-review-gate` is an explicit historical-lane escape hatch.
- Stop gate: Stop on (a) review field gate implemented and tested, (b) review policy needs user choice, (c) valid historical lane replay is blocked without an override, (d) test infrastructure blocks validation, or (e) budget cap is exceeded.
- Escalation rule: If shell-level runner cannot invoke the internal `impl-review` subagent directly, enforce durable review evidence/waiver instead of pretending the runner can perform the review itself.
- Allowed parallel support work: tests, lane template/docs updates, monitor visibility updates, docs-finalizer handoff when complete.
- DeepSeek V4 Flash concurrency plan: None planned.
- Deferred out-of-lane runtime changes: CI/pre-commit enforcement, automatic GitHub PR review, provider/model routing changes.
- Files/scripts expected to change: `scripts/agent/lane-runner.ts`, `scripts/agent/lane-runner.test.ts`, lane templates/docs.
- Evidence artifact: Experiment #381 plus focused test output.
- Event log: output/agent-runs/2026-05-02-L57-runner-review-gate/events.jsonl
- Dashboard command: monitor
- Runner command: bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L57-runner-review-gate.md --engine claude --model opus --permission-mode auto --worker-role captain --worker-id captain-claude --max-cycles 4 --max-hours 2 --max-no-change-cycles 1 --queue docs/sessions/lane-queue.md

## Baseline

- Current behavior: A stopped lane can advance when Results outcome, stop gate, evidence, and commits are populated. No independent review evidence is required.
- Baseline command(s): Inspect `scripts/agent/lane-runner.ts` `missingConclusionFields()` and queue advancement checks.
- Baseline result: Review is a prompt suggestion only; it is not mechanically enforced.

## Stop Gates

- (a) Clean pass: review gate implemented and tested.
- (b) Scope split: review policy needs a human decision.
- (c) Regression: valid historical lane replay cannot proceed with the documented override.
- (d) Infrastructure failure: local test setup prevents interpretation.
- (e) Cost cap: budget exceeded before readable result.

## Command Plan

- Sample shape / N: local unit tests and one dry-run/monitor check.
- Probe-family key or fixed panel: `L57-runner-review-gate`.
- Expected cost: $0.
- Command 1: Add `Results: Review` requirement to queued advancement.
- Command 2: Add tests for required/waived review behavior and prompt instructions.
- Verification command(s): focused tests, TypeScript check, `git diff --check`.

## Progress Log

- 2026-05-02: Created experiment #381 and queued L57 as the active lane after L56 completed. Baseline confirmed `lane-runner.ts` previously required only outcome, stop gate, evidence, and commits before queued advancement.
- 2026-05-02: Implemented default review gate in `lane-runner.ts`: queued advancement now requires populated `Results: Review`; `--no-review-gate` is the explicit historical-lane replay escape hatch. Worker prompt now asks for independent commit-pinned review evidence (`impl-review <sha> PASS`) or an explicit waiver reason/reviewer.
- 2026-05-02: Updated lane template, runbook, protocol docs, docs-finalizer instructions, and current-state docs so future lanes include/preserve the `Review` field.
- 2026-05-02: Focused checks passed: `bun test scripts/agent/lane-runner.test.ts scripts/agent/lane-core.test.ts scripts/agent/lane-dashboard.test.ts scripts/agent/monitor.test.ts scripts/agent/finalize-docs.test.ts` (57 pass), focused TypeScript check clean, L57 preflight passes with `--allow-dirty`, `git diff --check` clean. Pending: commit and independent review evidence before closing the lane.
- 2026-05-02: Runner dry-run for L57 produced the expected cycle prompt and includes the `Results: Review` finalization requirement.
- 2026-05-02: Implementation committed as `6d89447`. Commit-pinned `impl-review` returned no HIGH/MEDIUM findings; LOW findings were non-blocking temp-dir cleanup/help-text/prompt-structure notes and are accepted for this guardrail lane.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L57-runner-review-gate.md --actor <actor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L57-runner-review-gate.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L57-runner-review-gate.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome: Clean pass. Queued lane advancement now requires populated `Results: Review` by default, with `--no-review-gate` reserved for historical-lane replay.
- Stop gate fired: (a) Clean pass.
- Evidence link/row/path: Experiment #381; focused tests listed in Progress Log; runner dry-run artifact under `output/agent-runs/2026-05-02-L57-runner-review-gate/cycles/`; commit `6d89447`.
- Cost: $0 runtime/model cost.
- Commit(s): `6d89447 [infra] require review evidence before queued lane advance`.
- Review: `impl-review 6d89447` returned no HIGH/MEDIUM findings. LOW findings accepted by OpenCode reviewer as non-blocking because they concern existing temp-dir cleanup convention, operator-discipline wording for `--no-review-gate`, and prompt wording consistency rather than advancement correctness.

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 381 --conclusion "<summary>"`.
- Final checks run: focused tests; `git diff --check`.
- Independent review recorded in `Results: Review` before stop/queue handoff.
- Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- Last safe command: `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L57-runner-review-gate.md --json`
- If failed, failure fingerprint:
- Next action: Use `docs/harness-next-work-process.md` to queue the next harness lanes.
