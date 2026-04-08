---
status: active
updated: 2026-04-08
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
Ran all 73 regex lint patterns against 221k words of published fiction (Christie, Cather) and 254k words of AI prose. Many patterns fire equally or more on human prose: `perhaps/maybe` (0.9x), `seemed to` (0.3x), `sort/kind of` (0.4x), said bookisms like `murmured/exclaimed` (0.3x). These are general style advice, not AI tells. The real signals are patterns with ≥3x AI amplification: `silence stretched` (42x), `could feel` (10.5x), `wiped hands` (76x), `flicker of something` (3.5x). Patterns with ratio <1.5 should be disabled — they erode linter credibility by flagging normal English. **Validate every lint pattern against a human baseline before enabling it.** (Baseline script: `scripts/lint-baseline.ts`, 2026-04-04)

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
Tested Llama 3.1 8B (Groq) vs MiMo Flash on 25 tier-2 lint fixes. Both produced good rewrites for AI clichés (replacing abstract constructions with concrete scene-specific detail). Llama was 10x faster (131ms vs 1235ms) and cheaper ($0.05/$0.08 vs $0.10/$0.30). MiMo failed silently on some issues (returned unchanged sentence). Llama occasionally over-wrote but stayed closer to the original. **For chunked tonal fixes, use the cheapest fast model — the task is bounded enough that model size barely matters.** (Scripts: `scripts/tonal-pass-test.ts`, `scripts/relint-and-fix.ts`)

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


W&B Inference latency probe (`tuning_experiment` id=94, `scripts/test-wandb-inference.ts`) hit a counterintuitive finding: **OpenPipe/Qwen3-14B-Instruct on W&B Inference is FASTER than Cerebras Qwen 235B on the adherence-checker workload shape** — 157ms avg vs 365ms avg, a 2.3× speedup. On a 14B model on a "standard" tier inference service vs a 235B model on Cerebras's custom LPU hardware. That's not the direction the comparison usually goes.

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
4. Cross-reference against `src/phases/*.ts` and `src/state-extraction.ts` — these are the only places live agents get called from
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

## LoRA Fine-Tuning

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

### W&B ART fine-tune on 14B instruction-tuned base underperforms a dedicated 9B LoRA for style transfer (2026-04-08)
Once the correct serving URI was identified (`sft-resume:v8`), the v4 fine-tune (Qwen3-14B-Instruct, 4,497 pairs, 3 epochs, H200) produced **shorter** output than the base model (good) but **less vivid** output than V3 (bad). The model learned Howard's restraint without his imagery. Root cause: the OpenPipe/Qwen3-14B-Instruct base is heavily instruction-tuned and resists vocabulary distribution shift at LoRA rank 16 — 4,497 pairs isn't enough to override its default "expand with sensory detail" behavior. V3 (Qwen3.5 9B, Together AI) outperforms V4 on feature KL (structure closest to Howard) and produces crisper prose because a smaller, less-instruction-hardened base yields more readily to the fine-tuning distribution. **Model size does not predict LoRA style-transfer quality — base model plasticity does.** (Experiments #95, #96)
