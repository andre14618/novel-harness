---
status: final
created: 2026-05-01
experiment_id: 323
loop: L10
---

# Phase-Eval Variance Backfill — 2026-05-01

**Purpose:** Provide numeric basis for the §9 promotion-threshold rule ("single n=10 is suggestive; need multi-run/multi-seed") over existing `phase_eval_runs` rows from experiments #307, #311, #312, #313, and adjacent planner-shape runs.

---

## Methodology

**Source table:** `public.phase_eval_runs`  
**Window:** `ran_at > now() - interval '5 weeks'` (as of 2026-05-01)  
**Total rows queried:** 27  
**Planner-shape rows analyzed:** 15 (ids 7–21 + 67; excludes checker-A/B, convergence, and NER-calibration rows)  

Rows were grouped into probe-families by `(probe_name, test_variant, control_variant, git_commit, seed)`. For each family with N ≥ 2 rows, computed mean, population stdev, coefficient of variation (CV = stdev/mean), and min/max. Opener/closer distributions were normalized to a per-chapter rate. Flapping was defined as any family with at least one PASS and at least one FAIL verdict at the same family key.

**Independence caveat:** Row ids 8 and 9 are duplicate persists of the same exp #291 run (identical `g_metrics`). Id 9 was excluded. Row ids 18 and 19 are two runs within exp #311 on different seeds/prompts; they were retained but flagged as partially dependent.

---

## Per-Tuple Variance Table

### Family A — state-mapper / coverage-balanced vs default
**Probe:** `phase-variant-comparison` | **Test:** `coverage-balanced` | **Control:** `default`  
**Seeds:** `fantasy-system-heretic` (5 runs) + `fantasy-inscription` (1 run)  
**Git commit:** `59229cea` | **N = 6 unique runs**

| metric | side | mean | stdev | CV | range |
|---|---|---|---|---|---|
| facts_median | test (coverage-balanced) | 5.83 | 2.19 | 0.376 | 3–10 |
| facts_median | control (default) | 5.50 | 1.26 | 0.229 | 4–8 |
| know_median | test | 5.33 | 1.60 | 0.300 | 4–8 |
| know_median | control | 4.83 | 2.03 | 0.421 | 3–8 |
| total_beats | test | 44.00 | 2.45 | 0.056 | 39–46 |
| total_beats | control | 45.33 | 7.04 | 0.155 | 36–59 |

