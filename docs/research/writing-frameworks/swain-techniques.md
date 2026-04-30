# Techniques of the Selling Writer — Dwight V. Swain (1965)

**Research report for the novel-harness project. Focus: operational rules that map to the Drafting and Validation phases at beat granularity.**

## 1. Framework summary

Dwight V. Swain's *Techniques of the Selling Writer* (University of Oklahoma Press, 1965; reprinted 1981) is the most mechanical scene-construction manual in the English-language craft canon. Swain treats fiction not as inspiration but as a series of cause-and-effect units that the reader's nervous system processes in a fixed sequence: stimulus arrives, the viewpoint character reacts, the reader feels the reaction in their own body, the next stimulus arrives. The book's distinguishing feature is that almost every rule is reducible to a structural tag — Goal/Conflict/Disaster, Reaction/Dilemma/Decision, Motivation/Reaction — and is therefore amenable to deterministic checking. Swain's claim, repeated throughout the book, is that pulp and pre-pulp slick-magazine professionals worked from this skeleton consciously and that the apparent variety of "good fiction" is built on a small number of these primitives stacked at different scales. The book is divided roughly into halves: the first half develops the building blocks (motivation-reaction units, scenes, sequels); the second half develops larger structures (story plan, beginning, middle, end, the publishing business). For our harness, only the first half is load-bearing; it is the most prescriptive single source we have for what should happen at the paragraph and scene level.

## 2. Scene structure: Goal / Conflict / Disaster (GCD) and Sequel: Reaction / Dilemma / Decision (RDD)

Swain's most-quoted contribution is the bipartite structure: a scene (large-S "Scene" in his terminology) and the reflective passage that follows it (a "Sequel"). These are not metaphors; they are operational definitions with specific opening and closing requirements.

### 2.1 The Scene proper — Goal / Conflict / Disaster

A Swain Scene begins with an explicit, immediate **Goal** held by the viewpoint character. The goal must satisfy three properties to count: (a) **concrete** — testable from outside the character's head, with a yes/no outcome that the reader can score; (b) **time-bounded** — it must be pursued within the duration of the present scene, not "someday" or "across the novel"; (c) **possessive of clear opposition** — without a force resisting it, there is no scene. Swain's own example (p. 86 of the 1981 reprint) is "Bill must reach Reno before Maggie testifies." Bill's larger ambition (winning her back, getting custody, etc.) is not the scene goal. The scene goal is *get to Reno before Maggie takes the stand*.

**Conflict** is the second movement. Conflict is not the global antagonist; it is the local opposition the viewpoint character encounters within this scene while pursuing this goal. Swain insists conflict be externalized — visible in dialogue, action, environment, or another character's resistance. Internal conflict alone, in his view, belongs in a Sequel, not a Scene. The conflict must be proportional: trivial obstacles produce trivial scenes, no matter how elegantly written.

**Disaster** is the closing movement and is non-negotiable. A Scene that ends with the viewpoint character better off than at the opening is, in Swain's framework, *not a Scene*. He gives three permissible disaster shapes: (i) **outright failure** — the goal is denied; (ii) **partial success at higher cost than anticipated** — the goal is technically obtained but the price tag changes the strategic landscape (e.g., Bill reaches Reno but is now wanted for assault); (iii) **new complication** — a fresh obstacle arises that subordinates the original goal (e.g., Bill reaches Reno and discovers Maggie has already testified and named him as the murderer). In each case, the scene ends at a worse local equilibrium than its opening. Swain's argument is psychological: the reader is conditioned to keep reading by the worsening state, and a scene that ends "well" closes the energy loop and dismisses the reader.

### 2.2 The Sequel — Reaction / Dilemma / Decision

A Sequel processes the disaster. It has three movements that Swain insists run in order:

