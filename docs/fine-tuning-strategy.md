---
status: active
updated: 2026-04-10
---

# Fine-Tuning Strategy

## The Core Premise

Training is free (W&B Serverless SFT, public preview). Inference is $0.05/$0.22 per 1M tokens. One base model — `OpenPipe/Qwen3-14B-Instruct` on W&B Inference — with multiple task-specific LoRA adapters. The cost of a failed experiment is ~$0.02 in evaluation calls.

This changes the math: every agent in the pipeline is a fine-tune candidate. The question is no longer "can we afford to try this?" but "what do we expect to learn?"

**The multi-adapter model**: W&B Inference supports dynamic LoRA switching on a single base. One deployed model, N adapters, each billed at base-model rates. No per-adapter overhead.

```
OpenPipe/Qwen3-14B-Instruct (hot, always warm)
  ├── novel-harness/adherence-checker-v2      [DEPLOYED]
  ├── novel-harness/tonal-howard-v4           [DEPLOYED]
  ├── novel-harness/continuity-v1             [TRAINING, exp #155]
  ├── novel-harness/chapter-plan-checker-v1   [TRAINING, exp #154]
  ├── novel-harness/fact-extractor-v1         [PLANNED]
  ├── novel-harness/lint-fixer-v1             [PLANNED]
  ├── novel-harness/voice-pass-archetype-v1   [PLANNED — Phase 3, after context eng]
  └── novel-harness/beat-writer-v1            [EXPERIMENTAL — blocked on structural diversity]
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

**Status**: Not viable without solving the training problem separately. W&B Inference is the only real option.

The constraint isn't just on the serving side. W&B Inference is limited to their catalog (Qwen3-14B-Instruct is the only viable model), but **W&B ART training is also catalog-constrained** — training runs fine on other bases in principle, but there is no end-to-end path: ART trains → W&B Inference can't serve it. For RunPod flexibility to be real, you'd need a separate training pipeline (Unsloth on Modal, or similar), which is a non-trivial infrastructure commitment that doesn't currently exist.

The "3B specialist" argument in particular doesn't hold: no 3B training path, no 3B on W&B Inference, and RunPod serving a 3B at harness traffic volumes costs ~$7–8/M anyway (see Economics below). **Qwen3-14B-Instruct on W&B is the only legitimate LoRA base available end-to-end right now.**

RunPod Serverless would genuinely remove both constraints — any model, any rank, any base — but only if you also build the training side. That's the actual gap.

### What RunPod would unlock (if training were solved)

- **LoRA rank > 16** — relevant for complex tasks (continuity, beat-writer) where higher-capacity adapters may be needed
- **Any base model** — if a better base than Qwen3-14B-Instruct emerged that W&B Inference doesn't carry
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

> **LoRA serving convention (2026-04-09):** W&B and Together AI have incompatible LoRA APIs. W&B expects the artifact URI in the `model` field (`"model": "wandb-artifact:///team/project/name:v9"`). Together AI uses a separate `lora` field alongside the base model. W&B silently ignores a `lora` field — returns 200 with base model output. The transport layer (`src/transport.ts`) auto-detects `wandb-artifact:///` prefixed URIs and routes correctly. See `docs/lessons-learned.md` for the full post-mortem.

### When RunPod would actually become viable

The real threshold is solving the training pipeline, not the serving side:

1. **A separate training path exists** (Unsloth + Modal, or similar) for the target base model
2. **AND** the target model isn't in W&B's catalog / rank > 16 / some other constraint forces the switch

Until condition 1 is true, RunPod is an infrastructure cost, not a cost saving. At harness traffic volume (~$7–8/M effective), it's ~15× more expensive than W&B Inference regardless of which base model is served.

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

### 2. Adherence Checker — V2 DEPLOYED, V3 DISCONFIRMED (4-call decomposed)

**Current**: W&B Qwen3-14B-Instruct + V2 curated LoRA · 4 parallel calls (events/setting/tangent/character) · ~627ms avg · $0.00005/call

