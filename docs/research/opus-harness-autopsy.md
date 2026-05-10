---
job: 1
title: Harness Failure Autopsy
date: 2026-05-10
model: opus
status: draft (decision artifact, not promotion-ready)
---

# Harness Failure Autopsy

## 1. Executive Summary

The harness produces fluent, sentence-level-clean prose that is unmistakably AI: every sample chapter reads as a competent first draft, and almost every sample chapter fails at the same load-bearing scale — the **scene as a unit of dramatic change**. Sentences are clean (the writer system prompt is the most disciplined artifact in the repo); paragraphs are well-anchored in sensory detail; but scenes do not turn, chapters do not commit, and the engine that should be producing causal pressure between scenes is not actually wired into the writer's input. Existing diagnostic evidence already names this — the planner-discernment work calls it endpoint landing, world-fact pressure, motivation specificity, and relationship delta — but the harness has not yet routed those findings into the writer's prompt or into a checker the writer fears.

**Top three failure modes (full evidence under §3 / §4):**

1. **L1 → L2 contract gap on dramatic shape.** The planner emits a beat list keyed off "what changes dramatically in this beat — NO dialogue, NO quoted speech" plus optional Sanderson-MICE / value-charge tags. The runtime default mapper produces obligations keyed to facts/knowledge/state continuity (`mustEstablish`, `mustTransferKnowledge`, `mustShowStateChange`). What the writer never sees, in the default beat-shaped path: scene goal, scene opposition, turning point, crisis choice, value polarity, observable consequence, POV personal stake. These fields are defined (`SceneContractBlock`, `causal-motivation-v3`) but live behind `scenePlanContractV1` / `sceneCallWriterV1` flags that are default-off, advisory-only, and on a runtime path the 2026-05-10 evidence run does not exercise.

2. **Writer is asked to police craft rules the planner never set up.** `prose-writer-system.md` is encyclopedic about what *not* to do (no filter words, no AI clichés, no "let out a breath", no electricity-as-tension metaphor) and prescriptive about Goal → Conflict → Disaster. But the per-beat context the writer actually receives (`beat-context-render.ts`) gives it: a 1–2 sentence beat description, a transition bridge, character voice cards, character context capsules, and obligation lists keyed to facts/knowledge/state. There is no Goal/Conflict/Disaster, no scene turn, no value polarity in the default rendered prompt. The writer is being asked to dramatize a structure that wasn't planned at the dramatic level.

3. **Checker layer optimizes the wrong thing.** The five active checkers (chapter-plan-checker, halluc-ungrounded, continuity, functional-state, plus deterministic validation) measure: setting match, emotional-direction match, named-entity grounding, fact contradiction, and planned-state coverage. None of them measures "did the scene turn?", "did the chapter end on consequence?", "did the protagonist make a choice under pressure?". The checker layer is a hallucination/continuity firewall, not a story-quality gate. The 2026-05-10 evidence run reports `endpointIssues=2` and `weakStoryTurnBeats=3` but these are deterministic warnings the writer never sees and no checker enforces.

**Top three recommendations (full structured form under §5):**

1. **R1 — Promote scene contract into the default writer prompt path** (not a new flag, the actual default). The L097 `SceneContractBlock` already exists; flip the planner mapper to populate it from existing beat descriptions + value-charge agent output, render it unconditionally as the writer's primary structural brief, and demote the current beat description to a hint. Cost: $0 (deterministic mapping). Risk: contained — the writer prompt already accommodates the block, and the existing scene semantic review judge is the falsifier.

2. **R2 — Add a "scene turn" deterministic-then-LLM checker that fires on the *prose*, not the plan.** Current checkers check whether the prose adheres to the plan; they do not check whether the prose dramatizes a turn. Wire the existing planner-discernment-calibration scene-dramaturgy / endpoint-landing labels (already calibrated to 100% exact on known-answer fixtures) onto generated prose at chapter-end. Failure routes to the existing rewrite path. Same one-excerpt/one-dimension shape that survived the Plan-A bias collapse. Cost: ~$0.02/chapter.

3. **R3 — Make the chapter endpoint a hard plan field, not narrative purpose.** `chapter-outline-system.md` already says "NEVER close a chapter on pure description" and asks for a forward hook in `purpose`, but `purpose` is one prose blob the writer never sees parsed. Split it into `endpoint_action` (one observable action or decision) and `forward_pressure` (one specific reader question), require both at planner phase, render both into the writer prompt verbatim, and assert on prose at validation that the chapter's last 200 words contain something matching `endpoint_action` semantically. The 2026-05-10 evidence run (chapters 1+2 of fantasy-healer) had two `endpointIssues` flagged on a clean structural plan — this is not an exotic problem, it is the modal failure on routine runs.

---

## 2. Methodology

**Read in full:**

- `CLAUDE.md`; `docs/current-state.md`; `docs/sessions/lane-queue.md`.
- 2026-05-10 runtime drafting evidence; 2026-05-09 scene-first runtime promotion retrospective; 2026-05-09 corpus-structure-recreation POC; 2026-05-08 CFA-v1; 2026-05-07 method-pack cohort; 2026-05-07 planner-discernment calibration.
- `docs/authoring-methodology-hypotheses.md`; `docs/method-packs/commercial-fantasy-adventure-v1.md`; `docs/evals/method-pack-planner-semantic-judge-prompt-v0.md`; `docs/evals/planner-discernment-calibration-v0.md`; `docs/research/writing-frameworks/SYNTHESIS.md` §1–2.7 (top-level convergences).
- Agent system prompts: `planning-plotter/chapter-outline-system.md`; `planning-beats/beat-expansion-system.md`; `planning-state-mapper/state-mapper-system.md`; `writer/prose-writer-system.md`; `writer/beat-writer-system.md`; `writer/beat-context.ts` + `beat-context-render.ts` + `character-context.ts`; `chapter-plan-checker/plan-adherence-system.md`; `halluc-ungrounded/halluc-ungrounded-system.md`; `continuity/fact-check-system.md`; `functional-state-checker/functional-state-checker-system.md`; `structure-promise/promise-open-system.md`; `structure-mice/mice-system.md`; `structure-mckee-gap/mckee-gap-system.md`; `structure-character-arcs/character-arcs-system.md`; `structure-value-charge/value-charge-system.md`; `planning-plotter/schema.ts`.

**Generated outputs sampled (chapter-1 unless noted):**

- `output/semantic-gate-baseline-20260506T135502322-fantasy-system-heretic/chapter-1.md` and `chapter-2.md`.
- `output/semantic-gate-matrix-20260506T203007340-novel-1776702712258-3-control/chapter-1.md` (the bay/Maren chapter).
- `output/semantic-gate-matrix-20260506T203007340-pp2-floor-baseline-fantasy-archive-1776706058578-2-capped5/chapter-1.md` (the Imperial Library chapter).
- `output/semantic-gate-matrix-20260506T203007338-novel-1776702712258-1-capped4/chapter-1.md` (alternate bay/Maren).
- `output/novel-1778411555121/chapter-1.md` (the 2026-05-10 fantasy-healer evidence run).
- `output/corpus-structure-reference/crystal_shard/reference.md` (corpus baseline distribution).

**What I could not verify from artifacts alone:** whether the 2026-05-09 thread-character-context-v1 capsule promotion is in fact rendering for these earlier 2026-05-06 outputs (the change-state doc says it is the production default *as of* 2026-05-09; the sampled outputs predate that); whether `obligationId`/`threadId` flow through the older novels' DB rows; how often the writer hits the L097 retry-short-scenes-v1 expansion path in production. I marked the small number of claims that depend on these as `[unverified hypothesis]` in §3.

---

## 3. Layer-by-Layer Autopsy

### L0 — Premise / Concept

**What the layer is currently doing.** Concept ingestion is not a single agent in the runtime path the 2026-05-10 evidence run exercises. The planner-plotter consumes a world bible, character profiles, and a story spine, and emits chapter skeletons (`chapter-outline-system.md` lines 1–18). For diagnostic work, `commercial-fantasy-adventure-v1.md` defines a "Snowflake-lite strategy packet" with `logline`, `paragraphSummary`, `majorReversals[]`, `endingDirection`, `readerPromise`, `protagonistWant`, `protagonistNeed`, `protagonistLie`, `protagonistTruth`, `antagonistPressure`, `worldPressureRule`. That packet exists as a fixture (`docs/fixtures/method-packs/commercial-fantasy-adventure-v1/cohort/`) but is not consumed by the production planner — the CFA v1 cohort is `HOLD` (mean delta `+0.2`, win rate 50%, endpoint regression 53→44%).

