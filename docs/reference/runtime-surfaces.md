---
status: active
updated: 2026-05-10
role: reference
source: docs/current-state.md compaction
---

# Runtime Surfaces Reference

This reference preserves active implementation inventory that should not bloat
`docs/current-state.md`. Load it when touching planning/drafting/checker
runtime, traceability, diagnostics, or UI review surfaces.

## Planning And Authoring

- Product focus is upstream concept/planning methodology: templates, chapter
  contracts, scene functions, obligation traceability, and planner-quality
  diagnostics before broad drafting/checking/UI changes.
- Scene-first runtime promotion slices L095-L098 are shipped default-off:
  planner scene contract substrate, scene-call writer rendering, writer
  expansion mode, and scene-satisfaction diagnostic wiring.
- `scripts/test-drafting-isolated.ts`,
  `scripts/evals/scene-semantic-review.ts`, and
  `scripts/evals/scene-checker-parity-panel.ts` support default-off evidence.
- `thread-character-context-v1` is the production writer-context default after
  POC evidence improved expansion without semantic lows.
- Beat caps and `calibrated:packed` remain diagnostic-only; L088 makes native
  chapter contracts/story-turn planning the production default with rollback.

## Stable IDs And Telemetry

- Chapter-outline saves persist enriched stable IDs for chapters, scenes,
  legacy beats, source items, characters, and obligations.
- `sceneId` is the per-entry identity for scene-first work. `beatId` is retained
  only for real beat hints, legacy beat-shaped entries, and beat-specific
  records.
- Planning directives carry optional story thread/debt/payoff refs.
- Mapper obligations and writer telemetry carry active
  `threadId`/`promiseId`/`payoffId`; deterministic mapper ref validation is
  warning-only.
- Scene-level LLM telemetry persists `llm_calls.scene_id` for scene-first
  writer/checker surfaces. `beat_id` is retained only for legacy beat-shaped
  entries and beat-specific records.
- Halluc-ungrounded metadata carries exact-match `entityRefs[]` for
  `character`, `world_system`, and `culture` targets when deterministic
  resolution is possible.

## Planning Edit And Studio Surfaces

- Backend tracers expose read-only planning targets, deterministic impact
  preview, and `planning_edit` envelopes for chapter, scene/legacy-beat,
  obligation, directive, character, world, and spine scalar fields.
- Planning-edit create/apply responses include deterministic before/after
  diffs. `GET /api/novel/:novelId/planning-proposals/:envelopeId/diff` exposes
  read-only diff, target staleness, and impact-preview data.
- Planning Studio supports target navigation, impact preview, queue diffs,
  status tabs, approve/reject, grouped proposal review, and edit-before-approve
  modified resolution.
- Studio artifact preview inline edits for supported world/character/spine
  scalar fields queue `planning_edit` envelopes instead of directly mutating
  artifacts.
- Legacy direct artifact `PUT` routes are disabled in runtime. Use
  `/api/novel/:novelId/planning-proposals`.
- Production UI is guarded against direct artifact PUT callers by
  `scripts/lint/invariants-check.ts`.

## Checker And Diagnostic Posture

- Continuity findings do not open Drafting Plan-Assist Gates by themselves.
  Fact-scoped blockers can optionally persist manual `editorial_flag`
  envelopes; see L084.
- World fact roles are additive on `facts` and `canon_facts`. Runtime stays
  legacy by default; `factRoleContextPolicy: "role-aware"` remains A/B-only.
- `validateChapterDraft()` emits structured `findings[]` with stable chapter
  refs and stable beat refs for validation-mode beat keyword checks while
  preserving legacy blocker/warning strings.
- Character-presence validation accepts full-name, first-name, or surname
  word-boundary references.
- Drafting validation rewrite routing prefers structured finding codes/refs and
  keeps blocker-string routing only as a compatibility fallback.
- Plan-assist `edit-plan` and `override` remain manual-gate actions; drafting
  records `planning_mutation_lineage` from `chapter_exhaustions` and preserves
  chapter IDs across replacement outlines.
- Accepted chapter-plan-reviser replacements record
  `planning_mutation_lineage` from `chapter_revisions`.

## Read-Only Review Surfaces

- `GET /api/novel/:novelId/chapter-health` recomputes deterministic validation
  and attaches open issues, pending editorial/prose proposals, trace events,
  checker calls, and checker-observation refs.
- `/app/chapter-health/:novelId` renders chapter health with status filters,
  chapter cards, refs, and trace/proposal evidence.
- `GET /api/novel/:novelId/traceability/chapter/:chapterNumber` exposes
  ID-first chapter trace: scene/legacy-beat refs, obligation refs, source
  registry links, and writer/checker/event evidence with explicit positional
  fallback.
- `/app/traceability/:novelId/chapter/:chapterNumber` renders source registry,
  upstream targets, writer/checker/event evidence, and
  proposal/outcome/observation/lineage evidence.

## Browser Evidence

- UI-facing work must use Playwright MCP before handoff.
- Evidence belongs under `output/playwright/<YYYY-MM-DD>/...`.
- Use `bun run ui:preflight -- --surface <surface> --novel <id> --url <path>`
  before browser actions, and
  `bun run ui:evidence-check -- --dir <evidence-dir>` after the pass.
- Close the browser session and stop test-only app servers after completion.

## Parked Or Lower Priority

- Visibility/interactivity foundation is at scope ceiling unless a UI surface
  changes as part of a specific accepted slice.
- Broader checker entity resolution is parked until there is a canonical entity
  registry or explicit checker output contract.
- Artifact/Canon checker observation sources are parked until concrete
  observers exist.
