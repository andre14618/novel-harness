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

## Exact-ID Correction

During the next POC diagnostic slice, rejected a fuzzy deterministic shortcut
that tried to infer active scene pressure from seed-word overlap. That violated
the stable-ID norm already captured in `docs/lessons-learned.md`: deterministic
contract checks must not turn text overlap into semantic proof.

The corrected plan diagnostic checks explicit structure only:

- `choiceAlternatives` is a declared field, not parsed from prose;
- every scene must declare obligations if it wants deterministic pressure
  evidence;
- obligation `sourceId` values must exactly match known character, world-fact,
  protagonist, or story-debt IDs;
- semantic claims such as "the world fact mattered" or "the motivation was
  character-specific" stay in the scene semantic review/operator layer.

Follow-up scan found the same risk in two eval surfaces and corrected them:

- `corpus-recreation-semantic-review` applicability now uses exact obligation
  `sourceId`s only, not character/world keyword overlap in scene prose.
- `planner-discernment-real-data` no longer suppresses `relationshipDelta`
  judging because a relationship-keyword regex did not fire.
- method-pack deterministic diagnostics now state that a structural lift only
  advances to semantic review; it is not production promotion evidence.

## Exact-ID Planner Smoke

After the correction, reran the planner-only chapter-1 POC with no prose
generation:

```bash
bun run diagnostics:corpus-recreation-poc -- --live \
  --reference output/corpus-structure-reference/crystal_shard-with-summaries/reference.json \
  --chapter 1 \
  --model deepseek-v4-flash \
  --output-dir output/corpus-recreation-poc/crystal_shard-ch1-flash-exact-id-r1
```

Result:

- plan fit: 4/4 scenes, 4/4 polarity sequence, 4/4 MICE/thread sequence,
  19/19 beat-hint shape;
- contract fit: 4/4 scenes had explicit `choiceAlternatives`, declared
  obligations, known obligation `sourceId`s, and observable consequences;
- issues: none in deterministic structure/contract comparison;
- cost shape: one DeepSeek V4 Flash planner call, 3795 input tokens and 2809
  output tokens.

Interpretation: the exact-ID schema is viable for planner output. This does not
prove prose quality or semantic value. The next useful evidence step is to run
the same exact-ID artifact through scene-call writing plus scene semantic
review, then compare whether the declared choices and obligations actually
matter in prose.

## Exact-ID Scene Write + Semantic Review

Ran the next evidence step as a fresh exact-ID scene-call plan/write artifact:

```bash
bun run diagnostics:corpus-recreation-poc -- --live --write --scene-calls \
  --reference output/corpus-structure-reference/crystal_shard-with-summaries/reference.json \
  --chapter 1 \
  --model deepseek-v4-flash \
  --output-dir output/corpus-recreation-poc/crystal_shard-ch1-flash-exact-id-scene-calls-r1
```

Result:

- plan shape still fit the reference: 4/4 scenes, 4/4 polarity sequence, 4/4
  MICE/thread sequence, 19/19 beat-hint shape;
- contract checks found a useful weakness: only 2/4 scenes had observable
  consequences; scenes 2 and 4 used consequences that were generic,
  internal-only, or indistinct from outcome;
- chapter shape passed: 4/4 scenes, 1571/1832 words, every scene met its
  deterministic minimum, and no forbidden source terms appeared;
- two scene writer calls required expansion retries, so scene-call writing is
  still the right diagnostic path for observing per-scene sizing.

Then ran exact-ID semantic review:

```bash
bun run diagnostics:corpus-recreation-semantic-review -- --live \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch1-flash-exact-id-scene-calls-r1 \
  --output-dir output/corpus-recreation-poc/crystal_shard-ch1-flash-exact-id-scene-calls-r1/semantic-review-live \
  --model deepseek-v4-flash \
  --mode evidence-first \
  --concurrency 4
```

Result:

- 12 applicable semantic tasks and 4 exact-ID applicability skips;
- all applicable dimensions landed at level 2 with no low-signal findings:
  scene dramaturgy, motivation specificity, relationship delta, and world-fact
  pressure;
- skips were based on missing exact supporting-character or world-fact
  obligation IDs, not keyword overlap.

Interpretation: deterministic contract checks and semantic review are seeing
different useful layers. The deterministic layer caught weak planned
consequence wording before prose. The semantic layer judged the generated prose
adequate on the currently sampled dimensions, while preserving exact-ID
applicability boundaries. Next useful improvement is not another hard
structure metric; it is either operator review of the generated chapter or a
small exact-ID multi-chapter sample to see whether weak planned consequences
predict prose weakness at larger N.

## Exact-ID Multi-Chapter Sample

