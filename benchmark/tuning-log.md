# Benchmark Tuning Log

Results from probe tests run 2026-04-01 to find the right judge model, rubric style, and dimensions for the prose benchmark.

## 1. Rubric Style A/B Test (`rubric-ab-test.ts`)

**Question:** Does a count-based rubric produce more discrimination than a vibes-based 1-10 rubric?

**Setup:** Qwen3 32B judging Show/Tell on WEAK/MID/STRONG samples, 3 runs each. Two rubric variants:
- VIBES: original 1-10 rubric with band descriptions
- COUNTED: rubric requiring the judge to count telling/showing indicators before scoring

**Results:**
```
           VIBES              COUNTED
WEAK       2.0 [2,2,2]        4.0 [3,5]
MID        8.3 [9,8,8]        8.0 [8,8,8]
STRONG     8.3 [8,8,9]        8.0 [8,8]
```

**Conclusion:** Neither rubric discriminates MID from STRONG. Both cluster at 8. The counted rubric was less reliable (2 HTTP 400 failures, inconsistent on WEAK). The 1-10 scoring paradigm is the problem, not the rubric wording. 32B judges compress anything competent into 7-9.

---

## 2. Dimension Probe (`probe-dimensions.ts`)

**Question:** Are there quality dimensions where Qwen3 32B can actually tell MID from STRONG?

**Setup:** 6 candidate dimensions (Sentence Rhythm, Metaphor Originality, Prose Density, Tension & Pacing, Character Interiority, Micro-Detail Precision), 1-10 scoring, 3 runs each.

**Results:**
```
Dimension                MID              STRONG           Gap
Micro-Detail Precision   8.0 [7,9,8]      9.0 [9,9,9]      +1.0
Sentence Rhythm          8.3 [8,9,8]      8.7 [9,8,9]      +0.3
Metaphor Originality     8.0 [8,8,8]      8.0 [7,8,9]      0.0
Prose Density            9.0 [9,9,9]      9.0 [9,9,9]      0.0
Tension & Pacing         9.0 [9,9,9]      9.0 [9,9,9]      0.0
Character Interiority    8.3 [8,8,9]      8.0 [9,7,8]      -0.3
```

**Conclusion:** 32B cannot discriminate MID from STRONG on any dimension using 1-10 scoring. Micro-Detail showed the only gap (+1.0) but with overlap. This confirmed that 1-10 scoring is fundamentally broken for detecting quality differences within the "competent" tier.

---

## 3. Penalty Dimension Probe (`probe-penalties.ts`)

**Question:** Can we get better signal by asking judges to find specific problems (issue counts) rather than rating quality?

**Setup:** 6 penalty rubrics (Overwrought, Repetition, Psychic Distance, Telling, Dead Weight, Dialogue Problems) with Qwen3 32B, 3 runs each. Score = issue count (lower = better prose).

**Results:**
```
Dimension            WEAK             MID              STRONG           MID-STRONG gap
Overwrought          0.7 [0,0,2]      3.0 [2,5,2]      5.0 [2,9,4]      -2.0 (inverted!)
Repetition           3.3 [5,2,3]      2.0 [0,5,1]      2.0 [2]          0.0
Psychic Distance     1.3 [2,2,0]      1.0 [3,0,0]      1.7 [4,1,0]      -0.7 (inverted)
Telling              10.7 [11,10,11]  3.0 [3,4,2]      5.3 [4,6,6]      -2.3 (inverted)
Dead Weight          9.0 [10,10,7]    4.0 [4,5,3]      3.0 [6,0,3]      +1.0
Dialogue Problems    2.3 [3,1,3]      1.0 [2,0]        0.3 [0,0,1]      +0.7
```

**Conclusion:** Penalty approach shows more signal than 1-10, but 32B has problems:
- Overwrought flags STRONG *worse* than MID (ornate literary prose misread as "trying too hard")
- Telling inverted MID/STRONG (STRONG is longer = more surface area for false positives)
- Dead Weight and Dialogue correctly order all 3 tiers
- Samples were not length-normalized, biasing raw counts

