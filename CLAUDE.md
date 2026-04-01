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
  config.ts         ← writer/judge model selection (env-driven)
  db.ts             ← re-exports from central data/db.ts
  calibrate.ts      ← judge model calibration (discrimination, consistency, TPS)
  prose/            ← writer output quality
    run.ts          ← Show/Tell, Dialogue, Sensory
    judges/         ← rubric .md per dimension + schema.ts
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

All benchmark data goes to central `data/harness.db`. Every LLM call logged with agent, model, tokens, TPS, cost.

### Central data layer

```
data/
  db.ts           ← central operational DB schema + all query functions
  harness.db      ← the DB file (gitignored)
```

Tables: `runs`, `run_agents`, `llm_calls`, `generations`, `scores`, `baselines`

Key queries:
- `getModelStats()` — global per-model cost, TPS, call count
- `getAgentStats()` — per-agent cost and performance
- `getAgentModelScores()` — cross-run comparison of agent+model combos
- `compareRuns()` — diff two runs (config changes, score deltas, cost)
- `getCallSummary()` — per-agent breakdown for a specific run

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
- `epic-fantasy.json` — disgraced general, empire built on a lie
- `sci-fi-thriller.json` — generation ship, lying navigation AI
- `minimal.json` — locksmith, door that shouldn't exist
- `noir-mystery.json` — retired detective, letter from a murder victim
- `historical-drama.json` — court translator in 1920s Istanbul

## Backups

Pre-commit hook (`scripts/backup-dbs.sh`) safely backs up all SQLite DBs to `backups/` using `sqlite3 .backup` (WAL-safe). Keeps last 20 timestamped snapshots per DB.

## Judge Calibration Results

Tested 2026-04-01. Only Qwen3 32B discriminates reliably at low cost:

| Judge | Discrimination | Consistency | Speed | Cost (45 calls) |
|-------|---------------|-------------|-------|-----------------|
| **Qwen3 32B (Groq)** | **100%** | 0.3 spread | 662 tok/s | $0.040 |
| Gemini 3 Flash (OR) | 100% | 0.0 spread | — | $0.135 |
| DeepSeek V3.2 | 67% | 0.2 spread | 27 tok/s | $0.033 |
| Kimi K2 (Groq) | 67% | 0.3 spread | — | — |
| Llama 3.3 70B (Groq) | 33% | 0.0 spread | 150 tok/s | — |
| GPT-5.4-mini (OpenAI) | 33% | 0.6 spread | — | — |
| Qwen3 235B (Cerebras) | 33% | 0.0 spread | — | — |
| GPT-OSS 120B (Cerebras) | 0% | 0.2 spread | 551 tok/s | — |

Pattern: models >32B score MID=STRONG (can't detect improvement). May be fixable with count-based rubric revisions.

## Iterative Improvement Workflow

1. `bun benchmark/prose/run.ts --save-baseline` — establish baseline
2. `/diagnose` in Claude Code — analyze weak dimensions
3. Make ONE change (prompt.md, context.ts, or roles.ts)
4. `BENCHMARK_JUDGES="Qwen3 32B" bun benchmark/prose/run.ts` — measure delta
5. If improved: commit with scores, `--save-baseline`
6. If flat/worse: revert, next suggestion

Commit format:
```
[agent:writer] Description of what changed

benchmark: 18.5/30 (+-2.1) S:5.8 D:6.0 X:6.7
delta: +1.4 vs baseline | 5 seeds x 3 runs
```

Cost per iteration cycle: ~$0.04 (single judge, 5 seeds × 3 runs). See `docs/iteration.md` for the full improvement pathway and `docs/batch-processing.md` for async cost reduction strategies.
