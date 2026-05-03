---
status: amended-post-codex
kind: inventory
revision: 2
date: 2026-04-21
purpose: Full enumeration of every tunable surface in the harness for the autonomous-loop subsystem (docs/designs/autonomous-context-loop.md). Answers "what can the loop actually change?"
codex-review: Consult output captured 2026-04-21 — verdict PROCEED WITH AMENDMENTS. Revision 2 applies all 4 amendments inline. See "Codex amendments applied" block at end.
---

# Harness Optimization Inventory

> **HISTORICAL — superseded.** Catalogues knobs for the autonomous-loop subsystem at `docs/designs/autonomous-context-loop.md`. The autonomous-loop direction was deprioritized 2026-04-21 in favor of context engineering + editing passes (see memory `project_context_engineering_priority`). The Salvatore voice-LoRA route, Howard primer, route-specific leak detection, and other knobs listed below are also retired (see [`current-state.md`](current-state.md) "Retired Or Rejected Methodologies"). The list of tunable surfaces is still useful as a reference, but absence/presence is no longer authoritative — verify each surface against the live code before relying on this document.

Every knob, prompt, model slot, threshold, and pipeline flag that the
autonomous loop could legitimately change. Organized by the four-tier
sub-loop decomposition from `docs/designs/autonomous-context-loop.md`
(Sub-loop 0 concept → 1 planning → 2 writing → 3 checker), plus
cross-cutting surfaces (pipeline flags, model assignments, retry
policy) that don't belong to any single tier.

Column key:

- **Surface**: what the knob is
- **Type**: `prompt` / `model` / `config-int` / `config-float` /
  `config-bool` / `template` / `threshold` / `schema`
- **Storage**: where the value lives — `file:<path>` / `db:<table>` /
  `code:<const>` / `env:<var>` / `roles.ts`
- **Current default**: what production uses today
- **Loop-tunable?**: whether the autonomous loop should be allowed to
  change it in Phase 0+. `N` = should stay frozen; `Y` = open to
  exploration; `later` = deferred to a post-Phase-0 sub-loop.

---

## Sub-loop 0 — Concept / world-building layer

Frozen in Phase 0 (attribution through two downstream layers makes
early-phase measurement noisy). Enumerated so the next phase has a
complete knob list.

### 0.1 `world-builder`

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| System prompt | prompt | `file:src/agents/world-builder/world-bible-system.md` | current | later |
| Model | model | `roles.ts:world-builder` | DeepSeek V4 Flash | later |
| Temperature | config-float | DB `agent_generation_config` | 0.7 (default) | later |
| Max tokens | config-int | `roles.ts` | 8192 | later |
| Output schema richness | schema | `file:src/agents/world-builder/schema.ts` | current | later |
| Culture count floor (prompt rider) | prompt | `file:…/world-bible-system.md` | implicit | later |
| Systems depth (names / brief-rules / full-rules+edges) | prompt-variant | `file:…/world-bible-system.md` | implicit | later |
| Geography granularity (region / region+sites / sites+routes) | prompt-variant | `file:…/world-bible-system.md` | implicit | later |

### 0.2 `character-agent`

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| System prompt | prompt | `file:src/agents/character-agent/character-profile-system.md` | current | later |
| Model | model | `roles.ts:character-agent` | DeepSeek V4 Flash | later |
| Temperature / Max tokens | config | `roles.ts` | 0.7 / 8192 | later |
| `exampleLines` count per character | schema | `file:…/character-profile-system.md:22` | 4 | later (schema-of-record — changes cascade to beat-context preset math) |
| Relationship-graph depth (dyad / triad / full-N) | prompt-variant | file | implicit | later |
| Signature-phrasing extraction (off / passive / enforced) | prompt-variant | file | off | later |

### 0.3 `plotter` (story spine before chapter-level planning)

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| System prompt | prompt | `file:src/agents/plotter/story-structure-system.md` | current | later |
| Model | model | `roles.ts:plotter` | DeepSeek V4 Flash | later |
| Arc-shape prior (free / hero-journey / genre-pack-locked) | prompt-variant | file | free | later |

