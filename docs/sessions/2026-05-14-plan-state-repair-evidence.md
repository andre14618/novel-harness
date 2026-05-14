# Plan-State Repair Evidence

Date: 2026-05-14

## Objective

Close the current Rillgate source plan-state handoff gaps on the main
production path, then run a coherent drafting pass with telemetry to see
whether the next full draft is cleaner.

## Source Repairs

- Source: `rillgate-ch4-endpoint-hygiene-1778723371`.
- Reviewed source readiness items were applied through normal
  `planning_edit` proposals, not direct DB patching.
- Repaired handoffs: ch3-to-ch4 crew descent, ch5-to-ch6 route/physical-state
  continuity, ch8-to-ch9 split-route handoff, ch6-to-ch7 brief costly
  iron-thread use, and related ledger/ward wording.
- Harness repair: adjacent-pair packets no longer feed chapter N+1
  `establishedFacts`, `characterStateChanges`, or `knowledgeChanges` as
  opening state; those are later chapter outputs.
- Harness repair: scene `opposition` is an exact repair target.
- Harness repair: the source judge now allows a plausible intended plan to be
  executed offscreen across a chapter break.
- Final source audit:
  `output/plan-state-consistency/rillgate-ch4-endpoint-hygiene-1778723371/source-post-draft-repair/`;
  9 adjacent pairs, 0 findings.

## Draft Evidence

- Target: `rillgate-planstate-clean-1778788667-production-path`.
- Command shape: `test-drafting-isolated --writer-arms production-path
  --quality-telemetry-packet --scene-semantic-readiness-import
  --scene-semantic-max-tokens 12000`.
- Drafted chapters: `10/10`.
- Words: `31,889/31,000`, mean ratio `1.029`.
- Writer expansion events: `0`.
- Writer brief events: `50/50`, `scene-budget-tight-anchored-v1`.
- Plan-Assist readiness: `0`.
- Planning-context gaps: `0`; readiness sidecar surfaced 6 unresolved
  reference-context candidates.
- Checker readiness: `15` items, `0` blockers, `0` weight-bearing rows,
  `8` advisory, `7` noise.
- Production-clean: yes.
- Prose semantic: `0/40` lows, no errors; length not falsified as padding.
- Scene semantic: `166` tasks, `30` skips, `0` errors, `5` lows.

## Comparison

Baseline: `rillgate-coherent-prod-1778761633-production-path`.

- Words: `31,676` → `31,889` (`+213`).
- Plan-Assist readiness: `0` → `0`.
- Checker blockers: `2` → `0`.
- Weight-bearing checker rows: `2` → `0`.
- Prose-semantic lows: `0` → `0`.
- Scene-semantic lows: `4` → `5`.
- Compare artifact:
  `output/drafting-isolated/rillgate-planstate-clean-1778788667/compare-vs-coherent-prod.md`.

## Interpretation

The plan-state repair work materially improved the production-clean signal:
the prior full draft's weight-bearing chapter 9 checker blockers are gone.
This does not promote the draft surface as globally better because the
scene-semantic replay is mixed and one row regressed.

## Semantic Low Adjudication

Follow-up review found that the four endpoint rows were false positives from an
over-strict endpoint rubric. The rubric required the final action itself to
resolve the choice, even when the scene contract declared an unresolved choice,
offer, pressure point, or valid follow-through hook. After the rubric patch,
targeted endpoint replay over chapters 2, 3, 5, and 6 produced 20 endpoint
tasks, 0 lows, `ENDPOINT-2:3`, and `ENDPOINT-3:17`.

Those four endpoint Plan Readiness rows on
`rillgate-planstate-clean-1778788667-production-path` were marked
`not_applicable`.

The ch9 scene 2 `worldFactPressure` low reproduced and is real enough to keep
open: the scene contract says the buyer escapes with the main core ledger, but
the prose has him drop a hollow ledger after removing key pages. Next work is
to reconcile the plan/prose fact shape by either changing the required fact to
buyer-escapes-with-key-pages or redrafting the scene so he keeps the ledger.

## Ch9/Ch10 Follow-Up Repairs

The ch9 buyer/ledger miss was repaired upstream on source
`rillgate-ch4-endpoint-hygiene-1778723371` through reviewed `planning_edit`
proposals:

- `planning_edit:rillgate-ch4-endpoint-hygiene-1778723371:7017a70dda22e1a3`
  updated ch9 `establishedFacts`.
- `planning_edit:rillgate-ch4-endpoint-hygiene-1778723371:64a2028e22343ab7`
  replaced ch9 scene 2 so the buyer escapes with key identifying pages and
  leaves the hollow ledger shell.
- `planning_edit:rillgate-ch4-endpoint-hygiene-1778723371:583baa27196466d7`
  replaced ch9 scene 3 so Kael finds a torn partial page in that shell.
- `planning_edit:rillgate-ch4-endpoint-hygiene-1778723371:0a83861538a4e406`
  tightened ch9 scene 5 endpoint wording around the torn page.

Bounded evidence:
`rillgate-ch9-ledger-repair-1778793880-production-path` drafted ch9-ch10 at
`6,622/6,200` with Plan-Assist readiness `0`, checker readiness `0`,
prose-semantic lows `0/8`, scene-semantic lows `1/30`, and
world-fact lows `0/7`. The repaired ch9 WFACT row cleared. The lone new low was
a real ch10 scene 3 endpoint miss: the plan said Mira's marker was protected,
but the draft left Hask contesting the marker.

That ch10 endpoint row was adjudicated as `upstream_repair_needed` in
`output/scene-semantic-review/rillgate-ch9-ledger-repair-1778793880/production-path/scene-semantic-readiness-adjudicated.json`
and imported to source Plan Readiness as
`readiness-41ce6df2a0ec6d3bdb865334908f5942`. The source repair was applied
through `planning_edit:rillgate-ch4-endpoint-hygiene-1778723371:d195a3ea8c9d2cea`,
replacing ch10 scene 3 so Hask stamps and surrenders the canceled marker on
page while Kael's pledged token carries the future cost.

Verification:
`rillgate-ch10-marker-endpoint-1778794476-production-path` drafted ch10 at
`2,611/3,100` with Plan-Assist readiness `0`, checker readiness `0`,
prose-semantic lows `0/4`, scene-semantic lows `0/15`, endpoint lows `0/4`,
world-fact lows `0/4`, and source plan-state findings `0`. The ch10-only
planning-context audit reported bounded-window gaps for reader-info state and
resolved references, but generated no readiness items; this is an artifact of
starting at chapter 10 without prior drafted chapters, not a source-plan repair
blocker.
