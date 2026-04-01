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
  registry.ts   ← all available models, providers, pricing, specs (informational)
  roles.ts      ← which model each agent uses (one file to change)
```

Per-agent model assignment in `models/roles.ts`:

```ts
export const AGENT_MODELS = {
  "writer":                    groqQwen32B,
  "rewriter":                  groqQwen32B,
  "world-builder":             groqQwen32B,
  "character-agent":           groqQwen32B,
  "plotter":                   groqQwen32B,
  "planning-plotter":          groqQwen32B,
  "summary-extractor":         groqQwen32B,
  "fact-extractor":            groqQwen32B,
  "character-state":           groqQwen32B,
  "continuity":                groqQwen32B,
  "cross-chapter-continuity":  groqQwen32B,
  "prose-quality":             groqQwen32B,
}
```

Resolution order: `models/roles.ts` → `.env` global default → fallback to `qwen/qwen3-32b`.

### Benchmark system

```
benchmark/
  config.ts         ← shared writer/judge model selection
  db.ts             ← shared SQLite DB (benchmark_type distinguishes benchmarks)
  calibrate.ts      ← judge model calibration test
  prose/            ← writer output quality
    run.ts          ← bun benchmark/prose/run.ts
    judges/         ← Show/Tell, Dialogue, Sensory
  planning/         ← planning-plotter output quality
    run.ts          ← bun benchmark/planning/run.ts
    judges/         ← Beat Specificity, Dialogue Cues, Emotional Arc
  extraction/       ← extractor accuracy and completeness
    run.ts          ← bun benchmark/extraction/run.ts
    judges/         ← Completeness, Accuracy
  continuity/       ← continuity checker detection rate
    run.ts          ← bun benchmark/continuity/run.ts
    judges/         ← Issue Detection, Fix Quality
    fixtures/       ← JSON test cases with planted contradictions
```

Each benchmark type has its own `run.ts`, judges/rubrics, and scoring dimensions. All share the same SQLite DB tagged by `benchmark_type`. All LLM calls are logged with cost and TPS.

### DB modules

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

### Central data layer

```
data/
  db.ts           ← central operational DB (all LLM calls, run configs, scores)
  harness.db      ← the DB file (gitignored)
```

All LLM calls from both novel runs and benchmarks go here. Queryable across all runs:
- `getModelStats()` — global per-model cost, TPS, call count
- `getAgentStats()` — per-agent cost and performance
- `getAgentModelScores()` — cross-run comparison of agent+model combos
- `compareRuns()` — diff two runs (config changes, score deltas, cost)

### Config

```
src/config/
  pipeline.ts   ← maxDraftAttempts, maxValidationPasses, maxChapterRewrites
  pricing.ts    ← re-exports from models/registry.ts
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
bun benchmark/continuity/run.ts            # continuity detection (Detection, Fix Quality)
bun benchmark/prose/run.ts --save-baseline # save scores as baseline (works for all types)
BENCHMARK_PROVIDER=groq bun benchmark/prose/run.ts     # use specific provider
BENCHMARK_JUDGES="Gemini 3 Flash,Qwen3 32B" bun benchmark/prose/run.ts  # specify judges

# Judge calibration
bun benchmark/calibrate.ts                 # test all available models as judges
CALIBRATE_MODELS="GPT-OSS,Scout" bun benchmark/calibrate.ts  # test specific models

# Cost & performance analysis
bun scripts/cost-summary.ts               # most recent run
bun scripts/cost-summary.ts 5             # specific run by ID
bun scripts/cost-summary.ts --global      # all-time model/agent/phase stats
bun scripts/cost-summary.ts --runs novel  # list recent novel runs
bun scripts/cost-summary.ts --runs prose-benchmark  # list recent prose benchmarks
```

## Logging

Each novel run produces:
- `output/{novelId}/harness.log` — human-readable phase/checkpoint log
- `output/{novelId}/llm-calls.jsonl` — structured per-call log (timing, tokens, cost, validation chain, errors)

Every LLM call shows cost in real-time: `[LLM] Response: 450+1200 tokens ($0.0017)`

## Testing

```bash
bun test     # 148 tests across 8 files
```

## Seeds

Test inputs in `src/seeds/`:
- `epic-fantasy.json` — disgraced general, empire built on a lie
- `sci-fi-thriller.json` — generation ship, lying navigation AI
- `minimal.json` — locksmith, door that shouldn't exist
- `noir-mystery.json` — retired detective, letter from a murder victim
- `historical-drama.json` — court translator in 1920s Istanbul

## Iterative Improvement Workflow

1. Edit an agent's `prompt.md` or `context.ts`, or change a model in `models/roles.ts`
2. Run `bun benchmark/prose/run.ts`
3. Compare scores to baseline
4. Run `/diagnose` in Claude Code for analysis of weak dimensions
5. Commit with benchmark scores:
   ```
   [agent:writer] Add backstory prohibition rule

   benchmark: 18.5/30 (+-2.1) S:5.8 D:6.0 X:6.7
   delta: +1.4 vs baseline | 5 seeds x 3 runs
   ```
6. Run `bun benchmark/prose/run.ts --save-baseline` if keeping the change

See `docs/iteration.md` for the full improvement pathway.
