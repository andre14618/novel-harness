# Lane Queue

This file tracks active and immediately actionable work only.

## Active

- Authoring visibility/interactivity foundation remains active.
- Next low-risk implementation target: review remaining high-impact direct
  planning mutations, with plan-assist whole-outline replacement treated as a
  later higher-risk slice.

## Next

- Review remaining high-impact direct planning mutations that still bypass
  proposal envelopes or lack persisted mutation lineage.
- Investigate semantic action drift and checker gray-zone warnings with
  diagnostic evidence before adding new writer/checker nudges.
- Browser-test every UI-facing slice with Playwright MCP before handoff, close
  the browser session after the pass, and leave unconfirmed evidence as TODO
  rather than inferred.
- Keep creative heuristics diagnostic-only or A/B-gated until evidence proves
  value.

## Recently Closed

- Added a diagnostic-only checker warning report over existing
  `functional-check` trace events and continuity checker `llm_calls`. Use
  `bun run diagnostics:checker-warnings -- --novel <novelId>` before relaxing
  checker behavior.
- Added a diagnostic-only plan drift report over existing
  `chapter-plan-checker` `llm_calls` rows. Use
  `bun run diagnostics:plan-drift -- --novel <novelId>` to inspect pass/fail,
  deviations, stable beat refs, and parse errors before adding writer nudges.
- Validation character-presence warnings now handle surname-only references for
  multi-part names and avoid substring matches, closing the false-positive class
  observed in the refreshed smoke fixture.
- Legacy direct artifact `PUT` routes for character/world/spine updates now
  stay disabled in runtime; meaningful artifact edits use `planning_edit`
  proposal envelopes or existing artifact-patch resolution paths.
- Beat-count calibration now uses observed writer expansion length instead of
  the old targetWords/150 assumption. The refreshed `phase-parity-smoke`
  fixture records 5 beats for a 1,500-word target, lands near target length,
  and passes `bun run test:replay`.
- Proposal-backed artifact editing guard landed in `scripts/lint/invariants-check.ts`;
  production UI cannot call direct world/character/spine PUT helpers, and the
  direct artifact route test now lives in the DB/integration tier.
- Direct planning mutations now emit lineage for plan-assist edit/override
  decisions via `chapter_exhaustions` and accepted chapter-plan-reviser outline
  replacements via `chapter_revisions`; proposal wrapping remains a later
  higher-risk slice.
- Dedicated Test and Invariant Agent role documented at
  `docs/test-invariant-agent.md`; test/invariant slices now have a repeatable
  baseline, tier-selection, invariant-promotion, and no-gap coverage handoff
  contract.
- Read-only planning target and deterministic impact-preview endpoints landed.
- Initial `planning_edit` backend slices landed for scalar chapter-outline,
  beat-plan, beat-obligation, source-link, planning-directive,
  character-bible, world-bible, and story-spine proposals.
- Planning Studio landed target navigation, impact preview, queue diffs, status
  tabs, approve/reject, grouping, impact detail, and edit-before-approve.
  Playwright evidence covered initial and modified flows on disposable novels
  `codex-planning-studio-1777948116315` and
  `codex-planning-modified-1777980329324`.
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
