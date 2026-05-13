---
status: active
date: 2026-05-13
---

# L112: Scene Check Cost Posture

## Decision

Default drafting should prioritize scene-contract and deterministic plan
fulfillment over false-positive-heavy semantic gates.

The production scene retry aggregator is `src/phases/scene-checks.ts`.
Adherence remains active because it checks whether the scene entry's required
action is enacted. The halluc-ungrounded LLM checker is no longer default-on in
the scene retry loop; `pipeline.sceneEntityGroundingMode` defaults to `"off"`
and must be set to `"llm-blocking"` for deliberate calibration/regression runs.

Isolated drafting runs also make prose-semantic telemetry explicit instead of
default-on. `--quality-telemetry-packet` remains the stable way to request the
paid prose+scene semantic packet.

## What Changed

- Per-scene halluc-ungrounded LLM blocking is default-off. It remains opt-in via
  `sceneEntityGroundingMode: "llm-blocking"` for deliberate entity-drift
  calibration or regression runs.
- Prose semantic eval in `test-drafting-isolated` is default-off. It remains
  opt-in via `--prose-semantic-eval`.
- Scene semantic review stays explicit. Use `--quality-telemetry-packet` when a
  run needs the paid advisory prose+scene telemetry packet.
- Scene adherence stays active because it tests whether the required scene
  action was enacted on-page.

## Telemetry Posture

Default drafting still captures the mechanical evidence needed to tune the
harness: planning source shape, scene contracts, obligations, trace IDs,
writer-context events, LLM call rows, chapter drafts, word counts, plan-check
and validation outcomes, continuity/integrity/functional findings, checker
readiness, and Plan-Assist readiness sidecars in isolated runs.

Semantic judging is now a deliberate evidence layer. It should be used after a
bounded or complete draft when the question is quality, endpoint landing, prose
saturation, or scene-level semantic strength; it should not spend default retry
budget while the core production path is proving that it can draft through.

## Rationale

Entity hallucination checking has useful review value, but a single LLM-only
grounding verdict is too noisy and too expensive to spend default retry budget.
The harness gets more leverage from deterministic upstream-to-downstream
fulfillment: plan item IDs, scene contracts, required actions, forbidden future
anchors, and writer-visible context.

## Implications

- Surface possible entity drift as optional telemetry or review evidence unless
  a run explicitly opts back into blocking entity grounding.
- Put blocking weight on scene-contract/adherence failures that map back to
  deterministic plan items and IDs.
- Keep semantic prose/scene judging as an explicit evidence packet, not a
  routine drafting cost.
