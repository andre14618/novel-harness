---
status: active
date: 2026-05-06
decision: fact-role-ab-hold
---

# L82 Fact-Role Live A/B Hold - 2026-05-06

## Decision

Keep fact-role-aware drafting context opt-in and A/B-only. Do not promote
role-aware writer/checker policy to the production default from the capped
`fantasy-system-heretic` run.

The run proved the routing mechanism but not product value. Role-aware context
reduced the intended exposure surfaces:

- hidden writer facts: legacy 1 -> role-aware 0
- hidden continuity facts: legacy 1 -> role-aware 0
- reference continuity facts: legacy 1 -> role-aware 0

But both arms stopped at pending chapter-2 `plan-check-exhausted` gates, and
role-aware regressed cost and hallucination blockers:

- approved chapters: 1/2 in both arms
- blocker warnings: no improvement
- hallucination blockers: +1 role-aware regression
- cost: +$0.0109 role-aware regression

Evidence:

- `output/evals/fact-role-context-live-ab/fantasy-system-heretic-capped-20260505T213029/report.md`
- `output/evals/fact-role-context-live-ab/fantasy-system-heretic-capped-20260505T213029/summary.json`

The output directory is local evidence, not source-controlled truth. The
decision above is the durable record.

## Rationale

The policy mechanism behaves correctly, but promotion requires downstream value:
completion should not regress, blockers should not increase, hallucination
blockers should not regress, and cost should not increase. This run fails those
promotion gates.

The dominant next problem is semantic drafting behavior: chapter 2 repeatedly
missed planned Theo/record-alteration obligations and then gated on continuity
around Maret's hidden strength. Writer expansion also remains high even after a
clone-only five-beat cap.

## Implications

- Default runtime remains legacy.
- `factRoleContextPolicy: "role-aware"` remains an experiment override.
- Next work should diagnose semantic gate behavior and writer expansion before
  another live role-policy promotion attempt.
- Live A/B reports should include terminal gate evidence and an explicit
  promotion verdict so "mechanism worked" is not confused with "promote."

## Related

- Decision L79: `docs/decisions/L079-authoring-harness-eval-gates.md`
- Lane queue: `docs/sessions/lane-queue.md`
- Runner: `scripts/evals/fact-role-context-live-ab.ts`
