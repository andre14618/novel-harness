---
status: active
updated: 2026-05-07
role: actionable-backlog
archive: archive/todo-2026-05-04-full.md
---

# To Do

This file is the actionable backlog only. Live architecture belongs in
`docs/current-state.md`; immediate active/next work belongs in
`docs/sessions/lane-queue.md`; full historical backlog snapshot is archived at
`docs/archive/todo-2026-05-04-full.md`.

## Current Priority

### Upstream Planning Methodology And Traceability

- [x] Audit durable IDs across outlines, beats, obligations, writer context,
  checker findings, proposal targets, and UI edit paths. Record gaps in
  `docs/authoring-harness-refinement-plan.md`.
- [x] Add read-only planning target map and deterministic impact-preview
  endpoints before adding new mutation paths.
- [x] Harden chapter-outline persistence so `saveChapterOutline()` stores
  enriched chapter, beat, source-item, character, and obligation IDs.
- [x] Add first proposal-backed planning write slice for scalar chapter-outline
  fields (`title`, `purpose`, `setting`, `targetWords`) with stale
  preconditions, approve/reject/modified resolution, and lineage recording.
- [x] Extend proposal-backed planning writes to scalar beat-plan fields
  (`description`, `kind`) using beat-level target hashes and containing-outline
  row locks.
- [x] Extend proposal-backed planning writes to beat-obligation `text` edits
  using obligation-level target hashes and containing-outline row locks.
- [x] Extend proposal-backed planning writes to beat-obligation source-link
  edits (`sourceId`, `sourceKind`, `characterId`, `sourceLink`) with semantic
  source registry validation.
- [x] Add proposal-backed planning writes for style/voice planning directives
  (`rawNotes`, `tonalAnchors`) with seed directive target hashes.
- [x] Add proposal-backed planning writes for character-bible scalar fields
  (`backstory`, `goals`, `fears`, `speechPattern`, `internalConflict`,
  `avoids`) with character target hashes.
- [x] Add proposal-backed planning writes for world-bible and story-spine
  scalar fields with artifact target hashes and row locks.
- [x] Add deterministic before/after diff API surfaces for planning-edit
  proposals.
- [x] Add initial Planning Studio UI for target navigation, impact preview,
  proposal creation, queue diff, status tabs, and approve/reject controls over
  the first scalar/text/link/directive/character/world/spine backend slices.
- [x] Browser-test initial Planning Studio UI with Playwright MCP before
  handoff.
- [x] Persist mutation lineage for approved chapter-outline field adjustments:
  previous target ref, next target ref, changed field path, proposal id,
  pre/post versions, reason, and affected downstream refs.
- [x] Extend mutation lineage to structural chapter/beat/obligation edits with
  supersession from old IDs to new IDs.
- [x] Expand Planning Studio with edit-before-approve/modified resolution,
  smarter grouping by target, and downstream impact preview in the queue.
- [ ] Keep further UI/Playwright work deferred unless a slice changes UI
  behavior; current product focus is upstream planning methodology.
- [x] Add chapter health and plan-to-prose traceability views from existing
  checker outputs before adding new creative checkers.
- [x] Refresh phase-parity smoke after beat-count calibration; compare word
  count, beat count, approval rate, and semantic drift rate.
- [x] Investigate semantic action drift, continuity gate behavior, and writer
  expansion from drafting before adding new writer/checker nudges.
- [ ] Build Plan Readiness Review persistence/import/disposition slices before
  UI: aggregate planner diagnostics into operator-reviewed items, capture
  human determinations, and bridge accepted changes to manual `planning_edit`
  proposals. See L91 and `docs/plan-readiness-review.md`.
- [x] Add pure fact-role policy selectors and opt-in Canon role scoping before
  wiring runtime writer/checker behavior.
- [x] Add diagnostic preview for writer-visible and continuity-blocking
  fact-role policy effects before runtime wiring.
- [x] Add per-novel A/B override for role-aware drafting context while keeping
  default runtime legacy.
