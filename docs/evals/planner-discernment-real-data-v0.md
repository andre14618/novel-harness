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
- scene excerpts for `sceneDramaturgy`, `motivationSpecificity`,
  `characterMateriality`, `relationshipDelta`, `worldFactPressure`, and
  `stakesValueShift`.

It groups calls by dimension to preserve a stable prompt prefix for cache
reuse.

Applicability is separate from quality. The runner must not score every
dimension against every scene:

- `relationshipDelta` is skipped unless the scene requires a non-POV character
  and has deterministic relationship-pressure signals such as trust, leverage,
  debt, alliance, betrayal, promise, rivalry, or suspicion.
- `characterMateriality` is skipped unless the scene requires a non-POV
  character.
- `worldFactPressure` is skipped unless the scene requires at least one world
  fact.
- Skipped rows are reported as applicability skips and are not counted as low
  labels.
- `REL-1` means an applicable relationship-oriented scene is static. A
  non-relationship scene should normally be `not applicable`, not `REL-0` or
  `REL-1`.

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

## Richness Sensor Pilot

After the first real-data run saturated on most floor dimensions, three
scene-level richness dimensions were added:

- `motivationSpecificity`: does the scene action flow from a character-specific
  desire, fear, flaw, value, or relationship pressure?
- `relationshipDelta`: does the scene change trust, leverage, debt, loyalty,
  rivalry, intimacy, suspicion, or power?
- `stakesValueShift`: does the scene visibly move a value state, such as safe
  to exposed, trusted to suspect, legal to criminal, or hopeful to trapped?

Calibration:

- `evidence-first` hit `100%` exact on the 21 new known-answer cases.
- `direct-label` hit `95%` exact, with one off-by-one motivation over-label.

Calibration artifact:

`output/method-pack-diagnostics/2026-05-07T21-56-20-313Z/discernment-calibration/`

### Richness Evidence-First Run

Command:

```bash
bun run diagnostics:planner-discernment-real-data -- \
  --live \
  --model deepseek-v4-flash \
  --no-thinking \
  --concurrency 10 \
  --max-tokens 1400 \
  --replicate 1 \
  --chapter-limit 2 \
  --mode evidence-first \
  --dimension motivationSpecificity \
  --dimension relationshipDelta \
  --dimension stakesValueShift
```

Artifact:

`output/method-pack-diagnostics/2026-05-07T21-56-48-363Z/planner-discernment-real-data/`

Result:

| Dimension | Unit | Control Mean | Method Mean | Delta | Interpretation |
| --- | --- | ---: | ---: | ---: | --- |
| `motivationSpecificity` | scene | 2.00 | 2.00 | 0.00 | saturated |
| `relationshipDelta` | scene | 1.92 | 1.83 | -0.08 | method weaker |
| `stakesValueShift` | scene | 2.00 | 2.00 | 0.00 | saturated |

### Richness Direct-Label Cross-Check

Artifact:

`output/method-pack-diagnostics/2026-05-07T21-57-50-023Z/planner-discernment-real-data/`

Result:

| Dimension | Unit | Control Mean | Method Mean | Delta | Interpretation |
| --- | --- | ---: | ---: | ---: | --- |
| `motivationSpecificity` | scene | 1.92 | 1.88 | -0.04 | method slightly weaker |
| `relationshipDelta` | scene | 1.92 | 1.75 | -0.17 | method weaker |
| `stakesValueShift` | scene | 2.00 | 2.00 | 0.00 | saturated |

## Richness Interpretation

The new dimensions are more useful than the first floor set, but uneven:

- `relationshipDelta` is the strongest new signal. It found repeated scenes
  where characters are co-present or emotionally reacting, but the relationship
  state does not concretely change.
- `motivationSpecificity` is somewhat useful, especially under `direct-label`,
  but still often sits at level `2`. It needs operator review before we trust
  it as a promotion signal.
- `stakesValueShift` remains a floor check on this cohort. Current planner
  outputs usually include a value shift, but the label does not distinguish
  good from excellent stakes design yet.

Method-pack implication:

- The commercial fantasy/adventure method pack still does not show a semantic
  lift on this sampled cohort.
- It may be worse on relationship movement, which fits the broader concern
  that method scaffolds can improve structure while failing to make characters
  drive scenes.

Next value-add slice:

- Build a small operator calibration queue from `REL-1`, `MOTIVE-1`, and
  saturated `MOTIVE-2` / `STAKES-2` examples.
- Revise upstream scene contracts to require planned relationship-state deltas
  only where the scene actually depends on a relationship; avoid forcing every
  scene to carry one.
- Add a sharper stakes sensor later if operator review shows `STAKES-2`
  hides meaningful quality differences.

Follow-up correction:

- Earlier relationship means included scenes that may have been valid
  non-relationship scenes, so they are useful as a prompt to investigate, not
  as a clean score.

## Applicability-Filtered Relationship Rerun

After adding relationship applicability skips, `relationshipDelta` was rerun on
the same replicate/chapter-limit shape:

- cells: `6`;
- excerpts: `72`;
- judged relationship scenes: `34`;
- applicability skips: `14`, evenly split `7` control / `7` method.

Evidence-first artifact:

`output/method-pack-diagnostics/2026-05-07T22-12-07-034Z/planner-discernment-real-data/`

