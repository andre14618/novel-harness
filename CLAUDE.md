# Novel Harness

AI-assisted novel creation harness — deterministic code controls flow, LLMs are leaf-node function calls.

## Stack

- Runtime: Bun
- LLM: StepFun Step 4.5 Flash via OpenRouter
- DB: bun:sqlite (one DB per novel at output/{novelId}/novel.db)
- Interface: CLI

## Architecture

State machine with 3 phases: concept → planning → drafting. Each phase is a function. The LLM is called via `callAgent()` in `src/llm.ts` — always with a Zod schema for structured output.

## Running

```
bun src/index.ts              # new novel
bun src/index.ts --resume ID  # resume existing
```
