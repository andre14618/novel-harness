---
status: active
updated: 2026-04-04
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
