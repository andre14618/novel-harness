---
title: Scene-Level Plan/Write Fixture Design (Mixed Set)
date: 2026-05-10
status: design proposal; docs-only, no fixtures wired
---

# Scene-Level Plan/Write Fixture Design (Mixed Set)

This is the operator-review draft for the mixed fixture set that adjusted-B2
calls for in `docs/research/user-adjusted-backlog-2026-05-10.md`. It is the
precondition for adjusted-B3 (scene-contract A/B/C). No fixture files are
authored or wired in this artifact. Code under `src/`, `scripts/`, and `tests/`
is untouched.

## Section 1 — Goals

The fixture set must enable an A/B/C test where the writer's relationship to
scene boundaries is the variable. Per `user-adjusted-backlog-2026-05-10.md`
adjusted-B3 the three arms are:

- **Arm A** — current writer (beat-shaped, no scene contract).
- **Arm B** — current writer + planner-authored scene contract rendered.
- **Arm C** — scene-call writer + planner-authored scene contract.

For that experiment to be load-bearing, the fixture set must:

1. **Surface the live failure mode.** Production today over-expands. The
   2026-05-10 evidence run on `novel-1778411555121` produced 1.89× and 3.03×
   word ratios across two chapters — with `endpointIssues=2`,
   `weakStoryTurnBeats=3`, 11 halluc-ungrounded retries, and 5/11
   stage-2-rescued adherence calls — *while passing approval*. If the fixture
   set doesn't reproduce this profile, the A/B/C test fixes a problem
   different from the one production has.
2. **Admit the inverse.** Slice 2.5's `retry-short-scenes-v1` expansion path
   only fires on undershoot. If we're going to retain that path or compare
   against it under Arm C, at least one fixture has to make the writer
   undershoot. Otherwise that lever is untested.
3. **Hold planner output fixed where possible.** Arm A vs B is meant to
   isolate the contract-rendering effect; Arm B vs C is meant to isolate the
   scene-call writer shape. If planner output drifts between arms, attribution
   collapses. This forces a "frozen plan" fixture profile in addition to
   "concept-only" fixtures — and forces the runner to grow a `--plan-from`
   path (Section 6), because the existing `test-drafting-isolated.ts` only
   supports concept→plan→draft via clone.
4. **Include real production-derived material.** Slice 2.5 ran on synthetic
   fixtures with the wrong ratio profile and produced an inconclusive A/B
   that we then over-interpreted. At least one fixture must come from a real
   runtime plan (`novel-1778411555121` is the obvious candidate — it is the
   same artifact that motivates the lane).
5. **Pre-resolve named entities aggressively.** Plan-assist gates bail under
   `setAutoMode(true)` when the writer coins names not in the world bible /
   character roster. Slice 2.5's treatment arm bailed at chapter 1 for this
   reason. Every fixture should have a roster rich enough that the chapters
   the planner produces are castable from the seed.

The fixture set is small on purpose. v0 is four profiles (P1–P4), not seven.
Each profile must justify itself against the failure mode it surfaces.

## Section 2 — Fixture shape conventions (audit + recommendation)

### 2.1 What `scripts/test-drafting-isolated.ts` consumes today

Read of `scripts/test-drafting-isolated.ts` lines 53–115 and 157–192 confirms:

- The runner's input is a single `--source <novel-id>`, expected to be a
  novel that has already completed concept + planning (it asserts
  `chapter_outlines` rows exist for the novel).
- It clones the source twice via `scripts/variant/clone-for-variant.ts` to
  `<target-prefix>-baseline` and `<target-prefix>-scene-call-v1`.
- It sets `seed_json.pipelineOverrides.sceneCallWriterV1` and
  `seed_json.pipelineOverrides.writerExpansionMode` per arm (UPDATE on
  `novels.seed_json`).
- It calls `runDraftingPhase(novelId)` on each clone and reads
  `chapter_drafts` + `pipeline_events.event_type='writer-expansion'` to score.

So the consumer expects state in two places: the `novels` row (seed JSON,
pipeline overrides) and the `chapter_outlines` rows (a planner result already
written by an upstream phase). It does not read a JSON file at all. There is
**no `--plan-from` flag**; the Opus backlog's references to it (e.g.
`opus-next-experiment-backlog.md` line 122, 152) are aspirational.

### 2.2 Existing fixture conventions in the repo

```
docs/fixtures/
├── approval-policy-replay/        # JSON replay payloads for Phase 7
├── evals/                          # planner-discernment + plan-readiness fixtures
└── method-packs/
    └── commercial-fantasy-adventure-v1/
        ├── frozen-concept.json     # frozen concept input
        └── cohort/
            └── <slug>.json         # one-fixture-per-file cohort entries

src/seeds/
└── <slug>.json                     # tiny concept seeds: premise/genre/chapterCount/characters
```

Two clean precedents:

- **Concept-level fixtures** live as JSON files with a defined surface
  (`saltglass-curse.json` in `commercial-fantasy-adventure-v1/cohort/` is the
  reference; it carries `concept`, `protagonist`, `characters`, `worldFacts`,
  `storyDebts`, `strategyPacket`).
