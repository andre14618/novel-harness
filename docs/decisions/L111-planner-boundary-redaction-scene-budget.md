---
status: active
date: 2026-05-13
---

# L111: Planner Boundary Redaction And Scene-Scale Budgets

## Decision

Production planning should feed future chapter constraints as boundaries, not as
current-chapter story material. When a future-boundary term belongs to a later
chapter, scene expansion, state mapping, scoped story refs, adjacent handoffs,
and retry feedback should redact or generalize that term instead of repeating it
inside "do not reveal X" instructions.

Planning entries are scene-scale story turns, not micro-beats. The rough count
policy now treats a 3k chapter as about 3-5 planned entries. Seeds and method
fixtures should describe story ownership and endpoints, not tell the planner to
fill an arbitrary count such as 8-10 scenes.

## Rationale

The Rillgate planner was no longer failing because the model lacked a rule. It
was being primed with withheld future vocabulary in current-chapter context:
current chapter purpose, required beat notes, story debt payoff policy, adjacent
handoffs, and retry feedback could all repeat the exact forbidden reveal terms.
That made the negative prompt itself the strongest semantic anchor.

The harness should positively define the current chapter's allowed movement and
endpoint while keeping future reveal names out of the local generation window.
Deterministic guards still enforce order, but guard retry feedback should not
echo the forbidden phrase back into the next prompt.

## Evidence

- Pre-change Rillgate scene expansion reduced overplanning but failed Chapter 5
  sequence guard after retry by naming a future illegal harvest reveal.
- Post-change isolated planner run
  `test-planner-mercenary-rillgate-saltmine-1778674224711` completed planning
  with 10 chapters / 49 scenes, balanced scene load, no sequence-guard retry,
  and `futureEventAnchors: 0`.
- Verification passed:
  `bun run test:fast`,
  `./node_modules/.bin/tsc --noEmit`,
  `git diff --check`,
  JSON seed/fixture parse checks, plus focused planning/scene-count tests.

## Implications

- Do not reintroduce "do not reveal X" prompts for future chapter secrets when
  X is itself a withheld reveal term. Use boundary language and current-chapter
  ownership instead.
- Seed packets should remain story configuration, not prompt process control.
- Scene count pressure belongs in production count policy and telemetry, not in
  raw seed prose.
