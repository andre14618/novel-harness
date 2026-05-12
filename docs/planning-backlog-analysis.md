---
status: draft
updated: 2026-05-04
role: planning-backlog-research
---

# Planning Backlog Analysis: Visibility & Functionality

Research-driven answers to the 10 questions framing the next backlog cycle.

Refinement plan: `docs/authoring-harness-refinement-plan.md` is the
implementation-facing backlog for the first several steps.

---

## 1. Creation Flow

**What should the main novel creation flow feel like?**

**Current state:** The pipeline is a rigid sequential state machine:
`Concept → Planning → Drafting → Validation → Done`

At Concept, three agents run in order (world-builder, then character-agent ∥ plotter in parallel),
each with a human approval gate (`GatePanel`). Operators approve/reject/revise each artifact
before the next proceeds. (`src/phases/concept.ts:54-108`)

At Planning, there are four sub-phases (skeletons → beats → state-mapping → repair), with
obligation coverage validation and a repair loop. (`src/phases/planning.ts:161-434`)

The pipeline is serial and rigid — no phase can start before the prior completes. Even the
Planning Lock (`src/canon/planning-snapshot.ts:406`) enforces immutability after the lock
is set, and drafting refuses to start if the snapshot has drifted (`src/phases/drafting.ts:164-177`).

The Adjust panel (`ui/src/components/ArtifactPreviews.tsx:290-774`) and inline artifact editing
(via `PUT /api/novel/:id/world-bible`, `PUT /api/novel/:id/character/:charId`,
`PUT /api/novel/:id/story-spine`) allow post-concept editing, but there is no way to re-enter
Concept or Planning from Drafting without a full rewind.

**Recommendation: Hybrid — guided first draft of the plan, then freeform studio editing.**

Rationale:
- The sequential pipeline is good for the first pass — it forces the writer through necessary
  decisions before prose generation. The Planning Lock is a legitimate safety gate.
- But after the first plan exists, the operator needs to freely iterate any surface
  (characters, world, plot) and have those changes propagate to downstream artifacts
  with proposal-based review, not full rewinds.
- The Canon substrate's proposal model (`src/canon/substrate.ts:55-93`) already supports
  this — `proposeCanonUpdate()` creates pending proposals that can be approved/rejected/modified
  at any time during drafting. The substrate is decoupled from the pipeline phase.
- What's missing is the **UX to freely navigate and edit** without a full rewind.
  Phase rewind exists (`resumeAt` at the Studio page, `src/phases/state-machine.ts`),
  but it's a nuclear option that loses all downstream work.

**Key capability to add:** A "freeform mode" where the operator can edit any planning artifact
and changes automatically generate downstream proposal envelopes (artifact patches for
character/world/spine fields, canon proposals for facts, editorial flags for beat coverage).

---

## 2. Visibility

**When you say "overall visibility," what do you most need to see?**

**Current state:** The UI already has several visibility surfaces:

| Surface | Exists? | What it shows |
|---------|---------|---------------|
| Current phase/status | Yes | `PipelineFlow` shows phase diagram with per-agent pills (`ui/src/components/PipelineFlow.tsx`) |
| What changed recently | Partial | `EventLog` shows chronological LLM calls + milestones but no semantic diff |
| What is blocked or weak | Partial | `GatePanel` for pending gates, `PlanAssistPanel` for exhaustion, `LiveMeters` for progress |
| Draft following plan | Partial | Per-beat adherence checks (`src/agents/writer/adherence-checker.ts`) log per-beat pass/fail in the EventLog but no dashboard |
| Plan artifacts → chapter influence | No | No traceability from planning artifacts to chapters that used them |
| Pending proposals | Yes | `ArtifactPreviews` Adjust tab shows pending envelopes, CanonProposalsPage shows pending canon proposals |

**Gaps:**

1. **No change awareness.** When the operator edits a character in the world bible,
   there's no indication of which chapters, beats, or facts are now stale or need
   regeneration. The Canon substrate tracks versions, but the UI doesn't surface
   downstream impact.

2. **No plan-artifact-to-prose traceability.** When a chapter draft is visible
   in `NovelReadView`, there's no way to see which character profiles, world facts,
   or beat obligations influenced each paragraph. This is critical for understanding
   _why_ the system wrote what it wrote.

3. **No aggregated quality dashboard.** Individual check results (adherence,
   grounding, continuity, functional-state) are logged as SSE trace events but
   never aggregated into a per-chapter or per-novel health view.

