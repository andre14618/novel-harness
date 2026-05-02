---
loop: L31c
status: shipped
created: 2026-05-02
experiment: 356
commit: 1458d3e
panel_path: scripts/hallucination/synthetic-partial-enactment-fixtures/partial-enactment-panel.jsonl
panel_output: /tmp/partial-enactment-panel-results-20260502T032010.summary.json
---

# L31c — Adherence Stage-2 Override A/B Results (2026-05-02)

## Summary

L31c introduces a stage-2 override: when the per-event stage-2 adherence checker
reports ALL obligated_events as enacted, it overrides the stage-1 binary fail and
accepts the beat. Panel confirms zero new false positives.

## Partial-Enactment Panel Results

Panel: 14 rows from `synthetic-partial-enactment-fixtures/partial-enactment-panel.jsonl`
Run: local (no LXC), output at `/tmp/partial-enactment-panel-results-20260502T032010.*`

### Binary matrix

|           | Before L31c | After L31c |
|-----------|-------------|------------|
| TP        | 7           | 7          |
| FP        | 0           | 0          |
| FN        | 2           | 2          |
| TN        | 5           | 5          |
| Precision | 100.0%      | 100.0%     |
| Recall    | 77.8%       | 77.8%      |
| F1        | 87.5%       | 87.5%      |

### Per-shape matrix (after L31c)

| Shape                   | N_fail | N_pass | TP | FP | FN | TN | Recall | Prec  | F1   |
|-------------------------|--------|--------|----|----|----|----|--------|-------|------|
| two-of-three            | 3      | 1      | 2  | 0  | 1  | 1  | 67%    | 100%  | 80%  |
| reversed-order          | 3      | 1      | 2  | 0  | 1  | 1  | 67%    | 100%  | 80%  |
| substituted-actor       | 3      | 1      | 3  | 0  | 0  | 1  | 100%   | 100%  | 100% |
| acceptable-embellishment| 0      | 2      | 0  | 0  | 0  | 2  | N/A    | N/A   | N/A  |

### Why no new FPs

The override fires only when stage 2 reports ALL events as `enacted: true`. On
every partial-enactment fail shape (two-of-three, reversed-order, substituted-actor),
stage 2 correctly identifies the missing or wrong-actor event as `enacted: false`.
The override path never fires on real partial-enactment shapes.

Embellishment TN is preserved (both embellishment rows pass at stage 1; stage 2
never fires, so override is not relevant).

### Residual FNs (pre-existing, not caused by L31c)

- `partial-enact-two-of-three-fail-02`: "Cassel lights the candles on the sideboard"
  — stage 1 reasoning correctly identifies omission but outputs `events_present=true`
  (reasoning-verdict self-consistency failure in DeepSeek V4 Flash). Known since L21.
  
- `partial-enact-reversed-order-fail-02`: mage drain/binding causal reversal
  — stage 1 detects all events present but does not catch the reversed order on this
  specific shape. Known since L25.

Both FNs require per-event structured extraction in stage 1 — deferred.

## Override Telemetry

Override is traced as `adherence-stage2-override` event in `pipeline_events`:
```sql
SELECT * FROM pipeline_events WHERE event_type = 'adherence-stage2-override' ORDER BY id DESC LIMIT 10;
```

Payload includes `attempt`, `stage1Reasoning`, `stage2Override: true`.

## Acceptance

- FP=0: PASS
- No embellishment regression: PASS  
- No new test failures: PASS (7 pre-existing failures unchanged)
- TSC clean: PASS
- Preflight: PASS (`docs-impact: none`)
