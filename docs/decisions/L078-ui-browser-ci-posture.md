---
status: active
date: 2026-05-04
decision: ui-browser-ci-posture
---

# L78 UI Browser And CI Posture

## Decision

Use Playwright MCP as the preferred browser preflight path for proposal UI.
Agents should capture screenshots and interaction evidence before asking the
user for final visual approval.

Keep external CI for `policy:promotion-guard` on hold indefinitely. This
repository is not being optimized as a long-term multi-developer engineering
project, and there is no current `.github` or equivalent CI surface to wire.
The local guard remains the supported safety gate.

Move artifact/Canon checker observation expansion to backlog. Prose-edit
draft-hash attribution and artifact impact contexts are enough for the current
Phase 7 evidence loop; additional observer writes should wait until real
artifact-aware or Canon-generation-aware checker sources exist.

Accept the autonomy posture from L76/L77: manual review remains the product
default, deterministic mechanical assisted paths are allowed with replay/guard
evidence, and Canon autonomy requires a new explicit decision.

## Implications

- Browser UI work should proceed through
  `docs/how-to/playwright-mcp-browser-testing.md`.
- If Playwright MCP is unavailable in a session, browser evidence is blocked.
  Do not fake screenshots or substitute code inspection for browser approval.
- Do not add external CI config unless the user reopens a concrete need.
- Do not implement inferred artifact/Canon checker attribution without an
  explicit observer correlation contract.
