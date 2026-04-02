# Novel Harness

AI-assisted novel creation harness — deterministic code controls flow, LLMs are leaf-node function calls. Produces a 3-chapter short story (one chapter per act) for rapid iteration on agent tuning.

## Stack

- Runtime: Bun
- LLM: Configurable per-agent via `models/roles.ts`. Five providers: Cerebras, Groq, OpenRouter, OpenAI, DeepSeek.
- DB: bun:sqlite. Central operational DB at `data/harness.db` (all LLM calls, run configs, benchmark scores). Per-novel creative content at `output/{novelId}/novel.db`.
- Interface: CLI

## Architecture

State machine: concept → planning → drafting → validation → done

### Agent-per-directory structure

12 LLM agents, each self-contained in `src/agents/{name}/`:

```
src/agents/{name}/
  prompt.md     ← system prompt (readable markdown, easy to edit)
  schema.ts     ← Zod output schema
  context.ts    ← builds the user prompt from DB/input data
  config.ts     ← temperature, maxTokens, thinking (task-specific tuning only)
  index.ts      ← barrel export + prompt loader
```

**Concept phase:** world-builder, character-agent, plotter
**Planning phase:** planning-plotter
**Drafting phase:** writer, continuity
**State extraction:** summary-extractor, fact-extractor, character-state
**Validation phase:** cross-chapter-continuity, prose-quality, rewriter

### Model system

```
models/
  registry.ts   ← all available models, providers, pricing, specs, observed TPS
  roles.ts      ← which model each agent uses (one file to change all assignments)
```

Per-agent model assignment in `models/roles.ts`. Resolution: `roles.ts` → `.env` global default → fallback `qwen/qwen3-32b`.

### Benchmark system

```
benchmark/
  config.ts         ← writer/judge model selection (resolves from roles.ts)
  db.ts             ← re-exports from central data/db.ts
  calibrate.ts      ← judge model calibration (discrimination, consistency, TPS)
  tuning-log.md     ← persistent record of all tuning experiment conclusions
  prose/            ← writer output quality (penalty-based scoring)
    run.ts          ← quick-iteration benchmark (single writer config)
    experiment-runner.ts ← unified experiment runner (multi-variant, matrix support)
    shared.ts       ← shared functions (loadSeeds, generateProse, judgeDimension)
    summary.ts      ← auto-generate experiment summary markdown
    judges/         ← rubric .md per dimension + schema.ts
    experiments/    ← batch definitions (types.ts + batch-*.ts files)
  batch/            ← async batch processing (provider-agnostic)
    types.ts        ← BatchProvider interface, BatchRequest/Result/Status
    providers.ts    ← provider registry (currently: openai)
    openai.ts       ← OpenAI Batch API adapter (50% off, 24hr window)
    submit.ts       ← CLI: submit judge calls for a run as batch
    status.ts       ← CLI: check pending batch status
    collect.ts      ← CLI: import completed batch results to scores table
  pairwise/         ← A/B comparison for quality discrimination
    rubric.md       ← holistic comparison rubric (show-vs-tell, craft, voice, sensory, momentum)
    judge.ts        ← position-bias-corrected matchup engine (runs each pair twice: ab + ba)
    run.ts          ← CLI: compare two runs by matching generations on seed
  planning/         ← planning-plotter output quality
    run.ts          ← Beat Specificity, Dialogue Cues, Emotional Arc
    judges/
  extraction/       ← extractor accuracy and completeness
    run.ts          ← Completeness, Accuracy (uses existing novel output)
    judges/
  continuity/       ← continuity checker detection rate
    run.ts          ← Issue Detection, Fix Quality (needs fixtures/)
    judges/
```

**Unified experiment system:** Both `run.ts` and `experiment-runner.ts` store all results in the same tables (`generations` + `scores`). Each experiment variant gets its own `run_id` linked to a `tuning_experiment`. The experiment runner auto-lints all generated prose and auto-generates markdown summaries.

**Matrix experiments:** Define model × prompt × temperature axes in `ExperimentBatch.matrix`. The runner computes the cartesian product and runs all combinations.

All benchmark data goes to central `data/harness.db`. Every LLM call logged with agent, model, tokens, TPS, cost.

**Data persistence requirement:** ALL benchmark, probe, calibration, and tuning experiments MUST persist results to a database. Never write scripts that only output to stdout. Console output is for real-time monitoring; the DB is the source of truth for analysis and cross-session comparison.

### Central data layer

```
data/
  db.ts           ← central operational DB schema + all query functions
  harness.db      ← the DB file (gitignored)
```

Tables: `runs`, `run_agents`, `llm_calls`, `generations`, `scores`, `baselines`, `lint_patterns`, `lint_issues`, `tuning_experiments`, `tuning_results`

Key queries:
- `getModelStats()` — global per-model cost, TPS, call count
- `getAgentStats()` — per-agent cost and performance
- `getAgentModelScores()` — cross-run comparison of agent+model combos
- `compareRuns()` — diff two runs (config changes, score deltas, cost)
- `getCallSummary()` — per-agent breakdown for a specific run

### Deterministic lint system

