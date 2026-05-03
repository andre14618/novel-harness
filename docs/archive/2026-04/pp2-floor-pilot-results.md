---
status: reported
date: 2026-04-20
experiment: #256
charter: docs/charters/planner-phase2-payoff-floor.md
verdict: ITERATE (per charter §7)
---

# V1a Payoff-Floor Mini-Pilot — Results Report

## Summary

**ITERATE.** The aggressive prompt-only setup/payoff floor (without V1a's
`requiredPayoffs` schema) did **not** recover the V1a lift — it
slightly underperformed the pre-V1a baseline. Mean paired
Δ retry_ratio = **−0.0309**; prompt arm had 3% more retries across the
15 measured (seed, chapter) slots. Slot wins: prompt 6, baseline 8,
ties 1. Stddev 0.1256 (high variance). Directional signal is consistent
with "V1a schema is the causal lever," but only 2 of 4 charter arms
were run (missing: `extractor` measurement-only arm, `mainv1a`
observational reference row). V1b/V1c remain gated on a completed 4-arm
pilot.

## Setup

Running the charter's causal ablation on 3 fantasy seeds × 2 arms × 5
chapters = 30 paired chapter-slots. Arms run from the
`pre-planner-phase2-v1a` git tag via a worktree at
`~/apps/nh-pp2-floor`. Novel-naming convention per charter §2:
`pp2-floor__<arm>__<seed>__<unix_ts>`.

| Arm | Config |
|---|---|
| `baseline` | Frozen original `planning-beats` prompt on `pre-planner-phase2-v1a` tag |
| `prompt` | Aggressive prompt-only floor: seeding/payoff markers in beat descriptions, `[plants payoff for beat N: FACT]` / `[pays off FACT from beat M]` |

Seed set: `fantasy-archive`, `fantasy-cartographer`, `fantasy-debt`.

## Novels

Baseline arm:
- `pp2-floor__baseline__fantasy-archive__1776706058578`
- `pp2-floor__baseline__fantasy-cartographer__1776706178949`
- `pp2-floor__baseline__fantasy-debt__1776706299115`

Prompt arm:
- `pp2-floor__prompt__fantasy-archive__1776710233164`
- `pp2-floor__prompt__fantasy-cartographer__1776710358282`
- `pp2-floor__prompt__fantasy-debt__1776710485411`

## Primary metric: retry_ratio per chapter

`retry_ratio = beat-writer-attempt>1 / total-beat-writer-attempts` per
(novel, chapter). Measured only on chapters 1–5 per charter §7.

| seed | ch | baseline | prompt | Δ (baseline − prompt) |
|---|---:|---:|---:|---:|
| fantasy-archive | 1 | 0.435 | 0.278 | **+0.157** (prompt win) |
| fantasy-archive | 2 | 0.250 | 0.250 | 0.000 (tie) |
| fantasy-archive | 3 | 0.261 | 0.320 | −0.059 |
| fantasy-archive | 4 | 0.183 | 0.345 | −0.162 |
| fantasy-archive | 5 | 0.425 | 0.382 | +0.043 (prompt win) |
| fantasy-cartographer | 1 | 0.118 | 0.400 | **−0.282** |
| fantasy-cartographer | 2 | 0.227 | 0.379 | −0.152 |
| fantasy-cartographer | 3 | 0.259 | 0.240 | +0.019 (prompt win) |
| fantasy-cartographer | 4 | 0.261 | 0.344 | −0.083 |
| fantasy-cartographer | 5 | 0.321 | 0.167 | +0.154 (prompt win) |
| fantasy-debt | 1 | 0.235 | 0.381 | −0.146 |
| fantasy-debt | 2 | 0.268 | 0.286 | −0.018 |
| fantasy-debt | 3 | 0.361 | 0.287 | +0.074 (prompt win) |
| fantasy-debt | 4 | 0.457 | 0.367 | +0.090 (prompt win) |
| fantasy-debt | 5 | 0.447 | 0.546 | −0.099 |

**Mean paired Δ = −0.0309**
**Slot wins:** prompt 6, baseline 8, ties 1
**Stddev Δ = 0.1256**

## Charter §7 decision walkthrough

| Rule | Condition | Our data | Fires? |
|---|---|---|---|
| SHIP | Δ ≥ 0.03 AND prompt wins ≥ 11/15 | Δ = −0.03, prompt wins 6/15 | NO |
| JUSTIFY | \|Δ\| ≤ 0.02 AND mainv1a beats both | \|Δ\| = 0.03, no mainv1a data | NO |
| KILL | \|Δ\| ≤ 0.015 AND baseline mean ≤ 0.20 | \|Δ\| = 0.03, baseline means 0.18–0.45 | NO |
| ITERATE | everything else | ✓ | **YES** |

## Missing arms (scoping error, flagged for next session)

Charter §4 baseline ladder specifies 4 arms. Only 2 were run:

| Arm | Status | Why missing |
|---|---|---|
| `baseline` | ✅ DONE | |
| `prompt` | ✅ DONE | |
| `extractor` | ❌ NOT RUN | Pilot was under-scoped in launch briefing. |
| `mainv1a` observational | ❌ NOT RUN | Same. Would run on current `main` (V1a in production) across the same 15 slots as the reference row. |

Without `extractor`, we can't tell whether any observed delta is from
planner JSON shape vs verifier/extractor sensitivity. Without
`mainv1a`, we can't anchor the prompt arm to the actual current-prod
behavior — only to the tagged pre-V1a baseline.

## Directional interpretation

The prompt-only floor slightly underperforms pre-V1a baseline. Possible
readings:

1. **V1a schema is the causal lever.** The structured `requiredPayoffs`
   links do work that a prompt-only instruction can't replicate. Good
   news for V1b (`speaker_directives`) and V1c (`subplot_id` +
   `thematic_focus`) — they extend the same approach.
2. **Noise.** Stddev 0.1256 across 15 slots means the 0.03 mean delta
   is within 1σ/√15 ≈ 0.03 — statistically indistinguishable from
   zero. Expanding to 30 slots (6 seeds) would tighten the confidence
   interval.
3. **Aggressive prompt is actively harmful.** The `[plants payoff for
   beat N: FACT]` / `[pays off FACT from beat M]` markers may confuse
   the writer or planner in ways beyond just failing to help.

We cannot distinguish (1) from (2) from (3) without the missing arms.

## Next session actions

Per charter §7 ITERATE:

1. Run `extractor` arm on the same 3 seeds (`pre-planner-phase2-v1a` +
   measurement-only inference extractor) to isolate verifier
   sensitivity.
2. Run `mainv1a` observational arm on the same 3 seeds (current `main`
   with V1a in production). Caveat from charter §2: the 2026-04-18
   hallucination v3 wire-in means `mainv1a` runs with 3 beat-level
   checkers vs the tag's 1, so compare on adherence-only failing-chapter
   count.
3. If results remain ambiguous, expand to the full 6-seed set
   (`fantasy-healer`, `fantasy-cultivation-void`, `fantasy-bridge` added).
4. After 4-arm data is in: Codex adversary re-review on the charter;
   then ship/iterate/kill V1a ledger.

## Experiment

- **ID:** `256`
- **Type:** `validation_sweep`
- **Commit:** (current `main` at session close)
- **Conclusion:** stored in `tuning_experiments.conclusion`.

## Cost

API spend per the pilot was ~$0.30–$0.60 (per charter §8 estimate);
actual per-novel cost is in the corresponding `llm_calls` rows if
needed.