- **Reaction**: an emotional response to the disaster. Visceral first (gut, breath, vision), feeling next (named emotions: rage, despair, humiliation), thought last (abstract reflection). Swain explicitly orders these from body to mind. A reaction that begins at "thought" violates how nervous systems process shock and reads as cold to the reader.
- **Dilemma**: the character's logical inventory of bad options. This is the slowest part of the manuscript by design — Swain calls it "review." The character, having reacted, now thinks through the situation and finds that all available courses of action are unattractive. If there is an obviously good move, there is no dilemma and no sequel.
- **Decision**: a forced choice among the bad options, producing a new goal. The decision is the bridge: it terminates the sequel and *defines the goal of the next scene*. Without this terminal step, the sequel does not advance the novel.

A key Swain observation: sequels can be compressed to a single sentence ("He cursed and turned the truck north") or expanded to a full chapter, and the proportional weight should reflect the magnitude of the disaster. Tiny disasters get tiny sequels. Catastrophic disasters get long sequels. A novel that gives equal sequel weight to every disaster reads as flat.

### 2.3 Tagging beats

Our harness writes beats, not Swain-Scenes. A typical Swain Scene spans 3–8 of our beats; a Sequel spans 1–4. This means each beat carries a *role* within the parent Scene/Sequel, and the role is encodable as a tag. A tagging schema:

| Tag    | Role                                                                |
| ------ | ------------------------------------------------------------------- |
| `G`    | Scene-opening — establishes the goal                                |
| `C`    | Conflict beat — opposition is met and engaged                       |
| `D`    | Disaster beat — the closing reversal                                |
| `R`    | Sequel — visceral/emotional reaction                                |
| `Dl`   | Sequel — dilemma; bad-options review                                |
| `Dc`   | Sequel — decision; produces next scene's goal                       |
| `T`    | Transition — connective tissue (Swain calls these "narrative summary"; they are minimal and cheap) |

A well-formed Scene-Sequel sequence at beat level reads as a regex-like pattern: `G C+ D R Dl Dc` (the `C+` indicating one or more conflict beats), with optional `T` interleavings. The harness's chapter-plan-checker can validate that each chapter contains this shape; deviations are flag candidates. Empirically, planning-plotter's current output already approximates `G C C C D` at the chapter scale but rarely emits sequels — this is one of the highest-impact gaps Swain exposes.

## 3. Motivation-Reaction Units (MRUs)

Swain's most lint-friendly contribution is the **Motivation-Reaction Unit**: every paragraph (or near-paragraph) within a scene alternates between an external **Motivation** — something happening in the world — and an internal **Reaction** — what the viewpoint character does in response. The pair is the unit. Skipping the motivation or the reaction breaks reader cause-and-effect.

### 3.1 The strict ordering rule

Within a Reaction, Swain imposes a fixed sub-order which is the single most operational rule in the book:

1. **Feeling** — autonomic, pre-conscious. Heat, cold, breath, vision tunneling, nausea. In prose: "His stomach knotted."
2. **Reflex action** — involuntary motor response. Flinching, recoiling, eyes closing.
3. **Rational action and speech** — deliberate output. Words, decisions, weapons drawn.

The order is: **feeling → reflex → action/speech**. Reversing the order — having the character speak before feeling, or act before flinching — flattens the prose because the reader's own body cannot follow. Swain (p. 36, 1981 reprint) gives a violation example: *"Bill jerked away. The slap stung."* The slap (motivation) comes after Bill's reflex — illegal. The corrected version: *"The slap stung. Bill jerked away."*

### 3.2 Encodable as a lint rule

Within a paragraph, identify:

- **Motivation marker**: a clause describing an external event with the viewpoint character as observer or recipient (sensory verbs: heard, saw, felt + external subject).
- **Reaction marker**: a clause with the viewpoint character as subject performing internal or external response (cognitive verbs, motor verbs, dialogue).

A regex/AST checker can verify:

- (a) Each paragraph contains at least one of each, OR is explicitly a sequel-mode paragraph (extended reaction).
- (b) The motivation precedes the reaction within the paragraph.
- (c) Inside the reaction, body-state language precedes deliberate-action language.

This is genuinely tractable; it is roughly equivalent to a parts-of-speech / dependency-parse check + a small list of body/reflex vocabulary. The harness's existing lint set has nothing like this; adding it would be a step-change in adherence to genre cadence.

### 3.3 Common MRU violations

