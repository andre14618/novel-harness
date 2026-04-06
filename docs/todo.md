---
status: active
updated: 2026-04-05
---

# To Do

Items removed when done — git history has the record. Ordered by impact.

## Pipeline Stability

- Replace all zod enum constraints with z.string() for LLM label fields (category, relationship, type, level). Keep structural validation (shape/arrays), drop value validation. Every novel run hits 1-2 enum crashes.
- Deduplicate timeline events in DB — rewrite re-extractions create duplicate events that accumulate and bloat causal chain queries

## Context Quality

- Tighten fact extractor further — still 17-20/chapter, target 8-15. Model extracts scene detail ("faucet drips", "coffee in cup") despite prompt saying not to. May need few-shot examples or negative examples.
- Audit writer context weight (~8.5K tokens). Character profiles and prior chapter summaries are the biggest sections — evaluate whether full backstory/traits/fears are needed every chapter or if a shorter profile suffices.
- Word count below target (550-770 vs 800-1100). Unclear if context weight, model behavior, or prompt issue. Test with minimal context to isolate.
- Run context quality benchmark across 3 existing 10-chapter novels (runner exists at benchmark/context/run.ts)

## Context Engine

- Wire retrieval-config + deterministic-config as autoresearcher optimization targets via component registry

## Seeds & Testing

- Create 3-5 new seeds that stress different context layers: complex magic systems, many POV characters, dense continuity requirements

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
