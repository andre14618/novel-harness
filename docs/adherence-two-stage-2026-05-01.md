---
status: result
date: 2026-05-01
experiment: 317
loop: L5-adherence-two-stage
---

# L5 — Two-stage Adherence Wiring (Result)

## TL;DR

Two-stage `adherence-events` wiring shipped. Stage 1 is the existing
binary `events_present` check and always runs; stage 2 (per-event
enumeration with quote evidence) only fires when stage 1 returns
`events_present=false`. Pass-path latency / cost is unchanged. Fail-path
issue text is now per-event quote-backed instead of a single approximate
sentence.

Verified on LXC against three hand-authored fixtures (1 pass, 2 fail).
Call counts: PASS=1, FAIL=2 each. Per-event detail caught the two-event
miss and the wrong-character attribution drift exactly as designed.

## Recon Finding

Single LLM call before this loop (`src/agents/writer/adherence-checker.ts`):
returned `{events_present, evidence, reasoning}`. On fail, the issue text
was `"Beat events not enacted on-page: ${reasoning}"` — a one-sentence
summary that the exp #305 calibration on the labeled panel called
"sometimes approximate" (e.g., attributed "Cassel never asks" as the sole
miss when other obligations were also unmet).

Per-event prototype `scripts/hallucination/probe-obligation-aware-adherence.ts`
already existed (exp #305) and demonstrated 75% recall / 67% precision on
the b12 partial-enactment cluster. This loop wires it into production
gated on stage-1 fail.

**Verdict:** NOT a no-op. Refactor was warranted.

## Implementation

### Code

- `src/agents/writer/adherence-checker.ts`
  - Added `missingEventsSchema` and `MISSING_EVENTS_SYSTEM` (Stage 2 prompt
    distilled from the prototype, removing the prototype's `all_enacted`
    and `missed_count` fields since the runtime path only cares about
    which events are missing).
  - `checkBeatAdherence` now pulls `userPrompt` out into a shared local,
    issues stage 1, and on `events_present=false` calls
    `enumerateMissingEvents()` which fires stage 2.
  - `enumerateMissingEvents()` returns one issue per missing event
    (`"Beat event missing: <event> — closest prose: <quote>"`). On
    transport error or stage-2/stage-1 disagreement (stage 2 reports all
    enacted), falls back to the prior generic single-line so the stage-1
    blocker is never silently dropped.
- `src/agents/writer/retry-context.ts`
  - The "prior-beat alignment note" heuristic that injects the
    "previous beat may already cover some actions" hint now matches
    `"Beat event missing"` in addition to the legacy `"not enacted"`
    sentinel. Prior alignment-note semantics are preserved.

### Test

- `src/agents/writer/adherence-checker.test.ts`
  - Mocks `../../llm` with a counting + queueable stub keyed off the
    system prompt prefix.
  - 5 new tests covering: PASS path (stage 1 only, 1 call); FAIL path
    (stage 1 + stage 2, 2 calls, per-event detail with quote);
    stage-2 disagreement → fallback; stage-2 transport error → fallback;
    multi-event miss → one issue per missing event with/without quote
    evidence based on whether stage 2 returned a non-empty quote.

### Smoke

- `scripts/adherence-two-stage-smoke.ts`
  - Three fixtures, hand-authored:
    - `pass-door-open` — single-event beat fully enacted.
    - `fail-door-open-and-call` — two-event beat with second event
      missing.
    - `fail-wrong-attribution` — two-event beat with both events
      attributed to the wrong character (Tomas instead of Maren).
  - Tags each fixture with a unique `novelId` and counts post-hoc via
    `SELECT COUNT(*) FROM llm_calls WHERE agent='adherence-events' AND
    novel_id=<tag>`. Initializes an experiment-scoped run via
    `initExperimentRun(317, "smoke", ...)` so the logger has a
    `currentRunId` for persistence.

## Smoke Result (LXC)

`/tmp/adherence-two-stage-smoke-2026-05-01.json` (mirrored at
`docs/artifacts/adherence-two-stage-smoke-2026-05-01.json`):

| fixture | expected | actual pass? | calls (actual / expected) |
|---|---|---:|---:|
| `pass-door-open` | pass | true | **1 / 1** |
| `fail-door-open-and-call` | fail | false | **2 / 2** |
| `fail-wrong-attribution` | fail | false | **2 / 2** |

Aggregate: `call_count_ok=true`, `verdict_ok=true`, pass-path 1 call,
fail-path 4 calls (2+2).

DB confirmation:

```
                     novel_id                      |      agent       | count | total_cost
---------------------------------------------------+------------------+-------+------------
 smoke-fail-door-open-and-call-2026-05-02T03-26-27 | adherence-events |     2 |   0.000084
 smoke-fail-wrong-attribution-2026-05-02T03-26-27  | adherence-events |     2 |   0.000078
 smoke-pass-door-open-2026-05-02T03-26-27          | adherence-events |     1 |   0.000038
```

Total smoke cost: $0.0002. Well under the $4 budget cap.

## Per-event Quote Evidence Examples

`fail-door-open-and-call` issue:

```
Beat event missing: Maren calls Tomas's name into the yard —
  closest prose: "She stood in the doorway, listening to the wind, and said nothing."
```

`fail-wrong-attribution` issues:

```
Beat event missing: Maren picks up the broken lantern from the bench —
  closest prose: "Tomas crossed to the bench, picked up the broken lantern"
Beat event missing: Maren carries it outside —
  closest prose: "carried it out into the yard"
```

The wrong-attribution case is exactly the regression class the
prototype caught on b12-a2 in exp #305 — and the production wiring now
makes it visible to the writer's targeted-rewrite prompt with a quote
that names the wrong actor.

## Test Result (local)

```
$ bun test src/agents/writer/adherence-checker.test.ts
9 pass / 0 fail / 28 expect() calls

$ bun test src/phases/ src/lint/
112 pass / 0 fail / 288 expect() calls
```

`bunx tsc --noEmit` — clean (0 errors).

## Commits

| SHA | Subject |
|---|---|
| `9d818e4` | `[agent:adherence-events] Two-stage events-present + per-event enumeration on FAIL` (test + retry-context + current-state; runtime file inadvertently reverted) |
| `f8584fb` | `[agent:adherence-events] Re-apply two-stage runtime after working-tree revert` (the actual `adherence-checker.ts` changes) |
| `37dbc0e` | `[infra] Smoke validator for two-stage adherence-events call gating` (initial smoke script) |
| `8fa272d` | `[infra] Adherence-two-stage smoke counts via llm_calls instead of monkey-patch` (ESM-readonly fix) |
| `58cf8c7` | `[infra] Adherence-two-stage smoke initializes experiment run for telemetry` (logger run_id fix) |

## Acceptance Criteria — met

- [x] No extra LLM call on pass cases (smoke: 1/1).
- [x] Failure cases return quote-backed missing-event detail (smoke: 2/2,
      one issue per missing event with prose quote).
- [x] Pass-path latency / cost unchanged (stage 2 gated on stage-1 fail).
- [x] Unit tests assert both gating directions and the fallback paths.
- [x] Smoke validates per-fixture call counts via persisted llm_calls.

## Follow-ups (not in scope of this loop)

- Re-run the labeled current-surface panel through two-stage and confirm
  binary 100/100 holds. Tracked in `docs/todo.md` §8 task "Run two-stage
  adherence against the existing labeled panel".
- Consider whether `enumerateMissingEvents` should ship the full
  `obligated_events[]` (including enacted=true rows) into telemetry for
  drill-down, or whether only the missing rows belong in `request_json`.
  Defer until there's a concrete inspector use case.
