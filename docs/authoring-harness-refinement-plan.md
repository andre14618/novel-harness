---
status: active
updated: 2026-05-04
role: authoring-refinement-backlog
---

# Authoring Harness Refinement Plan

This backlog refines `docs/author-grounded-backlog.md` and
`docs/planning-backlog-analysis.md` around one product goal: make Novel Harness
better at structuring and telling a novel under operator influence.

The next work is not a new architecture direction. The repo already has the
right spine: Canon substrate, proposal envelopes, planning snapshots, stable
IDs, checkers, replay, and UI review surfaces. The refinement is to make those
systems serve authoring quality: richer bibles, editable plans, deterministic
impact awareness, and evidence-gated creative improvements.

## Principles

1. **Operator-shaped, not phase-locked.** Keep the guided first pass, but after
   planning exists, let operators navigate and revise world, character, plot,
   outline, beat, and style surfaces without full rewinds.
2. **IDs over text matching.** Use durable artifact IDs for traceability,
   impact detection, proposal targets, and UI edits. Text similarity is a
   fallback, not an identity model.
3. **Proposal-backed edits.** Meaningful planning/story changes flow through
   proposal envelopes with preconditions, diffs, audit history, and stale
   detection. Direct mutation should be reserved for narrow admin/debug paths.
4. **Deterministic impact first.** Before LLM reasoning about consequences,
   expose what can be known from IDs, snapshot hashes, target refs, and stored
   dependency edges.
5. **Persistent lineage for mutation.** Read-only target maps may derive links
   from current artifacts, but approved human/agent adjustments must persist the
   mutation chain: old target refs, new target refs, changed field paths,
   proposal id, precondition, and downstream impact context.
6. **Evidence before production wiring.** Craft heuristics that alter planner,
   writer, or checker behavior must start as diagnostic-only or A/B-gated
   experiments. Do not make them default production behavior without a baseline,
   changed lever, signal, stop gate, and replay/eval evidence.
7. **UI work needs browser evidence.** Any UI-facing feature or fix requires
   Playwright MCP evidence before handoff.

## Existing Foundation

These pieces already exist and should be deepened rather than replaced:

- `src/harness/ids.ts` assigns stable `chapterId`, `beatId`, knowledge/state
  IDs, `characterId`, and `obligationId`; obligation coverage uses explicit
  `sourceId`.
- `src/schemas/shared.ts` gives `SceneBeat` a writer/checker-facing beat
  contract through obligations and stable beat IDs.
- `src/agents/planning-plotter/schema.ts` preserves `chapterId`,
  `charactersPresentIds`, stable fact IDs, character state IDs, and knowledge
  change IDs in persisted outlines.
- `src/canon/planning-snapshot.ts` computes deterministic snapshot hashes over
  world, characters, spine, outlines, world systems, cultures, and related graph
  rows.
- `src/canon/proposal-envelope.ts` already has target refs, preconditions,
  evidence, policy recommendation, risk, and audit-oriented envelope structure.
- Proposal routes already enforce stale preconditions for artifact, Canon, and
  prose surfaces.

The main gap is not that IDs are absent. The gap is proving that they remain
visible and useful across the whole authoring loop: planning persistence,
writer context, checker findings, proposal review, UI editing, and impact
preview.

## Durable ID Readiness Audit

First implementation work should audit and harden the ID chain before adding
new creative behavior.

Known durable identifiers:

- `novelId`
- `chapterId` and `chapterNumber`
- `beatId`
- `obligationId`
- obligation `sourceId` plus `sourceKind`
- `characterId`
- established fact IDs
- knowledge/state change IDs
- Canon entity/fact/promise IDs
- proposal `target.kind`, `target.ref`, `fieldPath`, and `currentVersion`
- planning snapshot hash and artifact/draft hashes

Audit questions (status as of 2026-05-05):

- Persisted outlines enriched before storage and after repair/replan —
  **resolved**: `saveChapterOutline()` enrichment hardening shipped; chapter
  traceability covers downstream refs.
- Writer contexts and LLM call metadata preserve `chapterId` and `beatId` —
  **resolved**: `llm_calls.beat_id` persisted for beat writer, targeted beat
  rewrites, adherence checks, and halluc-ungrounded checks.
