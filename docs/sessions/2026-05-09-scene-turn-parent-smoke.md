# Scene Turn Parent Smoke

Date: 2026-05-09
Lane: L093 run/thread drafting coherence

## Command

```bash
bun scripts/evals/corpus-recreation-poc.ts --chapter 2 --output-dir output/corpus-recreation-poc/scene-turn-smoke-ch2-20260509 --live --model deepseek-v4-flash
bun scripts/evals/corpus-recreation-thread-map.ts output/corpus-recreation-poc/scene-turn-smoke-ch2-20260509 --output output/corpus-recreation-poc/scene-turn-smoke-ch2-20260509/thread-map.md --json output/corpus-recreation-poc/scene-turn-smoke-ch2-20260509/thread-map.json
bun scripts/evals/corpus-recreation-readiness.ts output/corpus-recreation-poc/scene-turn-smoke-ch2-20260509 --output output/corpus-recreation-poc/scene-turn-smoke-ch2-20260509/readiness.md --json output/corpus-recreation-poc/scene-turn-smoke-ch2-20260509/readiness.json
```

## Result

- Planner prompt version: `scene-turn-parents-v3`.
- The planner emitted 4 `sceneTurns` and 8 obligation-level `sceneTurnId`
  refs.
- Deterministic scene-turn validation found 0 unknown, duplicate, or
  cross-scene turn refs.
- The thread map rendered scene-turn rows and `sceneTurn` impact refs.
- Readiness preserved `sceneTurnIds` in the manual `THREADREF-1` candidate.

## Finding

Scene-turn parents make multi-obligation causal turns graph-ready, but they do
not automatically fix cross-thread promise misuse. The smoke still produced one
mismatch: `obl-ch02-sc01-tovin-offer` used `thread-tovin-leverage` with
`promiseId=debt-oathmark`, whose true thread is
`thread-oathmark-public-accountability`.

## Next

The next value-added planner slice should explicitly teach or repair this
pattern: when one scene turn affects relationship leverage and an oath/key
promise, keep the shared `sceneTurnId` but split child obligations so each child
uses only refs from its own thread.

## Follow-Up

Implemented prompt version `scene-turn-child-thread-v4`:

- Added an explicit sibling-child rule: a shared `sceneTurnId` does not license
  copying a promise/payoff ref onto another thread's child obligation.
- Added deterministic parser normalization for empty optional ref strings,
  matching the existing `null` normalization path.

First v4 smoke parse-failed because the model emitted empty strings for optional
refs. After normalization, the rerun at
`output/corpus-recreation-poc/scene-turn-v4-smoke-ch2b-20260509` passed:

- 4 `sceneTurns`;
- 4 obligation-level scene-turn refs;
- 0 scene-turn ref issues;
- 4/4 scenes with known thread refs;
- 0 plan comparison issues;
- thread map issues: 0;
- readiness groups: 0.

## Three-Chapter Check

Ran planner-only v4 smokes for chapters 1, 2, and 5, then aggregated them:

```bash
bun scripts/evals/corpus-recreation-thread-map.ts output/corpus-recreation-poc/scene-turn-v4-smoke-ch1-20260509 output/corpus-recreation-poc/scene-turn-v4-smoke-ch2b-20260509 output/corpus-recreation-poc/scene-turn-v4-smoke-ch5-20260509 --output output/corpus-recreation-poc/scene-turn-v4-smoke-3ch-20260509/thread-map.md --json output/corpus-recreation-poc/scene-turn-v4-smoke-3ch-20260509/thread-map.json
bun scripts/evals/corpus-recreation-readiness.ts output/corpus-recreation-poc/scene-turn-v4-smoke-ch1-20260509 output/corpus-recreation-poc/scene-turn-v4-smoke-ch2b-20260509 output/corpus-recreation-poc/scene-turn-v4-smoke-ch5-20260509 --output output/corpus-recreation-poc/scene-turn-v4-smoke-3ch-20260509/readiness.md --json output/corpus-recreation-poc/scene-turn-v4-smoke-3ch-20260509/readiness.json
```

Aggregate result:

- 3 POC dirs;
- 16 movement rows;
- 11 scene-turn rows;
- 0 thread-map issues;
- 0 horizon notes;
- 0 readiness groups.