- **Concept seeds** live at `src/seeds/<slug>.json` (e.g. `fantasy-healer.json`
  is six fields: `premise`, `genre`, `chapterCount`, `characters[]`).

Neither convention covers a frozen planner output (chapter outlines + state
mapper output + scene-contract fields where they exist). The closest analog
is the `corpus-recreation-poc` artifact directory layout under
`output/corpus-recreation-poc/<run-name>/` — but those are runtime outputs,
not curated fixtures.

### 2.3 Recommendation

**Match existing concept-level conventions for P1, P2, P3. Extend with a new
`frozen-plan/` layout for P4 only.** Rationale:

- The runner is plan-shaped already. P1–P3 fixtures are seed-level concepts
  the runner re-plans every time the harness boots. That matches today's
  contract.
- P4 needs a frozen plan to honor adjusted-B3's "hold planner output fixed
  across arms where possible" rule. The cheapest way is to add a
  `frozen-plan/` directory carrying a serialized `chapter_outlines.outline_json`
  payload and a hydration script that writes it directly into the DB
  alongside a generated novel row. The hydration step is a small follow-up
  ticket (Section 6); it is **not** in this artifact.

Proposed layout (no files created in this artifact):

```
docs/fixtures/scene-first/                    # NEW root
├── README.md                                 # operator-readable index
├── concepts/
│   ├── over-target/
│   │   ├── fantasy-healer-anchor.json        # P1 #1 — fantasy-healer profile
│   │   ├── ...                               # P1 additional fixtures
│   ├── undershoot/
│   │   ├── ...                               # P2 fixtures
│   └── pre-resolved/
│       ├── ...                               # P3 fixtures
└── frozen-plan/
    └── novel-1778411555121-ch1-ch2/          # P4 — derived from real runtime
        ├── concept.json                      # the input seed
        ├── chapter-outlines.json             # frozen planner output rows
        ├── world-bible.json                  # frozen concept artifacts
        ├── character-profiles.json
        └── trace.md                          # provenance: which run, which exp_id
```

Each concept-level file matches the existing `saltglass-curse.json` field
shape with additional `fixture_metadata` block (Section 3 skeletons). Frozen
plans use the persisted `chapter_outlines.outline_json` schema as their
authoritative shape — the schema already exists
(`persistedChapterOutlineSchema` in `src/agents/planning-plotter/schema.ts`).

## Section 3 — The four fixture profiles

Note on counts: each profile entry below describes **the profile**, not the
file count. v0 needs at minimum 1 fixture per profile to anchor the A/B/C
test. The operator should decide multiplicities in Section 7 Q1.

---

## Profile P1: Over-target current failure shape (PRIMARY)

### Purpose

Reproduce the live runtime failure. If the A/B/C test doesn't move on this
profile, the lane is fixing a different problem than the one production
exhibits.

### Source

Hand-derived from `output/novel-1778411555121` (the 2026-05-10 evidence run).
Concept stays close enough to fantasy-healer that the same drift mechanisms
fire — but is *not* identical so we don't conflate "P1 reproduces" with
"P1 is fantasy-healer with new noise."

### Content shape

| Field | Target |
|---|---|
| Chapters | 2 |
| Target words / chapter | 1500–1800 (matches fantasy-healer ch1/ch2) |
| Beats / chapter | 5–6 |
| POV | single, third-limited |
| Genre | epic-fantasy, ethics-in-war |
| Cast size | 3 named in seed (protagonist + foil + antagonist), 0 walk-ons |
| Setting | military camp, single location per chapter |
| Premise complexity | high — central conceit (transferable wounds / equivalent) requires per-scene operationalization |

The premise must be a *pressure-system concept that scales bad* — i.e. each
deployment of the conceit invites further dramatization. That's the
mechanism behind 3.03×: a wound transfer scene takes 90 lines because every
beat ("she presses the wound", "the prisoner gasps", "the phantom ache settles")
licenses another beat.

### Required pre-conditions

- Seed includes 3 named characters with role/voice/drives/fears.
- Seed includes 0–1 named locations; chapters live inside them.
- Seed deliberately omits a named field-command sergeant, an enemy officer,
  a quartermaster — *the same casting gap that produced 10 coined names in
  novel-1778411555121*. P1 reproduces that gap on purpose.
- threadId / promiseId / payoffId substrate: empty in the seed, just like
  fantasy-healer. The planner-mapper will produce `threadId=0/promiseId=0/payoffId=0`
  on obligation rows. That's the data shape we need to test against.
- Scene-contract fields (`goal/opposition/turningPoint/...`) on outline
  scenes: planner-authored when the planner can produce them, null elsewhere.
  P1 specifically tests "what does Arm B do when 4 of 9 fields are
  populated and 5 are null" — graceful degradation is the design.

### Expected current behavior (Arm A baseline)

