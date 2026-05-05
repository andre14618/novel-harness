---
status: active
updated: 2026-05-04
supersedes: full-log-2026-05-04.md#l74--phase-6-review-fixes--phase-7-replay-metrics-tracer-bullet-2026-05-04
---

# L74 — Phase 7 Replay Tracer

## Decision

Before opening new runtime behavior, close focused Phase 6 review findings and
start Phase 7 with a read-only replay report surface.

## Phase 6 Fixes

- Canon bulk resolve threads `resolvedByKind` and `resolution_policy_*`.
- Canon single resolve runtime-validates `resolvedBy`.
- Policy-decide queue decisions re-check pending status under
  `SELECT ... FOR UPDATE` before returning.
- Policy-decide reissue failures expose `policyEvaluation`, not success-shaped
  top-level decision fields.
- Producer reject without reasons returns deterministic `reject` instead of
  throwing.

## Replay Surface

- `src/canon/approval-policy-replay.ts` consumes `PolicyReplayRow[]` and emits
  `PolicyReplayReport`.
- `replayCandidatePolicy(frozenCases, policy)` evaluates frozen envelopes
  against a candidate policy while preserving historical outcome labels.
- `src/db/approval-policy-replay.ts` unions resolved `proposal_envelopes` and
  `canon_proposals`, mapping Canon to `kind=canon_update`, `risk=high`.
- `scripts/approval-policy-replay-report.ts` emits markdown or JSON and can
  fail `--check` on promotion threshold failure.

## Why

Autonomy must be measurable by proposal kind. A replay report over existing
resolution audit rows is the cheapest useful Phase 7 artifact, and it validates
the metric vocabulary before replaying producers or changing runtime behavior.

## Guardrail

Never pool Canon, artifact patches, prose edits, and editorial flags into one
undifferentiated precision metric. Replay buckets must stay separated by kind
and kind+risk.