Swain lists several:

- **Telegraphing**: the reaction precedes the motivation ("She winced as the door slammed"). Swain wants "The door slammed. She winced."
- **Invisible motivation**: a reaction occurs without a stated stimulus; the reader infers but is jarred. Common in rushed drafting.
- **Dropped reaction**: a stimulus arrives and the viewpoint character does not visibly process it, breaking POV intimacy.
- **Out-of-sequence reaction**: rational action precedes feeling (the character speaks an articulate line *before* their stomach knots). Often a sign of insufficient draft revision.

Each of these is a lint candidate.

## 4. Self-editing rules — *not applicable to Swain*

Swain does not provide a sentence-level editing rubric of the Browne-King variety. He stops at the MRU level. See the companion report `self-editing-browne-king.md` for that layer.

## 5. Concept/planning prescriptions

Swain is weak here; the book's planning chapters ("Plotting," "Story Planning") essentially say *generate a series of Scene-Sequel pairs whose disasters escalate*. There is no method for choosing the premise, building the world, or developing characters beyond one-line "tag plus trait" sketches (the so-called Swain tag — a physical or behavioral signature attached to a character so the reader keeps them straight). Note this briefly: at the planning layer, Swain contributes *the structural target* (chapters should decompose into Scene-Sequel pairs) but not *the content selection*. Our planning-plotter does the latter; what Swain offers is a constraint to add to its output schema.

## 6. Drafting-phase prescriptions

The operational rules a beat-writer prompt could enforce, distilled from chapters 1–6 of the 1981 reprint:

### 6.1 Scene-level (when writing a beat that opens a Scene)

- Open with a **stated goal** in the viewpoint character's head within the first 1–3 sentences. The goal must be concrete enough that a reader can ask "did they get it?" by scene end.
- Mark the goal so the rest of the scene can score against it (a planner annotation like `scene_goal: "reach Reno before testimony"` propagated to the writer).
- Establish **opposition** before the midpoint of the scene. If three beats elapse with no visible opposition, the scene is drifting.

### 6.2 Beat-level (every beat)

- **Lead with motivation**, not reaction. Open beats with an external stimulus (sensory or environmental) before any internal reflection.
- **Pair every motivation with a reaction**, in feeling → reflex → action/speech order.
- **No paragraph without a viewpoint anchor**: every paragraph has either the viewpoint character observing something or reacting to it. "Camera-floating" paragraphs (free indirect description with no anchor) are a Swain violation.
- **Conflict pressure** — for `C`-tagged beats, the opposition must materially worsen the goal-state vector. A `C` beat where nothing has changed is a stall.
- **Disaster commitment** — the `D` beat must close at a worse equilibrium. The writer prompt for `D` beats should include the explicit instruction: *the viewpoint character is in worse strategic position at the end of this beat than at its start*.

### 6.3 Sequel-level beats

- **Order reaction body-first**: feeling, then reflex, then thought. The writer prompt for `R` beats should include autonomic-language priming.
- **Dilemma beats must enumerate at least two unattractive options** before the decision. A dilemma with one option is not a dilemma.
- **Decision beats must produce a new goal** stated in the viewpoint character's head. The next scene's goal is the output of the decision beat.

### 6.4 Dialogue inside scenes

Swain treats dialogue as a kind of motivation/reaction stream — each character's line is a stimulus to the other, and each response is a reaction. The same ordering rules apply. He also calls out **"on-the-nose" dialogue** (characters saying exactly what they mean) as flat; he wants oblique, intentional dialogue. This is the only point where Swain anticipates Browne-King territory.

### 6.5 Operational checklist (for direct injection into a beat-writer prompt)

```
For each beat, in order:
1. Does the beat carry a Scene-Sequel tag (G/C/D/R/Dl/Dc/T)?
2. If G: state the viewpoint character's goal explicitly in the first 1–3 sentences.
3. If C: introduce opposition that materially worsens the goal-state.
4. If D: close at a worse equilibrium (failure, costly partial, new complication).
5. If R: open with body, then reflex, then thought; do not begin with rational action.
6. If Dl: enumerate at least two unattractive options in the viewpoint character's head.
7. If Dc: produce a new goal that becomes the next G-beat's input.
8. Every paragraph leads with motivation, follows with reaction.
9. Inside each reaction, feeling precedes reflex precedes deliberate action.
10. No paragraph without a viewpoint anchor.
```

