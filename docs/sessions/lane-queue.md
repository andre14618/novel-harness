# Lane Queue

This file tracks active and immediately actionable work only.

## Active

- Richness Backlog lane (2026-05-06): world fact roles. Substrate/diagnostics
  are shipped; default stays legacy. Latest capped A/B is hold: role filtering
  worked, but both arms gated on chapter-2 continuity and role-aware regressed
  cost/hallucination. Next: diagnose semantic gate/writer expansion.
- Authoring visibility/interactivity at scope ceiling: direct-mutation
  audit found only deferred higher-risk slices (plan-assist whole-outline,
  chapter-plan-reviser outline replacement).

## Next

- Investigate semantic action drift and checker gray-zone warnings with
  diagnostic evidence (`diagnostics:plan-drift`,
  `diagnostics:writer-expansion`, `diagnostics:checker-warnings`,
  `diagnostics:plan-assist-lineage`) before adding writer/checker nudges.
- Browser-test every UI-facing slice with Playwright MCP before handoff, close
  the browser session after the pass, and leave unconfirmed evidence as TODO
  rather than inferred.
- Keep creative heuristics diagnostic-only or A/B-gated until evidence proves
  value.

## Recently Closed

- Fact-role policy seam shipped: pure selectors, opt-in Canon role scoping,
  diagnostic preview, fixture eval, resume-ready clones, live A/B runner with
  terminal gate evidence / promotion verdict, and per-novel drafting override.
  Hidden Canon facts require explicit `forceIncludeHiddenFacts` before
  `includeFactIds` can surface them.
- Adjudicated continuity gray-zone panel N=20 shipped (decision L81).
  continuity-facts blocker/warning at 60% TP (do not relax);
  continuity-state/warning is the dominant gray zone (20% TP / 40% FP / 40%
  AMB, mostly off-page transitions and figurative aspirations); follow-up
  needs N≥50 across continuity-state before any production checker change.
- Added `diagnostics:plan-assist-lineage` over `planning_mutation_lineage`
  rows from `chapter_exhaustions` / `chapter_revisions`. Smoke-verified
  against `test-novel` (7 events). Feeds the deferred envelope-wrap
  decision on plan-assist + reviser outline replacement.
- Fixed the fast test runner's process shape for phase tests that install
  process-global Bun module mocks. `bun run test:fast` now runs those files in
  isolated subprocesses and keeps the phase contract test in the normal fast
  chunk without cross-test mock poisoning.
- Added a diagnostic-only checker warning report over existing
  `functional-check` trace events and continuity checker `llm_calls`. Use
  `bun run diagnostics:checker-warnings -- --novel <novelId>` before relaxing
  checker behavior.
- Added a diagnostic-only plan drift report over existing `chapter-plan-checker`
  calls. Use `diagnostics:plan-drift` to inspect pass/fail,
  recovered/unresolved drift, stable beat refs, and parse errors.
- Validation character-presence warnings now handle surname-only references for
  multi-part names and avoid substring matches, closing the false-positive class
  observed in the refreshed smoke fixture.
- Legacy direct artifact `PUT` routes for character/world/spine updates now
  stay disabled in runtime; meaningful artifact edits use `planning_edit`
  proposal envelopes or existing artifact-patch resolution paths.
- Beat-count calibration now uses observed writer expansion length, not
  targetWords/150; refreshed phase-parity-smoke records 5 beats for 1,500
  words and passes `bun run test:replay`.
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
- Validation findings carry durable chapter/beat refs and drafting-rewrite
  routing prefers structured codes; halluc-ungrounded blockers preserve
  `entityRefs[]` and the containing `beatId`. Older detail archived in
  `docs/sessions/archive/lane-queue-2026-05-04-full.md`.
- Structural planning-edit routes and Structural Planning Studio UI shipped
  the beat/obligation replace/reorder action surface with persisted structural
  lineage; Playwright evidence on `codex-structural-ui-1777995796883`.

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
