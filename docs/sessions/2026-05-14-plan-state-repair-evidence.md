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

The next useful work is not word-count policing. It is reviewing the five
scene-semantic readiness rows, especially ch9 scene 2 `worldFactPressure`
where the draft appears not to execute the required buyer-with-ledger fact, and
the four endpoint-landing rows where scenes do not land their concrete endpoint
inside the scene unit.
