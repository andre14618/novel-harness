---
status: active
date: 2026-05-06
decision: continuity-state-warning-panel-2026-05-06
---

# L83 Continuity-State Warning Panel — 2026-05-06

## Decision

An N=50 follow-up panel for `continuity-state/warning` found no true-positive
catch signal. Treat these warnings as diagnostic noise until a narrower
subclass proves value. Do not use raw `continuity-state/warning` counts as
evidence for planner/writer/checker runtime nudges.

This does not relax continuity blockers. Runtime already keeps location-state
violations warning-class and `buildCheckerBlockerDeviations()` promotes only
`blocker` issues into plan-assist gates.

## Evidence

Panel:
`output/continuity-grayzone/continuity-state-warning-n50-2026-05-06/continuity-grayzone-2026-05-06T112843109.jsonl`

Aggregate:
`output/continuity-grayzone/continuity-state-warning-n50-2026-05-06/aggregate/continuity-grayzone-results-2026-05-06T113728200.md`

Results:

| stratum | n | TP | FP | AMB |
|---|---:|---:|---:|---:|
| `continuity-state/warning` | 50 | 0 (0%) | 44 (88%) | 6 (12%) |

Polarity split:

| polarity | n | TP | FP | AMB |
|---|---:|---:|---:|---:|
| `ambiguous` | 47 | 0 (0%) | 41 (87%) | 6 (13%) |
| `negative` | 3 | 0 (0%) | 3 (100%) | 0 (0%) |

Dominant FP pattern: ordinary off-page travel, explicit scene transitions,
same-complex location movement, vague prior-state placement, or knowledge that
could plausibly have been learned off-page.

## Implications

- Keep continuity-facts behavior unchanged; L81 did not justify relaxing
  facts blocker/warning behavior.
- Keep continuity-state blockers in force for clear knowledge impossibility or
  explicit same-time location contradiction.
- `diagnostics:checker-warnings` now classifies `continuity-state/warning` as
  `calibration=low-confidence` while leaving the finding visible.
- Any prompt/runtime change to reduce warning generation still needs a replay
  or A/B check because prompt changes can shift blocker behavior.

## Related

- Parent decision: `docs/decisions/L081-continuity-grayzone-panel-2026-05-05.md`
- Session record: `docs/sessions/2026-05-06-semantic-gate-diagnostics.md`
- Tools: `scripts/analysis/continuity-grayzone-extract.ts`,
  `scripts/analysis/continuity-grayzone-aggregate.ts`
