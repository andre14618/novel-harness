---
status: active
updated: 2026-04-06
---

# To Do

Items removed when done — git history has the record. Ordered by impact.

## Pipeline Architecture — Beat-First, Embeddings Disabled

Beat-level writing bypasses semantic retrieval entirely. Context comes from the plan itself + deterministic DB lookups. The embedding pipeline adds cost and complexity without improving the beat path.

- **Disable embedding step** — skip `embedChapterData` in `state-extraction.ts`. Extraction still saves structured data to tables. Reference-resolver, adherence-checker, continuity-checker all query tables directly.
- **Tighten fact extractor** — still 17-20 facts/chapter, target 8-15. Precision matters more now that facts feed deterministic queries, not fuzzy vector search.
- **Build claim extractor + contradiction checker** — post-draft validation: extract testable claims from chapter, query world state tables for conflicts, send flagged conflicts to strong model. Replaces semantic context assembly with structured contradiction detection.
- Word count below target (550-770 vs 800-1100). May be model, prompt, or beat granularity issue.

## Adherence Checking (new — replaces prose penalty benchmark)

Experiment #90 showed the real quality axis is adherence to seed constraints (characters, premise, setting, genre, beats), not prose-level penalty counts. Penalty judges are noisy, don't discriminate, and have no corrective feedback path. Lint + tonal pass already handles AI clichés deterministically.

- **Build adherence checker** — fast small model checks each scene chunk against beat spec, character profiles, genre register. Returns pass/fail + specific deviation. Could be:
  - Deterministic: NER + keyword matching against seed JSON
  - Small model: Llama 8B on Groq (~50ms) with seed as rubric
  - Hybrid: deterministic first, model for nuanced checks (genre register, character voice consistency)
- **Chunked write-check loop** — writer generates per-beat (~300-500w), adherence checker validates before next beat. Fail → regenerate with deviation flagged. Fast iteration at low cost.
- **Archive prose penalty benchmark** — telling/dead-weight/dialogue judge dimensions are noisy (2-8x variance on re-judge), don't correlate with actual quality (MiMo scored similar but had real adherence failures), and have no corrective path. Keep infrastructure for macro trend tracking but remove from iteration loop.

## LoRA Tonal Pass

V3 LoRA (Qwen 3.5 9B on Together AI) trained on back-translated Howard pairs. Wins 9/15 paragraphs vs base on qualitative review — tighter prose, fewer adjectives, more visceral verbs. Total experiment cost: $2.71. Details: `docs/lora-style-transfer-report.md`, `docs/lora-qualitative-assessment.md`.

- **Build multi-author training corpus** — Howard alone is too narrow (sword-and-sorcery only). Source modern prose across genres: literary fiction, thriller, horror, romance narration. Need public domain or permissively licensed material. Target: 2,000-5,000 chunks covering both dialogue styles and thematic prose variety. Same back-translation pipeline (`scripts/generate-tonal-pairs.ts`), same curation (`scripts/curate-tonal-pairs.ts`).
- **Include dialogue-heavy training pairs** — current corpus filters out >70% dialogue. But voice distinction in dialogue is a core writing skill. The model should learn to handle dialogue tags and dialogue-adjacent narration, not just pure description/action.
- **Re-evaluate lint system role** — if a strong enough LoRA shifts the model's prior away from AI clichés organically, deterministic lint becomes redundant or counterproductive (flags patterns that real authors use intentionally). Test: run lint on V3 outputs vs base outputs, measure whether V3 already produces fewer violations. If so, lint becomes a safety net, not a pipeline stage.
- **DPO refinement** — generate multiple rewrites per paragraph, score by measurable style dimensions (sentence length, adjective density, verb concreteness), create preference pairs. ASTRAPOP showed +25% over SFT-only. Specifically targets structural patterns (sentence rhythm) that SFT hasn't fully captured.
- **Test V3 in production pipeline** — enable `pipeline.tonalPass`, run on an existing novel, compare before/after chapters.

## Cost Optimization

Real 10-chapter novel costs $0.63-$0.94 on Cerebras Qwen 235B. Rewriter is 24-32% of cost, extractors ~45%.