## 7. Validation/checking prescriptions

This is where Swain converts most directly to harness checkers. Each rule above is a lint-class candidate.

### 7.1 Hard structural checks (deterministic — Tier-1 lint)

- **Scene-Sequel tag presence**: every beat in `outline.scenes` carries a Swain tag. Missing tags fire on the planner output, not the writer.
- **Per-chapter beat shape**: the beat tag sequence within a chapter approximates `(G C+ D)(R Dl Dc)?` allowing for `T` interleaving. Deviations flag for human review (a chapter that is all conflict, no disaster, no sequel is suspect).
- **Disaster equilibrium check**: the closing sentence(s) of a `D`-tagged beat reference a worsening (lexical signals: "but," "however," "instead," negation patterns, "too late," costly-success markers). A `D` beat whose closing sentence is positive in sentiment is a strong candidate for rewrite.
- **Goal-statement check**: a `G`-tagged beat's first 50 tokens contain a goal predicate (modal + action: "must reach," "had to find," "needed to convince," etc.). Absent → flag.
- **Decision-statement check**: a `Dc`-tagged beat's last 50 tokens contain a goal predicate that becomes the next `G`-beat's stated goal. This is verifiable as a forward-link: tag the produced goal and check it is the input to the next Scene.

### 7.2 Paragraph-level MRU checks (small-LLM checker — Tier-2)

- **Lead-with-motivation**: each paragraph's first sentence contains an external-stimulus marker (sensory verb with non-viewpoint subject, environmental description, or another character's action). Internal-thought-only openers flag (acceptable in sequels, suspect in scenes).
- **Pair-completeness**: each paragraph contains both a motivation and a reaction beat. Solo-motivation paragraphs (description without response) flag in scene mode.
- **Body-first reaction order**: within a reaction, autonomic vocabulary ("his stomach knotted," "her breath caught," "vision tunneled") precedes motor vocabulary ("he flinched," "she stepped back") which precedes deliberate-action vocabulary ("he said," "she drew her sword"). A reaction that begins at deliberate-action without prior body or reflex flags. This is a small-LLM call shaped like a 3-class classifier: read the paragraph, identify the reaction sub-clauses in order, return body-position / reflex-position / action-position indices, fire if any inversion.

### 7.3 Sentence-level checks (regex / lint — Tier-1)

- **Reversed cause-and-effect**: "X happened *as* Y" or "X did Y *as* Z happened" — `as`-clauses where the dependent action precedes the trigger. Swain's #1 telegraphing pattern. Add to lint set.
- **Pre-stimulus reaction**: "She winced. The door slammed." — reaction sentence followed by stimulus sentence that should have preceded it. Detectable by: short reaction sentence + immediately-following past-tense external event.
- **Free-floating description**: paragraphs of pure description (no viewpoint character verb, no reaction) longer than ~3 sentences in scene mode. Sequel mode tolerates more.

### 7.4 Cross-beat checks (chapter-plan-checker — Tier-3)

- **Scene-end equilibrium delta**: track the viewpoint character's goal-state across consecutive beats; verify the delta is negative across the closing `D` beat.
- **Sequel-presence check**: a chapter with multiple `D` beats and no `R/Dl/Dc` beats between them is a flat-affect chapter (the reader gets no processing time). Flag for human review.
- **Decision-to-goal continuity**: the `Dc` beat's produced goal must match the next chapter's opening `G` beat's stated goal. A continuity break here is a higher-impact bug than most existing checks catch.

### 7.5 The patterns Swain explicitly calls out as wrong

Compiled from chapters 2 ("The Words on the Page"), 3 ("Plain Facts about Feelings"), and 4 ("Conflict and How to Build It"):

