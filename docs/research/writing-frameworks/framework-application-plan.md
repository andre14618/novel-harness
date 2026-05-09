---
status: active
updated: 2026-05-08
role: framework-application-plan
lane: upstream-planning-methodology
---

# Framework Application Plan

This document narrows the broad framework research into the next practical
Novel Harness application path. It is not a production-default decision. Any
craft framework that changes planner, writer, checker, or UI behavior still
must prove value through diagnostic-only or A/B-gated evidence first.

## Current Finding

The repo already contains enough framework research to stop searching broadly
and start testing a focused upstream stack.

Useful existing repo assets:

- `docs/research/writing-frameworks/SYNTHESIS.md` collects cross-framework
  principles: change per story unit, promise/progress/payoff, internal
  contradiction, scene value shift, and iterative expansion.
- `docs/planner-output-contract.md` already names the desired future flow:
  `genre/market strategy -> structure template slots -> chapter contracts ->
  scene contracts -> obligations and source refs -> prose`.
- `docs/method-packs/commercial-fantasy-adventure-v0.md` is the first method
  pack, but live diagnostics show it preserves slot/ID discipline without yet
  improving character materiality, world pressure, or endpoint landing.
- `docs/sessions/2026-05-07-scene-contract-method.md` records the active
  method shift: `sceneId` should become the plan/write/check unit;
  `obligationId` and `sourceId` remain durable traceability units; `beatId`
  becomes legacy or internal guidance for new scene-first methodology.
- `docs/evals/planner-discernment-real-data-v0.md` gives the current quality
  sensors: character agency/materiality, world pressure, endpoint landing,
  causal momentum, promise progress, scene dramaturgy, relationship delta,
  motivation specificity, and stakes/value shift.

The original Salvatore beat corpus is not a sufficient golden structure source
by itself. It was decomposed into short beats for an earlier small-model
workflow, so its beat size should not define the writer interface. A separate
corpus-structure recreation POC is useful, though: use the local Stage 6
scene/value/MICE/promise annotations to build a chapter/scene reference target,
then ask whether the planner can recreate comparable structural granularity
from compressed premise/context. Golden examples should come from authored
craft templates, corpus-derived scene/function references, operator judgment,
and prose-level POC outcomes.

## External Source Refresh

Use these sources as applied framework anchors, not as a mandate to encode every
rule:

- Plottr's Derek Murphy 24-chapter outline describes a commercial-fiction
  template with four plotlines, three-act organization, 34 scene cards, and 25
  beat spaces. It is useful for macro chapter/scene function labels, not as a
  rigid chapter-count rule.
  Source: https://plottr.com/24-chapter-novel-outline/
- Randy Ingermanson's Snowflake Method is the strongest fit for upstream
  concept conservation: one-sentence summary, paragraph summary, character
  summaries, synopsis expansion, and then a scene spreadsheet. This maps well
  to deterministic conservation checks between concept and planning.
  Source: https://www.advancedfictionwriting.com/articles/snowflake-method/
- Story Grid's Five Commandments define a scene/unit as inciting incident,
  turning-point progressive complication, crisis, climax, and resolution. It is
  the clearest basis for scene contracts and scene-readiness diagnostics.
  Source: https://storygrid.com/five-commandments-of-storytelling/
- Save the Cat's official method uses 10 story types and 15 structural beats
  with percentage markers. It is useful as a macro milestone vocabulary and a
  transformation-arc checklist, but should not become the only template.
  Source: https://savethecat.com/get-started
- K.M. Weiland's character-arc material frames the character arc around the
  conflict between the thing the character wants and the thing the character
  needs/truth. This is useful for character materiality checks.
  Source: https://www.helpingwritersbecomeauthors.com/character-arcs-3/
- Brandon Sanderson's 2025 plot lecture foregrounds promise, progress, and
  payoff as plot machinery. Use this as a planner-owned story-debt artifact
  before considering any durable global ledger.
  Source:
  https://www.brandonsanderson.com/blogs/blog/brandon-sandersons-2025-guide-to-plot-lecture-2

## Applied Stack

### 1. Snowflake-Lite Strategy Packet

Optimized layer: concept.

Purpose: force the planner to conserve the story's core conflict, disasters or
major reversals, character motivations, and ending direction before it creates
chapter or scene plans.

Candidate fields:

- `methodPackId`
- `strategyPacketId`
- `logline`
- `paragraphSummary`
- `majorReversals[]`
- `endingDirection`
- `readerPromise`
- `protagonistWant`
- `protagonistNeed`
- `protagonistLie`
- `protagonistTruth`
- `antagonistPressure`
- `worldPressureRule`

Expected benefit: fewer plans that are structurally complete but thin. The plan
should know what must be conserved before it chooses scenes.

Evidence signal: planner diagnostics should show fewer weak character-agency
and endpoint findings, with no regression in ID completeness or obligation
clarity.

### 2. Flexible Commercial Macro Template

Optimized layer: macro planning.

Purpose: give the planner a usable chapter/scene-function scaffold without
forcing all novels into one exact beat sheet.

Recommended starting point: evolve
`commercial-fantasy-adventure-v0` into a v1 diagnostic method pack that can use
Plottr/Derek Murphy 24-chapter slots, Save the Cat milestone vocabulary, or a
compressed short-story/novella slot set.

Rules:

- Treat template slots as functions, not mandatory chapter numbers.
- A short story or novella can map multiple functions into fewer scenes.
- Keep `structureSlotId` durable so later changes can trace which function a
  scene was meant to satisfy.
- Do not optimize for beat count as the primary win.

