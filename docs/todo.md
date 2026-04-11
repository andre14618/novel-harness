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

- **SFT training in progress** — 197-pair dataset (`lora-data/chapter-plan-checker-pairs-v2-final.jsonl`) submitted to W&B Serverless SFT as `chapter-plan-checker-v1` (exp #154). Teacher was gpt-oss-120b — now superseded by Sonnet (exp #158: Sonnet 94.3% vs gpt-oss 88.2%). V1 is a pilot. Class balance: 54:46. Eval target: ≥80% oracle agreement on held-out pairs. Adapter URI once done: `wandb-artifact:///andre14618-/novel-harness/chapter-plan-checker-v1-sft-resume:v9`.
- **V2 dataset with Sonnet labels** — V1 gpt-oss labels had ~12% error rate on PASS_REORDER and FAIL_REVERSED_ARC. V2 path: (1) add 20+ scenarios to `scripts/generate-chapter-plan-data.ts` (currently 25, target 45+); (2) relabel all pairs with Sonnet subagents; (3) combine with corrected V1 data → ~500+ pairs; (4) train `chapter-plan-checker-v2`. Do NOT re-collect production oracle gpt-oss labels — teacher is now Sonnet.

## Continuity

- **SFT training in progress** — 120-pair dataset (`lora-data/continuity-pairs-sonnet-labeled.jsonl`) submitted to W&B Serverless SFT as `continuity-v1` (exp #155). Teacher: Sonnet 4.6 (98% accuracy vs expected labels; 235B misses 90% of WARNINGs). Eval target: ≥80% accuracy on held-out continuity pairs before swapping from 235B. Adapter URI once done: `wandb-artifact:///andre14618-/novel-harness/continuity-v1-sft-resume:v9`.
- **Phase 2 — scale to 300 pairs** — add 10 more scenarios to `scripts/generate-continuity-data.ts` + VAR_WARNING_2 variants. Prioritize LitRPG scenarios and multi-chapter carryover. Then re-run Sonnet labeling pipeline.
- **Compact diff format (Phase 3)** — V1 trains on full-dump format (same as production ~7,300 tokens). Compressing to ~1,000 tokens via structured diff requires a new input format design + new training data. Do not attempt until V1 eval passes.

## Tonal Pass

- **Remove Together AI provider** — V4 confirmed preferred (pref eval 2026-04-11). Remove `TOGETHER_API_KEY`, Together entries from `models/registry.ts`, and provider config. V3 on Together was the only remaining use.
- **Tonal pass expansion** — v3/v4 training data is dark-fantasy-specific (Howard corpus). Multi-genre corpus needed before tonal pass is usable as a general pipeline stage. Public domain candidates: Hemingway (pre-1929), London, Cather, Fitzgerald. See `docs/ai-training-copyright-landscape.md`.

## Adherence Checker

- **V3 Sonnet-teacher adapter** — 7,540 pairs relabeled (2026-04-11), submitted to W&B SFT as `adherence-checker-v3-sonnet` (exp #159). ETA ~4h. Adapter URI once done: `wandb-artifact:///andre14618-/novel-harness/adherence-checker-v3-sonnet-sft-resume:v9`. Decision gate: must improve FAIL_TANGENT_HARD (V2: 69%) and FAIL_MISSING_SUBTLE (V2: 78.6%) without regressing events below 95%.

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

## Character Voice & Dialogue

### Phase 1 — Context engineering (no training required, build now)
- **Structured `SpeechProfile` schema** — replace the free-text `speechPattern` field in character snapshots with concrete attributes: `register`, `sentenceLength`, `vocabulary[]`, `forbiddenPhrases[]`, `syntacticPatterns[]`, `emotionalExpression`. Render in beat context as a structured block with 2–3 example lines, not attribute lists. Q14B follows examples far better than abstract descriptions.
- **Forbidden phrase lint (character-scoped)** — extend the deterministic lint layer to flag per-character `forbiddenPhrases` in dialogue. Same mechanism as existing cliché patterns, scoped by character name. Zero model cost.
- **Planner dialogue quantity guidance** — add explicit dialogue beat targets to the planning-plotter prompt. At least 2 of 4–6 scene beats should be primarily dialogue-driven. Current output: 15.7% dialogue vs 25–50% published norm. Measure with `scripts/analyze-structure.ts` before and after.

### Phase 2 — Archetype library (no training required)
- **15–20 named archetypes** with structured speech profiles and 3–5 canonical example dialogue lines each. Map every generated character to an archetype at concept time; beat context gets examples automatically. Target archetypes: `stoic_warrior`, `scheming_noble`, `earnest_apprentice`, `reluctant_hero`, `cynical_mentor`, `naive_innocent`, `calculating_villain`, `world_weary_professional`, `hot_tempered_youth`, `diplomatic_deceiver`, `hard_boiled_detective`, `theatrical_authority`.

### Phase 2 data — Dialogue pattern ingestion (feeds Phase 3)
- **Public domain dialogue extraction pipeline** — Project Gutenberg sources with strong character voice: Doyle (Holmes/Watson — analytical_deducer, earnest_companion), Hammett (hard_boiled), Wodehouse pre-1930 (evasive_servant, exasperated_authority), Dickens (theatrical villains, earnest apprentices), Conrad (formal_authority), Twain (dialect/colloquial), Haggard (stoic adventure), O. Henry (deadpan working-class). Extract 2–8 sentence dialogue exchanges with attribution. Use 235B to: (a) assign archetype label, (b) generate neutral "flattened" version. Training pair: `(flat_dialogue + archetype_profile) → (original_voiced_dialogue)`. Target: 400–500 pairs across 10–12 archetypes. ~$3–5 total. Same distillation-from-corpus pattern as the Howard tonal pass.

### Phase 3 — Voice-pass LoRA (after Phase 1+2 in production)
- **Beats-compatible voice-pass adapter** on W&B Qwen3-14B. Beat-writer generates voice-agnostic prose; voice-pass rewrites dialogue-only paragraphs conditioned on the character's `SpeechProfile`. Training format: `[system: voice-pass] [user: CHARACTER_PROFILE: {...} DIALOGUE: "..." CONTEXT: "..."] [assistant: "voiced dialogue"]`. Train `voice-pass-archetype-v1` once 400+ pairs assembled from the ingestion pipeline above. Blocked on Phase 1 infrastructure.

### Future — Character voice checker (blocked on Phase 1)
- Per-beat classifier checking whether dialogue matches the character's `SpeechProfile`. Train from `(dialogue_line, speech_profile, matches: bool)` once voice-pass infrastructure generates labeled examples naturally.

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
