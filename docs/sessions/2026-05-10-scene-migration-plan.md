---
date: 2026-05-10
status: plan (no slices shipped yet beyond the user-facing log cleanup)
role: migration-plan
---

# Scene-First Migration Plan

## Strategic call (2026-05-10)

Beats are not the future. Per L092 the scene is already the durable
plan/write/check unit (`outline.scenes[]`, `sceneId`); per L097 the
scene-call writer is wired but default-off; production runtime still
uses the legacy beat-shaped writer prompt. Operator decision (this
session): **migrate functionality and naming to scene-first; archive
the beat-shaped path as a historical artifact in git history rather
than maintaining it as a parallel direction.**

The legacy beat-shaped writer was never validated to a production-
quality bar. There is no evidence backing it as a "control" for future
A/B work. Continuing to optimize it is misdirected effort.

## What stays beat-named

- The internal data shape used as a **sub-scene obligation/hint** —
  per-entry obligations, beat-internal annotations, legacy fact links
  — can keep "beat" in their internal naming where doing otherwise
  would conflate sub-scene granularity with the scene unit. The
  `BeatSpec` type today represents what is actually a scene; renaming
  it is a separate slice (below).
- `requiredPayoffs.payoff_beat` and similar legacy schema columns —
  rename in the DB-migration slice with view-aliases for compat.
- Git history and the historical `archive/` paths.

## What migrates to scene-named

- All user-facing console output, status messages, progress bars.
- All operator-facing docs, READMEs, lane queue.
- Default writer-call shape: scene-call writer becomes the production
  default; legacy beat-writer becomes opt-in via a rollback flag, then
  removed once nothing references it.
- TypeScript types (`BeatSpec` → `SceneSpec`, etc.) once user-facing
  surfaces are clean.
- File names (`beat-context.ts` → `scene-context.ts`, etc.) once types
  are renamed.
- Agent name (`"beat-writer"` → `"scene-writer"`), prompt template
  filenames (`beat-writer-system.md` → `scene-writer-system.md`).
- DB schema columns where doing so does not require expensive data
  migrations (audit per column).

## Slice ordering (proposed)

Each slice is one atomic commit, low-blast-radius, reversible.

### Slice S0 — User-facing log + docs cleanup *(this commit)*

- `console.log("Writing N beats...")` → `"Writing N scenes..."`
- `console.log("Beat N/M: …w")` → `"Scene N/M: …w"`
- `docs/fixtures/scene-first/README.md` reorients arm posture: scene-call-v1
  is the direction, baseline is the legacy control archived for history.
- This migration plan doc.
- No type renames, no flag flips, no file moves. Tests unchanged.

### Slice S1 — Default flip: scene-call writer becomes production default

- Flip `pipeline.sceneCallWriterV1` from `false` → `true`.
- Flip `pipeline.writerExpansionMode` from `"off"` → `"retry-short-scenes-v1"`.
- Add `legacyBeatWriter: boolean` pipeline override (default false). When
  set on a seed, drafting falls back to the legacy beat-shaped writer
  prompt. This is the rollback path for ~30 days.
- Update default-flag tests in `src/config/pipeline.test.ts`.
- Update parity replay fixtures (the byte-parity test must record the
  scene-shaped prompt as the new baseline).
- Document the flip in a decision record (L100).
- Risk: the scene-call writer requires planner-authored scene-contract
  fields to render the SCENE CONTRACT block. When `scenePlanContractV1`
  stays default-off, the rendered prompt is structurally similar to
  legacy with one extra header. To make the flip meaningful, also:
- **Coupled flip**: `pipeline.scenePlanContractV1` from `false` → `true`
  in a sibling commit. L096's calibration gaps
  (crisisChoice→sourced-obligation, payoffEventId compliance) need to
  be addressed first. May require a calibration slice S0.5 between S0
  and S1.

### Slice S1.5 — scenePlanContractV1 calibration

