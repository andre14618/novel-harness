---
status: active
updated: 2026-04-11
---

# Adapter Changelog

Single source of truth for fine-tuning history across all pipeline agents. One entry per adapter version — what changed, what it showed, what it unlocked or blocked.

**Status legend:** DEPLOYED · IN TRAINING · PLANNED · DISCONFIRMED · RETIRED

---

## Quick Reference

| Adapter | Status | Current Version | Exp | Artifact URI |
|---------|--------|----------------|-----|-------------|
| Tonal Pass | **DEPLOYED** | V4 · W&B 14B | #98 | `howard-tonal-v4-sft-resume:v8` |
| Adherence Checker | **IN TRAINING** | V3-sonnet | #159 | `adherence-checker-v3-sonnet-sft-resume:v9` *(pending)* |
| Adherence Checker | DEPLOYED (current prod) | V2 · 235B teacher | #135 | `adherence-checker-v2-sft-resume:v9` |
| Chapter Plan Checker | IN TRAINING | V1 pilot · gpt-oss teacher | #154 | `chapter-plan-checker-v1-sft-resume:v9` *(pending)* |
| Continuity | IN TRAINING | V1 · Sonnet teacher | #155 | `continuity-v1-sft-resume:v9` *(pending)* |
| Reference Resolver | RETIRED | — | — | Llama 3.1 8B sufficient |

---

## Tonal Pass

**Task:** Per-paragraph voice rewrite toward Howard/pulp-fantasy register. Dialogue-only paragraphs skipped. Runs once post-validation across all approved chapters.  
**Base model (current):** `OpenPipe/Qwen3-14B-Instruct` on W&B Inference  
**Training data:** Howard corpus + curated pipeline output pairs

### V1–V3 · Together AI 9B
- Trained on Together AI using Qwen 3.5 9B LoRA
- V3 was the last Together AI adapter
- **Result:** Functional but slow (1,757ms/paragraph), weak content preservation (0.275)
- **Lesson:** Together standard tier is 50–100× slower than Groq fast tier; cold starts unacceptable for pipeline use

### V4 · W&B 14B `howard-tonal-v4-sft-resume:v8` (exp #98, 2026-04-08)
**Status: DEPLOYED** — confirmed by pref eval 2026-04-11

Migrated to `OpenPipe/Qwen3-14B-Instruct` on W&B Inference. Beats V3 on every metric:

| Metric | V3 (Together 9B) | V4 (W&B 14B) | Howard Ref |
|--------|-----------------|-------------|-----------|
| Classifier | 0.422 | **0.550** | 0.715 |
| Perplexity | 4,814 | **3,086** | 1,964 |
| Feature KL | 1.584 | **1.564** | 1.534 |
| Content pres. | 0.275 | **0.583** | — |
| Latency | 1,757ms | **597ms** | — |

**Implication:** V3 on Together AI retired. `TOGETHER_API_KEY` to be removed from env.

**Next:** Multi-genre corpus needed (Howard corpus is dark-fantasy-specific). Public domain candidates: Hemingway, London, Cather, Fitzgerald. Blocked until structural diversity in training corpus is addressed.

---

## Adherence Checker

