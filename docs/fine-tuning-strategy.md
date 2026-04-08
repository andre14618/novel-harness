---
status: active
updated: 2026-04-08
---

# Fine-Tuning Strategy

## The Core Premise

Training is free (W&B Serverless SFT, public preview). Inference is $0.05/$0.22 per 1M tokens. One base model — `OpenPipe/Qwen3-14B-Instruct` on W&B Inference — with multiple task-specific LoRA adapters. The cost of a failed experiment is ~$0.02 in evaluation calls.

This changes the math: every agent in the pipeline is a fine-tune candidate. The question is no longer "can we afford to try this?" but "what do we expect to learn?"

**The multi-adapter model**: W&B Inference supports dynamic LoRA switching on a single base. One deployed model, N adapters, each billed at base-model rates. No per-adapter overhead.

```
OpenPipe/Qwen3-14B-Instruct (hot, always warm)
  ├── novel-harness/continuity-v1
  ├── novel-harness/adherence-v1
  ├── novel-harness/reference-v1
  ├── novel-harness/plan-check-v1
  ├── novel-harness/tonal-howard-v4
  ├── novel-harness/fact-extractor-v1
  ├── novel-harness/lint-fixer-v1
  └── novel-harness/beat-writer-v1  (experimental)
```

---

## Infrastructure

| Component | Details |
|-----------|---------|
| Base model | `OpenPipe/Qwen3-14B-Instruct` |
| Training | W&B Serverless SFT via ART (`pip install openpipe-art`) |
| Serving | W&B Inference, `WANDB_API_KEY` in env |
| Inference cost | $0.05/M input · $0.22/M output |
| Training cost | Free during public preview |
| Storage | Free under 100GB tier (~50MB per r=16 adapter) |
| Max LoRA rank | 16 (W&B Inference hard limit) |
| Training script | `scripts/train-lora.py` (Python, not Bun) |
| JSONL format | OpenAI chat format — `{"messages": [{role, content}, ...]}` |
| ART docs | https://art.openpipe.ai/fundamentals/sft-training |

**Always download the adapter after training.** W&B artifacts are downloadable (`wandb artifact get`) but the export path is not prominently documented. Archive PEFT weights locally after every run.

---

## Alternative Serving: RunPod Serverless

**Status**: Potential avenue, not yet adopted. W&B Inference remains the default.

W&B Inference has two hard constraints: base model catalog (only Qwen3-14B-Instruct is viable) and max LoRA rank 16. RunPod Serverless removes both — any model, any rank, any base size.

### Why it's worth tracking

- **No catalog lock-in** — can serve Qwen3-3B, Mistral, or any custom base
- **Task-matched sizing** — a lint-fixer or adherence-checker might only need a fine-tuned 3B, which is far cheaper per token than forcing everything onto 14B
- **LoRA rank > 16** — relevant if higher-capacity adapters are needed for complex tasks (continuity, beat-writer)
- **Horizontal auto-scaling** — each endpoint gets its own worker pool; agents never compete for rate limits the way Cerebras calls do
- **Plugs into transport.ts unchanged** — RunPod vLLM exposes an OpenAI-compatible API; only `models/registry.ts` and `models/roles.ts` need updating

### Economics

Per-second billing, scale-to-zero. Current RunPod Secure Cloud serverless endpoint rates (2026-04):

| GPU | VRAM | Active $/s | $/hr equiv | Good for |
|-----|------|-----------|------------|----------|
| A4000 | 16GB | ~$0.00016–0.00022 | ~$0.58–0.79 | Fine-tuned 3B models |
| L4/A5000 | 24GB | ~$0.00016–0.00020 | ~$0.58–0.72 | Fine-tuned 7-14B (AWQ) |
| A6000/A40 | 48GB | ~$0.00024 | ~$0.86 | Fine-tuned 14B fp16, 30B AWQ |

Note: the lower-end GPUs (A4000, L4) are cheaper as community *pod* rentals (~$0.40–0.47/hr), but serverless *endpoint* pricing adds infrastructure overhead — expect 1.3–2× the pod rate. The A6000 figure is confirmed against the lessons-learned cost analysis.

