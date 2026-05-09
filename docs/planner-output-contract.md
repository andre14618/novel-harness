---
status: active
updated: 2026-05-07
role: planner-method-contract
---

# Planner Output Contract

This document defines the target shape for upstream planning methodology. It
answers what the planner is trying to produce before the harness changes
writing, checking, proposal flows, or UI.

Core method:

```text
genre/market strategy
  -> structure template slots
  -> chapter contracts
  -> scene contracts
  -> obligations and source refs
  -> prose
```

The planner's job is not to produce prose and not to satisfy a beat count. Its
job is to produce a plan where every chapter and scene has a clear story
function, durable obligations, and enough context for a writer/checker pair to
operate without guessing.

## Responsibilities

### Planner

The planner owns:

- selecting or using a declared genre/market strategy;
- mapping that strategy to a structure template or flexible story-function
  scaffold;
- producing chapter contracts that name pressure, conflict, irreversible
  change, endpoint/hook, and required story work;
- producing scene contracts under those chapters;
- assigning obligations with source refs and stable IDs;
- making character, world, and story-function requirements explicit before
  drafting.

The planner does not own:

- final prose;
- prose-level rhythm or voice polish;
- checker severity policy;
- UI presentation;
- automatic Canon/world/character mutations.

### Writer

Under the scene-first method, the writer should receive a `sceneId`, scene
contract, and obligation/source checklist. The writer's job is to produce a
coherent scene that satisfies the scene contract and covers required
obligations. It should not be forced to expand tiny beats in fixed order unless
the experiment explicitly remains beat-first.

### Checker

Under the scene-first method, checker adherence should be scene-scoped:

- did the scene satisfy its goal/conflict/outcome contract?
- did it cover required obligations and source refs?
- did it preserve required character/world/state changes?
- did the scene outcome land?

Beat-index matching is legacy compatibility, not the future primary contract,
unless the planner and writer are still operating at beat granularity.

### Operator

The operator should eventually judge or adjust:

- genre/market strategy;
- structure template choice;
- chapter contract;
- scene contract;
- obligation/source checklist;
- side-by-side plan variants before expensive drafting tests.

UI for this is not the active product lever yet. First prove the contract and
diagnostics.

## Plan Readiness Review

Planner diagnostics should feed Plan Readiness Review before drafting when
diagnostics are available. The readiness layer asks whether the current chapter
or scene contract is good enough to write from:

- Are required characters materially shaping choice, conflict, turn, outcome,
  consequence, or future pressure?
- Are required world facts operational in action, cost, constraint, reveal, or
  outcome?
- Does a relationship-oriented scene actually change relationship state?
- Is the POV motivation specific enough, and does the stakes/value shift matter
  enough for this scene?

The review captures operator intent and disposition. It does not rewrite the
plan by itself; any accepted change should become a normal `planning_edit`
proposal with stable target refs and stale preconditions.

## Contract Levels

### Novel Strategy

Purpose: define the commercial and structural lane before chapter planning.

Candidate fields:

- `genreProfileId`
- `marketLane`
- `templateId`
- `targetLengthRange`
- `readerPromise`
- `strictnessNotes`

Evidence question: does the rest of the plan match the chosen lane?

### Structure Template

Purpose: give chapters story jobs before scene or obligation expansion.

Candidate fields:

- `templateId`
- `structureSlotId`
- `slotLabel`
- `slotFunction`
- `expectedPressure`
- `expectedTurn`
- `expectedEndpoint`
- `flexPolicy`: `required | mergeable | splittable | optional`

Evidence question: does a chapter satisfy the slot's story function without
becoming formulaic or genre-mismatched?

### Chapter Contract

Purpose: define what a chapter must accomplish as a story unit.

Candidate fields:

- `chapterId`
- `structureSlotId`
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

Evidence question: can a reviewer understand what the chapter is for, how it
changes the story state, and what would count as success?

### Scene Contract

Purpose: define the generation and adherence unit.

Candidate fields:

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
- `requiredWorldFactIds`

Evidence question: can the scene be written as one coherent dramatic unit, and
can the checker evaluate it without relying on beat-index matching?

### Obligation Contract

Purpose: preserve traceability and load-bearing requirements inside a scene.