Per harness.log lines 19–52 of `novel-1778411555121`, the fantasy-healer
baseline produced:

- Word ratio 1.89× (ch1) and 3.03× (ch2)
- 11 halluc-ungrounded retries naming new officers (Captain Aris, Sergeant
  Vell, Captain Ren, Captain Lorn, Harrel, Elsabet, Tomas, Colonel Vex,
  Captain Laren, Denner)
- 5/11 stage-2 adherence rescues on stage-1 false negatives
- 1 chapter-2 plan deviation caught by chapter-plan-checker (Voss-transfers-
  to-Sylvie escalation that the writer ad-libbed)
- Cross-chapter motif repetition: the "She stands. Her back protests"
  cavalryman-aches sentence appears 3 verbatim times in chapter 1 and a
  variant in chapter 2; Jien's counted-numbers ("Seventeen", "Twenty-three"
  etc.) carries chapter 1 and seeds the chapter-2 assassination foreshadow.

Arm A on P1 should reproduce ≥3 of these 5 signals on a single 2-chapter
run. If it doesn't, the fixture is too synthetic and needs a richer central
conceit before it qualifies as P1.

### Diagnostic the fixture exposes

- **Word-ratio variance** (adjusted-B3 metric): is the over-expansion stable
  across arms? P1 is the load-bearing fixture for "does scene contract
  contain expansion?"
- **Halluc-ungrounded retry rate**: P1's casting gap forces the writer to
  fill structural under-specification with names; do contracts reduce that
  pressure?
- **Cross-scene motif repetition** (informal — operator side-by-side rather
  than judge): does Arm B/C give the writer enough distinct dramatic content
  per scene to stop reaching for the same image?
- **Chapter-2 plan deviation**: does Arm B's contract anchor the writer to
  the actual plan, vs. Arm A's beat-blob letting the writer ad-lib a more
  dramatic premise?

### Seed example (skeleton, not a real fixture)

```jsonc
{
  "fixture_metadata": {
    "profile": "P1-over-target",
    "expected_baseline_ratio": ">=1.5",
    "expected_baseline_failures": [
      "halluc-ungrounded retries on writer-coined officers >= 5",
      "stage-2 adherence rescues >= 2",
      "cross-chapter motif repetition observable",
      "endpoint-landing weak on at least one chapter"
    ],
    "derived_from": "novel-1778411555121 (2026-05-10 evidence run)",
    "casting_gap_intentional": true,
    "scene_contract_population_target": "4 of 9 fields per scene"
  },
  "concept": {
    "premise": "<a pressure-system fantasy concept whose central conceit invites scene-by-scene re-dramatization, structurally analogous to fantasy-healer's wound-transfer mechanic; e.g. 'a debt-binder who can move financial ruin between people'>",
    "genre": "epic-fantasy",
    "chapterCount": 2,
    "characters": [
      { "name": "<protagonist>", "role": "protagonist", "description": "<voice + drive + fear + the cost they pay for using the conceit>" },
      { "name": "<foil>", "role": "supporting", "description": "<single-character witness who treats protagonist as person; counts beats; foreshadow vector>" },
      { "name": "<antagonist>", "role": "antagonist", "description": "<dying / pressured authority figure offering the moral choice; not a tyrant, structurally>" }
    ],
    "worldFacts": [
      "<the conceit's mechanical rule>",
      "<the cost the protagonist pays>",
      "<the no-self-target constraint that the writer in P1 baseline will be tempted to violate via crisis-escalation>"
    ]
  },
  "pre_resolved_entities": {
    "officers_named_in_seed": [],
    "casting_gaps_intentional": ["field-command-sergeant", "enemy-officer-for-transfer-target", "quartermaster"]
  },
  "scene_contract_target": {
    "fields_populated": ["goal", "valueIn", "valueOut", "povPersonalStake"],
    "fields_null": ["opposition", "turningPoint", "crisisChoice", "outcome", "consequence"]
  }
}
```

The `fixture_metadata.expected_baseline_ratio` and
`expected_baseline_failures` are the **operator's verdict on whether the
fixture is doing its job**. If a calibration pass on Arm A produces ratio
<1.3 or skips the named-entity-coining failure, the fixture is too tame and
P1 needs a sharper conceit or thinner cast.

---

## Profile P2: Undershoot shape

### Purpose

Surface the inverse failure mode and exercise the
`writerExpansionMode="retry-short-scenes-v1"` path that Slice 2.5 was
nominally designed to test (and which 0 events fired on). P2 also serves as
the diagnostic for adjusted-B3's Arm B vs Arm C comparison: if Arm C's
scene-call writer can't extend an undershooting scene to its declared word
target while staying coherent, Arm C's architecture shift isn't a win.

### Source

Hand-authored to deliberately produce a thin draft. Mechanism: a concept
where the conflict is internal-deliberation-heavy, the cast is small, the
setting is single-location-static, and the chapter targets are aggressive
(2000+ words) — i.e. the writer reaches the end of the dramatic content
fast and stops, not because it's been told to but because it has nothing
else to say.

