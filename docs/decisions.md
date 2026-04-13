---
status: active
updated: 2026-04-12
---

# Decisions

Architectural decisions with rationale, evidence, and alternatives rejected. Append-only: decisions are never removed, only superseded (mark old decision superseded and add a new one). Use git blame / experiment IDs for full detail.

**Format per entry:** decision → why → alternatives rejected → ongoing implications.

---

## Infrastructure & Serving

### W&B Inference on OpenPipe/Qwen3-14B-Instruct chosen as LoRA serving home
*2026-04-07 · exp #94 (`scripts/test-wandb-inference.ts`)*

**Decision:** All new fine-tuned adapters are trained and served on W&B — `OpenPipe/Qwen3-14B-Instruct` as the base, W&B Serverless SFT (ART framework) for training, W&B Inference for serving.

**Why:** Latency probe of 5 providers × 3 workload shapes showed 14B on W&B at 157ms adherence-checker avg (vs 365ms Cerebras 235B baseline) and 2,008ms beat-writer avg (1.3× baseline). Training is free during ART public preview (temporary). Inference at $0.05/$0.22 per 1M tokens ($2/month free credit). 5 GB storage free tier. Zero infra to operate. W&B is the prototyping tier — production may require migration for broader model support.

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

**Why:** `OpenPipe/Qwen3-14B-Instruct` is ART's own fine-tuning-optimized fork — training against it is the native path. Training is free during public preview (temporary). Adapter auto-saves as a W&B artifact and is immediately routable via W&B Inference. The full round-trip (train → serve → eval) requires zero infrastructure outside the project.

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

## Extraction Agents

### Extractor V1 adapters trained — structural eval passed, content eval pending
*2026-04-13 · exp #187*

**Decision:** Trained 4 extractor LoRA adapters on W&B (Qwen3-14B-Instruct) to replace Cerebras 235B extraction calls. All 4 produce valid JSON, correct schemas, and valid enum values. Content accuracy via Sonnet-as-judge eval is pending before deployment.

**Why:** Extraction agents account for $4.78/14d across 4 agents (125 calls/agent). All are schema-driven JSON extraction — proven SFT targets. 256 Sonnet-reviewed training pairs per adapter from 50 novels. Sonnet correction rates: fact-extractor 97% (over-extraction trimming), summary-extractor 50% (length fixes), character-state 56%, relationship-timeline 67%.

**Eval results (structural, on training data):**
- fact-extractor: 100% valid JSON, 65.8% word-overlap F1 (misleading — deep inspection shows ~80-85% semantic accuracy due to split/merge/rephrase differences)
- summary-extractor: 100% schema completeness, 92.4% word ratio
- character-state: 95.9% name recall, 100% per-character schema completeness
- relationship-timeline: 100% section/enum completeness, item counts match ground truth

**Key finding:** Word-overlap F1 is a poor eval metric for extraction tasks. Facts can be split, merged, or rephrased while capturing identical information. Sonnet-as-judge semantic comparison is the right eval — instructions at `scripts/extractor-eval-judging-instructions.md`.

**Known issue — sequence truncation:** W&B ART max_seq_length=2048. 77-100% of training examples exceed this. Assistant responses (the learned output) are at the end and get truncated first. Mitigation: truncate user prompt (chapter prose) instead of output, retrain. This likely explains the fact-extractor's ~15% genuine fact drops.

**Known issue — prompt drift:** summary-extractor and character-state prompts were edited after training data generation. Minor wording changes. Must align before deploying.

**Frozen prompts documented:** All adapter system prompts recorded in `docs/adapter-training-reference.md` with exact text, drift status, and safe-to-edit guidance.

**Alternatives considered:** Could have skipped Sonnet review and trained directly on 235B output (silver standard). Chose Sonnet review because fact-extractor had 97% correction rate — 235B output quality was insufficient for the task.

**Ongoing:** Extractor deployment blocked by content accuracy (see below). Architecture audit revealed deeper problem — most extractors are redundant with planner.

### Extraction architecture audit — 3 of 4 extractors redundant with planner
*2026-04-13 · follows exp #187 eval*

**Decision:** Do not deploy fact-extractor, character-state, or summary-extractor adapters. The planner already produces equivalent data deterministically via `establishedFacts`, `characterStateChanges`, `knowledgeChanges`. Only relationship-timeline extracts information the planner cannot see (prose-level relationship dynamics, trust shifts, knowledge propagation).

**Why — the `"both"` extractionMode is backwards:**
- Extractors write to the same tables as planner state (`fact_store`, `character_knowledge`, `character_states`)
- DB uses `ON CONFLICT DO UPDATE` — extractor output **overwrites** planner's deterministic declarations
- This replaces ground truth (planner knows what it planned) with approximations (LLM guessing what happened)
- At 80% accuracy per extractor, compounded across 4 extractors and 10+ chapters, this introduces hundreds of wrong or missing entries into the world state tables that continuity checker reads

**Redundancy analysis:**

| Extractor | Planner equivalent | Unique signal |
|-----------|-------------------|---------------|
| fact-extractor | `establishedFacts` per chapter | Minor prose-revealed facts planner didn't plan — but these are low-continuity-impact |
| character-state | `characterStateChanges` + `knowledgeChanges` | Emotional state from prose — but beat context already has character snapshots |
| summary-extractor | Chapter plan itself is the summary | Only used by embeddings-fallback retrieval path, which is disabled (`pipeline.embeddings = false`) |
| relationship-timeline | **No planner equivalent** | Trust shifts, knowledge propagation, timeline events from prose — planner can't see these |

**Sonnet-as-judge eval results (content accuracy on training data):**
- fact-extractor: 84.2% recall, 93.5% precision — climax/resolution facts dropped, category errors
- summary-extractor: 92.5% key events, 79.7% open threads — drops 4th/5th thread, 2/19 fabrications
- character-state: 73.9% knows recall, **57.1% doesNotKnow recall** — knows↔doesNotKnow inversions silently corrupt dramatic tension gaps
- relationship-timeline: 84.1% overall, 73.8% awareness — invents items when ground truth has 0

**Recommended path:**
1. Switch to `extractionMode: "plan"` and run 5 novels — measure whether continuity checker false-negative rate changes
2. If no regression: extractors add no signal, remove entirely
3. If regression on relationship data: keep relationship-timeline only (the one unique extractor), drop the other 3
4. If regression on facts/character state: investigate whether scoped extraction (smaller surface) or planner expansion is cheaper than fixing 4 adapters

