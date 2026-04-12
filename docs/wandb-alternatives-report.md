# W&B Alternatives Report: Together AI vs Modal

**Date:** 2026-04-12 (updated with Together warm-up probe results)
**Context:** W&B is the prototyping tier for LoRA fine-tuning. Storage issue resolved (purged to 1 GB, auto-cleanup in place). This report evaluates migration paths if W&B becomes untenable.

## Current Pipeline: What Actually Runs on W&B

Per chapter, the pipeline makes **~13 W&B adapter calls**:

| Adapter | Calls/chapter | Shape (in/out tokens) | W&B latency | Role |
|---------|---:|---|---:|---|
| adherence-events | ~9-10 (2.25 per beat × 4 beats) | ~500 in / 200 out | **157ms** | Beat-level event checker |
| chapter-plan-checker | 1 | ~1000 in / 600 out | **609ms** | Cross-beat structural check |
| continuity-facts | 1 | ~2500 in / 7 out | **204ms** (warm) | Fact contradiction check |
| continuity-state | 1 | ~2500 in / 6 out | **204ms** (warm) | Character state check |
| tonal-pass | 0 (disabled) | ~300 in / 400 out | — | Per-paragraph voice rewrite |

**Total per chapter:** ~13 calls, ~2.1s of W&B latency (parallel-adjusted).
**Total per 3-chapter novel:** ~39 calls, ~$0.004.

W&B adapters are **not the latency bottleneck**. Beat-writer (Cerebras 235B, ~2.1s/beat) dominates chapter time.

---

## Option 1: Together AI Serverless LoRA (Tier 2 — hot standby)

### How it works

Together serves LoRA adapters on their shared serverless fleet. You upload a SafeTensors adapter, point it at a base model, and get per-token pricing at the base model rate. Multi-LoRA batching means multiple adapters share the same GPU pool.

Transport layer already supports Together (`src/transport.ts` — separate `lora` field convention). Would need to retrain adapters on a Together-supported Qwen3-14B base (or upload the existing W&B adapter weights if format-compatible).

### Latency benchmark (2026-04-12) — warm-up probe

**The old data was stale.** The 36.79s TTFT from Artificial Analysis (2026-04-07) was measured with infrequent isolated calls. A proper 20-call sequential probe (`scripts/together-warmup-probe.ts`) on Qwen 3.5 9B shows Together has improved significantly:

| Shape | Calls | Avg | Min | Max | 1st half | 2nd half |
|-------|------:|----:|----:|----:|----:|----:|
| Short (~256 out, checker-like) | 20 | **1,089ms** | 692ms | 1,738ms | 1,160ms | 1,018ms |
| Medium (~512 out, continuity-like) | 20 | **4,918ms** | 2,629ms | 10,268ms | 5,448ms | 4,389ms |

**Key finding: no warm-up effect.** First 3 calls avg = last 3 calls avg (within noise). Sustained traffic does not reduce latency — the variance is random, not a cold-start curve.

### What Together latency means for this pipeline (updated estimates)

| Call | W&B (current) | Together (measured) | Slowdown |
|---|---:|---:|---:|
| adherence-events (500 in / 200 out) | 157ms | **~1,100ms** | 7× |
| chapter-plan-checker (1000 in / 600 out) | 609ms | **~3,000ms** | 5× |
| continuity-facts/state (2500 in / 7 out) | 204ms | **~2,500ms** | 12× |
| tonal-pass per paragraph (if enabled) | ~500ms | **~3,000ms** | 6× |

**Per-chapter impact:** Currently ~2.1s of adapter latency would become ~15-25s. For a 3-chapter novel, **~45-75s of adapter wait time** vs current ~6s. This is 8-12× slower but no longer the 2-4 minute nightmare the old data suggested.

**The variance problem:** Medium-shape calls swing 2.6s to 10.3s — a 4× range within the same session. The pipeline handles this (checkers run in parallel, retries absorb spikes), but unpredictable 10s outliers would make the user experience feel unreliable.

### Together: viable as Tier 2

Together is the **hot standby** if W&B becomes untenable:
- **Setup:** 1 hour (retrain adapters on Together-supported base, upload, test)
- **Cost:** Comparable to W&B (~$0.003-0.005 per 3-chapter novel)
- **Latency:** 5-12× slower than W&B per call. Adds ~15-25s per chapter. Acceptable for development, uncomfortable for production.
- **No warm-up effect:** Don't expect it to get faster with sustained traffic.
- **Transport layer ready:** `src/transport.ts` already supports Together's `lora` field convention.

