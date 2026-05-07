---
status: active
eval: planner-discernment-calibration-v0
updated: 2026-05-07
---

# Planner Discernment Calibration V0

## Purpose

This eval tests whether DeepSeek can make useful narrow semantic judgments for
planning quality after broad pairwise judging failed position-bias controls.

The target is discernment, not preference:

- one excerpt at a time;
- one dimension at a time;
- anchored categorical labels;
- known expected labels;
- exact/off-by-one/over-label metrics.

## Dimensions

Initial dimensions:

- `characterAgency`: `AGENCY-0` through `AGENCY-3`.
- `worldPressure`: `WORLD-0` through `WORLD-3`.
- `endpointLanding`: `ENDPOINT-0` through `ENDPOINT-3`.

The labels are ordinal but not open-ended scores. Higher labels require concrete
evidence, and the judge is instructed to use the lowest label whose evidence
requirements are fully satisfied.

## Prompt Shapes

The harness tests three shapes:

- `direct-label`: classify directly into an anchored label and cite evidence.
- `evidence-first`: extract evidence first, then classify.
- `gate-derived`: fill binary evidence gates; the script derives the label.

Each live call now receives exactly one dimension rubric. Do not include all
rubric definitions in a normal discernment call. Group calls by
`promptMode + dimension` so the stable prefix can be reused and the model is not
asked to hold unrelated labels in context.

## Fixture

Known-answer fixture:

`docs/fixtures/evals/planner-discernment-calibration-v0.json`

It includes clean and adversarial cases:

- observer/non-agentic turns;
- energetic action with no meaningful cost;
- antagonist-driven turns;
- decorative lore;
- operational world constraints;
- world rules that force sacrifice;
- declared endpoints that are disconnected, verbal-only, landed, or propulsive.

## Live Flash Result

Command:

```bash
bun run diagnostics:planner-discernment-calibration -- \
  --live \
  --model deepseek-v4-flash \
  --no-thinking \
  --concurrency 6 \
  --max-tokens 1400
```

Artifact:

`output/method-pack-diagnostics/2026-05-07T20-27-33-288Z/discernment-calibration/`

Result:

| Prompt shape | Exact | Off-by-one | Over-label | Severe over-label | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| `direct-label` | 95% | 100% | 5% | 0% | `USEFUL` |
| `evidence-first` | 90% | 100% | 0% | 0% | `USEFUL` |
| `gate-derived` | 67% | 100% | 24% | 0% | `BORDERLINE` |

Interpretation:

- DeepSeek Flash can distinguish anchored quality levels when the task is
  narrowed to one dimension and one excerpt.
- `direct-label` is most accurate on this fixture.
- `evidence-first` is slightly more conservative and may be safer when false
  positives are costly.
- `gate-derived` is not the best workaround here; it over-labels because gate
  truthiness is too coarse.

## Dimension-Specific Flash Result

After the first result, the prompt shape was refined so each call sees only the
active dimension's labels and output contract. Calls are grouped by
`promptMode + dimension`.

Command:

```bash
bun run diagnostics:planner-discernment-calibration -- \
  --live \
  --model deepseek-v4-flash \
  --no-thinking \
  --concurrency 6 \
  --max-tokens 1400
```

Artifact:

`output/method-pack-diagnostics/2026-05-07T21-07-03-277Z/discernment-calibration/`

Result:

| Prompt shape | Exact | Off-by-one | Over-label | Severe over-label | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| `direct-label` | 100% | 100% | 0% | 0% | `USEFUL` |
| `evidence-first` | 100% | 100% | 0% | 0% | `USEFUL` |
| `gate-derived` | 95% | 100% | 0% | 0% | `USEFUL` |

Prompt token counts also dropped materially: the earlier all-rubric shape
commonly sent about `580-670` prompt tokens, while the dimension-specific shape
mostly sent about `340-407`.

Current recommendation:

- Use `direct-label` as the default cheap sensor.
- Use `evidence-first` when an operator needs more explanation or false
  positives are costlier than false negatives.
- Keep `gate-derived` as an experimental/checking shape, not the default.

## Live Pro Sample

Command:

```bash
bun run diagnostics:planner-discernment-calibration -- \
  --live \
  --model deepseek-v4-pro \
  --mode evidence-first \
  --concurrency 2 \
  --max-tokens 4000
```

Artifact:

`output/method-pack-diagnostics/2026-05-07T20-30-40-284Z/discernment-calibration/`

Result:

| Prompt shape | Exact | Off-by-one | Over-label | Severe over-label | Verdict |
| --- | ---: | ---: | ---: | ---: | --- |
| `evidence-first` | 86% | 100% | 10% | 0% | `USEFUL` |

Pro completed on the narrowed task with a larger token cap, but it did not beat
Flash on this fixture and used substantially more completion tokens. Keep Pro as
sampled adjudication, not the default calibration workhorse.

## Working Rule

Do not use broad pairwise A/B semantic judging for method promotion.

Use narrow categorical discernment first:

1. Run deterministic structural gates.
2. Run single-dimension categorical labels on chapter/scene excerpts.
3. Prefer `direct-label` or `evidence-first`.
4. Track high-bias/over-label rates explicitly.
5. Use operator review to calibrate expected labels on real harness outputs.

Only after those signals are stable should the harness spend calls on
draft-from-plan or prose-level semantic comparisons.