4. **No proposal-to-outcome correlation.** The Phase 7 replay infrastructure
   (`src/canon/approval-policy-replay.ts`) tracks proposal resolution outcomes
   but doesn't yet feed a visible dashboard.

**Recommendation: Prioritize these in order:**

1. **Plan-to-prose traceability** — which artifacts influenced each beat/chapter.
   This is the highest-leverage visibility item because it lets the operator
   understand the system's creative decisions and gives confidence in editing.
2. **Chapter health dashboard** — aggregate per-checker pass/fail/skip counts
   per chapter with severity summaries.
3. **Change impact awareness** — when editing a planning artifact, show which
   downstream chapters/beats are now stale.

---

## 3. Planning Interactivity

**Which planning surfaces should be directly adjustable in the UI?**

**Current state:** The UI already allows editing these artifacts:

| Surface | Edit method | How |
|---------|------------|-----|
| World bible | Inline JSON field editing | `PUT /api/novel/:id/world-bible` (`src/orchestrator/novel-routes.ts:667-677`) |
| Character profiles | Inline JSON field editing | `PUT /api/novel/:id/character/:charId` (`src/orchestrator/novel-routes.ts:654-665`) |
| Story spine | Inline JSON field editing | `PUT /api/novel/:id/story-spine` (`src/orchestrator/novel-routes.ts:679-689`) |
| World bible / characters / spine | Conversational adjust | `POST /api/novel/:id/adjust` → proposal envelopes (`novel-routes.ts:692-795`) |
| Canon facts | Review-only (approve/reject/modify) | `CanonProposalsPage` via `POST .../canon-proposals/:pid/resolve` |
| Chapter outlines | Plan-assist gate only | `POST /api/novel/:id/plan-assist/:ch/decide` with `edit-plan` action |
| Beat plans | No direct UI | Only via plan-assist gate outline edits |
| Scene plans | No direct UI | N/A (scene plans don't exist as a separate artifact — they are `SceneBeat[]` inside `ChapterOutline`) |
| Canon facts | Review-only | `canon-proposal-routes.ts` |
| Style/voice constraints | No UI | `tonalAnchors` exist in `PlanningDirectives` but no runtime UI for them |

**Missing interactive surfaces:**

1. **Chapter outlines** — only editable when the plan-assist gate fires (exhaustion). No
   proactive editing. The operator cannot restructure chapters without triggering exhaustion
   first. This is backwards — the operator should be able to edit the outline at any time
   and have changes propagate.

2. **Beat plans** — not interactive at all. `SceneBeat[]` lives inside `ChapterOutline`
   and can only be changed via plan-assist gate outline edits. No per-beat editing.

3. **Style/voice constraints** — `PlanningDirectives.tonalAnchors` and `forbidden` exist
   but have no runtime visibility or edit surface. They're set pre-creation in `DirectorChat`
   and then disappear.

4. **Scene plans** — don't exist as a separate artifact. The `SceneBeat` type has
   structural priors (`valueShifted`, `gapPresent`, `lifeValueAxes`, `miceActive`)
   but these are planner-emitted, not operator-editable.

**Recommendation:** All listed surfaces should be editable. Priority order:

1. **Chapter outlines** (highest impact — this is the main structural lever)
2. **Beat plans** (per-beat editing lets the operator reshape chapter structure)
3. **Style/voice constraints** (makes tonalAnchors visible and adjustable mid-run)
4. **Scene plans** (would require creating a new artifact type)

For each, the edit UX should use proposal envelopes (not direct mutation) so that:
- Changes are reviewable before applying
- Downstream impacts are visible
- Stale detection works (409 on precondition hash mismatch)
- Audit history is preserved

---

## 4. Character Bibles

**What should make a character bible "robust" in your mind?**

**Current state:** Character profiles (`src/agents/character-agent/schema.ts:38-74`) include:
- `goals`, `fears`, `backstory`, `traits`, `speechPattern`, `internalConflict`, `avoids`
- `relationships: { characterName, nature }[]`
- `culturalBackground: { cultureName, relationship }[]`
- `systemAwareness: { systemName, level, perspective }[]`
- LTWN arc structure: `lie`, `truth`, `want`, `need`, `arc_resolution`
- `exampleLines: string[]` (4 voice anchors for dialogue conditioning)

**What exists but is limited:**

1. **Relationships** are static — just a name + nature string. No relationship arc over
   time, no trust/loyalty tracking per chapter, no relationship events.
2. **Arc structure** exists (LTWN fields) but is corpus-calibrated and static. No active
   tracking of arc progression during drafting.
3. **Voice** has example lines but no runtime checking that dialogue in drafted prose
   matches the character's speech pattern.
4. **Emotional state** is tracked per-chapter via `characterStateChanges` in the chapter
   outline (location, emotionalState, knows[], doesNotKnow[]), and in the Canon substrate's
   `canon_character_states` table. But this is planned state, not observed state.
5. **Continuity tracking** is handled by the continuity checker (`src/agents/continuity/check.ts`)
   but only for facts and knowledge — not for character voice or arc trajectory.

6. **No generated suggestions.** There is no process that analyzes a character and
   proposes improvements. The `artifact-adjuster` agent (`src/agents/artifact-adjuster/`)
   handles operator-initiated adjustment, but there's no proactive suggestion system.

**What's missing for robustness:**

| Category | Gap |
|----------|-----|
| Goals, fears, secrets | Present as fields, but no connection to beat obligations — a fear is declared but not tracked through scenes |
| Voice/speech patterns | `exampleLines` exist but no checker verifies drafted dialogue against them (the voice-collapse detector is a STUB per `src/lint/quality-detectors.ts:213-217`) |
| Relationships | Static. No relationship arc (`relationship_arcs` per chapter), no trust metric, no events that change relationships |
| Arc over time | LTWN fields exist but arc is not tracked during drafting — there's no "arc progress" check per chapter |
| Scene-level obligations | No character-level obligations at the scene/beat level (only beat-level `mustEstablish`, `mustPayOff`, etc.) |
| Continuity tracking | Only fact/knowledge continuity; no voice continuity, no arc trajectory continuity |
| Emotional state history | Planned only (`characterStateChanges` in outline). No observed state from drafted prose. |
| Generated suggestions | Only operator-initiated via Adjust chat. No proactive analysis. |

**Recommendation for robustness work:**

1. **Relationship arcs** — track relationship changes across chapters with events
   (trust gained/lost, new dynamics formed). Add `relationship_arc: { characterId, chapter, event, newDynamic }[]`
   to the character profile or as separate Canon facts.

2. **Arc progress tracking** — per-chapter checks that the character's LTWN arc
   is advancing (lie being challenged, truth being approached). This would be a new
   checker kind (`arc-progress-checker`).

3. **Voice collapse detection** — complete the LLM-based implementation. Compare
   drafted dialogue against `speechPattern` + `exampleLines` and flag voice drift.
   This connects to the lint infrastructure (already has the `voice-collapse` STUB).

4. **Proactive character analysis** — a background checker that reads the full character
   profile and proposes improvements (thin backstory, one-dimensional traits, missing
   internal conflict). This would produce `editorial_flag` envelopes.

---

## 5. World Building

**Should the world bible be mostly encyclopedia-style, or should it be operational?**

**Current state:** The world bible (`src/agents/world-builder/schema.ts:39-53`) is a hybrid:
- **Encyclopedia elements:** Setting, timePeriod, geography, politicalStructure,
  socialCustoms, sensoryPalette, culture, history, cultures[]
- **Operational elements:** rules[] (testable world rules), technologyConstraints
  (what does/doesn't exist), systems[] (structured magic/tech/religion with rules,
  constraints, manifestations, vocabulary)
- **Locations:** Named places with sensory details

The operational elements ARE actively used during drafting:
- L1 Canon bundle (`src/canon/bundle.ts`) assembles facts, entities, character states,
  and active promises as a deterministic prefix for every writer + judge LLM call.
- `scopeCanonForChapter` (`src/canon/scope.ts:318`) filters canon to what's relevant.
- The halluc-ungrounded checker (`src/agents/halluc-ungrounded/index.ts:429-471`)
  surfaces world-bible entries as grounded evidence for entity validation.

**But the operational loop is incomplete:**

1. **Rules are emitted but not actively enforced.** The `rules[]` field says things
   like "magic requires a spoken phrase" but no checker verifies this in prose.
   The continuity checker checks fact contradictions, not rule violations.

2. **Systems vocabulary is recorded but not checked.** The `systems[].vocabulary` list
   is present in the grounded surface but there's no checker that verifies terminology
   is used correctly.

3. **Constraints are advisory.** `systems[].constraints` and `technologyConstraints`
   exist as text but no deterministic or LLM checker validates them against prose.

4. **No faction tracking.** There are cultures but no factions. The `politicalStructure`
   is a single text field. No faction relationships, faction goals, or faction events.

**Recommendation: Operational-world-bible grounding.**

The world bible should become more operational — meaning its contents generate
checkable constraints that are actively verified during drafting:

1. **Rule enforcement checkers** — for each `rules[]` entry and `systems[].constraints[]`,
   generate a checker that verifies the constraint is not violated in drafted prose.
   This would be a new checker kind (`world-rule-checker`).

2. **Terminology grounding** — weight the halluc-ungrounded checker to more aggressively
   validate system-specific vocabulary against the grounded evidence surface.

3. **Factions as first-class entities** — add a `Faction` type with `goals`, `members`,
   `relationships` (allies/enemies), and `resources`. Connect to the Canon entity type
   (`kind: "organization"` exists in `src/canon/api.ts:145`). Use faction goals to
   generate conflict obligations in beat planning.

4. **Location specificity** — use `locations[]` more aggressively in the grounded
   surface. When a beat's setting is mapped to a location, surface that location's
   sensory details and history in the beat-writer context.

---

## 6. Plot Control

**How strict should the system be about staying on plan?**

**Current state:** The pipeline already has multiple drift-detection layers:

| Layer | Strictness | What it does |
|-------|-----------|-------------|
| Planning Lock | Hard gate | `assertDraftableSnapshot()` refuses to draft if planning state has drifted (`src/phases/drafting.ts:164-177`) |
| Beat adherence | Per-beat LLM check | Verifies obligated events are enacted; fails trigger beat retry (`src/agents/writer/adherence-checker.ts:95`) |
| Entity grounding | Per-beat deterministic+LLM | Flags ungrounded entities; fails trigger retry (`src/agents/halluc-ungrounded/index.ts:392`) |
| Chapter plan check | Post-draft LLM | Compares full draft against outline; fails trigger settle loop (`src/phases/drafting.ts:612-898`) |
| Continuity checks | Post-draft LLM | Fact contradictions and state violations (`src/agents/continuity/check.ts:59`) |
| Functional state checks | Deterministic+LLM | Payoff-link integrity and planned-state grounding (`src/phases/functional-checks.ts`, `src/agents/functional-state-checker/`) |
| Checker blocker aggregation | Hard gate | Any remaining blockers after retry exhaustion → bail (`src/phases/drafting.ts:1204-1222`) |
| Plan-assist gate | Human gate | When settle loop exhausted, operator chooses edit-plan/override/abort (`src/phases/drafting.ts:1228-1257`) |

**The system is already strict — multiple layers of enforcement with escalating costs.**

**The question is about the UX for drift, not the mechanism.** The current mechanism
handles drift detected by the system. What's missing is:

1. **Operator-acknowledged drift.** When the operator wants to intentionally deviate
   from the plan (e.g., the story organically took a better direction), there's no way
   to say "this draft is fine, update the plan to match." The system only supports
   "rewrite the draft to match the plan" or "override the checker."

2. **Canon/world drift.** Canon updates require manual proposal review. The operator
   can approve new facts (`canon-proposal-routes.ts:172-339`) but there's no streamlined
   path from "interesting thing discovered in draft" → "proposal to add to canon."

**Recommendation: Mode-based strictness.**

The existing strictness layers are good. Add operator-facing controls:

1. **Plan-update-from-draft** — a new action when chapter plan check fails:
   "accept and update plan" that revises the chapter outline to match the draft
   instead of rewriting the draft. This turns discovered drift into plan updates.

2. **Canon proposal from prose** — a "propose to canon" button on any entity in
   the drafted chapter that extracts the observed fact/state from prose and
   generates a `canon_update` proposal.

3. **Strictness profile** — a per-novel toggle:
   - **Strict**: Current behavior — all checks block, retry required.
   - **Loose**: Checks still run but produce `editorial_flag` proposals instead of
     blocking. The operator reviews later.
   - **Mode-based** (recommended default): Canon/world facts are strict (must match),
     prose details are loose (warning flags only).

---

## 7. Draft Translation

**Where is the biggest current gap between plan and story?**

**Current state:** The translation from plan to story has these checkpoints:
- Beat specs → prose via beat-writer with beat obligations + transition bridges
- Adherence checker verifies obligated events are enacted
- Chapter plan checker verifies setting match + emotional arc + deviations
- Editorial beat-coverage producer flags uncovered beats
- Functional state checker verifies planned facts/states/knowledge in prose

**Gaps identified from the codebase:**

1. **Characters don't drive scenes enough** (highest gap). The beat spec includes
   `characters: string[]` and character snapshots are provided to the beat-writer,
   but there's no mechanism that ensures character voice, motivation, and arc
   are _active drivers_ of the scene. Characters appear because the plan says they
   should, not because their goals and fears naturally create the scene's events.

   Evidence: The adherence checker only checks that characters _appear_ (deterministic
   name matching at `src/agents/writer/adherence-checker.ts:288`) and that obligated
   events are _enacted_. It does not check that the character's voice, internal
   conflict, or arc are expressed in the prose.

2. **World details don't show up in prose.** The L1 Canon bundle includes world
   facts, but the beat-writer context (`src/agents/writer/beat-context.ts`) surfaces
   them as a flat prefix. There's no mechanism that selectively surfaces the most
   relevant world details for each beat and ensures they're woven into prose.

   Evidence: The halluc-ungrounded checker only flags _ungrounded_ entities. It does
   not check that _grounded_ world details are actually present in the prose.

3. **Plans can be too thin.** The `SceneBeat.description` is "1-2 sentences, NO dialogue/quoted
   speech" (`src/agents/planning-scenes/schema.ts`). This is intentional (to avoid
   truncation with 8K windows), but it means the beat-writer gets only a skeletal
   description. Richness depends on the LLM filling gaps.

