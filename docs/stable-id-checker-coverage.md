---
status: active
updated: 2026-05-05
role: stable-id-coverage-audit
---

# Stable-ID Coverage In Checker / Proposal Findings

Audit of how runtime checker and proposal-producer surfaces identify the
chapter / beat / world / character artifacts they reference. The goal of this
doc is to make the gap between "we have durable IDs" and "the findings carry
them" visible per surface. It feeds the durable-ID readiness audit in
`docs/authoring-harness-refinement-plan.md` and the stable-ID hardening item in
`docs/sessions/lane-queue.md`.

Identity vocabulary already produced by the harness (see `src/harness/ids.ts`,
`src/schemas/shared.ts`, `src/agents/planning-plotter/schema.ts`):

- `novelId`, `chapterId`, `beatId`, `obligationId`, `sourceId`, `sourceKind`,
  `characterId`, established-fact `id`, knowledge / state change `id`.

Only runtime / production producers are listed. Corpus-only structural
extractors (`structure-mckee-gap`, `structure-mice`, etc.) are out of scope;
they tag corpus beats by file offset, not novel artifacts.

## Coverage Table

| Surface | Inputs available | Beat ref | Chapter ref | Source / fact / character ref | Status |
|---|---|---|---|---|---|
| `src/canon/editorial-beat-coverage.ts` | `outline` (enriched), `beatIndex`, `chapterRef` | **was** positional `b<n>`; **now** prefers `beat.beatId` with `b<n>` fallback | caller-supplied `chapterRef` | n/a (purely a coverage signal) | **Improved 2026-05-04** — durable beat refs threaded |
| `src/canon/lint-to-prose-edit.ts` | prose, `LintIssue`, optional `beatProses` + beat refs, `chapterRef` | span target now carries optional `beatRef` when the rendered prose exactly matches `beatProses.join("\n\n")` and the mapped beat has a durable id | caller-supplied `chapterRef` | n/a — span-target only | **Improved 2026-05-05** — durable beat metadata threaded without changing span apply semantics |
| `src/canon/editorial-proposal.ts` (envelope) | proposal payload | `target.ref` for prose-edit beat targets is caller-shaped | `target.ref = chapterRef` | canon-fact refs are typed (`canonRefs[]`) | Already structurally OK |
| `src/canon/proposal-envelope.ts` (artifact patch) | artifact-adjuster patch, `novelId`, artifacts | n/a | n/a | `target.ref = characterId / novelId / story_spine` (durable IDs) | Already structurally OK |
| `src/agents/halluc-ungrounded/index.ts` | `prose`, `beat`, `outline`, `characters`, `worldBible`, `tags.{beatIndex,beatId}` | `llm_calls.beat_id` records `beat.beatId` alongside legacy `beat_index` for new beat-level calls; accepted beat-check blockers now retain `beatId` | tags carry `chapter` number only | final issue metadata and `ner_prepass_json` now carry exact-match `entityRefs[]` for `character`, `world_system`, and `culture` targets when resolvable | **Improved 2026-05-05** — durable beat telemetry plus exact entity refs threaded; unresolved entities remain surface-form |
| `src/agents/functional-state-checker/` | `outline` (enriched), `beatProses` | **was** `beat_index` only; **now** also exposes `beatId` from `outline.scenes[beat_index].beatId` when in range | implicit (caller passes outline) | findings now carry optional `plannedItemId` from exact id-match against `establishedFacts` / `knowledgeChanges` / `characterStateChanges`, or exact text-match on `establishedFacts.fact` / `knowledgeChanges.knowledge` (after `trim()`) | **Improved 2026-05-04** — additive `beatId` + `plannedItemId`; broader semantic / display-name resolution remains backlog |
| `src/agents/continuity/check.ts` | `Fact[]` (with `id`), `CharacterState[]` (with `characterId`) | n/a | n/a | output now also carries optional `factId` (exact `Fact.id` or `Fact.fact`-text match) and `characterId` (exact `CharacterState.characterId` match); `conflictsWith` and `character`-name surfaces unchanged | **Improved 2026-05-04** — additive exact-match ID resolution; broader entity-name resolution remains backlog |
| `src/agents/chapter-plan-checker/schema.ts` | outline, draft | **was** `beat_index` only; **now** drafting attaches `beatId` from `outline.scenes[beat_index].beatId` when in range | n/a | n/a | **Improved 2026-05-05** — additive beat refs threaded at the drafting consumption boundary |
| `src/phases/functional-checks.ts` `checkPayoffLinks` | `outline` (enriched) | **was** `beat_index` only; **now** also exposes `beatId`, `factId`, `payoffBeatIndex`, `payoffBeatId` | n/a | now includes `factId` for missing / duplicate payoff fact references | **Improved 2026-05-04** — durable refs added alongside legacy positional fields |
| `src/validation.ts` | `outline`, draft | legacy strings still render `Scene beat ${i+1}`; `findings[]` now carries `beatIndex` and `beatId` for validation-mode beat keyword checks | `findings[]` carries `chapterNumber` and optional `chapterId` on all findings | n/a | **Improved 2026-05-05** — additive structured findings with chapter/beat refs; legacy blocker/warning strings preserved |
| `src/canon/recall-validation.ts` | canon fixtures | n/a (not beat-scoped) | n/a | uses namespaced `RelevantId` (`fact:` / `entity:` / `state:` / `promise:`) | Already canonical |
| `src/canon/planner-canon-delta.ts` | enriched `outline`s | reports carry `beatId` per obligation | implicit | reports carry `factId`, `characterId`, `obligationId`, `sourceId` | Already canonical |
| `src/harness/planning-targets.ts` | persisted artifacts | public `scene_plan` ref = stored `beatId`/scene ID; legacy `beat_plan` remains an alias; `beat_obligation` ref = `obligationId` | `chapter_outline` ref = `chapterId` | `world_fact`, `character`, `world_system`, `culture` keyed by ID | Already canonical |