- Checker findings carry `beatId` / `obligationId` / `sourceId` —
  **mostly resolved**: chapter-plan checker, validation findings, and
  halluc-ungrounded carry stable refs; remaining checker-coverage backlog
  tracked in `docs/stable-id-checker-coverage.md`.
- UI surfaces display and submit target refs — **resolved**: Planning Studio
  + Structural Planning Studio + Traceability UI all key off target refs.
- Direct `PUT` edit routes bypassing proposal envelopes — **resolved**:
  character/world/spine direct PUTs gated off; plan-assist whole-outline and
  chapter-plan-reviser outline replacements still write directly but emit
  durable lineage via `chapter_exhaustions` / `chapter_revisions`. Envelope
  wrapping for those two paths is the explicit deferred higher-risk slice.
- Planning directives and style/voice constraints with stable refs —
  **resolved**: `planning_directive` proposal envelopes exist for `rawNotes`
  and `tonalAnchors`.
- World-system / culture / faction / promise-like artifacts with IDs —
  **partial**: world-bible and story-spine scalar refs covered; world-system,
  culture, faction, and promise-payoff ID work tracked in
  `docs/world-knowledge-graph.md`.

Deliverable: a target map document plus focused tests proving ID preservation
on the first supported path.

Initial 2026-05-04 audit result:

- Durable IDs are present for outlines, beats, obligations, source items,
  characters, proposal targets, and snapshot hashes.
- Highest-risk gaps remain: `saveChapterOutline()` persists raw outline JSON
  without enforcing enrichment; several checker outputs still report
  beat-index/text findings instead of `beatId`/`obligationId`; plan-assist
  editing still replaces whole outlines outside proposal envelopes.
- First backend tracer bullet added read-only planning target and impact-preview
  routes so later proposal-backed writes can target known refs before mutation.
- First persistence hardening makes `saveChapterOutline()` store enriched IDs
  instead of relying on later read paths to synthesize chapter/beat/obligation
  refs.
- First mutation tracer bullets now exist for scalar chapter-outline,
  beat-plan, beat-obligation text/source-link edits, planning-directive
  style/voice edits, character-bible scalar edits, and world/spine scalar
  edits: `planning_edit` proposal envelopes target `chapter_outline`,
  `beat_plan`, `beat_obligation`, `planning_directive`, `character`,
  `world_bible`, or `story_spine` refs,
  approvals/rejections/modifications use stale preconditions, and approved
  changes write durable mutation lineage with affected refs from impact
  preview.

Detailed coverage table per checker / proposal-producer surface lives in
`docs/stable-id-checker-coverage.md`. The 2026-05-04 mechanical pass threaded
durable beat refs through `editorial-beat-coverage` proposals and added
`beatId` / `factId` / `payoffBeatId` to `phases/functional-checks` findings.
The main backlog items (continuity, functional-state checker,
halluc-ungrounded `beat_id` persistence, structured `validation.ts` findings)
are listed there with the input data each one needs.

## First Several Steps

### Step 1 - Target Map And Impact Readiness

Build a read-only target map for existing planning artifacts. This is the
foundation for deterministic editing and downstream impact preview.

Candidate targets:

- `planning_directive:<key>`
- `world_bible:singleton`
- `world_fact:<factId>`
- `world_system:<systemId>`
- `culture:<cultureId>`
- `character:<characterId>`
- `story_spine:singleton`
- `chapter_outline:<chapterId>`
- `beat_plan:<beatId>`
- `beat_obligation:<obligationId>`
- `canon_fact:<factId>`
- `prose_span:<chapterRef>#<spanRef>`

Acceptance criteria:

- A deterministic helper can list editable targets for a novel.
- Each target includes kind, ref, display label, field paths, current hash or
  snapshot version, and known upstream/downstream references.
- Missing IDs are surfaced as validation findings, not silently papered over.
- Unit tests cover chapter outline, beat, character, world, and story spine
  target extraction.

### Step 2 - Read-Only Visibility Endpoints

Add endpoints that expose the target map and deterministic impact preview
without mutating story state.

Candidate endpoints:

```text
GET  /api/novel/:novelId/planning-targets
GET  /api/novel/:novelId/planning-targets/:targetKind/:targetRef
POST /api/novel/:novelId/planning-impact/preview
GET  /api/novel/:novelId/chapter-health
GET  /api/novel/:novelId/traceability/chapter/:chapterNumber
```