### Content shape

| Field | Target |
|---|---|
| Chapters | 2 |
| Target words / chapter | 2000 (deliberately aggressive) |
| Beats / chapter | 3–4 (deliberately sparse) |
| POV | single, third-limited |
| Genre | low-action — diplomatic, archive-bound, contemplative |
| Cast size | 2–3 named, mostly the protagonist alone |
| Setting | single location, static |

### Required pre-conditions

- Roster fully pre-resolved — the failure mode is *under-production*, not
  name-coining. If P2 also bails on plan-assist gates, signal is
  contaminated.
- Scene-contract fields present and complete (≥7 of 9 fields). P2 tests
  whether a *fully populated* contract can drive expansion when the writer's
  baseline pressure is to stop early.
- threadId / promiseId / payoffId: at least one promise opened in chapter 1
  with payoff explicitly deferred to chapter 2, so adjusted-B5's
  obligation-coverage metric has something to land on.

### Expected current behavior (Arm A baseline)

- Word ratio ≤0.85 — chapters undershoot.
- 0 halluc-ungrounded retries (clean roster).
- writer-expansion events: this is exactly the path Slice 2.5 expected to
  fire and didn't. P2's whole point is that it *should* fire here. If Arm A
  on P2 produces 0 expansion events, the fixture failed at its job and needs
  re-authoring.
- No structural drift; the prose is just thin.

### Diagnostic the fixture exposes

- **Expansion ratio under contract guidance** (Arm B vs C): does a populated
  scene contract give Arm C enough material to legitimately reach target
  word count, or does it just produce padded prose?
- **Obligation coverage at undershoot**: are obligations less likely to be
  satisfied when the writer underproduces? P2 is the cleanest test of this
  because there's no hallucination noise on top.
- **Quality at length**: operator side-by-side on Arm C's expanded scenes —
  is the expansion dramatically earned (real new content) or filler?

### Seed example

```jsonc
{
  "fixture_metadata": {
    "profile": "P2-undershoot",
    "expected_baseline_ratio": "<=0.85",
    "expected_baseline_failures": [
      "underproduction in both chapters",
      "0 halluc-ungrounded retries (clean roster)",
      "writer-expansion events expected to fire under expansion mode"
    ],
    "scene_contract_population_target": "7+ of 9 fields per scene"
  },
  "concept": {
    "premise": "<a low-action contemplative concept; e.g. 'an archivist deciphers a single contested document while the building is sealed'>",
    "genre": "literary-fantasy",
    "chapterCount": 2,
    "characters": [ "<protagonist>", "<one foil>", "<one offstage authority>" ],
    "targetWordsPerChapter": 2000
  },
  "pre_resolved_entities": {
    "officers_named_in_seed": "n/a",
    "casting_gaps_intentional": []
  },
  "scene_contract_target": {
    "fields_populated": "all 9",
    "fields_null": []
  }
}
```

---

## Profile P3: Pre-resolved NPC / casting shape

### Purpose

Test whether the architecture works *when inputs are clean*. P1 tests the
failure case; P3 tests whether the contract-rendering arms have somewhere to
land when nothing is fighting them. If Arm B beats Arm A on P1 but not on
P3, the contract is masking a different problem than the one we think it's
solving.

P3 is also the cleanest test of attribution: any quality lift on P3 between
arms is *unambiguously* attributable to scene-contract rendering, because
hallucination-suppression and plan-assist-gate noise are eliminated.

### Source

Hand-authored, lifting structure from `saltglass-curse.json` (the
`commercial-fantasy-adventure-v1` cohort entry that has a complete
`strategyPacket`, full roster, full storyDebts). Reuse the rich concept
shape but reduce chapter count to 2 for fast iteration.

### Content shape

| Field | Target |
|---|---|
| Chapters | 2 |
| Target words / chapter | 1500 (calibrated, not aggressive) |
| Beats / chapter | 4–5 |
| POV | single, third-limited |
| Cast size | 5–7 named characters with full profiles |
| World facts | 5+ named with id |
| Story debts / promises | 2+ open at chapter 1, expected payoff in chapter 2 |

### Required pre-conditions

- All officers, NPCs, locations, items the planner could plausibly need are
  pre-named with `characterId`, role, materiality, voice, drives, fears.
- World facts have `worldFactId`s the planner can route obligations against.
- Story debts (promise/payoff pairs) are explicit in the seed so
  `threadId/promiseId/payoffId` can land non-zero on obligation rows.
- Scene-contract fields: planner-authored, expected to populate 6+ of 9
  fields cleanly because all the upstream substrate is present.

### Expected current behavior (Arm A baseline)

- Word ratio close to 1.0 (calibrated targets, rich seed).
- 0 halluc-ungrounded retries.
- Adherence stage-1 false-negative rate within tolerance (≤2/10 beats).
- threadId/promiseId/payoffId non-zero on obligations.
- Endpoint landing semantically clean (seed already declares
  `endingDirection`).

### Diagnostic the fixture exposes