4. **Prose follows events but lacks emotional/thematic force.** The beat-writer
   gets beat obligations and transition bridges, but there's no explicit mechanism
   for emotional arc tracking within a scene. The `emotionalArc` is at the chapter
   level (`ChapterSkeleton` from the planning-plotter) and the `valueShifted`/`gapPresent`
   structural priors exist on beat specs, but neither is checked during drafting.

5. **The system can't explain why it wrote what it wrote.** The trace timeline
   (`ui/src/components/TraceTimeline.tsx`) shows LLM calls with full prompts+responses,
   but there's no attribution layer that maps from prose paragraph → planning artifact
   that influenced it. The operator can see _what_ was written and _what_ the prompt was,
   but not _why_ a specific creative choice was made.

**Recommendation: Close the gaps in priority order.**

1. **Character motivation injection** — add character goals/fears to the beat context
   in a structured way that forces the beat-writer to make characters _act on_ their
   motivations, not just be present. Add a checker that validates character agency
   (did the character drive the scene, or were they passive?).

2. **Selective world-detail surfacing** — instead of dumping the full L1 bundle,
   add a deterministic relevance scorer that selects the most salient world facts
   for each beat based on setting, characters present, and beat description.

3. **Richness scoring** — add a post-draft checker that evaluates prose richness
   (sensory detail count, world-detail integration score, dialogue-to-narration
   ratio) and flags thin beats for revision.