**The utilization cliff is the real cost driver.** At the continuous batch sizes the harness actually sustains, effective per-token cost is far from the hardware floor:

| Scenario | Throughput | $/M tokens (A6000) |
|----------|-----------|-------------------|
| Batched inference, 8–16 concurrent requests | ~500–2,500 TPS | ~$0.03–0.17/M |
| Single-request sequential (harness pattern) | ~60 TPS decode | ~$7–8/M |

The harness fires sequential per-beat calls with gaps between chapters. Even with idle timeout tuning, a worker is billing during inter-beat pauses and chapter transitions. The ~$0.04–0.17/M "efficient" figure only materialises at sustained concurrency the harness never produces. **The realistic cost is ~$7–8/M**, derived from an actual 10-chapter novel run in `llm_calls` (novel-1775484070927): 229K output tokens / 60 TPS decode = 3,822s active + 476K input tokens / 500 TPS prefill = 952s, all × $0.00024/s = ~$1.10 total vs $0.074 on W&B Inference. See lessons-learned for the full analysis.

The value of RunPod is **flexibility, not cost**: any model, any LoRA rank, any base size. At solo-developer volume it costs ~15× more than W&B Inference per token.

**The idle timeout trap**: A worker is billed until it scales down (configurable, default up to 5s after last request). For sequential harness calls separated by seconds of processing, the worker stays warm but also stays billing. Mitigations:
- Set idle timeout to 0s for infrequent agents (accept cold starts, ~5s with HF model cache)
- Set idle timeout to 60s for bursty sequential agents (beat-writer, adherence-checker) to stay warm across a full chapter
- Use min_workers=1 (active worker, 20–30% discount) only if the agent runs continuously throughout a production novel run

**Cold starts**: Mitigated by FlashBoot + HF model caching. With a model cached on HF, worker restore is ~5s rather than 60–90s.

### Integration path

```
W&B trains adapter
  → wandb artifact get (download PEFT weights locally)
  → peft merge_and_unload() (merge adapter into base)
  → push to private HuggingFace repo
  → RunPod endpoint: MODEL_NAME=yourorg/model-name
  → endpoint URL → models/registry.ts entry
  → agent assignment in models/roles.ts
```

Transport layer needs no changes. The RunPod vLLM URL is a drop-in OpenAI-compatible base URL.

### When to consider switching a slot

- Need a base model not in W&B's catalog
- Need LoRA rank > 16
- Want a 3B specialist for a pure classification task (adherence-checker, reference-resolver) — economics favor small models when they stay warm during runs
- Cerebras rate limits become a bottleneck for parallel agent workloads

---

## Candidate Slots — Priority Ordered

### 1. Continuity (Highest ROI)

**Current**: Cerebras Qwen 235B · 7,294 avg input tokens · $0.0023/call · highest per-call cost in pipeline by 10×

**The opportunity**: The continuity checker dumps the entire facts + character states table into the prompt on every call. A fine-tuned model that knows the harness's world-state schema can work from a structured diff — the delta since the last chapter — rather than the full dump. Compressing 7,294 → ~1,000 input tokens is a 7× cost reduction on the highest-cost slot.

**Fine-tune approach**: Teach the model to accept a compact structured diff format (new facts, changed character states, new timeline events) and reason about consistency against that, rather than a raw wall of text.

**Data source**: Generate 3-5 novels end-to-end, collect `(world_state_dump, chapter_prose, [continuity_issues], passed)` tuples per chapter from Cerebras 235B oracle calls. Then reformat inputs as structured diffs. Compact input format must be validated — the model needs to agree with the 235B oracle at ≥95% before the prompt compression is trusted.

**Risk**: High. Changing the input format means the training data must match the new format. Two-phase effort: (1) define the compact diff schema, (2) generate training data against it. Can't distill directly from existing 235B calls because those use the full-dump format.