## Notes On The 2026-05-04 Mechanical Fixes

### `editorial-beat-coverage.ts` — beat.beatId for `EditorialFlagProposal.beatRef`

`buildBeatCoverageProposalsFromLlm` previously formatted the proposal's
`beatRef` as `b${beatNumber1Based}`, a positional token tied only to the
LLM-emitted `beatIndex`. The producer already has access to
`outline.scenes[i].beatId`, which is the durable kebab-case beat ID assigned by
`enrichOutlineIds`. Production callers (`saveChapterOutline()` enriches before
persistence; `getChapterOutline()` returns the persisted enriched outline, see
`src/db/outlines.ts`) hand in enriched outlines, so the durable ref is already
present at runtime.

Behavior change:

- When `outline.scenes[beatIndex].beatId` is a non-empty string, the proposal's
  `beatRef` is set to that durable ID.
- When `beatId` is missing (legacy / synthetic outlines, including the existing
  test fixtures), the producer falls back to `b${beatNumber1Based}` — same byte
  output as before.
- The `suggestedAction` line keeps its 1-based human-readable form so review UI
  copy is unchanged.
- `chapterRef` is still caller-supplied. The deterministic envelope-id seed
  hashes the proposal payload; identical input outlines (including beatIds)
  still produce identical envelope ids on rerun.

This is purely a refinement of how findings reference targets. The LLM call
shape, validation rules, severity routing, and envelope structure are
unchanged.

### `phases/functional-checks.ts` — `FunctionalIssue` carries durable refs

`checkPayoffLinks` already runs over the in-memory outline and has every ID it
needs. The pre-fix `FunctionalIssue` shape exposed only `beat_index` and a
human-readable `description`. Post-fix the shape is additive: `beatId`,
`factId`, `payoffBeatIndex`, and `payoffBeatId` are optional fields populated
when the source data is present. The existing `description` and `beat_index`
fields are kept verbatim so downstream consumers (`checker-blockers.ts`,
drafting retry log lines) keep their current rendering.

### Why these two

Both surfaces had durable IDs in the input but threw them away in the output.
Both could be threaded mechanically without changing checker semantics or LLM
prompts. (The continuity and functional-state-checker passes that followed
extended the same pattern: additive optional ID fields populated only on
exact safe match, with the legacy `description` / `beat_index` shape
preserved verbatim.) Other gaps need either (a) a producer-input change to
include `beatId` for prose-span lint fixes, or (b) a schema migration on
`llm_calls` to persist `beat_id` alongside `beat_index`. Those are larger
PR-class moves and were skipped per the task scope.

