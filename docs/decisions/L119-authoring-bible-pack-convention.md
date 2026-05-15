---
status: active
date: 2026-05-14
---

# L119: Authoring Bible Pack Convention

## Decision

Character, world, relationship, and voice bible packs should use compact
positive operating models, not long tone essays or contrastive avoidance lists.

This convention applies to manually authored packs now and should become part
of the planning phase later, ideally through an interactive operator step that
shapes the bibles before drafting.

## Convention

Each important character should get a short performance card:

- Operating model: what the character converts pressure into.
- Dialogue model: sentence shape, favored nouns, and interaction posture.
- Interior attention: what the character notices under stress.
- Action texture: how the character moves, handles objects, or occupies space.
- Micro-examples: two or three short lines the model can imitate.

World and voice bibles should follow the same positive shape:

- World pressure: what the system changes characters' options, costs, or status.
- Sensory/technical vocabulary: a few concrete terms tied to consequence.
- Prose behavior: what emotional force should land through.
- Micro-examples: compact lines that show the intended texture.

Avoidance rules are allowed only for repeated observed failures. Prefer
positive replacements over "do not" lists:

- Prefer: "Kael names the practical need instead of the feeling."
- Avoid: "Do not make Kael emotional."
- Prefer: "Orin shows care by stating limits precisely."
- Avoid: "Do not make Orin heroic."

## Context Inclusion

Bible cards are selected by scene need, not by blanket availability:

- Include POV and present-speaker cards.
- Include relationship cards only when the relationship is present or changed.
- Include world-system cards only when the scene invokes that system's pressure,
  vocabulary, cost, status, legality, or available action.
- Include examples for active voices, not the whole cast.
- Treat a semantic miss as possible selector noise when the rule should not
  have been fed to that scene.

## Rationale

The first Rillgate authoring-bible smoke showed useful prose movement from
operational rules alone: Kael became more clipped and pressure-accounting, and
Orin became more procedural and clause-minded. DeepSeek Flash also appears to
benefit from short, concrete instruction surfaces and can be distracted by
large negative/contrastive blocks that keep unwanted concepts active.

The harness should therefore treat bible packs as compact performance cards
with traceable rule IDs and bounded examples. This gives the writer model a
usable imitation target without creating a prompt full of forbidden patterns.

## Implications

- Planning should eventually emit or request these bibles as explicit artifacts
  before drafting, instead of relying only on seed prose or generic character
  profiles.
- Interactive planning should let the operator edit character/world/voice cards
  directly and preserve their stable rule IDs through drafting telemetry.
- Authoring-bible evaluation should continue judging binary adherence to the
  cards; it should not introduce numeric confidence as a control signal.
- Future pack revisions should add short positive examples before adding more
  negative constraints.
