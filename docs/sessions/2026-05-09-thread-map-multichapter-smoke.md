# 2026-05-09 Thread Map Multi-Chapter Smoke

## Purpose

After the planner thread-ref prompt repair cleared a single chapter, run a small
multi-chapter planner-only sample to see whether the repaired contract holds
across more than one chapter before adding writer-context complexity.

## Inputs

Planner-only POC runs, all `deepseek-v4-flash`, `materiality-v1`, prompt version
`thread-ref-consistency-v2`:

- `output/corpus-recreation-poc/ch1-threadrefs-plan-repair-flash-20260509`
- `output/corpus-recreation-poc/ch2-threadrefs-plan-repair-flash-20260509`
- `output/corpus-recreation-poc/ch5-threadrefs-plan-repair-flash-20260509`

Combined thread map:

- `output/corpus-recreation-poc/threadrefs-plan-repair-flash-20260509-thread-map/thread-map.md`
- `output/corpus-recreation-poc/threadrefs-plan-repair-flash-20260509-thread-map/thread-map.json`

Manifest validation passed across 5 manifests.

## Result

The thread map separated true structural issues from future-horizon notes:

- movement rows: `20`
- counted issues: `3`
- horizon notes: `2`

The repaired prompt cleared chapter 1 but did not generalize cleanly:

- chapter 1: `promiseThreadMismatchCount=0`
- chapter 2: `promiseThreadMismatchCount=1`
- chapter 5: `promiseThreadMismatchCount=2`

All counted issues were the same class: relationship pressure on
`thread-tovin-leverage` reused a promise from another thread:

- `obl-ch02-sc02-tovin-refusal` used `debt-oathmark`
- `obl-ch05-sc01-tovin-leverage` used `debt-key-cost`
- `obl-ch05-sc01-tovin-knows-convoy` used `debt-oathmark`

The horizon notes are not failures:

- `debt-oathmark` has movement but no payoff row in the sampled chapters.
- `payoff-oathmark-public-confession` is not landed in the sampled chapters.

## Interpretation

Prompt-only thread-ref guidance is useful but insufficient. The planner still
tries to express "Tovin pressures Nara using an oath/key consequence" as one
relationship-thread obligation pointing at another thread's promise. The right
next slice is not writer-context. It is a planner-side repair or readiness
surface that makes cross-thread pressure explicit:

- split the relationship pressure obligation from the promise-progress
  obligation; or
- route the obligation to the promise's thread and express Tovin as the
  `sourceId`; or
- surface a Plan Readiness item before drafting.

Do not promote the prompt repair as sufficient from the single-chapter pass.

## Follow-Up Slice

`diagnostics:corpus-recreation-readiness` now turns deterministic
`threadRefConsistency` findings from `plan-comparison.json` into manual Plan
Readiness candidates. The readiness bridge also preserves `threadIds`,
`promiseIds`, and `payoffIds` alongside obligation, character, world, and source
IDs.

The readiness packet now includes deterministic repair hints for each mismatch:
the mismatched obligation id, the promise/payoff id, and the expected thread id
from the seed packet. These hints are advisory rewrite goals only; they do not
change the plan.

Output:

- `output/corpus-recreation-poc/threadrefs-plan-repair-flash-20260509-readiness/readiness.md`
- `output/corpus-recreation-poc/threadrefs-plan-repair-flash-20260509-readiness/readiness.json`

Result:

- groups: `2`
- findings: `2`
- label: `THREADREF-1`
- manifest validation: pass across 5 manifests

This keeps the next action manual: an operator or approved planning-edit agent
can split/reroute the cross-thread pressure before drafting, but the diagnostic
does not auto-mutate the plan.