- **Pure contract-rendering signal**: Arm B vs Arm A on P3 isolates the
  scene-contract rendering effect from every other moving variable.
- **Obligation coverage** (adjusted-B5 metric): the seed declares
  `storyDebts`; do Arm B / Arm C land them more reliably than Arm A?
- **Whether contract rendering helps when inputs are clean** — i.e. is this
  layer additive or subtractive on the easy case? Adjusted-B5's "no
  regression" gate runs through P3 most cleanly.

### Seed example

```jsonc
{
  "fixture_metadata": {
    "profile": "P3-pre-resolved",
    "expected_baseline_ratio": "0.9-1.1",
    "expected_baseline_failures": [],
    "scene_contract_population_target": "6+ of 9 fields per scene"
  },
  "concept": {
    "premise": "<saltglass-curse-shaped: pressure-system + protective-bargain + reparation-cost>",
    "genre": "epic-fantasy",
    "chapterCount": 2,
    "characters": [
      { "characterId": "char-protagonist-id", "name": "...", "role": "protagonist",
        "materiality": "...", "voice": "...", "drives": "...", "fears": "..." },
      { "characterId": "char-foil-id", "name": "...", "role": "supporting", "materiality": "..." },
      { "characterId": "char-antagonist-id", "name": "...", "role": "antagonist", "materiality": "..." },
      { "characterId": "char-officer-id", "name": "...", "role": "supporting", "materiality": "..." },
      { "characterId": "char-quartermaster-id", "name": "...", "role": "supporting", "materiality": "..." }
    ],
    "worldFacts": [
      { "worldFactId": "world-conceit-rule", "fact": "..." },
      { "worldFactId": "world-cost-rule", "fact": "..." },
      { "worldFactId": "world-no-self-rule", "fact": "..." }
    ],
    "storyDebts": [
      { "storyDebtId": "debt-promise-1", "promiseText": "...", "expectedPayoffSlotId": "ch2-final-scene" }
    ],
    "strategyPacket": {
      "logline": "...",
      "paragraphSummary": "...",
      "majorReversals": ["...", "...", "..."],
      "endingDirection": "...",
      "protagonistWant": "...", "protagonistNeed": "...",
      "protagonistLie": "...", "protagonistTruth": "...",
      "antagonistPressure": "...",
      "worldPressureRule": "..."
    }
  }
}
```

This is structurally `saltglass-curse.json` with chapter count 2 and the
fixture metadata block prepended. Reusing the existing concept shape is
deliberate: P3 should not introduce a new concept schema.

---

## Profile P4: Real-runtime-derived plan

### Purpose

Reduce the synthetic-test risk that scuttled Slice 2.5. P1 motivates the
profile from runtime evidence; P4 makes one fixture *be* a runtime artifact.
This is the only profile where adjusted-B3's "hold planner output fixed
across arms" rule applies strictly — for P1/P2/P3 the planner replans on
each arm clone (existing `test-drafting-isolated.ts` flow), but for P4 the
plan is already frozen and the runner reads it directly.

P4 also functions as the falsifier for "does this lever generalize beyond
synthetic shapes?" If Arm B/C beats Arm A on P1/P2/P3 but not on P4, the
lever is fixture-specific and not yet production-ready.

### Source

Frozen artifacts from `novel-1778411555121` (the 2026-05-10 evidence run,
experiment 480, central run 839). Specifically:

- The concept seed (`fantasy-healer`) — already exists at
  `src/seeds/fantasy-healer.json`.
- The world bible + character profiles produced by the concept phase —
  persisted in the `world_bibles` and `character_profiles` rows for
  `novel-1778411555121`.
- The chapter outlines produced by the planning phase — persisted in
  `chapter_outlines` rows. Per `harness.log` line 7: 4/5 mapped beats on ch1
  with 6 facts/1 knowledge/1 state, 6/6 mapped beats on ch2 with 9 facts/3
  knowledge/2 state.
- The state-mapper output (already merged into the chapter outline rows).

P4's fixture file is the serialized state of those rows, captured at the
"planning phase complete → drafting" checkpoint (per `harness.log` line
11).

### Content shape

Whatever the runtime produced — fixed and frozen. Quoting the run:

| Chapter | Target | Planned entries | Final words (Arm A baseline) | Ratio |
|---|---:|---:|---:|---:|
| 1 | 1500 | 5 | 2841 | 1.89× |
| 2 | 1800 | 6 | 5456 | 3.03× |

23 obligations across the two chapters, all with `threadId=0/promiseId=0/payoffId=0`
(empty refs are part of the fixture — this is the production-typical state
the lane has to fix in some other slice).

### Required pre-conditions

- Drift-resistance: the fixture is a snapshot. The runner that consumes it
  must restore the rows to a known DB state and not re-plan. This means a
  fixture-loading helper has to be added (Section 6 — explicitly outside
  this artifact).
- Trace transparency: the fixture must carry `provenance` fields naming the
  source novel id, run id, experiment id, harness commit SHA, and
  pipelineOverrides at the time of capture. Otherwise we lose the ability
  to audit "is this still the same shape after we updated the schema?"

