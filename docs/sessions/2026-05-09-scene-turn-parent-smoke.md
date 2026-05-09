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
