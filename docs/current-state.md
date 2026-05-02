---
status: active
updated: 2026-05-02
role: canonical-current-truth
---

<!-- Latest 2026-05-02: L38-G shipped writer-side same-chapter physical-state continuity rule (a27a8a1, exp #372). Paired replay on novel-1777721066908 ch2 cleared the L38-F-residual hand-washing/smudges contradiction: 15/15 beats wrote attempt 1, plan check passed, no new chapter_exhaustions row, prior-state cluster did not return. Stop gate (a) clean pass. -->


# Current State

This is the canonical current-state document for the novel harness.

If another document disagrees with this one about the live architecture, active pipeline, or retired components, this file wins.

## How To Use This Doc

Read this file first when you need to understand the system as it exists today.

Use the rest of the doc set like this:

- `README.md`: onboarding and quick-start
- `docs/context-engineering.md`: detailed current context/planner strategy
- `docs/interactive-claude-captain-loop.md`: engineering orchestration boundary; Claude Code/OpenCode are the primary coding harnesses
- `docs/experiment-design-rules.md`: experiment methodology and evaluation rules
- `docs/harness-next-work-process.md`: how to choose the next harness lane after a queue stops
- `docs/decisions.md`: historical decision log and rationale
- `docs/lessons-learned.md`: accumulated empirical findings
- `docs/todo.md`: backlog, not source of truth

## Operating Model

The harness is explicitly **context-engineering-forward**.

The split is:

- Planner and beat context decide what to write.
- Writer model weights decide how to write it.
- Checkers stay narrow and only police failures that plans cannot prevent reliably.

This means:

- craft is treated as a model problem, not a prompt-rules problem
- planner expressiveness and context assembly are primary quality levers
- post-hoc craft checkers are not the main path to improving prose quality

Reference:

- `docs/decisions.md` — "Context-engineering-forward architecture"

### Tracked work taxonomy

Tracked work taxonomy: all work items (tickets, training runs, evals, infra) are recorded as `tuning_experiments`.
The canonical types are defined in `src/db/ops.ts` as `TrackedWorkType`; use `'ticket'` as the default for standard engineering commits.

### Engineering orchestration boundary

Claude Code and OpenCode are the primary engineering harnesses for coding work, agent orchestration, code review, and queue handoff. Novel Harness should not rebuild that engineering control plane inside the repo.

`scripts/agent/lane-runner.ts` is **officially retired as the default engineering orchestrator**. It remains only as a legacy/optional helper for headless one-shot experiments or historical replay. Do not add new runner orchestration features unless they are reusable sensors/tools for the interactive engineering harnesses.

What belongs in Novel Harness:

- runtime LLM/API calls for novel planning, writing, checking, revision, and evaluation
- application observability for novel runs: telemetry, operator summaries, stop classifiers, dashboards, DB evidence, and product acceptance gates
- deterministic sensors and contract artifacts that Claude Code/OpenCode can use

What does not belong in Novel Harness:

- a custom autonomous coding supervisor that replaces Claude Code or OpenCode
- bespoke queue/terminal/liveness orchestration for engineering agents
- another layer that tries to coordinate coding subagents instead of using established engineering harnesses

### Loop architecture

Robustness work uses a **one-primary-lane** loop by default. A lane is the runtime behavior hypothesis being validated, not a file boundary. The lane must name its baseline, changed runtime lever, feedback signal, stop gate, and escalation rule before live validation starts.

Parallel work is allowed when it supports attribution or operability without changing the runtime behavior under test. Good support work: tests, replay harnesses, docs-impact audits, operator summaries, stop classifiers, result docs. Keep support commits and runtime behavior commits separate when practical.

DeepSeek V4 Flash concurrency should be used to increase statistical power inside the active lane when cheap additional evidence is available. Acceptable shapes include repeated same-family phase-eval runs, fixed-panel checker reruns, paired replay over saved `llm_calls`, and multi-seed confirmation after a single-seed-deep signal. The loop context must declare sample shape, probe-family key, budget cap, and promotion gate before calls start. Do not spend concurrency budget on multiple unrelated runtime lanes in parallel.

As of 2026-05-02, the default loop control plane is an **interactive engineering captain** in Claude Code or OpenCode. `bun scripts/agent/open-claude-captain.ts` is the repo helper for launching a Claude Code captain with the current lane context. The captain reads the lane doc and `monitor`, records heartbeats/messages, uses native subagents for bounded support work, and manually finalizes/advances queue entries. See `docs/interactive-claude-captain-loop.md`.

Legacy runner note: any remaining references to `lane-runner.ts` describe optional/headless support behavior or historical lanes. They are not the default engineering path. If a sentence below appears to route normal engineering work through `lane-runner.ts`, treat it as superseded by the engineering orchestration boundary above.

Lane monitoring is repo-local and tool-neutral. `scripts/agent/lane-heartbeat.ts` appends outside-loop events to `output/agent-runs/<lane-id>/events.jsonl`; `scripts/agent/lane-message.ts` appends addressed operational requests, claims, handoffs, and results to `output/agent-runs/<lane-id>/messages.jsonl`; `scripts/agent/lane-status.ts` computes `continue|stop|blocked|human-needed|infra-failure`; `monitor` / `scripts/agent/lane-dashboard.ts --watch` render the outside loop, operational coordination, inside-harness summary, evidence rows, repo hygiene, and process health through `--panel all|outside|coordination|inside|evidence|hygiene|process`. The coordination panel shows active worker identity when present, latest heartbeat actor, claimed work by actor, messages, and expired leases. `scripts/agent/preflight-loop.ts` is the explicit contract gate: it validates lane-contract completeness, starting-commit resolution via `git rev-parse`, experiment-id shape, declared file/script scope, and worktree state. Documentation closeout can be handed to `.opencode/agent/docs-finalizer.md` through `scripts/agent/finalize-docs.ts`, which first writes a deterministic `finalizer-packet` under `output/agent-runs/<lane-id>/`, then invokes OpenCode on `deepseek/deepseek-v4-flash` with a high reasoning variant and authorizes a docs-only commit after docs-impact and whitespace checks pass. Inside-harness novel data delegates to `scripts/operator-summary.ts`. Abandoned pending plan-assist gates should be marked `decision='orphaned'` with `scripts/agent/resolve-stale-gates.ts` after dry-run review, never deleted. See `docs/agent-lane-protocol.md`.

Bare `monitor` is the compact default alias for human loop visibility: route default monitoring instructions through that alias, and use expanded `bun run monitor`, `bun scripts/agent/monitor.ts`, or `lane-dashboard` commands only when debugging the alias or working where the alias is unavailable. It shows `outside`, `coordination`, and `process` panels and hides latest-novel wall text. The outside view includes `Lane progress`, sourced from the lane doc's latest `Progress Log` bullets and populated `Results` fields. Use `monitor --full` for all panels plus the latest novel summary, or `monitor --append` only when repeated snapshots are intentional. Captured/non-TTY watch mode renders one snapshot instead of flooding output.

Queue handoff requires review evidence by default. `Results: Review` must cite independent commit-pinned review evidence such as `impl-review <sha> PASS`, or an explicit waiver reason and reviewer, before a captain or legacy runner advances through `docs/sessions/lane-queue.md`; `--no-review-gate` is reserved for historical legacy-runner replay.

Replay-first verification has an MVP entry point: `bun scripts/agent/replay-first-plan.ts <panel.jsonl>` reads tracked JSONL panels (currently the L12 expanded halluc fail classes and L18 partial-enactment adherence panels), classifies each row as `halluc-ungrounded-fixture`, `adherence-events-fixture`, or unsupported, and prints row count, oracle-label distribution, source provenance, estimated call count, and the exact `run-expanded-class-panel.ts` / `run-partial-enactment-panel.ts` follow-up command for replay. The helper never makes model calls and exits non-zero on unsupported schemas. Use it as the cheap pre-smoke filter for halluc-ungrounded and adherence-events candidates; DB-backed `llm_calls` replay is queued separately.

Do not mix unrelated runtime levers in one validation smoke. Prompt edits, routing changes, schema changes, checker threshold changes, planner/context changes, and retry-policy changes can be bundled only when the declared lane requires the bundle. Otherwise, validate them as separate lanes so a pass, regression, or new blocker has a readable cause.

Default stop gates:

- **Clean pass:** acceptance criteria met; promote, document, commit, conclude the experiment.
- **New dominant blocker:** target cluster is gone and a new out-of-scope cluster has clear evidence; stop and queue the next lane.
- **Regression:** a previously closed cluster returns; stop and diagnose or revert before new work.
- **Infrastructure failure:** DB, deploy, provider, test harness, logging, or missing evidence prevents interpretation; stop and fix the harness first.
- **Budget cap:** cost cap reached; persist partial findings and remaining budget before stopping.

## Active Pipeline

### Planning and generation

- Concept and planning remain on smart frontier-style models, not an all-14B stack.
- **All DeepSeek-using slots route to V4 Flash** (V3.2 → V4 Flash swap landed 2026-04-29, commit `eb2993d`). Single API model; thinking mode is a per-agent toggle. **Thinking ON only on three slots**: `planning-state-mapper` (state/obligation placement across existing beats), `chapter-plan-checker` (cross-beat coherence judgment), `chapter-plan-reviser` (minimal-edit plan diff). Decision rule + rationale in the comment block above `deepseekV4Flash` in `src/models/roles.ts`. V4 Pro exists in the registry as a reasoning-tier escalation but is NOT routed by default (~12× output cost vs Flash at base rate; reserved for cases where Flash thinking proves insufficient).
- Writer routing is no longer genre-swapped. All genres use the base `beat-writer` assignment: DeepSeek V4 Flash non-thinking with the base beat-writer prompt and rich/default beat context.
- **Writer prompt guardrails now cover both beat-level and chapter-level paths (2026-05-02 follow-up to L42/L43).** Beat-writer prompts instruct the writer to use proper names only from the beat brief, `CHARACTERS` list, or `Allowed-new-entities`, and to render incidental walk-ons by role/descriptor rather than inventing proper names. Beat and chapter-level writer prompts also state that beat-specified verbal actions (claims, asks, refuses, agrees, demands) must be enacted on-page as direct dialogue, while still allowing natural/subtextual wording. This keeps the chapter-level fallback path from bypassing the L42/L43 runtime discipline.
- Fantasy seeds still receive Salvatore-derived **structural priors** in planning, but those priors no longer imply a writer LoRA, compact context, route-specific system prompt, or corpus-leak checker.
- Writer-layer LoRA routing is retired from runtime. Historical Salvatore/tonal adapters remain only as archived experiment artifacts, not active workflow dependencies.
- **Phase-2 planner output carries structured payoff links (V1a, 2026-04-18).** Each `establishedFact` gets a stable kebab-case `id`; per-beat `requiredPayoffs: [{fact_id, payoff_beat}]` links setups to the later beat that realizes them. The writer sees resolved "SEEDS (this beat must set up…)" and "PAYOFFS DUE (this beat must realize…)" sections in beat context. The chapter-plan-checker receives the same structured links. **Pilot not yet run.** The original `docs/charters/planner-phase2-contract.md` received a RED adversary verdict on 2026-04-18 and was superseded by `docs/charters/planner-phase2-payoff-floor.md` (status: `proposed`, adversary-verdict: `pending`). The payoff-floor charter asks the cheaper causal question from `pre-planner-phase2-v1a`: does an aggressive prompt-only floor recover most of the V1a lift? Pilot gate: 3-arm paired ablation, novels named `pp2-floor__<arm>__<seed>__<timestamp>`. V1b (`speaker_directives`) and V1c (`subplot_id` + `thematic_focus`) remain gated on the pilot result.
- **Planner-authored beat obligations are writer-visible and coverage-validated (exp #286-#294).** `sceneBeatSchema.obligations` carries compact per-beat `mustEstablish`, `mustPayOff`, `mustTransferKnowledge`, `mustShowStateChange`, `mustNotReveal`, and `allowedNewEntities` lists. `planning-beats` now emits beat shape only; `planning-state-mapper` maps chapter-level facts/knowledge/state plus payoff links and beat obligations onto the existing beat list. **L26/L32 (2026-05-02, exp #348/#353):** a 3-seed probe (148 beats) found `allowedNewEntities` is used on 4.1% of beats (qualitatively correct) but had 2 dup FPs where established characters (one in `beat.characters`, one in `charactersPresent`) were re-emitted as new entities. L32 fixed the mapper prompt with a positive-framed exclusion rule in Placement Guidance: characters already in `beat.characters` or `chapter.charactersPresent` are established and should be omitted from `allowedNewEntities`. Re-probe (L32, exp #353) verified BeatDupFPs=0, ChDupFPs=0. `beat-context-render.ts` renders obligations as `BEAT OBLIGATIONS` in the beat-writer prompt. `src/harness/beat-obligations.ts` derives writer-visible coverage. Coverage failures first go to `planning-state-repair`, which returns minimal stable-ID patch operations that code applies mechanically and revalidates; if the patch does not pass, planning falls back to a chapter-scoped mapper retry against the same fixed beat list. If the retry budget cannot produce a valid exact-ID contract, planning fails before prose. The mapper maxTokens is 16384 after exp #292 showed 8192 could pass outline gates while still causing JSON/Zod/cap health failures. Retry prompts anchor existing state so the mapper fixes coverage by adding/moving obligations rather than deleting valid facts/state. **Coverage validation is exact-ID only (2026-05-01).** Every chapter, beat, character, fact, knowledge change, state change, and obligation receives a stable kebab-case ID via `enrichOutlineIds()` in `src/harness/ids.ts` (idempotent; runs after every mapper merge). The validator builds source registries keyed by ID; a coverage gate passes only when each source ID is referenced by at least one obligation's explicit `sourceId` with matching `sourceKind` and `characterId`. Fuzzy beat-text overlap, character-name aliasing, and substring text matching are not part of the stable-ID harness path.

**2026-05-01 trace-audit update:** the stable-ID harness path no longer keeps fuzzy/text-overlap diagnostics or code-authored obligation repair. `enrichOutlineIds()` assigns artifact IDs and obligation IDs only; obligation `sourceId`/`sourceKind` must be explicit. G1 now requires `missing_source_ids = unknown_source_ids = duplicate_source_ids = source_kind_mismatches = character_id_mismatches = 0`. Recovery is LLM-authored and validator-backed: `planning-state-repair` first returns minimal stable-ID patch operations, deterministic code applies only mechanically valid operations, and exact-ID validation reruns. If the patch does not pass, the existing chapter-scoped `planning-state-mapper` retry/rebuild runs; if the retry budget cannot produce a valid exact-ID contract, planning fails before prose. `src/harness/stable-id-trace.test.ts` guards this invariant.

Primary code references:

- `src/models/roles.ts`
- `src/agents/writer/`
- `src/agents/writer/beat-context.ts` — SEEDS / PAYOFFS DUE rendering
- `src/agents/planning-beats/` — Phase-2a beat-shape expansion
- `src/agents/planning-state-mapper/` — Phase-2b state, payoff-link, and beat-obligation mapping
- `src/harness/beat-obligations.ts` — writer-visible coverage validation and deterministic fallback repair
- `src/schemas/shared.ts` — `sceneBeatSchema.requiredPayoffs` + `payoffLinkSchema`
- `docs/context-engineering.md`
- `docs/charters/planner-phase2-contract.md`

### Active quality controls

The active narrow checkers are:

- **2026-05-02 docs-impact reconciliation note:** the latest hardening follow-up tightens the L31/L39/L40/L41 stack without changing the checker set. Stage-2 adherence override now requires a non-empty `obligated_events` list; an empty stage-2 enumeration falls back to the stage-1 failure. Adherence checker input and beat retry prompts both expose up to 8000 chars of prior prose. `halluc-ungrounded` awaits `ner_prepass_json` persistence before returning, while remaining fail-open if the DB patch fails. L41 integrity retry context applies to main beat writes and to chapter-plan / validation targeted settle-loop rewrites.
- **adherence** — `adherence-events` runs inside the beat drafting retry loop on DeepSeek V4 Flash non-thinking. It combines deterministic character-presence checks with a bounded two-stage LLM design (exp #317, 2026-05-01): stage 1 is the existing binary `events_present` call and always runs; stage 2 (`MISSING_EVENTS_SYSTEM` schema → `obligated_events[].enacted`) only fires when stage 1 returns `events_present=false`, and renders one issue per missing event with quote evidence. Pass-path latency / cost is unchanged. **L31c override (exp #346, 2026-05-02):** when stage 2 reports ALL `obligated_events` as `enacted: true`, it overrides the stage-1 fail verdict and accepts the beat. Override fires only on unanimous enactment; any `enacted: false` leaves the stage-1 fail in place. Override is traced as `adherence-stage2-override` in `pipeline_events` for audit.
- **entity grounding** — `halluc-ungrounded` runs on every beat on DeepSeek V4 Flash non-thinking. It now combines a deterministic NER prepass with the LLM call under an AND-gate (L4-followup-3, exp #322, 2026-05-01): the NER prepass (`src/lint/entity-candidates.ts`) runs first and filters title-pair, capitalized-multi-word, suffix-class, x-of-y-capitalized (L15), number-word-tail (L15), initials (L23a), and capitalized-first-only (L23a) candidates against the same grounded surface using five-tier normalized matching (exact lowercase → substring → normalized exact → normalized substring → L49 title-strip fallback for title+surname forms when the candidate begins with a `TITLE_TOKENS` lexicon entry, e.g. "Master Orin" grounded by "Orin"); ungrounded NER candidates are compared against the LLM result: NER∩LLM=blocker, NER-only=warning, LLM-only=blocker. The prepass is active for variants v1/v3/v4 (the production default is v1). The grounded surface enumerates speakers, brief fields, world-bible names, From-brief proper nouns, optional Beat-entities (V1+ derivation), `Allowed-new-entities` — planner-sanctioned new named entities sourced from `beat.obligations.allowedNewEntities`; **Character-roster** — all novel characters from character-agent outputs (full `characters[]` param, not just beat-scoped subset, so title+surname forms like "Lord Sorcerer Brennan" and surname-alone "Brennan" are grounded via the per-token shard tier and the L49 title-strip fallback); **Outline-entities** — named entities extracted by `buildOutlineEntityList()` from the chapter outline's `setting`, beat `description` fields, and `establishedFacts` text, covering planner-emitted location names (Silver Street, Eastern Reach, Temple of Mercy) not otherwise in the world-bible `locations` array; and **Derived-titles** — title noun forms derived from character role fields (e.g., "Guild Master" → "Guildmaster", "guildmaster") via `deriveTitleNouns()` (L23b, exp #341). L20 (exp #339, 2026-05-01) closed the L17 FP cluster; L23a+L23b (exp #342+#341, 2026-05-02) closed the L22 cluster. Both confirmed suppressed in production by L24 smoke (exp #344, 2026-05-02). The `groundedSources` provenance snapshot persisted to `llm_calls.request_json` carries the same buckets (`bible`, `from_brief`, `derived_outline_fact`, `derived_prior_beat`, `allowed_new_entities`, `planner_emitted`, `character_roster`, `outline_entities`, `derived_titles`). **L31ab AND-gate redesign (2026-05-02, exp #355):** NER-only-warning branch returns `pass: true` — beat retry budget is not consumed when the LLM approves the entity. Warning issues appear in `issues[]` with `severity: "warning"` and in `nerOnlyFindings` for operator visibility; `retryLines` includes them for writer awareness. `ner+llm-blocker` now requires entity-phrase intersection (`nerUngrounded ∩ llmFlagged ≠ ∅`); when NER and LLM flag different entities (disjoint case), the result carries separate NER-only-warning (warning) + LLM-only-blocker (blocker) issues with correct per-issue `issuesSeverity[]`. `aggregateIssues` in `beat-checks.ts` reads `ungroundedSeverity[]` to honor severity per issue. **L31d production validation (exp #358, 2026-05-02):** L31a + L31b + L31c + L32 confirmed working end-to-end on `fantasy-debt` re-smoke — 9 NER-only-warning fires all returned `pass: true` (no retry exhaust), 3 `adherence-stage2-override` events correctly accepted beats, 0 mapper dup-FPs, 0 L17/L22 cluster regressions. The Salvatore/Forgotten-Realms corpus-leak checker is retired because it was coupled to the removed writer-LoRA route.
- **functional story-state checks** — `src/harness/enforce.ts` sanitizes invalid optional payoff scaffolding during planning so empty/missing/non-forward payoff links do not survive into drafting. `src/phases/functional-checks.ts` still blocks deterministic payoff graph failures that remain after enforcement, such as duplicate fact IDs or invalid links on manually edited outlines. `functional-state-checker` then uses bounded DeepSeek V4 Flash non-thinking to judge whether planned facts/knowledge/state are semantically grounded in the chapter prose; those semantic findings are warning-class until oracle calibration.
- **checker blocker policy** — unresolved beat-check blocker issues accepted after retry exhaustion, continuity `blocker` issues, and deterministic functional blockers halt chapter approval through the existing plan-assist exhaustion gate instead of being appended to the approved draft. Continuity location findings based only on previous-chapter state are warning-class because characters can move plausibly between chapters; knowledge impossibilities can still block. Word-count overshoot remains warning-class.
- **lint/prose integrity guard** — after deterministic/LLM lint fixes run, `src/lint/integrity.ts` rejects malformed post-fix prose before `saveChapterDraft()` overwrites the raw draft. Before human/auto approval, the same deterministic guard blocks malformed final prose with fused boundaries, dropped-space camel fusions, adjacent duplicate sentences, nearby duplicate fragments, and quote-integrity failures. Failures emit `lint-fix-rejected` or `prose-integrity-check` trace events and retry the chapter instead of approving corrupted prose. **L41 (2026-05-02, exp #368, commit `78dc138`):** when integrity fails on attempt N, the failed-attempt issue list is captured into a chapter-scoped `priorIntegrityIssues` and appended to every beat-writer userPrompt in attempt N+1 via `formatChapterIntegrityRetryContext` in `src/agents/writer/retry-context.ts`. Cleared on integrity pass. Retroactive analysis showed pre-L41 retries could *regress* (1→8 issues observed), not just slow-converge — L41 addresses both regression prevention and convergence acceleration. No-op on chapters that pass integrity on attempt 1.
- **LLM completion cap hits are error-class.** `src/transport.ts` and the shared `callAgent` / `executeAndLog` wrappers reject any provider `finish_reason="length"` or `completion_tokens >= maxTokens` as `hit max token cap`, preserving response telemetry in `llm_calls`. Structured JSON, prose, checker, lint, and direct transport callers should not silently accept truncated outputs.
- **chapter-plan-checker** — runs per chapter, currently **DeepSeek V4 Flash base, thinking mode ON** (V3.2 → V4 Flash swap landed 2026-04-29; was V3.2 base swapped from the retired W&B `chapter-plan-checker-v2` SFT adapter on 2026-04-18 after a dual-oracle audit found ~92% false-positive rate on real fantasy plans). Emits beat-indexed `deviations` that route to **beat-targeted rewrites** inside the chapter attempt, not full-chapter restart. On targeted-rewrite budget exhaustion (`pipeline.maxChapterPlanRewritePasses=2`), escalates **once per chapter** to the `chapter-plan-reviser` agent (**DeepSeek V4 Flash thinking ON** @ temp 0.3, 6144 maxTokens) which produces the smallest plan-edit that would make the issues satisfiable. Revised outlines are persisted to `chapter_outlines` so a state-machine re-dispatch picks up the revision. Sanity-checked for beat-floor and character-drift before acceptance.
- **validation** — deterministic checks for word count and POV presence. Blockers route to **beat-targeted rewrites** (shortest-beat expand for word count, smallest-cast-beat-that-plans-POV for pov-missing) via the same targeted-rewrite loop as plan-check. Falls back to blind chapter restart only after targeted-rewrite budget exhaustion.

Continuity remains part of the system, but the architectural direction is that checkers stay narrow and load-bearing rather than expanding into a large craft-checker zoo.

### Retry / escalation flow (2026-04-19)

For every chapter attempt, failure paths are ordered from most-targeted to least-targeted:

1. **Per-beat adherence / entity grounding** — `runBeatChecks()` in `src/phases/beat-checks.ts` aggregates checker output into `BeatIssue[]`; any blocker triggers a targeted beat rewrite with the specific issue descriptions. Budget: `pipeline.maxBeatRetries=2` per beat.
2. **Accepted beat-check blocker after retry exhaustion** — the beat may still be kept so the chapter can finish assembling, but the unresolved blocker is retained as a chapter-level approval blocker and routes to the plan-assist exhaustion gate before approval.
3. **Chapter-plan-checker fail** — deviations route to beat-targeted rewrites (up to `maxChapterPlanRewritePasses=2`). If the chapter plan still fails, escalate once to `chapter-plan-reviser`; restart the chapter attempt with the revised plan.
4. **Validation fail** — word-count + pov-missing blockers route to beat-targeted rewrites (same budget). Blind restart only if targeted exhaust. Word-count overshoot is warning-only.
5. **Functional story-state blocker** — deterministic payoff graph blockers route to the plan-assist exhaustion gate before approval. Semantic grounding findings from `functional-state-checker` are displayed in approval content but do not block.
6. **Continuity blocker** — continuity issues with severity `blocker` route to the plan-assist exhaustion gate before approval. Previous-state location findings are normalized to warning-class; the previous chapter's location is a starting hint, not an immovable constraint. Continuity transport errors still blind-restart because they are checker availability failures, not story findings.
7. **Prose-integrity blocker** — malformed final prose (duplicate adjacent spans, fused boundaries, malformed quotes) retries the chapter before approval. **L41 (exp #368):** the failed-attempt's specific `{kind, excerpt}` issue list is appended to every beat-writer userPrompt in the next chapter-attempt as a positive-framed avoidance block, so the writer sees what to avoid rather than redrafting blind.

Every reviser invocation is logged to `chapter_revisions` with outcome (accepted / rejected_beat_floor / rejected_new_characters / error / skip_*), issue signature hash, and pre/post beat snapshots. Surfaced via `GET /api/novel/:id/revisions` and the Studio pipeline view's `RevisionsPanel`.

**Exhaustion-handler architecture (shipped 2026-04-19, see `docs/exhaustion-handler-design.md`):**

- Plan-check + reviser both exhausted → **`plan-assist` human gate** in web mode (`PlanAssistPanel`: override / edit-plan / abort); **`PipelineBailError`** in auto-mode (run halts loudly, `lastRunError` written to novel state).
- Validation targeted-rewrites exhausted → **validation-driven reviser escalation** (`buildContextForValidation` path, path C). If reviser rejects, falls through to the same `plan-assist` gate.
- Reviser output rejected by sanity checks → **`plan-assist` gate** with `kind="reviser-rejected"` payload.

Exhaustion events are recorded in `chapter_exhaustions` table. Query via `GET /api/novel/:id/exhaustions`; surfaced in Studio via `ExhaustionsPanel` (SSE-refreshed).

### Validation and retry shape

- Chapter-level rewriter is removed.
- Tonal/voice LoRA generation is retired from runtime.
- Historical tonal-pass chapter versions can still be displayed for comparison, but new tonal-pass generation returns `410 Gone`.
- Retry pressure should route through drafting / targeted issue handling, not chapter-wide rewrite passes.
- If beat-level drafting falls back to chapter-level drafting, abandoned partial beat prose and accepted beat-check blockers are discarded before chapter-level checks run; stale beat findings must not block a fallback draft.

Primary code references:

- `src/phases/validation.ts`
- `src/phases/drafting.ts` — beat-targeted rewrite + reviser escalation paths
- `src/phases/beat-checks.ts` — BeatIssue aggregator
- `src/phases/functional-checks.ts` — deterministic payoff graph checks
- `src/agents/functional-state-checker/` — bounded semantic planned-state grounding check
- `src/agents/chapter-plan-reviser/` — planner-escalation agent
- `src/db/chapter-revisions.ts` + `sql/028_chapter_revisions.sql` — reviser telemetry
- `src/db/chapter-exhaustions.ts` + `sql/029_chapter_exhaustions.sql` — exhaustion-gate telemetry
- `src/gates.ts` — plan-assist gate type + auto-mode PipelineBailError path
- `ui/src/components/ExhaustionsPanel.tsx` — Studio SSE-refreshed exhaustion timeline
- `src/config/pipeline.ts`
- `src/orchestrator/novel-routes.ts`

### Known gaps under investigation

- **Cumulative prior-chapter context for the writer (L38).** L38-A (2026-05-02, exp #369) wired the READER-INFO STATE block into production beat context for chapters > 1: prior-chapter establishedFacts and per-present-character `doesNotKnow` render between resolved-references and SETTING. Slot-selection lives in `selectReaderInfoStateForBeat` (`src/agents/writer/enriched-context.ts`), and drafting wires `getFactsUpToChapter(novelId, ch - 1)` at all three `buildBeatContext` call sites (`src/phases/drafting.ts`). L38-A alone refuted the original causal hypothesis (writer saw the facts and still drafted prior-state as new). **L38-F (2026-05-02, exp #370, commits `d5c8e95`+`b77d206`) closes the cross-chapter cluster** with a single writer-side binding rule in `src/agents/writer/beat-writer-system.md`: "Reader already knows" lines are binding history for the POV character and any character who performed/witnessed/authored the listed action. **L38-G (2026-05-02, exp #372, commit `a27a8a1`) closes the same-chapter analogue** with a paired physical-state continuity rule in the same prompt: once a prior beat in the current chapter establishes a visible physical state (washed/unwashed hands, bandages, drawn weapons, removed cloaks, food/drink, lit torches), later beats must respect it or prefer ambiguity. Paired replay on `novel-1777721066908` chapter 2: baseline `chapter_exhaustions.id=81` 5 blockers → L38-A `id=83` 4 blockers (cluster persisted) → L38-F `id=84` 1 blocker (zero prior-state, residual = hand-washing/smudges) → L38-G clean pass (15/15 beats attempt 1, plan check passed, no new exhaustion row). **L38-C (2026-05-02, exp #371)** closed on stop gate (b) — `chapter_summaries` is intentionally obsolete after the 2026-04-13 summary-extractor retirement; the production cross-chapter bridge is `savePlannedState()` (planner-declared facts/character_states/character_knowledge in `src/planned-state.ts`, invoked from `src/phases/drafting.ts:1331`) surfaced via the L38-A READER-INFO STATE block, so no new summarization phase is added (`saveChapterSummary` has zero non-export call sites). The writer system prompt now carries two binding rules (cross-chapter L38-F, same-chapter L38-G); both depend on the L38-A surface being rendered. L38-B planner prior-fact context remains parked. Diagnosis in `docs/l38-investigation-2026-05-02.md`; lane results in `docs/sessions/2026-05-02-L38-A-prior-context.md`, `docs/sessions/2026-05-02-L38-F-reader-info-adherence.md`, and `docs/sessions/2026-05-02-L38-G-intra-chapter-state.md`.

## Retired Or Rejected Methodologies

These are not current strategy, even if older docs discuss them at length.

- Universal Howard-primer-style methodology as a default writing strategy: retired
- Writer-layer voice LoRA routing: retired from runtime
- Route-specific Salvatore corpus-leak checker: retired with the writer-LoRA route
- Craft encoded as large prompt-rule bundles: rejected
- Chapter-level rewriter as a core quality mechanism: removed
- Tonal/voice LoRA generation: retired from runtime

If a historical doc describes one of the above as current, treat that as historical context rather than live guidance.

## Current Improvement Philosophy

Systematic improvement should prefer these levers in order:

1. Planner output quality and expressiveness
2. Beat-context delivery and constraint clarity
3. Narrow checker calibration on real failure modes
4. Writer model upgrades

Improvement should not default to:

- adding new craft checkers
- encoding style theory into long system prompts
- multiplying post-hoc quality passes

## Finished Novel Acceptance

`docs/finished-novel-acceptance.md` is the canonical operator checklist for declaring a novel run "good enough finished." It enumerates eight gates that each map to an existing command, evidence artifact, pass/fail interpretation, and failure action. Gates 1–7 are locally checkable; gate 8 is a human read-through (subjective by design). The smoke-stop classifier (`scripts/agent/smoke-stop-classifier.ts`) and operator summary (`scripts/operator-summary.ts`) carry the run-level automatic signal; `scripts/agent/lane-status.ts` and `scripts/phase-eval/list-runs.ts` carry hygiene and calibration signals.

## Canonical Verification Gates

When the runtime, orchestration, or type surfaces change, these are the core checks:

```bash
./ui/node_modules/.bin/tsc -p tsconfig.json --noEmit
./ui/node_modules/.bin/tsc -p ui/tsconfig.json --noEmit
bun build --target bun src/index.ts --outfile /tmp/index.js
bun build --target bun src/orchestrator/server.ts --outfile /tmp/orchestrator.js
bun test
```

If a change affects model cost accounting, also verify representative `getTokenCost()` calls stay finite.

If a change affects eventing or orchestration, verify the backend event contract and process supervision path explicitly.

## Preflight Invariants

Structural-property checks that run as blocking preflight gates — the shift-left layer between tests and Codex review. Canonical invocation: `bun scripts/preflight.ts`. Five invariants are live (exp #243 shipped the initial slate; exp #244 widened #5; exp #246 tightened the baseline; exp #245 subsumed by #244); each targets a recurring bug class previously caught only by Codex. See `docs/invariants.md` for the canonical registry (assertion text, pattern docs, allowlist policy) — that file is the source of truth.

Live checks:

- **#1 revisionUsed restart persistence** (runtime) — reviser hard-cap holds across mid-run process restart. `src/phases/drafting-revision-used-persistence.test.ts`.
- **#2 Seam-recheck symmetry** (syntactic, AST) — every `chapter-plan-checker` / `chapter-plan-reviser` / `validateChapterDraft` call site inside `src/phases/drafting.ts` has a matching `inject.forceXxx` guard within ±50 source lines, including settle-loop rechecks. `scripts/lint/invariants-check.ts` `checkSeamRecheckSymmetry()`.
- **#3 Trace-seeded watcher** (syntactic, AST) — any test file that references SSE/trace event shapes must route through `watchForExpectations` / `watchForTerminal` (which seed from `GET /trace` before attaching the live stream). `scripts/lint/invariants-check.ts` `checkTraceWatcher()`.
- **#4 Branch-symmetric event emission** (runtime, narrow) — auto-mode and web-mode both emit `gate:plan-assist` with matching payload; drives through real `src/gates.ts` without mocking. `src/phases/drafting-reviser-escalation.test.ts`.
- **#5 Body-already-used detection** (syntactic, AST) — widened from template-literal regex to a TypeScript compiler API walk (exp #244, 2026-04-19). Groups body-consuming calls (`.text()` / `.json()` / `.arrayBuffer()` / `.blob()`) by `(enclosingFunction, receiverDeclaration)` and flags any source-ordered pair whose branch-containing-first does NOT unconditionally terminate (throw / return / continue / break, including try-blocks where both try-last and catch-last return; `switch` default-arms recognized). Default run scans ~112 sites repo-wide; `.claude/invariants-allowlist.yaml` `entries: []` (all 4 prior short-circuit-error-throw entries retired — reachability heuristic handles them natively). Loop-statement terminators and receiver-alias tracking deferred as conservative false negatives (flagged in `docs/invariants.md` known limitations). Regression belt: template + sequential + json-first fixtures under `tests/invariants-fixtures/`. `scripts/lint/invariants-check.ts` `checkBodyAlreadyUsed()`.

Baseline at ship time: `BASELINE_TEST_FAILURES = 0` in preflight (tightened 2026-04-19, exp #246) — the cross-file `bun:test` mock-pollution issue was fixed by extending the `mock.module("./beat-checks", ...)` factories in `drafting-reviser-escalation.test.ts` and `drafting-revision-used-persistence.test.ts` to re-export the full module shape (`aggregateIssues` + `formatRetryLine` + `summarizeIssues`). `bun test src/` now 71/0; any new failure fails preflight immediately.

## Documentation Contract

To keep the repo from drifting:

### Canonical source rule

For live architecture and runtime behavior, this file is the canonical source of truth.

### Same-commit update rule

If a commit changes current runtime behavior, architecture, or active methodology, it must do one of the following:

- update `docs/current-state.md` in the same commit, or
- include `docs-impact: none` in the commit body

`docs-impact: none` means the author explicitly checked and concluded that the change does not alter the current-state contract.

`scripts/preflight-docs-impact.ts` enforces the discipline. It runs in four modes: default (staged files), `--commit <ref>` (single commit incl. message), `--range <rev-range>` (every non-merge commit in the range), and `--since <date>` (every non-merge commit reachable from HEAD since the date). All modes share the same classification, footer detection, and exit-code rules; `--strict` exits non-zero on any violation. Use the range/since modes for morning pickup or long-loop review, e.g. `bun scripts/preflight-docs-impact.ts --since "yesterday" --strict`.

### Document roles

Use these categories consistently:

- **Current truth**: `docs/current-state.md`
- **Onboarding**: `README.md`
- **Method/rules**: `docs/experiment-design-rules.md`, `docs/overnight-runbook.md`
- **Historical notebook**: `docs/decisions.md`, `docs/lessons-learned.md`, experiment reports
- **Backlog/drafts**: `docs/todo.md`, charters, in-flight planning docs

Do not treat historical notebook docs as canonical current-state references.

## Update Checklist

When changing the live system, check these questions:

- Did the active writer route change?
- Did the active checker set change?
- Did a component move from active to retired, or vice versa?
- Did the retry/validation path change?
- Did the canonical verification gates change?
- Did the methodology change at the architecture level, not just as an experiment?

If yes, update this file.

## Current Session (2026-04-19)

- **Exhaustion-handler architecture fully shipped.** All five design-memo steps are live: plan-check escalation to chapter-plan-reviser, validation-path reviser escalation (path C), `plan-assist` human gate (web mode: `PlanAssistPanel` override/edit-plan/abort; auto-mode: `PipelineBailError`), `chapter_exhaustions` telemetry table + `GET /api/novel/:id/exhaustions` + `ExhaustionsPanel` in Studio.
- **Debug-injection MVP live.** `src/config/debug-injection.ts` with `DEBUG_FORCE_PLAN_CHECK`, `DEBUG_FORCE_VALIDATION`, `DEBUG_FORCE_REVISER` env flags. Campaign tests R0/R1/R5/R6/R7 all passing; R2/R3/R4 in flight with 15-minute web-mode timeouts.
- **Preflight invariants shipped (exp #243).** Five blocking preflight checks live via `bun scripts/preflight.ts` — covers restart persistence, seam-recheck symmetry, trace-seeded SSE watcher discipline, branch-symmetric event emission, and body-already-used detection. Commits `ce6452c`, `10ce979`, `7afe4dd`, `dedc0b6`, `2c29b91`. Registry at `docs/invariants.md`. Codex final verdict PASS after two fix-pass iterations.
- **Next pending work (from Codex follow-on reviews):** V2 transport-interceptor (Codex ae23f96a5f5cf8247) as the durable replacement for scattered env-flag injection seams; `src/invariants/debug.ts` centralized assertion module; historical-superseded doc pass across decisions.md + adapter-changelog.md + lessons-learned.md + fine-tuning-strategy.md + adapter-training-reference.md + retry-surface-audit.md (Codex ac11a277b179df8b0).

## Current Session (2026-04-21)

- **Quality-redraft gate shipped (behind flag, default OFF).** Commit `893bb26`. Two quality detectors live in `src/lint/quality-detectors.ts` (repetition-loop + underlength, 24 unit tests). `detectSyncDefects()` is wired into `src/phases/drafting.ts`; when detectors fire, the beat is redrafted from scratch (no V1 prose in context, no critique) rather than retried with critique. Flag: `pipeline.qualityRedraftEnabled` (default `false`); per-novel override via `seed.pipelineOverrides.qualityRedraftEnabled` (commit `e8b2bb6`). **Measurement (novel PID 315593) completed 2026-04-21: 0 redraft fires** despite flag on — detector thresholds likely too strict to trigger on real Salvatore-route production prose. Flag stays default OFF. Counted as signal #3 in the 2026-04-21 LoRA-track-evidence retrospective. See `docs/retrospectives/2026-04-21-lora-track-evidence.md` and `docs/decisions.md` "Salvatore v4 LoRA cannot rewrite with critique."
- **`src/agents/writer/retry-context.ts` extracted** (commit `3c5313d`). `buildRetryPrompt()` logic moved from inline drafting.ts to this dedicated module. Canonical source for retry-prompt construction — future probe harnesses and test fixtures should import from here.
- **`src/lint/quality-detectors.ts` is a new production module** (commit `ea74d90`). Repetition-loop detector + underlength detector, 24 unit tests. Future per-beat quality signals go here before wiring into the gate.
- **Salvatore conditioning-floor KILLED** (commit `639712e`, exp #258). Per-beat exampleLines rotation lost 7/20 to fixed preset-a on blind Sonnet pairwise distinctness judgment. Three auto-resolved pairs due to underlength (<50 words). Rotation also showed repetition-loop degeneration. Conditioning tricks are a closed chapter. Next lever: `salvatore-v5-corpus-expansion` (separate charter, pre-gated on PDF acquisition).
- **Parity harness SOP formalised** (commit `edb630a`). §4.7 added to `docs/experiment-design-rules.md`; new bullet in experiment charter template; pre-run checklist item. Canonical implementation: `scripts/evals/conditioning-floor-parity-check.ts`. Codex SOP-audit confirmed the rule and scope language as written.
- **Three-layer doctrine: Codex challenge noted.** Codex independent evaluation (jobs `bre6gu89b`, `bsbwl0v3g`) pushed back on "voice lives only in weights, editors can't add craft" as unproven and architecturally inconsistent — the quality-redraft gate is itself a cross-layer intervention. Doctrine not retracted but the absolute "don't cross streams" framing is softened: the layer assignments describe default optimization strategy, not a hard prohibition on context-engineering interactions across layers.
- **Rewrite-capability-probe charter: round-1 RED, not yet re-reviewed.** Commits `ca76090` + `d36bfae`. The rigorous probe (`eb3e7c8`) provided the decisive empirical evidence; charter needs a round-2 pass or formal withdrawal per `docs/todo.md`.

### Late 2026-04-21 — voice-LoRA track pivot + voice-shaping ablation

- **LoRA-track pivot committed.** Commit `1af5189` froze new LoRA investment; exp #272 later retired writer-LoRA runtime routing entirely. The current runtime writer path is DeepSeek V4 Flash for all genres, with fantasy structural priors feeding planning only.
- **2026-04-21 retrospective doc.** `docs/retrospectives/2026-04-21-lora-track-evidence.md` — first entry in the new `docs/retrospectives/` directory class per Codex consult doc-scope correction (retrospectives capture evidence arcs; decisions.md captures decisions; lessons-learned.md captures distilled rules; current-state captures live truth). Status: draft until voice-shaping-ablation-v1 resolves.
- **Three new lessons-learned rules** (commit `1af5189`): (1) N≥3-round step-back rule from the 9-round arm-b-preflight arc; (2) AI-judge pairwise bias-confound when length correlates with arm identity; (3) 14B-voice-fine-tune failure mode is scale-specific, not thesis-wide.
- **Charter lineage through the 2026-04-21 arc:**
  - `docs/charters/arm-b-detector-preflight.md` — 9 rounds, eventually superseded by arm-b-direct-pairwise per meta-consult
  - `docs/charters/arm-b-direct-pairwise.md` (revision 2) + results memo — CAUTION 11-9
  - `docs/charters/arm-d-writer-upgrade.md` (revision 3) + results memo — formal adjudication skipped per Codex design consult; pivot committed on directional evidence
  - `docs/charters/voice-shaping-ablation-v1.md` (revision 2) — first experiment under the post-pivot architecture
- **New infrastructure under the pivot** (commit `34898d3`):
  - `scripts/evals/voice-shape-metrics.ts` — 5-feature voice-shape extraction (mean sentence length, sentence-length std, dialogue ratio, clause complexity, sensory density), per-feature standardized distance to a reference, `countImprovedFeatures` for charter's "≥3 of 5" rule. 16 unit tests.
  - `scripts/evals/voice-shape-reference.json` + `voice-reference-passages.json` — frozen 10-passage Salvatore reference distribution (stratified 3/3/2/2 across kinds) + 5 few-shot excerpts. Deterministic via seed `voice-shape-reference-v1-2026-04-21`.
  - `src/agents/writer/voice-shaping-prompts.ts` — prompt fragments for D1 (style guide), D2 (few-shot reference passages), D3 (character voice directives). NOT imported from production paths.
  - `scripts/evals/run-voice-shaping-ablation.ts` — 4-arm runner with inline parity assertions.
- **React UI: pairwise adjudication page** at `/app/pairwise/:bundle`. Commit `41df605` + `d9536cf`. Server-side packet parsing, one-at-a-time review with keyboard shortcuts (1/2/3 → label+advance; ←/→ step), auto-save on click, "Compute verdict" button appears when all packets labeled. Used for arm-b-direct-pairwise-v1 (completed) and arm-d-writer-upgrade-v1 (skipped per consult); generalized to any `set_name` in `eval_results` with two distinct cell_labels.
- **Post-Codex-consult process discipline.** After the arm-b preflight hit 9 rounds, meta-consult became the canonical "is this the right instrument" check. Three meta-consults in the 2026-04-21 arc (`a738b4bb2879c39d0` shape; `acc1b47d14ce265f4` strategic pivot; `ae0e768d3292eb256` decomposed-audit design) each redirected material work — documented as a repeatable pattern in lessons-learned.

### Late 2026-04-21 — autonomous-loop roadmap revision 2 + tier-ordering-validation killed

- **Autonomous-loop roadmap revision 2 landed** (commit `db9d8f6`, `docs/autonomous-loop-roadmap-2026-04-21.md`). Applied Codex adversarial review of revision 1: tier reorder, Tier 1.5 concept named, prerequisites enumerated, exit criteria tightened, 2×2 counterfactual design added.
- **`tier-ordering-validation-v1` charter fully killed.** Full lineage: draft charter (commit `76a7667`) → Opus `experiment-adversary` RED verdict recorded (commit `cca9f57`, 7 blockers + 4 warnings + a $0.60 cheapest-untried-counterfactual probe) → terrain survey killed the v1 lever (commit `9956f62`) → pivot to v2 lever + probe driver (commit `8b89638`) → probe FLAT within noise (commit `b4426fb`, exp #264, actual $0.028 = 21× under budget). Matched-pairs McNemar p ≈ 0.68 at n=26/cell; writer IS responding to the lever but effect sits within sampling noise. Results doc: `docs/charters/tier-ordering-validation-v1-results.md`.
- **New architectural knowledge — writer-visible state surface is narrower than outline schema.** Terrain survey established that `outline.establishedFacts` reaches the writer ONLY via `beat.requiredPayoffs` links (SEEDS / PAYOFFS DUE blocks rendered at `src/agents/writer/beat-context.ts:255-281`); orphan facts are used only to build a `factById` lookup. `outline.characterStateChanges` is never rendered to the writer at all. Future planner-side state work must check this render surface before assuming a field is writer-visible.
- **3-tier sequential ordering is now a working hypothesis**, not a validated assumption. Revisit only if Tier 1 winners collapse under Tier 2 writer swaps.
- **Next direction: Tier 1B writer-visible threading.** Bulk `establishedFacts` injection into `beat-context.ts`, `worldExpansionBudget` wiring, `priorBeatEstablishedFacts` via `getFactsUpToChapter`. Requires production code change; measurement via decomposed audit at full-novel scale, not chapter-probe.

## Current Session (2026-04-20)

- **beat-entity-list V1 shipped (exp #254).** `halluc-ungrounded` now receives a `Beat-entities:` sub-line derived at check-time from `outline.establishedFacts` + prior-beat `description` via `src/phases/beat-entity-list.ts:deriveBeatEntities`. On-seed fire rate dropped 44.9% → 28.9% (−16 pts), precision 87.5% on 10-fire Sonnet adjudication, all 5 charter gates cleared. `BEAT_ENTITY_LIST_VARIANT=v1` is now the default. See hallucination bullet above (line 76) for full detail + commit SHAs.
- **Cross-genre smoke (exp #255) confirmed safe.** Non-Salvatore seeds show no regression with the V1 default.
- **`logLLMCall` double-encoding fix (commit `ff555bc`).** `llm_calls.request_json` was being stored as a double-encoded string; now stored as proper JSONB. Grounded-sources provenance is queryable via `#>` path operators.
- **halluc-leak-salvatore Rung 0 shipped, then retired with the writer-LoRA route.** Commit `cc57752` is historical evidence that regex-first was cheaper than SFT for corpus-leak detection. Exp #272 removed the runtime leak checker because no active writer route is trained on the Salvatore corpus.
- **V1a payoff-floor mini-pilot (exp #256) ran 2 of 4 arms → ITERATE.** Baseline vs aggressive-prompt-only on 3 seeds × 5 chapters. Mean paired Δ retry_ratio = −0.0309; prompt did NOT recover V1a lift, consistent with "V1a schema is the causal lever." But `extractor` + `mainv1a` arms missing (scoping error at launch); V1b/V1c still gated on the complete 4-arm pilot. Next-session action + 6 novel IDs + full table in `docs/pp2-floor-pilot-results.md`.
- **salvatore-v5-stripped ablation scoped and parked** (commit `15843a4`). Training data stripping script already ran successfully on the 777-pair corpus (zero residual corpus tokens in stripped prose). 4 design gates pending user decision before SFT submission. Sequencing: run conditioning-floor charter (`docs/charters/salvatore-distinctness-conditioning-floor.md`) first; v5-stripped go/no-go after its verdict. See `docs/ablation/salvatore-v5-stripped.md`.
- **Conditioning-floor scorer implementation in flight.** Codex CLI job running in background — implementing the 4 TODOs in `scripts/evals/run-salvatore-distinctness-v1.ts` + arm-config JSONs. Session closed before Codex reported; work is uncommitted on `main` and needs the session-end review (listed in `docs/next-session-plan.md`).
- **Component-isolation testing methodology proposed** (commit `7794735`). `docs/component-isolation-testing.md` — framework for when to test harness components offline (replay against existing `llm_calls`, plan-diff, beat-rewriter) vs e2e. Status: proposed. Motivated by observing that recent charters (including the V1a pilot above) could have been cheaper with replay harnesses.

## Current Session (2026-04-23)

- **Drift detector skeleton shipped (Phase 0 prereq #2).** `scripts/autonomous-loop/drift-detector.ts` + migration `sql/032_drift_checks.sql`. It remains useful for archived adapter baselines, but adapter drift is no longer the active runtime checker strategy after exp #272 moved active checks to DeepSeek V4 Flash + deterministic guards.
- **Migration 032 is next.** `sql/032_drift_checks.sql` adds the `drift_checks` table (run_id, adapter, frozen_run_id, precision/recall/F1 frozen+current+delta, trips_gate, gate_reason, brief_count, error_text, ran_at).

## Current Session (2026-04-28)

- **Drafting-layer deepenings landed (D1–D4a).** Per `docs/plans/2026-04-28-drafting-deepenings.md` (Codex GREEN round 4): D1 typed `BeatContext` slots + pure renderer + 20-fixture byte-parity gate (`b2669f9`); D2 `attemptRevision` policy module owning the reviser dispatch + sanity checks + `revisionUsed` write-before-call guard (`a16f72d`); D3 generic `runSettleLoop<T>` shell consolidating both plan-check and validation rewrite loops behind one shape (`2688f28`); D4a migrates the `DEBUG_FORCE_PLAN_CHECK` / `DEBUG_FORCE_REVISER` env-var seams from inline guards in `drafting.ts` to V2 transport-interceptor rules registered at orchestrator boot via `src/debug/v1-bridge.ts`. `DEBUG_FORCE_VALIDATION` stays at V1 until D4b lands the deterministic-check interception layer. Invariant #2 (Seam-recheck symmetry) stays live; the three plan-check/reviser call sites now carry `// @noninjectable` markers (transport handles it).

## Current Session (2026-04-29)

- **DeepSeek V3.2 → V4 Flash swap shipped (commit `eb2993d`; updated by exp #289).** Removed legacy `deepseek-chat` and `deepseek-reasoner` registry entries entirely (no aliases). Added `deepseek-v4-flash` ($0.14/$0.28, $0.0028 cache hit; thinking optional; maxOutput 64K) and `deepseek-v4-pro` ($1.74/$3.48 base, currently 75% off until 2026-05-31; thinking always-on; reserved as escalation, NOT routed in `roles.ts`). All DeepSeek-using slots in `src/models/roles.ts` now route to V4 Flash; thinking ON only on `planning-state-mapper`, `chapter-plan-checker`, `chapter-plan-reviser`. `thinking: boolean` plumbed through `src/llm.ts` makeRequest into the request body as `thinking: { type: "enabled" }` for the deepseek provider. 22+ scripts string-replaced from `deepseek-chat` → `deepseek-v4-flash`.
- **CLAUDE.md rule 6 augmented (commit `09bbf7a`).** Explicit list of required-rsync stages added: `src/models/roles.ts`, `src/models/registry.ts`, `src/agents/**`, `sql/**`, `src/config/pipeline.ts`, `src/phases/**`, `src/llm.ts` / `src/transport.ts`, `src/lint/**`. Doc-only commits and local-only scripts (`scripts/phase-eval/**` parents, `scripts/variant/**`) do NOT require deploy.
- **`record-fixture.ts` autoMode + auto-resolver fix (commit `cd55f0f`).** `tests/phase-parity/record-fixture.ts` now calls `setAutoMode(true)` + `setResolverMode("auto")` before `runNovel`, fixing a hang where the recorder blocked on the world-bible approval prompt because autoMode defaulted to false. Parity fixture P0b is RUNNING on LXC at session close (`bun tests/phase-parity/record-fixture.ts fantasy-system-heretic` PID 823157, log `/tmp/parity-record-fantasy-system-heretic.log`); fixture artifacts not yet committed.
- **Phase-eval probe scaffold (Slice 0a + Slice 1, commits `a031980` + `c6ef9a5`).** Cheap-probe instrument from `docs/designs/phase-variant-comparison.md` charter (R5 — converged after 4 rounds of Codex `gpt-5.5 effort=high` adversarial review). Components:
  - `scripts/variant/clone-for-variant.ts` — `--target-phase=concept-done` flag added. Defines `COMMON_CLONE_TABLES`, `DRAFTING_ONLY_CLONE_TABLES`, `CONCEPT_DONE_ONLY_CLONE_TABLES`, `CONCEPT_DONE_MUST_BE_ABSENT`. Concept-done mode lands the cloned target at `phase=planning, current_chapter=1` and asserts post-concept tables are empty after clone.
  - `src/agents/planning-beats/index.ts` and `src/agents/planning-state-mapper/index.ts` — prompt override seams read at module load. `PLANNING_BEATS_PROMPT_OVERRIDE` varies beat-shape expansion; `PLANNING_STATE_MAPPER_PROMPT_OVERRIDE` varies state/obligation placement.
  - `scripts/phase-eval/run-variant.ts` — child entry: takes `--novel-id` (cloned concept-done state) + `--output-dir`, runs planning ONLY via `runPlanningPhase`, dumps `chapter_outlines.outline_json` to disk. The child now accepts `PLANNING_BEATS_PROMPT_OVERRIDE`, `PLANNING_PLOTTER_PROMPT_OVERRIDE`, or `PLANNING_STATE_MAPPER_PROMPT_OVERRIDE`.
  - `scripts/phase-eval/probe-planning-beats.ts` — parent driver: concept once → clone that same concept-done snapshot per variant → spawn `run-variant.ts` per variant with the selected prompt env pre-set → aggregate outlines into `summary.json`. Cloning holds world/characters/story-spine constant so differences are attributable to the varied planning prompt, not concept randomness. Each variant gets its own bun process for fresh module graph (top-level await on the prompt file caches forever in-process; child processes are mandatory).
  - `scripts/phase-eval/print-screen-verdict.ts` — verdict computer; supports `--metric-set=planning-beats` for historical beat-shape/facts-density gates and `--metric-set=state-mapper` for mapper-owned facts/knowledge/state/payoffs/obligations, orphan, overload, and state-retention metrics. The verdict script calls no judge LLM; it applies deterministic file/SQL gates to LLM-produced outlines plus `llm_calls` telemetry.
  - `scripts/phase-eval/variants/planning-beats/{default,loud,corpus-v1}.md` are beat-shape-only variants. `scripts/phase-eval/variants/planning-state-mapper/{default,coverage-balanced}.md` are the first mapper-state variants.
  - **Charter:** `docs/designs/phase-variant-comparison.md` (R5, committed `42ae810`). 5-chapter planner-only A/B with directional G1-G4 gates.
  - **Status:** Slice 1 implementation landed; Codex review pass queued; first end-to-end probe run pending parity-fixture P0b completion.
- **Character-arcs LTWN harness integration shipped.** First corpus-derived structural prior to land in the runtime pipeline. `src/agents/character-agent/schema.ts` adds 5 optional fields — `lie`, `truth`, `want`, `need`, `arc_resolution` (`z.enum(["fulfilled", "partial", "tragic_inversion", "static"])`) — to `characterProfileSchema`. Optional so legacy novels round-trip. `character-profile-system.md` documents the LTWN structure with examples + the corpus-derived distribution target (≥1 tragic_inversion, ≤50% fulfilled for a 5–8 character cast). `planning-plotter/context.ts` renders the LTWN block when populated; static or partially-populated characters render only the fields they have. Calibration evidence: Crystal Shard CELL PASS F1=1.00 on character identification + LTWN structure (2026-04-29, Phase A 2×2). Mapped via [`docs/structural-dims-to-harness-mapping.md`](structural-dims-to-harness-mapping.md). Tests pass (writer enriched-context unchanged), no typecheck regressions in changed files.

## Current Session (2026-04-30)

Corpus pattern mining session on the Salvatore Icewind Dale 3-book bundle. Branch: `phase-variant-screen`. Theme: closing the gap between the chat narration of subagent findings and the `docs/harness-tuning-roadmap.md` cross-pattern view, plus codifying the rules that prevent the gap from re-opening.

- **Corpus mining maturity step-up.** `docs/harness-tuning-roadmap.md` now carries roadmap rows for ~30 measured patterns under the directional-gate methodology (PASS / DIVERGE / NEG / WATCH per row), each with cross-references to the JSON artifact under `novels/salvatore-icewind-dale/structure-calibration/` and the commit hash that landed it. Catch-up wave landed P22–P41 in commit `4ede0f4`; punctuation (P42) and dialogue tags (P48) added in `e225589`. Per-pattern data commits across the session: `351ec9d`, `d7df7cf`, `47ba480`, `670a1f1`, `c0ff3c7`, `86d4998`, `7e5de0f`. Six measurement subagents are in flight at session-pickup time (P49 chapter-opener / P50 chapter-closer / P51 scene-break cadence / P52 POV distribution / P53 sensory-mode density / P54 time-skip markers); their landings will append additional roadmap rows + conclusions sections once the orchestrator does the commit sweep.
- **CLAUDE.md Rule 14 (capture lessons at moment of surprise)** committed in `d492d61`. Codifies same-commit `docs/lessons-learned.md` entry whenever a session produces a methodology surprise, calibration finding, or process correction. Trigger surface enumerated in CLAUDE.md (low-prevalence multi-axis verdict, calibration pass/fail, methodology hop, > 10-min tool gotcha, "we already had this lesson somewhere" moment).
- **CLAUDE.md Rule 15 (findings must land in tracked docs, not just chat)** committed in `11a8178`. Per-finding cadence — when 5+ subagents land in parallel, each landing produces a roadmap row in the same or immediate-follow-up commit, not an end-of-session batch. Distinct from Rule 14: Rule 14 captures *generalized rules*, Rule 15 captures *specific findings*. Both are structural, not aspirational — chat is the most ephemeral persistence layer in the system.
- **Schema-prompt sync fix landed (commit `0c8457d`).** `src/agents/planning-beats/beat-expansion-system.md` now matches the production `sceneBeatSchema` enums after an LXC probe surfaced the planner emitting invalid `miceActive=['E','C']` against the new `MICE_ACTIVE_THREADS=["I"]` / `MICE_OPENS_THREADS=["M","I"]` constraints. Class-of-bug pattern: when a schema field constraint is tightened in a `feat`-class commit, the corresponding agent prompt must be synced in the same commit (or a same-day follow-up) — otherwise the next pipeline run validates against the new schema with the old prompt and emits structurally invalid output.
- **Lessons-learned wave** appended this session (already committed):
  - **Cross-model F1 ≠ anchor stability** (`97190b2`) — they measure different things; both gates must pass before a dim ships.
  - **Granularity rotation** (`cd4347a`) — fields validated at scene-level can degrade at beat-level (or vice versa); confirm at the production-emit granularity.
  - **Binary-collapse-before-relabel** (`b061779`, `c48a232`) — cheapest counterfactual on a FAILED gold-stability check is data-only re-aggregation; relabel only if collapse fails.
  - **Aggregate-only patterns can survive while per-book patterns fail** (`ad33e98`) — for cross-book/cross-corpus claims, gate per-book, not on aggregate.
  - **Parallel subagents on append-only docs need atomic write-then-rename** (`474585b`, `7e5de0f`, `11cafad`, `37f297f`) — the naive read→edit→add→commit pattern doesn't survive concurrency on shared narrative docs; the operational fix is per-pattern conclusions stubs gathered later.
  - **Findings narrated in chat die without crossing into tracked documentation** (`c0ff3c7`) — Rule 15's structural justification.
  - **Small-sample anchor Jaccard is a screening tool, not a ship gate** (`d492d61`) — n=50 gives false confidence on rare-event subfields; full-population validation is the load-bearing check.
  - **Hand-spot LLM probe verdicts on low-prevalence multi-axis dimensions** (`d492d61`) — Pattern 26 false-negative finding (DeepSeek 2.5% vs Sonnet 10.1% on compositional title axis) is the cite.
- **Patterns 72–75 sweep landed (commit `788b7a2`) — interaction patterns + magic lexicon.** Cumulative pattern count is now ~75 patterns probed across the IWD trilogy under the directional-gate methodology. P72-75 covered unique territory the earlier waves had not exercised: P72 per-PAIR dialogue voice (PASS_PARTIAL, 3/7 pairs PASS — Bruenor is the voice-pulling anchor in all 3, harness lever is per-pair `interactionMode` planner prior + per-pair fewshot block layered above P65 per-character fewshots + pair-context lints); P73 gesture-vs-tag ratio (DIVERGE, top-kind shuffles 3/3 books, surviving axis is action consistently top-2 + BARE-rate clusters for books 2-3); P74 character-pair scene affinity (DIVERGE, top-3 intersection 0/3, stuck-together-in-2-books at lift≥1.5 for Drizzt+Wulfgar and Bruenor+Catti-brie, universal book1→book2 affinity rise 10/10 as series-progression prior); P75 magic invocation (KILL, climax-spike reproduces only in CS, 8-token shared core, magic-antagonist 2× elevation real WITHIN book but per-book localized).
- **Mining surface approaching saturation; pivot to synthesis.** Concrete composite-prior bundles emerging from the cumulative wave: chapter-CLOSE narrator-seam (P50+P54+P55), action-beat assembly (P64+P53+P56+P66), voice-shaping bundle (P29+P39+P57+P65+P67), and now per-pair `interactionMode` (P72 layered over P65). The next priority is composite-prior synthesis → variant prompts → phase-eval probe through the existing `phase-variant-screen` instrument, NOT additional single-pattern measurements. Single-pattern coverage is high enough that the marginal pattern row is unlikely to produce a new harness lever; the marginal probe-variant arm is the higher-leverage spend.
- **Methodology surprise — `atomic_append_section` lost 3 of 4 sections under N=4 parallel subagents.** Recovery was manual (compact reconstruction from each subagent's verdict report, all 4 sections present in `crystal_shard-conclusions.md` post-recovery, all 4 roadmap rows + JSONs landed correctly through the row/JSON helpers). The flock-protected append helper is the SECOND parallel-write failure mode the project has hit — first was raw `>>` appends with merge conflicts (Patterns 28/32/33/37), now `flock + O_APPEND` with silent loss under high parallelism. Lesson committed in this same sweep — see `docs/lessons-learned.md` "atomic_append_section is not safe under N≥3 concurrent subagent processes." Practical mitigation until the conclusions-stubs flow lands: post-run `grep -c "^## Pattern N:" target.md` against the number of parallel subagents, OR cap parallel pattern subagents at 2 when they share an append target.
- **Three-layer architecture status updated by exp #272.** Planning layer: fantasy structural priors remain available to planner prompts. Writing layer: all genres route to base DeepSeek V4 Flash, not Salvatore v4 LoRA. Checker layer: active runtime checkers are deterministic guards plus bounded DeepSeek V4 Flash calls; route-specific leak and tonal-pass code is retired.
- **Planner status — phase-eval probe instrument now has split-mapper plumbing.** `phase-variant-screen` branch carries the SCREEN-PASS verdict on the pre-split `loud` planning-beats variant against `fantasy-system-heretic` (Slice 1 end-to-end, retrospective at `docs/sessions/2026-04-29-phase-eval-probe.md`, Codex review integrated in `28c2e57`). Because `planning-beats` is now beat-shape only and `planning-state-mapper` owns state/obligation density, future phase-eval gates must choose which surface they vary. The runner/verdict plumbing supports mapper variants via `PLANNING_STATE_MAPPER_PROMPT_OVERRIDE` plus `--metric-set=state-mapper`; state-mapper verdicts now include G5 call-health (JSON retries/failures, Zod failures, failed calls, cap hits). Exp #294 passed all state-mapper gates on `fantasy-system-heretic`: `coverage-balanced` had zero orphans, zero overloaded beats, state_items=52 vs floor 22.5, no retries/failures/cap hit, and max completion 9147/16384. Follow-up queued: sample `coverage-balanced` on another seed before considering default-prompt promotion.

## Current Session (2026-05-01)

Continuation of the §2 checker calibration cycle from the labeling task. Branch: `synthesis-bundle-v1`. Theme: build the labeled current-surface panel, measure both checkers' real calibration on it, and ship the resulting prompt change.

- **Current-surface checker calibration panel labeled (exp #301).** 4 parallel Sonnet subagents oracle-labeled the 34 natural rows of the exp #299 panel (17 halluc-ungrounded + 17 adherence-events) with quote-required evidence against checker-visible surfaces. **halluc-ungrounded:** TN=12, FN=4, MIXED=1 → 12.5% recall, 50% precision. Systematic FN class on title+ungrounded-surname (Guildmaster Aldric, Master Orin), named institutions (Office of Structural Integrity, Vault of Witnesses), named lore events (the Purge). **adherence-events:** TN=13, TP=4, FP=0, FN=0 → 100%/100%. Labeled panel persists at `/tmp/halluc-current-panel-exp299-labeled.jsonl` (LXC + local). Surface fingerprint `bcc85ab1`.
- **Synthetic-fixture invocation (exp #302, `scripts/hallucination/run-synthetic-checkers.ts`).** Invoked both checkers on the 10 staged candidate-score rows (5 entity-insertion + 5 event-omission). halluc-ungrounded missed all 5 `Veyr Dominion` insertions silently (pass=true, issues=[], empty reasoning) → 0% synthetic recall. adherence-events caught all 5 event-omission fixtures with appropriate evidence quotes → 100% synthetic recall. Combined natural+synthetic halluc recall ≈ 3.5% (1 of 13 hallucinations) — confirmed the prompt-revision blocker before promoting any severity change.
- **halluc-ungrounded prompt revised v1 → v3 and promoted (exp #303).** `src/agents/halluc-ungrounded/halluc-ungrounded-system.md` grew from 14 lines to 39 lines: split into MUST-FLAG vs PASS-EXCEPTION sections; explicit enumeration of FN classes (institution / place / lore-event / title+ungrounded-surname); tightened the title-alias rule so the SURNAME component must be the grounded part; added pass exceptions for calendar years and lowercase intra-text anaphora. A/B harness `scripts/hallucination/ab-halluc-prompt.ts` re-invokes the checker on the same 22-row labeled panel with a candidate prompt. v1 baseline (clean A/B): recall 10.0% / precision 100% / F1 0.182. v3 run 1: 70.0% / 77.8% / 0.737. v3 run 2: 60.0% / 66.7% / 0.632. Both v3 runs are 3.4-4× baseline F1. Run-to-run variance at temp=0.1 is real and parked as a stability follow-up. Deployed.
- **Adherence-events stays at 100/100 — cleared for stricter contract design.** No prompt change needed for the adherence checker. The labeled panel ground-truths the binary `events_present` decision against `events_fully_enacted` / `events_partially_enacted` / `events_not_enacted` per-row oracle judgments with quote evidence. The labeling subagents flagged that the existing checker's *reasoning* is sometimes approximate (e.g. attributing "Cassel never asks" as the sole missing event when other obligations were also unmet) but its *disposition* (fire blocker vs pass) is correct on every row. Obligation-aware design can build on this calibrated base.
- **Documentation discipline observed.** Every experiment recorded with a `linkExperiment` chain (#301 ← #302 ← #303). Two new lessons in `docs/lessons-learned.md`: per-checker labeling (never pool calibration matrices across checkers) and subagent batching for calibration (minimal payload + quote-required evidence + suffix-aware fixture-id normalization).
- **halluc-ungrounded v3 stability investigated (exp #304); v4 attempted but regressed (exp #308).** v3 at temp=0 is more stable run-to-run (21/22 stable vs ~17/22 at temp=0.1) but slightly worse precision (mean 66.8 vs 72.3) due to 5 FPs on generic document types ("the reconciliation report", "the porter's testimony"). Mean F1 marginal (0.683 vs 0.685). Kept live at temp=0.1. v4 candidate adding more pass-exception text regressed to 50%/71.4% F1=0.588 vs v3's 70%/70% F1=0.700; not promoted. The hypothesis was "more exception text = better discrimination"; the data says additional exception text under-primes the model on what to flag.
- **Obligation-aware adherence prototype demonstrated (exp #305, `scripts/hallucination/probe-obligation-aware-adherence.ts`).** Per-event variant decomposes `beat_description` into discrete events on the LLM side and judges each with quote evidence. Binary calibration TP=3 FP=1 FN=1 TN=12 (88% match vs current binary checker's 100%), per-event recall 75% / precision 67%. Caught the missing "Cassel asks" event on all 3 b12 attempts exactly per oracle; caught porter→copyist drift on b12-a2. Live wiring queued for two-stage design (binary first, per-event on fail).
- **Wider 10-chapter P3/P16 plotter probe confirmed surface gain + surfaced new failure mode (exp #307, persisted as `phase_eval_runs.id=17`).** corpus-v1 lifts facts (5.5→7.5), knowledge (4.5→7.5), total_beats (135→223). G2/G3/G4 PASS, G1 narrowly FAIL (7.5 < 1.5×5.5=8.25). Earlier n=3 facts-drop signal was noise. P3 closer-kind diagnostic (new in `print-screen-verdict.ts`): both variants comply with "NEVER close with pure description" rule (0/10 each). New finding: corpus-v1 over-rotates to description openers (9/10 vs corpus ~50%) — the "~50% description" prompt wording read as "almost always description". Fix landed in commit `31d7f16` (re-probe is exp #311).
- **§5 phase-parity reliability flake fixed.** `src/db/connection.ts` lazy SQL Proxy now detects `ERR_POSTGRES_CONNECTION_CLOSED` (and message variants) in the apply trap and `unsafe`/`begin`/`transaction` methods, nulls the singleton, and retries once. Long-running processes survive idle disconnects without surfacing the transient. Unit-tested via `withReconnect`/`isConnectionClosed` direct calls in `src/db/connection-reconnect.test.ts`. Lesson appended.
- **§5 historical-superseded doc pass complete.** Inline `> HISTORICAL — superseded.` callouts on all 9 stale docs across two sessions: hallucination-v3-wire-in-plan, pipeline-14b-consolidation, beat-writer-architecture, hallucination-checker-findings, lora-style-transfer-report, next-session-plan-2026-04-21, codebase-audit-2026-04-18, remediation-pass-2026-04-18, harness-optimization-inventory. Each callout cites the canonical current-state source plus the resolving experiment or deprioritized direction.
- **n=10 noise-baseline established (exp #311 r1/r2/r3 + #312 + #313).** Single-run G1/G2 SCREEN-PASS at n=10 chapters is NOT promotion-grade — facts/knowledge medians swing 2-3 across reruns of the same prompt; r3 of the noise baseline failed planning entirely on stochastic Chapter 9 under-production. The closer-kind "NEVER close with description" rule held 0/10 in 3 consecutive runs (deterministic discipline locked). `print-screen-verdict.ts` now prints a noise caveat after every planning-beats verdict pointing operators at `list-runs.ts` for run history.
- **Closer-rule promoted to live planning-plotter (commit `14218bf`, validated by exp #312, `phase_eval_runs.id=20`).** "NEVER close a chapter on pure description" is now in `src/agents/planning-plotter/chapter-outline-system.md` (and the `default.md` probe variant). Validation showed 0/10 description closes both pre- and post-promotion: explicit guard against stochastic drift, no behavior change observed.
- **Opener-kind prompt intervention failed in BOTH plotter AND beats prompts (exp #311 + exp #313).** Plotter intervention had no measurable effect (90% → 80% across noisy reruns). Beats intervention WORSENED the bias (10/10 description openers vs default beats 6/10 with 1/1/1 spread for action/dialogue/interiority). The "X OR Y" framing with negative prime collapsed dialogue and interiority as options without breaking the description default. Reverted in commit `aa4423f`. Lesson appended: explicit X-OR-Y rules under strong default bias collapse to the default. Opener-kind work parked until a non-prompt mechanism (post-hoc beat-kind rewriter) or fundamentally different prompt framing.
- **§5 TypeScript baseline tightened (commit `6594acd`).** 12 → 0 errors in test fixtures. Categorized: missing obligations field, missing charactersPresentIds field, Zod inference-path identity quirk (cast as SceneBeat), llm.test.ts closure-mutation control-flow narrowing (wrapped in object). All 27 tests in touched files still pass; `bunx tsc --noEmit` clean.
- **§5 plan-assist gate restart recovery shipped (commit `d055f60`, deployed).** New `cleanOrphanedExhaustionsForNovel` helper + call from `POST /api/novel/resume` handler. On resume, any pending plan-assist gate row for the novel is auto-marked `decision='orphaned'` with a reason indicating the resume context; fresh gates fire as new rows on the resumed attempts. Test in `src/db/chapter-exhaustions.test.ts` (4/4 pass). The "full re-await" direction (restoring in-memory promises across process boundaries) is intentionally not implemented — clean+recreate is operationally simpler.

## Current Session (2026-05-02)

- **L31 stack production-validated (exp #358, L31d).** Re-smoke of `fantasy-debt` confirms L31a + L31b + L31c + L32 closed both L24-class blockers (NER-only-warning exhaust + adherence stage-1 stochastic variance). All L17/L22 cluster fixes continue to hold. Chapter 1 drafted cleanly on attempt 1; chapter 2 produced complete 14-beat draft on attempt 1 then halted at the plan-assist gate when `continuity-state` correctly flagged a chapter-level state mismatch (planner: ledger glows red near false debts; prose: "amber, quiet"). Stop condition (b) — NEW design-class behavior surfaced: continuity blockers route directly to plan-assist via `buildCheckerBlockerDeviations` (`drafting.ts:1116-1133`) without consuming chapter-attempt retry budget. With L17/L22/L24 closed, this routing becomes the dominant remaining halt class. L37 todo logged: decide between continuity-once retry vs documenting current routing in `docs/overnight-runbook.md`. Cost $0.0526 / $4. See `docs/l31d-resmoke-2026-05-02.md`.

## Current Known Gaps

These are known cleanup items, not contradictions in the operating model:

- Root TypeScript still has a bounded set of implicit-`any` row-mapping errors.
- Historical docs still contain valid context mixed with stale current-tense statements.
- The repo still needs discipline around classifying docs as current-truth vs historical notes.

Those are documentation/process debt items, not a reason to fork the methodology again.