**When to pull the trigger:** If W&B inference becomes unreliable, pricing changes dramatically, or they restrict the free tier further. A same-day migration is feasible — retrain 4 adapters (~1 hour each on Together's training infra) and swap URIs in `models/roles.ts`.

---

## Option 2: Modal + vLLM

### How it works

Modal is a serverless compute platform. You deploy a Python function that loads vLLM with your base model + LoRA adapters. Modal handles the GPU provisioning, scaling, and billing.

```
Your code (Modal app, ~100 lines):
  → Starts a vLLM server on a Modal GPU
  → Loads Qwen3-14B-Instruct + 3 LoRA adapters
  → Exposes an OpenAI-compatible API endpoint
  → Scales to zero when idle
  → Wakes up on first request
```

vLLM natively supports multi-LoRA: all 3 adapters share one model instance, selected per-request via the `model` field. Same GPU, same memory, no per-adapter overhead.

### Why Modal is worse than W&B

**1. Cold starts are the dealbreaker.**

| Scenario | Latency |
|---|---|
| W&B (model always warm) | **157ms** first call |
| Modal with GPU snapshotting | **10-12s** first call |
| Modal without snapshotting | **60-120s** first call (model load from disk) |

A 14B model at FP16 needs ~28 GB of weights loaded into GPU memory. Even with Modal's GPU memory snapshotting (which pre-loads a memory snapshot), the first call after scale-to-zero takes 10-12 seconds. Without snapshotting, it's 1-2 minutes of model loading.

After warmup, subsequent calls would be fast (~150-300ms, comparable to W&B). But the pipeline runs in bursts: you kick off a novel, it runs for 5-10 minutes, then nothing for hours. Every run starts cold.

**2. You're maintaining infrastructure.**

W&B is a managed service — you push an adapter URI and it works. Modal requires:
- Writing and maintaining a vLLM serving app (~100 lines, but needs updates when vLLM/Modal APIs change)
- Managing model weights storage (Modal Volume, ~$0.50/month for 14B weights)
- Handling adapter deployment (upload new adapters to Volume, update app config)
- Monitoring health, debugging cold start issues, handling version pinning
- Understanding vLLM's LoRA configuration (adapter paths, max LoRA rank, GPU memory allocation)

**3. Cost is comparable, not better.**

| | W&B | Modal (A10, $1.10/hr) |
|---|---|---|
| 3-chapter novel (~5 min GPU) | ~$0.003 | ~$0.09 |
| 10-chapter novel (~15 min GPU) | ~$0.01 | ~$0.28 |
| Monthly (2-3 novels/day) | ~$0.20 | ~$5-8 |
| Idle cost | $0 | $0 (scale-to-zero) |

Modal is **30× more expensive per run** because you pay for the entire GPU for the duration, not just the tokens you use. W&B amortizes GPU cost across all customers on the shared fleet.

The $30/month Modal free tier covers ~27 hours of A10 time, which is plenty for your usage. But if you ever exceed it, you're paying real GPU rates.

**4. Quantization trade-offs.**

To fit on a cheaper GPU (L4 at $0.80/hr, 24 GB VRAM), you'd need AWQ/GPTQ quantization of Qwen3-14B (~8-10 GB quantized). This is fine for most tasks but introduces:
- Slight quality degradation on structured output (checkers care about precision)
- Need to re-validate all adapter performance on quantized base
- LoRA adapters trained on FP16 base may not transfer cleanly to quantized base

### Modal: what it's actually good for

Modal makes sense if:
- You need **guaranteed infrastructure control** (no surprise permission lockouts)
- You're running **long batch jobs** where cold start is amortized (e.g., processing 50 novels overnight)
- You want to serve **models W&B doesn't support** (custom architectures, larger models, experimental bases)
- W&B shuts down or becomes unusable

It does **not** make sense as a W&B replacement for your current workload pattern (short burst runs, latency-sensitive checker calls, infrequent usage).

---

## Option 3: Local Apple Silicon (Tier 4 — zero-cost self-hosted)

### Hardware available

- **MacBook Air M4 24GB** — fits 9B Q8 (~10 GB) comfortably, 14B Q4 (~9 GB) with room
- **Mac Mini M-series 16GB** — fits 9B Q4 (~6 GB) only; 9B Q8 risks memory pressure

### Expected performance

| Model | Quant | RAM | Prefill (tok/s) | Generation (tok/s) | Est. per-call |
|-------|-------|-----|-----------------|-------------------|--------------|
| 9B | Q4 | ~6 GB | ~150-250 | 30-50 | ~3-6s |
| 9B | Q8 | ~10 GB | ~100-200 | 20-35 | ~5-10s |
| 14B | Q4 | ~9 GB | ~80-150 | 15-25 | ~8-15s |

Tooling: **MLX** (Apple Silicon native, supports LoRA hot-loading via `--adapter-path`) or **Ollama** (simpler, requires merging LoRA into base weights).

### Cost comparison (adapter calls only)

| | W&B (Tier 1) | Together (Tier 2) | Local (Tier 4) |
|---|---:|---:|---:|
| Per 3-chapter novel (39 calls) | $0.004 | $0.004 | ~$0.0002 (electricity) |
| Monthly (2-3 novels/day) | $0.24-0.36 | $0.24-0.36 | ~$0.02 |
| Annual | ~$3.60 | ~$3.60 | ~$0.20 |
| Hardware | $0 | $0 | $0 (already owned) |

**Honest assessment:** Adapter costs are already negligible — W&B charges $0.004/novel. The savings from local are ~$3/year. The real value proposition is not cost:

1. **Zero provider dependency** — no pricing changes, no tier restrictions, no API outages
2. **Unlimited experimentation** — run thousands of eval probes, labeling sweeps, agreement checks at zero marginal cost
3. **Offline capability** — works without internet for the adapter portion
4. **Privacy** — training data and novel content never leave the machine

### Open questions (to evaluate)

- **LoRA adapter transfer:** Adapters trained on FP16 base (W&B/Together) may degrade on quantized local base. Need to eval all 4 adapters on Q4/Q8 Qwen 3.5 9B and compare accuracy to W&B.
- **MLX LoRA format:** Together exports SafeTensors; MLX needs compatible format. May need conversion step.
- **Latency impact on pipeline:** 39 calls × 5-10s = ~3-7 min of adapter wait per novel (vs ~2s on W&B). Acceptable for dev, uncomfortable for interactive use. Parallelism limited by single-device throughput.
- **Mac Mini 16GB viability:** 9B Q4 fits but leaves ~10 GB for OS + KV cache. Needs testing under sustained load to confirm it doesn't swap.

---

## Comparison Summary

| Factor | W&B (T1) | Together (T2) | Modal (T3) | Local (T4) | GPU Rental (T5) |
|---|---|---|---|---|---|
| **First-call latency** | 157ms | ~1,100ms | 10-120s | ~3-10s | ~3-10s (warm) |
| **Steady-state latency** | 157-609ms | 1-5s | ~150-300ms | ~3-10s | ~3-10s |
| **Cost per 3ch novel** | $0.004 | ~$0.004 | ~$0.09 | ~$0.0002 | ~$0.27 (full pipeline) |
| **Setup effort** | Done | 1 hour | 1-2 days | 2-4 hours | 2-4 hours |
| **Maintenance** | Zero | Zero | Ongoing | Minimal | Per-session |
| **Risk** | Pricing changes | Latency variance | Cold starts | Quant quality | Spot interruption |
| **Provider dependency** | Yes | Yes | Yes | **None** | Minimal |
| **Best for** | Production | Failover | Custom models | Experimentation | Batch jobs |

---

## Recommendation

**Stay on W&B (Tier 1).** Storage issue resolved, all 4 adapters deployed and serving. W&B is the prototyping tier — cheap inference ($0.05/$0.22/1M), free training during preview, zero maintenance.

**Tiered fallback plan:**

1. **Tier 1 — W&B (current).** All adapters live here. Train and serve on the same platform. $2/mo inference credit covers current volume. Risk: pricing changes, free training ending, 5 GB storage limit.

2. **Tier 2 — Together AI (hot standby).** Benchmarked 2026-04-12: ~1s short calls, ~5s medium calls, no warm-up effect. 5-12× slower than W&B but functional. Same-day migration: retrain 4 adapters (submitted 2026-04-12, Qwen 3.5 9B LoRA r=16), swap URIs. Transport layer already supports Together. Use when: W&B inference becomes unreliable or too expensive.

3. **Tier 3 — Modal + vLLM (full control).** 10-120s cold starts, 30× per-run cost, ongoing maintenance. Use when: both W&B and Together fail, or you need models/ranks neither supports.

4. **Tier 4 — Local Apple Silicon (MacBook Air M4 24GB).** Zero per-token cost, zero provider dependency. ~3-10s/call on 9B Q4/Q8 via MLX or Ollama. Adapter quality on quantized base needs evaluation. Use when: unlimited experimentation needed, or all cloud providers become untenable. Hardware already owned — no capital cost.

5. **Tier 5 — Rented GPU (RunPod/Lambda).** H100 $2.69/hr, A100 $1.39/hr, L40S $0.79/hr. Per-second billing. Benchmarked against 20 real novels (2026-04-12): **3-5x more expensive than current API setup** for per-novel pipeline execution. Cerebras wafer-scale engine and W&B shared LoRA fleet are too cost-efficient for a single rented GPU to compete at current volume. Break-even requires ~530 novels/day. Viable for batch jobs (SFT data gen, eval sweeps) where hourly rate beats per-token pricing. Full analysis: `docs/gpu-rental-analysis.md`.
