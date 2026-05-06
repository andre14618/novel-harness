---
status: recorded
updated: 2026-05-06
role: session-record
---

# Semantic Gate Diagnostics — 2026-05-06

This record captures why the semantic-gate diagnostic slice happened, what
commits landed, what evidence was produced, and what it means for the next
authoring-harness work. It is not an active single-lane contract.

## Why

The capped fact-role live A/B proved role-aware filtering mechanically worked,
but the product outcome was still `hold`: both arms stopped at chapter-2
Plan-Assist Gates, and role-aware regressed hallucination blockers and cost.
That made the next useful move diagnostic, not another writer/checker prompt
change.

The immediate question was whether the failure pattern was primarily:

- Chapter Plan shape: too many planned Beats for the target length.
- Writer expansion: too many prose words per planned Beat.
- Plan Adherence drift: prose changing or omitting planned actions.
- Continuity/checker behavior: blockers or warnings driving gates.
- Plan-Assist behavior: pending or resolved gate lineage.

## Commits

- `5262d62 feat: add writer expansion diagnostic`
  - Added `bun run diagnostics:writer-expansion -- --novel <id>`.
  - Separates over-planned Chapter Plans from writer over-expansion.
- `1df18f6 feat: add semantic gate diagnostic`
  - Added `bun run diagnostics:semantic-gate -- --novel <id>`.
  - Rolls up outline shape, draft expansion, Plan Adherence drift,
    checker blockers, and Plan-Assist lineage by chapter.
- `0d97ed8 refactor: share beat count assessment`
  - Moved beat-count assessment into `src/harness/beat-counts.ts` so
    diagnostics and planning use the same threshold math.
- `c7c280a feat: persist semantic gate evidence in fact-role ab`
  - Fact-role live A/B summaries now include semantic-gate evidence while
    disposable clone rows still exist.

## Evidence

Focused tests passed for the new diagnostics and A/B integration. The post-slice
supported fast tier passed:

```bash
bun run test:fast
```

Additional checks passed during the slice:

```bash
./node_modules/.bin/tsc --noEmit
bun run docs:weight
git diff --check
```

Current DB smoke:

```bash
bun run diagnostics:semantic-gate -- --novel fantasy-system-heretic
```

Observed signals:

- Chapter 1: `outline_shape`, `writer_expansion`, `plan_assist_gate`
- Chapter 2: `no_draft`, `outline_shape`, `plan_assist_gate`
- Chapter 3: `no_draft`, `outline_shape`

## Interpretation

The stored `fantasy-system-heretic` state now points first at Chapter Plan shape
and expansion pressure. That does not prove semantic drift is solved; it says
the next runtime change should start from evidence that compares plan shape,
draft length, drift, and gate behavior together.

The earlier capped A/B clone rows were cleaned, so future A/B runs must persist
the semantic-gate roll-up in their JSON/markdown summaries before cleanup. That
is now wired in `c7c280a`.

## Follow-Up

Use this record as input to the broader authoring harness program loop, not as
a one-off overnight lane. The next safe implementation sequence is:

1. Run semantic-gate diagnostics on candidate novels or fresh disposable runs.
2. Choose one low-risk, evidence-backed lever.
3. Add pure/focused tests and a replay or A/B signal before production default
   runtime changes.
4. Commit code and a durable docs record together.
