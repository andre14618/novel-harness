# Lane Queue

This file tracks only active and immediately actionable work. Full historical
snapshot archived at `docs/sessions/archive/lane-queue-2026-05-04-full.md`.

## Active

- Authoring visibility/interactivity foundation remains the product lane and
  should use the Test and Invariant Agent contract for test/guard slices.

## Next

- Refresh the phase-parity fixture in a dedicated commit if the current
  prompt/request drift is intentional. Current opt-in failure:
  `ReplayTransport miss: 1dd73b5c320260717ff5bfefd77593cc`.
- Figure out how to let Playwright handle local UI testing more autonomously:
  create a reusable preflight runner that captures screenshots, network, and
  console evidence with disposable data and clear guardrails.
- Browser-test every UI-facing slice with Playwright MCP before handoff.
- Keep creative heuristics diagnostic-only or A/B-gated until evidence proves
  value.

## Recently Closed

- Dedicated Test and Invariant Agent role documented at
  `docs/test-invariant-agent.md`; test/invariant slices now have a repeatable
  baseline, tier-selection, invariant-promotion, and no-gap coverage handoff
  contract.
- Tiered test runner restored useful local gates: `bun run test:fast`,
  `bun run test:db`, `bun run test:archive`, `bun run test:list`, and explicit
  opt-in `bun run test:replay`.
- DB integration tests now run one file per process with `BUN_SQL_MAX=1`.
  Planning target/snapshot DB reads were made serial where a single connection
  and transactional `Promise.all` could stall.
- Archived eval tests were split out of default coverage and the archived
  Arm-B parity import path was repaired.
- UI/browser clearance for proposal surfaces passed via Playwright MCP on
  disposable novel `codex-ui-preflight-1777936779921`.
- Canon proposal review evidence covered load, approve/reject,
  modify-with-edits, status tabs, bulk reject, and bulk approve.
- Studio artifact patch card evidence covered pending load, single resolve,
  stale regeneration surface, bulk actions, and audit history.
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
- Chapter-health tracer slice landed `GET /api/novel/:novelId/chapter-health`
  with deterministic validation, durable refs, and issue/proposal/trace/checker
  aggregation.
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
- Halluc-ungrounded issue metadata now carries deterministic exact-match
  `entityRefs[]` for `character`, `world_system`, and `culture` targets,
  threads that metadata through beat-check aggregation, and preserves it on
  accepted blocker deviations with the containing `beatId`.
- Structural planning-edit routes now create/apply beat and beat-obligation
  replace/reorder edits, with exact-ID structural lineage persisted.
- Structural Planning Studio UI now creates explicit beat/obligation
  replace/reorder proposal actions and preserves structural modified payloads.
  Playwright MCP evidence on disposable novel
  `codex-structural-ui-1777995796883` covered load, approve/reject/modified
  paths, status tabs, and target-refresh recovery after stable ID replacement.

## Parked

- Broader checker entity resolution for aliases, display-name variants,
  outline-derived entities, free-form allowed-new entities, and legacy
  world-location refs remains parked until there is a canonical entity registry
  or explicit checker output contract.
- Artifact/Canon checker observation sources are backlog until concrete
  artifact-aware or Canon-generation-aware observers exist.
- External CI for `policy:promotion-guard` is on hold indefinitely. Keep the
  local guard as the supported path unless the user reopens a concrete CI need.

## Closed History

Completed lane detail: `docs/sessions/archive/lane-queue-2026-05-04-full.md`.