This is deterministic evidence only. It does not prove prose quality or semantic
story quality, but it does clear the graph-ready parent/child ID shape for this
small planner-only sample.

## Prose POC

An initial `--plan-from` scene-call draft exposed a replay bug: the command
reused the source plan but rebuilt the packet from the default chapter, causing
chapter 2 prose to be compared against chapter 1 target structure. The script
now reuses `packet.json` from `--plan-from` when present and records that source
packet in the run manifest.

Corrected run:

```bash
bun scripts/evals/corpus-recreation-poc.ts --plan-from output/corpus-recreation-poc/scene-turn-v4-smoke-ch2b-20260509 --output-dir output/corpus-recreation-poc/scene-turn-v4-write-ch2b-20260509 --live --write --scene-calls --model deepseek-v4-flash
bun scripts/evals/corpus-recreation-semantic-review.ts --poc-dir output/corpus-recreation-poc/scene-turn-v4-write-ch2b-20260509 --live --model deepseek-v4-flash
bun scripts/evals/corpus-recreation-prose-review.ts --poc-dir output/corpus-recreation-poc/scene-turn-v4-write-ch2b-20260509 --live --model deepseek-v4-flash
bun scripts/evals/corpus-recreation-review.ts --poc-dir output/corpus-recreation-poc/scene-turn-v4-write-ch2b-20260509 --output output/corpus-recreation-poc/scene-turn-v4-write-ch2b-20260509/review.html
```

Result:

- correct source packet: crystal_shard chapter 2;
- deterministic plan issues: 0;
- chapter issues: 0;
- forbidden source terms: 0;
- word count: 2403/3353 (0.72), with advisory low-scene warnings only;
- semantic review: 0 low-signal findings across 18 applicable tasks;
- prose review: no operator-attention items; payoff propulsion labels were
  `PAYOFF-3:4`.

This is a useful prose proof point for the scene-turn parent shape, not a
promotion decision by itself.

## Thread-Context Arm

Ran the default-off writer-context arm on the same clean chapter 2 plan:

```bash
bun scripts/evals/corpus-recreation-poc.ts --plan-from output/corpus-recreation-poc/scene-turn-v4-smoke-ch2b-20260509 --output-dir output/corpus-recreation-poc/scene-turn-v4-thread-context-write-ch2-20260509 --live --write --scene-calls --writer-context thread-context-v1 --model deepseek-v4-flash
bun scripts/evals/corpus-recreation-semantic-review.ts --poc-dir output/corpus-recreation-poc/scene-turn-v4-thread-context-write-ch2-20260509 --live --model deepseek-v4-flash
bun scripts/evals/corpus-recreation-prose-review.ts --poc-dir output/corpus-recreation-poc/scene-turn-v4-thread-context-write-ch2-20260509 --live --model deepseek-v4-flash
bun scripts/evals/corpus-recreation-review.ts --poc-dir output/corpus-recreation-poc/scene-turn-v4-write-ch2b-20260509 --poc-dir output/corpus-recreation-poc/scene-turn-v4-thread-context-write-ch2-20260509 --output output/corpus-recreation-poc/scene-turn-v4-ch2-baseline-vs-thread-context-20260509/review.html
```

Result:

- deterministic plan/chapter issues: 0;
- word count: 2366/3353 (0.71), similar to baseline 2403/3353 (0.72);
- semantic review: same summary as baseline, 0 low-signal findings;
- prose review: same summary as baseline, no operator-attention items;
- writer-context packet includes `sceneTurnId` in current responsibilities.

Conclusion: `thread-context-v1` was safe in this one-scene-call chapter sample,
but it did not visibly beat baseline under the current automated judges. Treat
it as still diagnostic/default-off until there is a larger paired sample or
operator preference evidence.

## Expanded Writer-Context Pair

Ran the same baseline vs `thread-context-v1` scene-call write/review pair for
chapters 1 and 5, reusing the already-validated v4 plans:

