---
status: active
updated: 2026-05-02
role: primary-lane-context
---

# L50 Hallucination Per-Class Metrics

## Loop Contract

- Objective: Add per-class hallucination metrics to checker A/B output so aggregate precision/recall is not the only signal.
- Starting commit: 911a0b3
- Experiment ID: 374
- Budget cap: $1 local/test budget first; no live LLM panel run unless existing fixtures and scripts make the command deterministic and cheap.
- Primary lane: L50 checker-eval reporting for halluc-ungrounded per-class metrics.
- Causal hypothesis: Hallucination checker directionality is harder to interpret because current A/B summaries emphasize aggregate precision/recall and do not consistently break down known classes such as title+surname, institution, place/realm, artifact/lore, generic-document false positives, and sanctioned allowed-new-entity passes.
- Baseline: `docs/todo.md` §7 keeps the per-class metrics item open after L49 closed deterministic title+surname grounding. Existing fixture panels carry class/case metadata, but summary output may not surface it in a durable per-class matrix.
- Changed runtime lever: None. This lane should change eval/reporting scripts and tests only, not production checker behavior.
- Feedback signal: Focused tests or fixture runs show checker A/B output includes per-class recall/precision or pass/fail counts for the named hallucination classes while preserving existing aggregate metrics.
- Stop gate: Stop on (a) per-class metrics are implemented and tested, (b) fixture metadata is insufficient and a panel-schema lane is needed, (c) implementation would change production checker behavior, (d) DB/provider infrastructure blocks validation, or (e) budget cap is exceeded.
- Escalation rule: If result persistence schema changes are required, stop and queue a separate eval-persistence/schema lane rather than bundling it with the reporter change.
- Allowed parallel support work: focused tests, docs-impact audit, small fixture inspection, docs-finalizer handoff when result is known.
- DeepSeek V4 Flash concurrency plan: None planned. Use existing fixture outputs and deterministic tests where possible.
- Deferred out-of-lane runtime changes: halluc blocker threshold promotion, checker confidence scoring, multi-call convergence, route-ladder experiments, production prompt changes.
- Files/scripts expected to change: `scripts/hallucination/**`, related tests, and durable docs if the todo item closes.
- Evidence artifact: Experiment #374 plus focused test/fixture output.
- Event log: output/agent-runs/2026-05-02-L50-halluc-per-class-metrics/events.jsonl
- Dashboard command: bun scripts/agent/lane-dashboard.ts docs/sessions/2026-05-02-L50-halluc-per-class-metrics.md --watch --latest-novel
- Runner command: bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L50-halluc-per-class-metrics.md --engine claude --model opus --permission-mode auto --worker-role captain --worker-id captain-claude --max-cycles 30 --max-hours 8 --max-no-change-cycles 3 --queue docs/sessions/lane-queue.md

## Baseline

- Current behavior: Pending first-cycle inspection.
- Baseline command(s): Inspect hallucination A/B/reporting scripts and run the narrowest existing tests before editing.
- Baseline result: Pending.

## Stop Gates

- (a) Clean pass: per-class metrics implemented and tested.
- (b) Scope split: fixture metadata or persistence schema work is needed first.
- (c) Regression: reporter changes obscure or break existing aggregate metrics.
- (d) Infrastructure failure: DB/provider/test setup prevents interpretation.
- (e) Cost cap: budget exceeded before readable result.

## Command Plan

- Sample shape / N: local fixture/reporting tests first.
- Probe-family key or fixed panel: `L50-halluc-per-class-metrics`.
- Expected cost: $0 for local tests; no new LLM calls unless explicitly justified by the cycle.
- Command 1: identify the current hallucination A/B reporter and fixture metadata.
- Command 2: run the narrowest focused test or fixture command for that reporter.
- Verification command(s): focused tests, `bun scripts/preflight-docs-impact.ts --strict`, `git diff --check`.

## Progress Log

- Pending. Created after L49 closed and after the runner/docs-finalizer full-loop smoke passed.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L50-halluc-per-class-metrics.md --actor <actor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L50-halluc-per-class-metrics.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L50-halluc-per-class-metrics.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome:
- Stop gate fired:
- Evidence link/row/path:
- Cost:
- Commit(s):

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 374 --conclusion "<summary>"`.
- Final checks run: `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- Last safe command: `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L50-halluc-per-class-metrics.md --json`
- If failed, failure fingerprint:
- Next action: Inspect current hallucination reporting scripts and identify the narrowest reporter test seam.
