---
status: active
date: 2026-05-14
---

# L114: Weight-Bearing Checker Telemetry

## Decision

Checker telemetry reports now separate raw finding volume from weight-bearing
evidence. Raw checker rows remain visible, but default readiness and semantic
gate pressure should only use findings classified as `weight-bearing`.

## Classification

- `weight-bearing`: negative-polarity, standard-calibrated blockers.
- `advisory`: ambiguous rows or negative nonblocking rows.
- `noise`: positive/supportive rows, low-confidence rows, and explicitness-only
  gaps such as "not explicitly stated" without a concrete contradiction or
  omission.

## Rationale

Recent drafting evidence showed that raw checker counts overstate harness
problems. Functional-state and continuity warnings often describe explicitness
preferences, support echoes, or low-confidence state judgments. These are useful
to inspect, but they should not carry the same weight as deterministic
Plan-Assist, scene-contract, or negative blocker evidence.

## Implications

- Checker warning reports expose `byTelemetryWeight`.
- Checker readiness imports only weight-bearing findings by default.
- `--include-warnings` can still surface advisory warning rows for deliberate
  review, but default production evidence should prioritize weight-bearing
  rows.
- Semantic-gate and run-compare reports should treat weight-bearing checker
  rows as the meaningful checker pressure signal.
