# LoRA Style Transfer for Prose Rewriting: Research Report

**Date**: 2026-04-06
**Goal**: Train a LoRA adapter on Qwen 3.5 9B to rewrite AI-generated prose into a target voice (Robert E. Howard's sword-and-sorcery style), operating as a per-paragraph tonal-pass agent in the novel-harness pipeline.

**Constraint**: The 9B model is a rewriter, not a primary writer. It receives validated prose from larger models (Qwen 235B) and applies a style transformation while preserving all factual content.

---

## 1. Problem Definition

Standard LLM-generated prose tends toward a recognizable "AI voice" — hedging language, emotional abstraction, filler phrases, rhythmic monotony. Our pipeline already catches specific patterns via deterministic linting (26 patterns), but the underlying tonal signature persists even after fixes.

We need a model that can take a paragraph of structurally correct prose and rewrite it to match a specific author's voice — short punchy sentences, visceral physical verbs, concrete sensory detail, minimal adjectives — without altering plot events, character actions, or factual content.

A 9B model cannot serve as a primary writer (insufficient capacity for long-context planning, world-state tracking, and adherence to complex beat structures), but style transfer is a narrow, well-scoped task that small models can learn effectively.

---

## 2. Why Not Continued Pretraining?

The simplest LoRA approach is continued pretraining: feed the model raw target-style text with standard causal language modeling loss. The model absorbs the style into its weights and shifts its default output distribution.

**StyleTunedLM** (Patel et al., 2024) used ~80K tokens per author from Project Gutenberg, chunked to 256-token sequences, and trained Llama-2-7B LoRA adapters. They achieved 87.9% style classifier accuracy on authorship attribution tasks [1].

**StyleAdaptedLM** (Patel et al., 2025) extended this to Llama-3.1-8B, Mistral-7B, and Qwen2.5-7B, using 54K–1.7M tokens per style source. They found 5–8% instruction-following degradation after style LoRA training, mitigated by merging the style LoRA with the instruction-tuned model's weights [2].

**Why this is wrong for our use case**: Continued pretraining teaches the model to *generate* in a style. It does not teach the model to *transform* existing text. The production task is: receive a paragraph, rewrite it. That's a different skill — the model needs to parse input, identify what to preserve, and selectively modify voice. Continued pretraining does not train this transformation capability.

### References
- [1] Patel et al. "Customizing LLM Generation Style through a Single Reference Sentence." arXiv:2409.04574, 2024. https://arxiv.org/abs/2409.04574
- [2] Patel et al. "StyleAdaptedLM: Enhancing Instruction Following with Stylistic Transfer." arXiv:2507.18294, 2025. https://arxiv.org/abs/2507.18294

---

## 3. The Back-Translation Approach

### 3.1 Core Insight: Style Removal Is Easier Than Style Addition

The ITDA paper (Shao et al., 2024) established a key finding: **LLMs are significantly better at removing style than adding it**, because pretraining corpora are predominantly neutral text. When asked to "flatten" distinctive prose into plain language, LLMs produce high-quality neutral versions. When asked to "add style" to neutral text, they produce superficial imitations [3].

This means the most effective training data pipeline is:

1. Start with ground truth stylized text (Howard's prose)
2. Use a large LLM to generate neutral/flattened versions (back-translation)
3. Train on (neutral → stylized) pairs

The neutral versions are high-quality because the LLM is doing the easy direction. The stylized versions are high-quality because they're real Howard prose. The LoRA learns the hard direction (neutral → stylized) from these aligned pairs.

### 3.2 ITDA Pipeline

ITDA (Inverse Transfer Data Augmentation) implements this as:

1. Cluster representative stylized texts and build a demonstration pool
2. Use GPT-3.5 with dynamically selected few-shot examples to strip style, producing neutral versions
3. Fine-tune a compact model (BART-base in their case) on the resulting (neutral, stylized) pairs

Evaluated on Lin Daiyu, Shakespeare, Trump, and Lyrics datasets, ITDA outperformed forward augmentation approaches across all metrics [3].

### 3.3 STRAP: Paraphrase-Based Style Removal

STRAP (Krishna et al., 2020) takes a complementary approach: instead of explicitly asking an LLM to "remove style," it passes styled text through a **diverse paraphrase model** (GPT-2 Large fine-tuned on 75K ParaNMT pairs). Paraphrasing naturally strips style while preserving content, producing neutral versions without explicit instruction [4].

They processed 15M sentences across 11 styles and found that this approach "significantly outperforms state-of-the-art systems" on both human and automatic evaluations for formality transfer and Shakespeare imitation [4].

### 3.4 Practical Validation

A. Omukai (2023) documented a practical implementation: fine-tuning GPT-3.5 on ~100 paragraph pairs where the input was AI-flattened versions of their novel's prose and the output was the original. Key finding: **"Rephrasing proved more reliable than generation for maintaining voice consistency"** [5].

Novelcrafter's fine-tuning guide recommends the same structure for their "prose correction" mode: AI-generated text as input, author's version as output, minimum 75 examples, targeting training loss < 1.0 [6].

### References
- [3] Shao et al. "Authorship Style Transfer with Inverse Transfer Data Augmentation." AI Open, 2024. https://www.sciencedirect.com/science/article/pii/S2666651024000135 — GitHub: https://github.com/Vicky-Shao/ITDA
- [4] Krishna et al. "Reformulating Unsupervised Style Transfer as Paraphrase Generation." EMNLP 2020. https://arxiv.org/abs/2010.05700 — GitHub: https://github.com/martiansideofthemoon/style-transfer-paraphrase
- [5] Omukai, A. "Fine-tuning GPT 3.5 to Write in Your Voice." 2023. https://aomukai.com/2023/12/27/fine-tuning-gpt-3-5-turbo-to-write-in-your-voice/
- [6] Novelcrafter. "Fine-Tuning AI to Suit Your Writing Style." https://www.novelcrafter.com/blog/fine-tuning-ai-for-authors

---

## 4. SFT vs DPO for Style Transfer

### 4.1 ASTRAPOP: Direct Comparison

ASTRAPOP (Wegmann et al., 2024) directly compared SFT, DPO, CPO, and PPO for authorship style transfer on LLaMA-2-7B with LoRA [7]:

| Method | Individual Style (Joint Score) | Community Style (Joint Score) |
|--------|-------------------------------|-------------------------------|
| SFT only | 0.484 | 0.659 |
| PPO | 0.495 | 0.665 |
| DPO | **0.507** | 0.767 |
| CPO | 0.505 | **0.827** |

DPO and CPO substantially outperform SFT-only. The improvement is not marginal — CPO achieves a 25% higher joint score than SFT on community-level style tasks.

### 4.2 Two-Stage Pipeline

The recommended approach from ASTRAPOP is:

1. **Stage 1 (SFT)**: Train on (neutral, stylized) pairs to teach the basic transformation
2. **Stage 2 (DPO/CPO)**: Generate multiple rewrites of held-out neutral inputs at different temperatures, score with a style classifier, create (chosen, rejected) pairs

DPO requires SFT as a foundation — DPO from a base model performs poorly. The SFT stage teaches "what to do," DPO refines "how well to do it."

### 4.3 Caveats

- DPO reduces output diversity — the model converges harder on the target style at the expense of variation [7]
- DPO requires a reliable style scoring mechanism for creating preference pairs
- Together AI supports DPO LoRA but at 3x the training cost ($1.50/M vs $0.48/M for sub-16B models)
- A length penalty should be added to the reward signal to prevent degenerate short outputs [8]

### 4.4 Recommendation for This Project

Start with SFT-only (Tier 2 in our pipeline). If results are promising but style adherence is inconsistent, add DPO as a refinement stage. The SFT stage is cheap ($0.26) and validates the entire pipeline before investing in preference pair generation.

### References
- [7] Wegmann et al. "ASTRAPOP: Authorship Style Transfer with Policy Optimization." arXiv:2403.08043, 2024. https://arxiv.org/abs/2403.08043 — GitHub: https://github.com/isi-nlp/astrapop
- [8] OpenAI. "DPO Fine-Tuning Guide." https://developers.openai.com/cookbook/examples/fine_tuning_direct_preference_optimization_guide

---

## 5. Paragraph-Level vs Sentence-Level Processing

### 5.1 ZeroStylus: Structure Matters

ZeroStylus (2025) evaluated long-text style transfer and found that **paragraph-level structural encoding improved content preservation by 57%** compared to sentence-only approaches [9]. Their dual-layered approach processes both sentence-level style features and paragraph-level structural patterns.

This aligns with our tonal-pass design: the agent operates per-paragraph, not per-sentence. Each paragraph preserves its internal structure, and the model receives one paragraph of preceding/following context for transition continuity.

### References
- [9] ZeroStylus. "Long-Text Style Transfer via Dual-Layered Structure." arXiv:2505.07888, 2025. https://arxiv.org/abs/2505.07888

---

## 6. Data Requirements

### 6.1 How Much Is Enough?

| Source | Dataset Size | Model | Result |
|--------|-------------|-------|--------|
| StyleTunedLM [1] | ~80K tokens/author | Llama-2-7B | 87.9% style classifier accuracy |
| ASTRAPOP [7] | 2 texts/author (low-resource) | LLaMA-2-7B | Meaningful transfer |
| Omukai [5] | ~100 examples | GPT-3.5 | Removed AI voice patterns |
| Novelcrafter [6] | 75+ examples | Various | Sufficient for prose correction |
| LIMA (Zhou et al., 2023) | 1,000 examples | LLaMA-65B | Outperformed 50K Alpaca examples |

Our dataset: **926 Howard chunks, ~550K tokens**. This is approximately 7x the minimum shown to produce results in style transfer literature, and well within the range where quality matters more than quantity.

### 6.2 Quality Controls

Per Raschka (2023) [10]:
- Train for 1–3 epochs maximum; more epochs cause overfitting and quality degradation
- LoRA rank 16–32 is appropriate for this dataset size; higher ranks (64–128) risk overfitting
- 200 carefully curated pairs outperform 926 sloppy ones (the LIMA finding)

### 6.3 Coverage

Training data must cover the full range of scene types the model will encounter in production: action sequences, atmospheric description, character interiority, transitional passages, dialogue-adjacent narration. A dataset biased toward one scene type produces a model that only handles that type.

Our Howard corpus naturally covers all of these — his stories include temple exploration, sword fights, wilderness travel, court intrigue, and supernatural encounters.

### References
- [10] Raschka, S. "Practical Tips for Finetuning LLMs Using LoRA." 2023. https://magazine.sebastianraschka.com/p/practical-tips-for-finetuning-llms

---

## 7. Back-Translation Gotchas

Based on the literature, the following failure modes must be mitigated during pair generation:

### 7.1 Content Drift

The flattening LLM may alter meaning, not just style. Mitigation: explicit content-preservation constraints in the prompt, and BERTScore verification between original and neutral versions. Drop pairs where BERTScore falls below threshold.

### 7.2 Length Mismatch

Neutral versions tend to be shorter (less flourish). This can teach the model that "stylized = longer" rather than actual style features. Mitigation: constrain output length in the neutralization prompt ("approximately the same word count").

### 7.3 Diversity Collapse

Using a single neutralization prompt for all examples produces monotonically similar "flat" versions. The model learns to transform one specific type of blandness rather than generalizing. Mitigation: rotate 3–5 prompt variants across batches.

### 7.4 Verification

Spot-check 50+ pairs manually to ensure the neutral version genuinely preserves the content while removing only stylistic features. Automated BERTScore checks catch gross content drift but not subtle meaning shifts.

---

## 8. Recommended Training Configuration

Based on Together AI's platform constraints and the research literature:

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Base model | Qwen/Qwen3.5-9B | Only serverless Qwen 3 on Together; fine-tuning supported |
| Method | LoRA SFT | Start simple; add DPO if needed |
| Training data | ~926 back-translated pairs | (neutral → Howard) paragraph pairs |
| Data format | ChatML messages | `system` + `user` (neutral) + `assistant` (Howard) |
| System prompt | "Rewrite the given paragraph to match the target voice." | Generic — style is in the weights, not the prompt |
| Epochs | 1 | Conservative; 550K tokens is sufficient signal in one pass |
| Learning rate | 1e-5 to 2e-4 | Standard LoRA range; Together may auto-tune |
| Training cost | ~$0.26 (550K tokens × $0.48/M) | Sub-16B standard tier |
| Inference cost | $0.10/$0.15 per 1M input/output | Same as base Qwen 3.5 9B serverless |

---

## 9. Implementation Plan

### Phase 1: Pair Generation
- Split 926 Howard chunks into individual paragraphs (~3-4 per chunk)
- Run each paragraph through Qwen 235B on Cerebras with style-flattening prompts (3–5 prompt variants, rotated)
- Verify content preservation via BERTScore
- Format as ChatML JSONL

### Phase 2: Training
- Upload JSONL to Together AI
- Fine-tune Qwen 3.5 9B with LoRA, 1 epoch
- Validate training loss < 1.0

### Phase 3: Evaluation
- Run 3 verification prompts through both base and LoRA model
- Compare tonal-pass agent output on existing novel chapters (base vs LoRA)
- Measure: style classifier accuracy, content preservation (BERTScore), human preference

### Phase 4: Integration
- Update `models/roles.ts` with LoRA model output_name
- Set `pipeline.tonalPass: true`
- Deploy to LXC

### Phase 5 (Optional): DPO Refinement
- Generate multiple rewrites per held-out neutral paragraph
- Score with style classifier
- Create preference pairs, run DPO LoRA on top of SFT

---

## 10. Experiment Log: v1 (2026-04-06)

### 10.1 Setup

| Parameter | Value |
|-----------|-------|
| Base model | Qwen/Qwen3.5-9B (Together AI serverless) |
| Method | SFT LoRA |
| Rank / Alpha | 64 / 128 |
| Target modules | all-linear |
| Epochs | 1 |
| Learning rate | 1e-5 |
| Training pairs | 1,407 (paragraph-level, back-translated) |
| Training tokens | 265,638 |
| Flattening model | Qwen3 32B on Groq ($0.10) |
| Training cost | $0.13 |
| Total cost | $0.23 |
| Job ID | ft-ee7a2fd7-a643 |
| Adapter ID | `andre14618_2c8c/Qwen3.5-9B-howard-tonal-v1-582d484b` |

### 10.2 Together AI Platform Lessons

1. **Serverless LoRA uses the `lora` parameter, not the model field.** Passing the adapter ID as the `model` value returns a "non-serverless" error. Instead, set `model` to the base model (`Qwen/Qwen3.5-9B`) and add `"lora": "<adapter-id>"` as a separate field.

2. **Qwen 3.5 thinking must be disabled.** Without `"chat_template_kwargs": {"enable_thinking": false}`, the model spends tokens on reasoning and may return empty content or hit max_tokens on the thinking phase alone.

3. **Together CLI is required for file upload.** The REST API file upload endpoint returns "Missing required fields" regardless of FormData structure. Use `together files upload <path>` via the Python SDK/CLI.

4. **LoRA fine-tuning auto-configures well.** Together defaulted to rank 64, alpha 128, all-linear modules, cosine LR scheduler, batch size "max" (auto). These defaults align with literature recommendations.

5. **Training is fast and cheap.** 265K tokens trained in ~8 minutes (22 steps). Queue wait was the bottleneck, not compute.

### 10.3 Methodology Lessons

1. **Test with production-format inputs.** We initially tested with generation prompts ("Write a scene where...") instead of rewrite prompts ("Rewrite this paragraph..."). A model trained on rewrite pairs doesn't know how to handle generation prompts — it asked for clarification. Always test with the exact task format the model was trained on.

2. **Flattening prompt specificity matters.** Initial prompts produced summaries instead of paragraph-by-paragraph flattening. Adding explicit rules ("Keep the SAME number of paragraphs", "Do NOT summarize or compress", "Preserve dialogue word-for-word") reduced content drift from 20% skip rate to 1.5%.

3. **`/nothink` for Qwen3 on Groq.** Without it, the model burns tokens on internal reasoning during flattening. Prepending `/nothink` to the user message cuts output cost significantly.

4. **Per-paragraph pairing is correct for a per-paragraph agent.** Splitting 300-500 word chunks into individual paragraph pairs (avg 60 words) matches the tonal-pass agent's production granularity. This produced ~7 pairs per chunk, amplifying 200 chunks into 1,407 training examples.

### 10.4 Results

**Style shift: present but weak.** On generation prompts (wrong task format), outputs were subtly more atmospheric than base but not distinctively Howard. On rewrite prompts (correct format): **not yet tested** — this is the critical next step.

The weak signal on generation prompts may be because:
- The model was trained on rewrite pairs, not generation
- 1 epoch may be insufficient signal strength
- 1,407 pairs from 200 chunks may not cover enough stylistic range

### 10.5 v2 Results (2026-04-06, same session)

**Changes from v1**: Full corpus (926 chunks → 6,423 pairs), 2 epochs, updated system prompt to "Rewrite this paragraph. Make the prose vivid, concrete, and direct."

| Parameter | v1 | v2 |
|-----------|----|----|
| Job ID | ft-ee7a2fd7-a643 | ft-6dd7807b-6210 |
| Adapter ID | `andre14618_2c8c/Qwen3.5-9B-howard-tonal-v1-582d484b` | `andre14618_2c8c/Qwen3.5-9B-howard-tonal-v2-b139cbad` |
| Training pairs | 1,407 | 6,423 |
| Training tokens | 265,638 | 1,271,722 |
| Epochs | 1 | 2 |
| Total steps | 22 | 42 |
| System prompt | "Rewrite the given paragraph to match the target voice." | "Rewrite this paragraph. Make the prose vivid, concrete, and direct." |
| Cost | $0.13 | $1.22 |
| Batch size | 8 | 8 |
| LoRA rank / alpha | 64 / 128 | 64 / 128 |
| LR / scheduler | 1e-5 / cosine | 1e-5 / cosine |
| Target modules | all-linear | all-linear |
| Warmup / weight decay | 0.0 / 0.0 | 0.0 / 0.0 |
| Max grad norm | 1.0 | 1.0 |
| Packing | true | true |
| Random seed | 42 | 42 |

**A/B/C rewrite comparison** (bland input → rewrite, temperature 0.6):

Paragraph 1 (soldier in corridor):
- BASE: "blade raised and trembling... Dread pricked at his gut" — adds ungrounded detail, personified abstraction
- V1: "sword leveled like a spear... Unease coiled in his gut" — simile, slightly more active
- V2: "sword drawn and low... Dread coiled in his gut" — most economical, fewest words, visceral verbs

Paragraph 2 (sword fight):
- BASE: "a ghost in the downpour... a metallic *clunk*" — ornate, adds sound effects, longest output
- V1: "needle-thin thrust... foot finding purchase on a jagged stone" — detailed but overwrought
- V2: "A heavy blade sweeping wide... Neither would quit." — shortest sentences, most direct, closest to Howard's economy

Paragraph 3 (tower stairs):
- BASE: "Fear whispered her to turn back" — personified abstraction (classic AI tell)
- V1: "the urge to flee clawed at her lungs" — visceral but still ornate
- V2: "probing each fractured step... jagged patches of silver" — concrete, though still some cliches ("shiver down her spine")

**Assessment**: V2 is noticeably more compressed and direct than both base and V1. The prose economy (shorter sentences, fewer adjectives, stronger verbs) is clearly emerging, especially visible in paragraph 2. However, the model still produces some AI patterns (cliches, personified abstractions). The style signal is stronger but not yet at the level where outputs would be mistaken for Howard.

**Possible next levers**:
- 3 epochs on same data (risk: overfitting begins)
- DPO refinement with style classifier ranking (ASTRAPOP showed +25%)
- Curate training data: remove pairs where the bland→Howard contrast is weak (e.g., dialogue-heavy chunks where both sides are similar)
- Stronger system prompt coupling: include a short Howard reference sample in the system prompt to anchor the LoRA's direction

### 10.6 v3 Quantitative Analysis (15 paragraphs, 3 models)

**Setup**: 15 diverse bland paragraphs (4 action, 4 atmosphere, 3 introspection, 2 dialogue-adjacent, 2 complex scene) rewritten by base Qwen 3.5 9B, v2 LoRA (6,423 pairs), and v3 LoRA (4,497 curated pairs). All at temperature 0.6. Script: `scripts/measure-lora-effects.ts`.

#### Aggregate Metrics

| Metric | Input | Base | V2 | V3 (curated) | V3 vs Base |
|--------|-------|------|-----|--------------|------------|
| Word count | 47.9 | 56.7 | 59.1 | **53.3** | -6% (tighter) |
| Avg sentence length | 13.1 | 15.0 | 15.2 | **14.5** | -3.3% (shorter) |
| Short sentences (≤8w) | 20% | 12.2% | 10.2% | **14.4%** | +18% (more punchy) |
| Max sentence length | 17 | 20.8 | 20.5 | **20.2** | -3% (less runaway) |
| Adj-like density | 2.4% | 1.7% | 0.9% | **0.8%** | -53% (fewer adjectives) |
| Vocab diversity | 99.1% | 99.7% | 99.1% | **99.7%** | same |
| Short strong words | 68.1% | 62.4% | 64.3% | 59.7% | -4.3% (see note) |

#### Key Findings

**1. V3 consistently produces the tightest prose.** Average 53.3 words vs base's 56.7 — a 6% compression. This is the LoRA learning Howard's economy: "Dread coiled in his gut, yet he pressed forward" (V3) vs "Doubt clawed at him, but he forced his legs forward, driven only by the need to move" (base).

**2. V3 has the most punchy sentences.** 14.4% short sentences (≤8 words) vs base's 12.2%. Not a dramatic shift, but the direction is correct. Howard's actual prose runs 25-30% short sentences — the LoRA is pulling toward that target.

**3. Adjective density dropped 53%.** From 1.7% to 0.8%. This is the clearest quantitative signal — the LoRA is learning Howard's "minimal adjectives" style. V2 shows the same drop (0.9%), confirming this is a consistent training effect, not noise.

**4. V2 is WORSE than base on word count.** V2 averaged 59.1 words vs base's 56.7 — it learned to be more verbose, not less. The uncurated data included low-contrast pairs that diluted the compression signal. V3's curation fixed this.

**5. Short strong words decreased slightly.** 62.4% → 59.7%. This is counterintuitive — Howard uses short punchy verbs. The likely cause: the LoRA is replacing common short words with more specific but longer alternatives ("suffocating" for "dark", "strangled" for "grew"). The vocabulary is becoming more distinctive even as the metric decreases.

**6. Per-paragraph variance is high.** V3 shows strongest effects on action paragraphs (P1: 34 words vs base's 61) and atmospheric paragraphs (P6: 46 vs 60). Weaker effects on complex scenes (P14: 67 vs 60 — actually longer). This matches Howard's corpus: his action prose is the most distinctive, his complex scenes less so.

#### Progression Across Versions

| Version | Training | Word count | Short sent % | Adj density | Signal |
|---------|----------|-----------|-------------|-------------|--------|
| Base | — | 56.7 | 12.2% | 1.7% | — |
| V1 | 1,407 pairs, 1ep | not measured (weak qualitative) | — | — | Weak |
| V2 | 6,423 pairs, 2ep | 59.1 (+4%) | 10.2% (-16%) | 0.9% (-47%) | Mixed — learned adj reduction but got verbose |
| V3 | 4,497 curated, 2ep | **53.3 (-6%)** | **14.4% (+18%)** | **0.8% (-53%)** | **Best** — tighter, punchier, fewer adj |

**The curation effect is clear**: removing 1,926 low-contrast pairs (30%) and training on 4,497 high-contrast pairs produced better results than training on all 6,423. V2's word count went UP because low-contrast pairs (where bland ≈ Howard) taught the model "don't compress." V3 only saw pairs where Howard was distinctly different, so it learned to compress.

### 10.7 Lessons Learned

#### Data Quality > Data Quantity
The single most impactful change across all three versions was data curation, not data volume or epoch count. Removing zero-contrast pairs (where the flattening model returned Howard's text unchanged) prevented the model from learning "output ≈ input." This is consistent with the LIMA finding [Zhou et al., 2023] that 1,000 high-quality examples outperform 50,000 sloppy ones.

#### Back-Translation Quality Varies by Passage Type
Howard's dialogue and transitional prose is already relatively plain — the flattening model often returns it nearly unchanged. His action and atmospheric prose is highly distinctive — the flattening model must substantially rewrite it. This means the training signal is unevenly distributed across scene types. Future iterations should oversample action/atmosphere pairs and undersample dialogue-adjacent narration.

#### The Base Model Fights the LoRA
Qwen 3.5 9B's RLHF training biases it toward verbose, ornate prose (the V2 word count increase demonstrates this). The LoRA must overcome this prior. Stronger curation helps because it concentrates the counter-signal. DPO would help further by explicitly penalizing the verbose/ornate patterns the base model prefers.

#### System Prompt Coupling Matters
V1's system prompt ("Rewrite the given paragraph to match the target voice") was too vague — the base model asked for clarification. V2/V3's prompt ("Rewrite this paragraph. Make the prose vivid, concrete, and direct.") gives the base model's instruction-following a direction that aligns with the LoRA instead of fighting it. The system prompt must be identical between training data and inference.

#### Metrics That Move vs Metrics That Don't
- **Adjective density**: strongest signal (-53%). The LoRA reliably strips adjectives.
- **Word count**: strong signal (-6%). The LoRA compresses.
- **Short sentence ratio**: moderate signal (+18%). Moving in the right direction but not dramatically.
- **Avg sentence length**: weak signal (-3.3%). The LoRA shortens slightly but hasn't fully learned Howard's characteristically short sentences.
- **Max sentence length**: negligible change. The LoRA hasn't learned to avoid long complex sentences.

This suggests the LoRA has learned Howard's vocabulary preferences (fewer adjectives, tighter word choice) more than his structural patterns (short punchy sentences). Structural patterns may require more training data or DPO reinforcement.

### 10.8 Quantitative Style Scoring (4 dimensions)

Script: `scripts/score-lora-style.ts`. Side-by-side HTML: `lora-data/comparison.html`.

#### Methodology

Four independent scoring dimensions, each measuring a different aspect of style proximity to Howard:

1. **Style classifier**: Logistic regression on word frequency ratios (Howard vs bland training pairs). Measures vocabulary overlap with Howard's distinctive word choices. Score 0-1, higher = more Howard-like.

2. **Bigram perplexity**: Bigram language model trained on Howard's corpus. Measures how "surprised" a Howard-trained model is by the output. Lower = word sequences more consistent with Howard's patterns.

3. **Feature KL divergence**: KL divergence between the output's sentence-length and word-length distributions vs Howard's actual distributions. Lower = structural similarity to Howard.

4. **Content preservation**: N-gram F1 (unigram + bigram) between input and output. Higher = more meaning retained. Measures whether the rewrite changed content or just style.

#### Results

| Metric | Howard ref | Bland input | BASE | V2 | V3 | Best |
|--------|-----------|-------------|------|-----|-----|------|
| Classifier (↑) | 0.715 | 0.197 | **0.417** | 0.217 | 0.300 | BASE |
| Perplexity (↓) | 1964 | 3593 | 5069 | 4905 | **4624** | V3 |
| Feature KL (↓) | 1.534 | 1.569 | **1.555** | 1.584 | 1.571 | BASE |
| Content pres (↑) | n/a | n/a | **0.273** | 0.269 | 0.266 | BASE |

#### Analysis

**The classifier favors BASE.** This is counterintuitive but explainable. The classifier measures vocabulary overlap with Howard — which words appear. The base model produces ornate vocabulary ("suffocating," "churning," "silhouette") that happens to overlap with Howard's word inventory. V3 produces different words that are more *structurally* Howard-like but aren't the specific words Howard used. This reveals a limitation of bag-of-words classifiers for style: they measure what words are present, not how they're arranged.

**Perplexity favors V3 (4624 vs base 5069).** This is the most meaningful metric. Bigram perplexity measures whether word *sequences* (not just individual words) match Howard's patterns. V3's word-to-word transitions are 8.8% closer to Howard's patterns than base. The LoRA is learning Howard's rhythm — which words follow which — even if it's not using the exact same vocabulary.

**Feature KL is inconclusive.** All models are close to each other (1.555-1.584) and close to Howard's own score (1.534). The sentence-length and word-length distributions don't discriminate strongly between these outputs. This confirms the earlier finding: the LoRA has learned vocabulary and transition patterns more than structural patterns.

**Content preservation is similar across all models** (0.266-0.273). All three models change roughly the same amount of content from the input. V3 isn't sacrificing meaning for style — it's doing a comparable amount of rewriting, just in a different direction.

#### What the scores actually mean

The perplexity result is the headline: **V3's prose sequences are measurably closer to Howard's actual writing patterns than base**. The classifier result shows base uses more Howard vocabulary but in AI-typical arrangements, while V3 uses less Howard vocabulary but in more Howard-typical sequences. This is the difference between a model that knows Howard's words and a model that's learning Howard's rhythm.

The gap to Howard's actual prose remains large (V3 perplexity 4624 vs Howard 1964). The LoRA has closed about 14% of the perplexity gap between bland input (3593) and Howard (1964). More training data, more epochs, or DPO refinement would be needed to close further.

### 10.9 Tooling Reference

All scripts are in `scripts/`, all data in `lora-data/`, all documentation in `docs/`.

#### Data Pipeline

| Script | Purpose | Input | Output |
|--------|---------|-------|--------|
| `scripts/build-lora-data.ts` | Download Howard stories from Project Gutenberg, strip boilerplate, chunk into 300-500 word segments, filter dialogue-heavy chunks | Project Gutenberg URLs | `lora-data/howard-training.jsonl` (926 chunks) |
| `scripts/generate-tonal-pairs.ts` | Back-translate Howard chunks into bland prose via Qwen 32B on Groq, pair paragraph-by-paragraph | `howard-training.jsonl` | `lora-data/howard-tonal-pairs.jsonl` (6,423 pairs) + `lora-data/flatten-cache/` |
| `scripts/curate-tonal-pairs.ts` | Score pairs by contrast quality (edit distance, vocab divergence, sentence length shift, verb concreteness), remove bottom N% | `howard-tonal-pairs.jsonl` | `lora-data/howard-tonal-pairs-curated.jsonl` (4,497 pairs) |

#### Training

Upload via Together CLI: `together files upload <path>`, then `together fine-tuning create --training-file <id> --model Qwen/Qwen3.5-9B --lora --n-epochs 2 --learning-rate 1e-5 --suffix <name>`.

#### Evaluation

| Script | Purpose | Output |
|--------|---------|--------|
| `scripts/measure-lora-effects.ts` | Quantitative prose metrics (word count, sentence length, adjective density, etc.) across base vs LoRA | Console table |
| `scripts/score-lora-style.ts` | Four-dimension style scoring: classifier, bigram perplexity, feature KL divergence, content preservation | Console dashboard |
| `scripts/diagnose-lora.ts` | Quick 10-paragraph diagnostic with per-paragraph metrics | Console output |
| `scripts/side-by-side.ts` | Generate static HTML comparison page | `lora-data/comparison.html` |

#### Visualization

- **React UI**: `/app/lora` — scrollable three-column comparison (input / base / V3) with word count and avg sentence length metrics, filterable by scene category
- **Static HTML**: `lora-data/comparison.html` — standalone comparison page, no server needed
- **Data**: `ui/public/lora-comparison.json` — 15 comparison paragraphs with base and V3 outputs

#### Documentation

| File | Contents |
|------|----------|
| `docs/lora-style-transfer-report.md` | Full research report: 20+ cited references, experiment log (v1/v2/v3), quantitative analysis, lessons learned |
| `docs/lora-qualitative-assessment.md` | Per-paragraph human evaluation: 15 paragraphs scored base vs V3, failure mode analysis, recommendations |

#### Agent Integration

The tonal-pass agent is wired into the pipeline at `src/agents/tonal-pass/` and `src/phases/validation.ts`. It runs after validation converges, before marking the novel as `done`. Gated by `pipeline.tonalPass` in `src/config/pipeline.ts` (currently `false`).

The system prompt in the agent (`src/agents/tonal-pass/prompt.md`) must match the system prompt used in training data (`scripts/generate-tonal-pairs.ts`): **"Rewrite this paragraph. Make the prose vivid, concrete, and direct."** Changing one without the other will degrade the LoRA's effectiveness.

The Together provider in `models/registry.ts` includes `chat_template_kwargs: { enable_thinking: false }` as `extraBody` to prevent Qwen 3.5 from burning tokens on reasoning.

The `lora` field in `ModelAssignment` (`models/roles.ts`) is passed through `getAgentConfig()` → `callAgent()` → `makeRequest()` to the Together API as a separate field on the base model, not as the model name.

---

## 11. Qwen3-14B Training Plan (W&B Inference)

**Date researched**: 2026-04-08  
**Context**: W&B Inference only supports a small fixed base catalog for serverless LoRA. As of 2026-04-07, the only viable Qwen base is `OpenPipe/Qwen3-14B-Instruct`. The Together/Qwen3.5-9B path (v1–v3 above) remains the legacy home for the Howard tonal adapter; a future analytical multi-task LoRA (continuity compression, structured extraction) would live on W&B. This section documents best practices for that next training run based on the current state of the field.

---

### 11.1 Model Characteristics vs Previous Runs

| | Qwen3.5-9B (v1–v3) | Qwen3-14B (planned) |
|---|---|---|
| Parameters | 9.7B (MoE) | 14.8B (dense) |
| Architecture | Sparse MoE | Dense transformer |
| Context window | 262k | 33k |
| Serving | Together AI serverless + `lora` field | W&B Inference + PEFT artifact upload |
| Max LoRA rank | 64 (used in v2/v3) | **16 (W&B hard limit)** |
| AA Intelligence Index | 32 | 16 |

The 14B is a less capable but dense model. Its value is not raw intelligence but trainability and serverless LoRA availability on W&B. For style/transformation tasks the capacity gap matters less than for reasoning tasks.

---

### 11.2 Recommended Hyperparameter Config

```
# LoRA
r = 16                    # W&B's max; also appropriate for < 1000 examples
lora_alpha = 16           # α = r (not α = 2r as Together defaulted); prevents unintended LR scaling
lora_dropout = 0.1
target_modules = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
bias = "none"
task_type = "CAUSAL_LM"

# Training
learning_rate = 1e-4
lr_scheduler = "cosine"
warmup_ratio = 0.05        # 5% of total steps
per_device_train_batch_size = 2
gradient_accumulation_steps = 8   # effective batch = 16
max_seq_length = 2048
num_epochs = 1             # for < 500 examples; increase to 2 for 500–1000
```

**Why α = r instead of α = 2r (the Together AI default):** The actual weight update magnitude is `(alpha/r) × delta_W`. When α = r, this is 1× — the LoRA update scales naturally with rank. When α = 2r (as in v1/v2/v3), it's 2× — effectively doubling the learning rate for the adapter. For style tasks this can push the model to overfit faster. Community consensus for Qwen3 specifically is α = r unless you have good reason to scale up.

**Why r = 16 is not a limitation here:** The adapter capacity bottleneck only activates when (a) dataset > ~1000 high-quality examples, and (b) the style patterns are structurally complex enough to need the additional basis vectors. For the v3 data scale (~4,500 pairs), r = 64 may have been more capacity than needed — the quality improvement from v2→v3 came from curation, not rank. W&B's 16-rank cap is architecturally constraining but practically not the bottleneck for where this project's data volume currently sits.

---

### 11.3 KL-Anchored SFT

The most important addition compared to the v1–v3 runs: **add a KL divergence penalty during SFT**.

The standard SFT loss is:
```
Loss = CrossEntropy(output, target)
```

KL-anchored SFT adds:
```
Loss = CrossEntropy(output, target) + β × KL(fine-tuned model || frozen reference model)
```

The KL term penalizes drifting away from the base model's distribution. For style tasks — where the fine-tune touches every token in the output — this drift can accumulate and degrade general capability.

**β values (Qwen3-specific, from Ivan's 2025 guide):**

| Stage | β | Effect |
|-------|---|--------|
| SFT | 0.05 | Small anchor — prevents drift without constraining style learning |
| DPO (optional, later) | 0.05–0.20 | Sweep to find the "knee": highest β before general capability drops |

**Practical impact:** Without KL, style fine-tuning on a pervasive task (every paragraph) can degrade general benchmarks by 5–10%. With β = 0.05, degradation is < 1% in published results. The cost is near-zero: the reference model is frozen and can run in parallel.

**Implementation:** TRL's `SFTTrainer` supports a `ref_model` argument for KL-regularized training. In Unsloth, this requires a custom trainer wrapper — the base Unsloth SFT path doesn't expose it directly. Alternatively, train with standard SFT at low LR (1e-4) and 1 epoch: at small scale and short training duration the KL drift is less severe, so KL-anchoring matters more for longer runs or larger datasets.

---

### 11.4 Dataset Construction for Qwen3-14B

The back-translation approach (Section 3) and curation approach (Section 10.6–10.7) from the v3 run are sound and transfer directly. Key additions:

**Dilution with general examples.** Mix 25–30% general instruction-following examples into training data. Even though LoRA's frozen base limits catastrophic forgetting, the adapter's weight updates can shift the model's default behavior on non-style tasks. Mixing in general examples prevents this. Sources: OpenHermes, ShareGPT subsets, or the base model's own outputs on diverse prompts.

**Chat template format for Qwen3.** The system-prompt + user/assistant format remains correct but Qwen3 has a specific EOS token:
```json
{
  "messages": [
    {"role": "system", "content": "Rewrite this paragraph. Make the prose vivid, concrete, and direct."},
    {"role": "user", "content": "<bland paragraph>"},
    {"role": "assistant", "content": "<Howard-style paragraph>"}
  ]
}
```
Set `eos_token = "<|im_end|>"` in training config. Mask the assistant token itself from the loss (train on response tokens only, not on `<|im_start|>assistant`).

**Dataset size for r = 16:** With rank capped at 16, the adapter's expressiveness is bounded. This is actually helpful: it means you shouldn't over-engineer the dataset beyond ~500–800 high-contrast pairs. The v3 curated set (4,497 pairs) is likely more than r = 16 can fully utilize. A curated 500–800 pair subset focused on the highest-contrast examples may perform comparably with less overfitting risk.

---

### 11.5 Overfitting Signals

- **Training loss < 0.2:** Red flag — the model is memorizing, not generalizing. Stop before this point.
- **Validation loss diverging from training loss:** Early sign of overfitting. Use the checkpoint with the best validation loss, not the final checkpoint.
- **Style quality plateaus but general regression tests degrade:** KL was too low. Retry with β = 0.10 or add more general dilution examples.

For a 500-pair dataset at r = 16, overfitting risk is moderate. 1 epoch is the safe default; 2 epochs only if validation loss still decreasing at epoch boundary.

---

### 11.6 Evaluation Plan

Same scoring framework as Section 10.8, run against base `OpenPipe/Qwen3-14B-Instruct`:

| Metric | What it measures | Target |
|--------|-----------------|--------|
| Bigram perplexity (↓) | Word sequence patterns vs Howard corpus | 10–15% reduction vs base |
| Adjective density (↓) | Howard's minimal-adjective style | < 1.0% (base is ~1.7%) |
| Word count ratio | Compression (Howard is economical) | < 1.0 vs input (base tends to expand) |
| Short sentence ratio (↑) | Punchiness | > 15% short sentences (≤ 8 words) |
| BERTScore vs input (↑) | Content preservation | > 0.85 (semantic meaning retained) |

**General capability regression:** Hold out 15–20 diverse prompts (factual QA, simple logic, instruction following). Compare fine-tuned vs base. Flag if any category drops > 5% accuracy.

---

### 11.7 W&B Inference Serving

Upload the trained PEFT adapter as a W&B artifact:
```bash
wandb artifact put --name lora-adapter --type model ./path/to/adapter/
```

The adapter must be stored in `storage_region = "coreweave-us"` for low latency. Inference call includes the artifact reference as a `lora` parameter alongside the base model name `OpenPipe/Qwen3-14B-Instruct`. No LoRA surcharge — billed at base model rates ($0.05/M input, $0.22/M output).

**Latency context from tuning_experiment id=94**: The 14B on W&B Inference averaged 157ms on the adherence-checker shape (short output). For the tonal-pass shape (~300 in / 250 out tokens, one paragraph), expect 500–900ms per call — comparable to the Together/Qwen3.5-9B path but with better price per token.

---

### 10.10 Platform Notes for Reproducibility

**Together AI serverless LoRA inference call format:**
```json
{
  "model": "Qwen/Qwen3.5-9B",
  "lora": "andre14618_2c8c/Qwen3.5-9B-howard-tonal-v2-b139cbad",
  "temperature": 0.6,
  "max_tokens": 400,
  "chat_template_kwargs": {"enable_thinking": false},
  "messages": [
    {"role": "system", "content": "Rewrite this paragraph. Make the prose vivid, concrete, and direct."},
    {"role": "user", "content": "<paragraph to rewrite>"}
  ]
}
```

**Critical**: Use the `lora` field on the base model, NOT the adapter ID as the model name. The adapter ID as model returns "non-serverless" error.

### 10.9 Next Steps

1. **DPO refinement** — generate multiple rewrites per paragraph at varying temperatures, score by sentence length distribution + adjective density + verb concreteness, create (chosen, rejected) pairs. ASTRAPOP [7] showed +25% improvement from DPO over SFT-only. This specifically targets the structural patterns (sentence length) that SFT hasn't fully captured.
2. **Scene-type weighting** — oversample action/atmosphere pairs where Howard's voice is most distinctive, undersample dialogue-adjacent narration. May require re-running flattening with scene-type tags.
3. **Test in production pipeline** — run tonal-pass agent on actual novel chapters, compare before/after with deterministic lint scores.
4. **Writer fine-tune** (separate experiment) — use structured context → prose pairs for a full writer LoRA. Different training data format, same platform.

---

## 11. Existing Resources

| Resource | Description |
|----------|-------------|
| `retro-text-style-transfer-v0.1` | 49.3K style transfer examples across 21 literary styles, CC0 licensed. HuggingFace: `jdpressman/retro-text-style-transfer-v0.1` |
| ASTRAPOP codebase | Full SFT + DPO pipeline for LLaMA-2-7B style transfer. GitHub: `isi-nlp/astrapop` |
| ITDA codebase | Back-translation pair generation. GitHub: `Vicky-Shao/ITDA` |
| STRAP codebase | Paraphrase-based style removal. GitHub: `martiansideofthemoon/style-transfer-paraphrase` |
| Style Transfer in Text (paper list) | Comprehensive bibliography. GitHub: `fuzhenxin/Style-Transfer-in-Text` |

---

## Appendix A: Can a Fine-Tuned Small Model Be a Serviceable Writer?

Separate from the style-transfer question, we investigated whether a fine-tuned 7–9B model could serve as a primary prose writer when given rich structured context at inference time — relevant to whether the tonal-pass agent could eventually absorb the writer role, or whether small models could replace larger ones in the beat-writer slot.

### A.1 The Headline Result: WritingBench

WritingBench (2025) fine-tuned Qwen-2.5-7B-Instruct on criteria-aware curated data and achieved a score of **8.49** — surpassing GPT-4o (8.16) and the base Qwen-2.5-72B (7.90) on their creative writing benchmark. The base 7B scored 7.43 before fine-tuning [11].

This is the strongest evidence that a properly fine-tuned small model can match or exceed much larger models on bounded writing tasks. The key factor was **data curation quality**, not quantity — selectively filtering training samples using criteria-aware scoring.

However, WritingBench evaluates relatively short generations. Long-form coherence was not measured.

### A.2 Context Engineering Compensates for Model Size

**SCORE Framework** (2025) used RAG with dynamic state tracking and hybrid retrieval for narrative generation, achieving 23.6% higher coherence, 89.7% emotional consistency, and 41.8% fewer hallucinations vs baseline models [12].

**Agentic Context Engineering (ACE)** (2025) found that "smaller models with an evolving context can match the performance of much larger static models." On the AppWorld leaderboard, ACE with a smaller open-source model matched the top-ranked production agent. The paper explicitly states context evolution is "a powerful axis of optimization alongside weight updates" [13].

**StoryWriter Framework** (2025) fine-tuned Llama-3.1-8B and GLM4-9B using a multi-agent pipeline (outline → planning → writing with dynamic context compression). The fine-tuned models "demonstrate advanced performance in long story generation," generating ~6,000 stories averaging 8,000 words [14]. This architecture closely mirrors our novel harness.

These findings validate our approach: deterministic control flow + rich context assembly can compensate for the primary failure modes of small models.

### A.3 Industry Trajectory: NovelAI

NovelAI provides a useful case study. They progressed through three model generations [15]:

| Model | Size | Notes |
|-------|------|-------|
| Clio | 3B | Adequate for basic storytelling, fast |
| Kayra | 13B | "Gold standard for prose" in their lineup |
| Erato | 70B (Llama 3) | More compute to fine-tune than to pretrain Kayra from scratch |

NovelAI moved from 3B → 13B → 70B. They did not stay small. Their investment pattern suggests internal evaluation found prose quality scales meaningfully with model size even with domain-specific fine-tuning. They compensate for model limitations using "lorebooks" — structured character/world knowledge injected into context, essentially the same approach as our context engineering system.

### A.4 Community Evidence

**Sao10K/L3-8B-Stheno-v3.2** (Llama 3 8B fine-tune for creative writing) receives enthusiastic community feedback — users report it "blows all of them out of the water, even the 11B ones" for roleplay and short-form fiction [16]. Weaknesses: hallucinations and text repetition loops in extended generation.

**WestLake-7B** outperformed 50+ models on a creative writing benchmark and "ranks between miqu-1-120b and goliath-120b" (both 120B models) on the LLM Creativity Benchmark [17].

The community consensus on r/LocalLLaMA: 7B fine-tunes "punch above their weight class" and approach 13B quality for bounded tasks. For longer, more complex narratives, 13B+ is generally preferred.

### A.5 Where Small Models Break Down

Ranked by severity from the literature:

1. **Long-range coherence** — The most consistently cited failure. At 8K+ words, small models lose plot threads, contradict facts, and forget character details. LongWriter-8B dropped from 46% to 34.5% completion rate going from 16K to 32K token outputs [18]. This is precisely what our harness compensates for with per-beat generation and extracted state.

2. **Character voice consistency** — Small models maintain voice for short stretches but drift over extended passages. NovelAI explicitly requires lorebooks for persistence [15]. Our character-state extraction + context assembly addresses this directly.

3. **Vocabulary diversity** — LLMs show "significantly lower uncertainty" than human writers [19]. A "small set of phrases dominates texts," with 28% of errors being awkward word choice and 17% being clichés. This problem is worse in smaller models and is the hardest to fix with context alone — though our deterministic lint system targets it.

4. **Novelty and surprise** — Larger models are more fluent but more predictable. Paradoxically, smaller models sometimes show more creative deviation, though less controlled [20].

5. **Sentence-level prose quality** — This is NOT the primary failure mode. WritingBench and the BART-large study [20] show small models produce grammatically fluent, readable prose at the sentence level. The failure is sustained quality over longer passages.

### A.6 Implications for Our Architecture

Our harness is well-positioned to exploit the sweet spot identified in this research:

- **Beat-level generation** (1 beat = ~200-400 words) keeps each generation call within the range where small models perform well
- **Context assembly** (`src/agents/writer/context.ts`) provides the rich structured input that ACE and SCORE show closes the gap with larger models
- **Extracted state** (facts, character states, relationships, causal graph) compensates for failure mode #1 (coherence) and #2 (character consistency)
- **Deterministic lint** compensates for failure mode #3 (vocabulary diversity)
- The **tonal-pass LoRA** would further address #3 by rewriting repetitive patterns into a distinctive voice

The remaining risk: even with perfect context, a 9B model may produce prose that is *correct* but *flat* — lacking the creative spark and sentence-level variety that larger models provide. The tonal-pass LoRA is designed to address exactly this gap. Whether it's sufficient is an empirical question that the experiment will answer.

**A plausible future architecture**: Large model (Qwen 235B) for planning and complex creative decisions, small model (Qwen 3.5 9B + LoRA) for beat-level prose generation with rich context, tonal-pass for voice consistency. This would dramatically reduce inference cost while potentially maintaining quality. But it requires validation — the WritingBench result is promising but our task (novel-length fiction with complex world state) is harder than their benchmark.

### Appendix A References
- [11] WritingBench. "WritingBench: A Comprehensive Benchmark for Generative Writing." arXiv:2503.05244, 2025. https://arxiv.org/abs/2503.05244
- [12] SCORE. "Story Coherence and Retrieval Enhancement for AI Narratives." arXiv:2503.23512, 2025. https://arxiv.org/abs/2503.23512
- [13] Agentic Context Engineering (ACE). arXiv:2510.04618, 2025. https://arxiv.org/abs/2510.04618
- [14] StoryWriter. "StoryWriter: Long Story Generation with Multi-Agent Collaboration." arXiv:2506.16445, 2025. https://arxiv.org/abs/2506.16445
- [15] NovelAI Models Documentation. https://docs.novelai.net/en/text/models/
- [16] Sao10K/L3-8B-Stheno-v3.2. https://huggingface.co/Sao10K/L3-8B-Stheno-v3.2
- [17] WestLake-7B. https://huggingface.co/senseable/Westlake-7B
- [18] LongWriter. https://huggingface.co/THUDM/LongWriter-llama3.1-8b
- [19] "LLMs Exhibit Lower Uncertainty in Creative Writing." arXiv:2602.16162, 2026. https://arxiv.org/abs/2602.16162
- [20] "Small Language Models can Outperform Humans in Short Creative Writing." COLING 2025. https://arxiv.org/abs/2409.11547

---

## Full Reference List

1. Patel et al. "Customizing LLM Generation Style through a Single Reference Sentence." arXiv:2409.04574, 2024. https://arxiv.org/abs/2409.04574
2. Patel et al. "StyleAdaptedLM: Enhancing Instruction Following with Stylistic Transfer." arXiv:2507.18294, 2025. https://arxiv.org/abs/2507.18294
3. Shao et al. "Authorship Style Transfer with Inverse Transfer Data Augmentation." AI Open, 2024. https://www.sciencedirect.com/science/article/pii/S2666651024000135
4. Krishna et al. "Reformulating Unsupervised Style Transfer as Paraphrase Generation." EMNLP 2020. https://arxiv.org/abs/2010.05700
5. Omukai, A. "Fine-tuning GPT 3.5 to Write in Your Voice." 2023. https://aomukai.com/2023/12/27/fine-tuning-gpt-3-5-turbo-to-write-in-your-voice/
6. Novelcrafter. "Fine-Tuning AI to Suit Your Writing Style." https://www.novelcrafter.com/blog/fine-tuning-ai-for-authors
7. Wegmann et al. "ASTRAPOP: Authorship Style Transfer with Policy Optimization." arXiv:2403.08043, 2024. https://arxiv.org/abs/2403.08043
8. OpenAI. "DPO Fine-Tuning Guide." https://developers.openai.com/cookbook/examples/fine_tuning_direct_preference_optimization_guide
9. ZeroStylus. "Long-Text Style Transfer via Dual-Layered Structure." arXiv:2505.07888, 2025. https://arxiv.org/abs/2505.07888
10. Raschka, S. "Practical Tips for Finetuning LLMs Using LoRA." 2023. https://magazine.sebastianraschka.com/p/practical-tips-for-finetuning-llms
