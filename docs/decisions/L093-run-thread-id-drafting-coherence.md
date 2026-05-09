---
status: active
date: 2026-05-09
role: decision-record
---

# L093: Run And Thread ID Drafting Coherence

## Decision

Extend the existing run/stable-ref traceability foundation into an end-to-end
run lineage plus narrative thread/payoff coherence contract.

Initial runtime integration should be additive: carry author-declared
`threadId`, `promiseId`, and `payoffId` through planner directives,
state-mapper obligations, writer context, and telemetry without making thread
semantics blocking.

## Rationale

Novel Harness already has important traceability pieces: DB-backed novel run
IDs, `llm_calls` telemetry, stable `chapterId`/`beatId`/`sourceId`/
`obligationId` refs, planning mutation lineage, proposal impact contexts,
chapter traceability routes, and early `promiseId`/`storyDebtId` method-pack
fixtures.

The gap is not "no IDs." The gap is that these IDs are not yet normalized into
one execution/story trace that can explain a plan variant, a scene draft, a
semantic finding, and a downstream stale-impact preview together.

Scene-first writing improves the generation unit, but coherence still depends
on whether the right story obligations travel through the whole pipeline. A
scene can be well formed locally and still drop a promise, weaken a character
arc, or fail to carry a world constraint into later consequences.

Run IDs solve a different but related problem: they make experiments and
operator review trustworthy. If a comparison page cannot identify which run,
variant, input hashes, prompt versions, and output hashes produced each
artifact, the team can waste time comparing stale or mismatched evidence.

Thread/payoff IDs should let the planner and reviewer ask better questions:

- which narrative threads are active in this scene?
- what promise is being opened, progressed, complicated, or paid off?
- what downstream scene is affected if this plan item changes?
- did the generated prose actually land the intended movement?

This is a context-engineering move, not a mandate to add more context. The
writer should eventually receive the relevant thread ledger excerpt for a
scene, not a broad dump of all novel state.

## Implications

- Existing `runId`/stable-ref surfaces should be reused wherever possible
  instead of duplicated.
- `rootRunId`, `parentRunId`, `variantId`, artifact refs, and artifact hashes
  should become standard diagnostic metadata where current outputs lack them.
- `threadId`, `promiseId`, and `payoffId` are runtime traceability refs:
  planner directives may declare them, the state mapper attaches them to
  relevant obligations, and writer context/telemetry surfaces active refs.
- `sceneId` remains the primary plan/write/check unit under L92.
- `obligationId` remains the local satisfaction unit and can reference
  thread/payoff refs.
- Deterministic validators should catch missing IDs, unknown refs, duplicate
  refs, orphaned payoffs, stale hashes, and mismatched review inputs.
- Semantic checks should judge whether a scene actually progresses or pays off
  declared threads, but those checks remain advisory until calibrated.
- Side-by-side review should display run/variant identity and thread movement
  before a React UI is built.

## Lane Order

1. Add run manifest metadata to local diagnostic outputs.
2. Define thread/payoff refs in planner output contracts.
3. Produce deterministic thread maps and impact previews.
4. Add static review visibility for run and thread comparisons.
5. Add advisory scene-level thread semantic review.
6. Add advisory semantic review for thread progress/payoff landing.
7. Integrate proven refs into planning proposals and runtime stale-marking.

## Evidence Gate

Thread refs are promoted as additive visibility/context infrastructure, not as
creative policy. Blocking or rewrite behavior still requires:

- deterministic validators for missing/unknown/mismatched refs;
- semantic review showing thread/payoff landing improves or does not regress;
- operator side-by-side review explaining why the variant is more coherent.

## 2026-05-09 Runtime Integration

Production directives now accept `storyThreads`, `storyDebts`, and
`storyPayoffs`; the planner prompt renders stable IDs and tells downstream
agents to preserve them. `planning-state-mapper` can attach exact
`threadId`/`promiseId`/`payoffId` refs and `storyDebtStage` to obligations.
Writer context now shows active refs at the beat/chapter context level and
emits them in `writer-context` telemetry. No checker blocker or automatic graph
mutation was added.

## Detail

Implementation lanes and field sketches live in
`docs/charters/run-thread-id-drafting-coherence.md`.