`SYNTHESIS.md` §2.6 names this the single biggest current gap: "the harness jumps from concept agents straight to chapter skeletons. Adding the logline / paragraph / disaster-manifest sub-step is the keystone change."

**What's failing in real generated output.**

- **Sample 1 — `fantasy-system-heretic` ch1.** The chapter is a competent character study of a person hiding a System anomaly. The opening (lines 1–17) is well-executed but the chapter has no concept-level promise paid off; it is one extended interiority pass with two events (the calluses observation, the Arbiter announcement). The reader does not know what the *novel* is yet: is it a corruption tale, a heist, a system-breaking quest, a romance? The concept-level packet — "world rule that creates cost" — is not visible because there is no concept layer that committed to one.

- **Sample 2 — `novel-1776702712258-3-control` ch1 (Maren / bay).** Two completely separate chapter-1 drafts (one 365 lines, the other shorter) for what should be the same novel concept tell two different stories: one about chemical contamination + a fisherman's death; the other adds the protagonist discovering her father authorized the discharges. Both are plausible; neither is the same novel. This is concept drift visible across alleged sibling outputs and confirms the SYNTHESIS observation that *conservation across iterative expansion* is not enforced.

**Failure mode taxonomy.**

- **F-L0-1: No conserved upstream packet.** Logline → paragraph → page → skeleton with disaster-conservation invariants is not a runtime artifact. The planner-plotter's first move is already at chapter-skeleton granularity.
- **F-L0-2: Genre shape is not a planner input.** `WRITER_GENRE_PACKS` sets writer-side voice but the planner does not select obligatory scenes per genre (`SYNTHESIS.md` §2.7).
- **F-L0-3: Lie/Truth/Want/Need is character-bible data, not a chapter constraint.** The character-arcs agent is a corpus extractor (`structure-character-arcs/character-arcs-system.md`) — it labels published novels' arcs for training data, not the live novel's planner.

### L1 — Planner / Structure Templates

**What the layer is currently doing.**

- **Plotter** (`chapter-outline-system.md`) emits a chapter skeleton: `chapterNumber`, `title`, `povCharacter`, `setting`, `purpose` (1–2 sentences), `targetWords`, `charactersPresent`. It enforces structural priors as soft guidance ("STASIS = DEATH" opening, midpoint reversal, pinch points, whiff of death, try/fail cycles, never close on description). These priors live in the prompt, not in the schema — they are generation-time advice with no validator.

- **Beat expansion** (`beat-expansion-system.md`) takes one chapter skeleton + neighboring chapter skeletons and emits a beat list with: `description` (1–2 sentences, NO dialogue), `characters[]`, `kind`, `valueShifted`, `gapPresent`, `lifeValueAxes[]`, `miceActive`, `miceOpens`, `miceCloses`. Beat count formula: `ceil(targetWords / 400)` floor 3.

- **Structure agents** (promise / mice / mckee-gap / character-arcs / value-charge) — *all are corpus extractors*, not live planner agents. Read their prompts: each one says "this is a corpus-extraction task; your output trains the harness's structural-imitation layer." None of them runs against the in-progress novel during planning by default.

- **Planning-state-mapper** is the load-bearing live structural agent. It assigns chapter-level `establishedFacts` / `characterStateChanges` / `knowledgeChanges` and per-beat obligations (`mustEstablish` / `mustPayOff` / `mustTransferKnowledge` / `mustShowStateChange` / `mustNotReveal` / `allowedNewEntities`). It is *continuity-shaped*, not *dramatic-shaped*: the obligations it emits are about what the prose must mention, not about how a scene must turn.

**What's failing in real generated output.**

- **Sample 3 — `fantasy-system-heretic` ch1 vs ch2 endpoint landing.** Ch1 ends with Maret stepping into the corridor after hearing about the Arbiter ("an ink drop had soaked into the parchment, a permanent black stain at the edge of the column of numbers" → "*I will be what it has always seen. Nothing more, nothing less.*"). The chapter's *purpose* must have committed to a forward hook; the prose lands on an interiority decision, which is what the plotter prompt asks for. But ch2 immediately resolves into the most generic possible follow-through ("Theo offers to forge records; Maret agrees"). There is no reversal, no escalation beyond the linear "next step." That linearity is a planner symptom — the chapter skeleton's `purpose` field is asked to encode "what this chapter does for the story," but with one prose blob and no required `endpoint_action`/`forward_pressure` split, the planner produces causally-adjacent chapter purposes that read like a synopsis.

- **Sample 4 — `crystal_shard` reference distribution vs harness output.** Per `output/corpus-structure-reference/crystal_shard/reference.md`: median scenes/chapter = 4, median beats/scene = 5, median words/scene = 565, median words/beat = 103. The harness default beat formula is `ceil(targetWords / 400)`, floor 3, recommended `ceil(targetWords / 325)`. For a 1500-word chapter that's 4–5 beats, *total*. But the reference corpus has chapters of 1832–6667 words with 4–8 *scenes*, each scene containing ~5 beats — i.e. roughly 20–35 beats per chapter, with beats as ~100-word annotation granularity, not as the writing unit. The harness writer is being asked to expand a beat into 300–450 words (`beat-expansion-system.md` line 25) — exactly the wrong granularity. This is the same finding as the corpus-recreation POC ("scenes are the primary plan/write/check unit; beats remain annotation"), but it has not yet flipped the production default.

- **Sample 5 — Method-pack cohort `endpointLanding`.** CFA v1 vs control showed endpoint landing 53% → 44% (regressed). The deterministic scorer treats endpoint as token overlap; the semantic judge says endpoints land "as a stated decision or mood instead of a concrete action/consequence that creates propulsion." So even the diagnostic agreed: the planner is closing chapters on mood, not on consequence.

**Failure mode taxonomy.**

- **F-L1-1: Beat is the planner unit but not the writing unit.** Sanderson MICE, McKee gap, value-charge — all live as corpus annotations, not as live planner constraints. The planner-beats output's `valueShifted`/`gapPresent`/`miceActive` are soft prior booleans the mapper does not consume.
- **F-L1-2: Chapter `purpose` is one unparsed string.** The plotter prompt asks the model to encode setup/complication/reversal/climax, forward hook, and try/fail context inside `purpose`. This is the wrong shape for downstream consumption — it cannot be validated, cannot be rendered to the writer as a discrete endpoint requirement, cannot be linked to a payoff.
- **F-L1-3: Mapper is continuity-shaped.** `mustEstablish` / `mustTransferKnowledge` / `mustShowStateChange` / `mustNotReveal` cover *what facts must surface in this prose*. There is no `mustTurn` / `mustForceChoice` / `mustLandConsequence` field, so the mapper cannot route scene-dramaturgy into a writer-visible obligation.
- **F-L1-4: Promise/Payoff is annotation, not enforcement.** L093 added `threadId`/`promiseId`/`payoffId` to obligations as advisory refs. The 2026-05-10 evidence run shows `threadId=0`, `promiseId=0`, `payoffId=0` in two-chapter persisted obligations — the substrate exists, the planner is not using it.

### L2 — Scene Contract / Planner-to-Writer Handoff

**What the layer is currently doing.** The contract that flows from planner to writer in the **default runtime path** (the 2026-05-10 evidence run uses this path) is the rendered string built by `beat-context-render.ts`. The sections in order:

