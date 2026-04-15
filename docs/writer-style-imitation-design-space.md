---
status: planned
created: 2026-04-15
companion: docs/writer-imitation-benchmark.md
purpose: enumerate the full design space of methodologies for imitating an author's style, organized as composable harness layers, with cost/effort/success-probability estimates and complete "harness recipe" combinations
---

# Writer Style Imitation — Design Space

The Salvatore deconstruction benchmark (`docs/writer-imitation-benchmark.md`) gives us a measurement floor. This document maps the **full design space of methodologies** the harness can deploy against that benchmark.

The key reframe: **style imitation is not one technique. It is a stack of independent decisions across seven layers of the writing harness.** Different methodologies operate at different layers; most compose. The right answer is not "pick the best technique" — it is "pick the right combination of layer choices for the cost/quality budget you accept."

Below: each layer's options, then complete harness recipes that compose those choices, then a comparison matrix, then recommended exploration order.

---

## The seven layers of a style-imitation writing harness

```
Layer 7: Post-processing            ← polish, normalize, restructure
Layer 6: Selection                  ← pick best of N candidates
Layer 5: Model & weights            ← what generates the tokens
Layer 4: Generation process         ← single-shot vs iterative vs multi-agent
Layer 3: Generation unit            ← sentence / beat / scene / chapter
Layer 2: Style conditioning         ← primer, retrieval, adapter, persona
Layer 1: Corpus / training data     ← what the system has learned from
```

Every methodology in the literature is a configuration of these layers. Naming the layers makes the design space tractable.

---

## Layer 1 — Corpus & Training Data

What the system has learned from. Even prompt-only methodologies depend on this — the primer is a corpus subset.

| option | what it is | engineering effort | cost | when it wins |
|---|---|---|---|---|
| **Raw author corpus** | Salvatore's complete works concatenated for next-token training | days of cleanup | $0 (have ebook) | next-token SFT — fastest path, but produces pastiche bot (V4 evidence) |
| **Paired (brief → prose)** | Reverse-engineered beats matched to actual passages | 3–4 days sub-agent labor | $0 (sub-agents) | the "right" data shape for SFT — teaches *application* of voice, not just surface |
| **Synthetic style-transfer pairs** | Sonnet rewrites modern fantasy scenes in Salvatore voice | 1–2 weeks, ~$300 Sonnet API | $300–800 | massive volume scaling — pair Salvatore-deconstruction (real, ~600 pairs) with synthetic (10K pairs) |
| **Multi-author corpus** | Salvatore + Tolkien + Howard + influences | 2 weeks | $0 (public domain mostly) | when single-author overfits — broader voice anchored in lineage |
| **Author craft notes** | Salvatore interviews, writing-advice articles, his own stated principles | 1 week of curation | $0 | augments any other corpus — teaches *intentions* alongside outputs |
| **Whole-franchise corpus** | All 50+ Forgotten Realms / Drizzt books | 1 month | $50–100 in ebooks | maximum volume, risks averaging across his evolution as a writer |
| **Distilled corpus** | Sonnet writes thousands of new scenes "in the style of Salvatore" with high temperature | 1 week, ~$500 Sonnet | $500–1500 | when raw corpus is too small (~600 paired) — trades originality for scale |

**Default for Phase 0:** paired (brief → prose) from Crystal Shard. **Scale path:** add synthetic style-transfer pairs once paired baseline exists.

---

## Layer 2 — Style Conditioning

How style information enters the model at generation time. **This is where most of the design space lives.**

### 2a. Prompt-only (no weight changes)