Ran exact-ID scene-call plan/write plus exact-ID semantic review for chapters
2, 5, and 8, then added a local deterministic aggregate helper:

```bash
bun run diagnostics:corpus-recreation-aggregate -- \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch1-flash-exact-id-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-exact-id-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch5-flash-exact-id-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch8-flash-exact-id-scene-calls-r1 \
  --output output/corpus-recreation-poc/exact-id-scene-calls-aggregate-r1.md \
  --json output/corpus-recreation-poc/exact-id-scene-calls-aggregate-r1.json
```

Aggregate:

| Chapter | Shape | Words | Contract | Semantic |
| --- | --- | --- | --- | --- |
| 1 | 4/4 scenes | 1571/1832 (0.86) | choices/IDs 4/4, consequences 2/4 | 12 tasks, 0 low, 4 skips |
| 2 | 4/4 scenes | 2584/3353 (0.77) | choices/IDs/consequences 4/4 | 13 tasks, 3 low, 3 skips |
| 5 | 1/1 scene | 1974/2255 (0.88) | choices/IDs/consequences 1/1 | 4 tasks, 0 low |
| 8 | 7/7 scenes | 3159/3621 (0.87) | choices/IDs/consequences 7/7 | 22 tasks, 0 low, 6 skips |

Chapter 2 low findings:

- scene 1 world-fact pressure: the world fact was present but did not actively
  constrain choice or alter the outcome;
- scene 2 relationship delta: interaction did not concretely change trust,
  obligation, or relationship state;
- scene 3 world-fact pressure: the key did not actively constrain options,
  create cost, or change outcome.

Findings:

- exact-ID planning shape is stable across sampled chapter shapes, including a
  one-scene long chapter and a seven-scene chapter;
- prose shape is consistently under target but above deterministic minimums,
  suggesting scene-call retries are adequate for diagnostics but not enough to
  declare production word-control solved;
- weak deterministic consequence wording did not reliably predict semantic
  low-signal findings at this small N: chapter 1 had consequence warnings but
  no semantic lows; chapter 2 had a clean deterministic contract but three
  semantic lows;
- therefore the next planner-quality lever should be semantic plan-readiness
  review of obligation materiality, not more deterministic structure scoring.

## Readiness Candidate Bridge

Added `diagnostics:corpus-recreation-readiness`, a no-LLM/no-DB adapter that
turns low scene semantic findings into Plan Readiness-compatible groups. This
keeps the next step conversational/manual:

```bash
bun run diagnostics:corpus-recreation-readiness -- \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch1-flash-exact-id-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-exact-id-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch5-flash-exact-id-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch8-flash-exact-id-scene-calls-r1 \
  --output output/corpus-recreation-poc/exact-id-scene-calls-readiness-r1.md \
  --json output/corpus-recreation-poc/exact-id-scene-calls-readiness-r1.json
```

Output:

- 3 groups / 3 findings, all from chapter 2;
- each group now targets the scene as `scene_plan:<sceneId>:description`;
  `beat_plan` remains a legacy compatibility alias for older rows and envelopes;
- each group preserves exact obligation IDs plus exact character/world IDs;
- each group asks an operator question, for example whether a world fact should
  actively constrain choice/outcome or whether background presence is
  acceptable.

This is the correct shape for the current lane: diagnostics produce review
candidates, the operator decides disposition, and accepted changes can later
become normal manual `planning_edit` proposals. The adapter intentionally does
not create proposals or mutate plans.

## Materiality-V1 Planner Variant

Added a default-off planner variant:

```bash
--planner-variant materiality-v1
```

Change packet:

- optimized layer: planner contract only;
- exact change: each obligation may now carry `materialityTest`, and the
  `materiality-v1` prompt asks the planner to state how the exact source ID
  changes choice, cost, constraint, relationship state, outcome, or future
  pressure;
- held constant: scene writer, semantic review dimensions, source boundary,
  and runtime defaults;
- expected benefit: reduce cases where exact IDs are present but the world
  fact or relationship does not materially affect prose;
- evidence gate: chapter-2 before/after because baseline chapter 2 had three
  semantic lows despite clean deterministic structure.

Live command:

```bash
bun run diagnostics:corpus-recreation-poc -- --live --write --scene-calls \
  --planner-variant materiality-v1 \
  --reference output/corpus-structure-reference/crystal_shard-with-summaries/reference.json \
  --chapter 2 \
  --model deepseek-v4-flash \
  --output-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-materiality-v1-scene-calls-r1
```

Then semantic review and aggregate:

```bash
bun run diagnostics:corpus-recreation-semantic-review -- --live \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-materiality-v1-scene-calls-r1 \
  --output-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-materiality-v1-scene-calls-r1/semantic-review-live \
  --model deepseek-v4-flash \
  --mode evidence-first \
  --concurrency 4

bun run diagnostics:corpus-recreation-aggregate -- \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-exact-id-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-materiality-v1-scene-calls-r1 \
  --output output/corpus-recreation-poc/ch2-materiality-v1-comparison-r1.md \
  --json output/corpus-recreation-poc/ch2-materiality-v1-comparison-r1.json
```

Result:

| Chapter | Variant | Shape | Words | Semantic |
| --- | --- | --- | --- | --- |
| 2 | baseline | 4/4 scenes, clean contract | 2584/3353 (0.77) | 13 tasks, 3 lows |
| 2 | materiality-v1 | 4/4 scenes, 4/4 materiality tests | 2693/3353 (0.80) | 13 tasks, 0 lows |

Readiness adapter output for materiality-v1 produced 0 groups, compared with
3 groups for the baseline chapter-2 run.

Caveat: materiality-v1 did not solve prose sizing. One scene stayed below its
deterministic minimum after retries (`analog-ch02-sc03` 651/720). The variant
is promising for obligation materiality, but it should not be promoted without
a small multi-chapter sample and either better scene expansion or a separate
word-shape fix.

## Materiality-V1 Multi-Chapter Follow-Up

Ran the same materiality-v1 plan/write/semantic path on chapters 1, 5, and 8,
then aggregated baseline vs materiality-v1 for chapters 1, 2, 5, and 8:

```bash
bun run diagnostics:corpus-recreation-aggregate -- \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch1-flash-exact-id-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-exact-id-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch5-flash-exact-id-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch8-flash-exact-id-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch1-flash-materiality-v1-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-materiality-v1-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch5-flash-materiality-v1-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch8-flash-materiality-v1-scene-calls-r1 \
  --output output/corpus-recreation-poc/exact-id-vs-materiality-v1-aggregate-r1.md \
  --json output/corpus-recreation-poc/exact-id-vs-materiality-v1-aggregate-r1.json
```

Aggregate summary:

| Chapter | Baseline semantic lows | Materiality-v1 semantic lows | Word-ratio movement |
| --- | ---: | ---: | --- |
| 1 | 0 | 2 | 0.86 -> 0.75 |
| 2 | 3 | 0 | 0.77 -> 0.80 |
| 5 | 0 | 0 | 0.88 -> 0.71 |
| 8 | 0 | 0 | 0.87 -> 0.91 |

Readiness candidates for materiality-v1:

- 2 groups / 2 findings, both chapter 1 scene 4;
- motivation specificity regressed to `MOTIVE-1`;
- world-fact pressure regressed to `WFACT-1`.

Decision: materiality-v1 is `HOLD`. It is directionally useful for the chapter
2 obligation-materiality failure, but not robust enough to promote. It appears
to improve explicit obligation contracts while sometimes making scenes more
mechanical or generic, especially around solo artifact-testing scenes. Next
diagnostic should combine materiality with a stronger POV-motivation tradeoff
requirement, or move to operator review of the materiality/readiness candidates
before adding another prompt knob.

Implementation follow-up: added default-off `--planner-variant
causal-materiality-v2`. It keeps the existing scene-plan schema, still requires
`materialityTest`, and adds prompt-only pressure for motive-caused choices,
explicit tradeoffs, operational world pressure, and causal
pressure/choice/result/consequence chains. This is diagnostic-only; no writer,
checker, proposal, or runtime default changed.

## Causal-Materiality-V2 Chapter 2 Smoke

First live smoke:

```bash
bun run diagnostics:corpus-recreation-poc -- --chapter 2 --live --write \
  --scene-calls --planner-variant causal-materiality-v2 \
  --model deepseek-v4-flash \
  --output-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-causal-materiality-v2-scene-calls-r1
```

Result: failed before plan validation because the planner returned malformed
JSON despite `response_format: json_object`. This was an infrastructure
failure, not a semantic quality result. The POC runner now retries one malformed
planner JSON response with an instruction to return a complete fresh JSON
object.

Rerun:

