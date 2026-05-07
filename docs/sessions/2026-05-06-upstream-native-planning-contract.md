---
status: active
updated: 2026-05-06
role: session-record
---

# Upstream Native Planning Contract

## Change Packet

- Phase/surface: concept/planning, specifically `planning-plotter`,
  `planning-beats`, planning enforcement, and planner-isolated diagnostics.
- Exact change: add default-off `pipelineOverrides.nativePlanningContractV1`.
  The plotter names a chapter contract in purpose text; beat expansion authors
  native story-turn beats; enforcement retries/rejects over-fragmented chapters
  without slicing or packing.
- Expected benefit: test realistic upstream planning shape instead of
  downstream calibration over unrealistic source outlines.
- Downstream projection: persisted `chapter_outlines.scenes` should carry
  fewer, denser native beats; state mapping attaches obligations to those
  native beats; drafting/checkers can then evaluate the new source shape.
- Evidence gate: focused unit tests, typecheck, docs gates, and planner-only
  smoke before any downstream drafting comparison.
- Non-goal: no production default, no hard cap promotion, no `calibrated:packed`
  promotion, no new creative heuristic blocker.

## Implementation

- Added `nativePlanningContractV1` to `SeedInput.pipelineOverrides` and
  `src/config/pipeline.ts`.
- `planning-plotter` context now adds native chapter-contract guidance only
  when the flag is enabled.
- `planning-beats` context now adds native story-turn guidance and retry
  feedback only when the flag/retry path applies.
- Planning enforcement rejects over-fragmented native-contract outlines above
  `recommendedBeats + 1`.
- Planning retries under-planned chapters as before; native-contract runs also
  retry over-fragmented chapters before final enforcement.
- `scripts/test-planner-isolated.ts` accepts `--native-planning-contract` and
  reports per-chapter beat counts.

## Smoke Evidence

Command:

```bash
bun scripts/test-planner-isolated.ts phase-parity-smoke --native-planning-contract
```

Result:

- Novel: `test-planner-phase-parity-smoke-1778112963497`
- Scope: concept -> planning only.
- Chapter 1 target: `1500w`
- Beat count: `5`
- Calls: `planning-plotter`, `planning-beats`, `planning-state-mapper`
- Truncation: `0`
- Minimum headroom: `70%`

The generated chapter purpose named the jammed bell, failing wall, Kade's
dismissal, and Mira's decision to seek Orin. The beat list was five native
story-turn beats rather than a sliced or packed legacy outline.

## Controlled Comparison

The first legacy-vs-native run reran concept for both arms. That was the wrong
comparison shape because the world, story spine, and character profiles drifted
between arms. The corrected run used
`scripts/variant/clone-for-variant.ts --target-phase concept-done` to freeze one
concept output and replan it twice.

Source concept:

- `test-planner-fantasy-system-heretic-1778113870729`

Arms:

- Legacy: `native-contract-controlled-legacy-1778113870729`
- Native: `native-contract-controlled-native-1778113870729`

Evidence logs:

- `output/evals/planner-isolated/native-contract-fantasy-system-heretic-20260506/controlled-legacy.log`
- `output/evals/planner-isolated/native-contract-fantasy-system-heretic-20260506/controlled-native.log`

Summary:

| Arm | Beat Counts | Total Beats | Planner Headroom | Mapper Headroom | Warning |
| --- | --- | ---: | ---: | ---: | --- |
| legacy | `ch1=8/2000w`, `ch2=8/2500w`, `ch3=8/2500w` | 24 | 86% | 36% | dropped non-forward payoff link |
| native | `ch1=5/1500w`, `ch2=6/1800w`, `ch3=7/2000w` | 18 | 88% | 53% | none visible |

What improved:

- Native produced the target-sized beat counts expected for the current writer.
- Native lowered total beats by 25% without post-hoc slicing or packing.
- Native lowered state-mapper pressure and avoided the visible payoff-link
  sanitation warning.

What remains uncertain:

- Native may have reduced Theo's relational role in chapter 2 despite listing
  him as present.
- Native chapter 3 ended closer to a decision/hook than a completed exposure,
  so endpoint satisfaction needs scoring.
- Planner-only evidence does not prove the writer can draft better prose from
  this plan.

## Next

## Planner-Quality Diagnostic

Added `scripts/analysis/planner-quality-report.ts` as a read-only diagnostic
for existing `chapter_outlines`. It reports beat-budget fit, declared endpoint
overlap with the final beat, listed-character materiality in beat text, weak
story-turn beats, and obligation coverage. Evidence was saved beside the
planner logs:

- `output/evals/planner-isolated/native-contract-fantasy-system-heretic-20260506/planner-quality-legacy.txt`
- `output/evals/planner-isolated/native-contract-fantasy-system-heretic-20260506/planner-quality-native.txt`

Results:

| Arm | Beats | Endpoint Issues | Inactive Listed Characters | Weak Story-Turn Beats | Obligation Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| legacy | 24 | 2 | 1 | 5 | 0 |
| native | 18 | 3 | 2 | 3 | 0 |

Interpretation:

- Native remains better on mechanical shape and weak story-turn count.
- Native is not a clean story-quality win: it has more endpoint issues and
  more listed-character materiality gaps.
- This supports the user correction: beat-count calibration is not the target
  by itself. The useful next lever is upstream concept/planning contract
  quality: endpoint landing, character materiality, and story-function
  allocation before drafting.

## Next

Use the planner-quality evidence to choose either an upstream
concept/planning-contract revision or a controlled drafting comparison. Do not
continue downstream beat calibration as the active product direction.