| option | what it is | engineering effort | per-call cost | wins when |
|---|---|---|---|---|
| **Static primer** | Fixed corpus-derived exemplar block prepended to every call | done | ~$0.001 (cached) | baseline. Already deployed (Howard primer). |
| **Dynamic primer (retrieval)** | Per-scene: retrieve top-K most-similar Salvatore scenes by tag/embedding | 2–3 days | ~$0.0008 (uncached but smaller) | scene specificity matters more than cache savings |
| **Hybrid primer** | Static cached fundamentals (5K) + dynamic per-scene exemplars (2K) | 3–4 days | ~$0.0007 | best-of-both — usually beats either alone |
| **Persona prompting** | "You are R.A. Salvatore, drafting Crystal Shard chapter 12..." | 1 hr | $0 | weakest of the four — model already knows the persona, the gain is small |
| **Constraint specification** | "Target sentence-length distribution: mean 14, stdev 9. Dialogue ratio 0.18..." | 1 day | $0 | rhythm matching when surface mimicry isn't enough |
| **Style-transfer demonstrations** | Few-shot: 2–3 (modern scene → Salvatore-rewritten scene) pairs in context | 1 week to curate examples | $0 | teaches *transformation* not just imitation; expensive in tokens |
| **CoT style reasoning** | "Before writing, analyze: pace, sentence rhythm, dialogue density needed for this beat. Then write." | 1 day | +1500 tokens output | model self-corrects — sometimes works, sometimes overthinks |
| **Multi-style primer** | 3 primers in context (Salvatore + Tolkien + Howard); model interpolates | 1 week | larger primer, less cache | when single voice is too narrow |

### 2b. Weight-based (training)

| option | what it is | engineering effort | training cost | inference cost | wins when |
|---|---|---|---|---|---|
| **LoRA on raw corpus** | Next-token training, rank 16–64, ~6M tokens × 3 epochs | 3 days | $50–150 (Together / W&B) | ~base + $0.30/M serving overhead | cheap voice-shift on top of strong base |
| **LoRA on paired data** | Train on `(brief → prose)` pairs, rank 32–64 | 1 week | $100–300 | same | the SFT path that *should* work, and produces the V4 didn't |
| **Full fine-tune on small base** | Qwen3.5 9B FP8 / GPT-OSS 20B fully fine-tuned | 1 week | $200–500 | very cheap inference | small bases — ceiling concerns documented |
| **LoRA on large MoE base** | Qwen3.5 397B / Kimi K2.5 LoRA, rank 64 | 1–2 weeks | $200–500 | ~Sonnet inference cost | large enough base to plausibly beat Sonnet on voice match |
| **DPO / KTO** | After SFT, pair (good Salvatore-voiced output, bland output), train on preferences | 1 week | $200–500 | same as SFT base | sharpens style after SFT establishes capability — second-stage refinement |
| **Continued pre-training** | Train base on Salvatore + influences corpus before SFT, ~50M tokens × 1 epoch | 2 weeks | $1500–5000 | same | when LoRA isn't expressive enough — rare but possible |
| **RLHF with style reward** | Train style classifier as reward model, RL on classifier signal | 3–4 weeks | $2000–8000 | same | research-tier investment, diminishing returns vs DPO |
| **Hot-swap LoRA per scene type** | Multiple LoRAs (combat, dialogue, atmosphere, interiority); router picks at runtime | 2–3 weeks | 4× $100–300 | small overhead per swap | when single LoRA can't capture all of an author's modes |
| **Adapter mixture** | Multiple LoRAs combined at inference with learned weights per scene | 4 weeks | training + tuning | same | research-tier; usually over-engineered |

### 2c. Decoding-time control

| option | what it is | engineering effort | per-call cost | wins when |
|---|---|---|---|---|
| **Logit bias** | Boost probability of author's signature n-grams during decoding | 3–4 days | small | nudges vocabulary without retraining; subtle effect |
| **Constrained decoding** | Hard rules during generation (e.g., max sentence length 20 words 80% of time) | 1 week | small latency hit | rhythm enforcement; brittle, can break grammaticality |
| **Style-classifier reranking at sentence level** | Generate N candidates per sentence, classifier picks best | 2 weeks | N× generation cost | rare wins; usually too expensive vs whole-output Best-of-N |

---

## Layer 3 — Generation Unit

Bigger units capture more rhythm continuity but are harder to retry and more expensive per failed call.