### Expected current behavior (Arm A baseline on the frozen plan)

The 2026-05-10 production run *is* Arm A's expected behavior. Re-running Arm
A against P4 should produce within tolerance of 1.89× / 3.03× word ratios,
the same halluc-ungrounded retry distribution, the same chapter-2 plan
deviation. Not byte-identical (writer is non-deterministic at temperature
>0), but distributionally close.

### Diagnostic the fixture exposes

- **Held-plan attribution** (the strict version of adjusted-B3): with planner
  output literally frozen, any quality difference between arms must come from
  the writer-side change. P4 is the only profile where this attribution is
  rigorous.
- **Production-shape generalization**: P1/P2/P3 are hand-shaped synthetic
  fixtures. P4 is what the harness actually produced. If the lever works on
  P4, it works on something that survived the live planner end-to-end.
- **Backfit risk**: if Arm B's improvement on P4 is much smaller than on
  P1, the synthetic over-target shape we built into P1 may have been *too*
  on-the-nose for the contract to fix and the lift on P1 is partly fixture
  fit, not method fit.

### Seed example (skeleton, not a real fixture)

```jsonc
// docs/fixtures/scene-first/frozen-plan/novel-1778411555121-ch1-ch2/concept.json
{
  // verbatim copy of src/seeds/fantasy-healer.json
}

// docs/fixtures/scene-first/frozen-plan/novel-1778411555121-ch1-ch2/chapter-outlines.json
{
  "fixture_metadata": {
    "profile": "P4-real-runtime",
    "source_novel_id": "novel-1778411555121",
    "source_central_run_id": 839,
    "source_experiment_id": 480,
    "captured_at": "2026-05-10T11:15:55Z",  // post-planning checkpoint
    "captured_against_commit": "<commit-sha-at-2026-05-10-run>",
    "pipeline_overrides_at_capture": {
      "nativePlanningContractV1": true,
      "writerContextMode": "thread-character-context-v1",
      "scenePlanContractV1": false,
      "sceneCallWriterV1": false,
      "writerExpansionMode": "off"
    }
  },
  "outlines": [
    {
      "chapterNumber": 1,
      "title": "The Wound That Cannot Be Healed",
      "chapterId": "<frozen>",
      "povCharacter": "Sylvie Dunmore",
      "povCharacterId": "<frozen>",
      "setting": "...",
      "purpose": "...",
      "targetWords": 1500,
      "scenes": [
        // verbatim from chapter_outlines.outline_json — 5 entries with sceneId,
        // beat description, characters[], obligations{}, valueShifted, gapPresent,
        // lifeValueAxes[], etc. scene-contract fields (goal, opposition, ...)
        // are null because scenePlanContractV1=false at capture time.
      ],
      "establishedFacts": [ /* 6 entries */ ],
      "characterStateChanges": [ /* 1 entry */ ],
      "knowledgeChanges": [ /* 1 entry */ ]
    },
    {
      "chapterNumber": 2,
      "title": "The General's Equation",
      // ... 6 scenes, 9 facts, 3 knowledge, 2 state
    }
  ]
}

// docs/fixtures/scene-first/frozen-plan/novel-1778411555121-ch1-ch2/world-bible.json
// docs/fixtures/scene-first/frozen-plan/novel-1778411555121-ch1-ch2/character-profiles.json
// docs/fixtures/scene-first/frozen-plan/novel-1778411555121-ch1-ch2/trace.md
```

The `fixture_metadata` block is the load-bearing addition. It is also the
cleanest answer to the question "is this fixture stale?" — re-capture is
needed when the schema or the planner pipeline changes such that the rows
won't round-trip.

The frozen plan as captured *will* have empty
`threadId/promiseId/payoffId` and *will* have null scene-contract fields.
That is correct — adjusted-B3's Arm B's deterministic-fallback path is
what populates those fields at writer-render time, working from the
frozen mapper output. P4 is meant to surface "what does Arm B do when it's
asked to derive contract fields from a real production-typical empty
substrate?", not "what does Arm B do when the substrate is helpfully
populated."

## Section 4 — Coverage matrix

The matrix below names which profiles inform which arm comparisons in
adjusted-B3 (Arm A = current writer; Arm B = current writer + scene
contract; Arm C = scene-call writer + scene contract).