If S1's coupled `scenePlanContractV1` flip surfaces the L096-flagged
prompt-fidelity gaps, address them with a narrow calibration commit
before S1 lands. If the flip is clean, fold into S1.

### Slice S2 — Legacy beat-writer prompt template removal

After S1 ships and the rollback flag has cooled (~2 weeks), remove the
`legacyBeatWriter` flag, delete `beat-writer-system.md` (the prompt
template) and `beat-writer-system-salvatore.md`. The
`scene-writer-system.md` (renamed in S3) becomes the single writer
prompt template.

### Slice S3 — Type rename: `BeatSpec` → `SceneSpec`

- `BeatSpec` → `SceneSpec` in `beat-context.ts` and consumers.
- `BeatContext.beatSpec` → `BeatContext.sceneSpec`.
- `BeatSpec.beatNumber` / `totalBeats` → `sceneNumber` / `totalScenes`.
- Re-export old names as deprecated type aliases for one slice cycle.
- Update tests that pin field names.
- Risk: low — internal-only type rename.

### Slice S4 — File rename: `beat-context.ts` → `scene-context.ts`

- `src/agents/writer/beat-context.ts` → `src/agents/writer/scene-context.ts`
- `src/agents/writer/beat-context-render.ts` → `scene-context-render.ts`
- All test files renamed correspondingly.
- Update imports across the repo (finite set; tsc + tests catch misses).
- Risk: low — file move with import sweep.

### Slice S5 — Agent name rename: `beat-writer` → `scene-writer`

- `src/models/roles.ts`: rename role.
- `callAgent({ agentName: "beat-writer" })` → `"scene-writer"` everywhere.
- Prompt template file renamed to `scene-writer-system.md`.
- DB / `llm_calls.agent` column: existing rows stay as `beat-writer`
  (historical); new rows write `scene-writer`. Provide a view alias
  `agent_normalized` if any consumer needs to query both.
- Risk: medium — DB-visible name; needs care for any analytics query
  that pins `agent='beat-writer'`.

### Slice S6 — DB column / schema rename audit

- `chapter_drafts.beat_index` → `scene_index`? Audit consumers first.
- `llm_calls.beat_id` → already deprecated per L095 amendment; remove
  if no live writers populate it.
- `pipeline_events.payload.beat_index` → `scene_index` for new events.
- Risk: medium — touches replay fixtures, planning_mutation_lineage,
  proposals. Each column rename gets its own commit.

### Slice S7 — Final cleanup

- Remove deprecated type aliases from S3.
- Remove view aliases from S5/S6.
- Remove `beat`-prefixed export shims wherever they survived.
- Update CLAUDE.md / AGENTS.md / current-state.md to drop any
  remaining beat-as-future references.

## Constraints throughout

- **Atomic commits**: one concern per commit; tests pass at every
  commit.
- **Rollback paths**: S1 ships with `legacyBeatWriter` flag; S2 only
  removes it after the cooldown.
- **Replay parity**: each slice that changes prompt rendering needs a
  fresh `tests/beat-context-fixtures` (rename to `scene-context-
  fixtures` in S4) snapshot recording.
- **No B1 conflation**: the writer-prompt ID rendering ablation (L099)
  is orthogonal to this migration. It stays default-off and gets
  evaluated independently. Do not bundle B1 evidence with scene-first
  evidence.

## What this plan deliberately does NOT include

- A B1 four-arm A/B as a prerequisite. The B1 ablation is auxiliary,
  not on the critical path of this migration.
- An evidence requirement to "prove scene-first beats baseline" before
  flipping. The operator's strategic call is that beats were never
  validated either; the harness is moving to scenes by decision, not
  by A/B.
- A guarantee that nothing breaks at runtime when S1 flips defaults.
  The `legacyBeatWriter` rollback flag is the safety net; if a smoke
  reveals a regression, that flag is the answer.
- Renaming any `archive/` content. Historical paths stay as captured.