| option | tokens out | per-novel calls (20-ch) | wins when |
|---|---|---|---|
| **Sentence** | ~30 | thousands | research-tier; never practical for full novels |
| **Beat (current)** | ~400 | ~250 | small models, retry-friendly, but fragments rhythm |
| **Scene** | ~1500 | ~80 | DeepSeek-class writers — preserves intra-scene pacing |
| **Chapter** | ~5000 | ~20 | maximum coherence; hardest to retry/repair |
| **Rolling-window scene** | scene + 2-scene previous context held in cache | ~80 | scene unit + better cross-scene continuity |
| **Two-pass: outline → expand** | first call writes scene skeleton, second expands | ~160 | quality lift via decomposition; doubles latency |

**Architectural reality on DeepSeek:** ~30s/call latency means small units are *worse*. Beat-level (250 calls × 30s) = 2 hours sequential. Scene-level (80 calls × 40s) = 50 min. **Fewer-larger calls is the DeepSeek-era default** — beat-first was a Cerebras-era optimization.

---

## Layer 4 — Generation Process

Single call vs structured multi-call pipelines.

| option | calls per scene | latency multiplier | quality lift | wins when |
|---|---|---|---|---|
| **Single-shot** | 1 | 1× | baseline | always the starting point |
| **CoT prepass** | 1 (longer) | 1.2× | small | model self-plans rhythm before writing |
| **Draft → Critic → Revise** | 3 | 3× | real (research-backed) | when single-shot loses on pref-eval but only narrowly |
| **Multi-turn refinement** | 2–4 | 2–4× | moderate | conversation-style "now make it more X" iterations |
| **Two-stage: structure → prose** | 2 | 2× | moderate | when planner-output is too sparse — expand to scene-skeleton first |
| **Multi-agent debate** | 4–6 | 4–6× | mixed | "Salvatore-voice" agent vs "modern-clarity" agent → judge picks. Research-tier. |
| **Reasoner + writer cascade** | 2 | 2–3× | moderate | DeepSeek R1 / o3 plans the scene, DeepSeek V3.2 writes — splits planning capacity from generation |
| **Sentence-by-sentence rhythm rewrite** | 30+ | 30× | small | post-hoc — moves to Layer 7 |

---

## Layer 5 — Model & Weights

Where the tokens come from. Often paired with Layer 2b (training) choices.

| model | params | $/M (in/out) | LoRA-tunable | comment |
|---|---|---|---|---|
| **DeepSeek V3.2** (current) | 685B MoE | $0.28 / $0.42, cached $0.028 | no public path | current default. Cheap, capable, prefix-cached. |
| **DeepSeek V3.1** | 685B MoE | $0.60 / $1.70 (Together) | unclear | older sibling, no advantage |
| **Sonnet 4.5** | undisclosed (likely ~500B-1T) | $3 / $15, cached $0.30 | no | gold standard for literary prose; ~10× DeepSeek |
| **Opus 4.6** | undisclosed (larger) | $15 / $75, cached $1.50 | no | best available; ~50× DeepSeek; reserve for highest-stakes |
| **Gemini 2.5 Pro** | undisclosed | $1.25 / $10, cached $0.31 | no | strong; less prose-tuned than Anthropic |
| **GPT-5** | undisclosed | $1.25 / $10, cached $0.13 | no | strong; cheapest cached input of frontier |
| **Qwen3.5 397B A17b** | 397B / 17B active | $0.60 / $3.60 (Together) | yes (r=64) | strongest tunable base; ~5× cheaper than Sonnet |
| **Kimi K2.5** | ~1T MoE / ~32B active | $0.50 / $2.80 (Together) | likely | Moonshot's writing focus; modern training |
| **GLM 5.1 FP4** | ~32B dense | $1.40 / $4.40 (Together) | yes | smaller base, prose ceiling concerns |
| **GPT-OSS 120B** | 120B MoE / ~5B active | $0.15 / $0.60 (W&B/Together) | yes | very cheap; tiny activation = prose ceiling concerns |
| **Llama 3.1 70B** | 70B dense | $0.80 / $0.80 (W&B) | yes (r=16 W&B) | older base; 3× DeepSeek inference; meh |
| **OpenPipe Qwen3-14B** | 14B dense | $0.05 / $0.22 (W&B) | yes | proven path for checker LoRAs; **proven not to do voice (V4)** |