| Profile | Stresses Arm A vs B? | Stresses Arm B vs C? | Primary metric |
|---|---|---|---|
| P1 over-target | **Primary** — the live failure profile; if B doesn't beat A here the lever is wrong-target | Secondary — does scene-call shape suppress over-expansion better than beat-shaped writer with contract? | Word-ratio variance reduction; halluc-ungrounded retry-rate reduction |
| P2 undershoot | Secondary — undershoot is a different mechanism; B's contract may help by giving the writer dramatic content to expand into | **Primary** — `retry-short-scenes-v1` only fires under sceneCall+expansion mode; P2 is where Arm C's expansion path is live | Expansion-event count; obligation coverage at length; operator preference on whether expansion is earned |
| P3 pre-resolved | **Primary** — clean attribution; the only profile where any A→B delta is unambiguously contract-rendering | Secondary — Arm C should still match or beat Arm B; if it regresses on P3 the scene-call shape is masking something | Operator side-by-side preference; obligation coverage; no-regression check |
| P4 real-runtime | **Validation** — generalization check; lift on P4 confirms P1's lift wasn't fixture-shape-specific | **Validation** — same role for B vs C | All adjusted-B3 metrics, but at lower N (single fixture) — this is a generalization probe, not a primary signal |

The headline: **P1 and P3 are load-bearing for adjusted-B3's Arm B
promotion decision. P2 is load-bearing for the C-over-B verdict. P4 is the
generalization gate that prevents over-fitting.** If any of P1 / P3 isn't
authored, the central decision is under-tested. If P2 isn't authored, the
"is C worth the architecture cost?" question can't be answered. If P4
isn't authored, we ship on synthetic-only evidence — the same failure
mode Slice 2.5 hit.

## Section 5 — What NOT to include in v0

The following fixture shapes are deliberately excluded from v0. Each is
plausibly useful eventually; including any of them now risks expanding the
fixture set past where signals stay interpretable.

1. **Multi-POV chapters.** Adds a confound: a multi-POV failure could be
   POV-routing (a different layer entirely) rather than scene-contract.
   Single-POV across all profiles keeps the writer-side change as the
   variable.

2. **Romance B-plot / multi-arc threading.** Threading arc continuity is a
   layer-A problem (concept/spine), not a layer-B problem. Including a
   romance-B fixture invites "Arm C beats Arm B because of better arc
   coherence" attribution that is downstream of the scene-call shape.

3. **Magic-cost / world-rule stress test.** This is C2 in the user-adjusted
   backlog and was explicitly dropped (Conflict C4 in
   `opus-next-experiment-backlog.md`). Including it as a fixture re-opens
   the magic-cost-ledger question we resolved by deferring.

4. **Mystery / clue-ledger fixture.** Same logic — this is part of one of
   the 7 method packs that were deferred. The fixture set should not become
   the testbed for parked method-pack work.

5. **Long-form (≥5 chapter) fixtures.** v0 fixtures are 2 chapters. Two
   chapters is enough to surface chapter-2 drift (P1's chapter-2 plan
   deviation in the runtime evidence) and obligation continuity across
   chapters. Five-chapter fixtures multiply API cost without adding
   discriminating signal in v0. Re-evaluate after adjusted-B5 closes.

6. **YA / cozy / non-fantasy genres.** `project_fantasy_genre_focus` memory
   pins commercial focus on fantasy + gamelit. Diversifying genre at
   fixture-shape v0 is exactly the cross-pack diagnostic that
   `opus-overbuild-critique.md` pushes back on (P3+P4+P6 in the
   over-build critique).

7. **Adversarial / edge-case fixtures.** "What happens when seed is empty",
   "what happens when target is 100 words", "what happens with 0 named
   characters" — these are unit-test-shaped, not A/B-shaped. They belong
   under `tests/` if they belong anywhere. They specifically should not
   live alongside P1–P4 because including them creates a "fixtures are
   tests too" pattern that contaminates evidence-gathering with regression
   testing.

8. **Variants of P1 with different conceits** (e.g. "transferable debts",
   "transferable curses", "transferable hauntings"). Tempting because each
   is a candidate over-target shape, but v0 needs *one* anchor on P1 not
   four. Multiplicity within a profile invites cherry-picking the variant
   that reproduces the failure most cleanly.

## Section 6 — Wiring proposal (non-binding)

This artifact does not wire fixtures. The wiring proposal below exists so
the operator can review *what wiring would entail* before committing to v0.

### Where fixtures live

```
docs/fixtures/scene-first/
├── README.md
├── concepts/
│   ├── over-target/
│   ├── undershoot/
│   └── pre-resolved/
└── frozen-plan/
    └── <novel-id>-<chapter-range>/
```

`docs/fixtures/scene-first/` is a new root under the existing
`docs/fixtures/` tree. The naming mirrors `docs/fixtures/method-packs/<id>/`
so the convention is consistent. Concepts are flat per-profile JSON files
(matching `saltglass-curse.json` shape with `fixture_metadata` prepended).
Frozen plans are directories carrying multiple JSON files.

### How they'd be loaded into `scripts/test-drafting-isolated.ts`

Today the runner takes `--source <novel-id>`. To consume the new fixtures,
the runner would need (in priority order):

1. **`--concept-fixture <path>` flag.** Reads a P1/P2/P3 concept-level JSON
   file, creates a fresh novel row, writes the fixture's seed into
   `seed_json`, then runs the full concept → planning → drafting flow per
   arm. Replanning happens per-arm because the planner is part of the
   concept-level pipeline; if Arm A's plan ≠ Arm B's plan, that's an
   expected variance the existing `--source <novel>` clone path already
   has and accepts. (Strict plan-fixity is reserved for P4.)

