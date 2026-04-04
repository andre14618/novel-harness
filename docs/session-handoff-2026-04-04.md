---
status: DELETE AFTER COMPLETION
---

# Session Handoff — 2026-04-04

## Summary

Built a complete lint-driven prose improvement system: detect → fix → discover new patterns → optimize writer prompt. All integrated into the novel pipeline and working end-to-end.

## Architecture

```
src/lint/
  types.ts                    Shared types
  index.ts                    lintProse() — orchestrates all detectors
  fix.ts                      fixLintIssues() — orchestrates all fixers
  concepts.ts                 Concept registry (categories → reference docs)
  detectors/
    regex.ts                  DB patterns + regex matching
    emotional-echo.ts         R.U.E. violation heuristic (6 patterns)
    rhythm.ts                 CV + opening repetition heuristics
  fixers/
    deterministic.ts          String replacement (filler, redundancy, bookisms)
    per-sentence.ts           LLM per-sentence with dialogue guardrails
    rhythm.ts                 LLM per-window rhythm rewriting
```

**Detection**: 49 regex patterns + 6 emotional echo + 3 rhythm heuristics (CV<0.35, opening repetition, paragraph opening).

**Fixing**: Three passes — deterministic (free), LLM per-sentence ($0.0003/fix), LLM per-window rhythm ($0.001/window). Guardrails: skip dialogue lines, reject duplication, reject quote count changes, reject >50% length changes.

**Discovery**: `scripts/lint-discover.ts` — per-concept focused LLM passes (8 concepts, each with deep reference doc context). Proposes new regex patterns with craft citations. Validates against corpus before adding to DB. WARNING: discovered rhythm regex patterns were junk (matched everything) — disabled in DB. Only heuristic CV detection works for rhythm.

**Improvement loop**: `scripts/lint-improve.ts --discover --iterations N` — generates prose → lints → fixes → tracks persistent issues → proposes writer prompt changes → re-generates → compares. Uses lint-writer role (Qwen 235B, 3s/chapter).

## Key findings

- **Root cause of 0 LLM fixes**: `fix.ts` had wrong import path (`../models/registry` → `../../models/registry`) causing silent module resolution errors on every call. Fixed.
- **Transport defaults to JSON mode**: DirectTransport always sets `response_format: json_object`. Fix calls need to request JSON explicitly and extract the `fixed` field.
- **Rhythm monotony can't be fixed by prompt engineering**: improvement loop tried 5 iterations, all reverted. The LLM generates with its trained rhythm distribution. Per-window rewriting works (~67% success) when validation isn't too strict.
- **Rhythm CV threshold**: 0.35 catches real monotony without over-flagging. Published fiction: 0.4-0.8. AI output: 0.15-0.30.
- **Discovered regex patterns for rhythm are junk**: LLMs can't express CV calculations as regex. They produce "8 sentences in a row" patterns that match everything. Only use the heuristic detector for rhythm.
- **Dialogue corruption**: per-sentence LLM fixes were breaking dialogue formatting (duplication, lost attribution). Fixed with guardrails: skip dialogue lines, deterministic tag swap for said-bookisms, reject quote count changes.
- **Rhythm rewrite validation**: relaxed from 20% char length to 30% word count, plus requires CV improvement and wider min-max range. Rejects 1-word fragments and 30+ word sentences.

## Current model assignments

| Role | Model | Provider |
|------|-------|----------|
| Writer (novel) | DeepSeek V3.2 | DeepSeek |
| Writer (lint loop) | Qwen 235B | Cerebras |
| Planners/Extractors/Validators | Qwen 235B | Cerebras |
| Lint fixer | Qwen 235B | Cerebras |
| Judges | DeepSeek V3.2 | DeepSeek |
| Improver | DeepSeek V3.2 | DeepSeek |

## What works well

- Per-sentence fixes: 90%+ success on non-dialogue patterns (filler, clichés, hedges)
- Deterministic fixes: 100% success on subtractive patterns
- Rhythm window fixes: ~67% success with natural sentence length constraints (3-30 words)
- Full pipeline: typical chapter goes 15 issues → 2-4 after all three fix passes
- Lint improvement loop: experiment #80 kept 2/5 changes, -46 persistent issues across 5 seeds

## Immediate next tasks

### 1. Validate rhythm rewriting quality
The CV metric improves but need human review of actual prose quality. Does the restructured rhythm read better or just differently? Need before/after comparison on 5-10 passages.

### 2. Improve discovery pattern quality
Discovery adds junk rhythm patterns. Add a guard: categories with heuristic detectors (RHYTHM_MONOTONY, PARAGRAPH_HOMOGENEITY) should reject regex proposals. Only accept new regex patterns for categories that are regex-native.

### 3. Quality rubric baseline
Three new rubrics (prose-craft, character-voice, sensory-grounding) have never been benchmarked. Run a baseline to see if 1-10 scoring discriminates (tuning log warns it may cluster at 7-8).

### 4. End-to-end novel with fixes
Run a full novel with the lint fixer integrated into drafting. The novel test earlier had extraction issues — now fixed (schema + maxTokens). Verify the full pipeline produces a clean novel.

### 5. Structural AI patterns
The linter catches mechanical issues but not structural ones: triple symbolic closures, self-conscious cliché avoidance, predictable nature outros, formulaic scene structure. These are what make prose read as "mediocre but clean." Future work — likely needs LLM analysis rather than regex.

## Experiments this session

| # | Type | Result |
|---|------|--------|
| #75-76 | Pairwise K2 vs DeepSeek | Inconclusive (position bias) |
| #77 | Lint improvement (1 seed) | 1/3 kept, -2 persistent |
| #78-79 | Novel end-to-end | Completed with extraction issues |
| #80 | Lint improvement (5 seeds) | 2/5 kept, -46 persistent |
| #81 | Lint improvement (batched rewrite) | 0/4 kept (rewriter broken) |

## Key commits (chronological)

1. Transport simplification (remove PrefixCacheTransport)
2. Lint fixer in drafting phase
3. Quality rubrics (prose-craft, character-voice, sensory-grounding)
4. ExperimentBuilder UI fix
5. Writer → DeepSeek V3.2, planners/extractors → Qwen 235B
6. Fact-extractor schema fix (action/dialogue/identity)
7. Batch transport in workbench runner
8. Emotional echo + rhythm heuristic detectors
9. Lint-driven improvement loop + discovery
10. Specialist agents (lint-discoverer, lint-improver)
11. Per-concept focused discovery passes
12. Fix: import path for models/registry (root cause of 0 LLM fixes)
13. Fix: JSON response format for fix calls
14. Dialogue guardrails (skip dialogue, reject duplication/quote changes)
15. Rhythm fixer with natural sentence constraints (3-30 words)
16. Reorganize lint system (detectors/ + fixers/)
