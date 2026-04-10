---
status: active
updated: 2026-04-10
---

# To Do

Pending action items only. Ordered by impact. Completed items and decision rationale live in `docs/decisions.md`.

## Adherence Checker

- **Tiered retry policy** — any single flag currently fires a full beat rewrite. Proposed: events/character flags → hard gate (always retry), setting/tangent → soft gate (log warning, skip retry unless off_spec_fraction > 0.7). Reduces false-rejection rate from ~19% to ~5–7%. Especially important with expensive writer models.
- **3-chapter romance-drama end-to-end validation** — V2 adapter + tiered retry policy. Measure actual retry rate, false-rejection impact, and whether setting/tangent soft gates cause downstream chapter-plan-checker failures.
- **GRPO/RL reward loop** (conditional, post-validation) — adherence-checker is the only pipeline agent with a clean automatic reward signal (deterministic checks + synthetic labels). Design a GRPO loop on W&B/ART after the tiered retry policy is validated and any residual SFT gaps are assessed.

## Chapter Plan Checker

- **SFT distillation** — distill gpt-oss-120b onto Qwen3-14B via SFT. Base 14B at 58% direct agreement; 100% one-directional bias (rubber-stamps PASS). SFT is the right fix for systematic under-detection. Data: (a) 80 synthetic pairs in `lora-data/chapter-plan-checker-pairs.jsonl` — relabel with 120B outputs from exp #107; (b) accumulate 200+ real production pairs from diverse novel runs. Stay on gpt-oss-120b in production until a fine-tuned adapter exists. See `project_chapter_plan_checker_finetune.md`.

## Continuity

- **Build Claude-as-teacher labeling pipeline** — 235B misses 90% of warnings and 65% of nits (exp #117/#118). Use Opus or Sonnet (not gpt-oss — peer-tier with 235B on this task). Steps: hand-validate WARNING/NIT variant injections in `scripts/generate-continuity-data.ts`, re-run the synthetic eval with Claude as teacher, confirm improvement before full data run. ~1,000 pairs, ~$15 (Sonnet) once validated. See `docs/decisions.md`.

## Tonal Pass

- **Pref eval** — V4 quantitative metrics beat V3 on every dimension (exp #98) but reads as more conservative. Run 15-paragraph binary preference eval in `/app/lora` → Pref Eval tab. V3 stays in production until pref eval confirms V4.
- **Remove Together AI provider** — once V4 is confirmed, remove `TOGETHER_API_KEY`, Together entries from `models/registry.ts`, and provider config. V3 on Together is the only remaining use; no new adapters go there.
- **Tonal pass expansion** — v3/v4 training data is dark-fantasy-specific (Howard corpus). Multi-genre corpus needed before tonal pass is usable as a general pipeline stage. Public domain candidates: Hemingway (pre-1929), London, Cather, Fitzgerald. See `docs/ai-training-copyright-landscape.md`.

## Fine-Tuning (Other)

- **Fact extractor tightening** — still 17–20 facts/chapter, target 8–15. Run `bun scripts/build-finetune-data.ts --task fact-extractor --limit 50`, review 20–30 pairs, correct to gold, scale to 300+.
- **Lint fixer SFT** — mine approved chapters for `(flagged_sentence, scene_context, good_rewrite)` triples. Target 200–300 examples across the 8 AI cliché pattern types. Low risk.
- **Beat writer SFT** (opportunistic, high risk) — 7.8× cost reduction if it works. Shadow-run in parallel with 235B. Validation bar: adherence rate ≥ 235B baseline, lint counts ≤ baseline, 2 full novels without regression. Blocked until structural diversity in the training corpus is addressed.

## Pipeline Tuning

- **Switch extractionMode to "plan"** — planner already outputs `establishedFacts`, `characterStateChanges`, `knowledgeChanges`. Once verified against a few novels, disable LLM extractors (except relationship-timeline). Currently set to "both".
- **Word count below target** — 550–770w vs 800–1100w target. Measure pre- vs post-tonal-pass word counts to isolate cause (model, prompt, beat granularity, or tonal pass shortening).
- **Re-evaluate lint system role** — if tonal pass LoRA already reduces AI clichés, lint becomes a safety net rather than a pipeline stage. Test: run lint on tonal-pass outputs vs base outputs.
- **Strip anti-pattern list from rewriter prompt** — rewriter can't self-police clichés (proven). Lint + tonal pass handles this.
- **Skip re-extraction for prose-only rewrites** — if a rewrite fixes only cosmetic issues, extraction results remain valid.

## Structural Diversity

- **Structural diversity pass** — pipeline prose is below published norms: 15.7% dialogue (published: 25–50%), 0.1 interiority verbs/100w, 7.5w avg sentence length (published: 12–18w). Needs paired training data (current output → structurally rich output) that doesn't exist yet. Block beat-writer SFT and new tonal-pass training until addressed.
- **Analysis tracking** — run `scripts/analyze-structure.ts` after each batch of new novels to track improvement.

## Seeds & Data Diversity

- **Run 10–15 novels across new seeds** — 30 seeds created (2026-04-09): 8 post-apoc, 7 sci-fi, 7 epic fantasy, 4 portal fantasy, plus 6 originals. All 131 approved chapters come from only 5 premises. Chapter-plan-checker and continuity SFT need plan/world-state diversity synthetic generation can't provide.

## Character Voice

- **Speech profiles** — add concrete attributes per character to character-agent (register, vocabulary, patterns, forbidden phrases). Current `speechPattern` field captures this as free text but needs to be richer for downstream checking.
- **Character voice checker** (future, blocked on speech profiles) — per-beat check that dialogue matches character speech profile. Train from `(dialogue_line, speech_profile, matches: bool)` examples once profiles exist.

## Studio

- **Chat-driven rebuild** of `/app/studio` — replace form-based launcher with conversational chat interface. LLM (Cerebras Qwen 235B) shapes input into `CustomSeed` format, asks for confirmation, then kicks off the pipeline and transitions to a terminal-style SSE stream view. Current Studio page (form + passive log) doesn't match the vision.

## Autoresearcher / Daemon

- **Rename daemon → autoresearcher** across codebase.
- **Refocus on structured quality signals** — adherence pass rates, plan check rates, lint counts, extraction precision/recall. Remove all LLM judge and embedding-related optimization targets.

## Infrastructure

- **Mac Mini as local inference provider** — Ollama + `qwen3.5:9b` resident in memory, registered as `local` provider in `models/registry.ts` at `http://mac-mini:11434/v1`. Role: background/batch jobs only (tonal-pass pair generation, analytical LoRA input generation, agreement probes). Not for online per-beat inference.
- **Extend LLM call inspector tags** — `chapter` / `beat_index` / `attempt` populated for beat-writer and adherence-checker. Need to thread through reference-resolver, continuity, chapter-plan-checker, rewriter, planner, and extractors. Columns already exist; each agent's `callAgent` site needs the tags. See `docs/llm-call-inspector.md`.

## Pipeline Stability

- **Deduplicate timeline events** — rewrite re-extractions create duplicate timeline events in DB.
- **Clean up stale DB data** — incomplete novels, orphan benchmark runs, experiments without conclusions.

## Future

- **Worldbuilding Workbench** (separate project) — interactive chat frontend backed by the knowledge graph. Author converses with their world, modifies plotlines, generates beats, adjusts world state. Output is a structured plan that feeds the harness. Same Postgres tables, different interface. Entirely separate from the prose generation pipeline.
