---
status: active
date: 2026-05-09
role: decision-record
---

# L093: Run And Thread ID Drafting Coherence

## Decision

Make durable run lineage and narrative thread/payoff IDs the next traceability
foundation for authoring methodology work.

Before changing production writer behavior, diagnostics should prove that the
harness can carry these refs from concept/planning through scene contracts,
prose artifacts, semantic review, and planning/revision proposals.

## Rationale

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

- `runId`, `rootRunId`, `parentRunId`, `variantId`, artifact refs, and artifact
  hashes should become standard diagnostic metadata.
- `threadId`, `promiseId`, and `payoffId` should be added to planner contracts
  as traceability refs before production prompt changes.
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
6. Run a default-off interleaved writer-context experiment.
7. Integrate proven refs into planning proposals and runtime stale-marking.

## Evidence Gate

No production writer-context change should promote until:

- run/thread refs are complete on the compared artifacts;
- deterministic validators pass;
- semantic review shows thread/payoff landing improves or at least does not
  regress;
- operator side-by-side review can explain why the variant is more coherent.

## Detail

Implementation lanes and field sketches live in
`docs/charters/run-thread-id-drafting-coherence.md`.
