---
ticket: T3 — BASELINE_TEST_FAILURES → 0 (fix beat-checks mock pollution)
experiment: 246
parent: 243
status: planning
created: 2026-04-19
---

# Plan — Drop `BASELINE_TEST_FAILURES` to 0

## Goal
Fix the cross-file `bun:test` mock pollution that causes `src/phases/beat-checks.test.ts` to fail loading when `src/phases/drafting-*.test.ts` runs first in the same `bun test src/` process. Once fixed, tighten `BASELINE_TEST_FAILURES` in `scripts/preflight.ts` from 1 → 0 so any new failure is caught immediately.

## Non-goals
- No refactor of the real `src/phases/beat-checks.ts` module. The bug is in the test mocks, not the production code.
- No change to the invariant-#1 / invariant-#4 test logic. The mocks only need extension, not rewriting.
- No migration to a different test runner. `bun:test` stays.

## Root cause

`src/phases/drafting-reviser-escalation.test.ts:180-183` and `src/phases/drafting-revision-used-persistence.test.ts:158-161` both call:

```ts
mock.module("./beat-checks", () => ({
  runBeatChecks: async () => ({ pass: true, issues: [], retryLines: [] }),
  summarizeIssues: () => "no issues",
}))
```

`bun:test` module mocks are process-global. When `beat-checks.test.ts` loads later in the same process, it does `import { aggregateIssues, summarizeIssues, formatRetryLine } from "./beat-checks"` — but the module registry returns the drafting-tests' mock, which only exports `runBeatChecks` and `summarizeIssues`. `aggregateIssues` and `formatRetryLine` are undefined → `SyntaxError: Export named 'aggregateIssues' not found in module ...`.

## Exit criteria
1. `bun test src/` — 64 pass / 0 fail / 0 errors (was 63 pass / 1 fail / 1 error at baseline).
2. `bun scripts/preflight.ts` — `BASELINE_TEST_FAILURES = 0`; preflight step 1 shows `64 pass / 0 fail (at baseline 0)`.
3. `bun test src/phases/beat-checks.test.ts` — 8 pass / 0 fail (unchanged).
4. Test file ordering isolation is NOT relied on — the fix is robust to any file-load order bun:test picks.
5. Codex implementation review verdict RESOLVED / PASS.

## Fix strategies (rank by preference)

### Strategy A (preferred): extend the two drafting mocks to re-export the full beat-checks shape

Change both `mock.module("./beat-checks", ...)` bodies from partial mocks to full-shape mocks. The mock implementations must match the REAL signatures in `src/phases/beat-checks.ts:99-126`:

- `aggregateIssues(outputs: RawCheckerOutputs): BeatCheckResult` — takes `{adherence: string[], ungrounded: string[], leak: string[]}`, emits `BeatIssue[]` where each issue has `{source, severity: "blocker", description: string}`, and the `source` maps from the input key: `adherence → "adherence"`, `ungrounded → "halluc-ungrounded"`, `leak → "halluc-leak-salvatore"`. `pass = issues.every(i => i.severity !== "blocker")`. `retryLines = issues.map(formatRetryLine)`.
- `formatRetryLine(issue: BeatIssue): string` — returns `issue.description` for every current source (the per-source `switch` collapses to identity; kept for future divergence).

Mock body (match the exact signatures so `beat-checks.test.ts` assertions at `beat-checks.test.ts:32-67` keep holding if it ever re-imports through the mock):

```ts
mock.module("./beat-checks", () => ({
  runBeatChecks: async () => ({ pass: true, issues: [], retryLines: [] }),
  summarizeIssues: () => "no issues",
  // Re-export with real-signature parity so `beat-checks.test.ts`
  // (which imports `aggregateIssues`/`formatRetryLine`/`summarizeIssues`)
  // doesn't SyntaxError when it loads in the same process — bun:test
  // module mocks are process-global.
  formatRetryLine: (issue: any) => issue.description,
  aggregateIssues: (outputs: { adherence: string[]; ungrounded: string[]; leak: string[] }) => {
    const issues: any[] = []
    for (const s of outputs.adherence) issues.push({ source: "adherence", severity: "blocker", description: s })
    for (const s of outputs.ungrounded) issues.push({ source: "halluc-ungrounded", severity: "blocker", description: s })
    for (const s of outputs.leak) issues.push({ source: "halluc-leak-salvatore", severity: "blocker", description: s })
    return {
      pass: issues.every((i: any) => i.severity !== "blocker"),
      issues,
      retryLines: issues.map((i: any) => i.description),
    }
  },
}))
```