```bash
bun run diagnostics:corpus-recreation-poc -- --chapter 2 --live --write \
  --scene-calls --planner-variant causal-materiality-v2 \
  --model deepseek-v4-flash \
  --output-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-causal-materiality-v2-scene-calls-r2
bun run diagnostics:corpus-recreation-character-context -- \
  output/corpus-recreation-poc/crystal_shard-ch2-flash-causal-materiality-v2-scene-calls-r2
bun run diagnostics:corpus-recreation-thread-map -- \
  output/corpus-recreation-poc/crystal_shard-ch2-flash-causal-materiality-v2-scene-calls-r2 \
  --output output/corpus-recreation-poc/crystal_shard-ch2-flash-causal-materiality-v2-scene-calls-r2/thread-map.md \
  --json output/corpus-recreation-poc/crystal_shard-ch2-flash-causal-materiality-v2-scene-calls-r2/thread-map.json
bun run diagnostics:corpus-recreation-semantic-review -- \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-causal-materiality-v2-scene-calls-r2 \
  --live --model deepseek-v4-flash --concurrency 4 \
  --output-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-causal-materiality-v2-scene-calls-r2/semantic-review-live \
  --json
bun run diagnostics:corpus-recreation-prose-review -- \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-causal-materiality-v2-scene-calls-r2 \
  --live --model deepseek-v4-flash --concurrency 4 \
  --output-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-causal-materiality-v2-scene-calls-r2/prose-quality-live \
  --json
```

Aggregate:

```bash
bun run diagnostics:corpus-recreation-aggregate -- \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-exact-id-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-materiality-v1-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-causal-materiality-v2-scene-calls-r2 \
  --output output/corpus-recreation-poc/ch2-baseline-materiality-v1-causal-v2-aggregate-r3.md \
  --json output/corpus-recreation-poc/ch2-baseline-materiality-v1-causal-v2-aggregate-r3.json
bun run diagnostics:corpus-recreation-review -- \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-exact-id-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-materiality-v1-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-causal-materiality-v2-scene-calls-r2 \
  --output output/corpus-recreation-poc/ch2-baseline-materiality-v1-causal-v2-review-r1.html
```

Findings:

- deterministic plan fit was clean: 4/4 scenes, 29/29 beat hints, 4/4 choices,
  4/4 known thread refs, 4 scene turns, 8 scene-turn refs, 0 issues;
- character-context diagnostic was clean: 4 packets, 0 structural issues;
- thread map had 8 movement rows, 0 issues, and two future-horizon notes for
  the unpaid key-cost promise/payoff;
- semantic review had 23 tasks, 1 applicability skip, and 0 lows:
  motivation 2.50, promise-payoff 2.25, relationship 2.50, scene 2.25,
  thread progression 2.25, world 2.00;
- prose review had 16 tasks, 0 lows: drama 2.00, pacing 2.00, voice 2.00,
  payoff propulsion 2.75;
- prose was shorter than target: 2187/3353 words, with two advisory
  scene-floor warnings. This is not a blocker under the current word-count
  policy but should be watched for synopsis-like compression.

Interpretation: v2 is a better chapter-2 diagnostic result than baseline and
materiality-v1 on thread refs, character-context closure, semantic lows, and
payoff-propulsion pre-review. It is still a single chapter smoke, not promotion
evidence. Next data step is a small multi-chapter cohort on chapters 1, 2, 5,
and 8, holding writer/checker behavior constant.

## Word Count Policy Update

Changed corpus-recreation prose sizing from hard retry pressure to advisory
diagnostics:

- scene and chapter word counts now report warnings, not deterministic issues;
- scene-call writing no longer retries solely because a scene is below the
  advisory floor;
- malformed JSON and hard structural/source-boundary failures can still
  trigger retry or failure paths;
- aggregate reports separate deterministic `Issues` from `Warnings`.

Reason: word count is a weak proxy for story quality. It can catch obvious
synopsis-level compression, but forcing rewrites to hit a floor risks padding
and can hide the real semantic question: whether the scene goal, opposition,
choice, consequence, and material obligations actually happen in prose.

Prompt cleanup: source-boundary rules stay in the hard rules, but the writer
task no longer repeats "original prose" as a drafting instruction. That phrase
was legal/source-boundary guardrail work and added noise to the actual writing
task. The writer now gets a simpler instruction: draft chapter/scene prose
from the provided plan while obeying source-boundary rules.

Source leakage definition: forbidden source names, places, terms, or exact
source events appearing in the generated analog artifact. It is not a failure
for the artifact to share structural function, scene cadence, or promise
movement with the reference; that is the diagnostic target.

Current review threshold: start side-by-side review now. The useful packet is:

- `plan.json` for the generated scene contract;
- `chapter.md` for actual prose;
- `chapter-comparison.json` for deterministic shape/source-boundary checks;
- `semantic-review-live/semantic-review.json` for scene-level semantic
  findings;
- aggregate/readiness reports for cross-chapter comparison.

If side-by-side review shows scenes are passing structure while reading like
summary, add a narrow `scene completeness / dramatization` semantic diagnostic.
Do not restore hard word-count retry loops as the first fix.

## Static Side-By-Side Review

Added `diagnostics:corpus-recreation-review`, a read-only static HTML report
for operator review:

```bash
bun run diagnostics:corpus-recreation-review -- \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch1-flash-exact-id-scene-calls-r1 \
  --output output/corpus-recreation-poc/crystal_shard-ch1-flash-exact-id-scene-calls-r1/review.html
```

