---
status: complete
date: 2026-05-01
experiment: 318
related: docs/sessions/2026-05-01-L6-multi-seed-probe-shape.md
phase_eval_runs: [17, 18, 19, 20, 21, 67]
---

# Multi-Seed Probe-Shape Variance Comparison (L6)

**Question:** does spreading the same total compute across multiple seeds (3 seeds × 5 chapters = 15 chapter-outlines) yield lower variance on planner output medians than the historical single-seed-deep shape (1 seed × 10 chapters)?

**Why it matters:** exp #311 r1-r5 documented G1/G2 medians swinging across reruns of the SAME prompt at n=10 chapters (`fantasy-debt`). If multi-seed variance is materially smaller for similar cost, future planner-prompt probes should default to multi-seed.

**Answer (with data):** No. Multi-seed (3×5) **is 3-4× noisier** than single-seed-deep (1×10) on the per-chapter medians (`facts_median`, `know_median`) at near-equal cost. Between-seed structural variation (different seeds → different planner output distributions) dominates over the within-seed stochastic noise that the single-seed shape was already measuring. Multi-seed is the WRONG tool for noise-reduction; it is the RIGHT tool for "does this prompt change generalize across seeds?"

## Configurations

### Config A — single seed, deep (existing baseline; no new spend)

- Source: `phase_eval_runs.id={17, 18, 19, 20, 21}` (exp #311 r1-r5).
- Shape: 1 seed (`fantasy-debt`) × 10 chapters × 5 reruns.
- Variant: `default` planning-beats (control side of #311 paired probe; corpus-v1 was the test side, but for this comparison only the control matters because we're isolating noise of a held-constant prompt across repeated runs of the same seed).
- Per-rerun **default control** metrics:

| Rerun | facts_median | knowledge_median | total_beats |
|------:|-------------:|-----------------:|------------:|
| r1    | 5.5          | 4.5              | 135         |
| r2    | 6            | 4                | 130         |
| r3    | 6            | 5                | 168         |
| r4    | 5.5          | 5                | 191         |
| r5    | 5.5          | 5                | 132         |

- Across-rerun **σ (n=5, sample)**: facts_median σ=0.274, knowledge_median σ=0.447, total_beats σ=27.14.
- Range: facts 5.5-6, know 4-5, beats 130-191.
- μ: facts 5.70, know 4.70, beats 151.2.

### Config B — three seeds, shallow (new run, this experiment)

- Source: `phase_eval_runs.id=67` (probe `multi-seed-probe-shape-comparison`, exp #318).
- Shape: 3 seeds × 5 chapters × 3 reruns each = 9 ok cells (in-memory `chapterCount=5` override; live `src/seeds/` files unchanged).
- Variant: `default` planning-beats — same prompt as Config A control, so the only difference between the two configurations is the (seed × rerun) coverage.
- Per-cell metrics:

| seed                       | r1 facts/know/beats | r2 facts/know/beats | r3 facts/know/beats |
|----------------------------|---------------------|---------------------|---------------------|
| fantasy-debt               | 6 / 5 / 76          | 7 / 6 / 65          | 6 / 4 / 67          |
| fantasy-system-heretic     | 5 / 6 / 81          | 8 / 8 / 76          | 6 / 5 / 71          |
| fantasy-inscription        | 9 / 3 / 74          | 7 / 5 / 74          | 7 / 5 / 76          |

- Per-seed (within-rerun) μ ± σ:
  - fantasy-debt: facts 6.33 ± 0.58 (range 1), know 5.00 ± 1.00 (range 2), beats 69.3 ± 5.86 (range 11)
  - fantasy-system-heretic: facts 6.33 ± 1.53 (range 3), know 6.33 ± 1.53 (range 3), beats 76.0 ± 5.00 (range 10)
  - fantasy-inscription: facts 7.67 ± 1.15 (range 2), know 4.33 ± 1.15 (range 2), beats 74.7 ± 1.15 (range 2)

## Variance Comparison

| metric           | Config A across-rerun σ | Config B across-cell σ | Config B across-seed-mean σ | Config B pooled within-seed σ |
|------------------|------------------------:|-----------------------:|----------------------------:|------------------------------:|
| facts_median     |                  0.274  |                 1.202  |                       0.770 |                         1.155 |
| knowledge_median |                  0.447  |                 1.394  |                       1.018 |                         1.247 |
| total_beats      |                  27.14  |                 4.95   |                       3.53  |                         4.50  |

Where:
- **across-cell σ** = treat all 9 (seed, rerun) cells as a flat sample. Answers "if I run the multi-seed probe once and report the median, what's its stddev?"
- **across-seed-mean σ** = compute each seed's mean across reruns, then σ across the 3 seed-means. Answers "how much do seeds disagree on the typical value?"
- **pooled within-seed σ** = root-mean-square of per-seed stddevs. Answers "if I knew which seed I'd be running, what's the noise per rerun?"

**Caveat on `total_beats`:** Config A used 10-chapter novels (μ ≈ 151 beats); Config B used 5-chapter novels (μ ≈ 73 beats). Beat-counts scale with chapter count, so the σ comparison is not apples-to-apples. The CV (coefficient of variation: σ/μ) is the meaningful normalization: Config A CV(beats) ≈ 0.18, Config B across-cell CV(beats) ≈ 0.068. So Config B beats look quieter on a per-beat basis, but this is largely an artifact of fewer chapters → fewer floor opportunities → narrower variance window. Use facts_median and knowledge_median (per-chapter quantities) as the primary directionality signal.

## Cost

- Config B actual: ~$0.30-0.50 (15 mins wall, 9 planning runs + 3 concept setups; estimated from per-call telemetry — exact amount not separately captured).
- Budget cap: $6. Actual / cap ratio: ~6%.

## Recommendation

**Keep single-seed-deep as the default phase-eval probe shape; do NOT migrate to multi-seed-shallow at near-equal cost.**

Decision logic (pre-registered before run):
- If Config B across-cell σ ≤ 75% × Config A σ on **all three** primary metrics → adopt multi-seed (3×5) as the default.
- If Config B across-cell σ ≤ Config A σ on **at least two of three** primary metrics → adopt multi-seed as a secondary recommended shape.
- If Config B across-cell σ ≥ Config A σ on **two or more** primary metrics → keep single-seed-deep as the default.

Result: Config B across-cell σ is **4.4× larger** for facts_median (1.202 vs 0.274) and **3.1× larger** for knowledge_median (1.394 vs 0.447). Multi-seed across-cell σ is much LARGER than single-seed-deep across-rerun σ on both primary metrics. Decision falls cleanly in bucket 3.

**Why multi-seed is noisier here:** the planner produces meaningfully different output distributions per seed (fantasy-inscription leans facts-heavy/know-light; fantasy-system-heretic leans heavier on both with high run-to-run variance; fantasy-debt is the lowest-variance seed). The single-seed shape only sees stochastic-temperature noise on top of one seed's "true" mean. The multi-seed shape mixes that within-seed noise with structural between-seed variation — the latter dominates by ~2× (across-seed-mean σ 0.77/1.02 vs Config A across-rerun σ 0.27/0.45 on facts/know).

**However, multi-seed has a different, real use case:** *"does this prompt change generalize across seeds, or is it specific to fantasy-debt?"* That is exactly what the cross-seed signal answers. The right reading is:

- For **noise quantification** (e.g., "how big a delta on `fantasy-debt` is real?") → use single-seed-deep with multiple reruns. Single-seed across-rerun σ is the cleanest noise floor.
- For **promotion decisions on prompt changes** → run single-seed-deep on the canonical seed (`fantasy-debt`) for the existing G1-G5 verdict + use multi-run promotion gate (already shipped, commit `6a42adc`); then if SCREEN-PASS, sample 1-2 reruns on a second seed to verify directionality before promoting.
- For **discovering seed-specific failures** (e.g., "does the rule break heretic but not debt?") → multi-seed is the right tool, but interpret per-seed deltas, not flat across-cell stddev.

The phase-eval `print-screen-verdict.ts` shape stays single-seed; the multi-seed probe stays as a sibling for diagnostic seed-generalization probes only.

## Source files

- Probe script: `scripts/phase-eval/probe-planning-beats-multiseed.ts` (commit `fb4d5b5`).
- Analysis CLI: `scripts/phase-eval/multiseed-shape-analysis.ts` (committed alongside this doc).
- Loop context: `docs/sessions/2026-05-01-L6-multi-seed-probe-shape.md`.
- Existing baseline rows: `phase_eval_runs.id IN (17, 18, 19, 20, 21)`.
- New row: `phase_eval_runs.id=67`.
- Experiment row: `tuning_experiments.id=318`.

## Lessons appended

- `docs/lessons-learned.md` — "multi-seed probes measure between-seed variation, not stochastic noise floors" (when X, then Y framing).
- `docs/decisions.md` — L6 entry recording the result and the decision to keep single-seed-deep as default.

## What this does not say

- This experiment did not measure how much **prompt-change signal** is masked by which probe shape. It only measured noise. A future loop could simulate a known prompt change and see which shape detects it more sensitively (signal-to-noise ratio), but that's separate work.
- Multi-seed at much larger N per seed (e.g., 5 seeds × 10ch × 5 reruns each = 250 chapters) might still beat single-seed-deep on per-metric σ — but that's not "near-equal cost." The user explicitly scoped this comparison to near-equal cost.
- This experiment used three seeds with very different genres (epic-fantasy debt-magic, litrpg, epic-fantasy inscription mages). A multi-seed probe restricted to genre-similar seeds (e.g., 3 epic-fantasy seeds) might show smaller across-seed σ. Not measured here.