Key insight: **issue-count scoring + narrow rubrics is the right paradigm, but needs a stronger model and normalized samples.**

---

## 4. Judge Model Shootout (`judge-shootout.ts`)

**Question:** Which model handles penalty rubrics best? Can cheaper models do it?

**Setup:** 7 models tested on 3 rubrics (Telling, Dead Weight, Dialogue) with length-normalized WEAK/MID/STRONG (~400-440 words each), 3 runs.

**Results:**
```
TELLING:
Llama 3.1 8B (groq)       12.0 [14,13,9]   7.7 [7,9,7]     8.7 [8,11,7]    NO
Llama 3.1 8B (cerebras)    FAIL             FAIL             10.3 [8,13,10]  N/A
GPT-OSS 20B (groq)         19.0 [19,19,19]  3.0 [3]          0.5 [1,0]       YES clean
Llama 4 Scout (groq)       14.7 [15,14,15]  4.7 [5,5,4]      5.0 [5,5,5]     NO
GPT-OSS 120B (groq)        18.0 [17,19,18]  3.7 [3,4,4]      2.3 [3,2,2]     YES overlap
GPT-OSS 120B (cerebras)    16.7 [18,15,17]  3.7 [3,4,4]      2.3 [2,4,1]     YES overlap
Qwen3 32B (groq)           24.3 [23,26,24]  4.0 [4,5,3]      4.0 [3,2,7]     NO

DEAD WEIGHT:
GPT-OSS 120B (groq)        7.0 [7,4,10]    2.7 [4,1,3]      2.3 [3,2,2]     YES overlap
GPT-OSS 120B (cerebras)    5.0 [5,4,6]     4.3 [3,5,5]      2.3 [2,2,3]     YES overlap
Others: NO or N/A

DIALOGUE:
GPT-OSS 120B (groq)        3.0 [3,3,3]     2.7 [3,4,1]      1.0 [3,0,0]     YES overlap
Others: NO
```

**Conclusions:**
- **GPT-OSS 120B (Groq) is the best judge.** Only model that discriminates on all 3 rubrics. $0.15/$0.60 per M tokens — cheaper than Qwen3 32B.
- **Llama 8B**: too noisy, FAILs on Cerebras, can't order MID/STRONG. Not viable.
- **GPT-OSS 20B**: amazing on Telling (clean!) but constant FAILs on other rubrics. Too fragile.
- **Scout 17B**: produces suspiciously identical scores (9,9,9) — doesn't actually read the prose.
- **Qwen3 32B**: inverts MID/STRONG on Dead Weight. Not reliable for penalties.
- **Cerebras vs Groq** for 120B: similar accuracy, Groq is cheaper.

---

## 5. GPT-OSS 120B Extended Probe (`probe-120b.ts`)

**Question:** Can 120B handle more complex/nuanced penalty dimensions that 32B couldn't?

**Setup:** 5 new dimensions (Overwrought, Repetition, Psychic Distance, Generic Detail, Pacing Stalls) with GPT-OSS 120B on normalized samples, 3 runs.

**Results:**
```
Dimension            WEAK             MID              STRONG           W>M>S?  Gap    Spread
Overwrought          4.0 [4,4,4]      3.7 [3,4,4]      3.3 [4,2,4]      YES    +0.3   +-2
Repetition           3.7 [4,3,4]      1.7 [2,1,2]      1.0 [1,1,1]      YES    +0.7   +-1 (clean!)
Psychic Distance     2.0 [2,2,2]      1.3 [2,1,1]      3.0 [4,2,3]      NO     -1.7   (inverted)
Generic Detail       7.0 [6,10,5]     6.7 [6,9,5]      2.0 [4,1,1]      YES    +4.7   +-5 (noisy)
Pacing Stalls        4.0 [5,3,4]      2.3 [2,3,2]      2.0 [2,3,1]      YES    +0.3   +-2
```