### `continuity/check.ts` — additive `factId` / `characterId` on exact match

`continuityIssueSchema` gained two optional fields, populated only on
deterministic exact match between the LLM output and the input collections:

- `factId` is set when `contradiction.fact` is `===` to either an input
  `Fact.id` or an input `Fact.fact` (after `trim()`). The fact-side LLM
  prompt typically echoes the canonical fact text from the prompt's
  ESTABLISHED FACTS section, so the second branch is the common production
  hit.
- `characterId` is set when `state-violation.character` is `===` to an input
  `CharacterState.characterId`. Display-name to ID resolution is intentionally
  skipped — there is no canonical name → ID registry inside the checker, and
  fuzzy / aliased name matching would invent IDs.
- `stateViolationToIssue()` keeps its original 1-arg form (back-compat); the
  optional second arg threads the input `CharacterState[]` for the lookup.

Persistence is unchanged — `db/issues.ts` writes the existing columns; the
new fields are dropped on the round trip. They are additive primarily for
in-memory consumers (the checker → blockers → drafting retry path) and
future structured-finding surfaces. A schema migration to persist them is
separate backlog.

The remaining backlog cases — display-name → `characterId` resolution,
LLM-emitted `factId` field — would change the prompt contract or require a
canonical entity registry; both are PR-class moves outside this commit's
scope.

### `functional-state-checker` — additive `beatId` / `plannedItemId`

`FunctionalStateCheckerFinding` gained an optional `planned_item_id` field
and `FunctionalStateWarning` gained optional `beatId` / `plannedItemId`.
Resolution is deterministic and never invents an id:

- `beatId` is taken from `outline.scenes[finding.beat_index]?.beatId` when
  the outline is enriched and the beat index is in range. Out-of-range,
  null, or un-enriched outlines leave `beatId` absent. The legacy
  `beat_index` and `description` fields are preserved verbatim.
- `plannedItemId` is resolved by `resolvePlannedItemId(outline, finding)`
  in `src/agents/functional-state-checker/index.ts`. Two safe paths: (1)
  the model's emitted `planned_item_id` exactly matches an
  `establishedFacts.id`, `knowledgeChanges.id`, or `characterStateChanges.id`
  on the outline; (2) the emitted `planned_item` text exactly matches an
  `establishedFacts.fact` or `knowledgeChanges.knowledge` value (after
  `trim()` on both sides). Character-state findings have no canonical text
  surface the LLM would echo, so they resolve via the id-path only — the
  wrapper never guesses an id from a composite display string. Unverified
  ids that do not match the planned-state registry are silently dropped.
- The `CHAPTER_PROSE_BY_BEAT` block in `buildContext()` now emits `beat_id`
  alongside `beat_index` when the outline is enriched, and the system
  prompt instructs the model to copy a matched item's `id` verbatim into
  `planned_item_id` (omitting the field when no id is available). The
  prompt instruction is best-effort — the wrapper's deterministic
  resolution is the source of truth.
- `findingToWarning()` is now an exported 2-or-3-arg helper. The pre-2026-05-04
  2-arg form (`finding`, `prose`) still produces a valid warning without the
  optional refs, so any out-of-tree caller stays back-compatible.

The drafting-phase mapping into `FunctionalIssue` (in
`src/phases/drafting.ts`) forwards `w.beatId` so the durable beat ref
survives one layer further. `FunctionalIssue` does not carry
`plannedItemId`, so that field stays on the warning shape only — direct
consumers of `checkFunctionalStateGrounding()`'s output see it; the
broader `FunctionalIssue` view does not.

### `chapter-plan-checker` — additive `beatId` on deviations

The checker contract remains `deviations[].beat_index`: the LLM is still asked
to identify the zero-based beat index or `null` for chapter-level problems.
After the schema parses, `src/phases/drafting.ts` now calls
`attachChapterPlanDeviationBeatIds()` with the live enriched outline. The helper
adds `beatId` only when `outline.scenes[beat_index].beatId` exists and the index
is in range. It does not rewrite invalid indices, chapter-level deviations, or
un-enriched legacy fixtures.