**Expected outcome**: 7× input token reduction, 5× cost reduction per call, comparable latency to adherence-checker shape (~150-200ms).

---

### 2. Adherence Checker

**Current**: Cerebras Qwen 235B · ~360 in / ~140 out · ~520ms · $0.0003/call

**The opportunity**: Classification task (PASS/FAIL + deviation list). The 235B model is overkill for this shape. The prior Llama 8B was wrong-but-consistent (systematically over-strict); the upgrade to 235B fixed calibration. A fine-tuned 14B trained on 235B oracle decisions should match calibration at 3× lower cost and comparable latency (157ms measured on this exact shape in tuning_experiment id=94).

**Data source**: Already generating. Beat pipeline logs `(beat_spec, prose, adherence_decision, deviations)` per run. Target: 200 labeled examples with 235B oracle decisions reviewed for correctness.

**Risk**: Low. Well-scoped classification task. The benchmark infrastructure (`scripts/best-of-n-experiment.ts`) already validates agreement rate. Decision criterion: ≥95% agreement with 235B oracle on held-out set.

**Expected outcome**: Matches 235B accuracy, 2.3× faster (confirmed in latency probe), 6× cheaper per call.

---

### 3. Reference Resolver

**Current**: Llama 3.1 8B Groq · ~257 in / ~162 out · ~289ms · $0.00003/call

**The opportunity**: Identifies implicit references in beat prose that need context lookups. Currently runs parallel-3 with set-union to improve recall (+23% over single-shot). A fine-tuned 14B trained on oracle lookup sets would improve single-shot recall, potentially making parallel-3 unnecessary (or further improving it).

**Data source**: Already generating. Best-of-3 union outputs from approved novel beats as labeled examples. The oracle is the union of 3 Llama calls — imperfect but good enough to teach recall improvement.

**Risk**: Low-medium. Set output task with inherent variance. Evaluation needs the coarse-key metric from `benchmark/context/` (not strict Jaccard — see lessons-learned).

**Expected outcome**: Higher single-shot recall than Llama 8B, removes or reduces need for parallel-3 overhead.

---

### 4. Chapter Plan Checker

**Current**: `openai/gpt-oss-120b` on Groq · ~2,880 in / ~995 out · ~2,415ms · $0.0007/call

**The opportunity**: Structural reasoning task — compare chapter prose against the structured plan (beats, characters, facts, state changes) and classify deviations. The false-positive ruleset (paraphrased dialogue, reordered details, atmospheric additions are NOT deviations) is currently in the prompt. A fine-tuned model compresses those rules into weights and works from a shorter prompt.

**Data source**: Persist `(prose, plan, deviations, passed, model)` to a `chapter_plan_checks` table so every real novel run generates a labeled example. After 50-100 examples: review in Claude Code, correct false positives, train. The `openai/gpt-oss-120b` base is on the W&B supported list — could distill from that oracle directly.

