# Novel Harness

AI-assisted novel creation harness — deterministic code controls flow, LLMs are leaf-node function calls. Supports short stories (3 chapters) for rapid iteration and full-length novels (20-30 chapters). Beat-first architecture: planning outputs world state, writing is per-beat with adherence checking, quality measured via structured pass/fail checks.

## Philosophy — three-layer architecture (north star 2026-04-18)

The harness is three separable layers, each optimized differently. The layer assignments describe the primary optimization direction for each layer — they are not a hard prohibition on context-engineering interactions across layers. (Codex independent evaluation 2026-04-21 identified this as an over-statement; cross-layer feedback routing like the quality-redraft gate is consistent with the architecture.)

- **Planning layer — structural imitation.** Imitates the structure of successful storytelling (beat rhythms, cluster patterns, opener/closer rules, scene sizes, tension curves). Extracted from proven corpora (Salvatore reference implementation), rendered into planner structural priors. Long-term: robust human-in-the-loop planning stage where the author shapes world/character/arc commitments.
- **Writing layer — cadence/tone imitation.** The active runtime writer is **DeepSeek V4 Flash** base (swapped from V3.2 on 2026-04-29), non-thinking, with the base beat-writer prompt and rich/default beat context. **Status 2026-04-30:** writer-layer voice LoRA routing is retired from runtime (exp #272). Fantasy genre matching supplies planner structural priors only; it does not swap the writer model, system prompt, compact context, or leak profile.
- **Checker/rewriter layer — anti-hallucination + on-plan discipline.** Adherence-events, chapter-plan-checker, hallucination-checker, continuity (legacy). These don't add creative value — they add discipline, catching things the autonomous drafter introduces. Each check is narrow, independently trainable, ideally small enough to run locally. Retry shape: targeted beat rewrites first; on plan-check exhaustion, escalate once to chapter-plan-reviser; on reviser/validation exhaustion, escalate to the `plan-assist` human gate (web) or throw `PipelineBailError` (auto-mode). The **quality-redraft gate** (2026-04-21, `src/lint/quality-detectors.ts` + `pipeline.qualityRedraftEnabled` flag, default OFF) adds a detect-then-redraft-from-scratch path: when repetition-loop or underlength defects are detected, the beat is regenerated with a blank context rather than a critique-based rewrite.

**Strategic goal:** semi-autonomous novel writing. Author shapes the plan; the harness drafts. **Offline-capable writing is NO LONGER a primary constraint** as of the 2026-04-21 pivot — the strategic writer is DeepSeek V4 Flash base via API (V3.2 → V4 Flash swap landed 2026-04-29). The offline-capability thesis ("run small fine-tuned models locally") is preserved as an option for checkers (narrow tasks, small-model POCs remain viable per decisions.md 2026-04-XX "Small-model checker POC") but is NOT load-bearing for the writer layer. Small-model checker POCs (Qwen3-1.7B, Qwen3-4B, Llama-3.2-3B) continue as cost/latency/learning exercises on narrow checker tasks, not as writer candidates.

**Route-specific leak detection is retired with writer LoRAs.** Do not add corpus-leak checkers unless a future runtime writer is again trained on a known corpus and the route explicitly carries that risk.

**Howard primer methodology retired 2026-04-16** because it tried to inject voice via prompts — voice transfers via weights, not few-shot. Similarly, do not ask checkers to add creative value or writers to enforce discipline; layer assignments are load-bearing.

## Deployment Model

Code lives locally (canonical git repo). LXC 307 is the runtime — all benchmarks, novel runs, and the orchestrator run there. Local machine is the editor; LXC is the executor.

- **Edit locally** → commit → `bash scripts/deploy-lxc.sh` (rsyncs to LXC)
- **Run on LXC** via `ssh novel-harness-lxc "cd ~/apps/novel-harness && bun ..."`
- **Single Postgres DB** on LXC — `novel_harness_orchestrator` stores ALL data (novel content, world state, experiments, LLM calls)
- **Results come back** via Postgres (SSH tunnel) or `bash scripts/sync-improvements.sh` (rsync prompts)

## Stack

- Runtime: Bun
- LLM: Configurable per-agent via `src/models/roles.ts`. Providers: Cerebras, Groq, Fireworks, OpenRouter, OpenAI, DeepSeek, MiniMax, Zai, MiMo, Together (legacy LoRA fine-tunes), W&B Inference (CoreWeave-backed, chosen home for new LoRA fine-tunes per `docs/lessons-learned.md`).
- DB: Single Postgres (`novel_harness_orchestrator` on LXC — all tables). pgvector installed but embeddings disabled.
- Fine-tuning: W&B/Together LoRA infrastructure remains for archived experiments and possible explicitly authorized future work, but no writer or checker LoRA is active in the base-writer runtime path. Runtime checker changes should default to deterministic guards plus bounded DeepSeek V4 Flash calls, not new SFT spend. W&B LoRA convention remains: artifact URI goes in the `model` field if an archived or explicitly authorized adapter is invoked.
- Transport: `src/transport.ts` — pluggable layer beneath all LLM calls (direct, batch). Per-call telemetry written to `llm_calls`.
- Interface: React UI (`/app`), CLI

## Architecture

State machine: concept → planning → drafting → validation → done

### Agents (live, with current model assignment)

Each agent's prompt/schema/context lives in `src/agents/{name}/`. The model assignment is in `src/models/roles.ts`.

- **Studio pre-planning** (optional, pre-concept): `planning-conversationalist` (**Groq Qwen3-32B**, guided 8-phase Q&A with sparsity detection) + `planning-extractor` (**DeepSeek V4 Flash**, one-shot transcript → `PlanningDirectives`). Directives embed in `SeedInput.directives` → `seed_json` and reach concept agents via `renderDirectivesForConcept()` and the planner via `renderDirectivesForPlanner()`. See `docs/decisions.md` "Pre-planning Director chat."
- **Concept** (`src/phases/concept.ts`): world-builder, character-agent, plotter — all on **DeepSeek V4 Flash** (V3.2 → V4 Flash swap landed 2026-04-29; non-thinking mode for these slots; Howard primer methodology retired 2026-04-16, see `docs/decisions.md`).
- **Planning** (`src/phases/planning.ts`): split into three calls. **Phase 1** `planning-plotter` emits chapter skeletons (title, POV, setting, purpose, targetWords, charactersPresent) — one call, ~2K output. **Phase 2a** `planning-beats` expands each chapter in parallel into beat shape only — scenes with beat descriptions, characters, kind, and soft structural annotations. **Phase 2b** `planning-state-mapper` maps `establishedFacts`, `knowledgeChanges`, `characterStateChanges`, `requiredPayoffs`, and writer-visible beat obligations onto the fixed beat list. The original split (2026-04-17) fixed single-call planner truncation and too-few beats; exp #289 (2026-05-01) split state/obligation placement out of beat expansion. `enforcePlanningOutput` enforces a per-chapter beat floor of `ceil(targetWords / 150)`, validates writer-visible state coverage, retries the mapper on coverage gaps, and keeps deterministic auto-repair only as final fallback. Planning agents use **DeepSeek V4 Flash**. `planning-plotter` and `planning-beats` run non-thinking; `planning-state-mapper` runs thinking mode because it reasons across a fixed beat list to place state/knowledge/payoff obligations. Decision rule for thinking-on slots is documented in `src/models/roles.ts` above the `deepseekV4Flash` constant.
- **Drafting** (`src/phases/drafting.ts`):
  - **beat-writer** is the primary writer path. **DeepSeek V4 Flash** default (non-thinking; no primer; V3.2 → V4 Flash swap landed 2026-04-29). All genres use this base route; fantasy structural priors affect planning only. Chapter-level `writer` only runs as fallback when beat generation fails N retries. Fallback discards abandoned partial beat prose and accepted beat-check blockers so stale beat findings cannot block the fallback draft.
  - **reference-resolver** (Llama 3.1 8B Groq) — pre-fetched in parallel for all beats before the serial writing loop.
  - **adherence-checker** — deterministic checks (char presence only) + **single bounded LLM call** (events+attribution) via `adherence-events` on **DeepSeek V4 Flash non-thinking**. Dialogue deterministic check removed — false positive for intentionally silent scenes; events LLM call covers this. Word-count gate removed 2026-04-16 because it was never load-bearing. Retries use **targeted rewrite** (existing prose + specific issues).
  - **chapter-plan-checker** — **DeepSeek V4 Flash base, thinking mode** (V3.2 → V4 Flash swap landed 2026-04-29; was DeepSeek V3.2 base swapped from W&B SFT adapter 2026-04-18). Focused on cross-beat properties only: setting coherence, emotional arc direction, major plot contradictions. The SFT adapter `chapter-plan-checker-v2:v1` was retired after a dual-oracle audit (Sonnet + Codex gpt-5.4) found ~92% false-positive rate on real fantasy plans despite validated 96% accuracy on exp #178 — distribution drift between training scenarios and production output. DeepSeek base handles the narrow 3-question check natively; thinking mode is on because the check requires reasoning across 14 beats with subtle cross-beat dependencies. Deviations are beat-indexed (schema: `{description, beat_index: number|null}`) and route to **beat-targeted rewrites** inside the chapter attempt (`pipeline.maxChapterPlanRewritePasses=2`). On exhaustion, escalates once per chapter to `chapter-plan-reviser`. SFT recalibration deferred to `docs/todo.md` low-priority.
  - **chapter-plan-reviser** — **DeepSeek V4 Flash base, thinking mode** (V3.2 → V4 Flash swap landed 2026-04-29; introduced 2026-04-19). Only invoked once per chapter when chapter-plan-checker's targeted-rewrite settle loop exhausts. Thinking mode is on because the reviser is producing the smallest plan-edit that resolves a multi-issue cluster — extended reasoning materially improves the diff quality. Takes original plan + current prose + persistent unresolved issues; returns the smallest beat-list edit that would make the issues satisfiable. Output matches `chapterBeatsSchema` so the revised plan drops straight into `outline.scenes`. Post-revision sanity checks reject plans below beat-count floor or with newly introduced characters. Accepted revisions persist to `chapter_outlines` via `saveChapterOutline()`. Telemetry logged to `chapter_revisions` (sql/028) with outcome enum: `accepted | rejected_beat_floor | rejected_new_characters | error | skip_already_revised | skip_duplicate_sig | skip_no_beat_state`.
  - **continuity** — 2 parallel decomposed agents (`continuity-facts` + `continuity-state`) on **DeepSeek V4 Flash non-thinking**. Called per chapter in `drafting.ts`; blocker findings route to plan-assist before approval. Previous-state location findings are warning-class because characters can move plausibly between chapters; knowledge impossibilities remain blocker-class.
  - **functional story-state checks** — deterministic payoff-link integrity in `src/phases/functional-checks.ts` plus bounded semantic planned-state grounding via `functional-state-checker` on DeepSeek V4 Flash non-thinking. Invalid graph links block; semantic grounding findings stay warning-class until oracle-calibrated.
  - **lint-fixer** — Cerebras Qwen 235B per-sentence rewrites. No agent dir; lint code lives in `src/lint/` and reads the model assignment via `getModelForAgent("lint-fixer")`.
  - **quality-redraft gate** (2026-04-21, `pipeline.qualityRedraftEnabled`, default OFF) — `src/lint/quality-detectors.ts` runs repetition-loop + underlength detectors per beat via `detectSyncDefects()`; on fire, drafting.ts regenerates the beat from blank context rather than issuing a critique-based rewrite. Retry-prompt construction (`buildRetryPrompt`) lives in `src/agents/writer/retry-context.ts` (extracted from drafting.ts 2026-04-21, commit `3c5313d`). **Per-novel scoping (2026-04-21):** enable via the `--quality-redraft` CLI flag or by setting `seed.pipelineOverrides.qualityRedraftEnabled = true`; drafting.ts reads the merged `effectivePipeline(novel.seed)` once per run. The previous `QUALITY_REDRAFT_ENABLED` env-var wiring was removed because it read at module-load time and could not be scoped per-novel under the orchestrator service.
- **Extraction** — LLM extractor subsystem (summary-extractor, fact-extractor, character-state, relationship-timeline, graph-linker) validated as noise (7 novels, 134 checks, 0 failures on plan-only — 2026-04-13). **Being removed.** `pipeline.extractionMode` is locked to `"plan"` — planner declared state is the sole world-state source. See `docs/decisions.md` "Plan-only extractionMode validated."
- **Validation** (`src/phases/validation.ts`): **diagnostic-only** (2026-04-17) — runs deterministic checks and logs issues but does NOT rewrite. Chapter-level rewriter agent removed; beat-writer retry in drafting is the quality gate. Tonal/voice LoRA generation is retired from runtime; historical tonal rows can still be displayed, but new `POST /api/novel/:id/tonal-pass` calls return `410 Gone`.

### Tools-only agent dirs (not in the runtime pipeline)

- `src/agents/lint-discoverer/` — used by `scripts/lint/lint-discover-lib.ts` for lint pattern research only
- `src/agents/lint-improver/` — used by the lint improvement tooling for prompt research only

These are NOT called via `callAgent` and are NOT in `src/models/roles.ts`. They read prompts directly from disk and use the `improver` model role. Don't add them to the agent registry — they're scripts that happen to live under `src/agents/`.

### Data Layer
- `src/db/` — per-table async Postgres modules (all functions return Promises via `Bun.sql`)
- `src/db/connection.ts` — shared lazy Postgres proxy, migration runner
- `src/db/ops.ts` — operational helpers: run management, experiment tracking, LLM call logging, lint seeding
- `src/harness/` — **service layer** — typed high-level API for all harness operations. The daemon, benchmarks, and UI call this instead of writing SQL. Modules: `scores`, `experiments`, `cycles`, `context`, `embeddings`, `graph`, `novels`.
- `sql/` — migration files (001-018)

### Beat-Level Context
Beat writing bypasses semantic retrieval. Context comes from the plan + deterministic DB lookups. Real per-call shape from `llm_calls`: avg ~9,800 input tokens (primer + context), ~391 output tokens, ~30s latency on DeepSeek V4 Flash (V3.2 → V4 Flash swap 2026-04-29; latency baselines may shift, re-measure after first end-to-end run). Primer is ~94% prefix-cached after beat 0.

**Beat context** (`src/agents/writer/beat-context.ts`):
- Beat spec (description, characters, POV, setting)
- Planner-authored beat obligations (must establish/pay off/transfer knowledge/show state change/not reveal + allowed new entities)
- Transition bridge (last 2-3 sentences of previous beat)
- Landing target (first sentence of next beat)
- Character snapshots (speech pattern, behavioral drivers [goals/avoids/internal conflict], emotional state, relationship to POV, doesn't-know constraints)
- Resolved references via `src/agents/writer/reference-resolver.ts` (deterministic + cheap LLM lookups, pre-fetched in parallel for all beats before the serial writing loop starts)
- Setting (only on beat 0 or detected location change)

**Planned state** (`src/planned-state.ts`):
- Planning-plotter outputs `establishedFacts`, `characterStateChanges`, `knowledgeChanges` per chapter
- Planning-beats also emits compact per-beat `obligations`; these are rendered to the writer as the local contract and are the intended future checker surface. `src/harness/beat-obligations.ts` measures writer-visible coverage and planning triggers one targeted re-expansion when facts/knowledge/state would otherwise be hidden from the writer.
- Saved to DB tables after chapter approval (`extractionMode: "plan"` — planner-declared state only, LLM extractors removed)

**Semantic retrieval** (`src/db/retrieval.ts`, `src/db/embed.ts`):
- Infrastructure exists but embeddings disabled (`pipeline.embeddings = false`)
- Used as fallback for chapter-level writing path only

### Knowledge Graph
Structured world systems, cultures, evolving relationships, timeline events, character knowledge — all in Postgres. Tables: `world_systems`, `cultures`, `character_cultures`, `character_system_awareness`, `relationship_states`, `timeline_events`, `character_knowledge`, `event_causes`, `knowledge_propagation`.

### Models
`src/models/roles.ts` is the single place to control all agent assignments. `src/models/registry.ts` has all available models with pricing/specs. Runtime overrides via web UI; `persistOverrides()` writes to roles.ts.

### Quality Checks
Quality measured via structured pass/fail checks, not LLM scoring (1-10 judges showed 0-33% discrimination — see `docs/lessons-learned.md`):
- **Adherence checker** — per-beat: deterministic (character presence only) + single bounded LLM call (events+attribution) on **DeepSeek V4 Flash non-thinking**. Events failure triggers targeted rewrite (prose + specific issues passed back to writer). Setting and tangent calls removed — zero production signal. Dialogue deterministic check removed — false positive for intentionally silent scenes. Word-count gate removed 2026-04-16.
- **Chapter plan checker** — per-chapter: **DeepSeek V4 Flash base, thinking mode** (V3.2 → V4 Flash swap landed 2026-04-29; was V3.2 base swapped from SFT 2026-04-18 after ~92% FP rate on real fantasy plans). Checks cross-beat properties: setting coherence, emotional arc direction, major plot contradictions. Emits beat-indexed deviations that route to targeted beat rewrites; escalates once per chapter to `chapter-plan-reviser` on rewrite-budget exhaustion. Telemetry via `chapter_revisions` table + `GET /api/novel/:id/revisions` + Studio `RevisionsPanel`.
- **Continuity checker** — per-chapter: 2 parallel DeepSeek V4 Flash non-thinking calls (facts + state) check against world state tables. Location drift from previous-character-state snapshots is visible telemetry but not a blocker unless later calibrated with stronger evidence.
- **Entity-grounding checker** — per-beat: `halluc-ungrounded` checks named entities against the writer-visible evidence surface on DeepSeek V4 Flash non-thinking. The Salvatore leak checker was removed with the writer-LoRA route.
- **Functional checks** — planner enforcement sanitizes invalid optional payoff scaffolding before drafting. Per-chapter deterministic payoff-link integrity still blocks invalid graph links that remain after enforcement (for example manually edited outlines), plus bounded planned-state grounding runs before approval/state persistence. Semantic findings are approval-visible warnings until calibrated for blocker use.
- **Lint** — deterministic (~26 patterns) + LLM fixes for cliché, hedging, emotional echo, rhythm. Lives in `src/lint/`.
- **Tonal pass** — runtime generation retired. Historical tonal rows may be displayed for comparison; no active agent invokes a tonal/voice LoRA.

Archived benchmarks (infrastructure kept): context quality, prose penalties, planning scores, extraction scores, pairwise comparison. The continuity benchmark and `cross-chapter-continuity` agent were removed in 2026-04 (the per-chapter `continuity` checker subsumes that role).

### Autonomous Improvement Loop — status 2026-04-21

**The old `Improvement Daemon` (`src/orchestrator/daemon-loop.ts` + `src/orchestrator/improve.ts`) has been deleted.** It predated the planner-split, beat-level context, voice-LoRA track, quality-redraft gate, and the decomposed-audit instrument — its knob space covered only the legacy retrieval/context-template/gen-config surfaces, which are now mostly inactive (`pipeline.embeddings=false`).

Replacement in progress on the `autonomous-harness-loop` branch. See:
- `docs/designs/autonomous-context-loop.md` — subsystem design (revision 2, Codex-reviewed)
- `docs/harness-optimization-inventory.md` — the full tunable-surface catalog (revision 2, Codex-amended)
- `scripts/autonomous-loop/` — driver scaffolding (skeleton, guarded off until Phase 0 prerequisites ship)

Forward-looking shape borrows Karpathy's autoresearch pattern: per-sub-loop target file, one-metric or Pareto-pair scoring, git-as-history, `program.md` for human strategy updates. Multi-proposer pool (Codex GPT-5.4 / Claude Opus / DeepSeek / Kimi) drives hypothesis proposal; deterministic Bun driver handles control flow + cost caps + kill-switch.

**`src/harness/registry.ts`** remains as a static catalog of legacy tunable surfaces (retrieval, context templates, deterministic causal weights, gen-config). It is NOT the autonomous-loop knob space — that lives in `docs/harness-optimization-inventory.md` and spans the four-tier sub-loop decomposition (concept / planning / writing / checker). The registry is kept for the UI's Config page but is not load-bearing for the new loop.

### Web UI
`ui/`, React + Vite, served at `/app`. Nav has 5 items — living pages are JSX with visuals; reference docs are markdown in the Docs browser:
- **The Studio** (`/app/studio`, default route) — home page. Compact creation bar (seed/custom toggle, genre dropdown, full-width premise textarea in custom mode) + novel picker popout (tile grid with genre, date, premise) + inline pipeline view (PipelineFlow, LiveMeters, narrative activity feed). Clear button resets local UI for new runs. Auto-scroll only during live writes; historical views start at top. Hydrates historical events from `/api/novel/:id/trace` on novel switch. SSE subscription for real-time updates during active writes. Elapsed timer freezes to actual run duration on completion.
- **Overview** (`/app/guide`) — project summary: what it does, architecture tree, novel creation flow, quality measurement, cost management.
- **Context Engineering** (`/app/context`) — visual context engineering page with SVG pipeline diagram, beat context assembly flow, deliberate omissions, state feedback loop tables.
- **Fine-Tuning** (`/app/finetune`) — SFT pipeline overview, LoRA style transfer narrative, deployed adapter table, plus tabs for adapter changelog and LoRA comparison tool.
- **Docs** (`/app/docs`) — reference document browser (drag-to-reorder sidebar, markdown rendering). All `docs/*.md` files served here.
- **Pipeline View** (`/app/:novelId`) — standalone real-time SSE timeline with gate panels (also accessible from Studio)
- **Read** (`/app/:novelId/read`) — rendered novel prose, linked from Studio/Pipeline. Historical tonal-pass rows can be viewed/diffed when they already exist, but new tonal generation is retired. Export dropdown supports `.md`/`.txt`/`.json`, with an approved-only variant.
- **Other pages** (accessible via URL, not in nav): Config, Experiments, Models, LLM Calls, Costs

Streaming infrastructure: `src/transport.ts` (DirectTransport emits `llm-call-start` / `llm-token` events), `src/trace.ts` (persists pipeline events to `pipeline_events` table). Historical hydration via `traceToSSE` conversion from DB rows to SSE event format.

**MAJOR UI REQUIREMENT — no forever-streaming rows.** An activity row must never remain in a `running`/"streaming…" state after the pipeline has advanced past it. Completion events can be lost (transport crash, SSE reconnect, retry). The Studio activity feed MUST reconcile orphans: when a new `llm-call-start` arrives for the same `(agent, chapter, beatIndex)` tuple, any prior `running` row with that tuple is marked `stale`; on `phase-change` / `phase-complete`, ALL remaining `running` rows are marked `stale` and the active-agent set is cleared. Stale rows render as a dimmed "orphaned" chip so the user knows what happened instead of seeing a spinner that never resolves. See `StudioPage.tsx` `llm-call-start` and `phase-change` event handlers.

### Gate Abstraction
`src/gates.ts`, `src/events.ts` — decouples approval gates from stdin. SSE event bus pushes real-time updates. Modes: CLI readline, web API POST, auto-approve.

## DB Queries

**Never guess column names.** Before writing any ad-hoc SQL (bun -e, scripts, debugging), query `information_schema.columns` for the table first. The schema evolves via migrations and column names don't always match what you'd expect (e.g. `seed_json` not `seed`, `profile_json` not `role`, `attempt` not `run_number`).

**Public vs archive schema (2026-04-16):** Pre-2026-04-15 telemetry and all 70 test-era novels live in `archive.*` (`archive.novels`, `archive.llm_calls`, `archive.pipeline_events`, etc.). `public.*` contains only current-pipeline data — queries for "what is the current pipeline producing" should stay in public. For historical analysis explicitly query `archive.*`. See `docs/decisions.md` 2026-04-16 entries "Pre-2026-04-15 telemetry and state archived" + "All 70 existing novels archived."

**Eval infrastructure (2026-04-16):** Phase C.3-style evals persist to `eval_briefs` + `eval_results` tables. Cell-level leaderboard via `eval_cell_summary` view; full lineage via `eval_full_provenance` view. CLI: `bun scripts/finetune/provenance-report.ts --adapter <name>`. See `docs/eval-infrastructure.md`.

## Repo Layout Discipline

The root directory contains only: `src/`, `scripts/`, `ui/`, `tests/`, `docs/`, `sql/`, and config files (`package.json`, `tsconfig.json`, `.env.example`, `CLAUDE.md`, `README.md`). Everything else is either generated/runtime (gitignored) or belongs inside one of these.

**`src/` is the only home for application code.** If you find yourself creating a root-level directory for TypeScript/Python code, move it into `src/`. The current structure:
```
src/
  agents/     ← one dir per agent, each with index.ts + context.ts + schema.ts + prompt files
  config/     ← pipeline config, pricing, run config
  db/         ← per-table Postgres modules + connection.ts + ops.ts
  harness/    ← service layer (high-level API used by daemon, UI, scripts)
  lint/       ← lint detectors, fixers, concepts
  models/     ← model registry (registry.ts) and role assignments (roles.ts)
  orchestrator/ ← HTTP server and route handlers
  phases/     ← concept.ts, planning.ts, drafting.ts, validation.ts
  schemas/    ← shared Zod schemas
  seeds/      ← JSON novel seeds (38 files)
```

**When removing a subsystem, audit reverse dependencies before deleting.** Run `grep -r "the-path" src/ scripts/` first. Leaving broken imports is worse than leaving dead code.

**Keep README.md current.** Update it in the same commit as any architectural change — not in a later cleanup pass. If the README describes a removed feature, it actively misleads.

**Gitignore generated output.** Runtime artifacts (`output/`, `scripts/lora-data/`, `data/batches/`, `wandb/`, `finetune-data/`) are already in `.gitignore`. Don't commit generated files.

## Rules

1. **Every tracked work item goes in the DB.** Use `harness.experiments.createTuningExperiment(type, ...)` + `concludeExperiment()`. Prefer canonical `TrackedWorkType` values (see `src/db/ops.ts`); default to `'ticket'` for standard engineering work. `'charter'` is reserved for multi-commit architectural efforts with multiple Codex review rounds. Never delete experiments.
2. **Every benchmark run links to an experiment** via `EXPERIMENT_ID=N`.
3. **All results persist to the DB.** Never write scripts that only output to stdout.
4. **Use the service layer.** Data access goes through `src/harness/` — no inline SQL in daemon, benchmarks, or UI code.
5. **One change per commit.** See `docs/commit-conventions.md`.
6. **Deploy after commit when changes are runtime-affecting.** Run `bash scripts/deploy-lxc.sh` whenever a commit touches code/config the LXC runtime executes. The LXC runs the orchestrator + every benchmark + every novel; uncommitted-or-undeployed changes mean LXC is still running stale code and any "result" from there is invalid. **Required-rsync stages** (deploy MUST happen before any benchmark/novel run that depends on the change): `src/models/roles.ts` (model role assignments), `src/models/registry.ts` (model registry entries — pricing, thinking, contextWindow), `src/agents/**` (any prompt edit, schema edit, context-builder change), `sql/**` (schema migrations — also need to apply on LXC), `src/config/pipeline.ts` (pipeline-flag changes), `src/phases/**` (phase logic), `src/llm.ts` / `src/transport.ts` (call-shape changes), `src/lint/**` (active lint rules + quality detectors). Doc-only commits and local-only scripts (`scripts/phase-eval/**` parents, `scripts/variant/**`) do NOT require deploy unless their child entry points run on LXC. When unsure, deploy — `rsync` is cheap, stale-LXC bug-hunts are not.
7. **Every experiment links to a git commit.** Commit changes BEFORE running experiments.
8. **Use `nohup` for long-running LXC scripts.** Never pipe SSH output through `head` or filters that close the pipe — it sends SIGPIPE and kills the process. Use `nohup ... > /tmp/foo.log 2>&1 &` and check progress via `tail`.
9. **Never deploy while data generation is running.** `deploy-lxc.sh` uses `rsync --delete`, which deletes any LXC file that doesn't exist locally — including in-progress `scripts/lora-data/` output. The script now checks for active generation processes and prompts before continuing. `scripts/lora-data/` is also excluded from rsync so generated datasets are never overwritten.
10. **Default to parallel Sonnet subagents for implementation.** When work can be decomposed into independent chunks (disjoint files, or worktree-isolatable), spawn MULTIPLE `Agent` subagents (Sonnet) in a single message so they run concurrently. Single-subagent hand-offs are a missed speed lever. Codex review runs ONCE on the aggregated commits at the end, not per-subagent.
11. **Spawn a documentation subagent after meaningful work.** After a PR-sized chunk lands (one big commit or a series), launch a Sonnet subagent to update `docs/current-state.md` + append to `docs/lessons-learned.md` + refresh `docs/todo.md`. Runs in parallel with the next implementation chunk. Keeps the human oriented without re-reading commits. Skip only for trivial changes.
12. **Write session retrospectives to `docs/sessions/` at end-of-session.** Any session with multiple architectural iterations, Codex reviews, or supersession chains gets a git-committed retrospective at `docs/sessions/YYYY-MM-DD-{slug}.md` following `docs/sessions/TEMPLATE.md`. Captures supersession chains (initial → problem → fix with commit SHAs), Codex back-and-forths, class-of-bug patterns, process observations. If a pattern recurs across 2+ sessions, elevate to `docs/patterns/{slug}.md` with back-links. See `docs/sessions/README.md` for the full workflow.
13. **Commits are pre-authorized — do not ask before committing.** Standing authorization to land work as commits when a coherent unit is complete (passing checks where applicable, one concern per commit per `docs/commit-conventions.md`, no secrets). This OVERRIDES the default "only commit when requested" behavior. Still ask before: (a) `git push` to a remote, (b) destructive ops (`reset --hard`, force-push, branch deletion, `git clean -f`), (c) committing files that look sensitive (.env, credentials, large binaries). Use atomic commits — one concern per commit, separate code from docs unless they're co-load-bearing for a single change.
14. **Capture lessons learned at the moment of methodology surprise — do not defer.** Any session that produces a methodology surprise, calibration finding, process correction, or generalizable insight gets a `docs/lessons-learned.md` entry IN THE SAME COMMIT as the work or in a follow-up doc commit before session-end. The lesson takes the form "when X, then Y" — the generalized rule, not the specific finding. Specific findings live in their conclusions docs and JSON artifacts; lessons compound across sessions and feed future-Claude. **Trigger surface (any one fires the rule):** (a) LLM probe returns surprising prevalence numbers (especially low-prevalence DIVERGE/KILL on multi-axis dims — see lessons-learned 2026-04-30 P26 entry); (b) calibration check passes or fails unexpectedly; (c) methodology hop (point-estimate → directional re-score, single-axis → compositional follow-up, scene → beat granularity rotation); (d) tool/library/API gotcha that cost > 10 minutes to diagnose; (e) "we already had this lesson encoded somewhere but missed it" moment. Recurring patterns (2+ sessions) elevate to `docs/patterns/{slug}.md` per Rule 12. This rule is NOT subsumed by Rule 11 (the documentation subagent is for end-of-PR triage; lessons capture is per-trigger and fires in-session).
15. **Findings must land in tracked documentation, not just chat.** When measurement work, experiments, or analysis produce findings — even one-off ones — those findings MUST be captured in the appropriate persistent doc (`docs/harness-tuning-roadmap.md` for corpus / variant / pattern measurements, `docs/decisions.md` for concluded design choices, `docs/todo.md` for action items, `docs/current-state.md` for live-system updates, the per-corpus `conclusions.md` for analysis sessions). Chat summaries DIE — the next session won't see them. **The cadence is per-finding, not per-session-end.** A subagent landing 3 patterns in a row produces 3 roadmap rows, not a single end-of-session sweep. The verbatim summary you'd put in chat is approximately what should land in the doc — terse, with cross-references to the JSON artifact and commit hash. **Trigger surface:** (a) any subagent reports findings, (b) any LLM probe / calibration / experiment lands a verdict, (c) any cross-pattern synthesis emerges, (d) any verdict on a tracked work item changes (DRAFT → PASS / DIVERGE / NEG), (e) any "I just told the user X but didn't write it anywhere" moment. **The fix is in the same commit as the work, not in a later cleanup pass** — separate doc commit is fine if scope-clean, but never deferred to next session. This rule is the structural counterpart to Rule 14: Rule 14 captures generalized *lessons*; Rule 15 captures specific *findings*. Both must land in tracked docs in-session.

## Running

```bash
# Deploy code to LXC
bash scripts/deploy-lxc.sh

# Novel creation (on LXC)
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun src/index.ts --auto --seed romance-drama"

# Orchestrator (systemd service)
ssh novel-harness-lxc "sudo systemctl status novel-harness-orchestrator"
```

## Key env vars

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Postgres connection (fallback: ORCHESTRATOR_DB_URL) |
| `OPENROUTER_API_KEY` | Embeddings + LLM calls via OpenRouter |
| `BENCHMARK_SEEDS` | Filter to specific seeds (comma-separated) |
| `BENCHMARK_RUNS` | Runs per seed (default 2-3) |
| `EXPERIMENT_ID` | Link benchmark run to experiment |
| `LLM_TRANSPORT` | `direct` (default) or `batch` |

## LXC 307

- **IP**: 192.168.1.108 (LAN), 100.115.80.77 (Tailscale)
- **SSH**: `novel-harness-lxc` (ProxyJump proxmox)
- **Services**: `novel-harness-orchestrator` (port 3006), `ntfy` (port 2586)
- **Postgres**: `novel_harness_orchestrator` DB with pgvector extension
- **Deploy**: `bash scripts/deploy-lxc.sh` (rsync + restart)
- **PATH**: `~/.bashrc` on the LXC has the bun export moved ABOVE the interactive guard so `ssh novel-harness-lxc "bun ..."` works without full path. If the LXC is rebuilt, do `sed` the bun export to the top of `.bashrc` again, otherwise non-interactive SSH will fail with "bun: No such file or directory".
- **Web UI**: `http://novel-harness:3006/app?key=<ORCHESTRATOR_API_KEY>`

## Sources of Truth

| What | Where |
|------|-------|
| Architecture + pipeline flow | `/app/guide` (Overview) + `/app/context` (Context Engineering) |
| Knowledge graph + context assembly | `docs/world-knowledge-graph.md` |
| DB schema | `sql/010_novel_data.sql`, `sql/011_vector_graph.sql`, `sql/012-015_*.sql` |
| Agent model assignments | `src/models/roles.ts` |
| Service layer API | `src/harness/index.ts` |
| Retrieval engine | `src/db/retrieval.ts` |
| Fine-tuning strategy + adapter roadmap | `/app/finetune` (UI) + `docs/fine-tuning-strategy.md` |
| LoRA training best practices + experiment log | `docs/lora-style-transfer-report.md` |
| Architectural decisions with rationale | `docs/decisions.md` |
| Writer quality oracle (measurement layer) | `docs/writer-imitation-benchmark.md` |
| Writer methodology design space (method layer) | `docs/writer-style-imitation-design-space.md` |
| Corpus ingestion (PDF/EPUB → canonical text) | `docs/corpus-ingestion.md` + `scripts/finetune/ingest-corpus.py` |
| Eval infrastructure (eval_briefs / eval_results / provenance) | `docs/eval-infrastructure.md` + `sql/024-025_*.sql` |
| Corpus pipeline (novel decomposition → training bundles) | `docs/corpus-pipeline.md` + `novels/<key>/` bundles + `scripts/corpus/run.ts` |

## Reference docs

- `docs/todo.md` — **living to-do** — pending action items only
- `docs/decisions.md` — **architectural decisions with rationale** — append-only record of what was decided and why
- `docs/lessons-learned.md` — **read before designing agents, rubrics, or experiments**
- `docs/harness-tuning-roadmap.md` — **single-page evaluation matrix** — corpus pattern → harness target → variant → phase-eval probe → cross-book validation → ship/hold/pivot. Living doc; tracks what's queued, what's running, what shipped. Update each row as variants move through the pipeline.
- `docs/invariants.md` — **canonical invariants registry** — structural-property checks that run as blocking preflight gates. 4 shapes (syntactic / runtime / cross-state / LLM-check). Shift-left layer between tests and Codex review.
- `.claude/skills/implement-ticket.md` — **canonical workflow** — 13-phase Claude+Codex orchestration pattern. Source of truth for Phase -1 through Phase 12 + 9 exit triggers + 7 telemetry fields. See `/app/workflow` for the rendered dashboard.
- `docs/workflow-portable.md` — genericized version of the skill doc for drop-in use in other projects
- `docs/commit-conventions.md` — commit message format
- `docs/world-knowledge-graph.md` — knowledge graph, context assembly, retrieval parameters
- `docs/writer-imitation-benchmark.md` — Salvatore Crystal Shard deconstruction plan; 6-stage pipeline; 10 methodologies × 4 metrics scored against real published prose
- `docs/writer-style-imitation-design-space.md` — companion method layer: 7 architectural layers × 10 end-to-end harness recipes
- `docs/corpus-ingestion.md` — repeatable PDF/EPUB → canonical-text procedure for any new training corpus
- `docs/corpus-pipeline.md` — **canonical architecture** for decomposing proven novels into training bundles. 5-stage pipeline (ingest → scenes → beats → briefs → analysis), bundle format at `novels/<key>/`, 14 conservation invariants, `verify-pipeline.py` audits end-to-end. Salvatore bundle is the reference implementation (2,470 training pairs, all invariants pass).
- `../archives/novel-harness/` — completed research docs + archived scripts/agents (outside repo) — lint pattern research, extractor agents, one-off eval scripts

## Decision Recording SOP

When an experiment concludes, a design choice is made, or a path is ruled out:

1. **Add an entry to `docs/decisions.md`** — decision, why, alternatives rejected, ongoing implications. Use the experiment ID and date.
2. **Remove the rationale from `docs/todo.md`** — todo.md is for pending action items only. Completed items and decision history do not belong there.
3. **Record the experiment in the DB** — `createTuningExperiment()` + `concludeExperiment()` per the existing SOP.
4. **Commit docs separately** from code changes (see `docs/commit-conventions.md`).
