# Novel Harness

AI-assisted novel creation harness — deterministic code controls flow, LLMs are leaf-node function calls. Supports short stories (3 chapters) for rapid iteration and full-length novels (20-30 chapters) with semantic context retrieval.

## Deployment Model

Code lives locally (canonical git repo). LXC 307 is the runtime — all benchmarks, novel runs, and the orchestrator run there. Local machine is the editor; LXC is the executor.

- **Edit locally** → commit → `bash scripts/deploy-lxc.sh` (rsyncs to LXC)
- **Run on LXC** via `ssh novel-harness-lxc "cd ~/apps/novel-harness && bun ..."`
- **Single Postgres DB** on LXC — `novel_harness_orchestrator` stores ALL data (novel content, world state, embeddings, experiments, LLM calls)
- **Results come back** via Postgres (SSH tunnel) or `bash scripts/sync-improvements.sh` (rsync prompts)

## Stack

- Runtime: Bun
- LLM: Configurable per-agent via `models/roles.ts`. Providers: Cerebras, Groq, OpenRouter, OpenAI, DeepSeek.
- DB: Single Postgres with pgvector (`novel_harness_orchestrator` on LXC — all tables)
- Embeddings: `openai/text-embedding-3-large` via OpenRouter (3072 dims, HNSW halfvec indexes)
- Transport: `src/transport.ts` — pluggable layer beneath all LLM calls (direct, batch)
- Interface: React UI (`/app`), CLI

## Architecture

State machine: concept → planning → drafting → validation → done

### Agents
Each in `src/agents/{name}/` with prompt.md, schema.ts, context.ts, config.ts:
- **Concept**: world-builder, character-agent, plotter
- **Planning**: planning-plotter
- **Drafting**: writer, continuity
- **Extraction**: summary-extractor, fact-extractor, character-state, relationship-timeline, **graph-linker**
- **Validation**: cross-chapter-continuity, prose-quality, rewriter

### Data Layer
- `src/db/` — per-table async Postgres modules (all functions return Promises via `Bun.sql`)
- `src/harness/` — **service layer** — typed high-level API for all harness operations. The daemon, benchmarks, and UI call this instead of writing SQL. Modules: `scores`, `experiments`, `cycles`, `context`, `embeddings`, `graph`, `novels`.
- `data/connection.ts` — shared lazy Postgres proxy, migration runner
- `sql/` — migration files (001-011)

### Semantic Context Engine
Writer receives context assembled via hybrid RRF search (vector similarity + full-text keyword) over 6 tables: facts, events, summaries, character states, relationships, knowledge. See `benchmark/context/judges/` for how context quality is measured.

**Context assembly** (`src/agents/writer/context.ts`):
- Fixed skeleton: scene setup, POV world view, character profiles + relationship arcs, craft reminders
- Dynamic sections: semantically retrieved, weighted by scene relevance via `src/db/retrieval.ts`

**Retrieval pipeline** (`src/db/retrieval.ts`):
- Scene query embedded → 6-table parallel hybrid search → RRF fusion → character/location boost → recency decay
- Graph queries: causal chains (recursive CTE), relationship arcs, knowledge propagation
- Tunable via `retrieval_config` table (12 parameters per novel)

**Embedding pipeline** (`src/db/embed.ts`, `src/harness/embeddings.ts`):
- Runs after extraction: batch embeds all new chapter data (~$0.0003/chapter)
- Text templates in `embedding_templates` DB table (6 source types, autoresearcher-tunable)

**Graph linker** (`src/agents/graph-linker/`):
- 5th extraction agent, runs after extractors + embedding
- Produces: causal links (`event_causes`), knowledge propagation (`knowledge_propagation`)

### Knowledge Graph
Structured world systems, cultures, evolving relationships, timeline events, character knowledge — all in Postgres. Tables: `world_systems`, `cultures`, `character_cultures`, `character_system_awareness`, `relationship_states`, `timeline_events`, `character_knowledge`, `event_causes`, `knowledge_propagation`.

### Models
`models/roles.ts` is the single place to control all agent assignments. `models/registry.ts` has all available models with pricing/specs. Runtime overrides via web UI; `persistOverrides()` writes to roles.ts.

### Benchmarks
Active suites in `benchmark/`:
- **`context/`** — context quality scoring (primary optimization target): relevance, completeness, noise, causal-depth, knowledge-accuracy. Each judge produces actionable retrieval diagnostics.
- `continuity/` — Issue Detection, Fix Quality (1-10). Stable signal, concrete metrics.
- Deterministic lint (26 patterns) + Llama 8B tonal pass for AI cliché fixing.

Archived (infrastructure kept for macro tracking, removed from iteration loop):
- `prose/` — penalty dimensions (telling, dead-weight, dialogue). Noisy judges, no corrective feedback path. Superseded by lint + adherence checking.
- `planning/` — 1-10 scores with ceiling effect (all models score ~8.0).
- `extraction/` — completeness doesn't discriminate (all models score 8.0). Direct output comparison more useful.
- Pairwise — position bias, only useful for substantially different variants.
- Quality dimensions (prose-craft, character-voice, sensory-grounding) — zero judge discrimination.

### Improvement Daemon
`src/orchestrator/daemon-loop.ts` — autonomous improvement loop:
1. Diagnose weakest dimension (`src/harness/scores.ts`)
2. Build improver context (`src/orchestrator/improve.ts` → `src/harness/`)
3. Propose change via LLM (improver agent)
4. Benchmark → evaluate → keep/revert
5. Synthesize conclusion for future cycles

All daemon data access goes through `src/harness/` service layer. No inline SQL in daemon code.

**Optimization surfaces** (50 components in `src/harness/registry.ts`):
- 12 agent prompts (all extraction, planning, prose, continuity, concept agents)
- 9 retrieval parameters (`retrieval_config` table)
- 6 deterministic causal parameters (`deterministic_config` table)
- 6 embedding templates (`embedding_templates` table)
- 6 context format templates (`context_templates` table — scene query, per-item formats)
- 8 generation parameters (`agent_generation_config` table — temperature/maxTokens per agent)
- 3 model assignments (visible in registry, not daemon-tunable)

The daemon rotates between prompt, config, and template proposals per iteration, using the component registry to discover surfaces per benchmark dimension.

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
