# Novel Harness

AI-assisted novel creation harness — deterministic code controls flow, LLMs are leaf-node function calls. Supports short stories (3 chapters) for rapid iteration and full-length novels (20–30 chapters). Beat-first architecture: planning outputs world state, writing is per-beat with adherence checking, quality measured via structured pass/fail checks.

Built on the principles from [Harness Engineering](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html).

> **Canonical current state**: [`docs/current-state.md`](docs/current-state.md) is the authoritative description of the live system — active pipeline, retired methodologies, verification gates. If any doc (including this README) disagrees with it, that doc wins. Read it first when orienting.

## How It Works

The harness is a **state machine** moving through four phases:

```
Concept ──> Planning ──> Drafting ──> Validation ──> Done
```

Each phase calls specialized LLM agents with scoped context and typed schemas. The harness decides **what happens and in what order**. The LLM decides **how it sounds**.

### Phase 1: Concept
Three agents run in parallel, each producing a structured artifact:
- **World Builder** — setting, rules, locations, culture, history
- **Character Agent** — character profiles with backstory, voice, behavioral drivers
- **Plotter** — story arc, conflict, theme, ending direction

Each artifact gets a human approval gate (or auto-approved with `--auto`).

### Phase 2: Planning
All Phase 1 outputs converge into a **Planning Plotter** call that generates chapter-by-chapter outlines with scene beats (4–6 per chapter), POV assignments, character lists, and word targets. The planner also declares world state: established facts, character state changes, knowledge changes — this becomes the authoritative state source.

### Phase 3: Drafting
For each chapter, beats are written serially. For each beat:
1. **Reference Resolver** (pre-fetched in parallel for all beats) — resolves character/world references
2. **Beat Writer** — generates prose from beat spec + character snapshots + transition bridge
3. **Adherence Checker** — deterministic checks (character presence, word count) + LLM call (events, attribution)
4. **Chapter Plan Checker** — cross-beat properties: setting coherence, emotional arc, plot contradictions
5. **Continuity Checker** — cross-references draft against established world-state facts

Failed checks trigger targeted rewrites. All checkers are fine-tuned Qwen3-14B adapters on W&B Inference.

### Phase 4: Validation
Diagnostic-only. Deterministic checks run and issues are logged; the chapter-level rewriter was removed because the beat-writer retry loop in drafting is the quality gate. The tonal-pass auto-run is disabled — voice lands at generation time via per-genre voice LoRAs (see `WRITER_GENRE_PACKS` in `src/models/roles.ts`). The on-demand `POST /api/novel/:id/tonal-pass` endpoint still works for existing novels.

## Stack

- **Runtime**: Bun
- **LLM**: Multi-provider. Assignments per agent in `src/models/roles.ts`. Default writer is DeepSeek V3.2; fantasy seeds route to the Salvatore voice LoRA via `WRITER_GENRE_PACKS`. Other active providers: Cerebras (lint-fixer), Groq (reference-resolver), W&B Inference (fine-tuned checker + voice adapters), OpenRouter, OpenAI
- **DB**: Single Postgres (`novel_harness_orchestrator`) — all novel content, world state, experiments, LLM calls, and cost tracking
- **Fine-tuning**: W&B Serverless SFT (ART framework) → W&B Inference. Base model: `OpenPipe/Qwen3-14B-Instruct`. Active adapters: adherence-checker-v4, chapter-plan-checker-v2, continuity-v2, salvatore-1988-v3 (fantasy voice LoRA). The howard-tonal-v4 adapter is retained for on-demand tonal-pass only.
- **Transport**: `src/transport.ts` — DirectTransport (real-time HTTP with retries). Per-call telemetry persists to `llm_calls`.
- **UI**: React + Vite served at `/app`

## Quick Start

```bash
bun install
cp .env.example .env   # fill in API keys and DATABASE_URL

# Run tests (no DB needed)
bun test

# Deploy to LXC and run
bash scripts/deploy-lxc.sh
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun src/index.ts --auto --seed romance-drama"
```

## Project Structure

```
src/
  agents/       ← one dir per agent (index.ts, context.ts, schema.ts, prompt files)
  config/       ← pipeline config, pricing, run config
  db/           ← per-table Postgres modules, connection, operational helpers
  harness/      ← service layer — high-level API used by daemon, UI, scripts
  lint/         ← lint detectors, fixers, ~26 patterns
  models/       ← model registry (registry.ts) and role assignments (roles.ts)
  orchestrator/ ← HTTP server and route handlers
  phases/       ← concept.ts, planning.ts, drafting.ts, validation.ts
  seeds/        ← 38 JSON novel seeds across genre
scripts/
  agent/        ← experiment CLI helpers
  analysis/     ← ad-hoc inspection and smoke tests
  finetune/     ← W&B/LoRA training pipeline
  lint/         ← lint pattern research and maintenance
sql/            ← 27 numbered Postgres migration files
ui/             ← React + Vite SPA (The Studio, Pipeline View, Config, Experiments)
docs/           ← decisions.md, lessons-learned.md, fine-tuning-strategy.md, ...
```

Unit tests live next to their source (e.g. `src/models/registry.test.ts`) and run via `bun test`.

## Web UI

React SPA served at `/app` on the orchestrator (port 3006):

| Page | Purpose |
|------|---------|
| `/app/studio` | Home — create novels, pick from history, live pipeline view |
| `/app/:novelId` | Real-time SSE pipeline timeline |
| `/app/:novelId/read` | Rendered prose |
| `/app/config` | Per-agent model switching |
| `/app/experiments` | Experiment history with scores, cost, lineage |
| `/app/models` | Searchable model registry |
| `/app/guide` | Architecture diagrams and pipeline docs |

## Improvement Daemon

Autonomous improvement loop running on LXC via the orchestrator:
1. Diagnose weakest quality dimension
2. Build improver context from DB
3. Propose change via LLM
4. Run benchmark → evaluate → keep or revert
5. Record conclusion for future cycles

Start via: `curl -X POST http://novel-harness:3006/api/improvement/start -H 'x-api-key: <key>'`

## Seeds

38 JSON seeds in `src/seeds/` across genres: dark-fantasy, LitRPG, sci-fi, post-apocalyptic, portal fantasy, romance-drama (primary test bed).
