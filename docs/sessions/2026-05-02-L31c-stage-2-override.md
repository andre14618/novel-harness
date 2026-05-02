---
loop: L31c
status: shipped
created: 2026-05-02
experiment: 356
commit: 1458d3e
---

# L31c — Stage-2 Override for Adherence: Session Retrospective

## What Was Done

Implemented the L31c fix: when stage 2 of the two-stage adherence checker
reports all obligated_events as enacted, override the stage-1 fail verdict
and accept the beat.

## Motivation

L24 beat 7 (novel `novel-1777704637163`): stage 1 returned `events_present: false`
on attempts 2 and 3, but stage 2 confirmed all 4 events enacted ("locking door",
"confronting ledger", "reciting regulations", "deciding to report via complaint
form"). The prose was correct — the writer enacted "deciding to report" via the
detail of filling out a complaint form. Stage 1's temp=0.1 binary call could not
resolve "form = decision" reliably across retries, exhausting the beat retry budget.

## Implementation

Three files changed:

1. `src/trace.ts` — added `"adherence-stage2-override"` to `TraceEventType`.
2. `src/agents/writer/adherence-checker.ts` — `enumerateMissingEvents` return type
   changed from `string[]` to `{ issues: string[]; stage2Override: boolean }`. When
   all `obligated_events` are `enacted: true`, returns `{ issues: [], stage2Override: true }`.
   `checkBeatAdherence` emits `adherence-stage2-override` trace and log when override fires.
3. `src/agents/writer/adherence-checker.test.ts` — 3 new L31c test cases:
   - all-enacted → pass (override fires)
   - partial-enacted → fail (override does not fire)
   - stage-1-true → pass (no stage 2, no override)
   Updated the existing "stage 2 disagrees" test to new override semantics.

## Panel A/B (local, no LXC)

Script: `scripts/hallucination/run-partial-enactment-panel.ts`
Panel: `synthetic-partial-enactment-fixtures/partial-enactment-panel.jsonl` (14 rows)

| | Before L31c | After L31c |
|---|---|---|
| TP | 7 | 7 |
| FP | 0 | 0 |
| FN | 2 | 2 |
| TN | 5 | 5 |
| Precision | 100% | 100% |
| Recall | 77.8% | 77.8% |
| F1 | 87.5% | 87.5% |

Zero new FPs. Override path does not fire on any partial-enactment shape because
stage 2 correctly reports enacted=false for the missing event. Embellishment TN=100%.

The 2 persistent FNs (candle-lighting two-of-three-fail-02, reversed-order-fail-02
mage drain/binding) are pre-existing model-sensitivity failures not caused by L31c.

## Test Results

- 11 tests in `adherence-checker.test.ts` — all pass
- Full `src/` suite: 439 pass / 7 fail (7 pre-existing failures in L31a/L31b tests
  and DB-requiring tests — 0 new regressions introduced by L31c)
- `bun tsc --noEmit` — 0 type errors
- Preflight: `[docs-impact] OK — commit message declares docs-impact: none`

## DB

Experiment #356 created and concluded:
- Type: `ticket`
- Target: `adherence-checker`
- Dimension: `stage2-override`
- Panel before/after: unchanged (FP=0 confirmed)

## Key Decision

The original exp #305 fallback ("stage 2 disagrees → preserve stage-1 blocker")
was based on a labeled panel where stage-2 disagreement always had stage-1 correct.
L24 showed a real production case where stage-2 was right and stage-1 was wrong
(stochastic implicit-action interpretation at temp=0.1). The override is conservative:
it only fires on unanimous stage-2 enactment, preserving the stage-1 fail for any
partial enactment.

## Next

L31d: re-smoke fantasy-debt after L31a+L31b+L31c all land to confirm 3/3 chapters
draft cleanly.