4. **Provenance attribution** — trace from prose span → beat obligation → planning
   artifact. This requires instrumenting the beat-writer to emit citation annotations
   and would be a significant Phase 7 data model change.

---

## 8. Review UX

**When the system proposes changes, what should the review experience optimize for?**

**Current state:** Two review surfaces exist:

1. **Canon proposal review** (`ui/src/components/CanonProposalsPage.tsx:831`) —
   status tabs, filter bar, proposal table with approve/reject/modify, bulk actions,
   audit history. Already well-structured.

2. **Artifact patch proposal review** (`ui/src/components/ArtifactPreviews.tsx:290-774`) —
   envelope cards with risk badges, approve/reject, stale detection + regenerate,
   bulk quick actions, audit history. Already well-structured.

**What's already optimized:**
- Fast accept/reject (single click per proposal)
- Understanding rationale/evidence (rationale + summary on each card)
- Stale detection (409 on precondition hash mismatch)
- Bulk handling (approve all low-risk, reject all)

**What's missing:**

1. **Comparing before/after** — the modify flow in CanonProposalsPage shows
   the original as italic ghost text, but there's no side-by-side diff view.
   For artifact patches (character updates, world updates), the before/after
   is not visible at all — just the proposed new values.

2. **Editing the proposal before approval** — only Canon proposals support
   modify-with-edit (`canon-proposal-routes.ts:172-339`). Artifact patch
   proposals are accept/reject only. The operator cannot tweak a proposed
   character update before applying it.

