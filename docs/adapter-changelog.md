---
status: active
updated: 2026-04-18
---

# Adapter Changelog

> **Runtime supersession 2026-05-01:** This table records adapter history, not live routing. Writer LoRA routes, tonal-pass generation, and Salvatore leak adapters are retired from runtime; current live assignments are in `src/models/roles.ts` and summarized in `docs/current-state.md`.

Single source of truth for fine-tuning history across all pipeline agents. One entry per adapter version — what changed, what it showed, what it unlocked or blocked.

**Status legend:** DEPLOYED · IN TRAINING · PLANNED · DISCONFIRMED · RETIRED

---

## Quick Reference

| Adapter | Status | Current Version | Exp | Artifact URI |
|---------|--------|----------------|-----|-------------|
| Salvatore Voice (Fantasy Writer) | **DEPLOYED** | V4 · voice-baked beat-writer | #222 | `salvatore-1988-v4` — shipped 2026-04-17 as fantasy default |
| Tonal Pass | DEPLOYED (on-demand only) | V4 · W&B 14B | #98 | `howard-tonal-v4-sft-resume:v8` — Howard methodology retired 2026-04-16 |
| Adherence Checker | **DEPLOYED** | V4 · events+attribution | #161 | `adherence-checker-v4` |
| Chapter Plan Checker | **RETIRED 2026-04-18** | V2 · Sonnet teacher (retired) | #178 | `chapter-plan-checker-v2:v1` — slot now runs DeepSeek V3.2 base; see 2026-04-18 entry in `docs/decisions.md` |
| Continuity | **DEPLOYED** | V2 · Sonnet teacher | #175 | `continuity-v2:v1` |
| Hallucination Checker | CANDIDATE (v3 two-adapter) | V3 · ungrounded + leak parallel | — | `halluc-ungrounded-v2:v1` + `halluc-leak-salvatore-v1:v1` — v2 kitchen-sink REJECTED 2026-04-18 |
| Archetype POC (dialogue rewrite) | VALIDATED (not in pipeline) | V1 · 5-character dialogue LoRA | #220 | `archetype-poc-v1` — voice POC; dialogue post-pass architecture rejected |
| Salvatore V3 | RETAINED (rollback) | V3 · 777 crystal_shard pairs | #196 | `salvatore-1988-v3` |
| Salvatore V1–V2 | SUPERSEDED | — | #192, #195 | — |
| Fact / Summary / Character / Relationship extractors | RETIRED | V1 · Sonnet teacher | #187 | — |
| Reference Resolver | RETIRED | — | — | Llama 3.1 8B sufficient |

### Salvatore Voice V1 — Path B voice imprinting (VALIDATED — 2026-04-16)

First voice-imprinting LoRA. Targets the 1988 Salvatore action-pulp rhythm (short punchy sentences, restrained sensory imagery, dialogue-heavy beats) on top of `OpenPipe/Qwen3-14B-Instruct`.

