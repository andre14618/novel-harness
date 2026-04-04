---
status: DELETE AFTER COMPLETION
---

# Session Handoff — 2026-04-04 (afternoon)

## What was accomplished this session

### Lint fixer integrated into novel pipeline (commit 6956bc6)
- `src/phases/drafting.ts` now runs `lintProse()` → `fixLintIssues()` after chapter generation
- Added `lint-fixer` role in `roles.ts` (Qwen3 235B on Cerebras, per experiment #71 findings)
- Deterministic fixes first, then LLM per-sentence for remaining issues
- Shows lint summary (categories, fix counts, unfixed) in human gate display
- Non-blocking — errors don't prevent chapter approval
- Emits SSE events (`lint` step) for real-time UI tracking

### 1-10 prose quality scoring rubrics (commit d49c1f0)
- Three new rubric files: `prose-craft.md`, `character-voice.md`, `sensory-grounding.md`
- Schema split: `PENALTY_DIMENSIONS` (telling, dead-weight, dialogue) + `QUALITY_DIMENSIONS` (prose-craft, character-voice, sensory-grounding)
- `DIMENSIONS` kept as penalty-only for backwards compat with 10+ experiment scripts
- `ALL_DIMENSIONS` for combined access
- New `judgeQualityDimension()` in `shared.ts` validates against `judgeScoreSchema` (1-10)
- Both `run.ts` and `workbench/runner.ts` invoke quality judges alongside penalty judges
- Quality scores stored in same `scores` table (dimension name distinguishes them)
- Reporting shows separate penalty and quality sections

### ExperimentBuilder UI fixed (commit 49392b6)
- Text contrast bumped across all elements (#e6edf3 for labels, #c9d1d9 for provider names, #a5b3c0 for prices)
- Provider columns get borders and separator lines under names
- Seed/eval chips get borders for visual separation
- Cost bar batch discount now shown as green badge instead of trailing text
- Checked off in improvement checklist

### Writer switched to DeepSeek V3.2 (commit 6809d0c)
- Pairwise experiments #75 (non-Reasoner) and #76 (Reasoner) both showed 2/2 inconsistent (position bias)
- Verdict: "quality is comparable" — but penalty metrics from experiment #74 strongly favor DeepSeek (telling 3.5 vs 7.5, lint 1.5 vs 5.5, 7x cheaper)
- Writer, rewriter, and benchmark-writer all switched from Kimi K2 (Groq) to DeepSeek V3.2
- Caveat: latency increases from 7s to 44s per chapter

### Transport simplified (commit 30022e7)
- Removed `PrefixCacheTransport` — provider prefix caching is automatic at the provider level
- `DirectTransport` is now the default (was `PrefixCacheTransport`)
- Updated README, architecture diagram, and guide page

## Immediate next tasks

### 1. Run a full novel with the new pipeline
The lint fixer integration and writer switch are untested end-to-end. Run a novel to verify:
- Lint fixer runs after each chapter without blocking
- DeepSeek V3.2 produces acceptable prose quality
- Quality scoring rubrics produce reasonable scores when benchmarked
```bash
ssh novel-harness-lxc "cd ~/apps/novel-harness && ~/.bun/bin/bun src/index.ts --auto --seed romance-drama"
```

### 2. Baseline benchmark with quality dimensions
Run a full prose benchmark to establish quality dimension baselines alongside penalty baselines:
```bash
ssh novel-harness-lxc "cd ~/apps/novel-harness && EXPERIMENT_ID=<id> ~/.bun/bin/bun benchmark/prose/run.ts"
```
Create the experiment first, save as baseline with `--save-baseline`.

### 3. Batch engine integration
The workbench UI has transport mode toggles (realtime/batch per phase) but the runner only executes real-time. The batch chaining (generation batch → auto-collect → judge batch → auto-collect → score) needs engine-level work. Key files:
- `benchmark/workbench/runner.ts` — needs batch transport support
- `src/transport.ts` — BatchTransport exists but workbench doesn't use it
- `benchmark/batch/` — existing batch infrastructure for prose runner

### 4. Character voice differentiation
Now that quality rubrics exist (character-voice dimension), this can be measured. Run benchmarks across seeds and see if scores correlate with character count/dialogue density. Currently unchecked in improvement checklist.

### 5. Pairwise judge position bias
Both Reasoner and non-Reasoner showed 100% position bias on the writer comparison. This limits pairwise utility. Potential fixes:
- Try a different judge model (Claude, GPT)
- Increase matchup count (more seeds, more runs per seed)
- Add confidence calibration to the rubric

## Key experiment IDs for reference
| ID | What | Key finding |
|---|---|---|
| #74 | Writer model comparison | DeepSeek V3.2 beats Kimi K2 on penalties at 7x lower cost |
| #75 | Pairwise: K2 vs DeepSeek (non-Reasoner) | 2/2 inconsistent — position bias |
| #76 | Pairwise: K2 vs DeepSeek (Reasoner) | 2/2 inconsistent — position bias persists with Reasoner |

## Key files changed
- `src/phases/drafting.ts` — lint fixer integration point
- `models/roles.ts` — writer switched to DeepSeek V3.2, lint-fixer role added
- `benchmark/prose/judges/schema.ts` — PENALTY_DIMENSIONS, QUALITY_DIMENSIONS, ALL_DIMENSIONS
- `benchmark/prose/shared.ts` — judgeQualityDimension()
- `benchmark/prose/judges/{prose-craft,character-voice,sensory-grounding}.md` — quality rubrics
- `benchmark/prose/run.ts` — quality judges in benchmark runner
- `benchmark/workbench/runner.ts` — quality judges in workbench
- `ui/src/components/ExperimentBuilder.tsx` — UI polish