**Hosting paths for SFT'd models:**

| host | model support | training | serving | cost characteristic |
|---|---|---|---|---|
| **W&B Inference** | catalog only (14B, 70B, 120B, 30B-A3B, 8B) | ART preview (free, temporary) | $0.05–0.80/M | best for catalog models; LoRA r≤16 |
| **Together AI** | broad catalog incl. Qwen3.5 397B, Kimi K2.5, GLM | own UI/API | catalog rates | best for tunable large MoE |
| **Fireworks** | stock models only | not for serverless LoRA | n/a | not a fit |
| **RunPod / Vast.ai** | any HF model you upload | self-managed | $0.50–2/hr GPU | flexible but ops burden, ~15× more expensive than serverless at our volume |
| **Modal serverless** | any model, custom pipelines | fully custom | per-second GPU billing | when no managed offering fits |
| **Replicate** | hosted custom model deploys | not training | per-second | rare fit for our use |
| **Local M-series Mac** | ≤30B with quantization | not training | electricity | dev/iteration only, never production |

---

## Layer 6 — Selection

Most generation produces one output. The selection layer says "produce N, pick best."

| option | N | latency | cost | wins when |
|---|---|---|---|---|
| **Single output** | 1 | 1× | 1× | always default |
| **Best-of-N + style classifier** | 3–5 | parallel = 1×, serial = N× | N× generation | classifier discriminates well — Salvatore classifier built in Phase 1c |
| **Best-of-N + Sonnet judge** | 3 | parallel | 3× generation + 1 judge | when classifier is unreliable; expensive |
| **Beam search reranking** | beam=8 | similar to N=8 | model-internal | requires generation API support; few hosts expose this |
| **Rejection sampling on features** | unbounded | high variance | high variance | hard rules ("dialogue ratio in range") fail-resample; rarely worth it |
| **Pairwise tournament** | 4 | 4× + log(4) judge | 4× + judges | research-tier; small additional gain over Best-of-3 |

---

## Layer 7 — Post-processing

Once prose exists, what transformations apply.

| option | what it does | when it wins |
|---|---|---|
| **Style-transfer pass** | Small SFT model rewrites paragraph-by-paragraph (the original tonal pass design) | when generation model lacks voice but has structure — V4 evidence: this *fails* if SFT base is too small |
| **Lexical substitution** | Replace generic words with author's signature vocabulary | adds "tells" — risk of pastiche |
| **Sentence reordering** | Local rhythm fix (e.g., move short punchy sentence before long descriptive one) | rare wins, easy to over-engineer |
| **Punctuation normalization** | Match author's em-dash/semicolon/comma habits | tiny effect, low risk |
| **Paragraph re-chunking** | Adjust paragraph-break density to author's average | structural rhythm at the visual level |
| **Lint pass (current)** | Remove cliché, hedging, emotional echo, rhythm-monotony patterns | already deployed, useful regardless |
| **Continuity / adherence rewrite** | Targeted prose-level fix when checker fires | already deployed |

---

## Composing layers into "harness recipes"

Below: complete configurations across all seven layers. Each is a coherent harness — orderable on the shelf, runnable end-to-end.

### Recipe A — **Cheap Imitation (current)**
```
L1: Howard raw corpus (existing)
L2: Static Howard primer (cached)
L3: Beat
L4: Single-shot
L5: DeepSeek V3.2
L6: Single output
L7: Lint pass
```
Cost per 20-ch novel: ~$0.05. Latency: ~60 min. **Baseline. Always run for comparison.**

### Recipe B — **Strong In-Context (no training)**
```
L1: Salvatore deconstructed corpus (Phase 0 deliverable)
L2: Hybrid primer (5K cached fundamentals + 2K dynamic per-scene retrieved)
L3: Scene
L4: Single-shot
L5: DeepSeek V3.2
L6: Single output
L7: Lint pass
```
Cost: ~$0.15 per 20-ch. Latency: ~50 min. **The "engineering frame" recipe — squeeze maximum out of DeepSeek before spending money on training.** Tested as M6 in benchmark.

