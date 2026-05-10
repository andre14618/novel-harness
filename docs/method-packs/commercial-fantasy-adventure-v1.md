---
status: draft
updated: 2026-05-08
role: method-pack-charter
methodPackId: commercial-fantasy-adventure-v1
---

# Commercial Fantasy Adventure V1 Method Pack

This is a diagnostic-only successor to
`commercial-fantasy-adventure-v0`. It is not a production planner default.

V0 proved that method packs can preserve slot fit and ID discipline, but it did
not improve the dimensions that matter most: character materiality, world
pressure, relationship movement, endpoint landing, or promise progress. V1
therefore moves the method upstream and scene-first instead of trying to tune
beat counts.

## Change Packet

- Optimized layer: concept and planning methodology.
- Exact lever: Snowflake-lite strategy packet + flexible commercial macro
  slots + Story Grid scene contracts + character materiality + planner-owned
  story debt.
- Held constant: writer, checker policy, UI, proposal flow, runtime defaults,
  model policy, and manual review posture.
- Expected benefit: plans that are not only structurally complete, but easier
  to draft into coherent scenes with active character pressure, operational
  world constraints, and visible setup/payoff intent.
- Evidence gate: diagnostic planner score, Plan Readiness Review findings,
  operator side-by-side review, then a small production-path framework-to-prose
  diagnostic.

## Method Stack

### Snowflake-Lite Strategy Packet

The planner receives a compact concept packet before any scene work:

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

The diagnostic checks whether the final plan visibly conserves this packet.
This is not a prose-quality judgment; it is a guard against losing the story's
core pressure while producing schema-complete contracts.

### Flexible Commercial Macro Slots

V1 keeps the CFA slot family from V0, but treats slots as story jobs rather
than chapter-count mechanics. A short story may map several slots into a few
scenes; a novel may expand slots into chapters or chapter groups.

The first diagnostic still uses six representative slots:

- `CFA-01` Pressure baseline
- `CFA-04` Invitation to danger
- `CFA-06` First irreversible step
- `CFA-11` Major reversal
- `CFA-17` Forced truth
- `CFA-22` Defining choice

### Story Grid Scene Contracts

Scenes are the generation and adherence unit. V1 scene contracts add:

- `opposition`
- `turningPoint`
- `crisisChoice`
- `climaxAction`
- `resolution`
- `valueIn`
- `valueOut`

These fields sit beside the existing `goal`, `conflict`,
`turnOrValueShift`, `outcome`, and `consequence`. The point is not to force a
rigid formula into every paragraph; it is to give the writer a complete unit of
story instead of a string of micro-beats.

### Character Materiality

Character references must explain why a character changes the scene:

- what the protagonist wants;
- what they need instead;
- what false belief or fear blocks that need;
- which relationship, leverage, or wound makes the choice hard.

Do not require relationship deltas in every scene. A relationship-delta check
applies only when the scene contract claims a relationship is materially active.

### Planner-Owned Story Debt

V1 uses story debt as plan-local intent:

- `storyDebtId`
- `promiseText`
- `openedBySlotId`
- `expectedProgressSlotIds[]`
- `expectedPayoffSlotId`
- `payoffPolicy`

This is not a durable global ledger yet. The first question is whether exposing
story debt to the planner improves plan shape and prose outcomes.

## Diagnostic Dimensions

V1 keeps V0 dimensions and adds:

- `strategyConservation`: the plan visibly preserves the strategy packet.
- `storyGridSceneContract`: scenes carry goal, opposition, turning point,
  crisis, climax action, resolution, value shift, and consequence.
- `characterArcPressure`: chapters visibly pressure want/need and lie/truth
  through material character refs.
- `storyDebtTraceability`: story-debt IDs route into obligations and scenes.

## First Diagnostic

1. Run planner-only diagnostics on frozen fixture concepts.
2. Import findings into Plan Readiness Review for operator dispositions.
3. Draft one short story or the first 2-3 chapters from the selected arm.
4. Compare plan diagnostics, readiness findings, checker blockers, word ratio,
   and operator preference.

Promotion remains `hold` until the framework arm improves both upstream plan
quality and downstream prose usefulness.
