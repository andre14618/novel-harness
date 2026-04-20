---
pattern: bun-test-module-mock-hygiene
status: active
first-seen: 2026-04-19 (docs/sessions/2026-04-19-5-invariants.md)
last-seen: 2026-04-19 (docs/sessions/2026-04-19-t1-t3.md)
elevated_from:
  - docs/sessions/2026-04-19-5-invariants.md
  - docs/sessions/2026-04-19-t1-t3.md
---

# bun:test module-mock hygiene

## Characterization

`mock.module()` feels file-local when you run one test file, but in `bun:test`
it mutates a process-global module registry. The bug usually shows up somewhere
else: a later-loaded sibling test imports the real module and instead gets a
partial mock with missing exports or helper behavior that no longer matches its
assertions.

Typical symptoms:
- `bun test <this-file>` passes but `bun test src/` fails.
- The failing file never declared the mock.
- Adding one missing export still leaves sibling assertions broken because a
  stubbed helper body leaked too.

## Problem shape

`mock.module()` in `bun:test` applies to every file loaded after the mock is
registered, not just the file that declared it. Partial mocks, ones that only
re-export a subset of the real module's exports, leak to sibling test files
that happen to load later in the same `bun test <glob>` process.

## Anti-pattern

```ts
// my-test.test.ts
mock.module("./beat-checks", () => ({
  runBeatChecks: async () => ({ pass: true, issues: [], retryLines: [] }),
  summarizeIssues: () => "no issues",
  // aggregateIssues, formatRetryLine — missing!
  // The summarizeIssues stub is also a leak point: sibling tests that assert
  // on group-by-source formatting inherit this body too.
}))
```

Consequence: a sibling test in the same process gets
`SyntaxError: Export named 'aggregateIssues' not found`. Even if the missing
names are added later, a stub body that does not mirror real behavior, for
example `summarizeIssues: () => "no issues"`, still leaks by breaking sibling
assertions that depend on the real helper output.

## Pattern

Full-shape mock: re-export every named export the real module provides, with
real-signature parity for helpers that sibling tests might exercise. Import the
real types so `tsc` fails if the mock drifts from the source module.

```ts
import type { BeatIssue, RawCheckerOutputs } from "./beat-checks"

mock.module("./beat-checks", () => ({
  runBeatChecks: async () => ({ pass: true, issues: [], retryLines: [] }),
  formatRetryLine: (issue: BeatIssue) => issue.description,
  aggregateIssues: (outputs: RawCheckerOutputs) => {
    /* mirror real impl */
  },
  summarizeIssues: (issues: BeatIssue[]) => {
    /* mirror real impl */
  },
}))
```

Every helper is a real-signature reimplementation or a conservative stub with
the right shape and behavior for sibling assertions.

## When to apply

- Any test file that calls `mock.module()` for a module whose real version
  exports more than the current file imports.
- Any `bun test src/` suite where sibling files can load the mocked module
  later in the same process.
- Rule of thumb: if the real module has N exports, the mock must cover N.

## When not to apply

- When you can mock below the shared module boundary, for example transport or
  DB seams, and let sibling tests keep importing the real module.
- When the runner guarantees per-file process isolation. This pattern is about
  `bun:test`'s process-global `mock.module()` registry.

## Sessions where seen

- 2026-04-19 — [5 starting invariants](../sessions/2026-04-19-5-invariants.md):
  first surfaced as `BASELINE_TEST_FAILURES = 1` because two `drafting-*.test.ts`
  partial mocks of `./beat-checks` broke `beat-checks.test.ts` in whole-suite
  runs.
- 2026-04-19 — [T1 + T2 + T3](../sessions/2026-04-19-t1-t3.md): fixed by
  extending both mocks to the full `beat-checks` surface and mirroring
  `summarizeIssues` after the literal `"no issues"` stub leaked into sibling
  assertions.

## Canonical fix

Treat the mock factory as a contract against the real module. Re-export every
named export with real-signature parity, and import the real types so
`tsc --noEmit` fails if the source module changes underneath the mock. The
shipping fix landed in `b8b5967`, with type-only drift hardening in `b5cb37a`.
The operational check is whole-tree `bun test src/`; single-file runs do not
exercise process-global leakage.

## Recurrences

1. **Exp #243 Slice B** (`10ce979`) — first occurrence; created the issue
   (two sibling `mock.module("./beat-checks")` sites in exp #243). Each mock
   re-exported only part of the module, so either later-loaded sibling test
   could inherit the broken shape.
2. **Exp #246 Slice A** (`b8b5967`) — fixed via Strategy A in both sites, plus
   `summarizeIssues` mirrored during implementation after the literal
   `() => "no issues"` stub leaked to `beat-checks.test.ts:55`.

## Checklist for adding new mocks

1. Read the real module's exports: `grep -E "^export" <real-module>.ts`.
2. Re-export every one in the mock body with real-signature parity, not just
   the names the current test imports. If you only need a stub for your own
   test, it still must accept the real arguments and return values sibling
   tests can accept.
3. Import the real types from the target module (`import type { X, Y } from
   "./module"`) and annotate the mock helpers with them so `tsc --noEmit`
   becomes the drift detector: when the real signature changes, the mock stops
   type-checking at compile time instead of failing later in a sibling suite.
4. Run `bun test src/`, not just `bun test <this-file>`, to verify no cross-file
   pollution.

## Related

- `scripts/preflight.ts` — `BASELINE_TEST_FAILURES` documents why whole-suite
  `bun test src/` is the relevant gate.
- [2026-04-19 — 5 starting invariants](../sessions/2026-04-19-5-invariants.md)
- [2026-04-19 — T1 + T2 + T3](../sessions/2026-04-19-t1-t3.md)
