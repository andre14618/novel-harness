---
status: active
updated: 2026-04-13
---

# To Do

Pending action items only. Ordered by impact. Completed items and decision rationale live in `docs/decisions.md`.

## Extractor SFT — Sonnet-as-Judge Eval + Deploy (exp #187)

**4 extractor adapters trained on W&B** (2026-04-13). 256 Sonnet-reviewed pairs each, 50 novels. All produce valid JSON with correct schemas. Structural eval passed. **Content accuracy eval pending** — word-overlap F1 is a poor proxy; need Sonnet-as-judge semantic comparison before deploying.

| Adapter | Artifact | Structural | Content (pending) | Latency |
|---------|----------|-----------|-------------------|---------|
| fact-extractor-v1 | `fact-extractor-v1:v1` | 100% valid JSON, categories | 65.8% word F1 (~80-85% semantic est.) | 2.6s |
| summary-extractor-v1 | `summary-extractor-v1:v1` | 100% schema, 92% word ratio | Pending | 3.7s |
| character-state-v1 | `character-state-v1:v1` | 96% name recall, 100% schema | Pending | 2.8s |
| relationship-timeline-v1 | `relationship-timeline-v1:v1` | 100% schema, enums, sections | Pending | 6.9s |

**Next steps (ordered):**
1. Run prep script: `ssh novel-harness-lxc "bun scripts/prep-extractor-eval-batches.ts"` → generates `/tmp/extractor-eval/{agent}-eval.json`
2. Spawn 4 Sonnet subagents per `scripts/extractor-eval-judging-instructions.md` — measures content accuracy
3. If >=80% content recall: deploy to `models/roles.ts`, expected 98% cost reduction
4. If <80%: truncate user prompts to fix 2048 token limit truncation, retrain

**Known issues:**
- Sequence length: 77-100% of training examples exceed W&B ART 2048 token limit — assistant responses truncated during training
- Prompt drift: summary-extractor and character-state have minor wording changes between training data and live prompts — align before deploy
- Frozen prompts: all 4 prompts are locked — see `docs/adapter-training-reference.md`

**Lint fixer SFT** — 169 pairs with full data in `llm_calls`. 849 flagged issues in `lint_issues` across 34 patterns. Mine `(flagged_sentence, scene_context, good_rewrite)` triples from approved chapters. Target 200-300 examples across the 8 major pattern types.

## Together AI Tier 2 — V2 Training (In Progress)

