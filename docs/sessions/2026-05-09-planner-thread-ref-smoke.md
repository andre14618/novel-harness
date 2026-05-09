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
- Remaining thread-map issues are chapter-horizon findings: opened promises
  have no local payoff in this single-chapter plan. That is a different
  question from thread-ref mismatch and should be handled by explicit
  chapter-local vs future-payoff semantics.

Manifest validation passed:

```bash
bun run diagnostics:run-manifest-validate -- \
  output/corpus-recreation-poc/ch1-threadrefs-plan-repair-flash-20260509
```

## Decision

Treat the prompt repair as useful but not broadly promoted from one smoke.
Before another writer-context comparison, clarify whether the thread map should
expect all declared payoffs in a single chapter or allow future-horizon payoff
refs.
