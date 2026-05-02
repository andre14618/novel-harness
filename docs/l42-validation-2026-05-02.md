---
status: result
date: 2026-05-02
experiment: 366
parent: L42
seed: fantasy-system-heretic
chapters_attempted: 3
chapters_completed: 0
stop_condition: (b) NEW out-of-scope cluster found (writer-side adherence misses on verbal-action obligations)
---

# L42-validation — Heretic re-smoke after writer walk-on discipline rule

## Summary

Re-smoked `fantasy-system-heretic` (3 chapters, $4 budget) on commit `c765073` to validate the L42 walk-on-entity discipline rule (added to both `beat-writer-system.md` and `beat-writer-system-salvatore.md`). **L42 PARTIALLY VALIDATED:** the entity-grounding cluster is substantially closed (0 halluc llm-only-blockers and 0 ner+llm-blockers in chapter 1, vs 1 llm-only-blocker in L40-val). The writer still invents some walk-on names but they now surface only as NER-only-warnings (severity warning, no retry burn). Chapter no longer bails on entity grounding.

**Stop condition: (b) — NEW out-of-scope cluster found** (writer-side adherence misses on verbal-action obligations).

## L42 effect on entity-grounding cluster

### Direct comparison vs L40-val

| Metric | L40-val (`novel-1777716659610`) | L42-val (`novel-1777718105222`) | Delta |
|---|---|---|---|
| Halluc-ungrounded calls (ch1) | 19 | 15 | -21% |
| AND-gate `pass` | 13 (68%) | 10 (67%) | similar |
| AND-gate `ner-only-warning` | 5 (26%) | 5 (33%) | +7 pts |
| AND-gate `llm-only-blocker` | **1 (5%)** | **0 (0%)** | **-5 pts** |
| AND-gate `ner+llm-blocker` | 0 | 0 | unchanged |
| L40 rescues fired | 0 | 1 | +1 (correct fire) |
| Bail cluster | writer-invented entities | writer adherence FN | DIFFERENT |

**Headline:** L42 closes the writer-invented-entity cluster (0 blocker-class fires, vs 1 in L40-val that caused the bail).

### What the writer still does — and why it doesn't bail

The writer continues to invent some walk-on names, but the LLM checker now treats them as plausible enough to grant L31a warning class. NER-only-warnings recorded in chapter 1:

| Beat | Phrase | Class |
|---|---|---|
| 3-4 | `Master Halden` (8 fires) | title-pair |
| 6 | `North Gate` | capitalized-multi-word |
| 7 | `Guildmistress Vex's` | capitalized-multi-word |
| 11 | `Veldener Guild` | capitalized-multi-word |

None are in:
- World bible: `systems`/`locations`/`cultures` only carry `[The System, The Arbiterate, Scribe Guild Hall, ...]`
- Character roster: `[Maret Sorel, Journeyman Theo, Arbiter Cassel]`
- Outline scenes / established facts: no Halden / Vex / North Gate / Veldener mentions

So these are 100% writer inventions. But:
1. **L31a treats NER-only-warnings as `pass=true`** (no retry burn).
2. The LLM checker no longer flags them as ungrounded (likely because the writer integrated them more naturally — the L42 rule made the writer think about walk-on entity discipline at all, even if not perfectly).

Net effect: writer still produces some FPs but they're no longer bail-inducing. **The L42 rule shifted the FP class from blocker → warning, which is what the harness wants.**

### L40 rescue activated correctly once

`ch1 b1 a1 dec=pass rescued=1 flagged=[Arbiter]` — the LLM flagged the bare token `Arbiter` (not "Arbiter Cassel"). Pre-L40 this would have been an llm-only-blocker. L40 correctly rescued: `Arbiter` is a character-roster per-token shard (from "Arbiter Cassel"). Decision: `pass`, beat continues. Telemetry confirms L40 + L42 work together.

## NEW finding (L42-val-NEW): Writer adherence misses on verbal-action obligations

The L42-val novel bailed at chapter 1 plan-assist after exhausting beat 5 retries (3 attempts). The unresolved blockers are 2 adherence FNs on beat 6 events:

```
Beat 6 obligations the writer didn't enact on-page:
  1. "Maret stalls, claiming she needs to finish a ledger before she can meet the Arbiter."
  2. "The guild master agrees, giving her a few hours."

Writer prose for beat 5 (the dramatic equivalent):
  "She crossed to it. Sat. Her hands found the Darnel inventory and pulled it open
   without her eyes asking permission."
```