**Conclusions:**
- **Repetition**: best new dimension. Clean ordering, tight consistency (+-1), actionable issues.
- **Generic Detail**: huge gap (+4.7) but wildly inconsistent (+-5). Needs rubric tightening or more runs.
- **Overwrought/Pacing Stalls**: technically discriminate but gap is only 0.3 — within noise.
- **Psychic Distance**: inverted (STRONG scored worse). The concept may be too subjective for any model.

---

## 6. Gemini 3.1 Flash Lite Probe (`probe-gemini-lite.ts`)

**Question:** Can the ultra-cheap Gemini 3.1 Flash Lite work as a penalty judge?

**Result:** HTTP 404 on every call. OpenRouter has no active endpoints for `google/gemini-3.1-flash-lite-preview` as of 2026-04-01.

Also confirmed GPT-OSS 120B consistency in this run:
```
TELLING:    WEAK 16.0 [16,16,16]  MID 3.7 [4,3,4]   STRONG 3.0 [3,4,2]   YES
DEAD WEIGHT: WEAK 6.0 [6,6,6]    MID 3.0 [2,2,5]    STRONG 2.3 [3,2,2]   YES
DIALOGUE:   WEAK 2.3 [3,1,3]     MID 4.0 [4,4,4]    STRONG 1.7 [2,2,1]   NO (inverted)
REPETITION: WEAK 1.3 [2,1,1]     MID 1.7 [0,3,2]    STRONG 1.0 [0,2,1]   NO (inverted)
```

**Conclusion:** Dialogue and Repetition are unreliable even with 120B — they invert across runs. Only Telling and Dead Weight are consistently reliable.

---

## Summary: Final Benchmark Configuration

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Writer** | Qwen3 32B (Groq) | Fast, cheap, good enough for iteration |
| **Judge** | GPT-OSS 120B (Groq) | Only model that reliably discriminates on penalty rubrics |
| **Scoring** | Issue counts (lower = better) | 1-10 scoring can't detect quality differences within "competent" tier |
| **Dimension: Telling** | RELIABLE | 16→3.7→3.0 across tiers, consistent across runs |
| **Dimension: Dead Weight** | RELIABLE | 6.0→3.0→2.3 across tiers, mostly consistent |
| **Dimension: Dialogue** | UNRELIABLE | Inverts MID/STRONG in some runs |
| **Dimension: Repetition** | PROMISING | Clean with 120B probe but inverted in confirmation run |
| **Seeds** | 5 (dark-fantasy, minimal, romance-drama, sci-fi-thriller, young-adult-fantasy) | Genre coverage without over-capturing |
| **Runs per seed** | 3 | Balances consistency signal vs cost |
| **Cost per cycle** | ~$0.058 | 60 LLM calls (15 writer + 45 judge) |

### Baseline (Run 12)
```
Telling:        5.8 issues (+-2.4)
Dead Weight:    2.1 issues (+-1.4)
Dialogue:       2.1 issues (+-1.9)
TOTAL:          3.3 issues/dim (+-2.6)
```

---

## 7. Prompt Engineering Sweep — Qwen3 32B (`batch-1-prompts.ts`, Experiment #4)

**Question:** Which prompting strategy reduces telling most?

**Setup:** 5 prompt variants, 5 seeds × 2 runs, GPT-OSS 120B judge, Qwen3 32B writer.

**Results:**
```
Variant                  Telling    Dead Weight   Dialogue    OVERALL
A2: positive-only        5.1        2.0           2.0         3.0  ← BEST
A3: examples             5.8        2.3           1.8         3.2
A5: role-framing         5.8        3.8           1.5         3.5
A1: current (NEVER)      6.0        1.9           2.8         3.5
A4: minimal (no rules)   6.2        2.0           2.2         3.5
```

**Conclusions:**
- Positive instructions ("show through physical reactions") beat prohibitions ("NEVER summarize")
- Examples in prompt had no effect on telling (5.8, same as baseline)
- Role-framing ("award-winning writer") caused more verbose prose (dead weight: 3.8)
- Minimal/no rules was worst — the model needs guidance
- A2 wins on telling AND overall with no regressions

---