This is intentionally at the consumption boundary rather than in the prompt:
the model's job stays simple, and deterministic ID resolution remains the
source of truth. The legacy `description` and `beat_index` fields are preserved
verbatim, and `canonicalizeDeviations()` still hashes only the legacy fields so
revision dedupe semantics do not change.

### `halluc-ungrounded` — durable beat telemetry and exact entity refs

Migration `sql/046_llm_call_beat_id.sql` adds `llm_calls.beat_id` and an
index on `(novel_id, beat_id)`. `callAgent()` and `executeAndLog()` now accept
an optional `beatId` tag and persist it next to the legacy `beat_index` column.
The drafting loop passes `beatSpec.beatId` for beat-writer calls, targeted
beat rewrites, adherence checks, and halluc-ungrounded checks. The
halluc-ungrounded wrapper also falls back to `beat.beatId` when the caller only
passes `beatIndex`.

This closes the beat-id persistence part of the halluc-ungrounded gap: past
and legacy rows can still be filtered by `beat_index`, while new rows can join
directly to planning targets by durable `beat_id`.

The entity side is now additive metadata, not a checker behavior change:

- `HallucUngroundedResult.issueMetadata[]` is parallel to the legacy
  `issues[]` strings. Each entry records `{ entity, excerpt, entityRefs }`.
- `entityRefs[]` is populated only by deterministic exact or bounded
  title-stripped exact match against existing `CharacterProfile.id/name`,
  `worldBible.systems[].id/name`, or `worldBible.cultures[].id/name`.
- `src/phases/beat-checks.ts` threads that metadata into `BeatIssue.metadata`,
  and `src/phases/checker-blockers.ts` preserves it on accepted blocker
  deviations alongside the containing `beatId`.
- `llm_calls.ner_prepass_json` also stores final `issueMetadata` and
  `llmRescuedIssueMetadata`, so false-positive/rescue audits can see when a
  flagged surface form was actually tied to a durable planning target.

The human-readable issue strings, retry wording, pass/fail gate behavior, and
LLM prompt/schema are unchanged.

### `validation.ts` — additive structured findings

`validateChapterDraft()` still returns the legacy `blockers[]` and `warnings[]`
strings that drafting and validation control flow consume. It now also returns
`findings[]` entries with `{ severity, code, description, chapterNumber?,
chapterId?, beatIndex?, beatId?, metadata? }`. Every finding carries the
chapter number and optional durable `chapterId` from the outline. Validation-mode
scene-beat keyword blockers/warnings also attach `beatIndex` and `beatId` when
the outline beat has one.

Drafting and validation traces include `findings` in their payloads, but routing
now prefers the structured finding codes/refs before falling back to legacy
strings. This keeps behavior stable while making future chapter-health and
traceability UI able to group validation signals by durable beat target.

### `lint-to-prose-edit.ts` — optional beat metadata on span proposals

Lint prose-edit proposals still target the exact byte span they replace; apply
behavior is unchanged. When drafting calls the producer with `beatProses` and an
enriched outline, the producer checks that the chapter prose is exactly
`beatProses.join("\n\n")`, maps the computed span start through
`offsetToBeatIndex()`, and copies the matching `outline.scenes[i].beatId` into
the span target as `beatRef`. If any precondition is missing or inconsistent,
the field is omitted rather than guessed.

## Remaining Gaps

These are the surfaces that still emit positional / surface-form references
even though stable IDs exist somewhere in the call graph. They are listed in
rough order of "downstream lineage and impact tracking would benefit":

1. **`continuity/check.ts` (partially closed 2026-05-04)** — `factId` and
   `characterId` now flow on exact match. The remaining gap is broader name
   → ID resolution (display name → `characterId`, paraphrased fact → `factId`).
   That requires either a canonical entity-name registry available inside the
   checker or a contract change so the LLM emits IDs directly. Both are
   PR-class moves outside the additive pass.
2. **`functional-state-checker` (partially closed 2026-05-04)** — `beatId`
   and `plannedItemId` now flow on exact match (id echo or canonical
   fact / knowledge text). Remaining gap is broader resolution: paraphrased
   `planned_item` text, character-state composite descriptions, and
   contradictions whose `planned_item` is the model's own gloss rather than
   an outline-verbatim string. Closing those needs either a canonical
   entity-text registry or a tighter prompt contract that requires the
   model to echo the planned-item text verbatim.
