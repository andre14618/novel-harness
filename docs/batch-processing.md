---
status: proposal
verified: 2026-04-02
---

# Batch Processing for Cost Reduction

## Concept

Most benchmark and testing work doesn't need real-time responses. Batch APIs offer significant discounts for async processing. The iteration loop has two modes:

- **Fast path**: making a prompt change, need immediate feedback. Use Groq/Cerebras, real-time.
- **Batch path**: comprehensive evaluation across seeds, models, benchmark types. Fire and collect later.

## Provider Batch Support

### OpenAI Batch API
- **Discount**: 50% off input and output tokens
- **Turnaround**: up to 24 hours (often faster)
- **Format**: upload JSONL file of requests to `/v1/batches`
- **Limits**: 50,000 requests per batch, 200MB file size
- **Supported**: `/v1/chat/completions` (what we use)
- **Polling**: `GET /v1/batches/{batch_id}` until status is `completed`
- **Docs**: https://platform.openai.com/docs/guides/batch

### Groq Batch API
- **Status**: investigate — Groq may support async batch processing
- **Value**: Groq is already cheap, but batch could reduce costs further on high-volume runs
- **Action**: check Groq docs for batch/async endpoints

### OpenRouter Batch
- **Status**: investigate — OpenRouter proxies many providers, may support batch for some
- **Action**: check if OpenRouter passes through batch requests to underlying providers

### DeepSeek Prefix Caching (not batch, but similar cost savings)
- **Mechanism**: automatic, no code changes needed
- **Discount**: cached input tokens at $0.014/M vs $0.28/M (95% reduction)
- **How it works**: when consecutive requests share the same token prefix (system prompt), subsequent calls hit cache
- **Requirement**: system prompt must contain the word "json" for json_object mode (already done in all prompts)
- **Best for**: judge calls that share a rubric across many evaluations, writer calls that share the same system prompt
- **Limitation**: only works when calls share exact prefix from position 0

## Where Batch Processing Applies

### Benchmark Judge Calls (highest impact)
- Current: 3 judges × 3 dimensions × 15 generations = 135 calls per prose benchmark
- These are independent — no call depends on another's output
- All share the same system prompt per dimension
- Perfect for batch: submit all 135 at once, collect results later

### Benchmark Writer Generations
- Current: 5 seeds × 3 runs = 15 writer calls per prose benchmark
- Independent — each seed/run combo is self-contained
- Can be batched if latency doesn't matter
- For iteration (fast path), keep these real-time

### Cross-Model Testing
- Running the same benchmark with 5 different model configs = 5× the calls
- Each model config run is independent
- Submit all as one batch, compare results when done

### Full Harness Testing
- Running `bun src/index.ts --auto` across all 5 seeds = 5 full novel runs
- Each novel run is ~20-25 LLM calls
- Total: ~100-125 calls, fully parallelizable across seeds
- Batch the entire set, collect all novels' output at once

## Implementation Approach

### Phase 1: OpenAI Batch for Judges
1. After generating prose (real-time), serialize all judge requests to JSONL
2. Upload to OpenAI Batch API
3. Store batch_id in central DB
4. Poll or check later for completion
5. Parse results, populate scores table

**Cost impact**: if using GPT-5.4-mini as a judge:
- Real-time: $0.40/$1.60 per M
- Batch: $0.20/$0.80 per M
- 135 judge calls × ~2K tokens each ≈ 270K tokens → saves ~$0.10 per benchmark run

### Phase 2: DeepSeek Sequential Judging
1. Add DeepSeek V3.2 as a judge option
2. Run judge calls sequentially per dimension (not parallel)
3. Prefix caching kicks in automatically after first call per rubric
4. 14 of 15 calls per dimension hit cache → 95% input cost reduction

**Cost impact**: DeepSeek V3.2 as judge:
- First call per dimension: $0.28/M input
- Subsequent 14 calls: $0.014/M input (cached)
- Output: $0.42/M across all calls
- Total for 135 calls ≈ $0.02-0.03 vs $0.05+ for Gemini Flash

### Phase 3: Batch Generation Runs
1. Submit writer/planner generations as a batch when doing comprehensive testing
2. Not for iteration (need fast feedback) but for baselines and model comparisons
3. Collect all generated prose, then batch all judge evaluations
4. Two async steps: generate → judge

### Phase 4: Batch Full Harness
1. Submit entire novel run as a sequence of batch requests
2. Each phase's output feeds the next phase's input
3. More complex — requires orchestrating dependencies between calls
4. Biggest cost savings but most implementation effort

## DB Schema Support

The central DB already tracks all calls. For batch processing, we'd add:

```sql
CREATE TABLE batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES runs(id),
  provider TEXT NOT NULL,           -- 'openai', 'groq', etc.
  batch_id TEXT NOT NULL,           -- provider's batch ID
  status TEXT NOT NULL DEFAULT 'submitted',  -- submitted, processing, completed, failed
  request_count INTEGER NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  input_file TEXT,                  -- path to submitted JSONL
  output_file TEXT                  -- path to results JSONL
);
```

## Priority

1. **OpenAI Batch for judges** — 50% off, moderate implementation effort. Makes GPT-5.4-mini competitive.
2. **DeepSeek sequential judging** — automatic prefix caching, no new code. 67% discrimination (fails Dialogue). Very slow (27 tok/s) — only useful in async/batch mode.
3. **Batch generation runs** — useful for model comparison at scale.
4. **Batch full harness** — most complex, tackle when the simpler paths are proven.

## Cost Comparison (45 judge calls, ~1.5K input + ~750 output each)

| Approach | Total (45 calls) | Discrimination | Speed | Notes |
|----------|-----------------|----------------|-------|-------|
| **Qwen3 32B Groq (real-time)** | **$0.040** | **100%** | 662 tok/s | Current best for iteration |
| DeepSeek V3.2 (cached prefix) | $0.020 | 67% | 27 tok/s | Cheap but slow, misses Dialogue |
| GPT-5.4-mini (real-time) | $0.090 | 33% | — | Expensive + poor discrimination |
| GPT-5.4-mini (batch 50% off) | $0.045 | 33% | async | Still poor discrimination |
| Gemini Flash (real-time) | $0.135 | 100% | — | Good but 3x Qwen3 cost |
