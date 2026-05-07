---
status: active
eval: planner-discernment-real-data-v0
updated: 2026-05-07
---

# Planner Discernment Real Data V0

## Purpose

This diagnostic applies calibrated planner-quality labels to real planner
cohort outputs. It is comparison evidence only:

- no planner prompt change;
- no writer/checker/UI change;
- no promotion gate;
- no automatic rewrite or rejection.

The first target is the live method-pack cohort:

`output/method-pack-diagnostics/2026-05-07T13-51-44-961Z/cohort`

## Runner

Command shape:

```bash
bun run diagnostics:planner-discernment-real-data -- \
  --live \
  --model deepseek-v4-flash \
  --no-thinking \
  --concurrency 10 \
  --max-tokens 1400 \
  --replicate 1 \
  --chapter-limit 2 \
  --mode direct-label
```

The runner labels:

- chapter excerpts for `characterAgency`, `worldPressure`,
  `endpointLanding`, `causalMomentum`, and `promiseProgress`;
- scene excerpts for `sceneDramaturgy`.

It groups calls by dimension to preserve a stable prompt prefix for cache
reuse.

## Pilot Shape

Pilot scope:

- 6 cohort cells: all concepts, replicate 1 only;
- 2 arms per cell: no-method control and commercial fantasy/adventure method
  pack;
- first 2 chapters only;
- 72 real excerpts;
- 168 labels per prompt mode.

This is enough to detect obvious directional changes without spending on the
full 18-cell cohort.

## Direct-Label Pilot

Artifact:

`output/method-pack-diagnostics/2026-05-07T21-43-19-012Z/planner-discernment-real-data/`

Result:

| Dimension | Unit | Control Mean | Method Mean | Delta | Interpretation |
| --- | --- | ---: | ---: | ---: | --- |
| `characterAgency` | chapter | 1.92 | 1.75 | -0.17 | method slightly worse |
| `worldPressure` | chapter | 2.00 | 2.00 | 0.00 | no difference |
| `endpointLanding` | chapter | 2.00 | 2.00 | 0.00 | no difference |
| `causalMomentum` | chapter | 2.08 | 2.00 | -0.08 | no useful lift |
| `promiseProgress` | chapter | 2.00 | 2.00 | 0.00 | no difference |
| `sceneDramaturgy` | scene | 2.00 | 2.00 | 0.00 | no difference |

Lowest-label examples were all `AGENCY-1`. The common reason was weak linkage
between protagonist choice, pressure, cost, and concrete consequence.

## Evidence-First Cross-Check

Artifact:

`output/method-pack-diagnostics/2026-05-07T21-44-22-045Z/planner-discernment-real-data/`

Result:

| Dimension | Unit | Control Mean | Method Mean | Delta | Interpretation |
| --- | --- | ---: | ---: | ---: | --- |
| `characterAgency` | chapter | 1.67 | 1.67 | 0.00 | no difference |
| `worldPressure` | chapter | 2.00 | 2.00 | 0.00 | no difference |
| `endpointLanding` | chapter | 2.08 | 2.08 | 0.00 | no difference |
| `causalMomentum` | chapter | 2.00 | 2.00 | 0.00 | no difference |
| `promiseProgress` | chapter | 2.00 | 2.00 | 0.00 | no difference |
| `sceneDramaturgy` | scene | 2.00 | 2.00 | 0.00 | no difference |

Evidence-first was more conservative on character agency but still found no
method-pack advantage.

## Interpretation

The semantic sensor is useful on real data, but this first run shows two
limits:

1. The commercial fantasy/adventure method pack does not show a semantic lift
   on the sampled real planner outputs.
2. Several dimensions saturate at level 2 on current planner outputs. That
   means they can identify broken or missing planning shape, but they are not
   yet sharp enough to separate decent from excellent plans.

Current useful finding:

- Character agency is the most informative live dimension so far. The repeated
  weakness is not "characters absent"; it is choices without sufficiently
  concrete pressure, cost, and consequence.

Current non-finding:

- World pressure, endpoint landing, causal momentum, promise progress, and
  scene dramaturgy mostly say the sampled plans are basically functional. They
  do not currently explain why a plan would feel richer or more compelling.

## Next Diagnostic Improvements

Do not promote or reject planner methods from this pilot alone.

Next useful slices:

- Add sharper real-data dimensions for motivation specificity, relationship
  state movement, scene stakes/value shift, and promise novelty.
- Build a small operator calibration queue from the `AGENCY-1` and saturated
  `*-2` examples.
- Run the full 18-cell cohort only after the dimensions can separate quality
  above "basic playable plan."
