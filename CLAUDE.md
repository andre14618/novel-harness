# Novel Harness

AI-assisted novel creation harness — deterministic code controls flow, LLMs are leaf-node function calls. Produces a 3-chapter short story (one chapter per act) for rapid iteration on agent tuning.

## Deployment Model

Code lives locally (canonical git repo). LXC 307 is the runtime — all benchmarks, novel runs, and the orchestrator run there. Local machine is the editor; LXC is the executor.

- **Edit locally** → commit → `bash scripts/deploy-lxc.sh` (rsyncs to LXC)
- **Run on LXC** via `ssh novel-harness-lxc "cd ~/apps/novel-harness && bun ..."`
- **DB lives on LXC only** — SQLite at `data/harness.db`, Postgres for orchestrator state
- **Results come back** via Postgres (SSH tunnel) or `bash scripts/sync-improvements.sh` (rsync prompts)

## Stack

- Runtime: Bun
- LLM: Configurable per-agent via `models/roles.ts`. Five providers: Cerebras, Groq, OpenRouter, OpenAI, DeepSeek.
- DB: bun:sqlite (`data/harness.db` on LXC), Postgres (`novel_harness_orchestrator` on LXC)
- Transport: `src/transport.ts` — pluggable layer beneath all LLM calls (direct, batch, prefix-cache)
- Interface: CLI + orchestrator dashboard (port 3006)

## Architecture

State machine: concept → planning → drafting → validation → done

**Agents** (each in `src/agents/{name}/` with prompt.md, schema.ts, context.ts, config.ts):
- Concept: world-builder, character-agent, plotter
- Planning: planning-plotter
- Drafting: writer, continuity
- Extraction: summary-extractor, fact-extractor, character-state
- Validation: cross-chapter-continuity, prose-quality, rewriter

**Models** — `models/roles.ts` is the single place to control all agent assignments. `models/registry.ts` has all available models with pricing/specs and provider cache/batch config.

**Benchmarks** — four benchmark suites in `benchmark/`:
- `prose/` — penalty-based scoring (issue counts, lower = better)
- `planning/` — Beat Specificity, Dialogue Cues, Emotional Arc (1-10)
- `extraction/` — Completeness, Accuracy (1-10)
- `continuity/` — Issue Detection, Fix Quality (1-10, requires fixtures/)

**Evaluation tools:**
- `benchmark/pairwise/` — A/B comparison with position-bias correction (runs each pair twice)
- `benchmark/batch/` — async judge calls via provider batch APIs (OpenAI, Groq — provider-agnostic `BatchProvider` interface in `benchmark/batch/openai-compatible.ts`)
- `src/lint/` — deterministic prose flagger, DB-driven patterns, no LLM calls

**Transport layer** (`src/transport.ts`) — sits beneath `callAgent()`, `generateProse()`, `judgeDimension()`:
- `DirectTransport` — standard real-time HTTP with retries (default)
- `BatchTransport` — queues requests, submits via provider batch API (50% off)
- `PrefixCacheTransport` — serializes same-system-prompt calls per provider cache strategy
- Provider caching config lives in `models/registry.ts` (`cache` + `batchApi` fields on `ProviderDef`)

**Central DB** (`data/harness.db` on LXC, schema in `data/db.ts`) — all experiments, runs, generations, scores, lint issues, batch tracking, pairwise matchups. Source of truth for all scores and baselines.

**Orchestrator** (`src/orchestrator/`, runs on LXC 307 at 192.168.1.108):
- Single Bun service on port 3006 combining batch polling, improvement daemon, dashboard, and API
- Entry point: `bun src/orchestrator/server.ts`
- Postgres DB: `novel_harness_orchestrator` (schema in `sql/`)
- ntfy on port 2586 (self-hosted email notifications to andre14618@gmail.com)
- SSH: `novel-harness-lxc` (via ProxyJump proxmox)
- Dashboard: `http://novel-harness-lxc:3006/?key=<ORCHESTRATOR_API_KEY>`
- Autonomous improvement: diagnoses weakest dimensions, proposes prompt changes, benchmarks, keeps/reverts. Manual trigger only (`POST /api/improvement/start`).
- Budget-capped at $0.80/night, max 15 iterations

## Rules

