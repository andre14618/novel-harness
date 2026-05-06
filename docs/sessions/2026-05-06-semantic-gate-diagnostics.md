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
- `a761935 feat: add semantic gate candidate scanner`
  - Added `bun run diagnostics:semantic-gate-candidates -- --limit N`.
  - Ranks novels by pending Plan-Assist Gates, checker blockers, Plan
    Adherence drift, writer expansion, outline shape, and missing drafts.
- `15e5ac6 feat: tag checker finding polarity in diagnostics`
  - Checker-warning diagnostics now classify findings as negative, positive, or
    ambiguous so consistency-shaped blockers are visible before gate changes.
- `99ae892 feat: add polarity filters to continuity panel`
  - Continuity gray-zone extraction now carries finding polarity and supports
    `--polarity positive` samples for adjudicating consistency-shaped blockers.
- `4bceed5 feat: aggregate continuity labels by polarity`
  - Labeled continuity-panel summaries now include per-polarity TP/FP/AMB rates.

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
bun run diagnostics:semantic-gate-candidates -- --limit 5 --scan-limit 20
```

Observed signals:

- Chapter 1: `outline_shape`, `writer_expansion`, `plan_assist_gate`
- Chapter 2: `no_draft`, `outline_shape`, `plan_assist_gate`
- Chapter 3: `no_draft`, `outline_shape`
- Candidate scan returned three `critical` novels and two `medium` novels from
  the latest 20; `fantasy-system-heretic` ranked second with one pending gate,
  one writer-expansion chapter, three outline-shape chapters, and two no-draft
  chapters.
- The top candidate (`novel-1777786463873`) had four checker blockers; two
  were positive-polarity continuity-facts blockers whose reasoning said the
  prose was consistent with the fact.
- `bun run diagnostics:continuity-grayzone-extract -- --per-stratum 2
  --polarity positive` found 45 positive-polarity continuity findings in the
  local DB, including seven continuity-facts blockers.
- Aggregate smoke over a positive-polarity sample emitted a `Per-polarity rates`
  table, so adjudicated labels can now quantify support-echo false positives.

## Interpretation

The stored `fantasy-system-heretic` state now points first at Chapter Plan shape
and expansion pressure. That does not prove semantic drift is solved; it says
the next runtime change should start from evidence that compares plan shape,
draft length, drift, and gate behavior together.

The top scanner candidate also shows a checker-calibration risk: some
continuity-facts blocker rows can be consistency echoes rather than negative
contradictions. Keep that diagnostic-only until an adjudicated sample or replay
shows a deterministic runtime filter is safe.

The continuity gray-zone panel can now provide that adjudication sample without
changing gates: filter to `--polarity positive`, label the sample, then decide
whether a deterministic support-echo filter is justified.

The earlier capped A/B clone rows were cleaned, so future A/B runs must persist
the semantic-gate roll-up in their JSON/markdown summaries before cleanup. That
is now wired in `c7c280a`.

## Follow-Up

Use this record as input to the broader authoring harness program loop, not as
a one-off overnight lane. The next safe implementation sequence is:

1. Use `diagnostics:semantic-gate-candidates` to pick candidate novels or fresh
   disposable runs.
2. Choose one low-risk, evidence-backed lever.
3. Add pure/focused tests and a replay or A/B signal before production default
   runtime changes.
4. Commit code and a durable docs record together.
