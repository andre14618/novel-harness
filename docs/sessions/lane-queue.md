# Lane Queue

This file tracks only active and immediately actionable work. Full historical
snapshot archived at `docs/sessions/archive/lane-queue-2026-05-04-full.md`.

## Active

- Authoring visibility/interactivity foundation remains active.
- Next low-risk implementation target: review remaining high-impact direct
  planning mutations, with plan-assist whole-outline replacement treated as a
  later higher-risk slice.

## Next

- Refresh the phase-parity fixture in a dedicated commit if the current
  prompt/request drift is intentional. Current opt-in failure:
  `ReplayTransport miss: 1dd73b5c320260717ff5bfefd77593cc`.
- Browser-test every UI-facing slice with Playwright MCP before handoff, close
  the browser session after the pass, and leave unconfirmed evidence as TODO
  rather than inferred.
- Keep creative heuristics diagnostic-only or A/B-gated until evidence proves
  value.

## Recently Closed

- Proposal-backed artifact editing guard landed in `scripts/lint/invariants-check.ts`;
  production UI cannot call direct world/character/spine PUT helpers, and the
  direct artifact route test now lives in the DB/integration tier.
- Plan-assist direct manual decisions now preserve chapter IDs on replacement
  outlines and record `planning_mutation_lineage` rows sourced from
  `chapter_exhaustions`; whole-outline proposal wrapping remains a later
  higher-risk slice.
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
- Initial `planning_edit` backend slices landed for scalar chapter-outline,
  beat-plan, beat-obligation, source-link, planning-directive,
  character-bible, world-bible, and story-spine proposals.
- Planning Studio landed target navigation, impact preview, queue diffs, status
  tabs, approve/reject, grouping, impact detail, and edit-before-approve.
  Playwright evidence covered initial and modified flows on disposable novels
  `codex-planning-studio-1777948116315` and
  `codex-planning-modified-1777980329324`.
- Studio artifact preview inline edits for supported world/character/spine
  fields now queue `planning_edit` proposals instead of direct artifact PUTs;
  unsupported fields render read-only, and direct artifact PUT routes are
  explicit-opt-in only. Playwright MCP evidence on disposable novel
  `codex-traceability-ui-1778003397963` covered supported world-setting
  proposal creation, read-only unsupported world fields, clean console, and no
  artifact PUT network calls.
- Chapter-health landed `GET /chapter-health` and
  `/app/chapter-health/:novelId`; Playwright evidence on disposable novel
  `codex-chapter-health-ui-1778000670807` covered health load, filters,
  evidence expansion, mobile, and clean console/API.
- Traceability UI landed at
  `/app/traceability/:novelId/chapter/:chapterNumber`, with source registry,
  upstream target, writer/checker/event, proposal outcome, checker observation,
  and mutation-lineage evidence. Playwright MCP evidence on disposable novel
  `codex-traceability-ui-1778003397963` covered direct load, evidence expansion,
  health-card Trace navigation, mobile rendering, clean console, and `200`
  traceability/health API calls.
- Local Playwright preflight setup helper landed as `bun run ui:preflight`;
  it creates the evidence directory, runbook, console/network placeholders, and
  manifest without adding browser-driver dependencies.
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

Closed history: `docs/sessions/archive/lane-queue-2026-05-04-full.md`.
