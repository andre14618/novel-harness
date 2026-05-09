---
status: active
date: 2026-05-09
lane: run-thread-id-drafting-coherence
---

# Writer Context A/B Smoke

## Question

Does opt-in `--writer-context thread-context-v1` improve scene prose coherence
when the plan, model, reference, and writer shape are held constant?

## Setup

- Source plan: `output/corpus-recreation-poc/ch1-threadrefs-plan-flash-20260509`
- Writer model: `deepseek-v4-flash`
- Arms:
  - `materiality-v1`
  - `materiality-v1 + thread-context-v1`
- Both writer arms used `--plan-from` so planner output was held constant.
- Review page:
  `output/corpus-recreation-poc/ch1-threadrefs-writer-context-ab-20260509/review.html`

## Evidence

- Run-manifest validation passed across 10 manifests for the two writer arms.
- Deterministic thread map found 5 movement rows and 2 inherited plan issues
  in both arms.
- Semantic review:
  - baseline: `threadProgression` mean 2.50, `motivationSpecificity` mean 2.25
  - thread-context: `threadProgression` mean 2.00, `motivationSpecificity` mean 2.00
  - both arms had zero low-signal findings.
- Prose review tied exactly:
  - dramatization 2.00
  - commercial pacing 2.00
  - POV voice 2.00
  - payoff propulsion 2.75
- Word shape:
  - baseline 1431/1832 words, ratio 0.78
  - thread-context 1206/1832 words, ratio 0.66

## Interpretation

This single-chapter controlled smoke does not support promoting
`thread-context-v1`. The arm did not improve prose-quality review, scored lower
on semantic thread/motivation dimensions, and produced shorter prose.

The more important finding is upstream: the fresh planner can now emit usable
thread/promise/payoff refs, but it still produced a plan mismatch where a
relationship-thread obligation carried a promise/payoff belonging to the
character-accountability thread. That should be handled as a planner contract
repair before more writer-context testing.

## Next

- Do not wire writer-context into production.
- Tighten planner-side thread/promise/payoff consistency or add deterministic
  plan repair/reject diagnostics.
- Re-run writer-context only after the plan has clean thread-map validation.
