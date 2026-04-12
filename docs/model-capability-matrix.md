---
status: active
updated: 2026-04-10
derived-from: tuning_experiments #10, #86-94, #107-123, #135, #138, #140
---

# Model Capability Matrix

Statistical reference for which models perform best on which pipeline tasks. All numbers are from controlled experiments on deterministic eval sets — not anecdotal. Use this to pick teachers, select production models, and prioritize fine-tuning.

---

## Task × Model Accuracy (% agreement with deterministic labels)

### Adherence Checker (4-call decomposed, 160 pairs, exp #122)

| Model | Overall | PASS_CLEAN | PASS_PARA | PASS_REORD | PASS_ATMO | FAIL_MISS | FAIL_CHAR | FAIL_SET | FAIL_TANG | Bias |
|-------|--------:|-----------:|----------:|-----------:|----------:|----------:|----------:|---------:|----------:|------|
| **Qwen 235B (Cerebras)** | **97%** | 100 | 100 | 95 | 100 | **85** | 95 | 100 | 100 | Balanced |
| gpt-oss-120b (Groq) | 95% | 100 | 100 | 100 | 100 | **93** | **100** | 100 | **87** | Slight over-strict on tangent |
| Qwen3-14B V2 LoRA (W&B) | 90%† | — | — | — | — | 98† | 88† | 88† | 87† | Balanced |
| Qwen3-14B base (W&B) | 91% | 100 | 95 | 95 | 100 | 80 | 80 | 100 | 90 | Over-permissive on FAIL |
| Llama 3.1 8B (Groq) | 76% | 90 | 90 | 75 | 95 | 90 | 95 | 100 | 100 | Over-strict on PASS |