3. **`halluc-ungrounded` (partially closed 2026-05-05)** —
   `llm_calls.beat_id` now persists the durable beat ref for new beat-level
   calls, and final issue metadata carries exact `character` / `world_system` /
   `culture` refs when the surface form can be resolved safely. Remaining gaps:
   free-form `allowed_new_entities`, outline-derived entities, legacy world
   locations without IDs, aliases, display-name variants, and paraphrases still
   remain surface-form only. Closing those needs a canonical entity registry or
   an explicit checker output contract; fuzzy matching remains out of scope.
4. **`validation.ts` (closed for current coverage scope 2026-05-05)** —
   structured findings now carry chapter refs on all findings and beat refs for
   validation-mode beat keyword checks. Drafting validation rewrite routing now
   prefers structured finding codes/refs, with legacy strings retained only as
   fallback.
5. **`lint-to-prose-edit.ts` (partially closed 2026-05-05)** — span proposals
   now carry optional `beatRef` when drafting provides an exact beat-prose map.
   Remaining gap: duplicate-text span ambiguity is still governed by the
   existing span resolver; the beat metadata does not replace span targeting.

## Tests

Focused tests exist for ID-propagation only (no creative quality assertions):

- `src/canon/lint-to-prose-edit.test.ts` and
  `src/canon/editorial-beat-coverage.test.ts` — existing tests pin the
  positional-fallback behavior on un-enriched fixtures; new cases assert
  enriched outlines surface the durable `beatId` as `beatRef`, including
  lint span proposals when exact beat prose is available.
- `src/phases/functional-checks.test.ts` — new cases assert the additive
  `beatId` / `factId` / `payoffBeatId` fields populate when the outline has
  enriched IDs.
- `src/agents/continuity/check.test.ts` — new cases assert exact-match
  `factId` / `characterId` propagation and fallback behavior when no durable
  ID can be resolved safely.
- `src/agents/functional-state-checker/index.test.ts` — new cases assert
  `beatId` resolution from enriched outlines (and absence on
  un-enriched / null / out-of-range / no-outline-arg paths), `plannedItemId`
  exact-match resolution against fact / knowledge / state ids, exact text
  matches with `trim()`, paraphrase / substring rejection, fallthrough on
  unverified ids, suppression of character-state display-name guesses, and
  byte-identical `description` / `beat_index` preservation.
- `src/agents/chapter-plan-checker/schema.test.ts` — new cases assert
  drafting-side helper resolution from enriched outlines, absence on
  un-enriched / null / out-of-range paths, and legacy string-deviation
  coercion compatibility.
- `src/agents/halluc-ungrounded/index.test.ts` — new cases assert
  `checkHallucUngrounded()` passes the durable `beatId` tag into its LLM call
  when the beat has one, exact/title-stripped entity refs resolve only against
  durable character / world-system / culture targets, and final issue metadata
  carries those refs without changing issue strings.
- `src/phases/beat-checks.test.ts` and `src/phases/checker-blockers.test.ts` —
  new cases assert halluc-ungrounded metadata survives aggregation and accepted
  blocker promotion with the containing `beatId`.
- `src/validation.test.ts` — new cases assert structured validation findings
  preserve legacy blocker/warning strings, carry chapter refs on all findings,
  carry `beatId` for validation-mode beat keyword checks, and stay absent for
  beat keyword checks in drafting mode.
- `src/phases/validation-routing.test.ts` — new cases assert structured
  validation findings route beat-scoped blockers without parsing blocker copy,
  word-count findings remain advisory/no-route, and legacy fallback remains
  available for stale or forced blocker paths.

## How To Use This Doc

Update this table when:

- A new checker / proposal producer ships and emits findings.
- A finding shape gains structured ID fields.
- A schema migration adds a durable-ID column the audit depends on (e.g.
  `llm_calls.beat_id`).

If a row's status flips from "positional only" to "durable IDs threaded",
record the commit SHA and date in the "Status" column rather than removing the
row. The doc is a coverage map, not a backlog.
