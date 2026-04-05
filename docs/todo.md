---
status: active
updated: 2026-04-05
---

# To Do

Items removed when done — git history has the record. Ordered by impact.

## Context Engine

- Build context quality benchmark runner (`benchmark/context/run.ts`)
- Run 10+ chapter novel to validate retrieval at scale
- Wire retrieval-config + deterministic-config as autoresearcher optimization targets via component registry

## Seeds & Testing

- Create 3-5 new seeds that stress different context layers: complex magic systems, many POV characters, dense continuity requirements
- Extend seeds to support 10-20 chapter novel plans (current seeds produce 3 chapters)

## Autoresearcher

- Wire context quality benchmark as primary autoresearcher target
- Wire component registry into autoresearcher so it reads available surfaces
- Add embedding template tuning as an autoresearcher surface
- Add scene query template tuning as an autoresearcher surface
- Rename daemon → autoresearcher across codebase
- Test autoresearcher on context-quality dimensions end-to-end

## Lint & Rewriter

- Continue lint pattern expansion from craft references
- Tune rewriter prompt via autoresearcher on prose penalty dimensions

## Infrastructure

- Upgrade pgvector to 0.7+ on LXC for halfvec support (enables 3072-dim embeddings)
- Add context inspection view to web UI (show what the writer received for a chapter)
- Evaluate fine-tuning small models for rewrites and tone mimicry (after 20+ chapter novels running reliably)
