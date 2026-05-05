---
status: active
updated: 2026-05-05
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

Store screenshots, snapshots, console logs, and network logs in a per-run
directory:

```text
output/playwright/<YYYY-MM-DD>/<surface-or-lane>-<novelId-or-short-slug>/
```

Use descriptive names such as `baseline.png`, `after-modify.png`,
`console-final.md`, and `network-final.md`. Link or list the directory and key
files in the final handoff or lane doc.

After the evidence is captured, close the Playwright MCP browser tab/session.
Stop any local app server started only for the browser test.

Do not substitute screenshot generation from code inspection for real browser
evidence. If Playwright MCP is unavailable, report the browser preflight as
blocked.