```bash
bun scripts/evals/corpus-recreation-poc.ts --plan-from output/corpus-recreation-poc/scene-turn-v4-smoke-ch1-20260509 --output-dir output/corpus-recreation-poc/scene-turn-v4-write-ch1-20260509 --live --write --scene-calls --model deepseek-v4-flash
bun scripts/evals/corpus-recreation-poc.ts --plan-from output/corpus-recreation-poc/scene-turn-v4-smoke-ch1-20260509 --output-dir output/corpus-recreation-poc/scene-turn-v4-thread-context-write-ch1-20260509 --live --write --scene-calls --writer-context thread-context-v1 --model deepseek-v4-flash
bun scripts/evals/corpus-recreation-poc.ts --plan-from output/corpus-recreation-poc/scene-turn-v4-smoke-ch5-20260509 --output-dir output/corpus-recreation-poc/scene-turn-v4-write-ch5-20260509 --live --write --scene-calls --model deepseek-v4-flash
bun scripts/evals/corpus-recreation-poc.ts --plan-from output/corpus-recreation-poc/scene-turn-v4-smoke-ch5-20260509 --output-dir output/corpus-recreation-poc/scene-turn-v4-thread-context-write-ch5-20260509 --live --write --scene-calls --writer-context thread-context-v1 --model deepseek-v4-flash
```

Then ran semantic review, prose review, and static comparison pages:

```bash
bun scripts/evals/corpus-recreation-review.ts --poc-dir output/corpus-recreation-poc/scene-turn-v4-write-ch1-20260509 --poc-dir output/corpus-recreation-poc/scene-turn-v4-thread-context-write-ch1-20260509 --output output/corpus-recreation-poc/scene-turn-v4-ch1-baseline-vs-thread-context-20260509/review.html
bun scripts/evals/corpus-recreation-review.ts --poc-dir output/corpus-recreation-poc/scene-turn-v4-write-ch5-20260509 --poc-dir output/corpus-recreation-poc/scene-turn-v4-thread-context-write-ch5-20260509 --output output/corpus-recreation-poc/scene-turn-v4-ch5-baseline-vs-thread-context-20260509/review.html
```

Results:

- chapter 1 baseline: deterministic issues 0, word count 1069/1832, semantic
  lows 1/21 (`motivationSpecificity` scene 1), prose operator-attention 0;
- chapter 1 `thread-context-v1`: deterministic issues 0, word count 1135/1832,
  semantic lows 0/21, prose operator-attention 0;
- chapter 5 baseline: deterministic issues 0, word count 857/2255, semantic
  lows 0/6, prose operator-attention 0;
- chapter 5 `thread-context-v1`: deterministic issues 0, word count 754/2255,
  semantic lows 0/6, prose operator-attention 0.

Static review pages:

- `output/corpus-recreation-poc/scene-turn-v4-ch1-baseline-vs-thread-context-20260509/review.html`
- `output/corpus-recreation-poc/scene-turn-v4-ch5-baseline-vs-thread-context-20260509/review.html`
- `output/corpus-recreation-poc/scene-turn-v4-ch2-baseline-vs-thread-context-20260509/review.html`

Aggregate evidence:

- `output/corpus-recreation-poc/scene-turn-v4-paired-writer-context-aggregate-20260509/aggregate.md`
- 6 rows across chapters 1, 2, and 5;
- deterministic issues: 0 in all rows;
- character-context structural issues: chapter 1 has 2 per arm; chapter 2 has
  4 per arm; chapter 5 has 0 per arm;
- semantic low findings: 1 total, only baseline chapter 1 scene 1
  `motivationSpecificity`;
- prose operator-attention findings: 0 in all rows;
- `thread-context-v1` did not improve word ratio, and was shorter than baseline
  in chapters 2 and 5.

Interpretation: the parent-child scene-turn shape remains clean across the
paired prose samples. The thread-context arm is still not a promotion win: it
improved one narrow chapter-1 motivation finding, tied prose review, and did
not solve the broader under-expansion tendency. Keep it default-off and treat
the useful promotion candidate as the ID lineage shape, not the current writer
context packet.

Implementation note: the aggregate and static review readers now accept both
the current `semantic-review/semantic-review.json` output path and the older
`semantic-review-live/semantic-review.json` path. The earlier aggregate showed
`not run` for semantic rows because it only checked the older path.

Character-context note: `diagnostics:corpus-recreation-character-context`
creates read-only character packets from the same POC artifacts. It does not
change writer prompts. The new structural issues are exact-ID context gaps:
the scene contract names a known character, but the plan did not link that
character through `requiredCharacterIds` or a character-source obligation. The
next planning-layer fix should make those IDs explicit before any
character-context writer arm is promoted.
