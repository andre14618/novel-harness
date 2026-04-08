---
status: active
updated: 2026-04-07
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
