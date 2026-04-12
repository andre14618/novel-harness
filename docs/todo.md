---
status: active
updated: 2026-04-12
---

# To Do

Pending action items only. Ordered by impact. Completed items and decision rationale live in `docs/decisions.md`.

## Beat Architecture — DONE

Dramatic beats + dramatize writer + no-prescribed-dialogue rule shipped and validated (exp #173, #176). 5-novel validation (50 chapters): echo 0.35→0.20 (target met), dialogue 11.8%→17-28% (genre-dependent, target met for sci-fi/romance), first-attempt 79%→73-100% (target met). Full evidence in `docs/decisions.md` under "Beat Architecture."

**Remaining known issues (tracked elsewhere):**
- **Interiority** still near-zero (0.1-0.3/100w). Writer prompt issue, not beat architecture. Tracked under Structural Diversity.
- **Fantasy-siege low dialogue** (13.7%). Genre-specific. Tracked under Character Voice & Dialogue Phase 1.
- **Continuity location violations** from planner's chapter-level settings. Tracked under Planner Setting Coherence.

## Adherence Checker

- **V4 deployed and concluded** (exp #161, 2026-04-12) — `adherence-checker-v4` live at 512 token budget. Production eval: 79% first-attempt pass (23/30 beats), all failures resolved on retry, zero false positives. Synthetic eval (70%) not reliable for this task — production signal is the metric. See `docs/decisions.md`.
- **GRPO/RL reward loop** (conditional, post-V4 validation) — adherence-checker is the only pipeline agent with a clean automatic reward signal (deterministic checks + synthetic labels). Design a GRPO loop on W&B/ART. Now unblocked since V4 is validated.

## Chapter Plan Checker

- **Scope narrowed** — `beats_covered` and `characters_present` removed from schema and prompt (2026-04-12). Now focused on cross-beat properties only: setting coherence, emotional arc, major plot contradictions. Beat-level adherence handles event coverage and character presence.
- **SFT training in progress** — 197-pair dataset (`lora-data/chapter-plan-checker-pairs-v2-final.jsonl`) submitted to W&B Serverless SFT as `chapter-plan-checker-v1` (exp #154). Teacher was gpt-oss-120b — now superseded by Sonnet (exp #158: Sonnet 94.3% vs gpt-oss 88.2%). V1 is a pilot. Class balance: 54:46. Eval target: ≥80% oracle agreement on held-out pairs. Adapter URI once done: `wandb-artifact:///andre14618-/novel-harness/chapter-plan-checker-v1-sft-resume:v9`.
- **V2 dataset with Sonnet labels** — V1 gpt-oss labels had ~12% error rate on PASS_REORDER and FAIL_REVERSED_ARC. V2 path: (1) add 20+ scenarios to `scripts/generate-chapter-plan-data.ts` (currently 25, target 45+); (2) relabel all pairs with Sonnet subagents; (3) combine with corrected V1 data → ~500+ pairs; (4) train `chapter-plan-checker-v2`. Do NOT re-collect production oracle gpt-oss labels — teacher is now Sonnet.

## Continuity

- **SFT training in progress** — 120-pair dataset (`lora-data/continuity-pairs-sonnet-labeled.jsonl`) submitted to W&B Serverless SFT as `continuity-v1` (exp #155). Teacher: Sonnet 4.6 (98% accuracy vs expected labels; 235B misses 90% of WARNINGs). Eval target: ≥80% accuracy on held-out continuity pairs before swapping from 235B. Adapter URI once done: `wandb-artifact:///andre14618-/novel-harness/continuity-v1-sft-resume:v9`.
- **Phase 2 — scale to 300 pairs** — add 10 more scenarios to `scripts/generate-continuity-data.ts` + VAR_WARNING_2 variants. Prioritize LitRPG scenarios and multi-chapter carryover. Then re-run Sonnet labeling pipeline.
- **Compact diff format (Phase 3)** — V1 trains on full-dump format (same as production ~7,300 tokens). Compressing to ~1,000 tokens via structured diff requires a new input format design + new training data. Do not attempt until V1 eval passes.

## Tonal Pass

- **Remove Together AI provider** — V4 confirmed preferred (pref eval 2026-04-11). Remove `TOGETHER_API_KEY`, Together entries from `models/registry.ts`, and provider config. V3 on Together was the only remaining use.
- **Tonal pass expansion** — v3/v4 training data is dark-fantasy-specific (Howard corpus). Multi-genre corpus needed before tonal pass is usable as a general pipeline stage. Public domain candidates: Hemingway (pre-1929), London, Cather, Fitzgerald. See `docs/ai-training-copyright-landscape.md`.

## Open Experiments (need concludeExperiment())

- **Exp #154** (chapter-plan-checker-v1) — training submitted, eval pending. Run oracle agreement eval on held-out pairs.
- **Exp #155** (continuity-v1) — training submitted, eval pending. Run accuracy eval on held-out pairs.
- **Exp #159** (adherence-v3-sonnet) — partial eval done (character 61% regression documented). Conclude with notes.
- **Exp #161** (adherence-v4-events-sonnet) — concluded 2026-04-12. See `docs/decisions.md`.

## Fine-Tuning (Other)

- **Fact extractor tightening** — still 17–20 facts/chapter, target 8–15. Run `bun scripts/build-finetune-data.ts --task fact-extractor --limit 50`, review 20–30 pairs, correct to gold, scale to 300+.
- **Lint fixer SFT** — mine approved chapters for `(flagged_sentence, scene_context, good_rewrite)` triples. Target 200–300 examples across the 8 AI cliché pattern types. Low risk.
- **Beat writer SFT** (opportunistic, high risk) — 7.8× cost reduction if it works. Shadow-run in parallel with 235B. Validation bar: adherence rate ≥ 235B baseline, lint counts ≤ baseline, 2 full novels without regression. Blocked until structural diversity in the training corpus is addressed.

## Planner Setting Coherence

- **Beat specs assign wrong settings when scenes cross locations** — production data (563 adherence-setting calls, 24 flags = 4.3%) shows the planner assigns a chapter-level setting to all beats even when the narrative naturally transitions mid-chapter (e.g., "Drowned Row Gym" assigned but prose correctly moves to "Statless Hideout"). This is a planner-level bug, not a writer-level bug. The beat writer can't fix it by rewriting.
  - **Investigation**: query `llm_calls` for adherence-setting flags, cross-reference with chapter outlines to identify which planning patterns produce stale settings on mid/late beats.
  - **Fix options**: (1) planner outputs per-beat settings instead of chapter-level; (2) post-plan validation that checks beat descriptions against their assigned settings for location transitions; (3) beat context assembly detects setting shifts from prior beat prose and overrides the stale plan setting.
  - **Chapter plan checker already has `setting_match`** — once beat-level setting checks are removed (done), the chapter plan checker is the only remaining setting gate. Consider whether it should validate setting coherence *across* beats rather than per-beat.

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
- **Archetype pattern research + synthetic generation** — study modern fiction freely to extract archetype speech patterns (what a `stoic_warrior` or `scheming_noble` sounds like is a pattern, not a copyrightable expression). Use 235B to generate synthetic training pairs from those patterns: `(flat_dialogue + archetype_profile) → (voiced_dialogue)`. Do not use verbatim copyrighted dialogue lines as training targets — extract the pattern, generate the examples. Modern genre fiction is more relevant than public domain for the seeds the pipeline targets (post-apoc, sci-fi, fantasy). Target: 400–500 pairs across 10–12 archetypes. ~$3–5 at 235B rates.

### Phase 3 — Voice-pass LoRA (after Phase 1+2 in production)
- **Beats-compatible voice-pass adapter** on W&B Qwen3-14B. Beat-writer generates voice-agnostic prose; voice-pass rewrites dialogue-only paragraphs conditioned on the character's `SpeechProfile`. Training format: `[system: voice-pass] [user: CHARACTER_PROFILE: {...} DIALOGUE: "..." CONTEXT: "..."] [assistant: "voiced dialogue"]`. Train `voice-pass-archetype-v1` once 400+ pairs assembled from the ingestion pipeline above. Blocked on Phase 1 infrastructure.

### Future — Character voice checker (blocked on Phase 1)
- Per-beat classifier checking whether dialogue matches the character's `SpeechProfile`. Train from `(dialogue_line, speech_profile, matches: bool)` once voice-pass infrastructure generates labeled examples naturally.

## Studio

- **Chat-driven creation flow** — Studio was rebuilt as a pipeline-first interface (compact creation bar + inline pipeline view with narrative activity feed, 2026-04-11). Next step: replace the form-based seed input with a conversational chat interface where an LLM (Cerebras Qwen 235B) shapes user input into `CustomSeed` format, asks for confirmation, then kicks off the pipeline.

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