V1 eval (exp #180, 2026-04-13): Together 9B significantly underperformed W&B 14B — adherence 80% vs 94%, chapter-plan 62% vs 100%, continuity 88% vs 98%. Root causes: `train_on_inputs` unspecified (possibly training on prompts), no warmup, 4-6× fewer gradient steps from forced batch_size=8.

**V2 training submitted (2026-04-13)** with fixes:
- `train_on_inputs: "auto"` (mask non-assistant tokens)
- `warmup_ratio: 0.1` (match W&B)
- `learning_rate: 1e-4` (halved — gentler with more epochs)
- Epochs increased: adherence 2→6, chapter-plan 3→10, continuity 3→12, tonal 2→4

Check status: `ssh novel-harness-lxc "cd ~/apps/novel-harness && python3 scripts/train-together.py --status"`
Re-run eval once complete: `bun scripts/eval-together-vs-wandb.ts` (update adapter names to V2)

## W&B Storage Management

**Resolved (2026-04-12):** Purged 20.8 GB of superseded artifacts (21.81 → 1.02 GB). Required enabling "models write access" in W&B team settings (was restricted by default on pay-as-you-go plan). Aliases must be stripped before deletion (`v.aliases = []; v.save(); v.delete()`). `train-lora.py` now auto-cleans after each training run. Cleanup script: `python3 scripts/cleanup-wandb-storage.py --delete`.

**Ongoing:** Each training run creates ~3.7 GB of intermediate artifacts. Post-training auto-cleanup keeps it under 5 GB free tier. Train one adapter at a time. No checkpoint frequency controls exist in ART — this is server-side, not configurable. See `docs/wandb-alternatives-report.md` for migration options if W&B becomes untenable (Together AI latency re-benchmark needed, Modal as fallback).

## Beat Architecture — DONE

Dramatic beats + dramatize writer + no-prescribed-dialogue rule shipped and validated (exp #173, #176). 5-novel validation (50 chapters): echo 0.35→0.20 (target met), dialogue 11.8%→17-28% (genre-dependent, target met for sci-fi/romance), first-attempt 79%→73-100% (target met). Full evidence in `docs/decisions.md` under "Beat Architecture."

**Remaining known issues (tracked elsewhere):**
- **Interiority** still near-zero (0.1-0.3/100w). Writer prompt issue, not beat architecture. Tracked under Structural Diversity.
- **Fantasy-siege low dialogue** (13.7%). Genre-specific. Tracked under Character Voice & Dialogue Phase 1.
- **Continuity location violations** from planner's chapter-level settings. Tracked under Planner Setting Coherence.

## SFT Data Distribution Shift (Beat Architecture)

All existing SFT training data was generated with screenplay-style beats (pre-exp #173/#176). Now that the pipeline uses dramatic-style beats, training data for future adapter versions should be regenerated:
- **Adherence checker** — 2,134 pairs (V4) trained on screenplay beats. V4 handles dramatic beats without retraining (validated exp #161), but V5+ should be regenerated with dramatic beat distribution.
- **Chapter plan checker** — 520 pairs (V2 dataset) trained on screenplay beats. V2 Sonnet relabeling (in progress) should use dramatic-style plans as input.
- **Continuity checker** — 253 pairs trained on screenplay beats. V2 deployed and working. V3 data generation should use dramatic-style plans.
- **Not urgent** — current adapters work. Regeneration is for the next training round of each checker.

## Adherence Checker — V4 DEPLOYED

- **V4 deployed and concluded** (exp #161, 2026-04-12) — `adherence-checker-v4` live at 512 token budget. Production eval: 79% first-attempt pass (23/30 beats), all failures resolved on retry, zero false positives. V2 config removed from `models/roles.ts` (dead — never invoked at runtime, only `adherence-events` is called). See `docs/decisions.md`.
- **GRPO/RL reward loop** (conditional, post-V4 validation) — adherence-checker is the only pipeline agent with a clean automatic reward signal (deterministic checks + synthetic labels). Design a GRPO loop on W&B/ART. Now unblocked since V4 is validated.

## Chapter Plan Checker — DONE

**V2 adapter deployed** (2026-04-12). `chapter-plan-checker-v2:v1` live in `models/roles.ts`. 96% accuracy vs Sonnet ground truth (vs 78% for gpt-oss-120b), 609ms latency. Validated on 520-pair oracle comparison (exp #178) + 3-chapter dark-fantasy production run (all chapters passed first attempt). See `docs/decisions.md`.

- Scope narrowed (2026-04-12): cross-beat properties only — setting coherence, emotional arc, major plot contradictions.
- V1 pilot (exp #154) superseded — V2 Sonnet labels (96% accuracy) are the definitive dataset.
- **Next data round** — regenerate with dramatic-style beat plans (current dataset used screenplay-style). Not urgent; V2 handles dramatic beats fine in production. Revisit when first-attempt pass rate trends downward.

## Continuity — V2 DEPLOYED

**V2 adapter deployed** (2026-04-12). `continuity-v2:v1` live in `models/roles.ts` for both `continuity-facts` and `continuity-state`. 3-chapter dark-fantasy validation (novel-1776029103713): 0 false positives, 0 missed issues, 11.9× cost reduction vs Cerebras 235B ($0.0011 vs $0.0128), 204ms warm latency. See `docs/decisions.md`.

- V1 pilot (exp #155) superseded by V2 — do not eval V1.
- **Phase 2 — scale to 300 pairs** — add 10 more scenarios to `scripts/generate-continuity-data.ts` + VAR_WARNING_2 variants. Prioritize LitRPG scenarios and multi-chapter carryover. Then re-run Sonnet labeling pipeline.
- **Compact diff format (Phase 3)** — V2 trains on full-dump format (~7,300 tokens). Compressing to ~1,000 tokens via structured diff requires new input format + new training data. Phase 3 is now unblocked.
- **Next data round** — regenerate with dramatic-style beat plans (current dataset used screenplay-style). Not urgent; V2 handles dramatic beats fine in production.

## Tonal Pass

- **Together AI now Tier 2 hot standby** — V3 tonal-pass on Together retired (V4 on W&B preferred, pref eval 2026-04-11). All 4 adapters retraining on Together's Qwen 3.5 9B (submitted 2026-04-12) as Tier 2 fallback. Keep `TOGETHER_API_KEY`. Once training completes, verify adapter quality against W&B baselines before declaring Tier 2 ready.
- **Tonal pass expansion** — v3/v4 training data is dark-fantasy-specific (Howard corpus). Multi-genre corpus needed before tonal pass is usable as a general pipeline stage. Public domain candidates: Hemingway (pre-1929), London, Cather, Fitzgerald. See `docs/ai-training-copyright-landscape.md`.

## Open Experiments (need concludeExperiment())

- **Exp #154** (chapter-plan-checker-v1) — superseded by V2. Conclude with note: "V1 pilot on gpt-oss labels superseded by chapter-plan-checker-v2 (Sonnet labels, 96% accuracy, exp #170/#178). V1 not evaluated."
- **Exp #155** (continuity-v1) — superseded by V2. Conclude with note: "V1 pilot superseded by continuity-v2 (253 pairs, 99% Sonnet accuracy, exp #175). V1 not evaluated."
- **Exp #159** (adherence-v3-sonnet) — partial eval done (character 61% regression documented). Conclude with notes.

## Fine-Tuning (Other)

- **Fact extractor tightening** — still 17–20 facts/chapter, target 8–15. Tracked under Extractor SFT above.
- **Beat writer SFT** (opportunistic, high risk) — 7.8× cost reduction if it works. Shadow-run in parallel with 235B. Validation bar: adherence rate ≥ 235B baseline, lint counts ≤ baseline, 2 full novels without regression. Blocked until structural diversity in the training corpus is addressed.

## Planner Setting Coherence

- **Beat specs assign wrong settings when scenes cross locations** — production data (563 adherence-setting calls, 24 flags = 4.3%) shows the planner assigns a chapter-level setting to all beats even when the narrative naturally transitions mid-chapter (e.g., "Drowned Row Gym" assigned but prose correctly moves to "Statless Hideout"). This is a planner-level bug, not a writer-level bug. The beat writer can't fix it by rewriting.
  - **Investigation**: query `llm_calls` for adherence-setting flags, cross-reference with chapter outlines to identify which planning patterns produce stale settings on mid/late beats.
  - **Fix options**: (1) planner outputs per-beat settings instead of chapter-level; (2) post-plan validation that checks beat descriptions against their assigned settings for location transitions; (3) beat context assembly detects setting shifts from prior beat prose and overrides the stale plan setting.
  - **Chapter plan checker already has `setting_match`** — once beat-level setting checks are removed (done), the chapter plan checker is the only remaining setting gate. Consider whether it should validate setting coherence *across* beats rather than per-beat.

## Pipeline Tuning

- **extractionMode decision** — currently `"both"` (planner state + LLM extractors). Once extractor LoRAs are deployed (see above), choose: `"extract"` (LoRA extractors only) or `"plan"` (planner output only, no LLM extractors). Relationship-timeline has no planner equivalent — must keep as LLM call regardless.
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

## Local Apple Silicon Inference (Tier 4 Evaluation)

Evaluate running LoRA adapters locally on MacBook Air M4 24GB instead of W&B. See `docs/wandb-alternatives-report.md` for full analysis.

**Cost savings are minimal** (~$3/year) — adapter calls are already ~$0.004/novel on W&B. The value is zero provider dependency and unlimited experimentation at zero marginal cost.

**Evaluation steps:**
1. Install MLX or Ollama, download Qwen 3.5 9B Q4/Q8
2. Convert Together-trained LoRA adapters (SafeTensors) to MLX format
3. Run all 4 adapters on quantized local base and compare accuracy to W&B (FP16 base) — adherence, chapter-plan, continuity, tonal
4. If quality holds: register as `local` provider in `models/registry.ts`, add transport support for local endpoint
5. Benchmark latency on real pipeline calls (expect ~3-10s/call vs 157-609ms W&B)
6. Test Mac Mini 16GB with 9B Q4 under sustained load (memory pressure risk)

**Together AI training (2026-04-12):** All 4 adapters submitted for LoRA training on `Qwen/Qwen3.5-9B` (r=16, alpha=32). Check status: `ssh novel-harness-lxc "cd ~/apps/novel-harness && python3 scripts/train-together.py --status"`. Once complete, these adapters can serve double duty — Together Tier 2 inference AND local Tier 4 inference (same SafeTensors format).

**GPU rental benchmarked (2026-04-12):** Per-second analysis against 20 real novels. GPU rental is 3-5x more expensive than current API setup. Break-even requires ~530 novels/day. Viable for batch jobs (SFT data gen, eval sweeps) but not per-novel pipeline. Full report: `docs/gpu-rental-analysis.md`.

## Infrastructure

- **Extend LLM call inspector tags** — `chapter` / `beat_index` / `attempt` populated for beat-writer and adherence-checker. Need to thread through reference-resolver, continuity, chapter-plan-checker, rewriter, planner, and extractors. Columns already exist; each agent's `callAgent` site needs the tags. See `docs/llm-call-inspector.md`.

## Pipeline Stability

- **Deduplicate timeline events** — rewrite re-extractions create duplicate timeline events in DB.
- **Clean up stale DB data** — incomplete novels, orphan benchmark runs, experiments without conclusions.

## Future

- **Worldbuilding Workbench** (separate project) — interactive chat frontend backed by the knowledge graph. Author converses with their world, modifies plotlines, generates beats, adjusts world state. Output is a structured plan that feeds the harness. Same Postgres tables, different interface. Entirely separate from the prose generation pipeline.