### Recipe C — **Frontier Ceiling**
```
L1: Salvatore deconstructed corpus
L2: Hybrid primer
L3: Scene
L4: Draft → Sonnet critic → revise
L5: Sonnet 4.5
L6: Single output
L7: Lint pass
```
Cost: ~$15 per 20-ch. Latency: ~3 hr. **Establishes the achievable upper bound.** Tested as M10 (without critic) in benchmark; this is M10++.

### Recipe D — **SFT Specialist**
```
L1: Paired (brief → prose) Salvatore corpus + 5K synthetic pairs
L2: Static primer (smaller — model knows voice intrinsically) + LoRA adapter
L3: Scene
L4: Single-shot
L5: Qwen3.5 397B + LoRA r=64 trained on L1
L6: Single output
L7: Lint pass
```
Training cost: ~$300–800 one-time. Inference: ~$0.50 per 20-ch. Latency: ~50 min. **The specialist hypothesis — beats DeepSeek+primer if base capacity is sufficient and training data is well-shaped.**

### Recipe E — **SFT + Frontier Cascade**
```
L1: Paired Salvatore corpus
L2: Hybrid primer + LoRA adapter
L3: Scene
L4: SFT specialist drafts → Sonnet polishes if classifier score below threshold
L5: Qwen3.5 397B SFT'd as drafter, Sonnet 4.5 as conditional polisher
L6: Single output (selection happens via classifier gating)
L7: Lint pass
```
Cost: ~$2 per 20-ch (most beats stay on cheap model, ~20% escalate). **Cost-optimal upper bound — commercial path if SFT specialist proves out.**

### Recipe F — **DPO Voice Sharpening**
```
L1: Paired corpus + Sonnet-generated style preferences (good vs bland pairs)
L2: Adapter from SFT + DPO
L3: Scene
L4: Single-shot
L5: Qwen3.5 397B + LoRA + DPO-refined adapter
L6: Single output
L7: Lint pass
```
Training: ~$500–1500 one-time. Inference: same as Recipe D. **When SFT alone plateaus — DPO is the second-stage move.** Worth running only if D wins benchmark and we want to push further.

### Recipe G — **Hot-Swap LoRA Routing**
```
L1: Paired corpus partitioned by scene type (combat / dialogue / interiority / atmosphere)
L2: Per-type LoRA adapter, hot-swapped at inference
L3: Scene
L4: Single-shot
L5: Qwen3.5 397B + 4 LoRA adapters + scene classifier router
L6: Single output
L7: Lint pass
```
Training: 4× ~$300 = ~$1200 one-time. Inference: same as Recipe D + small swap latency. **Solves the "single LoRA can't capture all author modes" problem.** Higher engineering complexity.

### Recipe H — **Continued Pretrain + SFT**
```
L1: Salvatore complete works (~50 books) + Tolkien + Howard influences = ~50M tokens
L2: Continued-pretrained adapter + paired-data SFT on top + static primer
L3: Scene
L4: Single-shot
L5: Custom-trained model on Qwen3.5 397B
L6: Single output
L7: Lint pass
```
Training: ~$2K continued pretrain + ~$300 SFT = ~$2300 one-time. Inference: ~$0.50 per 20-ch. **Maximum-effort specialization.** Justifies itself only if D/F/G all fall short of Sonnet (M10).

### Recipe I — **Best-of-N with Style Classifier**
```
L1: Salvatore deconstructed corpus
L2: Hybrid primer
L3: Scene
L4: Single-shot, parallel N=3
L5: DeepSeek V3.2
L6: Best-of-3 selected by Salvatore-style classifier
L7: Lint pass
```
Cost: ~$0.45 per 20-ch (3× Recipe B). Latency: ~50 min (parallel). **Cheap quality lift on top of B if classifier discriminates well.** Easy win if the gap to frontier is small.