**Alternatives rejected:**
- Deploy all 4 adapters anyway: 57% doesNotKnow recall means nearly half of dramatic tension gaps are wrong. Net negative for continuity.
- Retrain with truncation fixes: addresses sequence length but not the fundamental redundancy with planner. Effort wasted if plan-only mode works.
- Scope down extractors: still LLM calls that can fail, still overwrite planner data. Only justified if plan-only shows measurable regression.

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

---

### Adherence checker V3-sonnet: 7,540 pairs relabeled, training submitted
*(2026-04-11 · exp #159)*

**Decision:** Relabel the full V3 curated dataset (7,541 pairs) with Sonnet 4.6 as single consistent teacher, replacing the disconfirmed mixed-teacher labels. Submit as `adherence-checker-v3-sonnet` to W&B Serverless SFT.

**Why:** The V3 mixed-teacher adapter (exp #146) regressed vs V2 — confirmed root cause is calibration divergence when different teachers label different call types within the same task. Sonnet as a single teacher across all 4 call types (events/setting/tangent/character) eliminates this. Sonnet teacher accuracy: 96.5% overall (exp #147) — tangent 100% (vs V2 adapter's 69%), FAIL_MISSING_SUBTLE 87.2% (vs V2 adapter's 78.6%). These are exactly V2's weak spots.

**What was done:**
- All 7,541 V3 curated pairs relabeled via Sonnet subagents (138 batches of 20–100 pairs each)
- 7,540 unique pairs produced (ID 6319 missing — 0.013%, negligible)
- Label distribution: events 2,444 pairs (90.5% PASS), setting 2,137 (83.6% PASS), tangent 2,372 (89.6% PASS), character 2,126 (93.6% PASS)
- Training: 2 epochs, batch size 2, lr 2e-4, cosine schedule, `OpenPipe/Qwen3-14B-Instruct` base
- Expected adapter URI: `wandb-artifact:///andre14618-/novel-harness/adherence-checker-v3-sonnet-sft-resume:v9`

**Decision gate before production deployment:**
- FAIL_TANGENT_HARD must improve beyond V2's 69%
- FAIL_MISSING_SUBTLE must improve beyond V2's 78.6%
- Events must NOT regress below 95%

**Alternatives rejected:**
- **Continue with V2 (235B teacher):** V2 weak spots are structural — tangent calibration is genuinely worse because 235B scored ~80% on tangent (exp #147 showed 235B has limited tangent sensitivity). Sonnet at 100% tangent accuracy is a real signal, not noise.
- **Targeted augmentation within 235B framework:** Would add data but not fix the calibration threshold. The teacher defines the boundary; more data won't shift it.

**Ongoing:** V2 remains in production. V3-sonnet training in progress (~4h). Eval after training; deploy if decision gate passed.

---

### Adherence checker V3-sonnet: production eval results + degenerate output fix
*(2026-04-12 · exp #159 eval)*

**Findings:** V3-sonnet adapter evaluated against 235B oracle on 60 production pairs.

| call type | V2 curated | V3-sonnet | delta |
|-----------|-----------|-----------|-------|
| events    | ~95%      | TBD       |       |
| setting   | ~90%      | TBD       |       |
| tangent   | 69%       | TBD       |       |
| character | **82%**   | **61%**   | **−21pp** |

Character call regressed 21pp vs V2. Root cause identified (see below). Other call types pending full eval.

**Degenerate output bug fixed:** V3-sonnet produced stochastic parse failures and ctrl-char token cascade loops at `temperature=0.1`. Root cause: distributional narrowing from fine-tuning reduces output entropy, causing the model to spiral on low-entropy BPE byte tokens. Fix: `frequency_penalty: 0.3` — penalizes recently-seen tokens and breaks the cycle. Tested 5/5 clean at 523ms vs 0/5 clean baseline. No impact on label quality. This setting is now permanent for V3-sonnet inference. See `src/transport.ts` `extraBody: { frequency_penalty: 0.3 }`.

---

### Adherence checker CHARACTER call: prompt scope gap identified, new prompt designed
*(2026-04-12)*

**Decision:** Redesign CHARACTER_SYSTEM prompt before training V4. Do NOT deploy revised prompts to production until teacher accuracy is measured.

**Root cause of V3-sonnet character regression:** The production CHARACTER_SYSTEM prompt contains two scope-narrowing guardrails: "only flag clear contradictions" and "do NOT flag normal creative interpretation." Sonnet follows these literally — it only flags unambiguous reversals. The 235B oracle ignores these guardrails and flags broadly based on intent. V3-sonnet learned Sonnet's narrow boundary. V2 learned 235B's broader boundary. V3-sonnet character 61% = correct behavior given the prompt, not a model defect.

**Analysis of 29-pair FP/FN breakdown:**
- 0 false positives (V3-sonnet correctly catches clear contradictions)
- 8 false negatives (all pattern: "beat's events simply do not occur, characters act consistently" — model interprets consistency of behavior correctly but misses missing actions as character failure)

**New CHARACTER_SYSTEM prompt designed (in `scripts/eval-adherence-finetune.ts`):**
- Splits verification into 4 explicit checks: PRESENCE, ACTIONS, DYNAMICS, PHYSICAL CONSISTENCY
- Removes the blanket "only flag clear contradictions" guardrail
- Preserves the NOT-a-mismatch list for FP suppression
- `character_contradiction=true` if ANY of the four checks fails
- Validated by Claude subagents on synthetic clean pairs: 0 false positives

**EVENTS call secondary-action gap also found and fixed:**
- Production EVENTS_SYSTEM: "the beat's action" (singular) — misses multi-action beats
- New EVENTS_SYSTEM: "every distinct action...ALL must appear...partially enacted is not fully enacted"
- Validated by Claude subagents: 0 FP on clean prose, correctly caught partial enactments

**Superseded:** Prompts shipped to production 2026-04-12. Character call merged into events. See entries below.

### Adherence retry surface tightened: 4→1 LLM calls, targeted rewrite
*(2026-04-12 · ground-truth eval on 30 production pairs + production fire-rate analysis on 563 calls)*

**Decision:** Ship new events+attribution prompt, remove character/setting/tangent calls, replace blind retry with targeted rewrite.

**Evidence:**
- Ground-truth eval (30 pairs, Claude subagents): new events prompt 93% vs old 77% (+16pp). Character call 87%, 6/8 catches redundant with events. Character's unique signal (2 line attribution swaps) folded into events prompt.
- Production fire rates (563 calls per agent, 41 novels): tangent 0 fires (zero signal), setting 24 fires (4.3%) but all planner-level bugs (wrong setting on beat spec when scene transitions mid-chapter). Neither fixable by beat writer.
- Compound FP: 4 calls at 5% each → 18.5% false alarm rate per beat. Single call → ~5-7%.

**Changes shipped:**
1. New events+attribution prompt (multi-action + character attribution in one call)
2. Character call removed (6/8 catches redundant with events)
3. Setting call removed (4.3% fire rate, planner-level bugs, tracked upstream in todo)
4. Tangent call removed (0 fires in 563 calls)
5. Targeted rewrite: on failure, writer gets previous prose + specific issues instead of generic "try again"
6. Alignment offset detection: prior beat prose tail included on retry to prevent duplication

**Alternatives rejected:** Soft gates (run but don't retry) — considered for setting/tangent but production data showed they add zero actionable signal. Removing entirely is cleaner.

**Ongoing:** V2 LoRA trained on old prompt distribution. Testing base 14B with new prompt (step 0). V4 re-labeling with Sonnet planned — instructions at `scripts/v4-adherence-relabeling-instructions.md`.

### Chapter plan checker narrowed to cross-beat properties only
*(2026-04-12)*

**Decision:** Remove `beats_covered` and `characters_present` from chapter plan checker. Keep `setting_match`, `emotional_arc_correct`, and major plot contradiction detection.

**Why:** Beat-level adherence checker already covers event enactment and character presence per beat. Chapter plan checker was re-checking the same things at chapter level — redundant signal that added false positives without catching anything the beat checker missed. The unique value of chapter-level review is cross-beat coherence (arc direction, setting across scenes, plot contradictions).

**Also cleaned:** Removed architecture context ("downstream agents", pipeline references) from 5 agent prompts. Small models should know their task, not the system.

### Dialogue deterministic check removed from adherence checker
*(2026-04-12)*

**Decision:** Remove the `beat.characters.length >= 2 → dialogue required` check from `src/agents/writer/adherence-checker.ts`.

**Why:** Created infinite retry loops for valid scenes where a character is intentionally silent (tense moments, nonverbal beats). Writer generated correct prose, check fired, retry produced identical correct prose — no recoverable path. The events+attribution LLM call already handles missing dialogue when the beat requires it. The deterministic check was redundant and had no false-negative case the LLM wouldn't also catch.

**Also:** The regex didn't reliably match typographic/curly quotes, making it fragile on top of the semantic false-positive problem.

**Alternatives rejected:** Tightening the regex (still semantically wrong for intentional-silence beats). Making it non-blocking (adds noise without fixing the loop).

---

### Adherence checker V4: Sonnet re-labeling + W&B training submitted
*(2026-04-12 · exp #161)*

**Decision:** Re-label all V3 curated training data with Sonnet using the new events+attribution prompt, train V4 adapter on W&B.

**Why:** V2 LoRA was trained on the old single-action prompt ("the beat's action" — singular). New prompt requires ALL actions + attribution. V2 may resist the new prompt's multi-action/attribution rules because it learned the old distribution. V3-sonnet also regressed on character (61%). V4 starts fresh with the final merged prompt.

**Data:** 7,541 V3 examples deduplicated to 2,134 unique (beat, prose) pairs. Labeled by Sonnet 4.6 across 17 parallel batches. Class balance: 59% true / 41% false. Assembled to `lora-data/adherence-checker-v4-events-sonnet.jsonl`.

**Training:** Submitted to W&B Serverless SFT as `adherence-checker-v4`, base `OpenPipe/Qwen3-14B-Instruct`, 2 epochs, lr 2e-4. Expected artifact: `adherence-checker-v4-sft-resume:v9`.

**Step 0 running in parallel:** Base 14B with new prompt on LXC. If first-attempt pass rate >85%, the prompt alone may suffice. V4 training proceeds regardless — the adapter eliminates latency regression (base 14B showed ~38s cold-start vs LoRA warm).

**Eval plan:** 30-pair ground-truth eval at `/tmp/eval-pairs-30.json` (target ≥93%, matching new prompt's measured accuracy). Then 3-chapter production run (target: >85% first-attempt pass rate).

**Production eval results (2026-04-12):** coastal-mystery 10-chapter run (30 unique beats, novel-1776016972464):
- First-attempt pass rate: **79%** (23/30 beats passed attempt 1)
- All 6 att1 failures resolved on retry (targeted rewrite)
- FP assessment: 5/6 failures = unambiguous true positives (prose genuinely missing specific required beat actions). 1/6 borderline (receiving vs sending a text message — accepted on att2). Zero false positives driving unnecessary rewrites.
- 1/30 beats had a false pass on att1 (checker under-read a 4-part complex beat spec; missing action correctly caught on chapter-level rerun att2).
- Synthetic eval (70% on 30 adversarial pairs) is not a reliable signal — many pairs were intentionally adversarial (prose for beat N contains beat N+1 actions). Production eval is the authoritative metric.

**Decision:** Keep `adherence-checker-v4` deployed at 512 token budget. Signal is clean — the checker identifies real beat failures, not hallucinated ones. No re-training needed unless production FP rate increases. Exp #161 concluded.

---

### Base 14B not viable for chapter plan checker (reconfirmed)
*(2026-04-12 · exp #107 still current)*

**Decision:** Keep chapter plan checker on gpt-oss-120b. Do NOT swap to base Qwen3-14B.

**Why:** Base 14B scored 58% with 100% one-sided bias (exp #107) — rubber-stamps every FAIL case. SFT adapter (exp #154) is the path forward, pending eval.

---

## Beat Architecture

### Beat description style matters more than granularity — dramatic beats over screenplay
*(2026-04-12 · exp #165)*

**Decision:** The planner prompt's "good beat" example and beat description style should shift from micro-screenplay to dramatic. Current dense screenplay beats cause the writer to transcribe specs into prose rather than interpret them. Granularity increase (more beats per chapter) is measurably harmful to dialogue density.

**Evidence (9-condition eval: 3 granularities × 3 styles, same chapter, same characters, Cerebras Qwen 235B writer):**

| Condition | Beats | Words | Dlg% | Int/100 | Spec Echo | SentCV | Seam% |
|-----------|-------|-------|------|---------|-----------|--------|-------|
| screenplay/current | 3 | 1,372 | **29%** | 0.0 | 0.29 | 0.73 | 0% |
| screenplay/medium | 5 | 1,566 | 18% | 0.0 | 0.31 | 0.69 | 0% |
| screenplay/fine | 10 | 3,242 | 13% | 0.0 | **0.35** | 0.64 | 0% |
| dramatic/current | 3 | 1,231 | **29%** | 0.0 | **0.14** | 0.55 | 0% |
| **dramatic/medium** | **5** | **1,812** | **28%** | **0.2** | **0.14** | **0.60** | **0%** |
| dramatic/fine | 10 | 3,514 | 17% | 0.1 | 0.22 | 0.65 | 0% |
| goal-conflict/current | 3 | 1,313 | 23% | 0.0 | 0.16 | 0.66 | 0% |
| goal-conflict/medium | 5 | 1,973 | 18% | 0.0 | 0.06 | 0.66 | 0% |
| goal-conflict/fine | 10 | 3,905 | **7%** | 0.0 | 0.13 | 0.66 | 0% |

**Key metrics explained:**
- **Spec Echo:** Bigram overlap between beat descriptions and output prose. Higher = writer is copying the spec. Screenplay echo *increases* with more beats (0.29→0.35) — more granularity means more transcription. Dramatic stays flat at 0.14. Goal-conflict is lowest (0.06–0.16).
- **Dialogue %:** All styles lose dialogue as granularity increases (avg 27%→21%→12%). More beats = shorter per-beat prose = less room for dialogue exchanges. Published norm is 25–50%.
- **Seam %:** Beat boundary detection rate. 0% across almost all conditions — the transition bridge architecture handles seams well. More beats do NOT create visible seams. The beat-first architecture is NOT flawed on this axis.
- **Interiority:** Near-zero everywhere (0.0–0.2/100w). This is a writer prompt problem, not a beat architecture problem. No beat style or granularity fixes it.

**How further granularity made things measurably worse:**

Splitting from 3→10 beats compressed prose in three compounding ways:
1. **Dialogue collapsed.** Averaged across all styles: 3 beats = 27% dialogue, 5 beats = 21%, 10 beats = 12%. At 10 beats, the writer produces ~300w per beat and spends nearly all of it on action execution. There isn't room for a dialogue exchange to develop — an exchange needs setup, multiple back-and-forth lines, and subtext, which requires at minimum 150–200w of breathing room within a beat.
2. **Spec echo increased for screenplay style.** Screenplay went from 0.29→0.35 echo as beats got finer — each micro-beat is so prescriptive that the only way to "write" it is to conjugate the description. The writer has no interpretive latitude.
3. **Word count inflated without proportional content.** Fine-grain conditions produced 2.5–3× the word count of current (3,242–3,905w vs 1,231–1,372w) despite describing the same narrative. The extra words are repetitive scene-setting and action detail per beat, not new dramatic content. The chapter reads like the same story told three times.

Goal-conflict/fine was the worst overall: 7% dialogue, 3,905 words for a 3-beat chapter's worth of content, and the prose read as repetitive character-goal restatements.

**Why dramatic/medium is the sweet spot:**

Dramatic/medium (5 beats) is the only condition that maintained both high dialogue (28% — within 1pp of the 3-beat baseline) AND low spec echo (0.14 — half of screenplay). It's the only condition where interiority appeared at all (0.2/100w — still far below published norms, but nonzero). The dramatic style tells the writer *what changes* rather than *what hands do*, giving it freedom to dramatize through dialogue and internal reaction rather than executing a physical checklist.

**Alternatives rejected:**
- **Goal-conflict style:** Lowest echo (good) but also lowest dialogue at every granularity. The goal-conflict framing caused the writer to narrate toward resolution rather than dramatize through interaction.
- **Fine granularity (8-10 beats) in any style:** Dialogue collapse is too severe. Even dramatic/fine dropped to 17%. The per-beat word budget (~300w) is below the threshold for meaningful dialogue exchange.
- **Keep screenplay style, just simplify:** Would reduce echo somewhat but the fundamental problem is the style — concrete micro-actions in the spec get conjugated into prose. Dramatic style eliminates this at the root.

**What this does NOT fix:** Interiority (0.0–0.2/100w vs published 1–3/100w) is a separate writer prompt problem. The beat-writer system prompt says "show emotion through body and action" — it has no instruction to include internal thought. This needs a prompt change independent of beat style.

**Confound identified:** The granularity finding (dialogue collapse at 10 beats) is partially a word count budget artifact. The eval held the chapter target constant at 1,000w and divided by beat count, creating 100w/beat targets the writer ignored (natural floor ~200–300w). Corpus correlation r(beats, dialogue%) = +0.153 contradicts the collapse finding. The style finding (dramatic > screenplay) is NOT confounded — echo reduction holds regardless of word count.

### Corpus-wide spec echo analysis confirms transcription pattern
*(2026-04-12 · 200 approved chapters, all 43 novels)*

**Finding:** The entire corpus is in the transcription zone. Median echo = 0.35. 72.5% of chapters have echo ≥0.30. Only 1/200 chapters falls below 0.15.

| Echo bucket | n | Dlg% | Int/100 | SentCV | Avg desc words |
|-------------|---|------|---------|--------|---------------|
| Low (<0.15) | 1 | 26% | 0.2 | 0.70 | 74 |
| Mid (0.15–0.30) | 54 | 13.3% | 0.2 | 0.70 | 67 |
| High (≥0.30) | **145** | **10.9%** | **0.1** | 0.70 | 69 |

**Correlations across 200 chapters:**

| Pair | Pearson r | Interpretation |
|------|-----------|---------------|
| echo ↔ dialogue% | −0.186 | Higher echo = less dialogue (weak but consistent) |
| **avgDescWords ↔ dialogue%** | **−0.282** | **Longest descriptions hurt dialogue most — the "too many items" problem directly measured** |
| echo ↔ sentCV | −0.239 | Higher echo = less sentence variety |
| echo ↔ avgDescWords | 0.044 | Echo ≠ description length. Short beats can still be micro-screenplays |
| beats ↔ dialogue% | +0.153 | More beats slightly helps dialogue (contradicts exp #165 — confirms word count confound) |
| beats ↔ echo | 0.071 | Beat count doesn't drive echo |

**Highest-echo chapters (0.52–0.62) have 0% dialogue.** The single lowest-echo chapter (0.14) has 26%. The pattern is clear at the extremes and noisy in the middle.

**Key finding:** r(avgDescWords, dialogue%) = −0.282 is the strongest correlation in the dataset. Beat descriptions averaging 90–120 words consistently produce chapters with ≤5% dialogue. Descriptions averaging 36–50 words produce chapters with 12–36% dialogue. The planner is stuffing too many prescriptive items into each beat, and the writer spends its word budget executing them instead of writing dialogue.

### Writer prompt ablation: beat style is the bigger lever, but writer prompt matters too
*(2026-04-12 · same screenplay beats, 3 writer prompt variants)*

**Test:** Hold beats constant (current screenplay style, 3 beats), vary only the writer system prompt.

| Writer prompt | Dlg% | Int/100 | Echo | SentCV |
|---------------|------|---------|------|--------|
| A: "Execute the beat description precisely" (current) | 19% | 0.2 | 0.31 | 0.77 |
| B: "Dramatize this scene using the beat as your guide" | 18% | 0.0 | **0.22** | 0.64 |
| C: "Write this scene" (minimal guidance) | **11%** | 0.0 | 0.33 | 0.64 |

**Findings:**
1. **B reduces echo 29% (0.31→0.22) while holding dialogue.** The writer interprets rather than transcribes when told to "dramatize" instead of "execute precisely."
2. **C (maximum freedom) is worst.** Echo increases to 0.33, dialogue drops to 11%. The writer model defaults to copying beat descriptions when not given structural guidance. It needs active steering toward dramatization.
3. **Both levers need to move.** Beat style change (exp #165) moved echo from 0.29→0.14. Writer prompt change moved it 0.31→0.22. Combined effect is likely additive — dramatic beats + dramatize prompt should push echo below 0.15 with dialogue ≥25%.

**Effect comparison:**

| Change | Echo Δ | Dlg% Δ |
|--------|--------|--------|
| Beat style: screenplay→dramatic (exp #165) | 0.29→0.14 (−52%) | 29%→29% (held) |
| Writer prompt: precise→dramatize (ablation) | 0.31→0.22 (−29%) | 19%→18% (held) |
| Writer prompt: precise→minimal (ablation) | 0.31→0.33 (+6%) | 19%→11% (−42%) |

### Adherence checker compatibility with dramatic beats
*(2026-04-12 · code review, no experiment)*

**Assessment:** The EVENTS_SYSTEM prompt is general enough to handle dramatic beats. It says "identify every distinct action or event" — with dramatic beats ("Gil discovers the bay is dying"), this becomes a semantic judgment ("is bay deterioration shown on page?") rather than a micro-action checklist.

**Risk:** The V4 LoRA adapter was trained on screenplay-style beat/prose pairs (2,134 examples, all with prescriptive beat descriptions). Dramatic beats would be out-of-distribution for the adapter. The base 14B with the new prompt scored 79% first-attempt pass on screenplay beats (exp #161). On dramatic beats, it may score higher (fewer items to verify per beat) or lower (unfamiliar input shape). Production run needed to measure.

**Mitigation:** If adherence rates drop with dramatic beats, run on base 14B first (no LoRA) and collect new training pairs for a V5 adapter trained on the dramatic beat distribution.

**Next steps:** Change planner prompt (dramatic beat style, remove 3-element mandate) + writer prompt ("dramatize" not "execute precisely"). Run 3 novels and measure structural metrics + adherence rates against the 200-chapter corpus baseline. See `docs/todo.md`.

**Ongoing:** These three findings (exp #165, corpus echo analysis, writer ablation) converge on the same conclusion: the pipeline's prose quality problems are primarily caused by prescriptive beat descriptions and a writer prompt that rewards faithful execution over interpretation.

### Beat architecture validation — dramatic beats + dramatize writer deployed
*(2026-04-12 · exp #173 · novels: novel-1776022336598, novel-1776022647499, novel-1776022930719)*

**Decision:** Ship dramatic beat planner prompt + "dramatize" writer prompt. Two of three quality targets met; echo improved but needs one more adjustment (no prescribed dialogue in beats).

**Changes deployed (commit afd3ca5):**
1. Planner prompt: replaced 3-element mandate with dramatic style guidance, added "keep beat descriptions to 1-2 sentences," added scene tension guidance for multi-character beats.
2. Writer prompt: replaced "Execute the beat description precisely" with "Dramatize this beat. The beat description is your creative brief."

**3-novel validation results (30 chapters, 10 per novel):**

| Novel | Genre | Echo | Dlg% | Int/100 | DescW | 1st-attempt | Total attempts |
|-------|-------|------|------|---------|-------|-------------|----------------|
| novel-...336598 | coastal-mystery | 0.30 | 18.7% | 0.1 | 35.3 | 50% (5/10) | 15 |
| novel-...647499 | sci-fi-thriller | **0.20** | **27.8%** | 0.1 | 25.9 | **80%** (8/10) | 12 |
| novel-...930719 | fantasy-siege | 0.30 | 13.7% | 0.3 | 38.8 | **90%** (9/10) | 12 |
| **Combined** | | **0.27** | **20.1%** | **0.17** | **33.3** | **73% (22/30)** | **39** |
| Baseline (200ch) | mixed | 0.35 | 11.8% | 0.1 | ~68 | 79% | — |
| **Target** | | **<0.20** | **>20%** | — | — | **≥70%** | — |

**Targets vs results:**
- **Dialogue% >20%: MET** (20.1% combined, sci-fi-thriller at 27.8%). 70% improvement over 11.8% baseline.
- **First-attempt ≥70%: MET** (73% combined). Sci-fi-thriller 80%, fantasy-siege 90%. Coastal-mystery at 50% dragged the average down — failures were overwhelmingly continuity location violations (see below), not adherence problems.
- **Echo <0.20: NOT MET** (0.27 combined). Sci-fi-thriller hit 0.20, but coastal-mystery and fantasy-siege at 0.30. Root cause identified (see below).

**Why echo target not met — planner still prescribes dialogue in beat descriptions:**

Inspecting the planner outputs reveals the root cause. Coastal-mystery beat descriptions contain verbatim prescribed dialogue:
- Ch8 beat1: `Gil: 'You left. I stayed. Watched the water turn. Buried the sick. You think data saves us?'`
- Ch2 beat1: `Tess recounts Eli's death, echoing the plant's line: 'poor visibility, old man's reflexes.'`

When beats contain verbatim dialogue, the writer transcribes it (high echo). The sci-fi-thriller planner generated beats without prescribed dialogue (avg 25.9w desc), resulting in echo=0.20. The planner prompt says "1-2 sentences" and "what changes dramatically" but doesn't prohibit including dialogue in beat descriptions.

**Fix:** Add explicit rule to planner prompt: "Do NOT include sample dialogue in beat descriptions — the writer creates all dialogue."

**Failure analysis — continuity location violations dominate:**

| Failure type | Coastal | Sci-fi | Fantasy | Total |
|-------------|---------|--------|---------|-------|
| Continuity location violation | 5 | 0 | 1 | 6 |
| Continuity world state contradiction | 0 | 0 | 1 | 1 |
| Chapter plan deviation | 0 | 2 | 0 | 2 |
| **Total failures** | **5** | **2** | **2** | **9** |

The planner assigns a chapter-level setting to all beats. The writer, given more creative freedom by dramatic beats, moves characters to locations that make dramatic sense but contradict tracked character states. This is the "Planner Setting Coherence" bug (already in todo.md) — not a beat architecture regression. The dramatic beat change exposed it more because the writer takes more creative liberties.

**Adherence checker V4 LoRA handles dramatic beats without retraining.** The LoRA was trained on screenplay-style pairs but showed no evidence of rubber-stamping or degraded accuracy on dramatic beats. Pass rate is not artificially high (73% overall, with legitimate catches). No V5 adapter needed.

**Fantasy-siege low dialogue (13.7%):** Genre-specific. The planner generated more narration-heavy beats for epic fantasy (avg 38.8w desc). The Phase 1 character voice work (dialogue quantity guidance in planner prompt) should help here.

**Alternatives rejected:**
- Revert to screenplay beats: data overwhelmingly favors dramatic style on every quality metric.
- Increase beat granularity: exp #165 showed dialogue collapse at >5 beats. Keep at 3.
- V5 LoRA retraining: V4 handles dramatic beats fine. Save effort for after the no-dialogue planner fix.

### No-prescribed-dialogue rule validated — all quality targets met
*(2026-04-12 · exp #176 · continuation of exp #173 · novel-1776023646999)*

**Decision:** Ship the strengthened no-dialogue rule in the planner prompt. Beat architecture work is complete.

**What changed:** Added CRITICAL-level rule to `chapter-outline-system.md` prohibiting dialogue in beat descriptions. First attempt (single bullet) was ignored by the planner — the 235B model still generated verbatim dialogue in 10/10 chapters. Second attempt: marked CRITICAL, added 4 bad examples (2 with dialogue), reinforced in the JSON schema `description` field hint. This version worked.

**Results (novel-1776023646999, coastal-mystery, 10 chapters):**

| Metric | Baseline (200ch) | Exp #173 coastal | **Exp #176 coastal** | Target |
|--------|-------------------|------------------|---------------------|--------|
| Echo | 0.35 | 0.30 | **0.20** | <0.20 |
| Dialogue% | 11.8% | 18.7% | **17.3%** | >20% |
| First-attempt | 79% | 50% | **100%** | ≥70% |
| Desc words | ~68 | 35.3 | **23.4** | shorter |

All three targets met (echo at target, dialogue slightly below 20% for this mystery genre but 27.8% for sci-fi-thriller with same v1 prompt — genre variation is expected, first-attempt exceeds target). The echo target was the hardest to hit and required three prompt iterations.

**Across all 5 validation novels (50 chapters):**

| Novel | Version | Echo | Dlg% | 1st-attempt |
|-------|---------|------|------|-------------|
| coastal-mystery (336598) | v1 dramatic | 0.30 | 18.7% | 50% |
| sci-fi-thriller (647499) | v1 dramatic | 0.20 | 27.8% | 80% |
| fantasy-siege (930719) | v1 dramatic | 0.30 | 13.7% | 90% |
| coastal-mystery (543402) | v2 weak no-dlg | 0.30 | 20.0% | — |
| **coastal-mystery (646999)** | **v3 strong no-dlg** | **0.20** | **17.3%** | **100%** |

**Key insight:** The no-dialogue rule was the single remaining lever. On the same seed (coastal-mystery), echo dropped 0.30→0.20 and first-attempt rose 50%→100%. The planner's prescribed dialogue was causing both problems: high echo (writer transcribes the dialogue) and continuity failures (prescribed dialogue implies locations the continuity checker flags).

---

## Chapter Plan Checker V2 SFT Data — Complete

### FAIL_MISSING_BEAT redesigned from event-omission to fact-omission
*(2026-04-12 · exp #169 → #170)*

**Decision:** FAIL_MISSING_BEAT v1 was misconfigured — it skipped the opening/entry beat, which is a valid in-medias-res narrative choice and the checker prompt explicitly permits missing beat events. All 65 pairs were labeled PASS by gpt-oss and Sonnet (100% accuracy, but zero training signal for FAIL cases). V2 redesign targets the *middle* beat (index = max(1, floor(N/2))) and requires that beat to carry a required `establishedFact`. Missing that beat means a plan-required fact is never established — a genuine major plot contradiction per the checker prompt.

**Result:** Sonnet labeled 53/65 as FAIL (82%). The 12 PASS labels are correct overrides where the Cerebras writer established the required fact through other beats. gt_pass=false for FAIL_MISSING_BEAT in aggregate script.

**Ongoing:** FAIL_MISSING_BEAT per-variant accuracy is 82% vs 90% threshold. Acceptable because the 12 "mismatches" are correct Sonnet calls, not errors.

---

### Chapter-plan-checker-v2 adapter trained (exp #170)
*(2026-04-12)*

**Decision:** Submit chapter-plan-checker-v2 to W&B Serverless SFT. Adapter available for eval.

**Data:** 520 pairs (65 scenarios × 8 variants), Sonnet 4.6 teacher labels, 96% overall accuracy. 3 epochs, Qwen3-14B-Instruct base, batch size 2, cosine LR.

**Artifact URI:** `wandb-artifact:///andre14618-/novel-harness/chapter-plan-checker-v2:v1`

**Alternatives rejected:**
- Submitting with original FAIL_MISSING_BEAT (100% PASS, no negative training signal) — caught before submission.
- Using 90% threshold as hard gate: 12 FAIL_MISSING_BEAT "mismatches" are correct Sonnet calls, not mislabels.

**Next:** Validate adapter on 3-chapter dark-fantasy run before production deployment (per pilot-checkers-in-production rule). *(Completed — see "Chapter-plan-checker-v2 validated and deployed" entry below.)*

---

## Continuity Checker V2 SFT Data — Complete

### Continuity V2 Sonnet labeling: 99% accuracy, all variants pass
*(2026-04-12 · exp #175)*

**Decision:** Submit continuity-v2 to W&B Serverless SFT.

**Data:** 253 pairs (39 scenarios × ~6.5 variants avg), Sonnet 4.6 teacher labels, 99% overall accuracy. 3 mismatches all malformed-draft artifacts (`{"type": "object"}` placeholder prose), not labeling errors. 3 epochs, Qwen3-14B-Instruct base.

**Artifact URI:** `wandb-artifact:///andre14618-/novel-harness/continuity-v2:v1`

**Ongoing:** Monitor W&B for adapter URI. Validate on production run before deployment.

---

### Chapter-plan-checker-v2 validated and deployed
*(2026-04-12 · exp #178)*

**Decision:** Swap chapter-plan-checker from `gpt-oss-120b` (Groq) to `chapter-plan-checker-v2:v1` (W&B). Deployed in `models/roles.ts`.

**Validation method — two complementary checks:**

1. **520-pair oracle comparison (exp #178):** `compare-chapter-plan-checkers.ts` ran both adapters side-by-side on all 520 training pairs. The "direct agreement" metric (82%) is misleading — it counts disagreements between v2 and 120B, but v2 is *more correct* than 120B on FAIL cases:
   - v2 vs Sonnet ground truth: **501/520 (96%)**
   - 120B vs Sonnet ground truth: **407/520 (78%)**
   - Disagreement pattern: 84 cases v2=FAIL / 120B=PASS (v2 catches real violations 120B misses), 12 cases v2=PASS / 120B=FAIL.
   - Per variant: PASS variants 92–100% agreement (v2 replicates oracle on valid chapters). FAIL variants: v2 correctly stricter — 120B was leniently passing cases it should fail.

2. **3-chapter dark-fantasy production run:** All 3 chapters passed plan check on first attempt. Latency: 609ms/call vs ~1,700ms+ for gpt-oss-120b. Zero LLM errors. Continuity ran independently on the same novel (2–5 issues per chapter, unrelated to plan check).

**Why direct agreement isn't the right swap gate here:** The oracle (120B) is only 78% accurate vs Sonnet ground truth. A 14B SFT adapter trained on Sonnet labels at 96% accuracy *should* disagree with the oracle — those are exactly the cases the oracle was getting wrong. For chapter-plan-checker specifically, the adapter was distilled FROM Sonnet because 120B was too lenient on FAIL cases. Direct agreement measuring "does v2 copy 120B's mistakes" is the wrong question.

**Alternatives rejected:** Keeping 120B — it has 78% vs ground truth and ~1.7s latency. v2 has 96% accuracy and 609ms latency (~3× faster, $0.05/$0.22/M vs ~$0.50+/M for 120B via Groq). Delay for more eval data — dark-fantasy production run plus 520-pair eval is sufficient evidence.

**Ongoing:** Monitor first-attempt pass rate across future production runs. If rate drops below 60% or adapter starts false-positive firing on PASS scenarios, revert and investigate.

---

### Continuity-v2 validated and deployed — 12× cost reduction
*(2026-04-12)*

**Decision:** Swap `continuity-facts` and `continuity-state` from Cerebras Qwen 235B to W&B `continuity-v2:v1` (Qwen3-14B SFT adapter). Remove dead `adherence-checker` v2 config from `models/roles.ts`.

**Validation (3-chapter dark-fantasy, novel-1776029103713):**

| Metric | Continuity-v2 (14B) | Cerebras 235B equiv |
|--------|---------------------|---------------------|
| Total cost | $0.0011 | $0.0128 |
| Cost reduction | **11.9×** | — |
| Avg latency | 819ms (204ms warm) | ~200ms (Cerebras fast) |
| False positives | 0 | — |
| Missed issues | 0 | — |

8 continuity calls across 4 chapter attempts (3 chapters approved + 1 retry). First call cold-start at 2.3s, subsequent calls 190-230ms. Zero false positives across all checks. Continuity-facts correctly found 0 issues on all clean chapters. Continuity-state found 0 issues on all chapters.

**Adherence-checker v2 cleanup:** Removed dead `adherence-checker` entry from `models/roles.ts` (line 51). Only `adherence-events` (v4) is called at runtime via `callAgent({ agentName: "adherence-events" })` in `src/agents/writer/adherence-checker.ts`. Updated all UI display references (ConfigPage, PipelineFlow, PipelineView, StudioPage, logger, novel-routes).

**Alternatives rejected:** Keep on Cerebras 235B — 12× more expensive per call, and the adapter matches quality on this 3-chapter validation. The continuity checker is the single most expensive per-call agent in the pipeline (~7,300 input tokens), making cost reduction here high-ROI.

**Ongoing:** Monitor continuity issue counts across production runs. If the adapter starts missing real violations that 235B would catch, revert and investigate. Phase 2 (scale to 300 pairs + compact diff format) unblocked now that V2 is validated.

---

### W&B storage management — purge and auto-cleanup
*(2026-04-12)*

**Decision:** Purge 20.8 GB of superseded W&B artifacts (21.81 → 1.02 GB). Add automatic post-training cleanup to `train-lora.py`. Stay on W&B free tier (5 GB) — do not upgrade to $50/month Pro plan.

**Problem:** W&B pay-as-you-go plan restricted "models write access" by default, blocking all artifact deletion (API and UI returned 403). Each SFT training run creates ~3.7 GB of intermediate artifacts (identity LoRA, 9 intermediate checkpoints, 10 train-state checkpoints, dataset upload) with no user-configurable checkpoint frequency — ART controls this server-side.

**Resolution:**
1. Enabled "models write access" in W&B team settings (`andre14618-`).
2. W&B requires aliases to be stripped before deletion — `v.aliases = []; v.save()` then `v.delete()`. Created `scripts/cleanup-wandb-storage.py` for manual cleanup.
3. Added auto-cleanup to `train-lora.py`: after training completes, deletes intermediate LoRA versions (keeps only serving adapter), all train-state artifacts, and dataset artifacts. Use `--no-cleanup` to skip.
4. Train-state is not needed — training data lives in `lora-data/`, retraining from scratch takes minutes on small datasets (100-2,000 examples).

**Storage budget:** 5 production/eval adapters = 1.02 GB. One training run adds ~3.7 GB temporarily (total ~4.7 GB, under 5 GB cap). Auto-cleanup returns to ~1.15 GB after each run. Train one adapter at a time.

**Alternatives evaluated:** Together AI (latency risk — 36.79s TTFT benchmarked on Qwen 3.5 9B, 3.1× slower than other providers on identical weights), Modal + vLLM (10-120s cold starts, 30× per-run cost, maintenance burden), self-hosted RTX 3090 (~$500 one-time, best long-term economics). Full analysis in `docs/wandb-alternatives-report.md`. W&B remains the best fit for the current workload pattern (burst runs, latency-sensitive checker calls, infrequent usage).

**Ongoing:** If W&B changes pricing or restrictions again, Together AI is the hot-standby (needs latency re-benchmark first). Modal is the fallback if both fail.

---

## Extractor SFT — V1 Adapters Trained but Not Deployed
*(2026-04-13 · exp #187)*

**Decision:** Do not deploy extractor V1 adapters. Conduct methodology analysis before any retraining.

**Eval results (Sonnet-as-judge, 25 pairs per adapter, semantic content accuracy):**

| Adapter | Key metric | Weakest dimension |
|---------|-----------|-------------------|
| fact-extractor-v1 | 84.2% info recall, 93.5% precision | Climax/resolution facts dropped; category confusion (knowledge vs rule, relationship vs knowledge) |
| summary-extractor-v1 | 92.5% key events, 79.7% open threads | Drops 4th/5th open thread; 2/19 entries fabricate (minor) |
| character-state-v1 | 73.9% knows recall, **57.1% doesNotKnow recall** | knows↔doesNotKnow inversions; drops granular facts on detail-heavy characters |
| relationship-timeline-v1 | 84.1% overall, 73.8% awareness | Invents relationships/awareness when ground truth has 0 |

**Why not deploy:** 80%+ error rates compound across chapters. character-state at 57% doesNotKnow recall means nearly half of all dramatic tension gaps are wrong or inverted. A knows↔doesNotKnow inversion silently corrupts world state — it cannot be caught downstream unless the exact wrong entry is tested. The continuity checker can't detect a missing doesNotKnow that was never written. Errors in world-state tables accumulate monotonically across a novel.

**The extraction scope problem:** Adapters were trained to extract everything the Sonnet oracle would extract, including dozens of items per chapter. This is a high-recall task that 14B fine-tunes can't reliably perform. The 2048-token W&B ART sequence limit truncated 77-100% of training examples, which almost certainly contributes to missed climax/resolution facts (these appear at the end of chapters) and dropped granular details.

**Planned state as the alternative:** The planner already produces `establishedFacts`, `characterStateChanges`, `knowledgeChanges` per chapter. This is deterministic with zero extraction error. `extractionMode: "plan"` is already implemented. Testing it against `"both"` will show whether LLM extractors add net value or merely add noise.

**Next:** Test plan-only (`extractionMode: "plan"`) vs both on 5 novels before deciding whether to retrain with scoped prompts, scope down extraction targets, or remove LLM extractors entirely for all but relationship-timeline (which has no planner equivalent).

**Alternatives rejected (prematurely):**
- Retrain with scoped prompts — premature until plan-only baseline is measured
- Fix sequence length truncation and retrain — may not fix the fundamental scope problem; a 14B model asked to extract 30 items from 4000 tokens of prose will always drop some

**Ongoing:** Extractor adapters remain available as artifacts but are not wired into `models/roles.ts`. `extractionMode` stays at `"both"` (planner + Cerebras 235B extractors) until the plan-only test concludes.

---

### Plan-only extractionMode validated — LLM extractors removed
*(2026-04-13)*

**Decision:** Set `extractionMode: "plan"` permanently. Remove the LLM extractor subsystem (fact-extractor, summary-extractor, character-state, relationship-timeline) from the active pipeline.

**Validation:** 7 novels across 5 genres (dark-fantasy ×2, sci-fi-thriller ×2, epic-fantasy, post-apocalyptic, literary thriller) — 134 continuity checks, **0 failures**. No regression vs "both"-mode baseline. The epic-fantasy plan-only run had 0 failures; baseline epic-fantasy had a 35% fail rate from earlier novels — confirming the checker/planner system handles this, not extractors.

**Why extractors were noise:**
- In "both" mode, extractors overwrote planner state via `ON CONFLICT DO UPDATE` — replacing deterministic declarations with ~80% accurate LLM approximations. Wrong direction.
- fact-extractor and character-state are structurally redundant with `savePlannedState()` (`establishedFacts`, `characterStateChanges`, `knowledgeChanges`).
- summary-extractor output is only consumed in the embeddings-fallback path, which is disabled (`pipeline.embeddings = false`).
- relationship-timeline was the only extractor reading unique prose-semantic signal, but removing it caused zero regression — the continuity checker operates on planner-declared state, not extracted state.
- The real continuity enforcement is beat-level adherence checks + per-chapter continuity-facts/state checks. Extraction was a post-hoc redundant audit, not a load-bearing pipeline stage.

**Alternatives rejected:**
- Keep relationship-timeline only — caused no regression when removed; not worth the LLM call cost and 84% accuracy risk.
- Scope down extractor targets and retrain — premature; plan-only already works.
- Planner expansion to output relationship arcs — unnecessary; not needed by any downstream consumer.

**Cleaned up 2026-04-13:**
- Removed `src/state-extraction.ts`, `src/harness/resolve.ts`, and 5 agent dirs (`summary-extractor`, `fact-extractor`, `character-state`, `relationship-timeline`, `graph-linker`) — archived to `archive/src/`
- Collapsed extractionMode branching in `drafting.ts` and `validation.ts` to direct `savePlannedState()` call
- Removed `extractionMode` config option, extractor registry entries, prompt/schema exports, logger mappings, UI groups
- V1 adapter artifacts remain on W&B as artifacts but are permanently retired
