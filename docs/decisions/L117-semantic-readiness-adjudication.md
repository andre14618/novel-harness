---
status: active
date: 2026-05-14
---

# L117: Semantic Readiness Adjudication

## Decision

Scene-semantic readiness artifacts carry an adjudication status for each
finding: `raw`, `false_positive`, `real`, or `upstream_repair_needed`.
Plan Readiness imports skip findings adjudicated `false_positive` while keeping
the classification visible in the artifact and metadata.

World-fact semantic lows target the whole scene contract by default instead of
only `scene_plan.description`.

## Rationale

The Rillgate adjudication showed two different classes of semantic signal:
false-positive endpoint rows that should not create repair pressure, and real
world-fact/endpoint misses that needed upstream source repairs. Treating both
as undifferentiated raw readiness rows made telemetry less weight-bearing.

The ch9 ledger miss also showed that a world-fact issue can span established
facts, outcome/consequence language, and attached obligations. A scalar
description edit is too narrow for that repair shape.

## Evidence

- `rillgate-ch9-ledger-repair-1778793880-production-path`: ch9/ch10 bounded
  run cleared the repaired world-fact chain (`worldFactPressure` lows `0/7`)
  and exposed one real ch10 endpoint miss.
- `output/scene-semantic-review/rillgate-ch9-ledger-repair-1778793880/production-path/scene-semantic-readiness-adjudicated.json`
  classified that ch10 endpoint row as `upstream_repair_needed`.
- `rillgate-ch10-marker-endpoint-1778794476-production-path`: ch10-only
  redraft after the reviewed source repair produced scene-semantic lows `0/15`,
  endpoint lows `0/4`, world-fact lows `0/4`, checker readiness `0`, and source
  plan-state findings `0`.

## Implications

- Semantic telemetry remains advisory, but operator-reviewed classifications
  can now separate noise from repairable source-plan defects.
- False-positive semantic rows stay visible for analysis without adding open
  Plan Readiness pressure.
- World-fact repairs should preserve IDs while synchronizing the scene contract,
  source facts, and obligations through reviewed `planning_edit`.
