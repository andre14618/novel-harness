---
status: active
date: 2026-05-06
role: decision-record
---

# L086: Calibrated Planner Shape, Not Hard Beat Caps

## Decision

Do not promote hard chapter beat caps as a production default from the current
semantic-gate cohorts.

The next planning runtime candidate should be an experimental calibrated
planner-shape pass: choose a beat budget from target length and source
obligations, then pack required causal, emotional, character, canon, and ending
obligations into the fewest sufficient load-bearing beats.

Keep this diagnostic/A-B-only until cohort evidence shows that it preserves
semantic stability while reducing length, cost, and retry pressure.

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
- Future A/B variants should include `calibrated-packed` or equivalent against
  `control:source`, `capped4`, and `capped5`.
- Promotion requires evidence that the calibrated arm approaches capped-arm
  length/cost while maintaining control-like semantic stability.
- Richer character/world/plot work should wait until this shape can carry
  obligations through planning into prose without full rewinds.

## Experiment Throughput Note

The first accelerated cohort attempt failed due to Postgres connection fanout,
not authoring quality. Eval runners now default child processes to
`BUN_SQL_MAX=1`, and the LXC Postgres service has been tuned for local
experiment fanout. See `docs/how-to/semantic-gate-experiments.md`.

