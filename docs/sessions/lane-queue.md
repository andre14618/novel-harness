# Lane Queue

This file tracks active work only. Active implementation happens on `main`
unless the user explicitly requests a disposable branch.

## Active

- Authoring harness program loop: move visibility, interactivity, diagnostics, and evidence-backed runtime slices. See `docs/authoring-harness-program-loop.md`.
- Richness Backlog lane: fact roles remain A/B-only; semantic-gate diagnostics choose the next evidence-backed slice.
- Authoring visibility/interactivity at scope ceiling: direct-mutation
  audit found only deferred higher-risk slices (plan-assist whole-outline,
  chapter-plan-reviser outline replacement).

## Next

- Use semantic-gate candidate JSON artifacts, baseline, matrix, and cohort diagnostics for fresh disposable evidence before runtime nudges; next decision-data pass should cover four to six candidate sources before promoting any planner beat-shape default. Opt continuity review flags in with `--continuity-editorial-flag-proposals`.
- For local DB-backed diagnostics, verify `15432`; if down, use a temporary LXC Postgres SSH tunnel.
- Browser-test every UI-facing slice with Playwright MCP before handoff, close
  the browser session after the pass, and leave unconfirmed evidence as TODO
  rather than inferred.
- Keep creative heuristics diagnostic-only or A/B-gated until evidence proves
  value.
- Treat mechanically repairable prose syntax as a deterministic repair surface
  before Drafting retries or Plan-Assist Gates; keep semantic/content changes
  in Settle Loops, Reviser paths, or proposal/manual review.

## Recently Closed

- Playwright evidence verification shipped: `ui:preflight` now pairs with `ui:evidence-check`.
- Deterministic quote-integrity repair shipped before prose-integrity retry/gate
  logic; detailed scoped-baseline evidence is in the semantic-gate session doc.
- Continuity L83/L84 shipped: state warnings are diagnostic noise; continuity
  does not block Drafting, and fact-scoped blockers have opt-in editorial flags.
- Semantic-gate diagnostics shipped: writer expansion, Diagnostics landing
  page, default-off planning beat-cap seam, cohort aggregation/viewer, baseline/matrix viewers, risk-driver explanations, durable candidate JSON output, candidate ranking, load-bearing discounts, action/proposal evidence, drift witnesses.
  Record: `docs/sessions/2026-05-06-semantic-gate-diagnostics.md`.
- Fact-role policy seam shipped with opt-in Canon role scoping, diagnostic
  preview, fixture eval, and live A/B runner; hidden facts stay explicit opt-in.
- Adjudicated continuity gray-zone panels and support-echo readiness reporting shipped; N≥50 evidence still holds production checker changes.
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
