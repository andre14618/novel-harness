---
status: active
updated: 2026-05-08
role: plan-readiness-operating-model
---

# Plan Readiness Review

## Intention

Plan Readiness Review is the default human-in-the-loop checkpoint between
planning diagnostics and drafting. Its purpose is to improve upstream story
decisions before prose is generated, while collecting operator judgments that
can later calibrate diagnostics, planner prompts, and rewrite experiments.

The review is conversational by design. A diagnostic can say "this looks weak"
or "this required ID is not doing work"; the operator decides whether that is a
real issue, false positive, not applicable, acceptable choice, deferred concern,
or a plan edit.

## Default Rule

Before drafting from a novel plan that has planner-quality diagnostics
available, the harness should aggregate readiness findings by chapter/scene and
surface them for review.

Readiness items are not blockers by default. They become changes only when the
operator or an approved rewrite agent creates a normal `planning_edit`
proposal.

Bypassing readiness review is acceptable for disposable smoke tests, legacy
fixture replay, or explicitly scoped experiments, but the run should record
that the review was bypassed.

## Review Item Shape

Persisted readiness items should capture:

- `novelId`
- `targetKind`: `chapter_outline` or `beat_plan`
- `targetRef`: durable chapter or scene ID
- `sourceHash`: current target hash used for staleness
- `diagnosticLabel`: for example `REL-1`, `MATERIAL-1`, `WFACT-1`
- `dimension`
- `fixIntent`
- `preserveIds`: obligation, character, world-fact, and source IDs
- `explanation` and `missingForNextLevel`
- `status`: `open`, `accepted_as_is`, `not_applicable`, `deferred`,
  `proposal_created`, `fixed`, or `stale`
- `operatorDisposition`: `real_issue`, `false_positive`, `not_applicable`,
  `acceptable_choice`, `defer_to_drafting`, or `fixed`
- `operatorNote`
- `proposalEnvelopeId`, if a planning proposal was created
- downstream outcome refs after drafting/checking, when available

## Initial Diagnostic Set

Use the current calibrated scene diagnostics first:

- `relationshipDelta`
- `characterMateriality`
- `worldFactPressure`
- `motivationSpecificity`
- `stakesValueShift`

Applicability comes before quality. Do not ask the operator to label a
relationship issue for a scene that is not relationship-oriented, or a world
fact issue for a scene with no required world fact.

Candidate additions should be introduced one at a time only when the operator
decision is clear:

- endpoint landing;
- promise/story-debt progress;
- POV drive;
- scene necessity.

## Workflow

1. Planner diagnostics produce real-data reports.
2. The finding aggregate groups selected labels by target and emits rewrite
   packets with fix intents and preserved IDs.
3. The readiness importer persists or refreshes `plan_readiness_items`.
4. The operator reviews each item conversationally.
5. `accept`, `not applicable`, and `defer` record data without changing the
   plan.
6. `revise` or `remove requirement` creates a normal manual `planning_edit`
   proposal with stale preconditions.
7. Applying a proposal records normal proposal resolution and planning mutation
   lineage.
8. Read-only outcome reports join readiness items to proposal status, planning
   lineage, and exact downstream observer rows when those rows exist.

Current bridge route:

`POST /api/novel/:novelId/plan-readiness/:itemId/create-planning-proposal`

This route creates a manual `planning_edit` proposal only for open/deferred
items, only when the readiness target hash is current, and only when the
operator supplies a replacement value.

Current attribution route:

`GET /api/novel/:novelId/plan-readiness/outcomes`

This route is read-only. It reports readiness disposition, linked proposal
resolution, planning mutation lineage, and any exact downstream
outcome/impact/checker observations already attached to the proposal. Planning
lineage is not treated as proof of downstream quality; applied proposals with
lineage but no observer rows are marked as needing downstream observation.

## Data Use

Operator dispositions are first-class training and evaluation data, but not
immediate fine-tuning material.

Use the data to:

- tighten applicability rules when operators mark repeated false positives;
- update planner contracts when operators repeatedly convert a label into real
  plan edits;
- improve judge rubrics when explanations are unclear or over-broad;
- create before/after examples for future rewrite prompts;
- measure whether readiness review reduces downstream drift, rewrite loops, or
  weak prose.

## Next Build Slices

Done:

- persistent `plan_readiness_items` storage plus store tests;
- aggregate JSON import into readiness item drafts;
- read/list, import, disposition, and staleness-refresh routes.
- manual bridge from open/deferred readiness items to `planning_edit`
  proposals when the operator supplies a replacement target value.
- read-only outcome report joining readiness items to linked proposal status,
  planning mutation lineage, and exact downstream observers where available.

Next:

1. Add a supported remove-requirement action for required character/world-fact
   IDs; this needs a structural planning-edit target, not ad hoc mutation.
2. Add concrete downstream observer capture for approved planning edits after
   drafting/checking, so outcome reports can distinguish quality improvement
   from lineage-only application.
3. Add a minimal Planning Studio review panel only after the data contract is
   stable; UI work then requires Playwright evidence.

## Non-Goals

- Do not make readiness labels drafting blockers by default.
- Do not auto-mutate plans from diagnostics.
- Do not add many new checks before operator data shows the current set is
  insufficient.
- Do not train or fine-tune directly on operator dispositions without a
  separate reviewed dataset and eval gate.