Expected benefit: better macro progression, stronger endpoint/hook landings,
and less aimless middle material.

Evidence signal: method arm improves endpoint landing, causal momentum, and
promise progress in planner diagnostics; later prose POC shows fewer plan-drift
and hallucinated-resolution blockers.

### 3. Story Grid Scene Contracts

Optimized layer: scene planning.

Purpose: make scenes the primary generation and adherence unit.

Candidate fields:

- `sceneId`
- `chapterId`
- `structureSlotId`
- `povCharacterId`
- `goal`
- `opposition`
- `turningPoint`
- `crisisChoice`
- `climaxAction`
- `resolution`
- `valueIn`
- `valueOut`
- `consequence`
- `requiredObligationIds[]`
- `requiredSourceIds[]`

Expected benefit: give DeepSeek a complete unit of story to write, rather than
asking it to stitch many small beats into prose.

Evidence signal: scene plans should pass scene dramaturgy, stakes/value shift,
and character-materiality sensors. Prose POC should preserve scene outcomes
without requiring beat-level adherence.

### 4. Character Materiality Overlay

Optimized layer: concept plus scene planning.

Purpose: make characters cause scenes rather than merely appear in them.

Candidate fields:

- `characterId`
- `want`
- `need`
- `lie`
- `truth`
- `fear`
- `leverageOrWound`
- `scenePressure`
- `relationshipDelta` when applicable

Rules:

- Do not label every scene as relationship-oriented.
- `relationshipDelta` applies only when another character relationship is
  materially active in the scene.
- Character materiality should be checked only where the scene contract claims
  a character is load-bearing.

Expected benefit: more scenes where character motivation and pressure shape
the action.

Evidence signal: fewer `AGENCY-1`/materiality findings, better operator
pre-draft confidence, and fewer prose scenes where the right characters are
present but passive.

### 5. Planner-Owned Story Debt

Optimized layer: concept/planning diagnostics.

Purpose: track promise/progress/payoff as planning intent before adding a heavy
global ledger or production DB schema.

Candidate fields:

- `storyDebtId`
- `promiseText`
- `openedBySceneId`
- `progressSceneIds[]`
- `expectedPayoffSceneId`
- `payoffPolicy`

Rules:

- Start as method-pack output and diagnostics, not runtime gate.
- Keep it local to the plan until evidence shows it improves prose outcomes.
- Use `obligationId` links only for concrete scene requirements.

Expected benefit: fewer dangling setup/payoff issues and less arbitrary finale
resolution.

Evidence signal: promise-progress findings improve upstream, and draft checks
show fewer unsupported payoffs or unresolved major promises.

## What To Defer

- Beat-count calibration and post-hoc packing remain diagnostic history, not
  the target method.
- Microtension, prose lints, and voice polish belong after the scene-plan POC
  proves that upstream context produces better scenes.
- LitRPG-specific progression systems should wait until the general planning
  scaffold works in a simpler commercial fantasy/adventure lane.
- UI work remains deferred unless a new planning/review surface is required to
  run the experiment.
- Full durable DB schemas for story debt or template packs should wait until
  diagnostic outputs justify persistence beyond artifacts.

## First Proof-Of-Concept

Run a small framework-to-prose POC rather than another planner-only pass.

Recommended shape:

1. Pick 3-6 disposable commercial fantasy/adventure concepts.
2. Generate two arms from the same concept:
   - `control`: current planning path.
   - `framework-v1`: Snowflake-lite strategy packet + flexible macro slots +
     scene contracts + character/story-debt overlays.
3. Hold writer, checker, model policy, target length, and seed constant.
4. Draft either:
   - one complete short story, or
   - the first 2-3 chapters of a novella/novel concept.
5. Compare plan and prose:
   - planner diagnostics;
   - Plan Readiness Review findings;
   - word ratio and expansion;
   - plan-drift/checker blockers;
   - operator review of side-by-side scene plans and prose;
   - bias-controlled semantic judge only after calibration.

Promotion signal:

- The framework arm should improve character agency/materiality, scene
  dramaturgy, endpoint landing, and promise progress without increasing
  checker blocker rate.
- The prose should read more scene-coherent, not merely shorter or more
  schema-complete.
- Operator review should be treated as the highest-value early signal until
  semantic judges prove stable.

## ID Trace

The scene-first framework should preserve traceability through mutation:

- `methodPackId` identifies the active framework variant.
- `templateId` and `structureSlotId` identify macro story function.
- `strategyPacketId` identifies the upstream concept packet.
- `chapterId` groups scenes into delivery units.
- `sceneId` is the primary plan/write/check/revision unit.
- `obligationId` identifies concrete requirements inside a scene.
- `sourceId` links obligations back to character, world, structure, concept, or
  story-debt sources.
- `storyDebtId` tracks promise/progress/payoff intent when applicable.

Human or agent modifications should flow through `planning_edit` proposals,
target hashes, and lineage. If a scene changes, the affected downstream
obligations, source refs, story-debt refs, and draft spans must become stale or
superseded explicitly rather than silently detached.

## Next Implementation Slice

Build `commercial-fantasy-adventure-v1` as a diagnostic-only method pack:

- add a compact method-pack artifact or prompt module for the Snowflake-lite
  strategy packet and Story Grid scene contract fields;
- add 3-6 frozen disposable concepts for the framework POC;
- extend the existing method-pack diagnostic runner only enough to emit and
  score scene contracts with the new fields;
- add a draft-from-plan smoke on 1-2 concepts after the planner output is
  inspectable;
- document results in a session record before changing production defaults.