## 8. Temperature Sweep — Qwen3 32B (`batch-2-temperature.ts`, Experiment #5)

**Question:** Does temperature affect telling with the A2 prompt?

**Setup:** T=0.6, 0.8, 1.0 with A2 positive-only prompt, 5 seeds × 2 runs.

**Results:**
```
Temp    Telling    Dead Weight   Dialogue    OVERALL
0.6     7.4        1.8           3.9         4.4  ← WORST (rigid patterns)
0.8     5.7        1.6           3.0         3.4  ← BEST
1.0     5.7        3.4           2.6         3.9
```

**Conclusion:** T=0.8 is optimal. Lower temperature makes telling worse (model falls into defaults more rigidly). Higher adds dead weight.

---

## 9. Context Structure Sweep — Qwen3 32B (`batch-3-context.ts`, Experiment #6)

**Question:** Do "Emotional shift" labels in scene beats cause telling?

**Setup:** 3 context variants (emotional labels, no labels, physical cues), A2 prompt, T=0.8.

**Results:**
```
Variant                  Telling    Dead Weight   Dialogue    OVERALL
C1: emotional labels     4.6        1.8           2.5         3.0  ← BEST telling
C2: no labels            4.9        2.4           1.4         2.9
C3: physical cues        5.5        2.8           2.7         3.7  ← WORST
```

**Conclusions:**
- Emotional labels do NOT cause telling — removing them doesn't help
- Physical cues make prose more verbose (model tries to incorporate specific behaviors)
- Keep current context structure

---

## 10. Multi-Pass Writing Tests (Experiments #2, #3)

**Question:** Does a polish/rewrite pass improve quality?

**Setup:** Single-pass vs two-pass (write→polish), tested with both 32B and 235B polish models.

