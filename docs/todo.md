---
status: active
updated: 2026-04-06
---

# To Do

Items removed when done — git history has the record. Ordered by impact.

## Cost Optimization (active)

Real 10-chapter novel costs $0.63-$0.94 on Cerebras Qwen 235B. Rewriter is 24-32% of cost ($0.13-0.23/novel), extractors are ~45%.

- **Deploy MiMo Flash for extractors** — tested equal on summary-extractor, fact-extractor, character-state, graph-linker (exp #88). Tested equal/better on continuity + cross-chapter-continuity (exp #89, 9.0 detection vs 8.8). Saves ~$0.28/novel (~47% of extraction cost). Roles.ts already updated.
- **Keep relationship-timeline on Qwen 235B** — MiMo Flash missed 2/5 knowledge gains and 1/2 awareness changes on chapter 5 test. Knowledge gaps compound through retrieval pipeline.
- Test MiMo Flash on prose-quality validator — untested, $0.04/novel at stake
- Test DeepSeek V3.2 as rewriter — currently $0.0024/call vs $0.0072 on Cerebras, plus DeepSeek gets 95% prefix caching. Rewriter has 10K avg prompt tokens so caching matters.

## Rewriter Architecture

Rewriter is the single most expensive agent (24-32% of novel cost, 22-28 calls per 10-chapter novel). Each rewrite triggers full re-extraction ($0.03). Experiments showed it introduces as many dead-weight issues as it fixes (exp #34: dead-weight +10.0 after rewriting).

- **Validate deterministic lint post-pass** — exp 68's 51.7% collateral was a measurement bug (character-level diff, fixed in exp 69 → 0.1%). Run on 3 recent novel chapters to confirm safety, then wire as post-pass after rewriter.
- **Strip "do NOT introduce" anti-pattern list from rewriter prompt** — rewriter can't self-police cliches (proven). Let deterministic lint handle cosmetic cleanup.
- **LLM prose tone and rhythm fine-tune** — targeted per-window LLM rewriting for rhythm monotony. Sentence-level is wrong scope (rhythm is cross-sentence). Window of 3-5 sentences needed. Blocked on: context piping finalization. Per-sentence context-aware fixes work (exp #71) but rhythm needs different approach.
- Investigate skipping re-extraction for prose-only rewrites — if rewrite only fixes cosmetic issues (no plot/character changes), extraction results are still valid

## Pipeline Stability

- Deduplicate timeline events in DB — rewrite re-extractions create duplicate events that bloat causal chain queries
- Clean up stale DB data: 5 incomplete novels (concept/planning phase), 35 orphan benchmark runs, 35 experiments without conclusions

## Context Quality

- Tighten fact extractor — still 17-20/chapter, target 8-15. Extracts scene detail despite prompt saying not to. May need few-shot or negative examples.
- Audit writer context weight (~8.5K tokens). Character profiles and prior chapter summaries are biggest sections.
- Word count below target (550-770 vs 800-1100). Unclear if context weight, model, or prompt issue.
- Run context quality benchmark across 3 existing 10-chapter novels

## Writer Model

DeepSeek V3.2 is the best tested writer — lowest telling on average (~6.0), consistent dialogue quality. But high variance (telling swings 2.5-14.5). Kimi K2 clearly worse (dead-weight 25-80 in older runs). Qwen 235B never properly benchmarked as writer with independent judge. No better candidates at DeepSeek's price tier ($0.28/$0.42 + 95% cache).

- Benchmark Qwen 235B as writer with DeepSeek judge to get a real comparison
- Evaluate whether DeepSeek should replace Cerebras for writing + rewriting (cheaper per-token, 95% prefix caching on repeated prompts)

## Seeds & Testing

- Create 3-5 new seeds stressing different context layers: complex magic systems, many POV characters, dense continuity

## Autoresearcher

- Rename daemon → autoresearcher across codebase
- Test autoresearcher on context-quality dimensions end-to-end

## Lint

- Continue lint pattern expansion from craft references
- Validate that lint patterns are calibrated against published fiction (baseline script exists at scripts/lint-baseline.ts)

## Infrastructure

- Add context inspection view to web UI (show what the writer received for a chapter)
- Upgrade pgvector to 0.7+ on LXC for halfvec support (enables 3072-dim embeddings)
