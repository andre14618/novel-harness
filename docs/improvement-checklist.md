---
status: active
verified: 2026-04-03
---

# Improvement To-Do

## Concept Phase Agents (Never Improved — Highest Impact)

These three agents produce the foundation every downstream agent uses. All are at 15-24 line prompts with 9-line context builders — the same state the extraction agents were in before their 4.2→8.0 overhaul. No benchmarks exist for concept quality.

- [x] **World-builder overhaul** — Expanded from 15 to ~30 lines. Added 5 new schema fields (geography, politicalStructure, technologyConstraints, socialCustoms, sensoryPalette), location sensoryDetails, specificity examples in prompt, downstream context enrichment in writer + planning-plotter (2026-04-04).
  - File: `src/agents/world-builder/prompt.md`, `schema.ts`, `context.ts`; also `schemas/shared.ts`, `agents/writer/context.ts`, `agents/planning-plotter/context.ts`
  - Verify: run a novel, compare world bible quality before/after

- [x] **Plotter overhaul** — Expanded from 21 to ~45 lines. Added: per-act methodology (Stasis=Death, midpoint reversal, whiff of death, try/fail cycles), turningPoint field in act schema, theme-as-question guidance, 5 genre-specific obligation sets, theme integration across all 3 acts. Planning-plotter context enriched with turningPoint (2026-04-04).
  - File: `src/agents/plotter/prompt.md`, `schemas/shared.ts` (actSchema), `agents/planning-plotter/context.ts`
  - Verify: compare plot spines before/after across multiple seeds

- [x] **Character-agent overhaul** — Expanded from 24 to ~50 lines. Added: detailed speech pattern template (structure, vocabulary, tics, avoidance), 2 new schema fields (internalConflict, avoids), backstory-to-behavior chain guidance, bad/good examples for traits, relationships, and fears. Downstream contexts (writer, planning-plotter) enriched with new fields (2026-04-04).
  - File: `src/agents/character-agent/prompt.md`, `schema.ts`; also `agents/writer/context.ts`, `agents/planning-plotter/context.ts`
  - Verify: pairwise comparison on dialogue-heavy seeds, check if writer produces distinct voices

## Validation Agents (Never Improved)

- [x] **Continuity checker overhaul** — Expanded from 27 to ~50 lines: added 2-3 concrete examples per severity level (blocker/warning/nit), object tracking check, 5 false-positive exclusions (dramatic irony, figurative language, unreliable narrator, vague timeline, triggered emotional shifts) (2026-04-04).
  - File: `src/agents/continuity/prompt.md`, `context.ts` (25 lines)

- [x] **Cross-chapter-continuity overhaul** — Expanded from 29 to ~60 lines. Added: 2-3 examples per severity level, dedicated dropped-thread detection section (promises, character arcs, foreshadowing), emotional continuity tracking guidance, 4 false-positive exclusions (2026-04-04).
  - File: `src/agents/cross-chapter-continuity/prompt.md`, `context.ts` (37 lines)
  - Verify: run continuity benchmark before/after

- [x] **Prose-quality overhaul** — Expanded from 22 to ~50 lines: added 3 issue categories (telling, cliché, AI-fiction tells), 14 before/after examples, false-positive guidance (legitimate telling, hedging in dialogue/deep POV), priority ordering (2026-04-04).
  - File: `src/agents/prose-quality/prompt.md`, `context.ts` (27 lines)

## Prose Quality (Partially Done)

- [x] **Show-don't-tell: when telling is right** — Added 5 telling-is-correct cases (time skips, transitions, rapid action, known facts, sequel compression) to writer prompt (2026-04-04).
  - File: `src/agents/writer/prompt.md`

- [x] **Environment as emotional mirror** — Added pathetic fallacy guidance with 3 before/after examples + restraint note to writer prompt (2026-04-04).
  - File: `src/agents/writer/prompt.md`

- [x] **Rewriter dead-weight regression re-test** — Experiment #44: dead-weight 81.5→58.5 (-23.0), telling 8.0→6.5 (-1.5), dialogue 10.0→5.5 (-4.5). Regression fully resolved (2026-04-04).

## Character & Dialogue (Tier 3)

- [ ] **Character voice differentiation** — Characters should have distinct speech patterns, vocabulary, sentence structure. Blocked on character-agent producing strong profiles first.
  - Measure: pairwise comparison on dialogue-heavy seeds, human eval
  - Depends on: character-agent overhaul