**Results (Experiment #2, 32B polish):**
```
A: 32B single     T:5.3  W:2.5  D:2.3  Overall:3.4
B: 32B→32B polish T:6.3  W:2.9  D:2.2  Overall:3.8  ← WORSE
```

**Results (Experiment #3, 235B polish):**
```
A: 32B single       T:4.4  W:1.2  D:2.0  Overall:2.3  ← BEST overall
B: 32B→235B polish  T:4.2  W:2.6  D:3.0  Overall:3.3  ← WORSE
C: 235B single      T:2.6  W:2.7  D:3.5  Overall:2.9
```

**Conclusions:**
- Rewrite passes consistently make things worse — the rewriting model introduces new issues
- 235B has best telling (2.6) but worst dialogue (3.5) and worse dead weight (2.7 vs 1.2)
- 32B is best overall (2.3) due to lean prose
- Multi-pass approach is not viable with current models

---

## 11. Kimi K2 Prompt Engineering Sweep (Experiment #7)

**Question:** Does K2 respond differently to prompt strategies than Qwen3 32B?

**Setup:** Same 5 prompt variants as Batch 1, but with Kimi K2 (1T MoE, 32B active) on Groq.

**Results:**
```
Variant                  Telling    Dead Weight   Dialogue    OVERALL
A3: examples             4.0        1.4           5.3         3.6  ← BEST telling
A2: positive-only        4.6        3.0           3.6         3.7
A4: minimal              4.8        1.8           4.9         3.8
A1: current (NEVER)      4.9        1.8           4.0         3.6
A5: role-framing         5.6        2.9           6.1         4.8  ← WORST
```

**Conclusions:**
- K2 responds to **different** prompts than 32B. A3 (examples) won for K2 but had no effect on 32B.
- K2 has inherently lower telling (4.0-4.9 range vs 32B's 5.1-6.2 range)
- K2 has a serious dialogue problem (4.0-6.1 range vs 32B's 1.5-2.8 range)
- Role-framing (A5) is worst on both models — consistently causes verbosity

---

## 12. Quality (1-10) vs Penalty Scoring Comparison (Experiment #8)

**Question:** Do 1-10 quality rubrics with GPT-OSS 120B discriminate between K2 and Qwen3 32B?

**Setup:** Both models on 3 seeds × 2 runs, judged by GPT-OSS 120B on BOTH the old 1-10 rubrics (Show/Tell, Dialogue, Sensory) AND the penalty rubrics (Telling, Dead Weight, Dialogue Problems).

**Results — Quality (1-10, higher = better):**
```
Writer           Show/Tell   Dialogue   Sensory   AVG
Qwen3 32B        6.4         6.4        7.8       6.9
Kimi K2          6.0         6.7        8.0       6.9
```

**Results — Penalty (issue counts, lower = better):**
```
Writer           Telling   Dead Weight   Dialogue Probs   AVG
Qwen3 32B        6.8       3.2           1.8              3.9
Kimi K2          4.7       2.3           7.5              4.8
```

**Conclusions:**
- **1-10 quality scores are identical (6.9 vs 6.9)** — GPT-OSS 120B with 1-10 rubrics cannot discriminate between models, same clustering problem as Qwen3 32B judge
- Penalty scores DO show differences but measure problems, not quality
- K2's "dialogue problems" score (7.5) is misleading — K2 writes much more dialogue with more subtext, giving the judge more surface area to flag
- **1-10 absolute scoring is fundamentally broken** for comparing models or detecting quality improvements, regardless of judge model

---

## 13. Human Prose Comparison (not in DB — qualitative assessment)

**Method:** Generated fresh dark-fantasy and romance-drama chapters from both models, read them side by side.

**Qwen3 32B characteristics:**
- Shorter output (~700-900w)
- Lean, efficient prose
- Narrator commentary and emotional declarations ("Her mind raced with calculations", "There would be no room for fear or doubt")
- Dialogue is functional but on-the-nose — characters explain plot to each other
- Less ambitious, fewer risks, fewer errors

**Kimi K2 characteristics:**
- Longer output (~1000-1600w)
- More specific and surprising physical details ("teeth turned translucent as glass", "bare feet left wet prints though rain hadn't fallen in weeks")
- Dialogue has genuine subtext and character voice differentiation ("Your customers wouldn't know duck confit if it bit them")
- More ambitious scene construction, takes creative risks
- Occasionally verbose, more dialogue = more opportunities for flagged issues

**Verdict:** K2 produces objectively better fiction. The benchmark penalty scores favor 32B because it writes less text with less ambition — fewer opportunities for issues, but also less interesting prose.

---

## 14. Research: How Others Evaluate Fiction Quality

**Sources reviewed:** EQ-Bench Creative Writing, lechmazur/writing benchmark, LitBench (arxiv 2507.00769), WritingBench (arxiv 2503.05244), HANNA benchmark, G-EVAL, LLM-as-Judge survey (arxiv 2411.15594).

### Key Findings

**Absolute 1-10 scoring fails universally for quality discrimination.** Every major benchmark has found that LLM judges cluster scores at 7-8 for anything competent. This is not a rubric problem or a model problem — it's fundamental to how LLMs process evaluation scales.

**Pairwise comparison is the standard solution.** EQ-Bench and Chatbot Arena both use pairwise matchups (A vs B: which is better?) to build Elo/Glicko-2 rankings. This reliably discriminates quality levels that absolute scoring cannot.

**But pairwise has limitations for our use case:**
- O(n²) comparisons for ranking (expensive)
- Tells you "A is better than B" but not "how to write better" — doesn't provide actionable feedback to the writer agent
- Not suitable as a continuous improvement signal in a pipeline

**Other techniques worth considering:**
- **Power mean (p=0.5)** from lechmazur: penalizes weaknesses disproportionately, spreads score distribution. One-line math change.
- **Dynamic per-chapter rubrics** from WritingBench: generate evaluation criteria specific to each scene type. 84% human alignment vs 67% for static rubrics.
- **Panel of LLM judges (PoLL):** 3 small models > 1 large model for evaluation reliability.
- **Anchor examples in rubrics:** showing pre-graded "3" and "8" examples calibrates the judge's scale.

### Practical Conclusion

The evaluation system should be split:
1. **Deterministic flagging** (regex/rules) for known bad patterns — free, instant, feeds the rewriter with specific fix instructions. A regex for "she felt", "he realized", "it was clear that" catches the same telling issues as an LLM penalty judge.
2. **Pairwise LLM comparison** only at decision points — "should we adopt prompt A or B?" Not every iteration.
3. **The actual improvement lever is the writer agent itself** — prompt design, context assembly, model selection. Not the evaluation system.

### Reference Links
- [EQ-bench/creative-writing-bench](https://github.com/EQ-bench/creative-writing-bench)
- [lechmazur/writing](https://github.com/lechmazur/writing)
- [WritingBench](https://github.com/X-PLUG/WritingBench) / [paper](https://arxiv.org/abs/2503.05244)
- [LitBench](https://arxiv.org/abs/2507.00769)
- [G-EVAL](https://arxiv.org/abs/2303.16634)
- [LLM-as-Judge survey](https://arxiv.org/abs/2411.15594)
- [Prometheus-eval](https://github.com/prometheus-eval/prometheus-eval)

---

## Best Configuration Found (as of end of session)

| Parameter | Value | Evidence |
|-----------|-------|----------|
| **Writer model** | Kimi K2 (Groq) — better prose quality | Exp #7, #8, #13: less telling, better detail, stronger dialogue subtext |
| **Writer prompt** | A2: positive-only (32B) / A3: examples (K2) | Exp #4, #7: different models respond to different strategies |
| **Temperature** | 0.8 | Exp #5: 0.6 and 1.0 both worse |
| **Context structure** | Keep emotional labels | Exp #6: removing/replacing labels doesn't help |
| **Multi-pass** | No — single pass only | Exp #2, #3: polish passes degrade quality |
| **Issue detection** | Should be deterministic (regex), not LLM | Finding #14: regex catches same patterns as LLM penalty judge, for free |
| **Quality assessment** | Pairwise comparison at decision points only | Finding #14: absolute 1-10 scores don't discriminate |
| **Penalty judge** | GPT-OSS 120B (Groq) | Shootout: only reliable discriminator (but may be replaceable by regex) |

## Architecture Direction (emerging from experiments)

The evaluation system should separate into:

1. **Deterministic issue flagging** — regex/rules for filter words, narrator commentary patterns, declared emotions. Free, instant, consistent. Feeds the rewriter agent with specific fix instructions.

2. **Pairwise LLM comparison** — "which of these two passages is better?" Used only for A/B testing (comparing models, prompt variants, config changes). Not for continuous pipeline evaluation.

3. **Writer agent improvement** — the actual lever. Prompt design (positive techniques > prohibitions), context assembly, model selection. The evaluation system measures; the agent config is what actually improves.

## Open Questions

- Should the penalty benchmark be replaced entirely by deterministic flagging + pairwise comparison?
- K2 writes better prose but costs more ($1/$3 vs $0.29/$0.59). Is the quality difference worth 3-5x cost?
- K2's dialogue "problem" score is an artifact of writing more dialogue — how do we normalize for output length?
- Can we combine K2's prose quality with deterministic issue detection to get the best of both?
- Which other models should we test? (DeepSeek V3.2, GPT-4.1-mini, etc.)

## Experiment Index

| # | Type | Description | Key Finding |
|---|------|-------------|-------------|
| 1 | message-order | Prose-before-rubric ordering | No quality change, enables caching |
| 2 | ab-test | Single-pass vs 32B→32B polish | Rewrite passes make things worse |
| 3 | model-ab | 32B vs 235B vs 32B→235B polish | 235B better telling, worse dead weight |
| 4 | experiment | Prompt engineering sweep (32B) | A2 positive-only wins |
| 5 | experiment | Temperature sweep (32B, A2) | T=0.8 optimal |
| 6 | experiment | Context structure sweep (32B, A2) | Emotional labels fine |
| 7 | experiment | Prompt engineering sweep (K2) | A3 examples wins (different from 32B!) |
| 8 | quality-vs-penalty | 1-10 vs penalty scoring, K2 vs 32B | 1-10 scores identical, penalty scores differ |