Generated sample:

```text
output/corpus-recreation-poc/crystal_shard-ch1-flash-exact-id-scene-calls-r1/review.html
```

The page shows four columns per scene:

- reference shape reconstructed from existing corpus analysis;
- generated plan contract and obligations;
- generated prose;
- deterministic warnings plus semantic review findings.

This is the right review layer for the current POC because it keeps the
diagnostic evidence visible without adding new blockers, gates, proposals, UI
routes, or LLM calls.

Follow-up: the review page now accepts multiple `--poc-dir` values and renders
a scene-index aligned comparison section. Use this for baseline-vs-variant
review before adding another planner knob.

## AI Prose Pre-Review

Added `diagnostics:corpus-recreation-prose-review`, a diagnostic-only LLM
pre-review surface for generated scene prose. It uses one scene plus one narrow
dimension per call and writes advisory JSON/Markdown to:

```text
<poc-dir>/prose-quality-live/prose-review.{json,md}
```

Dimensions:

- `dramatization`;
- `commercialPacing`;
- `povVoice`;
- `payoffPropulsion`.

This is intended to reduce operator reading load by surfacing likely review
points and variant disagreements before handoff. It does not block, rewrite,
mutate plans, create proposals, or promote a runtime behavior.

Live chapter-2 baseline vs materiality-v1 pre-review:

- baseline: all scenes scored level 2 for dramatization, pacing, POV voice,
  and payoff propulsion;
- materiality-v1: level 2 for dramatization, pacing, and POV voice, but level
  3 for payoff propulsion across all four scenes;
- operator-attention queue was empty for both, so this is a preference signal
  rather than a failure signal.

Clarification: the current POC reconstructs structural signals from existing
novel analysis, not prose or an expressive source outline. The source-derived
inputs are scene count, scene word sizes, annotation beat counts, value
polarity, MICE/thread cadence, beat kind counts, boundary-signal counts,
gap-size counts, and optional private structural summaries when the reference
is built with `--include-summaries`.

## Causal Materiality v2 Cohort

Added a default-off diagnostic planner variant,
`--planner-variant causal-materiality-v2`, to test whether the planner can
carry materiality through the scene contract without changing the production
writer/checkers. The variant keeps the same schema and asks the planner to make
the protagonist's motive causal, give each choice alternative a gain/risk, make
world facts constrain options or outcomes, and make supporting characters
change leverage/trust/obligation/access/threat/allegiance/available choices.

Implementation guard: the live planner call now has a bounded second attempt
for malformed JSON and for schema-validity failures. The retry asks for a fresh
complete JSON object and includes the validator issue, rather than patching a
partial model response.

Evidence artifacts:

- `output/corpus-recreation-poc/crystal_shard-ch1-flash-causal-materiality-v2-scene-calls-r2/`
- `output/corpus-recreation-poc/crystal_shard-ch2-flash-causal-materiality-v2-scene-calls-r2/`
- `output/corpus-recreation-poc/crystal_shard-ch5-flash-causal-materiality-v2-scene-calls-r1/`
- `output/corpus-recreation-poc/crystal_shard-ch8-flash-causal-materiality-v2-scene-calls-r1/`
- `output/corpus-recreation-poc/exact-id-vs-materiality-v1-vs-causal-v2-aggregate-r1.md`
- `output/corpus-recreation-poc/causal-materiality-v2-thread-map-r1.md`
- `output/corpus-recreation-poc/exact-id-vs-materiality-v1-vs-causal-v2-review-r1.html`

Result across chapters 1, 2, 5, and 8:

- deterministic scene fit held: all sampled chapters matched reference scene
  count and required choice IDs;
- thread refs became complete: v2 had `knownThreadRefCount == contractTotal`
  in every sampled chapter, while baseline/materiality-v1 had no thread refs in
  this cohort shape;
- cross-chapter thread map had 29 movement rows, 0 issues, and 0 horizon notes;
- semantic review ran 85 tasks with 0 low labels;
- prose review ran 64 tasks with 0 low labels;
- character-context linkage still found 8 issues: named local characters in
  chapters 1 and 8 were sometimes present in the scene contract without a
  required-character or source-obligation link;
- prose was too short for analog recreation: 6604 generated words against
  11061 target words, mean ratio 0.585, with chapter/scene-floor warnings.

Interpretation: v2 is a useful diagnostic improvement over the previous
materiality prompt because it preserves thread IDs and clears the low semantic
labels in this sample. It is still `HOLD`, not a production promotion, because
the stronger causal contract appears to compress prose and the character-link
surface still needs planner/readiness repair. The next value-added slice is to
turn those exact character-link and underspecified-scene gaps into Plan
Readiness items, or to test a writer expansion/context arm while holding the v2
planner contract fixed.

