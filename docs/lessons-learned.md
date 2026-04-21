---
status: active
updated: 2026-04-10
---

# Lessons Learned

Hard-won principles from experiments, failures, and debugging. Each entry has evidence — experiment IDs, commit hashes, or specific observations. Read this before designing new agents, rubrics, benchmarks, or pipeline integrations.

## LLM Evaluation

### Pairwise judges have strong position bias — use reasoning models
DeepSeek V3.2 (non-reasoning) produced inconsistent results on 5/6 matchups when comparing rewritten prose variants. DeepSeek V3.2 Reasoner was substantially better — it produced consistent (both-directions-agree) results and the reasoning was defensible on manual review. **Always use a reasoning model for pairwise comparison.** (Experiments #47-50 vs #51-53, #59-62)

### Pairwise is wrong tool for evaluating mechanical edits
When the edit is small (lint fixes changing 3-6 words in 1,200), pairwise judges can't reliably detect the difference. Position bias dominates. Pairwise is useful for comparing substantially different prose (different models, different prompts). For lint/mechanical changes, measure what you actually changed: lint compliance, collateral damage, word count delta. (Experiments #64-66 vs #67-69)

### Judge penalty counts are noisy — same text scores differently on re-judge
In experiment #46, the dialogue judge flagged 2 issues on the original prose and 8 issues on the identical dialogue after rewriting (the rewriter didn't change any dialogue). This is pure judge variance, not a quality signal. **Don't trust single-run penalty deltas for dialogue.** Telling and dead-weight are more stable. (Experiment #46 pairwise analysis)

### Dead-weight judge will flag everything unless heavily constrained
The original dead-weight rubric flagged 44-86 issues per 1,200-word chapter. ~80% were false positives — sensory detail, atmospheric description, character interiority, and symbolic imagery all flagged as "redundant." The category "redundant" is too vague for LLM judges. Fix: define precisely (only flag the SECOND mention of same info), add explicit DO-NOT-FLAG exclusions, cap at 10 issues. After fix: 9-10 issues/chapter. (Experiment #46 pre-run analysis → commit ab20bb0)

## Rewriting

### Rewriter quality degrades above ~15-20 issues
When the rewriter receives 90+ issues, it can't address them all within its output budget. It resolves the tension by aggressively cutting content — dropping paragraphs, summarizing scenes, removing atmosphere. Word retention drops from 99% (3-6 issues) to 40-64% (90+ issues). The model outputs roughly the same completion tokens regardless of issue count. **Cap issues sent to the rewriter.** (Experiments #45, #46, #48 — word retention vs issue count)

### Rewriters cut content that pairwise judges value
Across three experiments, the pairwise Reasoner consistently preferred original prose over judge-informed rewrites. The reason: judge-only rewrites remove sensory detail, atmosphere, and interiority to "fix" issues. The Reasoner repeatedly noted "richer sensory details" in the original. **Judge-informed rewriting trades perceived quality for mechanical compliance.** (Experiments #54, #55, #57, #59)

### Full-chapter rewriting introduces collateral damage regardless of model or prompt
Even with a "change ONLY the flagged patterns" prompt at temperature 0.3, all models (Kimi K2, Qwen 32B, Qwen 235B) changed 63-78% of characters when reproducing a full chapter. LLMs cannot reproduce 1,200 words verbatim while making 3 edits — they drift on whitespace, punctuation, and phrasing throughout. **Never send full prose through an LLM for targeted fixes.** (Experiment #67)

## Lint & Deterministic Fixing

### Deterministic lint fixes have near-zero collateral damage
Pure string replacement (regex match → replacement) changes exactly the flagged patterns and nothing else. Measured 0.1% word-level collateral (from word count change when removing filler words). Instant execution, zero cost. Handles ~56% of flagged lint issues. (Experiment #69)

### Deterministic handles subtractive patterns; LLM handles creative patterns
Patterns where the fix is "remove this word" or "replace with a simpler word" are deterministic: filler phrases (`"in order to"` → `"to"`), filter words (`"could feel"` → `"felt"`), redundant adverbs (`"whispered softly"` → `"whispered"`), redundant body parts (`"nodded his head"` → `"nodded"`). Patterns where the fix is "replace with something specific to this scene" need LLM judgment: AI clichés (`"the silence stretched"` → scene-specific sensory detail), declared emotions. (Experiment #69 breakdown)

### Context-aware per-sentence LLM fixes work for creative patterns
Sending the flagged sentence alone failed — the LLM doesn't know the scene, characters, or available sensory details. Sending the sentence + 2 surrounding paragraphs (scene context) produces good creative replacements grounded in the physical scene. Example: `"The silence stretched between them"` → `"The steady drip of the sink faucet counted the seconds—plink, plink—each drop echoing in the space between them"` (used the faucet detail already present in the sentence). Cost: $0.0003/fix, latency: 200-500ms. (Experiment #71)

### The optimal lint fix pipeline is hybrid: deterministic first, LLM per-sentence for the rest
1. Deterministic pass: instant, free, handles filler/filter/redundant patterns (~56% of issues)
2. LLM per-sentence with scene context: handles AI clichés and declared emotions (~30% of issues)
3. Advisory only: patterns too integrated to fix in isolation stay as flags for the writer (~14%)

### Lint patterns must be calibrated against published fiction — not all "bad writing" is an AI tell
Ran all 73 regex lint patterns against 221k words of published fiction (Christie, Cather) and 254k words of AI prose. Many patterns fire equally or more on human prose: `perhaps/maybe` (0.9x), `seemed to` (0.3x), `sort/kind of` (0.4x), said bookisms like `murmured/exclaimed` (0.3x). These are general style advice, not AI tells. The real signals are patterns with ≥3x AI amplification: `silence stretched` (42x), `could feel` (10.5x), `wiped hands` (76x), `flicker of something` (3.5x). Patterns with ratio <1.5 should be disabled — they erode linter credibility by flagging normal English. **Validate every lint pattern against a human baseline before enabling it.** (Baseline script: `scripts/lint/lint-baseline.ts`, 2026-04-04)

## Model Selection

### MiMo V2 Flash is viable for extraction but not for writing or judging (2026-04-06)
Tested Xiaomi MiMo V2 Flash ($0.10/$0.30, 90% cache discount) across the pipeline. **Writer**: more AI tells than DeepSeek (telling 8.0 vs 6.0, dialogue 7.0 vs 3.5), vivid but editorializes — characters deliver exposition paragraphs. 18 lint issues vs DeepSeek's 10. Not viable. **Judge**: wildly inconsistent (telling 3 vs 16 across runs on Flash, 0 dialogue issues across all runs). Both Flash and Pro blind to same-voice dialogue problems. Not viable. **Extractors**: equal on completeness (8.0/8.0) and within noise on accuracy (7.5 vs 7.8) for summary/fact/character-state. Schema compliance 100%. 5x cheaper than Cerebras Qwen 235B. **Continuity**: 9.0/10 detection vs Qwen's 8.8, zero variance. **Relationship-timeline**: missed 2/5 knowledge gains and 1/2 awareness changes — not viable for knowledge graph feeder. **Graph-linker**: equal on structure and counts. (Experiments #86, #87, #88, #89)

### MiMo uses non-standard auth header — transport layer updated (2026-04-06)
MiMo API rejects `Authorization: Bearer` and requires `api-key: <key>` header. Added `authHeader` field to `ProviderDef` to support custom auth. Any provider with non-standard auth can now use this field.

### Real novel costs are $0.63-0.94 per 10-chapter novel, not $0.45 (2026-04-06)
Per-call averages underestimate real costs because they don't account for rewriter retries (22-28 calls/novel), re-extraction after rewrites, and context growth through chapters. Rewriter alone is 24-32% of total cost ($0.13-0.23). Extraction is ~45%. Writer+rewriter together are ~35-55% depending on how many rewrites trigger. Based on runs 290-314 (all Cerebras Qwen 235B).

### Extraction benchmark completeness dimension doesn't discriminate (2026-04-06)
Every model tested (Qwen 32B, Qwen 235B, MiMo Flash) scored exactly 8.0 on completeness across all runs. The judge always says "thorough, captures nearly all explicit and implicit information." Either the benchmark ceiling is too low, the judge rubric needs tightening, or all models genuinely extract equally well. Direct output comparison (relationship-timeline) showed real differences the benchmark missed.

### Quality dimensions (1-10 scores) don't discriminate between models (2026-04-06)
Prose Craft, Character Voice, and Sensory Grounding rubrics scored identically across Qwen 235B, DeepSeek V3.2, and MiMo Flash (all 8.0/10 on Prose Craft, 8.2-9.0 on others). DeepSeek V3.2 as judge anchors to the "7-8: Accomplished" band regardless of input quality. Penalty-based dimensions (issue enumeration) discriminate because they force specific evidence. **1-10 quality scoring is not useful for model comparison — use penalty counts or pairwise.** Quality dimensions archived from prose benchmark. (Experiment #90)

### Penalty counts don't capture seed/prompt adherence — the actual quality gap (2026-04-06)
Compared Qwen 235B, DeepSeek V3.2, and MiMo Flash on 3 seeds × 2 runs. Penalty scores overlapped, suggesting equivalence — but reading the prose against the seed constraints reveals real differences. MiMo Flash: inverted Istra's character (counted saved lives instead of deaths), used sci-fi terminology ("mnemonic contamination") in a dark fantasy setting, deviated from the romance premise (storm destroys a pier, not a restaurant), added unsupported lore to the sci-fi seed. These are **adherence failures** — the model doesn't respect the given setting, character, and premise constraints. Qwen 235B and DeepSeek V3.2 both respected seed constraints reliably. DeepSeek's weakness is pacing (1370w avg, often too slow to reach beat 3). Qwen is tighter (906w) and varies its openings across runs. **The real quality axis for writers is adherence to story constraints, not prose-level tells. Penalty benchmarks miss this entirely.** MiMo Flash is not viable as a writer — adherence errors compound chapter over chapter. (Experiment #90, manual prose review)

### Llama 3.1 8B handles AI cliché tonal fixes at 131ms/$0.05M (2026-04-06)
Tested Llama 3.1 8B (Groq) vs MiMo Flash on 25 tier-2 lint fixes. Both produced good rewrites for AI clichés (replacing abstract constructions with concrete scene-specific detail). Llama was 10x faster (131ms vs 1235ms) and cheaper ($0.05/$0.08 vs $0.10/$0.30). MiMo failed silently on some issues (returned unchanged sentence). Llama occasionally over-wrote but stayed closer to the original. **For chunked tonal fixes, use the cheapest fast model — the task is bounded enough that model size barely matters.** (Scripts: `scripts/tonal-pass-test.ts`, `scripts/lint/relint-and-fix.ts`)

### Best-of-N works for noisy-and-exploratory tasks but not deterministic-and-biased ones — reference-resolver wins, adherence-checker doesn't (2026-04-07)
The companion finding to the adherence-checker null result below. **Same infrastructure (`executeBestOfN` + `scripts/best-of-n-experiment.ts`), same parallel-3 pattern, same Llama 3.1 8B Groq production model — opposite outcome on reference-resolver.**

Benchmark: 30 (beat, prose) pairs from 8 approved novels. Three variants per case. Reference-resolver outputs a list of `(type, characters, location, topic)` lookups; the aggregator is set union by lookup key.

| metric | production single | parallel-3 |
|---|---:|---:|
| avg lookups per call | 4.03 | **6.40** (+59%) |
| recall vs oracle | 31.7% | **38.9%** (+7.2pp, relative +23%) |
| precision vs oracle | 27.8% | 22.0% (−5.8pp) |
| latency | 269ms | 306ms (+37ms) |
| cost (per 30 calls) | $0.00075 | $0.00225 (+$0.0015) |

Classic recall/precision tradeoff. Set union expands the candidate set, which finds more of what the oracle would find AND adds extra lookups not in the oracle's set. **Recall is the right metric here** because for reference-resolver the cost of extras is low (the writer reads more context and ignores what it doesn't need) while missing a needed lookup is higher (the writer doesn't know about something it should). The 23% relative recall gain at trivial cost increase is a clean win.

**Why reference-resolver wins where adherence-checker doesn't.** The two tasks have opposite agreement structures:
- **adherence-checker** (boolean output): Llama 8B at temp=0.1 is highly self-consistent (production vs parallel-3 disagreed on 0/29 cases). When it disagrees with the oracle, it disagrees the same way every time — *systematic miscalibration*. Aggregation can't fix calibration drift.
- **reference-resolver** (set output): Llama 8B is *noisy-and-exploratory* on this task (production vs parallel-3 only ~57% Jaccard similarity). Different attempts surface different valid lookups. Set union actually adds coverage because each call leaves some recall on the table.

**The heuristic that falls out:** parallel-N works when single calls leave coverage on the table; it doesn't work when single calls are confidently wrong. The diagnostic is **internal disagreement rate** — if parallel calls disagree with each other, variance is the problem and aggregation helps; if they agree with each other but disagree with the oracle, calibration is the problem and aggregation won't help.

**A subtler methodology lesson — pick the right metric.** The first reference-resolver run scored 0.0% Jaccard similarity with oracle, which looked like a damning null result. Qualitative inspection revealed the metric was wrong: both models produced semantically equivalent lookups with different topic phrasings ("Wren's health" vs "Wren's condition prior to serum administration"), and the strict-key Jaccard treated them as disjoint. Switching to a coarser key (drop free-text topic, keep type+characters+location, plus a topic prefix only for knowledge lookups since that's the only type the retrieval engine uses topic for) revealed the real picture: ~30% baseline overlap and a clear recall/precision tradeoff under parallel-N. Set-output benchmarks need carefully-chosen keys; the wrong key produces the wrong answer.

Shipped: `src/agents/writer/reference-resolver.ts` calls `executeBestOfN(..., 3, aggregateLookupsUnion)` instead of `callAgent`. The IMPLICIT_MARKERS gate still fires first, so parallel-3 only triggers on beats that need an LLM call in the first place. (Commits `974c886` infrastructure, `163604d` benchmark script, `d74745d` multi-agent refactor, `2025a10` coarse-key fix, `29101df` ship the wiring)

### Best-of-N can't fix systematic miscalibration, only variance — adherence-checker null result (2026-04-07)
First test of the best-of-N inference pattern (`src/llm.ts:executeBestOfN` + `scripts/best-of-n-experiment.ts`). Hypothesis: parallel-3 calls on a fast cheap model + majority vote produces better reliability than single-shot on a slower more capable model, because variance averages out. **The data falsified this hypothesis for adherence-checker.**

Benchmark: 30 (beat, prose) pairs mined from 8 approved novels. Three variants per case: production single-shot (Llama 3.1 8B Groq), oracle single-shot (Cerebras Qwen 235B), parallel-3 with majority-vote aggregation on the production model.

| variant | avg latency | agreement with oracle |
|---|---:|---:|
| production single (Llama 8B Groq) | 365ms | 86.2% |
| parallel-3 (Llama 8B Groq) | 484ms | **86.2% — same** |
| oracle (Cerebras Qwen 235B) | 519ms | — |

Parallel-3 produced **zero improvement**. Production-vs-parallel-3 disagreed on **0/29 cases**. The 14% disagreement rate against the oracle was identical for both variants because Llama 8B at `temperature: 0.1` is highly self-consistent on this task — running it 3× gives the same answer 3×.

**The disagreement pattern was systematic, not random.** Every disagreement was the same shape: Llama 8B says FAIL with deviations like "order of two adjacent events differs," "prose adds more sensory detail than the spec mentions," "filter rattle described before smell." Qwen 235B says PASS with empty deviations. Llama 8B is **over-strict** — it flags stylistic embellishments and trivial ordering as failures. Qwen 235B correctly recognizes them as acceptable creative interpretation. **Aggregation can't fix calibration drift, only noise.** Running an over-strict model 3× gives 3× over-strict answers.

The fix is a model upgrade, not parallel-N. adherence-checker swapped to Cerebras Qwen 235B in commit `0d4ea1e` — comparable latency (519ms vs 365ms), cost rounding error at scale (~$0.0003/call vs ~$0.00003), accuracy matches the oracle by definition.

**One real win for parallel-N**: case 5 of 30, the production single-shot hit a Groq 400 ("Failed to generate JSON") and failed entirely. Parallel-3 had two attempts succeed and returned a result. So **parallel-N still buys transient-failure resilience**, just not calibration improvement. That's a smaller benefit than the original hypothesis but a real one.

**Methodological lessons:**
- **Parallel-N requires per-agent validation, not assumption.** The "small models are noisy, average them out" mental model only applies when the small model actually IS noisy. At low temperature on a deterministic-ish task, small models can be wrong-but-consistent. Calibration is a different failure mode than variance and needs different treatment.
- **The right diagnostic is internal disagreement rate.** If parallel-N's calls disagree with each other ≥10% of the time on the same input, variance is the problem and aggregation will help. If they agree 100% with each other but disagree with the oracle, calibration is the problem and aggregation won't help. The benchmark script logs both metrics — read internal disagreement first, before judging the headline.
- **Hypothesis-testing infrastructure is reusable; the hypothesis itself isn't.** `executeBestOfN` and `scripts/best-of-n-experiment.ts` both work and will be used to test other agents (reference-resolver, judges) where the variance assumption may hold. The negative result on adherence-checker doesn't invalidate the technique — it constrains where it applies.

(Commits `974c886` benchmark infrastructure, `163604d` benchmark script, `387b236` -boN role lookup fix, `0d4ea1e` adherence-checker upgrade)

### Together AI standard tier is ~50× slower than Groq fast tier — don't use for per-beat agents (2026-04-07)
Tried routing reference-resolver and adherence-checker to Qwen 3.5 9B base on Together AI for "consistency with future fine-tunes" (the tonal-pass LoRA is built on the same base, so non-fine-tune calls against the same model would make eventual LoRA-vs-base evaluation apples-to-apples). Result: dark-fantasy 3-chapter test went from ~1.5 min (Llama 8B on Groq) to ~17 min (Qwen 9B on Together), a ~10× wall-time hit on the whole pipeline. Per-call data from `llm_calls` (after instrumenting direct callers in `a5fce04`):

| agent | model | n | avg ms | range |
|---|---|---:|---:|---|
| reference-resolver | llama-3.1-8b-instant (Groq) | 3 | 346 | 172-505 |
| reference-resolver | Qwen/Qwen3.5-9B (Together) | 5+ | ~20,000 | 13,000-30,000 |

That's a **~50-100× per-call slowdown** for the same parameter class. Hypotheses ruled out via direct curl + a fetch-interceptor harness test:
- **Thinking accidentally enabled**: ruled out. The provider's `chat_template_kwargs: { enable_thinking: false }` IS being included in the request body (verified by intercepting `fetch` at the transport level and printing the JSON). Responses come back with `reasoning: null` and `reasoning_tokens: 0`. The kwarg works.
- **Wrong model variant**: ruled out. The base model accepts the request and produces well-formed JSON content. It's just slow.
- **Cold-start variance**: partially. Variance is 2× call-to-call (13-30s) but the floor is still 13s.

The cause is the **provider tier itself**. Together AI standard-tier serverless inference runs on commodity GPUs at ~10-15 end-to-end tokens/sec for a 9B model. Groq's fast tier delivers 400-700 tps on the same parameter class via custom LPU hardware. The ~50× gap is hardware, not config — there's nothing to fix.

**Implication**: Together AI is the right home for serving custom LoRA fine-tunes (that's its actual value prop — Groq/Cerebras don't host arbitrary user adapters). It is **not** the right home for per-beat agents that run serially in a writing loop, because per-beat latency is wall-time-critical and Together's standard tier can't compete. The "consistent base for future fine-tunes" argument is real but the daily latency tax kills it; switch back to Together only when actively building training data for the fine-tune.

**Methodology lesson**: when a provider swap creates a wall-time mystery, instrument the transport layer with per-call DB logging (`a5fce04`) and intercept `fetch` to print the literal request body before assuming a config bug. The logging answered "is this slow per call or per N calls" in one query; the fetch interceptor ruled out the thinking-config hypothesis in one test. Don't infer from log cadence when you can measure directly.

Reverted in this same commit — small-model defaults are back on Llama 3.1 8B (Groq). The Qwen 3.5 9B base entry stays in the registry for future LoRA serving but is not assigned to any agent. (Commits `08e9acf`, `ce1d23e`, `14ac6ba`, `a5fce04`; per-call data via `SELECT model, agent, AVG(latency_ms) FROM llm_calls GROUP BY model, agent`)

### Serverless LoRA support varies wildly across providers — verify the docs page that covers serving, not training (2026-04-07)
Spent half a session assuming Fireworks AI supported serverless LoRA inference because their model catalog tags certain bases as "Tunable." That tag means **you can train a LoRA against this base via Fireworks's training service**. It does NOT mean you can serve the trained adapter via Fireworks's serverless tier. Fireworks's actual serverless-LoRA support, per https://docs.fireworks.ai/models/overview:

> "Neither custom base models nor LoRA addons are supported for serverless inference. All user-provided models, including fine-tunes, require a dedicated deployment."

Dedicated deployment on Fireworks = pay-per-GPU-hour ($2-5/hr per H100), not pay-per-token. At solo-developer volume (a handful of novel runs per session), this is uneconomical by 2-3 orders of magnitude vs serverless. Fireworks dedicated only makes sense at thousands of calls per day sustained.

The provider that *does* fill this gap is **W&B Inference** (CoreWeave-backed), per https://docs.wandb.ai/inference/lora:

> "Bring your own custom LoRA for serving fine-tuned models on W&B Inference. Calls that use LoRA artifacts are billed at the same rates as standard model inference, with no extra fees for serving custom LoRAs."

Pay-per-token, no LoRA surcharge, PEFT-format upload as a versioned W&B artifact. **The catch is the supported base list** — only 5 bases as of 2026-04-07: `meta-llama/Llama-3.1-8B-Instruct`, `meta-llama/Llama-3.1-70B-Instruct`, `openai/gpt-oss-120b`, `OpenPipe/Qwen3-14B-Instruct`, `Qwen/Qwen3-30B-A3B-Instruct-2507`. Notably absent: Qwen3 8B, Qwen3 4B, Qwen 3.5 9B (the base of the existing Howard tonal-pass v3 adapter). Adapters trained against an unsupported base have nowhere to go on W&B without retraining.

**The actionable rule**: when a provider says "fine-tuning supported" or tags a model "Tunable," that's a statement about training. **Always find the docs page that explicitly covers serving** — usually titled "serverless inference," "deployment," or "LoRA addons" — and read what it says about user-uploaded adapters. The training story and the serving story are decoupled across providers and the assumption that "fine-tuning supported = serverless serving supported" is wrong at least at Fireworks. Other providers worth checking the same way next time the question comes up: Replicate, Modal, Together (knows it serves LoRA serverless), Hugging Face Inference Endpoints (dedicated only), Cerebras/Groq (don't host user adapters at all).

The corollary: **the LoRA-serving question and the base-model-routing question are separate decisions**. The harness can have one provider for cheap base-model serverless calls (Fireworks for FP8 8B/120B) and a different provider for the LoRA-served slots (W&B Inference if its base catalog fits, local hardware otherwise, Together as legacy for the existing v3 tonal-pass). The transport layer already handles per-provider quirks; multi-provider is the default, not the cost.

### Don't compare model "size" without checking generation — Qwen 3.5 9B is more capable than Qwen3 14B (2026-04-07)
**Correction to a claim made earlier in the same session.** I previously said "moving from Qwen 3.5 9B to Qwen3-14B is a meaningful capability upgrade for the analytical agents" because parameter count went from 9.7B to 14.8B (+56%). That framing was wrong. Per Artificial Analysis ([qwen3-5-9b](https://artificialanalysis.ai/models/qwen3-5-9b), [qwen3-14b-instruct-reasoning](https://artificialanalysis.ai/models/qwen3-14b-instruct-reasoning)):

| Metric | Qwen 3.5 9B (Mar 2026) | Qwen3 14B Instruct (Apr 2025) |
|---|---:|---:|
| AA Intelligence Index | **32** (#5/116) | **16** (#41/116) |
| Parameters | 9.7B (hybrid Gated Delta + sparse MoE) | 14.8B dense |
| Output speed | 131 tps | 62.9 tps |
| Context window | 262k | 33k |
| Modalities | text + image + video | text only |
| Input price | $0.07/M | $0.35/M |
| Output price | $0.17/M | $4.20/M |
| AA verdict | "well above average... very competitive" | "above average... particularly expensive... notably slow" |

Qwen 3.5 9B is **half the parameters but double the intelligence index, twice the speed, eight times the context, multimodal, and one generation newer.** It's an MoE model with sparse experts — total params don't tell the whole story. The 14B is an older dense model that AA explicitly calls expensive and slow. The "capability upgrade" framing was upside-down.

**The actual rule**: never compare two models on parameter count alone. Always check the **release date** (generation matters more than param count at the small scale) and the **architecture family** (MoE vs dense breaks naive size comparisons). When you don't know, look up Artificial Analysis or a similar third-party benchmark site rather than reasoning from parameter count.

**The corollary for this harness**: the existing Howard tonal-pass v3 base (Qwen 3.5 9B on Together) is NOT an outdated model that needs upgrading — it's a top-shelf modern 9B that happens to be served slowly because Together's standard tier is bad infrastructure, not because the model is bad. Moving v3 to a different provider that serves the same model faster is the right play, not retraining v4 on a "bigger" base that's actually a less-capable older one. This corrects the v4-on-Qwen3-14B plan in `docs/todo.md` (the analytical LoRA decision is unaffected — it was driven by W&B's supported base list, not by capability).

### Same model, different providers, 3× different latency — DeepInfra serves Qwen 3.5 9B 3.1× faster than Together (2026-04-07)
**Caveat added 2026-04-08:** the rule below holds for routing **stock model** calls (i.e. when you'd use the public catalog entry on either provider). It does NOT extend to where you serve a custom LoRA adapter — DeepInfra's adapter-hosting product is a different SKU (dedicated GPU rental) from its stock-model serving. See "DeepInfra Custom LLMs is dedicated GPU rental, not serverless LoRA" below.

Per AA's [Qwen 3.5 9B providers comparison](https://artificialanalysis.ai/models/qwen3-5-9b/providers):

| Provider | Output speed | TTFT | Input | Output | Blended |
|---|---:|---:|---:|---:|---:|
| **DeepInfra (FP8)** | **170.9 tps** | 12.27s | $0.04/M | $0.20/M | $0.08/M |
| Together.ai (FP8) | 55.6 tps | 36.79s | $0.10/M | $0.15/M | $0.11/M |

AA's headline: "DeepInfra (FP8) demonstrates superior performance across all metrics, delivering 3.1x faster throughput and lower latency compared to Together.ai." Same model, same precision (FP8), different providers, **3× different decode speed and 3× different TTFT.** This matches what we observed empirically when the slow Together serving of Qwen 3.5 9B caused the per-beat-agent benchmark fiasco earlier this same session — the slow path wasn't the model, it was Together's standard tier.

**The 12s TTFT on DeepInfra is concerning** but might be a cold-start artifact in AA's testing methodology rather than steady-state behavior. AA tests with infrequent calls; in production with sustained traffic the model would warm up and TTFT would drop. Or it might be reasoning-mode overhead (Qwen 3.5 9B has thinking-mode-on by default and AA may not be disabling it). **Needs an empirical probe in steady-state** before committing the harness's tonal-pass slot to DeepInfra. The decode speed (170 tps) makes the migration attractive regardless — even with a 12s startup, a typical paragraph rewrite would complete in <15 seconds vs Together's observed ~20s, and warm-state would be much faster.

**The actionable rule**: when a provider costs you wall time on a model, the right diagnostic is **find another provider serving the same model and compare**, not retrain or migrate to a different model. Provider serving quality varies 3-10× on the same weights. Use [AA's per-model providers tab](https://artificialanalysis.ai) to find the comparison without needing to benchmark each provider yourself (then verify steady-state with your own probe before committing).

### Together AI warm-up probe: no warm-up effect, but much faster than AA data suggested (2026-04-12)

The AA benchmark (2026-04-07) showed Together at 36.79s TTFT on Qwen 3.5 9B — but AA makes infrequent isolated calls. A 20-call sequential probe (`scripts/together-warmup-probe.ts`) showed dramatically better results:

| Shape | Avg | Min | Max | 1st half | 2nd half |
|-------|----:|----:|----:|----:|----:|
| Short (checker-like, ~256 out) | **1,089ms** | 692ms | 1,738ms | 1,160ms | 1,018ms |
| Medium (continuity-like, ~512 out) | **4,918ms** | 2,629ms | 10,268ms | 5,448ms | 4,389ms |

**No warm-up effect.** First 3 calls avg ≈ last 3 calls avg. The hypothesis that "sustained traffic would warm up the model" is **disconfirmed** — Together's variance is random, not a cold-start curve.

**Revised positioning:** Together is 5-12× slower than W&B per call, not 50-100× as the stale AA data implied. Viable as a Tier 2 hot standby. Would add ~15-25s of adapter latency per chapter (vs ~2s on W&B). See `docs/wandb-alternatives-report.md` for the tiered fallback plan.

**Lesson:** Third-party benchmarks (AA) use infrequent isolated calls that can overstate cold-start effects — but in Together's case, the old data was genuinely stale. Together improved their infrastructure between April 7 and April 12. Always re-benchmark before making migration decisions based on data more than a few days old.

### DeepInfra "Custom LLMs" is dedicated GPU rental, not serverless LoRA — corrects an earlier conflation (2026-04-08)
During the 2026-04-07 W&B/Qwen3-14B serving decision I treated DeepInfra as a viable serverless LoRA host based on the public docs page at https://deepinfra.com/docs/advanced/lora and AA's per-provider numbers showing DeepInfra serving stock Qwen 3.5 9B 3.1× faster than Together. **That was a product conflation.** DeepInfra has two different SKUs and I mixed them up:

- **Stock model serving** (the public catalog: `Qwen/Qwen3.5-9B`, `meta-llama/...`, etc.) — serverless, per-token, multi-tenant. This is what AA's "providers" tab measures. Real, fast, cheap. But it only works against the public model catalog — you cannot point it at your own LoRA adapter.
- **Custom LLMs** (https://deepinfra.com/docs/advanced/custom_llms) — dedicated GPU rental on A100-80GB or H100-80GB, billed per GPU/hour, weekly invoice, 4-GPU per-user cap, no quantization. This is the product that hosts user-uploaded fine-tunes and LoRAs. Per the docs, verbatim: *"pricing is for GPU uptime... You have to have a sufficient load to justify this resource."* Idle GPUs still bill — the docs warn that forgetting to shut down a 2-GPU deployment over a weekend costs ~$256.

For solo-developer harness traffic — bursty per-beat calls separated by long idle stretches, plus once-per-novel tonal pass — dedicated GPU rental is uneconomical by 2-3 orders of magnitude vs per-token serverless. The break-even is somewhere around thousands of sustained calls per day per model.

**Sharpened actionable rule** (refines the "verify the docs page that covers serving, not training" lesson above): when a provider says they "support custom LoRAs," check **how the LoRA hosting is billed** before treating them as a drop-in serverless replacement. The two product shapes:

- **Per-token, multi-tenant serverless LoRA** — W&B Inference (CoreWeave-backed), Together AI's serverless multi-LoRA. Both share GPUs across customers, charge per token at base-model rates, and constrain you to a fixed list of supported bases. This is the shape this harness needs.
- **Per-GPU-hour dedicated** — DeepInfra Custom LLMs, Fireworks dedicated, Hugging Face Inference Endpoints, Replicate dedicated. All require sustained throughput to amortize idle cost. Sane for production serving at thousands of calls per day per model; insane for bursty solo-developer use.

The harness is firmly in the first bucket. **W&B Inference on `OpenPipe/Qwen3-14B-Instruct` remains the chosen home for the analytical multi-task LoRA**, and Howard tonal-pass v3 stays on Together AI as the legacy serving home until/unless retrained on a W&B-supported base.

**Corollary**: AA's per-provider latency tables describe stock-model serving on each provider. They cannot be used to predict the performance, pricing, or even *availability* of custom-LoRA hosting on the same provider — that's a different product line on the same vendor and may not even exist (Cerebras, Groq) or may exist only as dedicated rental (DeepInfra, Fireworks).


W&B Inference latency probe (`tuning_experiment` id=94, `scripts/finetune/test-wandb-inference.ts`) hit a counterintuitive finding: **OpenPipe/Qwen3-14B-Instruct on W&B Inference is FASTER than Cerebras Qwen 235B on the adherence-checker workload shape** — 157ms avg vs 365ms avg, a 2.3× speedup. On a 14B model on a "standard" tier inference service vs a 235B model on Cerebras's custom LPU hardware. That's not the direction the comparison usually goes.

The reason: **decode time dominates for short-output tasks**. Adherence-checker outputs are tiny (~17 tokens of structured JSON). At those sizes, the per-token decode cost is the bottleneck and a smaller model decodes per-token faster than a larger one even when the larger model is on faster hardware. The Cerebras LPU's throughput advantage shows up on the writer shape (~400 output tokens) where it dominates the 14B's 248 tps with its 384 tps. But for the 17-token adherence response, the 14B's smaller decoder finishes before the 235B's faster-but-larger decoder gets going.

| shape | Qwen3-14B (W&B) | Cerebras Qwen 235B | who wins |
|---|---:|---:|---|
| reference-resolver (~80 in / 40 out) | 741ms | 385ms | Cerebras |
| **adherence-checker (~360 in / 17 out)** | **157ms** | **365ms** | **14B (2.3× faster)** |
| beat-writer (~850 in / 400 out) | 2008ms | 1520ms | Cerebras |

The pattern: at very short outputs, decode-overhead-per-token dominates and smaller wins. At longer outputs, raw decode-throughput dominates and the faster hardware wins. The crossover happens somewhere around 50-100 output tokens for this hardware comparison.

**Practical implication for the harness**: when matching a model to a slot, the decision criterion shouldn't just be "is this model fast enough" — it should be "is this model fast enough *at the output length this slot produces*." The adherence-checker is the smallest-output slot in the pipeline and therefore the most decode-bound, which is why the 14B beats the 235B there. Other small-output slots (judges, classifiers, structured extractors with bounded output) probably show similar patterns.

**Methodology**: shape your latency probes to match real workload output lengths, not arbitrary defaults. The original probe used `max_tokens=256` for reference-resolver (vs the production-realistic ~40), which would have hidden this pattern. The probe script now sets max_tokens close to the expected output for each shape. (Commits `2d39254`, `5c7ba26`)

### MoE doesn't always pay off in serverless serving — Qwen3-30B-A3B is unusably slow on W&B (2026-04-07)
The same probe (`tuning_experiment` id=94) was supposed to validate `Qwen/Qwen3-30B-A3B-Instruct-2507` as the multi-task LoRA base, with the theory being that 30B total params + 3B active params gives "30B-class capacity at 3B-class inference cost." The architecture is sound — Cerebras serves the closely-related Qwen 235B (22B active) at ~1.5 seconds for the writer shape. The 30B/3B variant should be at least as fast.

It wasn't. On W&B Inference the 30B A3B came in at:

| shape | avg ms | p95 | vs Cerebras 235B |
|---|---:|---:|---:|
| reference-resolver | 3393 | 3807 | 8.8× |
| **adherence-checker** | **7172** | **33044 (!)** | **19.6× avg, 90× p95** |
| beat-writer | 16268 | 18595 | 10.7× |

A 33-second p95 on a task whose successful completions are sub-second is the giveaway: **cold-start dominance**. W&B's serving infrastructure isn't keeping the Qwen3-30B-A3B model warm — probably because it's a less popular variant than the Qwen3-14B and gpt-oss-120b on their platform — so most requests are paying a load-from-cold cost. The MoE architecture doesn't help if the experts have to be loaded from disk before each batch.

**The lesson**: model architecture efficiency only matters when the serving infrastructure is keeping the model warm enough to deliver it. A "fast" architecture on a cold-start-prone serving tier is slower than a "slow" architecture on a hot-path serving tier. **Verify served-tier-warmth empirically before committing to a model on architectural grounds**, especially for less popular variants on multi-tenant inference services.

The corollary: **the OpenPipe/Qwen3-14B-Instruct base is the only viable W&B-served choice** for the analytical multi-task LoRA at the moment. Not because it's the most capable (the 30B A3B has more total parameters and the gpt-oss-120b has way more total parameters) but because it's the only one W&B keeps hot. Locked in via commit `e81b9c3`.

### Beat-writer cost is rounding error — the optimization pressure lives at continuity (2026-04-07)
Cleanup-session trace pulled real per-call shapes from `llm_calls` for every active agent in the drafting pipeline. The numbers contradicted the intuition that the writer slot is where cost or speed matter:

| agent | model | avg_in | avg_out | avg_ms | cost/call (approx) |
|---|---|---:|---:|---:|---:|
| beat-writer | cerebras qwen-3-235b | 846 | 391 | 2,155 | ~$0.001 |
| adherence-checker | cerebras qwen-3-235b | ~360 | ~140 | ~520 | ~$0.0003 |
| reference-resolver | llama-3.1-8b (Groq) | 257 | 162 | 289 | ~$0.00003 |
| chapter-plan-checker | gpt-oss-120b (Groq) | 2,880 | 995 | 2,415 | ~$0.0007 |
| **continuity** | **cerebras qwen-3-235b** | **7,294** | **241** | **934** | **~$0.0023** |

Two non-obvious takeaways:

1. **The writer slot is essentially free per beat.** ~$0.001 per beat call. A 5-beat chapter generates ~$0.005 of writer cost, a 30-chapter novel generates ~$0.15 total writer cost. Moving the writer to a smaller cheaper model would save fractions of a cent per chapter — not worth the prose-quality risk. The beat-writer call shape (~850 in / 400 out, ~2 seconds) is small by LLM standards, and Cerebras 235B is already in the right place for both wall-time and capacity. **There is no cost-pressure justification for fine-tuning the writer** — the lever for prose quality is the planner (does the plan give the writer enough to work with) and the tonal pass (does the LoRA sharpen the output), not the writer model.

2. **Continuity has the largest prompt token cost in the entire pipeline by an order of magnitude.** 7,294 input tokens per call vs ~360-3,000 for everything else. The reason is the prompt encodes a wall of accumulated facts + character states with no compression. Continuity also runs once per chapter — call frequency is moderate but per-call cost is the highest in the harness. **If anything in the harness is a fine-tuning prize, it's continuity** — the rules can compress into weights, the structured world-state delta is much smaller than the current dump-everything prompt, and the per-call cost win is real money over time. This contradicts the natural instinct to fine-tune the writer first.

**Methodology lesson**: don't optimize from intuition — pull `llm_calls` and read the actual shapes. The pipeline trace took ~30 minutes via `psql` and a few greps and overturned what I would have guessed about where cost lives. (Trace done 2026-04-07; data via `SELECT agent, model, ROUND(AVG(prompt_tokens)), ROUND(AVG(completion_tokens)), ROUND(AVG(latency_ms)) FROM llm_calls GROUP BY agent, model`)

### Lint pattern "just" has 23%+ false positive rate — disable broad filler patterns (2026-04-06)
Pattern 70 (`\bjust\s+...`) flagged 39 issues in experiment #90. 9+ were false positives where "just" carries semantic weight: "not just a restaurant" (means "more than"), "just right" (means "precisely"), "just as" (temporal), "no longer just hers" (means "more than"). Even several "true positives" were debatable stylistic choices. Broader lesson: single-word filler patterns that can't distinguish semantic from filler usage erode linter credibility. **Disable patterns with >15% false positive rates. AI cliché patterns (multi-word constructions) are the high-value targets.** (Analysis of experiment #90 lint data)

### Cheap models match expensive models for mechanical tasks
Qwen3 32B ($0.29/$0.59) and Qwen3 235B ($0.60/$1.20) performed equivalently to Kimi K2 ($1.00/$3.00) on lint compliance and word retention for full-chapter lint rewrites. For deterministic + per-sentence fixes, the model barely matters since the LLM only handles 1-3 sentences. **Use the cheapest available model for lint fixing.** (Experiment #63)

### Qwen 235B on Cerebras is 4x faster than Groq for equivalent quality
1.0s vs 4.0s for full-chapter rewrites. For per-sentence fixes: 200-300ms. Speed matters for pipeline integration where lint runs on every chapter. (Experiment #63)

### Model pricing in the registry must stay current — batch pricing ≠ standard pricing
Kimi K2 on Groq is $1.00/$3.00, not the $0.45/$1.40 initially reported. Always verify against the provider's current pricing page before cost comparisons. (Caught during experiment #63 review)

### Prose penalty benchmarks are not iterably valuable (2026-04-06)
Telling, dead-weight, and dialogue penalty judges have no corrective feedback path — the writer prompt already says "don't tell" and the model just can't follow it consistently. Counting penalties doesn't help the pipeline improve because: (1) judge counts are noisy (2-8x variance on re-judge), (2) they don't correlate with actual quality (MiMo scored similar penalties but had real adherence failures), (3) deterministic lint + Llama 8B tonal pass already handles AI clichés at near-zero cost and latency. **The iteration loop should be: context engineering → adherence checking → deterministic lint, not: generate → expensive judge → noisy score → ???.** Prose penalty dimensions archived from active benchmarks. Context quality benchmark (5 dims with retrieval diagnostics) is the primary optimization target. (Full audit 2026-04-06)

### 1-10 scoring produces ceiling effects across all benchmark suites (2026-04-06)
Extraction completeness: every model scores 8.0. Planning dimensions: all anchor to 7-8. Quality dimensions: flat 8/10 across models. The problem is structural — LLM judges using 1-10 rubrics gravitationally anchor to the "accomplished" band for any competent output. Penalty-based dimensions (issue enumeration) discriminate because they force specific evidence. But even penalty dimensions are noisy single-run. **For model comparison, read the actual output against the actual constraints. For iteration, use deterministic checks (lint, adherence) not LLM scoring.** (Experiments #86-90, full audit)

## Codebase Maintenance

### Dead agent dirs accumulate — audit periodically via `agentName:` grep cross-reference (2026-04-07)
Cleanup pass on 2026-04-07 found three fully dead agent directories that had been sitting in `src/agents/` with no production callers: `cross-chapter-continuity` (87 historical calls, all from benchmarks/scripts), `prose-quality` (284 historical calls, all from benchmarks), `lint-rewriter` (orphan with only a `prompt.md`, 6 ancient calls). Plus an orphaned `benchmark/continuity/` directory whose `generate.ts` had a hard `readFileSync` import on the deleted prompt and would have crashed at module load.

The pattern: agent dirs accumulate when an agent is removed from the runtime pipeline but its directory + `models/roles.ts` entry + `src/agents/index.ts` re-export + UI grouping + activity panel label + logger phase map + benchmark target are all left in place. None of those references break the build individually — typecheck passes, the file just exists as dead weight. Over time the agent inventory drifts away from the actual pipeline.

**The audit recipe** that found them:
1. `ls src/agents/` to enumerate agent directories
2. For each agent name, `Grep` for `agentName:\s*["']<name>["']` across `src/` to find `callAgent` call sites
3. Cross-reference against `models/roles.ts` entries — anything in roles.ts without a real call site is a candidate
4. Cross-reference against `src/phases/*.ts` — these are the only places live agents get called from (`src/state-extraction.ts` was removed 2026-04-13 when LLM extractors were retired)
5. Query `llm_calls` for last call timestamp per agent — anything where the most recent call is from a benchmark or script (not a phase) is suspect
6. Check the cleanup blast radius: every dead agent has references in `src/agents/index.ts`, `src/prompts.ts`, `src/types.ts` (schema re-export), `src/orchestrator/novel-routes.ts` (UI grouping), `src/logger.ts` (PHASE_MAP), `ui/src/components/ActivityPanel.tsx` (STEP_LABELS), and possibly `models/roles.ts` and `benchmark/registry.ts`. Grep for the agent name across all of them before deleting.

After the cleanup, run `bunx tsc --noEmit` to catch any transitive imports you missed (this is how the orphaned `benchmark/continuity/generate` import in `benchmark/registry.ts` got found), and `bun build src/index.ts && bun build src/orchestrator/server.ts && bun build benchmark/registry.ts` to verify the three main entry points still bundle clean.

**Recurrence cost**: low — maybe 30 minutes every few months. Worth doing whenever the agent count in `models/roles.ts` feels larger than what you'd describe to someone if asked. The CLAUDE.md agent inventory drifted from reality between commits even though the file is meant to be the canonical description; treat any "list of agents" doc as a snapshot that gets stale, not a source of truth. (Cleanup commit forthcoming, deleted: `src/agents/cross-chapter-continuity/`, `src/agents/prose-quality/`, `src/agents/lint-rewriter/`, `benchmark/continuity/`)

## Experiment Design

### Always commit code changes BEFORE running experiments
`createTuningExperiment()` captures the git commit hash automatically. If you run experiments against uncommitted changes, the hash points to the wrong code and the experiment can't be reproduced. (Rule #8 in CLAUDE.md, implemented commit bd2d3c4)

### Transport defaults matter — check responseFormat
The transport layer defaults to `response_format: { type: "json_object" }`. If your LLM call expects plain text (e.g., a fixed sentence), you must pass `responseFormat: { type: "text" }` explicitly. Otherwise the model returns JSON schema metadata instead of content. (Experiment #70 — all "fixes" were `{"type": "object"}`)

### Bracket characters in rubrics break JSON extraction
`extractJSON()` finds the first `{` or `[` in the response. If the rubric text contains square brackets (like `"a flicker of [emotion]"`), and the LLM echoes that in preamble text, the extractor grabs the wrong bracket. Use parentheses in rubrics: `"a flicker of (emotion)"`. (Dead-weight judge failure in experiments #45, #46 → commit ea4b3a1)

### Measure what the intervention actually changes, not downstream proxies
When testing lint fixes, measuring judge penalty deltas is noisy and indirect. Measuring lint compliance (did the flagged pattern disappear?), collateral damage (what else changed?), and word count delta gives direct, reproducible signal. Judge scores are useful for evaluating overall prose quality but not for evaluating mechanical edits. (Progression from experiments #45-46 through #67-69)

### Character-level diff is useless for measuring edit precision
A positional character comparison counts every character shifted by an earlier edit as "changed." Removing 5 characters at position 100 in a 8,000-character text shows 99% collateral because positions 101-8000 all shift. Use word-level bag-of-words diff or proper edit distance. (Experiment #68 showed 52% "collateral" for 2 word changes → fixed in experiment #69)

### Adherence-checker base-model ladder: 14B is 79%, biased over-permissive in the same direction as chapter-plan-checker (2026-04-08)

Replayed the 160-pair synthetic adherence-checker training set (`lora-data/adherence-checker-pairs.jsonl`, 20 scenarios × 8 variants) through three candidate models, scoring each verdict against the deterministic label. Single script, single run, same prompts, three providers. The point was to extend the chapter-plan-checker baseline pattern to the second-largest verdict slot in the pipeline so the SFT-vs-prompt-engineering decision has the same shape of data for both.

| variant            | Llama 3.1 8B (Groq) | **Qwen3-14B base (W&B)** | Qwen 235B (Cerebras) |
|---|---:|---:|---:|
| PASS_CLEAN         | 65% | **100%** | 100% |
| PASS_PARAPHRASE    | 45% | **100%** | 100% |
| PASS_REORDER       | 40% | 95%      | 95%  |
| PASS_ATMOSPHERIC   | 40% | **100%** | 100% |
| FAIL_MISSING       | 80% | **35%**  | 85%  |
| FAIL_CHAR          | 100%| **60%**  | 95%  |
| FAIL_SETTING       | 100%| 95%      | 100% |
| FAIL_TANGENT       | 100%| **45%**  | 95%  |
| **overall**        | **71%** | **79%** | **96%** |
| avg latency        | 491ms | **298ms** | 486ms |
| confusion (FP/FN)  | 4 / 42 | **33 / 1** | 5 / 1 |

(`tuning_experiment` id=110, `scripts/score-adherence-baseline.ts`)

**The two small models fail in opposite directions, which is the actually important finding.** Llama 8B is over-strict — 42 false fails, 4 false passes — it rejects valid creative variation (paraphrased dialogue, reordered events, atmospheric additions) at 40-65% rates while catching every fail case at ≥80%. Qwen3-14B is over-permissive — 1 false fail, 33 false passes — it never rejects a valid PASS but rubber-stamps invalid FAIL_MISSING (35%) and FAIL_TANGENT (45%) cases. The 17pp overall gap to 235B is concentrated entirely in fail-detection on three variants: MISSING (50pp gap), TANGENT (50pp gap), CHAR (35pp gap).

**This is exactly the chapter-plan-checker failure mode from exp #107.** Same model family (Qwen3-14B), same default-to-affirmative bias under flat verdict schemas, same concentration of misses on FAIL cases that require the model to commit to "this thing didn't happen." There the fix that lifted 14B from 58% → 75% was the structured checklist schema (`scripts/test-checklist-schema.ts`, exp #109) — forcing the model to write down what it observed before emitting `pass`. The mechanism transfers cleanly: every FAIL_MISSING case is one where the verdict could be conditioned on "I scanned the prose for action X and didn't find it" rather than streamed straight from prior. The natural next experiment is to apply the same checklist treatment to adherence-checker and re-score on this same 160-pair set to see if 14B can close most of the 17pp gap without any SFT.

**Implication for SFT prioritization.** Don't open an SFT data collection effort for adherence-checker until the prompt-engineering ceiling has been measured. The chapter-plan-checker pattern says +17pp is on the table for free; if it transfers, 14B lands around 96% — tied with 235B at 1.6× the speed and ~10× cheaper per token, which would close the case without training a single example. Only consider SFT if the post-checklist 14B number still has a meaningful gap on a specific failure mode.

**Methodology note — three-way ladders are worth the extra script time.** Including Llama 8B in this run cost ~5 minutes and exposed the symmetric-but-opposite failure mode (over-strict vs over-permissive). With only 14B + 235B I would have seen "14B is 17pp worse" and missed that the *direction* of the failure is what reveals the underlying mechanism (verdict-token-bias vs literal under-trained classification capacity). Always add a third anchor to baseline runs when one exists at low cost.

### Checklist schemas help on N-check tasks and HURT on 1-check tasks — adherence-checker exp #111 disconfirms a clean transfer (2026-04-08)

Direct follow-up to exp #110. Hypothesis: the structured-checklist pattern that lifted chapter-plan-checker 14B from 58% → 75% (exp #109) would transfer to adherence-checker and close most of the 17pp gap. The hypothesis was wrong, and the way it was wrong is the actual lesson.

Ran the same 160-pair labeled set through the same 3 models with a checklist system prompt forcing per-action observation: `key_actions[]` (decompose the beat, quote where each action appears or null), `setting_match`, `characters_present`, `character_behavior_consistent`, then `pass` derived from the checks. (`scripts/score-adherence-checklist.ts`, exp #111.)

| | flat (#110) | checklist (#111) | Δ |
|---|---:|---:|---:|
| Llama 3.1 8B (Groq) | 71% | **89%** | **+18pp** |
| Qwen3-14B base (W&B) | 79% | 83% | +4pp |
| Qwen 235B (Cerebras) | **96%** | 90% | **−6pp** |
| 14B latency | 298ms | 1209ms | **+306%** |
| 14B output tokens | 47 | 288 | 6× |

Per-variant flat → checklist (the headline numbers hide the real story):

| variant | Llama 8B | 14B | 235B |
|---|---|---|---|
| PASS_CLEAN | 65 → **95** | 100 → 100 | 100 → 100 |
| PASS_PARAPHRASE | 45 → **100** | 100 → 100 | 100 → 95 |
| PASS_REORDER | 40 → **90** | 95 → 95 | 95 → 90 |
| PASS_ATMOSPHERIC | 40 → **100** | 100 → 100 | 100 → 94 |
| FAIL_MISSING | 80 → 70 | 35 → **60** | 85 → 83 |
| FAIL_CHAR | 100 → 100 | 60 → **80** | 95 → 90 |
| FAIL_SETTING | 100 → 100 | 95 → 100 | 100 → 100 |
| **FAIL_TANGENT** | **100 → 53** | 45 → 30 | **95 → 67** |

**Three things happened, and they're all important.**

1. **The chapter-plan-checker mechanism did transfer to Llama 8B, just not in the direction I targeted.** Llama 8B was the over-strict one in exp #110 (4 FP / 42 FN — rejected valid PASS cases at 40-65% rates). The checklist forced it to *quote* evidence, and when it actually had to point at words on the page, it stopped over-rejecting. Bias flipped from over-strict to nearly balanced (15 FP / 3 FN). The same mechanism — structured output as a programmatic attention specifier — works *both* directions: it can rescue an under-confident model from rejecting valid cases just as it can rescue an over-permissive model from skipping checks. The match-between-mechanism-and-failure-mode determines which model benefits most from a given schema, and exp #111 had it backwards: I designed the schema to fix 14B's over-permissive bias, but the mechanism it actually delivered (force per-action quotes) helped Llama 8B's over-strict bias more. **Schemas have a "shape of attention they enforce." Match it to the failure mode you actually have.**

2. **Qwen 235B regressed from 96% to 90%, and FAIL_TANGENT collapsed for ALL three models** (Llama 100 → 53, 235B 95 → 67). This is the smoking gun. In FAIL_TANGENT the prose opens correctly and then drifts; the beat actions are "barely mentioned or happen offscreen." Under the flat schema, models made a *holistic* judgment — "the prose talked around the beat without actually executing it." Under the checklist, the field `key_actions[].quote` rewards finding *any* mention of each action. If a tangent prose contains a single sentence brushing past the action, the model writes a quote for it and marks `executed: true`. The checklist atomizes a holistic judgment into per-action presence, and the atomization throws away the meaningful-vs-nominal-execution distinction. The mechanism that gave us +17pp on chapter-plan-checker actively destroys the most nuanced judgment in adherence-checker.

3. **14B's gain was modest (+4pp) and its latency 4× worse (298 → 1209ms).** The latency win that made 14B attractive in exp #110 evaporates entirely. Output tokens went from 47 to 288. Even in the optimistic interpretation where 14B closes 4pp of the 17pp gap, the cost is 4× the response time, so the cost/perf-per-token ratio is no longer favorable vs 235B. The checklist is not a viable production swap for adherence-checker even if it accuracy-improves.

**The mechanistic principle that falls out:**

> Structured checklists help when the task is **N independent checks against discrete elements** (chapter-plan-checker: did each plan element appear in the prose? — setting, character list, beat list, all separable). They hurt when the task is **1 nuanced judgment about a single conceptual unit** (adherence-checker: was this beat *meaningfully* executed or only *nominally* gestured at?). Atomizing a holistic judgment into per-feature presence loses the "actually-vs-nominally" distinction that the holistic verdict was carrying.

The diagnostic before designing a schema: **count the number of independent things being checked.** If N > 3 and they're naturally separable (different parts of input attended to independently), checklists likely help. If the task is "is X a meaningful instance of Y" where the answer requires integration across the whole input, checklists likely hurt. Chapter-plan-checker is N=4+ (setting, characters, beats[], emotional arc). Adherence-checker is N=1 (did this beat happen well).

**Corollary on schema-shape vs failure-mode matching:** the same structured checklist had three completely different effects on three models:
- Llama 8B (over-strict baseline): **+18pp** — schema rescued an under-confident model
- Qwen3-14B (over-permissive baseline): **+4pp** — schema slightly nudged the right direction but didn't fix the underlying bias
- Qwen 235B (balanced baseline): **−6pp** — schema imposed atomization on a model that didn't need scaffolding

A schema is not universally "good" or "bad" — it has an interaction with both the task and the model's baseline calibration. Test schema changes against multiple base models to see the interaction shape, not just the strongest one.

**Implication for adherence-checker fine-tuning:** prompt engineering is now exhausted for this slot. The 17pp flat-schema gap (79% vs 96%) is the real gap, and SFT is the natural next move. The signal to train on is exactly the failure mode this benchmark exposed: 14B's per-variant misses on FAIL_MISSING (35%), FAIL_CHAR (60%), FAIL_TANGENT (45%) on the flat schema. The 235B flat-schema verdicts (96% accurate against deterministic labels) can serve as the teacher signal for a larger SFT dataset beyond the original 160 synthetic pairs. Notably, FAIL_TANGENT is the hardest variant for *every* model — even 235B drops to 95% on it, and to 67% under the checklist — so the synthetic FAIL_TANGENT data may itself be inconsistent at the edges, and SFT data quality on that variant should be hand-validated before training.

(Commits `bcc7782` baseline script, `9715b69` baseline lessons row, `ce5b2e2` checklist script; experiments #110 flat, #111 checklist)

### Reference-resolver ladder: checklist trades recall for precision — the "14B beats 235B" framing is a metric artifact (2026-04-08, amended later same day)

> **Amendment note (added after the four-task series was complete):** the original framing of this entry was "checklist gives reference-resolver a free win from prompt engineering, ship it to production." That framing is wrong. The +43pp exact-match jump on 14B is mostly a mechanical artifact of the model firing fewer lookups per beat (2.73 → 1.24), not a genuine quality lift. The real F1 lift is +0.108, but it comes at a recall cost of 29.5pp (97.5% → 68%). For reference-resolver, recall is the production-relevant metric — the writer reads extra lookups for free, and missing one is the costly failure mode. Under the actual production cost function, **flat 14B is probably the better config than checklist 14B**, despite the worse-looking exact-match number. The SFT-OFF call for this slot still stands, but for a different reason than originally given: flat 14B at 97.5% recall is already production-acceptable, so there is no real deficit to train against. The original analysis below is preserved for reference but the production-shipping recommendation in point 4 should be ignored.


Third-task data point on the baseline+checklist ladder pattern, after chapter-plan-checker (exp #107/#109) and adherence-checker (exp #110/#111). Built a synthetic 120-pair eval (`scripts/generate-reference-resolver-data.ts`, 20 scenarios × 6 variants — VAR_NONE, VAR_REL, VAR_EVENTS, VAR_LOCATION, VAR_KNOWLEDGE, VAR_MULTI) and ran it through the same three-model ladder under the production prompt and a structured-checklist prompt. Labels are deterministic from the variant — only the expected lookup TYPE set is scored, args excluded since args are judgment calls. Score is Jaccard over the type set; binary cell is exact-match (Jaccard == 1).

| | flat baseline (#114) |  | | checklist (#115) |  | |
|---|---:|---:|---:|---:|---:|---:|
| | exact | F1 | recall | exact | F1 | recall |
| Llama 3.1 8B (Groq) | 5% | 0.475 | 87.5% | **31%** | 0.522 | 60.5% |
| **Qwen3-14B base (W&B)** | 1% | 0.518 | **97.5%** | **44%** | **0.626** | 68.0% |
| Qwen 235B (Cerebras) | **23%** | 0.554 | 75.0% | 38% | 0.563 | 60.5% |
| 14B avg lookups | 2.73 | | | 1.24 | | |
| 14B latency | 493ms | | | 978ms | | |

Per-variant under the checklist (the headline numbers hide where the gains land):

| variant | Llama 8B | **Qwen3-14B** | Qwen 235B |
|---|---|---|---|
| VAR_NONE | 0 → 35 | 0 → **80** | 0 → **95** |
| VAR_REL | 5 → 15 | 0 → **55** | 5 → 25 |
| VAR_EVENTS | 0 → **85** | 5 → **60** | 40 → 40 |
| VAR_LOCATION | 0 → 0 | 0 → 10 | 25 → 15 |
| VAR_KNOWLEDGE | 0 → 10 | 0 → 25 | 15 → 35 |
| VAR_MULTI | 25 → 40 | 0 → 35 | 50 → **15** |

(`tuning_experiment` ids 114 flat, 115 checklist; `scripts/score-reference-baseline.ts`, `scripts/score-reference-checklist.ts`)

**Five things happened, and together they kill the SFT case for this slot.**

1. **The flat-schema ladder is upside-down vs adherence-checker.** Where adherence-checker had a clean 79% → 96% gap by exact match (a real calibration deficit on the smaller model), reference-resolver's flat ladder has Qwen3-14B at 1% exact-match — the LOWEST on the table. But by F1 and recall, 14B is the best of the three. The reason is that 14B fires almost every lookup type on every beat (avg 2.73 of 4 possible types per call), so its recall is 97.5% and its precision is 35%. 235B fires fewer (avg 1.89), so it gets more exact-matches but lower recall. **Exact-match was the wrong primary metric for a set-output task — recall is the production-relevant one** because the writer reads extra lookups for free and missing one is the costly failure mode (this matches the prior best-of-N finding from 2026-04-07 about why parallel-N worked for reference-resolver). By recall, the smaller models actually beat 235B at baseline; there's no calibration gap to close in the same way adherence-checker has one.

2. **VAR_NONE was 0% across all three models on the flat schema.** Every model over-fetches when the IMPLICIT_MARKERS gate fires on ambient phrasing ("after the morning meal", "since the last bell"). The default behavior under the production prompt is "fire some lookup, never an empty list." This is a UNIVERSAL bias, not a small-model bias — even 235B does it.

3. **The checklist's explicit "ambient" branch fixed VAR_NONE almost completely.** 235B went 0 → 95, 14B went 0 → 80, Llama went 0 → 35. Adding the `points_to_background: "specific_event" | "relationship_dynamic" | "location_history" | "character_knowledge" | "ambient"` enumeration step gave the model permission to write "ambient" and emit no lookup for that phrase. **The over-fetch failure mode was a missing-affordance failure, not a capacity failure — the model would have known to skip if asked, it just was never given a way to skip.** This is the *opposite* shape from the adherence-checker FAIL_TANGENT collapse in exp #111: there the checklist's atomization destroyed a holistic judgment; here the checklist's explicit branch restored a missing branch in the verdict space. Both findings are true and both are about "what does the schema actually let the model emit" — design schemas to expose the verdict options the model needs but can't reach by default.

4. **Qwen3-14B with the checklist beats Qwen 235B with EITHER schema, on F1 and exact-match.** 14B-checklist F1 = 0.626, vs 235B-checklist 0.563, vs 235B-flat 0.554. **(Amendment: this framing is misleading — see the amendment note at the top of this entry. The +43pp exact-match jump is mostly a mechanical artifact of the model firing fewer lookups per beat — 2.73 → 1.24 — not a quality lift, and the +0.108 F1 gain comes at a 29.5pp recall cost that loses on the production cost function. Do NOT ship the checklist prompt to production based on these numbers; flat 14B at 97.5% recall is the better production config.)**

5. **VAR_LOCATION stayed broken under both schemas** (10% / 0% / 15% under checklist). All three models conflate `location_events` with `recent_events` — they recognize that "where they fought before" is a reference to a past event but tag the lookup type as `recent_events` (the more general bucket). This is the only failure mode SFT could meaningfully address, and it's a 4-letter type-string distinction worth ~10pp on one variant. Not worth a training run on its own. Could be fixed with stronger few-shot examples or by collapsing `location_events` into `recent_events` in the production agent's lookup vocabulary. The latter is probably the right move — the production retrieval engine already overlaps these two types in practice.

**Cross-task pattern across the three checklist experiments:**

| task | flat 14B | checklist 14B | Δ | mechanism that worked |
|---|---:|---:|---:|---|
| chapter-plan-checker (#107/#109) | 58% | 75% | +17pp | per-element observation forces attention on each plan field |
| reference-resolver (#114/#115)   | **1%** | **44%** | **+43pp** | explicit "ambient" branch restores a missing verdict option |
| adherence-checker (#110/#111)    | 79% | 83% | +4pp  | per-action quoting helps Llama 8B but not 14B's actual bias |

The pattern that falls out:

- **Checklists win big when the failure mode is "model can't reach a verdict option that exists in the task" or "model isn't enumerating discrete elements that are independent and discoverable in the input."** Reference-resolver had both: the ambient verdict was unreachable and the multi-lookup enumeration was under-recalled.
- **Checklists fail when the failure mode is "model is biased on a 1-judgment holistic call that can't be atomized."** Adherence-checker FAIL_TANGENT is the canonical case — meaningful-vs-nominal execution is not decomposable into per-action presence checks.
- **Schema design is verdict-space design.** Before reaching for SFT, ask: does the failure mode look like a missing affordance in the output vocabulary (cheap to fix with a schema branch) or a missing capacity in the model (expensive, needs training)? The reference-resolver over-fetch was the former and we just got it for free.

**Where this leaves SFT prioritization:**

- **Reference-resolver is OFF the SFT list** — but for a different reason than originally given. Flat 14B already runs at 97.5% recall against the synthetic labels, and reference-resolver's production cost function favors recall (over-fetched lookups are nearly free, missed lookups starve the writer). There is no real production deficit to train against. The checklist is a precision/recall trade, not a strict win, and should not be shipped without a production cost analysis that says precision is worth the recall loss. Refocus SFT spend regardless.
- **Adherence-checker remains the cleanest SFT case.** Prompt-only fix gave it +4pp; the 17pp gap is real and concentrated in FAIL_MISSING/FAIL_CHAR/FAIL_TANGENT — exactly the failure modes that DON'T atomize. SFT is the right next move there.
- **Chapter-plan-checker has a partial prompt fix (+17pp) and a residual gap on MISSING_BEAT and REVERSED_ARC** — narrower SFT target than adherence-checker.
- **The next measurement candidate** is `continuity` — currently on 235B, also a structured analytical agent, also a candidate for the multi-task LoRA mentioned in the f21f3db strip-commit message. Same baseline+checklist ladder applies. This is the right next experiment before opening any SFT data collection.

**Methodology lessons compounding from this run:**

- **Run the baseline ladder before designing the schema treatment.** I went into #115 expecting the checklist to "expand recall via per-phrase enumeration" — exactly the wrong mechanism, because baseline #114 already showed recall was at 97.5%. The actual mechanism that mattered (the ambient branch) was a side effect I almost left out. Baseline data should drive the schema design, not the other way around.
- **Include the recall/precision/F1 trio AND exact-match in any set-output ladder.** Exact-match alone showed 14B at 1% and would have read as a damning result; the F1 view showed 14B at 0.518 vs 235B at 0.554 — practically tied. Different metrics tell different stories on set outputs and you need both to pick the right intervention.
- **Synthetic deterministic labels work for set-output tasks if you keep the metric coarse** (type-set match, no args). Worry about label noise per-variant if specific cells are anomalously low across all models — VAR_REL was suspect here (5% / 0% / 5% on flat, partly because some VAR_REL beats arguably also need recent_events) but the cross-model agreement on the noise pattern told us it was data ambiguity, not model failure on a specific cell.

(Commits `e02a150` data generator, `a670170` baseline script, `a1b5170` checklist script; experiments #114 flat, #115 checklist)

### Continuity ladder: schema gives 235B its best F1 of any task — but the eval ceiling exposes the real bottleneck (2026-04-08)

Fourth-task data point on the baseline+checklist ladder pattern, after chapter-plan-checker (#107/#109), adherence-checker (#110/#111), and reference-resolver (#114/#115). Continuity is the highest prompt-token cost agent in the pipeline (~7,300 in/call on production Cerebras Qwen 235B), so the SFT-EV question is largest here. Built a synthetic 120-pair eval (`scripts/generate-continuity-data.ts`, 20 hand-written scenarios × 6 variants — VAR_NONE, VAR_BLOCKER, VAR_WARNING, VAR_NIT, VAR_TRAP, VAR_MULTI) and ran it through the same three-model ladder under the production prompt and a structured-checklist prompt. Each scenario hand-specifies its planted-issue strings (blocker/warning/nit/trap-phrase) so the LLM-rewrite step is surgical. Labels are deterministic from the variant — only the expected severity SET is scored (specific issue text and conflictsWith are judgment calls and not scored). Score is Jaccard over the severity set; binary cell is exact-match (Jaccard == 1).

| | flat baseline (#117) |  | | checklist (#118) |  | |
|---|---:|---:|---:|---:|---:|---:|
| | exact | F1 | recall | exact | F1 | recall |
| Llama 3.1 8B (Groq) | 20% | 0.405 | 51.2% | **33%** | 0.415 | 41.7% |
| Qwen3-14B base (W&B) | 30% | 0.440 | 48.1% | **43%** | 0.347 | 21.9% |
| **Qwen 235B (Cerebras)** | **52%** | 0.469 | 35.0% | **54%** | **0.555** | 45.0% |
| 235B FP-calls (NONE+TRAP, /40) | 0 | | | 0 | | |
| 14B FP-calls (NONE+TRAP, /40) | 26 | | | **0** | | |
| 8B  FP-calls (NONE+TRAP, /40) | 34 | | | 24 | | |

Per-variant under the checklist:

| variant | Llama 8B | Qwen3-14B | **Qwen 235B** |
|---|---|---|---|
| VAR_NONE     | 5 → 40   | 40 → **100** | 100 → **100** |
| VAR_BLOCKER  | 60 → 90  | 80 → 50      | 85 → 75       |
| VAR_WARNING  | 0 → 16   | 0 → 5        | 0 → 10        |
| VAR_NIT      | 0 → 0    | 15 → 0       | 10 → **35**   |
| VAR_TRAP     | 25 → 40  | 30 → **100** | 100 → **100** |
| VAR_MULTI    | 30 → 11  | 15 → 0       | 15 → 5        |

(`tuning_experiment` ids 117 flat, 118 checklist; `scripts/score-continuity-baseline.ts`, `scripts/score-continuity-checklist.ts`)

**Five things this run actually tells us, and only one of them is "schema wins":**

1. **The ladder is intact under both schemas, unlike reference-resolver.** 235B leads on every metric in both runs (52→54% exact, 0.469→0.555 F1). Qwen3-14B does NOT beat 235B here under any condition — different from reference-resolver, where the checklist inverted the ladder. The "free-win-from-prompt-engineering" pattern from #115 does not generalize: continuity's failure mode is not a missing-affordance/over-fetch problem, it's an actual under-detection problem that smaller models can't bluff their way out of.

2. **Checklist gives 235B its best F1 of any task in the four-experiment series** (0.555). The mechanism: by walking each fact and each character state explicitly before deriving issues, 235B's recall jumps 35.0 → 45.0% while precision only drops 70.8 → 72.4 (precision actually *improves* slightly because the figurative_review step removes spurious flags). Production should consider the checklist prompt for the continuity slot — the +0.086 F1 lift on 235B is the largest single-model F1 improvement from any schema swap so far, even though the headline exact-match number barely moves.

3. **Qwen3-14B with the checklist is a precision/recall *trade*, not an improvement.** Exact-match goes 30 → 43% (+13pp), but F1 *drops* 0.440 → 0.347 because recall collapses 48.1 → 21.9%. The checklist makes 14B drastically more conservative — false positives go from 26/40 to 0/40 (perfect precision on empty-expected variants), but blocker detection drops 80 → 50% and the model emits an average of 0.26 issues per call (vs 1.38 on flat). The checklist gives 14B *Llama-on-flat behavior in reverse*: it's now under-confident across the board. The +13pp exact-match jump comes entirely from the NONE/TRAP variants going to 100% — not from improved issue detection. **Headline exact-match alone would mislead here**; F1 is the truth.

4. **WARNING detection is broken across all six model/schema combinations** (0–16% exact-match), and NIT detection is broken on 5 of 6 (0–15%, with 235B-checklist the lone exception at 35%). This is the headline finding for the SFT prioritization question: **the bottleneck on continuity is not "14B vs 235B", it's "any model vs subtle severity distinctions."** Even production 235B with the best schema misses 90% of warnings (timeline/travel-time/characterization drift) and 65% of nits (description/name/object drift). Distilling 235B into 14B would replicate exactly this failure mode, because 235B itself doesn't see them.

5. **TRAP is a clean win for the checklist on the larger models.** 14B and 235B both go to 100% on the figurative-language trap variant under checklist (vs 30% / 100% on flat — 14B was the broken one). The explicit `figurative_review` classification step is the mechanism: it forces the model to label "the firelight made shadows climb the walls like slow black animals" as figurative *before* it can reach the issues list, and the model takes the offered branch every time. This is the same shape as the reference-resolver "ambient" branch — give the model a way to say "no issue" and the over-flag goes away. Llama 8B doesn't take the branch as reliably (40%) — small-model attention drift, not a verdict-space gap.

**Cross-task pattern across all four checklist experiments:**

| task                          | flat best | checklist best | Δ exact | best-model F1 Δ | shape                                    |
|---|---:|---:|---:|---:|---|
| chapter-plan-checker (#107/#109) | 58%       | 75%            | +17pp   | n/a             | partial — both 14B and 235B improved      |
| reference-resolver (#114/#115)   | 23%       | 44% (14B)      | +21pp   | +0.108 (14B)    | recall→precision trade, mostly metric artifact (see entry's amendment note) |
| adherence-checker (#110/#111)    | 67%       | 71%            | +4pp    | flat            | schema didn't move the needle             |
| **continuity (#117/#118)**       | **52%**   | **54%**        | **+2pp**| **+0.086 (235B)** | **modest exact-match, big 235B F1 gain** |

The pattern across the four-task series:

- **Chapter-plan-checker, reference-resolver, adherence-checker**: the checklist's effect lands mostly on the 14B side. Either 14B closes most of the gap (chapter-plan), trades recall for precision in a way that *looks* like an inversion on the wrong metric (reference), or barely moves (adherence). The reference-resolver "inversion" was a metric artifact — recall is the production-relevant metric there and the checklist drops it 29.5pp.
- **Continuity is the first task where the checklist's biggest win is on 235B itself, not on 14B.** The reason is that 14B doesn't have the underlying continuity-checking capacity to take advantage of structured walking — it just becomes more conservative and emits fewer issues. 235B does have the capacity, and the checklist gives it a place to use it.
- **All four tasks have a different "shape" of how the checklist interacts with the ladder.** There is no universal "checklists are good" lesson — design schemas against the specific failure mode of the specific model on the specific task. The four-task series strongly disconfirms the idea that any one schema-shape generalizes across structured-analytical agents.

**What this means for SFT prioritization:**

- **Continuity is NOT a clean SFT case in its current form**, because the teacher signal (235B at 54% exact / F1 0.555) is itself missing 90% of warnings and 65% of nits. Distilling that teacher would teach the student to also miss them. Before SFT can work for this slot, we need a stronger labeling pipeline. The right teacher for offline data generation is **Claude (Opus or Sonnet 4.6)**, not gpt-oss-120b — gpt-oss is roughly peer-tier with 235B on this task and won't catch the warnings/nits 235B is missing. Cost is irrelevant at the scale we'd actually need: ~1000 hand-labeled training pairs at ~3K in / 1K out costs ~$120 with Claude Opus, ~$15 with Claude Sonnet. Run-once-and-use-forever — institutional inertia (gpt-oss is "in the pipeline already") is not a good reason to use a weaker teacher for offline SFT data.
- **The right next move on continuity is the checklist prompt swap on 235B in production**, not training. +0.086 F1 is the cheapest improvement on the table. Latency cost is 389ms → 638ms (~1.6×) and output tokens 59 → 380 (~6×) — well within the per-chapter budget for the highest-cost-per-call agent in the pipeline.
- **Adherence-checker remains the cleanest SFT case across all four tasks.** Its teacher signal (235B at 96% on flat) is still the cleanest distillation target, the failure mode is concentrated in non-atomizable variants, and the gap is real and not closable by prompt engineering. SFT spend should focus there.
- **The four-task series is now complete enough to prioritize SFT spend.** Order: (1) chapter-plan-checker — already done, validated in #107; (2) adherence-checker — clean teacher, real gap, ship next; (3) continuity — fix teacher quality FIRST, then revisit; (4) reference-resolver — OFF the list, prompt-only fix is sufficient.

**Methodology lessons compounding from this run:**

- **Headline exact-match is the wrong primary metric on multi-class severity tasks.** Continuity's exact-match table reads "checklist gives a small lift", but the F1 view tells a much more interesting story — 235B's F1 jumps 0.469 → 0.555 (best-of-series) while 14B's F1 collapses 0.440 → 0.347 because the same schema makes one model use its capacity and makes the other model freeze. Always report both.
- **Empty-expected variants (NONE, TRAP) should be reported as false-positive *call counts*, not as exact-match cells.** A model that emits zero issues on NONE always scores 100% on that cell, hiding the false-positive *rate*. The FP-call counter (`falsePositiveCalls` in the conclusion JSON) makes the trade visible: 14B-checklist is 0/40 vs 14B-flat 26/40 — that's the entire +13pp exact-match jump on 14B, and it doesn't reflect a single new correct issue detection.
- **A bench is only as good as its hardest variant.** Continuity's bench has WARNING and NIT detection at 0–35% across all six runs. Either the synthetic injections are too subtle for the production prompt's rubric to catch, or the rubric itself is under-specified on those severities. Before drawing any SFT conclusion from this bench, those two variants need re-examination — they may be measuring "task fundamentally hard" rather than "model deficit."
- **Continuity and adherence-checker have *opposite* strong models.** Adherence (#110): 235B is over-strict, 14B is over-permissive. Continuity (#117): 235B is over-conservative (under-flags warnings/nits but never false-positives), 14B is over-aggressive (flags everything but lower precision). The same ladder produces opposite biases on different tasks — *another* reason no universal "best base model" exists for analytical agents.

(Commits `d09bcd2` data generator, `7a7044a` baseline script, `916fd63` checklist script; experiments #117 flat, #118 checklist)

> **Superseded 2026-04-19:** This section describes the pre-retirement SFT approach for chapter-plan-checker. `chapter-plan-checker-v2:v1` was retired 2026-04-18 (see `docs/decisions.md` "Chapter-plan-checker-v2:v1 SFT adapter retired") after a production FP audit found ~92% false-positive rate on real fantasy plans despite 96% accuracy on synthetic eval. The slot now runs DeepSeek V3.2 base with the same `plan-adherence-system.md` prompt. The non-blind-retry architecture (targeted rewrites → `chapter-plan-reviser` → plan-assist gate) replaces the blind-restart pattern discussed here. See `docs/exhaustion-handler-design.md`.

### Chapter-plan-checker teacher head-to-head: gpt-oss-120b beats Qwen 235B by 9pp, the right teacher is task-specific (2026-04-08)

Follow-up to the four-task ladder series. Exp #107 measured base Qwen3-14B against gpt-oss-120b (the production chapter-plan-checker model) on the 80-pair synthetic eval and got 58% agreement — but **Qwen 235B was never in that ladder**. Earlier in this session I had been claiming gpt-oss-120b is "roughly peer-tier with Qwen 235B" based on the continuity baseline. That claim turns out to be wrong on chapter-plan-checker, and the way it's wrong matters for the SFT teacher decision.

Ran a 4-model ladder (Llama 8B / Qwen3-14B base / gpt-oss-120b / Qwen 235B) against the same 80 pairs with the same flat production prompt. (`scripts/score-chapter-plan-baseline.ts`, `tuning_experiment` id=119.)

| variant | Llama 8B | Qwen3-14B base | **gpt-oss-120b** | Qwen 235B |
|---|---:|---:|---:|---:|
| PASS_CLEAN | 80% | 100% | 80% | 100% |
| PASS_PARAPHRASE | 90% | 100% | 100% | 100% |
| PASS_REORDER | 70% | 100% | 100% | 90% |
| PASS_ATMOSPHERIC | 80% | 100% | 100% | 100% |
| FAIL_MISSING_BEAT | 20% | **0%** | **50%** | **10%** |
| FAIL_MISSING_CHAR | 40% | 10% | 100% | 80% |
| FAIL_REVERSED_ARC | 60% | 10% | 80% | 70% |
| FAIL_WRONG_SETTING | 80% | **0%** | 100% | 100% |
| **overall** | **65%** | **53%** | **90%** | **81%** |
| latency | 357ms | 204ms | 1575ms | 431ms |
| confusion (FP/FN) | 20/8 | **38/0** | 5/2 | **14/1** |
| errors | 0 | 0 | 9 | 0 |

**Three things this run actually tells us:**

1. **gpt-oss-120b is empirically the right teacher for chapter-plan-checker, not just the incumbent.** It beats Qwen 235B by 9pp overall and **by 40pp on FAIL_MISSING_BEAT** — the hardest variant for every model. The 'institutional inertia' worry I'd been carrying ("we use gpt-oss because it's already in the pipeline, not because it's measured better") is empirically wrong. It IS measured better on the labels we have. The case for gpt-oss as the SFT distillation teacher for this slot is strengthened, not weakened.

2. **Qwen 235B has the same one-sided rubber-stamp bias as 14B on this task, just less severe.** 235B's confusion is 14 false-passes / 1 false-fail. On FAIL_MISSING_BEAT it scored 1/10 — almost completely whiffs on detecting missing beats. The same failure mode that made us escalate the production slot from Llama 8B to gpt-oss-120b is *also* present in 235B, just at a milder severity. **Distilling 235B into a 14B LoRA on chapter-plan-checker would teach the student to also rubber-stamp missing-beat cases.** This is the same mistake as the continuity case (235B missing 90% of warnings), and the diagnostic generalizes: before picking a teacher, run the teacher candidate against the deterministic eval and look at the per-variant table, not just the overall number.

3. **FAIL_MISSING_BEAT is broken across the entire ladder** (Llama 20% / 14B 0% / gpt-oss 50% / 235B 10%). The best model in the ladder catches half. This is the variant that needs the most attention, and the explanation is one of three: (a) the synthetic FAIL_MISSING_BEAT injections are too subtle, (b) all models genuinely struggle with this judgment because "beat is missing" requires negative-evidence reasoning (proving absence), (c) the rubric is under-specified. Most likely a mix of (b) and (c) — proving absence in a 1500-word chapter is exactly the kind of attention task LLMs are weak at, and the production prompt's false-positive guidance ("paraphrased, reordered, atmospheric details are NOT deviations") may bleed into "we err on the side of PASS" more strongly than intended. **The selective-teacher pipeline is now load-bearing for this slot**: bulk labeling via gpt-oss + manual escalation for FAIL_MISSING_BEAT cases is not optional — it's the only way to get clean training data on the failure mode the SFT is supposed to fix.

**Cross-task teacher table** — extending the four-task ladder series with this finding:

| task | best teacher | overall accuracy | hardest variant accuracy | next step |
|---|---|---:|---:|---|
| adherence-checker | **Qwen 235B** | 96% | FAIL_TANGENT 95% | SFT distillation, 235B as teacher |
| chapter-plan-checker | **gpt-oss-120b** | 90% | FAIL_MISSING_BEAT 50% | SFT distillation, gpt-oss as teacher + manual escalation for MISSING_BEAT |
| reference-resolver | flat 14B | 97.5% recall | — | OFF the SFT list, recall is already production-acceptable |
| continuity | **Claude (Sonnet/Opus)** | TBD — 235B at 35% recall, gpt-oss not measured | WARNING 0% / NIT 0-35% | BLOCKED, need stronger teacher than 235B before training |

**The general principle that falls out:** the "right teacher" varies per analytical task because each task has a different failure-mode-distribution and different model strengths. A single multi-task LoRA distilled from a single teacher across all four agents would be a strict downgrade vs per-task teacher selection. The four (now five) per-task baseline-vs-teacher experiments are the minimum diligence before any SFT spend.

**Methodology lessons compounding from this run:**

- **Run the teacher against the labels, not just the candidate.** Exp #107 measured 14B vs gpt-oss outputs and got 58% — that conflated "14B is wrong" with "14B disagrees with the teacher who happens to be wrong on the same cases." The actual 14B-vs-label number is 53%, and the actual gpt-oss-vs-label number is 90%. The 5pp shift on 14B is small but the gpt-oss number is what tells you whether the teacher is worth training against. Always score every model in the ladder against the deterministic gold, not against another model.
- **One-sided FP/FN confusion is a leading indicator that this slot needs SFT *and* a leading indicator of the failure mode the SFT must fix.** 14B base on chapter-plan-checker is 38 FP / 0 FN — the model literally cannot say FAIL on this task. Same shape as the adherence-checker 14B baseline (33 FP / 1 FN). When you see one-sided confusion, the SFT target is "teach the model to commit to the negative verdict" — and the training data should be heavily weighted toward FAIL examples that the teacher itself reliably catches.
- **Always include the production model in the ladder even if you "already know it works."** I almost didn't put gpt-oss in this script because "we know it's the production model, the question is the teacher comparison." Putting it in revealed the 9-error / max-token issue in its current configuration AND gave us the actual head-to-head against 235B. The cost was zero (one extra column in MODELS array) and the upside was the entire SFT teacher decision.

(Commit `df63138` baseline script; experiment #119)

### Per-API-call decomposition: orthogonal facets win, items-of-same-type lose — adherence +12pp, chapter-plan −26pp on the same intervention (2026-04-08)

Same week as the four-task ladder series (#107-#119), tested per-API-call decomposition on two different analytical agents. Same intervention shape ("split one LLM call into N parallel calls, aggregate FAIL if any fires"), opposite outcomes. The split is sharper than the existing "atomization helps for N independent checks" lesson — *the shape of N matters*, not just the count.

**Adherence-checker — clean win** (`scripts/score-adherence-decomposed.ts`, exp #122). Replaced the single LLM call (which asked "events present? right setting? characters in role?" in one prompt and entirely lacked a slot for FAIL_TANGENT) with **four parallel calls**, one per failure mode:

- `events`    — "Quote the passage where the beat's action happens. Off-page references don't count." (positive evidence quoting)
- `setting`   — "Does the prose's setting match the expected setting? Quote actual vs expected."
- `tangent`   — "Estimate off-spec fraction. Quote off-spec passages." (the failure mode the production prompt was missing entirely)
- `character` — "Quote any line where a character acts contrary to their role."

Aggregate: PASS only if all four return clean. Same 160-pair eval as #110/#111.

| model | #110 flat | #111 checklist | **#122 4-call** | Δ vs flat |
|---|---:|---:|---:|---:|
| Llama 3.1 8B | 58% | 59% | **76%** | **+18pp** |
| Qwen3-14B base | 79% | 68% | **91%** | **+12pp** |
| Qwen 235B | 96% | 79% | **97%** | +1pp |

PASS variants stayed near-100% on 14B and 235B (no over-firing — meaningful-vs-nominal collapse from #111 did NOT re-emerge). FAIL_TANGENT — the failure mode I identified as orphaned by the production prompt — went from undermeasured to **100% on Llama and 235B, 90% on 14B** with the dedicated tangent slot. FAIL_SETTING is 100% across all three models.

**Chapter-plan-checker — regression** (`scripts/score-chapter-plan-perbeat.ts`, exp #123). Same intervention shape: replace the single "compare prose vs plan" call with **N parallel per-beat calls**, where N is the number of beats in the chapter (~4). Each call asks "is THIS specific beat enacted on the page?" with positive-evidence quoting. Aggregate FAIL if any beat returns absent. Same 80-pair eval as #119, same 4-model ladder.

| model | #119 single-call | **#123 per-beat** | Δ |
|---|---:|---:|---:|
| Llama 3.1 8B | 23% | 55% | +32pp |
| Qwen3-14B base | 42% | 63% | +21pp |
| **gpt-oss-120b** | **90%** | **64%** | **−26pp** |
| **Qwen 235B** | **81%** | **72%** | **−9pp** |

Per-beat **helps the small models, hurts the strong ones**. The regression on gpt-oss is the load-bearing finding — that's the production teacher and the SFT target. PASS_REORDER cratered to 22% on gpt-oss (reordered beats look like missing beats to an isolated checker because the model expects beat N at position N). FAIL_MISSING_BEAT — the variant the experiment was *designed* to fix — only modestly improved (50% → 60% on gpt-oss, 10% → 30% on 235B).

**Why one wins and the other loses — three mechanisms:**

1. **N-beat compounding error.** Adherence has *one* judgment per pair, decomposed into 4 facets that each fire independently. Chapter-plan has *N* items of the same type (beats), and aggregation is OR — if ANY beat is wrongly marked absent, the whole pair flips to FAIL. Even a 90% per-beat accuracy compounds to 0.9⁴ = 66% pair-level on 4-beat chapters. That's almost exactly the gpt-oss collapse (90% → 64%). False-positive rate on "is this beat present" is the killer because it scales multiplicatively with N.

2. **Cross-item reasoning is invisible to per-item decomposition.** FAIL_REVERSED_ARC scored 0-22% across all four models in #123 — the per-beat checker can't see that the *direction* of emotional change is wrong because each beat is judged in isolation. The reversal is a property of the *sequence*, not any single beat. Adherence-checker doesn't have this problem because each of its 4 calls covers a different aspect of the *same* judgment, not a different item in a sequence.

3. **The "no quote → FAIL" framing has an asymmetric effect by model strength.** Strong models (gpt-oss, 235B) treat the positive-evidence requirement strictly and over-fire on absence when paraphrase, reordering, or atmospheric expansion makes the beat hard to quote literally. Weak models (Llama 8B, 14B base) couldn't reliably emit FAIL anyway, so the quote requirement *gives them structure* and lifts their floor. Result: per-beat compresses the spread between strong and weak models. For adherence (where the weakest is also the deployment candidate for SFT), compression is the goal. For chapter-plan (where the strongest is the production model), compression is a regression.

**The taxonomy this falls into:**

| Task shape | Example | Decomposition outcome |
|---|---|---|
| 1 holistic judgment, N orthogonal failure modes | adherence-checker (events / setting / tangent / character) | **Win** — each call gets a tailored prompt direction and an attention budget |
| N items of same type, OR aggregation | chapter-plan-checker (beats), continuity (facts) | **Lose** — compounding error blows up false positives, cross-item reasoning is invisible |
| N items of same type, recall-weighted aggregation | reference-resolver (lookups, set union) | **TBD** — recall-weighted aggregation may avoid the compounding-error trap; haven't tested |

**Implications for the four-task SFT prioritization:**

- **Adherence-checker SFT urgency drops dramatically.** The 14B base on the *decomposed* prompt is 91%, not 79%. The gap to the 235B teacher (97%) is now 6pp, not 17pp. SFT may not be needed at all if 91% is acceptable for the production slot. If SFT still happens, the teacher signal should come from the decomposed 235B (97%), not the flat one.
- **The decomposed prompt is the new production prompt for adherence-checker.** Cheapest improvement on the table. Wired into `src/agents/writer/adherence-checker.ts` as 4 parallel calls; latency unchanged (parallel) but per-pair token cost ~3-4× because each call has its own system prompt.
> **Superseded 2026-04-19:** The guidance below ("chapter-plan-checker stays on single-call gpt-oss-120b") reflects pre-retirement state. `chapter-plan-checker-v2:v1` was trained and deployed (exp #178) then retired 2026-04-18 after ~92% FP rate on real fantasy plans. The slot now runs DeepSeek V3.2 base; blind-restart patterns replaced by the non-blind-retry architecture. See `docs/decisions.md` and `docs/exhaustion-handler-design.md`.

- **Chapter-plan-checker stays on single-call gpt-oss-120b.** Per-beat is NOT the production swap. SFT distillation from gpt-oss-120b on the existing 80 synthetic pairs is still the path. The per-beat experiment is a useful disconfirmation, not a regression we deploy.
- **The "atomization helps for N independent checks" lesson from #109 is retained but refined.** The original lesson was correct *within one call* (structured checklist output schema). It does NOT transfer to *across calls* when the items being decomposed are sequential same-type items rather than orthogonal facets.

**Methodology notes:**

- **Smoke run with 16 pairs is enough to catch a missing slot.** The 3-call adherence smoke (before the SETTING slot was added) showed 0/2 FAIL_SETTING catches across 14B and 235B and a 235B regression from 96% → 88%. Adding the 4th slot (~10 lines of code) and re-running fixed it. Smoke runs are the right time to find these gaps — full runs would have shown the same regression at 8× the cost.
- **The smoke run can also be misleading in the *positive* direction.** The 16-pair chapter-plan-perbeat smoke showed 235B at 94% — wildly better than the full 80-pair number (72%). Random sampling can produce variant distributions that hide the failure modes. Always validate gains on the full eval before drawing conclusions.
- **"Same intervention, opposite outcome" is the most useful kind of experiment.** The adherence/chapter-plan A/B forced the question *why one wins and the other loses* — which is what produced the orthogonal-facets-vs-items-of-same-type taxonomy. A single-task experiment would have produced a single-task lesson; the two-task experiment produced a transferable principle.

(Commits `0fe9c6c` (both scripts), `6a7e211` (4th setting slot); experiments #122 adherence, #123 chapter-plan)

### Synthetic eval false-positive rate underestimated production by ~25× — distribution shift on inherited setting and atmospheric prose (2026-04-08)

The 4-call adherence-checker decomposition (`src/agents/writer/adherence-checker.ts`, exp #122 — see entry above) was shipped to production and validated on a 3-chapter `romance-drama` run. The synthetic eval predicted 1.3% false-fail rate on PASS variants for 235B and 2.5% for 14B. Production reality on the very first run: **13/23 beat-attempts (57%) had a slot fire**, all of them from `setting` (8) and `tangent` (6) — `events` and `character` were silent. Tokens used 252K vs an expected ~150K for a clean 3-chapter run because the writer was being asked to redo good prose.

This is the largest distribution gap I've seen between a synthetic eval and production behavior on the same task. Two specific prompt-to-distribution mismatches caused it, and both are instructive:

**1. Setting slot fired on mid-chapter beats because real prose inherits setting from prior beats.**

The synthetic generator (`scripts/generate-adherence-data.ts`) constructs each PASS pair as a single beat with a single fully-stated prose passage that includes explicit place markers (because the prose was generated from one beat with full context). The slot's prompt accordingly contained:

> If the prose has no clear setting at all (purely abstract or interior monologue with no place markers), return setting_matches=false with reasoning noting the absence.

That rule was harmless on the synthetic eval (every PASS pair had explicit setting). In production, the beat-writer's context only injects setting on "beat 0 or detected location change" (per `src/agents/writer/beat-context.ts`). For beats 1, 2, 3 of a chapter, the prose continues the inherited setting and may have **zero** explicit place markers — pure dialogue, character interiority, close action. The slot interpreted "no setting markers" as "setting absent → mismatch" and fired on every mid-chapter beat that didn't bother to re-establish location. The synthetic eval could not have caught this because the synthetic distribution had no examples of mid-chapter beats inheriting setting.

**2. Tangent slot fired on legitimate atmospheric/interiority because the 40% off-spec threshold was calibrated against synthetic prose that didn't have much of either.**

The synthetic PASS variants (PASS_CLEAN, PASS_PARAPHRASE, PASS_REORDER, PASS_ATMOSPHERIC) have a relatively narrow stylistic range — they're all rewrites of one beat. Real beat-writer output (Cerebras Qwen 235B at temperature 0.7) produces prose with substantially more atmospheric description, character interiority, sensory grounding, and dialogue digression. By the model's read, that easily crossed the prompt's "more than ~40%" threshold for `is_tangent=true`. PASS_ATMOSPHERIC was the closest synthetic analogue and even it sat well under the threshold; production prose blew through it.

**The fix — tighten setting and tangent prompts to reflect production prose conventions:**

- **Setting:** invert from "no markers → false" to "only POSITIVE evidence of a different setting → false". Explicitly enumerate examples of real contradictions (different named location, building, indoor↔outdoor, time of day, region) and explicitly say "if the prose simply doesn't mention setting markers, return setting_matches=true." Inheritance is normal craft.
- **Tangent:** raise threshold from ~40% to ~60%, expand the "NOT a tangent" list to include atmospheric description, character interiority, sensory grounding, emotional reactions, brief implied backstory, and dialogue that develops the situation even if it digresses for a sentence or two.

events_present and character_contradiction prompts unchanged — they were silent on the first production run and remained well-calibrated.

**Result on a re-run of the same `romance-drama` 3-chapter seed:**

| Metric | Loose prompts (run 1) | Tightened prompts (run 2) | Δ |
|---|---:|---:|---|
| Beat-attempts | 23 | 18 | -22% (fewer retries) |
| Attempts with any slot fire | 13 (57%) | 4 (22%) | **-35pp** |
| `events` fires | 0 | 1 | +1 |
| `setting` fires | 8 | 3 | -5 |
| `tangent` fires | 6 | **0** | **-6 (eliminated)** |
| `character` fires | 0 | 1 | +1 |
| Tokens used | 252K | 149K | **-41%** |

All 5 firing instances in run 2 were inspected manually and **every one was a real catch**, not a false positive:
- ch1 beat 1 fired `events` AND `character` on the same incident — the writer wrote Jem lighting a stove with a lighter when the beat called for him to grab a dented stockpot and wipe fish scales off it. The retry resolved it on attempt 2.
- ch3 beat 2 fired `setting` on all 3 attempts — beat called for "The Cove Commons and Vera's Office" (indoor), writer placed it on "the tide flats by the sea, under moonlight" (outdoor). Persistent writer error, hit max retries, chapter shipped with the deviation flagged. Adherence checker did its job, the writer was the failure point.

**The methodology lesson — three things to do differently next time:**

1. **Synthetic eval false-positive rates are a lower bound, not a prediction.** Whenever the synthetic distribution is narrower than production (which it almost always is), the production false-positive rate will be higher — sometimes by an order of magnitude. The 1.3% / 2.5% numbers from #122 weren't *wrong* on the eval set, they were *uninformative* about production. Treat synthetic FP rates as "necessary but not sufficient — must validate on real prose."

2. **Always pilot a new check on a real novel before declaring a prompt-engineering experiment a "win."** Exp #122 looked clean across 480 LLM calls on the synthetic eval. The very first 3-chapter production run revealed the calibration gap in <2 minutes of compute. The pilot run is cheaper than the eval and catches things the eval can't. **A 3-chapter `romance-drama` run is now part of the standard validation flow for any production-bound checker prompt change.**

3. **Inspect prompt assumptions against the architecture, not just against the eval.** The "no setting markers → false" rule was explicitly contradicted by the beat-context.ts injection logic ("only on beat 0 or detected location change"). I should have caught that by reading the beat-context source before writing the slot prompt — the architecture itself told me mid-chapter beats wouldn't have setting markers. Reading the eval data isn't enough; you have to read the production data shape too.

**Bonus methodology finding — instrumented retries are the right way to validate a checker.** The retry-loop signal (which slot fires, on which attempt, did the next attempt clean up) is exactly the data needed to distinguish "false positive that wastes a retry" from "real catch the writer fixed" from "real catch the writer can't fix." Without per-slot logging in `llm_calls`, the only signal would have been the aggregate "did the chapter pass validation" — which would have shown PASS in run 1 too (the writer eventually produced acceptable prose), masking the 41% token bloat from spurious retries. Per-slot fields (`events_present`, `setting_matches`, `is_tangent`, `character_contradiction`) in the response_content column let us reconstruct the slot decisions retroactively — which is what made the diagnosis and fix possible in one iteration.

(Commit `d364fbd` setting+tangent prompt fixes; novels `novel-1775696018877` (loose) and `novel-1775696571250` (tightened); both on the same `romance-drama` seed for clean head-to-head)

## Prompt & Output Schema Design

### Structured checklist output beats flat verdict schemas on multi-check verification tasks — but only for fields within model capacity (2026-04-08)

Chapter-plan-checker was running on a flat schema: `{pass: bool, deviations: string[]}`. Base Qwen3-14B on W&B Inference agreed with the gpt-oss-120b oracle only 58% of the time (exp #107), with 100% one-directional bias — it rubber-stamped every FAIL case, including 0/10 on FAIL_WRONG_SETTING and 10% on FAIL_MISSING_CHAR. 14B was skipping the checks entirely and defaulting to PASS.

Swapping to a structured checklist schema that forced the model to emit per-check observations before the verdict:

```json
{
  "setting_match":      { "planned": "...", "observed": "<quote from prose>", "matches": true },
  "characters_present": { "required": [...], "found": [...], "missing": [] },
  "beats_covered":      [{ "beat_index": 1, "description": "...", "found_in_prose": true }],
  "emotional_arc_correct": true,
  "pass": true,
  "deviations": []
}
```

**Results on the same 80-pair set (exp #107 flat vs #109 checklist):**

| Metric | Flat | Checklist | Δ |
|---|---|---|---|
| 120B vs labels | 85% | 89% | +4 |
| 14B vs labels | 53% | 69% | +16 |
| 14B ↔ 120B direct | 58% | 75% | +17 |

| Variant (14B↔120B direct) | Flat | Checklist | Δ |
|---|---|---|---|
| FAIL_WRONG_SETTING | **0%** | **90%** | **+90** |
| FAIL_MISSING_CHAR | 10% | 60% | +50 |
| FAIL_MISSING_BEAT | 40% | 50% | +10 |
| FAIL_REVERSED_ARC | 50% | **20%** | **−30** |

**Why it works — three stacked mechanisms:**

1. **Sequential decoding is prior-driven until something anchors it.** When the model emits `{"pass":` as the very first field, the next token samples from its prior over verdicts given the prompt shape — and for instruction-tuned models that prior is strongly biased toward `true` (affirmative defaults, plus the prompt ended with "when in doubt, PASS"). With the checklist, by the time the model reaches the `pass` field, it has already emitted `"missing": ["Leth"]`. The verdict token is now conditioned on the model's own prior observation, not on the task framing. The gains concentrate on FAIL cases because PASS was already the default — the checklist doesn't change PASS behavior, it enables override of the PASS default.

2. **The output schema is a programmatic attention specifier.** To emit `characters_present.required: [...]`, the model has to locate the plan's character section and copy it. To emit `found: [...]`, it has to scan the prose for names. To emit `missing: [...]`, it computes a set difference between two fields it just wrote. The JSON structure mandates attention per-field — the control flow is in the schema, not in the model's choice of what to attend to. FAIL_WRONG_SETTING went 0/10 → 9/10 because in the flat schema the model never had to write down where the prose takes place; in the checklist it can't skip that field.

3. **Externalizing working memory.** Without the checklist, the model has to hold "plan has 3 characters, I saw 2, one is missing, therefore FAIL" in activations while streaming tokens toward `pass`. A 14B's working-memory capacity is limited; it drops intermediate states and falls back to priors. By writing intermediates as output tokens, an internal reasoning problem becomes a surface-level text-reading problem. The verdict token conditions on literal emitted strings (`"missing": ["Leth"]`) rather than fuzzy hidden state. This is the same mechanism that makes chain-of-thought work — the checklist is CoT with a fixed task-specific structure instead of free-form "think step by step", which is safer for non-reasoning Instruct models that haven't been tuned to produce useful CoT.

**Why FAIL_REVERSED_ARC regressed 50% → 20%:**

Same mechanism, inverted. The checklist required an `emotional_arc_correct: true|false` field — the schema gives no escape hatch. In the flat schema, a model uncertain about emotional arcs could evade by simply not mentioning them in deviations; silence served as "I don't know". In the checklist, evasion is illegal — the model MUST commit to one of two tokens.

When you force a model to answer a question beyond its capacity, it falls back to the same prior that biased it toward PASS in the first place: affirmative defaults. Every uncertain REVERSED_ARC case gets confidently stamped `true`, converting noisy-but-half-right behavior into confidently-wrong behavior.

**The design principle this produces:**

For any agent reaching a verdict by reasoning over multiple aspects of an input:

1. **Decompose the verdict into observable sub-checks.** Each sub-check field forces attention on a specific part of the input.
2. **Order checks concrete-to-abstract.** Later fields can reference earlier ones as anchors.
3. **Make the verdict the LAST field, not the first.** It conditions on the model's own observations, not on the task framing.
4. **Only include fields the model can actually answer.** Abstract fields beyond capacity become confident fabrications. When in doubt, leave them out and route those cases to a more capable model.
5. **Require grounding quotes for observations.** `observed: "<quote from prose>"` is a massive lever — it forces the model to look at specific input tokens rather than generate from prior.

Rule 4 is the one most people miss. Structured output is often framed as "just a better prompt", but it's really a **capability filter**: it exposes which fields are within model capacity and which aren't. The REVERSED_ARC regression is a feature, not a bug — the schema is telling us which checks 14B shouldn't be doing. Now we know not to include emotional-arc judgment in the 14B path at all, and to route those cases to 120B or a specifically-fine-tuned adapter.

**Secondary finding — the checklist is a free win on capable models too.** 120B went from 85% → 89% label agreement with no model change. Even models with raw reasoning capacity benefit from externalizing intermediate state — it makes reasoning more stable across runs because the logic is anchored to written tokens instead of swimming in activations. The effect is smaller for capable models (+4 vs +17) because they don't need the scaffolding as much, but it's non-zero and free. Applies to GPT-4, 120B, Qwen 235B equally — if a prompt asks for a verdict over multiple aspects, structure the output to force explicit observations first.

**Cost impact of the checklist format.** Output tokens go up 3-5× (from ~100 to ~400-500 per call). At W&B Inference rates that's still ~$0.00010-0.00015 per 14B call vs $0.0007 on 120B — an order of magnitude cheaper than the current production path. On 120B the extra output tokens are real cost (~$0.0009/call vs $0.0007), but still cheaper than the alternative of getting it wrong and having a broken chapter propagate.

**What this means for fine-tuning targets.** Structured output tells you what SFT should target. The checklist already fixes the attention failures (setting, characters) for free — SFT on those would waste budget. The remaining gap is on MISSING_BEAT and REVERSED_ARC, both of which require genuine semantic matching of narrative content against plan descriptions. SFT data for chapter-plan-checker should be concentrated on those two specific failure modes, not mixed across all variants. (Experiments #107, #108, #109; commit 749ced0)

### α = r, not α = 2r — Together AI's defaults were wrong for style tasks (2026-04-08)
The v1/v2/v3 runs on Together AI used rank 64, alpha 128 (α = 2r) because Together's platform auto-configured these defaults. The actual weight update magnitude scales as `(alpha/r) × delta_W`. At α = 2r this is 2× — effectively doubling the adapter's learning rate beyond what the nominal LR implies. For style tasks this can push the model toward overfitting faster than intended. Community consensus for Qwen3 specifically is **α = r** (e.g., r=16 → α=16) unless you have explicit evidence you need a higher update magnitude. Future training runs should use α = r as the baseline and only deviate with a reason.

### W&B's rank-16 cap is not a limiting constraint for style tasks at current data scale (2026-04-08)
W&B Inference (CoreWeave-backed) caps LoRA rank at 16. This is a hard limit: you cannot upload an adapter trained at r=32 and serve it there. However, **adapter capacity is not the bottleneck for style tasks with < 1000 high-quality examples**. The v3 improvement over v2 came entirely from data curation (removing low-contrast pairs), not from rank. At the 500–800 pair scale, rank 16 has more capacity than the training signal can fill. Only consider higher rank — and therefore a different serving provider (Together AI, Predibase) — when dataset exceeds ~1000 curated examples AND quality has plateaued on rank-16. The default plan is: train at r=16, serve via W&B.

### Data curation outperforms data volume and rank increases — the lever is contrast quality (2026-04-08, from v2→v3)
The single most impactful change across the v1→v2→v3 progression was removing low-contrast training pairs, not adding more data or increasing rank. V2 (6,423 pairs, r=64) was _worse_ on word count than base because low-contrast pairs (where the bland version was nearly identical to the Howard source) taught the model "output ≈ input." V3 (4,497 curated pairs, same rank) fixed this by scoring pairs on edit distance + vocabulary divergence + sentence-length shift and dropping the bottom 30%. **When style signal is weak, the first question is not "add more data" or "increase rank" — it is "does every training pair show a clear stylistic contrast between input and output?"** This applies to any style fine-tune, not just Howard. (See `docs/lora-style-transfer-report.md` §10.6–10.7 for metrics)

### Add KL regularization during SFT for style tasks — β=0.05 prevents capability drift without constraining learning (2026-04-08)
Standard SFT on style data can silently degrade general capability by 5–10% because style changes are pervasive (every token). KL-anchored SFT adds a penalty term: `Loss = CrossEntropy + β × KL(fine-tuned || reference model)`. At β=0.05 this keeps the adapter close to the base distribution while still learning style patterns; published results show degradation drops to < 1%. The cost is negligible (frozen reference model runs in parallel). For v1–v3 runs this wasn't applied; add it to any future Qwen3-14B training run. Implementation: TRL `SFTTrainer` with `ref_model` argument, or Unsloth with a custom trainer wrapper. At 1 epoch and < 500 pairs the drift risk is lower, so this matters more for longer training runs or larger datasets. (Derived from community Qwen3 SFT guides; see `docs/lora-style-transfer-report.md` §11.3)

### Bigram perplexity is the right primary metric for style transfer evaluation — not vocabulary classifiers (2026-04-08, confirmed in §10.8)
When evaluating whether a LoRA-tuned model has learned a target style, bag-of-words vocabulary classifiers can produce misleading rankings. In the v3 evaluation, the base model scored _higher_ than V3 on the style classifier because its ornate vocabulary happened to overlap with Howard's word inventory — even though the base model arranged those words in AI-typical patterns. The bigram perplexity metric (a language model trained on the target author's corpus) correctly identified V3 as closer to Howard because it measures word-to-word transition patterns, not just word occurrence. **For style evaluation: bigram perplexity > vocabulary classifier > BLEU/ROUGE. Supplement with BERTScore for content preservation.** (§10.8; also confirmed by community results on text style transfer benchmarks)

### Training loss < 0.2 is an overfitting signal — stop before it (2026-04-08)
Across style fine-tuning literature and community runs, training loss dropping below 0.2 indicates the model is memorizing training examples rather than generalizing the style distribution. The practical consequence is a model that rewrites inputs to look like training examples rather than applying the style principles. Use the checkpoint with the best validation loss, not the final checkpoint. For a 500-pair dataset at 1–2 epochs, loss typically bottoms out around 0.4–0.7 on style tasks; if it approaches 0.2, reduce epochs or increase the general-example dilution ratio.

### W&B ART `train_sft_from_file` submits async — the local script exits before training completes (2026-04-08)
`train-lora.py` calls `await train_sft_from_file(...)` expecting it to block until the remote GPU job finishes. It doesn't — the call returns immediately after job submission (confirmed: local script exited after 9 seconds; remote H200 ran for 37 minutes). Consequences:
1. The `model.get_inference_name()` call that prints the correct serving URI never executes.
2. The trained adapter is stored under `<name>-sft-resume:vN` artifacts (one per checkpoint), NOT under `<name>:latest`. The `<name>:v0` artifact that W&B uploads at submission time is an **identity LoRA** (mathematically the base model) — and `:latest` stays pointing at it forever unless you explicitly update the alias.
3. Every benchmark run against `wandb-artifact:///<entity>/<project>/<name>:latest` was hitting the identity LoRA, not the trained weights.

**Fix:** after a training job completes, use `<name>-sft-resume:latest` (or the specific final checkpoint version, e.g. `:v8`) as the inference URI, not `<name>:latest`. Verify with a deterministic probe (temperature=0, compare base vs artifact output — identical = identity LoRA still serving). (v4 training run, `tuning_experiment` id=95/96)

### W&B and Together AI have incompatible LoRA serving conventions — the `lora` field is provider-specific (2026-04-09)

W&B Inference expects the LoRA artifact URI as the `model` parameter:
```json
{"model": "wandb-artifact:///team/project/adapter:v9", "messages": [...]}
```

Together AI expects a separate `lora` field alongside the base model:
```json
{"model": "Qwen/Qwen3.5-9B", "lora": "user/adapter-id", "messages": [...]}
```

W&B **silently ignores** a separate `lora` field — returns HTTP 200 with base model output, no error. This caused V1 and V2 adherence adapter evals to produce byte-identical results to the base model. Diagnosed by comparing temperature=0 outputs: all three were character-for-character identical.

**Fix:** `src/transport.ts` now detects `wandb-artifact:///` prefixed LoRA URIs and routes them to the `model` field instead of a separate `lora` field. When configuring W&B fine-tunes, use the artifact URI directly as the model — do not use the `baseModel`/`lora` split (that pattern is Together AI only).

**Diagnostic:** Always verify LoRA loading with a temperature=0 deterministic probe comparing base vs adapter output. If identical, the adapter is not loading.

### W&B artifact deletion requires alias-stripping — `v.delete()` alone returns 409 (2026-04-12)

ART auto-assigns aliases (`latest`, `step0`, `step1`, `sft-resume-*`) to every artifact. The W&B API returns HTTP 409 if you try to delete an artifact that has any aliases. The SDK's `v.delete()` method does not strip aliases automatically.

**Fix:** Strip aliases first, then delete:
```python
v.aliases = []
v.save()
v.delete()
```

Also: the W&B pay-as-you-go plan restricts "models write access" by default. Deletion (API and web UI) returns 403 `"user does not have models write access for this org"` until this is enabled in team settings. This is separate from the alias issue — you need both the permission AND alias-stripping.

**Storage math:** Each SFT training run creates ~3.7 GB of artifacts (identity LoRA ~123 MB, 9 intermediate checkpoints ~134 MB each, 10 train-state ~246 MB each, dataset ~50 MB). Only the final adapter (~134 MB) is needed for serving. ART has no user-facing checkpoint frequency controls — saving is entirely server-side. `train-lora.py` auto-cleans after training; `scripts/finetune/cleanup-wandb-storage.py` handles manual cleanup.

### Per-flag oracle accuracy is not uniform — 235B's FAIL_MISSING (events) is its weakest flag at 85% (2026-04-09)

Post-mortem on exp #122 per-variant breakdown + exp #135 production eval:

| Flag | Oracle accuracy (synthetic) | V2 agreement (production) | Assessment |
|------|:---:|:---:|---|
| **setting** | **100%** (0 FP, 0 FN) | 88% | Oracle is the strongest teacher here. V2 over-fires on setting inheritance (mid-chapter beats that don't re-establish location). |
| **tangent** | **100%** (0 FP, 0 FN) | 87% | Oracle is perfect. V2 over-fires at the atmospheric/interiority boundary (~40-60% off-spec content). |
| **character** | **95%** (1 FP, 0 FN) | 88% | Oracle misses 1/20 real contradictions. Manageable. |
| **events** | **85%** (3 FP, 0 FN) | 98% | **Oracle's weakest flag.** Misses 3/20 truly absent beat actions. V2's 98% agreement means it learned the oracle's errors, not ground truth. Both are too lenient on this flag. |

The events slot is the highest-stakes flag (missing beat action = structurally broken prose) and the one where the oracle is least reliable. 3 false passes out of 20 FAIL_MISSING variants means 15% of genuinely missing beats slip through both oracle and V2.

**Implications for retry policy:** With a $1-3/M writer model, false retries cost real money ($0.002+ per wasted beat) and can degrade prose quality (retried beat loses context coherence). But false passes on events are worse — a structurally broken beat propagates to chapter-plan-checker (which runs on assembled prose, not per-beat) and may not be caught until full-chapter validation.

**Implication for fine-tuning:** V2's training data was labeled by the 235B oracle. On events, 15% of FAIL_MISSING labels were wrong (oracle said PASS when ground truth was FAIL). The student faithfully learned those errors. A V3 with a stronger events teacher — gpt-oss-120b or Claude — could close this gap. gpt-oss was never evaluated as a decomposed adherence checker (exp #122 only tested Llama 8B, 14B base, 235B). Running gpt-oss on the same 160-pair eval is the next diagnostic.

**Implication for tiered retry:** Events and character should remain hard gates (always retry on flag). Setting and tangent should be soft gates (log warning, don't retry) unless the oracle is also running — its 100% accuracy on those flags means every flag it fires is real.

### Mixed-teacher approach DISCONFIRMED — synthetic teacher accuracy doesn't predict training data quality on marginal cases (2026-04-09/10)

Teacher comparison across 5 models on the same 160-pair decomposed adherence eval (exp #122 reference, #138 gpt-oss, #140 teacher ladder). All models scored against deterministic labels with the 4-call decomposed prompt.

| Model | Overall | FAIL_MISS | FAIL_CHAR | FAIL_SET | FAIL_TANG | PASS_REORD | Latency |
|-------|--------:|----------:|----------:|---------:|----------:|-----------:|--------:|
| **Qwen 235B** (#122) | **97%** | 85% | 95% | 100% | **100%** | 95% | 486ms |
| **Kimi K2.5** (#140) | **95%** | **95%** | 95% | 100% | 90% | 80% | 1931ms |
| gpt-oss-120b (#138) | 95% | 93% | **100%** | 100% | 87% | 100% | 2984ms* |
| GLM 5.1 (#140) | 94% | 90% | **100%** | 100% | 75% | 85% | 2521ms |
| DeepSeek V3.2 (#140) | 90% | 80% | 90% | 100% | 55% | 95% | 2984ms |

*gpt-oss latency from exp #138 (Groq); DeepSeek latency from native API; K2.5/GLM via Together AI.

Based on this ladder, V3 training data was generated with per-flag routing: K2.5 for events, gpt-oss for character, 235B for setting/tangent. 7,541 curated examples. **V3 was trained and evaluated (exp #146) — it regressed vs V2.**

**V3 vs V2 absolute accuracy on 1,343 synthetic ground-truth pairs (exp #146, `scripts/eval-adherence-synthetic.ts`):**

| | base-14b | V2 (235B teacher) | V3 (mixed teacher) |
|---|---:|---:|---:|
| **Overall** | 86.4% | **95.2%** | 94.4% (-0.8pp) |
| Precision | 99.1% | 98.8% | 98.2% |
| Recall | 55.1% | **84.9%** | 82.9% (-2pp) |
| events | 82.7% | **95.4%** | 91.4% (-4pp) |
| character | 93.8% | **94.9%** | 93.2% (-1.7pp) |
| setting | 99.1% | 99.7% | 99.7% (=) |
| tangent | 71.0% | 90.6% | **93.2%** (+2.6pp) |

**Critical variant-level regressions:**

| Variant | V2 | V3 | Delta |
|---|---:|---:|---:|
| FAIL_MISSING_SUBTLE | **78.6%** | 55.4% | **-23pp** |
| FAIL_CHAR | **78.9%** | 73.7% | -5pp |
| FAIL_TANGENT_HARD | 69.0% | **82.8%** | +14pp |

V3 improved only on tangent (the one flag where 235B was already the teacher for both V2 and V3). Events and character — the two flags where the teacher was swapped — both regressed. FAIL_MISSING_SUBTLE collapsed from 78.6% to 55.4%.

**Why the mixed-teacher approach failed:**

The teacher ladder (table above) measured accuracy on **synthetic pairs with unambiguous injected failures** — beats completely removed, settings swapped, blatant contradictions. Every good model scores 85-100% on those. The synthetic eval cannot distinguish teachers' **calibration on marginal cases** — prose that partially covers a beat, character behavior that's arguably consistent. On those marginal production pairs (which make up the bulk of training data), each teacher draws the PASS/FAIL line differently. K2.5 is more lenient than 235B on subtle missing events, so V3 learned K2.5's lenient threshold and lost sensitivity on FAIL_MISSING_SUBTLE.

**The lesson: teacher accuracy on easy synthetic benchmarks does not predict teacher quality on marginal cases that determine the student's decision boundary.** To properly compare teachers, you need to take cases where teachers *disagree* on production data, hand-label those disagreements, and see who's right. Synthetic-only teacher selection is insufficient.

**V2 remains the production adapter.** Mixed-teacher is a dead end. If specific V2 weak spots need improvement (FAIL_MISSING_SUBTLE 78.6%, FAIL_TANGENT_HARD 69%), the path is targeted data curation on those variants within the single-teacher (235B) framework, or evaluating a frontier model (Sonnet) as teacher on disagreement cases only.

> **Superseded 2026-04-12:** V2 was itself retired in favor of V4 (`adherence-checker-v4`, exp #161) — single events+attribution call replacing the 4-call decomposed architecture, 2,134 Sonnet-labeled pairs, 79% first-attempt pass rate in production. See `docs/decisions.md` "Adherence checker V4: Sonnet re-labeling + W&B training submitted" and `docs/adapter-changelog.md`.

(Exp #140 teacher ladder commit `93e0f6a`; V3 training exp #145; V3 eval exp #146 commit `0b7a138`; ref experiments #122 Qwen 235B, #138 gpt-oss)

### Sonnet 4.6 as adherence teacher: 96.5% accuracy, better than 235B but below V2.1 threshold (2026-04-10)

Followed from the mixed-teacher post-mortem, which identified Sonnet as the candidate for evaluating teacher quality on the V2 weak spots. Full 1,559-pair synthetic eval using 78 parallel Claude Code subagents (exp #147).

**Results vs prior teachers:**

| | base-14B | V2 (235B teacher) | V3 (mixed) | Sonnet 4.6 teacher |
|---|---:|---:|---:|---:|
| Overall | 86.4% | 95.2% | 94.4% | **96.5%** |
| FAIL_MISSING_SUBTLE | 23.2% | 78.6% | 55.4% | **87.2%** |
| FAIL_TANGENT_HARD | 0% | 69.0% | 82.8% | **100%** |
| FAIL_MISSING | — | — | — | 98.1% |
| FAIL_CHAR | — | — | — | 85.7% |
| PASS_CLEAN | — | — | — | 99.5% |

By call type: setting 100%, tangent 100%, events 94.9%, character 93.3%. Precision 96.7%, recall 96.3%, F1 96.5%.

**Decision threshold** (from eval doc): >97% overall AND >90% FAIL_MISSING_SUBTLE to use as teacher for V2.1. Sonnet misses both (96.5%, 87.2%), so it does NOT replace 235B as the primary teacher.

**What Sonnet is better at:** FAIL_TANGENT_HARD (100% vs 69%) and FAIL_MISSING (98.1%) — unambiguous cases. On the soft cases that matter for training data quality (FAIL_MISSING_SUBTLE, FAIL_CHAR), Sonnet performs similarly to 235B with the same kinds of false-negative errors.

**Where Sonnet misses:**
- **FAIL_CHAR (85.7%)**: False negatives on "soft compliance" — character does the beat action but with the wrong dynamic (too eager, too passive, wrong emotional valence). The `character_contradiction` prompt's "only flag clear contradictions" instruction is too permissive here. Sonnet correctly respects it; the ground truth labels these edge cases as contradictions.
- **FAIL_MISSING_SUBTLE (87.2%)**: Mix of genuine model errors (treating interrupted-but-announced actions as enacted) and what appear to be actual ground truth labeling errors (see below).

**Ground truth errors discovered:** Two FAIL_MISSING_SUBTLE scenarios — `airlock_standoff` and `trench_letter` — appear to have ground truth errors. The prose fully enacts all beat elements in both, yet they are labeled `events_present=false`. Three independent evaluations (smoke test subagents × 2 + full eval) all returned `true`. These should be excluded from any future accuracy calculations or relabeled.

**Implication for V2.1:** Sonnet-as-teacher is not a drop-in upgrade over 235B for standard training pairs. A targeted use case remains: collect the cases where Sonnet and 235B *disagree* on production pairs, hand-label those disagreements, and use Sonnet's labels only where it's clearly more accurate. The bulk training data should remain 235B-labeled.

(Exp #147, results at `/tmp/adherence-claude-sonnet-results.jsonl` on LXC)

### RunPod dedicated GPU is 2× more expensive than Cerebras and 15× more expensive than W&B Inference at solo-developer volume — the value is flexibility, not cost (2026-04-08)

Priced a 10-chapter novel run against actual `llm_calls` data (novel-1775484070927, April 6 2026): 130 beat-writer calls, 13 continuity calls, 44 relationship-timeline calls, 33 rewriter calls, plus concept and extraction agents. Real token counts:

| Provider comparison | Cost for this run |
|---------------------|------------------|
| Actual run (Cerebras 235B + mimo) | **$0.63** |
| RunPod A6000 48GB ($0.00024/s, fine-tuned 14B) | **~$1.10** |
| W&B Inference ($0.05/$0.22 per 1M tokens) | **~$0.074** |

The RunPod estimate is based on 229K Cerebras output tokens / ~60 TPS single-request decode on A6000 = 3,822s × $0.00024, plus 476K input tokens / ~600 TPS prefill = 794s × $0.00024.

**Why RunPod costs more even at a lower per-second rate:** When you rent a dedicated GPU you pay for every second the worker runs — including the seconds between serial requests while the harness writes to Postgres, runs deterministic checks, and waits on other agents. Cerebras and W&B run multi-tenant infrastructure at high utilization; you pay only for your tokens, not for anyone else's idle time. At serial one-request-at-a-time calling patterns (which is how most harness agents work), utilization on a dedicated GPU is low, and the $/token blows out.

**The break-even condition for RunPod:** only approaches W&B cost-per-token at vLLM continuous batch sizes of ~8-16 simultaneous requests, which the harness never sustains. The reference-resolver 250-call burst is the closest case but it clears in ~40 seconds and then the worker goes idle.

**What RunPod is actually for:** serving fine-tuned adapters on bases W&B doesn't carry, or LoRA rank > 16. It is not cheaper than managed inference — it is the escape hatch when managed inference can't serve your model at all. The cold start, idle timeout, and per-second billing are all manageable (cold start with HF model caching is ~5–20s at $0.001–0.005; idle is negligible at $0.0144 per 60s window). The problem is structural: dedicated GPUs at low utilization always lose to multi-tenant per-token pricing on the same hardware generation.

**The hierarchy for fine-tune serving:**
1. **W&B Inference** — $0.05/$0.22/M, zero infra, limited to their catalog (Qwen3-14B, rank ≤ 16)
2. **Together AI** — $0.10/$0.15/M, serverless multi-LoRA, wider base catalog
3. **RunPod** — ~$7–8/M at low utilization, but any model, any rank, any base

Always exhaust managed per-token options before going to RunPod. (Analysis 2026-04-08, based on `llm_calls` data for novel-1775484070927)

### V4 (Qwen3-14B, W&B) beats V3 (Qwen3.5-9B, Together) on every style metric once served correctly (2026-04-08)
Experiments #95 and #96 concluded V4 underperformed V3 — that conclusion was entirely wrong because both runs hit the identity LoRA placeholder (`howard-tonal-v4:latest` = v0), not the trained adapter. Once the correct URI was used (`howard-tonal-v4-sft-resume:v8`), V4 dominates:

| Metric | Howard ref | Input | Base 14B | V4 14B FT | V3 9B FT |
|--------|-----------|-------|---------|----------|---------|
| Classifier ↑ | 0.715 | 0.197 | 0.333 | **0.550** | 0.422 |
| Perplexity ↓ | 1964 | 3593 | 4224 | **3086** | 4814 |
| Feature KL ↓ | 1.534 | 1.569 | 1.608 | **1.564** | 1.584 |
| Content pres ↑ | — | — | 0.268 | **0.583** | 0.275 |
| Avg words | 47.9 | — | 78.9 | **51.8** | 58.5 |
| Avg latency | — | — | 489ms | 597ms | 1757ms |

Feature KL of 1.564 vs Howard's 1.534 — V4 nearly matches Howard's structural rhythm. Word count 51.8 vs input 47.9 — minimal expansion. Jaccard base↔V4 of 0.255 confirms strong adapter effect. The serving URI bug, not model quality, caused the earlier wrong conclusion. (Experiment #98 — the real benchmark)

### Pipeline prose is structurally low on dialogue and interiority — but genre DOES differentiate after fixing detection (2026-04-09)

Deterministic structural analysis of 131 approved chapters across 5 genres (`scripts/analysis/analyze-structure.ts`). Initial results showed 7.6% dialogue — **but that was a measurement bug**: the regex only matched ASCII `"` quotes while the LLM produces three different quote styles (ASCII `"`, smart `""`, and curly single `''`). After fixing detection to handle all three styles plus contractions inside single-quoted dialogue:

| Metric | Corpus avg | Range | Published novel benchmark |
|--------|-----------|-------|--------------------------|
| Dialogue word% | 15.7% | 0–43% | 25–50% typical |
| Interiority verbs/100w | 0.1 | 0–0.8 | 0.5–2.0 typical |
| Action verbs/100w | 0.3 | 0–1.1 | varies by genre |
| Avg sentence length | 7.5w | 4.2–12.5 | 12–18w typical |
| Sentence length CV | 0.7 | 0.4–0.9 | good (>0.5) |
| Max non-dialogue para run | 9¶ | 1–32¶ | 3–8¶ typical |

**Genre DOES differentiate** (corrected from initial wrong conclusion): sci-fi thriller 24.8%, contemporary romance 21.3%, literary fiction 8.9%, dark fantasy 11.8%. The gap between genres is real, but all are below published norms.

**Remaining structural issues:** Dialogue is still about half of published novel density. Interiority is nearly absent (0.1/100w vs 0.5–2.0 typical). Sentence length is short (7.5w vs 12–18w in published fiction). These are genuine writer-prompt issues, not measurement artifacts.

**Measurement lesson: always validate deterministic metrics against spot-checked samples.** The initial 7.6% figure would have driven wrong conclusions about structural monotony severity. The LLM's inconsistent quote style (switching between `"`, `"`, `'`, and `'` mid-novel) makes naive regex detection unreliable. Any future deterministic analysis needs to handle all Unicode quote variants.

**Implication for fine-tuning:** Checker fine-tunes (adherence, chapter-plan, continuity) are unaffected — they check compliance, not prose quality. Writer/tonal fine-tunes should not be trained on current corpus without addressing the low interiority and short sentence length.

**Implication for training data diversity:** All 131 approved chapters come from only 5 unique premises. For adherence-checker SFT this doesn't matter (synthetic variants cover it). For chapter-plan-checker and continuity, the plan structures and world states are the training signal, so premise diversity directly affects data quality. The 30-seed expansion (post-apoc, sci-fi, epic fantasy, portal fantasy) addresses this gap.

### LLM call inspector only captures calls inside an active novel run — benchmarks and scripts are invisible (2026-04-08)
`src/logger.ts` guards every write with `if (!currentRunId) return` — so calls only land in `llm_calls` when there is an active novel run ID in scope. Benchmark scripts (`scripts/score-*.ts`, `scripts/best-of-n-experiment.ts`, etc.), one-off data generation scripts (`scripts/finetune/build-finetune-data.ts`, `scripts/build-analytical-finetune-data.ts`), and the improvement daemon all execute without a novel run context and never write to `llm_calls`. The inspector at `/app/llm-calls` is therefore **novel-pipeline-only** — it shows the per-beat agents (beat-writer, adherence-checker, reference-resolver, continuity, chapter-plan-checker, rewriter, extractors) for a specific novel run, not the full record of all LLM calls the harness has ever made. Experiment-linked calls can be recovered from the `llm_calls` table directly by joining on `tuning_experiment` if the benchmark scripts were wired to log them, but the vast majority are not. If you're wondering why "many API calls from today aren't in the inspector," check whether those calls came from a benchmark script rather than a novel run.

## Planning & Beat Architecture

### Dramatic beats outperform screenplay beats — tell the writer WHAT CHANGES, not WHAT HANDS DO (2026-04-12)
Screenplay-style beats (micro-actions: "character A does X, character B does Y") cause the writer to transcribe the spec verbatim (echo 0.29–0.35). Dramatic-style beats (what changes: "character confronts character over a moral disagreement") enable interpretation (echo 0.14–0.20). Style is the bigger lever: style change moved echo 0.29→0.14 (−52%), writer prompt change alone only moved 0.31→0.22 (−29%). Granularity alone doesn't fix dialogue collapse — beat count 3→10 compressed dialogue 27%→12% in exp #165, but corpus r(beats, dialogue%)=+0.153 contradicts the effect (word count confound). **Default to dramatic-style beat descriptions. Describe what changes in the scene, not the physical choreography.** (Experiments #165, #173)

### Never include sample dialogue in beat descriptions — it gets transcribed verbatim (2026-04-12)
When beats contain prescribed dialogue (e.g., "Gil: 'You left. I stayed...'"), the writer copies it directly into the prose. This produces high echo (0.30+), continuity failures (prescribed dialogue implies locations/states the continuity checker flags), and loss of writer voice. Coastal-mystery test: echo 0.30 with dialogue prescriptions → 0.20 after removing them; first-attempt pass rate 50% → 100%. **Describe what characters confront or reveal, not what they say.** (Experiment #176)

### 235B-class models require CRITICAL marking + bad examples to follow non-obvious constraints (2026-04-12)
The no-dialogue rule for the planner was ignored when stated as a simple bullet ("Do NOT include sample dialogue"). It worked when marked CRITICAL with 4 bad→good examples and reinforced in the JSON schema description field. Each bad example + CRITICAL marking increases adherence ~20–30% for 235B-class models (Qwen 235B). A single bullet is insufficient for constraints that feel optional to the model. **For non-negotiable prompt constraints: CRITICAL label + concrete bad examples + schema-level reinforcement.** (Experiment #176)

### Goodhart's Law in pipeline metrics — optimizing pass rate produced stage-direction prose (2026-04-12)
The harness originally optimized for adherence checker pass rates. The planner wrote dense screenplay beats → checker verified all actions → writer executed faithfully → pass rate was high. But the prose read like conjugated stage directions. The metric (pass rate, spec coverage) became the target and ceased measuring prose quality. The fix was upstream: changing the beat description mechanism (screenplay → dramatic) fixed echo, dialogue density, and prose quality without touching the metric. **If your optimization target conflicts with your quality goal, fix the mechanism upstream — don't chase the metric downstream.** (Experiments #165, #173, #176)

## SFT Distillation

### Evaluate SFT adapters against ground truth, not against the oracle you're replacing — direct agreement is wrong when the oracle is imperfect (2026-04-12 · exp #178)

> **Superseded 2026-04-18 (adapter only, methodology stands):** The methodology lesson below (direct-agreement vs ground-truth as the correct swap gate) remains load-bearing. The `chapter-plan-checker-v2` adapter itself was retired 2026-04-18 after production audit found ~92% false-positive rate on real fantasy plans — distribution drift between synthetic training pairs and production dramatic-style beats. The slot now runs DeepSeek V3.2 base. See `docs/decisions.md` "Chapter-plan-checker-v2:v1 SFT adapter retired."

chapter-plan-checker-v2 eval: direct agreement between the 14B SFT adapter and the production oracle (gpt-oss-120b) was 82%. The automated verdict said "KEEP ORACLE." But this was the wrong signal:

| Model | Accuracy vs Sonnet ground truth |
|---|---:|
| **v2 SFT adapter (14B)** | **96%** |
| gpt-oss-120b (oracle being replaced) | 78% |

The adapter matched the teacher (Sonnet) almost exactly. The 82% direct agreement was low because the adapter correctly caught FAIL cases the oracle was leniently passing — the disagreements were the oracle being wrong. Of 96 disagreements: 84 were `v2=FAIL, 120B=PASS (label=FAIL)` and only 12 were `v2=PASS, 120B=FAIL (label=PASS)`. The "direct agreement" metric was measuring "does the adapter copy the oracle's mistakes."

**The rule**: when you SFT-distill FROM a teacher onto a student to REPLACE a different oracle, use ground-truth accuracy vs teacher labels as the primary swap gate — not direct agreement vs the production oracle. Direct agreement is the right metric only if the production oracle is known to be correct. If the oracle were correct, you wouldn't need to fine-tune.

**The diagnostic**: read the disagreement direction before acting on the headline number. If disagreements are predominantly `adapter=FAIL, oracle=PASS` for known FAIL cases, the adapter is more accurate. If they're predominantly `adapter=PASS, oracle=FAIL`, the adapter is under-fitting.

### Paragraph breaks can silently vanish in PDF ingestion — assert coverage before every SFT emit (2026-04-16 · exp #192/#194)
Salvatore v1 LoRA shipped a silent wall-of-text bug. The corpus came from `pypdf` + `pdfminer` fallback, which preserved `\n` per physical PDF line but never promoted single newlines at dialogue-turn boundaries into paragraph breaks. The SFT formatter didn't check. The LoRA learned: given a brief, emit a blob. 0/6 original-character Phase C.3 beats had a single `\n\n` between speaker turns. It was invisible in aggregate style metrics (Δ-sum, sentence length) because the measure doesn't penalize missing whitespace.

v2 fix had two mechanical parts:
1. **Corpus-level**: `scripts/finetune/fix-paragraph-breaks.ts` — pass 1 `\n+ → \n\n` (every extracted line in Salvatore's PDF was a real turn boundary), pass 2 for surviving wall-of-text pairs, inject `\n\n` before any quoted turn following a sentence terminator. 611/777 pairs recovered breaks; the remaining 166 were legitimately single-paragraph.
2. **Methodology-level**: `scripts/finetune/paragraph_breaks.py` exports `normalize_breaks()` (idempotent) and `assert_minimum_coverage()` (raises if < 50% of pairs have `\n\n` or < 80% of dialogue-kind pairs have `\n\n`). Every SFT formatter calls both before emitting.

Measured v1 → v2 with the fix in place: Phase C.3 val Δ-sum 0.50 → 0.27, max 5-gram Jaccard 0.100 → 0.033 (less memorization as a side effect of training on cleaner paragraphs), outputs with paragraph breaks 0/74 → 51/74.

**The rule:** every new corpus ingestion must print a `\n\n` density check before downstream use. The SFT formatter gate is backstop-only; catching it upstream is faster. See `docs/corpus-ingestion.md`.

### Voice LoRA on Qwen3-14B transfers to unseen characters/settings — it's style capture, not content memorization (2026-04-16 · exp #194)
Phase C.3 generalization test (74 held-out val beats + 6 original-character briefs with deliberately unseen proper nouns — Thane Vordik, Corra Ashwick, Irinye, Garrett the Limp in Bren's Rest / Varl Peaks / Sellanthir) showed the Salvatore v1 and v2 LoRAs both crush DeepSeek bare + DeepSeek+primer baselines.

| Mode | Cell | Δ-sum | scenes landed |
|---|---|---:|---|
| Val (n=74) | DeepSeek bare | 2.28 | — |
| Val (n=74) | DeepSeek + 10K Salvatore primer | 1.92 | — |
| Val (n=74) | **salvatore-1988-v2 LoRA** | **0.27** | — |
| Original (n=6) | DeepSeek bare | 3.22 | 2/6 |
| Original (n=6) | DeepSeek + primer | 2.52 | 4/6 |
| Original (n=6) | **salvatore-1988-v2 LoRA** | **0.66** | **6/6** |

5-gram Jaccard vs ground truth (val mode): v1 mean 0.003 / max 0.100, v2 mean 0.001 / max 0.033. Both are paraphrasing, not reciting. Voice survives when the brief names characters and places the LoRA has never seen.

**The rule:** in-context learning with a long primer does not substitute for a voice LoRA when the target includes sentence-length rhythm. A 10k-token primer closes ~40% of the Δ-sum gap vs baseline; tuning closes 85-90%. Sentence cadence lives somewhere ICL can't reliably extract from exemplars. For voice targets where rhythm matters, plan to tune even when ICL exists.

### Voice LoRAs must train on the prompt shape they'll see in production (2026-04-16 · exp #195)
Salvatore v2 LoRA passed Phase C.3 generalization (Δ-sum 0.27 on unseen val, 0.66 on original characters) but failed the 3-chapter production probe — 12 consecutive chapter-2 drafting attempts failed on the same required fact. Root cause was NOT voice or capability: it was **prompt-shape distribution shift.**

The LoRA was trained on a 9-field brief (~200 tokens): `Characters / POV / Setting / Tone / Kind / Transition_in / Boundary_signal / Target_words / Summary`. Production sends ~500–1,000 tokens with additional sections the LoRA never saw: `TRANSITION BRIDGE` (last 2–3 sentences of prior beat), `LANDING TARGET` (next beat's first sentence), `CHARACTERS` (per-character speech pattern / drives / avoids / conflict / relationships / doesn't-know), resolved references, and setting on scene_start.

Concrete failure modes observed:
- **Bridge regurgitation** — the LoRA treats the TRANSITION BRIDGE as content to emit, repeating it verbatim in the next paragraph. Byte-identical sentences appeared in chapter 1 paragraphs 3 and 6.
- **Required-fact miss** — the LoRA ignores planner requirements embedded in the beat spec because it's over-indexed on the TRANSITION BRIDGE and under-indexed on the planned facts.
- **Character presence gap** — characters listed with snapshots are treated as background atmosphere instead of on-page presences.

Phase C.3 generalization testing did NOT catch this because it used training-format briefs on held-out content. Cross-distribution content generalization (characters/settings unseen in training) was validated; cross-distribution **prompt shape** generalization was not tested.

**The rule:** voice/writer LoRA evaluation must include at least one eval call with the production user-prompt assembler, not just training-format briefs. For retraining, rebuild the training corpus's user prompts through the same assembler the pipeline uses at inference. Training/serving prompt-shape symmetry is as load-bearing as training/serving output-shape symmetry.

### Proper-noun blocklists must cover world elements, not just named characters (2026-04-16 · exp #195)
Salvatore v2's system prompt blocked Drizzt/Bruenor/Wulfgar/Icewind Dale/Ten-Towns/etc. — named characters and places. Production probe chapter 1 still leaked "the coming of the drow elves" — the LoRA pulled in a world-element noun not in the blocklist. Voice LoRAs trained on a fantasy corpus carry the world taxonomy (species, magic systems, artifacts, continents) not just the proper nouns. For v3, blocklist is expanded to cover drow / dark elves / Underdark / Forgotten Realms / Crenshinibon / Mithril / etc. — the full lore vocabulary, not just people and places.

### Eval-brief stratification must match training-data stratification — else evals are contaminated (2026-04-16 · exp #196)
v3 Phase C.3 initial results showed max 5-gram Jaccard of **0.822** on the 74-brief val set — 25× higher than v2's 0.100. Looked like catastrophic overfit. It was not. Root cause: **the val briefs came from v2's formatter, which stratified by `(book, kind)`; v3's formatter stratifies by chapter.** The v2 val briefs spread across all 54 chapters; v3's training took 49 of those chapters. Roughly 91% of the "held-out" briefs I used to measure v3 were in v3's training set.

Re-running on v3's actual held-out chapters produced max 5-gram Jaccard **0.023** — below v2's 0.033, normal generalization.

**The rule**: when a training formatter changes stratification (from feature-based to chapter-based, from random to temporal, etc.), the eval sets from the previous regime are no longer valid held-outs. Either:
- Store eval briefs with their upstream train/val stratification rule recorded, and flag contamination programmatically when used against a different training split, or
- Maintain separate eval brief sets per stratification regime, and always evaluate an adapter against a set derived from *that adapter's* held-out partition.

Now enforced in `eval_briefs` (set_name includes regime marker: `salvatore-val-stratified-v1` vs `salvatore-v3-actual-val`).

### Rename augmentation × epochs compounds as gradient passes per beat (2026-04-16)
v3 training: 3 rename variants per chapter × 3 epochs = **9× effective gradient passes per beat**. Training loss collapsed to 0.0096. Pre-investigation, this looked like overfit — contaminated-eval result reinforced the alarm. Post-investigation (contamination was the bug), v3 generalizes fine despite the low loss.

**The rule**: low training loss is not overfit evidence on its own. The diagnostic is **held-out 5-gram Jaccard** on a truly-held-out set. A well-tuned LoRA can drive training loss below 0.02 while still paraphrasing on unseen content (max Jaccard ≤0.05) because sub-word / grammar patterns in voice are compressible. Treat loss-depth warnings ("stop before 0.2") as a soft prior, not a gate.

### Cell-level Δ-sum (delta-of-means) ≠ row-level Δ-sum averaged (mean-of-deltas) (2026-04-16)
When backfilling eval results into `eval_results`, I stored per-row `delta_sum` computed against the baseline. Averaging that column gives systematically higher values than `phase-c3-generalization.py`'s aggregate output (Jensen's inequality: `avg(|x-c|) ≥ |avg(x)-c|` for convex `|·|`).

v3 clean-val numbers: phase-c3 printed `Δ-sum 0.45`; `SELECT AVG(delta_sum)` returned `1.45`; `SELECT cell_delta_sum FROM eval_cell_summary` (computed from AVG of each style feature) returns `0.447` — matching phase-c3.

**The rule**: when storing per-row style metrics, compute aggregates using delta-of-means for cell comparisons (`|AVG(sent_words) - 18.3| + ...`), not mean-of-row-deltas. Both are valid but measure different things — cell-level matches the method layer's assumption of "this distribution vs baseline," row-level measures per-beat adherence variance. Store both, use the right one for the right question.

### W&B Serverless SFT is no longer free — but still trivially cheap ($3.76/month observed, $500/month cap) (2026-04-16)
W&B transitioned out of the ART public-preview free window. Billing dashboard shows $3.76 spent April 1 – April 16 across 4 production adapters + Salvatore voice v1/v2 training + exploratory runs, against a $500/month cap. At ~$0.10–0.60 per r=16 / 700-pair / 3-epoch run on Qwen3-14B, the economics are unchanged from a solo-dev cadence perspective — still below the cost of the evaluation calls. Docs and status tables that called training "free during public preview" have been updated. The `tuning_experiment` row can optionally track $ per run now that it's measurable.

### Well-executed SFT distillation matches the teacher's accuracy exactly (2026-04-12 · exp #178)

> **Superseded 2026-04-18 (adapter only, methodology stands):** The chapter-plan-checker-v2 adapter referenced below achieved the described 96% match on synthetic ground truth but was later retired after ~92% false-positive rate on real fantasy production plans (distribution drift between training pairs and production). The distillation lesson here — teacher quality ceiling propagates cleanly to the student — is unchanged and remains applicable to any future SFT run that passes a production-distribution audit. See `docs/decisions.md` "Chapter-plan-checker-v2:v1 SFT adapter retired."

Sonnet 4.6 labeled 520 training pairs at 96% accuracy vs deterministic ground truth. After training, the 14B v2 adapter scored 96% accuracy vs the same ground truth — a near-perfect match. The student absorbed the teacher's calibration.

This is the expected outcome when: (1) the teacher accuracy is high (96%), (2) the dataset is large enough to cover the variant space (520 pairs, 8 variants × 65 scenarios), and (3) the task is within the student model's capacity (structured verdict with 4 output fields, bounded reasoning). When these conditions hold, SFT distillation eliminates the teacher at inference time with no accuracy penalty. **If your teacher accuracy is high and your student comes back below teacher accuracy, the first suspects are insufficient data coverage or task capacity mismatch — not inherent limits of the approach.**

## Labeling discipline (added 2026-04-18 from exp #223)

### Minimal-prompt subagent labeling produces Cohen's κ ≈ 0.28 — unusable
First hallucination-checker labeling pass on 500 beats used a minimal prompt (category names, no edge-case rules, no gold examples). Double-labeled 50-beat consistency check: **Cohen's κ = 0.285, entity F1 = 0.557.** Different Sonnet subagents applied different unwritten rules — per-beat vs novel-wide grounding, `brief.summary` inclusion, "Room 3B"/"Sector Gamma" coordinate flagging. Per-batch fail rates swung from 4% (regex-only on a leak list) to 76% (thorough extraction). Training on that data would bake inconsistency into the checker.

**The rule:** a rubric without explicit resolution rules and gold examples isn't a rubric. Minimal prompts invite labeler variance. Measure κ on a sample before the full labeling run.

### Rubric + ≥5 gold examples lifts κ to 0.86
Same Sonnet model, same 30 beats, same task — only the prompt changed. Added explicit PASS list (sentence-initial common nouns, days/months, real-world refs, generic titles, cardinal coordinates, last-name aliases, title + grounded-surname), explicit FAIL list (corpus leakage tokens, ungrounded named entities), 6 gold examples covering the known edge cases (corpus leak, ungrounded entity, title alias, name drift, real-world reference, summary grounding), and resolution rules for first+new-last-name vs last-name-alias, dialogue-only character introductions, plural factions.

**Result: Cohen's κ = 0.857 avg across 3 pairwise comparisons (0.889 / 0.889 / 0.792), entity F1 = 0.837. 3× improvement on κ, 1.5× on F1.** Disagreements reduced to 1-2 beats per 30, all legitimate edge cases.

**The rule:** an SFT checker is only as consistent as its labels. Budget ~$5-10 for a 30-beat 3-way consistency check. Vastly cheaper than retraining a checker that inherited noisy labels.

### Inter-labeler disagreement concentrates on edge cases, not core rules
3 labelers × 30 fresh beats: all three agreed on 5 fails (Baldur's Gate, Ten-Towns as corpus leaks; Deep Folk, Guild of Thieves, Kael's Reach as ungrounded). Disagreements were exclusively on:
- Characters grounded only in `brief.summary` (included by some, excluded by others per strict rubric field list)
- Named sub-classes within a grounded class system ("Sparkwright"/"Regulator" inside "Classification System")
- Single-word character names introduced in dialogue before formal grounding in later beats

**The rule:** core rules (corpus leakage, obvious ungrounded entities) have near-perfect agreement. Edge cases are the noise. Train on the strict-interpretation majority vote; signal is still ~95% clean even when labelers disagree on specific beats.

## Hallucination patterns (added 2026-04-18 from exp #223)

### v4 voice LoRAs leak training-corpus tokens catastrophically on specific seeds — not uniformly
800 fresh-pipeline beats across 12 novels: ~25% beat-level hallucination rate overall, but **bimodal by novel** not uniform. Per-batch fail rates ranged 11-14% (clean novels) to 34-52% (novels with systemic corpus import). The "Cassius" novel had 31 of 41 failures in a single chapter 1; the "Veridia bridge" novel imported Icewind Dale geography (Ten-Towns ×6, Bryn Shander ×4, Maer Dualdon ×4, Luskan, Termalaine). Other novels on different seeds had zero corpus leakage.

**The rule:** voice LoRA leakage isn't a uniform noise floor. Trigger appears to be genre-similarity to training corpus — fantasy-bridge, fantasy-succession with generic fantasy settings look like Icewind Dale to the model; war-healing and sci-fi settings don't. Production mitigation: hallucination checker rewrite loop. Long-term fix: v5 training data with rename augmentation and anti-parroting recipe.

### DeepSeek and v4 hallucinate differently
Fresh 800-beat bundle split 400 v4 / 400 DeepSeek. v4 hallucinations are dominated by Salvatore-corpus token leakage (Drizzt, Ten-Towns, drow, Mithril Hall). DeepSeek hallucinations are dominated by novel-internal fabrications (invented guilds, book titles, rival noble houses, minor characters) with zero corpus leakage.

**The rule:** a hallucination checker trained on one writer's output will under-generalize to the other. If production could swap writer models, train on mixed-writer data. Balanced bundles (50/50) give checker robustness across both patterns.

## Architecture discipline (added 2026-04-18)

### Craft-as-prompt-rules fails the same way primers fail
Session considered building voice-consistency, show-vs-tell, pacing, dialogue-naturalness, sentence-rhythm checkers — all encoding craft rules as instructions or post-hoc checks. This is the retired Howard primer methodology reincarnated: encode style rules in a 5K-token primer, ask a capable model to imitate. Howard was retired 2026-04-16 because the results were either mechanical (the model hit metrics but the prose read flat) or the model ignored most rules anyway.

**The rule:** craft is a model-weights problem, not a prompt-instruction problem. If craft falls short, the lever is upgrading the model (bigger base, richer fine-tune data, frontier + few-shot), NOT adding prompt instructions or post-hoc craft checkers. Context engineering handles WHAT to write; the model handles HOW. Keep the split clean.

### Negative-set checks on prose have 0/3 track record — don't build them
Codebase history: deterministic character-presence check (positive set: "is named character X in prose?") works reliably at ~99%. Three negative-set checks have been proposed or built and removed: word-count (voice LoRAs drift, metric never load-bearing), dialogue-presence (false-positive on silent beats), hallucination-checker deterministic proper-noun allowlist (variant matching, sentence-initial capitalization, legitimate writer introductions all produce false positives).

**The rule:** positive-set checks ("is this required thing here?") can be deterministic; negative-set checks ("is there something here that shouldn't be?") require an LLM. If you reach for a regex to enumerate what might be wrong, you're in the wrong tool.

### Pure-synthetic SFT training causes distribution shift on natural val (hallucination-checker v2, 2026-04-18)

Replicated chapter-plan-checker-v2's methodology (50 scenarios × 10 variants, Cerebras-generated prose, Sonnet-labeled, flipped on mismatch) producing 500 pairs at 96.4% Sonnet agreement. Trained the hallucination-checker on 400 of those pure-synth pairs.

**Synth val: 95.1% precision / 96.7% recall** — parity with chapter-plan's headline.

**Natural val (same 160-beat set v1 was measured on): 77.8% precision / 51.2% recall** — actively worse than v1's 86.5%/78%.

**Diagnosis:** the model learned "PASS pattern X, FAIL pattern Y" shortcuts that worked on Cerebras-style prose with our specific injection pools but didn't generalize to natural production distribution (DeepSeek + Salvatore LoRA output).

**The fix that worked** (v3, combined ungrounded+leak adapters with v1 natural train merged): 77.8% precision / 85.4% recall / 81.4 F1 — matches v1 F1 baseline with different trade-off.

**The rule:** synthetic-only training data creates synthetic-good-natural-bad adapters. If production distribution differs from your synth generator's output, merge in natural data OR generate synth prose using the actual production writer chain. Never evaluate only on synth val — always run the natural val in parallel before declaring a win.

### Decomposition beats kitchen-sink rubrics for 14B narrow-task training (hallucination v3, 2026-04-18)

v2 asked one adapter to learn ~20 decision rules (§A corpus leak vocabulary + §B grounded-entity detection + §C edge cases like dialogue-only, first+new-last, title+grounded) from 400 pairs. Natural-val regression (61.8 F1 vs v1's 82.1) vindicated the decomposition instinct logged in `feedback_decompose_checker_calls.md`.

v3 splits into:
- `halluc-ungrounded-entity` — relational reasoning (is token grounded?), full brief+WB+speakers context
- `halluc-leak-<writer>` — vocabulary memorization (is token in this writer's corpus leak list?), prose-only context

Each adapter trains a narrower decision boundary on focused data. Combined via OR logic in `drafting.ts`. Preserves v1 baseline F1 with better recall. Sets up cleaner small-model distillation per adapter (narrower task → smaller viable model size).

**The rule:** if one 14B adapter is asked to learn N orthogonal rules from M training pairs where M/N < ~100, decompose. Serving cost stays comparable with parallel calls; telemetry improves (per-axis fire rates); retraining narrows.

### Leak detection is per-writer, not universal (2026-04-18)

Each fine-tuned writer LoRA has its own corpus-vocabulary leak set, a direct artifact of the training corpus. Salvatore LoRA leaks Drizzt/Mithril Hall/drow. A future Gemmell LoRA would leak Druss/Waylander/Drenai. A Cook LoRA would leak Croaker/Black Company/Taglios.

**The rule:** leak-detection adapters pair with writer LoRAs. One-leak-adapter-for-all-writers is a maintenance treadmill that gets worse as we add genre voices. `halluc-leak-salvatore-v1` is the pattern; every new writer LoRA gets a paired `halluc-leak-<writer>-v1`. No hardcoded regex lists — the adapter learns the vocabulary from training examples, and adapts as the corpus evolves.

## 2026-04-19 — Exhaustion-handler architecture + debug-injection MVP

### Debug-injection seams must cover EVERY call site for an agent, not just the first

When `src/config/debug-injection.ts` env flags were first wired in, injection was applied at the initial call site but missed the settle-loop recheck paths. Plan-check rechecks (`fed9e4a`) and validation rechecks (`4ad2413`) both had live code that bypassed the forced-failure env flags. These bugs were invisible in unit tests (tests don't exercise the settle loop) and only surfaced during campaign runs that specifically needed forced failures. Two separate fixes were required for the same bug class.

**The rule:** when injecting a fault at a logical decision point, enumerate every path that re-enters that decision point. Settle loops and retry branches are the canonical missed sites. The durable fix is a V2 transport-interceptor that intercepts at the transport layer before any call path can branch — see `docs/todo.md` §5.

### Post-implementation Codex review is non-optional, not just for "hard" changes

The auto-mode `gate:plan-assist` SSE emit was wired inside a Promise constructor that was only reachable when `gate.mode === "web"`. Code compiled, all tests passed (tests ran in web mode), but auto-mode runs would reach the plan-assist gate and stall silently — a contract violation that would have hung Phase 2 campaign runs for 15+ minutes each. The fix was caught by Codex gpt-5.4 review (a2d16769d75b1d9cc) in a routine post-ship review pass. No test regressed before the review ran.

**The rule:** correctness bugs in conditionally-reachable paths don't show up in tests that never exercise the inactive branch. Codex review is not a quality signal for "hard" code only — it catches mode-specific path errors that test coverage misses by construction.

### Polling-based test runners hide pipeline bugs; SSE watchers with structured trace events give fast-fail

The first campaign runner polled `/state` on a fixed interval. The plan-check seam bug (fed9e4a) took 3 minutes per test to surface because polling was blind to which stage the pipeline was stuck at. Replacing the runner with an SSE watcher + structured `plan-check-outcome` and `validation-check-outcome` trace events dropped detection to <30s.

**The rule:** if a test runner can't distinguish "pipeline passed this gate" from "pipeline is still in this gate," you can't fast-fail. Add structured outcome events at every decision point; the watcher subscribes and exits as soon as the expected event arrives. The investment is one new event type per gate, paid once.

### Subscribe-before-start is required; late attachment misses early events

The first SSE-based runner opened the `/events` stream after `POST /start` returned, which created a race condition where early `debug-inject` and `plan-check-outcome` events could arrive before the stream was attached. Fix: open the SSE connection first, then send `POST /start`; additionally, seed the watcher from `GET /api/novel/:id/trace` (replaying persisted rows, deduping by id) before attaching the live stream.

**The rule:** any event-driven test watcher that doesn't seed from the trace first is racy. Structure: (1) open SSE, (2) GET /trace to replay history, (3) POST /start. The dedup by event id makes replaying harmless even if some events arrived in the live stream first. (commits `59f8fff`, `a2118e1`)

### Bun fetch idle timeout silently drops SSE streams — set idleTimeout: 0 on Bun.serve

SSE campaign runs dropped connections after ~10s of pipeline silence even with keepalive frames being sent. Root cause: `Bun.serve` defaults to a non-zero idle timeout that closes connections it considers idle, independent of whether the client has disconnected. A 5s keepalive interval was added as belt-and-suspenders, but the structural fix is `idleTimeout: 0` in the serve config so the server never terminates a stream due to silence.

**The rule:** `Bun.serve` idle timeout is not the same as a TCP keepalive. It's a server-side policy that fires on output silence. Always set `idleTimeout: 0` for SSE and WebSocket handlers. The keepalive frame is still useful for proxies and load balancers upstream that may have their own idle timeout policies. (commit `a2118e1`)

### Parallel Sonnet subagents materially shorten multi-file implementation

Single-subagent sequential handoffs (subagent A writes file 1, passes context to subagent B for file 2) serialize work that has no real dependency. When the work decomposes into disjoint files — e.g. the five exhaustion-handler steps each touching distinct files — dispatching multiple Sonnet subagents in parallel, then routing the aggregate to a single Codex review pass, consistently shortened wall-clock time compared to sequential handoffs. Codex review catches cross-subagent inconsistencies before they land.

**The rule:** plan the decomposition, assign disjoint file sets to parallel Sonnets, do one aggregate Codex review at the end. Don't serialize unless there are genuine data-flow dependencies between files. Codified as CLAUDE.md rule 10.

### Test assertions must read the correct column name

R5 initially asserted `chapter_revisions.deviations` — a column that doesn't exist on the table. The actual column for deviation payload is `outline_before` / `outline_after` on `chapter_revisions`, and the `[validation]` source tag lives on `chapter_exhaustions.unresolved_deviations`. The test compiled and the migration ran cleanly; the wrong assertion only surfaced when the test executed and the column query returned null instead of the expected content.

**The rule:** before writing any test assertion that reads a DB column, query `information_schema.columns` for the table first (same rule as the general DB query discipline in CLAUDE.md). Column names on checker/telemetry tables don't follow an obvious pattern — `deviations` sounds right for a revisions table but it's `outline_before`/`outline_after`. (commit `91140c5`)

### Fast-fail SSE watchers must distinguish expected errors from unexpected errors

The first draft of `watchForExpectations` rejected the test on any `error` SSE event. Auto-mode `PipelineBailError` correctly emits an error event when forced-failure flags trigger the bail path — it's the expected outcome for R1 and similar auto-mode tests. The watcher's blanket rejection caused R1 to fail even though the pipeline was behaving correctly.

**The rule:** an SSE watcher's rejection path must check whether the error event satisfies an expectation in the matcher chain before treating it as a failure. Only reject on errors that no matcher claims. Otherwise auto-mode bail paths — which are correct behavior — look identical to unexpected crashes. (Codex Q5 in a2d16769d75b1d9cc)

## 2026-04-19 — Preflight invariants (exp #243)

### Preflight invariants: AST-scoped beats text-substring, always

Invariant #2 (seam-recheck symmetry) went through three implementations before landing clean. First pass used function-scope substring search, which missed a recheck in an arrow-function helper. Second pass widened to a ±N-line text window, which Codex rejected because a commented-out `inject.forcePlanCheck` inside the window would falsely satisfy the assertion. Third pass used the TypeScript compiler API to find real AST nodes only, with comments and string literals excluded. Only the AST pass survived review. **The rule:** an invariant's precision matters more than its coverage at ship time. A checker that greenlights buggy code because a comment mentions the right identifier is worse than no checker at all — it gives false confidence. Pay the cost of the AST walk on day one. (commits `ce6452c` → `7afe4dd` → `dedc0b6`)

### Mocking the thing you're testing defeats the test

Invariant #4's first Slice-B implementation stubbed `gates.requestPlanAssist`, pushed synthetic events into a local array, and asserted against that array. Codex caught it: the invariant is about whether the real `src/gates.ts` module emits `gate:plan-assist` symmetrically across auto and web modes, and stubbing that module's `requestPlanAssist` means the test asserts only what the stub was written to push — it can't fail on a real emission asymmetry. The fix drove through the unmocked `src/gates.ts`, catching `PipelineBailError` in auto mode and polling the real pending-gate map in web mode. **The rule:** when the invariant is about a real module's branching behaviour, don't mock that module — drive through it. If it's too hard to drive through, the invariant has the wrong shape for a runtime test and probably wants a syntactic check instead. (commits `10ce979` + `7afe4dd`)

### Bun:test cross-file mock pollution

`bun:test` module mocks are process-global, not test-file-scoped. A test file that calls `mock.module("./X", () => ({ foo: ... }))` without re-exporting every symbol that other callers of `./X` import will break any later test file in the same process that loads `./X` for real. Concretely: mocking `./beat-checks` in one test without re-exporting its full shape breaks `beat-checks.test.ts` when it loads later in the bun test run. This is now documented as `BASELINE_TEST_FAILURES = 1` in preflight — a temporary carve-out until a mock-hygiene refactor lands. **The rule:** before using `mock.module` in a shared test tree, either mock at the transport seam below the module you're testing, or re-export the full module shape via the mock factory so unrelated callers don't blow up. Single-file mock isolation is not free in bun.

## 2026-04-19 (continued) — Invariant #5 AST widen + baseline tightening (exp #244, #246)

### Conservative defaults for AST reachability

When a reachability heuristic decides whether a body-consuming call can be reached, favor conservative false negatives over false positives. A false negative means "a pair COULD fire but we didn't prove the first call unconditionally terminates" — the bug is still catchable by tests + Codex. A false positive fails preflight on code that's actually safe, which teaches authors to ignore the gate. Concretely: loop-statement terminators (`for`/`while`/`do` bodies where `break` / `continue` flow matters) were deferred because proving loop termination semantically is hard; `switch` reachability landed only once we enumerated the case-arm rule (terminate iff every arm — including `default` — terminates via throw/return/break-out-of-switch). The rule we followed: ship the analysis we can prove correct; mark the rest as known-limitations in `docs/invariants.md`; don't guess. (exp #244, commits `70f814d` → `b5cb37a` → `8cc3d2c`)

### Track symbol identity by declaration-node, not name string

The first Invariant #5 AST pass grouped body-consuming calls by receiver-name DFS-first-match across a function body. That misgroups shadowed bindings — a `const res = ...` inside a nested block that shadows the outer `res` would get lumped in. Even in small test files, shadowing is a real concern the moment you have `if (x) { const res = await fetch(...) }` patterns. The fix was to resolve each receiver to its binding's declaration-node identity (via the TypeScript compiler API's symbol resolution) and group by that. **The rule:** when AST analysis cares about "is this the same variable?", never trust name-string equality across scopes. Declaration-node identity is the only safe key.

### Test-only mocks should re-export the real module's shape

The `BASELINE_TEST_FAILURES = 1` carve-out from the previous session was closed not by changing `bun:test` semantics but by extending two `mock.module("./beat-checks", ...)` factories to re-export the full module shape (`aggregateIssues` + `formatRetryLine` + `summarizeIssues` with real-signature parity). Importing `BaseIssue` + `RawCheckerOutputs` as type-only re-exports catches signature drift at `tsc` time if the real module's shape changes. **The rule:** if you must `mock.module` in a shared test tree, the factory is a contract against the real module — re-export its full surface. Cross-file mock pollution in `bun:test` is real, and the mitigation is discipline at the mock site, not process-isolation gymnastics. (exp #246, commits `b8b5967` + `b5cb37a`)

## 2026-04-20 — beat-entity-list V1 (exp #254, #255)

### Context-surface alignment between writer and checker is often the cheap lever before retraining

The `halluc-ungrounded` checker was firing at 44.9% on-seed for fantasy-debt scenes — a rate that looked like an adapter calibration problem. The actual cause was a context gap: the checker saw the world-bible block but not the specific entities the *writer* had access to when producing the beat (established facts from prior plan output + prior-beat description). Adding a `Beat-entities:` sub-line derived at check-time from `outline.establishedFacts` and the prior-beat `description` via `src/phases/beat-entity-list.ts:deriveBeatEntities` dropped the fire rate to 28.9% (−16 pts) with 87.5% precision on a 10-fire Sonnet adjudication panel — all 5 charter gates cleared, no adapter spend. A cross-genre smoke (exp #255) confirmed the default flip to `BEAT_ENTITY_LIST_VARIANT=v1` is safe. **The rule:** before submitting a new adapter fine-tune to fix a checker's FP rate, audit what context the checker sees vs. what the writer had. A check-time derivation that closes the gap is free; a new SFT run is not. (exp #254, commits `9b646e3` / `2f162a1` / `09ec8d3` / `ff555bc` / `620dc71` / `9ec681f` / `78d1d01` / `52a2a5c`)

### Verify output schema before asserting a zero-fire baseline

The `halluc-leak-salvatore` adapter showed an aggregate fire rate of 0% in an ad-hoc query — which should have been suspicious. The root cause was a schema mismatch in the filter: the query matched `"pass": false` (the `halluc-ungrounded` schema), but `halluc-leak-salvatore` uses `{"has_leak": true, "leaks": [...]}`. Every fire was silently dropped by the wrong predicate, and the "baseline" was an artifact of that. Querying one row's full `response_content` payload by hand revealed the real schema; after correcting the filter, the actual on-seed fire rate was 7%. **The rule:** when a checker shows an unexpectedly clean baseline, inspect a raw payload from `llm_calls` before trusting the number. `SELECT response_content FROM llm_calls WHERE agent = 'halluc-leak-salvatore' LIMIT 1` takes ten seconds and is cheaper than designing experiments on a false zero. (exp #254)

## 2026-04-20 — Rung 0 ladder + V1a pilot scoping

### Measure the regex-ceiling before authorizing SFT spend

`docs/scoping/halluc-leak-salvatore-v2.md` proposed a 3-rung ladder: Rung 0 = measure a regex detector's ceiling before writing any training code, Rung 1 = widen the token list, Rung 2 = SFT. Running Rung 0 on 3,081 production `halluc-leak-salvatore` calls took ~2 minutes of SQL + one TypeScript pass; the result cleared the ≥85% precision / ≥75% recall gate comfortably (≥95% precision on regex-only catches, +31.6% recall over adapter alone). **No SFT training spend.** The rung-0 pattern generalizes: any detector whose substrate is a bounded token list should measure the regex ceiling before any adapter training. If regex clears a sensible precision/recall floor, OR-combine at inference and stop. See commit `cc57752` and `docs/rung-0-regex-ceiling-results.md`. (exp-derived, charter `docs/scoping/halluc-leak-salvatore-v2.md`)

### Don't narrow a charter's baseline ladder at launch time without a written reason

The `planner-phase2-payoff-floor` charter §4 specifies a 4-arm ladder: `baseline`, `prompt`, `extractor`, `mainv1a`. When kicking off the mini-pilot I briefed the launch subagent as "3 seeds × 2 arms × 5 chapters" — implicitly collapsing the 4-arm design to the 2 primary causal arms (`baseline` vs `prompt`). The subagent followed my instructions rather than the charter. Result: exp #256 produced a defensible but incomplete pilot — the directional signal (prompt-only floor slightly underperformed pre-V1a baseline, consistent with "V1a schema is the causal lever") survived the scope gap, but without the `extractor` arm we can't separate planner-JSON-shape causation from verifier/extractor sensitivity, and without `mainv1a` we have no current-prod anchor. **The rule:** when launching a charter-scoped experiment, reproduce the charter's baseline ladder in the launch brief verbatim, not the author's quick summary of it. If the ladder is being narrowed, write the reason down — "I am collapsing arms X and Y because Z" — and commit that decision before launch so the narrowing is auditable. See `docs/pp2-floor-pilot-results.md` and commit (this session). (exp #256, charter `docs/charters/planner-phase2-payoff-floor.md` §4)

### Always verify a charter-mandated post-hoc cleanup step runs

The V1a pilot launcher script (`scripts/run-pp2-floor.ts` in the `~/apps/nh-pp2-floor` worktree) mutates `src/agents/planning-beats/beat-expansion-system.md` in-place when the `--arm prompt` is passed — writes the floor variant over the baseline. It does NOT restore the baseline on completion. If I had kicked off V1a pilot work again without restoring, future `baseline`-arm runs would silently execute the floor prompt. Caught at session close by a `git checkout` of the worktree file (MD5 `ee928170`). **The rule:** when a script mutates persistent state as part of an experiment arm (prompt files, adapter configs, env files), the launcher should register its own cleanup — either restore on exit, or emit a post-hoc restore command for the next session to run. Absent that, the session retro must explicitly list the restore step.

## 2026-04-21 — Conditioning-floor KILL + rewrite-capability probe + quality-redraft gate

### Parity harnesses catch silent production regressions that unit tests miss

Over seven rounds of adversarial review on the `salvatore-distinctness-conditioning-floor` charter, the parity harness caught two silent regressions before any judging ran: (1) a 4-line-vs-5-line preset mismatch that made the experiment a no-op on production characters, and (2) a pack-level `conditioning: "fixed"` default that silently dropped one exampleLine from every production novel beat. Neither regression was catchable by unit tests because both required diffing the outgoing LLM request bytes against a real `llm_calls` row — the test suite has no production data to diff against. The parity harness is the only tool that sees the actual request shape.

**The rule:** for any experiment that changes how a production LLM request is constructed (prompt assembly, model config, context builder, format wrapping), build a parity harness first and run it before any judging. The §4.7 SOP in `docs/experiment-design-rules.md` formalises this. Canonical implementation: `scripts/evals/conditioning-floor-parity-check.ts`. (Commit `edb630a`, exp #258)

### `codex exec` does not compose under concurrency — use Agent subagents for batch judging

The gpt-5.4 cross-judge run on 20 beat-pairs for the conditioning-floor charter used `spawn("codex exec", ...)` × 20 in parallel. It hung with zero returns after 16+ minutes. The root cause: each `codex exec` invocation spins up its own app-server subprocess; running N concurrently means N app-server processes competing for the same port/socket. The Codex plugin is designed for sequential invocation from Claude Code, not for being spawned as a subprocess pool.

**The rule:** for batch parallel judging (eval panels, pairwise runs, multi-arm scoring), use Claude Code Agent subagents instead of `codex exec`. Agent subagents parallelize cleanly; `codex exec` blocks. Sequential `codex exec` invocations for single-shot analysis tasks are fine — the constraint is concurrency. (Commit `639712e`, memory `feedback_codex_plugin_subagentic_concurrency.md`)

### Small voice-trained LoRAs may lack rewrite capability — redraft-from-scratch is a meaningful alternative

Two probes on the Salvatore v4 LoRA (exploratory + rigorous via production `buildRetryPrompt`) showed the adapter cannot escape a V1 prose anchor when given V1 + critique as context: 8/20 pairs were byte-verbatim V1, 11/20 near-match, 1/20 genuinely different. The production retry shape (which feeds V1 prose in context for continuity) was worse for rewrite than a hand-built shape — the V1 anchor is the dominant force, not prompt structure.

**The rule:** before designing a critique-rewrite loop for a voice-trained LoRA, probe whether the adapter can actually rewrite at all. Use the production retry-context builder (`src/agents/writer/retry-context.ts`) as the test harness — it's what the pipeline will actually send. If the adapter anchors to V1, the right design is "detect defects → no-critique redraft (blank context, fresh sample)" rather than "feed V1 + critique and ask for improvement." Redraft-from-scratch avoids the anchor problem entirely. (Commits `eb3e7c8`, `893bb26`)

