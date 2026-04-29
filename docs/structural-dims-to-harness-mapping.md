# Structural dims → harness prompt mapping

## Overview

This document maps the five structural dimensions extracted from R.A. Salvatore's *The Crystal Shard* (corpus structural-decomposition R7 charter) to concrete injection sites in the harness's planning and drafting pipeline. Its purpose is to turn calibrated measurements into runnable planner constraints — someone reading this doc can locate the exact file, know what text to add or which schema field to require, and open a ticket. Dims are ordered by readiness: ship first → hold → investigate → park.

---

## Per-dim mapping

### 1. character-arcs (CELL PASS — hard constraint candidate)

**Calibration verdict:** F1=1.00 character identification, arc_resolution agreement 67%. Approved for hard constraint per conclusions doc ("Crystal Shard's character-arcs distribution is shippable as a planner constraint right now").

- **Injection site**: `src/agents/character-agent/context.ts`, end of `buildContext()` — the final `ctx +=` line (line 30). This is the per-character profile call that runs in the concept phase before any planning agent sees the characters.

- **Concrete prompt edit**: After the existing "Develop these character sketches into full profiles" line, append:

  ```
  Character arc structure (required for every named character):
  - lie: the false belief the character holds at the story's start
  - truth: what they must learn or embody by the end
  - want: their external goal (what they consciously pursue)
  - need: their internal deficiency (what the story forces them to confront)
  - arc_resolution: one of — fulfilled (want and need resolved), partial (one resolved), tragic_inversion (lie wins), static (character unchanged by design for antagonists/minor roles)

  Crystal Shard distribution reference (6 chars): fulfilled ×2, partial ×3, tragic_inversion ×1. A novel with 5-8 named characters should target at least 1 tragic_inversion or disillusionment arc for dramatic contrast and at most 50% fulfilled arcs — avoid a cast where everyone succeeds.
  ```

- **Schema addition**: Add `lie`, `truth`, `want`, `need`, `arc_resolution` to `characterProfileSchema` in `src/agents/character-agent/schema.ts` as optional strings (so legacy rows round-trip). `arc_resolution` should be a `z.enum(["fulfilled", "partial", "tragic_inversion", "static"])`. The character-agent system prompt at `character-profile-system.md` already has `internalConflict` and `goals`; the LTWN fields replace ambiguity there with structured vocabulary.

- **Data shape**: Per-character struct (lie, truth, want, need, arc_resolution), one entry per named character. Derive the arc_resolution distribution target from `character-arcs.20260429T190338.json` — 6 characters: Drizzt (fulfilled), Bruenor (partial), Wulfgar (fulfilled), Regis (partial), Kessell (tragic_inversion), Catti-brie (partial).

- **Constraint type**: **Hard** — schema field required, arc_resolution validated against the enum. The planner (planning-plotter context.ts, line 55) renders character profiles into the planner context, so LTWN fields automatically flow to the chapter skeleton and beat expansion passes without additional wiring. No planner prompt change needed once the schema and character-agent prompt carry the fields.

- **Implementation note**: The `buildContext` in `planning-plotter/context.ts` (lines 49-64) passes character profiles through verbatim. Adding LTWN to the schema means it gets rendered in `CHARACTER PROFILES:` automatically. Verify the schema addition doesn't break the existing `isValidCharacterName` refine on the `name` field.

---

### 2. mice (CELL MARGINAL — soft prior pending C.4 sharpening)

**Calibration verdict:** F1=0.776, P=0.731, just below the 0.78 PASS gate. Hold ship; iterate on mice prompt close-criterion sharpening (C.4) first.

- **Injection site**: `src/agents/planning-beats/beat-expansion-system.md` (the Phase-2 per-chapter beat expansion system prompt). The beat's `kind` field already exists in `sceneBeatSchema`; the MICE label is a parallel annotation.

- **Concrete prompt edit**: Add a new optional field `mice_thread` to each beat in the system prompt's JSON example, with a soft-prior instruction block (not a hard-schema requirement yet):

  ```
  ## MICE thread annotation (soft prior — include when unambiguous)
  Each beat may carry a "mice_thread" field: { "primary": "M|I|C|E", "opens": true|false, "closes": true|false }
  - M (Milieu) — character enters or leaves a location or setting
  - I (Inquiry) — a question is posed and pursued (mystery, investigation, "why did X happen")
  - C (Character) — a character changes their identity, belief, or role
  - E (Event) — an external force disrupts the world (battle, catastrophe, political shift)
  Omit "mice_thread" when the beat's primary function is transitional or multi-threaded.
  Reference distribution from Crystal Shard (139 scenes): I ~38%, E ~28%, C ~22%, M ~12%.
  ```

- **Schema addition**: Add `miceThread: z.object({ primary: z.enum(["M","I","C","E"]), opens: z.boolean(), closes: z.boolean() }).optional()` to `sceneBeatSchema` in `src/schemas/shared.ts` (wherever `sceneBeatSchema` is defined). Optional field so existing rows round-trip.

