---
status: active
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

- 2026-05-01: created experiment row 318, drafted this context. Implementation pending.

## Results

- Outcome: pending.
- Evidence link/row/path: pending.
- Cost: pending.
- Commit(s): pending.

## Pickup Instructions

- Last safe command: experiment row 318 created; no DB or runtime mutations yet.
- If the loop crashes mid-run: cleanup novels with `phase-eval-multiseed-` prefix via `scripts/phase-eval/probe-planning-beats-multiseed.ts --cleanup-only` (to be implemented) or manually via `clearNovelState`.
- Next action: implement script.