| Field | Value |
|---|---|
| Adapter name | `salvatore-1988-v1` |
| Base | `OpenPipe/Qwen3-14B-Instruct` |
| Training pairs | 703 train / 74 val (777 total beats) |
| Source corpus | Icewind Dale Trilogy (Crystal Shard, Streams of Silver, Halfling's Gem) |
| LoRA rank | 16 |
| Hyperparams | lr 2e-4, batch 2, 3 epochs, cosine schedule |
| Training file | `finetune-data/salvatore-1988-sft-train.jsonl` |
| Experiment | #192 (`lora_voice_sft`, target=writer, dimension=voice_imprint) |
| Pre-train baseline | DeepSeek V3.2 + Howard primer, Δ-sum 1.81 vs Salvatore aggregate (Phase B) |
| Submission script | `bun scripts/archive/finetune/submit-salvatore-training.ts` |
| Run host | LXC 307 (W&B Serverless SFT, ART framework, free preview tier) |

**Phase C A/B verdict (2026-04-16):** Δ-sum 0.45 vs DeepSeek baseline 2.45 on 4 stratified briefs at 120w. Both Phase-B-identified gaps closed: avg sentence length 10.8w → 16.4w (target 18.3w), sensory density 4.75 → 1.66 hits/100w (target 1.56). Adapter live on W&B Inference. Next gate: 3-chapter production run on litrpg/romance-drama seed before promoting to default writer or opt-in style alternative. See `docs/decisions.md` "Phase C verdict."

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

> **Superseded 2026-04-16:** Howard methodology retired. Auto-run disabled 2026-04-15 (`pipeline.tonalPass=false`) and not reinstated; voice now lands at generation time via per-genre voice LoRAs (Salvatore v4 for fantasy). The V4 Howard adapter is retained on W&B Inference for the **on-demand** `POST /api/novel/:id/tonal-pass` endpoint on existing novels only — it does NOT run once post-validation during fresh novel generation. See `docs/decisions.md` "Howard primer/tonal-pass methodology retired" and "Tonal pass V4 verdict — lexical-only, dead end as a voice tool."

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
**Status: RETIRED 2026-04-18** — replaced by DeepSeek V3.2 base after ~92% FP audit on real fantasy plans (see `docs/decisions.md` 2026-04-18 entry). Adapter artifact retained on W&B; not wired in `roles.ts`.

- **Dataset:** 520 pairs (65 scenarios × 8 variants), Sonnet 4.6 teacher
- **Eval (exp #178):** 96% accuracy vs Sonnet ground truth (vs 78% for gpt-oss-120b oracle)
- **Production validation:** 3-chapter dark-fantasy — all chapters passed first attempt, 609ms avg latency
- **Scope narrowed:** `beats_covered` and `characters_present` removed (redundant with beat-level adherence). Focus on cross-beat properties only.
- **Next:** Regenerate data with dramatic-style beat plans for V3 (not urgent — V2 handles dramatic beats fine)

---

## Continuity Checker

**Task:** Per-chapter check against world state tables (facts, character states). 2 parallel decomposed calls (continuity-facts + continuity-state). **De-emphasized (2026-04-18)** — context-engineering shifts have reduced actual per-call size substantially from the original "7,300 token dump" design, and beat-level adherence + hallucination checks are subsuming this role. Future work below is retained for historical reference only.  
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

### V3 · Scale to 300 pairs (DEPRIORITIZED 2026-04-18)
**Status: ON HOLD — continuity de-emphasized in roadmap**

### V4 · Compact diff format (DEPRIORITIZED 2026-04-18)
**Status: ON HOLD — premise (~7,300 token full dump) no longer reflects current pipeline behavior**

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

## Extraction Agents — V1 (exp #187, 2026-04-13)

> **Superseded 2026-04-13 (same day):** All four extractor adapters were retired before production deployment. Plan-only `extractionMode` was validated on 7 novels (134 continuity checks, 0 failures) and the entire LLM extractor subsystem — `fact-extractor`, `summary-extractor`, `character-state`, `relationship-timeline`, `graph-linker` — was removed from the active pipeline. Planner-declared state (`establishedFacts`, `characterStateChanges`, `knowledgeChanges`) is the sole world-state source. Adapters below are retained as W&B artifacts only. The "EVAL / BLOCKED pending plan-only validation" status lines throughout this section are historical; none of these adapters are deployed and none are planned for deployment. See `docs/decisions.md` "Plan-only extractionMode validated — LLM extractors removed."

**Task:** Post-approval extraction of facts, summaries, character states, and relationship timelines from chapter prose. Currently Cerebras 235B ($4.78/14d combined across 4 agents).
**Base model:** `OpenPipe/Qwen3-14B-Instruct` on W&B Inference

### Pipeline

1. **Phase 1** — Exported 143 pairs per agent from `llm_calls` (235B silver standard)
2. **Phase 2** — Generated 113 more pairs per agent from approved chapters missing saved prompts
3. **Phase 3** — Sonnet subagent review of all 1,024 pairs (256 per agent). Correction rates: fact-extractor 97%, summary-extractor 50%, character-state 56%, relationship-timeline 67%
4. **Phase 4** — Assembled training JSONL, trained 4 adapters on W&B (3 epochs, batch size 2, cosine LR 2e-4)

### Fact Extractor V1 · `fact-extractor-v1:v1`
**Status: EVAL — needs Sonnet-as-judge before deploy**

- **Dataset:** 256 Sonnet-reviewed pairs from 50 novels, 97% corrected (Sonnet was aggressive — mostly trimming over-extraction)
- **Structural eval:** 100% valid JSON, 100% valid categories, 65.8% word-overlap F1
- **Deep inspection:** F1 is misleading. Adapter splits/merges/rephrases facts vs ground truth. True semantic accuracy estimated ~80-85%. Genuine drops ~10-15%. See `docs/adapter-training-reference.md` for full failure mode breakdown.
- **Sequence length:** 77% of training examples exceeded W&B ART 2048 token limit — assistant responses may be truncated during training
- **Latency:** 2,557ms avg

### Summary Extractor V1 · `summary-extractor-v1:v1`
**Status: EVAL — needs Sonnet-as-judge before deploy**

- **Dataset:** 256 Sonnet-reviewed pairs, 50% corrected (most corrections: summaries too short)
- **Structural eval:** 100% valid JSON, 100% schema completeness (all 4 fields present), 92.4% word ratio vs ground truth, 7.0 key events vs 7.5 ground truth
- **Sequence length:** 100% over 2048 tokens, 14% over 4096
- **Latency:** 3,703ms avg

### Character State V1 · `character-state-v1:v1`
**Status: EVAL — needs Sonnet-as-judge before deploy**

- **Dataset:** 256 Sonnet-reviewed pairs, 56% corrected
- **Structural eval:** 100% valid JSON, 95.9% character name recall, 98.4% precision, 100% per-character schema completeness
- **Sequence length:** 92% over 2048 tokens
- **Latency:** 2,783ms avg

### Relationship Timeline V1 · `relationship-timeline-v1:v1`
**Status: EVAL — needs Sonnet-as-judge before deploy**

- **Dataset:** 256 Sonnet-reviewed pairs, 67% corrected
- **Structural eval:** 100% valid JSON, 100% schema completeness (all 4 sections), 100% valid trust levels, 100% valid knowledge sources, item counts closely match ground truth
- **Sequence length:** 100% over 2048, 51% over 4096 (most severe truncation risk)
- **Latency:** 6,873ms avg

### Sonnet-as-Judge Eval Results (2026-04-13)

Content accuracy eval revealed deployment-blocking issues:
- fact-extractor: 84.2% recall, 93.5% precision — climax/resolution facts dropped
- summary-extractor: 92.5% key events, 79.7% open threads — 2/19 fabrications
- character-state: 73.9% knows recall, **57.1% doesNotKnow** — knows↔doesNotKnow inversions
- relationship-timeline: 84.1% overall, 73.8% awareness — invents items when GT=0

### Architecture Audit (2026-04-13)

**3 of 4 extractors are redundant with planner.** The planner already produces `establishedFacts`, `characterStateChanges`, `knowledgeChanges` deterministically. `"both"` extractionMode overwrites planner data via `ON CONFLICT DO UPDATE` — replacing ground truth with ~80% accurate approximations.

Only **relationship-timeline** captures unique signal (prose-level trust shifts, knowledge propagation).

**Status: BLOCKED — pending plan-only validation.** If `extractionMode: "plan"` shows no continuity regression, extractors are unnecessary. See `docs/decisions.md` "Extraction architecture audit" for full analysis.

### Frozen Prompts

All 4 extractor adapters have system prompts frozen in training data. Changing these prompts requires retraining. See `docs/adapter-training-reference.md` for the exact prompt text per adapter and drift status.

**Known drifts:** summary-extractor ("downstream agents" → "future chapters") and character-state ("downstream agents depend on this" → "this must be accurate to maintain continuity"). Minor wording; align before production deploy.

---

## Future Candidates

| Adapter | Priority | Status | Blocker |
|---------|----------|--------|---------|
| Salvatore v5 (anti-parroting) | Medium | CONDITIONAL | Only if verbatim echo rate becomes a visible production problem. Data recipe: multiple example-set variants per training row (K=5), example-count jitter, example-drop (~10% no-examples), synthetic paraphrase pool |
| Hallucination Checker v2 (kitchen sink) | REJECTED 2026-04-18 | — | Pure-synth training hit 95%+ synth val but regressed to 77.8%/51.2% on natural val. Replaced by v3 two-adapter decomposition (ungrounded + leak). See `docs/decisions.md` 2026-04-18. |
| Hallucination Checker v3 (decomposed, candidate) | High | CANDIDATE | `halluc-ungrounded-v2:v1` + `halluc-leak-salvatore-v1:v1` shipped as candidates 2026-04-18. Combined natural val: 81.4 F1 (matches v1 at 82.1). Next: wire into `drafting.ts`, measure production fire rates per adapter. |
| Per-writer leak adapters (Gemmell, Cook, etc.) | Low | PLANNED | Paired with each future genre voice LoRA. Follow `halluc-leak-salvatore-v1` recipe. |
| Planner-Adherence (payoff + directive enforcement) | Medium | DEFERRED | Gated on planner Phase-2 enrichment shipping first |
| Lint Fixer | Low | DEFERRED | Mine approved chapters for 200–300 cliché rewrite triples; gated on lint-fire-rate measurement |
| Craft-layer checkers (voice/show-tell/pacing) | REJECTED 2026-04-18 | — | Architectural decision: craft is a model-weights problem, not a prompt/checker problem. See `docs/decisions.md` |
| Character Voice (per-character LoRA zoo) | REJECTED 2026-04-18 | — | Archetype POC #220 showed DeepSeek+few-shot matches a dialogue LoRA. Zoo maintenance doesn't justify the delta. |
