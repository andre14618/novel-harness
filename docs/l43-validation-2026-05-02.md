---
status: result
date: 2026-05-02
experiment: 367
parent: L43
seed: fantasy-system-heretic
chapters_attempted: 3
chapters_completed: 0
stop_condition: (b) NEW out-of-scope cluster found (L41 prose-integrity instability)
---

# L43-validation — Heretic re-smoke after verbal-action obligation rule

## Summary

Re-smoked `fantasy-system-heretic` (3 chapters, $4 budget) on commit `091eaa3` to validate the L43 verbal-action obligation enactment rule. **L43 SOLIDLY VALIDATED:** no adherence checker blockers fired across any of chapter 1's 3 attempts (vs 2 fires in L42-val that caused the bail). The chapter exhausted retry budget on prose-integrity issues — the L41 cluster which was already queued and is now THE dominant heretic bail cluster after L31/L39/L40/L42/L43 close their respective clusters.

**Stop condition: (b) — NEW out-of-scope cluster found** (L41 prose-integrity instability surfaced as solo bail cluster).

## L43 effect on adherence cluster

### Per-attempt walk-through (chapter 1, 12 beats)

| Attempt | Beats drafted | Plan check | Continuity | Lint issues | Prose integrity |
|---|---|---|---|---|---|
| 1 | 12/12 | ✅ PASS | ✅ no issues | 12 (10 deterministic + 2 LLM) | ❌ FAIL (3 issues) |
| 2 | 12/12 | ✅ PASS | ✅ no issues | 17 (lint-fix-rejected by integrity guard) | ❌ FAIL (2 issues) |
| 3 | 12/12 | ✅ PASS | ✅ no issues | 10 (1 unfixed) | ❌ FAIL (1 issue) |

