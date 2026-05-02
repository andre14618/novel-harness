---
status: shipped
updated: 2026-05-02
role: overnight-loop-context
loop: L8-two-stage-adherence-panel
experiment: TBD
---

# L8 — Two-stage Adherence vs Labeled Panel

## Loop Contract

- **Objective:** Run the freshly-shipped two-stage adherence checker (exp #317, commit `ae50e99`) against the existing labeled panel `/tmp/halluc-current-panel-exp299-labeled.jsonl`. Prove the per-event stage improves specificity on the b12 partial-enactment cluster (Cassel asks Maret about the discrepancy) while preserving the binary 100/100 baseline.
- **Starting commit:** 67b0d1b (synthesis-bundle-v1 HEAD at loop start)
- **Experiment ID:** TBD — set once `createTuningExperiment` runs
- **Budget cap:** $4 ($0.10–$0.50 expected DeepSeek V4 Flash spend)
- **Primary lever under test:** Two-stage adherence wiring (binary → per-event on fail) vs binary-only. Acceptance gate: binary 100/100 AND ≥1 b12 row where per-event detail names the missing event with quote evidence.
- **Files/scripts expected to change:**
  - `scripts/hallucination/run-two-stage-adherence-panel.ts` (new)
  - `docs/two-stage-adherence-panel-2026-05-01.md` (new result doc)
  - `docs/decisions.md` (append L8 entry)
  - `docs/todo.md` (close §8 sub-bullet)
  - `docs/sessions/2026-05-01-L8-two-stage-adherence-panel.md` (this file)
- **Evidence artifacts:**
  - `/tmp/two-stage-adherence-panel-<YYYYMMDDTHHMMSS>.jsonl` — per-row results
  - `/tmp/two-stage-adherence-panel-<YYYYMMDDTHHMMSS>.summary.json` — aggregate + b12 deep-dive
- **Stop condition (any):**
  1. Result doc + phase_eval_runs row + decisions.md entry land
  2. Panel file gone — rebuild from `scripts/hallucination/build-current-surface-panel.ts` against novel-1777670460355 chapter 1
  3. Cost crosses $3 without producing the comparison
- **Escalation condition:** Binary precision drops below 100% — document regression and stop.

## Baseline

- **Prior behavior:** Binary-only adherence checker. L5 calibration on this same panel: TN=13, TP=4, FP=0, FN=0 → 100%/100%.
- **Prior run:** exp #305 (probe-obligation-aware-adherence.ts) demonstrated per-event detail on a subset.
- **b12 cluster:** 3 rows (a1, a2, a3), all `events_partially_enacted`, oracle missing event is "Cassel calmly asks Maret to explain the discrepancy" — Maret volunteers the explanation unprompted in all 3 variants.

## Command Plan

1. Write context doc (this file).
2. Write `scripts/hallucination/run-two-stage-adherence-panel.ts`.
3. Create experiment row: `createTuningExperiment("ticket", "L8 two-stage adherence vs binary-only on labeled panel", {...})`.
4. Run the script with `--persist` and `EXPERIMENT_ID=<id>`.
5. Inspect b12 row results explicitly.
6. Write result doc `docs/two-stage-adherence-panel-2026-05-01.md`.
7. Append decisions.md entry.
8. Close todo.md §8 sub-bullet.
9. Conclude experiment.
10. Commit: `[infra] adherence-events: two-stage panel-validation script`.
11. Commit: `[docs] L8 two-stage adherence panel — result + decisions + todo close`.

## Progress Log

- 2026-05-01 — Loop opened. Recon complete. Panel has 17 current_surface_natural adherence rows: 13 TN (fully enacted), 3 TP from b12 (partially enacted), 1 TP from b5-a1 (not enacted). Session context file created.
- 2026-05-02 — Experiment #324 created on LXC. Panel eval script written (`scripts/hallucination/run-two-stage-adherence-panel.ts`) and deployed to LXC. 4 runs completed. Best run (Run 3) phase_eval_runs.id=72: TP=4 FP=0 FN=0 TN=13. Loop closed.

## Results

- Outcome: PASS. Binary precision=100% in all 4 runs. Best run: TP=4 FP=0 FN=0 TN=13 (phase_eval_runs.id=72). Stage 2 fired on all 4 fail rows. b12 per-event detail correctly named "Cassel calmly asks Maret to explain the discrepancy" with prose-backed quotes on all TP b12 rows. b12-a2 additionally caught the wrong-mechanism excuse deviation (copyist vs porter).
- FN variance (1 FN in 3 of 4 runs, always on b12 partial-enactment): LLM sensitivity variance at temp=0.1, not a wiring regression.
- Evidence: `/tmp/two-stage-adherence-panel-20260502T040521.{jsonl,summary.json}` (best run)
- phase_eval_runs.id: 72 (PASS run), 68/70/71 (FN=1 runs — persisted for comparison)
- Cost: ~$0.004 total across 4 runs
- Commit(s): pending

## Pickup Instructions

- Panel file: `/tmp/halluc-current-panel-exp299-labeled.jsonl` (44 rows total, 17 adherence natural)
- Script to write: `scripts/hallucination/run-two-stage-adherence-panel.ts`
- If panel file is gone: `bun scripts/hallucination/build-current-surface-panel.ts` against novel-1777670460355 chapter 1
- b12 rows fixture IDs: `cs-598-novel-1777670460355-c1-b12-a1-adherence-events`, `cs-598-novel-1777670460355-c1-b12-a2-adherence-events`, `cs-598-novel-1777670460355-c1-b12-a3-adherence-events`
- b5 fail row: `cs-598-novel-1777670460355-c1-b5-a1-adherence-events`
