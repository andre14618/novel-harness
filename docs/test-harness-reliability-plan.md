---
status: active
updated: 2026-05-05
owner: test-harness-reliability-lane
---

# Test Harness Reliability Plan

## Problem

Direct broad `bun test` is not a trustworthy fast gate. A 2026-05-05 full run
took 181.22s and ended with 1599 pass / 71 fail / 3 errors. The failures
clustered in DB-backed route and telemetry suites plus one archived
missing-module test and one stale replay fixture.

The harness needs tests to be useful in three ways:

- Fast default feedback for ordinary coding loops.
- Focused DB/integration smoke coverage for real persistence and route paths.
- Explicit end-to-end browser evidence for UI-facing changes.

## Current Evidence

Supported tiered coverage has been restored and split by cost:

- `bun run test:fast`: 84 mostly pure/non-DB files; latest run passed.
- `bun run test:db`: bounded DB smoke commands for representative persistence,
  route, transaction, stale-precondition, and lineage paths. It performs an
  upfront DB health check so a down listener/tunnel fails quickly.
- `bun run test:db:full`: planning proposal DB smoke plus all isolated DB
  files, each run with `BUN_SQL_MAX=1`. Use for broad persistence sweeps, not
  every edit loop.
- `bun run test:archive`: 6 archived eval/history files; latest run passed.
- `bun scripts/test/tiered-test-runner.ts --tier replay`: skips unless
  `PHASE_PARITY_REPLAY=1`.
- `bun run test:replay`: explicit opt-in phase parity replay; currently fails
  with `ReplayTransport miss: 1dd73b5c320260717ff5bfefd77593cc` and needs a
  refreshed fixture if the prompt drift is intentional.

The original 2026-05-05 full-run failures resolved into these outcomes:

- `src/harness/canon-proposal-telemetry.test.ts`,
  `src/db/chapter-exhaustions.test.ts`, and
  `src/orchestrator/planning-target-routes.test.ts`: pass in the DB tier.
- `src/orchestrator/policy-decide-routes.test.ts`,
  `src/orchestrator/prose-edit-routes.test.ts`,
  `src/orchestrator/proposal-envelope-routes.test.ts`, and
  `src/orchestrator/canon-proposal-routes.test.ts`: pass in isolated DB
  processes.
- `scripts/archive/evals/preflight-arm-b-parity.test.ts`: import repaired and
  archived tier passes.
- `tests/phase-parity/phase-parity.test.ts`: moved to replay tier; opt-in run
  still fails until the reference fixture is re-recorded.

## Principles

- Default `bun run test` should be fast, deterministic, and mostly DB-free.
- DB-backed suites are allowed, but they must be explicitly named, disposable,
  and runnable as smoke or full integration commands with bounded timeouts.
- A test that relies on a live DB must prove fixture setup, cleanup, and row
  isolation. Hidden state from a running dev server should not decide results.
- Archived evals and replay fixtures must not participate in default coverage
  unless they are maintained as current gates.
- UI-facing changes require Playwright MCP/browser evidence before handoff.
- Do not delete coverage to get green. Move coverage to the right layer and
  keep an explicit command for slower coverage.

## Lane Slices

1. **Inventory test tiers.** Done.
   Classify current tests as pure unit, DB integration, browser/e2e, archived
   eval, or long-running experiment. Record the intended command for each tier.

2. **Repair default discovery.** Done.
   Exclude or rename archived/broken historical tests from default Bun
   discovery, or make them pass if they are still current gates.

3. **Fix DB fixture isolation.** Done for current failing clusters.
   Start with the current failing clusters. For each DB-backed suite, verify
   fixture creation, cleanup, ID expectations, and whether a running dev server
   or shared Bun SQL pool can interfere.

4. **Add explicit commands.** Done.
   Introduce clear scripts for `test:fast`, DB smoke `test:db`, full DB sweep
   `test:db:full`, and later UI/browser smoke. Each command should state what
   class of regressions it catches.

5. **Codify pass/fail gates.** Done in `docs/current-state.md`.
   Update `docs/current-state.md` with the supported local gates once they are
   green. Do not claim `bun test` as a supported gate until it passes.

6. **Browser testing autonomy follow-up.** Still pending.
   Continue the existing Playwright MCP todo by building a reusable local UI
   preflight runner that uses disposable data and captures screenshot,
   console, and network evidence.

## Diagnostic Findings

- Broad `bun test` mixed DB suites, archived tests, and replay fixtures in one
  process/discovery surface. That made failures look product-level when several
  were test-shape problems.
- DB-backed suites are more stable when isolated one file per process with
  `BUN_SQL_MAX=1`, but the exhaustive sweep can still exhaust or lose a local
  DB/tunnel over long runs. The standard DB gate is now smoke-first.
- Planning snapshot and target reads used concurrent `Promise.all` around a
  single transactional connection. Serial reads preserve snapshot consistency
  and remove single-connection stalls in the DB test shape.
- Phase parity is a fixture drift signal, not a DB integration gate.

## Acceptance Criteria

- `bun test` is intentionally replaced by documented tiered commands.
- `bun run test:fast`, `bun run test:db`, and `bun run test:archive` pass.
- `bun run test:db:full` remains available for exhaustive persistence sweeps
  and should fail fast when the configured DB listener is unavailable.
- Default fast command returns in seconds, not minutes.
- DB smoke is stable across repeated runs with the local app stopped.
- Every DB smoke uses disposable IDs and cleans its matching rows.
- Current-state docs name the supported gates and the opt-in replay fixture
  drift.
