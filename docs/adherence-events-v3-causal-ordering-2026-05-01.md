---
status: final
created: 2026-05-02
experiment: 345
phase_eval_run: 83
---

# L25: EVENTS_SYSTEM v3 Causal-Ordering — Promotion Result

## Summary

This document records the L25 A/B evaluation and promotion of EVENTS_SYSTEM v3 in
`src/agents/writer/adherence-checker.ts`. The change targets the reversed-order shape
recall gap from L21: after v2 promotion, reversed-order-fail-02 (mage drain/binding
causal reversal) was the sole remaining FN in that shape.

**Experiment:** #345
**phase\_eval\_runs.id:** 83
**A/B script:** `scripts/hallucination/run-ab-causal-ordering.ts`
**Promoted:** yes — v3-causal-ordering is now live in `src/agents/writer/adherence-checker.ts`
**Evidence artifact:** `/tmp/ab-causal-ordering-20260502T025455.summary.json`

---

## Root Cause of fail-02 (Pre-v3)

Beat: `"The mage casts the binding, drains the well, then collapses."`

Prose: Mage reaches for the well and draws heat first (drain), then forces the
binding outward through his palms (binding cast), then collapses.

v2 reasoning on this case: "The prose shows the mage draining the well (drawing heat),
casting the binding (forcing it outward), and collapsing (on his knees), all in sequence."

The model read the prose left-to-right, found all three events present, and reported
pass. v2's EVENTS_SYSTEM has no language about sequence or causal prerequisites — only
presence detection.

---

## Prompt Diff (v2 → v3)

One bullet added after the "equally obligated" rule (positive framing,
no neg-prime patterns per `feedback_priming_suppression_ab`):

```
+ - When the beat sequences events with "then", "after", "before", "next", or implicit
+   causal logic (where X is a prerequisite for Y to occur), verify that the prose
+   enacts them in the same order. If a prerequisite action occurs after its consequence
+   in the prose, return events_present=false even when all events are present.
```

---

## Per-shape A/B Matrix (L18 partial-enactment panel, 14 rows)

Results from phase_eval_runs.id=83:

| Shape | N_fail | N_pass | v2_TP | v2_FN | v2_Rec | v3_TP | v3_FN | v3_Rec | delta_Rec |
|-------|--------|--------|-------|-------|--------|-------|-------|--------|-----------|
| two-of-three | 3 | 1 | 2 | 1 | 67% | 2 | 1 | 67% | 0 pp |
| reversed-order | 3 | 1 | 2 | 1 | 67% | 3 | 0 | 100% | +33 pp |
| substituted-actor | 3 | 1 | 2 | 1 | 67% | 3 | 0 | 100% | +33 pp (bonus) |
| acceptable-embellishment | 0 | 2 | — | — | N/A | — | — | N/A | — |

**Reversed-order detail (all 4 fixtures):**

| Fixture | Oracle | v2 | v3 | Notes |
|---------|--------|----|----|-------|
| reversed-order-fail-01 | FAIL | TP (caught) | TP (caught) | Sara calls before seeing — detected by both |
| reversed-order-fail-02 | FAIL | FN (miss) | TP (caught) | Mage drain before binding — **the target lift** |
| reversed-order-fail-03 | FAIL | TP (caught) | TP (caught) | Cassel doesn't hand brief — detected by both |
| reversed-order-pass-01 | PASS | TN | TN | Kael draws+shouts (parallel, no causal order) — correct TN preserved |

**v3 reasoning on fail-02:** "The prose enacts draining the well and collapsing, but
the binding is cast after draining, not before as the beat specifies."

**Bonus:** substituted-actor-fail-03 (porter-slides-ledger passive witness case) was
also lifted from FN→TP by v3. Root cause likely: the v3 causal-ordering language
further tightened the model's action-attribution checking, prompting it to inspect
whether the assigned character performed the action directly.

---

## v4 Comparison

v4 added concrete examples to the causal-ordering bullet:
> "...For example: if the beat says 'casts the binding, then drains the well', the
> prose must show the binding cast first..."

