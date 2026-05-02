---
status: active
updated: 2026-05-01
role: loop-context
loop: L10
---

# L10 — Phase-eval variance backfill

## Loop Contract

- Objective: Compute observed variance for facts_median, knowledge_median, total_beats, opener mix, closer mix, and planning failure rate over existing `phase_eval_runs` rows tied to experiments #307, #311, #312, #313, and any other planner-shape rows from the past ~5 weeks. Provide numeric basis for §9 promotion-threshold rule.
- Starting commit: 67b0d1b (current HEAD of synthesis-bundle-v1 branch)
- Experiment ID: TBD (created during loop)
- Budget cap: $0.10 (pure SQL + JSON parsing — no LLM calls)
- Primary lever under test: N/A — pure analysis loop
- Files/scripts expected to change:
  - `docs/sessions/2026-05-01-L10-phase-eval-variance-backfill.md` (this file)
  - `docs/phase-eval-variance-backfill-2026-05-01.md` (result doc, timestamped)
  - `docs/decisions.md` (append §L10 entry)
  - `docs/todo.md` (close §9 sub-bullet)
- Evidence artifact: `docs/phase-eval-variance-backfill-2026-05-01.md`
- Stop condition: (a) result doc + decisions.md entry land, (b) data too sparse (< 3 rows per probe-family — document gap + recommend follow-up), (c) cost crosses $0.10
- Escalation condition: DB unreachable or `phase_eval_runs` has no planner-shape rows

## Baseline

- Current behavior: §9 promotion rule says "single n=10 is suggestive; need multi-run/multi-seed" with no numeric basis
- Baseline command(s): `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='phase_eval_runs' ORDER BY ordinal_position`
- Baseline result: TBD

## Command Plan

1. Schema check: `information_schema.columns` for `phase_eval_runs`
2. Pull rows: planner-shape rows from past 5 weeks
3. Inspect `summary_json` shape on sample rows
4. Group by probe-family tuple: `(probe_name, test_variant, control_variant, git_commit, seed)`
5. Compute per-metric variance (mean, stdev, CV, min/max) per probe-family with ≥2 rows
6. Flag flapping tuples (same tuple emitting both SCREEN-PASS and SCREEN-FAIL)
7. Compute recommendation: N-runs-per-tuple for stable median estimate
8. Write result doc
9. Append decisions.md entry
10. Update todo.md §9
11. Track experiment via `createTuningExperiment`
12. Commit

## Progress Log

- 2026-05-01T00: Loop started. Wrote session context first per contract.
- 2026-05-01T01: Queried `phase_eval_runs` schema (10 columns confirmed). Pulled all 27 rows from 5-week window.
- 2026-05-01T02: Extracted planner-shape rows (ids 7–21 + 67). Inspected `summary_json` shapes — three distinct shapes: phase-variant-comparison (g_metrics dict with test/control sides), multi-seed-probe-shape-comparison (cells array + seedAggregates), halluc/convergence/NER rows (calibration_matrix shapes, excluded).
- 2026-05-01T03: Computed variance across 3 probe families. Key finding: Family A (state-mapper) flaps 2/5 at CV=0.376; Family C (corpus-v1 beats) all-fail at CV=0.159; Family D (default multiseed) CV=0.167 across 9 cells.
- 2026-05-01T04: Created experiment #323. Wrote result doc `docs/phase-eval-variance-backfill-2026-05-01.md`. Updated `docs/decisions.md` with §L10 entry. Updated `docs/todo.md` §9 sub-bullet to closed. Persisted variance-backfill row as `phase_eval_runs.id=69`.
- 2026-05-01T05: Committed. Loop complete.

## Results

- Outcome: PASS — all 3 families analyzed, 1 flapping tuple identified, concrete N-runs recommendation computed
- Evidence link/row/path: `docs/phase-eval-variance-backfill-2026-05-01.md`, `phase_eval_runs.id=69`
- Cost: $0.00 (pure SQL, no LLM calls)
- Commit(s): TBD (pending)

## Pickup Instructions

- Last safe command: All docs written, DB rows persisted
- If failed, failure fingerprint: n/a — complete
- Next action: Commit `[docs] L10 phase-eval variance backfill — per-tuple CV + recommendation`
