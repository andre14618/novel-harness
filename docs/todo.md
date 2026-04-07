---
status: active
updated: 2026-04-07
---

# To Do

Items removed when done — git history has the record. Ordered by impact.

## Fine-Tuning (Qwen 3.5 9B on Together AI) — primary focus

LoRA fine-tunes on Together ($0.48/M training tokens, $0.10/$0.15 inference). Knowledge distillation: base model outputs, human reviews/corrects in Claude Code, corrected outputs become training data. Generic prompts — training data teaches behavior, not the prompt.

- **Run fact-extractor dataset generation** — `bun scripts/build-finetune-data.ts --task fact-extractor --limit 50` on LXC. Review 20-30 pairs in Claude Code, correct to gold standard, then scale to 300+.
- **Adherence-checker fine-tune** — runs every beat, high frequency. Classification task (pass/fail + deviation). Needs beat-level training data — generate novels with beat pipeline and log beat/draft/adherence pairs.
- **Reference-resolver fine-tune** — runs every beat. Identify needed lookups from implicit references. Same beat-level data source.
- **Chapter plan checker fine-tune** — runs once per chapter. Compare prose against plan, report structural deviations or PASS. ~3-5K token input. Training data from novel runs.
- **Tonal pass expansion** — V3 LoRA trained on Howard only (sword-and-sorcery). Need multi-genre corpus. Copyright considerations documented in `docs/ai-training-copyright-landscape.md`. Public domain authors: Hemingway (pre-1929), London, Cather, Fitzgerald. Back-translation pipeline exists (`scripts/generate-tonal-pairs.ts`).
- **Test tonal pass V3 in production** — enable `pipeline.tonalPass`, run on a novel, compare before/after.

## Pipeline Tuning

- **Tighten fact extractor** — still 17-20 facts/chapter, target 8-15. Precision matters now that facts feed deterministic queries.
- **Word count below target** (550-770 vs 800-1100). May be model, prompt, or beat granularity issue.
- **Switch extractionMode to "plan"** — once planner's state outputs are verified against a few novels, disable LLM extractors (except relationship-timeline which produces data the planner doesn't). Currently set to "both".
- **Re-evaluate lint system role** — if tonal pass LoRA already reduces AI cliches, lint becomes a safety net, not a pipeline stage. Test: run lint on tonal-pass outputs vs base outputs.
- **Strip anti-pattern list from rewriter prompt** — rewriter can't self-police cliches (proven). Lint + tonal pass handles this.
- **Skip re-extraction for prose-only rewrites** — if rewrite only fixes cosmetic issues, extraction results are still valid.

## Character Voice

- **Add speech profiles to character-agent** — concrete attributes per character (register, vocabulary, patterns, forbidden phrases). Current `speechPattern` field captures this as free text but needs to be richer for downstream checking.
- **Character voice checker** (future fine-tune) — per-beat check that dialogue matches character speech profile. Needs speech profile infrastructure first.

## Autoresearcher

- Rename daemon → autoresearcher across codebase
- Refocus on structured quality signals — adherence pass rates, plan check rates, lint counts, extraction precision/recall
- Remove all LLM judge and embedding-related optimization targets

## Pipeline Stability

- Deduplicate timeline events in DB — rewrite re-extractions create duplicate events
- Clean up stale DB data: incomplete novels, orphan benchmark runs, experiments without conclusions

## Infrastructure

- Add context inspection view to web UI (show what the writer/beat-writer received)

## Seeds & Testing

- Create 3-5 new seeds stressing different scenarios: complex magic systems, many POV characters, dense continuity, dialogue-heavy

## Future — Worldbuilding Workbench (separate project)

Interactive chat frontend backed by the knowledge graph. Author converses with their world, modifies plotlines, generates beats, adjusts world state. Output is a structured plan that feeds the harness. Workbench writes to knowledge graph, harness reads from it. Same Postgres tables, different interface. Semantic search / embeddings may be useful here for exploratory authorial queries. Entirely separate from the prose generation pipeline.