### 0.4 Pre-planning chat (Studio Director)

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| `planning-conversationalist` prompt | prompt | `file:src/agents/planning-conversationalist/` | current | later |
| `planning-extractor` prompt | prompt | `file:src/agents/planning-extractor/` | current | later |
| Model — conversationalist | model | `roles.ts` | Groq Qwen3-32B | later |
| Model — extractor | model | `roles.ts` | DeepSeek V4 Flash | later |

---

## Sub-loop 1 — Planning layer (Phase 0 target)

### 1.1 `planning-plotter` (chapter skeletons)

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| System prompt | prompt | `file:src/agents/planning-plotter/chapter-outline-system.md` | current | Y |
| Model | model | `roles.ts:planning-plotter` | DeepSeek V4 Flash | Y (narrow set: DeepSeek / Cerebras 235B / Kimi K2) |
| Temperature | config-float | `roles.ts` + DB | 0.6 | Y |
| Max tokens | config-int | `roles.ts` | 8192 | Y |
| Chapter-level richness tier | prompt-variant | file | implicit | Y |
| POV-assignment explicitness | prompt-variant | file | implicit | Y |

### 1.2 `planning-beats` (per-chapter beat-shape expansion)

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| System prompt | prompt | `file:src/agents/planning-beats/beat-expansion-system.md` | current | Y |
| Model | model | `roles.ts:planning-beats` | DeepSeek V4 Flash (non-thinking) | Y |
| Temperature | config-float | `roles.ts` + DB | 0.6 | Y |
| Max tokens | config-int | `roles.ts` | 8192 | Y |
| `SeedInput.directives` → `renderDirectivesForPlanner()` threading | prompt-rider | `src/types.ts` + `src/agents/planning-beats/context.ts:71-73` | passthrough from Studio Director chat | Y |
| Beat-description richness tier (compact / standard / rich) | prompt-variant | file | standard | Y |
| Structural-prior emphasis | prompt-rider | file | soft | Y |
| Beat-kind / value-shift / MICE annotation pressure | prompt-rider | file | soft | Y |
| Beat-count floor multiplier (0.8× / 1.0× / 1.2× of ceil(targetWords/150)) | code | `src/phases/planning.ts` enforcePlanningOutput | 1.0× | Y |
| Universal structural rules rider | prompt-const | `roles.ts:UNIVERSAL_STRUCTURAL_RULES` | current | **later** (demoted per Codex: shared by `planning-plotter` + `planning-beats` via `src/agents/planning-plotter/context.ts:75-76` and `src/agents/planning-beats/context.ts:72-73` — editing it breaks Phase 0 attribution) |
| Beat-kind distribution priors (`SALVATORE_PRIORS`) | code | `roles.ts:240-248` | fantasy preset | **later** (demoted per Codex: shared priors touch planner AND beat-context reads at `roles.ts:298-345`, not isolated to `planning-beats`) |
| Cluster-sustain ranges | code | `roles.ts:SALVATORE_PRIORS` | fantasy preset | **later** (same reason) |
| Opener/closer kinds | code | `roles.ts:SALVATORE_PRIORS` | description/action openers, action/interiority closers | **later** (same reason) |
| Max active chars per beat | code | `roles.ts:SALVATORE_PRIORS` | 3 | **later** (same reason) |
| Beats-per-scene range | code | `roles.ts:SALVATORE_PRIORS` | [2, 15] | **later** (same reason) |
| Beats-per-chapter range | code | `roles.ts:SALVATORE_PRIORS` | [11, 40] | **later** (same reason) |

`planning-beats` no longer owns `establishedFacts`, `knowledgeChanges`, `characterStateChanges`, `requiredPayoffs`, or writer-visible obligations. Exp #289 moved those surfaces to `planning-state-mapper`.

