---
status: active
updated: 2026-04-05
---

# To Do

Items removed when done — git history has the record. Ordered by impact.

## Context Engine (Highest Priority)

- Replace heuristic context layers 4-9 with semantic retrieval from `src/db/retrieval.ts`
- Build deterministic graph-linker layer (knowledge propagation origins, theme keyword matching, causal co-occurrence heuristics) — LLM only for ambiguous cases
- Fix relationship-timeline schema to accept non-enum category values gracefully
- Build context quality benchmark runner (`benchmark/context/run.ts`)
- Run 10+ chapter novel to validate retrieval at scale
- Wire retrieval-config as daemon optimization target

## Seeds & Testing

- Create 3-5 new seeds that stress different context layers: complex magic systems, many POV characters, dense continuity requirements
- Extend seeds to support 10-20 chapter novel plans (current seeds produce 3 chapters)

## Daemon & Auto-Research

- Wire context quality benchmark as primary daemon target
- Add embedding template tuning as a daemon surface (config file the daemon can modify)
- Add scene query template tuning as a daemon surface
- Test daemon on context-quality dimensions end-to-end

## Lint & Rewriter

- Continue lint pattern expansion from craft references
- Tune rewriter prompt via daemon on prose penalty dimensions

## Infrastructure

- Upgrade pgvector to 0.7+ on LXC for halfvec support (enables 3072-dim embeddings)
- Add context inspection view to web UI (show what the writer received for a chapter)
- Evaluate fine-tuning small models for rewrites and tone mimicry (after 20+ chapter novels running reliably)
