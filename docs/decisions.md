---
status: active
updated: 2026-04-29
---

# Decisions

Architectural decisions with rationale, evidence, and alternatives rejected. Append-only: decisions are never removed, only superseded (mark old decision superseded and add a new one). Use git blame / experiment IDs for full detail.

**Format per entry:** decision → why → alternatives rejected → ongoing implications.

---

## Infrastructure & Serving

### W&B Inference on OpenPipe/Qwen3-14B-Instruct chosen as LoRA serving home
*2026-04-07 · exp #94 (`scripts/finetune/test-wandb-inference.ts`)*

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

> **Superseded 2026-04-18:** The "single flat call" routing decided here is still the shape of the check, but the call itself no longer runs a 14B SFT adapter. `chapter-plan-checker-v2:v1` was retired after a dual-oracle audit found ~92% FP on real fantasy plans; the slot now runs **DeepSeek V3.2 base** with the same `plan-adherence-system.md` prompt. See 2026-04-18 entry "Chapter-plan-checker-v2:v1 SFT adapter retired — DeepSeek V3.2 base replaces it" below.

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

> **Superseded 2026-04-13 (same day):** None of the four extractor adapters shipped. Plan-only `extractionMode` was validated on 7 novels (134 checks, 0 failures) and the entire LLM extractor subsystem was removed from the active pipeline. See "Plan-only extractionMode validated — LLM extractors removed" entry below.

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

### Tonal pass V4 verdict — lexical-only, dead end as a voice tool; writer-side style training is the path forward
*2026-04-14 · post-hoc analysis of 147 live tonal-pass calls*

**Decision:** Stop treating the post-hoc tonal pass as the voice-transfer mechanism. The V4 adapter (`howard-tonal-v4-sft-resume:v8`) produces lexical substitutions, not literary transformation. Future voice work moves to **writer-side SFT** (train the beat-writer on `(beat spec + context → target-voice prose)` pairs so voice lands at generation time).

**Evidence — representative rewrites from one novel (147 calls):**

| Category | Count | Behavior |
|---|---:|---|
| Real rewrites (flag=true, content differs) | 73 | Single-word synonym swaps |
| Real rewrites with **`changed:false`** (flag lie) | 48 | Silently dropped pre-fix |
| Paragraph-concat artifacts | 27 | V4 glued the FOLLOWING paragraph onto its output |
| No-op identical | 19 | Returned input verbatim |
| Length-collapse | 1 | 400-char paragraph → `"I suppose,"` |

Representative real diffs: `looked at → stared at`, `judgment → condemnation`, `question → wonder`, `jokes → jesting`, `rising and falling → heaving`. Formatting swaps: `*italics* → _italics_`, em-dash → `--`, smart quotes → straight quotes.

**Why it's a dead end:** Voice is a sentence-construction property (rhythm, clause structure, metaphor density, cadence, interiority depth). V4 changes none of those — only token-level word choice. The exp #98 metrics that favored V4 (classifier 0.550 vs Howard ref 0.715, feature KL 1.564, perplexity 3086) measured distributional token drift, not literary transformation. The model is optimizing for the part of "voice" that survives under a unigram-ish loss.

**Why post-hoc retrofitting can't work:** You can't retrofit voice onto prose without breaking beat adherence and rhythm, because voice is baked into the sentence structure at generation time. Per-paragraph rewrite windows also lose whole-scene rhythm. The architecture itself is wrong for the goal.

**Alternatives rejected:**
- **Train V5 on bolder pairs** — same architecture, same ceiling. The issue is task framing, not training volume.
- **Co-train writer + adherence + style** — adherence is strict pass/fail (easy to distill), style is diffuse (hard). Adherence loss dominates, squashes voice.

**Chosen path — beat-writer voice LoRA:**
1. Sonnet-label 500–1000 `(beat, beat context, target-voice prose)` triples from existing approved chapters. Sonnet rewrites existing outputs into target voice while preserving beat adherence (cheap — one pass per beat, no ground truth needed beyond the beat spec).
2. Train a LoRA on Qwen3-14B-Instruct (same base as other adapters) via W&B Serverless SFT.
3. Pref-eval vs. Cerebras Qwen 235B writer baseline.
4. If wins: replace writer model assignment in `src/models/roles.ts`.

**Ongoing:**
- `pipeline.tonalPass` stays wired and reachable via `POST /tonal-pass` for experimentation, but the post-hoc pass is no longer the "make the novel read like Howard" lever.
- The guards added to `src/agents/tonal-pass/run.ts` (paragraph-concat strip, italics normalization, content-based change detection, length-collapse rejection) stay in place so the on-demand endpoint produces clean diffs for further V5/V6 experiments.
- The reader-view before/after diff remains the primary tool for adapter comparison going forward — can now be used to eyeball any future tonal adapter cheaply.

---

### Tonal pass stores a separate version; on-demand run for existing novels
*2026-04-14*

**Decision:** Tonal-pass output now saves to `chapter_drafts` as a new version with `status='tonal-pass'`. The original `status='approved'` draft is preserved so the reader view can diff before/after. A `POST /api/novel/:id/tonal-pass` endpoint runs the pass on any existing novel's approved chapters; the NovelReadView has Original / Tonal / Diff toggles and a "Run Tonal Pass" button.

**Why:** The pipeline previously did `unapproveChapterDraft → saveChapterDraft → approveChapterDraft`, destroying the pre-tonal version. Users asked to see "before and after visually identifiable" — that required keeping both versions. Making the pass re-runnable on completed novels also decouples adapter-quality evaluation from running a fresh pipeline.

**Implementation:**
- `src/db/drafts.ts`: `saveTonalPassDraft` / `getTonalPassDraft` / `deleteTonalPassDrafts`
- `src/phases/validation.ts`: uses `saveTonalPassDraft` instead of unapprove-replace
- `src/orchestrator/novel-routes.ts`: `GET /chapters?variant=tonal`, `GET /chapter/:n/versions`, `POST /tonal-pass` (optional `{ chapter, regenerate }`)
- `NovelReadView.tsx`: Original / Tonal / Diff view toggle; diff view aligns paragraphs by index (tonal-pass `reassemble()` preserves paragraph count) and highlights removed-paragraph text in red, added-paragraph in green.

**Also:** `pipeline.tonalPass` flipped to `true` (V4 adapter `howard-tonal-v4-sft-resume:v8` confirmed 2026-04-11 — flag had been left off).

**Ongoing:** Tonal-pass drafts are visible via `?variant=tonal` only; default reader view shows the approved version. Re-running regenerates the tonal version without touching approved.

---

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

## Corpus Pipeline

### Canonical corpus-bundle architecture with 14 conservation invariants
*2026-04-17 · ref: `docs/corpus-pipeline.md`*

**Decision:** Decomposition of proven novels into structured training bundles is a first-class subsystem with its own architecture, not a set of one-off scripts. Every novel lives at `novels/<key>/` as a self-contained bundle (source/, canonical.txt, scenes.jsonl, beats.jsonl, pairs.jsonl, analysis/, reports/). The pipeline has five stages (ingest → scenes → beats → briefs → analysis), each with explicit input/output contracts and schema-validated outputs. Fourteen conservation invariants span the stages, partitioned into hard-fail (block training) vs soft-warn (surface but allow). A `verify-pipeline.py` tool audits every stage end-to-end and refuses bundles with gaps. TypeScript CLI wrappers at `scripts/corpus/run.ts` orchestrate the Python engine scripts. Pipeline versioning via `pipeline_version.json` + prompt SHA hashes detects staleness when prompts change.

**Why:** Previous ad-hoc scripts silently dropped **~72% of the Salvatore trilogy** between stages — a multi-stage failure that went unnoticed because nothing validated cross-stage conservation. Root cause was a single over-conservative filter (`boundary == "bounded"`) plus a silent default word-count range, but the deeper issue was architectural: no formal contracts, no end-to-end audit, no way to tell a bundle was incomplete. Any future novel decomposition (Gemmell, LitRPG, Sanderson) would have hit the same invisible failures. The harness was being built on ~28% of its intended training signal without anyone knowing.

**Alternatives rejected:**
- **Per-script point fixes** — treats symptoms, not the design flaw. Each silent-drop bug was technically small; the pattern (no cross-stage validation) was the problem.
- **Database-backed bundle state** — overkill for a corpus shaped like files. Filesystem-as-source-of-truth is simpler, git-trackable for configs/reports, and composes cleanly with the existing gitignore discipline around raw prose.
- **Monolithic pipeline-run script** — fragile to partial failures and hard to iterate stage-by-stage. Separate `prepare`/`merge` verbs per stage let humans sample-review between phases and enable partial re-runs.

**Ongoing implications:**
- Every new novel added goes through `bun scripts/corpus/run.ts --novel <key>` — no ad-hoc scripts.
- Training scripts MUST call `is_training_ready(novel_key)` before loading pairs. Bundles that fail hard invariants cannot reach training code.
- If a stage prompt changes, `pipeline_version.json` goes stale and affected bundles are surfaced for re-run. Prompts are versioned via SHA hashes in the bundle.
- Stage 5 (Analysis) is a plugin-style framework — ten analyzers declared in `config.yml` per novel, each producing one JSON artifact consumable by one or more harness agents (planner structural priors, beat-writer character snapshots, checker rules).
- This document + `docs/corpus-pipeline.md` supersede the old ad-hoc Salvatore-specific scripts documented in historical experiment notes.

### Regex-based prose evaluation is a last resort, not a default
*2026-04-17*

**Decision:** Any new prose-evaluation metric defaults to an LLM-based path — Sonnet subagent for one-off validation, DeepSeek (or equivalent) for corpus scale after head-to-head quality confirmation. Regex is only the primary implementation when the metric is a hard structural count (word length, paragraph count, chapter word count, lexical diversity) that regex provably handles. It is NEVER the primary signal for voice quality, prose cadence, dialogue-vs-interior-monologue, beat-kind classification, tension, or character-consistency evaluation.

**Why:** regex approximations of literary signals are 85–90% accurate on surface but can miss the prose improvements we actually care about. Sentence splits break on abbreviations, em-dashes, ellipses, and numbers. Dialogue regex cannot distinguish speech from thought or handle nested quotes. Beat-kind classification is pure LLM territory. In the 2026-04-17 session a regex quote-count bug had previously produced a phantom "15.7% dialogue" measurement that surfaced as a harness weakness and drove decisions — only to be invalidated when the real dialogue-word fraction (from the same regex run properly) came out at 17.8%. Trusting regex output as evaluation signal has misled us before.

**How to apply:**
- New prose-evaluation tool → Sonnet subagent pilot (10 samples) → port to DeepSeek/Cerebras after head-to-head validation (`scripts/corpus/test-*.ts` pattern). Regex fallback only if metric is provably structural.
- Dialogue ratio / sentence rhythm / vocabulary diversity: regex OK as cheap sanity check, never primary. Pair with LLM pairwise judging for voice/prose-quality evaluation.
- Beat-kind distribution, cluster sustain, chapter openers/closers: these require LLM-segmented beats upstream. Regex cannot produce them.
- Evaluation tooling defaults to the writer-imitation-benchmark pattern (`docs/writer-imitation-benchmark.md`, `eval_briefs` + `eval_results` tables) — pairwise Opus judging vs real Salvatore prose — not to regex surface stats.

**Exceptions where regex is fine as primary:**
- Word/character/paragraph counts for ingestion-stage sanity (`verify-pipeline.py` invariants).
- Lexical diversity (type-token ratio) for training-data statistics.
- Quote counting in validated, harness-controlled output formats.
- Pipeline conservation invariants (I2.2, I3.2) — reconstruction ratios.

**Ongoing implications:**
- The deterministic analyzers shipped 2026-04-17 (`scripts/analysis/structural.py`, `dialogue-density.py`, `sentence-rhythm.py`, `pov-rotation.py`) are OK because they operate on LLM-segmented beat data, not raw prose. They count kinds, not classify them. The regex inside `dialogue-density.py` and `sentence-rhythm.py` is approximate but the outputs are used as statistical signatures at scale where 5–10% noise averages out; not used as per-beat judgment calls.
- When scoping a new evaluation, budget the LLM call. Treat LLM calls as the default tool, not an optimization.

### Per-task model selection for corpus pipeline — validated head-to-head
*2026-04-17 · scripts/corpus/test-briefs.ts + test-segment.ts + test-deepseek-dialogue.ts*

**Decision:** Each stage of the corpus pipeline uses the model validated for that specific task via a 10-sample head-to-head against Sonnet. The pattern — pick 10 representative samples, run Sonnet as reference, run candidates, compare field-level — is the template for validating every new task before corpus-scale runs.

**Validated model assignments:**

| Stage | Primary | Fallback | Evidence |
|---|---|---|---|
| **Dialogue extraction** | DeepSeek V3.2 | Sonnet | 10-beat test: 100% attribution agreement with Sonnet on content overlap, 97% recall, formatting-only differences. Full-corpus run: 2,447 lines, $1.33, 5.7 min. |
| **Brief extraction** | Cerebras Qwen 235B | DeepSeek V3.2 | 10-beat test: 90% character exact match, 80% POV match vs Sonnet. 2.2s per 10-beat batch — 15× faster than DeepSeek. Setting/tone values are semantically equivalent to Sonnet's (different phrasings). |
| **Beat segmentation** | Cerebras Qwen 235B (scenes <1500w) | DeepSeek V3.2 (larger scenes) | 5-scene test: 99.7–100% reconstruction, 99.7–99.9% verbatim. 2.5s/scene — 40× faster than DeepSeek's 99s. Failed on 1 scene over 2000w (likely max_tokens), hence fallback. DeepSeek handles large scenes at 100% verbatim. |
| **Analyzers** (Stage 5, unproven) | Sonnet subagent for prototyping → DeepSeek/Cerebras for corpus scale | — | Each new analyzer must pass its own 10-sample head-to-head before production. |