Evidence-first result:

| Dimension | Unit | Control Mean | Method Mean | Delta | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| `relationshipDelta` | scene | 2.00 | 2.00 | 0.00 | one method `REL-1`; one method `REL-3` |

Direct-label artifact:

`output/method-pack-diagnostics/2026-05-07T22-12-07-057Z/planner-discernment-real-data/`

Direct-label result:

| Dimension | Unit | Control Mean | Method Mean | Delta | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| `relationshipDelta` | scene | 2.00 | 1.94 | -0.06 | two method `REL-1`; one method `REL-3` |

Updated interpretation:

- The broad "relationship regression" concern weakened after applicability
  filtering.
- The useful queue is now the small set of applicable `REL-1` method scenes,
  not all non-relationship scenes.
- This supports a conditional planner contract: require relationship-state
  movement only when a scene actually depends on relationship pressure.

## Conditional Materiality Pilot

After adding `characterMateriality` and `worldFactPressure`, the same
replicate/chapter-limit shape was run with evidence-first labels:

- cells: `6`;
- excerpts: `72`;
- judged rows: `73`;
- applicability skips: `23`.

Calibration artifact:

`output/method-pack-diagnostics/2026-05-07T22-26-20-352Z/discernment-calibration/`

Real-data artifact:

`output/method-pack-diagnostics/2026-05-07T22-25-29-493Z/planner-discernment-real-data/`

Result:

| Dimension | Unit | Control Mean | Method Mean | Delta | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| `characterMateriality` | scene | 2.00 | 1.94 | -0.06 | one method `MATERIAL-1` |
| `worldFactPressure` | scene | 1.95 | 2.00 | +0.05 | one control `WFACT-1` |

Interpretation:

- Both dimensions are usable as targeted review sensors.
- `characterMateriality` found one method-arm scene where a required
  antagonist may be procedurally present but not materially shaping the scene
  beyond the expected status loss.
- `worldFactPressure` found one control scene where a required world fact was
  present but may not actually constrain the action.
- The signal is narrow, not a promotion result. Use the flagged examples for
  operator calibration before changing planner contracts.

## Operator Calibration Queue

The review queue generator turns selected diagnostic labels into operator
review rows with source excerpt, judge evidence, missing-for-next-level, and a
blank operator disposition:

```bash
bun run diagnostics:planner-discernment-review-queue -- \
  --report output/method-pack-diagnostics/2026-05-07T21-56-48-363Z/planner-discernment-real-data \
  --report output/method-pack-diagnostics/2026-05-07T22-12-07-034Z/planner-discernment-real-data \
  --report output/method-pack-diagnostics/2026-05-07T22-25-29-493Z/planner-discernment-real-data \
  --limit 20
```

Artifact:

`output/method-pack-diagnostics/2026-05-07T22-27-03-873Z/planner-discernment-review-queue-multi-report/`

Default labels:

- `REL-1`;
- `MOTIVE-1`;
- `MOTIVE-2`;
- `STAKES-2`;
- `MATERIAL-1`;
- `WFACT-1`.

Purpose:

- decide whether a diagnostic label is actually a story-quality problem;
- decide whether the fix belongs in the planner contract, method pack,
  diagnostics only, or nowhere;
- prevent model labels from becoming unreviewed production blockers.

## Finding Aggregate / Plan Rewrite Bridge

The finding aggregate is the first deterministic bridge from diagnostics toward
plan rewrite. It groups selected labels by planning target and emits a
rewrite packet:

- target: scene `beat_plan.description` when `sceneId` exists, otherwise
  chapter `chapter_outline.purpose`;
- fix intents: deterministic routing such as material-character pressure,
  operational-world-fact pressure, relationship delta, motivation sharpening,
  or stakes sharpening;
- preserve IDs: required obligation, character, and world-fact IDs parsed from
  structured result fields or excerpt text;
- proposal candidate: a `planning_edit`-shaped `field_replace` target marked
  `requiresProposedValue: true`.

It does not mutate a plan, create a proposal envelope, auto-approve, or invent
the corrected plan text. The missing step is semantic: an operator or rewrite
agent still has to produce the proposed value and preserve or intentionally
remove the listed IDs.

Command:

```bash
bun run diagnostics:planner-discernment-finding-aggregate -- \
  --report output/method-pack-diagnostics/2026-05-07T21-56-48-363Z/planner-discernment-real-data \
  --report output/method-pack-diagnostics/2026-05-07T22-12-07-034Z/planner-discernment-real-data \
  --report output/method-pack-diagnostics/2026-05-07T22-25-29-493Z/planner-discernment-real-data \
  --limit 20
```

Artifact:

`output/method-pack-diagnostics/2026-05-07T23-00-00-000Z/planner-discernment-finding-aggregate-multi-report/`

This run emitted `20` grouped targets and `50` findings. The default aggregate
also includes `MATERIAL-0` and `WFACT-0` because complete absence of material
character/world pressure is a higher-severity rewrite candidate than a merely
weak scene.

Use this artifact after operator calibration to choose the first default-off
planner rewrite experiment. A valid next experiment should take one aggregate
group, author a new proposed target value, then pass it through normal
`planning_edit` proposal review rather than writing directly into the plan.
