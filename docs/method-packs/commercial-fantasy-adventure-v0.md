---
status: draft
updated: 2026-05-07
role: method-pack-charter
methodPackId: commercial-fantasy-adventure-v0
---

# Commercial Fantasy Adventure V0 Method Pack

This charter defines the first repo-native method pack for upstream planning.
It is a planning scaffold, not a drafting prompt, checker policy, UI surface,
or production default.

The goal is to test whether a clear commercial adventure structure improves
plan quality before the harness spends tokens drafting prose. This pack should
make chapter and scene contracts more story-shaped without locking the novel
to one genre module such as LitRPG, romance, or mystery.

## Change Packet

- Optimized layer: upstream concept/planning methodology.
- Exact lever: selectable `commercial-fantasy-adventure-v0` method pack.
- Held constant: writer, checker, UI, proposal flows, auth posture, runtime
  defaults, and existing manual review policy.
- Expected benefit: clearer chapter function, stronger endpoints, more active
  character pressure, more relevant world use, and fewer arbitrary beat lists.
- Evidence gate: planner-quality diagnostic plus operator side-by-side review
  on frozen concept inputs before any drafting/checking/UI change.
- Stop condition: if the pack creates formulaic, semantically thin, or
  over-specified plans, keep it diagnostic and revise the method before code
  promotion.

## Why This Pack First

General commercial fantasy/adventure is broad enough to test the harness
scaffold without requiring specialist subsystems. It can use character desire,
world pressure, discovery, danger, reversal, cost, and payoff as ordinary story
machinery.

This deliberately avoids LitRPG for V0. LitRPG would require additional
modules for stats, progression economy, game-system consistency, reward pacing,
and system-message semantics. Those are useful later, but they would confound
the current question: can the harness produce better upstream plans?

## Source Basis

This pack is informed by, but does not copy, commercial plotting structures:

- a flexible 24-chapter commercial outline pattern, including the Derek Murphy
  / Plottr 24-chapter family of structures:
  https://plottr.com/24-chapter-novel-outline/
- three-act and four-part commercial adventure structures;
- scene craft centered on goal, opposition, turn, outcome, and consequence;
- the repo's current decisions on scene-first planning, obligation/source
  traceability, and layer-scoped methodology experiments;
- future corpus-derived distributions for scene size and function, used as
  calibration evidence rather than as the source of the macro scaffold.

Legacy Novel Harness outlines are not golden examples for this pack. They can
be used only as baseline, migration, or regression evidence.

## Method Shape

```text
methodPackId: commercial-fantasy-adventure-v0
  genreProfileId: general-commercial-fantasy-adventure
  templateId: commercial-24-flex-v0
  structureSlotIds[]
  chapter contracts
  scene contracts
  obligations/source refs
```

The template is a flexible story-function map. It is not an exact 24-chapter
requirement. Slots can merge, split, or be skipped when the concept requires it,
but the planner must preserve visible story function and causal progression.

## Macro Scaffold

Use four parts with six flexible structure slots each. Slot labels are internal
story jobs, not prose headings.

| Slot | Structure Job | Planning Test |
| --- | --- | --- |
| CFA-01 | Pressure baseline | Show what the protagonist wants, lacks, or cannot tolerate before the story changes. |
| CFA-02 | Disturbance | Introduce an event, clue, threat, or opportunity that does not fit the old pattern. |
| CFA-03 | Failed control | Let the protagonist try to restore normality and make the cost of staying visible. |
| CFA-04 | Invitation to danger | Present the concrete path into the story problem. |
| CFA-05 | Reluctant entanglement | Make refusal, hesitation, or half-measure create more pressure. |
| CFA-06 | First irreversible step | End the opening with a choice or consequence that prevents easy retreat. |
| CFA-07 | New rules | Establish the operating rules, allies, hazards, and limits of the wider arena. |
| CFA-08 | First method test | Make the protagonist attempt a new approach and learn its cost. |
| CFA-09 | Relationship/world pressure | Force character ties or world constraints to affect the plot, not decorate it. |
| CFA-10 | Rising commitment | Increase investment and make the old goal inadequate or incomplete. |
| CFA-11 | Major reversal | Reveal information or opposition that changes what the protagonist thinks the story is. |
| CFA-12 | Reframed objective | Convert the reversal into a sharper goal, promise, or deadline. |
| CFA-13 | Complication after turn | Show that the new objective creates second-order consequences. |
| CFA-14 | False progress | Let a plan appear to work while hiding a deeper cost or misunderstanding. |
| CFA-15 | Costly tradeoff | Require a sacrifice, betrayal, exposure, or relationship strain. |
| CFA-16 | Plan break | Break the protagonist's current strategy through antagonist, world, or self-pressure. |
| CFA-17 | Forced truth | Confront the protagonist with the flaw, false belief, or missing knowledge. |
| CFA-18 | Recommitment | Choose a better method, alliance, or motive after the forced truth. |
| CFA-19 | Final approach | Assemble the final plan under visible constraints and unresolved debt. |
| CFA-20 | Gauntlet | Escalate through tests that pay off earlier skills, ties, and world rules. |
| CFA-21 | Central confrontation | Bring the protagonist into direct conflict with the central force. |
| CFA-22 | Defining choice | Make victory depend on a meaningful choice, not only force or luck. |
| CFA-23 | Consequence | Show what changed in the protagonist, relationships, world, or promise ledger. |
| CFA-24 | Final image / next promise | Land emotional closure and, if applicable, a clean series-facing promise. |

