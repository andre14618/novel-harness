---
status: superseded
date: 2026-05-06
role: decision-record
---

# L086: Calibrated Planner Shape, Not Hard Beat Caps

## Decision

Do not promote hard chapter beat caps as a production default from the current
semantic-gate cohorts.

This record originally selected an experimental calibrated planner-shape pass
as the next diagnostic candidate: choose a beat budget from target length and
source obligations, then pack required causal, emotional, character, canon, and
ending obligations into the fewest sufficient load-bearing beats.

L088 supersedes that as the product direction. Downstream packing remains
diagnostic evidence for the failure class; new product work should move
upstream into concept/planning and prove story quality with planner-quality or
drafting evidence.

## Evidence

The accelerated N=10 semantic-gate cohort compared:

- `control:source`: use the source chapter outline exactly as stored.
- `capped4:beats=4`: disposable clone with a 4-beat planning cap.
- `capped5:beats=5`: disposable clone with a 5-beat planning cap.

Result:

| Variant | Completed | Clean Pass | Mean Risk | Mean Word Ratio | Cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| `control:source` | 7/10 | 7 | 425.58 | 3.57 | `$0.2096` |
| `capped5:beats=5` | 7/10 | 4 | 530.11 | 1.37 | `$0.0905` |
| `capped4:beats=4` | 7/10 | 3 | 534.89 | 0.98 | `$0.0726` |

Artifacts:

- `output/evals/semantic-gate-cohort-matrix/accelerated-top10-p8-20260506T200315Z/summary.json`
- `output/evals/semantic-gate-cohort-matrix/accelerated-top10-p8-20260506T200315Z/report.md`

Illustrative source, `novel-1777573197451`, target `2000` words:

| Variant | Beats | Completed | Words | Signals |
| --- | ---: | --- | ---: | --- |
| `capped4` | 4 | yes | 1519 | `plan_adherence_drift` |
| `capped5` | 5 | yes | 2040 | none |
| `control` | 15 | yes | 5984 | `outline_shape`, `writer_expansion` |

This source shows the desired shape: fewer beats can hit target length, but a
too-small or blunt cap can lose planned meaning. The cohort as a whole did not
show a universal winner.

## Rationale

The source-outline control arm was semantically safer in this N=10 sample, but
it was far too long and more expensive. The hard-cap arms were shorter and
cheaper, but they introduced more Plan-Assist and plan-drift risk.

Therefore the product problem is not simply "use fewer beats." It is "retain
the plan's load-bearing obligations while avoiding over-expanded beat lists."

A calibrated planner-shape pass should:

- derive a beat budget from chapter target words and observed words-per-beat;
- identify required chapter obligations before writing;
- assign every required obligation to a beat;
- preserve the chapter endpoint and emotional turn;
- reject or revise plans where a beat has no concrete story turn;
- emit evidence showing which obligations were packed into each beat.

## Implications

- `planningMaxBeatsPerChapter` remains an experiment seam, not a production
  default.
- Historical A/B variants included `calibrated-packed` against
  `control:source`, `capped4`, and `capped5`; keep those results as diagnostic
  evidence, not a runtime roadmap.
- Under L106, live semantic-gate baseline/matrix/cohort commands require
  explicit disposable flags before they create cloned novels.
- Downstream packing should not be promoted as the active product lever.
- Richer character/world/plot work should now be evaluated through upstream
  concept/planning contracts, planner-quality scoring, and downstream drafting
  evidence.

## Experiment Throughput Note

The first accelerated cohort attempt failed due to Postgres connection fanout,
not authoring quality. Eval runners now default child processes to
`BUN_SQL_MAX=1`, and the LXC Postgres service has been tuned for local
experiment fanout. See `docs/how-to/semantic-gate-experiments.md`.

## 2026-05-06 Update — calibrated:packed v1 evidence

A deterministic v1 of `calibrated:packed` shipped at commit
`f8057d44dfdbd3bf2578bd79637919b89193184f` (helper at
`src/harness/beat-packing.ts`, wired through the cohort matrix and baseline
runner). v1 derives `budget = recommendedBeatCountForTarget(targetWords)`
per chapter, anchors first/last source beats, and greedily merges adjacent
middle beats by lowest combined obligation density (with a smaller-merged-group
tie-break) until the budget is met. Merged beats serialize as
"Packed from source beats X-Y:" bullet lists; obligations + payoff links
are remapped to packed indices. v1 is experiment-only, no LLM cost added,
and never wired into runtime planning.

Cohort `calibrated-packed-cohort-20260506T215726Z` (N=12 sources × 4 variants
× 1 chapter, experiment #479):

| Variant | Completed | CleanPass | Mean Ratio | Cost |
| --- | ---: | ---: | ---: | ---: |
| `control:source` | 10/12 | 10 | 3.38 | `$0.2412` |
| `calibrated:packed` | 10/12 | 10 | 1.76 | `$0.1568` |
| `capped5:beats=5` | 11/12 | 3 | 1.58 | `$0.1349` |
| `capped4:beats=4` | 11/12 | 2 | 1.17 | `$0.0884` |

Status: **HOLD / diagnostic evidence only** on the L086 promotion targets.

- PASS — clean-pass count ties control (10 vs 10).
- PASS — cost 65% of control (target < 70%).
- PASS — plan-drift count no worse than better hard-cap (`plan_adherence_drift`
  fires on most capped rows but on zero calibrated rows).
- PASS — every audit emits `droppedObligationKeys: []` and
  `droppedPayoffLinks: 0` (15 obligations preserved on the obligation-rich
  smoke source `novel-1777782552884`).
- NEAR-PASS — completion 10/12 vs better hard-cap 11/12.
- NEAR-PASS — mean word ratio 1.76 vs target < 1.75.

Both calibrated gate failures (`pp2-floor__prompt__fantasy-debt__1776557952`,
`pp2-floor__prompt__fantasy-cartographer__1776557952`) are
`integrity-exhausted` writer-side prose-duplication faults; packing audits
on both show clean obligation preservation. The strongest single-source win
is `novel-1776690840208`, where control gated, both capped arms gated with
`no_draft`+`checker_blocker`, and calibrated completed cleanly at 1953
words.

Interpretation: the L086 diagnostic hypothesis holds at this scale, but the
production framing is wrong. A deterministic obligation-preserving repacker can
measure whether fewer beats help without dropping obligations, but it is still
repairing an unrealistic source artifact after the fact. L088 supersedes
`calibrated:packed` as the next active lever: concept/planning should author a
native chapter contract and native story-turn beats upstream, then downstream
drafting/checking should be evaluated from that source.

Artifacts:

- `output/evals/semantic-gate-cohort-matrix/calibrated-packed-cohort-20260506T215726Z/summary.json`
- `output/evals/semantic-gate-cohort-matrix/calibrated-packed-cohort-20260506T215726Z/matrices/*/summary.json`
- `output/evals/semantic-gate-cohort-matrix/calibrated-packed-cohort-20260506T215726Z/matrices/*/variants/calibrated/calibrated-packing/*-ch1.json`
- Session record: `docs/sessions/2026-05-06-pickup-planner-shape-baseline.md`