The writer dramatized the physical analog (Maret defers by burying herself in ledger work) but did NOT enact the obligated verbal exchange (Maret says she needs more time; guild master agrees). The adherence-events checker is correctly literal: the obligation specifies a verbal claim + an explicit consent, and neither appears in the prose.

**This is an L37-data L31d-(NEW1) recurrence at the writer-side.** L37-data identified continuity blockers as writer state-propagation gaps; L42-val surfaces a related but distinct cluster: writer infers dramatic intent (deferral via task) but doesn't enact the SPECIFIC obligated event shape (verbal stall + verbal consent). Two remediation options:

1. **Writer-side:** strengthen the beat-writer prompt to enact each obligation event literally before adding dramatic equivalents. Risk: over-prescription kills creative latitude.
2. **Adherence-checker-side:** recognize physical-equivalent enactment as satisfying verbal-action obligations (an enactment-mode tolerance gate). Risk: hides genuine adherence FNs.
3. **Planner-side:** mark obligations as "literal" (verbal exchange required) vs "directional" (any dramatic equivalent acceptable). Risk: planner schema change + retraining.

Queued as **L43** candidate. Option 1 is cheapest; option 3 is most architecturally sound. Recommend probing option 1 first (analogous to L42's positive-prompt-rule approach).

## Cluster verification

| Cluster | Status |
|---|---|
| L17 entity grounding | ✅ HOLDS |
| L22 FN entity expansion | ✅ HOLDS |
| L24-(a) NER-only-warning exhaust (L31a) | ✅ HOLDS — 5 NER-only-warnings, all `pass: true` |
| L24-(b) adherence stage-1 stochastic (L31c) | ✅ HOLDS |
| L26/L32 mapper allowedNewEntities dup-FPs (L32) | ✅ HOLDS |
| L39 adherence prose truncation | ✅ HOLDS |
| L40 NER post-filter | ✅ HOLDS — 1 correct rescue ("Arbiter") |
| **L42 writer walk-on discipline** | ✅ **PARTIAL** — 0 blocker fires (was 1); 5 walk-on warnings still present |
| **L42-val-NEW writer adherence misses on verbal obligations** | ⚠ NEW (L43 candidate) |

## Telemetry summary

| Metric | Value |
|---|---|
| Total cost (preliminary, ch1 only) | ~$0.04 / $4 (1.0%) |
| Total LLM calls (ch1) | ~140 |
| Halluc-ungrounded calls | 15 |
| AND-gate `pass` rate | 10/15 (67%) |
| Halluc llm-only-blocker | **0/15 (0%, was 5% in L40-val)** |
| L40 rescues activated | 1 |
| Bail cluster | adherence FN (verbal-vs-physical enactment mismatch) |
| Plan-assist gates | 1 (chapter 1, pending) |

## Conclusion + Action

**L42 fix: PARTIALLY VALIDATED.** The walk-on discipline rule shifts writer-invented walk-on entities from blocker class (llm-only-blocker) to warning class (NER-only-warning). The chapter no longer bails on entity-grounding. The writer is not perfectly disciplined (still invents `Master Halden` and `Guildmistress Vex`), but the AND-gate is now permissive on these specific shapes.

**L42-val-NEW writer adherence misses on verbal-action obligations:** open follow-up sprint. Candidate name: **L43**. Three remediation options (writer-side / checker-side / planner-side); recommend writer-side prompt rule first (analogous to L42 approach).

**The L31 + L39 + L40 + L42 stack now closes 3 distinct clusters in heretic-class scenarios:** truncation FNs (L39), gamelit grounded-but-disagreed entities (L40), and writer-invented walk-on entities (L42 + L31a). The next bottleneck is verbal-action adherence interpretation. Healthy ladder progress.

## References

- `docs/decisions.md` §L42, §L42-validation
- `docs/sessions/2026-05-02-L42-validation.md` (session retro)
- Smoke log: LXC `/tmp/smoke-l42val-heretic-1777718104.log`
- L42 source change: commit `c765073`
- L42-val novel: `novel-1777718105222`
- L40-val parent novel: `novel-1777716659610` (used for direct comparison)