### Recipe J — **Multi-Author Lineage**
```
L1: Salvatore (60%) + Tolkien (20%) + Howard (10%) + Le Guin (10%) — paired and raw
L2: Mixed-corpus primer (rotating selection per scene) + LoRA trained on full mix
L3: Scene
L4: Single-shot
L5: Qwen3.5 397B + LoRA
L6: Single output
L7: Lint pass
```
Training: ~$500 one-time. Inference: same as D. **When pure-Salvatore overfits to pulp tropes — broader voice anchored in fantasy lineage.** Useful insurance if A/B/C/D show genre lock-in.

---

## Comparison matrix

| Recipe | engineering effort | training spend | inference / 20-ch | latency / 20-ch | expected quality vs Sonnet | risk profile |
|---|---|---|---|---|---|---|
| A. Cheap (current) | done | $0 | $0.05 | 60 min | ~60% pref-eval | low — proven |
| B. Strong in-context | 1 week | $0 | $0.15 | 50 min | ~70–80% pref-eval | low — pure prompt engineering |
| C. Frontier + critic | 1 week | $0 | $15 | 3 hr | ~95% pref-eval | low — Sonnet known good |
| D. SFT specialist | 2 weeks | $500 | $0.50 | 50 min | unknown — could be 60% or 95% | medium — depends on training data quality |
| E. Cascade | 3 weeks | $500 | $2 | 1 hr | ~90% pref-eval | medium — gating threshold tuning |
| F. DPO | +1 week on D | +$500 | $0.50 | 50 min | D + 5–10% | medium — diminishing returns |
| G. Hot-swap LoRA | 4 weeks | $1500 | $0.50 | 50 min | unknown — could be best | high — ops complexity, classifier failures cascade |
| H. Continued pretrain | 6 weeks | $2500 | $0.50 | 50 min | unknown | high — most expensive bet, gates on D failing |
| I. Best-of-N | 3 days on B | $0 | $0.45 | 50 min | B + 5–15% | low — easy lift |
| J. Multi-author | 2 weeks | $500 | $0.50 | 50 min | unknown | medium — voice could blur |

**Key reads:**
- **A and B are the floor.** No serious harness operates without these baselines.
- **C is the ceiling oracle.** Always run to know how much room you have.
- **D is the central question.** Until D's number is known, all higher recipes are speculation.
- **E unlocks the commercial path** if D works — cheap + frontier-quality.
- **F/G/H are second-order investments** — only justified by D underperforming or by needing finer control.
- **I is free money** if benchmark shows the classifier discriminates well — almost always run on top of B.

---

## Recommended exploration order

**Stage 0 — Capability vs tuning POC (this week, ~$7):**
Before committing to any full Stage 1+ run, answer the strategic question: does real fine-tuning meaningfully close the gap, or is base-model capability the dominant lever? A 2×2 micro-benchmark on 3 training chapters + 2 eval chapters of Crystal Shard tests Qwen3-14B (untuned/tuned) × DeepSeek-or-Llama-70B (untuned/tuned). Full setup in `docs/writer-imitation-benchmark.md` "Phase 0-POC." Outcome determines whether SFT-heavy recipes (D, E, F, H) or capability-heavy recipes (B, C, I) deserve budget first.

**Stage 1 — Establish floor and ceiling (this month, ~$80):**
1. Phase 0 of `writer-imitation-benchmark.md` (Salvatore deconstruction, full book) — required input for everything else
2. Run Recipes A, B, C against the benchmark
3. **Decide:** is the gap between B and C large enough to justify spending money on training? If C beats B by less than ~10% pref-eval, ship B and stop here.

**Stage 2 — SFT specialist (if Stage 1 says go, ~3 weeks, ~$500):**
1. Recipe D — SFT Qwen3.5 397B on the paired corpus from Phase 0
2. Run against benchmark, compare to A/B/C
3. **Decide:** if D ≥ B, ship D. If D ≥ C, ship D and skip Sonnet entirely. If D < B, training failed — diagnose corpus or move to H.

**Stage 3 — Selection layer lift (parallel to Stage 2, ~3 days, $0):**
1. Recipe I — Best-of-N on whichever of A/B/D is leading
2. Almost always a free quality lift; cost is just inference

