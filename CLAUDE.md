# Novel Harness

AI-assisted novel creation harness — deterministic code controls flow, LLMs are leaf-node function calls. Produces a 3-chapter short story (one chapter per act) for rapid iteration on agent tuning.

## Stack

- Runtime: Bun
- LLM: Configurable per-agent. Default: Cerebras Qwen3 235B-A22B or Groq Qwen3 32B. Set `LLM_PROVIDER` in .env, override per-agent in config.ts.
- DB: bun:sqlite (one DB per novel at `output/{novelId}/novel.db`)
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
  config.ts     ← temperature, maxTokens, thinking, optional provider/model override
  index.ts      ← barrel export + prompt loader
```

**Concept phase:** world-builder, character-agent, plotter
**Planning phase:** planning-plotter
**Drafting phase:** writer, continuity
**State extraction:** summary-extractor, fact-extractor, character-state
**Validation phase:** cross-chapter-continuity, prose-quality, rewriter

### DB modules

Split by domain in `src/db/`:

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
  pricing.ts    ← per-provider token pricing for cost tracking
```

### Provider system

Three providers supported: `cerebras`, `groq`, `openrouter`. Set globally via `.env` or per-agent in config.ts:

```ts
// src/agents/writer/config.ts — use premium model for creative work
export const config = {
  name: "writer",
  temperature: 0.8,
  maxTokens: 16384,
  thinking: false,
  provider: "cerebras",  // optional override
}
```

## Running

```bash
# Novel creation
bun src/index.ts --auto                    # default seed (epic-fantasy)
bun src/index.ts --auto --seed sci-fi-thriller  # different seed
bun src/index.ts --resume novel-123456     # resume from checkpoint

# Benchmarking (iterative prompt improvement)
bun scripts/benchmark.ts                   # run benchmark (5 seeds × 3 runs × 3 judges)
bun scripts/benchmark.ts --save-baseline   # save current scores as baseline
BENCHMARK_PROVIDER=groq bun scripts/benchmark.ts  # use specific provider
bun scripts/benchmark.ts --skip-diagnostic # skip GPT-5.4 diagnostic pass

# Model comparison
bun scripts/compare-models.ts              # compare all available providers
bun scripts/compare-models.ts --skip-judge # skip LLM evaluation

# Cost analysis
bun scripts/cost-summary.ts               # most recent novel
bun scripts/cost-summary.ts novel-123456   # specific novel
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

1. Edit an agent's `prompt.md`
2. Run `bun scripts/benchmark.ts`
3. Compare scores to baseline
4. Commit with benchmark scores in the message:
   ```
   [agent:writer] Add backstory prohibition rule

   benchmark: 29.5/50 (±3.8) S:5.2 D:5.8 V:6.1 B:6.0 X:5.9
   delta: +2.4 vs baseline | 3 seeds × 3 runs
   ```
5. Run `bun scripts/benchmark.ts --save-baseline` if keeping the change

Benchmark costs ~$0.05/run. See `docs/iteration.md` for the full improvement pathway.
