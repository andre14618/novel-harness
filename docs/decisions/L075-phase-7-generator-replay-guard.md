---
status: active
updated: 2026-05-04
supersedes: full-log-2026-05-04.md#l75--phase-7-autonomous-loop-guard-downstream-metrics-generator-replay-harness-2026-05-04
---

# L75 — Phase 7 Generator Replay And Guard

## Decision

Continue Phase 7 through the no-operator-decision work:

- Add a local promotion guard.
- Expand replay reports with downstream-impact metrics.
- Expose a pure proposal-generator replay harness.
- Keep runtime apply behavior unchanged.

## Why

Policy changes need replay evidence before promotion. Generator behavior also
needs replay because a candidate policy can look safe while the producer drifts
and emits different envelopes.

## Concrete Shape

- `scripts/approval-policy-promotion-guard.ts` requires a passing replay report
  when approval-policy behavior files change.
- `PolicyReplayRow` carries optional downstream observations:
  `downstreamCheckerFired`, `downstreamEditChurn`, and
  `downstreamCanonConflict`.
- `replayProposalGenerator(cases, policy, generate)` runs injected generators
  against frozen inputs and reports `missingExpected` / `unexpectedGenerated`.
- CLI supports generator replay for artifact patch envelopes,
  `lint-to-prose-edit`, and frozen-output `editorial-beat-coverage`.

## Verification

Focused guard/replay tests passed. Historical DB-backed tests skip cleanly when
Postgres is unreachable.