## Causal Materiality v2 Readiness Bridge

Ran the existing no-LLM/no-DB Plan Readiness adapter over the four v2 cohort
artifacts:

```bash
bun run diagnostics:corpus-recreation-readiness -- \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch1-flash-causal-materiality-v2-scene-calls-r2 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch2-flash-causal-materiality-v2-scene-calls-r2 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch5-flash-causal-materiality-v2-scene-calls-r1 \
  --poc-dir output/corpus-recreation-poc/crystal_shard-ch8-flash-causal-materiality-v2-scene-calls-r1 \
  --output output/corpus-recreation-poc/causal-materiality-v2-readiness-r1.md \
  --json output/corpus-recreation-poc/causal-materiality-v2-readiness-r1.json
```

Result:

- 6 manual `CHARACTERREF-1` readiness groups;
- 6 findings covering the 8 character-context linkage issues;
- grouped targets: ch1 scene 2, ch1 scene 4, ch8 scenes 1, 4, 5, and 6;
- each group preserves the relevant character IDs plus any obligation,
  scene-turn, thread, promise, and payoff refs already present;
- no semantic lows were converted because v2 had no low semantic labels.

Interpretation: the exact character-link gaps are already convertible into
operator review items. No code change was needed for that bridge. The remaining
unresolved v2 question is not "can we surface the gaps"; it is whether the
short prose is caused by the stronger planner contract, the scene writer's
expansion behavior, or missing writer-context support.

## Fixed-Plan Writer Context Smoke

Held the v2 chapter-5 plan fixed and changed only the writer context arm:

```bash
bun run diagnostics:corpus-recreation-poc -- \
  --live --write --scene-calls \
  --model deepseek-v4-flash \
  --plan-from output/corpus-recreation-poc/crystal_shard-ch5-flash-causal-materiality-v2-scene-calls-r1 \
  --writer-context thread-context-v1 \
  --output-dir output/corpus-recreation-poc/crystal_shard-ch5-flash-causal-materiality-v2-thread-context-v1-scene-calls-r1
```

Evidence:

- `output/corpus-recreation-poc/ch5-causal-v2-baseline-vs-thread-context-r1.md`
- `output/corpus-recreation-poc/ch5-causal-v2-baseline-vs-thread-context-review-r1.html`

Result:

- baseline v2: 896/2255 words, ratio 0.40;
- `thread-context-v1`: 935/2255 words, ratio 0.41;
- deterministic contract/character/thread checks stayed clean in both arms;
- semantic review stayed low-free, but motive and promise/payoff dropped from
  level 3 to level 2 in the context arm;
- prose review stayed unchanged: level 2 dramatization, pacing, and voice;
  level 3 payoff propulsion.

Interpretation: thread context by itself is not the short-prose fix for the
single-scene chapter case. The remaining likely lever is a default-off
writer-expansion diagnostic, not broader thread context. Any expansion arm
should remain advisory/eval-only and should not turn production word counts
back into blocking gates.

## Default-Off Writer Expansion Arm

Added explicit `--writer-expansion retry-short-scenes-v1` support to
`diagnostics:corpus-recreation-poc`. This mode is off by default. When enabled
for scene calls, a below-advisory-floor scene gets up to two additional attempts
that receive the prior prose and ask for expansion through dramatized action,
dialogue, interiority, and consequence. The best attempt is retained, and word
count remains an advisory warning rather than a blocking gate.

Fixed-plan chapter-5 smoke:

```bash
bun run diagnostics:corpus-recreation-poc -- \
  --live --write --scene-calls \
  --model deepseek-v4-flash \
  --plan-from output/corpus-recreation-poc/crystal_shard-ch5-flash-causal-materiality-v2-scene-calls-r1 \
  --writer-expansion retry-short-scenes-v1 \
  --output-dir output/corpus-recreation-poc/crystal_shard-ch5-flash-causal-materiality-v2-expansion-v1-scene-calls-r1
```

Evidence:

- `output/corpus-recreation-poc/ch5-causal-v2-writer-arms-r1.md`
- `output/corpus-recreation-poc/ch5-causal-v2-writer-arms-review-r1.html`

Result on the same v2 plan:

- baseline v2: 896/2255 words, ratio 0.40;
- `thread-context-v1`: 935/2255 words, ratio 0.41;
- `retry-short-scenes-v1`: 1492/2255 words, ratio 0.66;
- expansion removed the broad chapter word-band warning but still missed the
  scene advisory floor by 86 words;
- deterministic plan/character/thread checks stayed clean;
- semantic and prose reviews stayed low-free;
- semantic motive/promise/payoff stayed at level 2 for the expansion arm, so
  the extra length did not automatically improve all story-quality dimensions.

