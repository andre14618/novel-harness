---
status: COMPLETED (2026-04-17); superseded by docs/context-engineering.md + next-phase plan below
updated: 2026-04-18
depends-on: docs/salvatore-structural-analysis.md, docs/archive/2026-04/beat-writer-architecture.md
---

# Context Engineering Plan — Fantasy Planner Structural Priors

**Status 2026-04-18:** All 5 priorities shipped in 2026-04-17 via `SALVATORE_PRIORS` in `src/models/roles.ts` and `renderStructuralPriorsForPlanner()`. This plan is retained for historical reference. Current state lives in `docs/context-engineering.md`.

**Next-phase context engineering** (under the 2026-04-18 context-engineering-forward architectural decision):
- Planner Phase-2 enrichment: `subplot_id`, `establishedFact.id`, `requiredPayoffs[]`, `speaker_directives`, `thematic_focus` (see `docs/todo.md` "Current Priorities")
- Unified issue aggregator across checkers
- Reader-information state tracker
- World-expansion budget per chapter

---

## Historical Plan (all items SHIPPED)

Implementation plan for feeding structural intelligence from the Salvatore corpus analysis into the planning-plotter. Each item maps a structural finding to a specific code change + expected impact.

**Scope:** fantasy genre only (per 2026-04-16 genre-focus directive). All changes target `src/agents/planning-plotter/`.

**Current planner prompt state** (from `chapter-outline-system.md`):
- Has three-act structure rules (stasis=death, midpoint reversal, pinch points, try/fail cycles) ✓
- Has scene description rules (no dialogue, focus on what changes) ✓
- Has world-state tracking (established facts, character states, knowledge changes) ✓
- Missing: beat-type guidance, beat sequencing, character-count caps, structural distribution targets

---

## Priority 1 — Beat-kind labeling (highest impact, schema + prompt change)

### Finding
The planner emits beats as free-text `description` strings. The writer doesn't know if a beat is meant to be action, dialogue, interiority, or description until it reads the text and infers. This inference step is where 14B loses constraint capacity.

### Change
Add explicit `kind` field to the scene-beat schema:

```ts
// src/schemas/shared.ts — sceneBeatSchema
kind: z.enum(["action", "dialogue", "interiority", "description"]).default("action")
```

Planner prompt addition:
```
Each scene beat must include a `kind` field:
- "action" — physical conflict, chase, combat, urgent movement
- "dialogue" — conversation-driven, 2+ characters talking
- "interiority" — internal thought, reflection, processing
- "description" — scene-setting, atmosphere, worldbuilding

The writer uses this to calibrate voice register and pacing.
```

### Impact
Writer knows what mode it's in before generating. Reduces mismatches (e.g., writer producing wall-of-dialogue for what was meant to be an interiority beat). Also enables the beat-type distribution constraint (Priority 3) since we can count kinds.

### Effort
~30 min. Schema change + prompt addition + update beat-context.ts to surface kind.

---

## Priority 2 — Active character cap (directly fixes exp #199 Helix bug)

### Finding
Salvatore averages 2-3 active named characters per beat. Probe exp #199 failed when the writer pulled Helix into a scene with 4+ characters. Real fiction uses collective nouns for groups beyond the core cast.

### Change
Planner prompt addition:
```
CRITICAL — character discipline per beat:
- Maximum 3 named characters actively speaking or acting per beat.
- Additional characters in the scene become collective nouns in the
  description: "the extraction team," "the goblin scouts," "the crowd."
- The writer can only reliably juggle 2-3 character voices per beat.
  More than that, and characters blur or get pulled in from off-page.
- If a scene has 5 characters present, the beat should focus on the 2-3
  who matter most for THAT beat's dramatic function. Others can be
  acknowledged ("Helix waited at the extraction point") but not given
  active roles.
```

### Impact
Directly prevents the character-pull-in bug that failed exp #199 chapter 3. Reduces writer constraint load by capping the juggling requirement.

### Effort
~15 min. Prompt-only change.

---

## Priority 3 — Beat-type distribution constraint

### Finding
Salvatore's structural signature: 34% action / 31% dialogue / 22% interiority / 14% description per chapter. Our pipeline's structural deficit: 15.7% dialogue (measured across pre-cutoff novels). Planner currently has no distribution target.

### Change
Planner prompt addition (fantasy-specific):
```
Beat-type distribution for fantasy chapters:
- Target: ~35% action, ~30% dialogue, ~20% interiority, ~15% description
- Every chapter with 2+ characters MUST have at least 2 dialogue beats
- Pure-action chapters (battle scenes) can go to 60%+ action but still
  need at least 1 interiority beat for the POV character's experience
- Pure-dialogue chapters (political negotiations) should have at least
  1 action or description beat to ground the scene physically
```

Depends on Priority 1 (beat-kind labeling) so we can verify the distribution.

### Impact
Closes the dialogue-deficit gap. Forces structural variety in every chapter. Prevents all-action or all-description chapters that read flat.

### Effort
~15 min. Prompt addition. Plus a post-hoc checker (~1 hr) that validates the distribution after the planner emits.

---

## Priority 4 — Cluster-sustain rule

### Finding
Salvatore's action → action self-transition is 55.6%. Dialogue → dialogue is 53.4%. He sustains sequences — fights run 3-5 beats, conversations run 2-4 beats. Our planner tends to fragment: action → interiority → action → description → action. This produces choppy pacing.

### Change
Planner prompt addition:
```
Pacing — sustain sequences, don't fragment them:
- Action sequences should run 3-5 consecutive beats before cutting to
  reflection or dialogue. Don't interrupt a fight with a single
  interiority beat every 2 actions.
- Dialogue exchanges should run 2-4 consecutive beats. Let a
  conversation develop — don't cut away after one exchange.
- Interiority and description are transitional — they lead INTO action
  or dialogue, not away from it. A description beat followed by another
  description beat is stasis.
```