**History**: Base 14B zero-shot hit 96% agreement on the old 160-pair single-call eval (exp #101). But the 4-call decomposed prompt (exp #122, 2026-04-08) revealed a 6pp gap: 14B at 91% vs 235B at 97% on the 160-pair decomposed eval. Worth closing at zero marginal cost (W&B SFT is free).

**Data pipeline (2026-04-09, exp #132)**: `scripts/generate-adherence-decomposed-data.ts` — 59 scenarios × 11 variants × 4 writers (Cerebras 235B, Llama 8B, Kimi K2, DeepSeek V3.2) = 2,596 prose samples × 4 decomposed oracle calls = 10,008 raw training examples. Multi-writer for stylistic diversity + organic drift from weaker models. Oracle: Cerebras 235B using production system prompts, validated against gpt-oss-120b (95% agreement). $6.16 total cost.

**Curation (2026-04-09)**: `scripts/curate-adherence-data.ts` removed 15% cross-contaminated labels → 8,524 curated examples. Cross-contamination: FAIL variants designed to test one dimension often trip non-target dimensions (e.g., FAIL_MISSING trips character contradiction because "not doing the action" ≠ "behaving out of character"). Ambiguous tangent examples (off_spec_fraction 0.3–0.7) also removed. Label balance post-curation: events 25% flag, setting 25%, tangent 17%, character 18%.

**Training status**:
- **V1 (uncurated, 10,008 examples)**: Finished. 2 epochs, batch_size=2, cosine schedule, lr=2e-4. 10 checkpoints (v0-v9). Artifact: `adherence-checker-v1-sft-resume:v9`.
- **V2 (curated, 8,524 examples)**: Finished. Same hyperparameters. Artifact: `adherence-checker-v2-sft-resume:v9`. **DEPLOYED to production.**
- **V3 (mixed-teacher, 7,541 curated examples)**: Finished. Per-flag teacher routing: K2.5 for events, gpt-oss for character, 235B for setting/tangent. Artifact: `adherence-checker-v3-mixed-teacher-sft-resume:v9`. **DISCONFIRMED — regressed vs V2.** See eval below.

**V2 production eval (exp #135, 2026-04-09)**: `scripts/eval-adherence-finetune.ts` — 64 beat/prose pairs from 20 approved chapters, 4 call types × 4 models = 1,024 API calls. V2 curated: **90% oracle agreement** (230/255). V1 uncurated: 87% (222/254). Base 14B: 77% (196/255). By call type: events V2 98%/V1 92%/base 78%, setting V2 88%/V1 83%/base 81%, tangent V2 87%/V1 92%/base 86%, character V2 88%/V1 83%/base 63%. Latency: V2 627ms, V1 701ms, base 402ms, oracle 383ms.

**V3 absolute accuracy eval (exp #146, 2026-04-10)**: `scripts/eval-adherence-synthetic.ts` — 1,343 synthetic pairs with known ground truth (injected failures), 3 models (base/V2/V3). **V3 94.4% overall vs V2 95.2%.** Critical regression: FAIL_MISSING_SUBTLE collapsed 78.6% → 55.4% (-23pp). Events recall dropped 86.6% → 74.1%. Character recall dropped 78.9% → 73.7%. Only tangent improved (71.8% → 79.5%). Root cause: K2.5 scored 95% on synthetic events (unambiguous failures) but has a more lenient threshold on marginal production cases than 235B. Training on K2.5 labels taught the student to be less sensitive to subtle missing events. **Lesson: synthetic teacher accuracy doesn't predict marginal-case calibration. A consistent single teacher (235B) produces better training signal than per-flag best teachers with different sensitivity thresholds.**

> **Critical W&B LoRA convention**: artifact URI goes in the `model` field (`"model": "wandb-artifact:///team/project/name:v9"`). W&B silently ignores a separate `lora` field — that convention is Together AI only. First eval run produced byte-identical output to base because of this. See `docs/lessons-learned.md`.

**Sonnet 4.6 teacher eval (exp #147, 2026-04-10)**: Full 1,559-pair synthetic eval using 78 parallel Claude Code subagents. Overall 96.5% (1504/1559). By variant: PASS_CLEAN 99.5%, FAIL_MISSING 98.1%, FAIL_MISSING_SUBTLE 87.2%, FAIL_TANGENT_HARD 100%, FAIL_CHAR 85.7%. By call type: setting 100%, tangent 100%, events 94.9%, character 93.3%. Decision threshold was >97% overall + >90% FAIL_MISSING_SUBTLE — Sonnet misses both (96.5%, 87.2%). Sonnet is +1.3pp overall and dramatically better on tangent (+31pp) but not a material upgrade over 235B on the marginal cases that determine training data quality. Ground truth labeling errors confirmed in `airlock_standoff` and `trench_letter` FAIL_MISSING_SUBTLE pairs (beat fully enacted but labeled false; three independent evaluations agree). See `docs/lessons-learned.md` "Sonnet 4.6 as adherence teacher."

**Next steps**: (a) tiered retry policy (events/character hard gate, setting/tangent soft gate), (b) 3-chapter romance-drama end-to-end validation of V2 + tiered retry, (c) if V2 weak spots need closing: targeted curation within 235B framework; Sonnet useful only as a disagreement-case tiebreaker (not bulk teacher), then GRPO/RL.

**Legacy data**: 160 flat-format pairs (exp #99–#100) in `lora-data/adherence-checker-pairs.jsonl` are superseded by the decomposed format.

---

### 3. Reference Resolver

**Current**: Llama 3.1 8B Groq · ~257 in / ~162 out · ~289ms · $0.00003/call

**The opportunity**: Identifies implicit references in beat prose that need context lookups. Currently runs parallel-3 with set-union to improve recall (+23% over single-shot). A fine-tuned 14B trained on oracle lookup sets would improve single-shot recall, potentially making parallel-3 unnecessary (or further improving it).

**Data source**: Already generating. Best-of-3 union outputs from approved novel beats as labeled examples. The oracle is the union of 3 Llama calls — imperfect but good enough to teach recall improvement.

**Risk**: Low-medium. Set output task with inherent variance. Evaluation needs the coarse-key metric from `benchmark/context/` (not strict Jaccard — see lessons-learned).

**Expected outcome**: Higher single-shot recall than Llama 8B, removes or reduces need for parallel-3 overhead.

---

### 4. Chapter Plan Checker — CONFIRMED FINE-TUNE CANDIDATE

**Current**: `openai/gpt-oss-120b` on Groq · ~2,880 in / ~995 out · ~2,415ms · $0.0007/call

**Zero-shot test (exp #107, 2026-04-08)**: Ran base Qwen3-14B-Instruct on W&B side-by-side with the 120B oracle across 80 synthetic pairs (10 scenarios × 8 variants, same methodology as adherence-checker exp #99–#101).

**Result**: **58% direct agreement (46/79)** — base 14B cannot replace 120B on this task.

| Variant | 14B↔120B agreement |
|---------|-------------------|
| PASS_CLEAN           | 9/10 (90%)  |
| PASS_PARAPHRASE      | 9/9 (100%)  |
| PASS_REORDER         | 9/10 (90%)  |
| PASS_ATMOSPHERIC     | 9/10 (90%)  |
| FAIL_MISSING_BEAT    | 4/10 (40%) ⚠ |
| FAIL_MISSING_CHAR    | 1/10 (10%) ⚠ |
| FAIL_REVERSED_ARC    | 5/10 (50%) ⚠ |
| FAIL_WRONG_SETTING   | **0/10 (0%)** ⚠ |

**Critical finding — 100% directional bias**: all 33 disagreements are "14B said PASS, 120B said FAIL". Zero cases where 14B was stricter. The base 14B has a systematic rubber-stamp bias — it approves almost every chapter regardless of actual plan violations, including obvious cases like setting the scene in the wrong location or omitting a character listed in the plan.

**Why this differs from adherence-checker**: Adherence-checker is a well-scoped per-beat binary classification (did this specific character appear? did the word count match?). Chapter-plan-checker requires multi-step structural reasoning over 4-5 scene beats, 5-10 facts, 3+ character state changes, and a false-positive ruleset. 14B hits its reasoning ceiling on the FAIL detection side. This is the same ceiling that made us escalate from Llama 8B → 120B originally — different failure mode (under-strict vs over-strict), same root cause.

**Why fine-tuning is justified here (unlike adherence-checker)**: The bias is 100% one-directional and highly learnable. SFT is the ideal correction for systematic under-detection — provide labeled FAIL examples and the model learns the discrimination boundary. This is the canonical use case for distillation from a stronger model.

**Fine-tune approach**: Distill gpt-oss-120b onto Qwen3-14B via SFT. The 120B judgments are trusted as labels (85% agreement with deterministic labels on the synthetic set, and disagreements were mostly label noise where the generator failed to cleanly omit/invert elements).

**Data source**: Two parallel collection paths:
1. **Real production data (primary)**: Every production chapter-plan-checker call captures `(prose, plan, oracle_pass, oracle_deviations)`. Already flowing through `llm_calls` but `response_content` needs to be reliably captured (known gap). Target: 200+ real pairs from actual novel runs.
2. **Synthetic augmentation (secondary)**: The 80-pair synthetic set exists in `lora-data/chapter-plan-checker-pairs.jsonl`. Relabel with the 120B outputs from exp #107 (stored in experiment conclusion) — this gives 80 120B-labeled pairs immediately, usable for a pilot SFT run to validate the approach before waiting for production data.

**Risk**: Medium. 14B has the raw capacity (PASS variants all ≥90%), so the fine-tune only needs to teach FAIL discrimination, not full reasoning from scratch. 200 distilled pairs is the minimum viable dataset per the adherence-checker playbook.

**Expected outcome**: Agreement with 120B rises from 58% → ≥90% after SFT. Cost drops from $0.0007 → $0.00005/call (14×). Latency drops from ~2,400ms → ~400ms (6×, matching adherence-checker profile on same base).

**Status**: Stay on gpt-oss-120b in production until a fine-tuned adapter exists. Do NOT swap to base 14B — it would rubber-stamp broken chapters.

---

### 5. Tonal Pass — V4 DEPLOYED (pref eval confirmed 2026-04-11)

**Status**: V4 adapter deployed to production. Pref eval confirmed V4 preferred. V3 on Together AI retired.

**Identity LoRA bug**: Exp #95 and #96 used `howard-tonal-v4:latest` which points to the identity LoRA placeholder (v0 uploaded at job submission). All data from those runs was base-vs-base. See `lessons-learned.md`. Real adapter is at `howard-tonal-v4-sft-resume:v8`.

**Results (exp #98, sft-resume:v8) vs V3**:

| Metric | Howard ref | Input (bland) | V3 (9B Together) | V4 (14B W&B) | Winner |
|--------|-----------|---------------|-----------------|--------------|--------|
| Classifier ↑ | 0.715 | 0.197 | 0.422 | **0.550** | V4 |
| Perplexity ↓ | 1964 | 3593 | 4814 | **3086** | V4 |
| Feature KL ↓ | 1.534 | 1.569 | 1.584 | **1.564** | V4 |
| Content pres ↑ | — | — | 0.275 | **0.583** | V4 |
| Avg latency | — | — | 1757ms | **597ms** | V4 |

**Pref eval (2026-04-11)**: 15-paragraph binary preference confirmed V4 preferred.

**Serving URI**: `wandb-artifact:///andre14618-/novel-harness/howard-tonal-v4-sft-resume:v8`

**Next step (V5, if needed)**: Re-curate training targets using V4 outputs as bootstrap teacher. Run V4 inputs through V4, use V4 outputs as new targets, apply Jaccard filter to drop pairs where output similarity > 0.6, retrain.

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

### 10. Voice-Pass LoRA (Phase 3 — after context engineering in production)

**Architecture**: Same pattern as tonal pass. Beat-writer generates voice-agnostic prose; voice-pass rewrites dialogue-only paragraphs conditioned on the character's `SpeechProfile`. The two passes are complementary: tonal pass touches narrative prose and skips dialogue; voice-pass touches only dialogue. Non-overlapping at the paragraph level.

**Training format**:
```
[system: voice-pass rewriter instructions]
[user:
CHARACTER_PROFILE:
  register: hard_boiled
  sentence_length: short
  forbidden: "perhaps", "I feel", "it seems"
  patterns: ["declarative statements", "rhetorical deflection"]
  examples: ["You want a reason? There it is.", "Move."]

DIALOGUE: "I think perhaps we should consider whether this situation warrants further examination."

CONTEXT: [surrounding prose paragraph for register reference]]
[assistant: "This needs looking at. Tonight."]
```

**Data source — public domain extraction pipeline** (see todo.md Phase 2 data):
Gutenberg texts → 2–8 sentence dialogue exchanges → 235B assigns archetype + generates flattened version → `(flat + profile) → original` training pairs. Target: 400–500 pairs across 10–12 archetypes. ~$3–5 total. Same distillation-from-corpus pattern as Howard tonal pass.

Primary Gutenberg sources by archetype:

| Archetype | Source |
|-----------|--------|
| `analytical_deducer` | Doyle (Holmes) |
| `earnest_companion` | Doyle (Watson) |
| `hard_boiled` | Hammett (Continental Op, Spade) |
| `evasive_servant` | Wodehouse pre-1930 (Jeeves) |
| `exasperated_authority` | Wodehouse (Bertie Wooster), Dickens |
| `theatrical_villain` | Dickens (various), Collins (Fosco) |
| `formal_authority` | Conrad, Trollope |
| `dialect_colloquial` | Twain (Huck, Tom) |
| `stoic_adventure` | Haggard (Quatermain) |
| `deadpan_street` | O. Henry |

**Risk**: Medium. The model must learn to apply different transformations depending on the input profile — harder than uniform style (tonal pass). Archetype coverage in training data must match production archetype distribution.

**Expected outcome**: Consistent character voice across a full novel without beat-writer cognitive load increase. Covers the primary gap (15.7% → target 25–30% dialogue with planner changes, plus each character sounds distinct).

**Prerequisite**: Phase 1 context engineering (structured `SpeechProfile` schema) must be in production first. The training data input format must match what the inference path produces.

**Status**: Blocked on Phase 1 infrastructure. See `docs/decisions.md` "Character Voice & Dialogue" for architectural rationale.

---

### 11. Character Voice Checker (Future — after voice-pass is in production)

**The opportunity**: A per-beat classifier that checks whether dialogue matches a character's `SpeechProfile`. Once the voice-pass LoRA is generating voiced dialogue, the checker can be trained from pairs the voice-pass produces — no separate labeling pipeline needed.

**Status**: Blocked on Phase 1 infrastructure and voice-pass LoRA.

---

## Data Generation Principles

**Knowledge distillation is the default approach.** Use the current best model for each task as oracle, collect its outputs, review a sample for correctness, scale.

**Generic system prompts.** Training data should use the simplest possible task description. The fine-tuned behavior lives in the weights, not the prompt. A model trained on "Does this prose match this beat?" generalizes better than one trained on a 500-word prompt full of rules.

**Label quality gates.** Every dataset needs a human review pass before training. Target: review 20-30% of examples manually, correct systematic errors, then scale. `scripts/build-analytical-finetune-data.ts` + `/app/finetune` review UI are the tools.

**Compact input format first.** For slots where prompt compression is part of the value (continuity, chapter-plan-checker), design the compact input format before generating training data. Training data must match the inference format.

## Data Sufficiency Assessment (2026-04-09)

**Production data status**: 131 approved chapters from 31 novels, but only **5 unique premises** across 5 genres. This is sufficient for adherence-checker SFT (synthetic variants cover the gap) but insufficient for chapter-plan-checker and continuity SFT, where plan structure and world-state diversity are the training signal.

| Fine-tune target | Data sufficient? | Bottleneck | Path forward |
|-----------------|-----------------|------------|--------------|
| Adherence checker | **Yes — V2 DEPLOYED** | V3 mixed-teacher regressed (exp #146). V2 stays. | Tiered retry policy + e2e validation. V2 weak spots (FAIL_MISSING_SUBTLE 78.6%, FAIL_TANGENT_HARD 69%): Sonnet teacher evaluated (exp #147, 96.5%) — better overall but below V2.1 threshold; targeted 235B curation or GRPO/RL if needed |
| Chapter-plan checker | **Yes — TRAINING (exp #154)** | 197 synthetic pairs (25 scenarios × 8 variants), gpt-oss teacher, 87.5% accuracy, 54:46 balance | Eval adapter on held-out pairs (≥80% oracle agreement); run 10–15 novels on new seeds for V2 production data |
| Continuity | **Yes — TRAINING (exp #155)** | 120 synthetic pairs (20 scenarios × 6 variants), Sonnet teacher, 98% accuracy | Eval adapter on held-out pairs (≥80%); Phase 2: scale to 300 pairs; Phase 3: compact diff input format |
| Tonal pass | **Yes — V4 DEPLOYED** | Pref eval confirmed V4 preferred (2026-04-11) | V5 if needed: bootstrap from V4 outputs |
| Tonal pass (structural) | **No** | No paired data exists (monotone → structurally rich) | Requires structural diversity pass design first |
| Beat writer | **No** | 131 chapters from 5 premises, structurally monotone (7.6% dialogue avg). Training on this would bake in the monotone shape | Address structural diversity in writer prompts first, then collect |

**Structural deficit finding**: Deterministic analysis (`scripts/analyze-structure.ts`) showed pipeline output is below published norms: 15.7% dialogue (vs 25-50% in published novels), 0.1 interiority verbs/100w, 7.5w avg sentence length (vs 12-18w). Genre does differentiate (sci-fi 24.8% vs literary fiction 8.9%) but all genres are below published density. This affects writer/tonal fine-tunes but NOT checker fine-tunes. See `docs/lessons-learned.md`. Note: initial analysis showed 7.6% dialogue but this was a measurement bug — the regex missed single-quoted dialogue.

**30 seeds created** (2026-04-09) to address premise diversity: 8 post-apoc, 7 sci-fi, 7 epic fantasy, 4 portal fantasy. These need to be run through the pipeline before chapter-plan-checker and continuity SFT data generation can begin.

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
