---
status: active
date: 2026-05-14
---

# L115: Plan-State Consistency Readiness

## Decision

Production source hygiene includes an adjacent-chapter plan-state consistency
audit before drafting evidence runs. The audit compares chapter N's declared end
state to chapter N+1's opening plan, uses DeepSeek V4 Flash structured semantic
judgment by default in `test-drafting-isolated`, and emits Plan
Readiness-compatible repair targets for exact chapter/scene fields.

Chapter-level `establishedFacts[]` may now carry optional `factStatus`:
`completed`, `intended`, `pending`, or `belief`. Missing status preserves legacy
behavior and is interpreted as completed by the consistency audit. The
state-mapper prompt instructs the model that a decision or intent is not the
same as a completed action.

Checker readiness now groups same-target findings and Plan Readiness imports the
group as one item with all finding evidence preserved. Drafting still does not
hard-block on continuity findings by default; instead, drafting-isolated reports
mark arms with weight-bearing checker rows as not production-clean.

Repeated plan-state imports replace the same import lane by staling open or
deferred rows absent from the fresh aggregate while preserving current item IDs
and resolved operator dispositions.

Amended 2026-05-14: the adjacent-pair packet treats chapter N+1
`establishedFacts`, `characterStateChanges`, and `knowledgeChanges` as later
chapter outputs, not opening handoff state. They are excluded from the
next-chapter packet so the judge compares chapter N's end state only against
chapter N+1's purpose and opening scenes. Scene `opposition` is now an explicit
repair target, and the judge prompt allows plausible offscreen execution of an
intended plan across a chapter break instead of forcing every intended action to
be rewritten as completed.

## Rationale

The Rillgate full draft exposed an upstream plan contradiction: chapter 8
planned Kael and Tessa splitting routes, while chapter 9 required them together
at the mine exit. Prose retries cannot reliably repair an inconsistent plan
contract. The right repair surface is the chapter/scene plan field that creates
the handoff.

Continuity checkers have a false-positive history, so L084's no-hard-block
posture remains. L115 makes high-value contradictions visible and reviewable
before drafting/promotion without reviving noisy generation stops.

## Evidence

- `scripts/analysis/plan-state-consistency-report.ts`
- `output/plan-state-consistency/rillgate-ch4-endpoint-hygiene-1778723371/source/`
- `output/plan-state-consistency/rillgate-ch4-endpoint-hygiene-1778723371/source-post-draft-repair/`
- Live source audit on `rillgate-ch4-endpoint-hygiene-1778723371`: latest pass
  9 chapter pairs, 0 findings after reviewed `planning_edit` repairs.
- `rillgate-planstate-clean-1778788667-production-path`: 10/10 chapters,
  31,889/31,000 words, Plan-Assist 0, prose-semantic lows 0/40,
  scene-semantic lows 5/166, checker blockers 0, weight-bearing checker rows 0.
- Targeted tests:
  - `bun test scripts/analysis/plan-state-consistency-report.test.ts`
  - `bun test scripts/analysis/checker-readiness-report.test.ts`
  - `bun test scripts/test-drafting-isolated.test.ts`
- `./node_modules/.bin/tsc --noEmit`

## Implications

- New source audits should inspect plan-state readiness before spending a full
  drafting pass.
- `factStatus` is additive; legacy plans remain valid.
- If live semantic review fails on one pair, the artifact remains usable and
  records the pair error instead of dropping the full report.
