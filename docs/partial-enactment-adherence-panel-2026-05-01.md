---
status: final
created: 2026-05-01
updated: 2026-05-02
experiment: 337
phase_eval_run: 79
---

# L18: Partial-Enactment Adherence Panel — Per-shape Matrix

## Overview

This document records the L18 synthetic panel evaluation of the two-stage `checkBeatAdherence`
(commit `ae50e99`) against controlled partial-enactment fixtures across three failure shapes.

The goal was to establish whether the checker discriminates partial vs full enactment cleanly
beyond the narrow b12 Cassel/Maret cluster that was the only partial-enactment evidence in the
L8 labeled panel (exp #324).

**Experiment:** #337  
**phase\_eval\_runs.id:** 79  
**Panel file:** `scripts/hallucination/synthetic-partial-enactment-fixtures/partial-enactment-panel.jsonl`  
**Run script:** `scripts/hallucination/run-partial-enactment-panel.ts`  
**Probe name:** `partial-enactment-per-shape-matrix`

---

## Panel Composition

14 total rows across 4 shapes:

| Shape | FAIL fixtures | PASS controls | Notes |
|-------|--------------|---------------|-------|
| two-of-three | 3 | 1 | Beat has 3 events; prose enacts 2 |
| reversed-order | 3 | 1 | Prose reorders in a causality-breaking way |
| substituted-actor | 3 | 1 | Wrong character performs the key action |
| acceptable-embellishment | 0 | 2 | PASS-only controls; cinematic/character detail |

All fixtures use the Cassel/Maret/archive universe for consistency with the labeled panel.
Beat descriptions are 1–3 sentence, direct, with 1–3 discrete events each.

---

## Panel-Level Binary Results

| Metric | Value |
|--------|-------|
| TP | 5 |
| FP | 0 |
| FN | 4 |
| TN | 5 |
| Total correct | 10/14 (71.4%) |
| Precision | **100.0%** |
| Recall | **55.6%** |
| F1 | **71.4%** |

**Zero false positives.** The checker never failed an acceptable embellishment or a correctly
enacted PASS control. The 4 FNs are all miss-of-FAIL — the checker passed prose that should
have been flagged.

---

## Per-shape Recall / Precision / F1 Matrix

| Shape | N\_fail | N\_pass | TP | FP | FN | TN | Recall | Prec | F1 | Stage-2 detail correct |
|-------|--------|--------|----|----|----|----|--------|------|----|-----------------------|
| two-of-three | 3 | 1 | 1 | 0 | 2 | 1 | 33% | 100% | 50% | 1/1 |
| reversed-order | 3 | 1 | 2 | 0 | 1 | 1 | 67% | 100% | 80% | 1/2 |
| substituted-actor | 3 | 1 | 2 | 0 | 1 | 1 | 67% | 100% | 80% | 2/2 |
| acceptable-embellishment | 0 | 2 | 0 | 0 | 0 | 2 | N/A | N/A | N/A | 0/0 |

**Stage-2 detail correctness:** 4/5 stage-2 fires correctly named the missing/substituted
element (80%). The 1 miss was `reversed-order-fail-01`: stage 2 reported "Sara unlocks the door"
as missing (she does force the door open in prose), when the real violation was the inverted
call-before-see causal ordering.

---

## Per-event Detail Correctness

Of 9 FAIL rows:
- Stage 2 fired: **5/9** (checker caught the fail via binary stage 1, then enumerated events)
- Stage 2 with verbatim prose quote: **5/5** (100% of fires had grounded quote evidence)
- Stage 2 correctly named the missing/substituted event: **4/5** (80%)

The 4 FN rows had no stage-2 output because stage 1 passed (the binary check said "events
present"), so stage 2 never fired — this is expected behavior.

---

## Residual Miss Analysis

### FNs by shape and root cause

| Fixture | Shape | Oracle-missing event | Root cause |
|---------|-------|---------------------|------------|
| two-of-three-fail-01 | two-of-three | Maret asks about the porter's whereabouts | Checker sees porter named + Maret present and infers question was implicit. Short single-clause beat omission: the missing event is not dramatically salient. |
| two-of-three-fail-02 | two-of-three | Cassel lights the candles on the sideboard | Purely mechanical action (candles) easily treated as optional ambient detail. Checker does not distinguish between optional background actions and obligated beat events. |
| reversed-order-fail-02 | reversed-order | Mage casts binding before draining the well | Causality reversal is the failure — all three events ARE present in prose. The checker sees "cast binding" + "drain well" + "collapses" and correctly identifies all events as enacted; it does not evaluate ordering or causal dependencies. |
| substituted-actor-fail-03 | substituted-actor | Rael slides the ledger (porter does it instead) | The prose attributes the action to "the porter" who was not in the beat's character list. Since Maret is in the beat, and the porter performs the action, the checker sees both characters in prose, counts the ledger-slide as enacted (it does happen), and passes. |

### Structural root causes

**Two most problematic shapes:**

1. **two-of-three** (33% recall, 2 FNs): The checker is most vulnerable when the missing
   event is a minor/mechanical action (lighting candles, asking a sub-question) that doesn't
   affect the dramatic arc. The binary `events_present` prompt says "ALL must appear" but
   the model weights salient events higher and can effectively ignore ambient obligations.

2. **reversed-order** (1 FN, specific type): The checker is trained to detect *presence* of
   events, not *ordering*. A causality-breaking reversal where all events are present is
   systematically invisible to the current prompt design. The EVENTS\_SYSTEM prompt has no
   language about ordering or causal dependencies — it only checks whether each action
   "happens IN SCENE."

**Notable finding on substituted-actor:** The checker handles the clear-substitution case well
(Captain→Lieutenant: 2/3 caught) but misses the passive-witnessing case (Rael watches while
porter acts, then speaks "as if granting permission"). The distinguishing factor is whether the
named character is completely absent from the beat action or merely passive. When the named
character speaks in-scene about the action, the checker can incorrectly credit them as having
enacted the beat.

---

## Recommended Next Iterations

### Priority 1: two-of-three prompt clarification

**Target:** Bring two-of-three recall from 33% to ≥67%.

The current prompt: "If ANY key action from the beat is missing, return events_present=false."
The word "key" is doing invisible work — the model weights salience, not presence. Proposed
addition to EVENTS\_SYSTEM:

> "Treat every listed action as obligated regardless of its dramatic weight. Ambient or
> mechanical actions (lighting candles, handing over a document, asking a sub-question) are
> as obligated as dramatic actions if the beat specifies them. Do not distinguish between
> 'major' and 'minor' events — if the beat names it, it must appear."

Acceptance bar: two-of-three recall ≥ 2/3 without new FP regression.

### Priority 2: reversed-order — explicit ordering gate

**Target:** Catch causality-breaking reversals.

This is a harder prompt engineering problem because the checker must hold a temporal model
of the beat events AND the prose events and compare ordering. Proposed prompt addition:

> "If the beat specifies events in a causal sequence (A causes B, A is a prerequisite for B,
> or the beat uses 'then' to indicate ordering), verify that the prose preserves that causal
> sequence. If A must precede B in logic (e.g., 'sees the body, then calls for help' — you
> cannot call for help before seeing the body) and the prose reverses them, return
> events_present=false even if both events are present."

Acceptance bar: reversed-order-fail-02 (mage binding/drain) and reversed-order-fail-01 (Sara)
both caught without FP regression on reversed-order-pass-01 (parallel non-causal actions).

### Priority 3: substituted-actor passive witnessing

**Target:** Catch passive-witness cases (named actor present but doesn't perform action).

The existing prompt says "The action must be performed by the character the beat assigns it to."
This is correct but the model disambiguates by asking whether the character *could have* done it.
When the named character speaks about the action after the fact, the model credits enactment.

Proposed clarification to EVENTS\_SYSTEM:

> "Passive witnessing is not enactment. If the beat says Character A performs action X, and
> the prose has Character B perform X while Character A watches, speaks about it, or reacts
> to it, the action is NOT correctly enacted by Character A. The named character must
> physically perform the action themselves, not merely observe, delegate, or comment on it."

---

## Cost

Total LLM cost for experiment #337: **~$0.0009** (19 calls × ~$0.000047/call).  
Well within the $1 budget cap.

---

## Conclusion + Action

**Conclusion:** The two-stage checker achieves **precision = 100%** across all shapes — it
never fails acceptable embellishment — but recall is uneven: **substituted-actor and
reversed-order are at 67%** (acceptable for a first pass), while **two-of-three is at 33%**
(the primary prompt-iteration target). The root cause for two-of-three FNs is implicit
salience weighting: the model treats minor/mechanical beat actions as optional despite the
prompt's "ALL must appear" instruction. The root cause for reversed-order FN is a structural
gap: the current prompt has no causality-ordering language. The root cause for substituted-actor
FN is passive-witnessing ambiguity when the named character speaks about the action.

**Action:** Priority-1 next iteration is a two-of-three prompt clarification adding an
explicit statement that ambient/mechanical actions are equally obligated as dramatic ones.
Validate on a 3-fixture re-run before shipping to the binary prompt. Do NOT modify runtime
files in this loop (L18) — queue as a follow-up prompt edit with its own panel-validation
run.