- [ ] **Subtext quality** — Dialogue should carry meaning beyond its surface. Characters talk around the real issue.
  - Measure: new rubric + human eval. Hard to judge with LLM alone.

## Structure & Genre (Tier 3 — Need New Rubrics)

- [ ] **Pacing and structure rubric** — Measure narrative rhythm (tension/release, scene/sequel alternation). No benchmark dimension exists. The `docs/ai-tells-rhythm-homogeneity.md` doc has a design for 5 statistical patterns (sentence length uniformity, opening repetition, compound sentence dominance, paragraph uniformity, opening pattern repetition) but they need calibration against published fiction first.
  - Needs: new `benchmark/prose/judges/rhythm.md` rubric, or implement `src/lint/rhythm.ts` heuristics from the doc

- [ ] **Genre convention compliance** — Does romance-drama follow Love genre conventions? Does dark-fantasy maintain horror beats?
  - Needs: genre-specific rubrics per Story Grid genre analysis

## Infrastructure

- [ ] **Lint false positive review** — 66 patterns, 0 reviewed for precision. Run lint on 2-3 recent novels, skim flagged instances, disable patterns that are mostly wrong. Hedging patterns (perhaps/maybe, sort of/kind of) are highest FP risk in dialogue and deep POV.

- [ ] **Batch API routing** — Transport layer supports batch mode but untested outside prose runner. DeepSeek has no batch API (fixed: daemon no longer defaults to --batch). Batch still available for OpenAI/Groq judges via `--batch` flag with `BATCH_PROVIDER=openai`.

- [ ] **Extraction accuracy test cases** — Ground-truth comparison for the 3 extraction agents. Accuracy at 7.4/10, judge says remaining issues are overreach (inferences presented as facts). Build 5 gold-standard extractions from existing chapters.

- [ ] **Cross-dimension regression check** — Daemon only checks other dimensions at cycle end. Per-iteration check would catch regressions earlier.
  - Implementation: after each kept change, judge 1-2 other dimensions. Revert if any regresses > 1.0.
  - Cost: 2-3x more judge calls per iteration.

- [x] **Remove orphaned prose-polish agent** — deleted directory, removed from roles.ts, prompts.ts, novel-routes.ts, ConfigPage.tsx, architecture.html (2026-04-04).

## Improvement Daemon (Completed 2026-04-03)

- [x] Scoring normalization (higher=better everywhere)
- [x] Diagnose sort + judge reasoning bugs fixed
- [x] Statistical keep/revert threshold (minDelta >= 0.3, maxFailures 3→5)
- [x] Improver system prompt (scoring context, strategy guidance, anti-patterns)
- [x] Improver model (Kimi K2 → DeepSeek V3.2)
- [x] Proposal diversity (temperature escalation, strategy hints on failures)
- [x] Auto-commit kept changes
- [x] Seed coverage (up to 3 seeds from registry)

## Completed Items (Reference)

<details>
<summary>Expand completed items</summary>

- [x] Establish planning baselines (commit 5a3fa67)
- [x] Establish extraction baselines → full overhaul: completeness 4.2→8.0, accuracy 6.2→7.4 (experiments #36-40)
- [x] Consolidate duplicate judge rubrics (3 active penalty rubrics remain)
- [x] Cost optimization sweep (judge 10x cheaper on DeepSeek, extractors on Qwen3 32B)
- [x] Lint-informed writer rules (4 rules covering 27 Tier 1 patterns)
- [x] Temperature sweep (writer 0.8 optimal, experiment #33)
- [x] Lint Tier 3 patterns (said bookisms, declared emotions)
- [x] Pipeline config tuning (3/3/3 defaults kept, experiment #35)
- [x] Writer methodology integration — Scene/Sequel, Stasis=Death, Midpoint Reversal (experiment #9)
- [x] Planning-plotter Five Commandments
- [x] Planning-plotter dialogue cue specificity (4.6→7.0, experiment #30)
- [x] Rewriter precision measurement (experiment #34, rewriter prompt updated with dead-weight awareness)
- [x] Context builder enrichment (emotionalState, theme, character voice profiles)
- [x] Dialogue Problems rubric fix (tightened 4 sub-criteria)
- [x] Continuity checker fixtures (5 test cases)
- [x] AI tells integration — 27 lint patterns (15 AI_CLICHE, 12 HEDGE_QUALIFIER), writer/rewriter/judge rules. All patterns sourced from Strunk & White, King, Orwell, Zinsser, Clark, Browne & King, Lukeman, Stein.

</details>
