# Novel Harness

AI-assisted novel creation harness — deterministic code controls flow, LLMs are leaf-node function calls. Produces a 3-chapter short story (one chapter per act) for rapid iteration on agent tuning.

## Stack

- Runtime: Bun
- LLM: Configurable per-agent via `models/roles.ts`. Five providers: Cerebras, Groq, OpenRouter, OpenAI, DeepSeek.
- DB: bun:sqlite. Central operational DB at `data/harness.db`. Per-novel content at `output/{novelId}/novel.db`.
- Interface: CLI

## Architecture

State machine: concept → planning → drafting → validation → done

**Agents** (each in `src/agents/{name}/` with prompt.md, schema.ts, context.ts, config.ts):
- Concept: world-builder, character-agent, plotter
- Planning: planning-plotter
- Drafting: writer, continuity
- Extraction: summary-extractor, fact-extractor, character-state
- Validation: cross-chapter-continuity, prose-quality, rewriter

**Models** — `models/roles.ts` is the single place to control all agent assignments. `models/registry.ts` has all available models with pricing/specs.

**Benchmarks** — four benchmark suites in `benchmark/`:
- `prose/` — penalty-based scoring (issue counts, lower = better)
- `planning/` — Beat Specificity, Dialogue Cues, Emotional Arc (1-10)
- `extraction/` — Completeness, Accuracy (1-10)
- `continuity/` — Issue Detection, Fix Quality (1-10, requires fixtures/)

**Evaluation tools:**
- `benchmark/pairwise/` — A/B comparison with position-bias correction (runs each pair twice)
- `benchmark/batch/` — async judge calls via provider batch APIs (OpenAI first, provider-agnostic)
- `src/lint/` — deterministic prose flagger, DB-driven patterns, no LLM calls

**Central DB** (`data/harness.db`, schema in `data/db.ts`) — all experiments, runs, generations, scores, lint issues, batch tracking, pairwise matchups. Source of truth for all scores and baselines.

## Rules

1. **Every experiment goes in the DB.** Use `createTuningExperiment()` + `concludeExperiment()`. Never delete experiments — failures are reference data.
2. **Every benchmark run testing a change links to an experiment** via `EXPERIMENT_ID=N`.
3. **All results persist to the DB.** Never write scripts that only output to stdout.
4. **Tight iteration first, full validation after.** Use env filters for focused cycles, run all seeds only when keeping a change.
5. **One change per commit.** See `docs/commit-conventions.md` for message format.
6. **Improvement loop auto-commits** kept changes AND reverted attempts — every attempt is in git history.

## Running

```bash
# Novel creation
bun src/index.ts --auto                    # default seed
bun src/index.ts --auto --seed sci-fi-thriller
bun src/index.ts --resume novel-123456

# Benchmarks — tight iteration (minimum viable data)
BENCHMARK_SEEDS="romance-drama" BENCHMARK_RUNS=2 bun benchmark/prose/run.ts
BENCHMARK_SEEDS="romance-drama" BENCHMARK_RUNS=2 bun benchmark/planning/run.ts
BENCHMARK_SAMPLES=2 BENCHMARK_RUNS=2 bun benchmark/extraction/run.ts
BENCHMARK_FIXTURES="location-impossibility" BENCHMARK_RUNS=2 bun benchmark/continuity/run.ts

# Benchmarks — full validation (all seeds/samples)
bun benchmark/prose/run.ts
bun benchmark/planning/run.ts
bun benchmark/extraction/run.ts
bun benchmark/continuity/run.ts
bun benchmark/prose/run.ts --save-baseline

# Agent isolation
BENCHMARK_AGENT=fact-extractor BENCHMARK_SAMPLES=2 bun benchmark/extraction/run.ts

# Pairwise comparison
bun benchmark/pairwise/run.ts --run-a 19 --run-b 21 --seeds romance-drama

# Batch mode (async judges, 50% off)
bun benchmark/prose/run.ts --batch
bun benchmark/batch/status.ts
bun benchmark/batch/collect.ts

# Automated improvement loop
bun scripts/improve-loop.ts --target extraction --dimension completeness --iterations 3
bun scripts/improve-loop.ts --target planning --dimension dialogue-cues --iterations 3
bun scripts/improve-loop.ts --target prose --dimension telling --dry-run

# Experiments (multi-variant, matrix)
bun benchmark/prose/experiments/batch-1-prompts.ts

# Utilities
bun test
bun scripts/cost-summary.ts --global
bun src/lint/test-all.ts
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
| `IMPROVER_MODEL` | improve-loop | LLM that proposes prompt changes (default: kimi-k2) |

## Seeds

Test inputs in `src/seeds/`: dark-fantasy, young-adult-fantasy, sci-fi-thriller, romance-drama (primary test bed), minimal (stress test).

## Reference docs

Each doc has a `status` frontmatter field: `active` (operational), `proposal` (not implemented), `reference` (read-once research).

- `docs/commit-conventions.md` — commit message format and prefixes
- `docs/improvement-checklist.md` — 25 improvement items across 4 capability tiers
- `docs/methodology-integration-report.md` — writing methodology (Story Grid, Save the Cat, Weiland)
- `docs/batch-processing.md` — batch API cost analysis and phased approach (proposal)
- `docs/proposal-style-mimicry.md` — author style extraction for fanfiction (proposal)
- `docs/tuning-log.md` — historical tuning experiment results (April 2026, pre-DB)
