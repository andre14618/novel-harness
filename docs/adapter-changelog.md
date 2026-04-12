---
status: active
updated: 2026-04-12
---

# Adapter Changelog

Single source of truth for fine-tuning history across all pipeline agents. One entry per adapter version — what changed, what it showed, what it unlocked or blocked.

**Status legend:** DEPLOYED · IN TRAINING · PLANNED · DISCONFIRMED · RETIRED

---

## Quick Reference

| Adapter | Status | Current Version | Exp | Artifact URI |
|---------|--------|----------------|-----|-------------|
| Tonal Pass | **DEPLOYED** | V4 · W&B 14B | #98 | `howard-tonal-v4-sft-resume:v8` |
| Adherence Checker | **DEPLOYED** | V4 · events+attribution | #161 | `adherence-checker-v4` |
| Chapter Plan Checker | **DEPLOYED** | V2 · Sonnet teacher | #178 | `chapter-plan-checker-v2:v1` |
| Continuity | **DEPLOYED** | V2 · Sonnet teacher | #175 | `continuity-v2:v1` |
| Reference Resolver | RETIRED | — | — | Llama 3.1 8B sufficient |

### Together AI Tier 2 Mirrors (IN TRAINING — 2026-04-12)

All 4 adapters submitted for LoRA training on `Qwen/Qwen3.5-9B` (r=16, alpha=32, dropout=0.05). Same training data as W&B adapters, `_meta` keys stripped. These serve as Tier 2 hot standby and potential Tier 4 local inference source (same SafeTensors format works with MLX).

| Adapter | Together Job ID | Together Output Model | Data | Epochs |
|---------|----------------|----------------------|------|--------|
| Adherence V4 | `ft-452bac3d-dbcb` | `andre14618_2c8c/Qwen3.5-9B-adherence-checker-v4-together-0c3a3c63` | 2,134 pairs | 2 |
| Chapter Plan V2 | `ft-2b8663d1-1644` | `andre14618_2c8c/Qwen3.5-9B-chapter-plan-checker-v2-together-30747106` | 520 pairs | 3 |
| Continuity V2 | `ft-ed08007d-2056` | `andre14618_2c8c/Qwen3.5-9B-continuity-v2-together-7f273d6b` | 253 pairs | 3 |
| Tonal V4 | `ft-f5916b1d-c94f` | `andre14618_2c8c/Qwen3.5-9B-howard-tonal-v4-together-90c6e60c` | 4,497 pairs | 2 |

Check status: `python3 scripts/train-together.py --status`

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

**Task:** Per-beat verification — single LLM call (events+attribution). Binary pass/fail. Retries the beat writer on failure with targeted rewrite (specific issues passed back).  
**Base model:** `OpenPipe/Qwen3-14B-Instruct` on W&B Inference  
**Architecture:** Single events+attribution call (shipped 2026-04-12, exp #161) — prior 4-call decomposed architecture retired (setting/tangent had 0–4.3% fire rates, character merged into events)

### V2 · 235B teacher `adherence-checker-v2-sft-resume:v9` (exp #135, 2026-04-08)
**Status: RETIRED** — config removed from `models/roles.ts` 2026-04-12

- **Dataset:** 8,524 curated pairs (4-call decomposed format), 235B as single teacher
- **Eval:** 90% oracle agreement on 64 production pairs (+13pp over base)
- Superseded by V4 (events+attribution merged prompt, Sonnet labels)

### V3 mixed-teacher (exp #145 train / #146 eval, 2026-04-11)
**Status: DISCONFIRMED**

- **Root cause:** Synthetic accuracy ≠ calibration on marginal cases. Mixing teachers within a task produces an incoherent decision boundary.
- **Lesson:** One teacher per task, always.

### V4 · Sonnet teacher `adherence-checker-v4` (exp #161, 2026-04-12)
**Status: DEPLOYED**

- **Dataset:** 2,134 unique (beat, prose) pairs, Sonnet 4.6 teacher, events+attribution merged prompt
- **Production eval (10-chapter coastal-mystery):** 79% first-attempt pass (23/30 beats), all failures resolved on retry, zero false positives
- **Architecture change:** 4 parallel calls → 1 call. Character merged into events. Setting/tangent removed (0–4.3% fire rates, planner-level bugs).
- **Next:** GRPO/RL reward loop (adherence-checker has clean automatic reward signal)

---

## Chapter Plan Checker

**Task:** Per-chapter check — cross-beat properties: setting coherence, emotional arc direction, major plot contradictions. Strict false-positive rules: paraphrased dialogue, reordered details, and atmospheric additions are NOT deviations.  
**Base model:** `OpenPipe/Qwen3-14B-Instruct` on W&B Inference

### V1 pilot · gpt-oss labels (exp #154)
**Status: SUPERSEDED by V2**

- **Dataset:** 197 pairs, gpt-oss teacher (12% error rate on key variants)
- Superseded by V2 Sonnet labels (96% accuracy)

### V2 · Sonnet labels `chapter-plan-checker-v2:v1` (exp #170 train / #178 eval, 2026-04-12)
**Status: DEPLOYED**

- **Dataset:** 520 pairs (65 scenarios × 8 variants), Sonnet 4.6 teacher
- **Eval (exp #178):** 96% accuracy vs Sonnet ground truth (vs 78% for gpt-oss-120b oracle)
- **Production validation:** 3-chapter dark-fantasy — all chapters passed first attempt, 609ms avg latency
- **Scope narrowed:** `beats_covered` and `characters_present` removed (redundant with beat-level adherence). Focus on cross-beat properties only.
- **Next:** Regenerate data with dramatic-style beat plans for V3 (not urgent — V2 handles dramatic beats fine)

---

## Continuity Checker

**Task:** Per-chapter check against world state tables (facts, character states). 2 parallel decomposed calls (continuity-facts + continuity-state). Largest prompt-token cost in the pipeline (~7,300 in/call — full fact/state dump).  
**Base model:** `OpenPipe/Qwen3-14B-Instruct` on W&B Inference

### V1 · Sonnet teacher (exp #155)
**Status: SUPERSEDED by V2**

- **Dataset:** 120 pairs, Sonnet teacher
- Superseded by V2 (253 pairs, 99% Sonnet accuracy)

### V2 · Sonnet teacher `continuity-v2:v1` (exp #175, 2026-04-12)
**Status: DEPLOYED**

- **Dataset:** 253 pairs (39 scenarios × ~6.5 variants avg), Sonnet 4.6 teacher, 99% label accuracy
- **Production validation (novel-1776029103713, 3 chapters dark-fantasy):**
  - 8 calls, 0 false positives, 0 missed issues
  - $0.0011 total cost vs $0.0128 Cerebras equivalent (**11.9× cost reduction**)
  - 204ms warm latency (first call 2.3s cold start)
- **Training:** 3 epochs, batch size 2, cosine LR 2e-4, LoRA rank 16
- **Decomposed prompts:** `fact-check-system.md` (contradictions vs established facts), `state-check-system.md` (character location/knowledge consistency)

### V3 · Scale to 300 pairs (planned)
**Status: PLANNED**

- Add 10 more scenarios to generator + VAR_WARNING_2 variants
- Prioritize LitRPG scenarios and multi-chapter carryover
- Regenerate with dramatic-style beat plans

### V4 · Compact diff format (planned)
**Status: PLANNED — unblocked now that V2 is validated**

- V2 trains on full-dump format (~7,300 tokens/call)
- Compressing to ~1,000 tokens via structured diff requires new input format + new training data

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
