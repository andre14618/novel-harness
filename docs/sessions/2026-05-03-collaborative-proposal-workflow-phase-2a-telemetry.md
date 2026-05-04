---
status: cleared
updated: 2026-05-03
role: lane
session: 2026-05-03-collaborative-proposal-workflow-phase-2a-telemetry
charter: docs/charters/world-bible-architecture.md
design: docs/designs/collaborative-proposal-workflow.md
parent-lane: docs/sessions/2026-05-03-collaborative-proposal-workflow-phase-2a.md
---

# Lane — Phase 2A Telemetry: Proposal Lifecycle Events

## Session-Start Contract

### 1. Goal + component

Wire `trace()` events for the proposal lifecycle so operators can observe
proposal creation/resolution traffic in `pipeline_events` (and the existing
SSE stream). The Phase 2 design doc explicitly names this work item — it
was deferred out of Phase 2A scope so the API could ship testably first.

Component scope:

- `src/trace.ts` — add three event types to `TraceEventType`:
  - `canon-proposal-create` — fired per proposal inserted (planner-origin
    via `generatePlannerCanonProposals`, or substrate-direct via
    `proposeCanonUpdate`).
  - `canon-proposal-resolve` — fired per resolution
    (approve/reject/modified).
  - `canon-proposal-generate-summary` — fired once per
    `generatePlannerCanonProposals` call with a roll-up of
    `outlinesCount / gateClear / createdCount / skippedCount`.
- `src/harness/planner-canon-proposals.ts` — emit per-create + summary
  events. On gate fail-closed the summary still fires (with
  `gateClear=false` + `recommendation` + duplicate counts) so a refused
  generate is observable.
- `src/harness/canon-substrate.ts` — emit per-create on
  `proposeCanonUpdate` and per-resolve on `resolveProposal` (after the
  transaction commits, so the event reflects durable state).
- `src/harness/canon-proposal-telemetry.test.ts` (new) — DB-backed tests
  asserting that:
  - 30-source-item generate fires 30 creates + 1 summary.
  - Idempotent rerun: 0 new creates + 1 summary with `createdCount=0`.
  - Gate-fail summary carries `gateClear=false` + the recommendation.
  - Approve / reject / modified all fire `canon-proposal-resolve` with
    correct `proposalId / status / factId / chapter`.
  - Substrate-direct `proposeCanonUpdate` fires `canon-proposal-create`
    with `agent="canon-substrate"` (different from planner-origin's
    `agent="planner-canon-proposals"`).

Out of scope: SSE consumer wiring (events broadcast for free via the
existing `emit()` call inside `trace()`); UI consumption of the events
(Phase 2B).

### 2. Why

Phase 2A landed the API surface but proposal lifecycle is currently
invisible in the pipeline-events stream. Operators reviewing a novel run
have no audit trail for: when a planner-canon-generate ran, what it
produced, which proposals an operator approved/rejected, or why a generate
refused (gate failure). Telemetry closes that gap with a small,
well-scoped patch.

### 3. What is measurable

- New tests pass against the DB.
- All existing tests still green (canon + harness + orchestrator).
- `bunx tsc --noEmit` clean.
- `bun scripts/audits/run-salvatore-recall.ts` — gate clear, recall ≥ 0.92.
- Manual probe (optional): generate proposals on a fixture novel; query
  `SELECT event_type, payload FROM pipeline_events WHERE novel_id = …`
  and see the expected rows.

### 4. Validated gates

- **(a) Clean pass:** events land in `pipeline_events` with correct
  shape; full sweep green.
- **(b) New dominant blocker:** trace() being awaited inside the harness
  service starts adding meaningful latency to the generate-from-outline
  path (e.g., > 100ms per proposal). Working hypothesis: each trace() is a
  single INSERT; 30 trace() calls is ~30 INSERTs, sub-50ms aggregate. If
  it's slower, we batch-insert via a single multi-row INSERT in a follow-on
  optimization.