Impact preview should initially report deterministic relationships only:

- chapters and beats that reference a target ID
- obligations sourced from a target ID
- proposals targeting or derived from the same artifact
- current planning snapshot hash and whether the target participates in it
- drafts with known hash/impact context from proposal outcomes

Do not infer creative consequences with an LLM in this first slice.

Status 2026-05-04: backend tracer bullet implemented for the three endpoints
above. The impact preview is deterministic-only: direct target, planning
snapshot participation, ID-based chapter/beat/obligation references, matching
proposal-envelope targets, and recorded proposal-resolution impacts.

Related hardening: `saveChapterOutline()` now normalizes outlines through
stable-ID enrichment before persistence. Missing `sourceId` remains a visible
target-map validation finding; the write boundary only guarantees durable
artifact IDs, not semantic coverage.

### Step 3 - Proposal-Backed Planning Write Endpoints

Add a generic proposal creation path for planning edits. The endpoint should
create proposal envelopes; it should not directly apply planning changes.

Candidate endpoint:

```text
POST /api/novel/:novelId/planning-proposals
POST /api/novel/:novelId/planning-proposals/:envelopeId/resolve
```

Request shape should include:

- target ref
- field path
- proposed value or patch operation
- operator note/rationale
- precondition hash or snapshot hash
- optional dry-run impact preview

The first supported write targets should be:

1. chapter outline fields
2. beat plan fields
3. style/voice planning directives
4. character fields
5. world-bible fields
6. story-spine fields

Acceptance criteria:

- Changes create pending proposal envelopes with target refs and preconditions.
- Approve/reject/modified resolution reuses existing audit and stale handling.
- Before/after diff data is available before approval.
- A stale target returns a structured stale-precondition response.
- Approval persists mutation lineage for any changed target refs:
  `previousRef`, `nextRef`, changed field path, proposal id, actor/source, and
  reason.
- Structural edits that replace chapters/beats/obligations preserve a
  supersession chain instead of leaving downstream references orphaned.

Status 2026-05-04: first low-risk write slices implemented for
`chapter_outline` scalar field replacements on `title`, `purpose`, `setting`,
and `targetWords`; `beat_plan` scalar field replacements on `description` and
`kind`; and `beat_obligation` replacements for `text`, `sourceId`,
`sourceKind`, `characterId`, and atomic `sourceLink`; plus
`planning_directive` replacements for style/voice fields `rawNotes` and
`tonalAnchors`; plus `character` replacements for `backstory`, `goals`,
`fears`, `speechPattern`, `internalConflict`, and `avoids`; plus
`world_bible` scalar replacements for `setting`, `timePeriod`, `geography`,
`politicalStructure`, `technologyConstraints`, `sensoryPalette`, `culture`,
and `history`; plus `story_spine` scalar replacements for `centralConflict`,
`theme`, and `endingDirection`. The route creates `planning_edit` envelopes,
resolves them server-side by envelope id, locks the containing outline, seed
row, character row, world-bible row, or story-spine row, checks the target
hash, and returns structured `stale-precondition` responses when the target
moved. Source-link edits are validated against the containing obligation list
and chapter source registry.

Lineage status 2026-05-05: structural lineage detection is implemented as a
pure helper for exact-ID beat/obligation reorders and same-slot replacements,
and planning proposal resolution is wired to persist those structural
supersession rows in the same transaction as the resolved proposal.

Structural action status 2026-05-05: backend `planning_edit` routes now create
and apply `beat_replace`, `beat_reorder`, `beat_obligation_replace`, and
`beat_obligation_reorder` proposals with stale preconditions, modified-payload
validation, DB smoke coverage, and structural mutation lineage. The remaining
backlog item is Planning Studio UI controls that call those actions.

Diff status 2026-05-04: `planning_edit` envelopes now have a deterministic
before/after diff helper. Create/apply responses include the diff, and
`GET /api/novel/:novelId/planning-proposals/:envelopeId/diff` returns the
stored diff, current target value/version, stale status, and impact-preview
data without mutating story state.

### Step 3A - Persistent Dependency And Mutation Lineage

