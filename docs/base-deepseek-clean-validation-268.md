---
status: concluded
date: 2026-04-30
experiment: 268
novel_id: novel-1777580634348
commit: 4efab0188498a4722119c4de1c7c3198ad04d3bb
---

# Base DeepSeek Clean Validation #268

## Verdict

NO-SHIP. Do not retire the Salvatore writer fallback on this run.

This run did answer the route-coupling question: base DeepSeek V4 Flash can run
inside the fantasy pack while using rich/default beat context and no Salvatore
leak checker. It did not clear the quality gate because the checker/approval
policy let visible story-logic and prose-integrity defects through.

Word count was not treated as a blocker. The more important finding is that
base DeepSeek's beat prose is naturally longer than the old LoRA route and the
current checker stack needs a chapter-level oracle / stricter approval policy
to separate acceptable expansion from real contradictions.

## Route Proof

- Run: `novel-1777580634348`
- Command shape: `EXPERIMENT_ID=268 WRITER_MODEL_OVERRIDE=deepseek-v4-flash WRITER_PROVIDER_OVERRIDE=deepseek WRITER_COMPACT_CONTEXT_OVERRIDE=false bun src/index.ts --auto --seed dark-fantasy --chapters 3`
- Drafting log: `Writer pack: salvatore-fantasy (deepseek-v4-flash, compact=false, leak=none)` for all chapters.
- SQL call routing: `beat-writer|deepseek|deepseek-v4-flash|75`.
- Salvatore leak checker calls: `0`.
- `halluc-ungrounded` calls: `75`.
- `adherence-events` calls: `75`.
- `lint-fix-rejected` events: `1`.

The `salvatore-fantasy` label remains because the route still uses the
Salvatore-derived fantasy structural priors and system prompt. It no longer
implies adapter inference, compact context, or Salvatore leak checking.

## Run Summary

- Wall clock: `18m34s`
- Cost: `$0.049086`
- LLM calls: `245` (`1` failed)
- Chapter word counts: chapter 1 `3322`, chapter 2 `2830` approved, chapter 3 `3022` approved
- Beat-writer shape: `75` calls, `118,641` input tokens, `68,197` output tokens, average `11.3s`

## Findings

### What improved

- Route decoupling worked: rich/default context was active (`compact=false`) while fantasy priors stayed in force.
- The lint integrity guard worked once: chapter 1 lint fix was rejected before it overwrote the raw draft.
- Base DeepSeek produced strong local atmosphere and a coherent dark-medical premise.

### Blockers

- **Checker signals were caught but accepted.** Harness log shows unresolved beat-level adherence/hallucination issues accepted after max retries in all chapters. Examples: chapter 1 accepted unresolved issues on beats 5, 6, 9, 11; chapter 2 on beats 5, 6, 7; chapter 3 on beats 5, 9, 10, 12.
- **Continuity blockers were diagnostic only.** Chapter 2 logged a blocker: Istra location violation. Chapter 3 logged a blocker: Wren location violation. Both chapters were auto-approved anyway.
- **Malformed dialogue reached approved prose.** Chapter 3 line 51 has missing opening quote, compressed speaker turns, and an extra trailing quote: `Then I will revoke your license myself." ... "That is the best I can offer.""`
- **Duplicate / seam artifacts reached approved prose.** Chapter 2 lines 35-39 repeat Wren's father setting her down and pleading. Chapter 3 lines 83-85 repeat `Istra opened her mouth`.
- **Location drift made scenes incoherent.** Chapter 3 begins in the Magistrate's Tower, moves to the apothecary with Wren, then later describes the same Wren scene as happening on the tower floor / inside tower stone walls.
- **Local fact contradictions remain.** Chapter 1 says Harold's fever drains after the on-page dose, then later says the flush had drained two days ago. Chapter 2 has active severe fever while also asking when the fever broke three nights earlier.
- **Ungrounded lore/name accretion persists.** The writer repeatedly introduces or mutates names and lore (`Harus`, `Malcolm Ashford`, `Nathara`, forbidden/ossuary/library knowledge). Some may be valid reveals if planned, but the current checker cannot distinguish a planned reveal from an invented one and the approval policy accepts residual fires.

## Classification

- **Writer-side:** longer-than-target beats, duplicate seams, malformed dialogue, local fact contradictions, phrase loops.
- **Planner-side:** beat specs ask for location/character states that downstream planned state then contradicts, especially Wren's location after chapter 2.
- **Checker-side:** beat checkers often detect issues but retries exhaust; the approval policy then accepts them. Continuity blockers are logged but non-blocking.
- **Lint-side:** post-fix corruption is now guarded for fused-boundary artifacts, but raw/fixed prose still needs quote/dialogue integrity checks.

## Policy Update

Treat word-count overshoot as a warning unless it breaks pacing or cost. Treat the following as blockers:

- Accepted unresolved adherence failure where required beat events are missing or inverted.
- Accepted unresolved hallucination involving named entities, places, institutions, texts, dates, or causal lore.
- Continuity issue with severity `blocker`.
- Malformed dialogue / unmatched quotes.
- Duplicate adjacent sentences or near-duplicate adjacent paragraphs.
- Scene/location contradiction that makes character movement impossible.

## Proposed Oracle Test

Create a checker-gap fixture from this run and assert that it fails validation.

Inputs:

- Approved chapter prose for `novel-1777580634348`.
- Chapter outlines / beat specs.
- Harness log or persisted beat-check results.

Oracle dimensions:

- `unresolved_checker_blockers`: fail if any beat exits with accepted unresolved blocker issues above threshold.
- `continuity_blocker_nonblocking`: fail if continuity emits blocker issues and the chapter is approved.
- `duplicate_span`: deterministic exact/near-duplicate adjacent sentence or paragraph detector.
- `quote_integrity`: deterministic unmatched quote / malformed dialogue detector.
- `scene_location_continuity`: independent chapter-level LLM oracle with quote-required evidence.
- `entity_grounding`: named entities and major lore must be planned, previously established, or introduced on-page with role/reason.
- `local_fact_consistency`: quote-required LLM oracle for contradictions within a chapter.

Minimal acceptance rule: validation can pass only if every blocker-class dimension is empty. Word count remains outside this blocker set.

## Next Step

Checker-oracle remediation started in exp #269. The smallest useful implementation is:

1. Make continuity `blocker` issues blocking in drafting approval. Implemented in exp #269.
2. Preserve unresolved beat-check blockers after retry exhaustion and route them to chapter failure / plan-assist instead of auto-approval. Implemented in exp #269.
3. Add deterministic quote-integrity and duplicate-span guards before chapter approval. Implemented in exp #269.
4. Add a chapter-level oracle fixture using `novel-1777580634348` before adding any new LLM checker surface. Still pending.