- **(c) Regression:** existing canon tests fail. Stop, fix.
- **(d) Infrastructure failure:** Postgres unreachable → tests skip via
  `describe.skipIf(!reachable)`. The harness-side `trace()` call is
  best-effort (it catches DB errors) so a transient outage logs but
  doesn't block proposal generation.
- **(e) Budget cap:** $0; local DB only.

### 5. Cost-threshold autonomy

Local code + tests; no LXC deploy unless the user explicitly asks. Per
CLAUDE.md §"Cost-threshold autonomy", proceed.

## Command Plan

1. Add 3 event types to `TraceEventType`.
2. Wire trace calls in:
   - `generatePlannerCanonProposals` — per-create + summary (both gate
     paths).
   - `proposeCanonUpdate` — per-create.
   - `resolveProposal` — per-resolve (after transaction commit).
3. Tests covering all 3 event types + both agent labels (planner-origin vs
   substrate-direct) + idempotent rerun + gate fail-closed.
4. Verify: bun test src/canon/ + src/harness/ + src/orchestrator/ + tsc +
   recall.
5. Docs sweep: lane Results, decisions entry, todo (no new line — this is
   a Phase 2A continuation), lane-queue advance, current-state amendment.

## Results

Phase 2A Telemetry cleared. The proposal lifecycle now emits structured
events to `pipeline_events` (and broadcasts via the existing SSE stream
that `trace()` already wires up):

- `canon-proposal-create` — per proposal inserted. Payload:
  `{ proposalId, source, factKind, sourceItemId? | factId?, schemaVersion?, targetFactId? }`.
  Agent label distinguishes the two creation paths:
  `planner-canon-proposals` for planner-origin, `canon-substrate` for
  substrate-direct (`proposeCanonUpdate`).
- `canon-proposal-resolve` — per resolution, fired after the resolve
  transaction commits. Payload:
  `{ proposalId, status, factId, targetFactId, operatorNote }`. `factId` is
  the committed-fact id on approved/modified, `null` on rejected. Chapter
  is set from the committed (or originally proposed) provenance.
- `canon-proposal-generate-summary` — single per
  `generatePlannerCanonProposals` invocation. Clean path:
  `{ outlinesCount, gateClear: true, createdCount, skippedCount, schemaVersion }`.
  Gate fail-closed: `{ outlinesCount, gateClear: false, createdCount: 0,
  skippedCount: 0, recommendation, validationErrorCount, duplicateSourceIdCount }`.

The summary event makes idempotent reruns observable as
`createdCount=0 / skippedCount=N`, and the per-create events being absent
on rerun (skipped inserts intentionally do NOT fire) keeps the per-event
stream a faithful "what's new" signal.

## Stop gate fired

Gate (a) — clean pass. 7-test telemetry suite green; 272-test full sweep
green; tsc clean; recall holds.

## Evidence

- `bun test src/harness/canon-proposal-telemetry.test.ts` — **7/7 pass / 294 expect() calls / 3.56s**
- `bun test src/canon/ src/harness/ src/orchestrator/canon-proposal-routes.test.ts` — **272/272 pass / 1,448 expects / 33.30s**
- `bunx tsc --noEmit` — clean
- `bun scripts/audits/run-salvatore-recall.ts` — `meanRecall=0.927, recallGateClear=YES`
- Commit SHA: `1bec94e` ([feat] collaborative proposal workflow Phase 2A telemetry — proposal lifecycle events)
- Experiment: `408` (ticket, target=world-bible-architecture, status=shipped)

## Cost

| line | spend |
|---|---|
| (no LLM/API calls — local only) | 0 |
| **total** | **0** |

## Commits

- `1bec94e` — `[feat] collaborative proposal workflow Phase 2A telemetry — proposal lifecycle events`. Includes 3 new TraceEventTypes, instrumentation in `generatePlannerCanonProposals` + `proposeCanonUpdate` + `resolveProposal`, the 7-test telemetry suite, and the docs sweep (lane doc + decisions + current-state + lane-queue).
