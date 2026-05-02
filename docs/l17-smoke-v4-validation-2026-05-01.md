---
status: complete
updated: 2026-05-01
experiment_id: 335
phase_eval_run_id: 80
---

# L17 — 3-Chapter LXC Smoke: v4 Halluc Prompt + L15 NER X-of-Y + L16 NER Telemetry — 2026-05-01

## Run Parameters

- **Seed:** fantasy-debt
- **Novel key:** novel-1777698707087
- **Deploy commit:** 59229cea82dfe13eab39ded0df82a197fde0cd27
- **Experiment:** tuning_experiments.id=335
- **Branch:** synthesis-bundle-v1
- **Stack under test:** v4 halluc-ungrounded prompt (L14) + L15 NER x-of-y-capitalized/number-word-tail + L16 ner_prepass_json persistence
- **Budget cap:** $4

## Outcome: PARTIAL (stop condition b)

**Stop condition triggered:** Plan-assist gate fired on ch1/attempt 3 on a NEW cluster (not the L11 4-fire cluster). Chapter 1 exhausted all 3 plan-assist attempts; pipeline bailed with `plan-check-exhausted`.

**Chapters completed:** 1 of 3 (planning passed cleanly; ch1 written 3x before gate exhausted; ch2/ch3 never reached)

## L11 Cluster Verdict: CLOSED

The four L11 fires (district archive, trade corporation, Grand Ledger, Guild Master) produced **0 fires** across all 3 attempts of chapter 1. SQL evidence:

```sql
SELECT count(*) FROM llm_calls
WHERE novel_id='novel-1777698707087'
  AND agent='halluc-ungrounded'
  AND (response_content LIKE '%district archive%'
    OR response_content LIKE '%trade corporation%'
    OR response_content LIKE '%Grand Ledger%'
    OR response_content LIKE '%Guild Master%')
-- Result: 0 rows
```