- **Telegraphing** — reaction before stimulus
- **Invisible motivation** — reaction without stated stimulus
- **Out-of-order reaction** — speech or rational action before body
- **Static scene** — opposition without escalation
- **Resolved scene** — disaster missing or replaced with success
- **Floating viewpoint** — paragraphs with no viewpoint anchor
- **One-option dilemma** — sequel collapse
- **Decision drift** — sequel terminates without producing the next goal
- **On-the-nose dialogue** — characters speaking precisely their literal intent without subtext
- **Adverb-loaded attribution** — "she said angrily" carrying the emotional weight that should be in the action; Swain (p. 197) hates these. Lint candidate.
- **Stage-direction overload** — extended physical blocking that displaces motivation/reaction. Lint candidate via paragraph profile.

## 8. Programmatic levers (15-25 each — for the autonomous harness loop)

Each lever below is a candidate knob in the writing/checking sub-loops. Format: name — type — surface.

1. `swain.scene_goal_required` — bool — planner constraint; `G` beats must declare `scene_goal` field.
2. `swain.disaster_required` — bool — planner constraint; every Scene must contain a `D` beat.
3. `swain.sequel_min_beats` — int (0–3) — planner constraint; minimum sequel beats per disaster.
4. `swain.sequel_after_disaster_pct` — float (0–1) — planner constraint; fraction of disasters followed by a sequel.
5. `swain.beat_tag_schema` — enum — `{none, GCDRDlDcT, GCDR, custom}` — schema applied to outline.scenes.
6. `swain.mru_lead_with_motivation` — bool — writer prompt directive.
7. `swain.mru_body_first_reaction` — bool — writer prompt directive.
8. `swain.mru_pair_completeness_check` — bool — small-LLM checker call.
9. `swain.mru_order_check_model` — enum — `{regex_only, qwen3-1.7b, qwen3-4b, deepseek}` — model to run the order check.
10. `swain.disaster_equilibrium_check` — bool — lint check on `D`-beat closing sentence sentiment.
11. `swain.goal_statement_check` — bool — lint check on `G`-beat opening sentences.
12. `swain.decision_to_goal_link_check` — bool — chapter-plan-checker cross-beat link.
13. `swain.adverb_attribution_lint` — regex — fires on `said \w+ly`.
14. `swain.telegraph_pattern_lint` — regex — fires on `\w+\b\s+as\s+\w+\b\s+(slammed|hit|struck|fell|crashed)`.
15. `swain.on_the_nose_dialogue_check` — small-LLM checker — flag when dialogue line restates subtext literally.
16. `swain.viewpoint_anchor_check` — small-LLM checker — flag paragraphs with no viewpoint-character verb.
17. `swain.dilemma_min_options` — int (0–3) — checker on `Dl`-beat content.
18. `swain.scene_conflict_escalation_required` — bool — checker that successive `C` beats raise stakes.
19. `swain.sequel_proportionality` — heuristic — sequel length as fraction of disaster magnitude.
20. `swain.beat_writer_tag_inject` — bool — pass beat tag into writer prompt header.
21. `swain.tag_inferrer_model` — enum — model that tags untagged plans for retroactive checking.
22. `swain.scene_pacing_max_C_beats` — int — cap on consecutive conflict beats before disaster (a 9-beat conflict run with no disaster is bloat).
23. `swain.tagged_beat_per_chapter_floor` — int — minimum number of explicitly tagged beats per chapter (covers the case where the planner emits all `T`-style narrative summary).
24. `swain.disaster_severity_label` — enum — `{minor, major, catastrophic}` — passed to writer to calibrate sequel weight.
25. `swain.mru_violation_retry_threshold` — int — number of MRU violations per beat that triggers a targeted rewrite.

## 9. Limitations

Swain's framework is **rigid by design** and not every well-functioning scene fits the GCD pattern. Several caveats apply when wiring this into the harness:

