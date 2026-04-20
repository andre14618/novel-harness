---
ticket: T6 — elevate pattern: bun:test cross-file mock hygiene
experiment: 249
parent: 246
status: planning
created: 2026-04-19
---

# Plan — Create `docs/patterns/bun-test-module-mock-hygiene.md`

## Goal
Promote the "bun:test module mocks are process-global; partial mocks cause cross-file pollution" lesson from session-level (observed 2x in exp #243 + exp #246) to a pattern-level document. Docs-only ticket; no code changes.

## Non-goals
- No code / test-file changes.
- No switch to a different test runner.
- No lint rule for incomplete mocks (that's a future code ticket if the pattern recurs).

## Exit criteria
1. NEW file `docs/patterns/bun-test-module-mock-hygiene.md` (50-120 lines) with: title, frontmatter, "Problem shape," "Antipattern," "Pattern," "When to apply," "Recurrences," "Checklist for adding new mocks," "Related."
2. Back-links added to: `docs/sessions/2026-04-19-t1-t3.md` §4 (class-of-bug patterns — elevation complete), `docs/todo.md` (if there's a standing note, mark DONE), `.claude/skills/implement-ticket.md` (one-line pointer in Phase 5 — "if touching test mocks, see `docs/patterns/bun-test-module-mock-hygiene.md`").
3. Preflight PASS (unchanged — pure docs).
4. Codex review verdict RESOLVED.

## Recurrences to cite

1. **Exp #243 Slice B** (commit `10ce979`) — drafting-*.test.ts mocks for `./beat-checks` re-exported only `runBeatChecks` and `summarizeIssues`. Worked when drafting-*.test.ts ran in isolation; broke `beat-checks.test.ts` when it loaded later in the same `bun test src/` process (ERR: "Export named `aggregateIssues` not found"). Surfaced as `BASELINE_TEST_FAILURES=1` in `scripts/preflight.ts`.

2. **Exp #246 Slice A** (commit `b8b5967`) — fixed by extending both mocks with full-shape re-implementation + real-signature parity. Codex `acd8a3a3` LOW confirmed Strategy A correct. Dropped `BASELINE_TEST_FAILURES` to 0.

Two recurrences in two sessions. Meets elevation threshold per `docs/sessions/README.md`.

## File ownership slices

### Slice A — pattern doc + back-links (single agent)
**Files:**
- CREATE `docs/patterns/bun-test-module-mock-hygiene.md`. Template:

  ```markdown
  ---
  status: active
  updated: 2026-04-19
  elevated_from:
    - docs/sessions/2026-04-19-t1-t3.md
  ---

  # bun:test module-mock hygiene

  ## Problem shape
  `mock.module()` in bun:test mutates a PROCESS-GLOBAL registry. The mock
  applies to every file loaded AFTER the mock is registered, not just the
  file that declared it. Partial mocks — ones that only re-export a subset
  of the real module's exports — leak to sibling test files that happen to
  load later in the same `bun test <glob>` process.

  ## Antipattern
  ```ts
  // my-test.test.ts
  mock.module("./beat-checks", () => ({
    runBeatChecks: async () => ({ pass: true, issues: [], retryLines: [] }),
    summarizeIssues: () => "no issues",
    // aggregateIssues, formatRetryLine — missing!
    // summarizeIssues also stubs away the real group-by-source behavior
    // that beat-checks.test.ts asserts on at :55 — the literal "no issues"
    // return value is a second leak point on top of the missing exports.
  }))
  ```
  Consequence: `beat-checks.test.ts` in the same process gets
  `SyntaxError: Export named 'aggregateIssues' not found in module
  '.../beat-checks.ts'`. Even if the missing names were added, a stub body
  that doesn't mirror real behavior (e.g. `summarizeIssues: () => "no issues"`)
  breaks every sibling test that asserts on that helper's output.

  ## Pattern
  Full-shape mock: re-export every named export the real module provides,
  with real-signature parity for helpers that other tests might exercise.
  Import the real types to catch drift at tsc time:

  ```ts
  import type { BeatIssue, RawCheckerOutputs } from "./beat-checks"

  mock.module("./beat-checks", () => ({
    runBeatChecks: async () => ({ pass: true, issues: [], retryLines: [] }),
    formatRetryLine: (issue: BeatIssue) => issue.description,
    aggregateIssues: (outputs: RawCheckerOutputs) => { ... mirror real impl ... },
    summarizeIssues: (issues: BeatIssue[]) => { ... mirror real impl ... },
  }))
  ```

  Every helper is a real-signature reimplementation OR a conservative
  stub with the right shape.

  ## When to apply
  - Any test file that calls `mock.module()` for a module whose real
    version exports more than the current file imports.
  - Rule of thumb: if the real module has N exports, the mock must cover N.

  ## Recurrences
  1. **Exp #243 Slice B** (`10ce979`) — first occurrence; created the issue. Two separate sibling `mock.module("./beat-checks")` sites (in `drafting-reviser-escalation.test.ts` + `drafting-revision-used-persistence.test.ts`) were each partial.
  2. **Exp #246 Slice A** (`b8b5967`) — fixed via Strategy A (full-shape mock with real-signature parity) in both sites, plus `summarizeIssues` mirrored during implementation after the literal `() => "no issues"` stub leaked to `beat-checks.test.ts:55`.

  ## Checklist for adding new mocks
  1. Read the real module's exports: `grep -E "^export" <real-module>.ts`.
  2. Re-export every one in the mock body **with real-signature parity**
     (phrasing from `scripts/preflight.ts:30`) — not just the shape, but
     enough of the real behavior that sibling test assertions still hold.
     If you only need a stub for your own test, that stub MUST still match
     the real signature AND return values that sibling tests can accept.
  3. Import the real types from the target module (`import type { X, Y }
     from "./module"`) and use them in the mock for tsc-level drift
     detection.
  4. Run `bun test src/` (not just `bun test <this-file>`) to verify no
     cross-file pollution.

  ## Related
  - `scripts/preflight.ts` — `BASELINE_TEST_FAILURES` constant. The fix
    pattern is documented inline in the comment above that constant.
  - `docs/sessions/2026-04-19-t1-t3.md` §2 Chain C — the session-level story.
  ```

- EDIT `docs/sessions/2026-04-19-t1-t3.md` §4 — mark the "bun-test mock hygiene" line as elevated with path to the new pattern doc.
- EDIT `.claude/skills/implement-ticket.md` Phase 4 (primary anchor) — add a sentence in the "Mandatory in every subagent prompt" list: "If the subagent authors `mock.module()` calls, cite `docs/patterns/bun-test-module-mock-hygiene.md` as required reading — partial mocks leak across files in bun:test." Also add a secondary one-line reminder in Phase 5 preflight to re-run `bun test src/` (not just single-file tests) as a rot check. Rationale (Codex thread `a2598abe` MEDIUM #3): Phase 5 catches the bug after the fact; Phase 4 is where the mock authoring contract is defined.
- EDIT `docs/todo.md` — if there's a standing note, mark DONE.

## Green / red split
- **Green.** Pure docs + a one-line skill-doc edit.

## Risks + mitigations
- **Session retrospective edit** — same one-line elevation-candidate → elevated transformation. Low risk.
- **Skill-doc edit** — a one-sentence pointer. Low risk.

## Commit chain (anticipated)
1. `[docs] T6 — elevate pattern: bun:test module-mock hygiene (exp #249)` — one commit.

## Codex sequencing
- Phase 2 triage: expect `green`.
- Phase 3 full review: pattern doc quality + recurrence citation accuracy + check the commit SHAs cited.
- Phase 6 impl review: **hot tier** (docs only).
