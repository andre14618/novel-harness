---
status: active
verified: 2026-04-03
---

# Improvement To-Do

## Concept Phase Agents (Never Improved — Highest Impact)

These three agents produce the foundation every downstream agent uses. All are at 15-24 line prompts with 9-line context builders — the same state the extraction agents were in before their 4.2→8.0 overhaul. No benchmarks exist for concept quality.

- [ ] **World-builder overhaul** — 15-line prompt, the thinnest in the system. Feeds world rules to plotter, writer, and continuity. A vague world bible means the writer invents settings and rules on the fly, creating continuity issues downstream.
  - File: `src/agents/world-builder/prompt.md` (15 lines), `context.ts` (9 lines)
  - Needs: structured output fields (geography, political structure, technology constraints, social customs, sensory palette), specificity guidance with examples, minimum detail thresholds
  - Verify: run a novel, compare world bible quality before/after

- [ ] **Plotter overhaul** — 21-line prompt. Decides central conflict, theme, and 3-act structure for the entire novel. Has no methodology integration (unlike planning-plotter which got Scene/Sequel, Five Commandments, Stasis=Death, etc.).
  - File: `src/agents/plotter/prompt.md` (21 lines), `context.ts` (9 lines)
  - Needs: Story Grid obligatory scenes per genre, try/fail cycle structure, theme integration guidance, act-level turning point specificity
  - Verify: compare plot spines before/after across multiple seeds

- [ ] **Character-agent overhaul** — 24-line prompt. Speech patterns feed writer + prose-quality, but likely produce generic profiles. The "character voice differentiation" Tier 3 item can't be solved at the writer level — it needs to be solved here.
  - File: `src/agents/character-agent/prompt.md` (24 lines), `context.ts` (9 lines)
  - Needs: distinctive speech pattern examples (vocabulary, sentence structure, verbal tics, what they avoid saying), backstory-to-behavior connections, relationship dynamics with specific conflict sources
  - Verify: pairwise comparison on dialogue-heavy seeds, check if writer produces distinct voices

## Validation Agents (Never Improved)

- [ ] **Continuity checker overhaul** — 27-line prompt, no benchmark, no examples. The single-chapter variant that runs during drafting.
  - File: `src/agents/continuity/prompt.md` (27 lines), `context.ts` (25 lines)
  - Needs: concrete examples of each issue type, false positive guidance, severity calibration

- [ ] **Cross-chapter-continuity overhaul** — 29-line prompt. Has a benchmark and fixtures but the prompt itself has never been improved.
  - File: `src/agents/cross-chapter-continuity/prompt.md` (29 lines), `context.ts` (37 lines)
  - Needs: same as continuity, plus dropped-thread detection guidance and emotional continuity examples
  - Verify: run continuity benchmark before/after

- [ ] **Prose-quality overhaul** — 22-line prompt. Rubric is focused (show-don't-tell + cliche detection) but has no examples of good vs bad flags. Context was enriched with character voice profiles but prompt unchanged.
  - File: `src/agents/prose-quality/prompt.md` (22 lines), `context.ts` (27 lines)
  - Needs: before/after examples of each flag type, threshold guidance for "clear cases"

## Prose Quality (Partially Done)

- [ ] **Show-don't-tell: when telling is right** — The writer has 17 NEVER rules for cliches/hedges but no guidance on when telling IS the correct choice (time skips, rapid-fire action, transitions between scenes). Currently the rules are all prohibitions with no permissions.
  - File: `src/agents/writer/prompt.md`

- [ ] **Environment as emotional mirror** — Use setting details to reflect character emotional state without stating it. "Rain streaked the window" during grief, not "She felt sad."
  - File: `src/agents/writer/prompt.md`

- [ ] **Rewriter dead-weight regression re-test** — Rewriter prompt now has anti-cliche/anti-hedge rules (2026-04-03). Experiment #34 showed +10 dead-weight regression. Need to re-run `benchmark/prose/rewriter-precision.ts` to verify the fix.
  - Verify: `bun benchmark/prose/rewriter-precision.ts` — dead-weight delta should be < +3

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

- [ ] **Remove orphaned prose-polish agent** — 32-line prompt, not exported from `src/agents/index.ts`, not in the pipeline. Either integrate or delete.

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