**Pros:** Minimal intervention. No production code change. Pattern is clear ("mock must match full export shape"). Signatures mirror the real implementations so any test that happens to run through the mock keeps semantic parity.
**Cons:** Two test files drift from the real implementation if beat-checks.ts adds new exports. Mitigation: a lint rule (future) could flag incomplete module mocks; for now rely on preflight catching the failure.

### Strategy B: extract helpers to a separate module (`src/phases/beat-issue-aggregator.ts`)

Move `aggregateIssues`, `formatRetryLine`, and their types out of `beat-checks.ts` into a helper module. `beat-checks.test.ts` imports from the helper module, which the drafting-tests never mock. `beat-checks.ts` re-exports the helpers (or imports them) for its own use.

**Pros:** Architecturally cleaner — separates pure helpers from the I/O-heavy `runBeatChecks`. Future test files inherit the isolation.
**Cons:** Touches production code. Higher blast radius. Changes the import path for anything currently importing `aggregateIssues` from `beat-checks.ts`.

### Strategy C: scope the `mock.module` calls to within individual test functions

bun:test may support file-scoped or test-scoped mocks via `mock.module` inside `test()` blocks. Requires confirming bun semantics.

**Pros:** Surgical — no new code to maintain.
**Cons:** bun:test documentation isn't explicit about this; may not work reliably.

## Recommended approach

**Strategy A** as the shipping fix — smallest blast radius, no production-code risk, explicit "full-shape mock" discipline that other tests can follow.

**Strategy B as a follow-up ticket** if this class recurs (would elevate to a `docs/patterns/bun-test-module-mock-hygiene.md` at that point).

## File ownership slices

### Slice A — mock extension (GREEN, single edit)
**Files:**
- EDIT `src/phases/drafting-reviser-escalation.test.ts` — extend the `../beat-checks` mock body with the real shape (Strategy A).
- EDIT `src/phases/drafting-revision-used-persistence.test.ts` — same extension.

### Slice B — preflight baseline tighten + docs (GREEN, after Slice A)
- EDIT `scripts/preflight.ts` — drop `BASELINE_TEST_FAILURES` constant from `1` to `0`; update the comment that documents the baseline.
- EDIT `docs/todo.md` — mark the 3rd follow-up (tighten BASELINE_TEST_FAILURES) DONE.
- EDIT `.claude/session-handoff.md` — remove priority #3 from "Start-here priorities."

## Green / red split
- **Green.** Test-only changes + one constant tighten. No production-code change. Existing tests (9 in the drafting-*.test.ts files + 8 in beat-checks.test.ts) all continue to pass.

## Risks + mitigations
- **Aggregator behavior drift** — if the inline mock implementation of `aggregateIssues` differs from the real one, drafting tests could silently pass against incorrect behavior. Mitigation: the inline implementation is simple enough to verify by inspection (the real `aggregateIssues` is at `src/phases/beat-checks.ts:99-116` — 18 lines).
- **Future beat-checks.ts exports** — adding a new exported symbol could break the mock pattern again. Mitigation: document the requirement in a top-of-file comment above the mock blocks. Lint rule deferred.
- **bun:test version behavior** — if a future bun:test release isolates module mocks per file automatically, this fix becomes unnecessary (but benign). Not a concern for shipping.

## Commit chain (anticipated)
1. `[test] extend drafting test mocks with full beat-checks shape (exp #246)` — Slice A.
2. `[scripts] drop BASELINE_TEST_FAILURES to 0 after mock-pollution fix (exp #246)` — Slice B.

## Codex sequencing
- Phase 2 triage: expect `green`.
- Phase 3 full review: confirm Strategy A is the right call (vs B); pattern-check the inline mock implementations against the real ones.
- Phase 6 impl review: **hot tier** (leaf-local, test-only, behavior-preserving).
