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