3. **Downstream consequences** — no visibility into what changes if a proposal
   is approved (which chapters would need rewriting, which beats would be
   affected, which characters' relationships would change).

4. **Bulk handling of low-risk items** — exists as "approve all low-risk" but
   there's no smart grouping (e.g., all mechanical prose edits together, all
   low-risk character updates by the same character).

5. **Prioritization** — pending proposals are shown in creation order. No
   prioritization by impact (changing the centralConflict vs fixing a typo).

**Recommendation: Add these capabilities in order of impact.**

1. **Before/after diff** — for every proposal, show what changes. For canon facts,
   show old vs new text side by side. For character updates, show the field-level
   diff. For artifact patches, render the patch as a readable change.

2. **Downstream impact preview** — when reviewing a proposal, show which chapters,
   beats, and characters would be affected. This is a query against the outline
   and the L1 bundle. Low-cost, high-value.

3. **Edit-before-approve** — extend the artifact patch resolution endpoint to support
   a `modified_payload` field, same as Canon proposals. This is a data model change
   (the `proposal_envelopes` table already has `modified_payload JSONB`).

4. **Smart grouping** — group pending proposals by kind, target, and risk. Allow
   batch review of all proposals affecting the same character or chapter.

---

## 9. Autonomy

**For planning improvements, what should stay manual by default?**

