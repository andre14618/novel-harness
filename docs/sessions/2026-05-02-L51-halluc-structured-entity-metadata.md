---
status: active
updated: 2026-05-02
role: primary-lane-context
---

# L51 Halluc Structured Entity Metadata

## Loop Contract

- Objective: Make hallucination checker experiment output preserve structured entity metadata so failures can be inspected without rerunning checker calls.
- Starting commit: 81397bf
- Experiment ID: 375
- Budget cap: $1 local/test budget; no live LLM calls unless an existing fixture command already runs offline.
- Primary lane: L51 structured entity metadata in halluc checker experiments.
- Causal hypothesis: A/B result inspection is slower and less reliable because rows do not consistently preserve entity, excerpt, candidate class, grounded-match status, and vote/count metadata alongside pass/fail outcomes.
- Baseline: `docs/todo.md` line 110 keeps this gap open after L50 added per-class summary metrics.
- Changed runtime lever: None. This lane changes eval/reporting metadata only, not production checker behavior.
- Feedback signal: Focused tests or fixture output show the halluc A/B experiment rows include structured entity metadata while existing aggregate and per-class metrics still render.
- Stop gate: Stop on (a) structured metadata implemented and tested, (b) source fixtures lack enough data and a panel-schema lane is required, (c) production checker code would need behavior changes, (d) DB/test infrastructure blocks validation, or (e) budget cap is exceeded.
- Escalation rule: If persistence schema changes are needed beyond `summary_json` or JSONL output shape, stop and queue a separate eval-persistence lane.
- Allowed parallel support work: fixture inspection, focused tests, docs-impact audit, docs-finalizer handoff when complete.
- DeepSeek V4 Flash concurrency plan: None planned.
- Deferred out-of-lane runtime changes: halluc blocker threshold promotion, confidence scoring, convergence, prompt changes.
- Files/scripts expected to change: `scripts/hallucination/**`, tests under `tests/`, durable docs if the todo closes.
- Evidence artifact: Experiment #375 plus focused test/fixture output.
- Event log: output/agent-runs/2026-05-02-L51-halluc-structured-entity-metadata/events.jsonl
- Dashboard command: monitor docs/sessions/2026-05-02-L51-halluc-structured-entity-metadata.md
- Runner command: bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L51-halluc-structured-entity-metadata.md --engine claude --model opus --permission-mode auto --worker-role captain --worker-id captain-claude --max-cycles 30 --max-hours 8 --max-no-change-cycles 3 --queue docs/sessions/lane-queue.md

## Baseline

- Current behavior: Pending first-cycle inspection.
- Baseline command(s): Inspect hallucination A/B scripts and current tests before editing.
- Baseline result: Pending.

## Stop Gates

- (a) Clean pass: structured entity metadata is implemented and tested.
- (b) Scope split: panel schema or persistence schema work is required first.
- (c) Regression: aggregate/per-class reporter output breaks.
- (d) Infrastructure failure: DB/provider/test setup prevents interpretation.
- (e) Cost cap: budget exceeded before readable result.

## Command Plan

- Sample shape / N: local fixtures and unit tests.
- Probe-family key or fixed panel: `L51-halluc-structured-entity-metadata`.
- Expected cost: $0 by default.
- Command 1: Identify row output shapes in halluc A/B scripts.
- Command 2: Add/extend focused unit tests around metadata extraction/rendering.
- Verification command(s): focused tests, `bun scripts/preflight-docs-impact.ts --strict`, `git diff --check`.

## Progress Log

- Pending. Queued as lane 1 of 6 in the bounded post-L50 harness/eval loop.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L51-halluc-structured-entity-metadata.md --actor <actor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L51-halluc-structured-entity-metadata.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L51-halluc-structured-entity-metadata.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome:
- Stop gate fired:
- Evidence link/row/path:
- Cost:
- Commit(s):

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 375 --conclusion "<summary>"`.
- Final checks run: `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- Last safe command: `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L51-halluc-structured-entity-metadata.md --json`
- If failed, failure fingerprint:
- Next action: Inspect halluc A/B row output shape and add the narrowest metadata extraction test.