**Task:** Per-beat verification — 4 parallel LLM calls (events / setting / tangent / character). Binary pass/fail per call type. Retries the beat writer on failure.  
**Base model (current prod):** `OpenPipe/Qwen3-14B-Instruct` on W&B Inference  
**Architecture:** 4-call decomposed (shipped 2026-04-08, exp #122) — prior single-call architecture retired

### Baseline: Llama 3.1 8B (pre-LoRA)
- Over-strict; rejected valid prose at high rate
- Replaced by 235B for production; used as impetus to fine-tune

### Base Qwen3-14B (no adapter)
- ~77% oracle agreement on 64 production pairs
- Insufficient for pipeline use on its own

### V2 · 235B teacher `adherence-checker-v2-sft-resume:v9` (exp #135, 2026-04-08)
**Status: DEPLOYED (current production)**

- **Dataset:** 8,524 curated pairs (4-call decomposed format), 235B as single teacher
- **Eval:** 90% oracle agreement on 64 production pairs (+13pp over base)
- **Strengths:** Events ~97%, setting ~95%
- **Weak spots:** FAIL_TANGENT_HARD 69%, FAIL_MISSING_SUBTLE 78.6%, FAIL_CHAR 85.7%

### V3 mixed-teacher (exp #145 train / #146 eval, 2026-04-11)
**Status: DISCONFIRMED**

- **Hypothesis:** Per-flag best teachers — Kimi K2.5 for events (95% synthetic), gpt-oss for character (100% synthetic), 235B for setting/tangent
- **Result:** Regressed vs V2 overall (94.4% → 55.4% on FAIL_MISSING_SUBTLE; events recall 86.6% → 74.1%)
- **Root cause:** Synthetic accuracy ≠ calibration on marginal cases. Different teachers have different thresholds for ambiguous prose. Mixing teachers within a task produces an incoherent decision boundary.
- **Lesson:** One teacher per task, always. See `docs/teacher-selection-strategy.md`.

### V3-sonnet · Sonnet 4.6 teacher `adherence-checker-v3-sonnet-sft-resume:v9` (exp #159, 2026-04-11)
**Status: IN TRAINING** (~4h ETA from submission)

- **Dataset:** 7,540 pairs — full V3 curated set relabeled with Sonnet as single consistent teacher
- **Teacher accuracy (exp #147):** Sonnet 96.5% overall vs 235B's ~95% (tangent: 100% vs ~80%; FAIL_MISSING_SUBTLE: 87.2% vs 78.6%)
- **Training:** 2 epochs, batch size 2, lr 2e-4, cosine schedule

**Decision gate before deploying:**
- FAIL_TANGENT_HARD must improve beyond V2's 69%
- FAIL_MISSING_SUBTLE must improve beyond V2's 78.6%
- Events must NOT regress below 95%

---

## Chapter Plan Checker

**Task:** Per-chapter check — does the prose implement the structured beat plan? Strict false-positive rules: paraphrased dialogue, reordered details, and atmospheric additions are NOT deviations.  
**Current production:** gpt-oss-120b on Groq (direct, no adapter)  
**Base model (target):** `OpenPipe/Qwen3-14B-Instruct` on W&B Inference

### Base Qwen3-14B (no adapter, exp #107)
- 58% overall accuracy — effectively useless
- 100% PASS on all PASS variants, 5% on FAIL variants
- "Rubber-stamp" failure mode: structural reasoning requires distillation

### Teacher eval (exp #158, 2026-04-11)
Sonnet 4.6 vs gpt-oss-120b on 229 pairs, 25 scenarios:

| Teacher | Overall | PASS_REORDER | FAIL_REVERSED_ARC | FAIL_MISSING_BEAT |
|---------|---------|-------------|------------------|------------------|
| Sonnet 4.6 | **94.3%** | **100%** | **89.7%** | 67.9% |
| gpt-oss-120b | 88.2% | 82.8% | 82.8% | 46.4% |

Adjusted for 12 GT labeling errors: Sonnet 99.5% vs gpt-oss 93.1%.  
**Decision:** Sonnet adopted as teacher. gpt-oss labels had ~12% error rate on PASS_REORDER and FAIL_REVERSED_ARC.

### V1 pilot · gpt-oss labels `chapter-plan-checker-v1-sft-resume:v9` (exp #154)
**Status: IN TRAINING**

- **Dataset:** 197 pairs, gpt-oss teacher (12% error rate on key variants)
- **Purpose:** Pilot only — confirms distillation is viable
- **Eval target:** ≥80% oracle agreement on held-out pairs
- **Known issue:** gpt-oss over-literal on reordering; V1 will likely struggle on PASS_REORDER and FAIL_REVERSED_ARC

### V2 · Sonnet labels (planned)
**Status: PLANNED**

- Add 20+ scenarios to generator (currently 25, target 45+)
- Relabel all pairs with Sonnet subagents
- Combine with corrected V1 data → ~500+ pairs
- Train `chapter-plan-checker-v2`
- Target: match or exceed gpt-oss-120b (88.2%) — ideally approach Sonnet's 94.3%

---

## Continuity Checker

**Task:** Per-chapter check against world state tables (facts, character states, relationship timeline). Largest prompt-token cost in the pipeline (~7,300 in/call — full fact/state dump).  
**Current production:** Cerebras Qwen 235B (direct, no adapter)  
**Base model (target):** `OpenPipe/Qwen3-14B-Instruct` on W&B Inference

### Baseline: Qwen3 235B
- Catastrophic on soft violations: ~10% recall on WARNINGs, ~35% on NITs
- Acceptable on BLOCKERs (~95%) and TRAPs (~90%)
- Unusable as a teacher due to WARNING blindness

### Teacher eval (exp #150)
Sonnet 4.6 vs 235B on 120 pairs:

| Teacher | Overall | BLOCKER | WARNING | NIT | TRAP |
|---------|---------|---------|---------|-----|------|
| Qwen3 235B | ~10–35% | ~95% | ~10% | ~35% | ~90% |
| Sonnet 4.6 | **98%** | **100%** | **~95%** | **~95%** | **~100%** |

**Decision:** Sonnet is the only viable teacher for continuity. 235B cannot be used.

### V1 · Sonnet teacher `continuity-v1-sft-resume:v9` (exp #155)
**Status: IN TRAINING**

- **Dataset:** 120 pairs, Sonnet teacher
- **Eval target:** ≥80% accuracy on held-out continuity pairs before swapping from 235B
- **Known gap:** 120 pairs is borderline (see data sufficiency table below)

### V2 · Scale to 300 pairs (planned)
**Status: PLANNED**

- Add 10 more scenarios to generator + VAR_WARNING_2 variants
- Prioritize LitRPG scenarios and multi-chapter carryover
- Re-run Sonnet labeling pipeline
- Target: 300 pairs before serious eval

### V3 · Compact diff format (planned, blocked)
**Status: BLOCKED on V1 eval passing**

- V1/V2 train on full-dump format (~7,300 tokens/call)
- Compressing to ~1,000 tokens via structured diff requires new input format + new training data
- Do not attempt until V1 eval passes

---

## Reference Resolver

**Task:** Pre-beat lookup — resolves character names, locations, and world-state references to concrete prose context.  
**Current production:** Llama 3.1 8B on Groq (fast, cheap)  
**Status: RETIRED from SFT ladder**

Llama 8B handles deterministic lookups + cheap LLM disambiguations sufficiently. No accuracy gap that would justify a fine-tune. Not a training candidate.

---

## Data Sufficiency Reference

Based on the adherence V2 calibration point (8,524 pairs → 90% oracle agreement):

| Adapter | V1 (pilot) | V2 (viable) | V3 (robust) |
|---------|-----------|------------|------------|
| Adherence | 8,524 (V2 = baseline) | + targeted augmentation | + GRPO reward loop |
| Chapter-plan | 200 pairs | 500 pairs | 1,000+ pairs |
| Continuity | 120 pairs | 300 pairs | 600+ pairs |
| Tonal Pass | — | (V4 deployed) | multi-genre corpus |

**The problem with V1 pilots:** Chapter-plan V1 (197 pairs) is ~43× less training signal than the adherence baseline on a harder reasoning task. Continuity V1 (120 pairs) is borderline. Treat both as "what variants did the model learn" experiments, not production replacements.

---

## Future Candidates

| Adapter | Priority | Status | Blocker |
|---------|----------|--------|---------|
| Fact Extractor | Medium | PLANNED | Still 17–20 facts/ch vs 8–15 target; needs 300 corrected pairs |
| Lint Fixer | Low | PLANNED | Mine approved chapters for 200–300 cliché rewrite triples |
| Beat Writer | High risk | PLANNED | Blocked on structural diversity (15.7% dialogue vs 25–50% published norm) |
| Character Voice | Future | BLOCKED | Requires speech profiles per character first |
