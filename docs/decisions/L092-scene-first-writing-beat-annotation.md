---
status: active
date: 2026-05-09
role: decision-record
---

# L092: Scene-First Writing, Beat Annotation Boundary

## Decision

Treat the scene as the primary plan/write/check unit for the next authoring
methodology work. Treat beats as annotation, obligation, and traceability
granularity inside scenes, not as the default writer-call unit.

Existing semantic checks remain valuable, but they should be adapted upward to
scene contracts instead of preserving beat-level writing as the future default.
The legacy beat writer/checker path remains supported for current runtime
compatibility and migration evidence.

## Rationale

The corpus structure reference showed that source-derived beats are usually
too small to be a natural writing unit. They behave more like structural
annotations inside scenes:

- median beat length in the sampled reference was about 103 words;
- median scene length was about 565 words;
- chapter 8 used 35 annotation beats inside 7 scenes;
- scene-call writing produced more stable chapter drafts than one
  chapter-level JSON writer call.

The prior harness had semantic checks, but they were attached to a
beat-writing pipeline:

- `adherence-events` verifies whether a beat's obligated events appeared;
- `halluc-ungrounded` verifies grounding for a beat-sized prose unit;
- `chapter-plan-checker` checks final chapter prose against a legacy
  chapter outline with beat references;
- planner-quality and discernment diagnostics review plan quality, but not
  the new corpus-recreation scene contract.

That is real semantic checking, but it is not proof that beat-level writing is
the right methodology. It is evidence that the harness can semantically
evaluate plan/prose relationships and should reuse that machinery at the scene
level.

## Implications

- New planning experiments should prefer chapter contracts and scene contracts
  before prose.
- A scene contract should name goal/objective, opposition, turning point or
  value shift, crisis/choice, outcome, consequence, and required obligation
  refs.
- Beat hints should remain available as internal scene annotations and
  source-linked obligations.
- The next semantic adapter should reuse the existing narrow judge shape where
  possible: one scene, one dimension, anchored labels, deterministic
  applicability skips.
- Initial scene-level semantic dimensions should be:
  `sceneDramaturgy`, `motivationSpecificity`, `worldFactPressure`, and
  relationship checks only when the scene actually has relationship work.
- Do not create new semantic checkers until the existing narrow LLM-call shape
  is tried against scene contract plus scene prose.
- Do not make scene-level semantic findings blockers by default. They feed
  diagnostics and Plan Readiness Review until operator/outcome data proves
  value.

## Evidence

Corpus-recreation POC data:

- chapter 1 scene-call run passed: 4/4 scenes, 1583/1832 words, all scene
  minimums met, no source-term leakage;
- chapter 2 passed: 4/4 scenes, 2874/3353 words;
- chapter 5 Flash rerun passed the single-long-scene case: 2372/2255 words;
- chapter 8 Flash rerun passed the high-scene-count case: 7/7 scenes,
  3081/3621 words.

Plan-shape matching held across sampled chapters for scene count, polarity
sequence, MICE/thread sequence, and beat-hint density. Prose expansion was the
unstable surface, and scene-level calls with deterministic retry evidence were
more useful than whole-chapter writing.

## Non-Goals

- Do not remove legacy beat IDs or beat-level checker compatibility.
- Do not promote corpus-recreation POC behavior into production runtime yet.
- Do not use corpus structural fit as proof of story quality.
- Do not overfit new checkers before testing the existing semantic judge
  pattern against scene contracts.