- **Sequels are scenes too.** A pure-sequel passage (extended reaction, dilemma, decision over multiple paragraphs) is not a `G C D` shape. Forcing every chapter to contain a Scene proper would break legitimate reflective chapters. The harness should treat a chapter consisting of one Scene + one Sequel as the minimum well-formed unit, not "Scene per chapter."
- **Modern omniscient and lyric prose violate MRU on purpose.** Writers like Cormac McCarthy and Toni Morrison routinely place reflection before stimulus to produce a particular cadence. The harness's target is genre-aligned prose (fantasy, litRPG), where Swain is closer to the productive convention; but the rules should be configurable per `WRITER_GENRE_PACKS` slot.
- **Comedy and slice-of-life subvert disaster.** A chapter whose comedic engine is "things go better than expected" is a legitimate shape; Swain treats it as exception territory. For our fantasy/litRPG target, this is rarely binding.
- **MRU is more violated than honored in published fiction.** Empirical sampling of any modern bestseller will find paragraphs that lead with reaction or skip motivation entirely. The lint rule should be calibrated as a *frequency* check — a chapter whose paragraphs follow MRU 70%+ of the time reads as well-paced; below 40%, the cause-and-effect chain breaks down for the reader.
- **Static scenes have a place.** Set-piece description, ritual, and atmosphere paragraphs are not always disasters-in-waiting. The harness should permit `T`-tagged beats with looser checking.
- **Swain pre-dates close-third interior monologue conventions.** His "rational action and speech" bucket conflates internal articulation and external speech, which Browne-King later separates more crisply. Where there is conflict between Swain and Browne-King at the sentence level, prefer Browne-King for prose checking and Swain for structural checking.
- **Tag-inference is noisy.** Auto-tagging beats from prose alone (rather than from the planner) using a small model will have order-of-10% error rates; the harness should rely on planner-emitted tags wherever possible, treating prose-derived tags as a backup.
- **Rigidity penalizes quiet scenes.** A character-development conversation that happens to lack a hard disaster is not necessarily broken. Swain would rewrite it; modern editors may not. Soft-fail rather than hard-fail.

## 10. Citations

- Swain, Dwight V. *Techniques of the Selling Writer*. Norman: University of Oklahoma Press, 1965; paperback reprint 1981. ISBN 0-8061-1191-7. Page references in this report are to the 1981 paperback reprint.
- Swain develops the Motivation-Reaction Unit primarily in Chapter 2 ("The Words on the Page"), pp. 33–53.
- Scene structure (Goal/Conflict/Disaster) is developed in Chapter 4 ("Conflict and How to Build It"), pp. 73–110.
- Sequel structure (Reaction/Dilemma/Decision) is developed in Chapter 5 ("How to Build a Story"), pp. 111–138.
- Adverb-attribution objection: Chapter 8 ("Plain Facts about Markets"), p. 197.
- The "tag" concept for character signature: Chapter 3 ("Plain Facts about Feelings"), pp. 60–64.

**Companion sources consulted (not cited in body):**

- Bickham, Jack. *Scene & Structure*. Cincinnati: Writer's Digest Books, 1993. Bickham was Swain's student; his book is the most accessible modern restatement of GCD/RDD and is closer to the operational checklist style needed for harness rules.
- Card, Orson Scott. *Characters and Viewpoint*. Writer's Digest Books, 1988. Useful corroboration of the viewpoint-anchor rule.

---

**One-paragraph summary:** Swain's *Techniques of the Selling Writer* gives the harness a near-complete structural ontology at two scales — beats (Motivation-Reaction Units, with the body→reflex→action ordering rule for reactions) and scenes (Goal-Conflict-Disaster, paired with Reaction-Dilemma-Decision sequels). Both are mechanical enough to encode as planner schema constraints, beat-level structural tags, and lint-class regex/small-LLM checkers; the most immediately implementable additions are the GCDRDlDcT tag schema in `outline.scenes`, an MRU-ordering small-LLM checker per paragraph, the telegraphing regex (`\w+ as \w+ slammed|hit|struck`), the adverb-attribution regex (`said \w+ly`), and a chapter-plan-checker cross-beat link from each `Dc` beat's produced goal to the next `G` beat's stated goal. The framework's main limitation is rigidity — quiet scenes, lyric prose, and pure-sequel chapters legitimately violate it — so checks should be soft-fail and configurable per genre pack, not blocking gates.
