---
status: active
updated: 2026-05-04
role: browser-preflight-runbook
---

# Playwright MCP Browser Testing

Use this process when an agent needs browser evidence before asking the user
for final UI approval.

## Posture

- Prefer Playwright MCP browser actions over adding local Playwright packages,
  browser drivers, or external CI.
- If no Playwright MCP browser tool is exposed in the agent session, stop and
  report that browser preflight is blocked. Do not fake screenshots or replace
  browser evidence with code inspection.
- External CI is on hold indefinitely. The local promotion guard remains enough
  for policy safety until a concrete CI need is reopened.

## Preconditions

- Orchestrator is running on `http://localhost:3006` via `bun run dev` or
  `bun run start`.
- `ui/dist/index.html` exists. If it is stale or missing, run
  `cd ui && bun run build` before testing.
- The agent has a usable Novel Harness session cookie or password for `/login`.
- Test data contains at least one novel id with pending Canon proposals or
  artifact patch envelopes for the target scenario.

## Evidence Contract

For each tested surface, capture:

- Starting URL and novel id.
- Baseline screenshot after first settled load.
- Screenshot after each meaningful action: approve, reject, modify, bulk
  resolve, regenerate stale proposal, or tab/filter switch.
- Console errors, failed network requests, and visible error banners.
- Final pass/fail summary with any untested paths called out explicitly.

## Canon Proposal Checklist

1. Navigate to `http://localhost:3006/app/canon-proposals/<novelId>`.
2. Confirm the pending list loads and empty/error states are clear.
3. Exercise single approve and single reject on disposable proposals.
4. Exercise modify-with-edits and confirm the resolved row reflects modified
   status.
5. Exercise status tabs or filters for pending, approved, rejected, and all.
6. Exercise bulk approve/reject only on disposable data and confirm the capped
   summary is visible.

## Artifact Patch Checklist

1. Navigate to the Studio route for the test novel and open artifact previews.
2. Confirm pending artifact patch proposal cards load from
   `/api/novel/:novelId/proposal-envelopes`.
3. Exercise approve/reject on disposable low-risk envelopes.
4. Force or select a stale-precondition envelope and confirm regenerate is
   visible and safe.
5. Exercise bulk quick actions on disposable pending envelopes.
6. Confirm resolved envelopes appear in audit history.

## Stop Rules

- Stop if Playwright MCP is unavailable in the session.
- Stop before destructive actions on non-disposable project data.
- Stop if auth, database, or missing test data prevents truthful browser
  evidence.
- Stop if the UI is not built and building it would require installing new
  dependencies without user approval.
