---
status: stopped
updated: 2026-05-03
role: lane
session: 2026-05-03-step-2c-live-planner-semantic-labeling
charter: docs/charters/world-bible-architecture.md
experiment: none-local-llm-panel
predecessor: docs/sessions/2026-05-03-step-2b-live-planner-canon-delta.md
---

# Lane - Step 2C Live Planner Semantic Labeling

## Session-Start Contract

### 1. Goal + component

Build and run an overlapping DeepSeek V4 Flash / V4 Pro semantic labeling panel over the live planner Canon delta from generated `chapter_outlines`.

### 2. Why

Step 2B proved the live ID graph is mechanically coherent on `novel-1777786463873` (`idGraphGateClear=YES`, 30 source items, 30 obligations), but it did not prove the facts/knowledge/state content attached to those IDs is semantically safe for direct Canon writes.

### 3. What is measurable

The lane works if a local command builds a cache-shaped judging packet from the live outline/prose artifacts, runs overlapping V4 Flash and V4 Pro labels for each emitted source item plus a missing-item pass, aggregates agreement/disagreement, and reports which rows need human confirmation before precision/recall/F1 can be finalized.

### 4. Validated gates

- **(a) Clean pass:** harness lands, schema validation and aggregation tests pass, typecheck passes, and a bounded overlap panel runs with persisted JSON output.
- **(b) New dominant blocker:** model agreement is too low or missing-item generation is too unstable to trust without a stronger human-labeling protocol; record blocker instead of claiming planner safety.
- **(c) Regression:** existing canon tests, Step 2B live-ID audit, or §0a recall regress; stop and fix or document pre-existing failure.
- **(d) Infrastructure failure:** LLM/API or DB access fails; persist partial artifacts and do not infer semantic quality.
- **(e) Budget cap:** initial run target is under $2 if possible; if actual projected run exceeds that, user has explicitly authorized a larger statistical-confidence run in this conversation, but record cost and stop before runaway retries.

## Results

Stop gate (a) clean panel run achieved. The harness built a cache-shaped judging packet from the live `chapter_outlines` artifact for `novel-1777786463873`, ran overlapping DeepSeek V4 Flash / V4 Pro labels, persisted raw calls + aggregate JSON, and produced a human-confirmation queue.

Panel artifact: `docs/artifacts/planner-semantic-labeling-novel-1777786463873-2026-05-03T221815312Z.json`.

Headline output:

- source items judged: 30/30 live planner/state IDs.
- model calls: 128 total, 126 schema-valid, 2 schema-invalid but captured as failed rows.
- emitted item consensus: 29 `direct_write` consensus, 0 `human_review`, 0 `reject`; 2 item rows still need human review, so review-free direct-write candidates are 28.
- cross-route agreement: safety 0.967, verdict 0.967.
- missing-item candidates: 21, all require human review because conservative deterministic aggregation no longer merges semantic paraphrases.
- human-confirmation queue: 26 rows (2 emitted items, 21 missing candidates, 3 direct-write spot checks).

Direct planner Canon writes remain blocked. This panel is strong evidence that the emitted ID content is mostly semantically plausible, but recall cannot be finalized until the missing-candidate queue is human-confirmed or explicitly LLM-adjudicated by a separate semantic matching pass.

## Evidence

- `bun scripts/audits/run-live-planner-semantic-labeling.ts --latest --max-concurrency=3` completed and wrote the artifact above.
- `llm_calls` run id: 681.
- Provider-reported cache accounting from `llm_calls`: Flash 96 calls, 1,923,762 prompt tokens, 1,904,640 cached tokens, cache ratio 0.9901; Pro 32 calls, 641,254 prompt tokens, 627,840 cached tokens, cache ratio 0.9791.
- Failed call rows: `62633` (`know-maret-physical-assessment`, Flash sample 2, invalid evidence source enum `fact`) and `62707` (chapter-1 missing pass, Pro sample 1, invalid evidence source enum `state`). Both are logged and reflected as failed panel calls.
- Conservative missing aggregation fixture added: semantic paraphrases such as “hand heals almost instantly” vs “hand rapidly heals” remain separate human-review candidates rather than being merged by token overlap.
- Verification before the panel: `bun test src/canon/planner-semantic-labeling.test.ts src/canon/planner-canon-delta.test.ts src/canon/planner-integrity.test.ts` passed; `bun test src/canon/` passed; `bunx tsc --noEmit` clean; `git diff --check` clean.

## Cost

Full panel run cost: `$0.2756` recorded in `llm_calls` for run 681.

Token accounting: 2,565,016 prompt tokens, 132,076 completion tokens, 2,532,480 cached tokens, combined cache ratio 0.9873.

The prior smoke run (run 680) warmed the same stable prefix, so the full run had provider-reported cache hits from the first call. The stable user prefix hash was `b2d463ef5310...`; the runner stores the full hash in the artifact.
