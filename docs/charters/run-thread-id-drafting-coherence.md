---
status: active
updated: 2026-05-09
kind: implementation-charter
lane: upstream-planning-methodology
---

# Run And Thread ID Drafting Coherence

## Question

Can Novel Harness make drafting more coherent by carrying durable run lineage
and narrative thread/payoff IDs from concept through planning, scene writing,
review, and revision?

The goal is not more context volume. The goal is better context routing: every
scene should know which story threads it is responsible for, every generated
artifact should know which run produced it, and every review finding should be
traceable back to the exact plan contract it is judging.

## Change Packet

- Optimized layer: upstream concept/planning traceability and drafting context
  engineering.
- Exact change: extend existing run/stable-ref traceability into normalized
  run manifests and narrative thread/payoff refs before changing writer
  behavior.
- Held constant: production writer, checker severity policy, proposal policy,
  and UI defaults until trace completeness is proven.
- Expected benefit: clearer story debt propagation, fewer dropped payoffs, less
  stale comparison work, and better side-by-side evidence when plan variants
  are compared.
- Downstream projection: writer prompts can receive a compact relevant thread
  ledger per scene; semantic review can judge whether intended thread movement
  landed; planning edits can deterministically identify affected downstream
  scenes.
- Evidence gate: no runtime drafting default changes until run/thread refs are
  complete, validated, and visible in local diagnostic artifacts.

## Existing Foundation

This lane does not start from zero. The repo already has:

- DB-backed `runId` for novel runs and logged LLM calls;
- experiment/eval artifact `runId` and `variantId` surfaces in some
  diagnostics;
- stable `chapterId`, `beatId`, `sourceId`, `characterId`, and `obligationId`
  refs in enriched outlines and checker/proposal evidence;
- planning mutation lineage and proposal impact contexts;
- chapter health and traceability routes that join outline refs to
  writer/checker/event evidence;
- early `promiseId`/`storyDebtId` refs in method-pack fixtures and docs.

The new work is to normalize and connect those pieces:

- add `rootRunId`, `parentRunId`, artifact hashes, and prompt/model metadata
  where diagnostic artifacts lack them;
- distinguish execution lineage from narrative thread lineage;
- add `threadId` and `payoffId` beside existing promise/story-debt refs;
- produce deterministic maps that show thread movement and downstream stale
  impact across scenes.

## Terms

`runId` identifies one execution of a diagnostic, planner, writer, checker, or
review pass.

`rootRunId` identifies the top-level experiment or operator session that a
chain of derived runs belongs to.

`parentRunId` links a derived run to the run it reused or mutated.

`variantId` identifies the changed method arm, such as `baseline`,
`materiality-v1`, or future template/writer variants.

`threadId` identifies a narrative continuity vector. Examples:
`main_plot`, `relationship:cassel_noor`, `character_arc:noor_agency`,
`world_rule:compiler_revision`, `mystery:folio_truth`.

`promiseId` identifies a story debt opened inside a thread.

`payoffId` identifies a planned payoff or partial payoff for a promise.

`obligationId` remains the local contract item a writer/checker can satisfy.
Obligations can point to `threadId`, `promiseId`, and `payoffId`.

`sceneId` is the primary plan/write/check unit under L92. `beatId` remains an
annotation or legacy compatibility ref inside scenes.

## Desired Trace

```text
rootRunId
  runId: concept/template planning
    templateId / structureSlotId
    threadId[] / promiseId[]
  runId: chapter planning
    chapterId -> thread movements
  runId: scene planning
    sceneId -> obligations -> threadId/promiseId/payoffId
  runId: scene writing
    sceneId -> draftSpanId -> produced prose
  runId: semantic/prose review
    sceneId -> observations -> thread/payoff satisfaction
  runId: planning edit or revision
    proposalId -> affected refs -> new run lineage
```

This is the interleaving target: narrative IDs travel alongside execution run
IDs at every phase, so the harness can say what changed, why it changed, and
which downstream story obligations were affected.

## Lanes

### Lane 1 - Run Manifest Baseline

Normalize read-only run manifests in local diagnostics before changing
generation. Reuse existing run IDs when present; add missing parent/root,
variant, and artifact-hash metadata around them.

Minimum fields:

- `runId`, `rootRunId`, `parentRunId`;
- `laneId`, `variantId`, `phase`;
- model/provider and prompt version when an LLM is called;
- input artifact refs and hashes;
- output artifact refs and hashes;
- created timestamp and command args.

First target: corpus recreation POC outputs and review artifacts.

Evidence gate: a deterministic validator can detect stale inputs, missing run
links, duplicate run IDs, and mismatched artifact hashes.

Status 2026-05-09: first slice implemented for corpus recreation diagnostics.
`diagnostics:corpus-recreation-poc`, prose review, semantic review, aggregate,
readiness, and static review now write run manifests or sidecar manifests with
input/output hashes. This is diagnostic metadata only; it does not change
planning, writing, judging, proposal behavior, or UI.

### Lane 2 - Thread/Payoff Contract Schema

Define thread refs in the planner output contract before prompt changes.

Minimum shape:

- chapter contract declares expected `threadMovements`;
- scene contract declares required thread movements for that scene;
- obligation contract can reference `threadId`, `promiseId`, and `payoffId`;
- every payoff references an opened promise or explicitly declares itself as a
  standalone reveal/turn.

Evidence gate: fixture validation catches unknown refs, duplicate refs,
orphaned payoffs, promises with no planned progress/payoff, and obligations
that reference missing scenes.

