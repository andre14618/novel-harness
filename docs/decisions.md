---
status: active
updated: 2026-04-11
---

# Decisions

Architectural decisions with rationale, evidence, and alternatives rejected. Append-only: decisions are never removed, only superseded (mark old decision superseded and add a new one). Use git blame / experiment IDs for full detail.

**Format per entry:** decision → why → alternatives rejected → ongoing implications.

---

## Infrastructure & Serving

### W&B Inference on OpenPipe/Qwen3-14B-Instruct chosen as LoRA serving home
*2026-04-07 · exp #94 (`scripts/test-wandb-inference.ts`)*

**Decision:** All new fine-tuned adapters are trained and served on W&B — `OpenPipe/Qwen3-14B-Instruct` as the base, W&B Serverless SFT (ART framework) for training, W&B Inference for serving.

**Why:** Latency probe of 5 providers × 3 workload shapes showed 14B on W&B at 157ms adherence-checker avg (vs 365ms Cerebras 235B baseline) and 2,008ms beat-writer avg (1.3× baseline). Training is free during ART public preview. Inference at $0.05/$0.22 per 1M tokens. Storage free under 100GB tier (~50MB per r=16 adapter). Zero infra to operate.

**Latency probe results (exp #94):**

| model | adherence avg | beat-writer avg | verdict |
|---|---:|---:|---|
| Qwen3-14B-Instruct (OpenPipe) | **157ms** | 2,008ms | **CHOSEN** |
| Qwen3-30B-A3B-Instruct-2507 | 7,172ms (33s p95) | 16,268ms | TOO SLOW |
| openai/gpt-oss-120b | 3,881ms | 7,339ms | MARGINAL |
| Qwen3-235B (Cerebras baseline) | 365ms | 1,520ms | reference |

**Alternatives rejected:**
- **Fireworks** — verified at docs: does not support serverless LoRA. Only stock models.
- **Qwen3-30B-A3B** — killed by cold-start sensitivity on W&B; 33s p95 on adherence-checker workload is unusable.
- **RunPod Serverless** — requires a separate training pipeline (W&B ART can't train for non-catalog bases). At solo-dev traffic volume (~sequential per-beat calls), effective cost is ~$7–8/M vs $0.22/M on W&B — 15× more expensive due to dedicated GPU idle billing. Value is flexibility (any rank, any base), not cost. See lessons-learned "RunPod dedicated GPU is 2× more expensive."
- **DeepInfra** — "Custom LLMs" product is dedicated GPU rental at $2–5/hr per A100/H100, not serverless. See decision below.

**LoRA API convention (critical):** W&B expects the artifact URI in the `model` field (`"model": "wandb-artifact:///team/project/name:v9"`). W&B silently ignores a separate `lora` field — that is the Together AI convention. First runs produced base-model output because of this. The transport layer (`src/transport.ts`) auto-detects `wandb-artifact:///` prefix and routes correctly.

**Ongoing:** W&B Inference catalog is limited (Qwen3-14B-Instruct, Llama-3.1-8B/70B, gpt-oss-120b, Qwen3-30B-A3B). LoRA rank hard-limited to 16. Any adapter requiring a different base or rank > 16 would require RunPod + a separate training path.

**Update — exp #148 (2026-04-10):** W&B now keeps Qwen3-30B-A3B warm. Adherence-checker shape: 7,172ms → 551ms avg (13× improvement). Beat-writer shape: 16,268ms → 11,054ms (still 9.5× Cerebras baseline — TOO SLOW for writing). 30B-A3B is now viable for checker-shaped tasks. Throughput ceiling remains (58 tps vs 14B's 261 tps) — MoE decode on W&B is slower per token than dense 14B, so output-heavy workloads don't benefit. 30B-A3B is worth evaluating as a chapter-plan-checker fine-tune base given its larger expert pool and 551ms adherence latency. Cost is 2× input / 1.36× output vs 14B.

---

### DeepInfra not viable as LoRA serving home
*2026-04-08*

**Decision:** DeepInfra is not a candidate for serving fine-tuned adapters.

**Why:** DeepInfra has two distinct products: (1) serverless inference of stock models (competitive per-token pricing), and (2) "Custom LLMs" — dedicated GPU rental at $2–5/hr per A100/H100 with weekly invoicing. The per-provider speed comparison that made DeepInfra appear attractive (3.1× faster than Together on stock Qwen 3.5 9B) was measuring product #1. Our LoRA adapters require product #2. At bursty solo-developer traffic, dedicated GPU rental is uneconomical by 2–3 orders of magnitude.

**Ongoing:** DeepInfra remains a potential source for cheap stock model inference (no LoRA needed). Not a fine-tune serving option.

---

### W&B Serverless SFT (ART framework) for training
*2026-04-08*

**Decision:** All LoRA training uses W&B's Serverless SFT powered by OpenPipe's ART framework on CoreWeave GPUs. No Modal, no Unsloth, no manual upload.

**Why:** `OpenPipe/Qwen3-14B-Instruct` is ART's own fine-tuning-optimized fork — training against it is the native path. Training is free during public preview. Adapter auto-saves as a W&B artifact and is immediately routable via W&B Inference. The full round-trip (train → serve → eval) requires zero infrastructure outside the project.

**Ongoing:** ART training is catalog-constrained (same bases as W&B Inference). If a task ever requires a base W&B doesn't support, a separate training path (Unsloth + Modal) becomes necessary. This is the actual threshold for RunPod to make sense.

---

## Adherence Checker

### 4-call decomposed prompt over single-call schema
*2026-04-08 · exp #122*

**Decision:** Adherence checking uses four parallel calls (events / setting / tangent / character) rather than a single combined call.

**Why:** Exp #122 showed the single overloaded call caused 14B to conflate dimensions and fire on wrong dimensions. Decomposition to focused binary classifiers closed ~6pp gap vs oracle on the 160-pair eval and removed systematic cross-dimension leakage (e.g., FAIL_MISSING also triggering character_contradiction). Each call is now a well-scoped binary classification.

**Per-call schemas:** events → `{events_present, evidence, reasoning}`, setting → `{setting_matches, expected_setting, actual_setting, reasoning}`, tangent → `{off_spec_fraction, off_spec_quote, is_tangent, reasoning}`, character → `{character_contradiction, evidence, reasoning}`.

**Ongoing:** The 4-call structure is the production schema. All training data (V1, V2, V3) and all future fine-tunes target the decomposed format. The 160 flat-format pairs from exp #99–#100 are superseded.

---

### Chapter-plan-checker per-beat decomposition DISCONFIRMED
*2026-04-08 · exp #123*

**Decision:** Chapter-plan-checker stays as a single flat call over the full chapter. Per-beat parallel calls were tested and rejected.

**Why:** Per-beat decomposition compounds error multiplicatively (0.9⁴ ≈ 66% pair-level accuracy at 90% per-beat for a 4-beat chapter). More critically, it cannot detect cross-beat properties like FAIL_REVERSED_ARC (0–22% across all models in per-beat mode). gpt-oss-120b regressed 90% → 64%; Qwen 235B regressed 81% → 72%.

**Contrast with adherence-checker:** Adherence decomposition worked because each sub-check is genuinely independent (events ≠ setting ≠ tangent ≠ character). Chapter-plan checks are structurally interdependent — arc reversal, character absence, and pacing can only be assessed over the full chapter.

**Ongoing:** Flat single-call stays. SFT distillation from gpt-oss-120b onto Qwen3-14B is the pending path to reduce cost and latency.

---

### V2 curated adapter deployed; V1 uncurated superseded
*2026-04-09 · exp #132 (data), exp #135 (eval)*

**Decision:** V2 curated adapter (`adherence-checker-v2-sft-resume:v9`) is the production adapter.

**Why:** V2 at 90% oracle agreement (230/255) vs V1 uncurated 87% (222/254) vs base 14B 77% (196/255) on 64 production pairs from 20 approved chapters. Curation removed 15% cross-contaminated labels: FAIL variants designed to test one dimension often triggered non-target dimensions (FAIL_MISSING also firing character contradiction). Removing ambiguous tangent examples (off_spec_fraction 0.3–0.7) further reduced label noise.

**V2 known weak spots (as of production deploy):**
- FAIL_MISSING_SUBTLE: 78.6% on synthetic ground truth
- FAIL_TANGENT_HARD: 69.0% on synthetic ground truth

**Adapter URI:** `wandb-artifact:///andre14618-/novel-harness/adherence-checker-v2-sft-resume:v9`

**Ongoing:** V2 remains production. Future improvement paths: targeted curation within 235B framework, tiered retry policy, or GRPO/RL reward loop.

---

### V3 mixed-teacher adapter DISCONFIRMED, V2 remains production
*2026-04-10 · exp #138/#140 (teacher ladder), exp #145 (V3 training), exp #146 (V3 eval)*

**Decision:** Mixed-teacher training (different oracle models per flag) is rejected as a strategy. V2 (single 235B teacher) remains production.

**Why:** V3 used per-flag best teachers (K2.5 events 95%, gpt-oss character 100%, 235B setting/tangent) selected by synthetic accuracy. V3 regressed vs V2: 94.4% vs 95.2% overall; FAIL_MISSING_SUBTLE collapsed 78.6% → 55.4% (−23pp); events recall dropped 86.6% → 74.1%. V3 only improved on tangent (71.8% → 79.5%) where 235B was already the teacher in both V2 and V3.

**Root cause:** The teacher ladder measured accuracy on unambiguous injected failures (beats completely removed, settings swapped). Every competent model scores 85–100% on those. It cannot distinguish teachers' calibration on *marginal* production cases — prose that partially covers a beat, character behavior arguably consistent. On those cases, K2.5 is more lenient than 235B on subtle missing events. Training on K2.5 labels taught the student K2.5's lenient threshold.

**The lesson:** Teacher accuracy on easy synthetic benchmarks does not predict teacher quality on marginal cases. To properly compare teachers: take cases where teachers *disagree* on production data, hand-label those, and see who is right. Synthetic-only teacher selection is insufficient.

**Ongoing:** A consistent single teacher (235B) is the correct approach. If specific weak spots need improvement, targeted 235B curation on those variants is the path — not per-flag teacher routing.

---

### Sonnet 4.6 evaluated as adherence teacher: below threshold, not adopted
*2026-04-10 · exp #147*

**Decision:** Sonnet 4.6 does not replace 235B as the primary adherence-checker teacher. V2 production adapter stays.

**Evidence:** 1,559-pair synthetic eval with 78 parallel Claude Code subagents. Overall 96.5% (1504/1559). FAIL_MISSING_SUBTLE 87.2%. FAIL_TANGENT_HARD 100%. FAIL_CHAR 85.7%. By call type: setting 100%, tangent 100%, events 94.9%, character 93.3%. Decision threshold: >97% overall AND >90% FAIL_MISSING_SUBTLE. Sonnet misses both.

**Why Sonnet performs better than 235B overall (+1.3pp) but isn't a clear upgrade:** Sonnet is dramatically better on FAIL_TANGENT_HARD (+31pp) and unambiguous cases. On the marginal cases that determine training data quality (FAIL_MISSING_SUBTLE, FAIL_CHAR), Sonnet performs similarly to 235B with the same types of false-negative errors.

**Sonnet's failure modes:**
- FAIL_CHAR (85.7%): Treats soft-compliance cases (character does action but with wrong dynamic) as passing due to "only flag clear contradictions" instruction.
- FAIL_MISSING_SUBTLE (87.2%): Mix of genuine model errors (interrupted-but-announced actions treated as enacted) and confirmed ground truth errors (see below).

**Ground truth labeling errors confirmed:** `airlock_standoff` and `trench_letter` FAIL_MISSING_SUBTLE pairs are mislabeled — prose fully enacts all beat elements. Three independent evaluations (smoke test × 2 + full eval) all returned `events_present=true`. Exclude from future accuracy calculations.

**Sonnet's remaining role:** Disagreement-case tiebreaker only — collect cases where Sonnet and 235B disagree on production pairs, hand-label those, and use Sonnet's label where it's more accurate. Bulk training data stays 235B-labeled.

---

### Tonal pass V4 deployed — pref eval confirmed
*2026-04-11 · exp #98 (quantitative) + pref eval*

**Decision:** V4 (`howard-tonal-v4-sft-resume:v8` on W&B Inference) is the production tonal-pass adapter. V3 on Together AI retired.

**Evidence:** Quantitative metrics from exp #98 favor V4 on every dimension (classifier 0.550 vs 0.422, perplexity 3086 vs 4814, content preservation 0.583 vs 0.275, latency 597ms vs 1757ms). Pref eval (15-paragraph binary preference in `/app/lora`) confirmed V4 is preferred.

**Alternatives rejected:** V3 read as "bolder and more dramatic" in subjective review — pref eval did not support retaining V3 on prose quality grounds.

**Actions taken:** `models/roles.ts` `tonal-pass` switched from Together AI (V3) to W&B Inference V4. Together AI no longer serves any production adapter.

**Ongoing:** Clean up Together AI entries from `models/registry.ts` and remove `TOGETHER_API_KEY`. V5 strategy (if needed later): run V4 inputs through V4, bootstrap new training targets, filter Jaccard > 0.6.

---

## Character Voice & Dialogue

### Voice-pass LoRA: beats-compatible, character-conditioned, same pattern as tonal pass
*2026-04-11 (architectural decision — no experiment yet)*

**Decision:** Character voice enforcement is built as a dedicated voice-pass LoRA on Qwen3-14B, not as additional complexity inside the beat-writer call. Architecture mirrors the tonal pass exactly: beat-writer generates voice-agnostic prose, voice-pass rewrites dialogue-only paragraphs conditioned on a structured `SpeechProfile`. In-context pattern matching (structured profiles + few-shot archetype examples) ships first as Phase 1; the fine-tune is Phase 3.

**Why a separate pass rather than beat-writer context enrichment:**
At 14B, loading the beat-writer call with simultaneous beat adherence + world state + voice enforcement causes drift. The beat-writer already manages beat spec, transition bridges, character snapshots, reference lookups, and word count. Adding voice enforcement to the same call degrades beat adherence on complex scenes. A separate focused call (one job: voice) is more reliable and independently improvable.

**Why in-context first:**
The `speechPattern` field is currently free text ("sounds gruff"). Replacing it with a structured `SpeechProfile` schema (register, sentenceLength, vocabulary, forbiddenPhrases, syntacticPatterns, emotionalExpression) plus 2–3 example dialogue lines in the beat context is a zero-cost, zero-training improvement that ships immediately and also generates the schema that the voice-pass LoRA will be conditioned on.

**Data sourcing — pattern research + synthetic generation:**
Study modern fiction freely to understand archetype speech patterns — fair use for research is not in question. What a `stoic_warrior` or `scheming_noble` sounds like is a pattern, not a copyrightable expression. The training data itself is generated synthetically: use 235B to produce `(flat_dialogue + archetype_profile) → (voiced_dialogue)` pairs from those patterns. Verbatim copyrighted dialogue lines are not used as training targets. Modern genre fiction (fantasy, sci-fi, post-apoc) is more relevant to the seeds the pipeline targets than public domain sources, which skew toward registers the pipeline doesn't use. Target: 400–500 pairs across 10–12 archetypes. ~$3–5 at 235B rates.

**Beat compatibility:**
Voice-pass runs after beat validation converges (same position as tonal pass). Dialogue-only paragraphs are identified by the same logic the tonal pass uses to skip them — inverted: voice-pass touches only dialogue paragraphs, tonal pass skips them. The two passes are complementary and non-overlapping at the paragraph level.

**Why in-context pattern matching for Phase 2 (archetype library):**
Named archetypes with structured profiles and few-shot example lines allow Q14B to apply consistent voice without training. This covers the common case (archetypal characters) and generates the labeled examples needed to evaluate whether Phase 3 (fine-tune) closes any remaining gap.

**Dialogue quantity is a separate problem:**
15.7% dialogue vs 25–50% published norm is a planner problem, not a voice problem. Fix is a planning-plotter prompt change requiring at least 2 of 4–6 scene beats to be dialogue-driven. No training required. These are logged separately in todo.md.

**Alternatives rejected:**
- *Add voice to beat-writer context only* — insufficient for a 14B model handling simultaneous beat adherence + voice; demonstrated pattern in adherence-checker that focused calls outperform overloaded single calls.
- *Train a character-specific adapter per novel* — not tractable; adapter per novel defeats the purpose of a shared base and exceeds W&B storage economics at any real novel volume.
- *Voice checker instead of voice pass* — a binary checker tells you voice is wrong but doesn't fix it; a rewrite pass produces better prose directly. Checker can be added later as a quality gate on top of the pass.

**Ongoing:** Phase 1 (structured SpeechProfile schema + forbidden phrase lint + planner dialogue guidance) builds next. Phase 2 (archetype library + few-shot beat context) follows as novel runs accumulate. Phase 3 (voice-pass LoRA) begins once Phase 1 is in production and dialogue pattern ingestion script is built.

---

## Reference Resolver

### Reference-resolver SFT permanently off the list
*2026-04-09 · exp #114/#115 (with amendment)*

**Decision:** No fine-tune planned for reference-resolver. The task is sufficiently solved by base Llama 3.1 8B.

**Why:** Base 14B is at 97.5% recall against synthetic labels in parallel-3 mode. Production cost function strongly favors recall (over-fetching context is nearly free; missing a reference propagates through the full beat). No real deficit to train against. The "checklist wins" framing in exp #115 was a metric artifact — checklist prompt improved the eval metric but not the underlying reference quality.

**Ongoing:** Flat Llama 8B Groq stays. If a clear production failure mode emerges (beats consistently missing references despite over-fetching), revisit.

---

## Tonal Pass

### V4 (Qwen3-14B W&B) trained and benchmarked; quantitative metrics favor V4 over V3
*2026-04-08 · exp #98*

**Decision:** V4 adapter trained. V3 stays in production pending qualitative pref eval.

**Evidence (exp #98, `howard-tonal-v4-sft-resume:v8`):**

| Metric | Howard ref | V3 (9B Together) | V4 (14B W&B) | Winner |
|--------|-----------|-----------------|--------------|--------|
| Classifier ↑ | 0.715 | 0.422 | **0.550** | V4 |
| Perplexity ↓ | 1964 | 4,814 | **3,086** | V4 |
| Feature KL ↓ | 1.534 | 1.584 | **1.564** | V4 |
| Content pres ↑ | — | 0.275 | **0.583** | V4 |
| Avg latency | — | 1,757ms | **597ms** | V4 |

**Qualitative concern:** V4 reads as more conservative (measured, period-accurate) vs V3 (bolder, more dramatic). Metrics favor V4 but prose reading may favor V3. Pref eval tab (`/app/lora` → Pref Eval) resolves this.

**Serving URI:** `wandb-artifact:///andre14618-/novel-harness/howard-tonal-v4-sft-resume:v8`
**V3 (legacy):** Together AI Qwen 3.5 9B + howard-tonal-v3.

**Note on identity LoRA bug:** Exp #95 and #96 concluded V4 underperformed V3 — wrong. Both runs hit the identity LoRA placeholder (`howard-tonal-v4:latest` = v0). The real adapter is at `howard-tonal-v4-sft-resume:v8`. Lesson: always verify artifact version, not just name.

**Ongoing:** V3 stays in production. V4 switches in after pref eval confirms. V5 strategy (if pref eval favors V3): run inputs through V3, use V3 outputs as new targets (teacher-student bootstrap), filter pairs with Jaccard > 0.6, retrain.

---

### Tonal-pass v4 retrain on Qwen3-14B for unified serving — OFF THE TABLE
*2026-04-08*

**Decision:** No retrain of the tonal-pass adapter solely for the purpose of moving it from Together AI to W&B Inference.

**Why:** The motivation was unified serving (one provider). This is the wrong cost/benefit framing: the existing V3 adapter on Together AI works, the V4 adapter trained on Qwen3-14B is a capability upgrade (not just an infrastructure migration), and the right trigger for moving providers is capability — not serving consolidation. Retraining on a less-capable older base (Qwen 3.5 9B → Qwen3-14B) for infrastructure reasons was based on flawed reasoning: models should be compared on task output, not parameter count.

**Ongoing:** V4 on W&B replaces V3 on Together when pref eval confirms V4 prose quality. The switchover is a capability decision, not an infrastructure cleanup.

---

## Process / Method

### LLM judges (1–10 scoring) removed from quality pipeline
*(date: pre-2026-04, documented retrospectively)*

**Decision:** No LLM judges with numeric scales (1–10, 1–5) anywhere in the pipeline. Quality is measured via structured pass/fail checks only.

**Why:** LLM judges with 1–10 scales showed 0–33% discrimination across 200+ benchmark runs — models reliably scored everything between 6 and 8 regardless of actual quality difference. Pass/fail checkers (adherence, chapter-plan, continuity) showed 15–30% discrimination between good and bad prose on the same material. The numeric signal is not just noisy — it's uninformative.

**Ongoing:** Any new quality signal must be structured pass/fail or a quantifiable metric (word count, dialogue%, lint count). No numeric judge scores.

---

### Synthetic teacher accuracy doesn't predict calibration on marginal cases
*(derived from V3 mixed-teacher failure, 2026-04-10)*

**Decision:** Do not select teachers based on synthetic benchmark accuracy alone. Teacher selection requires disagreement-case hand-labeling on production data.

**Why:** Synthetic pairs have unambiguous injected failures — beats completely removed, settings swapped, blatant contradictions. Every competent model scores 85–100% on those. The synthetic eval cannot distinguish teachers' calibration on marginal cases (prose that partially covers a beat, character behavior that's arguably consistent). On marginal cases, different teachers draw the PASS/FAIL line differently based on their training distribution, not their benchmark accuracy.

**Protocol for future teacher evaluation:** (1) generate synthetic ground truth eval — necessary but not sufficient; (2) collect production pairs where candidate teacher disagrees with current teacher; (3) hand-label those disagreements; (4) measure which teacher's labels match human judgment. Only if candidate teacher wins step 3 is it adopted.

**Ongoing:** Applied to adherence-checker teacher selection. Should be applied to any future task where teachers are being compared.

---

### Continuity SFT blocked until labeling pipeline is built with a stronger teacher
*(2026-04-09 · exp #117/#118)*

**Decision:** Continuity fine-tuning cannot use 235B as oracle teacher. Blocked until Claude-as-teacher labeling pipeline is built and validated.

**Why:** Exp #117/#118 showed 235B misses 90% of WARNINGs and 65% of NITs in synthetic eval. Distilling 235B would replicate exactly those failure modes in the student. The task is genuinely hard for 235B — the synthetic eval may be measuring "task fundamentally hard for this model tier" rather than "student has a fixable deficit."

**Path forward:** (a) build Claude-as-teacher labeling script (Opus or Sonnet — NOT gpt-oss, which is peer-tier with 235B on this task); (b) hand-validate WARNING and NIT variant injections in `scripts/generate-continuity-data.ts` first; (c) re-run #117/#118 equivalent with Claude as teacher to confirm meaningful improvement before committing to a full data run.

**Cost at scale:** ~1,000 pairs at ~3K in / 1K out ≈ $120 (Opus) / $15 (Sonnet) — trivial once the labeling quality is confirmed.

---

### Parallel subagents via Claude Code for large-scale annotation tasks
*(2026-04-10 · exp #147)*

**Decision:** Use Claude Code batch subagent spawning for annotation/evaluation tasks that require frontier model judgment on hundreds to thousands of examples.

**Why:** 78 parallel Sonnet subagents processed 1,559 adherence pairs in a single session. No API billing (covered by Claude Code subscription). Each subagent reads a batch JSON file, returns structured JSON, writes results to a JSONL file. Aggregation via a local Bun script. Total wall time: ~30 minutes vs hours of sequential API calls.

**Pattern:**
1. Export pairs as individual/batch JSON files (local or LXC)
2. Spawn N parallel subagents (batches of 20 pairs each = N/20 agents)
3. Each subagent writes results to `/tmp/adherence-results/batch_NNN.jsonl`
4. Aggregate with a local script → combined JSONL → rsync to LXC for DB recording

**Ongoing:** This pattern is reusable for continuity labeling, chapter-plan-checker SFT data collection, and any future large-scale annotation task.

---

### Chapter-plan-checker: Sonnet 4.6 adopted as teacher — gpt-oss superseded
*(2026-04-11 · exp #158)*

**Decision:** Switch from gpt-oss-120b to Sonnet 4.6 as the oracle teacher for all chapter-plan-checker SFT data. V2 data collection uses Sonnet labels only.

**Why:** Sonnet 94.3% vs gpt-oss 88.2% on a 229-pair, 25-scenario, 8-variant eval (exp #158). Adjusted for 12 confirmed GT labeling errors: Sonnet 99.5% vs gpt-oss 93.1%. Sonnet wins on the variants where correctness matters most for training signal quality:

| Variant | Sonnet | GPT-oss | Delta |
|---------|--------|---------|-------|
| PASS_REORDER | 100% | 82.8% | +17pp |
| FAIL_REVERSED_ARC | 89.7% | 82.8% | +6.9pp |
| PASS_PARAPHRASE | 100% | 96.4% | +3.6pp |
| FAIL_MISSING_CHAR | 96.4% | 96.4% | — |
| All FAIL_WRONG_SETTING, PASS_CLEAN, PASS_ATMOSPHERIC | 100% | 100% | — |

GPT-oss failure mode: over-literal on beat reordering and arc reversal. Calls FAIL when prose contains all required beats/arcs in non-canonical order. This is the false-positive pattern the V1 adapter may have inherited.

FAIL_MISSING_BEAT: both models at 67.9% / 46.4% vs GT — driven by 12 GT labeling errors where the beat IS present but GT incorrectly marks it missing. Not a teacher quality issue.

**Alternatives rejected:**
- **Keep gpt-oss** — 88.2% is at the lower end of the "consider Sonnet" threshold. The specific failure patterns (PASS_REORDER, FAIL_REVERSED_ARC) are exactly the variants most likely to produce bad training signal. Cost is $0 with Sonnet via subagents. No reason to keep gpt-oss.

**V1 training implication:** The V1 adapter (`chapter-plan-checker-v1`, exp #154, 197 pairs) was trained on gpt-oss labels, which had ~12% error rate on PASS_REORDER and FAIL_REVERSED_ARC. V1 should be treated as a pilot only. Post-eval target remains ≥80% oracle agreement before production deployment.

**V2 path:**
1. Add 20+ scenarios to `scripts/generate-chapter-plan-data.ts` (currently 25, target 45+)
2. Label with Sonnet subagents
3. Combine with V1 data (relabeled with Sonnet) → ~500+ pairs
4. Train `chapter-plan-checker-v2` on W&B Serverless SFT

**Ongoing:** gpt-oss remains the production oracle until V2 adapter passes ≥80% eval. Do not swap yet.
