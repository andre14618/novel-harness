---
status: active
updated: 2026-04-16
---

# To Do

Pending action items only. Ordered by impact. Completed items and decision rationale live in `docs/decisions.md`.

## Writer Imitation Benchmark — Salvatore deconstruction (TRAINING IN FLIGHT)

Treat writer quality as an engineering problem with a measurable ground truth. Deconstruct the Icewind Dale Trilogy into beat-level training pairs, build a permanent quality oracle that scores every methodology (model swap, primer change, generation unit change, SFT adapter) against actual published prose for the same beats.

**Full plan:** `docs/writer-imitation-benchmark.md` (measurement layer) + `docs/writer-style-imitation-design-space.md` (method layer). Phase A + B results in `docs/corpus-structural-analysis.md`. Decisions in `docs/decisions.md` ("Writer Voice Imprinting").

**Status (2026-04-16):**
- Phase A (corpus decomposition): **DONE** — 777 paired (brief, prose) beats, 83,641 prose words, 703/74 train/val
- Phase B (chunk-size A/B on DeepSeek baseline): **DONE** — 120w wins (Δ-sum 1.81); identifies the rhythm + sensory-density gaps the LoRA must close
- Phase C (LoRA training + validation): **DONE** — `salvatore-1988-v1` trained and validated; Δ-sum 0.45 vs DeepSeek 2.45 (exp #192 concluded)

### Phase D — production validation (next)
1. 3-chapter pipeline run on litrpg seed with `salvatore-1988-v1` as beat-writer; compare adherence pass rate, lint counts, and structural analysis to DeepSeek + Howard primer baseline
2. 3-chapter run on romance-drama seed (voice-mismatch genre) to confirm the adapter doesn't catastrophically degrade outside its training distribution
3. If production holds → register in `models/registry.ts` and add as an opt-in writer for genre-appropriate seeds (eventually default if it also beats DeepSeek on adherence + structural)
4. If production regresses → keep as tonal-pass candidate (Howard tonal V4 analog for Salvatore voice), not default writer

### Phase D (deferred) — "Capability vs tuning" 2×2
Originally planned as POC. Now superseded by the live training run — `salvatore-1988-v1` IS the small-model LoRA cell. If B > C decisively after Phase C validation, skip the 2×2; SFT at small scale answered the question. If B < C, run the larger-base cell (Llama 3.3 70B on Together, ~$2.60) to distinguish "14B too small" from "tuning doesn't move this writer-voice axis."

---

## Writer-side voice imprinting — DEPRIORITIZED, superseded by imitation benchmark

DeepSeek V3.2 + Howard primer is now the default writer stack (exp #189/#190/#191, see `docs/decisions.md` "DeepSeek V3.2 + Howard primer promoted to pipeline-wide default"). All voice-SFT plans below are paused pending the Salvatore imitation benchmark verdict — the benchmark will tell us whether any SFT investment (14B, larger-base, or DeepSeek-class) is justified vs. simply improving primer strategy or generation unit.

**Phase 1 (Qwen3-14B beat-writer SFT)** — PAUSED. Pre-benchmark hypothesis was 14B may be under-capacity for voice imprinting. The benchmark's M4/M6 (hybrid primer at beat/scene level) will dominate this if primer is sufficient; M9/M10 (Sonnet ceiling) will clarify whether any DeepSeek-class methodology even matters. Only revisit if benchmark verdict says DeepSeek + primer leaves a large gap to M9/M10 AND a 14B SFT could plausibly close it.

**Phase 2 (larger-base SFT on W&B or Together)** — PAUSED. Same gating as Phase 1 but with bigger bases (Qwen3.5 397B A17B on Together, Llama 70B, next hot W&B base when available). Training costs are meaningful ($20–100+ per run), so this path requires benchmark verdict + a clear ceiling to chase.

**Phase 3 (DeepSeek experiments)** — DONE/shipped. DeepSeek as default writer and Howard primer cached at ~94% hit rate both landed as pipeline-wide defaults 2026-04-15.

**Ongoing:** post-hoc tonal pass stays reachable via `POST /tonal-pass` for adapter comparison on any existing novel. Auto-run is disabled.

**Lint fixer SFT** — 169 pairs with full data in `llm_calls`. 849 flagged issues in `lint_issues` across 34 patterns. Mine `(flagged_sentence, scene_context, good_rewrite)` triples from approved chapters. Target 200-300 examples across the 8 major pattern types. Not blocked by benchmark — lint is deterministic rewriting, not voice imprinting.

## W&B Storage Management

**Resolved (2026-04-12):** Purged 20.8 GB of superseded artifacts (21.81 → 1.02 GB). Required enabling "models write access" in W&B team settings (was restricted by default on pay-as-you-go plan). Aliases must be stripped before deletion (`v.aliases = []; v.save(); v.delete()`). `train-lora.py` now auto-cleans after each training run. Cleanup script: `python3 scripts/finetune/cleanup-wandb-storage.py --delete`.

**Ongoing:** Each training run creates ~3.7 GB of intermediate artifacts. Post-training auto-cleanup keeps it under 5 GB free tier. Train one adapter at a time. No checkpoint frequency controls exist in ART — this is server-side, not configurable. Modal is the fallback if W&B becomes untenable.

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
- **Tonal pass expansion** — v3/v4 training data is dark-fantasy-specific (Howard corpus). Multi-genre corpus needed before tonal pass is usable as a general pipeline stage. Public domain candidates: Hemingway (pre-1929), London, Cather, Fitzgerald.

## Open Experiments (need concludeExperiment())

- **Exp #154** (chapter-plan-checker-v1) — superseded by V2. Conclude with note: "V1 pilot on gpt-oss labels superseded by chapter-plan-checker-v2 (Sonnet labels, 96% accuracy, exp #170/#178). V1 not evaluated."
- **Exp #155** (continuity-v1) — superseded by V2. Conclude with note: "V1 pilot superseded by continuity-v2 (253 pairs, 99% Sonnet accuracy, exp #175). V1 not evaluated."
- **Exp #159** (adherence-v3-sonnet) — partial eval done (character 61% regression documented). Conclude with notes.

## Fine-Tuning (Other)

- **Beat writer SFT** (opportunistic, high risk) — 7.8× cost reduction if it works. Shadow-run in parallel with 235B. Validation bar: adherence rate ≥ 235B baseline, lint counts ≤ baseline, 2 full novels without regression. Blocked until structural diversity in the training corpus is addressed.

## Planner Setting Coherence

- **Beat specs assign wrong settings when scenes cross locations** — production data (563 adherence-setting calls, 24 flags = 4.3%) shows the planner assigns a chapter-level setting to all beats even when the narrative naturally transitions mid-chapter (e.g., "Drowned Row Gym" assigned but prose correctly moves to "Statless Hideout"). This is a planner-level bug, not a writer-level bug. The beat writer can't fix it by rewriting.
  - **Investigation**: query `llm_calls` for adherence-setting flags, cross-reference with chapter outlines to identify which planning patterns produce stale settings on mid/late beats.
  - **Fix options**: (1) planner outputs per-beat settings instead of chapter-level; (2) post-plan validation that checks beat descriptions against their assigned settings for location transitions; (3) beat context assembly detects setting shifts from prior beat prose and overrides the stale plan setting.
  - **Chapter plan checker already has `setting_match`** — once beat-level setting checks are removed (done), the chapter plan checker is the only remaining setting gate. Consider whether it should validate setting coherence *across* beats rather than per-beat.

## Pipeline Tuning

- **Word count below target** — 550–770w vs 800–1100w target. Measure pre- vs post-tonal-pass word counts to isolate cause (model, prompt, beat granularity, or tonal pass shortening).
- **Re-evaluate lint system role** — if tonal pass LoRA already reduces AI clichés, lint becomes a safety net rather than a pipeline stage. Test: run lint on tonal-pass outputs vs base outputs.
- **Strip anti-pattern list from rewriter prompt** — rewriter can't self-police clichés (proven). Lint + tonal pass handles this.
- **Skip re-extraction for prose-only rewrites** — if a rewrite fixes only cosmetic issues, extraction results remain valid.

## Structural Diversity

- **Structural diversity pass** — pipeline prose is below published norms: 15.7% dialogue (published: 25–50%), 0.1 interiority verbs/100w, 7.5w avg sentence length (published: 12–18w). Needs paired training data (current output → structurally rich output) that doesn't exist yet. Block beat-writer SFT and new tonal-pass training until addressed.
- **Analysis tracking** — run `scripts/analysis/analyze-structure.ts` after each batch of new novels to track improvement.

## Seeds & Data Diversity

- **Run 10–15 novels across new seeds** — 30 seeds created (2026-04-09): 8 post-apoc, 7 sci-fi, 7 epic fantasy, 4 portal fantasy, plus 6 originals. All 131 approved chapters come from only 5 premises. Chapter-plan-checker and continuity SFT need plan/world-state diversity synthetic generation can't provide.

## Character Voice & Dialogue

### Phase 1 — Context engineering (no training required, build now)
- **Structured `SpeechProfile` schema** — replace the free-text `speechPattern` field in character snapshots with concrete attributes: `register`, `sentenceLength`, `vocabulary[]`, `forbiddenPhrases[]`, `syntacticPatterns[]`, `emotionalExpression`. Render in beat context as a structured block with 2–3 example lines, not attribute lists. Q14B follows examples far better than abstract descriptions.
- **Forbidden phrase lint (character-scoped)** — extend the deterministic lint layer to flag per-character `forbiddenPhrases` in dialogue. Same mechanism as existing cliché patterns, scoped by character name. Zero model cost.
- **Planner dialogue quantity guidance** — add explicit dialogue beat targets to the planning-plotter prompt. At least 2 of 4–6 scene beats should be primarily dialogue-driven. Current output: 15.7% dialogue vs 25–50% published norm. Measure with `scripts/analysis/analyze-structure.ts` before and after.

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

### Chat-based Planning Control (three intervention points)

The chat UI is a reusable shell; the question is *where in the pipeline* it plugs in. Ship #1 first (additive, no schema changes), add #2 once the UX is proven, defer #3 until gates are ready.

#### Option 1 — Pre-planning directives — SHIPPED 2026-04-14
- Two-agent split: `planning-conversationalist` (Groq Qwen3-32B, guided 8-phase Q&A with sparsity detection) + `planning-extractor` (Cerebras Qwen 235B, one-shot compile of transcript → `PlanningDirectives`).
- Directives live on the seed (`SeedInput.directives`), persisted via `seed_json` — no new table.
- Injected into concept phase (world-builder, character-agent, plotter) via `renderDirectivesForConcept()` and into the planner via `renderDirectivesForPlanner()` (includes required beats).
- UI: `DirectorChat.tsx` two-pane (transcript + live directives chips). Endpoints `POST /api/novel/director/chat` (plain text) and `POST /api/novel/director/compile` (structured).
- **Next**: chip-edit (inline quick edit + AI-modify scoped call), validate guided flow produces well-formed directives on 2–3 real runs.

#### Option 2 — Post-planning editing
- **Where it plugs in**: after `runPlanningPhase()` produces chapter outlines, before `presentForApproval()` transitions to drafting. New "Edit Plan" gate in the Studio pipeline view.
- **Model**: chat agent emits a structured diff against the `chapter_outlines` rows — add/remove/edit beat, swap POV, re-order beats, change chapter-level setting. Diffs are applied transactionally; a plain regeneration of affected chapters is the fallback when the diff is ambiguous.
- **Requires**:
  - Diff schema covering beat/outline mutations (new Zod schema in `src/schemas/`)
  - Apply layer in `src/harness/novels.ts` that mutates `chapter_outlines` + keeps `planned_state` consistent (character state / knowledge changes may need recomputation)
  - UI: plan tree on the left, chat on the right, pending-diff preview at the bottom with Apply/Discard
  - Re-runs of the `chapter-plan-checker` after each apply so the user sees whether edits broke cross-beat coherence
- **Risk**: medium. Edits to `chapter_outlines` after approval can desync `planned_state` tables. Needs careful transaction boundaries.

#### Option 3 — Mid-run steering
- **Where it plugs in**: at every existing gate (`src/gates.ts`) and optionally at custom breakpoints (end of chapter, before tonal pass). Steering message is injected into the *next* agent's context.
- **Requires**:
  - Gate extension: `presentForApproval` returns `{ decision, steeringMessage? }` instead of just decision
  - Per-phase context hooks that accept an optional steering blob and render it into the agent prompt
  - SSE event types for "gate:chat-open" / "gate:chat-message" so the UI can slide in a chat panel when the pipeline pauses
  - Transcript persisted per gate event for audit / daemon training data
- **Risk**: high. Every agent site that calls `callAgent` needs to accept/route steering. Steering can contradict already-persisted `planned_state`, so drafting-phase steering may need partial plan invalidation. Defer until #1 and #2 have validated the chat UX.

## Autoresearcher / Daemon

- **Rename daemon → autoresearcher** across codebase.
- **Refocus on structured quality signals** — adherence pass rates, plan check rates, lint counts, extraction precision/recall. Remove all LLM judge and embedding-related optimization targets.

## Local Apple Silicon Inference (Tier 4 Evaluation)

Evaluate running LoRA adapters locally on MacBook Air M4 24GB instead of W&B.

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

- **Extend LLM call inspector tags** — `chapter` / `beat_index` / `attempt` populated for beat-writer and adherence-checker. Need to thread through reference-resolver, continuity, chapter-plan-checker, rewriter, and planner. Columns already exist; each agent's `callAgent` site needs the tags. See `docs/llm-call-inspector.md`.

## Pipeline Stability

- **Deduplicate timeline events** — rewrite re-extractions create duplicate timeline events in DB.
- **Clean up stale DB data** — incomplete novels, orphan benchmark runs, experiments without conclusions.

## Future

- **Worldbuilding Workbench** (separate project) — interactive chat frontend backed by the knowledge graph. Author converses with their world, modifies plotlines, generates beats, adjusts world state. Output is a structured plan that feeds the harness. Same Postgres tables, different interface. Entirely separate from the prose generation pipeline.
