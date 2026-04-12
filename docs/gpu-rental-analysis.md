---
status: active
created: 2026-04-12
data: 20 novels (2026-04-09 to 2026-04-12)
---

# GPU Rental vs API Providers: Per-Second Cost Analysis

Real token data from 20 recent novels compared against rented GPU economics. The question: would running the pipeline on rented GPUs (RunPod, Lambda) be cheaper than the current multi-provider API setup?

**TL;DR: No. Current API providers are 3-5x cheaper than GPU rental for this workload. Cerebras and W&B use specialized hardware that generic GPUs can't match on price. GPU rental only makes sense at 10-50x current volume or for workloads that keep the GPU continuously busy.**

---

## Actual Pipeline Token Data (20 Novels)

Source: `llm_calls` table, 20 most recent completed novels (11 three-chapter, 9 ten-chapter). Date range: 2026-04-09 to 2026-04-12.

### Grand Totals

| Metric | Value |
|--------|-------|
| Novels | 20 |
| Total LLM calls | 4,509 |
| Total prompt tokens | 5,918,775 |
| Total completion tokens | 1,623,411 |
| Total tokens | 7,542,186 |
| **Total API cost** | **$3.10** |
| Avg cost per novel | $0.155 |

### Cost by Provider

| Provider | Calls | Prompt Tokens | Completion Tokens | Cost | % of Total | Avg Latency |
|----------|------:|-------------:|------------------:|-----:|-----------:|------------:|
| Cerebras (235B MoE) | 1,647 | 2,590,317 | 944,902 | $2.69 | 86.6% | 1,262ms |
| MiMo (mimo-flash) | 488 | 1,040,410 | 331,035 | $0.20 | 6.6% | 6,960ms |
| Groq (Llama 8B) | 173 | 475,618 | 141,812 | $0.15 | 5.0% | 2,168ms |
| W&B (14B LoRA) | 2,201 | 1,812,430 | 205,662 | $0.06 | 1.9% | 643ms |

Cerebras dominates cost (86.6%) despite handling only 21.8% of total tokens. W&B handles the most calls (2,201) and 24% of all tokens but costs only $0.06 total.

### Top Agents by Cost

| Agent | Calls | Tokens | Cost | % Total | Provider |
|-------|------:|-------:|-----:|--------:|----------|
| beat-writer | 972 | 1,487,591 | $1.24 | 40.0% | Cerebras |
| continuity-facts | 157 | 664,241 | $0.40 | 13.0% | Cerebras |
| relationship-timeline | 123 | 504,392 | $0.38 | 12.2% | Cerebras |
| continuity-state | 157 | 390,203 | $0.24 | 7.8% | Cerebras |
| planning-plotter | 20 | 208,623 | $0.17 | 5.6% | Cerebras |
| chapter-plan-checker | 157 | 621,710 | $0.15 | 5.0% | Groq/W&B |
| adherence-events | 802 | 748,242 | $0.04 | 1.1% | W&B |

### Per-Novel Averages

| Novel Type | Calls | Prompt Tok | Comp Tok | Cost | Wall Clock |
|-----------|------:|-----------:|---------:|-----:|-----------:|
| 3-chapter | 156 | 191,619 | 53,992 | $0.098 | ~140s |
| 10-chapter | 310 | 423,440 | 114,389 | $0.225 | ~310s |

---

## GPU Rental Pricing (April 2026)

| GPU | VRAM | RunPod (on-demand) | Lambda | $/second |
|-----|-----:|-------------------:|-------:|---------:|
| H100 80GB SXM | 80 GB | $2.69/hr | $2.89/hr | $0.00075-0.00080 |
| A100 80GB SXM | 80 GB | $1.39/hr | $1.29/hr | $0.00036-0.00039 |
| A100 80GB PCIe | 80 GB | $1.19/hr | — | $0.00033 |
| L40S 48GB | 48 GB | $0.79/hr | — | $0.00022 |

RunPod offers spot instances at ~40-50% off and commitment discounts (5-15%).

---

## TPS Estimates by GPU + Model