†V2 numbers from production eval (64 pairs, exp #135), not directly comparable to synthetic 160-pair numbers.

**Key finding:** 235B is weakest on **FAIL_MISSING (events) at 85%** — the highest-stakes flag. gpt-oss scores 93% on the same variant (+8pp) but drops 13pp on tangent. No single model is best everywhere.

**Production model:** W&B Qwen3-14B + V2 LoRA (deployed 2026-04-09, exp #135).

### Adherence Teacher Ladder — Full 5-Model Comparison (exp #122, #138, #140)

| Model | Overall | FAIL_MISS | FAIL_CHAR | FAIL_SET | FAIL_TANG | PASS_REORD | Latency | Provider |
|-------|--------:|----------:|----------:|---------:|----------:|-----------:|--------:|----------|
| **Qwen 235B** | **97%** | 85% | 95% | 100% | **100%** | 95% | 486ms | Cerebras |
| **Kimi K2.5** | **95%** | **95%** | 95% | 100% | 90% | 80% | 1931ms | Together |
| gpt-oss-120b | 95% | 93% | **100%** | 100% | 87% | 100% | ~2400ms | Groq |
| GLM 5.1 | 94% | 90% | **100%** | 100% | 75% | 85% | 2521ms | Together |
| DeepSeek V3.2 | 90% | 80% | 90% | 100% | 55% | 95% | 2984ms | DeepSeek |

**DeepSeek V3.2 is not viable as a teacher** — tangent collapsed to 55%. **Kimi K2.5 is the best events teacher** at 95% (+10pp over 235B). **235B remains the only model at 100% on tangent.**

---

### Adherence Checker — Flat Schema (160 pairs, exp #110)

Pre-decomposition reference showing how the 4-call split changed the picture:

| Model | Overall | FAIL_MISS | FAIL_CHAR | FAIL_SET | FAIL_TANG | FP / FN |
|-------|--------:|----------:|----------:|---------:|----------:|---------|
| Qwen 235B | 96% | 85 | 95 | 100 | 95 | 5 / 1 |
| Qwen3-14B base | 79% | 35 | 60 | 95 | 45 | 33 / 1 |
| Llama 8B | 71% | 80 | 100 | 100 | 100 | 4 / 42 |

**Lesson:** 14B and Llama fail in **opposite directions** (over-permissive vs over-strict). Decomposition closed 14B's gap from 79→91% (+12pp).

---

### Chapter Plan Checker (80 pairs, exp #119)

| Model | Overall | PASS_CLN | PASS_PAR | PASS_REO | PASS_ATM | FAIL_BEAT | FAIL_CHAR | FAIL_ARC | FAIL_SET | FP / FN | Errors |
|-------|--------:|---------:|---------:|---------:|---------:|----------:|----------:|---------:|---------:|---------|--------|
| **gpt-oss-120b (Groq)** | **90%** | 80 | 100 | 100 | 100 | **50** | **100** | **80** | **100** | 5 / 2 | 9 |
| Qwen 235B (Cerebras) | 81% | 100 | 100 | 90 | 100 | **10** | 80 | 70 | 100 | 14 / 1 | 0 |
| Llama 8B (Groq) | 65% | 80 | 90 | 70 | 80 | 20 | 40 | 60 | 80 | 20 / 8 | 0 |
| Qwen3-14B base (W&B) | 53% | 100 | 100 | 100 | 100 | **0** | 10 | 10 | **0** | 38 / 0 | 0 |

**Key finding:** gpt-oss-120b is the empirically best teacher, not just the incumbent. Beats 235B by 9pp overall and **40pp on FAIL_MISSING_BEAT**. 14B has 100% rubber-stamp bias (38 FP / 0 FN). **FAIL_MISSING_BEAT is broken across the entire ladder** — even gpt-oss only catches half.

**Production model:** gpt-oss-120b on Groq.

---

### Continuity (120 pairs, exp #117 flat / #118 checklist)

| Model | Schema | Exact | F1 | Recall | BLOCKER | WARNING | NIT | TRAP | FP (NONE+TRAP) |
|-------|--------|------:|----:|-------:|--------:|--------:|----:|-----:|---------------:|
| **Qwen 235B** | **checklist** | **54%** | **0.555** | **45.0%** | 75 | 10 | **35** | **100** | **0/40** |
| Qwen 235B | flat | 52% | 0.469 | 35.0% | 85 | 0 | 10 | 100 | 0/40 |
| Qwen3-14B | checklist | 43% | 0.347 | 21.9% | 50 | 5 | 0 | 100 | 0/40 |
| Qwen3-14B | flat | 30% | 0.440 | 48.1% | 80 | 0 | 15 | 30 | 26/40 |
| Llama 8B | checklist | 33% | 0.415 | 41.7% | 90 | 16 | 0 | 40 | 24/40 |
| Llama 8B | flat | 20% | 0.405 | 51.2% | 60 | 0 | 0 | 25 | 34/40 |

**Key finding:** WARNING detection is **0-16% across all six configurations**. NIT is 0-35%. The bottleneck isn't model size — it's that **no model in the ladder can reliably detect subtle continuity issues**. 235B with checklist is the best available (F1 0.555) but misses 90% of warnings. **Stronger teacher needed (Claude) before SFT is viable.**

**Production model:** Cerebras Qwen 235B with checklist prompt.

---

### Reference Resolver (120 pairs, exp #114 flat)

| Model | Exact | F1 | Recall | Precision | Avg Lookups |
|-------|------:|---:|-------:|----------:|------------:|
| **Qwen3-14B base (W&B)** | 1% | 0.518 | **97.5%** | 35% | 2.73 |
| Qwen 235B (Cerebras) | 23% | 0.554 | 75.0% | 51% | 1.89 |
| Llama 8B (Groq) | 5% | 0.475 | 87.5% | 33% | 2.40 |

**Key finding:** 14B has worst exact-match but **best recall at 97.5%**. Recall is the production-relevant metric (over-fetched lookups are nearly free, missing one starves the writer). **No fine-tune needed.** With parallel-3 aggregation: recall +23% (38.9% vs 31.7%) at trivial cost.

**Production model:** Llama 3.1 8B on Groq with parallel-3 set union.

---

## Task × Model: Writer Quality (exp #90)

| Model | Penalty Score (↓) | Cost/Chapter | Throughput | Adherence | Lint Issues |
|-------|------------------:|-------------:|-----------:|-----------|------------:|
| **Cerebras Qwen 235B** | 9.7 | $0.003 | 428 tps | Reliable — follows seed constraints | 9.7 |
| DeepSeek V3.2 | **6.6** | $0.002 | 41 tps | Reliable — but pacing issues (1370w avg, too slow) | 6.6 |
| MiMo V2 Flash | 7.8 | $0.001 | 88 tps | **Unreliable** — inverts characters, uses wrong genre vocabulary | 7.8 |

**Key finding:** Penalty scores overlap, suggesting equivalence — but **reading the prose against seed constraints reveals real differences**. MiMo Flash inverted a character's arc, used sci-fi terms in fantasy, and deviated from premises. Penalty benchmarks miss adherence failures entirely. **The real quality axis for writers is adherence to story constraints, not prose-level tells.**

**Production model:** Cerebras Qwen 235B. Cost is rounding error ($0.001/beat), no pressure to optimize.

---

## Task × Model: Lint Fixing (exp #67, #72)

| Model | Fix Rate | Collateral | Latency | Cost/Fix |
|-------|----------|-----------|---------|---------|
| Llama 3.1 8B (Groq) | 89% | 66% char change (full chapter) | **131ms** | $0.00005 |
| Kimi K2 (Groq) | 89% | 66% | 391ms | $0.001 |
| Qwen 235B (Cerebras) | 78% | 63% | 423ms | $0.0006 |
| Qwen3 32B | 89% | 78% | ~500ms | $0.0003 |

**Key finding:** Per-sentence with scene context: all models hit ~100% fix rate. Full-chapter rewriting: 63-78% collateral regardless of model. **Use cheapest fast model (Llama 8B) for per-sentence fixes.**

**Production model:** Cerebras Qwen 235B (for per-sentence fixes in lint pipeline).

---

## Task × Model: Tonal Pass / Style Transfer (exp #95-98)

| Model | Classifier ↑ | Perplexity ↓ | Feature KL ↓ | Content Pres ↑ | Latency |
|-------|----------:|----------:|----------:|----------:|---------|
| Howard reference | 0.715 | 1964 | 1.534 | — | — |
| Input (bland) | 0.197 | 3593 | 1.569 | — | — |
| **V4 sft-resume:v8 (W&B 14B)** | **0.550** | **3086** | **1.564** | **0.583** | **597ms** |
| V3 (Together 9B) | 0.422 | 4814 | 1.584 | 0.275 | 1757ms |

**Key finding:** V4 beats V3 on every quantitative metric and is 3x faster. But qualitative reading suggests V3 may produce bolder, more dramatic rewrites. Pref eval pending.

**Production model:** Together AI Qwen 3.5 9B + howard-tonal-v3 (pending pref eval for V4 swap).

---

## Cross-Task Summary: Schema × Model Interaction

Shows how the same intervention (structured checklist) has different effects by task and model:

| Task | 14B flat → checklist | 235B flat → checklist | Mechanism |
|------|---------------------|----------------------|-----------|
| Chapter-plan-checker | 58% → 75% (+17pp) | n/a | Per-element observation forces attention |
| Adherence-checker | 79% → 83% (+4pp) | 96% → 90% (−6pp) | Atomization hurts holistic judgment |
| Reference-resolver | 1% → 44% (+43pp)* | 23% → 38% (+15pp) | `ambient` branch restores missing verdict |
| Continuity | 30% → 43% (+13pp)** | 52% → 54% (+2pp) | 14B gain is FP reduction only |

\*Exact-match metric artifact; recall drops 97.5% → 68%.
\**F1 drops 0.440 → 0.347; gain is entirely from NONE/TRAP.

---

## Per-Call Cost & Latency at Production Workload Shape

| Agent | Model | Avg In | Avg Out | Latency | Cost/Call |
|-------|-------|-------:|--------:|--------:|----------:|
| beat-writer | Cerebras Qwen 235B | 846 | 391 | 2,155ms | ~$0.001 |
| **continuity** | **Cerebras Qwen 235B** | **7,294** | **241** | **934ms** | **~$0.0023** |
| chapter-plan-checker | gpt-oss-120b (Groq) | 2,880 | 995 | 2,415ms | ~$0.0007 |
| adherence-checker (×4) | W&B Qwen3-14B + V2 | ~360 | ~17 | ~627ms | ~$0.00005 ¹ |
| reference-resolver (×3) | Llama 8B (Groq) | 257 | 162 | 289ms | ~$0.00003 |
| lint-fixer | Cerebras Qwen 235B | ~200 | ~50 | ~200ms | ~$0.0002 |

**Continuity is the highest per-call cost by 3x.** That's where the fine-tuning ROI lives — but the teacher quality bottleneck must be solved first.

¹ W&B adherence calls are billed at Qwen3-14B rates ($0.05/$0.22 per 1M) — not free. The LoRA artifact URI (`wandb-artifact:///...`) previously caused `getTokenCost()` to return $0 due to an ID lookup miss; this was fixed in `models/registry.ts`. A 10-chapter run generates ~$0.019 in adherence costs (267K prompt + 27K completion tokens across 348 calls).

---

## Provider Latency Comparison (exp #92-94)

Same workload shape across providers, for models available on W&B Inference:

| Model | Adherence (~17 out) | Ref-resolver (~40 out) | Beat-writer (~400 out) |
|-------|-------------------:|----------------------:|----------------------:|
| Qwen3-14B (W&B) | **157ms** | 741ms | 2,008ms |
| gpt-oss-120b (W&B) | 7,172ms ⚠ | — | — |
| Qwen3-30B-A3B (W&B) | 33,044ms ⚠ | 3,393ms | 16,268ms |
| Qwen 235B (Cerebras) | 365ms | 385ms | 1,520ms |

⚠ Cold-start dominated — these models aren't kept warm on W&B.

**Key finding:** At short outputs (<50 tokens), smaller model on slower hardware can beat larger model on faster hardware. Crossover is ~50-100 output tokens.

---

## Fine-Tune Readiness Summary

| Task | Teacher | Teacher Accuracy | Student Gap | Data Sufficient? | SFT Status |
|------|---------|---------------:|------------:|:----------------:|:----------:|
| Adherence checker | Qwen 235B (decomposed) | 97% | 6pp (91%→97%) | ✅ 8,524 curated | **V2 DEPLOYED** |
| Chapter-plan checker | gpt-oss-120b | 90% | 37pp (53%→90%) | ❌ Need 200+ diverse pairs | Data collection |
| Continuity | Claude Opus/Sonnet (TBD) | TBD | ~45pp+ | ❌ Teacher quality + premise diversity | **BLOCKED** |
| Reference resolver | N/A | 97.5% recall | — | N/A | **OFF LIST** |
| Tonal pass | Howard corpus | V4 > V3 on all metrics | N/A | ✅ 4,497 curated | V4 pref eval |
| Lint fixer | Approved chapter rewrites | TBD | TBD | ❌ Need 200+ examples | Future |
| Beat writer | Approved chapter beats | TBD | TBD | ❌ Need 500+ diverse beats | Future (high risk) |

---

## Experiment Quick-Reference Index

| Experiment ID(s) | What was tested | Key result |
|-------------------|----------------|------------|
| #10 | Writer model comparison (K2/DeepSeek/32B) | K2 best prose, DeepSeek fast but doesn't follow methodology |
| #22-24 | Pairwise judge comparison | Reasoning models needed; GPT-5.4-mini and DeepSeek tied best |
| #33 | Writer temperature sweep | 0.8 optimal |
| #67 | Full-chapter lint rewrite | 63-78% collateral regardless of model |
| #72 | Per-sentence lint fix model sweep | K2/235B/DeepSeek all 100%; Llama cheapest |
| #86-90 | MiMo V2 Flash pipeline sweep | Viable for extraction only |
| #92-94 | W&B Inference latency probe | 14B beats 235B on short outputs; 30B-A3B unusable |
| #95-98 | Tonal pass V4 evaluation | V4 beats V3 on all quantitative metrics |
| #107-109 | Chapter-plan-checker baseline+checklist | 14B: 58%→75% with checklist; 100% rubber-stamp bias |
| #110-111 | Adherence baseline+checklist | Checklist hurts 235B (-6pp); Llama gains +18pp |
| #114-115 | Reference-resolver baseline+checklist | 97.5% recall already; OFF SFT list |
| #117-118 | Continuity baseline+checklist | WARNING 0-16% across all; teacher bottleneck |
| #119 | Chapter-plan 4-model ladder | gpt-oss beats 235B by 9pp |
| #122 | Adherence 4-call decomposition | **SHIPPED** — 14B: 91%, 235B: 97% |
| #123 | Chapter-plan per-beat decomposition | Regression — compounding error kills strong models |
| #132 | Adherence SFT data generation | 10,008 training examples from 4 writers |
| #135 | Adherence V1/V2 production eval | **V2 at 90% — DEPLOYED** |
| #138 | gpt-oss adherence eval | 95% overall; FAIL_MISSING 93% (+8pp vs 235B) |
| #140 | Teacher ladder: DeepSeek/K2.5/GLM | K2.5 best events (95%); DeepSeek not viable (tangent 55%) |

---

## Fine-Tune Teacher Competency Matrix

Quick reference: which model to use as teacher (label source) for each task and flag when generating SFT training data. Based on experiments #119, #122, #138, #140.

### Adherence Checker — Per-Flag Best Teacher

| Flag | Best Teacher | Accuracy | Runner-up | Gap | Notes |
|------|-------------|:--------:|-----------|:---:|-------|
| **events** | **Kimi K2.5** | **95%** | gpt-oss-120b (93%) | +2pp | +10pp over 235B oracle. K2.5 is aggressive on missing actions — exactly what this flag needs |
| **setting** | Any (all 100%) | **100%** | — | 0 | Use 235B (cheapest/fastest). All 5 tested models are perfect |
| **tangent** | **Qwen 235B** | **100%** | Kimi K2.5 (90%) | +10pp | Only model that never misses tangent drift. Critical — tangent is the subtlest judgment |
| **character** | **gpt-oss / GLM** | **100%** | K2.5/235B (95%) | +5pp | Tied at ceiling. gpt-oss already in pipeline, prefer it |

### Chapter Plan Checker — Per-Task Best Teacher

| Task | Best Teacher | Accuracy | Runner-up | Gap | Notes |
|------|-------------|:--------:|-----------|:---:|-------|
| **Overall** | **gpt-oss-120b** | **90%** | Qwen 235B (81%) | +9pp | Beats 235B on every FAIL variant |
| **FAIL_MISSING_BEAT** | **gpt-oss-120b** | **50%** | 235B (10%) | +40pp | Hardest variant; even best model catches half |
| **FAIL_REVERSED_ARC** | **gpt-oss-120b** | **80%** | 235B (70%) | +10pp | Sequence-level reasoning |

### Continuity — Teacher Status

| Severity | Best Available | Accuracy | Assessment |
|----------|---------------|:--------:|------------|
| **BLOCKER** | Qwen 235B | 75-85% | Adequate but not strong |
| **WARNING** | None adequate | 0-16% | **BLOCKED** — no model in the ladder detects warnings reliably |
| **NIT** | Qwen 235B (checklist) | 35% | Weak; only model above 15% |
| **TRAP** | 235B / 14B (checklist) | 100% | Solved by schema branch |

**Continuity SFT is blocked** until a stronger teacher is found. Claude (Opus/Sonnet) is the recommended teacher for offline labeling — 235B misses 90% of warnings and 65% of nits.

### Cross-Task Teacher Summary

| Task | Teacher | Status | V3 Action |
|------|---------|--------|-----------|
| Adherence events | Kimi K2.5 (95%) | **Ready** | Use as events teacher in mixed-teacher data gen |
| Adherence setting | Qwen 235B (100%) | **Ready** | Continue using 235B |
| Adherence tangent | Qwen 235B (100%) | **Ready** | Continue using 235B |
| Adherence character | gpt-oss-120b (100%) | **Ready** | Swap from 235B to gpt-oss for character labels |
| Chapter-plan | gpt-oss-120b (90%) | **Ready** | Distill gpt-oss, manually escalate MISSING_BEAT |
| Continuity | Claude Opus/Sonnet | **BLOCKED** | Need teacher eval first |
| Tonal pass | Howard corpus | **Ready** | V4 trained; pref eval pending |
| Reference resolver | N/A | **OFF LIST** | 97.5% recall, no deficit |

### Models NOT Recommended as Teachers

| Model | Why | Evidence |
|-------|-----|---------|
| **DeepSeek V3.2** | Tangent detection collapsed (55%). Systematically under-flags drift. | Exp #140: 9 false passes on FAIL_TANGENT, worst of any model tested |
| **Qwen3-14B base** | 100% rubber-stamp bias on chapter-plan-checker (38 FP / 0 FN). Over-permissive on adherence FAIL variants. | Exp #107, #110 |
| **Llama 3.1 8B** | Over-strict on adherence PASS variants (42 false-fails). Unusable for any judging task. | Exp #110 |
| **MiMo V2 Flash** | Adherence failures in writing (inverts characters, wrong genre vocab). Inconsistent as judge. | Exp #86-90 |
