---
status: active
updated: 2026-04-06
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

### Lint pattern "just" has 23%+ false positive rate — disable broad filler patterns (2026-04-06)
Pattern 70 (`\bjust\s+...`) flagged 39 issues in experiment #90. 9+ were false positives where "just" carries semantic weight: "not just a restaurant" (means "more than"), "just right" (means "precisely"), "just as" (temporal), "no longer just hers" (means "more than"). Even several "true positives" were debatable stylistic choices. Broader lesson: single-word filler patterns that can't distinguish semantic from filler usage erode linter credibility. **Disable patterns with >15% false positive rates. AI cliché patterns (multi-word constructions) are the high-value targets.** (Analysis of experiment #90 lint data)

### Cheap models match expensive models for mechanical tasks
Qwen3 32B ($0.29/$0.59) and Qwen3 235B ($0.60/$1.20) performed equivalently to Kimi K2 ($1.00/$3.00) on lint compliance and word retention for full-chapter lint rewrites. For deterministic + per-sentence fixes, the model barely matters since the LLM only handles 1-3 sentences. **Use the cheapest available model for lint fixing.** (Experiment #63)

### Qwen 235B on Cerebras is 4x faster than Groq for equivalent quality
1.0s vs 4.0s for full-chapter rewrites. For per-sentence fixes: 200-300ms. Speed matters for pipeline integration where lint runs on every chapter. (Experiment #63)

### Model pricing in the registry must stay current — batch pricing ≠ standard pricing
Kimi K2 on Groq is $1.00/$3.00, not the $0.45/$1.40 initially reported. Always verify against the provider's current pricing page before cost comparisons. (Caught during experiment #63 review)

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