Interpretation: writer expansion is a more plausible fix for short prose than
thread context on this single-scene case, but it needs a multi-chapter fixed-plan
cohort before any promotion. Keep it diagnostic/default-off.

## Fixed-Plan Writer Expansion Cohort

Held the `causal-materiality-v2` plans fixed for chapters 1, 2, 5, and 8, then
changed only the writer arm from no expansion to
`--writer-expansion retry-short-scenes-v1`.

Evidence:

- `output/corpus-recreation-poc/causal-v2-baseline-vs-expansion-v1-aggregate-r1.md`
- `output/corpus-recreation-poc/causal-v2-baseline-vs-expansion-v1-review-r1.html`

Result:

- baseline v2 total: 6604/11061 generated words, ratio 0.60;
- expansion total: 8817/11061 generated words, ratio 0.80;
- chapter ratios improved: ch1 0.65 -> 0.90, ch2 0.65 -> 0.78,
  ch5 0.40 -> 0.66, ch8 0.64 -> 0.84;
- scene-floor misses dropped from 9 to 2;
- broad chapter word-band warnings dropped from all 4 chapters to 2 chapters;
- deterministic scene/choice/thread/consequence contracts stayed intact;
- semantic reviews stayed low-free across 85 tasks;
- prose reviews stayed low-free across 64 tasks;
- plan-side deterministic issues were unchanged in chapters 1 and 8;
- character-context linkage gaps were unchanged at 8 issues.

Interpretation: the default-off writer expansion retry is useful for the
short-prose symptom and did not damage the current semantic/prose triage signals
in this cohort. It should not be promoted as a planner fix: it does not repair
plan-side structural issues, character-context linkage, or causal materiality
upstream. The next higher-value slice is to use Plan Readiness for the exact
character-context gaps, or revise the planner contract so fewer such gaps are
created before drafting.

## Planner Contract Retry Smoke

Added default-off `--planner-contract-retry structural-v1` to the POC planner.
This is a diagnostic-only upstream repair attempt: after valid planner JSON, the
tool compares the plan deterministically and gives the planner one extra attempt
only when hard plan-contract issues remain.

First smoke result: giving only the issue list was too noisy. Ch1 improved some
refs but introduced a new missing-obligation issue, proving the retry needed the
previous plan.

Follow-up fix: the retry prompt now includes the previous valid plan and asks
for a minimal full-plan rewrite.

Evidence:

- `output/corpus-recreation-poc/causal-v2-baseline-vs-contract-retry-v1-plan-r1.md`
- `output/corpus-recreation-poc/causal-v2-baseline-vs-contract-retry-v1-plan-review-r1.html`
- `output/corpus-recreation-poc/crystal_shard-ch1-flash-causal-materiality-v2-contract-retry-v1-minimal-r1/planner-contract-retry.json`
- `output/corpus-recreation-poc/crystal_shard-ch8-flash-causal-materiality-v2-contract-retry-v1-minimal-r1/planner-contract-retry.json`

Result:

- ch1 baseline v2 had 2 plan issues and 3 character-context issues; minimal
  contract retry ended with 0 plan issues, 0 character-context issues, and a
  clean thread map;
- ch8 baseline v2 had 4 plan issues and 5 character-context issues; minimal
  contract retry ended with 0 plan issues, 0 character-context issues, and a
  clean thread map;
- both smokes used two planner attempts; the retry prompt had prefix-cache hits;
- no prose was drafted from these repaired plans yet, so this is not promotion
  evidence for story quality or final output.

Interpretation: upstream plan-contract retry is a stronger next hypothesis than
manual character-ref cleanup for new plans. It should remain default-off until
the repaired plans are drafted and judged for semantic/prose quality.

## Planner Contract Retry + Writer Expansion Factorial

Drafted the repaired ch1/ch8 plans and compared four held-shape arms:

- `causal-materiality-v2`;
- `causal-materiality-v2 + retry-short-scenes-v1`;
- `causal-materiality-v2 + planner-contract-structural-v1`;
- `causal-materiality-v2 + planner-contract-structural-v1 + retry-short-scenes-v1`.

Evidence:

- `output/corpus-recreation-poc/causal-v2-contract-retry-expansion-factorial-r1.md`
- `output/corpus-recreation-poc/causal-v2-contract-retry-expansion-factorial-review-r1.html`

Result:

- ch1 combined arm: 1393/1832 words, ratio 0.76; no deterministic issues,
  no warnings, clean character-context packets, clean thread map;
- ch8 combined arm: 2796/3621 words, ratio 0.77; no deterministic issues,
  no warnings, clean character-context packets, clean thread map;
