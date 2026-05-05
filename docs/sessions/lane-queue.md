# Lane Queue

This file tracks only active and immediately actionable work. Full historical
snapshot archived at `docs/sessions/archive/lane-queue-2026-05-04-full.md`.

## Active

- Test harness reliability cleanup. Follow
  `docs/test-harness-reliability-plan.md`; first restore trustworthy fast/DB
  test gates, then resume broader authoring UI/backend slices.
- Authoring visibility/interactivity foundation remains the product lane, but
  broad new implementation should wait until the test-harness lane has a clean
  supported gate.

## Next

- Inventory current test tiers and separate pure unit, DB integration,
  browser/e2e, archived eval, and long-running experiment coverage.
- Diagnose current full-suite failure clusters from the 2026-05-05 `bun test`
  run: canon proposal telemetry zero rows, chapter exhaustion cleanup zero
  rows, planning-target fixture ID drift, DB route 404/409 clusters, archived
  missing-module test, and phase parity mismatch.
- Extend stable-ID coverage in checker findings before traceability UI.
- Remaining stable-ID coverage hotspot: entity ID resolution for
  halluc-ungrounded findings.
- Add structural mutation lineage for beat/obligation replace/reorder
  operations before supporting structural UI edits.
- Figure out how to let Playwright handle local UI testing more autonomously:
  create a reusable preflight runner that captures screenshots, network, and
  console evidence with disposable data and clear guardrails.
- Browser-test every UI-facing slice with Playwright MCP before handoff.
- Keep creative heuristics diagnostic-only or A/B-gated until evidence proves
  value.

## Recently Closed

- UI/browser clearance for proposal surfaces passed via Playwright MCP on
  disposable novel `codex-ui-preflight-1777936779921`.
- Canon proposal review evidence covered load, approve/reject,
  modify-with-edits, status tabs, bulk reject, and bulk approve.
- Studio artifact patch card evidence covered pending load, single resolve,
  stale regeneration surface, bulk actions, and audit history.
- Evidence screenshots are stored at the repository root as `canon-*` and
  `artifact-*` PNG files.
- Follow-up UI fixes: preserve structured stale-precondition `409` responses for
  artifact regenerate handling, and remove stale Canon browser-untested copy.
- Read-only planning target and deterministic impact-preview endpoints landed.
- First `planning_edit` backend slice landed for scalar chapter-outline field
  proposals with approval/rejection/modification, stale-precondition handling,
  and persisted mutation lineage.
- Second `planning_edit` backend slice landed for scalar beat-plan
  `description`/`kind` proposals using beat-level target hashes.
- Third `planning_edit` backend slice landed for beat-obligation `text`
  proposals using obligation-level target hashes.
- Fourth `planning_edit` backend slice landed for beat-obligation source-link
  proposals using obligation-level target hashes and semantic source registry
  validation.
- Fifth `planning_edit` backend slice landed for planning-directive
  `rawNotes`/`tonalAnchors` proposals using seed directive target hashes.
- Sixth `planning_edit` backend slice landed for character-bible scalar
  `backstory`/`goals`/`fears`/`speechPattern`/`internalConflict`/`avoids`
  proposals using character target hashes.
- Seventh `planning_edit` backend slice landed for world-bible scalar fields
  and story-spine scalar fields using artifact target hashes and row locks.
- Eighth `planning_edit` backend slice landed deterministic before/after diff
  helpers, a read-only diff endpoint, and UI API wrappers for future Planning
  Studio wiring.
- Ninth `planning_edit` UI slice landed initial Planning Studio target
  navigation, impact preview, proposal creation, queue diff, status tabs, and
  approve/reject controls. Playwright MCP evidence on disposable novel
  `codex-planning-studio-1777948116315` covered target load, create/approve,
  pending stale display, rejected/approved tabs, Pipeline/Snapshot/Canon Queue
  links, mobile rendering, clean console, and all relevant API calls returning
  `200`.
- Tenth `planning_edit` UI slice expanded Planning Studio queue review with
  grouping by target, queue impact detail, edit-before-approve, and modified
  resolution. Playwright MCP evidence on disposable novel
  `codex-planning-modified-1777980329324` covered live create, edit, resolve
  modified, modified-tab diff display, and mobile rendering. The diff endpoint
  now reads `modified_payload` for modified proposals.
- Chapter-plan checker stable-ref slice landed: drafting attaches durable
  `beatId` to checker deviations from `outline.scenes[beat_index].beatId`
  while preserving the legacy `beat_index` contract.
- Beat-level LLM telemetry now persists `llm_calls.beat_id` for beat writer,
  targeted beat rewrites, adherence checks, and halluc-ungrounded checks.
- Validation now emits additive structured `findings[]` with stable beat refs
  for validation-mode beat keyword checks while preserving blocker/warning
  string behavior.
- Validation structured findings now carry durable chapter refs on all findings,
  and lint-generated prose edit span targets now carry optional beat refs when
  an exact beat-prose map is available.
- Drafting validation rewrite routing now uses structured validation finding
  codes/refs first, with legacy blocker-string routing retained as fallback.

## Parked

- Artifact/Canon checker observation sources are backlog until concrete
  artifact-aware or Canon-generation-aware observers exist.
- External CI for `policy:promotion-guard` is on hold indefinitely. Keep the
  local guard as the supported path unless the user reopens a concrete CI need.

## Closed History

Use the archive for completed lane detail:

- `docs/sessions/archive/lane-queue-2026-05-04-full.md`
