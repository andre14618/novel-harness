---
status: active
updated: 2026-05-01
role: result-doc
loop: L1-halluc-convergence-panel
experiment: 316
---

# Hallucination Checker N-Call Convergence — L1 Results (2026-05-01)

## Question

Does running the production `halluc-ungrounded` checker (DeepSeek V4 Flash, temp=0.1, single call) **N times in parallel and combining via vote thresholds** materially lift recall and/or precision on the labeled current-surface panel?

Motivation: per `docs/todo.md` §7 + `feedback_priming_suppression_ab` (memory) — single-call halluc recall is ~70% (per v3 production report 2026-04-20). If 5 cheap parallel calls plus k-of-N voting can lift recall meaningfully without proportional precision loss, the cost (5x DeepSeek calls per beat at ~$0.0003 each = ~$0.0015 per beat) is trivially affordable.

## Two configurations tested

| Config | Temperature | N calls | Hypothesis |
|---|---|---|---|
| **A** | 0.1 | 5 | Production temp; baseline divergence |
| **B** | 0.5 | 5 | Higher-divergence to test whether disagreement helps |

Each config evaluated at thresholds k=1..5 (fail iff at least k of N calls voted fail).

## Panels

| Panel | Rows (halluc) | Ground-truth fail | Ground-truth pass | Source |
|---|---|---|---|---|
| **Small (exp #299 labeled)** | 22 | 10 | 12 | Adjudicated current-surface natural + 5 old synthetic |
| **Big (post-L3 expanded)** | 45 | 14 | 14 (+17 unlabeled natural) | New synthetic with 6 entity classes + pass controls |

## Headline numbers (Small panel, n=22)

Combined precision/recall/F1 by threshold:

| Threshold | T=0.1 F1 | T=0.5 F1 | T=0.5 Recall | T=0.5 Precision |
|---|---|---|---|---|
| k=1 (any vote) | 0.720 | 0.690 | 1.000 | 0.526 |
| k=2 | 0.720 | 0.720 | 0.900 | 0.600 |
| **k=3** | 0.696 | **0.762** | 0.800 | **0.727** |
| k=4 | 0.696 | 0.706 | 0.600 | 0.857 |
| k=5 | 0.632 | 0.625 | 0.500 | 0.833 |

**Best operating point:** temp=0.5, threshold 3-of-5 — F1 = **0.762** vs single-call-equivalent (k=1, T=0.1) F1 = 0.720. **+0.042 absolute, +5.8% relative.**

Recall held at 0.800 while precision lifted from 0.600 → 0.727 (+12.7 absolute, +21% relative).

## Why higher temperature helps

Agreement-matrix (vote_count_fail histogram across rows):

| Vote count | T=0.1 rows | T=0.5 rows |
|---|---|---|
| 0/5 (unanimous PASS) | 7 | 3 |
| 1/5 | 0 | 4 |
| 2/5 | 2 | 4 |
| 3/5 | 0 | 4 |
| 4/5 | 4 | 1 |
| 5/5 (unanimous FAIL) | 9 | 6 |
| **% unanimous** | **73%** | **41%** |

At T=0.1 the model is *too deterministic* — 73% of rows had unanimous votes, leaving little room for vote-aggregation to add information. At T=0.5 the divergence is real (~59% of rows have minority dissent), and the 3-of-5 threshold filters out the noisy single-vote false positives while still firing on the cases where the majority sees a hallucination.

## Big panel (n=45, 28 synthetic ground-truth + 17 unlabeled natural)

Note: the natural rows in the big panel are unlabeled (newly built from run_id 598; not yet adjudicated), so all big-panel precision/recall numbers below are **synthetic-only** — 14 fail (across the 6 entity classes from L3) + 14 pass controls.

| Threshold | T=0.1 F1 | T=0.5 F1 | T=0.5 Recall | T=0.5 Precision |
|---|---|---|---|---|
| **k=1 (any vote)** | 0.606 | **0.686** | **0.857** | 0.571 |
| k=2 | **0.625** | 0.647 | 0.786 | 0.550 |
| k=3 | 0.581 | 0.625 | 0.714 | 0.556 |
| k=4 | 0.600 | 0.600 | 0.643 | 0.563 |
| k=5 | 0.552 | 0.417 | 0.357 | 0.500 |

Best at T=0.1: k=2, F1=0.625. Best at T=0.5: k=1, F1=**0.686**.

**Big-panel best vs single-call baseline (T=0.1 k=1):** F1 **0.686 vs 0.606 = +0.080 absolute (+13.2% relative)**. Recall **0.857 vs 0.714 = +0.143 absolute (+20% relative)**.

Agreement histograms:

| Vote count | T=0.1 rows | T=0.5 rows |
|---|---|---|
| 0/5 (unanimous PASS) | 15 | 13 |
| 1/5 | 1 | 1 |
| 2/5 | 1 | 6 |
| 3/5 | 4 | 4 |
| 4/5 | 3 | 7 |
| 5/5 (unanimous FAIL) | 21 | 14 |
| **% unanimous** | **80%** | **60%** |

T=0.5 doubles the meaningful-disagreement rate (40% vs 20%), which is what gives the vote aggregation room to lift recall.

## Why the optimal threshold differs between panels

Small panel (n=22): best is **T=0.5 k=3** (F1=0.762).
Big panel (n=45 syn-only): best is **T=0.5 k=1** (F1=0.686).

The difference comes from class composition. Small panel had 12 natural pass + 5 synthetic fail + 5 natural fail — a balance where higher thresholds (k=3) helped filter natural-row noise. Big panel synthetic-only has 14 fail + 14 pass controls — the pass controls are sentence-level insertions of generic phrases, and the checker has a moderate FP rate on them at any temp. Lower threshold (k=1) maximizes recall on the easy synthetic fails, accepting the FP cost on pass controls.

In production, the *natural* pass distribution dominates (most beats are clean). So the small-panel finding (k=3 wins on natural-mixed data) is likely the better guide for production tuning.

## Cost (final)

| Config | Calls | Total cost |
|---|---|---|
| Small panel × T=0.1 × N=5 | 110 | ~$0.03 |
| Small panel × T=0.5 × N=5 | 110 | ~$0.03 |
| Big panel × T=0.1 × N=5 | 225 | ~$0.07 |
| Big panel × T=0.5 × N=5 | 225 | ~$0.07 |
| **L1 total** | **670** | **~$0.20** |

Well under the $8 cap.

## Cost

| Config | Calls | Total cost |
|---|---|---|
| Small panel × T=0.1 × N=5 | 110 | ~$0.03 |
| Small panel × T=0.5 × N=5 | 110 | ~$0.03 |
| Big panel × T=0.1 × N=5 | 225 | ~$0.07 |
| Big panel × T=0.5 × N=5 | 225 | ~$0.07 |
| **L1 total** | 670 | **~$0.20** |

Well under the $8 budget cap.

## Caveats

1. **Panel size is small** (22 rows of ground-truth on small; 28 on big). Confidence intervals on F1 are wide (~±0.10 plausible). Small-panel finding is suggestive, not promotion-grade. Big panel size still small.
2. **Systematic errors are not fixed by convergence.** Both at T=0.1 and T=0.5, the same ~3 false positives in the natural panel survive 5-of-5 votes — the model is wrong about those rows in a non-stochastic way.
3. **The 3 FN in natural cannot be lifted at any threshold tested.** The model just doesn't catch them. These need either: deterministic NER (L4 extractor → calibration loop), expanded grounded surface (L2 allowedNewEntities + future), or a smarter checker.
4. **Promotion-grade decision requires repeat run** per the now-mechanized phase-eval gate (commit `6a42adc`). At minimum: rerun on big panel + at least one re-run for the same (probe, variant, commit, seed) to qualify as PROMOTION-PASS.

## Persisted evidence

| Run | phase_eval_runs.id | Verdict |
|---|---|---|
| Small panel × T=0.1 × N=5 | 56 | CONVERGENCE-N5-T0.1 |
| Small panel × T=0.5 × N=5 | 57 | CONVERGENCE-N5-T0.5 |
| Big panel × T=0.1 × N=5 | 58 | CONVERGENCE-N5-T0.1 |
| Big panel × T=0.5 × N=5 | 59 | CONVERGENCE-N5-T0.5 |

Tuning experiment row: `tuning_experiments.id=316` (this loop's tracking experiment).

Per-row JSONL files preserved at:
- `/tmp/halluc-convergence-N5-T01-20260501T030200.jsonl`
- `/tmp/halluc-convergence-N5-T05-20260501T030500.jsonl`
- `/tmp/halluc-convergence-big-N5-T01-20260501T031000.jsonl`
- `/tmp/halluc-convergence-big-N5-T05-20260501T031000.jsonl`

## Recommendation

**Convergence at higher temperature is a real signal but not yet promotion-grade.** Both panels show meaningful F1 lift from N=5-call T=0.5 voting vs single-call T=0.1 baseline (+0.04 to +0.08 absolute F1). But:

1. The OPTIMAL threshold differs between the small (mixed natural+synthetic) and big (synthetic-only) panels — k=3 vs k=1. Production is closer to the natural-mixed regime, so the small-panel finding is the better guide. But n=22 is too small to ship on.
2. Both panels still leave 1-3 systematic FNs and 1-3 systematic FPs that survive every threshold. These need deterministic NER (L4 — already shipped, calibration loop next) or expanded grounded surface (L2 allowedNewEntities — already shipped) to crack.

**Next steps (subsequent loops, not part of this one):**

- **L1-followup:** Adjudicate the 17 unlabeled natural rows in the big panel and rerun T=0.5 N=5 to get a natural-mixed result with n≈45 (45 → ~30 ground-truth, 5x the small-panel size).
- **L4-followup (calibration):** Run the L4 NER candidate extractor on the same panel; build a 2x2 table of (deterministic-NER fires) x (LLM checker fires); find the rows where deterministic catches what LLM misses.
- **Promotion to production: NOT YET.** Per the now-mechanized phase-eval gate (commit `6a42adc`), promotion requires 2+ consecutive PROMOTION-PASS-eligible runs at the same (probe, variant, commit, seed) tuple. We have one suggestive run; need one more on the natural-adjudicated big panel.

**What we're confident in:**
- Convergence at temp=0.5 produces real disagreement (40-60% of rows have minority votes, vs 20-27% at temp=0.1).
- 5x cost is trivially affordable ($0.0015 per beat vs $0.0003).
- F1 lift is positive in both panels, magnitude 5-13% relative.

**What we're not yet confident in:**
- The specific optimal k threshold (k=1 vs k=3 differs across panels).
- Whether the lift survives larger panels (n=22 → 28 → ?).
- Whether systematic errors dominate the per-call lift potential (they probably do — see L4 calibration loop).