- contract retry without expansion cleaned plan/character/thread issues but
  stayed short at 0.63 ratio for both chapters;
- expansion without contract retry improved word ratios to 0.90 and 0.84 but
  preserved the baseline plan and character-context gaps;
- semantic and prose reviews stayed low-free in both combined cells.

Interpretation: the two default-off diagnostics are orthogonal. Planner
contract retry repairs upstream plan/ID/character-context defects; writer
expansion repairs the short-prose symptom. The combined arm is the current best
POC shape, but the evidence is still limited to two drafted chapters and should
remain diagnostic until broadened.

## Four-Chapter Combined Arm

Broadened the combined default-off arm to chapters 1, 2, 5, and 8, then
compared baseline `causal-materiality-v2`, expansion-only, and contract-retry
+ expansion.

Evidence:

- `output/corpus-recreation-poc/causal-v2-expansion-vs-contract-expansion-4ch-r1.md`
- `output/corpus-recreation-poc/causal-v2-expansion-vs-contract-expansion-4ch-review-r1.html`

Result:

- baseline v2: 6604/11061 words, ratio 0.60; plan issues remained in ch1/ch8;
- expansion-only: 8817/11061 words, ratio 0.80; plan and character-context
  gaps remained in ch1/ch8;
- contract retry + expansion: 8765/11061 words, ratio 0.79; plan issues 0/4,
  character-context issues 0/4, thread maps clean;
- combined arm warnings remained only in ch2 and ch5, both scene-floor
  advisory misses rather than structural failures;
- combined arm stayed semantic low-free across 85 tasks and prose low-free
  across 64 tasks.

Interpretation: the broadened evidence supports keeping the pair as the current
best diagnostic POC shape. Contract retry is adding upstream cleanliness rather
than merely shortening prose; writer expansion carries the length repair. This
is still not a production-default change: the next proof should test a fresh
multi-chapter run or a full short-story/chapter sequence where downstream
payoffs can land across chapter boundaries.

## Sequence Audit

Added `diagnostics:corpus-recreation-sequence-audit`, a deterministic
cross-chapter audit for POC dirs. It flags sequence-level ID patterns that
per-chapter plan/thread checks cannot see.

Evidence:

- `output/corpus-recreation-poc/causal-v2-contract-expansion-4ch-sequence-audit-r1.md`

Result on the four combined chapters:

- 37 thread/promise/payoff movements;
- 4 advisory sequence findings;
- `payoff-key-cost-exposure` was reused as a resolved payoff in chapters 1, 2,
  5, and 8;
- `payoff-oathmark-public-confession` was reused as a resolved payoff in
  chapters 2, 5, and 8;
- `debt-key-cost` had progress rows after first payoff;
- `debt-oathmark` had progress rows after first payoff.

Interpretation: the per-chapter combined arm is not enough to prove sequence
coherence. The planner needs a sequence-owned story-debt model where a parent
thread/promise can have child progress/payoff IDs, or later rows are marked as
aftermath/escalation rather than reusing the same final payoff ID.

## Sequence-Owned Story Debt Fields

Added graph-ready optional fields to the corpus recreation POC obligation
contract:

- `payoffEventId`: unique concrete child payoff event;
- `storyDebtStage`: `open`, `progress`, `complicate`, `partial_payoff`,
  `final_payoff`, `aftermath`, or `escalation`.

The deterministic plan checker now rejects payoff refs on non-payoff stages,
requires `payoffEventId` on explicit payoff stages, and rejects dangling
`payoffEventId` without parent `payoffId`.

Evidence:

- focused tests: `bun test scripts/evals/corpus-recreation-sequence-audit.test.ts scripts/evals/corpus-recreation-poc.test.ts`;
- typecheck: `./node_modules/.bin/tsc --noEmit`;
- old four-chapter sequence audit refreshed as
  `output/corpus-recreation-poc/causal-v2-contract-expansion-4ch-sequence-audit-r2.md`;
- fresh ch1 plan-only smoke:
  `output/corpus-recreation-poc/crystal_shard-ch1-flash-causal-materiality-v2-sequence-ids-v1-plan-r2`.

Result:

- old four-chapter outputs still show 4 advisory sequence findings, now phrased
  as missing child `payoffEventId` and progress after implicit final payoff;
- fresh ch1 plan-only smoke produced 8 obligations, 4 `storyDebtStage` refs,
  0 payoff refs, and 0 plan issues after contract retry;
- the smoke stayed plan-only, so it is not prose or sequence promotion
  evidence.

Interpretation: the contract can now represent parent story debts separately
from child payoff events. The next real proof should plan a multi-chapter or
short-story sequence where the planner decides which local landings are
`partial_payoff`, which are `final_payoff`, and which later rows are
`aftermath` or `escalation`.
