# Rillgate Story-Shape Evidence

Date: 2026-05-14
Lane: L109 mercenary-progression adventure, production path
Source: `rillgate-ch4-endpoint-hygiene-1778723371`

## Goal

Produce a full repaired-source Rillgate production draft, evaluate it against
the mercenary-progression adventure loop, apply only high-impact upstream
planning edits through reviewed `planning_edit`, and redraft bounded windows
until the source is ready for a serious coherent write candidate.

## Full Production Run

Run: `rillgate-storyshape-full-1778795211-production-path`

- Drafted 10/10 chapters on the production path.
- Words: 30,899 / 31,000 (0.997 mean ratio).
- Plan-Assist readiness: 0 rows.
- Checker readiness: 28 warnings, 0 blockers, 0 weight-bearing.
- Prose semantic: 40 rows, 0 lows.
- Scene semantic: 166 tasks, 1 low, 0 errors.
- Scene-semantic low: ch2 scene 5 `worldFactPressure` was a real issue; the
  departure from Rillgate functioned as passage instead of making the unwitnessed
  contract status operational.

Story-shape read:

- MPA-01 through MPA-10 are preserved: hub pressure, contract offer, crew
  friction, arena entry, tactical win, job complication, progression trial,
  faction reveal, contract climax, return/hook.
- Strongest surfaces: clear contract objective, mine arena constraints,
  Tessa rival-to-witness movement, illegal-core faction consequence, and
  Ashfall/next-contract hook.
- Weakest surface found by evidence: ch2 departure needed the contract-law
  weakness to cost Kael on page.

## Upstream Edits

All source mutations went through reviewed `planning_edit` proposals.

- `planning_edit:rillgate-ch4-endpoint-hygiene-1778723371:22805c139ba1a477`
  replayed the approved ch2 scene replacement from the evidence target back to
  the clean source. The scene now requires the eastern gate log to mark Kael as
  unwitnessed and cost him the road-toll coin.
- `planning_edit:rillgate-ch4-endpoint-hygiene-1778723371:b18152f7948dc2d9`
  removed `fact-core-clean-payout-risk` from ch8 `establishedFacts` because no
  ch8 scene established it; ch9 scene 1 already dramatizes the clean-payout
  offer.
- `planning_edit:rillgate-ch4-endpoint-hygiene-1778723371:5a2ac79852d7b315`
  clarified the ch8-to-ch9 handoff so split routes converge at the only usable
  exit after Tessa is intercepted.

The first replay also exposed and fixed a reusable tool gap:
`scripts/analysis/planning-edit-replay.ts` now previews structural
`self`/`requirements` edits against the artifact target while still replaying
the original structural proposal target.

## Bounded Proof

Run: `rillgate-ch2-departure-pressure-1778796781-production-path`

- Drafted ch2 only from the repaired source.
- Words: 3,274 / 3,100 (1.056 ratio).
- Plan check: passed.
- Continuity: passed.
- Plan-Assist readiness: 0 rows.
- Checker readiness: 9 warnings, 0 blockers, 0 weight-bearing.
- Prose semantic: 4 rows, 0 lows.
- Scene semantic: 18 tasks, 0 lows; worldFactPressure 0/4.

Final source audits after all planning edits:

- Planner quality: 10 chapters, 49 scenes, endpointIssues=0,
  obligationErrors=0, readiness groups=0. Residual note:
  `overloadedObligations=1` on ch10 is non-readiness telemetry.
- Plan-state consistency: 9/9 adjacent pairs clean, 0 findings.

## Stop Condition

Stop condition reached: the source now has a clean story-shape repair proof,
clean plan-state handoffs, no planner-quality readiness items, and a bounded
redraft demonstrating the only full-run semantic low cleared. The next sensible
step is a fresh full coherent candidate draft from the repaired source, not more
micro-repair on this run.
