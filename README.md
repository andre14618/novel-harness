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
All Phase 1 outputs converge into split planning calls: `planning-plotter` creates chapter skeletons, `planning-beats` expands each chapter into beat shape only, and `planning-state-mapper` maps established facts, knowledge changes, character state changes, payoff links, and per-beat obligations onto those existing beats. Planning validates that declared state is writer-visible through beat text or obligations, retries the mapper on coverage gaps, and only falls back to deterministic auto-repair after mapper retries are exhausted.

### Phase 3: Drafting
For each chapter, beats are written serially. For each beat:
1. **Reference Resolver** (pre-fetched in parallel for all beats) — resolves character/world references
2. **Beat Writer** — generates prose from beat spec + compact beat obligations + character snapshots + transition bridge
3. **Adherence Checker** — deterministic character-presence check + bounded LLM event-enactment call
4. **Entity Grounding Checker** — flags named entities not grounded in the writer-visible evidence surface
5. **Functional Story-State Checks** — deterministic payoff-link integrity plus bounded semantic planned-state grounding before state is persisted
6. **Chapter Plan / Continuity Checks** — cross-beat and cross-chapter story-state consistency

Failed checks trigger targeted rewrites or the plan-assist gate. Active runtime checks are deterministic guards plus bounded DeepSeek V4 Flash calls; retired W&B checker/voice adapters are not part of the base-writer workflow.

### Phase 4: Validation
Diagnostic-only. Deterministic checks run and issues are logged; the chapter-level rewriter was removed because the beat-writer retry loop in drafting is the quality gate. Tonal/voice LoRA generation is retired from runtime; old tonal-pass draft rows can still be viewed for archival comparison.

## Stack

- **Runtime**: Bun
- **LLM**: Multi-provider. Assignments per agent in `src/models/roles.ts`. Default writer is DeepSeek V4 Flash. Fantasy genre data now supplies planner structural priors only; it does not route the writer through a LoRA, compact context, or corpus-leak profile. Thinking mode is per-agent — ON only on `planning-state-mapper`, `chapter-plan-checker`, `chapter-plan-reviser`. Other active providers: Cerebras (lint-fixer), Groq (reference-resolver), OpenRouter, OpenAI
- **DB**: Single Postgres (`novel_harness_orchestrator`) — all novel content, world state, experiments, LLM calls, and cost tracking
- **Fine-tuning**: Historical W&B/Together SFT infrastructure remains for archived experiments, but no writer or checker LoRA is active in the base-writer runtime path.
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

## Autonomous Improvement Loop

The original `Improvement Daemon` was deleted — its knob space only covered legacy retrieval/context-template surfaces that are now mostly inactive (`pipeline.embeddings=false`). Replacement is in progress on the `autonomous-harness-loop` branch borrowing the autoresearch pattern (Karpathy 2026). See `docs/designs/autonomous-context-loop.md` and `scripts/autonomous-loop/README.md`.

## Seeds

38 JSON seeds in `src/seeds/` across genres: dark-fantasy, LitRPG, sci-fi, post-apocalyptic, portal fantasy, romance-drama (primary test bed).
