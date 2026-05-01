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

## Slice 2: Planner-Authored Obligations

Exp #286 promotes the contract into planner output and writer context while
keeping checker severity unchanged:

- `sceneBeatSchema.obligations` is optional/defaulted for legacy outlines.
- `planning-beats` was initially instructed to emit compact per-beat obligations;
  exp #289 supersedes that by making `planning-beats` beat-shape only and moving
  obligation placement into `planning-state-mapper`.
- `beat-context-render.ts` renders the obligations as `BEAT OBLIGATIONS`.
- the shadow derivation layer treats planner-authored obligations as explicit
  assignments and still logs orphan/overload telemetry.

This is not yet a checker promotion. Beat checkers must be updated and calibrated
against the new current surface before they can block on obligations.

## Fresh Surface Measurements

Exp #285, `novel-1777596835809`, measured the shadow-only surface on the same
3-chapter seed. Facts mapped cleanly, but state changes frequently remained
orphaned: chapter summaries were `0/0/2`, `0/0/1`, and `0/2/2` for
fact/knowledge/state orphans. Verdict: derived obligations alone are not enough;
the planner must author the local beat contract.

Exp #286 deployed planner-authored obligations. First run
`novel-1777597478181` proved the model emits obligations for every beat, but also
exposed that optional obligation metadata must be leniently parsed: malformed
id-only payoff items should not reject an otherwise valid chapter. Hardened commit
`1f62210` fixes that boundary.

Post-hardening run `novel-1777597799926` produced planning without schema retries.
All facts were assigned and no beats overloaded. Remaining orphans were semantic
coverage gaps, not mechanical parse failures: chapter 1 had `0/2/2`, chapter 2 had
`0/3/1`, chapter 3 had `0/0/0` for fact/knowledge/state orphans. Verdict:
planner-authored obligations are viable as writer context, but not ready for
blocking checker promotion. Next slice should tighten the planner obligation
prompt/contract so every `knowledgeChanges` and `characterStateChanges` item is
either assigned to an obligation or explicitly marked non-prose.

Exp #287 tightened the prompt to require every `knowledgeChanges[]` and
`characterStateChanges[]` item to mirror into an obligation, and hardened optional
soft-prior arrays so invalid tags like `miceOpens: "E"` do not reject chapters.
The prompt improved one run (`novel-1777598129824`: all facts/knowledge assigned,
state orphans 1/1/0) but did not eliminate variance on the final deployed surface
(`novel-1777598438754`: all facts assigned, no schema retries, but chapter 3 still
had 3 knowledge and 1 state orphan). Verdict: prompt-only tightening is helpful
but insufficient. The next slice should add a deterministic coverage validator
and targeted chapter re-expansion or explicit non-prose exemption field before
checker promotion.

Exp #288 adds the first deterministic coverage validator. Before planning approval
and DB persistence, each chapter is checked for orphan facts, knowledge changes,
and character state changes using the same writer-visible obligation derivation.
Chapters with gaps get up to two targeted `planning-beats` re-expansions with a concrete
coverage-error packet. Any remaining gaps are deterministically auto-repaired by
injecting compact obligations into the nearest plausible beat, so hidden state is
not discovered later by chapter/function checkers.

Validation run `novel-1777601516385` on deployed commit `8d57662` exercised the
new path: chapters 2 and 3 retried for obligation gaps, then final planning
telemetry reported zero orphan facts, zero orphan knowledge changes, zero orphan
state changes, and zero overloaded beats across all three chapters.

Exp #289 splits the judgment-heavy placement step out of `planning-beats` into
`planning-state-mapper`. Coverage retries now rerun the mapper against a fixed
beat list, not the whole beat expander. Planner-isolated LXC runs `576` and `577`
both reached final zero orphans with zero deterministic auto-repairs, but mapper
retries were still needed. The mapper maxTokens was raised to 8192 after run `576`
hit JSON-retry recoveries at the 6144 cap, and retry prompts now preserve prior
valid state so the mapper cannot pass coverage by deleting facts.

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

1. Shadow derivation logs orphan/overload rates. Done in exp #284/#285.
2. Planner schema adds authored `beatObligations` if shadow derivation shows
   orphan rates are material. Done in exp #286.
3. Writer prompt renders compact `BEAT OBLIGATIONS` per beat. Done in exp #286.
4. Planning-readiness coverage validator detects missing obligation mirrors. Done
   in exp #288.
5. Studio exposes obligations for human review before drafting.
6. Planning-readiness gate blocks only mechanical contract defects.
7. Beat checkers consume the same obligation packet after calibration.
8. Fresh current-surface checker datasets are generated after the surface is
   frozen.

## Success Criteria

- Every persisted chapter-level state item is assigned to a beat or explicitly
  marked non-prose/inferred.
- No semantic checker blocks on state hidden from the writer.
- Human review moves upstream to the plan contract.
- V4 Flash non-thinking writer receives a bounded local ask.
