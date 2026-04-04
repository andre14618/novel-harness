# Novel Harness

AI-assisted novel creation harness — deterministic code controls flow, LLMs are leaf-node function calls. Produces a 3-chapter short story (one per act) for rapid iteration on agent tuning.

Built on the principles from [Harness Engineering](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html) and Karpathy's [March of Nines](https://venturebeat.com/technology/karpathys-march-of-nines-shows-why-90-ai-reliability-isnt-even-close-to/).

## How It Works

The harness is a **state machine** that moves through phases:

```
Concept ──> Planning ──> Drafting ──> Validation ──> Done
```

Each phase calls specialized LLM agents with scoped context and typed schemas. The harness (your code) decides **what happens and in what order**. The LLM decides **how it sounds**.

### Phase 1: Concept
Three agents run, each generating a structured artifact:
- **World Builder** — World Bible (setting, rules, locations, culture, history)
- **Character Agent** — Character Profiles (backstory, voice, traits, relationships)
- **Plotter** — Story Spine (3-act structure, conflict, theme, ending direction)

Each artifact gets a human approval gate (or auto-approved with `--auto`).

### Phase 2: Planning
All Phase 1 outputs converge into a single **Planning Plotter** call that generates chapter-by-chapter outlines with scene beats, POV assignments, character lists, and word targets.

### Phase 3: Drafting
For each chapter:
1. **Context Assembly** (code) — queries the DB for outline, character profiles, world rules, previous chapter summaries, character states, and open issues
2. **Writer Agent** (LLM) — generates prose following scene beats
3. **Continuity Check** (LLM) — cross-references draft against established facts
4. **Human Gate** — approve, revise, or reject
5. **State Update** (3 LLM calls) — extract summary, facts, and character states

### Phase 4: Validation
Multi-pass cross-chapter consistency check. **Cross-Chapter Continuity** checks all chapters together, **Prose Quality** flags issues per chapter, and the **Rewriter** fixes them automatically. Repeats up to 3 passes until convergence.

## Stack

- **Runtime**: Bun
- **LLM Providers**: Configurable per-agent via `models/roles.ts` — Cerebras, Groq, OpenRouter, OpenAI, DeepSeek
- **DB**: Postgres (central — experiments, LLM calls, cost tracking), per-novel SQLite (story state)
- **Transport**: `src/transport.ts` — DirectTransport (real-time HTTP with retries) and BatchTransport (async batch API, 50% off)
- **UI**: React + Vite served at `/app` on the orchestrator

## Cost Management

Two levers for reducing LLM costs:

**Batch API (50% off input + output)** — the primary cost lever. Queues requests and submits via provider batch APIs (OpenAI, Groq). Async with 24h turnaround. Controlled via `LLM_TRANSPORT=batch` or `--batch` flag.

**Provider prefix caching (automatic, no code needed)** — OpenAI and DeepSeek automatically cache repeated prompt prefixes at the provider level. When consecutive requests share the same system prompt, cached tokens get discounted (OpenAI: 90% off input >1024 tokens, DeepSeek: 95% off any prefix). No transport-level intervention — the harness structures prompts with static instructions first and variable content last, so caching happens naturally. Cache metadata on each provider in `models/registry.ts` for cost estimation.

Every LLM call computes cost from registry pricing (tokens × $/1M), stores it in the `llm_calls` Postgres table, and emits it via SSE for real-time display.

## Model Registry

All available models, providers, pricing, and caching info live in `models/registry.ts`. Agent-to-model assignments in `models/roles.ts`. Runtime overrides via the web UI take effect immediately; "Save to File" persists to `roles.ts`.

| Provider | Tier | Cache | Batch |
|----------|------|-------|-------|
| Cerebras | Fast inference | Automatic (no discount) | — |
| Groq | Fast inference | Automatic (50% off) | 50% off, 7d window |
| OpenAI | Standard | Automatic (90% off >1024 tok) | 50% off, 24h window |
| DeepSeek | Standard | Automatic (95% off any prefix) | — |
| OpenRouter | Standard | Varies by underlying provider | — |

## Benchmarking & Improvement

Four benchmark suites in `benchmark/`:

| Suite | Tests | Dimensions | Scoring |
|-------|-------|-----------|---------|
| Prose | Writer agent | Penalty-based (issue counts) | Lower = better |
| Planning | Planning plotter | Beat Specificity, Dialogue Cues, Emotional Arc | 1-10 |
| Extraction | Summary, fact, character-state extractors | Completeness, Accuracy | 1-10 |
| Continuity | Cross-chapter continuity | Issue Detection, Fix Quality | 1-10 |

**Improvement daemon** automates: diagnose weakest dimension → propose prompt change → benchmark → keep or revert. Dimension-locked by default for structured, comparable data.

## Quick Start

```bash
bun install

# Set up API keys
cp .env.example .env

# Run tests (local, no DB needed)
bun test

# Deploy to LXC
bash scripts/deploy-lxc.sh

# Novel creation (on LXC)
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun src/index.ts --auto"
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun src/index.ts --auto --seed sci-fi-thriller"

# Benchmarks (on LXC)
ssh novel-harness-lxc "cd ~/apps/novel-harness && BENCHMARK_SEEDS=romance-drama bun benchmark/prose/run.ts"
```

## Web UI

Single React SPA served at `/app` on the orchestrator (port 3006):

| Page | Purpose |
|------|---------|
| `/app` | Novel list — start, resume, archive novels |
| `/app/:novelId` | Pipeline timeline — real-time SSE showing each agent, LLM call, cost |
| `/app/config` | Per-agent model switching with inline dropdowns |
| `/app/experiments` | Unified experiment history with scores, cost, lineage |
| `/app/operations` | Benchmark runner, improvement daemon controls |
| `/app/dashboard` | Daemon status, orchestrator stats |
| `/app/guide` | Full documentation |

## Architecture

```
src/
  index.ts              Entry point
  llm.ts                callAgent() — resolves model from roles.ts, calls transport
  transport.ts          DirectTransport (HTTP + retry), BatchTransport (async batch API)
  gates.ts              Approval gates — CLI, web API, or auto mode
  events.ts             SSE event bus for real-time browser updates
  agents/               12 agents, each with prompt.md, schema.ts, context.ts, config.ts
  phases/               concept.ts, planning.ts, drafting.ts, validation.ts
  orchestrator/         Bun server combining API, UI, batch polling, improvement daemon
models/
  registry.ts           All models, providers, pricing, cache info
  roles.ts              Agent-to-model assignments
benchmark/
  prose/                Penalty-based prose scoring
  planning/             Planning quality dimensions
  extraction/           Extractor completeness/accuracy
  continuity/           Cross-chapter continuity
  pairwise/             A/B comparison with position-bias correction
  batch/                Async batch API integration
ui/
  src/                  React + Vite SPA
```

## Seeds

Test inputs in `src/seeds/`: dark-fantasy, young-adult-fantasy, sci-fi-thriller, romance-drama (primary test bed), minimal (stress test).
