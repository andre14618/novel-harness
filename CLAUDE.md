# Novel Harness

AI-assisted novel creation harness — deterministic code controls flow, LLMs are leaf-node function calls. Supports short stories (3 chapters) for rapid iteration and full-length novels (20-30 chapters). Beat-first architecture: planning outputs world state, writing is per-beat with adherence checking, quality measured via structured pass/fail checks.

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
- Fine-tuning: **W&B end-to-end (train + serve) on `OpenPipe/Qwen3-14B-Instruct` is the chosen home for new LoRA fine-tunes** (decided 2026-04-07/08 via `tuning_experiment` id=94 — see `docs/decisions.md` "W&B Inference on OpenPipe/Qwen3-14B-Instruct"). Training via **W&B Serverless SFT (ART framework — now metered pay-as-you-go, $500/month cap; actual burn ~$3.76/month as of 2026-04-16 across all active adapters + voice LoRAs, still functionally cheap)** → adapter auto-saved as W&B artifact → served via W&B Inference at $0.05/$0.22 per 1M tokens. W&B free tier is 5 GB storage (pay-as-you-go plan). Each training run creates ~3.7 GB of intermediate artifacts; `train-lora.py` auto-cleans after training (strips aliases then deletes). Run `python3 scripts/finetune/cleanup-wandb-storage.py --delete` for manual cleanup. A r=16 adapter is ~134 MB. **W&B LoRA convention: artifact URI goes in the `model` field** (e.g. `model: "wandb-artifact:///team/project/name:v9"`). W&B silently ignores a separate `lora` field — that convention is Together AI only. Transport layer (`src/transport.ts`) auto-detects `wandb-artifact:///` prefix and routes correctly. **Howard primer/tonal-pass methodology RETIRED 2026-04-16** (see `docs/decisions.md` "Howard methodology deprecated"). Voice now lands via per-genre voice LoRAs (`WRITER_GENRE_PACKS` in `src/models/roles.ts`) at generation time. The V4 Howard tonal-pass adapter (`wandb-artifact:///andre14618-/novel-harness/howard-tonal-v4-sft-resume:v8`) is retained on W&B Inference for the on-demand `POST /api/novel/:id/tonal-pass` endpoint on existing novels only. Not invoked automatically. **Together standard tier is ~50-100× slower than Groq fast tier per `docs/lessons-learned.md` — no new adapters go to Together.** **Salvatore voice LoRA lineage** — first voice-imprinting adapter family trained on a single author corpus (Icewind Dale Trilogy, 777 beat-brief→prose pairs). **v3 is current** (exp #196): harness-shaped user prompts + 3-variant rename augmentation + retry-shape training (addresses v2 probe failure from exp #195 on prompt-shape mismatch). Serving URI: `wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v3`. Phase C.3 clean-val Δ-sum 0.447, max 5-gram Jaccard 0.023 (normal generalization). v4 (1-epoch, exp #197) and v5 (no rename aug, exp #198) training in parallel to test overfit hypotheses. Routing via `WRITER_GENRE_PACKS` in `src/models/roles.ts` (fantasy genres → voice LoRA; other genres → DeepSeek, no primer by default). See `docs/voice-lora-salvatore.md`.
- Transport: `src/transport.ts` — pluggable layer beneath all LLM calls (direct, batch). Per-call telemetry written to `llm_calls`.
- Interface: React UI (`/app`), CLI

## Architecture

State machine: concept → planning → drafting → validation → done

### Agents (live, with current model assignment)

Each agent's prompt/schema/context lives in `src/agents/{name}/`. The model assignment is in `src/models/roles.ts`.

- **Studio pre-planning** (optional, pre-concept): `planning-conversationalist` (**Groq Qwen3-32B**, guided 8-phase Q&A with sparsity detection) + `planning-extractor` (**DeepSeek V3.2**, one-shot transcript → `PlanningDirectives`). Directives embed in `SeedInput.directives` → `seed_json` and reach concept agents via `renderDirectivesForConcept()` and the planner via `renderDirectivesForPlanner()`. See `docs/decisions.md` "Pre-planning Director chat."
- **Concept** (`src/phases/concept.ts`): world-builder, character-agent, plotter — all on **DeepSeek V3.2** (promoted 2026-04-15c; Howard primer methodology retired 2026-04-16, see `docs/decisions.md`).
- **Planning** (`src/phases/planning.ts`): two-phase. **Phase 1** `planning-plotter` emits chapter skeletons (title, POV, setting, purpose, targetWords, charactersPresent) — one call, ~2K output. **Phase 2** `planning-beats` expands each chapter in parallel into scenes + establishedFacts + characterStateChanges + knowledgeChanges — N parallel calls, ~4K each. Split 2026-04-17: single-call planner was hitting DeepSeek's 8K output ceiling on 10-chapter novels and producing 3–4 beats per chapter when Salvatore's training data averages 14 beats/chapter at ~100w/beat. `enforcePlanningOutput` now enforces a per-chapter beat floor of `ceil(targetWords / 150)` with targeted re-expansion on miss. Both phases on **DeepSeek V3.2**.
- **Drafting** (`src/phases/drafting.ts`):
  - **beat-writer** is the primary writer path. **DeepSeek V3.2** default (no primer; Howard retired 2026-04-16). Fantasy-genre seeds route to Salvatore voice LoRA via `WRITER_GENRE_PACKS`. Per-beat shape (voice-LoRA route): ~1,500 in / 290 out. Per-beat shape (DeepSeek route, no primer): varies by beat complexity. Chapter-level `writer` only runs as fallback when beat generation fails N retries.
  - **reference-resolver** (Llama 3.1 8B Groq) — pre-fetched in parallel for all beats before the serial writing loop.
  - **adherence-checker** — deterministic checks (char presence only) + **single LLM call** (events+attribution) via `adherence-events` agent on **W&B `adherence-checker-v4`** (Qwen3-14B SFT, 2,134 Sonnet-labeled examples, exp #161). Was 4 parallel calls; character merged into events, setting/tangent removed (0–4.3% fire rates, planner-level bugs). Dialogue deterministic check removed — false positive for intentionally silent scenes; events LLM call covers this. **Word-count gate removed 2026-04-16** — voice LoRAs drift on word count and metric was never load-bearing. Retries use **targeted rewrite** (existing prose + specific issues). See `docs/retry-surface-audit.md`.
  - **chapter-plan-checker** — **W&B `chapter-plan-checker-v2:v1`** (Qwen3-14B SFT, Sonnet-labeled). Focused on cross-beat properties only: setting coherence, emotional arc direction, major plot contradictions. 96% accuracy vs Sonnet ground truth, 609ms latency. Serving URI: `wandb-artifact:///andre14618-/novel-harness/chapter-plan-checker-v2:v1`. Validated exp #178, 2026-04-12.
  - **continuity** — **W&B `continuity-v2:v1`** (Qwen3-14B SFT, 253 Sonnet-labeled pairs from 39 scenarios). 2 parallel decomposed agents (`continuity-facts` + `continuity-state`). Highest prompt-token cost in the pipeline (~7,300 in/call). Swapped from Cerebras 235B 2026-04-12 — pending production validation.
  - **lint-fixer** — Cerebras Qwen 235B per-sentence rewrites. No agent dir; lint code lives in `src/lint/` and reads the model assignment via `getModelForAgent("lint-fixer")`.
- **Extraction** — LLM extractor subsystem (summary-extractor, fact-extractor, character-state, relationship-timeline, graph-linker) validated as noise (7 novels, 134 checks, 0 failures on plan-only — 2026-04-13). **Being removed.** `pipeline.extractionMode` is locked to `"plan"` — planner declared state is the sole world-state source. See `docs/decisions.md` "Plan-only extractionMode validated."
- **Validation** (`src/phases/validation.ts`): **diagnostic-only** (2026-04-17) — runs deterministic checks and logs issues but does NOT rewrite. Chapter-level rewriter agent removed; beat-writer retry in drafting is the quality gate. **tonal-pass auto-run disabled** — voice lands at generation time via per-genre voice LoRAs. On-demand `POST /api/novel/:id/tonal-pass` still works for existing novels.

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
Beat writing bypasses semantic retrieval. Context comes from the plan + deterministic DB lookups. Real per-call shape from `llm_calls`: avg ~9,800 input tokens (primer + context), ~391 output tokens, ~30s latency on DeepSeek V3.2. Primer is ~94% prefix-cached after beat 0.

**Beat context** (`src/agents/writer/beat-context.ts`):
- Beat spec (description, characters, POV, setting)
- Transition bridge (last 2-3 sentences of previous beat)
- Landing target (first sentence of next beat)
- Character snapshots (speech pattern, behavioral drivers [goals/avoids/internal conflict], emotional state, relationship to POV, doesn't-know constraints)
- Resolved references via `src/agents/writer/reference-resolver.ts` (deterministic + cheap LLM lookups, pre-fetched in parallel for all beats before the serial writing loop starts)
- Setting (only on beat 0 or detected location change)

**Planned state** (`src/planned-state.ts`):
- Planning-plotter outputs `establishedFacts`, `characterStateChanges`, `knowledgeChanges` per chapter
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
- **Adherence checker** — per-beat: deterministic (character presence, word count) + single LLM call (events+attribution) on **W&B Qwen3-14B-Instruct**. Events failure triggers targeted rewrite (prose + specific issues passed back to writer). Setting and tangent calls removed — zero production signal. Dialogue deterministic check removed — false positive for intentionally silent scenes. See `docs/retry-surface-audit.md`.
- **Chapter plan checker** — per-chapter: W&B `chapter-plan-checker-v2:v1` (Qwen3-14B SFT adapter) checks cross-beat properties: setting coherence, emotional arc direction, major plot contradictions. 96% accuracy vs Sonnet ground truth, 609ms avg. `beats_covered` and `characters_present` removed (redundant with beat-level adherence). Has a strict false-positive ruleset (paraphrased dialogue, reordered details, atmospheric additions are NOT deviations).
- **Continuity checker** — per-chapter: **W&B `continuity-v2:v1`** (Qwen3-14B SFT) — 2 parallel decomposed calls (facts + state) check against world state tables. Largest prompt-token cost in the pipeline by an order of magnitude. Swapped from Cerebras 235B 2026-04-12.
- **Lint** — deterministic (~26 patterns) + LLM fixes for cliché, hedging, emotional echo, rhythm. Lives in `src/lint/`.
- **Tonal pass** — **auto-run disabled.** Howard methodology retired 2026-04-16 — voice now lands at generation time via per-genre voice LoRAs (e.g., `salvatore-1988-v3` for fantasy seeds, routed through `WRITER_GENRE_PACKS`). On-demand only: `POST /api/novel/:id/tonal-pass` still invokes the V4 Howard adapter on existing novels for comparison. Adapter retained on W&B Inference. See `docs/decisions.md` "Howard methodology deprecated."

Archived benchmarks (infrastructure kept): context quality, prose penalties, planning scores, extraction scores, pairwise comparison. The continuity benchmark and `cross-chapter-continuity` agent were removed in 2026-04 (the per-chapter `continuity` checker subsumes that role).

### Improvement Daemon
`src/orchestrator/daemon-loop.ts` — autonomous improvement loop:
1. Diagnose weakest dimension (`src/harness/scores.ts`)
2. Build improver context (`src/orchestrator/improve.ts` → `src/harness/`)
3. Propose change via LLM (improver agent)
4. Benchmark → evaluate → keep/revert
5. Synthesize conclusion for future cycles

All daemon data access goes through `src/harness/` service layer. No inline SQL in daemon code.

**Optimization surfaces** (in `src/harness/registry.ts`):
- Agent prompts for the live agents (concept, planning, writing, checking)
- 6 deterministic causal parameters (`deterministic_config` table)
- 6 context format templates (`context_templates` table — per-item rendering formats)
- 8 generation parameters (`agent_generation_config` table — temperature/maxTokens per agent)
- Model assignments (visible in registry, not daemon-tunable)

The daemon rotates between prompt, config, and template proposals per iteration, using the component registry to discover surfaces per quality dimension.

### Web UI
`ui/`, React + Vite, served at `/app`. Nav has 5 items — living pages are JSX with visuals; reference docs are markdown in the Docs browser:
- **The Studio** (`/app/studio`, default route) — home page. Compact creation bar (seed/custom toggle, genre dropdown, full-width premise textarea in custom mode) + novel picker popout (tile grid with genre, date, premise) + inline pipeline view (PipelineFlow, LiveMeters, narrative activity feed). Clear button resets local UI for new runs. Auto-scroll only during live writes; historical views start at top. Hydrates historical events from `/api/novel/:id/trace` on novel switch. SSE subscription for real-time updates during active writes. Elapsed timer freezes to actual run duration on completion.
- **Overview** (`/app/guide`) — project summary: what it does, architecture tree, novel creation flow, quality measurement, cost management.
- **Context Engineering** (`/app/context`) — visual context engineering page with SVG pipeline diagram, beat context assembly flow, deliberate omissions, state feedback loop tables.
- **Fine-Tuning** (`/app/finetune`) — SFT pipeline overview, LoRA style transfer narrative, deployed adapter table, plus tabs for adapter changelog and LoRA comparison tool.
- **Docs** (`/app/docs`) — reference document browser (drag-to-reorder sidebar, markdown rendering). All `docs/*.md` files served here.
- **Pipeline View** (`/app/:novelId`) — standalone real-time SSE timeline with gate panels (also accessible from Studio)
- **Read** (`/app/:novelId/read`) — rendered novel prose, linked from Studio/Pipeline. Sidebar has tonal-pass controls (Original / Tonal / Diff toggle + "Run Tonal Pass" button) when tonal-pass versions exist; Diff view highlights changed paragraphs (removed in red, added in green) aligned by paragraph index. Export dropdown supports `.md`/`.txt`/`.json`, with an approved-only variant.
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

1. **Every experiment goes in the DB.** Use `harness.experiments.createTuningExperiment()` + `concludeExperiment()`. Never delete experiments.
2. **Every benchmark run links to an experiment** via `EXPERIMENT_ID=N`.
3. **All results persist to the DB.** Never write scripts that only output to stdout.
4. **Use the service layer.** Data access goes through `src/harness/` — no inline SQL in daemon, benchmarks, or UI code.
5. **One change per commit.** See `docs/commit-conventions.md`.
6. **Deploy after commit.** Run `bash scripts/deploy-lxc.sh`.
7. **Every experiment links to a git commit.** Commit changes BEFORE running experiments.
8. **Use `nohup` for long-running LXC scripts.** Never pipe SSH output through `head` or filters that close the pipe — it sends SIGPIPE and kills the process. Use `nohup ... > /tmp/foo.log 2>&1 &` and check progress via `tail`.
9. **Never deploy while data generation is running.** `deploy-lxc.sh` uses `rsync --delete`, which deletes any LXC file that doesn't exist locally — including in-progress `scripts/lora-data/` output. The script now checks for active generation processes and prompts before continuing. `scripts/lora-data/` is also excluded from rsync so generated datasets are never overwritten.

## Running

```bash
# Deploy code to LXC
bash scripts/deploy-lxc.sh

# Novel creation (on LXC)
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun src/index.ts --auto --seed romance-drama"

# Orchestrator (systemd service)
ssh novel-harness-lxc "sudo systemctl status novel-harness-orchestrator"

# Improvement daemon
ssh novel-harness-lxc "curl -s -X POST http://localhost:3006/api/improvement/start -H 'x-api-key: <key>'"
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

## Reference docs

- `docs/todo.md` — **living to-do** — pending action items only
- `docs/decisions.md` — **architectural decisions with rationale** — append-only record of what was decided and why
- `docs/lessons-learned.md` — **read before designing agents, rubrics, or experiments**
- `docs/commit-conventions.md` — commit message format
- `docs/world-knowledge-graph.md` — knowledge graph, context assembly, retrieval parameters
- `docs/writer-imitation-benchmark.md` — Salvatore Crystal Shard deconstruction plan; 6-stage pipeline; 10 methodologies × 4 metrics scored against real published prose
- `docs/writer-style-imitation-design-space.md` — companion method layer: 7 architectural layers × 10 end-to-end harness recipes
- `docs/corpus-ingestion.md` — repeatable PDF/EPUB → canonical-text procedure for any new training corpus
- `../archives/novel-harness/` — completed research docs + archived scripts/agents (outside repo) — lint pattern research, extractor agents, one-off eval scripts

## Decision Recording SOP

When an experiment concludes, a design choice is made, or a path is ruled out:

1. **Add an entry to `docs/decisions.md`** — decision, why, alternatives rejected, ongoing implications. Use the experiment ID and date.
2. **Remove the rationale from `docs/todo.md`** — todo.md is for pending action items only. Completed items and decision history do not belong there.
3. **Record the experiment in the DB** — `createTuningExperiment()` + `concludeExperiment()` per the existing SOP.
4. **Commit docs separately** from code changes (see `docs/commit-conventions.md`).
