---
status: stopped
updated: 2026-05-03
role: lane
session: 2026-05-03-step-2a-planner-canon-integrity
charter: docs/charters/world-bible-architecture.md
experiment: none-local-harness
predecessor: docs/sessions/2026-05-03-canon-substrate-postgres-adapter.md
---

# Lane — Step 2A Planner Canon Integrity

## Session-Start Contract

### 1. Goal + component

Build the first Bible-Input Integrity grading harness for planner-output Canon claims against the Salvatore manual Canon fixture.

### 2. Why

Charter Step 2 says no source should write Canon until precision, recall, and F1 are measured; Step 1 made committed Canon durable, but a durable substrate is harmful if planner inputs poison it.

### 3. What is measurable

The lane works if a deterministic local command grades planner-output claims against `tests/canon/fixtures/salvatore-crystal-shard.canon.json`, reports TP/FP/FN and precision/recall/F1 by category, and states whether planner-output can write Canon directly, requires human review, or needs redesign.

### 4. Validated gates

- **(a) Clean pass:** harness + tests land, targeted tests pass, `bunx tsc --noEmit` passes, Salvatore grading produces a report.
- **(b) New dominant blocker:** the Salvatore manual Canon does not contain enough planner-output provenance to reach the Step 2 sample floor; report the sample-size blocker instead of forcing a verdict.
- **(c) Regression:** §0a Salvatore recall or canon substrate tests regress; stop and fix or document pre-existing failure.
- **(d) Infrastructure failure:** local test/TypeScript commands fail for unrelated environment reasons; record the failure and do not infer source quality.
- **(e) Budget cap:** no runtime LLM/API calls or paid actions; all grading is deterministic.

## Results

- Built `src/canon/planner-integrity.ts`, a deterministic Step 2 Bible-Input Integrity harness that compares emitted Canon claims against a complete manual Canon reference and reports TP/FP/FN plus precision/recall/F1 overall and by category.
- Added `scripts/audits/run-planner-integrity.ts`, which loads `tests/canon/fixtures/salvatore-crystal-shard.canon.json`, validates it, runs the planned-origin proxy audit, and prints human-readable or `--json` reports.
- Added `sourceEvidenceGateClear` so diagnostic proxy evidence cannot accidentally promote live planner direct writes.
- Stop gate (b) fired: no persisted live planner-output Canon-claim fixture exists, and the Salvatore planned-origin proxy misses the recall floor. Planner-output direct Canon writes remain blocked.

Step 2A Salvatore planned-origin proxy result:

| Metric | Value |
|---|---:|
| emittedCount | 50 |
| referenceCount | 89 |
| truePositives | 50 |
| falsePositives | 0 |
| falseNegatives | 39 |
| precision | 1.000 |
| recall | 0.562 |
| F1 | 0.719 |
| sampleGateClear | yes |
| sourceEvidenceGateClear | no |
| recallGateClear | no |
| recommendation | insufficient-sample |

Category rollup:

| Category | TP | FP | FN | Precision | Recall | F1 |
|---|---:|---:|---:|---:|---:|---:|
| established_fact | 32 | 0 | 25 | 1.000 | 0.561 | 0.719 |
| knowledge_change | 0 | 0 | 6 | 0.000 | 0.000 | 0.000 |
| character_state | 0 | 0 | 8 | 0.000 | 0.000 | 0.000 |
| promise | 8 | 0 | 0 | 1.000 | 1.000 | 1.000 |
| payoff | 1 | 0 | 0 | 1.000 | 1.000 | 1.000 |
| story_promise | 9 | 0 | 0 | 1.000 | 1.000 | 1.000 |

## Evidence

- `bun test src/canon/planner-integrity.test.ts` - 8 pass / 0 fail.
- `bun test src/canon/` - 190 pass / 0 fail.
- `bunx tsc --noEmit` - clean.
- `bun scripts/audits/run-planner-integrity.ts` - report generated; `recommendation=insufficient-sample`.
- `bun scripts/audits/run-salvatore-recall.ts` - §0a unchanged: `queryCount=42`, `meanRecall=0.927`, `recallGateClear=YES`, `tokenCapExceeded=0`.
- `git diff --check` - clean.

## Cost

No runtime LLM/API cost.
