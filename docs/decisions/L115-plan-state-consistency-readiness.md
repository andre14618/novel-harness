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
- Live source audit on `rillgate-ch4-endpoint-hygiene-1778723371`: 9 chapter
  pairs, latest pass 3 findings, 3 open imported readiness items after staling
  8 prior same-import rows.
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
