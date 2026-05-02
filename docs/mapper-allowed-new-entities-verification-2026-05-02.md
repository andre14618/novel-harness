# Mapper allowedNewEntities Verification — L26 (2026-05-02)

**Experiment:** #348 | **phase_eval_runs.id:** 120 | **Commit:** 125e848  
**Verdict:** FAIL-DUP-FPS  
**Cost:** $0.035

## Setup

- 3 seeds × 3 chapters each (planner-isolated, local only, no LXC)
- Seeds: fantasy-debt, fantasy-system-heretic, fantasy-inscription
- Prompt variant: default (production prompt, via `PLANNING_STATE_MAPPER_PROMPT_OVERRIDE`)
- Analysis: per-beat `allowedNewEntities` vs `beat.characters` vs `chapter.charactersPresent`

## Per-Seed Results

| Seed | Beats | Non-empty beats | Rate | Total entities | Beat dup FPs | Chapter dup FPs |
|---|---|---|---|---|---|---|
| fantasy-debt | 45 | 1 | 2% | 1 | 0 | 0 |
| fantasy-system-heretic | 58 | 3 | 5% | 3 | 0 | 0 |
| fantasy-inscription | 45 | 2 | 4% | 3 | 2 | 1 |
| **Aggregate** | **148** | **6** | **4.1%** | **7** | **2** | **1** |

## All Entities (Full List)

| Seed | Ch | Beat | Entity | Classification | Beat DupFP | Ch DupFP |
|---|---|---|---|---|---|---|
| fantasy-debt | 3 | 8 | `collective crown debt` | prop/abstract | No | No |
| fantasy-system-heretic | 2 | 7 | `record hall warding` | location | No | No |
| fantasy-system-heretic | 2 | 20 | `Arbiter's Spire holding cell` | location | No | No |
| fantasy-system-heretic | 3 | 13 | `Free Scribe` | walk-on | No | No |
| fantasy-inscription | 3 | 1 | `Sera` | suspicious proper noun | **YES** | No |
| fantasy-inscription | 3 | 10 | `Master Inquisitor Orvath` | story character | **YES** | **YES** |
| fantasy-inscription | 3 | 10 | `inquisitors` | walk-on (generic) | No | No |

## Analysis by Criterion

### 1. Non-empty rate (mapper actively uses the field)

4.1% — 6 of 148 beats have at least one `allowedNewEntities` entry. This is very sparse but **correct behavior**: most beats don't introduce genuinely-new named entities; the writer is expected to use established world-bible locations, known characters, and previously-named entities for the majority of beats.

Conclusion: **The mapper does use the field, but only rarely.** This is appropriate — the field is not meant to be emitted on every beat.

### 2. Beat-level duplication FPs

2 FPs in fantasy-inscription ch3:

**FP 1 (ch3 beat 1): `Sera`**
- Beat characters: `['Calla Vren', 'Davan', 'Sera']`
- `allowedNewEntities`: `['Sera']`
- Root cause: Sera is a new character introduced in this beat. The planning-beats expander added her to `beat.characters`. The mapper then also listed her in `allowedNewEntities` because she is new to the chapter. This is a coordination failure between the two planner phases — the mapper should not re-sanction a character that the beat expander already placed in `beat.characters`.

**FP 2 (ch3 beat 10): `Master Inquisitor Orvath`**
- Beat characters: `['Calla Vren', 'Master Inquisitor Orvath']`
- Chapter `charactersPresent`: `['Calla Vren', 'Davan', 'Master Inquisitor Orvath']`
- `allowedNewEntities`: `['Master Inquisitor Orvath', 'inquisitors']`
- Root cause: Orvath is a main story character explicitly listed in `charactersPresent`. The mapper context includes "Characters present: Calla Vren, Davan, Master Inquisitor Orvath" but the mapper still emitted him as a new entity. This is an LLM instruction-following failure — the mapper ignored the character presence information.

### 3. Qualitative sanity-check

Of the 5 non-FP entities:
- `collective crown debt` — abstract concept/MacGuffin introduced in the scene. Correct.
- `record hall warding` — minor in-world location, not in world-bible. Correct.
- `Arbiter's Spire holding cell` — sub-location for a scene. Correct.
- `Free Scribe` — walk-on faction/character. Correct.
- `inquisitors` — generic plural walk-on (same beat as the Orvath FP). Correct.

**Qualitative verdict: non-FP entities look right.** When the mapper uses the field correctly, it produces valid walk-ons, props, and minor locations.

## Root Cause Summary

Two distinct failure modes:

1. **Phase-coordination gap**: The planning-beats expander adds a newly-introduced character to `beat.characters`. The mapper then sees this character in the beat description as "new" (since they weren't in prior chapters) and re-emits them in `allowedNewEntities`. Fix: mapper prompt must exclude any character already in `beat.characters` from `allowedNewEntities`.

2. **Context non-attendance on `charactersPresent`**: The mapper receives `Characters present: ...` but still emits an established story character in `allowedNewEntities`. Fix: mapper prompt must explicitly exclude characters in `charactersPresent`.

## Conclusion

The mapper `allowedNewEntities` field is **partially functioning**: it is actively used (4.1% non-empty), qualitatively correct for non-FP entries, and the concept is sound. However, 2 of 7 emitted entities (29%) are duplication FPs — the mapper re-emitted characters already established in the beat or chapter.

**Action:** Open L32 to fix the mapper prompt. The fix is small — add two exclusion rules to the Placement Guidance section:
1. Do not include any character already present in `beat.characters` in `allowedNewEntities`.
2. Do not include any character already in the chapter's `charactersPresent` list in `allowedNewEntities`.

No runtime behavior should change in L32 — it is a prompt clarification, not a structural change. After landing, re-run this probe to verify the FP rate drops to 0.

## Impact on halluc-ungrounded

The dup FPs are benign for the halluc-ungrounded checker: including an established character in `allowedNewEntities` adds a redundant entry to the grounded surface (character already grounded via `character_roster`), not a false positive in hallucination detection. However, it creates semantic confusion in the mapper output and could mislead future tooling that uses `allowedNewEntities` for other purposes (e.g., a writer-facing "new entities this beat" display).