## Chapter Contract

Each planned chapter or chapter-equivalent section should state:

- `chapterId`
- `structureSlotId` or `structureSlotIds`
- `chapterFunction`
- `povCharacterId`
- `protagonistPressure`
- `centralConflict`
- `irreversibleChange`
- `endpointOrHook`
- `requiredCharacterWork`
- `requiredWorldWork`
- `requiredStoryDebtWork`
- `sceneIds`

Chapter success is not measured by beat count. It is measured by whether the
chapter has a clear job, changes the story state, and hands the next chapter a
specific consequence or promise.

## Scene Contract

Scene-first planning means the scene is the generation and adherence unit. Each
scene should state:

- `sceneId`
- `chapterId`
- `structureSlotId`
- `sceneFunction`
- `povCharacterId`
- `locationOrArena`
- `goal`
- `conflict`
- `turnOrValueShift`
- `outcome`
- `consequence`
- `requiredObligationIds`
- `requiredSourceIds`
- `requiredCharacterIds`
- `affectedCharacterIds`
- `requiredWorldFactIds`

Target scene count is flexible. As a starting diagnostic shape, expect one to
three scenes for most chapters and allow a fourth only when the chapter has a
clear multi-location or multi-objective structure.

## Obligation Policy

Obligations are traceability contracts inside a scene. They should be specific
enough that a writer can satisfy them and a checker can evaluate them without
beat-index matching.

Allowed coverage policies:

- `must_satisfy`: required for the scene or chapter contract to work.
- `should_surface`: useful pressure or texture, but not load-bearing.
- `forbid`: a contradiction, spoiler, or prohibited mutation.
- `optional`: available context that should not force prose.

Every obligation should link to at least one durable source:

- `characterId`
- `worldFactId`
- `structureSlotId`
- `sourceId`
- future `promiseId` or `storyDebtId`

## Planner Rubric

The first diagnostic should score plans, not prose:

- `template_slot_fit`: the chapter satisfies the selected story job.
- `chapter_contract_complete`: pressure, conflict, change, and endpoint are
  present.
- `scene_contract_complete`: scenes have goal, opposition, turn, outcome, and
  consequence.
- `character_materiality`: listed characters alter choices, pressure, or cost.
- `world_relevance`: world details constrain, enable, or complicate action.
- `obligation_clarity`: requirements are concrete and source-linked.
- `endpoint_landing`: the planned final scene can land the declared endpoint.
- `overfragmentation`: the plan is not a list of tiny gestures.
- `id_completeness`: required IDs and refs are present.

The rubric remains diagnostic-only until it has been reviewed against human
side-by-side examples.

## First Diagnostic Fixture

Do not start with a full novel run. Start with a compact authored fixture that
proves the method and rubric can talk to each other.

Recommended V0 fixture:

1. Create a frozen concept with protagonist desire, world pressure, antagonist
   force, two supporting characters, and one central story promise.
2. Author a six-slot mini-arc using representative slots:
   `CFA-01`, `CFA-04`, `CFA-06`, `CFA-11`, `CFA-17`, and `CFA-22`.
3. Write expected chapter-contract and scene-contract fields by hand.
4. Score the fixture with the planner rubric.
5. Ask the native planner to produce the same contract shape from the frozen
   concept and method pack.
6. Compare method-guided planning against no-method planning side by side.

Only after that should the harness run a broader 24-slot diagnostic or draft
from the generated scene contracts.

## First Experiment

Question: does this method pack improve upstream plan shape compared with the
same planner operating without a method pack?

Held constant:

- same frozen concept;
- same model and planner call budget;
- same output schema;
- same planner-quality rubric;
- no writer, checker, UI, proposal, or runtime-default changes.

Measurements:

- slot fit;
- chapter contract completeness;
- scene contract completeness;
- character materiality;
- world relevance;
- endpoint landing;
- overfragmentation;
- obligation/source ID completeness;
- operator side-by-side preference.

Promotion threshold: do not wire the method pack into normal runtime until it
beats no-method planning on plan-quality evidence and the operator can see why.

## Non-Goals

- Do not make 24 chapters mandatory.
- Do not use this as a LitRPG progression system.
- Do not derive the pack from legacy Novel Harness beat outlines.
- Do not change writer prompts in this slice.
- Do not change checker strictness in this slice.
- Do not make beat-level adherence the primary future contract if scenes are
  the planning and writing unit.
- Do not treat a shorter outline as better unless story obligations and
  endpoints are stronger.

## Open Questions

- Should V0 require a full 24-slot outline before drafting, or allow a shorter
  operator-approved structure map? Recommendation: allow flexible slot mapping.
- Should the first executable fixture cover six representative slots or all 24?
  Recommendation: six slots first, then expand after rubric calibration.
- Should world and character obligations be required in every scene?
  Recommendation: require them only when materially relevant; otherwise mark
  them `should_surface` or `optional`.
- Should the template select chapters, scenes, or both?
  Recommendation: template slots select chapter function; scene contracts
  translate that function into writeable units.