**Risk**: Medium. Complex multi-step reasoning. The prior Llama 8B failure (couldn't reason through structural rules, bounced valid prose) shows the task requires genuine reasoning capacity. The 14B should be sufficient but needs validation. 50 labeled examples is the minimum viable dataset.

**Expected outcome**: Comparable accuracy to gpt-oss-120b, 3× faster, 2× cheaper per call. More importantly: shorter prompt → lower input tokens → further cost reduction.

---

### 5. Tonal Pass — IN PROGRESS (V4 trained, pref eval pending)

**Status**: V4 adapter trained and benchmarked (exp #98, 2026-04-08). Quantitative metrics favor V4; qualitative pref eval in progress. V3 stays in production until pref eval confirms.

**Identity LoRA bug**: Exp #95 and #96 used `howard-tonal-v4:latest` which points to the identity LoRA placeholder (v0 uploaded at job submission). All data from those runs was base-vs-base. See `lessons-learned.md`. Real adapter is at `howard-tonal-v4-sft-resume:v8`.

**Real results (exp #98, sft-resume:v8) vs V3**:

| Metric | Howard ref | Input (bland) | V3 (9B Together) | V4 (14B W&B) | Winner |
|--------|-----------|---------------|-----------------|--------------|--------|
| Classifier ↑ | 0.715 | 0.197 | 0.422 | **0.550** | V4 |
| Perplexity ↓ | 1964 | 3593 | 4814 | **3086** | V4 |
| Feature KL ↓ | 1.534 | 1.569 | 1.584 | **1.564** | V4 |
| Content pres ↑ | — | — | 0.275 | **0.583** | V4 |
| Avg latency | — | — | 1757ms | **597ms** | V4 |

**Qualitative concern**: V4 outputs read as more conservative (measured, period-accurate) vs V3 (bolder, more dramatic rewriting). Metrics say V4 wins but prose quality reading says V3 may still be better. Pref eval tab (`/app/lora-style` → Pref Eval) resolves this — 15-paragraph binary preference rating, results saved to DB.

**Next step (V5)**: If pref eval confirms V3 still reads better — re-curate training targets. Strategy: run all 4,497 training inputs through V3, use V3 outputs as new targets (teacher-student bootstrap). Apply Jaccard filter to drop pairs where output similarity > 0.6 (conservative targets). Train V5 on the curated V3-bootstrapped set, re-run pref eval.

**Serving URI**: `wandb-artifact:///andre14618-/novel-harness/howard-tonal-v4-sft-resume:v8`

---

### 6. Fact Extractor

**Current**: Unnamed model · 17-20 facts/chapter · target 8-15 · over-extracts

**The opportunity**: The extractor consistently over-extracts — captures minor background details that clutter the fact store and degrade deterministic query precision. A fine-tuned model trained on labeled examples of "keep this / drop this" learns the right selection threshold.

**Data source**: `bun scripts/build-finetune-data.ts --task fact-extractor` → review 20-30 pairs in Claude Code → mark facts as keep/drop → scale to 300+. Labeling criteria: facts that would matter for a continuity check 10 chapters later, vs facts that are set dressing.

**Risk**: Low-medium. The selection criteria are subjective and need consistent human labels. But the problem (over-extraction) is well-defined and measurable.

**Expected outcome**: 8-12 facts/chapter (vs 17-20), higher precision, continuity checker benefits downstream.

---

### 7. Lint Fixer (AI Clichés)

**Current**: Llama 3.1 8B Groq · per-sentence with scene context · ~131ms · $0.00005/$0.00008 per call

**The opportunity**: The creative replacement task (replacing "the silence stretched" with scene-specific concrete sensory detail) is the hard part of the lint pipeline. Llama 8B does it adequately but occasionally over-writes or misses the scene's physical details. A fine-tuned 14B trained on good rewrites from approved chapters would produce more grounded replacements.

**Data source**: Mine approved novel chapters — for each AI cliché lint flag that was successfully fixed, collect `(flagged_sentence, surrounding_paragraphs, good_rewrite)` triples. Target: 200-300 examples across the 8 AI cliché pattern types.

**Risk**: Low. The task is bounded per-sentence. Even a marginal quality improvement is measurable via lint compliance + collateral damage metrics.

**Expected outcome**: Fewer over-writes, more scene-grounded replacements, slightly higher lint compliance rate.

---

### 8. Beat Writer (Experimental / High Upside)

**Current**: Cerebras Qwen 235B · ~846 in / ~391 out · 2,155ms · ~$0.001/call

**The opportunity**: This is the highest-risk, highest-upside candidate. A fine-tuned 14B trained on (beat_spec + context, high-quality prose) pairs would cost $0.000128/call vs $0.001 — a 7.8× reduction. More importantly: a beat-writer fine-tuned on harness-specific data might follow beat specs more reliably than a general 235B.

**Why it's risky**: The beat-writer is the creative core of the pipeline. The 235B's general capacity handles edge cases (unusual settings, complex character states, unusual beat types) that a 14B fine-tune might miss. Adherence failures compound chapter-over-chapter. Any quality regression here is pipeline-breaking.

**Data source**: Collect (beat_spec, world_state, transition_bridge, reference_context) → approved prose pairs from the best-rated novel runs. Only include beats where the prose passed all quality checks on first attempt. Target: 500+ high-quality examples across diverse seeds.

**Validation bar**: Higher than other slots. Requires: (1) adherence rate ≥ current 235B baseline, (2) seed constraint compliance (qualitative review), (3) lint counts ≤ current baseline, (4) at least 2 full novels generated without regression. Shadow-run in parallel with 235B before swapping.

**Expected outcome if it works**: 7.8× cost reduction on the primary writer slot. More likely partial outcome: fine-tune works for common beat types, falls back to 235B for complex cases.

---

### 9. Rewriter

**Current**: Cerebras Qwen 235B · runs on validation failures · reruns full chapters

**The opportunity**: The rewriter currently receives a chapter + list of issues and must fix specific problems without touching the rest. A fine-tuned model trained on (chapter, issue_list, fixed_chapter) triples would learn which issues it can actually fix surgically vs. which require more significant rewrites.

**Note**: Lessons-learned showed full-chapter rewriting introduces 63-78% collateral regardless of model. Fine-tuning doesn't fix that fundamental problem. This slot should stay on a capable model unless the input format changes to per-sentence rewrites.

**Status**: Low priority until the input format problem is solved.

---

### 10. Character Voice Checker (Future)

**Prerequisite**: Speech profiles must be built into character-agent first (richer `speechPattern` field with register, vocabulary, forbidden phrases).

**The opportunity**: A per-beat classifier that checks whether dialogue matches a character's established speech profile. Currently doesn't exist. Could be trained from (dialogue_line, speech_profile, matches: bool) examples generated by having 235B oracle label existing chapters.

**Status**: Blocked on speech profile infrastructure.

---

## Data Generation Principles

**Knowledge distillation is the default approach.** Use the current best model for each task as oracle, collect its outputs, review a sample for correctness, scale.

**Generic system prompts.** Training data should use the simplest possible task description. The fine-tuned behavior lives in the weights, not the prompt. A model trained on "Does this prose match this beat?" generalizes better than one trained on a 500-word prompt full of rules.

**Label quality gates.** Every dataset needs a human review pass before training. Target: review 20-30% of examples manually, correct systematic errors, then scale. `scripts/build-analytical-finetune-data.ts` + `/app/finetune` review UI are the tools.

**Compact input format first.** For slots where prompt compression is part of the value (continuity, chapter-plan-checker), design the compact input format before generating training data. Training data must match the inference format.

---

## Evaluation Protocol

All fine-tune evaluations use the same structure:

1. **Agreement rate vs oracle** on held-out examples. Decision criterion: ≥95% agreement for a slot swap.
2. **End-to-end pipeline run** on 2 seeds × 2 runs. No regression on adherence pass rates, plan check rates, or lint counts.
3. **Latency probe** on the actual production workload shape (match output token count to real production calls).
4. **Cost comparison** at production call volume (per 10-chapter novel).

If a slot fails criterion 1 but is close, expand training set and retrain. Training is free — iteration cost is just the evaluation runs.

---

## Sequencing

**Phase 1 — Analytical trio** (data nearly ready)
- Adherence-checker, reference-resolver: train once 200+ examples accumulated
- Chapter-plan-checker: build `chapter_plan_checks` table, accumulate 50-100 examples

**Phase 2 — Tonal pass v4 + fact extractor** (data exists)
- v4: re-curate `howard-tonal-pairs-curated.jsonl`, train, evaluate against v3 on same 15-paragraph set
- Fact extractor: label 300 examples, train, measure facts/chapter

**Phase 3 — Continuity** (requires schema work first)
- Design compact diff format
- Generate training data against new format
- Validate format before training

**Phase 4 — Lint fixer + beat writer** (opportunistic)
- Lint fixer: low-risk, run when 200+ examples mined from approved chapters
- Beat writer: run only after Phase 1-3 are stable; treat as research, not production swap
