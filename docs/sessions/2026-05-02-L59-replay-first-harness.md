---
status: active
updated: 2026-05-02
role: primary-lane-context
---

# L59 Replay-First Harness

## Loop Contract

- Objective: Add an MVP replay-first verification helper so checker/prompt candidates can be killed or narrowed on saved rows before live LXC smoke spend.
- Starting commit: 6d89447
- Experiment ID: 382
- Budget cap: $1 local/test budget; no live LXC generation and no LLM calls unless the lane explicitly records a cost estimate first.
- Primary lane: L59 replay-first harness.
- Causal hypothesis: The harness still spends too much validation effort on live smoke because saved checker/prompt evidence rows are not packaged into a repeatable replay-first workflow.
- Baseline: Candidate checker/prompt changes currently rely on bespoke A/B scripts, fixed panels, or direct smoke runs. There is no single lane entry point that inventories saved rows, estimates cost, and produces a replay packet before live generation.
- Changed runtime lever: None. This is support tooling only.
- Feedback signal: A new local CLI or documented helper can dry-run at least two tracked panels, report row count, agent/prompt family, evidence provenance, estimated call count/cost, and the exact follow-up command for a candidate replay.
- Stop gate: Stop on (a) helper plus tests and docs pass, (b) saved row inputs are too inconsistent and need a narrower schema decision, (c) helper risks changing runtime checker behavior, (d) local test or DB reachability blocks interpretation, or (e) budget cap is exceeded.
- Escalation rule: If generic replay across `llm_calls` and JSONL panels is too broad, ship the narrowest useful first slice for halluc/adherence fixed-panel JSONL and queue DB-backed `llm_calls` replay separately.
- Allowed parallel support work: tests, fixtures, docs-impact checks, small docs updates explaining how future lanes should use replay-first evidence.
- DeepSeek V4 Flash concurrency plan: None in implementation. The helper may print a future concurrency plan, but it must not launch model calls in this lane without an explicit updated Command Plan.
- Deferred out-of-lane runtime changes: checker prompt edits, checker threshold changes, planner/writer prompt changes, live smoke validation, and product acceptance policy.
- Files/scripts expected to change: `scripts/agent/*replay*.ts` or a narrowly named replay helper, tests under `scripts/agent/` or `tests/`, `docs/overnight-runbook.md`, `docs/harness-next-work-process.md`, `docs/todo.md`, and this lane doc.
- Evidence artifact: Experiment #382; focused test output; sample dry-run output over `scripts/hallucination/expanded-fail-classes-panel.jsonl` and `scripts/hallucination/synthetic-partial-enactment-fixtures/partial-enactment-panel.jsonl`.
- Event log: output/agent-runs/2026-05-02-L59-replay-first-harness/events.jsonl
- Dashboard command: monitor
- Runner command: bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L59-replay-first-harness.md --engine claude --model opus --permission-mode auto --worker-role captain --worker-id captain-claude --max-cycles 8 --max-hours 4 --max-no-change-cycles 1 --queue docs/sessions/lane-queue.md

## Baseline

- Current behavior: Saved halluc/adherence panels exist, and several A/B scripts can persist eval rows, but there is no standard pre-smoke command that packages row identity, replay scope, cost estimate, and evidence output for the next lane.
- Baseline command(s): Inspect `scripts/hallucination/ab-halluc-prompt.ts`, `scripts/hallucination/run-ab-events-system-panel.ts`, `scripts/hallucination/run-expanded-class-panel.ts`, `scripts/phase-eval/list-runs.ts`, and tracked JSONL fixtures.
- Baseline result: Replay capability is fragmented by script. Operators choose ad hoc panels and may skip cost/evidence declaration before smoke.

## Stop Gates

- (a) Clean pass: MVP helper handles two tracked panels in dry-run mode, focused tests pass, docs explain how to invoke it before checker/prompt smoke, and experiment #382 is concluded.
- (b) New dominant blocker: Panel row schemas diverge enough that a shared helper needs a schema-normalization lane first.
- (c) Regression: Existing halluc/adherence A/B scripts or list-runs output break.
- (d) Infrastructure failure: Local test runner, TypeScript parsing, or DB access needed for the chosen slice is unavailable.
- (e) Cost cap: Any accidental model/LXC spend occurs or local work exceeds the declared budget.

## Command Plan

- Sample shape / N: At minimum, dry-run two tracked JSONL panels: expanded halluc fail classes and synthetic partial enactment.
- Probe-family key or fixed panel: `L59-replay-first-harness:v1`.
- Expected cost: $0 for implementation and dry-runs.
- Command 1: Implement the smallest replay-first helper that can inventory supported saved rows and emit a cost/evidence plan.
- Command 2: Add focused unit tests for row parsing, unsupported-shape failure, and cost/call-count summary.
- Runner dry-run: `bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L59-replay-first-harness.md --engine claude --model opus --permission-mode auto --queue docs/sessions/lane-queue.md --dry-run`
- Verification command(s): focused tests for the helper; `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`; helper dry-run over the two tracked panels.

## Progress Log

- 2026-05-02 captain-claude: implemented `scripts/agent/replay-first-plan.ts` MVP. Reads one or more JSONL panels, classifies each row (`halluc-ungrounded-fixture`, `adherence-events-fixture`, or unsupported), reports row count, oracle-label distribution, source provenance, estimated call count, optional cost (default $0), and the exact replay command. Never launches model calls; `--json` for machine output; exits non-zero on unsupported schemas.
- 2026-05-02 captain-claude: added `scripts/agent/replay-first-plan.test.ts` with 14 focused tests covering args, both tracked panels (27 + 14 rows), unsupported and mixed-shape errors, JSON output, and the `main()` exit-code surface.
- 2026-05-02 captain-claude: ran the helper over the two tracked panels — halluc-ungrounded panel: 27 rows, oracle `true_hallucination=18, pass=9`; adherence-events panel: 14 rows, `events_not_fully_enacted=9, events_fully_enacted=5`; total estimated calls 55; cost $0 at default per-call price. Shape detection clean, unsupported=0.
- 2026-05-02 captain-claude: documented the helper in `docs/overnight-runbook.md`, `docs/harness-next-work-process.md` (L59 status), `docs/current-state.md`, and closed `[L48 replay-first harness]` bullet in `docs/todo.md`.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L59-replay-first-harness.md --actor <opencode|claude|supervisor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L59-replay-first-harness.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L59-replay-first-harness.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome:
- Stop gate fired:
- Evidence link/row/path:
- Cost:
- Commit(s):
- Review:

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 382 --conclusion "<summary>"`.
- Classified pending gates resolved as `orphaned` after dry-run, if any.
- Final checks run: `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- Independent review recorded in `Results: Review` before stop/queue handoff.
- Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- Last safe command: `bun scripts/agent/preflight-loop.ts docs/sessions/2026-05-02-L59-replay-first-harness.md --allow-dirty`
- If failed, failure fingerprint:
- Next action: Dry-run the lane runner, then launch L59 as the active autonomous cycle.
