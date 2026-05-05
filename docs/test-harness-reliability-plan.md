---
status: active
updated: 2026-05-05
owner: test-harness-reliability-lane
---

# Test Harness Reliability Plan

## Problem

`bun test` is no longer a trustworthy fast gate. A 2026-05-05 full run took
181.22s and ended with 1599 pass / 71 fail / 3 errors. The failures clustered
in DB-backed route and telemetry suites plus one archived missing-module test,
not in the planning-proposal split itself.

The harness needs tests to be useful in three ways:

- Fast default feedback for ordinary coding loops.
- Focused DB/integration smoke coverage for real persistence and route paths.
- Explicit end-to-end browser evidence for UI-facing changes.

## Current Evidence

Planning proposal route coverage has already been split:

- Fast non-DB route validation:
  `src/orchestrator/planning-proposal-routes.test.ts`
- Explicit DB smoke runner:
  `bun run test:db`
- Latest verified DB smoke result after stopping the local dev server:
  5/5 pass, no disposable `test-planning-proposal-*` rows left behind.

Full `bun test` still fails outside that slice. Current failing clusters from
the 2026-05-05 run:

- `src/harness/canon-proposal-telemetry.test.ts`: telemetry events read back as
  zero rows.
- `src/db/chapter-exhaustions.test.ts`: cleanup expectations return zero rows.
- `src/orchestrator/planning-target-routes.test.ts`: fixtures resolve to
  unexpected `ch-undefined-*` refs / 404s.
- `src/orchestrator/policy-decide-routes.test.ts`,
  `src/orchestrator/prose-edit-routes.test.ts`,
  `src/orchestrator/proposal-envelope-routes.test.ts`, and
  `src/orchestrator/canon-proposal-routes.test.ts`: DB-backed route expectations
  often receive 404/409 where the tests expect successful applies/lists.
- `scripts/archive/evals/preflight-arm-b-parity.test.ts`: archived test imports
  missing `./beat-prompt-sections`.
- `tests/phase-parity/phase-parity.test.ts`: parity replay mismatch.

## Principles

- Default `bun test` should be fast, deterministic, and mostly DB-free.
- DB-backed suites are allowed, but they must be explicitly named, disposable,
  and runnable as smoke/integration commands with bounded timeouts.
- A test that relies on a live DB must prove fixture setup, cleanup, and row
  isolation. Hidden state from a running dev server should not decide results.
- Archived or historical eval tests must not participate in default test
  discovery unless they are maintained as current gates.
- UI-facing changes require Playwright MCP/browser evidence before handoff.
- Do not delete coverage to get green. Move coverage to the right layer and
  keep an explicit command for slower coverage.

## Lane Slices

1. **Inventory test tiers.**
   Classify current tests as pure unit, DB integration, browser/e2e, archived
   eval, or long-running experiment. Record the intended command for each tier.

2. **Repair default discovery.**
   Exclude or rename archived/broken historical tests from default Bun
   discovery, or make them pass if they are still current gates.

3. **Fix DB fixture isolation.**
   Start with the current failing clusters. For each DB-backed suite, verify
   fixture creation, cleanup, ID expectations, and whether a running dev server
   or shared Bun SQL pool can interfere.

4. **Add explicit commands.**
   Introduce clear scripts for `test:fast`, `test:db`, and later UI/browser
   smoke. Each command should state what class of regressions it catches.

5. **Codify pass/fail gates.**
   Update `docs/current-state.md` with the supported local gates once they are
   green. Do not claim `bun test` as a supported gate until it passes.

6. **Browser testing autonomy follow-up.**
   Continue the existing Playwright MCP todo by building a reusable local UI
   preflight runner that uses disposable data and captures screenshot,
   console, and network evidence.

## First Debug Targets

Start with tests that fail by returning zero rows or wrong IDs, because those
are likely fixture/setup drift rather than product behavior:

- `src/harness/canon-proposal-telemetry.test.ts`
- `src/db/chapter-exhaustions.test.ts`
- `src/orchestrator/planning-target-routes.test.ts`

Then move to route suites returning unexpected 404/409, since they may share a
common fixture hash/precondition pattern.

## Acceptance Criteria

- `bun test` either passes or is intentionally replaced by documented tiered
  commands that all pass.
- Default fast command returns in seconds, not minutes.
- DB smoke command is stable across repeated runs with the local app stopped.
- Every DB smoke uses disposable IDs and leaves no matching rows behind.
- Current-state docs name the supported gates and any known excluded suites.
