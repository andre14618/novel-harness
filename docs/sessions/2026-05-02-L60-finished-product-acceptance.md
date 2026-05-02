---
status: queued
updated: 2026-05-02
role: primary-lane-context
---

# L60 Finished Product Acceptance

## Loop Contract

- Objective: Define robust finished-novel acceptance gates and map each gate to a command, evidence artifact, and handoff decision.
- Starting commit: 6d89447
- Experiment ID: 383
- Budget cap: $1 local/docs budget; no LLM or LXC generation required.
- Primary lane: L60 finished product acceptance.
- Causal hypothesis: Autonomous harness work lacks a crisp definition of “good enough finished novel,” so lanes can improve local blockers without knowing which evidence closes the product loop.
- Baseline: `docs/todo.md` lists candidate gates, but no canonical document ties preflight health, checker calibration, smoke results, integrity, cost, and read-through evidence into one acceptance checklist.
- Changed runtime lever: None. This is productization and operator policy only unless a tiny classifier over existing JSON evidence is justified.
- Feedback signal: A canonical acceptance doc exists and every gate has a status, command, required artifact, failure action, and owner. If a small local classifier is added, it consumes `operator-summary --json` or saved smoke-stop JSON and produces `accept`, `reject`, or `needs-human` without model calls.
- Stop gate: Stop on (a) acceptance gates are defined and locally checkable, (b) a gate requires user/product judgment that cannot be encoded, (c) acceptance contradicts current runtime architecture, (d) docs or tests cannot be validated, or (e) budget cap is exceeded.
- Escalation rule: If a gate needs subjective prose quality judgment, record it as a human read-through requirement rather than creating a broad style checker.
- Allowed parallel support work: docs updates, a small pure classifier with tests, monitor/operator-summary command examples, and todo cleanup.
- DeepSeek V4 Flash concurrency plan: None.
- Deferred out-of-lane runtime changes: checker severity changes, writer/planner prompt changes, new eval model judges, and live smoke runs.
- Files/scripts expected to change: `docs/finished-novel-acceptance.md`, `docs/current-state.md`, `docs/todo.md`, this lane doc, and optionally a small pure helper under `scripts/agent/` with tests.
- Evidence artifact: Experiment #383; acceptance doc; focused tests if a classifier is added.
- Event log: output/agent-runs/2026-05-02-L60-finished-product-acceptance/events.jsonl
- Dashboard command: monitor
- Runner command: bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L60-finished-product-acceptance.md --engine claude --model opus --permission-mode auto --worker-role captain --worker-id captain-claude --max-cycles 6 --max-hours 3 --max-no-change-cycles 1 --queue docs/sessions/lane-queue.md

## Baseline

- Current behavior: The harness has strong local stop classifiers and operator summaries, but “finished” is still a backlog bullet rather than a durable acceptance contract.
- Baseline command(s): Read `docs/todo.md` §12, `docs/current-state.md` active quality controls, `scripts/operator-summary.ts`, and `scripts/agent/smoke-stop-classifier.ts`.
- Baseline result: Evidence exists but is not assembled into one product acceptance checklist.

## Stop Gates

- (a) Clean pass: finished-novel acceptance doc exists, current-state/todo point to it, and optional helper/tests pass if implemented.
- (b) New dominant blocker: user/product choice is needed for subjective read-through thresholds or acceptable warning classes.
- (c) Regression: acceptance gates would require retired architecture such as broad craft checkers, LoRA routing, or generic 1-10 scoring.
- (d) Infrastructure failure: local tests/docs checks cannot run.
- (e) Cost cap: any accidental model/LXC spend occurs or local work exceeds budget.

## Command Plan

- Sample shape / N: No model sample. Use existing docs and operator-summary/smoke-stop-classifier shapes.
- Probe-family key or fixed panel: `L60-finished-product-acceptance:v1`.
- Expected cost: $0.
- Command 1: Draft the acceptance doc with gates, commands, artifacts, pass/fail interpretation, and unresolved human-read-through criteria.
- Command 2: Add a small deterministic classifier only if it can be implemented over existing JSON evidence without inventing policy.
- Runner dry-run: `bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L60-finished-product-acceptance.md --engine claude --model opus --permission-mode auto --queue docs/sessions/lane-queue.md --dry-run`
- Verification command(s): docs-impact check, whitespace check, and focused tests if code is added.

## Progress Log

- Pending.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L60-finished-product-acceptance.md --actor <opencode|claude|supervisor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L60-finished-product-acceptance.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L60-finished-product-acceptance.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome:
- Stop gate fired:
- Evidence link/row/path:
- Cost:
- Commit(s):
- Review:

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 383 --conclusion "<summary>"`.
- Classified pending gates resolved as `orphaned` after dry-run, if any.
- Final checks run: `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- Independent review recorded in `Results: Review` before stop/queue handoff.
- Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- Last safe command: `bun scripts/agent/preflight-loop.ts docs/sessions/2026-05-02-L60-finished-product-acceptance.md --allow-dirty`
- If failed, failure fingerprint:
- Next action: Start only after L59 closes or is explicitly skipped.
