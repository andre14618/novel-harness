---
status: active
updated: 2026-05-04
role: ui-verification-gate
---

# UI Work Gate

Any UI-facing feature or fix must be browser-tested with Playwright MCP before
handoff. Unit tests, build checks, and code inspection are not enough for UI
clearance.

Use `docs/how-to/playwright-mcp-browser-testing.md` as the runbook.

## Required Evidence

Each UI handoff should include:

- load screenshot for the changed surface
- at least one successful interaction screenshot
- one edge/error/stale/empty state when the feature has such a state
- one adjacent-surface regression check when the change touches shared UI,
  shared API helpers, or proposal/review flows
- note of disposable/test data used
- console/network blockers, if any

## Scope

The gate applies to:

- net-new UI surfaces
- non-trivial visible UI fixes
- API/client changes that alter visible UI states
- proposal/review UX changes
- routing/navigation changes

Tiny text-only docs edits do not need browser evidence. If a visible UI change
is too small to justify a full scenario, record that judgment in the handoff.

## Storage

Screenshots may be stored at the repository root with descriptive names during
local clearance. Link or list the files in the final handoff or lane doc.

Do not substitute screenshot generation from code inspection for real browser
evidence. If Playwright MCP is unavailable, report the browser preflight as
blocked.
