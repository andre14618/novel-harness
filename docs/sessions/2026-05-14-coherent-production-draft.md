# Coherent Production Draft Evidence

Date: 2026-05-14

## Objective

Run a fresh full production-path Rillgate draft from the repaired source and
collect weight-bearing telemetry before more harness tuning.

## Run

- Source: `rillgate-ch4-endpoint-hygiene-1778723371`.
- Target: `rillgate-coherent-prod-1778761633-production-path`.
- Command shape: `test-drafting-isolated --writer-arms production-path
  --quality-telemetry-packet --scene-semantic-readiness-import
  --scene-semantic-max-tokens 12000`.
- Drafted chapters: `10/10`.
- Words: `31,676/31,000`, mean ratio `1.022`.
- Chapter ratios: ch1 `0.95`, ch2 `0.95`, ch3 `1.16`, ch4 `1.02`, ch5
  `1.03`, ch6 `1.20`, ch7 `1.26`, ch8 `0.84`, ch9 `0.91`, ch10 `0.90`.
- Writer expansion events: `0`.
- Writer brief events: `61/61`, `scene-budget-tight-anchored-v1`.

## Telemetry

- Plan-Assist readiness: `0`.
- Planning-context gaps: `0`; readiness sidecar still surfaced four low
  `REFERENCE-CONTEXT-UNRESOLVED` candidates.
- Checker readiness: `14` items; `2` blockers; `2` weight-bearing findings,
  both chapter 9 continuity contradictions.
- Prose semantic: `0/40` lows, no errors; length not falsified as padding.
- Scene semantic: `166` tasks, `30` skips, `0` errors, `4` lows.
- Scene readiness import: inserted `4`, updated `0`, skipped `0`.

## Imported Readiness

Scene-semantic import created four open items on the draft clone:

- ch2 scene 3 `endpointLanding ENDPOINT-1`:
  `scene_plan:<sceneId>:consequence`.
- ch3 scene 3 `worldFactPressure WFACT-1`:
  `scene_plan:<sceneId>:description`.
- ch5 scene 1 `endpointLanding ENDPOINT-1`:
  `scene_plan:<sceneId>:consequence`.
- ch6 scene 2 `endpointLanding ENDPOINT-1`:
  `scene_plan:<sceneId>:consequence`.

Checker readiness import was run after the draft. It reported two chapter 9
continuity blockers but inserted/updated one Plan Readiness row because both
findings share the same `chapter_outline:ch-009-witness-s-choice:purpose`
target, label, dimension, and fix intent. This is useful telemetry but not
yet ideal: same-target checker findings should remain distinct or preserve a
multi-finding payload.

## Interpretation

The harness can now complete a coherent full production-path draft from the
repaired source without manual intervention. Word count is no longer the
primary blocker for this lane.

The weight-bearing issues are:

- Chapter 9 continuity contradictions: the draft has Tessa initially refusing
  testimony and leaving together, while upstream facts/plan expect prior
  agreement and separate exits.
- Prose-integrity retry behavior in chapters 8 and 9: built-in retry cleared
  both, but the failure fingerprint should be inspected before treating this
  as purely incidental.
- Checker-readiness import fidelity: multiple same-target checker blockers can
  collapse into one Plan Readiness row.

Next work should fix the telemetry/import fidelity first if we need exact
review queues, then repair chapter 9 upstream plan consistency and redraft a
bounded chapter 9/10 window.
