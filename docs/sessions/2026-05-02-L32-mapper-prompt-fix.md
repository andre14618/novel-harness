# Session — L32 Mapper Prompt Fix (2026-05-02)

**Branch:** synthesis-bundle-v1  
**Commits:** `e8f4045` (prompt fix), `<docs-commit>` (docs)  
**Experiments:** #353 (L32)  
**phase_eval_runs:** 121  
**Cost:** ~$0.035

## Goal

Fix the mapper prompt to eliminate 2 beat-level dup FPs found by L26 (exp #348):
1. `Sera` — new character in `beat.characters`, re-sanctioned in `allowedNewEntities` (phase-coordination gap)
2. `Master Inquisitor Orvath` — story character in `charactersPresent`, still emitted as new entity (instruction-following failure)

Acceptance: BeatDupFPs = 0, ChDupFPs = 0, non-empty rate stays 4-6%.

## What Was Done

1. Read L26 result doc and decisions.md L26 entry to understand root causes.
2. Added one positive-framed exclusion bullet to the Placement Guidance section in `state-mapper-system.md` (and mirrored to `default.md` variant):
   > `allowedNewEntities` is for entities genuinely NEW to the chapter — absent from both the current beat's character list and the chapter's `charactersPresent` list. Treat any character already in `beat.characters` or `chapter.charactersPresent` as established (already grounded); their inclusion in `allowedNewEntities` is redundant and should be omitted.
3. Verified no test regressions (4 pre-existing DB-only failures unchanged; tsc clean).
4. Committed prompt change atomically (commit `e8f4045`).
5. Created exp #353, ran L32 probe (3 seeds × 3 chapters), persisted as phase_eval_runs.id=121.
6. Concluded exp #353: PASS.
7. Updated docs: current-state.md, decisions.md, todo.md, result doc, session doc.

## Results

| Metric | L26 | L32 | Delta |
|---|---|---|---|
| BeatDupFPs | 2 | **0** | -2 |
| ChDupFPs | 1 | **0** | -1 |
| Non-empty rate | 4.1% | 4.8% | +0.7% |
| Total entities | 7 | 7 | 0 |

fantasy-inscription ch3 (the FP chapter): 0 entities in L32 (was 3 including both FPs).

## Key Decision

Single-bullet prompt addition covers both failure modes:
- `beat.characters` coverage closes the phase-coordination gap (Sera)
- `charactersPresent` coverage closes the instruction-following failure (Orvath)

Positive framing used throughout — the rule describes what `allowedNewEntities` IS for (genuinely new entities), not what to avoid. The "should be omitted" clause is a mild prescriptive, not a "NEVER" prohibition, consistent with `feedback_priming_suppression_ab`.

## Lessons

No new lessons. Standard prompt-clarification loop: L26 identified the root cause, L32 applied a minimal fix and re-ran the same probe. The probe took ~5 minutes and cost ~$0.035.
