---
status: active
updated: 2026-04-05
---

# Improvement To-Do

Living document. Items are removed when completed — git history has the record. Ordered by impact.

## Context Engine (Highest Priority)

- Wire embedding step into `updateStateAfterChapter()` — call `harness.embeddings.embedChapterData()` after extraction
- Wire graph-linker agent into `updateStateAfterChapter()` — run after embedding
- Add `graph-linker` to `models/roles.ts` agent assignments
- Replace heuristic context layers 4-9 with semantic retrieval from `src/db/retrieval.ts`
- Build context quality benchmark runner (`benchmark/context/run.ts`)
- Run 10+ chapter novel to validate retrieval at scale
- Wire retrieval-config as daemon optimization target

## Seeds & Testing

- Create 3-5 new seeds that stress different context layers: complex magic systems (layer 4), many POV characters (layers 2-3), dense continuity requirements (layer 9)
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
