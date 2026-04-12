# W&B Alternatives Report: Together AI vs Modal

**Date:** 2026-04-12
**Context:** W&B pay-as-you-go plan blocks artifact deletion (403 on all methods). 21.8 GB stored, 5 GB free tier. Need to evaluate migration paths for LoRA serving.

## Current Pipeline: What Actually Runs on W&B

Per chapter, the pipeline makes **~11 W&B adapter calls**:

| Adapter | Calls/chapter | Shape (in/out tokens) | W&B latency | Role |
|---------|---:|---|---:|---|
| adherence-events | ~9-10 (2.25 per beat × 4 beats) | ~500 in / 200 out | **157ms** | Beat-level event checker |
| chapter-plan-checker | 1 | ~1000 in / 600 out | **609ms** | Cross-beat structural check |
| tonal-pass | 0 (disabled) | ~300 in / 400 out | — | Per-paragraph voice rewrite |

**Total per chapter:** ~11 calls, ~1.7s of W&B latency (parallel-adjusted).
**Total per 3-chapter novel:** ~33 calls, ~$0.003.

W&B adapters are **not the latency bottleneck**. Beat-writer (Cerebras 235B, ~2.1s/beat) and continuity (Cerebras 235B, ~7,300 input tokens) dominate chapter time.

---

## Option 1: Together AI Serverless LoRA

### How it works

Together serves LoRA adapters on their shared serverless fleet. You upload a SafeTensors adapter, point it at a base model, and get per-token pricing at the base model rate. Multi-LoRA batching means multiple adapters share the same GPU pool.

Transport layer already supports Together (`src/transport.ts` — separate `lora` field convention). Would need to retrain adapters on a Together-supported Qwen3-14B base (or upload the existing W&B adapter weights if format-compatible).

### The latency problem

Together was previously benchmarked on Qwen 3.5 9B (the former tonal-pass base):

| Provider | Model | Decode speed | TTFT | Source |
|---|---|---:|---:|---|
| DeepInfra | Qwen 3.5 9B | 170.9 tps | 12.27s | lessons-learned.md |
| **Together** | **Qwen 3.5 9B** | **55.6 tps** | **36.79s** | lessons-learned.md |

Together was **3.1× slower** than DeepInfra on identical weights. TTFT of **36.79 seconds** is the killer — that's the time before the first token arrives.

### What Together latency would mean for this pipeline

The pipeline's W&B calls are short-output, latency-sensitive checker calls. Current W&B performance:

| Call | W&B (current) | Together (estimated) | Impact |
|---|---:|---:|---|
| adherence-events (500 in / 200 out) | 157ms | **~4-8s** (TTFT-dominated) | 9 calls × 4-8s = **36-72s added per chapter** |
| chapter-plan-checker (1000 in / 600 out) | 609ms | **~6-12s** | +6-12s per chapter |
| tonal-pass per paragraph (if enabled) | ~500ms | **~4-8s** | 8 calls × 4-8s = **32-64s per chapter** |

**Why the estimates are this bad:** Together's 36.79s TTFT was on a 9B model. A 14B model would be equal or worse. Even if Together has improved by 2-3× since the benchmark, TTFT would still be 12-18s — versus W&B's sub-200ms. The gap is structural: W&B/CoreWeave keeps models warm on dedicated CoreWeave GPUs; Together's standard tier shares capacity across all customers.

**Per-chapter impact:** Currently ~1.7s of adapter latency would become ~40-80s. For a 3-chapter novel, that's **2-4 minutes of pure adapter wait time** vs the current ~5 seconds.

### Together: could it work?

**Maybe, with caveats:**
- Together may have improved since the benchmark (2026-04-07). A re-benchmark is cheap — just run `scripts/test-qwen-speed.ts` pointed at Together.
- Together offers a "Turbo" tier for some models with better latency, but Qwen3-14B Turbo availability is unconfirmed.
- If TTFT has dropped to 2-3s (a 10× improvement from the benchmark), the pipeline impact shrinks to ~30s per novel — acceptable.
- Adherence-events calls could potentially be batched or parallelized differently to hide latency.

**Bottom line:** Together is **low-effort to try** (transport layer exists, adapter upload is straightforward) but **high risk of unacceptable latency**. A 15-minute benchmark would resolve this.

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

## Comparison Summary

| Factor | W&B (current) | Together AI | Modal + vLLM |
|---|---|---|---|
| **First-call latency** | 157ms | ~4-36s (TTFT) | 10-120s (cold start) |
| **Steady-state latency** | 157ms | ~4-8s | ~150-300ms |
| **Cost per 3ch novel** | $0.003 | ~$0.003 | ~$0.09 |
| **Setup effort** | Done | 1 hour (retrain/upload) | 1-2 days |
| **Maintenance** | Zero | Zero | Ongoing |
| **Artifact control** | Broken (403) | Full | Full |
| **Risk** | Storage lockout | Latency regression | Cold starts, infra burden |

---

## Recommendation

**Don't migrate yet.** The W&B storage problem is real but doesn't block inference — your adapters still serve fine, you just can't clean up or train new ones. The correct sequence:

1. **Contact W&B support** about the 403 permission issue. This is likely a bug or misconfigured default on the pay-as-you-go plan. You are the sole owner of a personal team and cannot delete your own artifacts — that's broken.

2. **Benchmark Together latency** (15 minutes). Run the existing `scripts/test-qwen-speed.ts` against Together's current Qwen3-14B endpoint. If TTFT is under 3s, Together becomes a viable hot-standby. If it's still 10s+, rule it out.

3. **If W&B support fails and Together is too slow**, then Modal becomes the fallback. Accept the cold start penalty and the maintenance burden as the cost of full control.

4. **Self-hosted RTX 3090** ($500 one-time) remains the nuclear option for long-term independence from all providers. Zero cold start, zero per-token cost, complete control. Worth considering if you're running novels daily.
