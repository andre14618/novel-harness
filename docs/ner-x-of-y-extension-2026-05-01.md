---
status: active
updated: 2026-05-01
experiment: 330
phase_eval_runs: [75, 76]
---

# L15 NER X-of-Y + Number-Word-Tail Extension

**Date:** 2026-05-01  
**Experiment:** #330  
**phase_eval_runs:** 75 (small panel), 76 (expanded panel)  
**Commits:** `74171d5` (impl), `ccec328` (tests)  
**Base state:** L12 (exp #327, `fe5152d`) — 3 FNs, expanded panel F1=0.91  
**Cost:** $0.00 (deterministic — no LLM calls)

---

## 1. Objective

Close 3 FNs identified in the L12 expanded synthetic panel (exp #327) by adding two new deterministic NER extractor classes:

1. **`x-of-y-capitalized`** — spans with "X of Y" connectors (e.g. "Crown of Hyran", "Sigil of Eight")
2. **`number-word-tail`** — phrases ending in English number-words (e.g. "the Veiled Eight")

Acceptance criteria:
- All 3 L12 FNs closed (recall 83% → 100%)
- FP rate stays at 0 (or rises by ≤1)
- F1 lifts on both labeled (small) and expanded panels

---

## 2. L12 Residual FNs (Pre-Extension)

| FN | Entity | Root Cause |
|----|--------|-----------|
| `named-place-fail-02` | "Crown of Hyran" | "of" breaks consecutive-capitalization; existing suffix-class requires SUFFIX_TOKEN as last word |
| `named-artifact-fail-03` | "the Sigil of Eight" | Article-prefix + "of Eight" where "Eight" is not in suffix vocabulary |
| `plural-faction-fail-03` | "the Veiled Eight" | Article-prefix + "Veiled Eight" where "Eight" is not in suffix vocabulary; NER article-prefix filter hid the phrase |

All 3 FNs were also LLM-miss (double-miss: neither NER nor LLM caught them at T=0.1).

---

## 3. Implementation

### 3.1 `x-of-y-capitalized`

**Regex:** `/(?:(?:the|The)\s+)?[A-Z][a-z][a-zA-Z'-]*\s+of\s+[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?/g`

**Rationale:** Matches one or two Capitalized Words separated by lowercase " of ", with optional leading article "the"/"The". The X part requires at least one lowercase letter (`[a-z]` in second position) to exclude ALL-CAPS abbreviations. Y allows uppercase-initiated words with any case continuation (covers "Hyran", "Eight", "Fallen Axes", etc.). Optional article is included in the match so the full canonical phrase surfaces in telemetry.

**Examples that fire:**
- `"Crown of Hyran"` → `x-of-y-capitalized`
- `"the Sigil of Eight"` → `x-of-y-capitalized`  
- `"Order of Vesh"` → `x-of-y-capitalized`
- `"Year of Fallen Axes"` → `x-of-y-capitalized` (Y is two words)
- `"House of Mirrors"` → `x-of-y-capitalized`

**Examples that do NOT fire:**
- `"out of nowhere"` (lowercase X)
- `"part of the plan"` (lowercase X)
- `"piece of cake"` (lowercase X)

**Sentence-initial filter:** NOT applied. An "X of Y" pattern is structurally high-signal regardless of sentence position.

### 3.2 `number-word-tail`

**Regex:** Dynamic construction from `NUMBER_WORD_TOKENS` (32 items) + hyphenated composites (e.g. "Twenty-One"). Pattern: `(?:(?:the|The)\s+)?[A-Z][a-z][a-zA-Z'-]*\s+(?:TWENTY-ONE|...|EIGHT|...|HUNDRED)\b`

**Rationale:** Matches a Capitalized Word (with lowercase in 2nd position — excludes bare articles) followed by an English number-word. Hyphenated composites (Twenty-One through Ninety-Nine) are included as longer alternatives listed first. Optional leading article captured.

**Examples that fire:**
- `"the Veiled Eight"` → `number-word-tail`
- `"the Silent Twelve"` → `number-word-tail`
- `"the Broken Hundred"` → `number-word-tail`
- `"the Fallen Forty-Seven"` → `number-word-tail`

**Examples that do NOT fire:**
- `"chapter seven"` (lowercase "chapter")
- `"the forty eight"` (lowercase number words)
- `"out of nowhere"` (no number-word tail; lowercase X anyway)

**Sentence-initial filter:** NOT applied (same rationale as x-of-y-capitalized).

---

## 4. FN Closure Verification

Running the calibration script post-extension on the L12 expanded panel (`scripts/hallucination/expanded-fail-classes-panel.jsonl`):

```
=== 2x2: oracle x signal (over n=27 labeled rows) ===
  NER  : TP=18 FP=0 FN=0 TN=9 | recall=1.000 precision=1.000 F1=1.000
```

Specific FN closures verified from output JSONL:

| Entity | Class that fired | ner_fires | oracle_pass |
|--------|-----------------|-----------|-------------|
| `the Crown of Hyran` | `x-of-y-capitalized` | true | false (FAIL fixture → CAUGHT) |
| `the Sigil of Eight` | `x-of-y-capitalized` | true | false (FAIL fixture → CAUGHT) |
| `The Veiled Eight`  | `number-word-tail`   | true | false (FAIL fixture → CAUGHT) |

**FN closure count: 3/3** — all 3 L12 FNs closed.

---

## 5. F1 Deltas

### 5.1 Small Panel (labeled, `/tmp/halluc-current-panel-exp299-labeled.jsonl`)

| Metric | L4-followup-2 (exp #321) | L15 (exp #330) | Delta |
|--------|--------------------------|----------------|-------|
| TP | 9 | 10 | +1 |
| FP | 0 | 0 | 0 |
| FN | 1 | 0 | -1 |
| TN | 12 | 12 | 0 |
| Recall | 0.900 | 1.000 | +0.100 |
| Precision | 1.000 | 1.000 | 0 |
| F1 | 0.947 | 1.000 | **+0.053** |

The +1 TP on the small panel came from `the Vault of Witnesses` (oracle FAIL row: `NER-WIN cs-598-novel-1777670460355-c1-b9-a1`) — the x-of-y-capitalized class fires on "Vault of Witnesses" in that prose. This was a pre-existing FN that L15 also closes as a side effect.

### 5.2 Expanded Synthetic Panel (L12 panel, 27 fixtures)

| Metric | L12 (exp #327) | L15 (exp #330) | Delta |
|--------|----------------|----------------|-------|
| TP | 15 | 18 | +3 |
| FP | 0 | 0 | 0 |
| FN | 3 | 0 | -3 |
| TN | 9 | 9 | 0 |
| Recall | 0.833 | 1.000 | **+0.167** |
| Precision | 1.000 | 1.000 | 0 |
| F1 | 0.909 | 1.000 | **+0.091** |

### 5.3 Summary

| Panel | Pre-L15 F1 | Post-L15 F1 | Delta |
|-------|------------|-------------|-------|
| Small (labeled, n=22) | 0.947 | 1.000 | +0.053 |
| Expanded synthetic (n=27) | 0.909 | 1.000 | +0.091 |

---

## 6. FP Regression Check

- **Small panel FP count: 0** (same as pre-L15)
- **Expanded panel FP count: 0** (same as pre-L15)
- 9 PASS controls in the expanded panel: all 9 correctly NOT fired

The `x-of-y-capitalized` class could theoretically fire on generic phrases like "part of the group" (lowercase) — but the regex requires `[A-Z][a-z]` as the X word start, which excludes lowercase-initial words. Edge case: "King of England" would fire (capitalized proper construct) — this is intentional; it is a real proper-noun candidate and the grounded-surface check would suppress it if "England" appears in the bible.

---

## 7. Test Coverage

- **Pre-L15:** 47 tests
- **Post-L15:** 80 tests (+33)
  - 11 new tests for `x-of-y-capitalized` (positives, negatives, italics guard, offset invariant, normalization symmetry)
  - 11 new tests for `number-word-tail` (positives, negatives, italics guard, offset invariant, normalization symmetry)
  - 5 regression guard tests (existing sentence-initial filter behavior unchanged for capitalized-multi-word and suffix-class)
  - 1 updated "class field" test to cover all 5 classes
  - 5 exported helper tests (NUMBER_WORD_TOKENS, xOfYCapitalizedRegex, numberWordTailRegex)
- All 80 tests pass; 0 TypeScript errors (`bunx tsc --noEmit` clean)

---

## 8. Cost

**$0.00** — deterministic-only implementation. No LLM calls in this loop.
NER calibration script (`ner-vs-llm-calibration.ts`) is also deterministic (no LLM calls).

---

## 9. Conclusion + Action

**Conclusion:** The two new extractor classes close all 3 L12 FNs deterministically, lifting recall on both panels to 100% with FP=0. The `x-of-y-capitalized` class also closed a 4th pre-existing FN on the small panel (`the Vault of Witnesses`) as a side effect. F1 on both panels is now 1.000.

**Action:**
- The NER extractor is now at recall=1.000 / precision=1.000 on both calibration panels. The remaining work in §7 is:
  1. Asymmetric voting policy evaluation (NER fire = auto blocker for confirmed classes) — deferred per L12 recommendation until NER coverage was complete. Now unblocked.
  2. v4 halluc-ungrounded prompt work (L14) — ongoing in parallel.
  3. NER telemetry persistence (L16) — ongoing in parallel.
- NER remains TELEMETRY-ONLY in production. Promotion to strict blocker requires the asymmetric voting policy decision.

---

## Appendix: Calibration Run Commands

```
# Small panel
bun scripts/hallucination/ner-vs-llm-calibration.ts \
  --in /tmp/halluc-current-panel-exp299-labeled.jsonl \
  --out /tmp/ner-calibration-postL15-small-20260502T044505.jsonl \
  --persist --exp-id 330 --variant-label ner-postL15-small

# Expanded panel
bun scripts/hallucination/ner-vs-llm-calibration.ts \
  --in scripts/hallucination/expanded-fail-classes-panel.jsonl \
  --out /tmp/ner-calibration-postL15-expanded-20260502T044511.jsonl \
  --persist --exp-id 330 --variant-label ner-postL15-expanded
```

Results at (on LXC):
- `/tmp/ner-calibration-postL15-small-20260502T044505.jsonl`
- `/tmp/ner-calibration-postL15-expanded-20260502T044511.jsonl`
