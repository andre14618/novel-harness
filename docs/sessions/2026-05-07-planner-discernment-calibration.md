---
status: active
updated: 2026-05-07
role: session-record
lane: upstream-planning-methodology
---

# Planner Discernment Calibration

## Change Packet

- Optimized layer: evaluation methodology for upstream planning.
- Exact change: add a known-answer calibration harness for narrow semantic
  planning-quality labels.
- Held constant: no planner prompt, writer, checker, UI, proposal, or runtime
  default changes.
- Expected benefit: determine whether DeepSeek can make useful quality
  judgments after broad pairwise A/B judging showed severe Plan-A bias.
- Downstream projection: if narrow categorical labels are reliable, use them as
  diagnostic sensors for planner/method-pack changes before prose-level tests.
- Evidence gate: exact/off-by-one accuracy, over-label rate, and severe
  over-label rate on authored calibration cases.

## Implementation

- Added fixture:
  `docs/fixtures/evals/planner-discernment-calibration-v0.json`.
- Added runner:
  `scripts/evals/planner-discernment-calibration.ts`.
- Added package script:
  `bun run diagnostics:planner-discernment-calibration`.
- Added rubric/result doc:
  `docs/evals/planner-discernment-calibration-v0.md`.

## Flash Result

DeepSeek V4 Flash was run on 21 known-answer cases across three prompt shapes:

- `direct-label`
- `evidence-first`
- `gate-derived`

Result:

- `direct-label`: `95%` exact, `100%` off-by-one, `5%` over-label,
  `0%` severe over-label.
- `evidence-first`: `90%` exact, `100%` off-by-one, `0%` over-label,
  `0%` severe over-label.
- `gate-derived`: `67%` exact, `100%` off-by-one, `24%` over-label,
  `0%` severe over-label.

Artifact:

`output/method-pack-diagnostics/2026-05-07T20-27-33-288Z/discernment-calibration/`

## Pro Sample

DeepSeek V4 Pro was sampled on the `evidence-first` shape only. It needed a
larger token cap (`4000`) after a `1400` cap hit, but completed the narrowed
task.

Result:

- `evidence-first`: `86%` exact, `100%` off-by-one, `10%` over-label,
  `0%` severe over-label.

Artifact:

`output/method-pack-diagnostics/2026-05-07T20-30-40-284Z/discernment-calibration/`

## Interpretation

DeepSeek is not useless as a semantic judge. It failed broad pairwise
preference, but it is useful on narrow anchored categorical labels.

Working shape:

- one excerpt at a time;
- one dimension at a time;
- anchored labels, not open numeric scores;
- explicit over-label metrics;
- operator-calibrated expected labels before promotion use.

Avoid for now:

- broad full-plan A/B preference;
- gate-derived labels as the default workaround;
- Pro as the bulk calibration model.

## Dimension-Specific Rerun

The harness was revised so each live call sees only one dimension rubric and
one compact output contract. Calls are grouped by `promptMode + dimension` for
prefix-cache reuse.

Result on the same 21-case fixture:

- `direct-label`: `100%` exact, `100%` off-by-one, `0%` over-label,
  `0%` severe over-label.
- `evidence-first`: `100%` exact, `100%` off-by-one, `0%` over-label,
  `0%` severe over-label.
- `gate-derived`: `95%` exact, `100%` off-by-one, `0%` over-label,
  `0%` severe over-label.

Artifact:

`output/method-pack-diagnostics/2026-05-07T21-07-03-277Z/discernment-calibration/`

Operational note:

- Prompt tokens dropped from roughly `580-670` in the all-rubric shape to
  roughly `340-407` in the dimension-specific shape.
- DeepSeek prompt cache hits continued to appear on repeated prefixes.
- The useful production shape is now one excerpt, one dimension, one rubric.

## Next

- Apply `direct-label` and `evidence-first` sensors to real planner cohort
  outputs by chapter/dimension.
- Have the operator review a small sample to calibrate labels before using
  model-only results as a decision signal.
- Track where method packs change dimension labels, not just aggregate quality.