1. **Every experiment goes in the DB.** Use `createTuningExperiment()` + `concludeExperiment()`. Never delete experiments — failures are reference data.
2. **Every benchmark run testing a change links to an experiment** via `EXPERIMENT_ID=N`.
3. **All results persist to the DB.** Never write scripts that only output to stdout.
4. **Tight iteration first, full validation after.** Use env filters for focused cycles, run all seeds only when keeping a change.
5. **One change per commit.** See `docs/commit-conventions.md` for message format.
6. **Improvement loop auto-commits** kept changes AND reverted attempts — every attempt is in git history.
7. **Deploy after commit.** Run `bash scripts/deploy-lxc.sh` to sync code to LXC.

## Running

All benchmark/novel commands run on the LXC via SSH:

```bash
# Deploy code to LXC (run after commits)
bash scripts/deploy-lxc.sh

# Novel creation (on LXC)
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun src/index.ts --auto"
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun src/index.ts --auto --seed sci-fi-thriller"

# Benchmarks (on LXC)
ssh novel-harness-lxc "cd ~/apps/novel-harness && BENCHMARK_SEEDS=romance-drama BENCHMARK_RUNS=2 bun benchmark/prose/run.ts"
ssh novel-harness-lxc "cd ~/apps/novel-harness && bun benchmark/prose/run.ts --batch"

# Orchestrator (runs as systemd service on LXC)
ssh novel-harness-lxc "sudo systemctl status novel-harness-orchestrator"
ssh novel-harness-lxc "curl -s http://localhost:3006/health"

# Improvement daemon — manual trigger
ssh novel-harness-lxc "curl -s -X POST http://localhost:3006/api/improvement/start -H 'x-api-key: <key>'"
ssh novel-harness-lxc "curl -s http://localhost:3006/api/improvement/status -H 'x-api-key: <key>'"

# View results (from local machine, requires Postgres tunnel)
ssh -f -N -L 15432:192.168.1.108:5432 proxmox
bun scripts/improvement-report.ts
bun scripts/batch-status.ts

# Pull prompt changes from LXC after improvement cycle
bash scripts/sync-improvements.sh
git diff    # review changes before committing

# Tests (run locally — no DB dependency)
bun test
```

## Key env vars

| Var | Used by | Purpose |
|-----|---------|---------|
| `BENCHMARK_SEEDS` | prose, planning | Filter to specific seeds (comma-separated) |
| `BENCHMARK_RUNS` | all benchmarks | Runs per seed/sample/fixture (default 2-3) |
| `BENCHMARK_SAMPLES` | extraction | Max chapters to test (default: all) |
| `BENCHMARK_AGENT` | extraction | Test one extractor in isolation |
| `BENCHMARK_FIXTURES` | continuity | Filter to specific fixtures (comma-separated) |
| `BENCHMARK_JUDGES` | all benchmarks | Override judge model (label match) |
| `EXPERIMENT_ID` | prose run.ts | Link run to an experiment |
| `BATCH_PROVIDER` | prose --batch | Batch API provider (default: openai) |
| `BATCH_MODEL` | prose --batch | Batch judge model (default: gpt-5.4-mini) |
| `LLM_TRANSPORT` | all LLM calls | Transport mode: `direct` (default), `cache`, `batch` |
| `ORCHESTRATOR_DB_URL` | orchestrator, local scripts | Postgres connection string |
| `IMPROVEMENT_BUDGET` | daemon | Max $/day for autonomous improvement (default: 0.80) |

## LXC 307 Infrastructure

- **IP**: 192.168.1.108
- **SSH**: `novel-harness-lxc` (ProxyJump proxmox)
- **Services**: `novel-harness-orchestrator` (port 3006), `ntfy` (port 2586)
- **Postgres**: `novel_harness_orchestrator` DB, role `orchestrator`
- **App dir**: `/home/andre/apps/novel-harness`
- **Backups**: nightly Postgres dump + container snapshot (automated on Proxmox host)
- **Deploy**: `bash scripts/deploy-lxc.sh` (rsync + restart)

## Seeds

Test inputs in `src/seeds/`: dark-fantasy, young-adult-fantasy, sci-fi-thriller, romance-drama (primary test bed), minimal (stress test).

## Reference docs

Each doc has a `status` frontmatter field: `active` (operational), `proposal` (not implemented), `reference` (read-once research).

- `docs/commit-conventions.md` — commit message format and prefixes
- `docs/improvement-checklist.md` — 25 improvement items across 4 capability tiers
- `docs/methodology-integration-report.md` — writing methodology (Story Grid, Save the Cat, Weiland)
- `docs/batch-processing.md` — batch API cost analysis and phased approach (reference, partially implemented)
- `docs/proposal-style-mimicry.md` — author style extraction for fanfiction (proposal)
- `docs/tuning-log.md` — historical tuning experiment results (April 2026, pre-DB)
