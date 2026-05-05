---
status: active
date: 2026-05-05
decision: continuity-grayzone-panel-2026-05-05
---

# L81 Continuity Gray-Zone Panel — 2026-05-05

## Decision

Adjudicated panel of N=20 continuity findings (stratified across
`continuity-facts` × {blocker, warning, nit} and `continuity-state` × warning;
the two `continuity-state` ×{blocker, nit} strata had zero candidates in the
production sample). Sampled deterministically from `llm_calls` via the new
`diagnostics:continuity-grayzone-extract` script and labeled by two parallel
Sonnet subagents (TP / FP / AMB + subcategory).

Authoritative result file:
`output/continuity-grayzone/continuity-grayzone-results-2026-05-05T2257.md`
(gitignored — re-runnable from the JSONL panel + label JSONs in the same
directory using `scripts/analysis/continuity-grayzone-aggregate.ts`).

## Headline Numbers

Overall: 9 TP / 6 FP / 5 AMB across 20 findings (45% / 30% / 25%).

Per-stratum TP / FP / AMB (n=5 each):

| stratum | TP | FP | AMB |
|---|---|---|---|
| `continuity-facts/blocker` | 60% | 20% | 20% |
| `continuity-facts/warning` | 60% | 20% | 20% |
| `continuity-facts/nit` | 40% | 40% | 20% |
| `continuity-state/warning` | 20% | 40% | 40% |

Per-subcategory:

| subcategory | n | TP | FP | AMB |
|---|---|---|---|---|
| `object_emphasis` | 6 | 67% | 17% | 17% |
| `other` | 13 | 38% | 38% | 23% |
| `emotional_readiness_state` | 1 | 0% | 0% | 100% |
| `invented_entity` | 0 | — | — | — |
| `changed_core_action` | 0 | — | — | — |

The `invented_entity` and `changed_core_action` subcategories from the
refinement plan have zero natural occurrence on the continuity surface — those
failures fire on `halluc-ungrounded` and `chapter-plan-checker` respectively,
not on continuity. The continuity gray-zone taxonomy reduces in practice to
`object_emphasis` and an `other` bucket dominated by location/status/knowledge
mismatches with off-page transitions or figurative-aspiration evidence.

## What This Implies

- **Do not relax `continuity-facts` blocker or warning behavior on N=20
  evidence.** TP rate of 60% is meaningful catch density; the FP rate is
  acceptable and the misses are object-state contradictions worth catching.
- **`continuity-state/warning` is the dominant gray zone** — only 20% TP, with
  40% FP and 40% AMB. The dominant FP/AMB pattern is location/knowledge
  warnings firing when the prior chapter ended off-page in transit, when the
  chapter opens mid-action with implicit travel, or when figurative
  aspirations ("vowed to find...") are read as actual placements. A
  `continuity-state` calibration slice — possibly an off-page-transition
  hedge or a placement-vs-aspiration disambiguation — is the next legitimate
  intervention.
- **`continuity-facts/nit` has 40% FP** — nits are over-fired and either
  warrant a higher precision bar before promotion or a downstream-only gate.
- **The `object_emphasis` subcategory is well-calibrated** (67% TP, 17% FP).
  No relaxation needed.
- **Sample size N=20 is small.** Confidence intervals are wide; a follow-up
  panel of N≥50 stratified more thoroughly (especially `continuity-state`)
  is warranted before any production checker change.

## Stop Gate

(a) Clean pass: extractor + aggregator tests green, panel emitted and
labeled, per-stratum and per-subcategory rates computed, AMB rate 25% under
the 40% adjudication-design-issue threshold.

## Related

- Lane: `docs/sessions/2026-05-05-continuity-grayzone-panel.md`
- Experiment: `tuning_experiments` row #476
- Plan: `docs/authoring-harness-refinement-plan.md` Step 7 Investigation Set
  ("Checker gray zones") and `docs/todo.md` Authoring Visibility lane item.
- Tooling: `scripts/analysis/continuity-grayzone-extract.ts`,
  `scripts/analysis/continuity-grayzone-aggregate.ts`.
