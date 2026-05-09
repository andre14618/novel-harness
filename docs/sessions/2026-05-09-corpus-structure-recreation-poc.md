---
status: active
updated: 2026-05-09
role: session-record
lane: upstream-planning-methodology
---

# Corpus Structure Recreation POC Slice

## Change Packet

- Optimized layer: upstream concept/planning methodology.
- Exact change: create a diagnostic path for turning the local corpus novel's
  Stage 6 structural annotations into a chapter/scene reference scaffold.
- Held constant: production planner, writer, checker policy, UI, proposals,
  and runtime defaults.
- Expected benefit: make the intended planner granularity concrete before
  testing new planner prompts or prose generation.
- Downstream projection: if the planner can recreate comparable structure from
  compressed premise/context, then scene-first writing and scene-scoped
  checking have a realistic target.
- Evidence gate: local reference report first, then planner recreation
  attempt, then operator side-by-side review, then optional prose POC.

## Implemented

- Added `docs/charters/corpus-structure-recreation-poc.md`.
- Added `scripts/evals/corpus-structure-reference.ts`.
- Added `diagnostics:corpus-structure-reference`.
- Added a focused unit test for the reference aggregation.
- Updated methodology docs to treat corpus structure recreation as a high-value
  diagnostic option while keeping old corpus beats as annotation granularity,
  not the future writer call unit.

## Source Boundary

The corpus reference may include source-derived plot summaries only in ignored
`output/` artifacts. Committed docs describe the method, schema, metrics, and
decision gates, not the source novel's full outline.

## First Local Run

Metrics-only command:

```bash
bun run diagnostics:corpus-structure-reference -- \
  --novel salvatore-icewind-dale \
  --book crystal_shard \
  --output-dir output/corpus-structure-reference/crystal_shard
```

Private structural-review command:

```bash
bun run diagnostics:corpus-structure-reference -- \
  --novel salvatore-icewind-dale \
  --book crystal_shard \
  --include-summaries \
  --output-dir output/corpus-structure-reference/crystal_shard-with-summaries
```

## Next

Run the reference report, inspect the chapter/scene granularity, then design a
default-off planner recreation diagnostic:

```text
compressed corpus premise/context
  -> generated chapter/scene planner contract
  -> structural comparison against the reference
  -> operator side-by-side decision
```
