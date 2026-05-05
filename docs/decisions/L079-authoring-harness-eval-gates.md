---
status: active
date: 2026-05-04
decision: authoring-harness-eval-gates
---

# L79 Authoring Harness Eval Gates

## Decision

The next authoring work focuses on visibility, interactivity, deterministic
impact awareness, and richer planning artifacts before adding new production
creative heuristics.

Any craft heuristic that changes planner, writer, or checker behavior must
start as diagnostic-only or A/B-gated work. Source strength and craft plausibility
are not enough to wire a heuristic into default production behavior. Each
candidate needs a baseline, one changed lever, a declared sample shape, a
measurable signal, a stop gate, and promotion/rollback criteria.

Promise/Progress/Payoff starts as a planner-owned story debt artifact, not a
global Canon-like substrate. It may become durable schema only after evidence
shows better structure, payoff continuity, or reduced operator correction
burden.

UI-facing work remains gated by Playwright MCP browser evidence before handoff.

## Implications

- Prioritize stable-ID audit, target maps, deterministic impact preview, and
  proposal-backed planning edits.
- Add read-only visibility endpoints before broad write paths.
- Keep scene turns, micro-tension, moral-argument checks, character-agency
  checks, world-detail forcing, and genre strictness profiles out of production
  defaults until A/B evidence exists.
- Character voice and motivation polish is important, but should come after
  context engineering, deterministic flow, and operator interactivity are
  working.
- Manual review remains the default for Canon/world/character/plot changes;
  `planning_edit` joins `canon_update` in the default manual proposal kinds.
