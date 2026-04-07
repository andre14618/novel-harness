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
- LLM: Configurable per-agent via `models/roles.ts`. Providers: Cerebras, Groq, OpenRouter, OpenAI, DeepSeek, Together (fine-tunes).
- DB: Single Postgres (`novel_harness_orchestrator` on LXC — all tables). pgvector installed but embeddings disabled.
- Fine-tuning: Together AI LoRA on Qwen 3.5 9B ($0.10/$0.15 inference). Tonal pass deployed, other adapters planned.
- Transport: `src/transport.ts` — pluggable layer beneath all LLM calls (direct, batch)
- Interface: React UI (`/app`), CLI

## Architecture

State machine: concept → planning → drafting → validation → done

### Agents
Each in `src/agents/{name}/` with prompt.md, schema.ts, context.ts:
- **Concept**: world-builder, character-agent, plotter
- **Planning**: planning-plotter (outputs beats + world state updates)
- **Drafting**: beat-writer, reference-resolver, adherence-checker, **chapter-plan-checker**, continuity, lint-fixer
- **Extraction** (configurable via `pipeline.extractionMode`): summary-extractor, fact-extractor, character-state, relationship-timeline, graph-linker
- **Validation**: rewriter, tonal-pass

### Data Layer
- `src/db/` — per-table async Postgres modules (all functions return Promises via `Bun.sql`)
- `src/harness/` — **service layer** — typed high-level API for all harness operations. The daemon, benchmarks, and UI call this instead of writing SQL. Modules: `scores`, `experiments`, `cycles`, `context`, `embeddings`, `graph`, `novels`.
- `data/connection.ts` — shared lazy Postgres proxy, migration runner
- `sql/` — migration files (001-011)

### Beat-Level Context
Beat writing bypasses semantic retrieval. Context comes from the plan + deterministic DB lookups (~500-1K tokens per beat vs ~8.5K for chapter-level).

**Beat context** (`src/agents/writer/beat-context.ts`):
- Beat spec (description, characters, emotional shift)
- Transition bridge (last 2-3 sentences of previous beat)
- Landing target (first sentence of next beat)
- Character snapshots (speech pattern, emotional state, relationship to POV)
- Resolved references via `src/agents/writer/reference-resolver.ts` (deterministic + cheap LLM lookups)

**Planned state** (`src/planned-state.ts`):
- Planning-plotter outputs `establishedFacts`, `characterStateChanges`, `knowledgeChanges` per chapter
- Saved to DB tables after chapter approval (same tables extractors write to)
- Configurable via `pipeline.extractionMode`: `"plan"` (planner only), `"extract"` (LLM extractors only), `"both"` (verify)

**Semantic retrieval** (`src/db/retrieval.ts`, `src/db/embed.ts`):
- Infrastructure exists but embeddings disabled (`pipeline.embeddings = false`)
- Used as fallback for chapter-level writing path only

### Knowledge Graph
Structured world systems, cultures, evolving relationships, timeline events, character knowledge — all in Postgres. Tables: `world_systems`, `cultures`, `character_cultures`, `character_system_awareness`, `relationship_states`, `timeline_events`, `character_knowledge`, `event_causes`, `knowledge_propagation`.

### Models
`models/roles.ts` is the single place to control all agent assignments. `models/registry.ts` has all available models with pricing/specs. Runtime overrides via web UI; `persistOverrides()` writes to roles.ts.

### Quality Checks
Quality measured via structured pass/fail checks, not LLM scoring (1-10 judges showed 0-33% discrimination):
- **Adherence checker** — per-beat: deterministic (character presence, word count, dialogue) + LLM verification
- **Chapter plan checker** — per-chapter: LLM compares prose vs plan, reports specific deviations
- **Continuity checker** — per-chapter: LLM check against world state tables
- **Lint** — deterministic (26 patterns) + LLM fixes for cliché, hedging, emotional echo, rhythm
- **Tonal pass** — LoRA-tuned 9B model for per-paragraph voice rewriting

Archived benchmarks (infrastructure kept): context quality, prose penalties, planning scores, extraction scores, pairwise comparison.

### Improvement Daemon
`src/orchestrator/daemon-loop.ts` — autonomous improvement loop:
1. Diagnose weakest dimension (`src/harness/scores.ts`)
2. Build improver context (`src/orchestrator/improve.ts` → `src/harness/`)
3. Propose change via LLM (improver agent)
4. Benchmark → evaluate → keep/revert
5. Synthesize conclusion for future cycles