```
src/lint/
  index.ts        ← flagger engine, DB persistence, pattern management
  test-all.ts     ← test flagger against all stored generations
```

DB-driven prose flagger — no LLM calls. Detection patterns live in `lint_patterns` table (not code), flagged issues in `lint_issues` with FK back to both the generation and the pattern that caught it.

**Pattern tiers:**
- **Tier 1** (28 patterns) — zero ambiguity: filler phrases, redundant body language, redundant adverb+verb, empty transitions
- **Tier 2** (7 patterns) — filter words: `seemed to`, `could feel/see/hear/smell/taste`, `found herself`. All skip dialogue. ~0.94 issues/gen on Kimi K2 output.
- **Tier 3** (planned) — said bookisms, declared emotions (0 hits on current writer — deferred until needed)

**Architecture:** Flagger optimizes for recall (catch everything). Rewriter optimizes for precision (skip false positives). The `resolved` + `rewrite_result` columns on `lint_issues` track rewriter decisions per-flag. `getPatternStats()` shows per-pattern hit/skip rates for measuring precision over time.

**Key functions:**
- `lintProse(prose, tier?)` — run flagger, returns issues
- `lintRun(runId)` — lint all generations for a run, persist to DB
- `togglePattern(id, enabled)` — enable/disable patterns without code changes
- `getPatternStats(runId?)` — per-pattern hit count + skip rate

### DB modules (per-novel creative content)

```
src/db/
  connection.ts        ← initDB(), getDB(), migrations
  novels.ts            ← createNovel, getNovel, updatePhase
  drafts.ts            ← saveChapterDraft, approveChapterDraft, getApprovedDraft
  outlines.ts          ← chapter outline CRUD
  world.ts             ← world bible, characters, story spine
  summaries.ts         ← chapter summaries
  facts.ts             ← fact CRUD + per-chapter queries
  character-states.ts  ← character state snapshots
  issues.ts            ← continuity issues
  validation-passes.ts ← validation pass tracking
```

### Config

```
src/config/
  pipeline.ts   ← maxDraftAttempts, maxValidationPasses, maxChapterRewrites
  pricing.ts    ← re-exports getTokenCost from models/registry.ts
```

## Running

```bash
# Novel creation
bun src/index.ts --auto                    # default seed (epic-fantasy)
bun src/index.ts --auto --seed sci-fi-thriller  # different seed
bun src/index.ts --resume novel-123456     # resume from checkpoint

# Benchmarks
bun benchmark/prose/run.ts                 # prose quality (Show/Tell, Dialogue, Sensory)
bun benchmark/planning/run.ts              # planning quality (Beat Specificity, Dialogue Cues, Arc)
bun benchmark/extraction/run.ts            # extraction quality (Completeness, Accuracy)
bun benchmark/continuity/run.ts            # continuity detection (needs fixtures/)
bun benchmark/prose/run.ts --save-baseline # save scores as baseline

# Focused seed testing
BENCHMARK_SEEDS="romance-drama" bun benchmark/prose/run.ts
BENCHMARK_SEEDS="romance-drama,dark-fantasy" BENCHMARK_RUNS=5 bun benchmark/prose/run.ts

# Link benchmark run to an experiment (tracks what changed + why)
EXPERIMENT_ID=9 BENCHMARK_SEEDS="romance-drama" bun benchmark/prose/run.ts

# Experiments (multi-variant, matrix support)
bun benchmark/prose/experiments/batch-1-prompts.ts    # run a batch experiment
# Matrix experiments defined in batch files with ExperimentBatch.matrix:
#   models × prompts × temperatures → auto-generates all combinations
# All results go to generations + scores (same tables as run.ts)
# Auto-lints prose and generates summary to tuning_experiments.summary

# Batch mode (generate prose via Groq, judge async via OpenAI Batch API — 50% off)
bun benchmark/prose/run.ts --batch                         # default: openai/gpt-5.4-mini
BATCH_PROVIDER=openai BATCH_MODEL=gpt-5.4-mini bun benchmark/prose/run.ts --batch
bun benchmark/batch/status.ts                              # check pending batches
bun benchmark/batch/collect.ts                             # import completed results
bun benchmark/batch/submit.ts --run 43 --provider openai   # submit judges for existing run

# Pairwise comparison (A/B quality discrimination)
bun benchmark/pairwise/run.ts --run-a 19 --run-b 21                   # compare two runs
bun benchmark/pairwise/run.ts --run-a 19 --run-b 21 --seeds romance-drama  # specific seeds

# Lean iteration mode (single judge, fewer runs)
BENCHMARK_JUDGES="Qwen3 32B" BENCHMARK_RUNS=2 bun benchmark/prose/run.ts

# Judge calibration
bun benchmark/calibrate.ts                 # test all available models as judges
CALIBRATE_MODELS="DeepSeek,Scout" bun benchmark/calibrate.ts  # test specific models

# Cost & performance analysis
bun scripts/cost-summary.ts               # most recent run
bun scripts/cost-summary.ts 5             # specific run by ID
bun scripts/cost-summary.ts --global      # all-time model/agent/phase stats
bun scripts/cost-summary.ts --runs novel  # list recent runs by type

# Deterministic lint
bun src/lint/test-all.ts                  # lint all prose runs, persist to DB, show pattern stats
```

