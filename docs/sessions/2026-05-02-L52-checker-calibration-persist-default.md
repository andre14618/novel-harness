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

- Current behavior:
  - `scripts/hallucination/run-synthetic-checkers.ts` accepts `--persist [--exp-id N] [--note STR]` and writes a `phase_eval_runs` row with probe_name `halluc-synthetic-fire-rate` and a top-level `summary_json` block (`halluc_calibration`, `adherence_calibration`, `halluc_recall_pct`, `adherence_recall_pct`, `per_row_results`). Default is dry (file-only via `--out`).
  - `scripts/hallucination/probe-obligation-aware-adherence.ts` accepts the same `--persist [--exp-id N] [--note STR]` shape and writes a row with probe_name `adherence-per-event-prototype` and a top-level `summary_json` block (`binary_calibration`, `binary_match_pct`, `per_event_recall_pct`, `per_event_precision_pct`, `per_row_results`). Default is dry.
  - `scripts/phase-eval/list-runs.ts` only knew the planning-shape `g_metrics` block (`test_facts_median`, `test_know_median`, `test_total_beats`) plus legacy `recall_pct/precision_pct/f1/calibration_matrix` for `--rows` mode. Checker-shape rows therefore appeared in the family rollup with FACTS/KNOW/BEATS columns all `—` and the SCREEN-PASS/FAIL counter mis-classifying their non-screen verdicts.
- Baseline command: `bun test scripts/phase-eval/list-runs.test.ts` → 47 pass / 0 fail.
- Baseline result: Persistence flag is already consistent across the two calibration scripts; the gap is purely on the reporting side.

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

- 2026-05-02: Audited the three target scripts. `--persist` parity already exists (same flag set in both calibration scripts). Per the escalation rule, kept persistence opt-in (the runtime concern is opportunistic DB writes during local testing, not unintended live LLM calls — LLM calls happen regardless of `--persist`).
- 2026-05-02: Extended `scripts/phase-eval/list-runs.ts` to recognise the two checker probes (`halluc-synthetic-fire-rate`, `adherence-per-event-prototype`). Added:
  - `isCheckerProbe(probeName)` registry.
  - `extractCheckerSummary(row)` returning a typed `CheckerSummary` with shape-specific calibration matrices and recall/precision percentages.
  - Two shape-aware rollup renderers (`printHallucSyntheticRollup`, `printAdherencePerEventRollup`) that show H_RECALL / A_RECALL / matrices for halluc-synthetic and BIN_MATCH / PE_RECALL / PE_PREC / matrix for per-event.
  - `partitionFamiliesByShape()` so the default `bun list-runs.ts` rollup prints legacy + each checker shape as separate sub-tables (preserves byte-identical legacy output for non-checker probes).
  - Extended `fetchRows` to slice the new top-level `summary_json` keys: `halluc_calibration`, `adherence_calibration`, `halluc_recall_pct`, `adherence_recall_pct`, `binary_calibration`, `binary_match_pct`, `per_event_recall_pct`, `per_event_precision_pct`.
- 2026-05-02: Added 9 unit tests covering `isCheckerProbe` and `extractCheckerSummary` (zero-fill of partial matrices, NaN/string rejection on percentages, shape dispatch). Total `list-runs.test.ts` count: 47 → 56.
- 2026-05-02: Verified `bun build` succeeds for the script and tests.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L52-checker-calibration-persist-default.md --actor <actor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L52-checker-calibration-persist-default.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L52-checker-calibration-persist-default.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome: Clean pass. Persistence flag was already consistent on both calibration scripts; the actionable gap was reporting. `list-runs.ts` now surfaces checker-specific columns (recall%, precision%, calibration matrices) for the two known checker probes, with shape-aware sub-tables in the default rollup so legacy planning output is unchanged.
- Stop gate fired: (a) — clean pass, persistence/reporting behaviour implemented and tested.
- Evidence link/row/path: `bun test scripts/phase-eval/list-runs.test.ts` → 56 pass / 0 fail (47 baseline + 9 new); `scripts/phase-eval/list-runs.ts` (`isCheckerProbe`, `extractCheckerSummary`, `partitionFamiliesByShape`, `printHallucSyntheticRollup`, `printAdherencePerEventRollup`).
- Cost: $0 (unit tests only, no live LLM / DB).
- Commit(s): pending finalization commit.

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 376 --conclusion "<summary>"`.
- Final checks run: `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- Last safe command: `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L52-checker-calibration-persist-default.md --json`
- If failed, failure fingerprint:
- Next action: Inspect target checker calibration scripts and identify the smallest persistence/reporting seam.
