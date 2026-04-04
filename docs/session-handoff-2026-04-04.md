---
status: DELETE AFTER COMPLETION
---

# Session Handoff — 2026-04-04 (full day)

## What was accomplished

### Pipeline integration
- **Lint fixer wired into drafting phase** — runs after each chapter generation, deterministic + LLM per-sentence fixes, shows results in gate display
- **Writer switched to DeepSeek V3.2** ($0.001/ch, 3.5 telling vs K2's 7.5) with maxTokens fix (8000)
- **All planners/extractors/validators switched from Qwen 32B → Qwen 235B (Cerebras)** — fixed JSON compliance issues (broken JSON in planning, enum violations in fact extraction)
- **Fact-extractor schema fixed** — added action/dialogue/identity categories that prompt listed but schema missed
- **Extractor maxTokens bumped 4096→8192** — Qwen 235B produces more detailed facts

### Benchmarking
- **3 quality rubrics added** — prose-craft, character-voice, sensory-grounding (1-10 scale alongside penalty judges)
- **Schema split** — PENALTY_DIMENSIONS + QUALITY_DIMENSIONS, backwards-compatible DIMENSIONS alias
- **Batch transport wired into workbench runner** — judging phase can run via batch API (50% off)
- **ExperimentBuilder UI fixed** — contrast, grid alignment, cost bar with batch discount badge
- **Pairwise**: experiments #75-76 both 100% position bias (Reasoner and non-Reasoner). Confirmed DeepSeek ≈ K2 quality, switched on cost/penalty advantage.

### Lint expansion & improvement loop
- **Emotional Echo detector** (6 patterns) — two-pass cross-sentence R.U.E. detection, always enabled
- **Rhythm heuristics** (5 patterns) — sentence length CV, opening repetition, compound dominance, paragraph length/opening. Disabled pending calibration but discovery auto-enables viable ones.
- **Concept registry** (`src/lint/concepts.ts`) — maps 8 lint categories to reference docs, craft sources, and "why AI gets this wrong"
- **Lint-driven improvement loop** (`scripts/lint-improve.ts`) — generate → lint → fix → track persistent → propose writer prompt change → compare. Uses lint-writer (Qwen 235B, 3s/chapter) for fast iteration.
- **LLM pattern discovery** (`scripts/lint-discover.ts`, `lint-discover-lib.ts`) — per-concept focused passes: each concept gets deep context from its reference doc, existing rules for THAT category, and prose samples. 8 parallel discovery agents.
- **Specialist agents** — `lint-discoverer/prompt.md` (craft principles + regex methodology) and `lint-improver/prompt.md` (prompt engineering methodology)
- **Batched chapter rewrite** (`src/lint/rewrite.ts`) — annotates issues with markers, sends one LLM call per chapter. NOT YET WORKING (40+ markers overwhelms the model, 0 fixes). Needs chunking.

### Experiments run
| # | Type | Result |
|---|------|--------|
| #75 | Pairwise K2 vs DeepSeek (non-Reasoner) | 2/2 inconsistent |
| #76 | Pairwise K2 vs DeepSeek (Reasoner) | 2/2 inconsistent |
| #77 | Lint improvement (1 seed) | 1/3 kept, -2 persistent |
| #78-79 | Novel end-to-end | Ch1-3 drafted, validation ran |
| #80 | Lint improvement (5 seeds, discovery) | 2/5 kept, -46 persistent |
| #81 | Lint improvement (batched rewrite) | 0/4 kept (rewriter broken) |

### Transport simplification
- Removed PrefixCacheTransport — provider prefix caching is automatic at provider level
- DirectTransport is now the default

## Current model assignments
| Role | Model | Provider | Latency |
|------|-------|----------|---------|
| Writer | DeepSeek V3.2 | DeepSeek | ~44s |
| Rewriter | DeepSeek V3.2 | DeepSeek | ~30s |
| Lint-writer (loop) | Qwen 235B | Cerebras | ~3s |
| Planners (4) + Retries (4) | Qwen 235B | Cerebras | ~3-5s |
| Extractors (3) | Qwen 235B | Cerebras | ~3s |
| Validators (3) | Qwen 235B | Cerebras | ~3s |
| Lint fixer | Qwen 235B | Cerebras | ~0.3s |
| Judges | DeepSeek V3.2 | DeepSeek | ~10s |
| Improver | DeepSeek V3.2 | DeepSeek | ~15s |

## Immediate next tasks

### 1. Fix batched chapter rewrite
`src/lint/rewrite.ts` doesn't work with 40+ markers. Options:
- Chunk into 5-8 issues per call
- Use paragraph-level batching (all issues in one paragraph → one call)
- Try a stronger/larger context model for the rewrite call
- Better validation than length-only comparison

### 2. Calibrate rhythm heuristics
The discovery passes keep auto-adding RHYTHM_MONOTONY patterns (68-82 hits per run). These dominate the issue count but the improvement loop can't fix rhythm via prompt changes. Need:
- Run calibration against published fiction corpus to set thresholds
- Determine which rhythm patterns are actually fixable vs inherent to LLM generation
- Consider whether rhythm should be a separate post-processing pass rather than a lint category

### 3. Quality rubric baseline
The 3 new quality rubrics (prose-craft, character-voice, sensory-grounding) have never been run. Need a baseline benchmark to see if 1-10 scoring actually discriminates (tuning log warns it clusters at 7-8).

### 4. Judge model evaluation
DeepSeek V3.2 as judge was adopted for cost, not quality. GPT-OSS 120B (Cerebras) was the original winner in the judge shootout. Consider switching judges to GPT-OSS 120B now that we're on Cerebras for everything else.

### 5. Prose quality beyond linting
The linter catches mechanical issues but not structural AI patterns (triple symbolic closures, self-conscious cliché avoidance, predictable nature outros). These are what make prose feel "mediocre but clean." Future work: structural pattern detection, possibly via LLM analysis rather than regex.

## Key files
- `src/lint/fix.ts` — hybrid fixer (deterministic + LLM per-sentence + rhythm per-window)
- `src/lint/rewrite.ts` — batched chapter rewrite (needs tuning)
- `src/lint/emotional-echo.ts` — R.U.E. violation detector
- `src/lint/rhythm.ts` — rhythm/paragraph heuristics
- `src/lint/concepts.ts` — concept registry mapping categories to reference docs
- `src/agents/lint-discoverer/` — pattern discovery agent
- `src/agents/lint-improver/` — prompt optimization agent
- `scripts/lint-improve.ts` — lint-driven improvement loop
- `scripts/lint-discover.ts` — standalone pattern discovery
- `scripts/lint-discover-lib.ts` — shared discovery library
- `benchmark/prose/judges/{prose-craft,character-voice,sensory-grounding}.md` — quality rubrics
