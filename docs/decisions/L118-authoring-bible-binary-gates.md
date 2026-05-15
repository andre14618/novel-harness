---
status: active
date: 2026-05-14
---

# L118: Authoring Bible Binary Gates

## Decision

Authoring-bible evidence uses stable story, world, character, relationship, and
voice rule IDs plus binary semantic gates. It does not use model-generated
numeric confidence as a control signal.

The first implementation is default-off via `authoringBibleMode: "v1"`. It
compiles compact rule slices from existing Story Spine, World Bible, and
Character Profile surfaces plus optional modular authoring-bible packs selected
by `authoringBiblePackIds`, renders them into production writer context, and
records rule IDs and deterministic selector reasons in writer-context telemetry.
Advisory replay review derives
`pass`, `miss`, `uncertain`, or `not_applicable` from binary gates:
applicability, prose evidence, rule satisfaction, contradiction, and evidence
specificity.

## Rationale

Recent Rillgate loops proved scene-level coherence mechanics but risked
microfixing individual scenes. Better novel quality needs upstream story,
character, relationship, and voice contracts that can shape drafting and
produce aggregate evidence.

Free-form confidence numbers from an LLM judge are not calibrated enough for
this harness. Binary gates are easier to audit, aggregate, and route: uncertain
rows stay telemetry, while complete misses can point to planning, character
bible, voice bible, or prose as the likely repair layer.

## Evidence

- `src/harness/authoring-bible.ts` adds the packet/slice compiler, renderer,
  telemetry summary, modular pack merge, and binary verdict derivation.
- `src/harness/authoring-bible-packs.ts` registers `rillgate-contrast-v1`,
  a deep pack with guild-law world pressure, Kael/Tessa/Orin/Varn
  character rules, relationship posture rules, and hardboiled ledger-fantasy
  voice guidance.
- Writer context and drafting-brief telemetry now carry authoring-bible
  surface counts, rule IDs, and rule-selection reasons when
  `authoringBibleMode="v1"`, including separate world-authoring-bible
  counts/IDs.
- `scripts/evals/authoring-bible-review.ts` runs advisory binary-gated replay
  review over persisted drafts and can evaluate seed-selected or explicit
  `--pack-id` packs; dry-run produces uncertain rows without model confidence.
  It also writes `authoring-bible-scene-review.md`, which shows each scene's
  selected bible slice, selector reason/hints, omitted packet rules, and prose
  source/excerpt.
- `scripts/test-drafting-isolated.ts` adds the
  `drafting-brief-authoring-bible-v1` production-path arm for bounded evidence
  and activates `rillgate-contrast-v1` on that arm.

## Implications

- Authoring-bible checks are advisory and default-off until a cohort shows
  better story/character/voice adherence without creating noisy repair loops.
- Future repair routing should act only on `miss` rows with specific evidence;
  `uncertain` remains nonblocking telemetry.
- Character, world, relationship, and voice bibles should improve by rule-ID
  evidence, not by one-off prose patching.
