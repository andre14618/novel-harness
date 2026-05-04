---
status: cleared
updated: 2026-05-03
role: lane
session: 2026-05-03-collaborative-proposal-workflow-phase-2a
charter: docs/charters/world-bible-architecture.md
design: docs/designs/collaborative-proposal-workflow.md
parent-lane: docs/sessions/2026-05-03-collaborative-proposal-workflow-phase-1.md
---

# Lane — Collaborative Proposal Workflow Phase 2A: Canon Proposal Review API

## Session-Start Contract

### 1. Goal + component

Land **Phase 2A** of `docs/designs/collaborative-proposal-workflow.md` — the
**review API only**. Phase 2 in the design doc covers both the API and a
minimal Studio UI; this lane narrows to the API surface so it can ship
testably without browser hand-testing. The UI panel is a follow-on lane.

Component scope:

- `src/orchestrator/canon-proposal-routes.ts` (new) — handler module with three
  endpoints, mirroring the route-module pattern of `pref-eval-routes.ts`:
  - `GET  /api/novel/:id/canon-proposals` — list pending proposals for a novel.
    Optional query params: `source` (`planner-output` / `planning-state-mapper`
    / etc.), `chapter` (filters by `proposedFact.provenance.chapter`),
    `plannerOnly` (`true` returns only planner-origin rows via the
    `plannerProposalPrefix` filter).
  - `POST /api/novel/:id/canon-proposals/:proposalId/resolve` — adjudicate.
    Body: `{ status: "approved" | "rejected" | "modified", modifiedFact?, operatorNote?, expectedStatus? }`.
    Calls `PostgresCanonSubstrate.resolveProposal`. The optional
    `expectedStatus` (e.g., `"pending"`) is a **stale-precondition guard**:
    if the proposal's current status does not match, the route returns
    `409 Conflict` with the actual status, so concurrent operators or a
    re-rendered review page can detect they're acting on stale state. This
    is per design doc Phase 2 Work item "Add stale-precondition handling
    if the proposal target has changed."
  - `POST /api/novel/:id/canon-proposals/generate-from-outline` — operator-
    triggered Phase 1 generation over the novel's authored outlines. Pulls
    `getChapterOutlines(novelId)` and calls
    `generatePlannerCanonProposals(novelId, outlines)`. Returns
    `{ created, skipped, gateClear, gateReport }`. Idempotent by
    construction (Phase 1's deterministic id + ON CONFLICT DO NOTHING).
- `src/orchestrator/server.ts` — wire `handleCanonProposalRoute` into the
  fetch dispatcher next to the other route modules.
- `src/orchestrator/canon-proposal-routes.test.ts` (new) — direct-handler
  tests (mirrors the pattern in `src/canon/substrate-equivalence.test.ts`
  but at the HTTP layer). Tests:
  - List endpoint returns pending only after generate; rejected/approved
    proposals are filtered out.
  - Filter by `source=planner-output` returns fact-origin rows only.
  - Filter by `chapter=2` returns only proposals whose
    `proposedFact.provenance.chapter === 2`.
  - `plannerOnly=true` returns only planner-deterministic-id rows
    (excludes any non-planner proposals seeded directly via
    `proposeCanonUpdate`).
  - Resolve approve → committed canon visible in `factsAsOfChapter`.
  - Resolve reject → canon stays clean.
  - Resolve modified → committed canon carries operator-edited text +
    `approvalStatus="human-edited"`.
  - Stale-precondition: resolving with `expectedStatus="pending"` after
    the proposal was already resolved returns 409.
  - Resolve unknown proposalId → 404.
  - Resolve modified without `modifiedFact` → 400.
  - Generate-from-outline writes proposals via the harness service and
    returns the created/skipped split; rerunning is idempotent (created=0
    on second call).

Out of scope this lane: Studio review UI, telemetry events, multi-novel
batch operations, autonomous-mode policy. Phase 2B (UI) and Phase 3+ per
the design doc.

### 2. Why

Phase 1 (lane: `docs/sessions/2026-05-03-collaborative-proposal-workflow-phase-1.md`,
commit `acf67c2`) shipped the harness service that converts planner source
items into pending Canon proposals, with no-ghost-canon proven and
idempotency proven. The proposals exist in `canon_proposals` but **no
operator-facing surface exists to act on them**: the only way to approve a
proposal today is to call `PostgresCanonSubstrate.resolveProposal` from a
script. Without an API the work is invisible to the orchestrator/Studio
flow. This lane closes that gap.

Phase 2 in the design doc is named as the immediate next narrow lane after
Phase 1; the lane queue has it in `## Next`. Splitting it into 2A (API)
+ 2B (UI) is necessary because UI work needs browser hand-testing and
should not block the API surface.

### 3. What is measurable

Work is complete when:

- `bun test src/orchestrator/canon-proposal-routes.test.ts` — passes
  (skipIf-unreachable for Postgres branches).
- `bun test src/canon/` — 196 prior tests still green.
- `bun test src/harness/` — Phase 1's 18 harness tests still green.
- `bunx tsc --noEmit` — clean.
- `bun scripts/audits/run-salvatore-recall.ts` — `recallGateClear=true,
  meanRecall=0.927` (no §0a regression).
- A live-shape exercise: invoke the handler directly with a synthetic
  `Request`, point it at a fixture novel + outlines, see the proposals
  list / resolve / generate as expected.
- The handler module is registered in `server.ts` and a deploy-ready
  Bun.serve run starts cleanly (no import errors).

### 4. Validated gates

- **(a) Clean pass:** API ships; HTTP-level tests pass against InMemory +
  Postgres adapters where applicable; `tsc` + recall + canon + harness
  suites green.
- **(b) New dominant blocker:** stale-precondition can't be expressed
  cleanly with the current `resolveProposal` signature (the substrate
  throws `"already X"` errors but a 409 needs the *current* status to
  return to the caller). If the substrate API needs a new
  `resolveProposalIfStatus(...)` helper to surface the actual status, stop
  and decide whether to extend the substrate or keep the precondition at
  the route layer (HTTP-side `findProposal` → status check → resolve).
  Working hypothesis: route-layer check is fine since the substrate's
  `findProposal` is already the authoritative read; we just sequence it
  inside the route handler before resolving.
- **(c) Regression:** existing canon tests fail or §0a recall drops. Stop,
  fix, re-verify.
- **(d) Infrastructure failure:** Postgres unreachable → tests skip
  Postgres branch via `describe.skipIf(!reachable)`.
- **(e) Budget cap:** no LLM/API cost; local DB only. $0.

### 5. Cost-threshold autonomy

Local code + tests only; no LXC deploy unless the user explicitly asks for
one. Per CLAUDE.md §"Cost-threshold autonomy", proceed.

## Command Plan

1. Implement `src/orchestrator/canon-proposal-routes.ts` with the three
   endpoints described above.
2. Wire into `server.ts` next to `handlePrefEvalRoute`.
3. Add `src/orchestrator/canon-proposal-routes.test.ts` exercising every
   endpoint + the stale-precondition path.
4. Verify: bun test src/orchestrator/canon-proposal-routes.test.ts +
   src/canon/ + src/harness/ + tsc + recall.
5. Docs sweep: lane Results, design-doc Phase 2A cleared marker (2B
   remains open), decisions entry, todo close-out for the Phase 2 line
   (split into Phase 2A done + Phase 2B open), lane-queue advance,
   current-state.md latest comment, lessons (if applicable — likely none
   for a thin route layer).

## Results

Phase 2A cleared. New `src/orchestrator/canon-proposal-routes.ts` exposes the
proposal-review surface over the existing `PostgresCanonSubstrate`:

- `GET /api/novel/:id/canon-proposals` lists pending proposals with optional
  filters: `source` (ProvenanceSource match), `chapter` (numeric, matches
  `proposedFact.provenance.chapter`), and `plannerOnly=true` (filters via
  `plannerProposalPrefix(novelId)` to exclude non-planner proposals).
- `POST /api/novel/:id/canon-proposals/:proposalId/resolve` adjudicates a
  pending proposal. Body `{ status: approved|rejected|modified, modifiedFact?,
  operatorNote?, expectedStatus? }`. The optional `expectedStatus` is the
  stale-precondition guard (per design-doc Phase 2 work item): if the
  current status doesn't match, the route returns 409 + `actualStatus` so a
  re-rendered review page can detect it's acting on stale state. Already-
  resolved proposals (without `expectedStatus`) also return 409 with the
  actual status for consistency. Unknown id → 404. Bad payload → 400.
  Substrate-level "already resolved" race condition surfaces as 409 too.
- `POST /api/novel/:id/canon-proposals/generate-from-outline` is the
  operator-triggered Phase-1 generation path. It pulls
  `getChapterOutlines(novelId)` and runs `generatePlannerCanonProposals`,
  returning `{ created, skipped, gateClear, gateReport.summary }`.
  Idempotent by construction (Phase 1's deterministic id + ON CONFLICT).
  Empty outlines → 404. Broken gate → 200 with `gateClear=false` and
  no proposals written.

The routes are wired into `src/orchestrator/server.ts` next to the
existing `pref-eval` / `finetune` / `novel` route modules. The dispatcher
calls `handleCanonProposalRoute` first; null returns fall through to the
next handler.

Phase 2B (UI) remains open. Phase 2A is the API surface only.

## Stop gate fired

Gate (a) — clean pass. API ships with HTTP-level handler tests covering
list filters (source/chapter/plannerOnly), approve/reject/modified
resolve, the stale-precondition 409, error-shape paths (404/400/409/500),
and generate-from-outline (clean + idempotent + gate-fail-closed +
no-outlines-404). 265 canon+harness+orchestrator tests pass; tsc clean;
§0a recall holds at 0.927.

## Evidence

- `bun test src/orchestrator/canon-proposal-routes.test.ts` — **18/18 pass / 139 expects / 8.88s**
- `bun test src/canon/ src/harness/ src/orchestrator/canon-proposal-routes.test.ts` — **265/265 pass / 1,154 expects / 20.47s**
- `bunx tsc --noEmit` — clean
- `bun scripts/audits/run-salvatore-recall.ts` — `meanRecall=0.927, recallGateClear=YES`
- Commit SHA: filled by commit step.

## Cost

| line | spend |
|---|---|
| (no LLM/API calls — local only) | 0 |
| **total** | **0** |

## Commits

(to be filled)