- **Deploy MiMo Flash for extractors** — tested equal on summary-extractor, fact-extractor, character-state, graph-linker (exp #88). Equal/better on continuity (exp #89). Saves ~$0.28/novel. Roles.ts already updated.
- **Keep relationship-timeline on Qwen 235B** — MiMo Flash missed knowledge gains. Knowledge gaps compound through retrieval.
- Evaluate DeepSeek V3.2 as rewriter — 95% prefix caching on 10K avg prompt tokens could cut rewriter cost. Pacing issue may not matter for rewrites where structure is set.

## Rewriter Architecture

- **Strip anti-pattern list from rewriter prompt** — rewriter can't self-police clichés (proven). Lint + tonal pass handles this.
- **Skip re-extraction for prose-only rewrites** — if rewrite only fixes cosmetic issues, extraction results are still valid. Saves $0.03/rewrite.
- Investigate reducing rewrite trigger threshold — currently too aggressive, 22-28 calls/novel.

## Pipeline Stability

- Deduplicate timeline events in DB — rewrite re-extractions create duplicate events
- Clean up stale DB data: 5 incomplete novels, 35 orphan benchmark runs, 35 experiments without conclusions

## Quality Measurement — Structured Checks, Not Score Judges

LLM judges scoring 1-10 are unreliable (0-33% discrimination in calibration). Replaced with structured pass/fail checks that produce specific actionable issues:

- **Adherence**: pass/fail per beat, deterministic checks + cheap LLM verification
- **Chapter plan check**: pass/fail per chapter, LLM compares prose against plan
- **Continuity**: LLM check against world state tables
- **Lint + tonal pass**: deterministic pattern matching, proven pipeline
- **Extraction quality**: precision (correct facts), recall (missed facts), schema compliance — computable against gold-standard dataset
- **Fine-tune evaluation**: compare fine-tuned model output vs gold standard on held-out test set — precision/recall, not 1-10 scores

## Autoresearcher

- Rename daemon → autoresearcher across codebase
- Refocus on deterministic quality signals — adherence pass rates, extraction precision/recall, contradiction detection rates
- Remove all LLM judge and embedding-related optimization targets

## Fine-Tuning (Qwen 3.5 9B on Together AI)

LoRA fine-tunes on Together ($0.48/M training tokens, $0.10/$0.15 inference). Knowledge distillation: base model extracts, Claude corrects to gold standard, train on Claude's output. Generic prompts — training data teaches behavior, not the prompt.

- **Fact-extractor fine-tune** — easiest win. Narrow schema (`{fact, category}[]`), clear validation (precision/recall vs gold standard). Build dataset: pull chapters from Postgres, base 9B extracts, Claude reviews/corrects, output Together JSONL.
- **Adherence-checker fine-tune** — runs every beat, high frequency. Classification task (pass/fail + deviation). Train on real beat/draft pairs.
- **Reference-resolver fine-tune** — runs every beat. Identify needed lookups from implicit references. Train on real beat descriptions.
- **Tonal pass** — V3 LoRA already shows promise. Expand corpus beyond Howard.
- **Chapter-level plan checker fine-tune** — post-assembly gate, runs once per chapter. Input: chapter plan (beats, characters, emotional shifts) + assembled prose. Output: specific structural deviations or PASS. Catches beat transition breaks, missing beats, emotional arc drift, character disappearance. Verifies against plan, not subjective quality. ~3-5K token input, structured comparison task.
- **Dataset generator script** — shared infrastructure for all fine-tunes. Pulls from Postgres, runs base + Claude, outputs Together JSONL, splits train/test.
- **Generate beat-level training data** — run beat pipeline across diverse seeds, log beat/draft/adherence/reference pairs for adherence-checker, reference-resolver, and chapter plan checker fine-tunes. New chapters also feed extraction fine-tunes.

## Future — Worldbuilding Workbench (separate project)

Interactive chat frontend backed by the knowledge graph. Author converses with their world, modifies plotlines, generates beats, adjusts world state. Output is a structured plan that feeds the harness. Workbench writes to knowledge graph, harness reads from it. Same Postgres tables, different interface. Semantic search / embeddings may be useful here for exploratory authorial queries. Entirely separate from the prose generation pipeline.

## Infrastructure

- Add context inspection view to web UI (show what the writer received for a chapter)

## Seeds & Testing

- Create 3-5 new seeds stressing different context layers: complex magic systems, many POV characters, dense continuity