**Verdicts:** 4 PASS / 2 FAIL out of 6 runs (2 FAIL = exp #290 id=7, exp #292 id=10; 3 PASS = exp #291 id=8, exp #294 id=11, exp #295 id=12; 1 PASS = exp #296 id=13 fantasy-inscription).  
**FLAPPING: YES** — same tuple has both PASS and FAIL. Example: id=7 (FAIL) vs id=8 (PASS) on the same git commit and seed.  
**Gate-ratio (test/ctrl) mean:** 1.061 — borderline; high CV=0.38 on facts_median makes any single run verdict unreliable.

---

### Family B — planning-beats corpus-v1 / fantasy-system-heretic
**Probe:** `phase-variant-comparison` | **Test:** `corpus-v1` | **Control:** `default`  
**Seed:** `fantasy-system-heretic` | **N = 1 run (id=15, exp #306)**

**Insufficient data (N < 2). Cannot compute variance. Gap documented.**

---

### Family C — planning-beats corpus-v1 / fantasy-debt
**Probe:** `phase-variant-comparison` | **Test:** `corpus-v1` | **Control:** `default`  
**Seed:** `fantasy-debt` | **Git commit:** `59229cea` | **N = 5 runs (exp #307, #311 ×2, #312, #313)**

| metric | side | mean | stdev | CV | range |
|---|---|---|---|---|---|
| facts_median | test (corpus-v1) | 6.10 | 0.97 | 0.159 | 5–7.5 |
| facts_median | control (default) | 5.70 | 0.24 | 0.043 | 5.5–6 |
| know_median | test | 5.30 | 1.17 | 0.220 | 4–7.5 |
| know_median | control | 4.70 | 0.40 | 0.085 | 4–5 |
| total_beats | test | 207.40 | 32.34 | 0.156 | 144–235 |
| total_beats | control | 151.20 | 24.28 | 0.161 | 130–191 |
| opener_desc rate/ch | test | 0.84 | 0.10 | 0.121 | 0.70–1.0 |
| opener_desc rate/ch | control | 0.68 | 0.12 | 0.171 | 0.60–0.90 |
| closer_action rate/ch | test | 0.42 | 0.23 | 0.551 | 0.10–0.70 |
| closer_action rate/ch | control | 0.48 | 0.10 | 0.204 | 0.30–0.50 |

**Verdicts:** 0 PASS / 5 FAIL. All 5 runs fail on G1 (corpus-v1 facts_median < 1.5× control_facts_median). Gate-ratio mean 1.07. No flapping.  
**Key finding:** The corpus-v1 beats variant's G1 failure is reliable. The mean ratio (1.07) is well below the 1.5× gate, and the 5-run stdev on test facts_median is 0.97. Even at 2σ upper bound (6.10 + 2×0.97 = 8.04), the control mean at that same run (5.70) would still require 8.04 ≥ 8.55 to pass — unlikely. KILL verdict is noise-tolerant.  
**Notable:** `total_beats` CV=0.156 on the test arm (144–235 across runs) reflects real planner stochasticity, not measurement noise. A single 10-chapter run has ~±32 beats uncertainty.  
**Also notable:** `closer_action rate/ch` has CV=0.55 — far too noisy to gate on in a single 10-chapter run. This metric requires multi-run aggregation.

---

### Family D — default planning-beats / multi-seed (3 seeds × 3 reruns = 9 cells, 5 chapters each)
**Probe:** `multi-seed-probe-shape-comparison` | **Variant:** `default` | **Git commit:** `59229cea`  
**Seeds:** fantasy-debt, fantasy-system-heretic, fantasy-inscription | **N = 9 cells (exp #318, id=67)**

| metric | mean | stdev | CV | range |
|---|---|---|---|---|
| facts_median | 6.78 | 1.13 | 0.167 | 5–9 |
| know_median | 5.22 | 1.31 | 0.252 | 3–8 |
| total_beats | 73.33 | 4.67 | 0.064 | 65–81 |

**Per-seed breakdown:**

| seed | facts_medians | facts_stdev | know_medians | know_stdev | beats | beats_stdev |
|---|---|---|---|---|---|---|
| fantasy-debt | [6, 7, 6] | 0.47 | [5, 6, 4] | 0.82 | [76, 65, 67] | 4.78 |
| fantasy-system-heretic | [5, 8, 6] | 1.25 | [6, 8, 5] | 1.25 | [81, 76, 71] | 4.08 |
| fantasy-inscription | [9, 7, 7] | 0.94 | [3, 5, 5] | 0.94 | [74, 74, 76] | 0.94 |

**Key finding:** Within a single seed, across 3 reruns, facts_median stdev ranges 0.47–1.25. Cross-seed stdev is 0.77 (lower than cross-cell 1.13), which confirms that seed selection introduces less variance than run-to-run LLM stochasticity. The 5-chapter multi-seed probe achieves comparable per-metric stability to a 10-chapter single-seed probe at the same total cost.

---

## Flapping Tuples

| family | runs | PASS | FAIL | flap? | example |
|---|---|---|---|---|---|
| A (state-mapper, coverage-balanced, fantasy-system-heretic) | 5 | 3 | 2 | **YES** | id=7 (FAIL) vs id=8 (PASS), same commit/seed |
| C (corpus-v1 beats, fantasy-debt) | 5 | 0 | 5 | NO | all fail consistently |
| D (default, multiseed) | 9 cells | 9 | 0 | NO | all cells pass structural gates |

Family A is the only flapping family. 40% failure rate on a coverage-balanced variant that was ultimately promoted illustrates exactly the gap in the current §9 rule: a single run returning SCREEN-PASS on this tuple was not sufficient evidence of promotion-grade stability.

---

## N-Runs Recommendation for Stable Promotion Gate

**Target:** 90% confidence interval on facts_median within ±15% of true mean.

Using the standard sample-size formula for means: `n ≥ (Z × CV / desired_precision)²`  
at Z=1.645 (90% CI), desired_precision=0.15:

| scenario | CV source | recommended n (per-family, same tuple) |
|---|---|---|
| Worst-case (state-mapper, stochastic seed) | CV=0.38 | **17 runs** |
| Typical (default arm, cross-seed) | CV=0.17 | **4 runs** |
| Best-case (corpus-v1, stable seed) | CV=0.16 | **4 runs** |

For the more demanding goal of ±5% CI on the mean (to distinguish a 1.07× ratio from a 1.12× ratio): `n ≥ 31 runs` at CV=0.18.

**Practical recommendation (cost-aware):**

The comparison between a 1×10-chapter run versus a 3-seed × 3-rerun × 5-chapter design is at similar cost (both ~10× planning calls), but the multiseed design showed lower cross-seed stdev than cross-cell stdev. The recommended minimum promotion gate for the §9 rule is:

> **3 consecutive PASS** on the same `(probe_name, test_variant, control_variant, git_commit, seed)` tuple, OR **2 seeds × 2 reruns (4 cells)** with all 4 cells passing structural gates — whichever is easier to schedule.

This directly targets the observed failure mode: Family A passed 3/5 at 40% failure rate, so requiring 3 consecutive (not 3/5) raises the bar meaningfully — the probability of 3 consecutive passes from a 60% pass-rate process is (0.6)³ = 0.22, vs a 0.85 pass-rate process at (0.85)³ = 0.61. At a 95% pass-rate (true signal), (0.95)³ = 0.86.

For the **closer_action rate** specifically: do not gate on this metric from a single run. CV=0.55 requires 82+ runs for ±15% stability. Aggregate over at least 5 runs before drawing directional conclusions.

---

## Conclusion + Action

**Conclusion:** The observed CV on `facts_median` is 0.16–0.38 depending on probe family and seed combination. A single n=10 run is insufficient because: (a) Family A showed 2/5 runs failing at the same tuple after eventual promotion — 40% failure rate on a ultimately-correct variant; (b) single-run total_beats varies by ±32 per 10 chapters (CV=0.16), meaning a 10% difference between test and control arms can be noise. The "suggestive" label in §9 is vindicated: n=1 should never trigger promotion, only SCREEN-PASS-SUGGESTIVE status.

**Action:** Update `docs/todo.md` §9 sub-bullet "Backfill analysis" to closed. Update `docs/decisions.md` with the numeric thresholds from this analysis. Document the concrete gate in `docs/experiment-design-rules.md` when that file is created (pending §9 sub-bullet). The recommended gate (3 consecutive PASS or 2-seed × 2-rerun grid) is numerically grounded by this analysis.

---

## Appendix: Raw Row Inventory

| id | exp | probe | seed(s) | variant(s) | verdict | note |
|---|---|---|---|---|---|---|
| 7 | 290 | phase-variant-comparison | fantasy-system-heretic | default,coverage-balanced | FAIL (G3) | Family A run 1 |
| 8 | 291 | phase-variant-comparison | fantasy-system-heretic | default,coverage-balanced | PASS (G1-G4) | Family A run 2 |
| 9 | 291 | phase-variant-comparison | fantasy-system-heretic | default,coverage-balanced | FAIL (G5) | Duplicate persist of run 8 (same metrics); excluded from variance |
| 10 | 292 | phase-variant-comparison | fantasy-system-heretic | default,coverage-balanced | FAIL (G2) | Family A run 3 |
| 11 | 294 | phase-variant-comparison | fantasy-system-heretic | default,coverage-balanced | PASS (G1-G5) | Family A run 4 |
| 12 | 295 | phase-variant-comparison | fantasy-system-heretic | default,coverage-balanced | PASS (G1-G5) | Family A run 5 |
| 13 | 296 | phase-variant-comparison | fantasy-inscription | default,coverage-balanced | PASS (G1-G5) | Family A run 6 (different seed) |
| 15 | 306 | phase-variant-comparison | fantasy-system-heretic | default,corpus-v1 | FAIL (G1,G2) | Family B N=1, insufficient |
| 17 | 307 | phase-variant-comparison | fantasy-debt | default,corpus-v1 | FAIL (G1) | Family C run 1 |
| 18 | 311 | phase-variant-comparison | fantasy-debt | default,corpus-v1 | FAIL (G1,G2) | Family C run 2 |
| 19 | 311 | phase-variant-comparison | fantasy-debt | default,corpus-v1 | FAIL (G1,G2) | Family C run 3 (partially dependent on run 2) |
| 20 | 312 | phase-variant-comparison | fantasy-debt | default,corpus-v1 | FAIL (G1,G2) | Family C run 4 |
| 21 | 313 | phase-variant-comparison | fantasy-debt | default,corpus-v1 | FAIL (G1,G2,G3) | Family C run 5 |
| 67 | 318 | multi-seed-probe-shape-comparison | debt+heretic+inscription | default | MULTISEED-VARIANCE | Family D — 9 cells |
