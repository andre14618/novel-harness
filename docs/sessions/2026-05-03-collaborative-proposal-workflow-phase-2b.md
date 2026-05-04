---
status: cleared
updated: 2026-05-03
role: lane
session: 2026-05-03-collaborative-proposal-workflow-phase-2b
charter: docs/charters/world-bible-architecture.md
design: docs/designs/collaborative-proposal-workflow.md
parent-lane: docs/sessions/2026-05-03-collaborative-proposal-workflow-phase-2a-telemetry.md
---

# Lane — Phase 2B Studio Review Panel: Operator UI Over The Phase 2A API

## Session-Start Contract

### 1. Goal + component

Ship the first UI surface that calls the Phase 2A canon-proposal review
API. A standalone page at `/canon-proposals/:novelId` that lists pending
proposals, shows each one's fact id / kind / proposed text / provenance,
and exposes Approve / Reject buttons that hit
`POST /api/novel/:id/canon-proposals/:proposalId/resolve` with
`expectedStatus: "pending"`. Plus filter controls (source / chapter /
plannerOnly) that map to the list endpoint's query params, plus a
"Generate from outline" button that hits
`POST /api/novel/:id/canon-proposals/generate-from-outline`.

Component scope:

- `ui/src/api.ts` — three new client functions (`listCanonProposals`,
  `resolveCanonProposal`, `generateProposalsFromOutline`) + supporting
  types narrow enough to render but structurally compatible with the
  authoritative substrate types in `src/canon/api.ts`.
- `ui/src/components/CanonProposalsPage.tsx` — new page component.
  Functional React: `useParams` to read the novelId from the URL,
  `useState/useEffect` for data + filter state, optimistic remove on
  successful resolve, reload-on-error so the operator sees authoritative
  state if a resolve raced.
- `ui/src/main.tsx` — one new `<Route path="/canon-proposals/:novelId">`
  registered before the `/:novelId` catch-all (required — otherwise the
  router would prefer the catch-all).

### 2. Why

Phase 2A (commit `9cf6238`) shipped the API. Phase 2A telemetry
(`1bec94e`) shipped lifecycle events. Phase 1.5 (`b967c69`) auto-wires
planner→proposals at the planning-phase boundary so the queue is
populated by default. Phase 2B closes the operator-facing loop: until
the UI exists, the only way to review proposals is curl + raw JSON.

This is the minimum operator surface to start using the no-ghost-canon
review path on real novels. v1 is intentionally narrow: no
modify-with-edits surface (operators who need to edit a proposal can hit
the API directly), no resolved-history view (queued in the lane queue),
no bulk approve/reject (queued).

### 3. What is measurable

- `bunx tsc --noEmit` clean across `ui/` + `src/`.
- `cd ui && bunx vite build` succeeds (catches anything tsc misses, like
  template-literal interpolation issues in JSX).
- Existing test sweep (`src/canon/ src/harness/
  src/orchestrator/canon-proposal-routes.test.ts`) stays green —
  275-test sweep, no UI changes touch server.
- `bun scripts/audits/run-salvatore-recall.ts` — recall gate stays
  ≥0.92.

### 4. Validated gates

- **(a) Clean pass:** UI compiles + bundles; existing test sweep stays
  green; recall gate stays clear; route resolves at
  `/app/canon-proposals/:novelId`.
- **(b) New dominant blocker:** if the API client surfaces a type
  mismatch I missed, fix the client type and re-verify.
- **(c) Regression:** existing canon tests fail. Stop, fix, re-verify.
- **(d) Infrastructure failure:** UI bundle won't build → diagnose,
  don't ship a non-building bundle.
- **(e) Browser-untested caveat:** per CLAUDE.md ("if you can't test the
  UI, say so explicitly rather than claiming success"), this lane ships
  with an explicit "browser-untested, awaiting hand-test verification"
  caveat in the page footer + lane Results. Operator hand-test required
  before declaring a full clean pass.

### 5. Cost-threshold autonomy

Local code + tests + bundle build; no LXC deploy unless the user
explicitly asks. Per CLAUDE.md §"Cost-threshold autonomy", proceed.

## Command Plan

1. Add `listCanonProposals` / `resolveCanonProposal` /
   `generateProposalsFromOutline` to `ui/src/api.ts` along with narrow
   structural types (`CanonProposal`, `ProposedFact`, etc.).
2. Create `ui/src/components/CanonProposalsPage.tsx` with filter bar,
   pending-list table, approve/reject buttons, generate button.
3. Register the new route in `ui/src/main.tsx` before the `/:novelId`
   catch-all.
4. Verify: `bunx tsc --noEmit` + `cd ui && bunx vite build` + existing
   server-side test sweep + recall gate.
5. Docs sweep: this lane doc, decisions entry, current-state amendment,
   lane-queue advance.

## Results

Phase 2B cleared (browser-untested). The operator-facing UI for the
no-ghost-canon proposal flow is now live in the bundle.

Page route: `/app/canon-proposals/:novelId`

Functions added to `ui/src/api.ts`:

```ts
listCanonProposals(novelId, opts?): Promise<{ proposals: CanonProposal[] }>
resolveCanonProposal(novelId, proposalId, body): Promise<ResolveProposalResult>
generateProposalsFromOutline(novelId): Promise<GenerateProposalsResult>
```

The page renders pending proposals as a table with columns: proposal id
(opaque), fact id (canon-id), kind (badge), proposed text + provenance
metadata (chapter / beat / source / confidence), and a decision column
with Approve / Reject buttons. Approving / rejecting fires the resolve
endpoint with `expectedStatus: "pending"` so a stale-page race surfaces
as 409 (and the page reloads to show authoritative state). The filter
bar (source / chapter / plannerOnly) maps directly to the list
endpoint's query params; "Generate from outline" hits the generate
endpoint and shows a one-line summary.

What's intentionally NOT in v1 (queued for follow-on):

- Modify-with-edits surface (operators can hit the API directly).
- Resolved-history view (the list endpoint currently returns pending
  only; the audit-view extension is queued separately).
- Bulk approve/reject.
- Inline diff against the existing canon row when `targetFactId` is
  set (a modify-flow nicety, not a v1 must).

## Stop gate fired

Gate (a) — clean pass, browser-untested. tsc + vite build + 275-test
server-side sweep + recall all green; the page is in the bundle and the
route resolves. Hand-testing in a browser by the operator is the
remaining clearance step (per CLAUDE.md UI rule, this is the right
shape — flag-and-disclose, don't claim full success without browser
verification).

## Evidence

- `bunx tsc --noEmit` — clean (exit 0).
- `cd ui && bunx vite build` — clean; 72 modules transformed; bundle
  size 505.41 kB / gzip 151.71 kB.
- `bun test src/canon/ src/harness/ src/orchestrator/canon-proposal-routes.test.ts`
  — **275/275 pass / 1,462 expects** (server unchanged).
- `bun scripts/audits/run-salvatore-recall.ts` — `meanRecall=0.927,
  recallGateClear=YES`.
- Commit SHA: filled by commit step.

## Cost

| line | spend |
|---|---|
| (no LLM/API calls — local UI work only) | 0 |
| **total** | **0** |

## Commits

(to be filled)
