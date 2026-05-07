---
status: active
date: 2026-05-06
---

# L087: Agent Phase Impact Contract

## Decision

Before non-trivial implementation, agents must surface a change packet:

- Phase/surface: the creation phase, UI, checker, telemetry, test, or docs
  surface being changed.
- Optimized layer: concept, planning template, chapter plan, scene plan, beat
  obligations, writer, checker, revision, proposal/review, UI, telemetry, or
  test infrastructure.
- Exact change: the behavior, files/modules, data shape, or workflow being
  altered.
- Expected benefit/outcome: what should improve and how that improvement should
  be observable.
- Downstream projection: which planner, writer, checker, proposal, UI, stable
  ID, lineage, or evaluation contracts should be affected.
- Evidence gate: the targeted test, replay, diagnostic, A/B run, or Playwright
  pass that can prove or disprove the benefit.
- Non-goals/risks: what is deliberately not being changed, especially when a
  downstream patch is only evidence for an upstream design question.

If the phase or benefit is unclear, the agent should keep work diagnostic-only,
make a docs/spec slice, or stop for user judgment before editing runtime code.

## Rationale

The harness is now mature enough that a local improvement can be wrong-layer
work. Recent planner-shape experiments showed this clearly: hard beat caps and
post-hoc packing can produce useful evidence, but they do not automatically
solve the upstream planning problem of native chapter shape, obligation
distribution, and downstream context contracts.

The repository needs a standing rule that forces the agent to say what is being
changed, why that layer is the right one, and how the effect should trace
through downstream IDs, proposals, checkers, drafting, UI, and evals. This keeps
visibility/interactivity work tied to the actual novel-writing harness rather
than to scaffolding that is only locally convenient.

## Implications

- Diagnostic-only and A/B-only arms may still use negative controls, but they
  must be labeled as evidence surfaces, not production candidates.
- Runtime planner/writer/checker changes need a predicted downstream effect and
  a verification signal before they become default behavior.
- "Rescue operator", "upstream phase fix", "UI visibility", and "test
  infrastructure" are different phase claims and should not be blurred.
- Methodology work should isolate one layer at a time so a test can explain
  what caused a better or worse result.
- Stable IDs, lineage records, proposal envelopes, and replay/diagnostic
  outputs are part of the projection, not after-the-fact bookkeeping.
- Docs sweeps should capture lessons and decisions, not just shorten live docs.

## Enforcement

This is enforced as repository workflow discipline through `AGENTS.md`,
`docs/authoring-harness-program-loop.md`, and code review. Future mechanical
enforcement can add a lightweight checklist to lane templates or commit
preflight tooling if agents repeatedly skip the packet.