### Impact
Produces chapter outlines that feel like published fiction pacing — sustained dramatic sequences with clean transitions between modes.

### Effort
~10 min. Prompt addition only.

---

## Priority 5 — Chapter opener/closer patterns

### Finding
Salvatore opens chapters with description (43%) or action (26%). Closes with action (39%) or interiority (30%). Only 6% close with description — chapters don't end with scene-painting.

### Change
Planner prompt addition:
```
Chapter structure:
- Open with a scene-setting description beat (preferred) or an in-medias-
  res action beat. Do NOT open with interiority unless the POV character
  is alone and the chapter is specifically about their mental state.
- Close with an action beat (cliffhanger / resolution) or an interiority
  beat (reflection / decision). NEVER close with pure description — the
  reader needs momentum or emotional resonance at chapter's end, not
  atmosphere.
```

### Impact
Produces better-shaped chapters. Aesthetic improvement, not adherence-critical.

### Effort
~10 min. Prompt addition only.

---

## Priority 6 — Scene-size guidance

### Finding
Salvatore's scenes are 3-8 beats (mean 5.5). Current planner guideline is "2-4 scenes per chapter" but doesn't specify beats-per-scene. The planner sometimes produces 2-beat scenes (too sparse for dramatic development) or 12-beat scenes (too long for a single location/timeframe).

### Change
Planner prompt update — replace "2-4 scenes per chapter" with:
```
Scene structure:
- Each scene is one continuous location + timeframe. A scene break
  occurs when the location changes, significant time passes, or the
  POV shifts.
- Target 3-8 beats per scene. Under 3 = too sparse for dramatic
  development (combine with adjacent scene). Over 8 = too long
  for one location/timeframe (split at the natural pivot point).
- A 10-chapter fantasy novel typically has 2-4 scenes per chapter
  for a total of ~50-120 beats across the novel.
```

### Impact
Prevents degenerate scene shapes. Gives the planner a concrete target for scene granularity.

### Effort
~10 min. Prompt update.

---

## Priority 7 — Per-beat drives (deferred, evaluate after P1-P6)

### Finding
User proposal (2026-04-16): planner should author one-line situational drives per character per beat, rather than the writer translating stable character-sheet traits into beat-specific actions.

### Change
Schema: add `characterDrives` field to `sceneBeatSchema`:
```ts
characterDrives: z.record(z.string()).optional()
// e.g., { "Senna": "absorb the spell before it kills her", "Reseth": "stall until the ritual completes" }
```

Planner prompt: "For each beat, write a one-line drive for each named character — what they specifically want from THIS beat, not their general goal."

### Impact
Reduces writer translation burden. Planner has full-chapter context so it can author better per-beat drives than the writer can infer from stable traits.

### Effort
~45 min. Schema change + prompt addition + beat-context.ts update to surface drives.

### Gate
Only implement if P1-P6 don't bring retry rate below 20%. Currently deferred per `docs/archive/2026-04/beat-writer-architecture.md`.

---

## Implementation order

```
P1 (beat-kind labeling)     ← 30 min, unblocks P3
P2 (active character cap)   ← 15 min, independent
P3 (distribution constraint) ← 15 min, depends on P1
P4 (cluster-sustain)        ← 10 min, independent
P5 (opener/closer)          ← 10 min, independent
P6 (scene-size)             ← 10 min, independent
                              ─────
                              ~90 min total for P1-P6
P7 (per-beat drives)        ← 45 min, deferred
```

P1 and P2 are the highest-leverage changes. P1 gives the writer explicit mode guidance; P2 prevents character-count overload. Together they address the two primary failure modes observed in probes.

P3-P6 are prompt additions that shape the overall chapter outline toward published-fiction structural norms. Individually small; collectively they shift the planning from "free-form creative" to "structurally-informed creative."

---

## Validation plan

After P1-P6 are implemented:

1. **Re-run the 3-chapter `fantasy-echo-mage` probe** (same seed as exp #199/#200/#201). Compare retry counts + chapter approval rates against the exp #201 baseline (5 total attempts, all 3 chapters approved).

2. **Structural comparison**: run `scripts/analysis/beat-sequence-analysis.py` on the generated novel's beat data (extract from chapter outlines + approved prose). Compare transition matrix, beat-type distribution, opener/closer patterns against the Salvatore corpus baseline.

3. **Check the ongoing sweep**: when the 17-seed sweep completes, analyze retry rates for LoRA-routed seeds vs DeepSeek-routed seeds. If LoRA-routed seeds have >20% retry rate after P1-P6, implement P7.

---

## Files touched

| File | Change |
|---|---|
| `src/schemas/shared.ts` | Add `kind` enum to `sceneBeatSchema` |
| `src/agents/planning-plotter/chapter-outline-system.md` | P1-P6 prompt additions |
| `src/agents/planning-plotter/schema.ts` | Update `chapterOutlineSchema` if needed |
| `src/agents/writer/beat-context.ts` | Surface `kind` in beat spec (P1) |
| `src/phases/drafting.ts` | Pass `kind` to adherence checker for kind-aware checking (optional) |

---

## Pointers

- Structural data: `docs/salvatore-structural-analysis.md`
- Beat-writer constraint analysis: `docs/archive/2026-04/beat-writer-architecture.md`
- Current planner prompt: `src/agents/planning-plotter/chapter-outline-system.md`
- Current planner schema: `src/agents/planning-plotter/schema.ts`
- Current planner context builder: `src/agents/planning-plotter/context.ts`
- Sweep results (in-flight): `ssh novel-harness-lxc "for f in /tmp/sweep-*.log; do ..."`