**Stage 4 — Cascade or DPO (if D wins narrowly, ~1–4 weeks, ~$500–1500):**
1. Recipe E if cost is the main concern (cascade keeps D cheap, escalates hard beats)
2. Recipe F if quality is the main concern (DPO sharpens D's voice)

**Stage 5 — Specialization (only if D plateaus, ~$1500–2500):**
1. Recipe G (per-scene-type LoRAs) if D's failures cluster by scene type
2. Recipe H (continued pretrain) if D plateaus and G doesn't help

**Stage 6 — Multi-author hedge (if mono-author overfits, ~2 weeks, ~$500):**
1. Recipe J — broader lineage corpus

**Total exploration budget if every stage runs: ~3 months, ~$5K.** Most stages gate on prior results, so realistic spend is much lower.

---

## What this design space tells you about strategy

1. **Layer 2 (style conditioning) has the most options and the highest leverage.** It's where 80% of the design space lives. Iterate fast at this layer before reaching for Layer 5 (model swaps) or Layer 1 (training).

2. **The benchmark is the gate.** Without `docs/writer-imitation-benchmark.md` Phase 0–1 deliverables in place, every recipe above is guesswork. Build the measurement layer first, always.

3. **DeepSeek + Layer 2 engineering may already be enough.** Recipes B and I (no training, no model swap, just better primer + Best-of-N) are ~$0 to engineer beyond the benchmark itself. If they win, the rest is wasted spend. Don't skip them.

4. **SFT is one bet among many, not the default.** The voice-imitation literature treats SFT as obvious; the cost analysis says it's only obvious when the base model lacks the capacity (sub-30B). On a 397B MoE base with paired data, SFT *should* work — but B might already work, in which case SFT buys nothing.

5. **Hosting choice cascades from Layer 5.** Together for SFT'd large MoE. W&B for catalog SFT. RunPod only when neither serverless offering fits. Self-hosting is operational debt, not a feature.

6. **Cascade (Recipe E) is the answer to most "but what about cost" objections.** Cheap model drafts, frontier polishes hard cases. Almost always Pareto-dominates either-extreme on the cost/quality plane.

7. **Post-processing (Layer 7) is the cheapest layer to add and the shallowest.** Lint pass already deployed. Most other Layer 7 options buy little. Don't over-invest here.

---

## Open architectural questions surfaced by this exploration

1. **Do we want a single specialist or a roster?** Recipe G (hot-swap LoRA) and Recipe J (multi-author) suggest "many small adapters" might out-perform "one large adapter." Worth probing once D runs.

2. **Where does the planner fit in this picture?** Every recipe assumes the planner outputs adequate beats. If even Recipe C fails, the planner is the gap — not the writer. The benchmark catches this.

3. **What's the right training-data unit?** Paired (brief → prose) is the best-shape proven hypothesis, but `(scene + previous-scene + character-state) → prose` is the harness's actual call shape. Train on call-shape data, not idealized data.

4. **How often will we re-run the benchmark?** Once per major model swap, primer change, or adapter version. The harness should make benchmark runs cheap (script + cron + dashboard) so they happen routinely.

5. **What's the second target novel?** Single-author overfit is real. Sanderson? Lynch? Sapkowski? Pick before Stage 2 to avoid retrofitting.

---

## Related artifacts

- `docs/writer-imitation-benchmark.md` — measurement layer (Phase 0–2). Required input for any recipe above.
- `docs/decisions.md` "Writer Model" — exp #189/#190 history; baseline data for Recipe A
- `docs/lessons-learned.md` — V4 voice-SFT failure post-mortem (informs Recipe D risk profile)
- `docs/lora-style-transfer-report.md` — prior LoRA training details
- `src/agents/writer/style-primer-howard.md` — current static primer (Recipe A's L2)
- `scripts/lora-data/howard-training.jsonl` — current corpus (Recipe A's L1)

---

## Next concrete action

Same as `docs/writer-imitation-benchmark.md`: confirm target novel and ebook source. Phase 0 of the benchmark unlocks every recipe in this document.
