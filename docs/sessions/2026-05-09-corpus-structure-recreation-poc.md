---
status: active
updated: 2026-05-09
role: session-record
lane: upstream-planning-methodology
---

# Corpus Structure Recreation POC Slice

## Change Packet

- Optimized layer: upstream concept/planning methodology.
- Exact change: create a diagnostic path for turning the local corpus novel's
  Stage 6 structural annotations into a chapter/scene reference scaffold.
- Held constant: production planner, writer, checker policy, UI, proposals,
  and runtime defaults.
- Expected benefit: make the intended planner granularity concrete before
  testing new planner prompts or prose generation.
- Downstream projection: if the planner can recreate comparable structure from
  compressed premise/context, then scene-first writing and scene-scoped
  checking have a realistic target.
- Evidence gate: local reference report first, then planner recreation
  attempt, then operator side-by-side review, then optional prose POC.

## Implemented

- Added `docs/charters/corpus-structure-recreation-poc.md`.
- Added `scripts/evals/corpus-structure-reference.ts`.
- Added `diagnostics:corpus-structure-reference`.
- Added a focused unit test for the reference aggregation.
- Updated methodology docs to treat corpus structure recreation as a high-value
  diagnostic option while keeping old corpus beats as annotation granularity,
  not the future writer call unit.

## Source Boundary

The corpus reference may include source-derived plot summaries only in ignored
`output/` artifacts. Committed docs describe the method, schema, metrics, and
decision gates, not the source novel's full outline.

## First Local Run

Metrics-only command:

```bash
bun run diagnostics:corpus-structure-reference -- \
  --novel salvatore-icewind-dale \
  --book crystal_shard \
  --output-dir output/corpus-structure-reference/crystal_shard
```

Private structural-review command:

```bash
bun run diagnostics:corpus-structure-reference -- \
  --novel salvatore-icewind-dale \
  --book crystal_shard \
  --include-summaries \
  --output-dir output/corpus-structure-reference/crystal_shard-with-summaries
```

## Next

Run the reference report, inspect the chapter/scene granularity, then design a
default-off planner recreation diagnostic:

```text
compressed corpus premise/context
  -> generated chapter/scene planner contract
  -> structural comparison against the reference
  -> operator side-by-side decision
```

## Continued Slice

User direction: make the scaffold sufficient to remake by plan and write an
example imitative chapter. Interpreted as full structural imitation, not source
prose/style copying.

Added `diagnostics:corpus-recreation-poc`, which:

- reads a local corpus reference, preferably the `--include-summaries` version;
- builds an original analog seed with different names, premise, artifact,
  world rules, and story debts;
- asks DeepSeek to create a scene-first chapter plan matching the reference
  chapter's scene count, scene sizes, value-turn cadence, MICE/thread sequence,
  gap/beat-hint density, and structural-function hints;
- optionally drafts one original example chapter from that plan;
- writes all detailed artifacts to ignored `output/`;
- emits deterministic plan/prose comparison JSON plus a compact report.

Command:

```bash
bun run diagnostics:corpus-recreation-poc -- --live --write --scene-calls \
  --reference output/corpus-structure-reference/crystal_shard-with-summaries/reference.json \
  --chapter 1 \
  --model deepseek-v4-flash \
  --output-dir output/corpus-recreation-poc/crystal_shard-ch1-flash-scene-calls
```

## Live Evidence

Whole-chapter JSON writing preserved the plan shape but compressed prose. The
best whole-chapter run matched 4/4 scenes with no source leakage, but landed
below the target prose length and failed the deterministic prose-shape check.

Scene-call writing passed the first usable scaffold gate:

```text
output/corpus-recreation-poc/crystal_shard-ch1-flash-scene-calls-r4/report.md
```

Result:

- target: 4 scenes, 1832 reference words, 19 annotation beats;
- plan fit: 4/4 scenes, 4/4 polarity sequence, 4/4 MICE/thread sequence,
  19/19 beat-hint shape, no plan issues;
- prose fit: 4/4 scenes, 1583/1832 words, all scene minimums met;
- source boundary: no forbidden source terms found.

Implementation note: the scene writer uses per-scene calls, deterministic
scene word minimums, prior-prose expansion on retry, best-attempt retention,
and a bounded retry for invalid JSON. This is diagnostic scaffolding only. It
does not change production planner or writer routing.

## Expanded Data

Additional live runs tested three chapter shapes:

| Chapter | Shape | Model | Plan Fit | Prose Fit | Notes |
| --- | --- | --- | --- | --- | --- |
| 2 | 4 scenes / 3353w | Flash | pass | pass, 2874/3353 | normal medium chapter |
| 5 | 1 scene / 2255w | Flash | pass | near miss, 1527/2255 | single long scene under minimum by 51w |
| 5-r2 | 1 scene / 2255w | Flash | pass | pass, 2372/2255 | rerun suggests stochastic expansion miss |
| 5-pro | 1 scene / 2255w | Pro | pass | pass, 3156/2255 | much slower and near upper prose band |
| 8 | 7 scenes / 3621w | Flash | pass | near miss, 2786/3621 | one scene under minimum by 42w |
| 8-r3 | 7 scenes / 3621w | Flash | pass | pass, 3081/3621 | rerun passed after malformed-output retry fix |

Findings:

- Plan-shape matching held across all sampled chapters: scene count, polarity,
  MICE/thread sequence, and beat-hint density all matched.
- Prose expansion is the main unstable surface. Scene calls usually recover,
  but long scenes and high-scene-count chapters sometimes need retries.
- Pro thinking is not an obvious default route here: it passed the single long
  scene but was materially slower and expanded close to the upper word band.
- One live chapter-8 rerun exposed truncated/malformed JSON without a closing
  brace. The diagnostic now wraps extract/parse failures as retryable
  `ModelJsonParseError` evidence.

Next data step: run a small planned cohort over diverse chapter shapes and add
operator/semantic review for story quality. Deterministic structure fit alone
does not prove the analog chapter is compelling.

## Beat/Semantic Conclusion

Clarified decision in L092: existing semantic checks are real, but they were
attached to the legacy beat-writing pipeline. They check beat event enactment,
grounding, and chapter-plan drift; they were not proof that beat-sized chunks
are the right future writing unit.

For the next methodology slice:

- scenes are the primary plan/write/check unit;
- beats remain annotation, obligation, and traceability refs inside scenes;
- adapt the existing narrow semantic judge/checker shape to scene contract plus
  scene prose before inventing new checkers;
- keep findings diagnostic/readiness-oriented until operator review and
  downstream outcome data prove value.

## Scene Semantic Review Adapter

Added `diagnostics:corpus-recreation-semantic-review`, a diagnostic-only
semantic review surface for scene-first POC artifacts. It reuses the existing
planner-discernment narrow judge shape against:

- the scene contract;
- relevant character/world facts;
- scene obligations;
- beat hints as internal annotations;
- generated scene prose.

Default dimensions are scene dramaturgy, motivation specificity, world-fact
pressure, and relationship delta. Applicability gates skip relationship/world
dimensions when the scene has no matching supporting character or world fact.
Findings are evidence for operator review, not blockers or automatic rewrite
triggers.

Live command:

```bash
bun run diagnostics:corpus-recreation-semantic-review -- --live \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch1-flash-scene-calls-r4 \
  --output-dir output/corpus-recreation-poc/crystal_shard-ch1-flash-scene-calls-r4/semantic-review-live \
  --model deepseek-v4-flash \
  --mode evidence-first \
  --concurrency 4
```

Live result on the first passing chapter-1 scene-call POC:

- 4 scenes, 16 semantic tasks, 0 applicability skips;
- scene dramaturgy: mean 1.75, 3/4 at SCENE-2;
- motivation specificity: mean 1.50, 2/4 at MOTIVE-2;
- world-fact pressure: mean 1.75, 3/4 at WFACT-2;
- relationship delta: mean 1.75, 3/4 at REL-2.

Weaknesses clustered in scene 4 and scene 1 motivation: the judge found generic
motivation, weak final-scene turn/consequence, and underused world/relationship
pressure. That is useful as a diagnostic: the structure can recreate scene
shape, but the prose still needs stronger character-specific choice pressure
before this should influence production planner/writer changes.

## Multi-Chapter Semantic Sweep

Ran the same diagnostic over the existing passing scene-call artifacts for
chapters 2, 5, and 8. No new prose was generated.

| Chapter | Scenes | Tasks | Low Findings | Main Weakness |
| --- | ---: | ---: | ---: | --- |
| 1 | 4 | 16 | 5 | generic motivation and weak final-scene pressure |
| 2 | 4 | 16 | 6 | passive opening and relationship deltas not changing state |
| 5 | 1 | 4 | 0 | clean on sampled dimensions |
| 8 | 7 | 28 | 1 | one scene used world facts as background only |

Conclusion: the scene-first POC has enough structure to be reviewed
semantically, and the narrow judge showed discernment beyond deterministic
shape checks. The next methodology change should not be a beat-count or
calibration knob. It should strengthen the upstream scene contract so each
planned scene carries a character-specific choice, a concrete relationship or
world-pressure change when applicable, and a dramatized consequence before the
writer sees it.