**Current state:** The ApprovalPolicy engine (`src/canon/approval-policy.ts:217`)
already defines strict boundaries:

- `manualKinds: ["canon_update"]` — Canon updates are always manual, cannot be
  auto-approved at any tier.
- `autoApproveRiskCeiling: "low"` — only mechanical low-risk proposals auto-approve.
- At `assisted` tier: only `prose_edit` envelopes with `risk: "mechanical"` auto-approve.
- At `autonomous` tier: any kind at/below `autoApproveRiskCeiling` unless in `manualKinds`.
- Producer `reject` overrides auto-approve.
- Phase 7 replay requires evidence thresholds before promotion (minRows, minAutoPrecision).

**What stays manual by default:**

1. **Canon/world/character/plot changes** — already the default via `manualKinds: ["canon_update"]`.
   This should expand to include new proposal kinds like `character_update`, `world_update`,
   `plot_update` when those envelope kinds are created.

2. **Structural outline changes** — beat reordering, chapter restructuring, POV changes.
   These should be `artifact_patch` envelopes targeting `chapter_outline` artifacts,
   defaulting to manual review.

3. **New fact creation** — any `canon_update` proposal creates a new Canon fact.
   Must stay manual.

**What can be assisted (deterministic mechanical only):**

1. **Deterministic lint fixes** — already exists via `lintProseEditProposals` pipeline
   override. These are mechanical (regex replacements) and safe.

2. **Word count / beat coverage warnings** — editorial flags for underlength or
   uncovered beats can be auto-generated as `editorial_flag` proposals without
   auto-approval. The operator reviews, but the system produces them proactively.

3. **Checker-observed issues** — when a checker fires (continuity, grounding, etc.),
   the findings already exist in the checker output. Auto-generating `editorial_flag`
   proposals from these findings (with evidence quotes) would make the review queue
   more comprehensive without changing autonomy posture.

**Recommendation: Keep the current manual default. Expand assisted generation.**

The current posture is correct: Canon/world/character/plot changes require manual
approval. What should change is _proactive proposal generation_ — the system should
automatically generate more proposals (editorial flags from checker findings,
character analysis suggestions, beat coverage gaps) while keeping them in the manual
review queue. This increases the operator's visibility without reducing their control.

New manualKinds that should be added:
- `character_update` — any change to character profile fields
- `world_update` — any change to world bible fields
- `plot_update` — any change to story spine or chapter outlines
- `canon_update` — already manual, keep it

New assisted kinds:
- `editorial_flag` — checker-observed issues (already auto-generated via
  `editorialBeatCoverageProposals`, expand to all checkers)
- `prose_edit` — already assisted at mechanical risk level, keep it

---

## 10. Backlog Shape

**How should the backlog be organized?**

**Recommendation: Product-phase first, technical slices under each.**

This keeps the backlog tied to the novelist workflow (the only workflow that matters).
Technical-layer organization would produce infrastructure drift — optimizing the
proposal model for its own sake rather than for the novels it serves.

