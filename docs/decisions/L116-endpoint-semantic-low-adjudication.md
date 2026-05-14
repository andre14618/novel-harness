---
status: active
date: 2026-05-14
---

# L116: Endpoint Semantic Low Adjudication

## Decision

Endpoint scene-semantic review must respect the declared scene endpoint shape.
When a scene contract declares an unresolved choice, offer, forced
consideration, or pressure point, the endpoint may land by creating that
concrete pressure. The judge should not require the choice to resolve inside
the same scene unless the contract declares that resolution.

A brief follow-through hook after the endpoint also does not make the endpoint
weak when it directly follows from the endpoint consequence.

## Rationale

The Rillgate full-draft replay produced four `ENDPOINT-1` rows where the prose
actually fulfilled the declared scene endpoint but the old rubric over-weighted
whether the final action itself resolved the choice. That made valid
scene-ending pressure look like a repairable failure and polluted Plan
Readiness with false positives.

## Evidence

- Old raw scene-semantic run:
  `output/scene-semantic-review/rillgate-planstate-clean-1778788667/production-path/`
  reported 5 lows.
- Targeted endpoint adjudication after the rubric correction:
  `output/scene-semantic-review/rillgate-planstate-clean-1778788667/endpoint-low-adjudication-1778790500/`
  reported 20 endpoint tasks, 0 lows, `ENDPOINT-2:3`, `ENDPOINT-3:17`.
- Targeted world-fact adjudication:
  `output/scene-semantic-review/rillgate-planstate-clean-1778788667/worldfact-low-adjudication-1778790500/`
  reproduced the ch9 scene 2 `WFACT-0` row.
- Plan Readiness dispositions on
  `rillgate-planstate-clean-1778788667-production-path`: four endpoint rows are
  `not_applicable`; the ch9 buyer-with-ledger world-fact row was later repaired
  upstream under L117.

## Implications

- Endpoint semantic lows remain advisory data, not blockers.
- Future endpoint readiness imports should be less noisy around valid
  unresolved-choice scene endings.
- The remaining real Rillgate issue from this pass was a contract/prose
  mismatch: the plan said the buyer escapes with the main core ledger, while
  the draft had the buyer escape after removing key pages and dropping the
  hollow ledger. L117 records the follow-up repair posture.