Candidate fields:

- `obligationId`
- `sceneId`
- `chapterId`
- `sourceId`
- `sourceKind`
- `characterId`
- `worldFactId`
- `structureSlotId`
- `requirementText`
- `coveragePolicy`: `must_satisfy | should_surface | forbid | optional`
- `satisfactionStatus`: diagnostic output, not planner input

Evidence question: is each requirement specific enough for a writer to satisfy
and a checker to evaluate?

## Planner Rubric

The planner-quality rubric should score the contract, not prose.

Candidate dimensions:

- `template_slot_fit`: chapter serves its structure slot.
- `chapter_contract_complete`: pressure, conflict, irreversible change, and
  endpoint/hook are present.
- `endpoint_landing`: final planned scene can land the declared endpoint.
- `scene_contract_complete`: each scene has goal, conflict, turn, outcome, and
  consequence.
- `character_materiality`: listed characters materially affect the chapter or
  scene.
- `obligation_clarity`: obligations are concrete, source-linked, and not vague.
- `world_relevance`: world details affect conflict, cost, choice, or
  constraint.
- `story_debt_health`: promises/progress/payoffs are visible where applicable.
- `overfragmentation`: plan is not a sequence of tiny beat gestures pretending
  to be scenes.
- `id_completeness`: required refs are stable and linked.

This rubric should start as diagnostic-only. It should not block generation
until measured against human side-by-side review.

## ID Projection

New methodology should preserve traceability through these refs:

```text
templateId
structureSlotId
chapterId
sceneId
obligationId
sourceId
characterId
worldFactId
promiseId / storyDebtId (future)
draftSpanId (future or derived)
```

`beatId` remains useful for legacy outlines and corpus-derived annotations, but
it should not be the primary future assertion surface under scene-first
planning.

## Evidence Tiers For Planner Calls

Planner prompts should separate context by tier:

- Required: selected genre/market strategy, template slots, character/world
  facts needed by this chapter, prior chapter state, and the output schema.
- Supporting: recent planner-quality findings, previous attempt feedback, and
  known lane decisions.
- Inventory: available character/world/canon IDs and broad story metadata.

The planner should not receive arbitrary full documents when structured refs
or diagnostic summaries exist.

## First Implementation Shape

Do this before writing or checker changes:

1. Choose an authored craft/template or corpus-structure exemplar as the target
   shape. Examples: a commercial 24-chapter structure, romance obligatory
   beats, pulp-quarter structure, LitRPG/progression strategy, or a local
   corpus-reference recreation POC at chapter/scene granularity.
   First candidate pack: `docs/method-packs/commercial-fantasy-adventure-v0.md`.
2. Translate that exemplar into template slots, chapter-contract expectations,
   scene-contract expectations, and obligation requirements.
3. Create a small diagnostic fixture from the exemplar. This is not a legacy
   harness outline and does not need to come from an existing novel row. If the
   exemplar is corpus-derived, keep source-derived detailed summaries in
   ignored local artifacts and commit only schemas, metrics, and conclusions.
4. Score the fixture with the planner rubric to make sure the rubric rewards
   the intended method.
5. Ask the native planner to produce this contract shape on a frozen concept
   seed.
6. Use legacy outline projection only as baseline/migration evidence: it can
   show how old beat-shaped plans differ from the target, but it must not
   define the future contract.
7. Review side by side with the operator.

Only after that should the harness test:

- template-guided planning;
- native scene-contract planning;
- scene writer;
- scene-scoped adherence.

## Non-Goals

- Do not make a fixed 24-chapter template a production default.
- Do not keep beat-level adherence as the primary checker if scenes become the
  planning/writing unit.
- Do not change drafting, checking, UI, or proposal behavior in the first
  contract slice.
- Do not promote promise ledgers, scene-turn checks, or micro-tension checks as
  blockers without A/B evidence.
- Do not infer that Salvatore's small corpus beat size is the production writer
  call size; use corpus beats as annotation/trace granularity inside
  scene-level structure unless a beat-first experiment explicitly proves value.
- Do not define the future harness method by projecting from existing
  beat-shaped outlines. Existing outlines are diagnostic/baseline artifacts,
  not golden examples.