Status 2026-05-09: first contract slice implemented for corpus recreation POC.
Planner output can carry `threadId`, `promiseId`, and `payoffId` on scene
obligations; deterministic comparison flags missing/unknown refs and payoff
refs attached to the wrong promise. Review, aggregate, semantic, and readiness
artifacts surface these refs. Remaining Lane 2/3 work: emit a dedicated thread
map with promise progress/payoff rows.

### Lane 3 - Thread Map Diagnostics

Produce a read-only thread map from a plan artifact.

The map should answer:

- which threads are active by chapter and scene;
- where each promise opens, progresses, complicates, and pays off;
- which scenes carry no load-bearing thread work;
- which downstream scenes are affected if a thread, promise, payoff, chapter,
  or scene contract changes.

Evidence gate: static reports and JSON output are enough for operator review;
do not build a React surface until the report proves useful.

Status 2026-05-09: first deterministic diagnostic is implemented as
`diagnostics:corpus-recreation-thread-map`. It reads corpus recreation POC
`packet.json` and `plan.json` artifacts, emits thread/promise/payoff movement
rows, scene summaries, impact-preview refs, structural issues, and a sidecar
run manifest when an output artifact is written. It does not call an LLM,
create proposals, mutate plans, or change writer context.

### Lane 4 - Interleaved Writer Context Experiment

Default-off only after Lanes 1-3.

Change the scene writer input from "scene contract plus all available context"
to "scene contract plus relevant thread ledger excerpt."

The excerpt should include:

- active promises that this scene must progress or pay off;
- prior thread state needed for this scene;
- the planned consequence this scene should leave for later scenes;
- only the character/world facts tied to those thread obligations.

Evidence gate: compare baseline vs interleaved context on the same scene plans.
Promotion requires equal or better deterministic shape, better semantic thread
landing, and no increase in source leakage or malformed output.

Status 2026-05-09: writer behavior is still unchanged, but the deterministic
context packet preview exists as `diagnostics:corpus-recreation-thread-context`.
It emits one compact per-scene thread ledger with active obligations,
promise/payoff refs, prior movement summaries, and future affected scene IDs.
This is setup evidence for a later default-off writer experiment, not runtime
context injection.

### Lane 5 - Scene Thread Semantic Review

Reuse the narrow semantic judge pattern: one scene, one dimension, anchored
labels, applicability skips.

Initial dimensions:

- `threadProgression`: did the scene actually progress the declared thread?
- `promisePayoff`: did the promised payoff or partial payoff land?
- `motivationCausality`: did character motive cause the thread movement?
- `worldConstraintUse`: did world detail alter cost, choice, reveal, or
  outcome?

Relationship dimensions should run only when the scene contract declares
relationship work. Not every scene needs every checker.

Evidence gate: advisory diagnostics only. Findings feed Plan Readiness Review
or side-by-side comparison; they do not block drafting by default.

Status 2026-05-09: first advisory dimensions are wired into the existing
narrow judge surface. `threadProgression` runs only when a scene has declared
`threadId` obligations, and `promisePayoff` runs only when a scene has declared
`promiseId` or `payoffId` obligations. Both are diagnostic-only and use the
same stable-prefix/volatile-excerpt shape as existing scene semantic review.

### Lane 6 - Operator Review And Side-By-Side Evidence

Extend static review artifacts before building UI.

The report should show:

- compared `runId`/`variantId` pairs;
- chapter and scene contracts;
- thread map rows;
- prose and semantic findings;
- impact preview for changed thread/payoff refs.

Evidence gate: operator can inspect why one variant is more coherent without
reading every scene from scratch.

Status 2026-05-09: first static evidence slice is implemented in
`diagnostics:corpus-recreation-review`. When POC directories contain
`run-manifest.json`, `thread-map.json`, or `thread-context.json`, the static
HTML review page now shows run/root/parent/variant provenance, thread movement
rows by scene, impact preview refs, compact context previews, and thread-map
issues. Missing artifacts are displayed explicitly instead of inferred.

### Lane 7 - Runtime Proposal Integration

Only after the diagnostic lanes prove value.

Planning edits should target stable refs and report affected downstream
threads/scenes. Approved edits create new run lineage and mark stale derived
artifacts. This is where the existing proposal system should attach, not where
the initial experiment begins.

## Deterministic Checks

These are structural and should not require an LLM:

- missing, duplicate, or malformed IDs;
- unknown `threadId`, `promiseId`, `payoffId`, `sceneId`, or `obligationId`;
- orphaned payoffs;
- promises with no planned progress or payoff;
- payoff assigned to a missing or stale scene;
- artifact hash mismatch;
- review output judging a different plan/prose hash than it claims;
- source-boundary forbidden terms in corpus POCs.

## Semantic Checks

These require judgment and should start diagnostic-only:

- whether a thread progression is satisfying;
- whether a payoff feels earned;
- whether character motivation caused the scene turn;
- whether world detail is operational rather than decorative;
- whether prose quality is commercially compelling.

Semantic checks should return concrete rationale and target refs. They should
not become rewrite loops or blockers until calibrated against operator review.

## Promotion Rule

This lane promotes in this order:

1. Run manifests and deterministic validation.
2. Thread/payoff schema and deterministic thread map.
3. Static review visibility.
4. Advisory semantic thread review.
5. Default-off interleaved writer context experiment.
6. Proposal/runtime integration.

Do not skip directly to writer prompt changes. If the IDs are not complete and
visible, the harness cannot know whether coherence improved or simply changed
shape.

## Non-Goals

- Do not make a promise ledger a production blocker in the first slice.
- Do not require every scene to carry every semantic dimension.
- Do not add UI before static artifacts prove the review shape.
- Do not use thread IDs to dump more context into writer prompts.
- Do not remove legacy beat IDs while migration evidence still depends on
  them.