**Adherence checker blockers fired: 0** (all 3 attempts).
**Halluc-ungrounded checker blockers (chapter-level): 0** (all 3 attempts; 2 beat-level fires resolved via retry).
**Bail mode:** `chapter-attempts-exhausted:ch1` (different code path from L42-val's plan-assist gate).
**Integrity convergence:** 3 → 2 → 1 issues across attempts. Never reached 0; retry budget exhausted at attempt 3.

### Direct comparison vs L42-val

| Metric | L42-val (`novel-1777718105222`) | L43-val (`novel-1777719198533`) | Delta |
|---|---|---|---|
| Adherence checker blockers (ch1) | 2 (caused bail at plan-assist) | **0** | -100% |
| Halluc llm-only-blocker (chapter-bailing) | 0 | 0 | unchanged |
| Halluc ner+llm-blocker (chapter-bailing) | 0 | 2 (beat-level, resolved on retry) | resolved |
| L40 rescues activated | 1 | 1 | unchanged |
| Prose integrity attempt-1 fail | not reached (bailed earlier) | 3 issues | new bail |
| Prose integrity attempt-3 fail | not reached | 1 issue | converging |
| Bail cluster | adherence FN | L41 prose-integrity | DIFFERENT |
| Bail code path | plan-assist gate | chapter-attempts-exhausted | DIFFERENT |

**Headline:** L43 closes the verbal-action adherence cluster. Chapter no longer bails on adherence. The exhaustion bail is purely on prose-integrity.

## Halluc-ungrounded behavior

### AND-gate decision histogram (39 calls across 3 attempts)

| Decision | Count | Notes |
|---|---|---|
| `pass` | 19 (49%) | clean checker passes |
| `ner-only-warning` | 18 (46%) | walk-on names writer invented but LLM accepted |
| `ner+llm-blocker` | 2 (5%) | both resolved via beat-level retry, not chapter-level |
| `llm-only-blocker` | **0 (0%)** | L40 + L42 stack continues to suppress this class |
| L40 rescues activated | 1 | working as designed |

The 2 `ner+llm-blocker` events:
- `ch1 b2 a1 [Quartermaster's Office, Scroll-Keeper's Circle]` — writer invented locations
- `ch1 b7 a1 [Toren, Elara, Jorun]` — writer invented character names

Both fired on attempt 1 only, and both were resolved when the writer tried different prose on retry. **Beat-level retry is doing the right thing here** — the writer's inventions get caught and the next attempt picks different shapes that pass.

## NEW finding (L43-val-NEW): L41 prose-integrity is THE dominant cluster

The L43-val novel bailed at `chapter-attempts-exhausted:ch1` — the chapter retry budget (3) was exhausted on prose-integrity failures. Each attempt's integrity issue count:

| Attempt | Integrity issues | Lint result |
|---|---|---|
| 1 | 3 | 10 of 12 fixed |
| 2 | 2 | lint fix rejected by integrity guard |
| 3 | 1 | 1 of 10 unfixed |

**The pattern:** lint produces fixes, but those fixes either fail the integrity guard (introducing new prose problems) or the writer's raw draft has integrity issues the lint can't reach (RHYTHM_MONOTONY:7-13, AI_CLICHE:2-4).

This was already queued as L41 with these candidate fixes:
- (a) Pass integrity issue descriptions back to writer in next-attempt prompt (lowest cost)
- (b) Improve lint-fixer reliability for integrity issues
- (c) Targeted-rewrite path for integrity-only chapter retries
- (d) Bump chapter retry budget from 3 → 5 (band-aid)

The 3 → 2 → 1 convergence trend strongly suggests a 2-3 attempt budget extension might close the gap stochastically. But that's a fragile fix — better to give the writer the integrity issue descriptions so they can address them on attempt 2.

## Cluster verification

| Cluster | Status |
|---|---|
| L17 entity grounding | ✅ HOLDS |
| L22 FN entity expansion | ✅ HOLDS |
| L24-(a) NER-only-warning exhaust (L31a) | ✅ HOLDS — 18 NER-only-warnings, all `pass: true` |
| L24-(b) adherence stage-1 stochastic (L31c) | ✅ HOLDS |
| L26/L32 mapper allowedNewEntities dup-FPs (L32) | ✅ HOLDS |
| L39 adherence prose truncation | ✅ HOLDS |
| L40 NER post-filter | ✅ HOLDS — 1 correct rescue |
| L42 writer walk-on discipline | ✅ HOLDS — 0 chapter-bailing entity blockers |
| **L43 writer verbal-action enactment** | ✅ **VALIDATED** — 0 adherence FN blockers across 3 attempts |
| **L41 prose-integrity instability** | ⚠ NOW DOMINANT (was queued, surfaced as solo bail cluster) |

## Telemetry summary

| Metric | Value |
|---|---|
| Total cost (preliminary, ch1 only) | ~$0.07 / $4 (1.7%) |
| Total LLM calls (ch1) | ~290 (3× 12-beat attempts + checks) |
| Halluc-ungrounded calls | 39 |
| Halluc llm-only-blocker | **0/39 (0%)** |
| Halluc ner+llm-blocker | 2/39 (resolved via beat retry) |
| L40 rescues | 1 |
| Adherence stage-1 calls | ~15 |
| Adherence stage-2 calls | varies |
| Plan-assist gates | 0 (chapter exhausted via different path) |
| Bail mode | `chapter-attempts-exhausted:ch1` |

## Conclusion + Action

**L43 fix: SOLIDLY VALIDATED.** The verbal-action obligation enactment rule closes the L42-val-NEW cluster: 0 adherence checker blockers across 3 chapter attempts (vs 2 fires in L42-val that caused the bail). Combined with L40 (NER post-filter) and L42 (walk-on discipline), the entity-grounding + verbal-action-adherence cluster stack is now fully closed for heretic-class scenarios.

**L41 prose-integrity instability:** the dominant remaining bail cluster. Was queued in earlier sessions; surfaces solo here. Convergence pattern (3 → 2 → 1) suggests the writer is making progress but retry budget runs out. Recommended L41 sprint design:

1. **Option (a) — pass integrity issue descriptions back to writer.** When prose integrity fails on attempt N, append the issue list to the writer's attempt N+1 prompt (analogous to the existing adherence retry context in `retry-context.ts`). Writer then has a chance to address the specific fragment / rhythm / cliché problems on the next attempt.
2. **Option (d) — bump chapter retry budget from 3 → 5.** Band-aid; trades ~50% more cost per integrity-failing chapter for a wider stochastic window.

Recommend (a) first; (d) as fallback if (a) doesn't close the gap. Acceptance: heretic re-smoke ch1 doesn't bail on integrity within standard 3-attempt budget.

**The L31 + L39 + L40 + L42 + L43 stack now closes 5 distinct clusters in heretic-class scenarios:** truncation FNs (L39), grounded-but-disagreed entities (L40), writer-invented walk-on entities (L42 + L31a), verbal-action adherence (L43). Each was a small, well-scoped fix. The ladder is producing systematic gains.

## References

- `docs/decisions.md` §L43, §L43-validation
- `docs/sessions/2026-05-02-L43-validation.md` (session retro)
- Smoke log: LXC `/tmp/smoke-l43val-heretic-1777719198.log`
- L43 source change: commit `091eaa3`
- L43-val novel: `novel-1777719198533`
- L42-val parent novel: `novel-1777718105222` (used for direct comparison)
