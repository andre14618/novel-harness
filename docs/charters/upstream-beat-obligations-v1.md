---
status: active
date: 2026-05-01
experiment: 284
owner: planning-to-beat-contract
---

# Upstream Beat Obligations V1

## Goal

Move semantic responsibility upstream. Planning should produce a complete,
human-reviewable beat contract before drafting. The beat writer should execute a
small local ask, and beat checkers should verify only obligations the writer saw.

## North Star

Planning decides what must happen. Drafting writes it. Beat checks verify local
execution. Chapter checks are backstops for stitching and contradictions, not the
primary way missing planned state is discovered.

## Contract Shape

Target contract per beat:

```ts
type BeatObligations = {
  mustEstablish: Obligation[]
  mustPayOff: Obligation[]
  mustTransferKnowledge: Obligation[]
  mustShowStateChange: Obligation[]
  mustNotReveal: Obligation[]
  allowedNewEntities: string[]
}
```

The same contract will eventually feed:

- Studio plan review.
- beat-writer prompt context.
- beat-level checker prompts.
- current-surface eval fixtures.

## Current Slice: Shadow Derivation

The first implementation slice does not change planner schema, writer prompts, or
checker severity. It derives a shadow obligation plan from the existing outline:

- `requiredPayoffs` become explicit seed/payoff obligations.
- unlinked `establishedFacts` are assigned to beats by conservative text match.
- `knowledgeChanges` are assigned by conservative text match plus character
  presence.
- `characterStateChanges` are assigned only when state text appears in a beat
  involving that character.
- orphan facts/knowledge/state changes are logged as planning-obligation warnings.
- overloaded beats are logged when they carry more than five hard obligations.

This is deliberately measurement-first. A shadow warning means the current plan
does not prove the writer saw the obligation. It is not yet a drafting blocker.

## Why Not Render Immediately

The current audit found that several planner fields are not writer-visible:

- full `establishedFacts`
- `knowledgeChanges`
- `characterStateChanges`
- soft structural tags (`valueShifted`, `gapPresent`, `lifeValueAxes`, `mice*`)

Rendering all of them naively would overload V4 Flash non-thinking. The desired
runtime shape is a compact per-beat obligation packet, but we first need data on
which obligations can be assigned deterministically and which require planner
schema changes or human review.

## Readiness Ladder

1. Shadow derivation logs orphan/overload rates.
2. Planner schema adds authored `beatObligations` if shadow derivation shows
   orphan rates are material.
3. Planning-readiness gate blocks only mechanical contract defects.
4. Studio exposes obligations for human review before drafting.
5. Writer prompt renders compact `BEAT OBLIGATIONS` per beat.
6. Beat checkers consume the same obligation packet.
7. Fresh current-surface checker datasets are generated after the surface is
   frozen.

## Success Criteria

- Every persisted chapter-level state item is assigned to a beat or explicitly
  marked non-prose/inferred.
- No semantic checker blocks on state hidden from the writer.
- Human review moves upstream to the plan contract.
- V4 Flash non-thinking writer receives a bounded local ask.