- **Data shape**: Per-beat tag (primary: M|I|C|E, opens: bool, closes: bool). The chapter-level distribution of opens/closes is the constraint — not per-beat enforcement. A chapter should contain MICE thread opens that are closed within 2-5 beats (Sanderson's satisfying-loops heuristic).

- **Constraint type**: **Soft prior** — included in the system prompt as a target distribution and annotated per-beat, but no hard schema validation gate. Do not gate chapter approval on MICE compliance until C.4 sharpening brings P ≥ 0.78.

- **Implementation note**: The `planning-beats/schema.ts` imports from `../../schemas/shared`, so the addition to `sceneBeatSchema` propagates automatically. The beat-writer context (`src/agents/writer/beat-context.ts`) passes beat descriptions to the writer but not `kind` annotations — `mice_thread` would remain a planner-only field and not flow to the writer, which is correct (MICE is a structural constraint on the plan, not a prose instruction).

---

### 3. value-charge (NULL-GOLD — pending retest expansion)

**Calibration verdict:** NULL-GOLD. The underlying binary polarity signal is strong (F1=0.94 Flash×Pro, 0.96 Flash×Flash), but the per-scene `lifeValue` agreement is lower (56% cross-model, 73% self-model). The NULL-GOLD verdict came from a small retest pool (n=5) tripping the 15% disagreement threshold — conclusions doc characterizes this as "sample-size noise, not real." Likely a CELL PASS once retest pool reaches n ≥ 20.

- **Injection site**: `src/agents/planning-beats/beat-expansion-system.md` — same file as mice, appended as a separate section.

- **Concrete prompt edit** (to add once retest confirms CELL PASS):

  ```
  ## Value-charge per beat (soft prior)
  Each beat optionally carries a "value_charge" field:
  { "life_value": "<the human value at stake — e.g. life/death, freedom/slavery, love/hatred>",
    "charge_start": "positive | negative | neutral",
    "charge_end": "positive | negative | neutral" }
  A value-shift (charge_start ≠ charge_end) is the unit of dramatic tension. Crystal Shard averages ~1.4 value-shifts per scene over 139 scenes. A chapter without a polarity shift in 4+ consecutive beats reads as static.
  ```

- **Schema addition**: Add `valueCharge: z.object({ lifeValue: z.string(), chargeStart: z.enum(["positive","negative","neutral"]), chargeEnd: z.enum(["positive","negative","neutral"]) }).optional()` to `sceneBeatSchema`. Optional — do not make it required until CELL PASS confirmed.

- **Data shape**: Per-beat struct (life_value label + start/end polarity). The constraint is distributional: a chapter's beat sequence should alternate polarity, not sustain one charge for more than 4 beats.

- **Constraint type**: **Soft prior now, upgrade to hard after n ≥ 20 retest.** The polarity-shift cadence is a planning-beats instruction only; the writer doesn't need to see the schema field.

- **Implementation note**: The life_value taxonomy is open-text — the planner picks the value, not the harness. The beat-expansion prompt should give 4-6 canonical examples drawn from the Crystal Shard data (`value-charge.20260429T183957.jsonl`) so the planner anchors to recognizable categories: life/death, honor/dishonor, freedom/slavery, love/hatred, loyalty/betrayal.

---

### 4. mckee-gap (NOT YET CALIBRATED — TBD)

**Calibration verdict:** Extraction in flight as of 2026-04-29. No verdict yet.

- **Injection site (anticipated)**: `src/agents/planning-beats/beat-expansion-system.md`. McKee-gap is per-beat (expectation vs. outcome divergence), making beat expansion the natural site — same as mice and value-charge.

- **Concrete prompt edit (draft — hold until calibration completes)**:

  ```
  ## McKee gap per beat (structural tension)
  Each beat optionally: "mckee_gap": { "gap_size": "none|small|large", "gap_type": "yes_but|no_and|yes" }
  A beat with gap_size "large" means the POV character's expectation was sharply violated — the scene outcome diverged from their plan. Crystal Shard target: >60% of beats carry a gap; pure "yes" beats (expectation met, no gap) should not run more than 2 consecutive.
  ```

- **Data shape**: Per-beat struct (gap_size enum + gap_type enum). Expectation is defined by the POV character at beat start; outcome is what actually happens.

- **Constraint type**: Hold until calibration. Based on the other dims, anticipate CELL MARGINAL or CELL PASS at the binary gap_size level, with lower agreement on gap_type.

- **Implementation note**: McKee-gap is structurally the simplest field to add to `sceneBeatSchema` because it is binary-ish (gap or no gap). Ship at soft prior first; only make hard once F1 ≥ 0.85 confirmed.

---

### 5. promise (NULL-GOLD-LIKE — parked until ensemble gold)

**Calibration verdict:** Jaccard 0.326 between two consecutive Pro judge runs on the same prompts (C.2 result). The dim is NULL-GOLD-LIKE — the gold itself is unstable. No extractor can reliably beat F1 = 0.491, which is the gold-stability ceiling. Parked until ensemble gold (N ≥ 3 Pro runs intersection, or Sonnet Tier 3 as anchor) lands.

- **Injection site (when ready)**: Two sites — `src/agents/plotter/story-structure-system.md` (for arc-level promise tracking) and `src/agents/planning-beats/beat-expansion-system.md` (for Chekhov's-gun setup-payoff bridges within chapters). The per-beat `requiredPayoffs` field (already in `sceneBeatSchema`) is structurally the right shape for intra-chapter promises. Cross-chapter promises need a new field in the chapter skeleton or the planner context.

- **Concrete prompt edit (draft — do not ship yet)**: The `requiredPayoffs` mechanism already in planning-beats (fact_id + payoff_beat) is the right sub-schema for intra-chapter setup-payoffs. For cross-chapter arc-level promises, the plotter's `story-structure-system.md` would add a `"promisedPayoffs"` field on each act: a list of `{ promise: string, opens_at_chapter: int, closes_by_chapter: int }`. The `planning-plotter/chapter-outline-system.md` would then receive that act's promises as constraints when generating its chapter skeletons.

- **Data shape**: Two levels — (a) intra-chapter: existing `requiredPayoffs` on beats covers this; (b) cross-chapter: arc-level list of open/close tuples, one per named promise. Crystal Shard's Sonnet-extracted list (`promises.20260429T215322.sonnet.json`, 38 promises) is the reference shape.

- **Constraint type**: **Parked** — do not ship in any form (hard or soft) until ensemble gold achieves F1 ≥ 0.70 vs. a stable gold anchor. The intra-chapter `requiredPayoffs` mechanism is already live and does not need this gating — it ships independently.

- **Implementation note**: Sonnet's 38-promise list (C.1 result) is the best current ground truth. The 3 open promises (Errtu's vow, Dendybar conspiracy, drow-house vendetta) are series hooks, not failures — a promise registry for a standalone novel should focus on satisfied and unsatisfied promises within the book, not cross-book arcs.

---

## Cross-cutting integration

**Where one constraint subsumes another**: The `requiredPayoffs` field in `sceneBeatSchema` already handles intra-chapter setup-payoffs (a subset of what promise tracks at book scale). Do not add a parallel promise mechanism at the beat level — use `requiredPayoffs` for that scope.

**LTWN fields in character-agent flow to planner automatically**: Because `planning-plotter/context.ts` renders the full character profile section (lines 49-64), any field added to `characterProfileSchema` and populated by the character-agent will appear in the planner's character section without additional context changes.

**Order of integration (by readiness):**

1. **character-arcs** — add LTWN fields to `character-agent/schema.ts` + update `character-profile-system.md` + update `character-agent/context.ts` append. One commit. No planner changes needed.
2. **mice** (after C.4 sharpening) — add `miceThread` optional field to `sceneBeatSchema` in `src/schemas/shared.ts` + add soft-prior block to `planning-beats/beat-expansion-system.md`.
3. **value-charge** (after n ≥ 20 retest confirms CELL PASS) — add `valueCharge` optional field to `sceneBeatSchema` + add soft-prior block to `planning-beats/beat-expansion-system.md`.
4. **mckee-gap** — after calibration result arrives, evaluate against CELL PASS gate. Add to beat schema if F1 ≥ 0.70.
5. **promise** — park until ensemble gold exists.

**Implementation milestones:**

- **Week 1**: Land character-arcs (LTWN schema + character-agent prompt update). Run one end-to-end novel, verify LTWN fields appear in generated character profiles and flow through to planner context without truncation.
- **Week 2**: Run C.4 mice prompt iteration (Sonnet subagent drafts sharper close-criterion examples). If P ≥ 0.78, land mice soft prior. Simultaneously re-run value-charge retest with n ≥ 20 to retire the NULL-GOLD verdict.

---

## Open questions

- **LTWN arc_resolution distribution target**: The Crystal Shard reference is 6 characters, small sample. Should the planner constraint be a ratio (≤50% fulfilled) or a minimum count (≥1 tragic_inversion)? The ratio is more flexible across novel lengths.
- **Does LTWN need to flow to the beat-writer?** Currently character profiles render in the planner context but only `speechPattern`, `goals`, `fears`, `internalConflict` reach beat-writer context (`src/agents/writer/beat-context.ts`). Adding `lie`/`truth` to beat-writer context would let the writer encode arc progression in prose — worth evaluating but not load-bearing for the first ship.
- **Mice chapter-level target vs. per-beat field**: The calibrated distribution (I ~38%, E ~28%, C ~22%, M ~12%) is across scenes, not chapters. A per-chapter MICE distribution constraint in the planning-beats prompt is achievable but untested — start with per-beat annotation and aggregate the distribution post-hoc before adding per-chapter targets.
- **Value-charge life_value taxonomy**: Should the harness constrain the planner to a closed set of life_values (e.g. life, freedom, love, honor, loyalty, identity) or leave it open-text? Closed set is easier to measure against corpus distributions; open-text is more expressive. Start open-text with examples, evaluate after 3-5 novels.
