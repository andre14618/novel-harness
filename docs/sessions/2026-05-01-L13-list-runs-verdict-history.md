---
status: active
updated: 2026-05-01
loop: L13
---

# Loop Context — L13: list-runs verdict-history rollup

## Loop Contract

- Objective: Update `scripts/phase-eval/list-runs.ts` to show per-probe-family aggregate columns (consecutive PASS streak, PASS/FAIL counts, facts/knowledge median range, total-beat range, parse failures, prompt hashes) and a `--family <key>` drill-down mode. Acceptance: a cherry-picked run is visible as one point in a noisy family.
- Starting commit: `67b0d1b` (branch `synthesis-bundle-v1`)
- Experiment ID: assigned at runtime (parent_exp: 320)
- Budget cap: $0.20 (pure code + DB-query work, no LLM calls)
- Primary lever under test: CLI UX for phase_eval_runs — aggregate rollup vs per-row browse
- Files/scripts expected to change:
  - `scripts/phase-eval/list-runs.ts` — new default family-rollup mode + `--family` drill-down + `--probe`/`--variant`/`--limit` filters + `--rows` legacy alias
  - `scripts/phase-eval/list-runs.test.ts` — new; unit tests for grouping, streak calculation, range computation, filter
  - `docs/decisions.md` — L13 entry
  - `docs/todo.md` — close §9 sub-bullet
  - `docs/sessions/2026-05-01-L13-list-runs-verdict-history.md` — this file
- Evidence artifact: smoke-run output against live LXC DB (captured in decisions.md)
- Stop condition: script lands + tests pass + commit posted
- Escalation condition: none expected (pure code)

## Baseline

- Current behavior: `list-runs.ts` shows a per-row flat table with id, probe, ran_at, seeds, variants, git, exp, verdict, R/P/F1, matrix. No grouping, no streak, no range.
- Baseline command(s): `bun scripts/phase-eval/list-runs.ts --limit=5`
- Baseline result: flat console.table rows, no family context

## Command Plan

- Command 1: Write session doc (this file)
- Command 2: Implement new list-runs.ts with family-rollup default mode + `--family` + `--rows` (legacy)
- Command 3: Write `scripts/phase-eval/list-runs.test.ts` (pure logic tests, no DB required)
- Command 4: `bun test scripts/phase-eval/list-runs.test.ts`
- Command 5: `bunx tsc --noEmit`
- Command 6: Create experiment via `harness.experiments.createTuningExperiment` (inline script or bun eval)
- Command 7: Commit code + tests
- Command 8: Smoke-run against live LXC DB (if reachable); capture output
- Command 9: Update decisions.md + todo.md; commit docs

## Progress Log

- Started: 2026-05-01. Session doc written.
- Implemented list-runs.ts with family-rollup default + --family drill-down + --rows/--full legacy.
- Wrote list-runs.test.ts: 47 pure-logic unit tests, no DB required.
- Verified: 47/47 tests pass locally and on LXC; tsc clean.
- Created experiment #328 on LXC; concluded with PASS conclusion; linked to parent #320.
- Smoke-run confirmed: `--probe=phase-variant-comparison` shows 4 families with correct N/PASS/FAIL/streak/ranges.
- Updated decisions.md + todo.md; committed docs.

## Results

- Outcome: PASS
- Evidence link/row/path: `phase_eval_runs` families visible via new CLI; tuning_experiments.id=328
- Cost: $0.00 (no LLM calls)
- Commit(s): `7bd7081` (code+tests), `1326987` (docs)

## Pickup Instructions

- Completed. No outstanding work.
- Next: §9 sub-bullet "Define a probe-family key in docs/experiment-design-rules.md" remains open (formal doc entry).