v4 results were identical to v3 (reversed-order 100%, substituted-actor 100%, labeled
100%, embellishment 100%). v3 is preferred for simplicity — no hard-coded examples
that could anchor the model to specific fixture patterns. v4 is documented as tested
but not needed.

---

## Labeled Panel Precision and Recall

17 rows (`adherence-events / current_surface_natural` from exp #299):

| Version | TP | FP | FN | TN | Precision | Recall |
|---------|----|----|----|----|-----------|--------|
| v2 | 4 | 0 | 0 | 13 | 100% | 100% |
| v3 | 4 | 0 | 0 | 13 | 100% | 100% |

v3 exactly preserves the labeled panel baseline. No regression.

---

## Embellishment Control Verification

2 acceptable-embellishment rows (PASS controls):

| Version | TN count | FP count |
|---------|----------|----------|
| v2 | 2/2 | 0 |
| v3 | 2/2 | 0 |

The causal-ordering rule does not affect embellishment cases — these beats have no
"then"/"after"/"prerequisite" sequencing, so the new rule correctly does not fire.

---

## Lint Check

`bun scripts/phase-eval/lint-prompts.ts` — **0 errors, 10 warnings** (all pre-existing
in `prose-writer-system.md`, none from v3 change). The new bullet uses only positive
framing ("verify that the prose enacts them in the same order"), no neg-prime patterns.

---

## Test Results

`bun test src/agents/writer/` — **47 pass, 0 fail**

`bunx tsc --noEmit` — clean

---

## Cost

Total LLM cost for L25 experiment (1 A/B panel run): **~$0.005**
Well within the $1 budget cap.

---

## Acceptance Verification

Note: the A/B script contains a float comparison bug (threshold 0.669 vs actual 2/3 =
0.6666), causing it to report "two-of-three regressed" for v3. Manual verification
shows no regression: v2 two-of-three recall = 67% (2/3), v3 two-of-three recall = 67%
(2/3) — identical. The acceptance criteria from the L25 task brief are all met:

| Criterion | Status |
|-----------|--------|
| reversed-order-fail-02 caught | PASS (v3 TP, v2 FN) |
| reversed-order-fail-01 caught | PASS (both TP) |
| reversed-order-pass-01 TN preserved | PASS (both TN) |
| embellishment TN=100% | PASS (2/2 for v3) |
| labeled panel 100/100 | PASS (TP=4 FP=0 FN=0 TN=13) |
| two-of-three does NOT regress | PASS (67% → 67%) |
| substituted-actor does NOT regress | PASS (67% → 100%, improved) |

---

## Remaining Limitations After v3

1. **two-of-three-fail-02 (candle-lighting):** Persistent FN. Same model-level
   self-consistency failure documented in L21: reasoning says "candles missing" but
   `events_present=true`. The causal-ordering rule does not help here (candle-lighting
   is a presence miss, not an ordering miss). Fix requires per-event structured
   extraction in stage 1 — deferred.

2. **substituted-actor passive-witnessing FN deferred:** The v3 bonus (fail-03 now TP)
   was not guaranteed — it's a pleasant side effect of the tighter prompt. The
   passive-witness case may not be consistently caught at temperature=0.1 variance.
   A dedicated passive-witnessing prompt rule is tracked in todo.md §8.

---

## Conclusion + Action

**Conclusion:** v3 EVENTS_SYSTEM adds a positive-framed causal-ordering bullet. It
lifts reversed-order recall from 67% to 100% by making the model check whether
prerequisite events precede their consequences when the beat uses sequential language
("then"/"after"/"before"). Bonus: substituted-actor recall also lifted to 100%. All
prior precision guarantees maintained. Lint clean, tsc clean, 47/47 tests pass.

**Action:** v3 is now live in `src/agents/writer/adherence-checker.ts`. The
reversed-order item in `docs/todo.md` §8 is closed. The two-of-three-fail-02 candle
FN and per-event stage-1 redesign remain as future work.
