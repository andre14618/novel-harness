---
status: proposal
updated: 2026-04-18
---

# Small-model distillation plan

**Goal:** distill checker adapters into 2B-4B local-inference-capable models. Evaluates whether focused checker tasks can run on Apple Silicon with <100ms latency at >95% of 14B baseline quality.

**Not for kicking off without approval** — per `feedback_together_explicit_only.md`, every Together/Modal training run needs explicit per-job authorization.

## Candidate adapters, ranked by distillability

### Tier 1 — narrow, training data available, strong production signal

**`halluc-leak-salvatore` → 1.7B/4B**
- Task: binary `{has_leak, leaks[]}`, prose-only input (~300 tokens)
- Current 14B stats: 100% synth precision / 80% natural precision / ~250ms latency
- Training data: `finetune-data/halluc-leak-salvatore-v1-train.jsonl` (237 pairs), already formatted
- Why best first: smallest input, narrowest decision boundary, 100% precision matters in production
- Expected small-model quality: high confidence of ≥95% precision retention; recall may drop 5-10pts
- Training cost (Together, Qwen3-1.7B): ~$0.80, 5 min wall time
- Serving: Together-hosted inference OR MLX-converted adapter for local

**`halluc-ungrounded-entity` → 4B**
- Task: `{pass, issues[]}`, full context (~2000 tokens brief + WB + speakers + prose)
- Current 14B stats (v2, with v1 natural merged): TBD — training in flight
- Training data: `finetune-data/halluc-ungrounded-v1-train.jsonl` (1,273 pairs)
- Why next: larger input, broader decision surface — need 4B capacity rather than 1.7B
- Training cost (Together, Qwen3-4B): ~$1.50-2, 10 min wall time

### Tier 2 — proven production checkers, data needs reformatting

**`adherence-events` → 1.7B/4B**
- Task: `{events_present, evidence, reasoning}`, short input (~400 tokens)
- Current 14B stats: 79% first-attempt production pass, 0 FP in 30-beat eval
- Training data: archived at `~/Desktop/personal_projects/archives/novel-harness/lora-data/adherence-checker-v3-curated.jsonl` (7,541 pairs — PLENTY)
- Data reshape needed: v4 is a 2,134-pair focused subset. Could re-curate from v3 archive.
- Why valuable: highest-confidence distillation candidate (most training data, validated task shape)
- Training cost: ~$1-2 depending on subset size

**`chapter-plan-checker` → 4B**
- Task: `{pass, deviations[]}`, chapter-scope input (~1500 tokens plan + prose)
- Current 14B stats: 96% accuracy vs Sonnet ground truth / 609ms latency
- Training data: archived at `.../lora-data/chapter-plan-checker-pairs.jsonl` (520 pairs)
- Why 4B not 1.7B: cross-beat reasoning harder for smallest tier
- Training cost: ~$1

### Tier 3 — deprioritized / skip

- **continuity** — deprioritized per session 2026-04-18; skip.
- **reference-resolver** — 120 pairs in archives, but small model not obviously better than existing Llama 3.1 8B Groq.

## Training infrastructure

**Training path:** Together AI (supports Qwen3-1.7B, Qwen3-4B, Llama-3.2-{1B,3B}, Qwen2.5-1.5B). W&B serverless rejects sub-8B bases. Modal + Unsloth is the fallback if Together quality disappoints.

**Serving path:** Together-hosted inference for POC measurement; MLX-converted adapter for genuinely-local serving. Two-stage:
1. Measure on Together (parity test against 14B baseline)
2. If accuracy clears 95% of 14B → convert to MLX, integrate with `src/transport.ts` as a `local` provider

**Training-data format requirement:** Together rejects `_meta` fields. Use the `-nometa.jsonl` variants (strip `_meta` before upload, mirroring `halluc-checker-v2-train-nometa.jsonl` pattern).

## Decision gates per adapter

1. **Data prep** → run. Strip `_meta`, upload to Together.
2. **Submit training** → **requires explicit user authorization per job.** Cost <$2/run.
3. **Eval head-to-head**: trained small adapter vs deployed 14B, same eval-results infrastructure (the `sql/026_checker_eval_columns.sql` schema covers both).
4. **Ship criteria**:
   - Accuracy within 2pts of 14B baseline on both synth val + natural val
   - JSON schema validity ≥99% (no malformed outputs)
   - Latency ≤100ms warm on Together; <50ms warm on MLX
5. **Deploy criteria**: pass ship criteria AND `adapter_registry` shows `status='deployed'` rather than `candidate`.

## Proposed first experiment

**`halluc-leak-salvatore-qwen17b-poc`** — lowest risk, narrowest scope, already-formatted data.

- Base: `Qwen/Qwen3-1.7B`
- Training file: `halluc-leak-salvatore-v1-train-nometa.jsonl` (237 pairs, strip _meta first)
- Epochs: 3, LoRA r=16 α=32, lr=2e-4
- Cost: ~$0.80
- Wall time: ~5 min
- Eval: run both `halluc-leak-salvatore-v1-val-synth.jsonl` (60 pairs) AND `halluc-leak-salvatore-natural-val.jsonl` (160 pairs)
- Success gate: ≥95% precision on synth val; ≥75% precision on natural val; ≥99% JSON validity

If POC succeeds, scope up to Tier 1 ungrounded-entity (4B) next.

## What this plan does NOT do

- **Does not train anything automatically.** Every training run requires explicit user approval per `feedback_together_explicit_only.md`.
- **Does not replace any production adapter.** Small models ship as *parallel* candidates in the registry (status=`candidate`), not replacements. The 14B adapters stay deployed until a small-model variant passes ship criteria.
- **Does not address latency-floor claims directly** — Together inference is cloud-hosted (~150-300ms). Only MLX-converted adapters serving locally deliver the <100ms vision. Conversion is the NEXT step after training proves out.
