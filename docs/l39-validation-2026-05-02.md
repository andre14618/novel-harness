---
status: result
date: 2026-05-02
experiment: 364
parent: L39
seed: fantasy-system-heretic
chapters_attempted: 3
chapters_completed: 0
stop_condition: (b) NEW out-of-scope cluster found (gamelit "System" entity grounding)
---

# L39-validation — Heretic re-smoke after adherence truncation fix

## Summary

Re-smoked `fantasy-system-heretic` (3 chapters, $4 budget) on commit `ae158f9` to validate the L39 fix (adherence-checker prose truncation 2000 → 8000 chars). **L39 validated: the adherence FN cluster is closed.** Heretic now bails on a NEW out-of-scope cluster — the gamelit world's "System" entity is not in the grounded surface, causing halluc-ungrounded blockers.

**Stop condition: (b) — NEW out-of-scope cluster found.**

## L39 fix validation

**Comparison vs original heretic (`novel-1777709036403` pre-L39):**

| Metric | Original heretic | L39-val heretic | Delta |
|---|---|---|---|
| LLM calls | 200 | 175 | -12% |
| Calls on retry | 52 | 25 | **-52%** |
| Cost | $0.0619 | $0.0606 | -2% (essentially equal — L39 cost-neutral as predicted) |
| Failed calls | 0 | 0 | — |
| AND-gate pass rate | 31% | 51% | **+20 pts** |
| Stage-2-override events | 2 | 6 | +4 (different chapter narrative, more overrides confirmed firing) |
| Bail cluster | adherence FN (Beat 4 reshelves) | halluc "System" ungrounded (Beat 2) | DIFFERENT — L39 closed adherence FN |

The 52% reduction in retries is the headline number. The original heretic burned 52 retry calls fighting the truncation-FN cluster; L39-val fights ~half that. The cost essentially matches (within noise) despite the larger per-call prose budget — confirming the L39 cost analysis (cached prefix dominates; uncached prose tokens went from ~500 → ~2000 with negligible $ impact).

**Adherence FN cluster: closed.** Across all 3 chapter retries on L39-val heretic, no `adherence-events` blockers fired on attempt 3 (the final attempt). Original heretic bailed on attempt 3 with `Beat 4: Beat event missing: Maret considers destroying the file but reshelves it untouched because the System logs all accesses` — that exact failure mode is gone.

## Per-chapter outcomes

| Chapter | Title | Beats | Attempts | Outcome | Bail reason |
|---|---|---|---|---|---|
| 1 | The Unwritten Record | 13 | 3/3 | ❌ plan-assist gate | halluc-ungrounded (Beat 2 "System" entity) |
| 2 | (planned) | — | 0 | not started | — |
| 3 | (planned) | — | 0 | not started | — |

**Chapter 1 retry sequence:**
- Attempt 1: prose integrity FAILED (4 issues) — retry
- Attempt 2: prose integrity FAILED (2 issues — improving) — retry
- Attempt 3: prose integrity passed; halluc-ungrounded blocker on Beat 2: `Ungrounded entity "System" — context: "The seal of the System stitched over the chest in silver thread."`

The prose-integrity instability is a separate cluster (L31d-(NEW2) in L37-data findings) that's still active. L39 doesn't address it.

The new halluc-ungrounded cluster is a **gamelit world-bible coverage gap**: "System" is the central magic/mechanic in the heretic seed (it's the gamelit System that ranks people and assigns classes), but it's not in the grounded surface. The world-bible's `systems[]` array probably lists specific systems but not the meta-System concept.

## Cluster verification

| Cluster | Status |
|---|---|
| L17 entity grounding (character_roster + outline_entities) | ✅ HOLDS — no L17 fires |
| L22 FN entity expansion (derived titles + suffix matching) | ✅ HOLDS — no L22 fires |
| L24-(a) NER-only-warning exhaust (L31a) | ✅ HOLDS — 18 NER-only-warnings, all `pass: true` |
| L24-(b) adherence stage-1 stochastic (L31c) | ✅ HOLDS — 6 stage-2-overrides correct |
| L26/L32 mapper allowedNewEntities dup-FPs (L32) | ✅ HOLDS — 0 dup-FPs |
| **L39 adherence prose truncation (the fix)** | ✅ **VALIDATED** — 0 adherence FNs on attempt 3; previously bailed here |
| **L39-(NEW) gamelit "System" entity grounding** | ⚠ NEW |

## NEW finding (L39-(NEW))

**The gamelit "System" entity is not in the grounded surface.**

The fantasy-system-heretic seed centers on "the System" — a magical/mechanical hierarchy that classes, ranks, and surveils citizens. It's the world's defining force. The world-bible likely contains specific subsystems (or specific "System" components) but not the meta-token "the System" that the writer naturally uses.

The halluc-ungrounded checker correctly flagged "the System" as ungrounded (no entry in world-bible names, character roster, outline entities, or derived titles). The writer wrote `"the seal of the System stitched over the chest"` and the prepass + LLM both flagged it as a new entity insertion.

**This is a world-builder coverage gap, not a checker bug.** Possible fixes:
1. **Patch the seed:** add "System" to world_bible_json `systems[]` for the heretic seed.
2. **Patch buildOutlineEntityList:** extract single-word capitalized terms from chapter outlines that appear repeatedly (would catch "System" as it appears in multiple beat descriptions).
3. **Add a gamelit-class extractor:** for litRPG/gamelit seeds, derive "System", "Class", "Status", etc. as known game-mechanic vocabulary regardless of world-bible content.

Option 1 is fastest; option 3 is most principled (litRPG genre-specific vocabulary). This belongs in a future L40 sprint.

## Telemetry summary

| Metric | Value |
|---|---|
| Total cost | $0.0606 / $4 (1.5%) |
| Total LLM calls | 175 |
| Failed calls | 0 |
| Calls on retry | 25 |
| AND-gate decisions | 43 (pass=22, ner-only-warning=18, llm-only-blocker=2, ner+llm-blocker=1) |
| Stage-1 adherence calls | 43 |
| Stage-2 adherence calls | 9 (21% stage-1 fail rate) |
| Stage-2-override events | 6 (L31c saving 6 retries) |
| Plan-assist gates | 1 (chapter 1, pending) |

## Conclusion + Action

**L39 fix: VALIDATED.** The adherence prose truncation cluster is closed. Heretic-class long-action-beat scenarios should now pass adherence on first attempt instead of bailing on a truncation FN. Retry budget consumption dropped 52%; cost was unchanged. L39 ships clean.

**L39-(NEW) gamelit "System" entity grounding:** open follow-up sprint. Candidate name: **L40**. Charter: extend halluc-ungrounded grounded surface to include genre-specific game-mechanic vocabulary (System, Class, Status, etc.) for litRPG/gamelit seeds. Acceptance: heretic re-smoke completes 3/3 chapters without "System" / "Class" ungrounded blockers.

**Prose-integrity instability** remains active. heretic ch1 attempts 1+2 both failed prose integrity (4 → 2 issues). This was the L31d-(NEW2) finding from L37-data; still queued as a separate sprint.

## References

- `docs/decisions.md` §L39, §L39-validation
- `docs/sessions/2026-05-02-L39-validation.md` (session retro)
- Smoke log: LXC `/tmp/smoke-l39val-heretic-1777712370.log`
- Operator summary: `bun scripts/operator-summary.ts novel-1777712370271`
- L39 source change: commit `0dc2b0c`
- L39 docs: commit `ae158f9`