2. **`--frozen-plan <fixture-dir>` flag.** Reads a P4 frozen-plan directory,
   creates a fresh novel row, hydrates `world_bibles`, `character_profiles`,
   `chapter_outlines` rows directly from the fixture, marks the novel
   `phase='drafting'`, and runs only `runDraftingPhase` per arm. **This is
   the only path that holds planner output fixed across arms.** It's
   structurally identical to the existing `--source <novel-id>` path —
   `--source` already hydrates from a planning-done DB row — but it sources
   from a fixture file instead.

3. **`--writer-arms` extension to add the third arm.** Today the runner
   takes `baseline` and `scene-call-v1`. Adjusted-B3 needs a third arm:
   `contract-render-only` (current beat-shaped writer + contract rendered).
   That arm sets `sceneCallWriterV1=false` + a new override to force
   `renderSceneContract` to be called at write time anyway. The flag for
   this doesn't exist yet — Arm B needs a new pipeline override, e.g.
   `forceRenderSceneContractWhenAvailable: true`.

### Minimum runner change the operator would need

- One new flag (`--concept-fixture` or `--frozen-plan`) plus the loader
  helper; ~50–100 LOC under `scripts/test-drafting-isolated.ts` plus a
  small DB-hydration helper.
- One new pipeline override (`forceRenderSceneContractWhenAvailable` or
  similar) gated to default-off and only consumed by the runner.
- An extension of `--writer-arms` enum to admit
  `contract-render-only`.

This is **a proposal, not work** — none of it is in scope for this artifact.
The operator decides whether to spec these as separate tickets after
reviewing the fixture design.

## Section 7 — Open questions for the operator

Six questions for operator review before fixtures are authored.

**Q1 — Multiplicity per profile.** v0 says "at minimum 1 fixture per
profile." Should P1 and P3 carry more than 1 to give the A/B/C test
variance, or is 1-per-profile sufficient and we trade fixture-count for
chapter-count (e.g. 1 P1 fixture × 2 chapters = N=2 paired observations vs.
3 P1 fixtures × 2 chapters = N=6)? Statistically the latter is stronger
but adds 6× authoring time. Recommendation: 1 each for P2, P3, P4; 3 for P1
(it's the load-bearing fixture for the lane's central decision).

**Q2 — P4 freezing scope.** Should P4 freeze `novel-1778411555121` exactly
(including the empty `threadId/promiseId/payoffId` substrate) or normalize
trace fields first (e.g. zero out `chapterId`, `sceneId` so they're
fixture-stable across re-hydrations)? Exact preserves provenance; normalized
makes the fixture round-trip cleanly across DB resets. Recommendation:
preserve substrate (including empty refs), normalize only telemetry IDs
that the harness re-mints on hydrate.

**Q3 — P1 conceit derivation.** Is it acceptable for P1 to be a structural
twin of fantasy-healer (different premise, same pressure-system shape) or
should P1 be a literally-different-genre fantasy concept that just produces
the same over-expansion behavior via a different mechanism? Twin is easier
to author but invites "you basically just renamed fantasy-healer";
different-genre is more honest but harder to calibrate. Recommendation:
twin for v0 (cheap, anchored), expand to a non-twin in v0.5 if the lift
generalizes.

**Q4 — Pre-resolution depth for P3.** How rich is "pre-resolved enough"?
The `saltglass-curse.json` fixture has 3 named supporting characters; the
fantasy-healer chapters needed ~10 walk-on names that the writer coined.
Should P3 over-resolve (10+ named characters with profiles, more than the
chapters can plausibly use) or right-size to "just enough" (5–7)?
Over-resolving makes the fixture more robust; right-sizing keeps planner
context manageable. Recommendation: right-size to 5–7 — over-resolution
introduces a different confound (writer leans on supplied characters more
than on plot).

**Q5 — Whether P2 needs to be hand-tuned to actually undershoot.** The
fantasy-healer baseline overshoots dramatically. Producing reliable
undershoot behavior on V4 Flash may require multiple authoring iterations
(low-action concept, sparse beats, aggressive target). Is the operator
willing to fund 3–4 calibration runs per P2 candidate to find one that
reliably undershoots, or should P2 be deferred until adjusted-B3 has a
preliminary verdict on P1+P3+P4 alone?

**Q6 — Wiring sequence.** The wiring proposal in Section 6 implies three
runner changes (`--concept-fixture`, `--frozen-plan`, third-arm support).
Should these be specced as one ticket or three? One is operationally simpler
but bundles three concerns; three is the standard repo discipline (one
concern per commit, single-lever) but takes longer to clear. Recommendation:
three tickets, in the order P3-then-P1-then-P2-then-P4 as fixtures get
authored, so the runner change lands one capability at a time.

---

**End of design.** No fixtures authored, no code modified, no tests added.
The operator's review of Section 3 skeletons + Section 7 questions is the
gate to proceed with authoring v0.
