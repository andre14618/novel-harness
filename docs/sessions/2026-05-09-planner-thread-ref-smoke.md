# 2026-05-09 Planner Thread-Ref Smoke

## Purpose

L093 needed a narrow check before more writer-context experiments: can the
planner keep `threadId`, `promiseId`, and `payoffId` internally consistent
before drafting?

This targets the upstream plan contract. Expected benefit: fewer downstream
confounds when comparing prose or writer-context arms, because the plan no
longer assigns one thread's promise/payoff refs to another thread's obligation.

## Change

- Added stable planner instructions that:
  - `promiseId` must use its story debt's `threadId`;
  - `payoffId` must use its payoff's `threadId`;
  - `payoffId` must match the declared `promiseId`;
  - cross-thread scene pressure should be split into separate obligations.
- Recorded planner prompt version as `thread-ref-consistency-v2` in diagnostic
  run manifests.
- Normalized nullable optional model fields (`threadId`, `promiseId`,
  `payoffId`, `materialityTest`) to `undefined` during plan parsing. This is a
  schema cleanup, not a semantic pass.

## Evidence

Fresh planner-only smoke:

```bash
bun run diagnostics:corpus-recreation-poc -- \
  --output-dir output/corpus-recreation-poc/ch1-threadrefs-plan-repair-flash-20260509 \
  --live \
  --model deepseek-v4-flash \
  --max-tokens 12000 \
  --planner-variant materiality-v1
```

Plan comparison result:

- `issues`: `[]`
- `promiseThreadMismatchCount`: `0`
- `payoffThreadMismatchCount`: `0`
- `orphanPayoffRefCount`: `0`
- `knownThreadRefCount`: `4 / 4 scenes`

Thread-map output:

- `output/corpus-recreation-poc/ch1-threadrefs-plan-repair-flash-20260509/thread-map.md`
- Movement rows increased to 6.
- After the horizon-classification slice, thread-map issues are `0` and
  horizon notes are `4`. Opened promises with no local payoff now render as
  `open_promise_no_report_payoff` / `planned_payoff_not_in_report` notes
  instead of counted issues. Horizon notes are evaluated across all provided POC
  dirs, so a later sampled chapter can clear an earlier setup note by landing
  the payoff.

Manifest validation passed:

```bash
bun run diagnostics:run-manifest-validate -- \
  output/corpus-recreation-poc/ch1-threadrefs-plan-repair-flash-20260509
```

## Decision

Treat the prompt repair as useful but not broadly promoted from one smoke.
Before another writer-context comparison, prefer multi-chapter thread-map
evidence so horizon notes can either resolve into later payoff rows or remain
visible as unresolved setup.