1. `BEAT N of M` + POV + Setting + Kind + 1–2 sentence description.
2. `SEEDS` (this beat seeds these payoffs, lands at beat X).
3. `PAYOFFS DUE` (this beat realizes seeds from earlier beats).
4. `BEAT OBLIGATIONS` (mustEstablish/mustPayOff/mustTransferKnowledge/mustShowStateChange/mustNotReveal/allowedNewEntities).
5. `TRANSITION BRIDGE` (last 3 sentences of prior beat).
6. `LANDING TARGET` (first sentence of next beat description).
7. `CHARACTERS:` (Voice/Drives/Avoids/Conflict/State/With POV/Doesn't know/example lines).
8. `CHARACTER CONTEXT CAPSULES` if `thread-character-context-v1` mode is on (Want/Need/Lie/Truth/Drives/Fears/Avoids/Conflict/Voice/State + thread/promise/payoff refs).
9. Resolved references (named entities from the world bible).
10. `READER-INFO STATE` (prior-chapter facts the reader knows).
11. `SETTING` block.

The L097 `SCENE CONTRACT` block (`renderSceneContract` in `beat-context-render.ts`) — which would carry goal/opposition/turningPoint/crisisChoice/choiceAlternatives/outcome/consequence/povPersonalStake/valueIn/valueOut — is **only** rendered if `sceneCallWriterV1=true`. The 2026-05-10 evidence run runs with `sceneCallWriterV1=false` (default). Per the 2026-05-09 retrospective: "L092's 'do not promote scene-satisfaction to blocker' non-goal remains in place; promotion to default-on for any flag requires a separate decision after live evidence" + "Slice 2.5 inconclusive A/B" + "no writer-expansion events fired in either arm."

**What's failing in real generated output.**

- **Sample 6 — fantasy-healer (`novel-1778411555121`) ch1.** The 2026-05-10 evidence run. Word ratio 1.89× for ch1, 3.03× for ch2. Per the session record: "Writer expansion is still the live pressure point. The calibrated entry counts held at 5 and 6, yet final prose landed at 1.89x and 3.03x target. Do not spend the next slice on more beat-count calibration; inspect writer budget/context behavior or scene-call writer evidence instead." The chapter is well-written but bloats around its central conceit (transferable wounds) — the wound-transfer scene takes 90+ lines because there is no scene contract that says "scene closes when transfer is complete + Sylvie has buckled + Jien has caught her." The writer treats every beat as a license to expand.

- **Sample 7 — Maren / bay.** Two consecutive chapter-1 candidates (the `-3-control` and `-1-capped4` versions). The control version contains an entire second mini-chapter inside ch1 — Maren returns from the dock conversation, processes the discharge ledgers, discovers her father's signature on the killing-discharge — that should obviously be ch2 or ch3. The capped4 version stops earlier. Both are technically following beats that say "what changes dramatically." Neither has a scene-level contract that says "scene 1 ends when Maren has logged her first contamination reading and seen the dead fish; scene 2 ends when Gil delivers the death; scene 3 ends when Tess arrives." Without that contract the writer makes its own scene boundaries, which is why one of these chapter-1s is 365 lines and another is 109.

- **Sample 8 — ch1 default beat shape.** The default beat description per `beat-expansion-system.md` line 30: "Each beat description must be 1-2 sentences. Longer descriptions constrain the writer's creative latitude and reduce dialogue in the output." This is a deliberate design choice but it traps the writer: the writer has 1–2 sentences of dramatic context, then ~1500 tokens of *continuity context* (who knows what, fact registries, thread refs, character cards), then is asked to produce 300–450 words of dramatized prose with a turn. The dramatic surface is the smallest part of its prompt.

**Failure mode taxonomy.**

- **F-L2-1: Default writer prompt has no goal/opposition/turn surface.** Scene contract block is flag-gated, default-off, and L097 amendment demoted its validator to advisory because V4 Flash could not reliably comply with the multi-field contract.
- **F-L2-2: Writer cannot tell where the scene begins or ends.** The `BEAT N of M` framing implies one-beat-one-prose-segment, but the writer is producing scene-shaped prose (one scene = several beats per the corpus reference) and chooses its own boundaries.
- **F-L2-3: Forward pressure is absent.** `LANDING TARGET` = first sentence of next beat description. That's a stylistic continuation hint, not a forward-pressure obligation. There is no "scene must end with the protagonist's options narrowed" instruction.
- **F-L2-4: Obligations are about facts, not about pressure.** The five obligation kinds (`mustEstablish`/`mustPayOff`/`mustTransferKnowledge`/`mustShowStateChange`/`mustNotReveal`) are about information continuity. Nothing routes scene-turn or character-choice into a writer-visible obligation.

### L3 — Writer Context Assembly

**What the layer is currently doing.** `buildBeatContextSlots` (`beat-context.ts:223`) is one of the more careful pieces in the repo. It deterministically assembles: beat spec, transition bridge, landing target, character snapshots (with async DB lookups for relationships and per-character state), resolved references, reader-info state (facts established in prior chapters), setting block, optional character-context capsules, and optional scene-contract block. It's all gated, ID-stable, and byte-parity-tested. The **information substrate** the writer receives is genuinely well-engineered.

The assembly is correct. The problem is what it assembles.

**What's failing in real generated output.**

- **Sample 9 — fantasy-system-heretic ch1 lines 64–72.** "She volunteered for nothing, never completed a task early, never produced a folio that could not be explained by patience rather than aptitude. Every movement in her workday had been calibrated to one end: appear unremarkable." This is competent prose that the writer is generating from a beat description like "Maret reflects on years of hiding her abilities in mediocre work" — a 1–2 sentence beat plus the character cards (Voice / Drives / Avoids / Conflict). The character-context capsule would, if fired, additionally inject Want/Need/Lie/Truth. The writer has all this and produces interiority. But what's missing: who is *opposing* her in this beat? What does she *risk* by reflecting? What *changes* by the end? The context layer can hand the writer everything except dramatic shape because the planner did not produce dramatic shape.

- **Sample 10 — character-context capsule overhead.** The `renderCharacterContextCapsules` rendering (`character-context.ts:147–183`) emits `Mode: thread-character-context-v1`, `Scope: beat`, `Chapter ID: ...`, `Beat ID: ...`, `Beat number: N`, `POV character ID: ...`, `Active thread refs:` (potentially empty), `Active promise refs:` (potentially empty), `Active payoff refs:` (potentially empty), then per-card Want/Need/Lie/Truth/Drives/Fears/Avoids/Conflict/Voice/State + obligation refs. This is dense. The L094 evidence said it improves word ratio (0.70 → 0.94 ch1; 0.77 → 0.88 ch2 in the corpus-recreation POC). But the writer is now reading ID metadata in its prompt — `Source obligations: obl-001-ch-001-...`, `Active threads: thread-archive-truth` — that adds tokens and noise without adding dramatic specificity. The IDs are useful for traceability; they should not be in the writer's prompt.

- **Sample 11 — example lines mismatch.** The character snapshots include `exampleLines` (sampled per beat with `pickExampleLineSubset`). When the writer is asked to dramatize a beat the example lines are *style* anchors — they show Maret's voice rhythm. But style is not the live problem; the writer's voice work is fine. This is space the prompt is using for the wrong layer.

**Failure mode taxonomy.**

- **F-L3-1: Context layer is rich on identity, sparse on conflict.** Want/Need/Lie/Truth land in capsules; opposition pressure does not. The capsule's `povPersonalStake` field exists but is null in the evidence run because the planner does not emit it.
- **F-L3-2: ID noise crowds the dramatic surface.** Stable refs (`obl-001-...`, `thread-archive-truth`) are good for traceability. Putting them in the writer's prompt is the wrong layer.
- **F-L3-3: Reader-info state is correctness-shaped, not pressure-shaped.** "Reader already knows X" prevents the writer from re-revealing facts. It does not say "scene must reframe X" or "scene must break a promise X created."

### L4 — Writer Prose Generation

**What the layer is currently doing.** Two writer prompts — `prose-writer-system.md` (whole-chapter) and `beat-writer-system.md` (per-beat) — both instruct the writer toward Goal → Conflict → Disaster scene shape, character-voice fidelity, sensory anchors, no AI clichés (the longest list in the repo: "let out a breath she didn't know she'd been holding", "the silence stretched", "something shifted", "a flicker of [emotion]", "the air between them charged"), no filter words, no electricity-as-tension metaphor, dramatized backstory, dialogue exchange minimums.

**This is the most disciplined craft prompt in the repo.** The writer produces clean sentences as a result. The samples confirm this — there are no electricity-as-tension lines, no "let out a breath" instances I could find across 5 chapters, no `realized/noticed/seemed` filter clusters.

**What's failing in real generated output.**

- **Sample 12 — Library / Noor ch1 lines 60–80 ("Subsection theta-prime terminates at shelf-mark 14-Gamma...").** Excellent voice pressure. But the chapter has the same problem at the prose level as at the planner level: the writer keeps writing because nothing stops it. The character finds the book at line 87, opens it at line 105, reads marginalia at line 107, finds another marginalia at line 127 ("Section 9D-15. That had shifted overnight."), then finds *another* set of marginalia at lines 137–146 ("Collation error in primary sequence..."), then makes the decision to pursue the trail at line 151. This is one scene split across three different reveals each of which a tighter contract would close into separate scenes with separate value polarity moves.

- **Sample 13 — fantasy-system-heretic ch2 lines 109–117.** The interview scene with Cassel pivots cleanly into a Theo conversation: "When she reached her desk, she found Theo waiting, leaning against a shelf, a mug of tea in his hand." The transition is clean prose-craft, but it skips a sequel beat — "Maret's hands trembled despite her effort to still them" cuts directly to the next scene with no reaction-dilemma-decision between them. The writer prompt explicitly asks for a sequel beat but there's no checker that fires when one is missing, and no plan field that would have placed one.

- **Sample 14 — instruction overfitting.** The writer system prompt's filter-word list and AI-cliché list works, but there are downstream costs. The bay-Maren chapter (lines 82–138 of `-3-control/chapter-1.md`) has the protagonist explicitly asking "I'll need the time of death, approximate water temperature at retrieval, and any observations the coroner noted regarding tissue discoloration or lung froth." This is an extreme case of "show specificity" — Maren is specified into a clinical-procedural caricature that does not modulate even when Gil cracks ("A man's dead, girl"). The prompt's "speech pattern is law" rule is being applied so rigidly that the character cannot register emotionally at the moment her own field's authority is challenged. This is craft-rule fundamentalism; the writer is over-applying a rule that should be context-sensitive.

**Failure mode taxonomy.**

- **F-L4-1: Writer keeps writing because nothing closes a scene.** No `wordsAvailable`-style budget per scene contract; no end-of-scene marker the writer can target.
- **F-L4-2: Goal→Conflict→Disaster is in the prompt but not in the input.** The writer is told to structure scenes that way; the beat description does not encode that structure.
- **F-L4-3: Voice rules over-applied.** "Speech pattern is law" prevents emotional modulation at moments of pressure.
- **F-L4-4: Sequel beats are in the system prompt but not enforced.** The writer can skip them and no checker fires.

### L5 — Checker Layer

**What the layer is currently doing.**

- **chapter-plan-checker** (`plan-adherence-system.md`) checks `setting_match`, `emotional_arc_correct` (only fails on REVERSED direction), `pass`, and `deviations[]`. PASS unless setting wrong OR emotional direction reversed OR major plot contradiction. **Excludes from deviations**: paraphrased dialogue, reordered details, added atmospheric detail, slightly different physical actions, missing individual beat events, characters absent from a single beat. Note line 26: "DO NOT flag these as deviations — they are normal creative interpretation: ... Missing individual beat events". Beat omission is *explicitly accepted*.

- **halluc-ungrounded** (`halluc-ungrounded-system.md`) checks named-entity grounding. ~70 lines of careful disambiguation rules between proper nouns / generic descriptors / aliases. This is a strong checker for what it does.

- **continuity** (`fact-check-system.md`) checks for direct contradictions of established facts. Severity guide: blocker / warning / nit. False-positive rules excluded: figurative language, dramatic irony, character lying, vague timeline, metaphor.

- **functional-state-checker** checks whether `establishedFacts`/`knowledgeChanges`/`characterStateChanges` (planned-state) are *supported by the prose*. Returns `established_fact_missing` / `knowledge_change_missing` / `character_state_missing` / `planned_state_contradicted`. Findings are warning-class until oracle-calibrated.

**What's failing in real generated output.**

- **Sample 15 — fantasy-system-heretic ch1 lines 87–90.** "The Scribe's Closet was quiet save for the scratch of quills and the occasional rustle of parchment being turned. Maret kept her eyes lowered, her hand steady as she copied the latest census totals onto the master ledger. One more day. One more test. The words repeated in her mind like a prayer." Then line 89: "The senior clerk pushed through the door without knocking" — but earlier in the same chapter, lines 39–63, the prose has *already* established Maret going through the corridor and arriving at her desk in the main hall ("She continued before he could ask how she had noticed. The main hall opened ahead..."). Lines 87–95 are a *repeat* setup of "she's at her desk in the closet" that contradicts the spatial flow. This is exactly the class of bug the continuity checker should catch — but the contradiction is between two non-fact-shaped statements ("crossed to her desk" vs "the Scribe's Closet was quiet"), not between a planned `establishedFact` and the prose, so it does not trigger.

- **Sample 16 — Library / Noor ch1 lines 132–149.** The marginalia repeats. Lines 107, 137, and 143 all introduce *cross-reference annotations* in the same shape with slightly different content. The narrator says "Her hands trembled against the paper. The words were still drying. Still fresh." (line 119) — this trembling moment lands twice (lines 91, 119) without any state change between them. This is the kind of intra-chapter repetition the harness has a deterministic deduplicator for at the surface-string level, but not at the structural level. None of the active checkers fires.

- **Sample 17 — None of the checkers ask "did the scene turn?".** The 2026-05-10 evidence shows `endpointIssues=2` and `weakStoryTurnBeats=3` were *deterministic flags* — these come from the planner-quality diagnostic, not from a runtime checker against the prose. The scene-semantic-review judge exists (`scripts/evals/scene-semantic-review.ts`) but is diagnostic only, deferred Slice 3.5, "live N≥20 evidence run not in scope."

**Failure mode taxonomy.**

- **F-L5-1: Plan-adherence excludes structural failures by design.** "Missing individual beat events" is explicitly not a deviation. Beat omission cannot be a fail.
- **F-L5-2: No checker measures dramatic shape.** Setting / emotional direction / fact contradiction / planned-state coverage is the universe of checks. Scene turn, choice pressure, value polarity, endpoint landing — none.
- **F-L5-3: Continuity is fact-shaped, not flow-shaped.** Two contradictory spatial-flow statements that are not encoded as `establishedFacts` slip through.
- **F-L5-4: Diagnostic surface ≠ runtime gate.** The planner-discernment, scene-semantic-review, prose-review tools are calibrated and useful; they do not gate prose acceptance.
- **F-L5-5: Functional-state coverage rewards mention, not dramatization.** Per its own prompt, "If a planned item is supported anywhere in the chapter, do not report it as missing." Mention satisfies coverage; the writer can drop a state change in narration ("Maret now knew the Arbiter had reopened her file") and pass coverage without dramatizing it.

### L6 — Evaluator / Judge Layer

**What the layer is currently doing.**

- **method-pack planner semantic judge v0** — blind pairwise A/B with AB/BA swap control. **Failed**: 18/18 position-biased pairs, 0/18 stable wins, 3/3 same-plan calibration pass. Conclusion: do not use for promotion.

- **planner-discernment-calibration v0** — narrow categorical discernment, one excerpt + one dimension + anchored labels. **Worked**: 100% exact at dimension-specific shape across direct-label and evidence-first modes. 11 calibrated dimensions including `characterAgency`, `worldFactPressure`, `endpointLanding`, `motivationSpecificity`, `relationshipDelta`, `characterMateriality`, `causalMomentum`, `sceneDramaturgy`, `promiseProgress`. Pro is not the workhorse; Flash is.

- **corpus-recreation-semantic-review** — same narrow shape, applied to scene prose. The materiality-v1 multi-chapter run reduced semantic-low findings (ch2: 3 lows → 0) without changing writer/checker.

**What's failing.**

- **Sample 18 — Plan-A bias is the dominant signal in pairwise judging.** The 2026-05-07 cohort showed DeepSeek Flash, asked to compare Plan A vs Plan B (which was actually method vs control swapped), picked Plan A 18/18 times regardless of which arm sat in A. This means: pairwise preference is unusable for promotion until a different judge shape, model, or human anchor is in place.

- **Sample 19 — Evaluator can't distinguish fixable-vs-broken on prose.** The planner-discernment dimensions saturate at level 2 on most production planner output. From the real-data pilot: `characterMateriality`: 2.00 / 1.94, `worldFactPressure`: 1.95 / 2.00, `endpointLanding`: 2.17 / 2.28. The dimensions catch broken (level 0/1) cleanly but cannot separate "decent" from "excellent" at the live ceiling. Per the session: "the clearest live weakness is protagonist choice pressure: several chapters have choices that are not tightly linked to concrete cost and consequence."

- **Sample 20 — No oracle calibration.** Functional-state findings are warning-class until oracle calibration. There is no labeled human oracle dataset that a checker has been calibrated against. Without that, even a working LLM judge cannot promote findings to blockers.

**Failure mode taxonomy.**

- **F-L6-1: Pairwise preference is broken.** Position bias dominates DeepSeek's signal on this task.
- **F-L6-2: Narrow categorical works but ceilings out at level 2.** Useful for catching disasters, not for separating good from great.
- **F-L6-3: No human oracle.** Calibration runs against authored fixtures, not against a labeled corpus of harness output.
- **F-L6-4: Evaluator is plan-shaped.** All current calibrated dimensions judge plans. Scene-semantic-review and prose-review are the prose-shaped surfaces, but they are off-default and N is small.

---

## 4. Cross-Layer Failure Patterns

### CL-1: Dramatic shape is corpus-extractor data, not live-planner constraint.

The structure agents (promise / mice / mckee-gap / character-arcs / value-charge) all begin with "this is a corpus-extraction task; your output trains the harness's structural-imitation layer." None of them runs against the in-progress novel as a planner gate. The data they produce sits in a side database for future training. The live planner-state-mapper is about facts/knowledge/state, not about turns/value-shifts/gaps. So the **most validated craft frameworks the harness understands are not constraining the live novel.** Diagnostic-only ≠ runtime constraint. This is the specific gap that generates F-L1-1, F-L1-3, F-L2-1, F-L2-4, F-L4-2, F-L5-2 as a single cross-layer failure.

### CL-2: Beat is the granularity in three layers; should be one.

Beat is the planner emit unit, the writer call unit, the obligation attachment unit, *and* the checker assertion unit. The corpus reference says scenes are the natural mid-granularity (4 scenes/chapter, ~5 beats/scene, 565 words/scene). The corpus-recreation POC (2026-05-09 retrospective) explicitly concluded: "scenes are the primary plan/write/check unit; beats remain annotation, obligation, and traceability refs inside scenes." That conclusion has not flipped the production default. Until it does, beat will continue to be over-loaded as both *the planner thinks in beats* and *the writer writes one beat at a time*, and the natural scene boundaries the corpus reference shows will keep getting violated.

### CL-3: Quality findings flow up; constraints don't flow down.

The 2026-05-10 evidence run produces excellent diagnostics — endpointIssues, weakStoryTurnBeats, obligation health, thread/payoff continuity — and these get logged. But none of them turns into a writer-visible constraint or a checker that gates acceptance. The diagnostic loop is observational. The 2026-05-09 retrospective explicitly chose to defer this: "Promotion to default-on for any flag requires a separate decision after live evidence."

### CL-4: The checkers measure correctness; reader experience needs propulsion.

Setting / emotional direction / named entity / fact contradiction / planned state coverage = correctness axes. Readers do not put down books because of a fact contradiction; they put them down because nothing seems to be at stake. The diagnostic discernment dimensions (`endpointLanding`, `causalMomentum`, `promiseProgress`, `sceneDramaturgy`, `motivationSpecificity`, `characterMateriality`) are exactly the propulsion axes — they exist as judges, with calibrated 100% exact accuracy on dimension-specific narrow tasks, but none of them is wired as a checker on prose. The bridge from L6 to L5 is the highest-leverage cross-layer change available without a model upgrade.

### CL-5: The writer prompt assumes a contract the planner does not produce.

`prose-writer-system.md` line 15: "Structure each scene as: GOAL (what does the POV character want?) → CONFLICT (what opposes them?) → DISASTER (how does it go wrong, or succeed at a cost?)." `beat-writer-system.md` line 8: "Structure the beat as: GOAL → CONFLICT → DISASTER." This is correct craft. But the beat description (1–2 sentences, "what changes dramatically — NO dialogue") does not separate goal from conflict from disaster. The writer prompt is asking the model to extract structure from a single sentence, then write 300–450 words of dramatized scene from it. The model is good enough to do it some of the time (samples 1, 17 are clean). It is not good enough to do it reliably without the structure being in the input.

### CL-6: World/character bibles are static catalogs, not active constraints.

User memory captures this: "World-bible architecture priority — deep evolving world/character bibles + scoped context > checker tightening." The harness has a world bible, character profiles, a scoping engine for facts. It does not have a *world rule operating in scenes* mechanism — `worldFactPressure` discernment dimension exists exactly because plans pass `mustEstablish` for a world fact without that fact constraining any choice/cost/outcome in the prose. The bay/Maren samples all have a "Vance Chemical plant" mentioned by name; in only one of them does the plant constrain a scene-level choice. The world bible is decoration in two of three sampled chapters.

### CL-7: Voice/character work is over-applied, structure work is under-applied.

The character-context capsule, character snapshots, exampleLines, doesNotKnow arrays, relationship `getRelationshipBetween`, READER-INFO STATE — all this scaffolding is precise. The writer's voice rules are the most prescriptive prompt in the repo. The result is that the prose has good voice and good interiority. What it lacks is *story shape*. The repo has under-invested in scene structure relative to character voice. The CFA-v1 cohort has the same finding: character-arc pressure 67% / 67% (no lift), endpoint landing 53% / 44% (regressed), even when method-pack improved character materiality 50% → 83%.

---

## 5. Recommendations (ranked by leverage)

### Recommendation R1: Promote scene contract into the default writer-prompt path

- **Layer optimized**: L2 (with deterministic ripple to L1 mapper output).
- **Exact proposed change**: Stop gating `SCENE CONTRACT` block on `sceneCallWriterV1`. The block already renders cleanly when populated. Change the planner-state-mapper to populate the scene-contract fields by combining: (a) the existing beat description as `goal` candidate, (b) the existing `valueShifted`/`lifeValueAxes` as `valueIn`/`valueOut` candidates, (c) the chapter `purpose` parsed for opposition/turning point candidates. Even partial population is strictly better than the current default (no contract). When fields are absent, render `Goal: ?`, `Opposition: ?`, etc. — make the absence visible to the writer, who can then improvise rather than be silently structured-by-omission. Keep `causalMaterialityV3`-style upstream prompting as the *source* of these fields when high-quality, but unconditionally render whatever exists.
- **Expected storytelling benefit**: Every scene the writer writes has a goal, opposition, and turn declared in the prompt. Reader-visible: scenes will close on consequence rather than on mood; bloated scenes will tighten; chapters with two-mini-chapter problems (sample 7) will resolve into one scene with a turn. This addresses F-L2-1, F-L2-3, F-L4-1, F-L4-2 simultaneously.
- **Downstream risks**: V4 Flash compliance ceiling caused L096 validator to be demoted to advisory. If we make the contract *visible to the writer* rather than *enforced by validator*, the compliance problem moves from "validator throws" to "field is missing in prompt" — gracefully degrades instead of bailing. Risk: writer over-indexes on contract and produces mechanical Goal-Conflict-Disaster scaffolding. Mitigation: render contract as guidance, keep beat description as primary creative brief.
- **How to test it cheaply**: Use the existing fixed-plan A/B harness (`scripts/test-drafting-isolated.ts`) on a *writer-undershoots fixture* per the 2026-05-09 follow-up note. Two arms: default-no-contract vs default-with-contract. Measure word ratio (does it tighten the over-target case, expand the under-target case?), `sceneDramaturgy` semantic label, `endpointLanding` semantic label. N=10 chapters. Cost: <$1.
- **What data would prove value**: `sceneDramaturgy` mean ≥ 2.5 (vs current ~2.0 baseline), `endpointLanding` mean ≥ 2.5, word-ratio variance reduced by ≥30% (less over- and under-shooting), no new checker-blocker class, semantic-review low-finding rate ≤ baseline.
- **What should remain unchanged**: writer system prompt; checker prompts; UI; ApprovalPolicy; manual-review default; `thread-character-context-v1` capsule rendering; halluc-ungrounded; functional-state checker; legacy outline byte parity.

### Recommendation R2: Wire the calibrated scene-dramaturgy / endpoint-landing judges as a runtime checker

- **Layer optimized**: L5 (consumes L6 calibrated artifacts).
- **Exact proposed change**: Add a new checker `scene-shape-checker` that runs `direct-label` (cheaper) on the *prose* per scene contract entry, returning the `sceneDramaturgy` label (SCENE-0..3) and `endpointLanding` label (ENDPOINT-0..3) at chapter end. Use the existing 100%-exact dimension-specific calibrated prompt. Wire SCENE-0 / SCENE-1 and ENDPOINT-0 / ENDPOINT-1 as findings; SCENE-0/ENDPOINT-0 as blockers, SCENE-1/ENDPOINT-1 as warnings. Route blockers through the existing rewrite path. Keep findings warning-class until 50 labeled operator examples confirm the level-1 bucket is real prose problem rather than judge noise.
- **Expected storytelling benefit**: Chapters that close on description instead of consequence get an automatic rewrite. Scenes that summarize instead of dramatize get flagged. The reader-facing benefit is the same one CFA-v1's `endpointLanding` regression named: chapters land on action+consequence instead of stated decision or mood.
- **Downstream risks**: Judge has a level-2 ceiling on real planner data — over-firing on level-1 cases that are already adequate is the fail mode. Mitigation: ship as warning-class first; only promote to blocker after operator labels confirm precision ≥0.85 at level-1.
- **How to test it cheaply**: Run the new checker against the existing 5 sampled chapters (Maret, Maren ×2, Sylvie, Noor) plus the 2026-05-10 fantasy-healer ch1+ch2. Manually label whether each chapter's last scene "turns" / "lands a consequence." Compare against checker output. Cost: <$0.20. If precision≥0.7 at SCENE-0/ENDPOINT-0 boundary, run on N=20 LXC novels for variance.
- **What data would prove value**: SCENE-0/ENDPOINT-0 precision ≥0.85 (operator-labeled); >40% of harness chapters fire at SCENE-0/SCENE-1 or ENDPOINT-0/ENDPOINT-1 on a baseline run (i.e. the problem is real and non-rare); rewrite path lifts at least 60% of fired chapters out of the SCENE-1/ENDPOINT-1 bucket on the next pass.
- **What should remain unchanged**: chapter-plan-checker; halluc-ungrounded; continuity; functional-state-checker; their thresholds; the writer prompt; manual-review default for blockers.

### Recommendation R3: Make chapter endpoint a structured field, not a prose blob

- **Layer optimized**: L1 (with rendered ripple to L2/L3).
- **Exact proposed change**: Modify `chapter-outline-system.md` and `chapterSkeletonSchema` to require two fields beyond current `purpose`: `endpoint_action` (one observable action or decision: "Maret accepts the night meeting with Theo" / "Maren confronts her father's signature in the ledger") and `forward_pressure` (one specific reader question generated by the endpoint: "Will Theo's forgery hold against Cassel's scrutiny?"). Render both into the writer prompt verbatim as `CHAPTER ENDPOINT TARGET:` and `CHAPTER FORWARD PRESSURE:` at the top of the writer's scope (last beat of the chapter). At validation, deterministically check that the chapter's last 200 words contain a verb-noun pair semantically matching `endpoint_action` (use existing `direct-label` judge as the semantic gate; deterministic regex on entity refs as the cheap pre-pass).
- **Expected storytelling benefit**: Eliminates the "chapter ends on a stated decision or mood" failure that the CFA-v1 cohort named. Reader-visible: every chapter's last paragraph is a hook the next chapter can answer, not an interiority decompression.
- **Downstream risks**: Forces some chapters into endpoint-action that organically wanted interiority. Mitigation: allow `endpoint_action` to be an *interiority decision* explicitly — "Maret resolves to confront the Arbiter at dawn" is an interiority decision and a forward action, both. The plotter prompt already says interiority decisions are valid endpoints; we just make it structured.
- **How to test it cheaply**: One A/B against the existing fantasy-healer 2-chapter run (`novel-1778411555121`). Re-plan with the new schema; redraft. Measure: `endpointLanding` semantic label on chapter-1 last 200 words; operator preference; word-ratio drift. Cost: <$0.50.
- **What data would prove value**: Endpoint-landing label ≥2.5 (vs current baseline 2.17), zero deterministic `endpointIssues` flags (vs the 2 in the evidence run), operator side-by-side preference ≥2:1.
- **What should remain unchanged**: existing plotter structural priors (STASIS = DEATH, midpoint reversal, etc.); `purpose` field (still produced, no longer load-bearing); chapter target words; writer system prompt; checker layer.

### Recommendation R4: Make scenes the planner emit unit, not beats

- **Layer optimized**: L1 (planner emit shape) + L2 (writer call unit).
- **Exact proposed change**: Promote `scenePlanContractV1` to the production default. Planner emits `outline.scenes[]` with scene contract + per-scene beat hints (3–6 beats per scene, ~100 words each as annotation). Writer drafts one scene per call, not one beat per call. Per-scene word target ~500–700, derived from chapter target / scene count (matching corpus reference distribution: median 565 words/scene). Beat hints ride along inside the scene prompt as "this scene contains these dramatic beats; you decide the order" — same shape as `beat-expansion-system.md`'s current beats but rendered as a checklist inside one writer call rather than as separate calls.
- **Expected storytelling benefit**: Scenes have natural beginnings, middles, ends because the writer can see all of them. The fantasy-healer over-expansion (3.03×) and the bay-Maren two-mini-chapter problem both become impossible in this shape because the writer is targeting one ~600-word scene, not chaining 5+ separate beat-prose-segments together.
- **Downstream risks**: Larger; this is the deferred Slice 2.5 redo. Risk: writer under-expands a scene that needs a long set piece (corpus has scenes from 651w to 6667w). Mitigation: scene `targetWords` is per-scene-contract, not chapter/N average; the planner sets it from beat-hint count + scene scope. Risk: existing per-beat checker contracts (functional-state, halluc-ungrounded) lose granularity. Mitigation: those checkers already operate at chapter scope on prose; lower scope to scene with `sceneId`, identical assertion logic.
- **How to test it cheaply**: The corpus-recreation POC has already produced this evidence on chapters 1, 2, 5, 8 — `causal-materiality-v2 + retry-short-scenes-v1` arm. Repeat the same harness *on a non-corpus fantasy seed* (e.g. fantasy-healer, fantasy-system-heretic) with two arms: default beat-shaped vs scene-shaped. N=4 chapters. Cost: <$2.
- **What data would prove value**: Word-ratio variance reduced ≥40%; scene-floor compliance ≥90%; semantic-review lows ≤ baseline; chapter-plan-checker pass rate unchanged; halluc-ungrounded fire rate unchanged.
- **What should remain unchanged**: writer system prompt craft rules; halluc-ungrounded grounding rules; continuity fact contradictions; world/character bibles; manual-review default; `thread-character-context-v1` capsule mode.

### Recommendation R5: Promote one structure agent (Promise/Payoff) from corpus-extractor to live planner constraint

- **Layer optimized**: L1.
- **Exact proposed change**: Stand up a `PromiseRegistry` table per `SYNTHESIS.md` §2.2. The structure-promise agent's promise-open prompt is already calibrated for corpus extraction; reuse the same prompt against the *generated chapter outlines* during planning (not against published corpus). Per chapter outline, the planner emits `promises_made[]` and `payoffs_delivered[]` as additive fields. Validator: every major promise has ≥1 progress event in the middle and a paid_off payoff before resolution; unmatched payoffs fire `unset_up_payoff` (Sanderson First Law violation = deus ex machina); promises still open at 95% completion fire `dangling_promise`. Wire findings as warnings; only structurally-broken patterns (promise opened, never progressed, never paid off) become blockers.
- **Expected storytelling benefit**: Chapter 2 of fantasy-system-heretic ("Theo offers to forge records, Maret agrees") would have to either pay off a chapter-1 promise (the calluses observation about the stranger? the senior clerk's concern about errors?) or open a new promise the climax pays off. The current chapter-2 reads as a follow-through because the planner has no promise model. With one, chapter-2 either advances an open promise (and gains weight) or opens a new one (and creates pressure).
- **Downstream risks**: Promise extraction at planning time depends on the planner having declared a promise in the chapter outline. If chapter outlines do not declare promises, the registry is empty. Mitigation: require `promises_made` (≥1 if chapter is not a pure transitional chapter) and `payoffs_delivered` (≥1 by midpoint) at the planning gate, with deterministic validation.
- **How to test it cheaply**: Run on the existing `crystal_shard` corpus first (already validated on Salvatore extraction). Then run on the fantasy-healer 2-chapter outline. Compare promise-density vs the corpus distribution. Cost: <$0.10.
- **What data would prove value**: Mean promises/chapter within 0.5σ of the corpus reference distribution; `dangling_promise` rate <10% on chapters past 75% of total length; operator review on 5 sampled chapters confirms promises feel real, not invented.
- **What should remain unchanged**: writer prompt; checker layer; existing planning agents; PromiseRegistry stays additive — old outlines don't carry it and that is non-blocking.

### Recommendation R6: Add a scene-internal McKee gap check on the prose

- **Layer optimized**: L5.
- **Exact proposed change**: New checker `scene-gap-checker` that runs the existing structure-mckee-gap prompt against generated scene prose, scene by scene. The corpus version expects beats; adapt to scenes by treating the scene's first sentence as the expectation anchor and the scene's last paragraph as the actual outcome. Returns `gap_size` ∈ {none, small, medium, large} and `gap_type`. Wire `gap_size=none` (i.e. flat scenes) as warning; chapters where ≥40% of scenes are flat fire a chapter-level blocker.
- **Expected storytelling benefit**: Catches the "competent prose, no scene movement" failure mode directly. The Library/Noor chapter is exactly this: every scene has the same flat polarity (Noor is anxious; the marginalia reveals more; Noor is anxious). At least one of those reveals should produce a small or medium gap (Noor expected the corridor to be there; it isn't = small gap; Noor expected the book to be a stray; it's a deliberate message = medium gap). The prompt already exists and is calibrated for tagging — `confidence ≥0.9` requires explicit pivot moments ("but instead", "to his surprise"). Useful precisely because pivots are what's missing.
- **Downstream risks**: Some scenes legitimately bridge / connect / decompress and should be flat (`abstain_reason` is already in the prompt). Risk: over-firing on legitimate transitional scenes. Mitigation: chapter-level threshold at 40% (most chapters in the corpus have ≥1 transitional scene; few have ≥40%).
- **How to test it cheaply**: Run on the 6 sampled chapters above + 4 corpus reference chapters. Cost: ~$0.10. Compare flat-scene rate harness vs corpus.
- **What data would prove value**: Corpus `crystal_shard` flat-scene rate ≤15%; harness baseline flat-scene rate ≥30%; the gap is real and measurable. After R1+R3 are in, harness flat-scene rate drops to ≤20%.
- **What should remain unchanged**: existing chapter-plan-checker `emotional_arc_correct` (which is direction-only); scene-shape-checker from R2 (different concern: dramaturgy completeness vs gap presence).

### Recommendation R7: Strip ID metadata from the writer's rendered prompt

- **Layer optimized**: L3 (rendering, not slot building).
- **Exact proposed change**: In `renderCharacterContextCapsules` (`character-context.ts:147–183`) and `renderBeatSpec` (`beat-context-render.ts:87`), suppress lines that emit `Chapter ID:`, `Beat ID:`, `Beat number:`, `POV character ID:`, `Active thread refs:`, `Active promise refs:`, `Active payoff refs:`, `Source obligations:`, `Active threads:`, `Active promises:`, `Active payoffs:`. Keep them in the trace artifact for telemetry/lineage; remove from the writer's prompt entirely. Replace the ID rendering with a *prose-shaped reminder* of *what* the active threads are: "Active reader expectations: Maret's hidden ability remains undiscovered; the Arbiter's investigation has just opened" (one sentence per active thread, naming the dramatic content).
- **Expected storytelling benefit**: Frees ~150–400 tokens per beat call for dramatic content. Reader-visible: marginally smaller; the win is downstream — those tokens become available for richer scene contract, scene-internal gap reminders, opposition specificity.
- **Downstream risks**: Loss of hidden traceability *to the writer* — but the writer doesn't need the IDs; the trace and the orchestrator do.
- **How to test it cheaply**: Byte-parity test only — confirm the writer prompt drops the ID lines. Then a token-count test: average prompt tokens before/after on the same fixture. Then a small A/B: same plan, same writer flag set, with vs without ID lines. Measure word-ratio variance, semantic-review low rate. Cost: <$0.50.
- **What data would prove value**: Token reduction ≥15%; no semantic-review regression; no character-context-trace regression at the orchestrator side (refs still flow through telemetry).
- **What should remain unchanged**: All slot-builder code; trace structures; orchestrator telemetry; functional-state checker contracts; halluc-ungrounded contracts.

### Recommendation R8: Add a "scene must turn — name the change" planner self-check

- **Layer optimized**: L1.
- **Exact proposed change**: At planner-beats emit, require each scene to declare `valueOpen` (initial value polarity) and `valueClose` (final value polarity) on the value-charge enum (life-death / freedom-slavery / justice-injustice / love-hate / truth-lie / power-weakness / hope-despair / success-failure / belief-doubt / identity-unknown / other). Hard rule: any scene with `valueOpen == valueClose` AND `polarity == 0` is a transitional scene and must be marked `transitional: true`; chapter cannot have >25% transitional scenes. This is the same value-charge schema the corpus extractor already uses; just enforce it on the live planner output.
- **Expected storytelling benefit**: Surfaces the "all my scenes feel the same" failure mode as a planner-side error before any prose is written. The Library/Noor chapter would have failed this check (every scene is hope/despair flat-negative); chapter-1 of fantasy-system-heretic would pass (Maret moves freedom→constrained as the Arbiter's news lands); chapter-2 (Theo offers forgery) is borderline (truth/lie shifting, but consequence not landed in plan).
- **Downstream risks**: Over-rotating polarity for variety's sake. Mitigation: the rule is about *non-flat scenes*, not about *alternating polarity*. Three rising scenes in a row are fine if they are rising on the same value (escalation).
- **How to test it cheaply**: Re-plan the 6 sampled chapters and the 2026-05-10 fantasy-healer chapters under the new constraint; compare scene-shape distribution to the corpus reference distribution. Cost: <$0.50.
- **What data would prove value**: Generated chapter scene-polarity distribution within 0.5σ of `crystal_shard` reference distribution (see `output/corpus-structure-reference/crystal_shard/reference.md`); chapter-level polarity entropy ≥ corpus baseline; downstream `scene-gap-checker` (R6) flat-scene rate drops correspondingly.
- **What should remain unchanged**: writer prompt; checker layer; existing beat structure (`description`, `kind`, `characters`).

### Recommendation R9: Concept-phase Snowflake-lite gate before planner-plotter runs

- **Layer optimized**: L0.
- **Exact proposed change**: Add a planner Phase 0 that produces (and persists) the Snowflake-lite strategy packet defined in `commercial-fantasy-adventure-v1.md`: `logline` (≤15 words), `paragraphSummary` (5 sentences with 3 disasters), `majorReversals[]`, `endingDirection`, `readerPromise`, `protagonistWant/Need/Lie/Truth`, `antagonistPressure`, `worldPressureRule`. Phase 0 is a *one-shot* generation gated by a deterministic conservation invariant: each disaster named in `paragraphSummary` must appear in the chapter skeleton's chapter `purpose` fields. This is the missing keystone from `SYNTHESIS.md` §2.6.
- **Expected storytelling benefit**: Conservation across iterative expansion — concept commits to 3 disasters; chapter skeleton must conserve them; planner-beats must dramatize them. The bay/Maren two-different-chapter-1s problem is impossible if both runs share a conserved Phase 0 packet that names the bay's contamination, the death, and the family conflict as the three disasters. No more concept drift between sibling outputs.
- **Downstream risks**: Phase 0 adds one DeepSeek call (~3K input / 2K output ≈ $0.005); minor. Risk: poor Phase 0 produces poor downstream plans. Mitigation: deterministic conservation gate is the test; if disaster-conservation fails, the next phase has clear retry semantics.
- **How to test it cheaply**: Run Phase 0 on the existing fantasy-healer seed; produce two independent chapter skeletons from the same Phase 0; compare chapter purposes. Then run the chapter skeletons through `endpointLanding` discernment. Cost: ~$0.10. Compare to the no-Phase-0 baseline.
- **What data would prove value**: Conservation pass rate ≥90% across N=6 concepts; chapter skeleton `endpointLanding` mean ≥+0.3 vs no-Phase-0; chapter purpose internal consistency (operator review N=6) clearly improved.
- **What should remain unchanged**: planner-plotter `chapter-outline-system.md`; planner-beats; mapper; writer; checkers; UI; runtime defaults for everything except whether Phase 0 exists.

### Recommendation R10: Fold the "scene must contain dialogue between conflicting characters" rule into the scene contract, not the writer's craft list

- **Layer optimized**: L2 (planner emits) + L4 (writer renders).
- **Exact proposed change**: Currently `prose-writer-system.md` says: "Every scene must contain at least 2 exchanges of spoken dialogue. Characters speak — they do not just think and observe." This is in the system prompt. But the scene-internal interiority chapters (fantasy-system-heretic ch1 first half = Maret alone in her closet) legitimately have no other character. Move the rule into the scene contract: scenes flagged `dialogueExpected: true` (i.e. ≥2 named characters present, no isolation marker) get the "≥2 dialogue exchanges" obligation; scenes flagged `dialogueExpected: false` (POV alone, interiority bridge) get an "interiority anchor" obligation instead (specific physical action, not pure thought). The functional check moves from a writer-side rule to a scene-shape-checker assertion.
- **Expected storytelling benefit**: Two sub-benefits. (a) Removes the writer's tension between "follow the dialogue rule" and "this scene has only the POV." (b) Catches the *opposite* failure: chapters where the writer skips a scene's needed dialogue exchange (sample 13 — Theo conversation skipped a sequel beat).
- **Downstream risks**: New scene-flag inflation. Mitigation: derive `dialogueExpected` deterministically from `characters[].length >= 2 && !povAlone`.
- **How to test it cheaply**: Deterministic flag derivation has unit tests. Run on the 6 sampled chapters; report dialogue exchange count per scene; compare to flag. Cost: <$0.10.
- **What data would prove value**: Scenes with `dialogueExpected: true` actually contain ≥2 exchanges in ≥95% of generated prose; scenes with `dialogueExpected: false` show interiority anchors rather than dialogue.
- **What should remain unchanged**: writer system prompt's other craft rules; checker layer; halluc-ungrounded.

### Recommendation R11: Operator-review oracle dataset (50 chapters, 6 dimensions)

- **Layer optimized**: L6 (calibration substrate).
- **Exact proposed change**: Hand-label 50 generated harness chapters across the 11 calibrated discernment dimensions (most importantly `sceneDramaturgy`, `endpointLanding`, `motivationSpecificity`, `characterMateriality`, `worldFactPressure`, `relationshipDelta`). Persist to `eval_briefs` / `eval_results`. Use this as the oracle for promoting any LLM judge from warning-class to blocker-class. This is the missing rung in the calibration ladder identified in `feedback_dont_calibrate_noisy_llm_checkers` (memory).
- **Expected storytelling benefit**: Indirect — unlocks R2, R6 promotion to blocker. Without an oracle, every LLM judge stays warning-class permanently and the pattern in CL-3 (findings flow up but don't gate prose) cannot break.
- **Downstream risks**: Time cost; this is one operator-day of work, not a $-cost. Risk: operator's labels are themselves biased. Mitigation: dual-label 10% of the set with an independent labeler (Codex / second human) and report κ; if κ < 0.6, abandon the dimension.
- **How to test it cheaply**: This *is* the test. The deliverable is the labeled set; cost is operator time, not API cost.
- **What data would prove value**: Inter-rater κ ≥0.6 on 5/6 dimensions; LLM judge accuracy against operator labels ≥0.85 at the SCENE-0/SCENE-1 boundary.
- **What should remain unchanged**: All current checkers; calibration fixture; eval infrastructure.

### Recommendation R12: Stop running corpus-extractor structure agents at planning time; use them at training time only

- **Layer optimized**: L1 (clarity / cost).
- **Exact proposed change**: Audit which structure agents (promise / mice / mckee-gap / value-charge / character-arcs) are invoked during the live planning phase vs only during corpus extraction. If any are invoked live as discovery tools, freeze that. Their prompts are explicitly corpus-extraction-shaped (e.g. structure-promise opens with "You read the chapter-by-chapter beat sequence of a published novel"). They are not the right shape for live in-progress planning. Replace any live invocations with planner-shaped variants per R5/R8 (or omit entirely until the planner-shaped variant is built).
- **Expected storytelling benefit**: Cleaner attribution. Cost reduction. Reduces one source of confusion in the docs about what's "active" vs "diagnostic-only."
- **Downstream risks**: None I can see; this is hygiene.
- **How to test it cheaply**: Code audit + DB query on `llm_calls` rows by `agent` for the 2026-05-10 evidence run.
- **What data would prove value**: `llm_calls` for `structure-promise`/`structure-mice`/`structure-mckee-gap`/`structure-value-charge` against any non-corpus novel = 0.
- **What should remain unchanged**: Their prompts (still used for corpus extraction); their schemas; the corpus pipeline.

---

## 6. Open Questions / Things I Couldn't Tell From Artifacts Alone

1. **Does the 2026-05-10 fantasy-healer run actually render `thread-character-context-v1` capsules?** The current-state doc says it's the production default as of L094 (2026-05-09). The session record says `threadId=0`, `promiseId=0`, `payoffId=0` on persisted obligations. So the *capsule shape* may render with empty active-ref lists, which would be the worst of both worlds (token cost without dramatic content). DB query needed: `SELECT count(*) FROM llm_calls WHERE writer_context_mode = 'thread-character-context-v1' AND chapter_id IN (...);` cross-referenced against per-call trace.

2. **Does the writer ever fire `retry-short-scenes-v1` expansion in the production runtime?** Slice 2.5 showed 0 events on the production A/B because the writer overshot rather than undershot. But fantasy-healer ch2 was 3.03× target and ch1 was 1.89× — neither would trigger an undershoot retry. So the expansion path is currently dead code on production novels [unverified hypothesis until expansion-event count is queried from `pipeline_events`].

3. **What does ApprovalPolicy actually approve, and how often?** The proposal model is sophisticated (artifact_patch / prose_edit / editorial_flag / canon_update / planning_edit); the dev/assisted/autonomous tiers have specific minRows and minAutoPrecision gates. None of the sampled outputs reflect *applied* proposals. Are these prose chapters going through the proposal layer at all, or is the proposal layer parallel work that hasn't yet integrated into the drafting feedback loop?

4. **Is the oracle calibration substrate (`eval_briefs` / `eval_results`) populated with operator-labeled gold beyond the 21–63 calibration fixtures?** If not, R11 is the gating dependency for all blocker-class promotion of LLM judges.

5. **What is the actual cost-per-chapter of the current default path?** The 2026-05-10 evidence run reported $0.047797 for 2 chapters (~$0.024/chapter). At that floor, R2/R6/R9 add ~$0.03/chapter combined. The cost ceiling is not the constraint; the question is what's worth adding inside the same order-of-magnitude.

6. **Is there a writer-craft instance where the prose actually fights the prompt?** The samples I read show the writer dutifully following craft rules. I did not observe an instance of the writer producing an electricity-as-tension metaphor or a "let out a breath" cliché. So the writer-system-prompt strictness is functional. The `over-applies voice rule` finding (sample 14) is a different failure (under-modulation), and it might be a planner failure (missing `emotional_amplification` field) rather than a writer failure.

7. **Does the planner-discernment-calibration's level-2 saturation problem reflect judge ceiling or planner ceiling?** Without an oracle dataset, I cannot tell whether DeepSeek Flash *cannot* distinguish good from great, or whether the harness *does not produce* great plans yet, so the judge sees nothing above level 2 in the wild. R11 disambiguates this.

8. **The sample chapters all have very strong sentence-level voice but feel similar across novels.** Maret, Maren, Sylvie, Noor — different premises, different settings — all share a procedural, observationally-careful, low-affect narrative voice. This may be a fingerprint of DeepSeek V4 Flash plus the writer-system-prompt's "show emotion through body and action; never name emotions" rule applied uniformly across genres. If so, R10's `dialogueExpected` flag is necessary but not sufficient; some scenes need an `emotional_register` flag that lets the prompt loosen voice rules in the right places.
