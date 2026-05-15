---
status: active
date: 2026-05-15
---

# Authoring Bible Selector Evidence

## Goal

Make authoring-bible packs usable on the production drafting path with
traceable selector telemetry, review artifacts, and a planning-card shape that
can later be driven interactively.

## Implementation

- `AuthoringBibleSlice` now carries `ruleSelections`: deterministic selection
  records with rule ID, kind, reason, matched hints, and character names.
- Writer-context and drafting-brief telemetry now persist those selection
  records alongside authoring-bible rule IDs and counts.
- `authoring-bible-review` now writes `authoring-bible-scene-review.md`,
  showing each scene's selected rules, selector reasons/hints, omitted packet
  rules, prose source, and excerpt.
- `AuthoringBiblePlanningArtifact` defines typed story/world/character/
  relationship/voice cards and converts them into runtime `AuthoringBiblePack`
  rules instead of a parallel prompt format.
- Selector fixes:
  - shared surnames no longer match relationship cards by accident
    (`Kael Rusk` no longer selects `Mira Rusk`);
  - honorific names still match by operative name (`Lady Varn` can match
    `Varn`);
  - faction/world-state wording now asks for concrete leverage/state pressure,
    not only completed mission outcomes.

## Evidence Runs

- Ch1 fixed-selector smoke:
  `rillgate-authoring-bible-selector-fixed-1778805393-drafting-brief-authoring-bible-v1`
  drafted 5 scenes at 3142/3100 words, Plan-Assist 0, checker readiness 0.
- Initial ch1 review on the fixed selector:
  `output/authoring-bible-review/rillgate-authoring-bible-selector-fixed-1778805393-ch1-live`
  produced 104/106 pass. The two misses were the old faction-world-state
  wording, not relationship selector noise.
- Ch1 re-review after faction wording fix:
  `output/authoring-bible-review/rillgate-authoring-bible-selector-fixed-1778805393-ch1-live-post-rule-text`
  produced 106/106 pass.
- Tessa/Varn window:
  `rillgate-authoring-bible-tessa-varn-1778805669-drafting-brief-authoring-bible-v1`
  drafted chapters 2-3 at 7162/6200 words, Plan-Assist 0, checker readiness 0.
  The bounded window surfaced one low planning-context readiness row for
  missing reader-info state on chapter 2 scene 2; this is a window-context
  issue, not an authoring-bible failure.
- Tessa/Varn live authoring-bible review:
  `output/authoring-bible-review/rillgate-authoring-bible-tessa-varn-1778805669-ch2-3-live`
  produced 254/254 pass. Selector telemetry shows Varn cards only in Varn
  scenes, Tessa cards only in Tessa scenes, and relationship packs only when
  the pair is present.

## Interpretation

The authoring-bible path is now functional enough for further production-path
drafting evidence. The useful next question is prose/story quality under a
larger coherent draft, not whether the pack can be selected, traced, reviewed,
or converted from planning cards.
