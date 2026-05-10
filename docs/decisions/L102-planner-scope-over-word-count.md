---
status: active
date: 2026-05-10
---

# L102: Planner Scope Over Word-Count Control

## Decision

Planning agents must size the story ask before drafting. Word counts are
telemetry and rough chapter-size signals, not the primary mechanism for
controlling prose length.

The planner should decide whether a chapter contains the right amount of story
content: how many scene contracts it carries, how many distinct set pieces or
confrontations it asks for, how dense the obligations are, and whether the
endpoint/hook can land without packing several full scenes into one entry.

## Implications

- Do not treat writer-side word-count retries as the first fix for overlong
  output.
- If a short chapter has enough content for several full scenes, the planner
  should reduce the chapter movement, split material across chapters, or make
  the chapter visibly larger at the skeleton layer.
- Scene contracts should carry one protagonist goal, one main opposition
  source, one dominant turn/crisis choice, and one immediate
  outcome/consequence.
- Word-count diagnostics remain useful for spotting obvious pacing failures,
  but promotion decisions should look at scope load and semantic quality.
- Scene-contract planning must not hard-fail or retry solely because a
  word-derived count guide says there are too few or too many entries. Those
  findings are advisory unless the operator supplied an explicit planning cap.

## Rationale

The scene-first POC artifact showed chapters overshooting targets by more than
3x. The useful finding was not simply "the writer needs a number." The planner
had asked the writer to draft several complete dramatic scenes inside short
chapter targets. The correct upstream fix is to scope the chapter and scene
contracts to the desired amount of story, then use word counts as one warning
surface among others.