These are **single-request** generation speeds (the pipeline's actual access pattern — sequential calls, not batched). Batched throughput is 5-20x higher but doesn't apply to our bursty, latency-sensitive workload.

| GPU | Model | Quant | Prefill (tok/s) | Generation (tok/s) | Fits? |
|-----|-------|-------|----------------:|-------------------:|-------|
| H100 80GB | 70B | FP16 | ~5,000 | 60-80 | Yes |
| H100 80GB | 70B | Q4 | ~6,000 | 80-100 | Yes |
| A100 80GB | 70B | Q4 | ~2,500 | 30-50 | Yes (tight) |
| A100 80GB | 14B | FP16 | ~8,000 | 80-120 | Yes |
| L40S 48GB | 14B | FP16 | ~5,000 | 60-90 | Yes |
| L40S 48GB | 9B | FP16 | ~6,000 | 80-120 | Yes |
| 2x H100 | 235B MoE | FP16 | ~3,000 | 30-50 | Yes |

For comparison, current API providers:
- **Cerebras (wafer-scale):** ~190 tok/s generation, ~2,100ms per beat-writer call
- **W&B (serverless):** ~643ms avg per checker call
- **Groq (LPU):** ~342ms per reference-resolver call

---

## GPU Cost Scenarios (20 Novels)

### Scenario 1: H100 for writing + L40S for checkers/extractors

Replace Cerebras with 70B FP16 on H100, everything else on 14B/L40S.

**Writing (Cerebras replacement) — H100 at $2.69/hr:**
- 2.59M prompt tokens / 5,000 prefill = 518s
- 0.94M completion tokens / 70 generation = 13,429s
- GPU time: 13,947s = **3.87 hours**
- Cost: **$10.42**

**Checkers + extractors (W&B/MiMo/Groq replacement) — L40S at $0.79/hr:**
- 3.33M prompt tokens / 5,000 prefill = 666s
- 0.68M completion tokens / 75 generation = 9,067s
- GPU time: 9,733s = **2.70 hours**
- Cost: **$2.14**

| | API (actual) | GPU rental | Ratio |
|---|---:|---:|---:|
| Writing portion | $2.69 | $10.42 | 3.9x more |
| Checker/extractor portion | $0.41 | $2.14 | 5.2x more |
| **Total (20 novels)** | **$3.10** | **$12.56** | **4.1x more** |
| Per 10-chapter novel | $0.225 | $0.63 | 2.8x more |
| Per 3-chapter novel | $0.098 | $0.27 | 2.8x more |
| Monthly (2-3/day) | $4.50-6.75 | $12.60-18.90 | 2.8x more |

### Scenario 2: Single A100 for everything (70B Q4)

All workloads on one A100 80GB at $1.39/hr with 70B Q4.

- 5.92M prompt / 2,500 prefill = 2,369s
- 1.62M completion / 40 generation = 40,585s
- GPU time: 42,954s = **11.93 hours**
- Cost: **$16.58**
- **5.3x more expensive than API**

### Scenario 3: 2x H100 for full 235B parity

Run the actual 235B MoE on 2x H100 ($5.38/hr combined, RunPod).

- 5.92M prompt / 3,000 prefill = 1,973s
- 1.62M completion / 40 generation = 40,585s
- GPU time: 42,558s = **11.82 hours**
- Cost: **$63.60**
- **20.5x more expensive than API**

### Scenario 4: L40S only (14B for everything, quality trade-off)

Replace all models with 14B on L40S at $0.79/hr. Cheapest GPU option but significant quality downgrade for writing.

- 5.92M prompt / 5,000 prefill = 1,184s
- 1.62M completion / 75 generation = 21,612s
- GPU time: 22,796s = **6.33 hours**
- Cost: **$5.00**
- **1.6x more expensive than API** (closest to break-even, but writing quality drops)

---

## Wall Clock Impact

A critical factor: GPU rental is slower per-call than specialized API providers.

**10-chapter novel wall clock comparison:**

| Component | API (current) | H100 70B | A100 70B Q4 |
|-----------|-------------:|----------:|-----------:|
| Beat writing (54 calls) | 59s | 535s | 855s |
| Checkers (64 calls) | 50s | 160s | 210s |
| Extractors (42 calls) | 130s | 95s | 130s |
| Planning + concept | 15s | 40s | 55s |
| **Approx total** | **~310s (5.2 min)** | **~830s (13.8 min)** | **~1250s (20.8 min)** |

Beat writing is the bottleneck. Cerebras generates at ~190 tok/s vs 60-70 tok/s on H100 70B. The novel takes **2.7-4x longer** on GPU.

---

## Break-Even Analysis

### At what volume does GPU rental become cheaper?

The break-even depends on GPU utilization. Rented GPUs cost per-second regardless of whether they're processing tokens. APIs charge per-token with zero idle cost.

**Current volume:** 2-3 novels/day, ~5 min active GPU per novel.
- Daily GPU need: 10-15 min
- Daily idle: 23 hours 45 min
- Paying for idle time makes GPU rental uneconomical

**Break-even utilization (H100 + L40S scenario):**
- API cost: ~$0.155/novel
- GPU cost: ~$0.45/novel (at current TPS)
- GPU hourly cost: $2.69 + $0.79 = $3.48/hr
- API equivalent $/hr (at full utilization): ~$3.48/hr requires processing ~22 novels/hr
- **Break-even: ~530 novels/day (keeping GPUs >95% utilized)**

This is unreachable at current scale.

**Break-even for L40S-only (14B, quality trade-off):**
- L40S at $0.79/hr
- API equivalent: ~0.155/novel × 5 novels/hr = $0.78/hr
- **Break-even: ~120 novels/day** — still far above current volume

### What about spot instances?

RunPod spot at 50% off:
- H100 spot: $1.35/hr
- L40S spot: $0.40/hr
- Reduces the ratio to ~2x more expensive (vs 4x on-demand)
- Break-even drops to ~265 novels/day — still unreachable

---

## Why API Providers Win at This Scale

| Provider | Hardware | Advantage |
|----------|----------|-----------|
| **Cerebras** | Wafer-scale engine | Custom silicon: 190 tok/s generation, no cold start, $0.60/$1.20/1M. 3-10x faster than any GPU at comparable pricing. |
| **W&B** | CoreWeave shared fleet | Multi-tenant LoRA serving: $0.05/$0.22/1M. You pay only for your tokens. GPU cost amortized across all customers. |
| **Groq** | LPU (custom ASIC) | Deterministic inference: 342ms for reference resolver. Purpose-built for low-latency. |
| **MiMo** | Serverless | Cheap per-token ($0.07/$0.30/1M), slow but fine for extraction tasks. |

The pipeline already exploits the best hardware for each task:
- **Latency-critical writing** → Cerebras (fastest generation)
- **High-call-volume checkers** → W&B LoRA (cheapest per-token)
- **Background extraction** → MiMo (cheapest per-token, latency doesn't matter)
- **Simple lookups** → Groq (lowest latency)

A single rented GPU is a generalist competing against four specialists. It loses on both cost and speed.

---

## When GPU Rental Makes Sense

Despite losing on per-novel economics, GPU rental has legitimate use cases:

1. **Batch data generation** — Generating thousands of SFT training pairs overnight. A 4-hour L40S session ($3.16) could produce 1,000+ labeled examples at zero per-token cost. Cheaper than API for any batch job exceeding ~$3 in API tokens.

2. **Eval sweeps** — Running 500+ eval probes across adapter variants. Per-token costs add up; flat hourly rate is predictable.

3. **Provider independence** — If Cerebras or W&B change pricing or go down, a rented GPU is a same-hour fallback with no vendor lock-in.

4. **Quality experiments** — Testing whether a 70B model produces acceptable prose. The writing quality gap between 14B → 70B → 235B can only be measured empirically, and running 10 test novels on a rented GPU is ~$3-5.

5. **Long-running fine-tune jobs** — Together AI training is convenient but opaque. Running your own training on a rented A100 with full control over hyperparameters may be worth the $1.39/hr for complex training runs.

---

## Summary Table

| Scenario | Cost (20 novels) | vs API ($3.10) | Wall Clock (10ch) | Quality |
|----------|------------------:|---------------:|-----------------:|---------|
| **API (current)** | **$3.10** | **baseline** | **~5 min** | **235B writing** |
| H100 70B + L40S 14B | $12.56 | 4.1x worse | ~14 min | 70B writing (lower) |
| Single A100 70B Q4 | $16.58 | 5.3x worse | ~21 min | 70B Q4 (lower) |
| 2x H100 235B parity | $63.60 | 20.5x worse | ~12 min | 235B (parity) |
| L40S only (14B) | $5.00 | 1.6x worse | ~18 min | 14B (much lower) |
| H100 spot + L40S spot | $6.28 | 2.0x worse | ~14 min | 70B (lower) |

**Recommendation:** Stay on multi-provider API. GPU rental is a legitimate option for batch jobs (SFT data gen, eval sweeps) but not for per-novel pipeline execution at current volume.
