---
status: active
date: 2026-05-15
---

# L120: Writer Cache Prefix Context Boundary

## Decision

Writer prompt cache engineering may reorder or split context to create an
exact byte-stable prefix, but it must not add irrelevant context only because
the added bytes would cache well.

The cache-stable prefix must be made from writer-useful material already needed
by the active arm, plus stable instruction text for that arm. Volatile scene
task, contract, obligation, character, reference, reader-state, and setting
context belongs after the cache boundary unless evidence shows a stable global
rule improves writing or harness behavior.

For drafting briefs, the cache boundary is the first volatile scene marker:
`WRITER DRAFTING BRIEF`. Stable-prefix changes should be guarded by exact-byte
tests and trace telemetry, not inferred from provider cache-token reports alone.

## Active Shape

`drafting-brief-authoring-bible-v1` currently orders context as:

1. Stable system prompt outside the user prompt.
2. `SCENE EXECUTION FLOOR`, stable for the writer arm/mode.
3. `AUTHORING BIBLE STABLE PRELUDE`, using selected baseline story, sensory,
   and voice rules with stable selector reasons.
4. `WRITER DRAFTING BRIEF`, the first volatile scene boundary.
5. Scene budget/load control, scene contract, scene-local authoring-bible slice,
   obligations, anchors, character context, references, reader state, and setting.

The authoring-bible stable prelude is a split of already-selected rules, not a
cache-padding packet. Scene-local character, relationship, and world-system
rules remain local.

## Evidence Requirements

Treat provider-reported cached tokens as useful telemetry, not as the governing
proof. A cache-layout change needs:

- Exact-byte stable-prefix test coverage across at least two different scene
  prompts.
- Writer-context telemetry for `cacheStablePrefix` chars/hash/boundary.
- A drafting smoke or replay showing normal readiness/checker behavior.
- A quality signal when creative context changes are involved.

If a future change increases stable prefix size by adding more context, the
promotion argument must show prose or harness value. Cache savings alone are
not enough.

## Rationale

DeepSeek prefix caching rewards byte-identical prompt starts, but a novel
harness fails if cost optimization feeds irrelevant cast, world, relationship,
or rule context into scenes. Stable context should be moved earlier only when
the writer already needs it. Local scene context is allowed to be less
cache-friendly because it is how the writer satisfies the actual scene.

## Implications

- Do not blanket-include all bibles, cards, world systems, or character rules
  for cache stability.
- Do not move scene-local facts above the volatile boundary.
- Prefer exact-prefix telemetry over manual prompt diffing.
- Larger stable prefixes are allowed only when they preserve local context
  discipline and improve more than provider cache metrics.