All daemon data access goes through `src/harness/` service layer. No inline SQL in daemon code.

**Optimization surfaces** (in `src/harness/registry.ts`):
- 12 agent prompts (planning, writing, checking, extraction, concept agents)
- 6 deterministic causal parameters (`deterministic_config` table)
- 6 context format templates (`context_templates` table — per-item rendering formats)
- 8 generation parameters (`agent_generation_config` table — temperature/maxTokens per agent)
- 3 model assignments (visible in registry, not daemon-tunable)

The daemon rotates between prompt, config, and template proposals per iteration, using the component registry to discover surfaces per quality dimension.

### Web UI
`ui/`, React + Vite, served at `/app`:
- **Novels** (`/app`) — create/resume/archive novels
- **Pipeline View** (`/app/:novelId`) — real-time SSE timeline with gate panels
- **Config** (`/app/config`) — per-agent model switching
- **Context** (`/app/context`) — retrieval parameter tuning per novel
- **Causal** (`/app/deterministic`) — causal link scoring weights and thresholds per novel
- **Experiments** (`/app/experiments`) — benchmark runs and improvement cycles
- **Operations** (`/app/operations`) — benchmark runner, improvement daemon controls
- **Dashboard** (`/app/dashboard`) — daemon status, batch status
- **Models** (`/app/models`) — searchable model registry
- **Guide** (`/app/guide`) — architecture diagrams, pipeline flow, benchmark docs

### Gate Abstraction
`src/gates.ts`, `src/events.ts` — decouples approval gates from stdin. SSE event bus pushes real-time updates. Modes: CLI readline, web API POST, auto-approve.

## DB Queries

**Never guess column names.** Before writing any ad-hoc SQL (bun -e, scripts, debugging), query `information_schema.columns` for the table first. The schema evolves via migrations and column names don't always match what you'd expect (e.g. `seed_json` not `seed`, `profile_json` not `role`, `attempt` not `run_number`).

## Rules

1. **Every experiment goes in the DB.** Use `harness.experiments.createTuningExperiment()` + `concludeExperiment()`. Never delete experiments.
2. **Every benchmark run links to an experiment** via `EXPERIMENT_ID=N`.
3. **All results persist to the DB.** Never write scripts that only output to stdout.
4. **Use the service layer.** Data access goes through `src/harness/` — no inline SQL in daemon, benchmarks, or UI code.
5. **One change per commit.** See `docs/commit-conventions.md`.
6. **Deploy after commit.** Run `bash scripts/deploy-lxc.sh`.
7. **Every experiment links to a git commit.** Commit changes BEFORE running experiments.

## Running

```bash
# Deploy code to LXC
bash scripts/deploy-lxc.sh

# Novel creation (on LXC)
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun src/index.ts --auto --seed romance-drama"

# Benchmarks (on LXC)
ssh novel-harness-lxc "cd ~/apps/novel-harness && BENCHMARK_SEEDS=romance-drama BENCHMARK_RUNS=2 bun benchmark/prose/run.ts"

# Context quality benchmark (requires 10+ chapter novel in Postgres)
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun benchmark/context/run.ts"

# Orchestrator (systemd service)
ssh novel-harness-lxc "sudo systemctl status novel-harness-orchestrator"

# Improvement daemon
ssh novel-harness-lxc "curl -s -X POST http://localhost:3006/api/improvement/start -H 'x-api-key: <key>'"

# Migrate existing SQLite novels to Postgres (one-time)
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun scripts/migrate-to-postgres.ts --embed"

# Tests (require DATABASE_URL)
bun test
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
| Architecture + pipeline flow | `/app/guide` (React UI) |
| Knowledge graph + context assembly | `docs/world-knowledge-graph.md` |
| DB schema | `sql/010_novel_data.sql`, `sql/011_vector_graph.sql`, `sql/012-015_*.sql` |
| Agent model assignments | `models/roles.ts` |
| Service layer API | `src/harness/index.ts` |
| Retrieval engine | `src/db/retrieval.ts` |

## Reference docs

- `docs/todo.md` — **living to-do** — items removed when done
- `docs/lessons-learned.md` — **read before designing agents, rubrics, or experiments**
- `docs/commit-conventions.md` — commit message format
- `docs/world-knowledge-graph.md` — knowledge graph, context assembly, retrieval parameters
- `docs/ai-tells-*.md` — lint pattern research (cliches, emotional echo, hedging, rhythm)
