---
status: DELETE AFTER COMPLETION
---

# Session Handoff — 2026-04-04

## What was accomplished this session

### Agent & rubric overhauls (commits 5560e47 → ab20bb0)
- Overhauled 8 agents: world-builder, plotter, character-agent, continuity, cross-chapter-continuity, prose-quality, writer (show-don't-tell permissions + emotional mirror), removed orphaned prose-polish
- Fixed dead-weight judge rubric — was flagging 44-86 issues/chapter (~80% false positives). Tightened to 10 max with explicit DO-NOT-FLAG exclusions. Commit `ab20bb0`.
- Fixed dead-weight judge `[emotion]` bracket causing JSON extraction failure. Commit `ea4b3a1`.
- Fixed pairwise runner — was using SQLite API, ported to Postgres. Commit `cd2ee5a`.

### Lint-rewrite investigation (experiments #44-#71)
Key finding: **deterministic lint fixing + context-aware LLM per-sentence is the optimal approach**. Full-chapter LLM rewrites introduce 63-78% collateral damage regardless of prompt constraints.

- **Deterministic fixes** handle ~56% of lint issues (filler phrases, filter words, redundant adverbs/body parts) at zero cost, zero latency, 0.1% collateral. File: `src/lint/fix.ts`.
- **Context-aware LLM per-sentence** fixes creative patterns (AI clichés) by sending flagged sentence + 2 surrounding paragraphs. Qwen3 235B (Cerebras) produces the best fixes — scene-grounded, 200-500ms, $0.0003/fix. Experiment #71, #72.
- **Full-chapter LLM rewriting is counterproductive** — pairwise judge consistently prefers originals over judge-informed rewrites due to content loss. Only lint-only rewrites ever beat originals.
- **Judge-informed rewriting cuts too much** — even with tightened rubric (10 issues vs 86), rewriter drops to 79-81% word retention and pairwise judge values the lost content.

### Writer model comparison (experiment #74)
DeepSeek V3.2 ($0.28/$0.42) beat Kimi K2 ($1.00/$3.00) on most quality metrics:
- Telling: 3.5 vs 7.5 issues
- Dead weight: 7.5 vs 10.0
- Lint: 1.5 vs 5.5
- Word count: 1,358 vs 1,159 (writes more)
- Cost: $0.001 vs $0.007 per chapter (7x cheaper)
- Caveat: 44s latency vs 7s. DeepSeek judge scored its own prose (potential self-bias). Needs pairwise confirmation with Reasoner.
- Qwen3 32B writes too short (860w avg) and high telling (15.0). Not viable as writer.

### Experiment Workbench (commits 00b40fb → cdfa45c)
Built the experiment workbench UI at `/app/experiments`:

**Phase 1 (working):**
- Tabbed experiment detail: Scores, Prose (with inline lint highlighting), Rubrics (rendered markdown), Commit (git show)
- APIs: `/api/experiments/:id/generations`, `/api/rubrics`, `/api/rubrics/:suite/:dimension`, `/api/experiments/:id/diff`, `/api/experiments/:id/summary`
- Copy-for-discussion button (markdown to clipboard)

**Phase 2 (working):**
- Side-by-side prose comparison: `ProseCompare.tsx` with variant/seed selectors, lint highlighting, score badges

**Phase 3 (partially working — UI needs polish):**
- ExperimentBuilder form: model selection, seed selection, evaluation toggles, transport mode (realtime/batch), cost estimate
- Workbench runner: `benchmark/workbench/runner.ts` reads config from DB, generates, judges, lints, pairwise
- API: `POST /api/experiments/create`, `GET /api/models`, `GET /api/seeds`
- **Known issue**: ExperimentBuilder layout/contrast/alignment is broken — added to improvement checklist

### Infrastructure
- Experiments now auto-capture git commit hash. Commit `bd2d3c4`.
- `docs/lessons-learned.md` created with experiment-backed principles. Commit `29bbf28`.
- GPT-5.4 Pro removed from model registry (too expensive).

## Immediate next tasks

### 1. Wire hybrid lint fixer into novel pipeline
The `src/lint/fix.ts` module is built and tested but not integrated into the drafting/validation phases.
- Call `fixLintIssues()` after chapter generation in `src/phases/drafting.ts`
- Use deterministic fixes for subtractive patterns, Qwen3 235B per-sentence for AI clichés
- Re-lint after fixing to verify compliance
- Store fix results in `lint_issues.resolved` / `lint_issues.rewrite_result`

### 2. Add 1-10 prose quality scoring rubrics
The prose benchmark only has penalty judges (issue counts). No positive quality dimension exists. The planning/extraction/continuity benchmarks have 1-10 rubrics and the schema supports it (`judgeScoreSchema` in `benchmark/prose/judges/schema.ts`).
- Write rubrics for: prose craft, character voice, sensory grounding (same format as `benchmark/planning/judges/beat-specificity.md`)
- Add as new dimensions in `benchmark/prose/judges/schema.ts`
- Wire into the experiment engine alongside penalty judges

### 3. Fix ExperimentBuilder UI
The model grid, contrast, and alignment are broken. See improvement checklist.

### 4. Confirm DeepSeek V3.2 as writer via pairwise
Run pairwise comparison (Reasoner judge) between experiment #74 runs 224 (Kimi K2) and 225 (DeepSeek V3.2). If DeepSeek wins or ties, switch `roles.ts` writer from Kimi K2 to DeepSeek.

### 5. Batch engine integration
The workbench UI has transport mode toggles (realtime/batch per phase) but the runner only executes real-time. The batch chaining (generation batch → auto-collect → judge batch → auto-collect → score) needs engine-level work. See the batch plan in the conversation context.

## Key files
- `src/lint/fix.ts` — hybrid lint fixer (deterministic + LLM per-sentence)
- `src/lint/index.ts` — deterministic prose flagger
- `benchmark/workbench/runner.ts` — generic experiment runner
- `benchmark/workbench/types.ts` — WorkbenchConfig type
- `ui/src/components/ExperimentBuilder.tsx` — experiment creation form (needs polish)
- `ui/src/components/ExperimentsPage.tsx` — experiment detail view with tabs
- `ui/src/components/ProseCompare.tsx` — side-by-side prose comparison
- `docs/lessons-learned.md` — experiment-backed engineering principles
- `docs/improvement-checklist.md` — full task list
- `models/registry.ts` — model definitions and pricing
- `models/roles.ts` — agent-to-model assignments

## Key experiment IDs for reference
| ID | What | Key finding |
|---|---|---|
| #44 | Rewriter dead-weight re-test | Regression fixed: -23 issues |
| #46 | Lint-rewrite 3-arm (with rubric fix) | Lint-only: -50 dead weight, 100% word retention |
| #48 | Two-pass (lint→judge) | Two-pass overwhelmed by judge issues (96+) |
| #58 | Two-pass with tightened rubric | Dead weight 86→10 issues, word retention 64%→81% |
| #63 | Lint rewrite model sweep (full chapter) | All models 99% word retention, 63-78% collateral |
| #67 | Inline lint rewrite (constrained prompt) | Still 63-78% collateral — LLMs can't reproduce text verbatim |
| #69 | Hybrid lint fix (deterministic + LLM) | 0.1% collateral, 56% fixed deterministically |
| #71 | Context-aware creative fix (Qwen 235B) | Scene context enables AI cliché replacement, $0.0003/fix |
| #72 | Context fix model sweep | Qwen 235B best quality, DeepSeek cheapest, Qwen 32B failed (0/3) |
| #74 | Writer model comparison | DeepSeek V3.2 beats Kimi K2 on quality at 7x lower cost |