## Logging

- `output/{novelId}/harness.log` — human-readable phase/checkpoint log
- `data/harness.db` → `llm_calls` table — all LLM calls with tokens, TPS, cost, agent, phase, model
- Every LLM call shows cost in real-time: `[LLM] Response: 450+1200 tokens ($0.0017)`

## Testing

```bash
bun test     # 150 tests across 8 files
```

## Seeds

Test inputs in `src/seeds/`:
- `dark-fantasy.json` — plague doctor, cure that comes back wrong
- `young-adult-fantasy.json` — dead familiar at a magic academy
- `sci-fi-thriller.json` — generation ship, lying navigation AI
- `romance-drama.json` — rival restaurateurs forced to share a kitchen
- `minimal.json` — locksmith, door that shouldn't exist (sparse input stress test)

## Backups

Pre-commit hook (`scripts/backup-dbs.sh`) safely backs up all SQLite DBs to `backups/` using `sqlite3 .backup` (WAL-safe). Keeps last 20 timestamped snapshots per DB.

## Benchmark Scoring: Penalty Mode

Prose benchmark uses **penalty-based scoring** (issue counts, lower = better). 1-10 scoring was tested extensively and cannot discriminate between "competent" and "good" prose — all judges compress to 7-9.

**Writer:** Kimi K2 (Groq) — set in `models/roles.ts` as `benchmark-writer`
**Judge:** GPT-OSS 120B (Groq) — set in `models/roles.ts` as `benchmark-judge`

Reliable penalty dimensions (confirmed via multi-model shootout):
- **Telling** — filter words, declared emotions, narrator explanations. Primary target.
- **Dead Weight** — filler phrases, redundant description, wasted sentences. Secondary target.
- **Dialogue Problems** — on-the-nose, info dumps, uniform voice. Unreliable (inverts across runs).

See `benchmark/tuning-log.md` for full tuning experiment results and rationale.

### Current Baseline (Run 16, post-methodology Tier 1)
```
                Raw issues    Per 1k words
Telling:        3.9 (+-1.8)
Dead Weight:    1.3 (+-1.5)
Dialogue:       4.9 (+-5.0)
Cost per cycle: ~$0.06 (all seeds) / ~$0.03 (single seed)
```
Note: Normalized (per-1k) baselines not yet established — run `--save-baseline` after next full benchmark to populate.

## Experiment Workflow

**Every benchmark run that tests a change MUST be linked to an experiment in the DB.** This is how we track what changed, why, and what we concluded.

```bash
# 1. Create experiment (returns experiment ID)
bun -e "import { createTuningExperiment } from './data/db';
  console.log(createTuningExperiment('methodology', 'description', {config}))"

# 2. Run benchmarks linked to experiment
EXPERIMENT_ID=9 BENCHMARK_SEEDS="romance-drama" bun benchmark/prose/run.ts

# 3. Record conclusion
bun -e "import { concludeExperiment } from './data/db';
  concludeExperiment(9, 'findings here')"
```

Tables: `tuning_experiments` (what/why/conclusion) → `runs` (experiment_id) → `generations` → `scores`

**Experiment types:** `probe`, `calibration`, `shootout`, `ab-test`, `methodology`, `experiment`, `system-test`
- Use `system-test` for smoke tests / system verification runs — keeps them separate from real tuning data
- `deleteExperiment(id)` handles full cascade cleanup (scores → generations → llm_calls → runs → experiment)

## Iterative Improvement Workflow

1. Create experiment in DB with description + config
2. `EXPERIMENT_ID=N BENCHMARK_SEEDS="romance-drama" bun benchmark/prose/run.ts` — focused test
3. `/diagnose` in Claude Code — analyze weak dimensions
4. Make ONE change (prompt.md, context.ts, or roles.ts)
5. `EXPERIMENT_ID=N BENCHMARK_SEEDS="romance-drama" bun benchmark/prose/run.ts` — measure delta
6. Record conclusion in DB with `concludeExperiment()`
7. If improved: commit with scores, run all seeds to verify generalization, `--save-baseline`
8. If flat/worse: revert, next suggestion

Commit format:
```
[agent:writer] Description of what changed

benchmark: 3.3 issues/dim (+-2.6) T:5.8 W:2.1 D:2.1 | norm: 3.0/1k T:5.2 W:1.9 D:1.9
delta: -0.5 vs baseline | 5 seeds x 3 runs | penalty mode
experiment: #9
```

Cost per iteration cycle: ~$0.03 (1 seed × 3 runs) / ~$0.06 (all seeds × 3 runs).

## Writing Methodology Integration

See `docs/methodology-integration-report.md` for the full report with 20 testable items.

**Primary test bed:** `romance-drama` (Love genre — most rigid conventions, cleanest character arc)
**Secondary:** `dark-fantasy` (Horror/Morality — generalization check)
**Writer model:** Kimi K2 (methodology rules only help capable models; Qwen3 32B showed no improvement)