- [x] Add deterministic role-context fixture eval, preserve/set fact roles in
  resume-ready drafting variant clones, and add disposable live A/B runner.
- [ ] Wire role-aware writer/checker policy only after A/B evidence improves
  outputs. Latest capped run is hold despite correct role filtering.
- [x] Build a small adjudicated continuity gray-zone panel before relaxing
  object/state conflict checks. (N=20 shipped 2026-05-05; decision L81;
  follow-up needs N≥50 across continuity-state before any checker relaxation.)
- [x] Keep Promise/Progress/Payoff as a planner-owned story-debt experiment
  until A/B evidence justifies durable production schema.
- [x] Backlog creative heuristics as diagnostic/A-B candidates only:
  scene turns, micro-tension, character agency, world-detail forcing,
  genre strictness, and editorial-letter summaries.
- [x] Backlog character voice/motivation polish after context engineering,
  deterministic flow, and interactivity are working.

### Phase 7 ApprovalPolicy Replay And Promotion

- [x] Populate route-observed `proposal_resolution_outcomes` for concrete
  edit/canon resolution seams. `prose_edit` records draft edit churn;
  `artifact_patch` records artifact edit churn; `canon_update` records
  route-observed Canon admit/reject conflict signals.
- [x] Add prose-edit checker-fire correlation foundation. Approved
  `prose_edit` resolutions now record a draft impact context keyed by resulting
  draft hash; validation checks attach observations only on exact hash match
  and roll up `downstream_checker_fired`.
- [x] Add artifact-patch impact contexts. Applied `artifact_patch` resolutions
  now record target artifact ref plus prior/result hashes for future
  artifact-aware checker attribution.
- [ ] Backlog: extend checker-fire observations beyond prose-edit validation
  checks after concrete artifact/Canon observer sources exist. Do not treat this
  as active work until a real observer path is chosen.
- [x] Wire deterministic lint proposal persistence after draft checks. Enable
  with `seed.pipelineOverrides.lintProseEditProposals=true`; the hook persists
  fixable lint issues as mechanical `prose_edit` envelopes and skips inline
  lint apply for that chapter.
- [x] Wire editorial beat-coverage proposal persistence after draft
  generation/checking. Enable with
  `seed.pipelineOverrides.editorialBeatCoverageProposals=true`; the hook runs
  the existing validator-backed producer and persists uncovered beats as
  `editorial_flag` envelopes.
- [ ] On hold indefinitely: external CI for `policy:promotion-guard`. The local
  guard remains the supported path; do not add `.github` or equivalent CI
  wiring unless a concrete repository need is reopened.

### UI Clearance

- [x] Run Playwright MCP browser preflight for the Canon proposal review panel:
  `/app/canon-proposals/:novelId`.
- [x] Run Playwright MCP browser preflight for Canon proposal bulk actions,
  audit-history status tabs, and modify-with-edits.
- [x] Run Playwright MCP browser preflight for artifact patch proposal cards:
  persisted pending load, resolve, regenerate-on-stale, bulk actions, and
  audit-history view.

### Backlog Hygiene

- [x] Keep this backlog under 150 lines.
- [x] Move parked product ideas to `docs/features-expansion-todo.md`.
- [ ] Extract reopened historical items from archive only when actionable.

## Lower Priority

- [ ] Checker calibration follow-ups: continuity subclass adjudication and
  stochastic checker convergence sweeps.
- [ ] Composite-prior methodology probe: choose one bundle before running more
  corpus/prompt experiments.
- [ ] World-building corpus expansion for future bible-extraction calibration.
- [ ] Human-confirm Step 2C planner semantic queue only if direct planner Canon
  auto-commit is reopened.

## Parked Product Ideas

See `docs/features-expansion-todo.md` for branch search, external idea
ingestion, prose quality track, audiobook/TTS exploration, deep-authoring UI,
small-model checker POCs, adapter provenance, and character-name normalization.