The target map is allowed to derive links from the current artifact graph. The
mutation history is not. Human and agent adjustments need durable linkage so
operators can see how IDs changed over time and why downstream artifacts became
stale.

Minimum persisted lineage shape:

- `novelId`
- `proposalId`
- `actorKind` / `source`
- `targetKind`
- `previousRef`
- `nextRef`
- `fieldPath`
- `previousVersion`
- `nextVersion`
- `changedAt`
- `reason`
- affected downstream refs captured from impact preview

Acceptance criteria:

- Approving a planning edit records old/new target refs even when the visible
  label or beat text changes.
- Reordering or replacing beats records supersession from prior `beatId` to new
  `beatId`.
- Downstream impact preview can include both current derived links and persisted
  historical mutation links.
- The UI can distinguish "this target currently depends on X" from "this target
  used to be X before proposal Y changed it."

Status 2026-05-04: `planning_mutation_lineage` now records approved
`planning_edit` mutations for scalar chapter-outline, beat-plan, and
beat-obligation text/source-link field paths, plus planning-directive
`rawNotes`/`tonalAnchors` field paths, character-bible scalar field paths, and
world-bible/story-spine scalar field paths. Impact preview includes historical
`mutation_lineage` entries alongside current derived links.

Status 2026-05-05: structural supersession detection exists for
replaced/reordered beats and obligations. The detector uses exact stable IDs
for reorders and conservative same-slot exact-ID absence for replacements; it
does not use text overlap or fuzzy matching. Proposal resolution persists
emitted structural lineage drafts transactionally for the backend structural
proposal routes; UI controls are still pending.

### Step 4 - Planning Studio UI Shell

Expose editing and impact awareness in the operator UI.

Initial UI surface:

- planning target navigator
- chapter outline editor
- beat plan editor
- style/voice constraint editor
- impact preview drawer
- proposal preview before submit
- proposal queue grouped by target

Backend prerequisites now available: target/impact endpoints, proposal-backed
planning writes for scalar/text/link fields, structural beat/obligation
replace/reorder actions, mutation lineage, and read-only before/after diff
endpoints. The next slice is UI, so it requires Playwright MCP evidence before
handoff.

UI rules:

- No direct mutation for meaningful planning changes.
- Every submit path creates a proposal envelope or explicitly labels itself a
  debug/admin path.
- Playwright MCP evidence is required before handoff: load, edit proposal,
  stale/error state, approval path, and adjacent proposal queue regression.

### Step 5 - Existing-Checker Health And Traceability

Before adding new creative checkers, aggregate existing checker outputs into a
chapter health and traceability surface.

Scope:

- adherence
- grounding
- continuity
- functional state
- editorial beat coverage
- lint/prose-edit proposal outcomes where present

Acceptance criteria:

- A chapter health endpoint returns pass/warn/fail/skip counts with linked
  evidence.
- Findings link back to `chapterId`, `beatId`, `obligationId`, or `sourceId`
  when available.
- The UI can show why a chapter is weak without reading raw trace logs.

Status 2026-05-05: chapter health is implemented through
`GET /api/novel/:novelId/chapter-health` and `/app/chapter-health/:novelId`.
The first traceability endpoint,
`GET /api/novel/:novelId/traceability/chapter/:chapterNumber`, now returns a
read-only ID-first chapter map over beats, obligations, source registry items,
writer/checker LLM calls, and trace events.

### Step 6 - Planner-Owned Story Debt Experiment

Treat Promise/Progress/Payoff as a planner-owned story debt artifact first, not
as a global Canon-like substrate.

Initial shape:

- promise opened
- expected progress beats
- intended payoff zone
- current status
- warning if ignored

Run this as an A/B-gated planning/drafting experiment. It can become durable
schema later only if evidence shows better structure, better payoff continuity,
or lower operator correction burden.

### Step 7 - Creative Heuristic Experiment Backlog

These ideas stay backlog until tested:

- promise/story debt influence on beat planning
- scene turn or value polarity nudges
- micro-tension prompts/checks
- character agency checks
- world-detail relevance surfacing
- genre strictness profiles
- editorial-letter summaries
- semantic drift prevention for planned actions that mutate during drafting
- continuity checker calibration for gray state/object conflicts
- beat-count calibration by current writer expansion length