**Why per-task rather than one-model-fits-all:**
- Dialogue extraction: judgment-heavy (pronoun/role attribution) → DeepSeek's reasoning wins
- Brief extraction: schema-constrained with short output → Cerebras speed wins, quality identical
- Beat segmentation: long verbatim output → DeepSeek is cleanest but slow; Cerebras is much faster with 99.9% verbatim (trivially worse than Sonnet's 94% on the one scene where Sonnet lost fidelity)
- Different tasks stress different model strengths. Picking one champion costs either accuracy or speed unnecessarily.

**Surprise finding:** Sonnet isn't always the gold standard. On beat segmentation, DeepSeek preserved 100% of verbatim text on all 5 test scenes while Sonnet dropped to 94% on one (streams_of_silver_ch20_s2). "Gold-standard baseline" was an assumption; head-to-head validation surfaces where it breaks.

**Cost at scale** for a new ~2000-beat novel bundle (Gemmell, LitRPG, Sanderson):
- Dialogue extraction: ~$1 (DeepSeek)
- Brief extraction: ~$0.50 (Cerebras)
- Beat segmentation: ~$3–5 (Cerebras primary + DeepSeek fallback for large scenes)
- **Total under $10/novel, zero session budget**

**Alternatives considered:**
- Mimo Flash for briefs: 80% character match, slower than Cerebras (7.4s vs 2.2s), no cost advantage — Cerebras wins.
- Kimi K2 via Groq: no longer offered (404 on `moonshotai/kimi-k2-instruct-0905`).
- GPT-4o / OpenAI: not tested yet; available via OpenRouter if a task's quality gap ever justifies the cost.
- One-model-fits-all (just DeepSeek): valid but wasteful — Cerebras is genuinely faster + cheaper + same quality for the shapes where it works.

**Ongoing implications:**
- Any new task added to the pipeline MUST pass a 10-sample head-to-head before production use. `scripts/corpus/test-*.ts` are the templates.
- Stage 5 analyzers (tension, chapter-hooks, sensory, etc.) should be prototyped with Sonnet subagents to prove the prompt, then ported to DeepSeek or Cerebras once the schema is validated.
- Fallback routing (Cerebras → DeepSeek on failure) should be built into Stage 5 analyzer scripts for robustness.
- Sonnet subagents remain the right tool for: new-task prototyping, one-off quality audits, judgment-heavy tasks where schema isn't well-defined.

### Programmatic DeepSeek V3.2 for corpus-wide extraction tasks (replaces Sonnet subagents)
*2026-04-17 · head-to-head `scripts/corpus/test-deepseek-dialogue.ts` + full-corpus run*

**Decision:** Use DeepSeek V3.2 programmatically (direct API via `scripts/corpus/extract-dialogue.ts`) for corpus-wide extraction tasks that have a stable schema — dialogue extraction, beat segmentation, brief extraction. Reserve Sonnet Claude Code subagents for judgment-heavy one-offs (quality audits, new analyzer prototyping) and for tasks where the output schema is unproven.

**Head-to-head validation** on 10 dialogue-heavy Salvatore beats showed:
- **Attribution accuracy: 100%** — both models agreed on every speaker where content overlapped
- **Content recall: ~97%** — DeepSeek captured all semantic content Sonnet did; missed 1 line out of 30
- **Format style differs** — Sonnet splits `"Quote A," he said. "Quote B"` into two separate entries; DeepSeek joins them. Both valid training representations.
- **Cost: 180× cheaper** at corpus scale ($1.33 for 2,470 beats vs session-budget burn on Sonnet subagents)
- **Speed: 5.7 min** full Salvatore corpus at concurrency 30 (vs ~20 min serialized + session-budget spend for 124 Sonnet subagents)

**Full corpus run** (2026-04-17) produced **2,447 attributed dialogue lines** across 2,470 beats — a **5.1× jump** from the prior Sonnet subagent extraction (478 lines) on the old partial 777-beat corpus. Zero failures. All 5 POV characters now clear 200+ lines including Catti-brie (237, up from 28 — 8.5× recovery). The archetype-pass POC (exp #220) is finally statistically viable.

**Alternatives rejected:**
- **Sonnet subagents at scale** — consumes session budget; 124 subagents were needed for brief extraction alone. Not sustainable per-novel when we add Gemmell, LitRPG, Sanderson.
- **Mimo Flash** — usable for simple extractor tasks (already powers summary-extractor), but weaker on coreference/attribution judgment. DeepSeek's reasoning margin matters for dialogue.
- **Sonnet via transport.ts** — would cost ~5–10× DeepSeek per call and go through the same transport infrastructure. No advantage over DeepSeek for schema-constrained tasks.

**Ongoing implications:**
- Stage 5 analyzers (tension, chapter-hooks, sensory, metaphor) should default to programmatic DeepSeek once their output schema is validated with a Sonnet-subagent pilot.
- Any new novel bundle (Gemmell, LitRPG, Sanderson) runs the full pipeline via DeepSeek at ~$2 per novel, ~6 min wall — no session-budget impact.
- `scripts/corpus/extract-dialogue.ts` is the reference for programmatic bundle-level extraction. Future analyzers should follow the same pattern: read bundle config, iterate beats with bounded concurrency, write to `analysis/<name>.jsonl` + `analysis/<name>.report.json`.
- Sonnet subagents remain the right tool for: prototyping a new analyzer's prompt (before porting to DeepSeek), one-off quality audits, and judgment-heavy tasks like "review these 20 samples and tell me what's wrong."

### Salvatore bundle — complete corpus re-ingestion post-audit
*2026-04-17 · Salvatore Icewind Dale Trilogy*

**Decision:** Re-ran the full Salvatore pipeline end-to-end with fixed ingestion + bundle architecture. Final state:

| Metric | Before (corrupted) | After (clean) |
|---|---|---|
| Scenes | 140 | 352 |
| Beats | 777 | 2,470 |
| Training words | ~82K | 262,748 |
| Chapter coverage | Partial | 100% all 3 books |
| Silent data loss | 72% of trilogy | 0% |

Median beat size 107w (target 80–140). Kind distribution matches published Salvatore analysis (action 36% / dialogue 32% / interiority 20% / description 12%). Scene-text reconstruction: 352/352 within 10% of source. `verify-pipeline.py`: CLEAN — no data-loss gaps detected between stages.

Stage 4 (brief extraction) complete for all three books as of 2026-04-17: **2,470/2,470 training pairs, zero failures**, stored at `novels/salvatore-icewind-dale/pairs.jsonl`. Full trilogy processed via 124 parallel Sonnet subagent batches (43 for Crystal Shard + 81 for Streams/Halfling's Gem). End-to-end pipeline audit passes all 14 conservation invariants.

**Why:** Any future Salvatore v4/v5 LoRA training needs to use this corpus, not the old partial one. Any future per-genre voice LoRA (Gemmell, Sanderson, LitRPG) will follow this same bundle pattern. Without this baseline, the archetype-pass POC (exp #220) would have been trained on compromised data.

**Ongoing implications:**
- Salvatore v3 LoRA was trained on the old 777-beat corpus (28% of trilogy). Any v4+ retrain should consider whether the 3.2× more training data justifies the training cost.
- Character dialogue extraction for the archetype POC (exp #220) should re-run against this corpus, not the old extractions. Catti-brie was sparse in the old corpus mostly because Streams of Silver — her primary book — had 93% of its content missing.
- The bundle structure makes it trivial to add Gemmell, LitRPG, Sanderson, or any other proven novel. Same `--novel <key>` CLI, same 14 invariants, same verification gate.

---

## Planning

### Two-phase planner (skeleton + per-chapter beat expansion) with beat-count floor
*2026-04-17 · tested on fantasy-healer + fantasy-cultivation-void*

**Decision:** Planning is split into two phases. Phase 1 (`planning-plotter`) emits chapter skeletons only — title, POV, setting, purpose, targetWords, charactersPresent — in a single call (~2K output tokens). Phase 2 (`planning-beats`) expands each chapter in parallel into `scenes` + `establishedFacts` + `characterStateChanges` + `knowledgeChanges`, with N parallel calls and ~4K budget each. `enforcePlanningOutput` now requires `ceil(targetWords / 150)` beats per chapter; chapters below the floor get one targeted re-expansion before the phase hard-fails.

**Why:** The single-call planner was hitting DeepSeek V3.2's 8192 output-token ceiling on 10-chapter novels (fantasy-cultivation-void failed with truncated JSON mid-object) and was emitting only 3–4 beats per chapter when Salvatore's training corpus averages 14.4 beats at ~100w per beat. That shape guaranteed word-count failures — the Salvatore voice LoRA was producing exactly what it was trained for, but the planner wasn't asking for enough of it. Prior sweep (2026-04-17 earlier): dark-fantasy 37% fail rate, fantasy-healer stuck at Ch7, cultivation-void 0 chapters generated. After the split on the same two seeds: Ch1–Ch4 all approved on attempt 1/3 with word counts of 1370–1898w (vs prior 340–545w), 12–15 beats per chapter (vs prior 3–4), no JSON truncation.

**Alternatives rejected:**
- Raise single-call `maxTokens` above 8192 — not supported at DeepSeek V3.2's current API limit; would paper over the attention-scope problem anyway.
- Keep single-call planner and just enforce a beat-count floor with retries — retries would also hit the 8K ceiling and fail.
- Per-chapter sequential expansion (not parallel) — would add ~10× latency for no additional coherence; cross-chapter coherence already lives in the skeleton tier since every Phase 2 call sees all skeletons.

**Ongoing implications:**
- Attention-scope-per-call is now a first-class design constraint in the pipeline. Future planners targeting longer novels (20+ chapters) or more elaborate chapter metadata should split further rather than fight the output ceiling.
- The beat-count floor formula (`ceil(targetWords / 150)`) assumes a ~100w-median-beat voice LoRA. If we retrain Salvatore with longer beat targets or swap to a different writer, update the divisor to match.
- `src/agents/planning-beats/` is a new tunable surface for the daemon (prompt + temperature/maxTokens).

---

## Writer Model

### DeepSeek V3.2 is a meaningfully better writer than Cerebras Qwen 235B (dark-fantasy, n=1)
*2026-04-15 · exp #189 (`novel-1776252162026`)*

**Decision (provisional, pending second-seed confirmation):** DeepSeek V3.2 (`deepseek-chat`) is a stronger base writer than Cerebras Qwen 3-235B for target-genre prose. Reframes the Phase 1 Qwen3-14B voice-SFT plan: base-model choice may cover most of the gap that Phase 1 was intended to close.

**Probe setup:** Swapped `writer`, `beat-writer`, `rewriter` from Cerebras Qwen 235B to `deepseek-chat` for a 3-chapter dark-fantasy run (`--seed dark-fantasy --chapters 3`). All checkers and tonal-pass left on their Qwen3-14B W&B adapters. No training involved.

**Results:**

| signal | DeepSeek V3.2 | Cerebras 235B baseline |
|---|---:|---:|
| beat-writer avg latency | 27.6s | ~2.1s (~13× slower) |
| beat-writer cost (13 calls) | $0.0082 | comparable |
| adherence-events pass rate | 13/13 first try | typically 79% |
| chapter-plan-checker | 3/3 | 3/3 |
| continuity (facts + state) | 3/3 each | 3/3 each |
| word count per chapter | 1455–1663w | 550–770w (historical undershoot) |
| total wall clock (3 ch) | 9m 9s | ~3–4m typical |

**Qualitative prose** (Ch 1, Istra POV, pre-tonal):
> The subject's respiratory rate stabilized at fourteen breaths per minute. Istra recorded the figure in her journal, the nib of her pen scratching a precise black line… Her fingers, damp from the perpetual humidity, left smudges on the cover. They trembled, a fine vibration she stilled by pressing her palm flat against the leather.

Clinical register held across chapters. Dialogue is tight (`"Secret trials," Istra said. The words were a diagnosis.`). Subtext active. Visibly a step up from Qwen 235B on this seed.

**Tradeoff:** ~13× slower drafting. A 20-chapter novel runs from ~7m (Cerebras) to ~90m (DeepSeek). Acceptable for quality work, rough for fast iteration.

**Why this reframes Phase 1 voice-SFT:** The post-hoc tonal pass V4 verdict (2026-04-14) concluded voice has to land at generation time and proposed Sonnet-labeled beat-writer SFT on Qwen3-14B. If a stronger base model already closes most of the prose-quality gap at zero training cost, the SFT investment needs to clear a higher bar. Before committing to Phase 1, confirm DeepSeek's advantage on a non-fantasy seed and decide whether SFT is better spent on a DeepSeek base (no serverless LoRA path currently) or deferred entirely.

**Open questions (pending):**
1. Second-seed probe (e.g. post-apoc or sci-fi) to confirm voice quality isn't genre-luck.
2. Policy decision: DeepSeek as default writer (accept 13× drafting time), or reserved for final/approved drafts while Cerebras handles iteration.
3. 8 failed LLM calls in the run (out of 176) — audit which agents failed and why before making DeepSeek a committed default.

**Ongoing:** Probe reverted; `writer`/`beat-writer`/`rewriter` back on Cerebras 235B pending the above. Phase 1 SFT (`docs/todo.md`) is now provisionally re-prioritized below "DeepSeek second-seed probe + default-writer decision."

### In-context Howard style primer (~10K tokens) is effectively free via DeepSeek prefix cache and pushes prose toward Howard rhythm
*2026-04-15 · exp #190 (`novel-1776254029537`)*

**Decision:** A `STYLE_PRIMER=<name>` env var in `src/agents/writer/index.ts` prepends a ~10K-token exemplar file (`style-primer-<name>.md`) to the writer/beat-writer system prompts. On DeepSeek, the primer caches as a prefix and bills at ~10% of the input rate after beat 0 — effectively free in-context voice conditioning, no training needed.

**Probe setup:** Exp #189 baseline (unprimed DeepSeek, 3-chapter dark-fantasy) repeated with `STYLE_PRIMER=howard` and the same seed. Primer built by `scripts/finetune/extract-howard-primer.ts` — picks longest passages from `scripts/lora-data/howard-training.jsonl`, filters Project Gutenberg boilerplate, wraps with a "match voice NOT content" instruction header. Output: 13 passages, 39.6 KB, ~9,895 tokens.

**Cache behavior (confirmed working):**

| beat | prompt_tokens | cached_tokens | cache hit % |
|---|---:|---:|---:|
| 0 (cold) | 9,832 | 0 | 0% |
| 1 | 9,562 | 9,152 | 95.7% |
| 2 | 9,705 | 9,152 | 94.3% |
| 3 | 9,675 | 9,152 | 94.6% |
| avg beats 1–14 | ~9,800 | ~9,200 | **~94%** |

**Results vs #189 baseline:**

| signal | #189 (unprimed) | #190 (primer=howard) |
|---|---:|---:|
| beat-writer calls | 13 | 15 |
| beat-writer avg latency | 27.6s | 31.9s (+16%) |
| beat-writer cost | $0.0082 | $0.0126 (+54%, but see below) |
| per-beat cost | $0.00063 | $0.00084 |
| adherence-events pass | 13/13 | 15/15 |
| chapter-plan | 3/3 | 3/3 |
| continuity (facts+state) | 6/6 | 6/6 |
| chapter char lengths | 9.9k / 9.5k / 8.8k | 10.6k / 11.6k / 11.1k (+19%) |
| wall clock (3 ch) | 9m 9s | 11m 37s |

**Cost math:** Without the cache, a 10K-token primer × 15 beats × $0.28/M input = ~$0.042. Actual writer cost was $0.0126. **Cache saved ~70% on primer tokens** — primer is effectively a ~$0.004 surcharge, not $0.034.

**Qualitative prose (Ch 1 opening, #190):**
> The final infusion dripped from the glass vial into the cannula. Istra observed the subject's radial artery. No pulse. The subject's chest did not rise. The subject's skin retained the pallor of the slab. Infusion complete. Vital signs monitored.
>
> The subject's eyelids opened.
>
> Pupils were fully dilated, black pools consuming the iris. No blink reflex to the candle held three inches from the cornea.

Clipped declarative rhythm with sudden expansions into sensory/clinical detail — noticeably closer to Howard's short-blunt-then-elaborate cadence than the more flowing #189 baseline. Chapters are ~19% longer: the primer encourages denser prose without sacrificing discipline.

**Why this matters for Phase 1 voice-SFT:** Voice transfer via ~10K-token in-context exemplars, near-free via prefix cache, with measurable rhythm shift and no quality regression, further raises the bar for committing to writer-side SFT on Qwen3-14B. If primer-conditioned DeepSeek produces "good enough" voice for production drafts, the SFT path becomes a latency/cost optimization rather than a quality unlock.

**Known issue (separate):** W&B Inference agent costs logged as NaN (147 tonal-pass + 15 adherence + 3 chapter-plan + 6 continuity). Not caused by this probe — `getTokenCost` doesn't resolve W&B artifact URIs against the registry. Worth fixing independently so run summaries show accurate cost.

**Open questions (pending):**
1. Second-seed probe (non-fantasy) to confirm the primer's voice shift isn't genre-confounded with the seed's native feel.
2. Compare primer=howard vs primer=<literary> (McCarthy, Wolfe) to see whether the technique generalizes or is Howard-specific.
3. Policy: make primer default-on for production drafts, or reserve for approved-chapter rewriter passes only.

**Ongoing:** Probe reverted; writers back on Cerebras 235B. Primer infrastructure (`STYLE_PRIMER` env var, `extract-howard-primer.ts`, `style-primer-howard.md`) kept for on-demand use. Phase 1 writer-SFT further deprioritized — primer + DeepSeek now a live third option alongside "Qwen3-14B SFT" and "larger-base SFT." **(Superseded 2026-04-15c — see "DeepSeek V3.2 + Howard primer promoted to pipeline-wide default" below.)**

### DeepSeek V3.2 + Howard primer promoted to pipeline-wide default
*2026-04-15 · exp #191 (verification run, 3-ch dark-fantasy, full DeepSeek stack)*

> **Superseded 2026-04-16:** Howard primer (`STYLE_PRIMER=howard`) was retired — default is now `STYLE_PRIMER=none`, and fantasy seeds route through the Salvatore voice LoRA via `WRITER_GENRE_PACKS` instead of a generic primer. The DeepSeek V3.2 default-writer flip stands; the "Howard primer as universal default" part of this decision does not. See "Howard primer/tonal-pass methodology retired" entry below.

**Decision:** DeepSeek V3.2 (`deepseek-chat`) becomes the default for all generative/creative roles in the harness. Howard style primer (`STYLE_PRIMER=howard`) becomes default-on. Tonal pass auto-run is disabled (on-demand endpoint retained). Cerebras Qwen 235B is retained only for `lint-fixer`.

**Roles swapped to DeepSeek V3.2:** `writer`, `beat-writer`, `rewriter`, `world-builder`, `character-agent`, `plotter`, `planning-plotter`, `planning-extractor`, `artifact-adjuster`, `relationship-timeline`.

**Roles staying on Cerebras Qwen 235B:** `lint-fixer` only — high call count (6–17/run), latency-sensitive, per-sentence rewrites where DeepSeek's voice advantage doesn't transfer.

**Verification (exp #191):** 3-chapter dark-fantasy end-to-end on the full new default stack. 13m 41s total wall clock. 100% first-attempt pass on adherence-events, chapter-plan, continuity (facts + state). No retries fired. Rewriter and tonal-pass were never invoked (both are fallback paths — the writer output cleared all gates on first try).

**Why supersede the "pending second-seed" posture of #189/#190:**
1. Three cumulative runs (#189, #190, #191) all passed every checker on the first try with no regressions.
2. The primer cache economics (~94% hit rate, ~70% token savings on the primer) make DeepSeek + Howard primer cost-competitive with Cerebras 235B for writer workloads.
3. Waiting for a non-fantasy seed before flipping defaults was costing iteration velocity; the flip is cheap to revert via `src/models/roles.ts` if a future seed regresses.

**Tradeoff accepted:** ~13× slower drafting (27.6s/beat vs 2.1s). 3-chapter novel: 13m 41s. 20-chapter novel projected: ~90m.

**Alternatives rejected:**
- Keep Cerebras as default, use DeepSeek only for final drafts — added operational complexity, no evidence it beats DeepSeek-default.
- Defer decision until Salvatore imitation benchmark lands — benchmark will settle method-level questions (beat vs scene, static vs dynamic primer) but baseline-model choice is already clear enough to flip.
- Promote but keep tonal pass auto-run on — V4 tonal pass is a dead end for voice transfer (see "Tonal pass V4 verdict"); primer handles voice at generation time.

**Known issues (not blockers):**
- W&B Inference agent costs log as NaN (`getTokenCost` doesn't resolve `wandb-artifact:///` URIs). Separate fix.
- 8 failed LLM calls in exp #189 went unaudited. If failures recur in production, audit before next default flip.

**Ongoing:** Any new creative/generative role defaults to `deepseekV3` in `src/models/roles.ts` unless there's a specific structured-output or latency reason to pick otherwise. Reverting to Cerebras is a one-line edit per role.

---

## Writer Quality Measurement

### Writer quality is measured against a deconstructed published novel, not subjective eyeballing
*2026-04-15 · planned (see `docs/writer-imitation-benchmark.md` + `docs/writer-style-imitation-design-space.md`)*

**Decision:** Every future writer methodology (model swap, primer change, generation unit change, SFT adapter, hybrid routing) is scored against a permanent quality oracle: R.A. Salvatore's *The Crystal Shard* deconstructed into `(beat brief + context) → real published prose` pairs. Four measurable axes replace "this prose looks good": pref-eval win rate (Sonnet sub-agent blind A/B), perplexity of real prose under the candidate, feature-distribution KL vs real prose, author-style classifier score.

**Why:** A direct user directive reframed writer-quality evaluation: *"Wouldn't the baseline be a completed successful novel and doing some kind of comparison, given beats that were fabricated from that novel? I'm trying to approach novel writing as an engineering problem."* Subjective "Sonnet judge decides" framing is insufficient. Engineering rigor requires real ground truth.

**Companion docs:**
- `docs/writer-imitation-benchmark.md` — measurement layer: 6-stage corpus deconstruction pipeline (mechanical split → sub-agent scene label → beat segmentation → deterministic style tagging → validation gate → merge/index), `writer_benchmark` Postgres schema, 10 methodologies M1–M10, 4 eval metrics, phased plan.
- `docs/writer-style-imitation-design-space.md` — method layer: 7 architectural layers (corpus, conditioning, unit, process, model, selection, post-processing) composed into 10 end-to-end recipes A–J from cheap baseline to continued pretraining.

**Decision rules set in advance:**
- DeepSeek methodology wins or ties Sonnet on pref-eval → ship it, writer-side SFT deferred indefinitely.
- Sonnet wins by >20% at acceptable cost → ship Sonnet, SFT path becomes "match Sonnet cheaply."
- Even M10 (Sonnet + best architecture) loses to real Salvatore by >30% → writer is not the bottleneck; planner is.
- Scene-level methodologies (M5/M6) significantly beat beat-level (M2/M4) → restructure pipeline around scenes, invalidating the Cerebras-era beat-first architectural decision.

**Alternatives rejected:**
- Sonnet-vs-DeepSeek head-to-head with subjective judging — primary reason the benchmark was designed; user explicitly pushed back on this framing.
- Unpaired prose comparison (critique-only) — loses the free SFT training set dividend the paired deconstruction provides.
- Broader multi-novel benchmark as v1 — single-novel Crystal Shard is the tractable start; Sanderson/Lynch/Rothfuss cross-validation is a v2 once the harness is proven reusable.

**Budget:** ~2 weeks, ~$60 API spend end-to-end. Sonnet analytical labor ($0 transport) via Claude Code sub-agents.

**Status:** Planned. Phase 0a (text acquisition) blocked on target-novel confirmation (Crystal Shard vs Homeland vs other Salvatore) and ebook source location.

**Ongoing:** Corpus deconstruction produces paired `(brief → prose)` training data as a free side effect. Any future writer-side SFT (Qwen3-14B, Qwen3.5 397B on Together, DeepSeek-class base) uses this dataset directly. Harness is reusable: swap the ebook, re-run the same 6-stage pipeline for a new target author in ~1 week.

---

## Process / Method

### Resume/redraft must call initNovelRun; failed runs clear activeRuns; phase errors surface via SSE
*2026-04-14*

**Decision:** Three orchestrator stabilizations shipped together:

1. `initNovelRun()` is called at the top of every run entry point — start, resume, redraft, on-demand tonal-pass. The logger's module-level `currentRunId` is only set inside `initNovelRun`. Without it, `logLLMCallStructured` silently drops every call. The logger now emits a loud `console.warn` when `currentRunId` is null.
2. Failed `runNovel` executions `activeRuns.delete(novelId)` and populate a separate `lastRunErrors` map. The `/state` endpoint returns `lastRunError` so the UI can surface the error after the run has exited. Previously a crash left the novel in `activeRuns` with `error` set, making subsequent resume attempts 409.
3. `src/state-machine.ts` wraps the phase switch in a try/catch that emits both a trace `error` event and an SSE `error` event. The UI falls back to polling `/state` every 8s while a run is active (gate-wait SSE can be dropped on reconnect).

**Why:** During a real novel run, planning got stuck re-dispatching chapter-count errors (retry used a generic warning instead of the actual zod/enforcement message), every drafting LLM call was silently absent from `llm_calls` (logger dropped them because resume didn't init the run), and a crash in the phase dispatcher surfaced no error to the UI (user saw a frozen spinner). These three bugs compounded into "novel hangs with no explanation."

**Ongoing:** Any new run entry point MUST call `initNovelRun(novelId)` before spawning `runNovel`. Planning-phase retry now passes the real `lastError` string into the retry prompt.

---

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

> **Superseded 2026-04-18:** The Sonnet-teacher V2 SFT adapter trained from this data (`chapter-plan-checker-v2:v1`) was retired after ~92% false-positive rate on real fantasy plans. Teacher-selection methodology here is still valid if/when the adapter is retrained on a production-matched distribution; right now the slot runs DeepSeek V3.2 base instead. See "Chapter-plan-checker-v2:v1 SFT adapter retired" entry below.

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

> **Superseded 2026-04-18:** Neither gpt-oss-120b nor base Qwen3-14B is the current production model for chapter-plan-checker — the slot runs **DeepSeek V3.2 base** with the narrow 3-question prompt. The 14B SFT path (`chapter-plan-checker-v2`) was trained (exp #178) and subsequently retired after a ~92% FP audit on real fantasy plans. See "Chapter-plan-checker-v2:v1 SFT adapter retired" entry below.

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

> **Superseded 2026-04-18:** Adapter `chapter-plan-checker-v2:v1` was deployed then retired after ~92% FP on real fantasy plans. The artifact remains on W&B for historical reference but is no longer wired into `roles.ts`. See "Chapter-plan-checker-v2:v1 SFT adapter retired" entry below.

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

> **Superseded 2026-04-18:** This deployment was reversed. `chapter-plan-checker-v2:v1` was retired after a dual-oracle audit (Sonnet + Codex gpt-5.4) found ~92% false-positive rate on real fantasy chapter plans despite its validated 96% accuracy on exp #178's synthetic eval. The slot now routes to **DeepSeek V3.2 base** with the same `plan-adherence-system.md` prompt. Deviations are beat-indexed and route to targeted rewrites; on rewrite-budget exhaustion, escalate once per chapter to `chapter-plan-reviser`. See "Chapter-plan-checker-v2:v1 SFT adapter retired" entry below.

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
2. W&B requires aliases to be stripped before deletion — `v.aliases = []; v.save()` then `v.delete()`. Created `scripts/finetune/cleanup-wandb-storage.py` for manual cleanup.
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

---

## Studio UI

### Pre-planning Director chat shipped as two-agent split
*2026-04-14*

**Decision:** The Studio's pre-planning "director" is split into two agents with different models:
- **`planning-conversationalist`** — Groq Qwen3-32B, temp 0.65, maxTokens 600. Plain-text chat. Runs a guided 8-phase sequence (protagonist → opposing force → world → supporting cast → story shape → voice/tone → guardrails → confirmation) with explicit sparsity detection — probes once with an example menu when an answer is a bare category or one-word adjective, then advances.
- **`planning-extractor`** — Cerebras Qwen 235B, temp 0.2, maxTokens 2048. One-shot compile of the transcript into `PlanningDirectives` (Zod schema: lockedCharacters, requiredBeats, forbidden, tonalAnchors, structuralConstraints, rawNotes). Only runs when the user presses "Compile."

**Why:** Chat turns are high-volume and forgiving; compile is one-shot and load-bearing (its output drives the whole concept + planning phase). Matches cost to where quality matters. Groq Qwen3-32B is ~10× cheaper than Cerebras 235B at similar chat fidelity; Cerebras 235B stays as the extractor because structured extraction quality feeds every downstream agent.

**Directives reach the whole pipeline, not just the planner:** `renderDirectivesForConcept()` injects locked characters, tonal anchors, forbidden items, and structural constraints into world-builder, character-agent, and plotter contexts. `renderDirectivesForPlanner()` (superset) injects everything plus required beats into planning-plotter. Directives travel on `SeedInput.directives` → `seed_json` JSONB, so no new DB table was required.

**Alternatives rejected:**
- **Single `planning-director` agent doing chat + per-turn JSON extraction** (initial design) — every turn paid for a structured call against the full schema, and chat drift kept corrupting earlier extracted state. Split into chat (cheap, plain text) + compile (expensive, structured, on-demand).
- **Cerebras 235B for the conversationalist too** — ruled out after pivot: chat doesn't benefit from the big model's schema-following; the extractor is where fidelity matters.
- **MiMo Flash for the extractor** — ruled out explicitly by user ("not an extra dumb model"). The extractor's output shapes every concept-phase context, so a weak model would amplify errors.
- **New `planning_directives` table** — unnecessary. Directives are seed-scoped; embedding in `seed_json` avoids a migration and keeps load/resume paths trivial.

**Ongoing:**
- Validate the guided 8-phase flow on 2–3 real novel runs; tune sparsity heuristics if probes misfire.
- Chip-edit UI (click chip → inline edit or scoped "AI modify" call) not yet built — next UI iteration.
- Post-planning editing (Option 2) and mid-run steering (Option 3) remain in `docs/todo.md`.

---

## Writer Voice Imprinting

### Target rhythm: 1988 Salvatore action-pulp (Path B)
*2026-04-15*

**Decision:** Target the 1988 Salvatore / Icewind Dale rhythm for voice-imprinting fine-tuning. This is the "small model + data volume" hypothesis — test whether enough correctly-shaped training pairs can override a model's natural register (sustained/contemplative) and produce short, punchy, action-dominant prose.

**Target profile:**
- Beat size: ~150–200 words, uniform
- Sentence length: 10–25 words average
- Dominant mode: action + dialogue
- Scene structure: strict `* * *` breaks, hard cuts, restraint over interiority

**Why Path B over Path A (native-fit / 2024 Salvatore) or Path C (hybrid):** User reasoning: "I kind of want to do B because it gives me a real idea of if we can really nudge a model into doing the right thing." The 2024 rhythm is too close to what models do natively — learning nothing. Path B tests the harder, more commercially relevant question (LitRPG pacing maps to 1988 rhythm). If B succeeds, we've proven style malleability. If it fails, we know to retreat to native-fit.

**Corpus:** Icewind Dale Trilogy (Crystal Shard 1988, Streams of Silver 1989, Halfling's Gem 1990). ~307K words, 79 chapters, 260 author-placed scene breaks. Pinquickle's Folly (2024) retained for late-style comparison but not in the training corpus.

**Training base:** Qwen3-14B-Instruct on W&B (r=16 LoRA). DeepSeek V3.2 + Howard primer as the untuned upper baseline.

**Alternatives rejected:**
- **Path A (native-fit, 2024 Salvatore rhythm)** — too easy; doesn't test whether we can move the model away from defaults. User: "whatever we can replicate is correct as long as they're successful books" but also "I want to know if we can really nudge a model."
- **Path C (hybrid: native-fit first, retarget later)** — lower risk but defers the interesting question. User chose to front-load the harder test.
- **Non-Salvatore target** — both ingested corpora are Salvatore. Same author = cleaner signal (controls for vocabulary, world-building style). Genre coverage deferred until after POC.

**Ongoing:**
- Phase A: decompose bounded scenes into ~150–200w beats, build paired (brief, prose) training corpus
- Phase B: chunk-size A/B on DeepSeek to validate target size before training
- Phase C: 2×2 capability-vs-tuning POC on the calibrated pairs

### Uniform beat size for training corpus (calibrated)
*2026-04-15 · calibration: 10 scenes, 56 beats*

**Decision:** Segment training corpus into uniform **~100–120 word beats** (median 105w). Initial target was 150–200w; calibration on 10 sample scenes showed Salvatore's natural beat is much shorter.

**Why:** Uniformity is the easiest lift for a small LoRA. Variable-length targets force the model to learn length control + voice simultaneously — three objectives competing for limited r=16 capacity. Uniform shape means loss converges faster, model doesn't waste capacity on length, eval is cleaner.

**Calibration evidence:** 56 beats across 10 stratified scenes. Median 105w, mean 103w, p25–p75 = 80w–126w. 90% of beats fall in 60–148w range. Only 5.4% reach the original 150–200w target. Per-scene averages stable at 81–121w regardless of scene length.

**Revised yield:** 135 pass-1 scenes × ~660 beats (up from ~540 at 150–200w target). 660 pairs is comfortably above the 200–500 threshold for voice-imprinting LoRA.

**Scoping (pass 1):** Bounded scenes only (both sides have `* * *` marker), 200–1500 words. Scenes <200w (transition snippets) and >1500w (monolithic, uncertain boundaries) excluded.

**Pass 2 (deferred):** Long monolithic scenes + unbounded chapter-open/close scenes, segmented using boundary signals calibrated from pass 1.

### Phase A complete: 777 paired (brief, prose) training beats
*2026-04-16*

**Decision:** Phase A of Path B is complete. The 6-stage decomposition pipeline (mechanical split → scene label → beat segment → brief extract → style tag → roundtrip validate) produced 777 training pairs from the Icewind Dale Trilogy.

**Corpus stats:**
- 777 beats, 83,641 prose words total
- Median beat 100w, mean 108w (matches calibrated 100–120w target)
- Aggregate Salvatore baseline: avg sentence 18.3w, dialogue ratio 0.28, clause complexity 0.62, sensory density 1.56 hits/100w
- Stratified by book (Crystal Shard / Streams of Silver / Halfling's Gem) and kind (dialogue / action / description / interiority)
- Train/val split: 703 / 74 (90/10 stratified by book × kind)

**Round-trip validation (Stage 6, 20 beats × Sonnet writers):** Confirmed the brief schema is sufficient — Sonnet can reconstruct in-spec beats from briefs alone. Sentence-rhythm gap (Sonnet ~12w avg vs Salvatore 18.3w) is intentional: schema deliberately omits rhythm so the LoRA learns it from the prose side of each pair.

**Output:** `scripts/lora-data/salvatore-1988-training-pairs-tagged.jsonl` (canonical), `finetune-data/salvatore-1988-sft-{train,val}.jsonl` (W&B messages format).

### Phase B chunk-size verdict: 120w wins on DeepSeek baseline
*2026-04-16 · `scripts/finetune/phase-b-chunk-size.py`*

**Decision:** Confirm the calibrated ~100–120w beat target. 15 real Salvatore briefs (5 per kind) × 3 chunk sizes (80 / 120 / 160w) = 45 DeepSeek V3.2 generations, scored against the Salvatore aggregate baseline.

**Result (normalized Δ-sum, lower = closer to baseline):**
- 80w: 2.28
- 120w: 1.81 ← winner
- 160w: 2.11

**Style gaps DeepSeek-baseline-vs-Salvatore (this is what the LoRA must close):**
- Sentence length: DeepSeek produces 11.8–12.2w sentences regardless of target; Salvatore is 18.3w
- Sensory density: DeepSeek 3.91–4.77 hits/100w (overdrive); Salvatore is 1.56
- Dialogue ratio + clause complexity already track baseline at 120w

**Why this matters:** DeepSeek + Howard primer (the current writer baseline) lands the planning-side dimensions but misses Salvatore on rhythm and sensory restraint. The LoRA target is therefore well-defined: pull sentences longer, dial sensory imagery back to baseline.

**Ongoing:** 120w is the production beat target for any Salvatore-flavoured runs. Result file: `scripts/lora-data/phase-b-chunk-size-results.jsonl`.

### Phase C.2 verdict: tuning beats ICL by ~2.7× on the Salvatore voice axes
*2026-04-16 · exp #193 · `scripts/finetune/phase-c2-capability-vs-tuning.py`*

**Decision:** For voice-imprinting on R.A. Salvatore's 1988 rhythm, fine-tuning decisively beats in-context exemplars on a larger base model. A ~10k-token primer closes 0.73 Δ-sum; the LoRA closes an additional 1.96 past that. Tuning effect is ~2.7× the ICL effect.

**Three-cell A/B on 4 stratified briefs at 120w:**

| Cell | Base | Voice mechanism | avg sent | sens | Δ-sum |
|---|---|---|---|---|---|
| A | DeepSeek V3.2 | bare system prompt | 10.6 | 6.39 | **3.41** |
| B | DeepSeek V3.2 | +10k-token Salvatore primer (31 passages) | 10.6 | 4.92 | **2.67** |
| C | OpenPipe/Qwen3-14B-Instruct | salvatore-1988-v1 LoRA | 15.9 | 1.76 | **0.71** |

**Per-axis findings (what ICL can and can't do):**
- **Sentence length does NOT transfer via ICL.** A and B both produce 10.6w sentences; only tuning pulls it to 15.9w (target 18.3w). The 31 exemplars the model sees have an 18.3w average — it reads them and still writes 10.6w sentences. Rhythm lives in something the attention layer isn't extracting from exemplars on this base.
- **Sensory density partially transfers.** Primer reduces overdrive 6.39 → 4.92; LoRA reaches the target at 1.76 (baseline 1.56). ICL gets you part of the way on imagery restraint, nothing on cadence.
- **Dialogue + clause noise was similar across all three** — both primer and LoRA slightly over-dialogue (~0.40 vs 0.28) and under-clause (~0.50 vs 0.62). These are less diagnostic.

**Why this matters for the methodology roadmap:** the "just write a primer" path is **not** a free substitute for voice LoRAs when the target includes rhythm. The Howard primer works as a general writer default because it imprints register and imagery habits, but it wouldn't close the gap against a Howard-trained LoRA on Howard prose either — we just haven't measured that yet. The 2×2 capability-vs-tuning question is settled on this axis: at Qwen3-14B scale with 703 pairs, tuning moves dimensions ICL can't touch.

**Limitation:** n=4 briefs, same seed as Phase C. Effect size is too large to be noise (1.96 Δ-sum gap on sentence length alone is structural, not statistical), but per-brief variance isn't characterized.

**Output:** `scripts/lora-data/phase-c2-capability-vs-tuning-results.jsonl`, primer at `src/agents/writer/style-primer-salvatore.md`.

### Phase C verdict: salvatore-1988-v1 LoRA decisively closes the Salvatore voice gap
*2026-04-16 · exp #192 · `scripts/finetune/phase-c-ab-salvatore-lora.py`*

**Decision:** salvatore-1988-v1 LoRA wins Phase C A/B decisively against DeepSeek baseline. Δ-sum drops from 2.45 → 0.45 (−2.00, well under the 1.0 production validation bar).

**Per-dimension on 4 stratified briefs at 120w:**

| Dimension | Salvatore target | DeepSeek baseline | salvatore-1988-v1 |
|---|---|---|---|
| avg sentence words | 18.3 | 10.8 | 16.4 (closed ~75% of gap) |
| sensory density | 1.56 | 4.75 (overdrive) | 1.66 (on target) |
| dialogue ratio | 0.28 | 0.37 | 0.41 |
| clause complexity | 0.62 | 0.63 | 0.54 |

**Key finding:** the LoRA cleanly addresses both Phase-B-identified gaps (short sentences + sensory overdrive). Sensory density in particular snapped from 4.75 to 1.66 — the model learned the restraint, not just the imagery.

**Adapter URI:** `wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v1` (live on W&B Inference).

**Ongoing:** Promote to registry candidate. Next gate is a 3-chapter production run on litrpg/romance-drama seed before considering making it the default writer or an opt-in style primer alternative. Output: `scripts/lora-data/phase-c-salvatore-ab-results.jsonl`.

### Salvatore 1988 voice LoRA training kicked off
*2026-04-16 · exp #192 · adapter `salvatore-1988-v1`*

**Decision:** Submitted the Salvatore voice LoRA to W&B Serverless SFT (ART framework) on `OpenPipe/Qwen3-14B-Instruct`. This is the first Path B (1988 Salvatore action-pulp rhythm) voice-imprinting fine-tune.

**Run config:**
- Base: `OpenPipe/Qwen3-14B-Instruct`
- Adapter name: `salvatore-1988-v1`
- Training pairs: 703 (74 held out)
- LoRA r=16, lr 2e-4, batch size 2, 3 epochs, cosine schedule
- Train file: `finetune-data/salvatore-1988-sft-train.jsonl`
- W&B run launched on LXC 307 (recovered from power outage 2026-04-16)

**Tracking:** `tuning_experiment` id=192 (`lora_voice_sft`, target=writer, dimension=voice_imprint). Conclude via `bun scripts/finetune/submit-salvatore-training.ts --conclude 192 "<summary>"` once trained adapter is validated against DeepSeek baseline.

**Validation plan post-training:**
1. Pull adapter URI from W&B (`wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v1:vN`)
2. Re-run Phase B briefs through the adapter; compare Δ-sum to DeepSeek baseline (1.81)
3. If Δ-sum < 1.0, run a 3-chapter pipeline against romance-drama/litrpg seeds for production validation
4. If still > 1.5, debug data shape (likely sensory-density signal too weak in 100w pairs) before retraining

### Salvatore 1988 voice LoRA v2 supersedes v1 — paragraph breaks restored, cross-distribution voice transfer confirmed
*2026-04-16 · exp #194 · adapter `salvatore-1988-v2:v1`*

**Decision:** v2 replaces v1 as the canonical Salvatore voice adapter. URI: `wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v2:v1`.

**Why (the bug):** v1 was trained on a corpus where PDF extraction had silently collapsed paragraph breaks — `pypdf` preserved `\n` but the downstream pipeline did not promote lone `\n` at dialogue-turn boundaries back into `\n\n`. Result: v1 learned wall-of-text output. 0/6 original-character generations had paragraph breaks. Dialogue ran together in one blob.

**Fix:** `scripts/finetune/fix-paragraph-breaks.ts` rebuilds the `prose` field with two passes: (1) `\n+ → \n\n` normalization — in Salvatore's PDF, each dialogue turn already sat on its own line, so lone newlines *were* real breaks; (2) for the remaining wall-of-text pairs (no newlines at all), inject `\n\n` before any quoted turn following a sentence terminator. Result: 611/777 (79%) of pairs now have `\n\n` breaks; the remaining 166 verified legitimately single-paragraph (38 description, 49 interiority, 76 action, 3 dialogue).

**Phase C.3 validation (v1 → v2):**

| Test | Metric | v1 | v2 |
|---|---|---|---|
| Val (74 held-out) | Δ-sum | 0.50 | **0.27** |
| Val (74 held-out) | 5-gram Jaccard max | 0.100 | **0.033** |
| Val (74 held-out) | outputs with `\n\n` | 0/74 | **51/74** |
| Original (6 new-character briefs) | Δ-sum | 0.32 | 0.66 |
| Original (6 new-character briefs) | outputs with `\n\n` | 0/6 | **3/6** |

**Cross-distribution generalization (Phase C.3 original mode) remains strong.** Both v1 and v2 crush A/B baselines (DeepSeek bare 3.22, DeepSeek+primer 2.52). v2's original Δ-sum regressed slightly (0.32 → 0.66) but n=6 and the longer outputs (137.8w vs v1's shorter) raise sentence-length variance — not a voice regression. Dialogue spot-checks confirm speaker turns land on separate paragraphs.

**Alternatives rejected:**
- **Post-hoc paragraph-break insertion at inference time.** Considered inserting breaks deterministically on the writer output. Rejected because it'd require a stateful parser that knows speaker turns and has to recover from mistakes — the LoRA learning to emit breaks is the root fix.
- **Harness changes instead of LoRA retrain.** Considered relaxing word-count gate, adding proper-noun blocklist, and calling v1 "good enough." These harness changes are still needed, but wall-of-text dialogue was severe enough to block any production use.

**Paragraph-break guardrail now baked into methodology.** `scripts/finetune/paragraph_breaks.py` provides `normalize_breaks()` (idempotent) and `assert_minimum_coverage()` (raises if <50% of pairs have `\n\n` or if dialogue-kind pairs dip below 80%). `scripts/finetune/format-salvatore-sft.py` calls both before emitting SFT files. Any future voice LoRA formatter must do the same — see `docs/voice-lora-salvatore.md` and `docs/corpus-ingestion.md` for the procedure.

**Ongoing:**
- v2 is not yet a default writer. Pending harness plumbing: genre-slot routing in `src/models/roles.ts`, proper-noun blocklist in the LoRA system prompt (block `Drizzt, Bruenor, Wulfgar, Regis, Catti-brie, Icewind Dale, Ten-Towns, Mithril Hall, Lonelywood, Bryn Shander, Targos, Crystal Shard`), dropping the per-beat word-count gate from the adherence checker for all writers.
- Full 3-chapter production run on Salvatore-style fantasy seed still owed.

### W&B Serverless SFT training is now metered (no longer free during public preview)
*2026-04-16 · observed from billing dashboard*

**Decision:** Note the pricing change. W&B training is now billed but cheap — $3.76 spent April 1 → April 16 across all active adapter training (4 deployed adapters + Salvatore v1/v2 voice runs + experiments), against a $500/month cap. Still functionally free at solo-dev cadence. No action required; the docs just need to stop calling it "free during public preview."

**Implication:** Every experiment now has a small direct cost. `tuning_experiment` config should optionally track $ per run going forward. Current ~$0.10–0.60 per run is well below the noise floor of an abandoned experiment.

### Pre-2026-04-15 telemetry and state archived to `archive` schema
*2026-04-16 · migration `sql/022_archive_stale_data.sql`*

**Decision:** Moved all pre-cutoff telemetry and state-table rows into a new `archive.*` schema in the same Postgres DB. Public schema now reflects only the current pipeline shape (DeepSeek V3.2 + Howard primer writer, post-2026-04-15).

**Why:** The pipeline architecture changed materially on 2026-04-15 (writer swap + primer default + beat-context assembly). Pre-cutoff telemetry and novel state came from a different pipeline and muddies calibration for any current-pipeline analysis (checker evals, writer benchmarks, failure-distribution mining for retry-variant training, daemon diagnostics).

**Scope:**
- **Archived by timestamp (< 2026-04-15):** `llm_calls`, `pipeline_events`, `issues`, `finetune_training_data`
- **Archived by novel_id (novels created < 2026-04-15):** `facts`, `timeline_events`, `event_causes`, `knowledge_propagation`, `character_system_awareness`, `world_systems`, `cultures`, `character_cultures`, `character_states`, `relationship_states`, `character_knowledge`, `chapter_summaries`
- **Archived wholesale (100% pre-cutoff, benchmark artifacts):** `batch_requests`, `pairwise_matchups`, `lint_issues`, `scores`, `generations`

**Kept intact in `public`:** `tuning_experiments` + `tuning_results` + `experiment_lineage` (rule: never delete experiments); `runs` + `run_agents` (linked to experiments); `novels` + `chapter_drafts` + `chapter_outlines` + `characters` + `world_bibles` + `story_spines` (novel content — readers may reference historical novels).

**Result:** public-schema size dropped from ~220 MB to 16 MB (87% reduction). 21 archive tables hold 141 MB of historical data, fully queryable as `archive.*`. Orchestrator restart verified clean.

**Reversibility:** `INSERT INTO public.X SELECT * FROM archive.X WHERE ...` restores any subset. Archive schema is not write-protected.

**Ongoing:** any future "mine production failure distribution" or "harvest training data" query should target `public.*` only. For historical comparisons, explicitly query `archive.*`. When the pipeline makes another materially different shift, repeat this pattern with a new cutoff.

### All 70 existing novels archived; public starts fresh
*2026-04-16 · migration `sql/023_archive_all_test_novels.sql`*

**Decision:** Moved all 70 existing novels and their content tables to `archive.*`. `public.novels` now has zero rows. Telemetry (`llm_calls`, `pipeline_events`) stays in public — novel_id is plain text there, not FK, so records survive as an analytical substrate even without a novels row.

**Why:** Every novel generated to date was testing harness behavior, not production output. With 70 novels spanning 14 distinct pipeline configurations (extractors on/off, different writers, different context assembly), any query over `public.novels` returned a grab bag of eras. Post-migration-022 we had 70 novels in public, of which 65 were pre-cutoff (archived content via novel_id filter) and 5 were post-cutoff. User directive: archive all of them so `public.novels` only contains novels currently being worked on.

**Scope:**
- **Archived wholesale:** `novels` (70 rows), `chapter_drafts`, `chapter_outlines`, `characters`, `world_bibles`, `story_spines`, `validation_passes`, `retrieval_config`, `deterministic_config`
- **All remaining state rows archived** (they were for the 5 post-cutoff novels): `facts`, `character_states`, `relationship_states`, `character_knowledge`, `timeline_events`, `event_causes`, `knowledge_propagation`, `character_system_awareness`, `world_systems`, `cultures`, `character_cultures`, `chapter_summaries`

**Kept in public:** all telemetry + experiment tables (`tuning_experiments`, `tuning_results`, `experiment_lineage`, `runs`, `run_agents`, `llm_calls`, `pipeline_events`, `lint_patterns`, `_migrations`, orchestrator tables).

**Result:** public size 16 MB → **10 MB**. Archive schema now 30 tables / 147 MB. Orchestrator restart verified clean.

**Reversibility:** the entire 70-novel test corpus lives in `archive.novels` + associated archive.* tables. `INSERT INTO public.novels SELECT * FROM archive.novels WHERE id = <id>` restores any specific novel.

**Ongoing:** Next novel run starts populating a fresh `public.novels`. Every future novel generated under the current pipeline lives in public; when the pipeline shifts again, this-cutoff novels get archived. Pattern repeats.

### Salvatore v2 fails 3-chapter production probe — v3 retraining on harness-shaped user prompts authorized
*2026-04-16 · exp #195*

**Decision:** v2 does not become the default writer for fantasy genre seeds yet. Retrain v3 on user prompts that match production shape before trying again.

**Why:** The 3-chapter probe (`fantasy-echo-mage` seed, v2 LoRA in the writer slot) failed the gate primarily on **training/serving prompt mismatch**. v1 and v2 were trained against a minimal brief-shape user prompt (~200 tokens, 9 fields). Production sends ~500–1,000 tokens with `TRANSITION BRIDGE`, `LANDING TARGET`, `CHARACTERS`, and resolved references added. The LoRA doesn't know what to do with sections it never saw in training.

**Probe gate outcomes:**

| Criterion | Target | Observed |
|---|---|---|
| Adherence first-attempt | ≥70% | ~33% |
| Chapter-plan pass | ≥85% | ~25% |
| Continuity blockers | ≤1 | 0 ✅ |
| Paragraph breaks | present | present ✅ |

Chapter 1 approved on attempt 2. Chapter 2 failed 12 consecutive attempts over 4 restart rounds — all on the same required fact ("Reseth's soul-etching curse imprints traumatic visions that persist"). Run terminated without producing chapter 3.

**Failure modes diagnosed from chapter 1 prose:**
1. **Transition-bridge regurgitation** — LoRA repeats the bridge verbatim instead of continuing past it. Byte-identical sentences in paragraphs 3 and 6; chunk repetition across consecutive paragraphs.
2. **Required-fact enactment failure** — LoRA writes around specific planned facts with vague imagery.
3. **Character presence gap** — named antagonist listed in every beat but never put on page.
4. **World-element lore leak** — "drow elves" appeared; blocklist only covered named characters, not world nouns.

**Positive findings:** voice cadence DID transfer (chapter 1 prose reads Salvatore-inflected), paragraph breaks hold, continuity-v2:v1 checker found zero issues across all attempts (inadvertent positive datapoint for the 14B checker tier), genre-slot routing worked perfectly.

**Alternatives rejected:**
- **Narrowing the user prompt at serving time** (translator from harness shape → brief shape). Rejected as a brittle patch — training cost is $0.30; retraining is the clean fix.
- **Accepting v2 with a disclaimer.** Rejected — 12 consecutive attempts on the same required fact is not salvageable via prompt engineering.
- **Giving up on voice LoRA as primary writer.** Rejected — voice clearly transferred on chapter 1; the mechanical failure mode is addressable.

**v3 changes:**
1. Reformat every training pair's user prompt through a harness-style assembler: original brief + TRANSITION BRIDGE (last 2–3 sentences of previous beat in same chapter) + LANDING TARGET (first sentence of next beat's summary) + CHARACTERS (per-character snapshot) + SETTING (on scene_start beats only).
2. Expand blocklist to world elements (drow, Underdark, Mithril Hall, Crenshinibon, Ten-Towns, etc.), not just named characters.
3. Add explicit system-prompt rule: "NEVER repeat or echo the TRANSITION BRIDGE — continue past it."

**Ongoing:** Phase 1.4 (beat-scope rewriter collapse) stays deferred until v3 probe lands. Tier 2+ migration plans in `docs/pipeline-14b-consolidation.md` stay gated on v3 passing the 3-chapter probe.

### 14B consolidation is for high-volume slots only — planner/concept/conversationalist stay on smart models
*2026-04-16*

**Decision:** Revise the pipeline-14b-consolidation plan. Not every slot should migrate to Qwen3-14B. Planning-plotter, concept agents (world-builder / character-agent / plotter), planning-extractor, and planning-conversationalist stay on DeepSeek V3.2 indefinitely — and are upgrade candidates for even smarter models (Claude Sonnet, GPT-5) rather than downgrade candidates for 14B.

**Why:** Consolidation is economic, not ideological. The cost-savings math flips on call volume:
- Writer: ~30 calls/chapter × 30 chapters = 900 calls/novel. Moving to 14B saves ~$0.70/novel. Worth migrating if quality holds.
- Planner + concept: ~4 calls/novel total. Moving to 14B saves ~$0.012/novel. Not worth quality risk.
- Planner even more so: a bad plan wastes every downstream writer call, adherence check, and continuity fix. Cost asymmetry is enormous.

Upgrade math in the other direction is also favorable: Claude Sonnet for planner would cost ~$1.37/novel (14× DeepSeek) but plan quality gates all downstream work. At solo-dev cadence that's trivial.

**Alternatives rejected:**
- **All-14B pipeline.** Our earlier consolidation doc implied this endpoint. Correcting: consolidation is "14B on high-volume narrow tasks, smart models on low-volume high-stakes creative tasks."
- **Moving planner down to 14B and accepting plan-quality regression.** The downstream amplification cost doesn't support it.

**Ongoing:** `docs/pipeline-14b-consolidation.md` updated with "Tier 4 — Deliberately kept on smart models" reframe. Planning-plotter / concept / planning-conversationalist explicitly marked "stay on DeepSeek" instead of "gated on beat-writer probe."

### Lint-fixer is a conditional-deprecation candidate; voice-LoRA may obsolete it
*2026-04-16*

**Decision:** Before SFT'ing a 14B lint-fixer, measure lint-fire rate on voice-LoRA output. If the voice LoRA produces prose with fewer than 1 lint issue per chapter, retire the lint-fixer slot instead of migrating it.

**Why:** The lint patterns (~26 of them) target AI-fiction artifacts: "the weight of", "something shifted", filler verbs, hedging adverbs, rhythm monotony, emotional-echo patterns. A voice LoRA trained on Salvatore's 1988 corpus shouldn't produce these — the corpus doesn't contain them. If voice-LoRA writing comes out clean, the whole lint-fixer stage is dead weight in the current-pipeline shape.

**Additional complexity if kept:** today the lint-fixer is tone-agnostic (Cerebras 235B produces generic rewrites). In a voice-LoRA-per-genre world, the lint-fixer would need to be voice-aware — a fix that flattens voice is worse than the flagged sentence it replaces. That's additional training-data complexity (paired per-genre corpus).

**Alternatives rejected:**
- **SFT a 14B lint-fixer today.** Risk wasting training effort on a slot we may retire.
- **Keep Cerebras lint-fixer indefinitely.** Voice-LoRA prose may still pass every pattern and the per-sentence rewrite becomes redundant work.

**Ongoing:** `docs/pipeline-14b-consolidation.md` Tier 1 entry for lint-fixer updated with the conditional-deprecation gate. Action: run lint detector against v3 (or whichever voice LoRA passes the probe) 3-chapter output; decide retire-vs-migrate on measured fire rate.

### Howard primer/tonal-pass methodology retired
*2026-04-16*

**Decision:** Howard primer and the Howard tonal-pass adapter are deprecated as an active methodology. Salvatore is the only style primer we maintain going forward (and for Salvatore-genre seeds the voice LoRA is the preferred route, not the primer). Default `STYLE_PRIMER` env var changes from `howard` to `none` — primers are now per-genre opt-in, not a universal default.

**Why:** Howard primer was the 2026-04-15 placeholder that pushed DeepSeek voice toward a pulpy register while we built a real voice solution. Now we have a real solution — per-genre voice LoRAs via `WRITER_GENRE_PACKS` — and running a generic Howard primer on top of an already-voice-tuned writer is voice-bias-on-voice-bias. For non-fantasy genres, generic DeepSeek output is fine until we build a per-genre LoRA or primer for that genre; falling back to Howard was always a compromise.

**What retired specifically:**
- Default primer in `src/agents/writer/index.ts` — changed from `howard` to `none`.
- `src/agents/writer/style-primer-howard.md` — deleted.
- CLAUDE.md + pipeline-14b-consolidation.md + voice-lora-salvatore.md Howard references removed or retagged.
- Howard tonal-pass adapter (`howard-tonal-v4-sft-resume:v8`) — **adapter retained** on W&B Inference for the on-demand `POST /api/novel/:id/tonal-pass` endpoint on existing novels, but not auto-invoked. No further Howard adapter versions planned.

**Alternatives rejected:**
- **Keep Howard as non-fantasy default.** Universal primer was always a compromise; maintaining two primer methodologies (Howard + Salvatore) adds surface area we don't need when we can opt per-genre.
- **Delete the Howard tonal-pass adapter entirely.** Some novels in the archive were produced with it; retaining the endpoint preserves comparative-analysis capability without adding runtime cost.

**Ongoing:** When a new author voice is needed (Cook, Gemmell, Howard-actual-corpus, etc.), build a voice LoRA following the Salvatore methodology (`docs/voice-lora-salvatore.md §6`), not a primer. Primers are reserved for cases where LoRA training isn't justified (low-volume, niche, or exploratory).

### Compact beat-context (narrow strip) validated — v3 passes all 3 chapters in 5 attempts
*2026-04-16 · exp #201*

**Decision:** Ship the narrow-strip compact-mode for voice-LoRA routes in `src/agents/writer/beat-context.ts`. Default path (DeepSeek writer, no genre pack) stays with full context.

**Why:** Exp #201 probe of v3 + narrow strip on `fantasy-echo-mage` passed ch1 (1 attempt), ch2 (1 attempt), ch3 (3 attempts) — **all three chapters approved in 5 total attempts**. v3 with full context (exp #199) needed 5 for ch1 + 4 for ch2 + failed on ch3 after 6+ attempts. v3 with aggressive strip (exp #200) failed ch1 after 9 attempts. Narrow strip is clearly the right balance.

**What the narrow strip removes:**
- CHARACTERS section: State / With / Tension / Doesn't-know (runtime-only fields, rarely load-bearing on a given beat)
- Duplicate SETTING block (inline `Setting:` in beat-spec §1 already carries location)

**What it keeps:**
- CHARACTERS: Voice + Drives + Avoids + Conflict (planner side-channels for per-chapter requirements like "Senna avoids mirrors")
- Resolved-references block (carries knowledge-graph world facts like fault-line backstory)
- Sensory line on scene_start beats

**What this confirms architecturally:** the 14B voice LoRA does NOT have a hard capability ceiling on complex beats. The prior probe failures (exp #199 chapter 3) came from **context noise** — runtime-only fields crowded out load-bearing ones. Narrow the context to what matters; the LoRA executes. No need for tiered escape valve or per-beat drives at this point.

**Alternatives rejected:**
- **Decomposition (DeepSeek adherence + voice polish).** Would have been the path if narrow-strip also failed. Kept in reserve as a backup architectural move.
- **Planner-authored per-beat drives (§3 of beat-writer-architecture.md).** Still potentially useful as a cleaner information architecture but no longer needed to unblock v3 production viability.
- **Tier 2 escape-valve (larger model rental).** Not needed at current seed difficulty.

**Ongoing:** `src/agents/writer/beat-context.ts` `compactMode` is now the routing-gated default for genre-pack writers. Monitor chapter-approval rates across more seeds. If other seeds fail similarly to v3-pre-fix, revisit; if they pass, the adapter is production-ready for fantasy seeds.

### Planner Phase-1 strict skeleton schema — 8K output truncation fixed
*2026-04-17 · exp #221*

**Decision:** Phase-1 of the two-phase planner now uses strict `chapterSkeletonSchema` that rejects `scenes`, `establishedFacts`, `characterStateChanges`, `knowledgeChanges` fields. User prompt rewritten to request "SKELETON outline — no scene beats, no world-state changes." Stale DB `agent_generation_config` row forcing maxTokens=8192 deleted.

**Why:** The "two-phase split" shipped morning of 2026-04-17 wasn't actually skeleton-only. Schema accepted beat fields via `.default([])`, user prompt said "specific scene beats", system prompt said opposite. DeepSeek followed the concrete instruction, bloated chapter 1 to ~5K tokens, truncated at chapter 3, retry died at max_tokens=8192 with truncated JSON. Four fantasy seeds never completed in the v3 sweep because of this (fantasy-healer, fantasy-archive, fantasy-cartographer, fantasy-cultivation-void).

**Verified on 4 previously-stalled seeds:** all produce clean 10-chapter plans with zero truncations, 59–83% token headroom. Phase-1 output is now 1,284–1,484 tokens (was blowing to 8,192).

**Collateral finding:** 8 of 10 "completed" v3 sweep novels hit max_tokens=8192 exactly on Phase-1 retry — `enforcePlanningOutput` silently accepted partial-parse output from truncated JSON. Not audited; archived via `seed_json.abandoned = true`.

**Alternatives rejected:** (a) retry-loop stripping beat detail — rejected because strict-schema means nothing to strip; (b) tight maxTokens ceiling — schema is the real guard, not token budget.

**Ongoing:** Planner Phase-1 runs at ~20% of ceiling on every call. Retry logic is defense-in-depth dead code.

### Voice-baked beat-writer shipped — Salvatore v4 is fantasy default
*2026-04-17 · exp #222*

**Decision:** `salvatore-1988-v4` replaces `salvatore-1988-v3` in `WRITER_GENRE_PACKS`. v4 trained on full 2,470-beat Icewind Dale trilogy (3.2× v3's 777 crystal_shard subset) with per-speaker profiles + 3 example voiced lines injected into every training user prompt (anti-leakage sampled from OTHER beats where that character spoke). Harness gained `CharacterProfile.exampleLines` schema field; `character-agent` generates 4 voice anchors per character at concept phase; `beat-writer` context injects them under each speaker profile.

**Why:** v3 produced decent Salvatore-narrator voice but didn't differentiate characters. v4's training shape teaches voice-conditional dialogue as part of beat writing. Validated via 42-beat fork-writer test on fantasy-healer — characters use their actual voice anchors (Sylvie's farm metaphors, Jien's single-word terseness, Voss's cold strategic framing) vs v3's generic register.

**Caveat:** v4 occasionally echoes exampleLines verbatim (Voss emitted his literal example line "One life balances ten thousand" in generated prose). Training-data shape allows memorization. v5 recipe (if needed): multiple example-set variants per training row to break one-to-one mapping.

**Alternatives rejected:** (a) dialogue-only LoRA zoo per character — archetype POC #220 showed DeepSeek+few-shot matches dialogue-rewrite LoRA on voice; maintenance overhead unjustified; (b) Sonnet dialogue post-pass on already-voiced v4 prose — tested empirically, near-no-op (archetype LoRA) or over-caricature (DeepSeek+few-shot). Base LoRA is the right layer.

**Ongoing:** v3 retained on W&B for rollback. Monitor verbatim-echo rate in production.

### Context-engineering-forward architecture — craft is a model problem, not a prompt problem
*2026-04-18*

**Decision:** The novel-harness architecture commits to **context engineering + planner expressiveness** as the primary quality lever. Checkers are narrow: only adherence (did writer follow the plan?) and hallucination (did writer invent things not in context?). Craft-layer issues — voice drift, show/tell, pacing, dialogue naturalness, rhythm — are handled by **upgrading the model** (better LoRA, bigger base, frontier + few-shot), not by building craft checkers or encoding craft-rules as prompt instructions.

**Why:** Session proposed voice-consistency checker, show-vs-tell detector, pacing checker, dialogue-naturalness checker, sentence-rhythm analyzer. User correctly identified this as reincarnating the retired Howard primer methodology — fine-grained style rules in a 5K-token primer produce either mechanical output that hits metrics but reads flat, or the model ignores most rules anyway. Howard was retired 2026-04-16 for exactly this reason.

**The clean split:**

| Layer | Responsibility | Where it lives |
|-------|----------------|----------------|
| What to write — plot, characters, facts, setting, beats, payoffs, subplots, theme | Context engineering | Planner output + beat-context assembly |
| How to write it — voice, rhythm, show/tell, dialogue style, sentence craft | Model weights | Writer model (LoRA or frontier) |
| Did the writer follow the plan? | Adherence check | `adherence-checker-v4` |
| Did the writer invent things? | Hallucination check | `hallucination-checker-v1` (exp #223) |

**What this closes off:** no voice-consistency checker SFT, no show-vs-tell checker, no pacing checker, no dialogue-naturalness checker, no craft priors encoded as inference-time prompt instructions.

**What this opens up:** planner Phase-2 enrichment (next experiment) adds `subplot_id` per beat, `establishedFact.id` cross-references, `requiredPayoffs[]` linked to prior fact IDs, `speaker_directives` per beat (content, not voice), `thematic_focus`. Beat-context updates to surface new planner fields. Unified issue aggregator — all checker outputs into one targeted rewrite per beat. Model-upgrade path (v5 LoRA with anti-parroting recipe, 70B fine-tune, frontier + richer few-shot) as the knob for craft improvements.

**Alternatives rejected:** (a) craft-priors-as-prompt-instructions — the Howard trap, empirically failed; (b) more fine-tunes per craft dimension — fine-tune proliferation without commensurate quality gains; (c) hybrid prompt+model split — conceptual clarity > marginal flexibility.

**Ongoing:** Next experiment after hallucination-checker ships is planner Phase-2 enrichment. Craft investments route through model upgrades.

### Hallucination-checker narrow scope — two categories, no taxonomy
*2026-04-18 · exp #223*

**Decision:** `hallucination-checker-v1` output schema is `{pass: bool, issues: [{entity, excerpt}]}` — no `kind` field, no category taxonomy. Training targets two failure classes but doesn't distinguish them in output: corpus leakage (Salvatore-corpus tokens) and ungrounded named entities (proper nouns not in speakers/brief/world_bible).

**Why:** Rewriter doesn't need to know whether an issue is corpus-leakage or novel-internal invention — it just needs the list of entities to remove/replace. Adding `kind` is analytics metadata that forces a brittle classification call. Adherence-checker-v4 shipped without kind taxonomy and achieves 96% precision; same shape here.

**Pattern match to adherence-checker evolution:** adherence started with 5 dimensions, pruned to 2 after setting (0% fire rate) and tangent (4.3%, mostly planner bugs) got cut. Start narrow; expand on evidence.

**Alternatives rejected:** (a) multi-category schema with `unknown_location`/`corpus_leakage`/`attribute_drift`/`fact_contradiction` — only the first two showed with any frequency in prototype; rest speculative; (b) deterministic proper-noun allowlist check — negative-set checks on prose have 0/3 track record (word-count, dialogue-presence both removed for false positives); variant matching, sentence-initial capitalization, legitimate writer introductions all cause false-positives.

**Ongoing:** If production telemetry shows consistent misses on a specific class, narrow additions can be made. Start-narrow-then-expand-on-evidence matches the adherence trajectory.

### Enterprise-grade labeling SOP — rubric + gold examples + κ monitoring
*2026-04-18 · exp #223*

**Decision:** Every SFT-for-checker labeling campaign must: (1) have a written rubric with explicit resolution rules for edge cases, (2) include ≥5 gold-example labels embedded in every labeler prompt, (3) measure inter-labeler agreement (Cohen's κ) on a double-labeled 30-beat sample before investing in the full set, (4) target κ ≥ 0.7 / entity-F1 ≥ 0.7 for usable training data.

**Why:** First labeling pass on 500 stale-pipeline beats used a minimal prompt. Different subagents applied different unwritten rules (per-beat vs novel-wide grounding, summary inclusion, coordinate-name flagging). Result: Cohen's κ = 0.285 (below "fair" threshold), entity F1 = 0.557. Training on that would inherit the inconsistency.

Second pass on fresh 800-beat bundle with strict rubric + 6 gold examples (`scripts/hallucination/labeling-rubric.md`) produced: κ = 0.857 avg (three pairwise 0.889 / 0.889 / 0.792), entity F1 = 0.837 avg. **3× improvement on κ, 1.5× on F1.** Same Sonnet model, same beats, same task — only the prompt changed.

**Concrete SOP** (to be added to `docs/synthetic-labeling-sop.md`):
1. Draft rubric: explicit PASS categories, FAIL categories, edge-case resolution rules, 5+ gold examples with rationale
2. Embed rubric + gold examples in every labeler subagent prompt
3. Dispatch N labelers (batched for parallelism)
4. Before merging labels: dispatch 3 independent labelers on a 30-beat stratified sample (same rubric) to measure pairwise κ + entity F1
5. If κ ≥ 0.7 → proceed to training
6. If κ < 0.7 → identify disagreement categories, tighten rubric with more gold examples for those cases, re-label disputed batches

**Alternatives rejected:** (a) proceed with noisy labels — trains a checker that inherits labeling inconsistency, not fit for enterprise; (b) one-shot LLM labeling as "good enough" — full ladder costs ~$25 extra across 800 beats, cheap insurance vs retraining.

**Ongoing:** Every future SFT checker (continuity-v3, chapter-plan-checker-v3, planner-adherence-v2) follows this SOP.

---

## Session 2026-04-18 — Hallucination-checker v2/v3 arc + architectural direction

### Hallucination-checker v2 — chapter-plan methodology replicated, synth-to-natural distribution shift confirmed
*2026-04-18 · exps #223 (v1 eval), #227 (v2 data format), #230-231 (v2 eval)*

**Decision:** v2 REJECTED. Distribution shift from pure-synthetic training is the lesson.

**Why:**
- v2 replicated the chapter-plan-checker-v2 methodology (50 scenarios × 10 variants × Sonnet-flipped labels via parallel subagents) producing 500 pairs Cerebras-generated, 482/500 Sonnet match (96.4%).
- Trained on pure-synth 400-pair training set. **Synth val: 95.1% precision / 96.7% recall / 95.9% F1** — matched chapter-plan's headline quality on equivalent measurement.
- **Natural val (the same 160-beat set v1 was measured on): 77.8% precision / 51.2% recall / 61.8% F1.** Worse than v1's 86.5%/78%/82.1%.
- Diagnosis: the 400-pair synth-only training taught "PASS pattern X, FAIL pattern Y" shortcuts that worked on Cerebras-style prose with our specific injection pools but didn't generalize to the natural distribution (DeepSeek + Salvatore LoRA output in real production).

**Alternatives rejected:**
- Scaling to 1000+ synth pairs without distribution diversity — chapter-plan's 520-pair precedent shows data volume alone doesn't close the gap when distribution mismatches.
- Bigger base (Qwen3-30B) — higher serving cost forever, and the issue isn't model capacity.
- Continuing with kitchen-sink rubric — see next decision.

**Ongoing:** v2 retired. The methodology (programmatic Cerebras generation + Sonnet subagent labeling + label flipping) is validated and reusable; the scope is what needs correction.

### Hallucination-checker v3 — two-adapter architecture (ungrounded-entity + Salvatore-leak), name-drift dropped
*2026-04-18 · conversation-driven architectural decision*

**Decision:** Decompose `hallucination-checker` into two narrow adapters:
1. `halluc-ungrounded-entity` — corpus-agnostic grounded-context check. Answers "does any named entity in prose fail to appear in speakers/brief.characters/brief.setting/brief.pov/brief.summary/world_bible?" Full context in prompt.
2. `halluc-leak-<writer>` — per-writer leak-vocabulary check. Answers "does prose contain any token from this writer's training-corpus vocabulary?" Prose-only input. Per-writer (Salvatore-first, paired with each future genre voice LoRA).

`halluc-name-drift` considered and **dropped** — zero production evidence (v1's 9 natural-val FNs contained no drift cases). If production later shows drift, revisit.

**Why:**
- v2's 10-variant kitchen-sink rubric was asking one 14B adapter to learn ~20 distinct decision rules from 400 pairs. Prior lesson: `feedback_decompose_checker_calls.md` ("14B can't handle complex single-call checklists; split into focused parallel calls per dimension").
- Grounded-entity detection and corpus-leak detection are DIFFERENT tasks: relational reasoning vs vocabulary memorization. Combining them was overloading the decision surface.
- Leak vocabulary is **per-writer** — each fine-tuned writer (Salvatore, future Gemmell/Cook/etc.) has its own corpus-specific leak set. Hardcoded single leak adapter would hit a maintenance treadmill; per-writer adapters match the architecture.
- Narrower tasks distill to small models better. This unblocks the small-model local-inference POC (pending).

**Alternatives rejected:**
- Three adapters (ungrounded-character + ungrounded-place + leak) — character vs place grounding uses different context subsets but same detection step; splitting further 3× the serving cost without clearer axis separation.
- Deterministic regex for corpus-leak — brittle on variants (Mithril/Mithral Hall, "drow" as common noun), corpus-coupled, can't learn from production feedback.
- Keeping v2 kitchen-sink with more data (1000+ pairs) — doesn't address the scope problem, just papers over it.

**Ongoing:** v3 adapters shipped as `candidate` in `adapter_registry`. First training pass had a data-pipeline bug (v1 natural train not merged into ungrounded); v2 with merged data in flight.

### Three-layer architecture formalized — planning / writing / checking
*2026-04-18 · philosophical frame*

**Decision:** The harness is three separable layers. Each optimizes differently. Don't cross the streams.

1. **Planning layer — structural imitation.** Beat rhythms, cluster patterns, opener/closer rules, scene sizes, tension curves. Extracted from proven corpora (Salvatore reference), rendered into planner constraints via `WRITER_GENRE_PACKS`. Long-term: human-in-the-loop planning stage.
2. **Writing layer — cadence/tone imitation.** Highest-impact fine-tune use case. Voice LoRAs (Salvatore v3/v4) per genre. Context engineering supports voice but does not replace the fine-tune.
3. **Checker/rewriter layer — anti-hallucination + on-plan discipline.** Adherence-events, chapter-plan-checker, hallucination (ungrounded + leak), continuity (deprioritized). Narrow, independently trainable, ideally small-enough-for-local.

**Strategic goal:** semi-autonomous novel writing with robust human planning + autonomous drafting. **Offline-capable** long-term via small fine-tuned models running locally (2B-14B). Small-model POCs serve both cost/latency AND are a **learning exercise** in small-model fine-tuning.

**Why:**
- Howard primer retirement (2026-04-16) showed voice transfers via weights, not prompts.
- Each layer has a different optimization lever: planning = structural priors + schema, writing = voice LoRA, checking = narrow SFT.
- Mixing roles (checker with creative duty, writer with discipline duty) corrupts both signals.

**Alternatives rejected:**
- Single monolithic "novel generator" — conflates layers, optimization noise, hard to test.
- Checker-less autonomous drafting — quality regresses; anti-hallucination discipline is load-bearing.
- Dropping the small-model track — the learning value AND offline-capability goal are both load-bearing; not just cost.

**Ongoing:** New memory `project_three_layer_architecture.md`. CLAUDE.md top section updated. Every future experiment classified into one layer; cross-layer proposals questioned.

### DeepSeek V3.2 preferred over Cerebras Qwen 235B for instruction-constrained writing
*2026-04-18 · A/B during v2→v3 data generation*

**Decision:** Default writer for synthetic prose generation scripts is now `deepseek-chat` (DeepSeek V3.2), not `qwen-3-235b-a22b-instruct-2507` (Cerebras).

**Why:** Direct A/B measured during hallucination-checker-v2 training-data generation (500 paired runs each):

| Metric | Cerebras Qwen 235B | DeepSeek V3.2 |
|---|---|---|
| Injection-fail rate | 4.6% | 2.0% |
| Sonnet agreement | 96.4% | 99.4% |
| Unintended PASS-variant contamination | 18 cases | 2 cases |
| Dialogue-only subcase adherence | Often leaked to narration | Followed tightly |

DeepSeek ~3× cleaner on instruction-constrained prose. Cerebras wins on raw speed (1-2s vs 3-5s) for bulk throughput cases.

**Alternatives rejected:** Keep Cerebras as default — faster per call but contamination rate made v2 labels noisier and required rework. DeepSeek's adherence quality is the right default tradeoff for anything requiring constraint discipline.

**Ongoing:** `generate-halluc-data.ts` defaults to deepseek. `docs/synthetic-labeling-sop.md` updated. New feedback memory `feedback_deepseek_over_cerebras_writing.md`. Cerebras kept for lint-fixer + bulk operations.

### Continuity checker deprioritized
*2026-04-18 · user directive*

**Decision:** Continuity checker (`continuity-v2:v1`) remains wired in `drafting.ts` as a per-chapter check but is **deprioritized** in the current roadmap. Phase 2 (scale to 300 pairs) and Phase 3 (compact diff format) are on hold. Stop characterizing it as the "highest prompt-token cost agent (~7,300 tokens)" — context-engineering shifts have substantially reduced actual per-call size from the original design.

**Why:**
- Beat-level adherence + hallucination checks subsume most of continuity's role
- Context-engineering (beat-scoped rather than chapter-dump) cut actual per-call size far below the design-era 7,300 tokens
- User doesn't see evidence it's earning its keep in current pipeline

**Alternatives rejected:**
- Retire entirely — still wired in drafting.ts, keep for now until production evidence confirms redundancy
- Scale to 300 pairs (Phase 2) — low ROI given deprioritization

**Ongoing:** `CLAUDE.md` and `docs/adapter-changelog.md` updated to drop "highest cost" framing. Memory `feedback_continuity_deprioritized.md` locks the directive. `docs/todo.md` marks related phases on-hold.

### Together AI fine-tunes require explicit per-job authorization
*2026-04-18 · user directive*

**Decision:** Never submit Together AI fine-tune jobs without explicit, per-job user approval. W&B Serverless remains the default training path; Together and Modal are opt-in only.

**Why:** Together fine-tunes incur direct charges. User wants visibility on each one. W&B has been the established path for all deployed adapters.

**Ongoing:** New feedback memory `feedback_together_explicit_only.md`. Single Together run submitted this session (`ft-6855dcb3-4ebe`, Qwen3-1.7B halluc POC) was explicitly authorized before submission.

### Training-data preservation fix — archive before training
*2026-04-18 · post-incident*

**Decision:** `train-lora.py` now archives the training JSONL to `finetune-data/archive/<adapter>__<timestamp>__<sha256>.jsonl` BEFORE submitting to W&B.

**Why:** Adherence-v4 training data was lost from LXC disk during repo cleanup (the `lora-data/` → `archives/` move); only recoverable because a local Mac copy happened to exist. Archive step ensures every training run has a durable local record tied by content hash.

**Ongoing:** Applied 2026-04-18. Future training experiments get automatic archive. Manual SHA256 lookup via filename.

## Session 2026-04-19 — Exhaustion-handler architecture + debug-injection + non-blind-retry

### Exhaustion-handler 5-step architecture canonicalized
*2026-04-19 · commits ce64e28..1d1b4e1 + 7d53dac..83772dd*

**Decision:** The retry/escalation architecture for drafting-phase quality failures is formalized as a 5-step exhaustion-handler: (1) targeted beat rewrites on adherence failure; (2) chapter-plan-checker flags route to beat-targeted rewrites (`maxChapterPlanRewritePasses=2`); (3) on rewrite-budget exhaustion, escalate once per chapter to `chapter-plan-reviser` (hard cap via `revisionUsed`); (4) on reviser exhaustion, fire `gate:plan-assist` (web/CLI decisions: edit-plan/override/abort); (5) in auto mode, gate emits SSE event then throws `PipelineBailError` (`lastRunError.kind='plan-assist-bail'`). UI surfaces the gate via `PlanAssistPanel` + `ExhaustionsPanel`. Test tooling ships as `DEBUG_FORCE_*` env flags + campaign runners. All prior blind-restart patterns are retired.

**Why:** Targeted rewrites + reviser escalation + plan-assist gate is the canonical non-blind-retry architecture. Each step is narrower and more informative than a blind restart. The plan-assist gate makes auto-mode exhaustion loud and surfaceable rather than a silent auto-approval. See `docs/exhaustion-handler-design.md` for the full design memo.

**Ongoing implications:** `src/gates.ts` is the single source for gate fire logic. Auto throw at lines ~167-170. `chapter_exhaustions` table logs telemetry per-exhaustion event. `chapter_revisions` table (sql/028) logs reviser outcomes. Any new quality gate must follow the same `pendingExhaustion` → gate-fire epilogue pattern in `src/phases/drafting.ts`.

---

### Debug-injection MVP as test-only infrastructure
*2026-04-19 · `src/config/debug-injection.ts`*

**Decision:** `DEBUG_FORCE_PLAN_CHECK`, `DEBUG_FORCE_VALIDATION`, and `DEBUG_FORCE_REVISER` env flags are the canonical testing surface for triggering exhaustion paths without natural failures. `src/config/debug-injection.ts` exports the flags; strict no-op when env unset — zero production footprint. Codex audit `ae23f96a5f5cf8247` recommended a V2 transport-interceptor pattern as the durable evolution; V2 is being specced separately (parallel Codex agent). MVP ships today for immediate campaign testing.

**Ongoing:** V2 transport interceptor spec in progress; when it lands, `debug-injection.ts` may be retired or absorbed into it.

---

### PipelineBailError auto-mode contract
*2026-04-19 · `src/gates.ts` lines ~167-170*

**Decision:** In auto mode, plan-assist gates do NOT silently auto-approve. The gate emits a `gate:plan-assist` SSE event with the full deviation context, then throws `PipelineBailError`. The run halts with `lastRunError.kind='plan-assist-bail'` so the Studio/API caller knows why the run stopped. This is a deliberate contract: auto runs surface exhaustion as a bail, not a silent bypass.

**Why:** Silent auto-approval of exhausted chapters would ship low-quality prose without any signal to the author. The bail is an invitation: either fix the plan, override knowingly, or abort.

---

### Non-blind-retry as canonical quality gate
*2026-04-19 · `src/phases/drafting.ts`*

**Decision:** All prior blind-restart retry patterns are replaced. Every exhaustion point is wrapped in `pendingExhaustion` → gate-fire epilogue. The escalation order is: beat-targeted rewrite → chapter-plan-reviser (once, hard-capped by `revisionUsed`) → plan-assist gate or auto-bail. No path in the drafting phase restarts from scratch without targeted context.

**Why:** Blind retries roll the dice again without fixing the root cause. Targeted rewrites pass the checker's specific failures back to the writer. The reviser edits the plan rather than rewriting blind. The gate gives the author agency at the boundary of automated capability.

---

### Chapter-plan-checker-v2:v1 SFT adapter retired — DeepSeek V3.2 base replaces it
*2026-04-18 (backdated — missing from decisions.md until now)*

**Decision:** `chapter-plan-checker-v2:v1` (Qwen3-14B SFT, exp #170/#178) retired from production. The slot now runs **DeepSeek V3.2 base** with the same `plan-adherence-system.md` prompt. `models/roles.ts` updated accordingly.

**Why:** A dual-oracle audit (Sonnet + Codex gpt-5.4) found ~92% false-positive rate on real fantasy chapter plans, despite the adapter's measured 96% accuracy on exp #178 synthetic eval. Root cause: distribution drift — the 520 synthetic training pairs used planner-generated beat descriptions with uniform structure, but production fantasy plans use dramatic-style beats (shorter, less prescriptive, no explicit event lists). The adapter learned to detect schema deviations in a training distribution that no longer matches production. DeepSeek V3.2 base handles the narrow 3-question check natively without the distribution sensitivity. SFT recalibration on the current production distribution is deferred to `docs/todo.md` low-priority.

**Alternatives rejected:** Retrain v3 on dramatic-beat production pairs — valid but low-priority given DeepSeek handles it correctly today. Keep v2 in production — 92% FP rate on real plans is unacceptable.

**Ongoing:** The adapter artifact remains on W&B for historical reference. The `plan-adherence-system.md` prompt is unchanged and now runs against DeepSeek base — no prompt freeze constraint. See `docs/adapter-changelog.md` and `docs/adapter-training-reference.md` for updated status.

---

### Round A + Round B architecture — non-blind-retry shipped, V2 interceptor Phase 1 coexisting with V1
*2026-04-19 · exp #237 (charter) + #238 (pre-registered validation_sweep, pending execution)*

**Decision:** The non-blind-retry exhaustion-handler architecture shipped in two rounds on 2026-04-19, with a V2 transport-level debug-injection interceptor layered in parallel (Phase 1; coexists with V1 env flags in `src/phases/drafting.ts`). `revisionUsed` now persists to `chapter_outlines.revision_used` (sql/031) so the reviser hard cap survives process restart. `scripts/cleanup-orphans.ts` cascade-deletes across 26 novel-scoped tables for test-novel hygiene. Post-settle `validation-check` trace added so validation-path false-fires are distinguishable from genuine exhaustions. Organic-run-verify script written and pre-registered as experiment #238 (not yet executed).

**Why:** Codex review `a252aecbb785a0eb3` (pre-Round-A) flagged `revisionUsed` as the last remaining restart-reset gap after the exhaustion-handler architecture shipped earlier. Round A closed that gap and the adjacent test-harness + cleanup gaps. Round B added the V2 transport interceptor spec (Codex thread `a892e3f5b4c79a3ea`) to eliminate the "instrument every new call site" fragility class that caused the two seam-recheck bugs (`fed9e4a`, `4ad2413`) earlier this week. A clean no-forced-flags validation run was required because every exhaustion test to date forced failure paths — we had no proof the handlers stay idle on a normal run.

**Codex verdicts:**
- Round A: `aad6d3503db164b1f` flagged 3 HIGH bugs (fire-and-forget DB write window on revisionUsed; R3 trace-replay race; 4 missing FK tables in cleanup-orphans) → all fixed in commit `0c9fa3b` → re-review thread `ac5ae1215077a1bee` PASS @ 90%, no blockers.
- Round B: `a1f0d145132145414` hot-review (full-diff + 3 narrow questions) returned CONDITIONAL PASS @ 84% with 2 MEDIUM findings (llm.ts enrichment outside try/catch; organic-run-verify missing V2-store probe) → both fixed in commit `c0704bd`. M3 (Zod per-kind validation on `POST /api/debug/inject`) deferred with rationale: env gate blocks prod adversaries; malformed rules from test scripts fail loudly when fired.
- Preflight caught one additional bug before Codex review (`ef4aa1b` — retryErrors local type widening). Validates the Lever 3 (preflight) pattern on first use.

**Workflow overhaul (paired decision):** Today's multi-agent pattern (plan → Codex plan-triage → Codex plan review → parallel Sonnet subagents → preflight → Codex implementation review → fix once → deploy → validate → docs → retrospective) produced measurable quality gains (7 real bugs caught across Round A+B; zero regressions shipped to LXC). Codifies as `.claude/skills/implement-ticket.md` (11 phases, 9 exit triggers, mandatory Phase 0 = create tuning_experiment). Session retrospective TEMPLATE.md now mandates 7 telemetry fields (wall_clock_min, codex_reviews, rework_passes, bugs_caught_by_codex, bugs_caught_by_preflight, bugs_escaped_to_prod, preflight_false_positives) so future workflow decisions are data-driven. See Codex consultation threads `a65ba6ef7290fdf25` (5-lever strategic analysis) + `ad350aa657ec1c9b1` (overhaul validation).

**Invariants decision (next-session #1 priority):** 5 starting invariants — revisionUsed restart persistence; seam-recheck symmetry (syntactic); subscribe-before-start (syntactic); branch-symmetric event emission (narrow scope, NOT global proof); body-already-used detection (syntactic). **Invariants MUST be blocking preflight gates, not debug-only** (Codex thread `ad350aa657ec1c9b1` Q6: non-blocking invariants become theater; the highest-probability failure mode for the whole overhaul).

**Alternatives rejected:**
- **Autonomous-loop runtime** — Codex and I agreed the scoped v1 IS the workflow we ship as documentation, NOT as runtime automation. Surface area too large; recreates the "free-running review gate" failure mode warned against in `docs/codex-usage.md`.
- **Standing Codex threads as default** — deferred pending a telemetry-instrumented experiment in one future session. Anchoring risk is real; keep fresh threads with manual preamble headers as the default.
- **Preflight as separate subsystem** — collapsed INTO invariants work. Preflight remains the wrapper/gate; invariants are one of its contents. Syntactic invariants subsume 80% of what a standalone preflight regex bundle would catch.

**Ongoing:**
- Experiment #238 (organic-run-verify) pending execution on LXC. Will self-conclude via `EXPERIMENT_ID=238` env var in `scripts/test/organic-run-verify.ts`. Pass gate: zero `chapter_exhaustions` rows + no `PipelineBailError` + zero active V2 rules in `GET /api/debug/active`.
- Invariants work queued as next-session #1. Plan lives in `docs/next-session-plan.md` once regenerated.
- Commit-pinned reviews formalized in the skill doc (every Codex prompt cites `git show <sha>`).
- Deferred: autonomous loop as runtime; standing thread experiment; `src/invariants/debug.ts` blocking gate; cached generic-reasoning doc for Codex review preambles.

**Commit chain:** Round A `0c9b1ef`, `f1f844f`, `83ffce0`, `0c9fa3b`, `c3e0c08`. Round B `a1f4842`, `b25f01e`, `7cdc0de`, `ef4aa1b`, `c0704bd`. Workflow overhaul `a0d396e`. Pending end-of-session commit links to this decisions entry + threads experiment #237/#238 references.

---

## Superseded charters

Log entries for charters killed by adversary review (RED verdict) and replaced by a successor with a new family name. Per `docs/commit-conventions.md` §Superseded-Documents, the predecessor is deleted from the working tree once superseded; this section is the append-only historical record. Recover the RED version with `git log --follow <path>` and `git show <sha>:<path>`.

### `planner-phase2-contract` (2026-04-18)

**Last live at:** `6dc2fe9` — path `docs/charters/planner-phase2-contract.md` (briefly also at `docs/charters/archive/planner-phase2-contract.md` between `7eb3ce4` and this supersession; the archive-directory experiment was retired the same day).

**Superseded by:** `docs/charters/planner-phase2-payoff-floor.md` (commit `fcae51f`, amended with a granularity-axis eval in `14c853f`).

**RED verdict:** `/codex:adversarial-review` 2026-04-18 (sessions `019da279-313c-7863-aad8-f483ff08e9d7` + rescue-forwarded duplicate). Five blocking issues:
1. Ungrounded effect-size claims (`−30%` / `+5 pts`) not backed by matched baseline rows.
2. Floor rung "describe payoffs in beat descriptions" was weaker than the then-live prompt, sandbagging the comparison.
3. Sample size 3 seeds × 2 runs × 3 chapters = 9 paired observations — effectively zero statistical power to detect a 30% relative effect, despite the `P<0.05` claim.
4. Measuring instrument moved with the mechanism (adherence-events retraining was deferred as "stretch" but the charter's lift hypothesis depended on structured-field verification).
5. Baseline contamination — V1a schema had already landed on `main` when the charter was written; the "pre-V1a baseline" needed for a clean A/B no longer existed without either reverting or tagging. Tag `pre-planner-phase2-v1a` was created at commit `8f42eb6` to preserve the comparison point without reverting the V1a code.

**Why SUPERSEDE vs revise:** the causal question changed — v1 asked "does schema enrichment help?"; v2 asks "does an aggressive prompt-only floor on the pre-V1a baseline already buy most of the V1a lift?" Different mechanism, different baseline, different metric.

### `cross-chapter-state-propagation` (2026-04-18)

**Last live at:** `96b0cb1` — path `docs/charters/cross-chapter-state-propagation.md`.

**Superseded by:** `docs/charters/cross-chapter-endswith-floor.md` (commit `524beee`).

**RED verdict:** `/codex:adversarial-review` 2026-04-18 (session `019da27c-b704-7d23-b1bf-3eb7004b6389`). Five blocking issues:
1. Primary ship metric was `continuity-v2` deviation, but `docs/current-state.md` marks continuity as deprioritized — a ±25% move on a deprioritized checker doesn't answer whether cross-chapter state propagation matters.
2. Confound with the adjacent planner charter — both used the same three fantasy seeds and both touched Phase-2 behavior, so any measured delta couldn't be attributed cleanly.
3. Mechanism claimed "full prior-chapter state" but the actual `planning-beats/context.ts` `priorChapters` renderer surfaces only `characterStateChanges` + `establishedFacts` and omits `knowledgeChanges` entirely.
4. Seeds were selected for clean Salvatore voice routing, not for heavy cross-chapter callbacks — biased away from the hypothesized failure mode.
5. Self-contradictory comparison protocol — Floor+ vs V1 vs near-tie had no coherent decision rule across §5 / §7 / §8.

**Why SUPERSEDE vs revise:** the primary metric had to change (not continuity) and the pilot design had to change (seeds disjoint from the planner charter, written callback-density screen). New family name signals the reframing.

### `salvatore-v5-corpus-expansion` (2026-04-18)

**Last live at:** `7cc6322` — path `docs/charters/salvatore-v5-corpus-expansion.md`.

**Superseded by:** `docs/charters/salvatore-distinctness-conditioning-floor.md` (commit `355417e`), which depends on the frozen eval at `docs/evals/salvatore-distinctness-v1.md`.

**RED verdict:** `/codex:adversarial-review` 2026-04-18 (session `019da278-7118-73c2-b322-dfde6d59c253`). Six blocking issues:
1. Cheapest counterfactual (`exampleLines` rotation) dismissed without measurement, despite v4 itself shipping on exampleLines conditioning per 2026-04-17.
2. `salvatore-distinctness-v1` eval didn't exist but was the primary ship gate — "benchmark design is the core experiment" was inverted.
3. Judge model unnamed — model-dependent voice judgments are documented (Archetype POC), so an unnamed judge is a judge-shopping trap.
4. Core 4-book corpus plan was drow-heavy (Homeland / Starless Night / Servant of the Shard); the only balancing title (Sojourn) was demoted to "optional stretch."
5. `≥15 pts` ship threshold numerology — on a 24-pair eval one flip = 4.17 points, so "+15 pts" wasn't anchored to eval resolution.
6. Budget `$10` / `1.5 days` ignored the admitted missing eval build + manual corpus prep (~420–470 Stage 3/4 batches).

**Orthogonal pre-gate:** zero of the four priority books were findable on local disk or LXC (full inventory recorded in the 2026-04-18 session transcript). Acquisition would have been a hard Step-0 prerequisite independent of charter quality.

**Why SUPERSEDE vs revise:** the lever changed entirely — v1 tested corpus expansion; v2 tests runtime conditioning (exampleLines rotation) on a frozen eval before any corpus expansion. No training spend in v2. Corpus expansion reopens only if conditioning-first kills.

**Companion runbook:** `scripts/corpus/salvatore-v5-runbook.md` remains in the working tree with `status: deferred` — operator-actionable if conditioning-first fails and corpus expansion is later reopened. Not superseded, not retired.

### Retrospective: the archive-directory experiment

A separate `docs/charters/archive/` directory was tried on 2026-04-18 (commit `5fb4a3f` convention + `7eb3ce4` first archival) as the method for handling superseded charters. Abandoned the same day because:

1. Duplicates what `git log --follow` already does.
2. Creates cross-reference drift — `docs/current-state.md:54,64` went stale within hours of the first archival because the archived file's path changed.
3. Adds a 3-step ritual per supersession event (move + frontmatter edit + README update) with no corresponding payoff.

Current convention is the delete-and-log rule above. The archive dir + README were removed as part of the `planner-phase2-contract` supersession commit.

---

## Checker architecture

### beat-entity-list V1 shipped — halluc-ungrounded fire rate −16 pts on fantasy-debt
*2026-04-20 · exp #254 · charter `docs/charters/beat-entity-list-v1.md` · commit `ff555bc`*

**Decision:** `BEAT_ENTITY_LIST_VARIANT=v1` is the new default for the halluc-ungrounded checker. When the writer drafts a beat, the checker now sees a `Beat-entities:` sub-line inside the WORLD BIBLE block, derived from `outline.establishedFacts[*].fact` proper nouns + the prior beat's `description` proper nouns via the shared helper at `src/phases/beat-entity-list.ts`. The derivation is done at check time — no planner-schema change.

**Evidence (within-seed ladder on `fantasy-debt`, 3 chapters, frozen plan):**
- V0 (no change, current prod): 44.9% ungrounded fire rate (44/98 calls, novel-1776698676238).
- V1 (checker-derived): 28.9% (37/128, novel-1776698676238-v1) — **Δ = −16.0 pts**. Chapter-1 V1 numbers inflated because the non-auto launch re-ran ch1 on resume; chapters 2-3 alone are a clean comparison (V0 38.2% → V1 15.4%, Δ = −22.8 pts).
- Precision floor: 87.5% (14 TP / 2 FP) via 10-fire Sonnet adjudication of solo-ungrounded fires 49213/49221/49225/49257/49293/49314/49342/49429/49488/49586. Both FPs flagged "Aldric" despite it being in Beat-entities — known adapter overfire on already-grounded entities, ~17% of fires, below the 50% Class-B kill threshold.
- Adherence regression: 0 fires → 0 fires (±2 pts required). Degenerate-list: 0% (15% ceiling). All five charter gates cleared.

**Why:** the 2026-04-20 production audit on 7 novels (`docs/halluc-v3-production-report-2026-04-20.md`) identified the root cause of the 46.7% baseline fire rate as a context-surface mismatch — the writer sees the full chapter outline + transition bridge + character snapshots; the checker sees only beat.description + world-bible names. Legitimate continuity references (entities mentioned in earlier beats or in `establishedFacts`) fired as ungrounded. V1 closes that gap cheaply via shared derivation.

**Alternatives rejected per charter §7 ladder:**
- **V2 (writer-only allowlist)** — skipped. V1 drops ≥15 pts means running V2 cannot improve the SHIP decision and only adds noise if V2 silently regresses something.
- **V3 (full stack, derived)** — skipped. Same reasoning.
- **V4 (planner-emitted `sceneBeat.mentionedEntities`)** — deferred. Only opens if V1/V2/V3 plateau short of the gate; V1 cleared it.
- Harder retry-wording alone — already shipped 2026-04-20 (commits `1bdc422` + `4471cac`) with retry clearance of 9%; surface gap, not wording, was the dominant failure mode.
- Retrain with widened surface — reserved for the 17% Class-B residual (Aldric overfire), not the primary lever.

**Class A/B/C attribution on V1 fires (46 entities sampled):**
- **Class B** (adapter overfires despite visibility): ~17%. All were "Aldric" — the protagonist is in `beat.characters`, so in bibleKnown, but adapter still flagged. Adapter-attention issue, not a surface issue. Below 50% kill → derived-source lever remains viable.
- **Class A/C** (not in checker surface): ~83%. Split roughly between Salvatore corpus leaks (Waterdeep, Luskan, Ten-Towns, Bryn Shander, Do'Urden, Baldur's Gate, Drossen Ironbelly — LoRA leakage that halluc-leak-salvatore under-fired on; 0 fires on this seed is a separate finding) and novel-specific writer inventions (Veynbridge, Bremen, Mottled Masks, Consortium, Plaza of the Three Horses, Brennan's Guild). Both are legitimate ungrounded fires per the checker's own system prompt.

**Ongoing implications:**
- `halluc-leak-salvatore-v1:v1` fired at 7.1% on V0 and 6.3% on V1 (earlier "0 fires" claim in this entry was a query bug — the leak adapter uses `{"has_leak":true,"leaks":[...]}` output shape, not `pass:false`, and the aggregate filter missed it). Correct finding: the leak adapter has **partial recall** on canonical Forgotten Realms names — caught "Ten-Towns" 1/2 times, "Luskan" 1/2, "Do'Urden" 1/2, "Bryn Shander" 1/1, "Maer Dualdon" 1/2, but missed "Waterdeep" 4/4 and "Baldur's Gate" 3/4. Halluc-ungrounded caught all of them as the corpus-agnostic safety net — this is the designed behavior of the two-adapter OR-gate, not a failure. Training-data gap (Waterdeep / Baldur's Gate not in `halluc-leak-salvatore-v1` positive examples) is the actual finding.
- Beat-entity derivation is now shared infrastructure. V2 (writer-side allowlist) can be reopened cheaply if future writer-invention pressure justifies it.
- The 2-FP residual (Aldric flagged despite Beat-entities) is the signal for a future adapter retrain with wider grounded-surface training data.
- `scripts/variant/clone-for-variant.ts` (plan-freeze infra) is kept — future within-seed ladder experiments reuse it.

**Instrumentation:** every halluc-ungrounded call now writes `groundedSources: {variant, bible[], from_brief[], derived_outline_fact[], derived_prior_beat[], planner_emitted[]}` into `llm_calls.request_json` — queryable via standard JSONB path operators after the `request_json` double-encode fix (commit `ff555bc`). Mechanism-falsifier queries documented in the charter §3.

**Class-of-bug caught mid-run:** `logLLMCall` was JSON.stringify-wrapping `request_json` before passing it to Bun.sql's tagged template (which auto-serialises JSONB). Result: Postgres stored the object as a JSONB *string type* — nested path operators always returned NULL. Latent since sql/018. Exposed only when the charter's mechanism-falsifier needed `request_json #> '{groundedSources,...}'`. See commit `ff555bc`.

### halluc-leak-salvatore: regex OR-combine shipped at inference (Rung 0)
*2026-04-20 · exp-derived (charter `docs/scoping/halluc-leak-salvatore-v2.md` §5) · commit `cc57752`*

**Decision:** `checkHallucLeakSalvatore` now runs a 59-token case-insensitive regex against beat prose in parallel with the W&B adapter call, unions the results, and fires on either side. Regex token list lives at `src/agents/halluc-leak-salvatore/regex-leak.ts` — union of `scripts/hallucination/expand-leak-vocab.ts` LEAK_TOKENS + scoping doc §B additions (Waterdeep, Baldur's Gate, Harpells, Chionthar, Neverwinter, Menzoberranzan, Gauntlgrym, Helm's Hold, Sea of Swords, Sea Sprite, Drossen Ironbelly, Nine-Towns).

**Evidence (production-wide, 3,081 halluc-leak-salvatore calls across 32 Salvatore-routed novels since 2026-04-18 wire-in):**
- Adapter-alone beats flagged: 158.
- OR-combined beats flagged: 208 — **Δ = +50 (+31.6% recall)**.
- Top adapter misses caught by regex: Harpells (35), Baldur's Gate (32), Waterdeep (15). Spot-checked ≥95% precision on 5 randomly sampled regex-only fires via Sonnet adjudication — all unambiguous corpus leaks in dialogue/narration.
- Residual adapter-only catches (regex FNs): 12 beats — "dark elf" (generic not in token list), "Rumblebelly's" (possessive edge case), "mithril" (lowercase standalone). Three genuine regex FNs logged to `docs/todo.md` for a widen pass.

**Why:** earlier aggregate queries suggested `halluc-leak-salvatore` fired 0 times on the beat-entity-list V1 charter seed, which looked like adapter under-recall. That claim was a query bug (see `docs/lessons-learned.md` "Verify output schema before asserting a zero-fire baseline"). The real fire rate is 7% production-wide with partial recall on canonical FR names — a training-data gap (Waterdeep + Baldur's Gate not in v1 positive examples). Rung 0 asked: does a regex closing that gap OR-combined with v1 hit ≥85% precision / ≥75% recall? Both cleared comfortably at ~95% / ~95%.

**Alternatives rejected:**
- **SFT retrain `halluc-leak-salvatore-v2`** — deferred. The scoping doc's Rung 0 ladder explicitly gated SFT on regex failing. Regex passed, so no training spend.
- **Corpus stripping at inference (regex-replace entities in prose before adapter call)** — rejected: breaks semantic continuity; prose downstream of regex-strip is no longer what the reader sees.
- **Widen the v1 adapter's grounded surface** — off-distribution per the leak adapter's training shape.

**Ongoing implications:**
- The regex token list needs to mirror every future adapter's training vocabulary — when a non-Salvatore voice LoRA ships (Gemmell, Cook, etc.) it needs its own regex sibling. Per-writer, per memory `project_three_layer_architecture.md` "leak detection is per-writer."
- Three regex FNs (verbeeg — in list but missed, Aegis-fang — in list but missed, possessive forms of list tokens) need a followup regex-widen pass. Logged to `docs/todo.md`.
- Retraining pathway (v5-stripped ablation at `docs/ablation/salvatore-v5-stripped.md`) is independent of Rung 0 and still available — it addresses **weight-level** leakage (writer LoRA leaking corpus tokens before any detector runs), not detection. Gated on: (1) conditioning-floor charter verdict and (2) user decisions on 4 design gates (brief-side stripping scope, placeholder strategy, sequencing, rename-augmentation interaction).

**Full report:** `docs/rung-0-regex-ceiling-results.md`.

### V1a payoff-floor pilot — ITERATE (2 of 4 arms run)
*2026-04-20 · exp #256 · charter `docs/charters/planner-phase2-payoff-floor.md`*

**Decision:** ITERATE per charter §7. The aggressive prompt-only setup/payoff floor on `pre-planner-phase2-v1a` did not recover the V1a lift — mean paired Δ retry_ratio = **−0.0309** across 15 (seed, chapter) slots on 3 fantasy seeds. Slot wins: prompt 6, baseline 8, ties 1. Stddev 0.1256. Directional signal is consistent with "V1a schema is the causal lever," but only 2 of 4 charter arms were run (scoping error at launch; missing `extractor` measurement-only arm + `mainv1a` observational reference row). V1b (`speaker_directives`) and V1c (`subplot_id` + `thematic_focus`) remain gated on a completed 4-arm pilot.

**Evidence:** see `docs/pp2-floor-pilot-results.md` for the 15-row table and the full §7 decision walkthrough. 6 novel IDs enumerated there.

**Why this is still useful despite the scoping error:** the prompt-only arm was the weakest of the four arms — if it had won, we could have declared V1a schema unnecessary with just 2 arms. It did not win. The directional signal survives the scope gap.

**Alternatives rejected:**
- **Declare V1a causal, unblock V1b/V1c** — rejected. Stddev 0.1256 across 15 slots means the 0.03 Δ is within 1σ/√15 noise. Without `extractor` we can't separate planner-JSON-shape causation from verifier sensitivity; without `mainv1a` we can't anchor to current-prod behavior.
- **KILL V1a schema family** — rejected. §3 falsification requires both cheap levers (prompt + extractor) to fail; only prompt tested.
- **Expand directly to 6 seeds skipping the 2 missing arms** — rejected. Missing arms are the cheaper counterfactuals; run them first before doubling seed count.

**Ongoing implications:**
- Next session: run `extractor` + `mainv1a` arms on the same 3 seeds before expanding to 6 seeds. Estimated ~$0.30–$0.60 + 1.5–4h wall clock.
- Worktree at `~/apps/nh-pp2-floor` is preserved; beat-expansion prompt file restored to baseline MD5 `ee928170` post-run.
- V1b/V1c charters should NOT be written yet. Writing them before the 4-arm pilot completes would invite RED verdicts for "declaring causation on incomplete data."
- The scoping error (reducing 4 arms to 2 at launch) is captured in `docs/lessons-learned.md` as a charter-fidelity pattern.



### `salvatore-distinctness-conditioning-floor` KILL — rotation fails ship gate 7/20
*2026-04-21 · exp #258 · charter `docs/charters/salvatore-distinctness-conditioning-floor.md` (slim-live-v1-replay-3arm)*

**Decision:** KILL the conditioning-first lever. Per charter §7, rotation wins **7 / 20** matched beats against fixed (preset-a) on blind Sonnet pairwise voice-distinctness judgment. §7 thresholds (N=20): SHIP ≥13, ITERATE 11–12, **KILL ≤10**. Rotation is well below the kill threshold.

**Ship gate detail:**
- 3 pairs auto-resolved to fixed because rotation produced <50 words (ch1-b4 40w, ch5-b5 45w, ch1-b10 49w) — rotation reliability problem, not just distinctness.
- 10 / 17 judged pairs went to fixed. Sonnet repeatedly flagged rotation prose with repetition-loop degeneration (e.g. ch2-b12 B arm: "Would it also show false debts? / I mean, the power allocations—they don't match the verified marks, see?" repeating verbatim three times, collapsing voice distinction).
- 7 / 17 judged pairs went to rotation, on clean register-contrast wins.

**Halluc-leak Rung 0 regex fire counts across 20 beats × 3 arms:** raw=5, fixed=6, rotation=**1**. Rotation PASSES the halluc-leak gate (rotation ≤ fixed). Interesting independent signal: rotation produces less Salvatore-corpus leak (likely because rotated example lines reduce over-fit to cached Crystal Shard vocabulary) — but this does not override the primary distinctness gate per §7.

**Why Sonnet-only, not gpt-5.4 confirmation:** the gpt-5.4 cross-judge run (via `codex exec` in a concurrent subprocess pool) hung with zero returns after 16+ min. Turned out to be a wrong invocation pattern — `spawn("codex exec", ...)` × N is not a supported concurrent pattern (each call spins up its own app-server subprocess; they block). Captured as a memory for future sessions (`~/.claude/projects/.../memory/feedback_codex_plugin_subagentic_concurrency.md`). Sonnet-only verdict stands: the 7/20 signal has 3 short-circuit wins mechanical + 10 confidently-reasoned fixed-wins, so gpt-5.4 would have to flip 6+ decisions to move rotation into ITERATE — unlikely given Sonnet cited concrete degeneration evidence (repetition loops).

**Evidence:** `output/evals/conditioning-floor-pilot-v1-judgments-fixed-vs-rotation-sonnet.json` has all 20 verdicts + summary. Full replay telemetry in `public.llm_calls` joinable via `runs.experiment_id = 258`. Parity harness confirmed all three arms byte-equal to live prompt bytes (modulo intended exampleLines delta) on pre-run audit.

**Alternatives rejected:**
- **Run gpt-5.4 sequentially (no concurrency) and wait ~3 hours** — rejected. KILL signal is already strong; 3 auto-wins alone require rotation to win 13/17 judged pairs to reach SHIP, and Sonnet gave it 7/17 with concrete reasoning. Marginal value of cross-judge confirmation is low relative to wall-clock cost.
- **Lower gpt-5.4 reasoning effort to medium** — rejected. Breaks §3.6 frozen judge discipline; would need to rerun at high later.
- **Rerun on a second source novel before killing** — rejected. §7 KILL path does not require second-source confirmation; ITERATE does.

**Ongoing implications:**
- Reopen `salvatore-v5-corpus-expansion` as a separate charter (per §7 KILL post-outcome path). PDF acquisition is that charter's pre-gate, not this one's.
- The conditioning-floor infra (three-arm replay runner, parity harness, judge wrapper, pair-builder) stays in the repo as reusable scaffold. The Agent-subagent judge path replaces `codex exec` for concurrent eval batches going forward.
- H2 (profile-field rotation) stays deferred; the runtime has no preset-indexed profile representation, and H1 failed.
- `docs/experiment-design-rules.md §4.7` (parity-harness SOP) stays; the conditioning-floor harness remains the canonical implementation and was validated end-to-end on this pilot.
- Nine rounds of adversarial review (§10.1-§10.9 in the charter) produced a clean, measurable KILL verdict — the investment in the review cycle was substantial but the experiment is interpretable because of it.

### Salvatore v4 LoRA cannot rewrite with critique — quality-redraft gate ships instead
*2026-04-21 · commits `893bb26` (gate), `eb3e7c8` (rigorous probe)*

**Decision:** The "targeted-critique rewrite" path — giving the adapter V1 prose plus a structured critique and asking it to improve — does not work for the Salvatore v4 LoRA. The gate design collapses accordingly: detect quality defects, then trigger a **no-critique redraft** (same writer, fresh sampling, no V1 prose in context). Shipped behind `pipeline.qualityRedraftEnabled` flag, default OFF. Detector lives in `src/lint/quality-detectors.ts` (repetition + underlength; 24 unit tests). Gate wired into `src/phases/drafting.ts` via `detectSyncDefects`.

**Why:** two probes falsified the rewrite hypothesis:
1. **Exploratory probe** (`scripts/evals/run-rewrite-probe-rigorous.ts`, ea74d90) — hand-built retry shape; adapter produced near-verbatim V1 prose.
2. **Rigorous probe** (`eb3e7c8`) — used the production `buildRetryPrompt()` path (now extracted to `src/agents/writer/retry-context.ts`, commit `3c5313d`). Results: 8/20 pairs byte-verbatim V1, 11/20 near-match, 1/20 genuinely different. The **production retry shape was worse for rewrite** than the hand-built shape — feeding V1 prose as context strongly anchors the adapter to it.

The probe falsifies the assumption behind targeted-critique rewriting for LoRA-generated beats. The adapter can produce fresh prose (it generates beat-0 cleanly from blank context) but cannot escape a V1 anchor.

**Alternatives rejected:**
- **Add more critique structure** — rejected. The structural critique is not the bottleneck; the V1 prose anchor is. More structure would not remove V1 from context.
- **Strip V1 prose from the retry prompt** — this *is* the quality-redraft design. Rather than a workaround, it's a first-class path.
- **Use a non-LoRA model for rewrites** — future option, not current scope; the redraft-from-scratch path avoids needing a separate model.

**Ongoing implications:**
- The `qualityRedraftEnabled` flag is default OFF. Measurement run completed 2026-04-21 (novel PID 315593, 93 beats, 29 retries = 31%, $0.0462 cost): **`grep -c 'quality redraft' /tmp/quality-redraft-treatment.log` returned 0** — the redraft gate never fired despite the flag being on. Inconclusive as a gate-value measurement; the more actionable finding is that the detector thresholds (`detectRepetition` + `detectUnderlength(<100w)`) are likely too strict to ever trigger on real Salvatore-route production prose. Flag remains default OFF. Counted as signal #3 in the 2026-04-21 LoRA-track-evidence retrospective (`docs/retrospectives/2026-04-21-lora-track-evidence.md`).
- Three-layer doctrine challenged by Codex independent evaluation (jobs `bre6gu89b`, `bsbwl0v3g`): the "voice lives only in weights, editors cannot add craft" claim was flagged as architecturally inconsistent with cross-layer feedback routing already in the system. The redraft gate is itself a context-engineering intervention that crosses the writing/checking boundary. Doctrine is **not retracted** but the blanket "don't cross streams" framing overstates the separation.
- `src/lint/quality-detectors.ts` is now a production module (repetition, underlength). Future quality signals go here.
- `src/agents/writer/retry-context.ts` is the canonical location for retry-prompt construction (extracted from drafting.ts inline logic, commit `3c5313d`).

---

### Voice-LoRA track frozen; DeepSeek V3.2 base becomes the strategic writer target
*2026-04-21 · retrospective `docs/retrospectives/2026-04-21-lora-track-evidence.md`; strategic Codex consult `acc1b47d14ce265f4`; decomposed-audit design consult `ae0e768d3292eb256`*

**Decision:** The voice-LoRA writer track (Salvatore v3/v4/v5 lineage) is FROZEN for new investment. DeepSeek V3.2 base becomes the strategic target writer for the harness. Existing Salvatore v4 adapter stays in production `WRITER_GENRE_PACKS` routing until the voice-shaping ablation (`voice-shaping-ablation-v1`) produces a direct replacement recommendation.

The pivot is a **freeze**, not a retirement. The LoRA infrastructure (W&B Inference serving, training pipeline, eval harness) is retained for future use if the voice-shaping program determines a bigger base model with weight-level fine-tuning is the answer. What's frozen is the current-cycle investment in Salvatore-adjacent levers.

**Why:** four 2026-04-21 negative signals on LoRA-adjacent levers (conditioning-floor KILL exp #258, rewrite-capability probe, quality-redraft gate 0-fires, arm-b-direct-pairwise weak A-lean 11-9 CAUTION) established the "current LoRA-side levers are failing" claim per the three-claim framework in the retrospective. arm-d-writer-upgrade ran as the forcing function for the stronger claim "LoRA is empirically worse than a strong untuned base"; the formal pairwise verdict was skipped after Codex's decomposed-audit design consult (`ae0e768d3292eb256`) found that pairwise on this corpus is bias-confounded (sensory-richness bias correlates with DeepSeek's 16/20 longer-pair advantage, documented in lessons-learned §29-30). Directional evidence from the arm-d run itself — DeepSeek median 172w vs Salvatore 90w, DeepSeek fire rate 10% vs Salvatore 20%, Salvatore 2863w loop outlier — was strong enough in combination with the earlier signals to commit the pivot without waiting for a formal adjudication instrument the project doesn't have.

**Why NOT "retire the entire fine-tune thesis":** 14B-LoRA voice transfer failing at this scale is not evidence that weight-level voice imitation is impossible at larger scales. The pivot is to prompt+pipeline-level voice shaping on a capable base FIRST; if that falls short, returning to fine-tuning on a 70B+ base remains on the table. The three distinct claims Codex called out (current-levers-failing / LoRA-worse-than-base / fine-tune-thesis-wrong) have evidence for 1, partial evidence for 2, none for 3.

**Alternatives rejected:**
- **Keep pushing Salvatore-adjacent micro-levers** (v5 corpus expansion, different fine-tune family, different sampling tricks). Rejected on the "four negatives in a day" pattern — specific levers are failing, not random variance.
- **Retire voice-LoRA entirely, move to API-only for all writers.** Rejected as premature: no evidence the voice-LoRA infrastructure is fundamentally wrong at bigger scales. Preserve the capability; pause the investment.
- **Accept 11-9 arm-b-direct-pairwise as sufficient evidence** for LoRA supremacy. Rejected: arm-b tested enrichment vs baseline, not LoRA vs base; the CAUTION verdict said context engineering isn't a lever, not that LoRA is winning.
- **Run formal pairwise adjudication on arm-d** to settle the LoRA-vs-base comparison. Rejected post-Codex-consult: holistic pairwise is structurally confounded on this corpus (sensory-richness bias correlates with DeepSeek's length advantage); an ensemble of AI judges shares the same bias; manual adjudication would take 45min for a verdict already supported by directional evidence.

**Ongoing implications:**

- **`WRITER_GENRE_PACKS` in `src/models/roles.ts`** — fantasy genres still route to Salvatore v4 in production. This is NOT changing today. The `voice-shaping-ablation-v1` charter will produce a candidate replacement or confirm the LoRA is still the best available option.
- **`docs/charters/salvatore-v5-corpus-expansion.md`** (queued/deferred) — remains queued but decapitalized. Do NOT start corpus acquisition or training work until the voice-shaping program resolves.
- **New charter shipped:** `docs/charters/voice-shaping-ablation-v1.md` — first experiment under the pivot. Six arms on DeepSeek V3.2: bare baseline, style-guide system prompt, few-shot reference passages, stronger per-character speaker directives, two-stage voice transfer, metric-gated retry. Decomposed audit (voice-shape metrics + adherence + halluc-leak kill gate + character-distinctness audit) per Codex recommendation. ~$0.20 cap.
- **Howard primer methodology retirement rationale (2026-04-16) is refined:** that decision established "prompt-based voice transfer doesn't work at 14B." It does NOT establish "prompt-based voice transfer never works." DeepSeek V3.2 is much larger; in-context learning is a different regime at that scale. The voice-shaping ablation explicitly tests whether this regime change matters.
- **Retrospective `docs/retrospectives/2026-04-21-lora-track-evidence.md`** is now the canonical narrative of the pivot. This decision entry is the decision; the retrospective is the evidence/context.
- **Product-identity implication (per Codex consult §4):** if voice-shaping fails to match the LoRA's voice quality, the harness's commercial differentiator shifts from "offline-capable Salvatore-voice imitation" to "planner/context/checker harness around an API writer." That re-framing is deferred to post-voice-shaping-ablation synthesis. Not decided yet.
- **Howard primer V4 adapter on W&B** (retired for automatic routing 2026-04-16) remains available for the on-demand `POST /api/novel/:id/tonal-pass` endpoint. Unchanged by this pivot.

---

### tier-ordering-validation-v1 killed; 3-tier sequential ordering stays as working hypothesis
*2026-04-21 · exp #264 · charter `docs/charters/tier-ordering-validation-v1.md` · results `docs/charters/tier-ordering-validation-v1-results.md` · retrospective `docs/sessions/2026-04-21-tier-ordering-probe.md`*

**Decision:** The `tier-ordering-validation-v1` charter — commissioned to empirically test whether the autonomous-loop roadmap's Tier 1 (structural planning) and Tier 2 (writer quality) can be sequentially optimized or require parallel-coupled optimization — is fully killed across both lever versions. The 3-tier sequential ordering assumption is promoted from "to be validated" to "working hypothesis, revisit if Tier 1 winners collapse under Tier 2 writer swaps." The cheapest-untried-counterfactual probe space at chapter-scale is exhausted for this specific question.

**Why:** The roadmap revision 2 (commit `db9d8f6`) landed an explicit 2×2 design to validate the tier ordering — {baseline planner, loud planner variant} × {DeepSeek V3.2, Salvatore v4 LoRA}. The Opus `experiment-adversary` fallback (Codex SlashCommand tool unavailable in session) returned RED with 7 blockers + 4 warnings + a $0.60 synthetic-loud-planner probe as cheapest-untried-counterfactual. Two lever versions were then falsified in sequence:

1. **v1 lever (establishedFacts + characterStateChanges density) — killed by terrain survey (commit `9956f62`).** The intended lever doesn't reach the writer prompt under the current `src/agents/writer/beat-context.ts`. Orphan `establishedFacts` are only read to build a factById lookup map; the writer sees them only when explicitly linked via `beat.requiredPayoffs` (SEEDS / PAYOFFS DUE blocks at lines 255-281). `characterStateChanges` from the outline is never rendered to the writer at all. The $0.60 probe would have measured byte-equal writer outputs — a $0 code-level audit rescued the budget.

2. **v2 lever (requiredPayoffs density) — killed by probe (exp #264, commit `b4426fb`).** After pivoting to a writer-visible lever, the probe ran on 52 beat-writer calls (2 chapters × 2 variants × 13 beats) for $0.028 actual (21× under budget). Marginal adherence-pass delta was −7.7pt (baseline 23/26 = 88.5% → loud 21/26 = 80.8%), which tripped the driver's NEGATIVE threshold but failed the correct matched-pairs McNemar test at p ≈ 0.68 (4 P→F regressions / 2 F→P recoveries / 6 discordant pairs). The writer IS visibly responding to the lever — extra SEEDS blocks compete with core-beat attention, producing occasional action inversions and truncations — but the net effect sits within sampling noise at n=26/cell.

**What this establishes:**
- Density-manipulation as a planner-side lever at chapter-probe scale does not produce a signal on adherence-pass-rate with a cheap instrument. The ordering question at this resolution is unanswerable for the budget tier the roadmap allocated.
- Two distinct structural-state surfaces that the roadmap conflated — the *outline schema* (planner output) and the *writer render set* (`beat-context.ts` concatenation) — are now named as separate concepts. See lessons-learned §"Writer-visible state surface is narrower than outline schema."
- Chapter-probe instruments with binary pass/fail at n=26/cell have a noise floor around ±6pt. Future probes at this scale need finer-grained metrics or more sampling units. See lessons-learned §"Adherence-pass-rate has a noise floor at n=26/cell."

**Alternatives rejected:**
- **Commission the full 2×2 as revised** — the single-writer stage-1 probe came in FLAT. Multiplying that by a second writer and a ceiling anchor would compound noise, not resolve it.
- **Expand to a 2×3 with Llama 8B ceiling anchor (adversary's blocker #7)** — same objection; the per-cell signal is too weak to survive additional-writer comparison.
- **Accept the script's marginal NEGATIVE verdict at face value** — rejected after McNemar analysis; the driver's ±5pt threshold was too tight for the realized sample size.
- **Treat the ordering as falsified by the FLAT result** — rejected. The probe doesn't discriminate; absence of evidence is not evidence of absence. The ordering assumption is unvalidated, not disproven.

**Ongoing implications:**
- **Roadmap revision 2 (`docs/autonomous-loop-roadmap-2026-04-21.md`) stays authoritative** with one semantic update applied via this decision entry: the "Validating the ordering" §2×2 design is no longer executable as specified; the ordering is a working hypothesis to revisit under the "Tier 1 winners collapse under Tier 2 writer swaps" trigger documented in charter §11 Fork 3.
- **Next Tier 1 work: ship the writer-visible threading** (`todo.md` item). Bulk `establishedFacts` injection into `beat-context.ts`, `worldExpansionBudget` wiring, `priorBeatEstablishedFacts` via `getFactsUpToChapter`. These are the un-shipped glue the terrain survey identified, and the three Tier 1B items the roadmap explicitly names as "most-unshipped." Measurement must be at full-novel scale via decomposed audit, not chapter-probe — the latter's noise floor is now demonstrated.
- **Adversary-review process caveat:** the Codex SlashCommand invocation path was unavailable mid-session; the Opus `experiment-adversary` fallback substituted per the skill's documented fallback rule. The fallback's RED verdict + cheapest-untried-counterfactual still steered the session to the correct kill. Worth making the primary Codex path more resilient, but the fallback mechanism worked as designed.
- **Pattern for future charters — "terrain-survey preflight":** before any experiment that assumes "planner output X reaches writer Y," add a $0 render-surface audit as an explicit preflight item alongside the adversary-review gate. This session shows the audit is cheap, high-signal, and can kill entire experiment branches before LLM spend. Documented as a rule in lessons-learned §"Terrain-survey before probe implementation."
- **Cost-estimate discipline reinforced:** the adversary's $0.60 budget was 21× over the actual $0.028 because per-token estimates don't account for DeepSeek prefix caching (280-320 cached tokens per call on the primer surface). Future charter §7 budgets should anchor on `SELECT sum(total_cost_usd) FROM llm_calls WHERE agent='beat-writer' ...` for any recent beat-scale run, not per-token ceilings. Reinforces memory `feedback_query_llm_calls_for_costs`.

## Session 2026-04-29 — DeepSeek V4 Flash swap + per-agent thinking-mode toggle

### DeepSeek V3.2 → V4 Flash pipeline-wide; thinking mode is per-agent
*2026-04-29 · commit `eb2993d`*

**Decision:** All DeepSeek-using slots route to **DeepSeek V4 Flash** (replacing V3.2). Thinking mode is OFF by default; ON only on three slots that reason over multi-element structure with cross-element dependencies — `planning-beats`, `chapter-plan-checker`, `chapter-plan-reviser`. Decision rule documented as a comment block above `deepseekV4Flash` in `src/models/roles.ts` so future model swaps inherit the rule.

**Why:** V4 Flash is DeepSeek's current production tier with optional thinking mode. The instinct to flip `thinking: true` for all 10 DeepSeek-using slots was caught by the user ("are they literally all being used for thinking?") — thinking tokens cost latency and money in exchange for *multi-step structural reasoning*, not for creative output or one-shot transforms. The three thinking-on slots all run cross-beat / multi-element analyses (14-beat per-chapter expansion + state flow; cross-beat coherence judgment over 14 beats; smallest-edit diff over a multi-issue cluster); the other seven (writer, world-builder, character-agent, plotter, planning-plotter, planning-extractor, artifact-adjuster) are creative or one-shot and stay non-thinking.

**Implementation surface:**
- `src/models/registry.ts` — added `deepseek-v4-flash` ($0.14 / $0.28 / $0.0028 cache hit; thinking optional; maxOutput 64K) and `deepseek-v4-pro` ($1.74 / $3.48 base, currently 75% off until 2026-05-31; thinking always-on; reserved as escalation, NOT routed in `roles.ts`). Removed legacy `deepseek-chat` and `deepseek-reasoner` entries entirely (no aliases).
- `src/models/roles.ts` — renamed `deepseekV3` → `deepseekV4Flash` constant; thinking-true set is exactly `{planning-beats, chapter-plan-checker, chapter-plan-reviser}`.
- `src/llm.ts` — `thinking: boolean` plumbed through `makeRequest()` into the request body as `{ thinking: { type: "enabled" } }` for the deepseek provider only. Other providers ignore the flag.
- 22+ scripts string-replaced from `deepseek-chat` → `deepseek-v4-flash`.

**Alternatives rejected:**
- **Set `thinking: true` everywhere DeepSeek runs.** Was the initial implementation; user pushback corrected it. Latency cost not justified for one-shot creative slots.
- **Keep V3.2 as the live default and add V4 Flash as opt-in.** No reason to maintain two API tiers when V4 Flash is the current production family — clutter for no benefit. V4 Pro stays in the registry as the escalation tier.
- **Use V4 Pro by default for the thinking slots.** ~12× output cost vs Flash at base rate; reserved for cases where Flash thinking proves insufficient. Pricing source: `https://api-docs.deepseek.com/quick_start/pricing` (V4 Pro base $1.74/$3.48; V4 Flash $0.14/$0.28).

**Ongoing implications:**
- Any new DeepSeek-using slot defaults to non-thinking; the comment block above `deepseekV4Flash` is the source-of-truth decision rule. Adding `thinking: true` requires the slot to justify it against the multi-element-structural-reasoning criterion.
- Latency baselines (CLAUDE.md says ~30s/beat on V3.2) need re-measuring after the first end-to-end novel run on V4 Flash. Flagged in current-state.md.
- V4 Pro is registered but unrouted — escalation lever for any slot whose Flash-thinking output proves insufficient. The 75% promo discount expires 2026-05-31, after which the base $1.74/$3.48 rate returns.

### Phase-eval probe scaffold (variant runner via env-var seam)
*2026-04-29 · commits `a031980` (Slice 0a) + `c6ef9a5` (Slice 1) + `9de6a78` + `d024ce8`*

**Decision:** Ship a cheap-probe instrument for testing planner-prompt variants side-by-side without building a full harness. Implementation lives in `scripts/phase-eval/` + the `PLANNING_BEATS_PROMPT_OVERRIDE` env-var seam in `src/agents/planning-beats/index.ts`. The probe is offline tooling, NOT part of the runtime pipeline — production novels are unaffected.

**Why:** The phase-variant-comparison charter (`docs/designs/phase-variant-comparison.md`) went through 4 rounds of Codex `gpt-5.5 effort=high` adversarial review (R1 RED through R4 RED, R5 GREEN). Each round named a cheaper counterfactual; following that pattern collapsed scope from a 14h harness build (R1) to a $0.30 5-chapter planner-only A/B (R5) — final scope ≈ 5% of original. The instrument's purpose is to let prompt-shape changes get a directional signal in minutes for cents, before committing to harness changes.

**Implementation:**
- `scripts/variant/clone-for-variant.ts` extended with `--target-phase=concept-done` flag (Slice 0a) — produces a frozen concept-snapshot novel that variants can clone from, ensuring all variants plan against identical concept state.
- `src/agents/planning-beats/index.ts` reads `PLANNING_BEATS_PROMPT_OVERRIDE` (absolute path) at module load via top-level await.
- `scripts/phase-eval/probe-planning-beats.ts` (parent): runs concept once → clones per variant → spawns child process per variant with the env var pre-set → aggregates per-variant `outlines.json` into `summary.json`. Each variant runs in its own bun subprocess to get a fresh module graph (top-level await caches forever in-process).
- `scripts/phase-eval/run-variant.ts` (child): runs planning phase only, dumps `chapter_outlines.outline_json` to disk.
- `scripts/phase-eval/print-screen-verdict.ts`: pure deps-free metric computer — reports G1-G4 (median facts/chapter, mean knowledge/chapter, mean beats/chapter, mean state-changes/chapter) with test-minus-control deltas. Charter R5 framing — directional, not compliance.

**First-run result (default vs loud, `fantasy-system-heretic` seed, 3 chapters):** ΔG1=+5 facts/chapter (median 3 → 8), ΔG3=+4.3 beats/chapter (mean 10 → 14.3), ΔG2=+1.3 knowledge transfers/chapter, ΔG4=+0.3 state changes/chapter. Strong directional signal that prompt-shape is a load-bearing planner lever even on V4 Flash thinking-mode. Sample size below charter spec (3 chapters vs 5 — used the smallest current-target-genre seed); next probe should add temperature-noise band or use a 5-chapter litrpg seed.

**Alternatives rejected:**
- **In-process variant cycling.** Top-level `await Bun.file(prompt).text()` in `planning-beats/index.ts` caches the prompt for the life of the process; in-process cycling silently applies the FIRST variant's prompt to ALL subsequent variants. Per-variant child processes are mandatory.
- **Charter R1's full harness build.** 14h scope; deferred until probe results justify the investment. R5 probe covers the immediate need at 5% of the cost.
- **Including chapter-plan-checker in the probe (R3 charter).** Required prose input; incompatible with planner-only scope. Codex R3 flagged via direct `src/agents/chapter-plan-checker/context.ts:13` cite. Dropped in R4.

**Ongoing implications:**
- The probe is the canonical first instrument for ANY planner-prompt change going forward. Spawn → measure → decide before committing to harness work.
- If probe results across multiple seeds + variants justify it, fold the env-var seam into the harness as a permanent prompt-pinning surface (e.g., `pipelineOverrides.promptOverrides[agent]`). Until then, it stays offline tooling.
- The same child-process variant runner pattern generalizes to ANY agent whose prompt is loaded via top-level await (i.e., all of them). Future probe scripts can clone the `run-variant.ts` shape per-agent.

### Schema-of-record drift caught at runtime — `thematic_tags` was dropped in sql/013
*2026-04-29 · commit `9de6a78`*

**Decision:** Slice 0a's `CONCEPT_DONE_MUST_BE_ABSENT` audit list (in `scripts/variant/clone-for-variant.ts`) included `thematic_tags`, which was created in sql/011 but DROPPED in sql/013 (`drop_themes_unify_defaults`). The first phase-eval probe run failed at the audit step with `relation "thematic_tags" does not exist`. Fix: removed `thematic_tags` from the list, added a comment citing the sql/011 CREATE + sql/013 DROP.

**Why this is recorded:** memory `feedback_schema_of_record_check` says: "Before landing code that assumes array size / enum / structural shape, grep the production schema-of-record and confirm." This session is the concrete cite — `grep -rn thematic_tags sql/` would have caught the drift in <5 seconds before commit. The rule applies to ALL constants that mirror schema state (table lists, column lists, enum values).
