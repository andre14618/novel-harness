---
title: Writer-Visible ID Rendering Audit + A/B Plan
date: 2026-05-10
status: audit + experiment proposal; docs-only, no runtime changes
inputs:
  - src/agents/**
  - docs/research/user-adjusted-backlog-2026-05-10.md
---

## Section 1 — Principle

Traceability IDs are **mandatory infrastructure**. Every persisted scene, beat,
chapter, obligation, source, character, story thread, story debt, and payoff
keeps stable IDs in system state, DB rows (`outlines`, `obligations`,
`llm_calls.scene_id`, `llm_calls.beat_id`, `chapter_drafts`, `eval_briefs`,
`eval_results`, `pipeline_events`, `proposal_envelopes`,
`planning_mutation_lineage`, `proposal_resolution_outcomes`, `chapter_revisions`),
checker findings, proposal targets, traceability views, eval artifacts, and
audit logs. Removing IDs from any of those surfaces is **out of scope** for this
audit — it would break replay, lineage, proposal review, and impact preview.
This audit asks **only** the narrow question raised in
`docs/research/user-adjusted-backlog-2026-05-10.md` Correction 2: are raw IDs
load-bearing inside the **LLM prompt text**, and within that, primarily inside
the **prose-writer prompt** with a finer-grained view of mapper / checker /
reviewer / proposal-editor prompts. The model needs the meaning of a
dependency; trace metadata holds the literal ID.

## Section 2 — Audit table

Render sites are listed by (file:fn). Every row points at code that ships text
into a `userPrompt`/`systemPrompt`. "Prompt visible to (agent)" lists the LLM
role(s) that consume the rendered string.

| # | Render site (file:fn) | ID type(s) emitted | Prompt visible to (agent) | Why visible (purpose) | Model uses it for | Recommendation |
|---|---|---|---|---|---|---|
| 1 | `src/agents/writer/character-context.ts:147` `renderCharacterContextCapsules` — `Chapter ID:`, `Beat ID:`, `POV character ID:`, `Active thread refs:`, `Active promise refs:`, `Active payoff refs:`, `Missing character IDs:` and per-card `[characterId]`, `Source obligations:`, `Active threads:`, `Active promises:`, `Active payoffs:` | `chapterId`, `beatId`, `povCharacterId`, `characterId`, `threadId[]`, `promiseId[]`, `payoffId[]`, `obligationId[]` | **prose writer** (production default — `writerContextMode = thread-character-context-v1`, set in `src/agents/writer/context-mode.ts:5`; threaded through every writer call site in `src/phases/drafting.ts:383, 391, 648, 655, 681, 688, 860, 868, 1163, 1171, 1743, 1751`) | Writer-side telemetry/tracing surfacing that this scene activates particular threads/promises/payoffs/obligations and that the per-card character is the same one referenced upstream. | None of these labels names a craft action. The model cannot do anything with raw ID strings except echo them — and no checker reads writer prose for ID echoes. The semantic load is in the *fact*, *want*, *need*, *lie*, *truth*, *voice*, *POV personal stake* fields immediately above. | **render semantic text instead** — example below. |
| 2 | `src/agents/writer/beat-context.ts:236, 245` `buildBeatContextSlots` (seeds + payoffsDue fallback) — fallback `[fact_id=${p.fact_id}]` when `factById.get` returns undefined. Render site is `src/agents/writer/beat-context-render.ts:101, 108` `renderBeatSpec` — emits `"… (lands at beat N)"` / `"… (seeded in beat N)"`. | `fact_id` (only on lookup failure) | prose writer | Defensive fallback so the writer still sees *something* when the fact text is missing. Beat number rendering is positional, not an ID. | Writer would only see `fact_id=` strings on a planner bug; in normal runs the fact text renders. | **render semantic text instead** — replace fallback with `(unresolved planner reference)` and emit a deterministic warning into trace. The literal `fact_id=…` text gives the writer no actionable signal. |
| 3 | `src/agents/writer/beat-context-render.ts:127` `renderSceneContract` (L097 SCENE CONTRACT block) | None. Field labels (`Goal:`, `Opposition:`, `Turning point:`, `Crisis choice:`, `Choice alternatives the protagonist weighs:`, `Outcome:`, `Consequence:`, `POV personal stake:`, `Value polarity: X → Y`) | prose writer (off-flag default; on when `sceneCallWriterV1` is set) | Pure semantic dramatic shape. | The writer turns goal/opposition/turning-point into scene structure. | **keep visible** — no IDs to remove; this is the canonical example of how the rest of the writer prompt should read. |
| 4 | `src/agents/writer/beat-context-render.ts:87` `renderBeatSpec` (`BEAT N of M`, `POV: name`, `Setting: name`, `Kind: kind`, `Characters present: name1, name2`, `SEEDS`, `PAYOFFS DUE`, `BEAT OBLIGATIONS`) | None. Beat is rendered by **number** (`BEAT N of M`) not by `beatId`. | prose writer | Positional reference + obligation prose text. | Writer treats beat number as ordinal. | **keep visible** — beat number is positional, not a traceability ID. |
| 5 | `src/agents/writer/beat-context.ts:282-298` `buildSnapshotFull/Compact` (CHARACTERS section rendered by `renderCharactersFull`/`renderCharactersCompact`) | Character is keyed by **display name**, not `characterId` (Voice / Drives / Avoids / Conflict / State / With X / Doesn't know / Example voiced lines). | prose writer | Voice + drives + state + relationship + ignorance, anchored on the human name. | Writer matches dialogue/behavior to the named character. | **keep visible** — already semantic. This is the shape Cluster-1 rows should converge on. |
| 6 | `src/agents/writer/enriched-context.ts:193` `renderReaderInfoState` (READER-INFO STATE: `Reader already knows`, `Hidden from {char}`) | None visible. Per-fact lines are tagged with `[ch{N}]` chapter number (positional, not a `chapterId`). | prose writer (chapter > 1) | Tells writer what the reader and individual characters already know vs. don't. | Writer avoids re-revealing established facts; preserves character ignorance. | **keep visible** — semantic. |
| 7 | `src/agents/writer/enriched-context.ts:99` `renderSpeakerDirectives` (Arm-B preflight) | None. Cultural background + system awareness rendered by name. | writer (Arm B preflight only; not production default) | Cultural stance / system awareness lines. | Writer uses cultural framing in speech. | **keep visible** — semantic; not in production writer path. |
| 8 | `src/agents/writer/reference-resolver.ts:71` `resolveReferences` (LLM lookup decider) | None. Asks the lookup LLM `"Beat: '<description>' / Characters: name1, name2 / Setting: name / Chapter: N"`. | reference-resolver LLM (decides which DB lookup to perform) | Decision input for which background to fetch. | Lookup classifier. | **keep visible** — already semantic. |
| 9 | `src/agents/writer/adherence-checker.ts:152` `checkBeatAdherence` user prompt (`BEAT: <description> / CHARACTERS EXPECTED: name1, name2 / PROSE: ---`) | None. | adherence-events checker (stage 1 + stage 2) | Verifies beat events were enacted on-page. | Event presence judgment. | **keep visible** — already semantic; no IDs visible in the prompt body (IDs flow as `tags` to telemetry only). |
| 10 | `src/agents/halluc-ungrounded/context.ts:305` `buildContext` (BEAT BRIEF / WORLD BIBLE / SPEAKERS / PROSE TO CHECK) | None visible (entity grounding by name only; no IDs). | halluc-ungrounded checker | Decide if a named entity is grounded. | Entity grounding judgment. | **keep visible** — already semantic. |
| 11 | `src/agents/continuity/check.ts:172` `buildStateUserPrompt` — `${cs.characterId}: at ${cs.location}, feeling …, knows: …` | `characterId` (rendered raw on each character-state line) | continuity-state checker | The checker outputs a `character` field in its violation payload; deterministic post-resolution maps that back to a stable `CharacterState.characterId` via exact-match (`resolveCharacterId`). | The checker is asked to flag impossible knowledge/location violations. The model does not need the literal ID — it needs the character's **name**. The wrapper already does exact-name → ID mapping. | **render semantic text instead** — emit the character's display name (e.g. `Sylvie: at Chancel infirmary, feeling shaken, knows: …`). Keep the ID in the trace tags, not the prompt text. The wrapper continues to resolve back to `characterId` from the model's `character` field via `resolveCharacterId`. |
| 12 | `src/agents/continuity/check.ts:162` `buildFactUserPrompt` — `[ch{N}] [{category}] {fact text}` | None. Chapter is rendered by number; fact is rendered by text. | continuity-facts checker | Fact-contradiction judgment. | Match free-form prose against canonical facts. | **keep visible** — semantic. |
| 13 | `src/agents/functional-state-checker/context.ts:11` `buildContext` (PLANNED_STATE block) — `JSON.stringify({ establishedFacts, characterStateChanges, knowledgeChanges })` and `JSON.stringify(beats)` where each beat carries `beat_id`. | `establishedFacts[].id`, `characterStateChanges[].id`, `knowledgeChanges[].id`, `characterStateChanges[].characterId`, `knowledgeChanges[].characterId`, `beat_id`, `beat_index` | functional-state-checker LLM | The checker is asked to emit `planned_item_id` matching the upstream item's `id` verbatim. The system prompt (functional-state-checker-system.md:40-44) says: *"copy that id verbatim into `planned_item_id`. Do not paraphrase, abbreviate, or guess an id."* Wrapper validates emitted ID against the input registry. | Structured-output mapper. Raw IDs are required because the model's job IS to emit `{planned_item, planned_item_id, beat_index}` rows. | **keep visible** — Cluster 4 (model is updating a structured target). Removing IDs would break the contract. |
| 14 | `src/agents/chapter-plan-checker/context.ts:23-44` `buildContext` (SCENE BEATS, `id=${f.id}` on FACTS) | `establishedFacts[].id` (rendered as `[id={id}]` line). Beats rendered as `Beat N` (positional). | chapter-plan-checker LLM | The checker emits `deviations[].beat_index` (numeric, not `beatId`). The `id=…` on facts is *not* echoed in the deviation output schema; the schema (`schema.ts:22-32`) returns `setting_match`, `emotional_arc_correct`, `deviations: [{description, beat_index}]`. | The checker doesn't need to echo fact IDs back — the schema doesn't carry one. The line is decorative. | **needs human decision** — likely a **cosmetic / orphan site** (Cluster 5). Operator should confirm whether `[id=…]` lines on facts have any consumer; if not, remove. |
| 15 | `src/agents/chapter-plan-reviser/context.ts:4-7` `skeletonBlocks` — `JSON.stringify(outline.scenes)`, `JSON.stringify(outline.establishedFacts)`, `JSON.stringify(outline.characterStateChanges)`, `JSON.stringify(outline.knowledgeChanges)` | All IDs nested in those JSON dumps: `chapterId`, `sceneId`, `beatId`, `obligationId`, `sourceId`, `characterId`, `threadId`, `promiseId`, `payoffId`, fact `id`, knowledge `id`, state `id`, `requiredPayoffs[].fact_id`, `payoff_beat`. | chapter-plan-reviser LLM | The reviser emits a revised `scenes[]` (and optionally facts/states/knowledge). System prompt (`plan-revision-system.md:22-27`): *"You MUST preserve … `establishedFacts` — unless a fact is the cause of the unresolved issue, carry it forward verbatim."* | Structured-target editor. Must echo IDs back to keep planning_mutation_lineage attached. | **keep visible** — Cluster 4. |
| 16 | `src/agents/planning-state-mapper/context.ts:35-46` `renderBeatLine` — beat rendered as `${index}.${idTag}` where `idTag = beat.beatId ? \` [${beat.beatId}]\` : \`\`` | `beatId` per beat row | planning-state-mapper LLM | System prompt (`state-mapper-system.md:88-90`): *"Use only existing beat indexes from the provided beat list… the matching `beatId` is shown in brackets next to each beat… When emitting a `beatMappings[]` entry, include both `beatIndex` and `beatId` from the input."* | Structured-target editor. Echoes `beatId` back into `beatMappings[]`. | **keep visible** — Cluster 4. |
| 17 | `src/agents/planning-state-repair/context.ts:43-80` `renderSources` / `renderBeat` / `renderBeatObligations` — `sceneId=…`, `beatId=…`, `sourceId=…`, `obligationId=…`, `characterId=…`, `sourceKind=…` on every line | `sceneId`, `beatId`, `sourceId`, `obligationId`, `characterId`, `sourceKind` | planning-state-repair LLM | The agent emits `add` / `remove` / `update` operations keyed by `(sceneId|beatId, list, sourceId)`. System prompt (`state-repair-system.md:50-54`) is explicit: *"Every operation must include an existing sceneId or, only for legacy beat-shaped targets, an existing beatId."* | Structured-target editor. Cannot do its job without the IDs. | **keep visible** — Cluster 4. Adding semantic gloss is fine but redundant given the agent's narrow ID-only contract. |
| 18 | `src/schemas/planning-directives.ts:289-330` `renderStoryThreadSections` — `STORY THREADS (preserve exact IDs in downstream obligations)`, `- threadId={id}: {label}`, `- promiseId={id} threadId={id}: {text}`, `- payoffId={id} promiseId={id} threadId={id}: {text}`, plus the `STORY REF RULE` line. Consumed by **`renderDirectivesForPlanner`** (planning-plotter, planning-beats, planning-state-mapper) AND **`renderDirectivesForConcept`** (world-builder, character-agent, plotter, planning-extractor). | `threadId`, `promiseId` (storyDebtId), `payoffId` | planning-plotter (skeleton), planning-beats (expansion), planning-state-mapper, world-builder, character-agent, plotter, planning-extractor | Author-supplied story-ref IDs; downstream agents must preserve them on emitted obligations so cross-chapter thread/promise/payoff lineage holds. | Mapper copies them verbatim onto obligation items. World-builder/character-agent/plotter do **not** emit obligations — they consume the directives only as context. | **needs human decision** — split site. (a) **Mapper / planner-beats / planner-skeleton** (structured-target consumers) — Cluster 4, keep visible. (b) **World-builder / character-agent / plotter / planning-extractor** — Cluster 5 cosmetic; these agents don't echo IDs back. Removing IDs from `renderDirectivesForConcept` while keeping them in `renderDirectivesForPlanner` is a clean clean-up. |
| 19 | `src/agents/structure-mice/context.ts:39-72` `buildMiceContext` (corpus extractor) — `beat_id: ${input.brief.beat_id}` and `chapter: …` | `beat_id` | mice-tagger LLM (corpus pipeline only — not the runtime prose pipeline) | The structure tagger emits findings keyed by `beat_id`; system prompt requires the model echo it back unchanged. | Structured-output mapper. | **keep visible** — Cluster 4 (corpus pipeline). Out of scope for the live writer A/B but listed for completeness. |
| 20 | `src/agents/structure-mckee-gap/context.ts:45-56` `buildMckeeGapContext` — `beat_id`, `scene_id`, `beat_idx`, `chapter` | `beat_id`, `scene_id`, `beat_idx`, `chapter` | mckee-gap tagger (corpus) | Same — structured-output corpus extractor. | Echo IDs back into findings rows. | **keep visible** — Cluster 4 (corpus pipeline). |
| 21 | `src/agents/structure-promise/context.ts:39-77` `fmtBeats` — `[ch_label=… / ch_index=… / scene=… / beat=…]` per row, plus pass-2 `${p.promise_id} | opened ch_label=…`. | `chapter_label`, `chapter_index`, `scene_id`, `beat_idx`, `promise_id` | promise-extractor (corpus) — open + close passes | System prompt: *"Echo BOTH chapter_label and chapter_index verbatim into your output for the opening beat of each promise."* Pass 2 must emit ONE closure per `promise_id`. | Structured-output mapper. | **keep visible** — Cluster 4 (corpus pipeline). |
| 22 | `src/agents/structure-character-arcs/context.ts:37-44` `fmtBeats` — `[ch_label=… / ch_index=… / scene=… / beat=…]` per row | `chapter_label`, `chapter_index`, `scene_id`, `beat_idx` | character-arcs extractor (corpus) | Schema requires `evidence_quote_lie/truth` to be a verbatim substring of one of the beat summaries; the per-row `[…]` header is the disambiguator. | Mapper output anchoring. | **keep visible** — Cluster 4 (corpus pipeline). |
| 23 | `src/agents/structure-value-charge/context.ts:34-67` `buildValueChargeContext` — `beat_id`, `chapter` | `beat_id` | value-charge tagger (corpus) | Same — structured-output mapper. | Echo IDs back into per-scene tags. | **keep visible** — Cluster 4 (corpus pipeline). |
| 24 | `src/agents/artifact-adjuster/context.ts:14-26` `buildContext` — `JSON.stringify(charSummary)` includes `id: c.id` per character. System prompt (`adjuster-system.md:13-30`) says: *"Never invent new character IDs. Use only the IDs that appear in the current character list."* | `CharacterProfile.id` | artifact-adjuster (chat-style editorial assistant) | The adjuster emits `{type: "characterUpdate", characterId: "<id>", patch: …}` and `{type: "characterRename", characterId: "<id>", newName: "<name>"}`. | Structured-target editor — must echo IDs back into patch envelopes. | **keep visible** — Cluster 4. |
| 25 | `src/agents/planning-state-mapper/state-mapper-system.md` (system prompt body) — example obligations carrying every ID type (`obligationId`, `sourceId`, `sourceKind`, `characterId`, `threadId`, `promiseId`, `payoffId`, `payoffEventId`); plus L96 SCENE PLAN CONTRACT guidance (mapper-context.ts:84-97). | Same as row 16 plus the system-prompt examples. | planning-state-mapper LLM | Schema-by-example. The model produces ID-keyed JSON; the prompt teaches the shape. | Structured-output mapper schema teaching. | **keep visible** — Cluster 4. |
| 26 | `src/agents/planning-extractor/extractor-system.md:12-14` (system prompt) — names `threadId`, `storyDebtId`, `payoffId` as optional output fields. | Field-name references in the schema description. | planning-extractor LLM | The extractor emits `storyThreads[].threadId?`, `storyDebts[].storyDebtId?`, `storyPayoffs[].payoffId?` only when the author supplied an ID-like label. | Structured-output mapper schema teaching. | **keep visible** — Cluster 4. |
| 27 | `src/agents/planning-state-repair/state-repair-system.md:1-55` (system prompt) — every operation example carries `sceneId`, `obligationId`, `sourceId`, `sourceKind`, `characterId`. | Same as row 17. | planning-state-repair LLM | Schema-by-example. | Structured-target editor schema teaching. | **keep visible** — Cluster 4. |
| 28 | `src/agents/functional-state-checker/functional-state-checker-system.md:25-44` (system prompt) — finding shape includes `planned_item_id`, `beat_index`. | Schema field references. | functional-state-checker LLM | Tells the model how to echo the matched item's `id` back. | Structured-output mapper schema teaching. | **keep visible** — Cluster 4. |
| 29 | `src/agents/writer/character-context.ts:166` per-card line `- ${card.name} [${card.characterId}] (${card.sceneRole}; ${card.role})` (sub-line of row 1, listed separately because it sits inside each character card body — not the capsule header) | `characterId` | prose writer | Same as row 1 — the writer card already has the human name; the bracketed `[characterId]` is duplicate identity. | Echo target — but writer is not asked to emit IDs. | **render semantic text instead** — drop the `[characterId]` bracket. The header line `- ${card.name} (pov; protagonist)` is enough. |

Total render sites surveyed: 29.

### Semantic-rendering examples for "render semantic text instead" rows

**Row 1 + Row 29 (writer character-context capsules):** today's render

```
CHARACTER CONTEXT CAPSULES:
Mode: thread-character-context-v1
Scope: beat
Chapter ID: ch-001-deep-stacks
Beat ID: beat-001-trust-choice
Beat number: 1
POV character ID: char-noor
POV personal stake: Noor cannot let Davan be reduced to leverage again …
Active thread refs: thread-inquiry, thread-relationship
Active promise refs: debt-folio
Active payoff refs: payoff-folio-prediction

- Noor [char-noor] (pov; protagonist)
  Want: …
  Need: …
  Source obligations: obl-noor-learns-cassius
  Active threads: thread-inquiry
  Active promises: debt-folio
  Active payoffs: payoff-folio-prediction
```

Arm-B writer-only render (IDs preserved in trace metadata, not the prompt):

```
SCENE CONTEXT:
POV personal stake: Noor cannot let Davan be reduced to leverage again …

Active story pressure (this scene must move them):
- Truth-of-the-folio inquiry — Noor is closing on who falsified the ledger.
- Davan-folio promise — the reader has been told this folio will be exposed.
- Folio-prediction payoff — this scene can land it (or hold it open).

CHARACTERS IN SCENE:
- Noor (pov; protagonist)
  Want: …
  Need: …
  Pressure: this scene must move "Noor learns Cassius's role" — see what she does about Cassius's evasion.
```

**Row 2 (writer beat-context fact-id fallback):** today emits `[fact_id=fact-foo]` when the fact text is unresolvable. Replace with `(unresolved planner reference — see trace warning)` and emit a deterministic warning to the trace; the writer cannot do anything with `[fact_id=fact-foo]` except parrot it.

**Row 11 (continuity state-check user prompt):** today renders

```
char-sylvie: at Chancel infirmary, feeling shaken, knows: ledger forged
```

Replace with

```
Sylvie: at Chancel infirmary, feeling shaken, knows: ledger forged
```

`resolveCharacterId` already does exact-match `model.character → cs.characterId`; it works equally well on display names because `CharacterState.characterId` and `CharacterProfile.name` are mapped through the deterministic name resolver upstream. Keep `characterId` in the trace tag, drop it from the prompt text.

### Operator-decision rows

**Row 14 (chapter-plan-checker `[id={id}]` decoration on FACTS lines):** the
checker schema (`src/agents/chapter-plan-checker/schema.ts:22-32`) emits
`deviations: [{description, beat_index}]`. Nothing in the schema carries fact
IDs. The `[id=…]` decoration is therefore either (a) leftover from an earlier
version of the schema that did emit fact IDs, or (b) a deliberate steering
hint the operator wants the model to "see" without echoing. **Question:** does
the model use the fact-id decoration to disambiguate similarly-worded facts at
inference time, or is it dead weight? If dead weight, remove it as part of
Cluster 5.

**Row 18 (`renderStoryThreadSections` consumed by both planner and concept
agents):** mapper / planner-beats / planner-skeleton genuinely need the IDs
because their output echoes them back as obligation refs. World-builder /
character-agent / plotter / planning-extractor receive these directives only
as context. **Question:** is there a use case where the world-builder is asked
to author cultural/system content that *names* a story thread by ID? If not,
`renderDirectivesForConcept` can drop the `threadId=`/`promiseId=`/`payoffId=`
prefixes and just render `- {label}: {description}`. Concept stages would then
see `STORY THREADS (the planner will track these): - The truth-of-the-folio
inquiry: Noor traces who falsified the ledger.` — same semantic load,
zero IDs.

## Section 3 — Findings summary

### Cluster 1: Prose-writer creative-rendering sites (the adjusted-B1 ablation candidates)

**Sites: 4** (rows 1, 2, 11, 29). Row 11 is technically a checker prompt but it
sits in the writer-adjacent gray zone — it gates drafting through the
continuity blocker path, and the operator may want to bundle it with Cluster 1
because the same display-name normalization argument applies.

Top three for the ablation:

1. **Row 1 — `renderCharacterContextCapsules` capsule header lines** (`Chapter
   ID:`, `Beat ID:`, `POV character ID:`, `Active thread refs:`, `Active
   promise refs:`, `Active payoff refs:`, `Missing character IDs:`). This is
   the largest visible-ID surface in the production writer prompt and the
   single biggest noise injection. Production default is on
   (`writerContextMode = thread-character-context-v1`).

2. **Row 29 — per-card `[characterId]` bracket** (`- Noor [char-noor] (pov;
   protagonist)`). Duplicate identity adjacent to the canonical name.

3. **Row 1 (continued) — per-card `Source obligations:`, `Active threads:`,
   `Active promises:`, `Active payoffs:` lines.** These are *per-character*
   ID lists and bloat every card. Replace with a single semantic
   "this character is moving the …-inquiry / …-promise" line.

Recommended posture for Cluster 1: **toggle behind a flag in the A/B per
Section 4**. Default-off until A/B proves it. Trace metadata (the
`WriterCharacterContextTrace` shape in `character-context.ts:39-53`) is
already separate and should preserve the IDs unconditionally — that's the
audit log. The prompt-text rendering is the only thing toggled.

### Cluster 2: Structured-output / mapper / checker / reviewer sites (IDs likely stay — operator's explicit exception class)

**Sites: 11** (rows 13, 16, 17, 25, 27 — strict structured mappers; rows
19-23, 26 — corpus structural extractors). All emit ID-keyed JSON whose
schema requires a verbatim ID echo. Removing IDs would break the contract.
Top three: planning-state-mapper (row 16), planning-state-repair (row 17),
functional-state-checker (row 13). Recommended posture: **keep visible.**

### Cluster 3: Disambiguation sites (IDs stay because two similarly named things need exact reference)

**Sites: 0 (clean).** No render site I found uses raw IDs *purely* for
disambiguation. Disambiguation is achieved by deterministic name resolution
(continuity wrapper, halluc-ungrounded NER prepass) or by structured-target
schema (Cluster 2). If two characters were named identically, the writer
prompt today would still render both by name and the relationship-resolver
would return both candidates — the writer prompt does not currently lean on
characterId for disambiguation.

### Cluster 4: Plan/proposal-update sites (IDs stay because the model is editing a structured target)

**Sites: 4** (rows 15 chapter-plan-reviser, 24 artifact-adjuster, 28
functional-state-checker schema teaching, 18-partial planner-side directives).
Same posture as Cluster 2 but distinguished because these are *editors*
producing patches against existing IDs, not extractors emitting fresh tags.
Recommended posture: **keep visible.**

### Cluster 5: Cosmetic / orphan sites (removal candidates regardless of A/B)

**Sites: 2** (row 14 — chapter-plan-checker fact `[id=…]` decoration; row 18
partial — `renderDirectivesForConcept` ID prefixes consumed by world-builder /
character-agent / plotter / planning-extractor that don't echo them back).

Both should be confirmed by the operator (Section 6) before removal. Lower
priority than the prose-writer ablation but cheap to fix; recommend folding
into a small follow-up "ID-cleanup" ticket *after* B1 settles, not before —
keep the lane focused.

## Section 4 — A/B experiment plan

### Hypothesis

Replacing raw ID strings (`Chapter ID:`, `Beat ID:`, `POV character ID:`,
`Active thread refs:`, `Active promise refs:`, `Active payoff refs:`,
`Missing character IDs:`, per-card `[characterId]`, `Source obligations:`,
`Active threads:`, `Active promises:`, `Active payoffs:`) in the prose-writer
prompt with semantic dependency text will produce parity-or-better drift,
hallucination, and obligation coverage outcomes at lower token cost, because
the LLM cannot do anything actionable with raw ID strings except echo them,
and no consumer reads writer prose for ID echoes.

### Arms

**Arm A — current writer prompt with raw IDs visible.**

Keep `renderCharacterContextCapsules` exactly as today. Production default
(`writerContextMode = thread-character-context-v1`).

**Arm B — prose-readable dependency text; raw IDs removed from visible
prompt, preserved in trace metadata.**

Toggle the following Cluster-1 render sites behind a single flag,
`writerCapsuleIdRenderingV2: "off" | "semantic"` (default `off` = Arm A;
`semantic` = Arm B):

| Render site | Off (Arm A) | Semantic (Arm B) |
|---|---|---|
| `character-context.ts:154` `Chapter ID: …` | emit | suppress |
| `character-context.ts:155` `Beat ID: …` | emit | suppress |
| `character-context.ts:157` `POV character ID: …` | emit | suppress |
| `character-context.ts:159` `Active thread refs: id1, id2` | emit | replace with `Active story pressure (this scene must move):\n- {thread.label}: {thread.description-or-1-line-purpose}` rendered from a separate `WriterStoryRefDescriptor` payload assembled by the slot builder |
| `character-context.ts:160` `Active promise refs: id` | emit | replace with promise label + opener-debt prose |
| `character-context.ts:161` `Active payoff refs: id` | emit | replace with payoff target prose |
| `character-context.ts:162` `Missing character IDs: …` | emit | suppress (this is a planner-bug warning that belongs in the trace, not the writer prompt) |
| `character-context.ts:166` `- {name} [characterId] (sceneRole; role)` | emit | drop the bracketed `characterId` only; keep `- {name} (sceneRole; role)` |
| `character-context.ts:177-180` per-card `Source obligations: …`, `Active threads: …`, `Active promises: …`, `Active payoffs: …` | emit | replace with one-line `Pressure: this scene must move "{obligation.text}" — for {character.name}.` derived from `ObligationItem.text` joined with the character |

`WriterCharacterContextTrace` (`character-context.ts:39-53`) keeps every ID
unchanged in **both arms** — that is the trace metadata payload. Telemetry
remains identical.

The fact-id fallback (row 2) is a separate small fix; bundle into Arm B's
diff if cheap, otherwise leave for a follow-up. The continuity state-check
(row 11) is a different agent and a different lane — keep out of B1.

### Fixture set

**Defer to** `docs/research/scene-write-fixture-design-2026-05-10.md` (the
parallel subagent's deliverable). Per Correction 1 in
`docs/research/user-adjusted-backlog-2026-05-10.md`, that fixture set
**must** include the live over-target failure profile (1.89× / 3.03× from
`novel-1778411555121`, see
`docs/sessions/2026-05-10-runtime-drafting-evidence.md`) plus undershoot,
clean pre-resolved-NPC, and at least one real generated plan. B1 reuses
that fixture set verbatim — do not invent a B1-only fixture set, that
fragments evidence across lanes.

**Important precondition:** the runtime evidence run on
`novel-1778411555121` produced empty `activeThreadIds` / `activePromiseIds`
/ `activePayoffIds` (per
`docs/sessions/2026-05-10-runtime-drafting-evidence.md` Finding 3). If the
fixture set inherits that profile, Arm A and Arm B will be **identical** on
the thread-refs lines (both emit nothing) and the ablation will measure
only the `Chapter ID` / `Beat ID` / `POV character ID` / `[characterId]`
removal — a weaker test. **Mitigation (declare in the lane doc):** at least
one fixture must come from a plan path that emits non-empty
`storyThreads`/`storyDebts`/`storyPayoffs` directives, so the ablation
exercises the full ID surface, not just the bare-capsule header. The
"Next session" item in `docs/sessions/lane-queue.md` (1) — fixture or prompt
path that emits real `threadId`/`promiseId`/`payoffId` refs — is the same
need; coordinate.

### Sample size and shape

- N = **20 paired scenes per arm** (40 writer calls total). Paired means same
  fixture-scene under both arms with the same seed; pairing eliminates
  fixture-variance from the comparison.
- **Two seeds per pair** (40 paired pairs, 80 writer calls total) for
  inter-seed stability check on the dimensions where DeepSeek V4 Flash has
  shown self-inconsistency (notably adherence stage-1).
- Plans are **frozen** — same outline JSON for both arms; this isolates the
  prompt change from any planner variance.
- Concurrency: DeepSeek V4 Flash, parallel within budget (per
  `feedback_parallel_batch_limit` cap of ~10-15 in-flight).

### Metrics

| Metric | Measurement | Meaningful-effect threshold |
|---|---|---|
| **Plan drift** | Chapter-plan-checker (`src/agents/chapter-plan-checker/index.ts`) `pass` rate per arm; deviation count per scene; setting-mismatch / emotional-arc-reversed flags | ≥ 5 percentage-point drop in pass rate is meaningful; ≥ 10 pp is regression |
| **Hallucination** | Halluc-ungrounded (`src/agents/halluc-ungrounded/index.ts`) flag count per scene (entity-level, deterministic + LLM-confirmed) | ≥ 0.5 additional flags/scene mean is meaningful; ≥ 1.0 is regression |
| **Obligation coverage** | Adherence-events (`src/agents/writer/adherence-checker.ts`) stage-1 + stage-2 enacted-event rate per beat; structured `findings[]` from `validateChapterDraft()` for stable obligation refs | ≥ 5 pp drop in per-event enactment rate is meaningful; ≥ 10 pp is regression |
| **Cost / tokens** | `llm_calls.input_tokens` + `llm_calls.output_tokens` + `llm_calls.cost_usd` per writer call | Report; not a promotion criterion |
| **Prose quality** | DeepSeek-judge pairwise (per `feedback_gold_stability_first` — gold-stable judge required, do **not** use the broken pairwise judge from `docs/sessions/2026-05-07-method-pack-planner-cohort.md`). If the gold-stable judge isn't ready, fall back to operator pairwise on a 10-pair subsample. | Pairwise win rate ≥ 50% (parity) for promotion; < 40% is regression |
| **Word-target ratio** | `final_words / target_words` per scene (the live failure mode — 1.89× / 3.03× on the runtime evidence run) | Δ ≥ 0.1 ratio improvement is favorable; Δ ≤ -0.1 is regression toward worse expansion |

### Stop / promotion gates

**Promote Arm B → default-on** only if **all** of:
- Plan drift parity-or-better (no ≥ 5 pp pass-rate drop).
- Hallucination parity-or-better (no ≥ 0.5 flags/scene increase).
- Obligation coverage parity-or-better (no ≥ 5 pp enactment-rate drop).
- Prose quality parity-or-better (pairwise win rate ≥ 50%).

Token savings alone do **not** promote. Per
`docs/research/user-adjusted-backlog-2026-05-10.md` decision rule.

**Kill (revert to Arm A as permanent default; close the lane)** if **any**:
- Plan drift regresses by ≥ 10 pp pass-rate drop.
- Hallucination regresses by ≥ 1.0 flags/scene increase.
- Obligation coverage regresses by ≥ 10 pp enactment-rate drop.

**Inconclusive band** (declared explicitly so it doesn't get litigated post-
hoc): drift Δ in (-10pp, -5pp), hallucination Δ in (+0.5, +1.0), obligation
coverage Δ in (-10pp, -5pp), prose-quality pairwise in (40%, 50%). Result:
**hold** — keep flag default-off, document the inconclusive verdict in
`docs/decisions/L099-…`, do not promote, do not kill, no second N=20 run
unless the operator explicitly authorizes more sample.

### Cost envelope

Target: **< $1 total**.

DeepSeek V4 Flash list price ~$0.14/1M input, ~$0.28/1M output (as of
2026-04 entries in `src/models/registry.ts` — verify before run). Writer call
typical input ~3-5K tokens uncached, ~6-9K with capsules; output ~600-1200
tokens. With prefix caching across paired calls, expected ≈ $0.40 for 80
writer calls + checker calls (adherence, halluc-ungrounded, plan-checker —
each ≈ same shape). Adds ~$0.30 for checker passes. Pairwise judge passes
add ≈ $0.20 if used. **Total budget cap: $2 (well under the autonomy
threshold).** Record actual `llm_calls.cost_usd` rollup in the lane doc.

### Telemetry to capture

In **both arms**, every writer/checker call must persist:

- `llm_calls.scene_id`, `llm_calls.beat_id` — already wired (per
  `docs/current-state.md` "Scene-level LLM telemetry persists
  `llm_calls.scene_id`").
- `llm_calls.run_id` and `experiment_id` — already wired.
- `WriterCharacterContextTrace` payload (with all activeThreadIds /
  activePromiseIds / activePayoffIds / sourceObligationIds /
  characterIds / missingCharacterIds) → persisted to `pipeline_events`
  under an event type like `writer-context-trace`. This is the audit lineage
  the operator needs to confirm Arm B did not silently lose ID coverage.
- New: `writer_arm` ∈ {`A`, `B`} on the writer-call event payload so the
  pairwise replay can join arms cleanly.
- `chapter_plan_checker` deviations, `halluc-ungrounded` flags,
  `adherence-events` stage-1/stage-2 results per beat — already wired.

Operator post-run audit query: pull all writer-context-trace events for the
A/B experiment_id, group by writer_arm, confirm both arms have the same set
of activeThreadIds/activePromiseIds/activePayoffIds populations. If Arm B's
trace payload is missing IDs that Arm A's has, the implementation broke the
audit contract — kill regardless of metric outcome.

### Rollback procedure

Single flag: `writerCapsuleIdRenderingV2`. Default `off` (Arm A). Promotion
flips default to `semantic` (Arm B). Rollback is a one-line revert in
`src/config/pipeline.ts` plus a deploy. No DB migration, no schema change,
no telemetry change — the trace payload is identical across arms.

If a regression appears post-promotion, flip the default back to `off`,
persist a `docs/decisions/L0XX-writer-capsule-id-rendering-rollback.md` with
the regression evidence (commit-pinned), and reopen the lane.

## Section 5 — Recommended docs updates (input to the docs-sweep step)

Do **not** land these in this audit's commit; they are proposals for the
next docs-sweep step.

- **`docs/current-state.md`** — add a one-paragraph "Traceability principle"
  rule under "Active Architecture": IDs are mandatory in DB / telemetry /
  proposals / evals / audit logs. Visibility inside LLM prompts is per-agent;
  prose-writer prompts may render dependencies semantically when an A/B
  shows parity-or-better, with raw IDs preserved in trace metadata.

- **`docs/sessions/lane-queue.md`** — under §Next, add a B1 entry:
  "Adjusted-B1: writer-prompt ID-rendering ablation. Toggle Cluster-1
  capsule ID lines behind `writerCapsuleIdRenderingV2`. Reuses the
  scene-write fixture set; promotion gate is parity-or-better on drift +
  halluc + obligation coverage + prose quality. See
  `docs/research/id-rendering-audit-2026-05-10.md` §4." Sequence after
  scene-write fixture design lands; B2 (mixed fixture) is a precondition
  per Correction 1.

- **`docs/authoring-methodology-hypotheses.md`** — add a hypothesis row:
  "ID-rendering noise hypothesis: writer prompts that render raw
  traceability IDs (`Chapter ID`, `Beat ID`, `POV character ID`, `Active
  thread refs`, `Source obligations`, etc.) inject decorative text the
  model cannot use semantically; replacing with prose-readable dependency
  text holds drift/halluc/coverage and improves expansion variance.
  Validation: B1 ablation."

- **New decision record `docs/decisions/L099-writer-prompt-id-rendering.md`**
  — slug: `L099-writer-prompt-id-rendering`. One-paragraph body proposal:
  "Decision: writer-prompt ID rendering is decoupled from system-state ID
  rendering. Traceability IDs remain mandatory across DB, telemetry,
  proposals, evals, and audit logs. Inside the prose-writer prompt, raw
  IDs are an A/B-gated rendering choice, not a default. The
  `writerCapsuleIdRenderingV2` flag toggles Cluster-1 prose-writer render
  sites between raw-ID (Arm A) and semantic-text (Arm B) modes; promotion
  requires parity-or-better on drift, hallucination, obligation coverage,
  and prose quality. Token savings alone do not promote. Trace metadata
  preserves IDs in both arms. Mapper/checker/reviewer/proposal-editor
  prompts continue to render IDs because their schemas require ID echoes;
  this decision does not extend to those classes. See
  `docs/research/id-rendering-audit-2026-05-10.md` for the full audit and
  cluster boundaries."

## Section 6 — Open questions for the operator

1. **Row 14 — chapter-plan-checker fact `[id=…]` decoration.** The
   deviation-emit schema does not carry fact IDs. Is the `[id=…]` line
   load-bearing for the model's task (e.g., disambiguating two
   similarly-worded facts inside one chapter), or is it cosmetic? If
   cosmetic, drop in the Cluster-5 follow-up.

2. **Row 18 — `renderDirectivesForConcept` ID prefixes.** World-builder,
   character-agent, plotter, and planning-extractor receive
   `threadId=`/`promiseId=`/`payoffId=` prefixes via the shared
   `renderStoryThreadSections` helper. They do not emit obligations. Is
   there a use case where one of these concept agents is asked to *name* a
   thread by ID in its output? If not, split the renderer so concept-stage
   directives drop the ID prefixes.

3. **Continuity state-check (row 11).** Is the `characterId` in the user
   prompt body load-bearing for the checker, or is the wrapper's
   exact-name → ID mapping (`resolveCharacterId`) sufficient? If
   sufficient, this is a clean drop. Operator decision because the
   continuity checker is in a different lane (continuity-warning panel)
   and bundling B1 with it would muddy attribution.

4. **Capsule ID lines on Arm B — do you want a hybrid?** Three options for
   the Active-thread/promise/payoff lines on Arm B:
   - **(a) Replace with semantic prose** (current proposal): "Active story
     pressure (this scene must move): - The truth-of-the-folio inquiry —
     Noor is closing on who falsified the ledger."
   - **(b) Suppress entirely** — writer sees only the per-character
     obligation prose, no thread/promise/payoff section.
   - **(c) Keep IDs but rename labels** — e.g. `Active story pressures:
     thread-inquiry, debt-folio, payoff-folio-prediction` is renamed to
     `Active story pressures: …`. This is the weakest A/B because the
     model still sees raw IDs.
   Recommendation: (a). Confirm.

5. **B2 fixture dependency — is `scene-write-fixture-design-2026-05-10.md`
   actually being produced?** The audit assumes a parallel subagent is
   producing it. If not produced, B1 needs to wait for B2 fixture work or
   define a minimal interim fixture (the runtime evidence
   `novel-1778411555121` plus 1-2 hand-authored over-target plans).

6. **Flag-naming — `writerCapsuleIdRenderingV2` ok?** The
   `…ContractV1`/`…WriterV1` naming suggests we should follow the same
   pattern: `writerCapsuleSemanticRenderingV1`? Operator preference.

7. **Scope of trace preservation — confirm.** Arm B preserves
   `WriterCharacterContextTrace` unchanged. The trace persists into
   `pipeline_events` (or wherever the Section 4 telemetry plan lands).
   Confirm that traceability views, eval briefs, and proposal lineage
   queries continue to read from the trace payload and **not** from the
   rendered prompt text. (They should, per current architecture — but
   confirm.)
