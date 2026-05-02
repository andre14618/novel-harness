# Mapper allowedNewEntities Prompt Fix Verification — L32 (2026-05-02)

**Experiment:** #353 | **phase_eval_runs.id:** 121 | **Commit:** e8f4045  
**Verdict:** PASS (dup-FP target achieved)  
**Cost:** ~$0.035

## Summary

L32 fixed the mapper prompt to exclude established characters from `allowedNewEntities`. Re-running the L26 probe confirmed BeatDupFPs dropped from 2 to 0, ChDupFPs dropped from 1 to 0. Non-empty rate held at 4.8% (within the 4-6% expected range).

## Before / After Table

| Metric | L26 (before fix) | L32 (after fix) | Delta |
|---|---|---|---|
| Seeds | 3 | 3 | — |
| Total beats | 148 | 124 | -24 (model variance) |
| Beats with entries | 6 | 6 | 0 |
| Non-empty rate | 4.1% | 4.8% | +0.7% |
| Total entities | 7 | 7 | 0 |
| **Beat dup FPs** | **2** | **0** | **-2** |
| **Chapter dup FPs** | **1** | **0** | **-1** |

## Per-Seed Results

### L26 (baseline)

| Seed | Beats | Non-empty | Rate | Entities | BeatDupFPs | ChDupFPs |
|---|---|---|---|---|---|---|
| fantasy-debt | 45 | 1 | 2% | 1 | 0 | 0 |
| fantasy-system-heretic | 58 | 3 | 5% | 3 | 0 | 0 |
| fantasy-inscription | 45 | 2 | 4% | 3 | **2** | **1** |
| **Aggregate** | **148** | **6** | **4.1%** | **7** | **2** | **1** |

### L32 (after fix)

| Seed | Beats | Non-empty | Rate | Entities | BeatDupFPs | ChDupFPs |
|---|---|---|---|---|---|---|
| fantasy-debt | 43 | 0 | 0% | 0 | 0 | 0 |
| fantasy-system-heretic | 45 | 3 | 7% | 3 | 0 | 0 |
| fantasy-inscription | 36 | 3 | 8% | 4 | **0** | **0** |
| **Aggregate** | **124** | **6** | **4.8%** | **7** | **0** | **0** |

## FP Elimination Detail

### FP 1: `Sera` (fantasy-inscription ch3 beat 1) — ELIMINATED
- **L26:** Beat characters included `Sera`; mapper also listed her in `allowedNewEntities`. Root cause: phase-coordination gap (beat expander added her to `beat.characters`, mapper re-sanctioned her).
- **L32:** fantasy-inscription ch3 emits 0 entities total. Sera correctly excluded.

### FP 2: `Master Inquisitor Orvath` (fantasy-inscription ch3 beat 10) — ELIMINATED
- **L26:** Orvath in `charactersPresent`; mapper still emitted him as new entity. Root cause: instruction-following failure.
- **L32:** fantasy-inscription ch3 emits 0 entities total. Orvath correctly excluded.

## Prompt Change

**File:** `src/agents/planning-state-mapper/state-mapper-system.md` (+ `scripts/phase-eval/variants/planning-state-mapper/default.md`)

**Section:** Placement Guidance (added after the `allowedNewEntities` use-case bullet)

**Added text:**
> `` `allowedNewEntities` is for entities genuinely NEW to the chapter — absent from both the current beat's character list and the chapter's `charactersPresent` list. Treat any character already in `beat.characters` or `chapter.charactersPresent` as established (already grounded); their inclusion in `allowedNewEntities` is redundant and should be omitted. ``

**Framing note:** Positive framing (describes what to do, not what to avoid) per `feedback_priming_suppression_ab` memory. The "do not" at the end is a hard prohibition on redundant output, not a prohibition on character choice — acceptable per the lesson.

## Qualitative Health

L32 entities (all 7 across both seeds that emitted any):

| Seed | Ch | Beat | Entity | Classification |
|---|---|---|---|---|
| fantasy-system-heretic | 2 | 7 | `Unbound class` | walk-on (faction/type) |
| fantasy-system-heretic | 2 | 8 | `Null Field skill` | prop/abstract |
| fantasy-system-heretic | 2 | 9 | `sealed writ` | prop |
| fantasy-inscription | 1 | 4 | `ancient inscriptions` | prop/artifact |
| fantasy-inscription | 1 | 4 | `pre-imperial script` | prop/lore term |
| fantasy-inscription | 2 | 9 | `locked cabinet of pre-imperial fragments` | location/prop |
| fantasy-inscription | 2 | 10 | `crumbling scroll` | prop |

All 7 are qualitatively appropriate — genuinely new in-chapter props, lore terms, or minor locations not previously named in the world-bible or character roster.

## Acceptance Criteria Check

| Criterion | Target | Result | Pass? |
|---|---|---|---|
| BeatDupFPs | 0 | 0 | YES |
| ChDupFPs | 0 | 0 | YES |
| Non-empty rate | 4-6% ballpark | 4.8% | YES |
| No new test regressions | 0 new failures | 0 new failures (4 pre-existing DB-only failures unchanged) | YES |

**Overall: PASS**

## Files Changed

- `src/agents/planning-state-mapper/state-mapper-system.md` — prompt fix
- `scripts/phase-eval/variants/planning-state-mapper/default.md` — probe variant updated to match
- `docs/current-state.md` — L26/L32 note added to §61 mapper bullet
- `docs/decisions.md` — L32 entry appended
- `docs/todo.md` — L32 item closed
- `docs/sessions/2026-05-02-L32-mapper-prompt-fix.md` — session doc
- `docs/mapper-prompt-fix-verification-2026-05-02.md` — this file

## Links

- L26 result: `docs/mapper-allowed-new-entities-verification-2026-05-02.md`
- L32 decision: `docs/decisions.md` §L32
- Probe output: `output/phase-eval/L32-mapper-prompt-fix/`
