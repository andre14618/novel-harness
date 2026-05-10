---
status: active
date: 2026-05-10
---

# L105: Scene-Contract Compression Hold

## Decision

Do not promote simple scene-contract payload clipping or auxiliary-tag removal
to production defaults.

The next scene-first evidence lane should target writer-context shaping: keep
full planner-authored scene contracts and the production writer context surface
in storage and review artifacts, but render a smaller writer-facing drafting
brief that preserves endpoint-critical fields, Character Profiles/Snapshots,
World Bible/setting, Story Spine, reader-info state, trace IDs, obligations,
and explicit per-scene word budgets. Prose semantic telemetry remains
default-on where wired and advisory only.

## Evidence

Baseline `poc-load-mapper-min-v3-1778437234` held endpoints at `3/3/3` with
9/9 scene IDs, 1.00 load-bearing obligations/scene, and 1.89x target length.
Re-rendered review metrics show 7,690 scene-contract payload chars and 16
choice alternatives.

`poc-contract-min-1778441482` tested conservative endpoint-preserving clipping:
4,577 payload chars, zero choice alternatives, 0.89 obligations/scene, 9/9 core
contract fields, 9/9 scene IDs, complete diagnostics, and endpoints `3/3/3`.
It still worsened length to 8,054/3,900 words, or 2.07x. Prose-semantic
telemetry had zero low/error rows and reported `lengthSignal=not_falsified_as_padding`.

`poc-contract-core-1778441482` tested aggressive endpoint-core shaping: 2,152
payload chars, zero choice alternatives, 1.00 obligations/scene, 9/9 scene IDs,
complete diagnostics, and a better 6,934/3,900 words, or 1.78x. It regressed
endpoint landing to `3/2/3`, dropped core contract coverage to 0/9, and reduced
payoff propulsion relative to the conservative arm.

Artifacts:

- `poc/scene-first-novella/output/poc-contract-min-1778441482/`
- `poc/scene-first-novella/output/poc-contract-core-1778441482/`
- `poc/scene-first-novella/output/poc-contract-min-1778441482/prose-semantic/prose-semantic-report.md`
- `poc/scene-first-novella/output/poc-contract-core-1778441482/prose-semantic/prose-semantic-report.md`

## Implications

- Payload size alone is not the active control surface. The conservative cut
  preserved endpoints and quality but did not reduce prose length.
- Removing too many auxiliary fields can shorten prose somewhat, but endpoint
  and contract-quality regressions make that shape non-promotable.
- Do not deterministically compact generated prose. The semantic judges did
  not classify these long chapters as obvious padding.
- Do not keep squeezing the state mapper as the primary next step; the mapper-
  min baseline already reached roughly one obligation/scene.
- Rubric calibration is useful as a sidecar, especially a future
  compression-opportunity dimension, but it is not the primary production-path
  change.
- The next POC should introduce a separate writer brief renderer with payload
  telemetry and a writer-context surface manifest so character/world/story
  context cannot silently fall out of evidence reports. Promotion gate:
  `<=1.5x`, endpoints `3/3/3`, 9/9 scene IDs, complete diagnostics/traces, and
  advisory prose-semantic reports.