**Proposed backlog structure:**

### Phase: Setup / Premise
- Director chat improvements (visibility of directives after creation)
- Seed management UX (create/edit/delete seeds from UI)
- Planning Directive editing surface (locked characters, required beats, tonal anchors)

### Phase: World
- Operational world bible grounding (rules → checkers)
- Faction support (first-class entities with goals/relationships)
- World detail surfacing for beat-writer (relevance scoring)
- World bible field-level diffs on proposals

### Phase: Characters
- Relationship arcs (per-chapter tracking)
- Arc progress checker (LTWN trajectory validation)
- Voice collapse detection (complete the LLM implementation)
- Proactive character analysis (auto-generate improvement proposals)
- Character agency check (did characters drive the scene?)

### Phase: Plot
- Chapter outline editing surface (proactive, not just at exhaustion)
- Beat plan editing (per-beat adjustment)
- Plan-update-from-draft (accept draft as new plan)
- Strictness profile (strict/loose/mode-based)

### Phase: Outline
- Beat-level editing UX
- Obligation editor (view/edit per-beat obligations)
- Scene plan artifact (if SceneBeat is separated from ChapterOutline)

### Phase: Drafting
- Character motivation injection into beat context
- World detail relevance scoring for beat context
- Provenance attribution (prose span → planning artifact)
- Richness scoring checker (sensory detail count, world integration, dialogue ratio)

### Phase: Revision
- Before/after diff on all proposals
- Edit-before-approve on artifact patches
- Downstream impact preview on proposal review
- Canon proposal from prose (extract observed facts from draft)

### Phase: Review / Proposals
- Smart proposal grouping (by target, risk, kind)
- Proposal prioritization (by impact)
- Auto-generate editorial flags from all checker findings
- Proposal-to-outcome correlation dashboard

### Phase: Observability
- Plan-to-prose traceability (which artifacts influenced each beat)
- Chapter health dashboard (aggregated per-checker pass/fail)
- Change impact awareness (which chapters are stale after editing)
- Quality trend dashboard (per-chapter scores over time)

---

## Backlog Principle: UI Work Gate

As explicitly requested:

> **UI Work Gate:** any UI-facing feature or fix should be browser-tested with
> Playwright MCP before handoff, with screenshots/evidence captured. Code inspection
> and unit tests are not enough for UI clearance.

This is already partially practiced (see `docs/how-to/playwright-mcp-browser-testing.md`
and the `.playwright-mcp/` session data from the canonical proposal UI clearance).
It should become a **non-negotiable gate** for every UI PR or feature, enforced by:

1. `docs/how-to/playwright-mcp-browser-testing.md` as the runbook
2. Screenshot evidence stored at the repository root with descriptive names
3. Coverage checklist per feature (load, interaction states, error states, edge cases)

## Backlog Principle: Creative Heuristic Eval Gate

Any craft heuristic that changes planner, writer, or checker behavior should be
tested before it is wired into production defaults.

This applies to promise/story-debt influence, scene turns, micro-tension,
character agency checks, world-detail forcing, genre strictness profiles,
editorial-letter generation, and voice/motivation nudges.

Required before default wiring:

1. A fixed baseline
2. One changed lever
3. Declared sample shape and budget
4. A measurable signal: human preference, checker improvement, reduced proposal
   churn, fewer stale repairs, or lower operator edit burden
5. Stop, promotion, and rollback criteria

Promise/Progress/Payoff should start as a planner-owned story-debt artifact
that is passed through the plan to beat planning and drafting. It should not
start as a global Canon-like substrate or blocking checker. Promote it only if
A/B evidence shows better structure, payoff continuity, or operator control.

Character voice and motivation polish should be backlog, but sequenced after
context engineering, deterministic flow, and interactivity are working. The
goal is graceful character distinctiveness and motivation in prose, not prompt
pressure that makes characters mechanical.

---

## Next Steps

1. **User reviews this analysis** and provides narrowing direction on which
   phases/surfaces are highest priority
2. **Backlog items are extracted** from the above structure into concrete,
   independently-grabbable tickets
3. **Tracer-bullet slices** are defined for the highest-priority items
4. **Each item gets a concrete acceptance criterion** including which UI surfaces
   need Playwright evidence

---

## Revision History

| Date | Change |
|------|--------|
| 2026-05-04 | Initial research-backed analysis written |