### 1.3 `planning-state-mapper` (state, payoff, and obligation placement)

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| System prompt | prompt | `file:src/agents/planning-state-mapper/state-mapper-system.md` | current | Y |
| Model | model | `roles.ts:planning-state-mapper` | DeepSeek V4 Flash (thinking ON) | Y |
| Temperature | config-float | `roles.ts` + DB | 0.25 | Y |
| Max tokens | config-int | `roles.ts` | 16384 | Y |
| State-density target | prompt-rider | file | implicit | Y |
| Knowledge-transfer explicitness | prompt-rider | file | mapper-authored obligations | Y |
| Payoff-link placement | prompt-rider | file | mapper-authored links | Y |
| Coverage repair policy | agent+code | `src/agents/planning-state-repair/` + `src/phases/planning.ts` | incremental LLM patch, then chapter mapper retry, then hard failure | Y |

### 1.4 Planning-level state schema (what planner MAY output)

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| `establishedFacts[]` shape | schema | `src/agents/planning-beats/schema.ts` | current | N (contract; schema changes break checker replay) |
| `characterStateChanges[]` shape | schema | same | current | N |
| `knowledgeChanges[]` shape | schema | same | current | N |
| `requiredPayoffs[]` shape (fact_id, payoff_beat) | schema | same | current | N |

---

## Sub-loop 2 — Writing layer

### 2.1 `beat-writer` — system prompt & model

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| System prompt — default (DeepSeek route) | prompt | `file:src/agents/writer/beat-writer-system.md` | current | Y |
| System prompt — voice-LoRA route (Salvatore v4) | prompt | `file:src/agents/writer/beat-writer-system-salvatore.md` | training-verbatim | N (training contract) |
| Model — default | model | `roles.ts:beat-writer` | DeepSeek V4 Flash | Y |
| Model — fantasy route | model | `WRITER_GENRE_PACKS` | Salvatore v4 LoRA | N (frozen per 2026-04-21 pivot until replacement ships) |
| Temperature | config-float | `roles.ts` + DB | 0.8 | Y |
| Max tokens | config-int | `roles.ts` | 4000 | Y |
| Style primer on/off | prompt-rider | `roles.ts:WriterGenrePack.usePrimer` + env `STYLE_PRIMER` | none (Howard retired 2026-04-16; Salvatore is the only valid primer going forward) | Y |
| Fallback chapter-level writer prompt | prompt | `file:src/agents/writer/prose-writer-system.md` | current | Y (rarely fires) |

### 2.2 `buildBeatContext` — context-construction knobs

All surface through `BeatContextInput` in `src/agents/writer/beat-context.ts`:

| Knob | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| `compactMode` | config-bool | per-call | true on voice-LoRA, false otherwise | Y |
| `beatEntityListVariant` (`v0` / `v1` / `v3`) | prompt-variant | code | `v1` (exp #254) | Y |
| `readerInfoStateEnabled` | config-bool | not yet threaded | false | Y (needs wiring) |
| `readerInfoStateDepth` (chapter-scoped / novel-scoped) | config-enum | not yet threaded | n/a | Y |
| `worldExpansionBudget` (0 / brief-entity-keyed / full-entities) | config-enum | not yet threaded | 0 | Y |
| `worldExpansionMaxBytes` (0 / 1000 / 3000 / 8000) | config-int | not yet threaded | 0 | Y |
| `transitionBridgeSentences` (0 / 1 / 3 / 5) | config-int | code | 3 | Y |
| `landingTargetEnabled` | config-bool | code | true | Y |
| `priorBeatEstablishedFacts` (thread `getFactsUpToChapter`) | config-bool | not yet threaded | false | Y |
| `speakerDirectivesDepth` (compact / directives / directives+cadence) | config-enum | `voice-shaping-prompts.ts` | compact | Y |
| `payoffLinksVisible` | config-bool | code | true (V1a shipped) | Y |
| `toolsMode` | config-bool | not yet threaded | false | Y |
| `exampleLines` conditioning (fixed / rotation / undefined=raw-slice) | config-enum | `WriterGenrePack.conditioning` + env `WRITER_CONDITIONING` | undefined (raw slice) in production | Y |
| Setting-block inclusion rules (beat 0 only / location-change) | code | `beat-context.ts` | location-change + beat 0 | Y |
| Reference-resolver output threading | code | `reference-resolver.ts` | current | Y |

### 2.3 `reference-resolver`

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| System prompt | prompt | inline in `src/agents/writer/reference-resolver.ts` | current | Y |
| Model | model | `roles.ts:reference-resolver` | Groq Llama 3.1 8B | Y (narrow: Llama / Qwen / Kimi) |
| Temperature | config-float | `roles.ts` | 0.1 | Y |
| Max tokens | config-int | `roles.ts` | 512 | Y |

### 2.4 Voice-shaping prompt assemblers

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| D1 style-guide block | prompt-const | `src/agents/writer/voice-shaping-prompts.ts` | current | Y |
| D2 few-shot passage selection | code | same | 3 passages, stratified | Y |
| D3 character-voice directives block | prompt-const | same | current | Y |

---

## Sub-loop 3 — Checker layer

**Critical rule from design doc:** this sub-loop optimizes only
against frozen labeled ground-truth (`eval_results` sets), NOT against
live generation. It does not open until a Sub-loop 1 or 2 winner
shifts the writer distribution enough to invalidate a checker.

### 3.1 `adherence-events`

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| System prompt | prompt | `file:src/agents/writer/adherence-checker.ts` (inline) | current | later |
| Model (SFT adapter URI) | model | `roles.ts` | `wandb:…adherence-checker-v4` | later (recalibrate only on writer-dist drift) |
| Temperature / Max tokens | config | `roles.ts` | 0.1 / 512 | later |
| Retry trigger rules | code | `src/phases/drafting.ts` | events-fail → targeted rewrite | later |

### 3.2 `halluc-ungrounded`

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| System prompt | prompt | `file:src/agents/halluc-ungrounded/halluc-ungrounded-system.md` | current | later |
| Model | model | `roles.ts` | `wandb:…halluc-ungrounded-v2:v1` | later |
| Grounded-context inclusion (speakers / brief / world_bible subsets) | code | `src/agents/halluc-ungrounded/context.ts` | current | later |
| Schema (fire/no-fire + evidence) | schema | `schema.ts` | current | N |

### 3.3 `halluc-leak-salvatore` (per-writer leak detector)

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| Regex vocabulary | code | `src/agents/halluc-leak-salvatore/regex-leak.ts` | corpus-derived | later |
| Adapter prompt | prompt | `file:…/halluc-leak-salvatore-system.md` | current | later |
| Model | model | `roles.ts` | `wandb:…halluc-leak-salvatore-v1:v1` | later |
| OR-combine rule (regex OR adapter) | code | `src/phases/drafting.ts` | OR | later |

### 3.4 `chapter-plan-checker`

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| System prompt | prompt | `file:src/agents/chapter-plan-checker/plan-adherence-system.md` | current | later |
| Model | model | `roles.ts` | DeepSeek V4 Flash thinking ON base | later |
| Beat-indexed deviation schema | schema | `schema.ts` | `{description, beat_index}` | N |
| Max rewrite passes | config-int | `src/config/pipeline.ts:maxChapterPlanRewritePasses` | 2 | Y (pipeline-level) |

### 3.5 `chapter-plan-reviser`

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| System prompt | prompt | `file:src/agents/chapter-plan-reviser/plan-revision-system.md` | current | later |
| Model | model | `roles.ts` | DeepSeek V4 Flash thinking ON base | later |
| Temperature | config-float | `roles.ts:chapter-plan-reviser` | 0.3 | later |
| Max tokens | config-int | `roles.ts` | 6144 | later |
| Post-revision sanity checks (beat-floor / new-characters) | code | `src/phases/drafting.ts:748-759` (inline guard; reviser module delegates to drafting-loop enforcement) | current | Y |
| Telemetry outcome enum | code | `sql/028` | 7 outcomes | N |

### 3.6 `continuity-v2` (de-emphasized per program direction)

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| Facts prompt | prompt | `file:src/agents/continuity/fact-check-system.md` | current | later (de-emphasized) |
| State prompt | prompt | `file:src/agents/continuity/state-check-system.md` | current | later |
| Model | model | `roles.ts:continuity-facts / continuity-state` | `wandb:…continuity-v2:v1` | later |

### 3.7 Quality detectors (local, deterministic)

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| Repetition-loop detector thresholds | code | `src/lint/quality-detectors.ts` | current | Y |
| Per-novel `qualityRedraftEnabled` | config-bool | `SeedInput.pipelineOverrides.qualityRedraftEnabled` (`src/types.ts:24-27` → `src/phases/drafting.ts:53-60`) | false | Y (canonical per-novel-override pattern) |
| Per-novel `qualityRedraftMinWords` | config-int | `SeedInput.pipelineOverrides.qualityRedraftMinWords` (same path as above) | 100 | Y |
| Global `qualityRedraftEnabled` fallback | config-bool | `src/config/pipeline.ts` | false | Y (rarely touched; prefer per-novel override) |
| Global `qualityRedraftMinWords` fallback | config-int | `src/config/pipeline.ts` | 100 | Y |

---

## Cross-cutting surfaces

### C.1 Pipeline-level control flags (`src/config/pipeline.ts`)

| Knob | Type | Current default | Loop-tunable? |
|---|---|---|---|
| `maxDraftAttempts` | config-int | 3 | Y |
| `maxPhaseRestarts` | config-int | 2 | Y |
| `beatLevelWriting` | config-bool | true | N (architectural) |
| `maxBeatRetries` | config-int | 2 | Y |
| `chapterPlanCheck` | config-bool | true | N (gate contract) |
| `maxChapterPlanRewritePasses` | config-int | 2 | Y |
| `maxValidationPasses` | config-int | 3 | Y |
| `maxChapterRewrites` | config-int | 3 | N (diagnostic-only since 2026-04-17) |
| `tonalPass` | config-bool | false | N (retired 2026-04-16) |
| `qualityRedraftEnabled` | config-bool | false | Y (per-novel override) |
| `qualityRedraftMinWords` | config-int | 100 | Y |
| `embeddings` | config-bool | false | N (beat path is deterministic) |
| `defaultTargetWords` | config-int | 1000 | Y |
| `minWords` | config-int | 500 | Y |

### C.2 Retry & rewrite policy

| Surface | Type | Storage | Current default | Loop-tunable? |
|---|---|---|---|---|
| Retry-prompt construction (`buildRetryPrompt`) | prompt-assembler | `src/agents/writer/retry-context.ts` | current | Y |
| Targeted-rewrite input threading (prose + issues) | code | `src/phases/drafting.ts` | current | Y |
| Redraft-from-scratch path (quality-defect detected) | code | `drafting.ts` | off by default | Y |
| Reviser → targeted beat rewrite vs full chapter restart threshold | code | `drafting.ts` | settle-loop budget | Y |

### C.3 Model-role assignments (global)

Entire `AGENT_MODELS` map in `src/models/roles.ts` is a knob surface.
Loop-tunable for the narrower roles (reference-resolver, planner,
chapter-plan-checker); NOT tunable for adapter-URI fields (adherence,
halluc-*, continuity) where the model IS the adapter and swapping
requires a training run.

### C.4 Retrieval / deterministic config (legacy surfaces)

The 9 retrieval params + 6 deterministic causal weights in
`src/harness/registry.ts` remain DB-backed and UI-adjustable, but
with `pipeline.embeddings=false` and the beat path using deterministic
lookups, these are effectively inactive. **Not loop-tunable in Phase 0+
until embeddings are re-enabled** (no plan to do so per current direction).

### C.5 Context / embedding templates (legacy)

12 templates in `context_templates` and `embedding_templates` tables
per `src/harness/registry.ts`. Same status as C.4 — inactive while
embeddings are off.

### C.6 Structural priors (per genre pack)

`WRITER_GENRE_PACKS` in `roles.ts` bundle `StructuralPriors` objects
derived from corpus analysis. Sub-loop 1 can propose new values
(covered in §1.2) but the pack-selection logic itself is frozen
(genre-regex match order, structural-priors schema).

### C.7 Per-novel `seed.pipelineOverrides`

Per-novel escape hatch for pipeline flags. Loop-tunable — the loop
should prefer setting `seed.pipelineOverrides.*` over editing
`src/config/pipeline.ts` so that A/B measurement isolates the
intervention to one novel/eval cell.

### C.8 Environment-variable overrides

Per Codex amendment: the first four should migrate to DB-backed
per-novel config (same pattern as `seed.pipelineOverrides.qualityRedraft*`)
because they currently leak process-wide via module-load env reads
(`src/agents/writer/index.ts:19-36`, `src/models/roles.ts:280-292`).
The autonomous loop cannot safely toggle them per-iteration while they
stay env-backed.

| Var | Controls | Loop-tunable? |
|---|---|---|
| `STYLE_PRIMER` | primer type (none / salvatore — **never howard**; Howard methodology retired 2026-04-16) | **migrate-to-DB** → then Y |
| `WRITER_MODEL_OVERRIDE` | per-pack writer model | **migrate-to-DB** → then Y |
| `WRITER_PROVIDER_OVERRIDE` | per-pack writer provider | **migrate-to-DB** → then Y |
| `WRITER_CONDITIONING` | exampleLines preset mode | **migrate-to-DB** → then Y |
| `BENCHMARK_SEEDS` | eval-run seed filter | Y (eval-time only; stays env — runner scope) |
| `BENCHMARK_RUNS` | runs per seed | Y (runner scope) |
| `EXPERIMENT_ID` | attach run to an experiment | Y (telemetry; not a lever) |
| `LLM_TRANSPORT` | direct / batch | **N** (operational, not a prose-quality knob; consistent with the "Outside the knob surface" section) |

---

## Outside the knob surface (explicitly frozen)

For completeness — things someone might think of as a lever but which
are intentionally NOT tunable by the autonomous loop:

- **Database schema** (`sql/*.sql`): migrations only. Schema changes
  cascade across eval-results comparability.
- **Transport layer** (`src/transport.ts`): pluggability exists but
  choosing transport is an operational decision, not a quality lever.
- **Gate abstraction** (`src/gates.ts`, `src/events.ts`): approval
  mode is a user choice, not a prose-quality knob.
- **LoRA adapter URIs in adapter-based checker slots**: changing the
  URI means swapping the trained model. Considered "later"-tier and
  only after the writer-distribution makes a recalibration necessary.
- **Fine-tune hyperparameters** (`scripts/finetune/train-lora.py`,
  W&B SFT configs): not in scope for the prose-quality loop; lives
  in a separate training-side experiment track.
- **Corpus pipeline** (`scripts/corpus/run.ts`, bundles under
  `novels/<key>/`): changes the training data distribution —
  out-of-scope for the prose-quality loop.
- **Lint detector regex catalog** (`src/lint/detectors/*`): sourced
  from craft references per memory `feedback_lint_sourcing`. Not
  adjustable by the loop; adjustments require research + citation.

---

## Summary by tier

| Tier | Tunable surfaces (approx) | Phase 0 opens? |
|---|---|---|
| Sub-loop 0 (concept) | ~15 | Deferred |
| Sub-loop 1 (planning) | ~22 | **Yes — primary** |
| Sub-loop 2 (writing) | ~20 | Yes — secondary (after Sub-loop 1 converges) |
| Sub-loop 3 (checker) | ~18 | Deferred (opens on distribution drift) |
| Cross-cutting (pipeline / retry / env) | ~15 | Y where marked above |

Phase 0 active surface (per design doc): **`planning-beats` subset of
Sub-loop 1 only** — approximately 8 knobs (system prompt, temp,
max_tokens, richness tier, establishedFacts target, knowledgeChanges
explicitness, payoff-link depth, beat-count floor multiplier). All
others frozen.

## Codex amendments applied (2026-04-21)

Consult verdict: **PROCEED WITH AMENDMENTS**. Four amendments applied
inline in this revision:

1. **Missing surfaces added.**
   - `SeedInput.directives` + `renderDirectivesForPlanner()` threading
     on `planning-beats` (§1.2) and implicitly on `planning-plotter`
     (§1.1 via `context.ts:73-76`).
   - `qualityRedraftEnabled` + `qualityRedraftMinWords` per-novel rows
     made explicit under §3.7 (was previously folded into the generic
     C.7 bucket).
   - `chapter-plan-reviser` temperature + max_tokens rows added (§3.5).
   - `chapter-plan-reviser` beat-floor guard location corrected to
     `src/phases/drafting.ts:748-759` (§3.5).

2. **Three surfaces demoted Y → later** because they sit on shared
   dependencies and would destroy Phase 0 attribution:
   - `UNIVERSAL_STRUCTURAL_RULES` (shared by both planner stages —
     moved to `later` in §1.2).
   - All six `SALVATORE_PRIORS` rows (beat-kind dist, cluster-sustain,
     opener/closer kinds, max-active-chars, beats-per-scene,
     beats-per-chapter — shared with beat-context reads in
     `roles.ts:298-345`; moved to `later` in §1.2).
   - `LLM_TRANSPORT` demoted `Y → N` in §C.8 for consistency with
     the "Outside the knob surface" freeze.

3. **Schema evolution is a separate versioned-migration sub-loop,
   not a tuning lever** (per Q4 of Codex review). Planner schema
   (§1.3) stays frozen for Phase 0. When a schema change is
   warranted, the required migration shape is: versioned schema →
   dual-write old + new → adapter-backed checker replay on frozen
   labeled sets → backfill → cutover. Document but do not implement
   pre-Phase-0.

4. **Checker-drift detector** (per Q5): defer KL-style writer-
   distribution metrics — no stable input feature distribution is
   defined today. Use a **calibration-substrate detector** instead:
   replay any upstream Phase 0 candidate winner through the frozen
   labeled `eval_results` checker sets; **open Sub-loop 3 when any
   checker's precision drops >5pt OR F1 drops >3pt** on that frozen
   set. This anchors on the design doc's named downstream-replay
   mechanism (`autonomous-context-loop.md:202-209, 223-230`), not on
   a hypothetical live-drift signal.

5. **Cheapest untried counterfactual** (Codex Q7, load-bearing for
   Phase 0 GO/NO-GO): before spending budget on the full autonomous
   loop, run a 5-chapter planner-only A/B —
   - **Arm A (control):** current `planning-beats` default.
   - **Arm B (loud variant):** richer beat descriptions,
     `establishedFacts` target 3-5, `knowledgeChanges` named+reason,
     1.2× beat-count floor.
   - **Score:** planner-native outputs (beat-count-floor,
     `establishedFacts` coverage, `knowledgeChanges` coverage,
     payoff-link realization) + `chapter-plan-checker` pass rate.
   - **Purpose:** verify the knob surface is declaratively
     expressible and measurably responsive before the loop spends
     real budget. If the loud variant doesn't move planner-native
     metrics beyond noise, the loop's knob space is broken before
     Phase 0 starts.

## Remaining Phase 0 gating work (from amendments)

- [ ] Migrate `STYLE_PRIMER`, `WRITER_MODEL_OVERRIDE`,
      `WRITER_PROVIDER_OVERRIDE`, `WRITER_CONDITIONING` from env vars
      to `seed.pipelineOverrides.*` so the loop can toggle per-novel.
- [ ] Implement the calibration-substrate drift detector on a replay
      harness (frozen `eval_results` sets + checker-precision/F1
      deltas).
- [ ] Run the 5-chapter planner-only A/B cheapest-counterfactual.
      GO/NO-GO gate for the autonomous loop's Phase 0.
- [ ] Build the held-out 10-beat replay set on a second novel
      (named in design doc but not yet constructed).