v4-disam prompt (L14, exp #329) definitively closes the L11 lowercase-compound-descriptor and title-only FP cluster on this seed.

## New Cluster: Character Names + World Locations (L18 Follow-up)

The blocker cluster that triggered stop condition (b) is a distinct FP class: the v3/v4 LLM halluc checker flagging **established characters and world locations** as ungrounded entities.

**Top flagged entities by frequency across all blocker calls:**

| entity | fires | classification |
|--------|-------|----------------|
| Lord Sorcerer Brennan | 3 | named character — main antagonist |
| Brennan | 2 | same character, short-form reference |
| Sorcerer's Tower | 1 | named location in world bible |
| Eastern Reach | 1 | named region in world bible |
| Collector Marwick | 1 | named character |
| Temple of Mercy | 1 | named location |
| East Ward / West Ward | 2 | named districts |
| Ashford shrine / verification office | 2 | named locations |
| Magistrate Dorn | 1 | named character |
| Silver Street | 1 | named location |
| Master Collector | 1 | title phrase (grounded) |
| Luken Ashby | 1 | named character |
| Aldric | 1 | named character (Lord Sorcerer Aldric) |
| king's auditor | 1 | FP on generic role compound |

**Root cause:** The context surface assembled for halluc-ungrounded does not include the full named character + location vocabulary from the world bible. Characters like Lord Sorcerer Brennan appear in the plotter's chapter plan and in the prose, but the halluc checker's `groundedSources` surface only includes beat-scoped entities, not the full roster of named characters and named locations defined during concept/world-building. This is a context assembly gap, not a prompt logic gap.

**NER AND-gate contribution:** The NER prepass correctly identified many of these as `capitalized-multi-word` and `title-pair` class candidates, contributing to `ner+llm-blocker` decisions. The NER is behaving correctly for the entities it flags — the gap is that the grounded union (beat characters + world bible terms) doesn't include all novel-context names.

## AND-Gate Matrix (55 halluc-ungrounded calls, ch1 only)

| decision | count | % |
|----------|-------|---|
| pass | 33 | 60.0% |
| ner+llm-blocker | 8 | 14.5% |
| llm-only-blocker | 7 | 12.7% |
| ner-only-warning | 7 | 12.7% |

Pass rate: **40/55 (72.7%)**

Note: all 15 blockers occurred on ch1 (3 attempts × beats 0–10). This run did not reach ch2/ch3, so this matrix reflects a single difficult chapter's worth of data.

## NER Class Histogram (from ner_prepass_json nerFindings)

| class | fires |
|-------|-------|
| capitalized-multi-word | 24 |
| title-pair | 4 |
| suffix-class | 3 |
| x-of-y-capitalized | 1 |

**L15 x-of-y-capitalized fired in production:** "The Temple of Mercy" in beat 5 (1 occurrence). The L15 extension is active and functional. The `number-word-tail` class produced no candidates in this run — consistent with the fantasy-debt seed having less faction-name numerology than the synthetic panels.

## Adherence and Plan Checker

| checker | passed | total | pass rate |
|---------|--------|-------|-----------|
| adherence-events | 58 | 58 | 100% |
| chapter-plan-checker | 3 | 3 | 100% |

Adherence-events passed on every single beat write (100% pass rate). Chapter plan checker passed on all 3 plan-checker attempts. The blockers were purely halluc-ungrounded.

## Prose Integrity

Chapter 1 had RHYTHM_MONOTONY, AI_CLICHE, HEDGE_QUALIFIER, and PARAGRAPH_HOMOGENEITY lint issues across all 3 attempts. lint-fixer was called 15 times total. Prose integrity failures are separate from the halluc/plan-assist gate and are consistent with the current writer surface.

## Chapter Exhaustions

| chapter | attempt | kind | decision |
|---------|---------|------|----------|
| 1 | 3 | plan-check-exhausted | null |

## Agent Call Volume

| agent | calls |
|-------|-------|
| adherence-events | 58 |
| beat-writer | 55 |
| halluc-ungrounded | 55 |
| lint-fixer | 15 |
| planning-state-mapper | 3 |
| continuity-state | 3 |
| continuity-facts | 3 |
| chapter-plan-checker | 3 |
| planning-beats | 3 |
| functional-state-checker | 3 |
| world-builder | 1 |
| planning-plotter | 1 |
| plotter | 1 |
| character-agent | 1 |

3 planning-state-mapper calls, all clean, confirming the mapper fix path remains stable on this seed.

## Cost

**Total: $0.062** (well within $4 budget cap)

## L16 Telemetry: ner_prepass_json Population

`ner_prepass_json` populated on all 55 halluc-ungrounded calls. The AND-gate matrix above is derived entirely from this column, confirming L16 persistence is working correctly in production. This is the first production AND-gate matrix from a live novel run.

## Comparison vs L11

| dimension | L11 (exp #326) | L17 (exp #335) |
|-----------|----------------|----------------|
| seed | fantasy-debt | fantasy-debt |
| stack | v3 prompt, no NER, no ner_prepass_json | v4 prompt, NER prepass, ner_prepass_json |
| ch1 plan-assist fires | 4 (all L11 cluster) | 0 L11 cluster fires |
| new cluster fires | N/A | 15 blocker calls, new character/location FP cluster |
| chapters completed | 1/3 | 1/3 |
| adherence pass rate | not recorded | 100% (58/58) |
| cost | ~$0.038 | $0.062 |

L11 cluster definitively closed by v4 prompt. New cluster is a different root cause requiring context assembly work (surfacing full character+location roster in halluc grounded surface), not another prompt iteration.

## Conclusion and Action

**v4 prompt (L14): VALIDATED** — closes L11 cluster completely on the production seed.
**L15 NER x-of-y: VALIDATED** — fires in production (1 occurrence, "Temple of Mercy").
**L16 ner_prepass_json: VALIDATED** — all 55 calls populated, AND-gate matrix queryable.

**L18 follow-up required:** The new blocker cluster is character names and world locations not in the halluc grounded surface. This is a context assembly gap: `groundedSources` needs to include the full named-character roster (from character-agent outputs) and named-location/place vocabulary (from world-builder outputs), not just beat-scoped entities. This is distinct from prompt disambiguation and should be addressed as a separate context-surface expansion task.

**3-chapter clean run** still required before closing §12 todo item. Will complete after L18 context fix ships.
