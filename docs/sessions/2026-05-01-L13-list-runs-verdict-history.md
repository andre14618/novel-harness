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

## Results

- Outcome: pending
- Evidence link/row/path: pending
- Cost: $0.00 (no LLM calls)
- Commit(s): pending

## Pickup Instructions

- Last safe command: wrote session context doc
- If failed, failure fingerprint: n/a
- Next action: implement list-runs.ts