Experiment requirements:

- fixed baseline
- one changed lever
- declared sample shape and budget
- paired or A/B comparison
- measurable signal: human preference, checker improvement, reduced proposal
  churn, fewer stale repairs, or lower operator edit burden
- explicit promotion, rollback, and stop gates

No candidate becomes default production behavior from source strength alone.

### Current Investigation Set

2026-05-05 phase-parity fixture work produced three concrete investigations:

- **Beat-count calibration:** the writer expanded 12-13 planned beats into
  4,700-5,700 word chapters for 1,500-1,800 word targets. The immediate fix
  calibrated deterministic beat floors to observed writer expansion length. The
  refreshed `phase-parity-smoke` evidence uses 5 beats for a 1,500-word target,
  lands near target length, and passes replay; the remaining investigation is
  whether that result holds across heavier fixtures.
- **Semantic action drift:** one failed chapter changed the planned action from
  altering Grand Registry records to breaking into the Arbiter's office. Treat
  this as a real semantic failure caught by the harness; investigate whether
  shorter beat plans reduce drift before adding new writer/checker nudges.
  Diagnostic support: `bun run diagnostics:plan-drift -- --novel <novelId>`
  summarizes existing `chapter-plan-checker` telemetry by chapter, attempt,
  deviation, and stable beat ref without changing runtime behavior.
- **Checker gray zones:** continuity findings around object emphasis and
  emotional/readiness state may be over-strict. Build a small adjudicated panel
  before relaxing checker behavior, preserving hard catches for unsupported
  invented entities and changed core actions.
- **Warning calibration:** the refreshed smoke fixture still produced
  warning-class functional-state and validation findings despite passing plan
  and continuity checks. Review warning precision before turning those warnings
  into blocking behavior. First calibration landed for deterministic validation
  character-presence warnings: surname-only references now count for multi-part
  names, and substring-only matches no longer count. Diagnostic support:
  `bun run diagnostics:checker-warnings -- --novel <novelId>` summarizes
  functional-check and continuity warning evidence for adjudication.

### Step 8 - Character Voice And Motivation Polish

This is important, but it comes after deterministic flow, interactivity, and
context control are working.

Backlog items:

- structured but lightweight voice profile
- character motivation/pressure surfaced to beat writer
- relationship and arc pressure surfaced at beat/chapter level
- voice drift diagnostics as warning-class findings
- A/B proof that characters sound more distinct and act from motivation without
  making prose mechanical

## Richness Backlog

Character richness:

- relationship arcs over time
- arc progress tracking against Lie/Want/Need/Ghost/Truth
- beat obligations tied to goals, fears, and choices
- proactive character-improvement proposals
- voice/motivation polish after context engineering is stable

World richness:

- world fact roles: `operational | reference | hidden` —
  **column shipped 2026-05-05** (`facts.role`, `sql/049`, default
  `operational`). Consumer slices (writer-context filtering by role,
  checker scoping for reference-class facts, fact-extraction pipeline
  role assignment) are deliberately deferred to follow-up lanes;
  `canon_facts.role` is also a follow-up.
- established-in-prose tracking for operational rules
- first-class faction entities with goals, resources, allies, enemies, and
  pressure on beats
- relevance-scored world details per beat
- world rule enforcement only after role/established status exists

Plot richness:

- planner-owned story debt/promise artifact
- genre-declared obligation profiles as experiments
- plan-update-from-draft when drift is intentional
- chapter outline and beat plan edits through proposal envelopes
- downstream impact preview before approval

Review richness:

- before/after diffs for all proposal kinds
- edit-before-approve for artifact patches
- smart grouping by target, kind, risk, and impact
- proposal-to-outcome correlation once concrete observer sources exist

## What Not To Build Yet

- Do not make micro-tension, scene turns, moral argument, or value polarity
  production blockers before A/B evidence.
- Do not build scene-level cross-cutting state for location, knowledge, or
  emotional state until chapter-level impact tracking proves insufficient.
- Do not make a heavy global promise ledger before the planner-owned story debt
  experiment proves value.
- Do not broaden world-rule enforcement beyond established operational rules.
- Do not expand Canon or character/world/plot autonomy beyond manual review
  without a new explicit decision.
