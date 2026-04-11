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

- **SFT training in progress** — 197-pair dataset (`lora-data/chapter-plan-checker-pairs-v2-final.jsonl`) submitted to W&B Serverless SFT as `chapter-plan-checker-v1` (exp #154). Teacher: gpt-oss-120b (87.5% agreement on PASS variants, Sonnet escalation on FAIL_MISSING_BEAT). Class balance: 54:46. Eval target: ≥80% oracle agreement on held-out pairs before swapping from gpt-oss-120b. Adapter URI once done: `wandb-artifact:///andre14618-/novel-harness/chapter-plan-checker-v1-sft-resume:v9`.
- **Accumulate real production pairs** — 197 synthetic pairs are the V1 training set. For V2: run 10–15 novels on diverse seeds, collect oracle labels from the production gpt-oss-120b calls (already flowing through `llm_calls`), relabel with the validated adapter for self-improvement loop.

## Continuity

- **SFT training in progress** — 120-pair dataset (`lora-data/continuity-pairs-sonnet-labeled.jsonl`) submitted to W&B Serverless SFT as `continuity-v1` (exp #155). Teacher: Sonnet 4.6 (98% accuracy vs expected labels; 235B misses 90% of WARNINGs). Eval target: ≥80% accuracy on held-out continuity pairs before swapping from 235B. Adapter URI once done: `wandb-artifact:///andre14618-/novel-harness/continuity-v1-sft-resume:v9`.
- **Phase 2 — scale to 300 pairs** — add 10 more scenarios to `scripts/generate-continuity-data.ts` + VAR_WARNING_2 variants. Prioritize LitRPG scenarios and multi-chapter carryover. Then re-run Sonnet labeling pipeline.
- **Compact diff format (Phase 3)** — V1 trains on full-dump format (same as production ~7,300 tokens). Compressing to ~1,000 tokens via structured diff requires a new input format design + new training data. Do not attempt until V1 eval passes.

## Tonal Pass

- **Remove Together AI provider** — V4 confirmed preferred (pref eval 2026-04-11). Remove `TOGETHER_API_KEY`, Together entries from `models/registry.ts`, and provider config. V3 on Together was the only remaining use.
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
