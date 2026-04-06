---
status: active
updated: 2026-04-06
---

# To Do

Items removed when done — git history has the record. Ordered by impact.

## Context Engineering (primary focus)

Context quality is the main lever for prose improvement — better context means less room for the writer to drift. The context quality benchmark (5 dimensions with retrieval diagnostics) directly guides this work.

- **Run context quality benchmark across 3 existing 10-chapter novels** — establish baseline scores and identify weakest retrieval dimensions
- **Tighten fact extractor** — still 17-20 facts/chapter, target 8-15. Extracts scene detail despite prompt saying not to. May need few-shot or negative examples.
- **Audit writer context weight (~8.5K tokens)** — character profiles and prior chapter summaries are biggest sections. Identify what's noise vs essential.
- **Tune retrieval parameters per dimension** — use context benchmark diagnostics (similarity thresholds, character boost, recency decay) to optimize each of the 6 retrieval tables
- **Improve embedding templates** — context benchmark judges diagnose template gaps. Iterate templates via autoresearcher.
- Word count below target (550-770 vs 800-1100). May be context weight, model, or prompt issue — investigate after context audit.

## Adherence Checking (new — replaces prose penalty benchmark)

Experiment #90 showed the real quality axis is adherence to seed constraints (characters, premise, setting, genre, beats), not prose-level penalty counts. Penalty judges are noisy, don't discriminate, and have no corrective feedback path. Lint + tonal pass already handles AI clichés deterministically.

- **Build adherence checker** — fast small model checks each scene chunk against beat spec, character profiles, genre register. Returns pass/fail + specific deviation. Could be:
  - Deterministic: NER + keyword matching against seed JSON
  - Small model: Llama 8B on Groq (~50ms) with seed as rubric
  - Hybrid: deterministic first, model for nuanced checks (genre register, character voice consistency)
- **Chunked write-check loop** — writer generates per-beat (~300-500w), adherence checker validates before next beat. Fail → regenerate with deviation flagged. Fast iteration at low cost.
- **Archive prose penalty benchmark** — telling/dead-weight/dialogue judge dimensions are noisy (2-8x variance on re-judge), don't correlate with actual quality (MiMo scored similar but had real adherence failures), and have no corrective path. Keep infrastructure for macro trend tracking but remove from iteration loop.

## Lint & Tonal Pass

26 enabled patterns (17 AI_CLICHE, 5 HEDGE_QUALIFIER, 2 DECLARED_EMOTION, 1 EMOTIONAL_ECHO, 1 REDUNDANT_BODY). Proven Llama 8B tonal fix pipeline: 9/9 cliché fixes at 131ms/$0.05M.

- **Wire Llama 8B tonal pass into pipeline** — post-writer, before extraction. Integration point: after chapter generation, run lint → Llama 8B fixes flagged clichés → proceed to extraction with cleaned prose.
- **Finetuned paragraph-scale tonal model** — for rhythm monotony and sentence uniformity. Heuristic detection exists (archived patterns 68, 69) but fixing needs paragraph-scope, not sentence-level. LoRA on small model with curated before/after pairs.
- **Expand AI cliché patterns** — source from craft references (docs/ai-tells-*.md). Validate each against published fiction baseline (scripts/lint-baseline.ts).

## Cost Optimization

Real 10-chapter novel costs $0.63-$0.94 on Cerebras Qwen 235B. Rewriter is 24-32% of cost, extractors ~45%.

- **Deploy MiMo Flash for extractors** — tested equal on summary-extractor, fact-extractor, character-state, graph-linker (exp #88). Equal/better on continuity (exp #89). Saves ~$0.28/novel. Roles.ts already updated.
- **Keep relationship-timeline on Qwen 235B** — MiMo Flash missed knowledge gains. Knowledge gaps compound through retrieval.
- Evaluate DeepSeek V3.2 as rewriter — 95% prefix caching on 10K avg prompt tokens could cut rewriter cost. Pacing issue may not matter for rewrites where structure is set.

## Rewriter Architecture

- **Strip anti-pattern list from rewriter prompt** — rewriter can't self-police clichés (proven). Lint + tonal pass handles this.
- **Skip re-extraction for prose-only rewrites** — if rewrite only fixes cosmetic issues, extraction results are still valid. Saves $0.03/rewrite.
- Investigate reducing rewrite trigger threshold — currently too aggressive, 22-28 calls/novel.

## Pipeline Stability

- Deduplicate timeline events in DB — rewrite re-extractions create duplicate events
- Clean up stale DB data: 5 incomplete novels, 35 orphan benchmark runs, 35 experiments without conclusions

## Benchmarks — What Remains Active

| Benchmark | Status | Why |
|-----------|--------|-----|
| **Context quality** | **Active** | 5 dims with retrieval diagnostics. Primary optimization target. |
| **Continuity** | **Active** | Stable signal, concrete metrics, low cost. |
| **Lint + tonal pass** | **Active** | Deterministic + Llama 8B. Proven pipeline. |
| Prose penalties | Archived | Noisy, no corrective path, superseded by lint + adherence. |
| Extraction scores | Archived | Ceiling effect (all models score 8.0). Direct output comparison more useful. |
| Planning scores | Archived | 1-10 ceiling effect. Adherence checking is better signal. |
| Pairwise | Archived | Position bias. Only useful for substantially different variants. |
| Quality dims | Archived | Zero discrimination (flat 8/10 across all models). |

## Autoresearcher

- Rename daemon → autoresearcher across codebase
- Focus autoresearcher on context-quality dimensions — retrieval parameters, embedding templates, context templates
- Remove prose penalty dimensions from autoresearcher optimization targets

## Infrastructure

- Add context inspection view to web UI (show what the writer received for a chapter)
- Upgrade pgvector to 0.7+ on LXC for halfvec support (enables 3072-dim embeddings)

## Seeds & Testing

- Create 3-5 new seeds stressing different context layers: complex magic systems, many POV characters, dense continuity
