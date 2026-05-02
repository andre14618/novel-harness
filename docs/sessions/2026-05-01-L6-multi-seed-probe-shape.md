---
status: complete
updated: 2026-05-01
role: overnight-loop-context
---

# L6: Multi-Seed Probe Shape — Variance Comparison

Closes `docs/todo.md` §9 backlog item: "Compare 1 seed × 10 chapters vs 3 seeds × 5 chapters."

## Loop Contract

- Objective: measure whether 3 seeds × 5 chapters yields lower variance on `facts_median`, `know_median`, `total_beats` than 1 seed × 10 chapters at near-equal cost. Decide whether future planner-prompt probes should default to multi-seed.
- Starting commit: `9d818e4` (HEAD at probe creation; parallel L7 agent landed 4 commits between context snapshot and this loop).
- Experiment ID: **318** (`tuning_experiments` row, type `validation_sweep`, target `phase-eval`, dimension `probe-shape-variance`).
- Budget cap: $6 (DeepSeek V4 Flash planner). Estimated actual: ~$1 (concept ~$0.012 × 3 + planning ~$0.07 × 9 = ~$0.7 plus margin).
- Primary lever under test: probe shape (single-seed-deep vs multi-seed-shallow). Variant `default` planning-beats prompt held constant on both sides.
- Files/scripts expected to change:
  - NEW: `scripts/phase-eval/probe-planning-beats-multiseed.ts`
  - NEW: `docs/multi-seed-probe-shape-2026-05-01.md` (result doc)
  - APPEND: `docs/decisions.md`, `docs/lessons-learned.md`, `docs/todo.md`
- Evidence artifact: `phase_eval_runs` row(s) with `probe_name='multi-seed-probe-shape-comparison'` + result doc.
- Stop condition: 3 seeds × 3 reruns of 5-chapter `default` planner persisted to `phase_eval_runs` AND comparison doc written AND experiment concluded.
- Escalation condition: any rerun that fails G4 (structural validity) twice in a row, or actual cost exceeds $4 (60% of budget).

## Baseline (Config A — already in DB)

- Source: exp #311 r1-r5, `phase_eval_runs` ids 17-21.
- Shape: 1 seed (`fantasy-debt`) × 10 chapters × 5 reruns.
- Variant under measurement: `default` (control side of #311 paired probe).
- Per-rerun control metrics (default planning-beats):
  - `facts_median`: 5.5, 6, 6, 5.5, 5.5 → range 0.5, σ ≈ 0.22
  - `knowledge_median`: 4.5, 4, 5, 5, 5 → range 1.0, σ ≈ 0.40
  - `total_beats`: 135, 130, 168, 191, 132 → range 61, σ ≈ 25.7
- (Note: corpus-v1 test side of #311 had wider variance: facts 5.5-7.5, know 4-7.5. The default control is what we care about for this experiment because it isolates "noise of the planner under a held-constant prompt across seed-rerun shape" rather than mixing in prompt-design effects.)

## Command Plan

- Step 1: implement `scripts/phase-eval/probe-planning-beats-multiseed.ts` (sibling of single-seed probe).
- Step 2: smoke run locally (or LXC) with 1 seed × 2 chapters × 1 rerun.
- Step 3: deploy LXC.
- Step 4: full Config B run on LXC: 3 seeds (`fantasy-debt`, `fantasy-system-heretic`, `fantasy-inscription`) × 5 chapters × 3 reruns. EXPERIMENT_ID=318. `--persist`.
- Step 5: compute variance comparison; write result doc; conclude experiment; commit + decisions.

## Progress Log

- 2026-05-01 03:22: created experiment row 318, drafted this context.
- 2026-05-01 03:25: smoke ran 2 seeds × 2 chapters × 1 rerun (heretic+inscription). Cleanup verified.
- 2026-05-01 03:28: kicked full Config B run (3 seeds × 5 ch × 3 reruns) on LXC nohup.
- 2026-05-01 03:56: probe completed cleanly. 9/9 ok cells. `phase_eval_runs.id=67`.
- 2026-05-01 03:58: ran `scripts/phase-eval/multiseed-shape-analysis.ts 67`. Variance comparison written to result doc.

## Results

- Outcome: **multi-seed is 3-4× noisier than single-seed-deep on per-chapter medians at near-equal cost. Recommendation: keep single-seed-deep as default.**
- Evidence link/row/path: `phase_eval_runs.id=67` (Config B); 17-21 (Config A baseline). Result doc `docs/multi-seed-probe-shape-2026-05-01.md`.
- Cost: ~$0.30-0.50 actual (well under $6 cap).
- Commits: `fb4d5b5` (probe script), `30848e7` (loop context), `9f3c5b6` (result doc + analysis CLI), plus pending decisions/lessons-learned/todo commit.

## Pickup Instructions

- Loop is complete. No further action.
- The `multi-seed-probe-shape-comparison` probe persists per-cell + per-seed + across aggregates in `phase_eval_runs.summary_json` for any future re-comparisons.
- If a future experiment wants seed-generalization data (not noise reduction), use `bun scripts/phase-eval/probe-planning-beats-multiseed.ts` and analyze with `multiseed-shape-analysis.ts`.
