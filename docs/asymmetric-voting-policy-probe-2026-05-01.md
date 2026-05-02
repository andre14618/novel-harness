---
status: concluded
updated: 2026-05-01
role: result-doc
loop: L19
experiment: 336
phase_eval_runs: [78]
verdict: KEEP-AND-GATE-V1
---

# L19 — Asymmetric Voting Policy Probe (2026-05-01)

**Date:** 2026-05-01  
**Experiment:** #336  
**phase_eval_runs:** 78  
**Script:** `scripts/hallucination/asymmetric-voting-probe.ts`  
**Output JSONL:** `/tmp/asym-voting-probe-20260502T011416.jsonl` (on LXC)  
**Cost:** ~$0.01–$0.02 (294 DeepSeek calls; heavy prefix cache hit; logged in `runs.id=627`)  
**Duration:** 15 seconds

---

## 1. Objective

Evaluate 4 voting policies for `halluc-ungrounded` on two panels, now that NER F1=1.000 on both calibration panels (L15, exp #330). The "fix NER first" precondition is satisfied.

**Research question:** Does an asymmetric policy (NER alone blocks + tuned LLM threshold) improve recall or precision over the current AND-gate-v1 production policy?

---

## 2. Policies Evaluated

| Policy | Description | LLM calls/beat |
|--------|-------------|---------------|
| **AND-gate-v1 (current)** | NER∩LLM-T01=blocker; NER-only=warning(fail); LLM-only=blocker | 1 @ T=0.1 |
| **Asym-A (high-precision)** | NER alone blocks; LLM T=0.5 ≥3-of-5=blocker; 1-2-of-5=warning(fail); 0-of-5=LLM-pass | 5 @ T=0.5 |
| **Asym-B (high-recall)** | NER alone blocks; LLM T=0.5 ≥2-of-5=blocker; 1-of-5=warning(fail); 0-of-5=LLM-pass | 5 @ T=0.5 |
| **Asym-C (NER + single-call)** | NER alone blocks; LLM T=0.1 single=blocker | 1 @ T=0.1 |

"NER alone blocks" = if NER fires, declare fail regardless of LLM. Asym-C differs from AND-gate-v1 in that NER-alone is a **hard blocker** rather than a warning — but in practice the distinction collapses on this panel (all NER fires have oracle_pass=false).

---

## 3. Panels

| Panel | Rows | Oracle FAIL | Oracle PASS | Notes |
|-------|------|-------------|-------------|-------|
| Labeled (`/tmp/halluc-current-panel-exp299-labeled.jsonl`) | 22 | 10 | 12 | 17 natural + 5 synthetic; adjudicated by Sonnet subagents |
| Expanded synthetic (`expanded-fail-classes-panel.jsonl`) | 27 | 18 | 9 | 6 classes × 3 FAIL + 9 pass controls |
| **Combined** | **49** | **28** | **21** | — |

---

## 4. Policy Comparison Matrix

### Labeled panel (natural-mixed, n=22 oracle-labeled)

| Policy | TP | FP | FN | TN | Recall | Precision | F1 |
|--------|:--:|:--:|:--:|:--:|-------:|----------:|---:|
| AND-gate-v1 (current) | 10 | 6 | 0 | 6 | **1.000** | 0.625 | **0.769** |
| Asym-A (NER + LLM≥3-of-5) | 10 | 10 | 0 | 2 | **1.000** | 0.500 | 0.667 |
| Asym-B (NER + LLM≥2-of-5) | 10 | 10 | 0 | 2 | **1.000** | 0.500 | 0.667 |
| Asym-C (NER + T=0.1 single) | 10 | 6 | 0 | 6 | **1.000** | 0.625 | **0.769** |

### Expanded synthetic panel (n=27 oracle-labeled)

| Policy | TP | FP | FN | TN | Recall | Precision | F1 |
|--------|:--:|:--:|:--:|:--:|-------:|----------:|---:|
| AND-gate-v1 (current) | 18 | 0 | 0 | 9 | **1.000** | **1.000** | **1.000** |
| Asym-A | 18 | 0 | 0 | 9 | **1.000** | **1.000** | **1.000** |
| Asym-B | 18 | 0 | 0 | 9 | **1.000** | **1.000** | **1.000** |
| Asym-C | 18 | 0 | 0 | 9 | **1.000** | **1.000** | **1.000** |

### Combined (n=49 oracle-labeled)

| Policy | TP | FP | FN | TN | Recall | Precision | **F1** |
|--------|:--:|:--:|:--:|:--:|-------:|----------:|------:|
| **AND-gate-v1 (current)** | 28 | **6** | 0 | 15 | **1.000** | **0.824** | **0.903** |
| Asym-A | 28 | 10 | 0 | 11 | 1.000 | 0.737 | 0.848 |
| Asym-B | 28 | 10 | 0 | 11 | 1.000 | 0.737 | 0.848 |
| **Asym-C** | 28 | **6** | 0 | 15 | **1.000** | **0.824** | **0.903** |

**AND-gate-v1 and Asym-C are co-equal on combined panel (F1=0.903).** Asym-A and Asym-B REGRESS vs current production (F1=0.848, −0.055 absolute).

---

## 5. Per-Class Breakdown (Expanded Synthetic Panel)

All 7 fixture classes (title-surname, named-institution, named-place-realm, named-artifact, named-historical-event, plural-faction, generic-document-fp-control): **all 4 policies score identically** on every class. F1=1.000 across all 6 FAIL classes; FP=0 on all 9 pass controls. NER handles all expanded-panel FAIL classes deterministically and the LLM policies add no value on top of it.

---

## 6. Root Cause Analysis

### Why asymmetric policies don't help

**Key finding: NER fires on 100% of oracle-FAIL rows on the labeled panel** (10/10) and 100% of oracle-FAIL rows on the expanded panel (18/18). Since NER already achieves perfect recall, there is no recall gap for LLM policies to fill. The asymmetric policies (A and B) actually **worsen precision** by adding 4 extra FPs (T=0.5 LLM stochastic fires on oracle-PASS natural rows where NER correctly passes).

### NER fires on labeled panel oracle-PASS rows

| Metric | Count |
|--------|-------|
| Oracle PASS rows | 12 |
| NER fires on oracle PASS | **0** |
| LLM T=0.1 fires on oracle PASS | 6 |
| LLM T=0.5 (≥1 vote) on oracle PASS | 10 |
| LLM T=0.5 (≥2 votes) on oracle PASS | 7 |
| LLM T=0.5 (≥3 votes) on oracle PASS | 6 |

NER precision on oracle-PASS: **12/12 = 100%**. LLM at T=0.1 single-call fires on 6/12 PASS rows (50% FP rate). LLM at T=0.5 is even noisier.

### The 6 labeled-panel FPs are a systematic LLM failure class

All 6 AND-gate-v1 / Asym-C FPs are NER=false, LLM=FIRE. They cluster on beat b12 and are the "generic document type" pattern identified in L14 (exp #329): categorical descriptors like "the reconciliation report", "the quarterly audit" trigger the LLM checker but not NER. This is an LLM prompt failure, not a voting-policy gap. The fix path is L14-style prompt disambiguation, not policy tuning.

### Asym-A vs AND-gate-v1 on oracle-PASS rows

Asym-A/B add 4 FPs vs AND-gate-v1 because T=0.5 multi-call LLM has higher stochastic fire rates on clean natural prose. The 1-2-of-5 "warning" votes fire on rows that T=0.1 correctly passes, turning TN → FP.

---

## 7. Cost Per Policy (Production Estimate)

| Policy | LLM calls/beat | Relative cost vs current |
|--------|---------------|--------------------------|
| AND-gate-v1 (current) | 1 @ T=0.1 | 1× |
| Asym-A | 5 @ T=0.5 | 5× |
| Asym-B | 5 @ T=0.5 | 5× |
| Asym-C | 1 @ T=0.1 | 1× (same) |

Asym-A and Asym-B cost 5× per beat for worse F1. No cost justification.

Probe cost: ~$0.01–$0.02 for 294 calls (heavy cache; individual call cost ≈$0.0000). Well under $1.50 cap.

---

## 8. Recommendation

**KEEP AND-GATE-V1. Do not promote any asymmetric policy.**

Detailed reasoning:

1. **No recall gap to fill.** NER fires on 100% of oracle-FAIL rows on both panels post-L15. The motivation for asymmetric policies was that NER would lift recall where LLM misses; on the current calibration panels, NER already achieves recall=1.000. There is no hallucination class where a higher-threshold LLM vote adds sensitivity.

2. **Asym-A/B worsen precision.** The T=0.5 multi-call LLM adds stochastic FPs on oracle-PASS natural prose. F1 regresses from 0.903 → 0.848 on the combined panel (−0.055 absolute). The cost is 5× per beat for worse results.

3. **Asym-C = AND-gate-v1 in practice.** Both score identically (F1=0.903 combined). Asym-C differs only in that NER-alone is labeled "blocker" instead of "warning", but since all NER fires in the current labeled panel are true positives, the practical effect is identical. There's no value in the label distinction.

4. **The 6 FPs are a prompt problem, not a policy problem.** The residual 6 FPs (generic document types) are immune to voting policy changes — they don't fire on NER, so NER-blocking can't suppress them. They do fire on LLM at any threshold T=0.1 or T=0.5. The fix is LLM prompt work (L14 direction: explicit disambiguation of categorical descriptors).

**Proposed L20 follow-up (if precision on natural panel is a priority):**

Rather than a voting policy change, the correct lever is LLM prompt improvement targeting the b12 generic-document-type FP cluster. L14 (exp #329) identified the root cause; the follow-up would be: A/B the v4 disambiguation additions explicitly on the 6 FP rows, confirm suppression, then measure recall regression. This is a prompt tuning loop, not a policy loop.

---

## 9. Persisted Evidence

| Run | phase_eval_runs.id | Verdict |
|-----|-------------------|---------|
| L19 combined | **78** | `KEEP-AND-GATE-V1` |

Tracking experiment: `tuning_experiments.id=336`, concluded: "KEEP-AND-GATE-V1: None of the asymmetric policies improves over current AND-gate-v1. NER already achieves recall=1.000 on all oracle-FAIL rows so there is no recall gap for asymmetric LLM policies to fill."

Per-row JSONL: `/tmp/asym-voting-probe-20260502T011416.jsonl` (on LXC)  
Probe script: `scripts/hallucination/asymmetric-voting-probe.ts`

---

## 10. Caveats

1. **Labeled panel is small (n=22).** 10 oracle FAIL rows. The 100% NER recall finding is strong on the calibration panels but the synthetic panel is NER-friendly by construction (all FAIL classes are NER-detectable post-L15). A natural-adjudicated panel with novel entity classes could reveal a gap.

2. **The 6 LLM FPs survived all 5 T=0.5 calls.** They are not stochastic noise — they are systematic LLM errors on the generic-document-type class. A voting policy could theoretically increase the threshold to suppress them (e.g., require 5-of-5), but that would also suppress legitimate hallucinations with moderate LLM confidence.

3. **Asym-C isn't meaningfully different from AND-gate-v1 on these panels.** The distinction (NER-alone=hard-blocker vs NER-alone=warning) would matter only for a row where NER fires but LLM passes — and all such rows in the labeled panel are oracle FAIL (NER is correct). If a future natural panel has NER FPs (currently 0), this distinction would matter.
