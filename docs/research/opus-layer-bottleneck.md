---
job: 6
title: Layer Bottleneck Inspection (A through F)
date: 2026-05-10
model: opus
status: draft (decision artifact, not promotion-ready)
---

# Layer Bottleneck Inspection

## TL;DR

Ranking from strongest current bottleneck to weakest:

**B (scene-level planning + writing) > A (concept/spine/template) > D (prose-quality writer prompting) > E (semantic judging/eval) > C (character/world bibles) > F (traceability/lineage IDs).**

Pick: **B**, with **A** running shadow as the only required-to-validate-B parallel layer (because B's "what does the writer call expand into?" question is unanswerable when A leaves chapter shape under-specified). The single most-leveraged experiment is to flip the L097 `SCENE CONTRACT` block on by default in the writer's prompt path (no flag), populate it deterministically from the existing planner-state-mapper output, and run a fixed-plan A/B on a writer-undershoots fixture per the 2026-05-09 follow-up note. Cost <$1, falsifies in one round.

This document explains, with quoted runtime evidence, why B is the bottleneck; why A is the second-most-load-bearing layer but is currently *wrong* to optimize alone; and why C, D, E, F are not the live blocker even though they have known weaknesses.

---

## Section 1 — Reading the Runtime Evidence

The 2026-05-10 evidence run (`novel-1778411555121`, fantasy-healer seed, 2 chapters, $0.048, exp 480) is the centerpiece. The run completed end-to-end, both chapters approved, validation converged on pass 1. That is the *floor*: the harness ships clean prose. The ceiling problems are everywhere visible.

### Symptoms of low quality, with origin layers

#### Symptom 1 — Massive writer over-expansion against calibrated beat counts

*Evidence (2026-05-10 session record, `docs/sessions/2026-05-10-runtime-drafting-evidence.md` line 60):*

> | Chapter | Target | Planned entries | Recommended | Final words | Ratio | Final validation |
> | --- | ---: | ---: | ---: | ---: | ---: | --- |
> | 1 | 1500 | 5 | 5 | 2841 | 1.89x | passed |
> | 2 | 1800 | 6 | 6 | 5456 | 3.03x | passed |

And line 78–80:

> **Writer expansion is still the live pressure point.** The calibrated entry counts held at 5 and 6, yet final prose landed at 1.89x and 3.03x target. Do not spend the next slice on more beat-count calibration; inspect writer budget/context behavior or scene-call writer evidence instead.

**Origin layer:** B (scene-level planning + writing). The planner emitted the right number of beats. The writer chose its own scene boundaries because *no scene contract told it where one scene ends and the next begins*. Chapter 2 has 6 beats and the prose runs 5456 words — almost 1000 words/beat against a 300–450 word/beat design intent (`beat-expansion-system.md` line 25). That isn't beat overplanning; that's the writer treating each beat as a license to expand because it has no scene-level "scene closes when X" boundary.

*Manifests:* in chapter 2, lines 285–390 of `chapter-2.md` are *one continuous "go to the pavilion + assassination + Jien dies + Sylvie reflects" sequence* that should be at minimum two scenes with a value-polarity break between them. The writer doesn't know to break.

#### Symptom 2 — Endpoint-landing weak on both chapters despite "passed" validation

*Evidence (2026-05-10 session record line 65):*

> `endpointIssues=2`; both chapters had weak deterministic overlap between declared endpoint and final planned entry.

**Origin layer:** A (concept/spine/template) at root, B at manifestation. Chapter 1 closes with Sylvie walking toward the command pavilion (chapter-1.md line 251: `Sylvie Dunmore walks forward, the mud sucking at her boots, the phantom aches a living weight in her bones, and she does not slow down.`). That is a *mood-and-direction* endpoint, not a forward-pressure consequence. The planner's `purpose` field absorbed the decision and didn't split into `endpoint_action` and `forward_pressure`. The mapper had nothing to route to the writer as "you must close on this concrete consequence." The writer, having no closing constraint, picked the cleanest available image and stopped.

#### Symptom 3 — Three weak story-turn beats flagged but not fed back to anything

*Evidence (line 67–70):*

> `weakStoryTurnBeats=3`; these are deterministic flags and need operator or semantic review before becoming a rewrite rule.

**Origin layer:** B. The mapper produces obligation kinds keyed to facts/knowledge/state continuity (`mustEstablish`, `mustTransferKnowledge`, `mustShowStateChange`); there is no `mustTurn` obligation. Three beats are weak on the dramatic-turn axis and the only artifact that knows that is a deterministic flag that nobody sees at writer time.

#### Symptom 4 — Lineage substrate exists, planner is not exercising it

*Evidence (line 87–94):*

> Thread/payoff lineage is not yet being exercised in this runtime. The persisted outlines had 23 obligations across two chapters, but `threadId=0`, `promiseId=0`, and `payoffId=0` on those obligation rows. Writer context traces also had empty `activeThreadIds`, `activePromiseIds`, and `activePayoffIds`.

**Origin layer:** F (traceability) substrate is fine; A (concept/spine) is failing to *commit* to threads/promises that the planner could route. The fantasy-healer seed is a 1-paragraph premise — there is no upstream thread/promise/payoff packet for the planner to anchor obligations to. Wiring is not the bug; absent input is.

#### Symptom 5 — Plan checker caught a real semantic drift the planner produced

*Evidence (line 82–86):*

> The plan checker caught a real semantic drift. Chapter 2 initially changed the plan from Voss proposing transfer onto a prisoner into transfer onto Sylvie herself. That contradicted both the plan and the world rule that the healer cannot transfer wounds onto themselves. One targeted rewrite of the first entry fixed the plan check.

**Origin layer:** B (scene-level planning) — the writer drift the checker caught is a writer scene-shape drift inside an under-specified scene contract. The chapter 2 plan was about negotiation; the writer ad-libbed a more dramatic premise (Voss asks Sylvie to be the vessel) which is *better fiction* but a plan deviation. Read chapter-2.md line 345: `"I am asking you to transfer a wound onto yourself."` — this is the writer inventing a third escalation because no scene contract committed to which beats own which crisis. The checker fired correctly. But the *upstream* fix is "scene contracts that name the crisis choice and value polarity," not tighter checker thresholds.

#### Symptom 6 — Persistent halluc-ungrounded retries on writer-invented names

*Evidence (harness.log lines 19, 20, 28, 35, 37, 40, 43, 45):*

```
[2026-05-10T11:16:27.558Z] [INFO] Beat 2 retry 1: halluc-ungrounded(1): Ungrounded entity "Denner" — context: "This boy's name is Denner. He has a mother in the eastern farmlands."
[2026-05-10T11:16:58.682Z] [INFO] Beat 3 retry 1: halluc-ungrounded(3): Ungrounded entity "Colonel Vex" ... "Captain Laren" ... "Tomas"
[2026-05-10T11:19:30.821Z] [INFO] Beat 3 retry 1: halluc-ungrounded(2): Ungrounded entity "Captain Aris" ... "Sergeant Vell"
[2026-05-10T11:21:09.055Z] [INFO] Beat 1 retry 1: halluc-ungrounded(1): Ungrounded entity "the kingdom"
[2026-05-10T11:23:10.748Z] [INFO] Beat 3 retry 1: halluc-ungrounded(2): Ungrounded entity "Harrel" ... "Elsabet"
[2026-05-10T11:24:31.876Z] [INFO] Beat 4 retry 1: halluc-ungrounded(4): Ungrounded entity "Captain Ren" ... "Captain Lorn"
[2026-05-10T11:25:30.141Z] [INFO] Beat 5 retry 1: halluc-ungrounded(2): Ungrounded entity "Twenty-three" ... "Thirty-two steps"
```

**Origin layer:** A and C. The writer keeps coining names because: (a) the world bible / character profiles do not provide enough non-PoV named characters for the chapter situations the plan contains (A and C — concept underseeded the cast), and (b) the writer is filling structural gaps that an under-specified scene contract creates with the most plausible thing — a named officer. The `Captain Aris / Sergeant Vell / Captain Ren / Captain Lorn` cluster across two chapters is not a hallucination problem; it's a casting problem. Fix it by giving the chapters real named NPCs in the character bible, not by tightening the checker. The "Twenty-three" / "Thirty-two steps" false positives are the checker over-firing on dialogue numerics — that's a checker prompt nit, not a story-quality bottleneck.

#### Symptom 7 — Adherence stage-1 false negatives suppressed by stage-2 override 5 times in 2 chapters

*Evidence (harness.log lines 21, 36, 38, 39, 42, 44):*

```
[INFO] Beat 3 adherence: stage-2 override — all events enacted, stage-1 false-negative suppressed
[INFO] Beat 2 adherence: stage-2 override — all events enacted, stage-1 false-negative suppressed
[INFO] Beat 2 adherence: stage-2 override — all events enacted, stage-1 false-negative suppressed
[INFO] Beat 3 adherence: stage-2 override — all events enacted, stage-1 false-negative suppressed
[INFO] Beat 3 adherence: stage-2 override — all events enacted, stage-1 false-negative suppressed
[INFO] Beat 5 adherence: stage-2 override — all events enacted, stage-1 false-negative suppressed
```

**Origin layer:** E (judging) calibration symptom. Stage-1 adherence is broken enough that stage-2 is rescuing it 5/11 beats. That's a 45% stage-1 failure rate that's not currently a quality issue because stage-2 catches it. But it tells us E is over-firing — and confirms the user-memory rule "*don't calibrate noisy LLM checkers*". E is **not** the live bottleneck (failures are recovered) but is fragile.

#### Symptom 8 — Adherence-events token cap hit

*Evidence (harness.log line 41):*

```
[INFO] Beat 3 retry 2: adherence(1): Adherence events check failed: LLM completion hit max token cap for adherence-events (deepseek/deepseek-v4-flash): completion_tokens=512 maxTokens=512 finish_reason=length
```

**Origin layer:** E (judging implementation). The adherence-events checker hit `512` tokens for a single beat's events. That's an infra knob, not a story-quality bottleneck.

#### Symptom 9 — Lint integrity retries on fused-boundary issues

*Evidence (harness.log lines 26, 27, 51, 52):*

```
[WARN] Prose integrity failed for chapter 1: quote-integrity: ... she does not remember hisShe remembers his eyes
[WARN] Lint fix rejected for chapter 2: fused-boundary: tinguishing the lamp.Darkness. Sylvie heard
[INFO] Integrity settle pass 1: targeted rewrite of beats [3]
```

**Origin layer:** D (writer prose surface) symptom — the writer is producing JSON-encoded prose where the model output stitches words together at the JSON boundaries (`"...his"` + `"She remembers"` → `"hisShe"`). Chapter 1 retried twice for this. **Not** a story-quality issue; a JSON-mode artifact. Mention it because if D were the optimization target this would *not* be the lever — the lever would be scene-level prompt richness, and these surface-string defects would be unaffected.

#### Symptom 10 — Massive duplicated paragraphs across two chapters (writer copy-paste)

*Evidence (chapter-1.md lines 21–22 ↔ 53 ↔ 113, all variants of):*

> She stands. Her back protests—that ache belongs to a cavalryman whose spine took a lance tip. She does not remember his name either. She remembers his eyes.

This sentence appears verbatim three times in chapter 1. Same chapter, line 197: `"She stands. Her back protests—that ache belongs to a cavalryman she does not remember saving."` — fourth instance with one variation. Chapter 2 has the same pattern: `"counted under his breath. Twenty-three. Twenty-four."` (chapter-2.md line 189) is a callback to chapter-1.md line 35–36 `"Seventeen. Steps from the last pallet to this one."` — the writer is leaning hard on counting + phantom-ache as motifs because *that's the only specific dramatic content the scene contract gave it*. Without per-scene goals/oppositions/turns, the writer reaches for repetition of the strongest available image.

**Origin layer:** B and D. B in that the scene contract should have given the writer different dramatic content per scene; D in that no checker fires on cross-scene phrase repetition. The B fix prevents the cause; the D fix would mask it.

#### Symptom 11 — Chapter 2 has scene-shape disasters: argument loops, character dies, then chapter restarts

*Evidence (chapter-2.md lines 285–501).* The chapter has a clean three-section shape (Voss negotiation → camp wandering → return-to-pavilion-and-assassination), but the third section is *350 lines* — almost 70% of the chapter. The negotiation in section 1 takes lines 1–120; the wandering interlude takes lines 121–284; the return takes lines 285–501. The negotiation closes with `"I will not do it,"` (line 109). The wandering closes with the line `"Let's get this over with."` (line 281). The return reopens, has Voss propose **transfer-to-Sylvie**, has an assassin attack, kills Jien, and Sylvie internally pivots to "I'll go to Voss." Three scenes of value-shifts in 215 lines, no scene boundaries marked.

**Origin layer:** B. This is exactly the corpus-recreation finding (2026-05-09 retro): "scenes are the primary plan/write/check unit; beats remain annotation, obligation, and traceability refs inside scenes." The chapter has 6 beats; it has at least 3 scenes; the writer has flattened them all into continuous prose because the contract was beat-shaped.

#### Symptom 12 — Lint discovered 22 issues on chapter 2; only 4/15 lint-fixed in chapter 1

*Evidence (harness.log lines 24, 25, 50):*

```
[INFO] Lint found 15 issues
[INFO] Lint fixed 4/15 issues ($0.0004)
[INFO] Lint found 22 issues
```

**Origin layer:** D, but second-order. The lint surface is what the writer-prompt's "no electricity-as-tension" rule misses. 22 issues on a 5456-word chapter is roughly 1 issue per 250 words. That's noisy at the surface level; not the story-quality problem. The chapter passed approval with 22 lint issues — that's the "this is acceptable" signal.

### Origin-layer summary

Of the 12 symptoms above:

- 7 originate in **B** (scene-level planning/writing): 1, 3, 5, 6 (partial), 10 (partial), 11, plus indirect on 2.
- 3 originate in **A** (concept/spine/template): 2, 4, 6 (partial).
- 2 originate in **E** (judging) but are *recovered*, not blocking: 7, 8.
- 1 originates in **D** (writer prose) but at JSON-artifact level: 9.
- 1 originates in **C** (character bible): 6 — undercast NPCs.
- 0 originate in **F** (traceability) — the substrate works; A is not feeding it.

This is not symmetric. **B is the dominant origin**, and the runtime evidence quote that names the bottleneck explicitly — "Writer expansion is still the live pressure point... inspect writer budget/context behavior or scene-call writer evidence instead" — is the same conclusion. The session record's own prescription (next session goals 1–3) is to test thread refs, scene-call writer A/B, and writer naming — three B-flavored experiments out of four.

---

## Section 2 — Per-Layer Diagnosis

## Layer A — Concept / Spine / Template

### Current capability

- `src/agents/world-builder/world-bible-system.md` builds a structured bible (setting, geography, politics, social customs, sensory palette, rules, locations, culture, history, systems[], cultures[]).
- `src/agents/character-agent/character-profile-system.md` builds character profiles (LTWN: lie/truth/want/need, voice, drives, fears, avoids, relationships).
- `src/agents/planning-plotter/chapter-outline-system.md` emits chapter skeletons with `chapterNumber`, `title`, `povCharacter`, `setting`, `purpose`, `targetWords`, `charactersPresent` — and structural priors as soft prompt guidance ("STASIS = DEATH", midpoint reversal, never close on description, etc.).
- `docs/method-packs/commercial-fantasy-adventure-v1.md` defines a Snowflake-lite strategy packet (logline, paragraphSummary, majorReversals[], endingDirection, readerPromise, protagonistWant/Need/Lie/Truth, antagonistPressure, worldPressureRule). **It does not run by default.** CFA v1 cohort verdict (2026-05-08): `HOLD` (mean delta +0.2 points, win rate 50%, endpoint regression 53→44%).
- The corpus-structure-recreation POC produced sequence-context + causal-motivation-v3 + thread-character-context-v1 stack. Improvements documented in 2026-05-09 retro. Production drafting promoted only the writer-context capsule (L094); the planner-side variants stay POC-only.

### Strongest evidence of being a bottleneck

Symptom 4 (lineage substrate empty in production). Per `2026-05-10-runtime-drafting-evidence.md` line 87–94, the planner produced 23 obligations with `threadId=0/promiseId=0/payoffId=0`. The fantasy-healer seed is a one-paragraph premise; the planner had nothing to commit threads/promises to.

CFA-v1 cohort (2026-05-08-cfa-v1-framework-poc.md line 198):

> | Endpoint landing | 53% | 44% | regressed |

The deterministic CFA v1 scaffold *regressed* endpoint landing in cohort. Adding planner inputs without giving them dramatic shape made things slightly worse. The user feedback (2026-05-03 memory) says world-bible architecture is the priority; that's a long-term direction, not the live runtime bottleneck.

### Strongest evidence of NOT being the bottleneck

The fantasy-healer chapters as written are recognizably one cohesive story: world rules are consistent (transfer requires viable host, healer carries phantom ache), characters have specific voice (Sylvie clinical, Jien counts, Voss measured-bureaucrat), the premise is a clean ethics-in-war setup. Concept/spine/template is *adequate* for two chapters of clean draft. The breaks are not "what is this story" — the breaks are "what does this scene do." The CFA v1 cohort directly tested the hypothesis "stronger upstream packet helps" — and it did not.

Per 2026-05-09 retro on cohort: `Saltglass-curse +1.7, skybridge-rebellion +1.2, mapmaker -0.4, ironwood +0.1, ember-library -0.5, desert-clockwork -0.9.` That distribution says **template fit is concept-shape-dependent** — for some concepts it helps, for others it hurts. That's the signature of a layer that needs tuning, not a layer that's the dominant blocker.

### Cheapest experiment to confirm/falsify it as the bottleneck

Re-run fantasy-healer 2-chapter with CFA-v1 strategy-packet seeded (logline, paragraphSummary, 3-major-reversals, endingDirection, protagonistWant/Need/Lie/Truth, antagonistPressure, worldPressureRule). Use existing `diagnostics:method-pack-planner` flow. Compare endpointLanding semantic label, weakStoryTurnBeats count, word-ratio variance against the 2026-05-10 baseline. Cost <$0.20.

Stop gate: if CFA-v1 doesn't reduce `weakStoryTurnBeats` to ≤1 *and* tighten word-ratio variance, A is not the live blocker on its own.

### If we optimize this layer first, what's the realistic upside?

Modest. Endpoint-landing semantic label might rise from 2.17 to 2.5 on cohort evidence. Saltglass/skybridge-class concepts get the most lift; mapmaker/ember-class get hurt. Reader-visible: chapters may close on cleaner promises but won't change scene-internal structure. The fantasy-healer-style "writer expanded the wound transfer to 90 lines" failure does not improve from more A.

### If we DON'T optimize this layer first, what's the cost of waiting?

Low if B is in flight, because B will *use* whatever A produces. Higher if we promote B's scene contract to default and then realize the planner can't fill `goal/opposition/turningPoint/crisisChoice/povPersonalStake` from the existing concept skeleton — i.e. B's prompt fields will land on null in a non-trivial fraction of cases without A also strengthening. **A must run as shadow during B**, not separately, because B falsifies on filled-in scene contracts and an empty contract is a useless test.

---

## Layer B — Scene-level planning + writing

### Current capability

- `src/agents/planning-state-mapper/state-mapper-system.md` is the load-bearing live structural agent. It emits `establishedFacts`/`characterStateChanges`/`knowledgeChanges` plus per-beat obligations (`mustEstablish`/`mustPayOff`/`mustTransferKnowledge`/`mustShowStateChange`/`mustNotReveal`/`allowedNewEntities`).
- `src/agents/writer/beat-context-render.ts` renders beat spec, transition bridge, landing target, character snapshots, optional capsules, resolved references, reader-info state, setting block — and **conditionally** renders the `SCENE CONTRACT` block (`renderSceneContract`, lines 120–148: goal/opposition/turningPoint/crisisChoice/choiceAlternatives/outcome/consequence/povPersonalStake/valueIn/valueOut). The block exists. It is gated on `ctx.sceneContract` being non-null, which today happens only when `sceneCallWriterV1=true`.
- `src/config/pipeline.ts`: `scenePlanContractV1: false`, `sceneCallWriterV1: false`, `writerExpansionMode: "off"`. **All three flags are default-off.** L095/L096/L097 retro (2026-05-09) says: "All four flags ship default-off; legacy callers see byte-identical behavior."
- 2026-05-09 retrospective (Slice 2.5): "First production A/B was inconclusive: baseline 5/10 chapters at mean ratio 2.20 (over-target), treatment bailed at ch1 on halluc-ungrounded plan-assist gate, **0 writer-expansion events fired in either arm.** The L097 expansion path only triggers on writer-undershoots; this fixture has the opposite ratio profile and was the wrong shape to test the hypothesis."

The substrate is *built*. Production has not committed to using it.

### Strongest evidence of being a bottleneck

Symptoms 1, 3, 5, 10, 11. The 1.89×/3.03× word-ratio overrun (symptom 1) maps directly to "writer has no scene-end signal." Symptom 11 (chapter 2 collapsed three scenes into one continuous 215-line block) is exactly the failure mode scenes-as-writing-unit was designed to prevent. The corpus-recreation POC (2026-05-09 retro line 1252) already demonstrated *the fix*: thread-character-context-v1 + causal-motivation-v3 + scene-call-writer + retry-short-scenes-v1 raised ch1 from 0.70→0.94 word ratio and ch2 from 0.77→0.88 with no semantic regressions. That stack landed in production-default *only* for the writer-context capsule (L094); the scene-call-writer half stayed flag-gated.

Multiple session records converge on this:

- 2026-05-10 evidence run (line 78): "do not spend the next slice on more beat-count calibration; inspect writer budget/context behavior or scene-call writer evidence instead."
- 2026-05-09 corpus-recreation retro (line 165): "scenes are the primary plan/write/check unit; beats remain annotation, obligation, and traceability refs inside scenes."
- 2026-05-09 scene-first promotion retro (line 36–38): the corpus POC chapter-2 baseline ran 3 semantic lows + 0 thread refs; `causal-motivation-v3` ran 0 lows + 4 thread refs across the 4-chapter cohort.

### Strongest evidence of NOT being the bottleneck

The L096 advisory amendment is the strongest contrary evidence: "Three iterative LXC smokes (r1: 22 failures, r2: 7 failures with collapsed shape, r3: 22 failures with no convergence trend) exposed a real V4 Flash compliance ceiling on the multi-field contract." V4 Flash *cannot reliably comply* with the full scene contract under the structural-v1 retry. So default-on enforcement is hard. But "the planner can't always fill all 9 fields" is different from "rendering 4 of 9 fields is worse than rendering 0." The ergonomic answer is graceful degradation: render whatever fields exist, leave others null, let the writer improvise within shape rather than improvise without shape.

The L094 character-context capsules already shipped on default. Word-ratio improvement on the corpus POC was 0.70→0.94 / 0.77→0.88 *before* sceneCallWriterV1 was on the path. So part of B's value is already realized. Pure-B promotion may yield smaller deltas than the POC suggested.

### Cheapest experiment to confirm/falsify it as the bottleneck

Use the existing `scripts/test-drafting-isolated.ts` harness with a writer-undershoots fixture (per 2026-05-09 follow-up, "needs a writer-undershoots fixture + pre-resolved entities"). Two arms: default-no-contract vs. default-with-contract-rendered-when-populated. Plan held identical via `--plan-from`. N=10 chapters min. Cost <$1.

Measure: word-ratio mean and variance, `sceneDramaturgy` semantic label, `endpointLanding` semantic label, halluc-ungrounded retry rate (proxy for "writer is filling structural gaps with names"). Stop gate: if scene-contract arm doesn't reduce ratio variance by ≥30%, doesn't lift sceneDramaturgy ≥0.3, and doesn't reduce halluc retry rate, B-as-rendered-by-default is not strictly better.

### If we optimize this layer first, what's the realistic upside?

High and reader-visible. Concrete predictions:

- Word-ratio variance reduced ≥30%: chapters that bloat (3.03×) tighten; chapters that undershoot (0.7×) expand on retry. Both directions converge on calibrated targets.
- Cross-scene phrase repetition (symptom 10) drops: scenes have distinct goal/turn/value polarity, so the writer's "reach for the strongest motif" trick has different content per scene.
- Symptom 11 (collapsed multi-scene chapter) is structurally prevented: writer is targeting one ~600-word scene per call, not one 5000-word chapter.
- Halluc-ungrounded retry rate drops: writer needs fewer ad-libbed officers to fill structural under-specification gaps.
- `weakStoryTurnBeats` drops because the writer is asked to enact the turn the planner declared.

### If we DON'T optimize this layer first, what's the cost of waiting?

High and compounding. Every other layer is downstream:

- A's improvements (better strategy packet, story-debt routing) fail to land cleanly because the planner-mapper has nowhere to put them — it routes to `mustEstablish`/`mustTransferKnowledge` rather than `goal`/`turningPoint`.
- D's writer prompts are already maxed on craft rules; further D work is diminishing returns when the input still doesn't separate goal from conflict.
- E's calibrated dimensions (sceneDramaturgy, endpointLanding) saturate at level 2 because they're scoring plans that don't have scene shape in the first place — at the prose level they could discriminate, but they're not wired there.
- F's lineage IDs flow through scenes/beats as labels; the labels are already there. F doesn't progress without B.

B blocks 4 of the 5 other layers from yielding measurable value.

---

## Layer C — Character/world bibles

### Current capability

- World bible: setting, time period, geography, political structure, technology constraints, social customs, sensory palette, rules, locations, culture, history, structured systems[] (with id/name/type/description/rules/manifestations/vocabulary/constraints), structured cultures[] (with id/values/taboos/speech-influences/customs/system-views).
- Character profiles: id/name/role/backstory/traits/speechPattern/internalConflict/avoids/goals/fears/relationships[]/culturalBackground[]/systemAwareness[]/exampleLines/lie/truth/want/need/arc_resolution.
- Character-context capsules (L094, default-on as of 2026-05-09): per-character Want/Need/Lie/Truth/Drives/Fears/Avoids/Conflict/Voice/State + obligation/thread/promise/payoff refs, rendered into writer prompt at beat granularity.
- Reader-info state: per-character `doesNotKnow` arrays prevent the writer from leaking facts to characters who shouldn't know them yet.

### Strongest evidence of being a bottleneck

Symptom 6 (writer keeps coining named characters because the bible undercasts). harness.log lines 20, 28, 40, 43 show `Captain Aris / Sergeant Vell / Captain Ren / Captain Lorn / Harrel / Elsabet / Denner / Tomas / Colonel Vex / Captain Laren` — 10 named characters invented across chapters 1–2. The character bible is providing Sylvie + Jien + Voss + maybe a sergeant or two; the chapters need a field-command sergeant, an enemy officer for the chest-wound transfer order, a quartermaster, a senior medic. The bible is the wrong layer to be making writers invent these.

User memory (2026-05-03) is the strongest direction signal: "World-bible architecture priority — deep evolving world/character bibles + scoped context > checker tightening."

### Strongest evidence of NOT being the bottleneck

The bibles are *adequate* for the symptoms that actually matter. Sylvie's voice is consistent across 750+ lines of two chapters; Jien's counting tic is established and used as the assassination foreshadow; Voss's "I have three days" pacing is internally coherent. The world rule (transfer requires viable host; healer cannot transfer to themselves) is consistent and is the load-bearing chapter-2 conflict. C is *working* for the parts of the run that work; C's gaps are around supporting cast and operational world-rule pressure, not around protagonist or core-rule fidelity.

The CFA-v1 cohort delta on `worldFactPressure` was 47→58% (improvement) and on `characterMateriality` was 72→81% (improvement) — adding *more upstream input* is moving these dimensions in the right direction at the planner level. If C were the bottleneck, those improvements wouldn't already be happening at the planner; they'd be hitting an information-availability ceiling.

### Cheapest experiment to confirm/falsify it as the bottleneck

Re-run fantasy-healer with an expanded NPC roster baked into the seed: 6–8 named officers, medics, prisoners with full `name/role/voice/relationships` cards. Compare halluc-ungrounded retry rate vs. baseline. Cost <$0.20. If retry rate drops ≥50% and word-ratio doesn't change much, C addresses one specific symptom but isn't the dramatic-shape lever.

### If we optimize this layer first, what's the realistic upside?

Symptom-narrow. Halluc-ungrounded retries shrink. Walk-on names get distinct voices. World-rule pressure tightens scene-by-scene if the planner is asked to thread world rules into obligations. None of this fixes the chapter-2 collapsed-scene problem. Reader-visible: less name-coining, slightly more lived-in world; same scene shape.

### If we DON'T optimize this layer first, what's the cost of waiting?

Low. C is the long-term direction (per user memory) but is not blocking any other layer from yielding value. A scene contract with `goal: "Sylvie reveals to Voss that she will not transfer to Tollen"` works regardless of whether C names 5 or 50 characters. C's lift compounds with B's structure once B is in.

---

## Layer D — Prose-quality writer prompting

### Current capability

- `prose-writer-system.md` (whole-chapter) and `beat-writer-system.md` (per-beat). Both prescribe Goal/Conflict/Disaster scene structure, character-voice fidelity, sensory anchors, NEVER-clauses for filter words, AI clichés ("let out a breath she didn't know she'd been holding", "the silence stretched", "a flicker of"), redundant adverbs/body parts, electricity-as-tension metaphors, distancing similes, hedging, vague qualifiers, "couldn't help but", show-don't-tell of emotion, dramatized backstory, dialogue-exchange minimums, document/letter quoting rules.
- This is the **most disciplined craft prompt in the repo.** ~120 explicit rules. The prose actually obeys most of them — sample chapter-1.md has zero electricity metaphors, zero "let out a breath" instances, zero `realized/seemed/noticed` clusters in the inspected sections.
- Lint discoverer + lint improver run after draft. Lint found 15 issues in chapter 1, fixed 4; found 22 in chapter 2.

### Strongest evidence of being a bottleneck

There is none in the runtime evidence. The writer prompt is *successful* at what it asks. Symptom 9 (fused-boundary lint) is a JSON-mode artifact, not a prompt issue. Symptom 12 (22 lint issues on chapter 2) is acceptable noise — that's 1 issue per 250 words, the chapter passed approval.

The closest D-shaped evidence is "speech pattern is law" being over-applied (Opus autopsy §L4 sample 14: Maren clinically reciting "tissue discoloration or lung froth" when Gil cracks emotionally). That's a real failure mode but it's diminishing-returns work — adding an "emotional modulation override" rule to a prompt that already has 120 rules.

### Strongest evidence of NOT being the bottleneck

Read the chapter 1 prose. Lines 19, 21, 53, 113, 197 — the recurring `"Her back protests—that ache belongs to a cavalryman whose spine took a lance tip"` motif is *good* AI-resistant prose: concrete sensory detail, character-specific anchor, no filter words. The problem isn't D — it's that the writer reuses this motif across 4 instances in one chapter because B didn't give it different content per scene.

Voice control across Sylvie / Jien / Voss / sergeant is solid: Jien's flat counted-numbers register is consistent (`"Affirmative."`, `"Twenty-three."`, `"Thirty-two steps from here to the supply wagon."`), Voss is measured-bureaucratic (`"The math does not lie."`, `"I am asking you to save ten thousand men."`), Sylvie has clinical authority (`"That wound's gone septic. You knew this last night."`).

D is doing its job. The fact that D's job is being done well *exposes* the B problem rather than masking it.

### Cheapest experiment to confirm/falsify it as the bottleneck

Strip the prose-writer-system.md down to one sentence ("Write vivid fiction from the scene beats and context provided") and re-run fantasy-healer 2-chapter. Compare lint issue count, AI-cliché count, voice-distinctness operator label. If quality doesn't drop sharply, D was over-engineered. If quality drops sharply, D is load-bearing — which is the strong prior. Cost <$0.20.

### If we optimize this layer first, what's the realistic upside?

Marginal. Prose is already at the AI-cliché floor for this writer model. Shaving the next 5% of lint issues is 1 issue per 350 words instead of 1 per 250 words. Reader-visible delta: invisible.

### If we DON'T optimize this layer first, what's the cost of waiting?

Zero. D is the most-tuned layer in the repo and shows the smallest marginal returns from further work.

---

## Layer E — Semantic judging / evaluation

### Current capability

- `chapter-plan-checker` (`plan-adherence-system.md`): setting_match, emotional_arc_correct, pass, deviations[]. **Excludes** "missing individual beat events" from deviations *by design*. Beat omission cannot be a fail.
- `halluc-ungrounded`: named-entity grounding with ~70 lines of disambiguation rules. Strong checker for what it does.
- `continuity` (`fact-check-system.md`): direct fact contradictions only. Severity = blocker/warning/nit. Per L84, continuity findings are diagnostic, not gating.
- `functional-state-checker`: planned-state coverage (establishedFacts/knowledgeChanges/characterStateChanges supported in prose). Findings warning-class until oracle-calibrated.
- Adherence-checker (stage-1 + stage-2 override). Per harness.log, stage-2 overrides 5/11 beats.
- Out-of-runtime: planner-discernment-calibration v0 (100% exact at dimension-specific shape, 11 calibrated dimensions including endpointLanding/sceneDramaturgy/motivationSpecificity/characterMateriality/causalMomentum/promiseProgress); scene-semantic-review (used in corpus POC). These are diagnostic-only.

### Strongest evidence of being a bottleneck

Symptom 7 (stage-1 adherence false-negative rate ~45% on this run) is the strongest E signal but is **recovered** by stage-2 override and not user-visible. None of the active checkers measures "did the scene turn?" or "did the chapter end on consequence?" — symptoms 2 and 3 (endpointIssues=2, weakStoryTurnBeats=3) are deterministic flags that fire and are then ignored. E is *missing dimensions*, not failing existing ones.

The most actionable E gap is exactly what the Opus semantic-judge plan identifies: J1 (endpoint landing on prose), J2 (scene completeness on prose), J3 (agency on prose) — all calibrated dimensions exist as plan judges; they are not wired as prose checkers.

### Strongest evidence of NOT being the bottleneck

The runtime path E exists is functioning: hallucination retries fired correctly on symptom 6, plan-checker fired correctly on symptom 5 (Voss-transfer-to-Sylvie drift), integrity caught fused-boundary symptom 9. E is the firewall; it's working as a firewall.

Per user memory ("don't calibrate noisy LLM checkers"): the bigger E mistake is to *expand* gray-zone LLM checkers without an oracle. The currently calibrated planner-discernment dimensions saturate at level 2 on production planner output (CFA-v1 cohort, characterMateriality 72→81%, endpointLanding 53→44% — the dimensions move but cap out fast). That's the signal of "calibration ceiling" not "calibration headroom."

CL-7 from the Opus autopsy: "Voice/character work is over-applied, structure work is under-applied." Adding more E to a system that doesn't yet have B is solving the wrong problem first — you'll measure scene shape on chapters that don't have scene shape.

### Cheapest experiment to confirm/falsify it as the bottleneck

Run J1 (endpoint-landing-on-prose) against the existing 5 sampled chapters (Maret, Maren ×2, Sylvie, Noor) plus the 2026-05-10 fantasy-healer ch1+ch2. Manually label each chapter's last scene "lands consequence" vs. "lands mood." Compare against J1 output. If precision ≥0.85 on the LANDS_NO/LANDS_YES boundary, E has a calibrated gate available — but **only if B is already producing scene contracts the gate can compare against**. Without B, J1 measures plans that don't have endpoints declared with structure.

Cost <$0.20.

### If we optimize this layer first, what's the realistic upside?

Modest and asymmetric. If we add J1/J2/J3 as warning-class checkers, runs get diagnostic visibility into the symptoms they're already producing — but no rewrite path fires unless we promote them to blockers, which user memory and the calibration ceiling argue against. Reader-visible: nothing changes, because warning-class findings don't drive rewrite. Operator-visible: better Plan Readiness review queue.

### If we DON'T optimize this layer first, what's the cost of waiting?

Low. E is well-positioned as **the falsifier for B**. Once B ships scene contracts to the writer by default, J1/J2/J3 immediately have something to score that has structure. Run E *after* B in the same lane, not before.

---

## Layer F — Traceability / lineage IDs

### Current capability

- `sceneId` minted for every `outline.scenes[]` entry, propagated through writer/checker telemetry, validation findings, traceability, health, proposal lookup, and planning-state repair (per L095/L098 + 2026-05-10 amendment).
- `beatId` retained for beat hints, legacy beat-shaped entries, beat-specific records.
- `obligationId` / `sourceId` for traceability inside scenes.
- `threadId` / `promiseId` / `payoffId` substrate (L093) — additive, warning-only ref validation, writer-context telemetry surfaces active refs.
- `llm_calls.scene_id` is the scene-first telemetry column.

### Strongest evidence of being a bottleneck

There is none. The substrate is built. Per `2026-05-10-runtime-drafting-evidence.md` line 96–97: "Scene IDs exist, but legacy beat tags are still present in this default path. Every outline entry had `sceneId`, and per-entry LLM calls carried `scene_id`." That's an observation, not a failure.

The thread/promise/payoff null-fill (symptom 4) is the single-cleanest case of "F substrate is present but A is not feeding it." That's an A problem, not an F problem.

### Strongest evidence of NOT being the bottleneck

Three of the L095/L096/L097/L098 + L093 + L094 decisions all landed substrate cleanly within 17 commits in 2026-05-09/10 without reader-visible quality changes. The substrate is production-ready and Codex-reviewed. F is *finished* relative to what B and A need to flow through.

### Cheapest experiment to confirm/falsify it as the bottleneck

There is no cheap experiment that moves F. F is plumbing; plumbing doesn't move quality on its own.

### If we optimize this layer first, what's the realistic upside?

Zero on reader-visible quality. Operator UI gets cleaner traceability, which is good but is at scope ceiling per the lane queue ("Visibility/interactivity foundation is at scope ceiling for now").

### If we DON'T optimize this layer first, what's the cost of waiting?

Zero. F is done.

---

## Section 3 — Ranking + Pick

Strict ranking with adjacent-pair justifications:

### Rank 1: B (scene-level planning + writing)

vs. A: B has 7 of 12 runtime symptoms; A has 3. B's substrate exists and is gated off; A's substrate (CFA-v1, strategy packets) has been tested and showed regression on endpointLanding. B's POC evidence (2026-05-09 corpus retro: 0.70→0.94 / 0.77→0.88 word-ratio improvement, no semantic regressions) is stronger than any A-only evidence. The session record's own next-session goals are 3-of-4 B-flavored (writer context, scene-call writer A/B, beat/scene naming).

### Rank 2: A (concept/spine/template)

vs. D: A's CFA-v1 cohort showed mixed-but-positive deltas on 3 dimensions (characterMateriality, worldRelevance, storyDebtTraceability) and one regression (endpointLanding). Adding upstream structure has measurable effect at the planner level. D's prose-quality work is at marginal-returns territory — the writer is hitting the ceiling of what V4 Flash will produce given the current input. A is more leveraged because A *feeds* B.

### Rank 3: D (prose-quality writer prompting)

vs. E: D is fully tuned, low-headroom, but is *load-bearing* — symptom 9 (fused-boundary) and the broader voice-distinctness signal both depend on D. Stripping D would visibly degrade prose. E is *adequate as firewall* and the natural mistake is to expand E into gray-zone work that user memory specifically warns against. D ranks higher than E because D is doing real protection work; E's improvements are conditional on B shipping first.

### Rank 4: E (semantic judging / eval)

vs. C: E has prepared infrastructure (calibrated planner-discernment, scene-semantic-review, the J1/J2/J3 prose-judges in Opus's semantic-judge plan) that is ready to deploy *after* B ships. C's improvements (more NPCs, operational world-rule pressure) require deeper work and yield narrower symptom relief. E ranks higher because it's the natural follow-on to B.

### Rank 5: C (character/world bibles)

vs. F: C addresses symptom 6 (name-coining) directly and aligns with user direction (2026-05-03 memory). F is plumbing. C ranks higher because C still has reader-visible improvements available; F has none.

### Rank 6: F (traceability / lineage IDs)

Substrate is complete. Zero reader-visible upside.

### Pick

**B is the priority.** No second pick required to validate it — B's evidence gate is a fixed-plan A/B with the existing `scripts/test-drafting-isolated.ts` harness on a writer-undershoots fixture, which can be run by populating the `SceneContractBlock` deterministically from existing planner-state-mapper output (chapter purpose + beat description + valueShifted/lifeValueAxes + character LTWN). If A's CFA-v1 strategy packet is also seeded into the same fixture, the experiment falsifies cleanly: scene-contract-rendered + strategy-packet-seeded should beat both arms.

**However**, A runs as **shadow during B**, not as a separate lane. Reason: a scene contract with all fields null is not a useful test of B. A scene contract with goal/turn populated and crisisChoice/povPersonalStake null *is* a test (it tests graceful degradation). So the lane is "B with A available as upstream feeder when fixtures call for it" — which is exactly the corpus-recreation POC stack that already works.

---

## Section 4 — The Pre-Mortem

We optimize B for 2 weeks. Specifically: flip `SCENE CONTRACT` block render to default-on whenever any field is populated, populate it deterministically from existing mapper output with `goal` from beat description, `valueIn`/`valueOut` from valueShifted/lifeValueAxes, `turningPoint` parsed from beat description verb-noun, `crisisChoice` parsed from chapter `purpose`, `povPersonalStake` from character LTWN, leave others null. Two weeks of A/B, calibration, and graceful-degradation work.

It fails to move quality. Likely causes:

### 1. V4 Flash compliance ceiling re-triggers

The 2026-05-09 L096 advisory amendment showed V4 Flash produces non-compliant scene-contract fields under structural-v1 retry: r1 22 failures, r2 7 failures with collapsed shape, r3 22 failures with no convergence. If we render whatever fields exist, *the planner-mapper might still fail to populate them* in the first place, leaving scenes with empty contracts. The writer then sees `Goal: ?, Opposition: ?` blocks which prime nothing.

**Early-warning signal:** in week 1, sample 20 random chapter outlines from disposable runs and count how many have ≥4 of 9 scene-contract fields populated. If <60% have ≥4, V4 Flash isn't filling the contract reliably enough for the layer to land. **Kill condition:** fewer than 50% of scene contracts populated to ≥4 fields after deterministic-fallback population.

### 2. Writer over-mechanizes Goal/Conflict/Disaster

Worst case of symptom-10 (motif repetition) gets *worse*: the writer gets a forced "Goal/Conflict/Disaster" structure and produces template-shaped scenes that read like writing-class exercises. The fantasy-healer style becomes uniformly choreographed.

**Early-warning signal:** in week 1 paired-replay, run prose-review.dramatization on 20 chapters. If treatment arm's `dramatization` mean *drops* relative to baseline (i.e., prose feels more mechanical), the structural prompt is hurting voice. **Kill condition:** dramatization label regresses ≥0.3 points or operator side-by-side preference goes <40% for treatment arm.

### 3. Word-ratio variance doesn't actually shrink

Hypothesis is that scene contracts give the writer scene-end signals. If the writer ignores them in favor of the existing beat-description hints, the 1.89×/3.03× pattern persists. The L097 retry-short-scenes-v1 only handles undershoots; nothing handles overshoots.

**Early-warning signal:** week 1 word-ratio variance on N=10 chapters. If variance reduction is <15%, the contract isn't constraining length. **Kill condition:** word-ratio variance reduction <20% by end of week 1.

### 4. Existing per-beat checkers misroute under scene-call shape

When the writer call shifts from per-beat to per-scene, halluc-ungrounded, adherence-checker, and chapter-plan-checker need to operate at scene scope. The L098 obligation-keyed validation-routing fix exists for *findings*; the *checker calls themselves* may still be beat-shaped. Mismatched scopes mean checker false-positives spike.

**Early-warning signal:** halluc-ungrounded + adherence stage-1 retry counts per chapter. Baseline (2026-05-10) had 11 halluc-ungrounded retries + 6 stage-2 overrides across 11 beats. If treatment doubles either count, checker scope is misaligned. **Kill condition:** any single checker's retry rate doubles vs. baseline.

### 5. Concept under-specification masks the lever

If the upstream concept is too thin (1-paragraph fantasy-healer seed), the planner-mapper has nothing to populate `crisisChoice` or `povPersonalStake` from. The contract fields stay null in the modal case. We've optimized a layer that depends on a feeder layer that wasn't ready.

**Early-warning signal:** for every fixture in the A/B set, count fixture concept word count. If the mean is <500 words and contract-field-population is <50%, concept thinness is masking the lever. **Kill condition:** scene-contract field population rate is uncorrelated with concept richness.

### 6. The corpus POC numbers don't replicate at production fixtures

The 0.70→0.94 / 0.77→0.88 word-ratio improvement was on the Salvatore Crystal Shard analog corpus — a deeply-shaped domain with thread/promise/payoff IDs already populated. Production fixtures (fantasy-healer-style, 1-paragraph seeds) may not show the same lift.

**Early-warning signal:** week 1 first-pair A/B word-ratio delta. If <0.10 (vs POC's 0.18–0.24), the lever is corpus-specific. **Kill condition:** mean word-ratio improvement on production fixtures is <0.05 across N=10.

### 7. The fixture problem from Slice 2.5 repeats

The 2026-05-09 retro names this: "writer-undershoots fixture + pre-resolved entities" doesn't currently exist in the disposable novel set. Trying to re-run on existing fixtures will run into the same ratio-profile mismatch (baseline 2.20× over-target, expansion path doesn't fire) and the A/B will be inconclusive again, not failing.

**Early-warning signal:** before running, audit fixture word-ratio distribution. If <30% of fixtures have baseline ratio <1.0, the fixture set is the wrong shape. **Kill condition:** before any A/B run, require ≥5 fixtures with baseline ratio ≤1.0 *and* ≥5 fixtures with baseline ratio ≥1.5 (variance test, not directional test).

### 8. Promotion gate confuses "no semantic regression" with "improvement"

The corpus-recreation POC kept showing "semantic review stays low-free" + "prose review stays low-free" as evidence of safety. That's *no harm*, not *measurable benefit*. If we promote on the same shape — "scene-contract arm doesn't regress" — we ship something that may not reliably help.

**Early-warning signal:** require both `improvement on a primary signal` AND `no regression on guardrails` for promotion. Don't promote on absence of regression alone.

**Kill condition:** explicit pre-declared promotion gate must include sceneDramaturgy mean ≥2.5 (vs baseline ≤2.0) AND endpointLanding mean ≥2.5 (vs baseline ~2.17) AND word-ratio variance reduction ≥30%. Failing any of three = no promotion.

---

## Section 5 — What This Means For The Other 5 Layers

### Layer A — concept/spine/template: **shadowed**

A runs in shadow during the B lane. Strategy-packet-seeded fixtures are part of the B test set so we measure both alone-B and A+B. A is not the *primary* lane signal but is the *natural feeder* for B's contract fields. Posture changes if: B ships and CFA-v1-seeded fixtures show ≥0.2 additional improvement over plain B fixtures. Then A becomes the next active lane.

### Layer C — character/world bibles: **continued at low priority**

C's NPC-undercast issue (symptom 6) is real but narrowly symptom-scoped. Fold any C work into B fixtures: the writer-undershoots fixture should be authored with a fully-populated NPC roster so halluc-ungrounded retries can be measured cleanly. Don't make C its own lane until B's lane closes. Posture changes if: post-B, halluc-ungrounded retry rate stays >5/chapter despite scene contracts being populated. Then C is the next active lane.

### Layer D — prose-quality writer prompting: **frozen**

No changes to `prose-writer-system.md` or `beat-writer-system.md` during the B lane. D is well-tuned, the prompts are at credible-craft-rule density, and any D change introduces a confound on B's measurement. Posture changes if: B ships and prose-review labels (dramatization/pacing/voice/payoff-propulsion) reveal a specific D-shaped failure that can't be addressed in B. Today's evidence does not show such a failure.

### Layer E — semantic judging / eval: **shadowed**

E's calibrated infrastructure (planner-discernment, scene-semantic-review, J1/J2/J3 from Opus semantic-judge plan) runs as warning-class diagnostic during the B lane. E is the *falsifier* for B — runs sceneDramaturgy and endpointLanding labels on B-treatment vs B-control prose. Do not promote any E checker to blocking during B. Posture changes if: B ships and J1/J2/J3 calibration against operator labels achieves precision ≥0.85; then E becomes the next active lane to wire those judges as gating checkers.

### Layer F — traceability / lineage IDs: **frozen**

F substrate is complete. No F changes during the B lane. Posture changes if: B ships and discovers that scene-contract findings need a new ID kind (unlikely given L095/L098 substrate is comprehensive). No expected change.

---

## Section 6 — Recommendations

### Recommendation R1: Render the SCENE CONTRACT block by default with deterministic field-population fallback

- **Layer optimized**: B (scene-level planning + writing).
- **Exact proposed change**: Remove the `sceneCallWriterV1` flag gate from `renderSceneContract` invocation in `beat-context-render.ts`. Add a deterministic `populateSceneContractFromMapperOutput()` step in the planner-state-mapper that produces a partial `SceneContractBlock` from existing fields: `goal` from beat description's leading verb-noun, `valueIn`/`valueOut` from `valueShifted` + `lifeValueAxes`, `turningPoint` from beat description's last clause, `crisisChoice` from chapter `purpose` decision verb, `povPersonalStake` from POV character LTWN composite, `opposition` and `outcome` and `consequence` and `choiceAlternatives` left null when planner doesn't supply. Render the block *with whatever exists*; null fields print as `Goal: ?` lines that are visible-but-honest. Keep `causal-motivation-v3`-style upstream prompting available as the source of high-quality fields when fixtures opt in.
- **Expected storytelling benefit**: Word-ratio variance reduced ≥30%; sceneDramaturgy mean rises from ~2.0 to ≥2.5; endpointLanding mean rises from 2.17 to ≥2.5; halluc-ungrounded retry rate drops ≥30% (writer fills less structural under-specification with name-coining).
- **Downstream risks**: V4 Flash compliance ceiling on planner-side prompted contract emission (mitigated: deterministic fallback population doesn't depend on planner compliance). Writer over-mechanizes (mitigated: render contract as guidance, keep beat description as primary creative brief, partial-fill is honest about gaps). Per-beat checker scope mismatch (mitigated: L098's obligation-keyed routing already handles this for findings; checker calls remain at beat scope until next lane).
- **How to test it cheaply**: Build a writer-undershoots fixture set (5 fixtures with baseline ratio ≤1.0, 5 with ratio ≥1.5, all with pre-resolved halluc entities so plan-assist gates don't bail). Run `scripts/test-drafting-isolated.ts` with `--plan-from` to hold plans constant; arm A = no-contract-render, arm B = contract-render-with-deterministic-fallback. N=10 chapters each. Cost <$1.
- **What data would prove value**: Word-ratio variance reduction ≥30% on N=10; sceneDramaturgy mean ≥2.5 (vs baseline ≤2.0); endpointLanding mean ≥2.5 (vs baseline 2.17); halluc-ungrounded retry rate reduction ≥30%; no semantic-review low-finding regression; no checker-blocker class introduced. **All five must hit** for promotion.
- **What should remain unchanged**: `prose-writer-system.md`, `beat-writer-system.md`, all checker prompts, ApprovalPolicy, manual-review default, `thread-character-context-v1` capsule rendering (already L094-default), halluc-ungrounded prompt, functional-state-checker prompt, F-layer ID substrate, world-bible/character-profile schemas, lint surface, integrity loops.

### Recommendation R2: Ship `scene-shape-checker` (J1 + J2 from semantic-judge plan) as warning-class on prose

- **Layer optimized**: E (consumes calibrated planner-discernment infrastructure, applies to prose).
- **Exact proposed change**: Add `scene-shape-checker` agent under `src/agents/`. Two judges per chapter: J1 (endpointLanding) on chapter's last 250 words against chapter's `endpoint_action` (or `purpose` if endpoint not split), J2 (sceneDramaturgy) on each scene-call block of prose against the scene contract `goal`/`turningPoint`/`crisisChoice`/`outcome`. Use existing `direct-label` shape (cheaper, 100% exact in calibration) with abstain on missing input. Wire ENDPOINT-0 / SCENE-0 as **warning-class** findings only; route through Plan Readiness, not rewrite. Promote to blocker only after operator labels confirm precision ≥0.85 at level-0 boundary on N=50 prose excerpts.
- **Expected storytelling benefit**: First runtime measure of "does the prose actually turn / land?". Operator visibility into which chapters fail dramatically (vs passing structural validation). No reader-visible delta on its own; pairs with R1 to lift quality on rewrite path.
- **Downstream risks**: Judge over-fires at level-1 boundary on real prose (mitigated: warning-class only; user memory says don't calibrate noisy LLM checkers). Saturation at level-2 ceiling makes the judge useless for "good vs great" (acceptable; the judge is for "broken vs adequate"). Cost creep across all chapters (mitigated: $0.02/chapter at N=50 = $1 total; cheap).
- **How to test it cheaply**: Run J1 + J2 against the existing 5 sampled chapters (Maret, Maren ×2, Sylvie, Noor) plus 2026-05-10 fantasy-healer ch1+ch2. Manually label "lands consequence" / "turns" yes/no per scene. Compare label vs prediction. Cost <$0.20.
- **What data would prove value**: J1 precision ≥0.85 on LANDS_NO/LANDS_YES boundary on N=50 operator labels; J2 precision ≥0.85 on TURN_NO/TURN_YES boundary on N=50; >40% of harness chapters fire at level-0/level-1 (problem is real and non-rare); rewrite-loop lift ≥60% out of level-0 bucket on next pass.
- **What should remain unchanged**: All existing checkers, their thresholds; writer prompts; ApprovalPolicy; manual-review default; lint loops; integrity loops; F substrate.

### Recommendation R3: Make `chapter_endpoint_action` and `chapter_forward_pressure` required schema fields

- **Layer optimized**: A (with rendered ripple to B).
- **Exact proposed change**: Modify `chapter-outline-system.md` and the chapter skeleton schema to require two fields beyond current `purpose`: `endpoint_action` (one observable action or decision the chapter must enact in its closing) and `forward_pressure` (one specific reader question the endpoint generates). Render both verbatim into the writer prompt as `CHAPTER ENDPOINT TARGET:` and `CHAPTER FORWARD PRESSURE:` at the writer's last-beat scope. Run J1 (endpoint-landing) at validation. Keep `purpose` as advisory.
- **Expected storytelling benefit**: Eliminates "chapter ends on stated decision or mood" failure (CFA-v1 named regression). Endpoint-landing mean ≥2.5 (vs current 2.17). Symptom 2 (endpointIssues=2) drops to 0 on disposable runs.
- **Downstream risks**: Forces some chapters into endpoint-action that organically wanted interiority (mitigated: allow `endpoint_action` to be an interiority decision explicitly — "Maret resolves to confront the Arbiter at dawn" both is interiority and is forward action). Required schema fields cause migration pain (mitigated: optional first, then required after 2 weeks of clean planner emission).
- **How to test it cheaply**: One A/B against the existing fantasy-healer 2-chapter run. Re-plan with new schema; redraft. Measure: J1 endpoint label on chapter-1 last 250 words; deterministic `endpointIssues` count; operator side-by-side preference. Cost <$0.50.
- **What data would prove value**: J1 endpoint-landing mean ≥2.5 (vs baseline 2.17); zero `endpointIssues` deterministic flags (vs baseline 2); operator side-by-side preference ≥2:1 for new-schema arm; no word-ratio regression.
- **What should remain unchanged**: Existing plotter structural priors (STASIS = DEATH, midpoint reversal); `purpose` field continues to exist as advisory; chapter target words; writer system prompt; checker layer (other than adding J1).

### Recommendation R4: Author the writer-undershoots fixture set per the 2026-05-09 retro follow-up

- **Layer optimized**: support / fixture engineering (preconditions for R1).
- **Exact proposed change**: Author 10 disposable fixture seeds intentionally shaped to produce baseline writer ratios <1.0 (i.e., undershoot target). Pre-resolve all named entities (officers, NPCs, locations, items) so halluc-ungrounded plan-assist gates never bail. Tag fixtures with seed metadata: `expectedBaselineRatio`, `seedComplexity`, `entityRichness`. Persist in `docs/fixtures/scene-first/writer-undershoots/`. Author 5 over-target companions for variance testing.
- **Expected benefit**: R1's evidence gate becomes runnable. The 2026-05-09 Slice 2.5 inconclusive A/B doesn't repeat.
- **Downstream risks**: Fixture authoring is a 4–6 hour task. Risk: fixtures are not representative of real production seeds (mitigated: sample 5 of the 10 from real production novel concepts that historically undershot).
- **How to test it cheaply**: Run 1 chapter per fixture, no A/B, just to verify each fixture produces the expected baseline ratio. Cost <$0.50.
- **What data would prove value**: ≥7 of 10 undershoot fixtures produce baseline ratio ≤1.0; ≥4 of 5 over-target fixtures produce ratio ≥1.5; no halluc-ungrounded plan-assist gate bails on any fixture in baseline arm.
- **What should remain unchanged**: production planner, writer, checker behavior; only adds disposable fixtures.

### Recommendation R5: Hold A's CFA-v1 strategy packet as opt-in seed metadata; do not run an independent A lane

- **Layer optimized**: A (process discipline).
- **Exact proposed change**: Keep `commercial-fantasy-adventure-v1.md` strategy-packet structure available as opt-in seed enrichment, but do not promote it as default planner input or run an independent CFA-v2 cohort during the B lane. Allow individual disposable fixtures (R4 above) to seed strategy packets when needed for variance.
- **Expected benefit**: Resources concentrated on B lane; A's mixed cohort signal (50% win rate, endpoint regression) doesn't compete for primary attribution; A runs as natural feeder to B without becoming a separate measurement.
- **Downstream risks**: User memory ("world-bible architecture priority") and CL-7 ("structure work is under-applied") prefer some A movement (mitigated: A is shadowed, not frozen — it stays available).
- **How to test it cheaply**: No experiment. Process commitment.
- **What data would prove value**: Post-B lane retrospective shows the lane closed without confounded attribution between A and B.
- **What should remain unchanged**: existing CFA-v1 fixture infrastructure; CFA-v1 cohort scripts; method-pack-planner-cohort runner; all are diagnostic-only.

### Recommendation R6: Author 6–8 named NPCs per disposable fixture's character bible

- **Layer optimized**: C (preconditions for R1's halluc-retry-rate metric).
- **Exact proposed change**: For the writer-undershoots fixture set (R4), author each fixture's character bible with 6–8 named non-POV characters covering the chapter's scene situations: a senior commander, a quartermaster, a lead medic, a named prisoner, a runner, etc. Provide proper names, voice fields, relationships, exampleLines, role.
- **Expected benefit**: Halluc-ungrounded retry rate metric in R1 becomes meaningful (writer not retrying on unavoidable name-coining). Symptom 6 isolated from the B test.
- **Downstream risks**: Test bibles may be richer than typical production bibles (acceptable — we want to measure B without C-noise).
- **How to test it cheaply**: Folded into R4. Marginal cost.
- **What data would prove value**: Halluc-ungrounded retry rate on baseline arm of fixtures with rich bibles is <2/chapter (vs 4–8/chapter on fantasy-healer baseline).
- **What should remain unchanged**: production world-builder/character-agent prompts; only fixture-side authoring.

### Recommendation R7: Defer F-layer changes; reserve traceability work for post-lane review

- **Layer optimized**: F (process discipline).
- **Exact proposed change**: No F changes during the B lane. After B closes, audit whether B's scene-contract field-by-field rendering needs new ID kinds (e.g., `crisisChoiceId`, `valuePolarityId`). Today's evidence says it does not.
- **Expected benefit**: Avoids substrate-tweaking churn while B's measurement is in flight.
- **Downstream risks**: A B failure-mode requires a new ID type and we can't add it mid-lane (mitigated: B's existing `sceneId` + `obligationId` substrate is comprehensive; gap unlikely).
- **How to test it cheaply**: No experiment. Process commitment.
- **What data would prove value**: Post-B retrospective shows no F-shaped change was needed during the lane.
- **What should remain unchanged**: All F substrate (`sceneId`, `beatId`, `obligationId`, `threadId`, `promiseId`, `payoffId`, `llm_calls.scene_id`).

---

## Closing note on disagreement with prior Opus artifacts

The Opus harness autopsy (`opus-harness-autopsy.md` §5) lists R1 = "Promote scene contract into the default writer prompt path" as the top recommendation. This artifact agrees and extends: **B is the bottleneck, not just the top recommendation.** The autopsy's R2 (wire calibrated judges as runtime checkers) and R3 (structured chapter endpoint) become R2/R3 here too, with the explicit posture that R2 is post-B and R3 is the only A-lane work that should run in shadow.

The Opus method-pack candidates artifact (`opus-method-pack-candidates.md`) recommends 7 new method packs. **This artifact disagrees with treating that as the next lane.** Method packs are A-layer work; A-layer work alone has been tested (CFA-v1) and showed mixed-with-regression evidence. Method packs become valuable *after* B ships, when scene-contract field population gives them somewhere to land. Adding more method packs before B is solving the upstream input problem when the downstream pipe is the constraint.

The Opus semantic-judge plan (`opus-semantic-judge-plan.md`) is excellent and is the natural follow-on lane. Its J1/J2/J3 wire as warning-class checkers in R2 above. Promoting them before B ships would measure plans/prose that don't have scene shape.
