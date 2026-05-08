---
status: active
date: 2026-05-07
role: decision-record
---

# L091: Plan Readiness Review Default

## Decision

Plan Readiness Review is the default checkpoint between planner diagnostics and
drafting when diagnostics are available. The harness should aggregate
diagnostic findings by durable chapter/scene target, surface them as
operator-review items, and capture the operator's disposition before the plan
is treated as ready for drafting.

Readiness items are not automatic blockers and do not mutate the plan. A plan
change happens only through a normal manual `planning_edit` proposal, with
stale preconditions and lineage, after the operator or an approved rewrite
agent supplies the proposed replacement or removal.

The operating model is `docs/plan-readiness-review.md`.

## Intention

The intention is to improve the story plan at the right layer: upstream
concept/planning decisions before prose generation. Diagnostics should become a
conversation about whether the plan's required characters, world facts,
relationships, motivations, stakes, endpoints, and story debts are actually
doing useful work.

The second intention is data capture. Human-in-the-loop determinations should
teach the harness which diagnostics are real, which are false positives, which
planner contracts need strengthening, and which changes improve downstream
drafting/checking outcomes.

## Rationale

Recent planner-discernment work showed that model judges are useful only in a
narrow shape: one excerpt, one dimension, anchored labels, and operator
calibration. Broad pairwise plan judging was position-biased, and broad
diagnostic inventories can produce many soft flags. That makes automatic
rewrites or blocking behavior the wrong default.

A readiness layer preserves the useful part:

- diagnostics identify likely planning questions;
- deterministic aggregation routes them to target IDs;
- the operator decides whether the issue matters;
- normal proposal infrastructure performs any actual plan change;
- dispositions and downstream outcomes become evaluation data.

## Implications

- Planner diagnostics should distinguish applicability from quality before
  creating review items.
- Readiness storage must preserve target refs, source hashes, diagnostic
  labels, fix intents, explanations, preserve IDs, operator disposition,
  proposal linkage, and downstream outcome refs.
- UI should eventually present readiness as a planning conversation, not as an
  error list.
- The current check set is sufficient for the first data loop:
  relationship delta, character materiality, world-fact pressure, motivation
  specificity, and stakes/value shift.
- Add new checks one at a time only when they create a clear operator decision.
- Readiness review is bypassable for disposable smoke tests and explicitly
  scoped experiments, but the bypass should be recorded.
- Operator disposition data can calibrate checkers, planner prompts, rubrics,
  rewrite prompts, and promotion evidence; it is not fine-tuning material
  until separately reviewed and gated.

## Evidence Gate

The first implementation should prove:

- aggregate JSON can be imported into stable readiness items;
- dispositions can be recorded without mutating plans;
- proposal creation remains manual and uses existing `planning_edit` paths;
- stale target hashes invalidate old readiness items;
- focused tests cover import, disposition, proposal bridge, exact
  remove-requirement edits, staleness, and draft-impact observer attachment.

UI evidence is required only when the Planning Studio review surface is added.
