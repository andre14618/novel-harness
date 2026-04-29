# Holly Lisle — How to Think Sideways, Notecard System, Plot Clinic

Research report for novel-harness planner architecture. Sources: Holly Lisle's *How to Think Sideways* course (HollyLisle.com / How to Think Sideways LLC), *Holly Lisle's Notecarding: Plotting Under Pressure* (2010), *Holly Lisle's Create A Plot Clinic* (Writers Digest / self-published, 2007), and the constellation of HollyLisle.com articles where she has serialized the methodology since the early 2000s.

## 1. Framework summary

Holly Lisle's body of writing instruction is the most pragmatic, working-novelist counterpart to Snowflake. Where Ingermanson is a process engineer, Lisle is a 30-novel veteran (fantasy, romance, SF) who built her methods empirically, around the constraint of writing fast under deadline while raising kids on novel income. Her frameworks are not one unified system but three interlocking ones — *How to Think Sideways* (the course-length end-to-end novel methodology), *Notecarding* (the plotting-under-pressure technique), and *Create A Plot Clinic* (a structural-troubleshooting handbook for broken plots). They share a common substrate: **iterative expansion under conservation**, with explicit decision-deferral as a feature, and with the writer's *intuition* given a load-bearing role rather than designed out.

The unifying philosophy is "write the novel you want to read," operationalized as: discover the *shape* of the book before committing to scenes, then commit to scenes only when you can feel the shape under them. Lisle is suspicious of pure outlining (which she calls "writing the book twice"), but equally suspicious of pure pantsing (which she has burned years of novel-time on). Her solution is iterative expansion — but the expansion is shorter, looser, and more author-intuitive than Snowflake's, and the conservation invariants are softer (semantic rather than syntactic). Notecarding in particular is designed to be done in a single afternoon, on a pile of physical 3×5 cards, and to be *thrown away or rearranged* freely. The method assumes high-frequency revision of the plan during drafting.

The three methods stack: *How to Think Sideways* covers concept through draft. *Notecarding* is the chapter/scene planning module within HTTS, deployable standalone. *Plot Clinic* is the diagnostic/repair module, deployable when a planned or drafted novel goes wrong. Lisle's frameworks are heavily used in the indie / self-published / "career writer" community and have probably influenced more working novelists in the 2000s-2020s than any academic methodology, though Lisle herself avoids the academic register.

## 2. Iterative expansion architecture

Lisle's expansion has fewer named layers than Snowflake but more layers in practice, because each layer is iterated multiple times before progressing.

### Layer 1 — The Sentence

- **Input:** The author's "what if" — the seed idea, possibly a dream, a news article, a "what if magic worked like this."
- **Output:** A single sentence. Lisle's sentence is *not* Ingermanson's logline. Hers is closer to an emotional-stakes statement: "A girl who has never been allowed to leave her village discovers her village is not a village." The sentence captures the **promise to the reader** — the implicit emotional contract.
- **Time budget:** can take days; Lisle says rewrite the sentence dozens of times until it makes you want to write the book.
- **Lisle's three sentence requirements** (from *How to Think Sideways* lessons 2-3):
  1. **Conflict.** The sentence must imply someone wants something and something opposes them.
  2. **Specificity.** Not "a girl who is special" — "a girl whose dreams predict deaths."
  3. **Hook.** It must make the writer want to keep going. The hook test is the writer's own *want-to-read* response, not a market-research proxy.
- **Locked after this step:** The promise. The implicit emotional contract.
- **Allowed to change:** Everything else, but the sentence is the canonical reference for "is this still the same book?" throughout drafting.

### Layer 2 — The Paragraph

- **Input:** The sentence.
- **Output:** A paragraph (~100-150 words) that expands the sentence into the rough shape of the story. Includes the protagonist, the antagonist or antagonistic force, the central conflict, the world's distinguishing weirdness, and the tone.
- **Lisle is less rigid than Ingermanson here.** She does not demand three disasters. She demands that the paragraph "feel like the book" — same voice, same emotional register, same sense of stakes.
- **Locked after this step:** The protagonist's identifying feature, the antagonist's identifying feature, the world's defining weirdness, the tone.
- **Allowed to change:** Plot specifics, secondary characters, scene-level events.

### Layer 3 — The Page (the "Sketch")

- **Input:** The paragraph.
- **Output:** A one-page sketch (~500 words) of the story as the author currently sees it. Lisle calls this "telling yourself the story." Written in author-voice (not narrative voice), present tense, prose-paragraph form. Includes "I'm not sure yet" annotations and "this might be where" speculation.
- **Locked after this step:** The story's broad shape — beginning, middle, end — and the major emotional turns.
- **Allowed to change:** Specific scenes, specific causality between turns.

### Layer 4 — The Plot Skeleton (or "Plot Skeleton" worksheet from Plot Clinic)

- **Input:** The page sketch.
- **Output:** A structured skeleton with named slots. The Plot Clinic skeleton fields are roughly:
  1. **Opening conflict.** What is wrong on page one?
  2. **Inciting event.** What forces the protagonist to act?
  3. **Try/fail cycles.** Three to five attempts to solve the problem, each failing in a way that makes the protagonist's situation worse and reveals new information.
  4. **The bottom.** The all-is-lost moment.
  5. **The leap.** The protagonist's commitment to a new approach that requires personal change.
  6. **The triumph (or tragedy).** The resolution.
  7. **The closing image.** What does the world look like after?
- **Locked after this step:** The structural spine — the seven slots above.
- **Allowed to change:** Scenes, settings, secondary characters, sequence of revelations.

### Layer 5 — Sentence Lights (or "Bright Lights")

This is a Lisle-specific intermediate layer that has no Snowflake analog. From the page-sketch and skeleton, the writer extracts a list of **scenes I cannot wait to write** — the high-emotion, high-stakes, vivid scenes that pulled the writer to the project. Lisle calls these "sentence lights" or "bright lights" in different lessons. They get written down on individual notecards (transitioning into Layer 6).

- **Input:** The page sketch, the plot skeleton, the writer's emotional response to the project.
- **Output:** A pile of 10-30 notecards, each describing one scene the writer is *excited* to write.
- **Locked after this step:** The emotional anchors of the book. These scenes will all appear in the final draft.

### Layer 6 — Notecarding (the canonical Lisle planning artifact)

This is the heart of the *Notecarding* book and the central mechanic of Lisle's planning. It is a physical-card system that maps directly onto a digital data structure.

- **Input:** Bright-light cards (Layer 5) + plot skeleton (Layer 4).
- **Output:** A full deck of notecards, one per scene, ordered into the rough sequence of the book.
- **Each card has, on the front:**
  - **Scene title** (a short phrase, not a chapter title).
  - **POV character.**
  - **The scene's purpose** — Lisle says one of three: *introduce, complicate, or resolve*.
  - **Setting.**
  - **Major event or discovery in this scene.**
- **Each card has, on the back:**
  - **What changes** (in a character's knowledge, position, or emotional state) by end of scene.
  - **Causal connection to next card** — why does what happens here force what happens next?
  - **What's at stake** in this scene.

- **Notecarding process (Lisle's afternoon procedure):**
  1. Write all the bright-light cards first.
  2. Spread them on the floor.
  3. Add cards for **structural slots from the skeleton** — opening, inciting event, low point, leap, triumph.
  4. Identify the *gaps* — places where the causal chain breaks. Add cards to bridge the gaps.
  5. Rearrange until the sequence "feels right" — Lisle's intuitive test, but operationally: each card's "what changes" should set up the next card's "what's at stake."
  6. Discard cards that don't earn their place (a card that doesn't change anything, or whose change doesn't motivate the next card).

- **Locked after this step:** The scene sequence, the per-scene POV, purpose, and stakes.
- **Allowed to change:** Specific dialogue, sensory detail, exact prose.

### Layer 7 — Scene drafting

- **Input:** One notecard at a time.
- **Output:** The scene's prose draft.
- **Lisle's per-scene drafting prescriptions** (from HTTS and *Mugging the Muse*):
  - Re-read the previous scene's last page before starting.
  - Read the current scene's notecard front and back.
  - Write the scene without referring back to the notecard mid-draft (the card is fuel, not a checklist).
  - Stop when the scene is *done*, not at a word count — the scene's "what changes" has occurred.
  - Annotate the card with what *actually* happened (which often differs from the plan).

### Plot Clinic — diagnostic layer (orthogonal, used at any stage)

*Create A Plot Clinic* is not a sequential expansion — it's a diagnostic toolkit invoked when any of Layers 1-7 produces something the writer recognizes as broken. It contains:

- **Symptom-based diagnosis tables** ("the middle sags," "the protagonist is passive," "the stakes feel low").
- **Surgery exercises** — concrete rewriting protocols for each diagnosed pathology.
- **The "interrogate the conflict" worksheet** — a ladder of "why does this matter?" questions until the writer hits a real-stakes answer.

## 3. Per-step coherence rules (conservation invariants)

Lisle's invariants are softer than Ingermanson's — more semantic, less structural — but they exist:

- **Sentence → Paragraph:** The paragraph must conserve the sentence's *promise*. If the sentence promises "a girl who has never been allowed to leave her village discovers her village is not a village," the paragraph must conserve the village-illusion conflict. The paragraph may add the antagonist and the world-weirdness but cannot pivot to a different promise.
- **Paragraph → Page:** The page must conserve the paragraph's tone, protagonist identity, and central conflict. The page may add specific events, secondary characters, and obstacle-types but cannot change the antagonist's nature or the world's weirdness.
- **Page → Skeleton:** The skeleton's seven slots must each be filled in a way the page-sketch implies or anticipates. The opening conflict slot must match the page's opening; the inciting event must be the event the page identifies as such; the bottom and the leap must be the emotional turns the page anticipates.
- **Skeleton → Bright Lights:** Bright-light scenes must dramatize at least one of the seven structural slots, OR must be load-bearing enough on their own that the skeleton accommodates them. Lisle is firm that "scenes you're excited to write" are non-negotiable but the skeleton must flex to include them.
- **Bright Lights + Skeleton → Notecards:** Every structural slot must have at least one card. Every bright-light scene must appear on a card. The card sequence must causally chain — each card's "what changes" must logically motivate the next card's "what's at stake."
- **Notecards → Drafted scenes:** The drafted scene must produce the card's "what changes." If it doesn't, the scene is broken (per Lisle, the failure is usually that the scene's stakes are wrong, and the fix is to revisit the card's back, not to push through the prose).

The notecard's *causal connection to next card* is Lisle's most operationally rigorous invariant. It's a per-card check that the next card cannot exist without this card's outcome. Violations indicate either a missing card (a gap in the chain) or a non-load-bearing card (a scene that should be cut).

## 4. Concept-phase prescriptions

Lisle's concept work is Layers 1-3 (Sentence, Paragraph, Page).

- **Sentence requirements (Lisle, explicit):**
  - **Conflict.** Implicit or explicit, but present. Lisle's heuristic: "If you can't see who wants what and who's stopping them, the sentence isn't there yet."
  - **Specificity.** No abstractions. "A girl whose dreams predict deaths" not "a girl with magical powers."
  - **Hook.** The writer's own want-to-read response. Lisle: "If you don't want to drop everything and write this book, the sentence isn't done."
  - **Tone signal.** The sentence's diction should sound like the book. A grim sentence promises a grim book; a wry sentence promises a wry book. This is a Lisle-specific addition that Ingermanson does not require.
  - **No length cap.** Lisle does not enforce Ingermanson's 15-word ceiling. Her sentences are sometimes 25-30 words. She prioritizes *promise-completeness* over compression.

- **Paragraph requirements:**
  - **Protagonist.** Named or archetyped, with the central trait that drives the story.
  - **Antagonist or antagonistic force.** Explicit. Lisle is firm that "the universe" or "society" are not antagonists for purposes of this paragraph — there must be something the protagonist can act against.
  - **Central conflict.** The big want and the big block.
  - **World weirdness.** The genre signal. Fantasy paragraphs have magic; SF paragraphs have tech; mystery paragraphs have a corpse.
  - **Tone preserved from sentence.**

- **Page requirements:**
  - **Beginning, middle, end visible.** The page should let the writer see the rough trajectory.
  - **At least one major emotional turn anticipated.** Lisle's "you should know where the gut-punch lives."
  - **Author-voice, not narrative-voice.** The page is the writer talking to themselves; it doesn't have to be polished.
  - **"I don't know yet" annotations encouraged.** Marks places where decisions are deferred.

## 5. Planning-phase prescriptions

Notecarding (Layer 6) is the planning artifact.

- **Notecard front (canonical fields):**
  1. Scene title.
  2. POV character.
  3. Purpose (introduce / complicate / resolve).
  4. Setting.
  5. Major event or discovery.

- **Notecard back (canonical fields):**
  1. What changes (knowledge / position / emotional state).
  2. Causal connection to next card.
  3. What's at stake.

- **POV alternation rules:**
  - Lisle is more permissive than Ingermanson — she allows tighter POV cycling for genre-fiction pacing and looser cycling for character-driven work.
  - **The rule she enforces:** the POV character must have the most at stake in the scene. If you find yourself writing a scene where the POV is a bystander, you've picked the wrong POV.
  - **Per-character POV-load balance:** roughly proportional to character-arc weight. Protagonist gets the most; antagonist gets enough to humanize; secondary POVs only if they reveal information the protagonist cannot witness.

- **Conflict-per-scene requirements:**
  - **Every scene must change something.** This is Lisle's hardest invariant. A scene where nothing changes is not a scene.
  - **The change must be motivated by conflict** — internal or external opposition. Frictionless changes (the protagonist decides to feel differently, with no precipitating event) are flagged.
  - **Stakes must be visible to the reader.** Not just real to the writer.

- **Causal-chain requirement:**
  - Each card's "what changes" must motivate the next card's "what's at stake."
  - **The "but/therefore" test** (Lisle borrows this from Trey Parker / Matt Stone, popularized by *South Park*): scenes should connect with "but" or "therefore," not "and then." A sequence of "and then" scenes is a list, not a plot.

- **Bright-light protection:**
  - Scenes the writer is *excited* to write get protected status. The skeleton may need to flex to include them. Lisle: "Cut anything but the scenes you can't wait to write."
  - This is a counterweight to the structural rigidity — the writer's intuition is given veto over the skeleton.

- **Scene count / pacing:**
  - Lisle does not specify a fixed scene count. Rough range: 40-80 scenes for a 100k-word fantasy novel.
  - Pacing rule: try/fail cycles should escalate. Each failure should be worse than the last.

## 6. Drafting-phase prescriptions

- **Pre-scene ritual:**
  - Re-read the previous scene's last page (re-anchor voice and emotional state).
  - Read the current notecard's front and back.
  - Set the card aside.

- **In-scene rules:**
  - Write toward the card's "what changes" — that's the scene's destination.
  - Don't refer to the card mid-scene. The card is the runway, not the flight plan.
  - Lisle's "one true sentence" rule (borrowed from Hemingway): when stuck mid-scene, write the truest sentence you know about this character in this moment, then keep going.

- **Sentence-level pacing (from HTTS lessons on prose):**
  - Vary sentence length aggressively. Lisle's heuristic: short sentences for action and emotional impact, long sentences for description and reflection. Three short sentences in a row signal high stakes; three long sentences in a row signal we're in the character's head.
  - Sensory anchoring per scene opening — at least one concrete sensory detail in the first paragraph.
  - Dialogue carries scene momentum more than narration; if a scene is dragging, more dialogue.

- **Stop conditions:**
  - The card's "what changes" has happened.
  - The next card's "what's at stake" is now active in the reader's mind.
  - Do not stop on a word count.

- **Post-scene annotations:**
  - On the back of the card, annotate what *actually* happened (often differs from plan).
  - If the card's "what changes" did NOT happen, the scene is broken and the writer's options are: (a) revise the card; (b) cut the scene; (c) rewrite. Lisle warns against (d) "leave it broken and fix in revision" — the broken scene poisons the next scene's stakes.

## 7. Validation prescriptions

What Lisle considers "broken" at each iteration boundary:

- **Sentence broken if:** No conflict; abstractions; doesn't make the writer want to write the book; tone doesn't match the intended book.
- **Paragraph broken if:** No identifiable antagonist (or antagonistic force is too abstract); pivots away from the sentence's promise; tone shift from sentence.
- **Page broken if:** No visible end; no anticipated emotional turn; reads like a Wikipedia plot summary instead of a writer's voice.
- **Skeleton broken if:** Any of the 7 slots empty; "try/fail cycles" missing or all-success; "the bottom" not actually low; "the leap" not requiring personal change (it must cost the protagonist something).
- **Bright lights broken if:** None exist (the writer isn't emotionally invested) — Lisle considers this a project-kill signal, not a bug to fix.
- **Notecards broken if:** Any card lacks a "what changes"; any card's "what changes" doesn't motivate the next card's "what's at stake" (gap in the causal chain); any card's POV is a bystander; the deck has too many "and then" connections (vs. "but/therefore"); structural slots from the skeleton are uncovered.
- **Drafted scene broken if:** The card's "what changes" didn't happen in the prose; the scene's stakes were resolved without conflict (frictionless change); the POV character lacks emotional access to what's happening (we're in the wrong head).

## 8. Programmatic levers

Concrete checker calls for the harness, drawing on Lisle's invariants:

1. **Sentence-promise extraction** — LLM call: given the seed sentence, extract (protagonist-archetype, central want, central block, tone-tag). Cache as the *promise manifest*.
2. **Promise-conservation check (sentence → paragraph, paragraph → page)** — for each downstream artifact, LLM-judge: "does this conserve protagonist-archetype, central want, central block, tone?" Fire on any mismatch.
3. **Plot-skeleton slot-fill check** — assert all 7 skeleton slots (opening conflict, inciting event, try/fail cycles ≥3, bottom, leap, triumph, closing image) are populated. Deterministic schema validation.
4. **Try/fail escalation check** — given the try/fail-cycle list, LLM-judge per consecutive pair: "is failure N worse than failure N-1?" Reject flat or de-escalating cycles.
5. **The-leap-costs-something check** — LLM-judge: "in the leap slot, what does the protagonist give up?" If "nothing identifiable," fire.
6. **Notecard schema check** — every card has front fields (title, POV, purpose ∈ {introduce, complicate, resolve}, setting, event) and back fields (what-changes, causal-link-to-next, stakes). Deterministic.
7. **Causal-chain check (the "but/therefore" test)** — for each consecutive card pair, LLM-judge: "does card N+1 connect via 'but' or 'therefore' (consequence) or via 'and then' (mere sequence)?" Flag "and then" runs >2.
8. **Bystander-POV check** — per card, LLM-judge: "of all named characters in this scene, which has the most at stake?" If not the POV, fire.
9. **Stakes-visibility check** — per card, LLM-judge: "is the scene's stake visible to a reader who hasn't read the back of the card?" If only the writer knows, fire.
10. **Bright-light coverage check** — every bright-light scene from Layer 5 must have a card in the deck. Deterministic match by title/event.
11. **Skeleton-slot coverage check** — every slot from the plot skeleton must have at least one card whose purpose maps to it. LLM-judge mapping; reject empty slots.
12. **What-changes verification (notecard → prose)** — given the card's "what changes" and the drafted prose, LLM-judge: "did the change occur?" This is structurally identical to our existing chapter-plan-checker but at scene granularity with stricter "did X actually happen" semantics.
13. **Frictionless-change detector** — per drafted scene, LLM-judge: "did the change happen because of a conflict event, or did the character just decide?" Frictionless changes fire.
14. **Causal-chain conservation between revisions** — when notecards are reordered or rewritten, re-run the causal-chain check on the new sequence. Detects when revision introduces new gaps.
15. **Plot-clinic symptom detector** — for any chapter or full draft, classify symptoms ("middle sags," "protagonist passive," "stakes flat," "antagonist absent") via LLM-judge against Lisle's diagnostic table. Routes to chapter-plan-reviser with a symptom-specific surgery prompt.

## 9. Map to current harness

Lisle's expansion architecture maps onto our two-phase planner with a different fit than Snowflake. Where Snowflake gives us conservation invariants between numbered steps, Lisle gives us **the notecard data model and the causal-chain invariant**, which are arguably more directly portable.

**Where we already align:**

- Per-beat fields (POV, setting, charactersPresent, description, targetWords) are roughly the front-of-card fields.
- `establishedFacts`, `characterStateChanges`, `knowledgeChanges` are roughly the back-of-card fields (what changes).
- Beat floor enforces a minimum scene-density that Lisle would interpret as "enough cards to cover the chapter's stakes."

**What we are missing — biggest gaps:**

- **No "what's at stake" field per beat.** Our beats describe what *happens*; they don't describe what is *risked*. Adding a `stakes` field to the beat schema, gated by a stakes-visibility check, is a Lisle-direct lever.
- **No causal-chain link per beat.** Our planner emits beats as a list with no explicit edge between beat N and beat N+1. Adding a `causalLinkToPrevious` field (or `consequenceOfBeatIndex`) and running the "but/therefore" check would catch the most common chapter-plan failure: the "and then" sequence.
- **No bright-light protection.** Our planner is fully top-down — there is no equivalent of "the author specifies the scenes they're emotionally committed to and the planner builds around them." For human-in-the-loop planning (the long-term direction), this is the obvious shape: let the human declare bright-light scenes in the seed, and require the planner to integrate them.
- **No purpose-tag per beat.** Lisle's introduce/complicate/resolve trichotomy is a clean classifier. Adding it to the beat schema lets us validate that chapters have a balanced mix (no chapter that's all "introduce," no chapter that's all "resolve").
- **No per-scene "did the change happen" check.** Our adherence-checker validates events occurred but doesn't check that the *state change the planner declared* actually manifested in prose. The planner already emits `characterStateChanges` per chapter; verifying each declared state change actually happens in the prose is a Lisle-direct lever and arguably a missing piece of our chapter-plan-checker.
- **No frictionless-change detector.** The hallucination-checker catches things that aren't grounded; the chapter-plan-checker catches plot contradictions; neither catches the "character just decided" failure mode where a state change has no precipitating event.
- **No plot-clinic-style symptom diagnosis on long-form output.** Our existing checkers fire on local issues; Lisle's symptom approach catches structural issues that only manifest at the chapter or whole-novel scale ("the middle sags").

**Cheapest wins to import:**

1. **Add `stakes` and `causalLinkToPrevious` fields to the beat schema.** Tiny change to `chapterBeatsSchema`. The planner will produce them; the planning-checker validates them.
2. **Add the "but/therefore" check** to chapter-plan-checker. Per consecutive beat pair, LLM-judge consequence vs. sequence. Flag runs of "and then" beats; route to beat-targeted rewrite.
3. **Add a purpose tag** (introduce/complicate/resolve) to the beat schema. Cheap to produce; gives a classifier the human author can override.
4. **Add a what-changes-verified check** to chapter-plan-checker — for each declared `characterStateChanges` entry, verify the prose dramatizes it. This is a beat-grain extension of our existing chapter-plan-checker.
5. **Add a frictionless-change detector** to adherence-checker — per beat, if a state change occurs without a precipitating event in the same beat or any prior beat, fire.
6. **Adopt the Plot Clinic symptom table as a chapter-level diagnostic** — when chapter-plan-reviser is invoked, route through a symptom classifier first; the symptom dictates the revision prompt.

**Where Lisle and Snowflake recommend the same lever, prefer the Lisle version:** the conservation invariants are softer (semantic LLM-judges) and more amenable to LLM checking than the syntactic Snowflake invariants. Snowflake's "step 4 must conserve step 2's disasters" is a structural check; Lisle's "the sentence's promise must be conserved through every layer" is a semantic check — and semantic checks are what our LLM checkers do natively.

**Where Snowflake is stronger:** the explicit numerical structure (3 disasters, 7 slots) gives a count-based deterministic check that Lisle's looser approach lacks. For a programmatic harness, *use Snowflake's structural counts as the deterministic gate and Lisle's semantic conservation as the LLM-graded gate*.

## 10. Limitations

- **Bright-light protection is hard to operationalize without a human in the loop.** The "scenes you can't wait to write" criterion is by definition the writer's emotional response. For autonomous mode, the harness has no equivalent. We can fake it (e.g., let the seed declare highlight scenes), but this is fundamentally human-shaped work.
- **Notecarding scales poorly past ~100 cards.** Physical cards on the floor work for novels; they break for series. Lisle has acknowledged this in *How to Write A Series* — her solution is per-book notecard decks, but cross-book continuity is left to the writer.
- **The "but/therefore" test has false positives on legitimate sequence.** Some scenes are setup that pays off many scenes later; the immediate transition is "and then" but the structural connection is "therefore" across a longer arc. A naive checker would over-fire.
- **Plot Clinic's symptom diagnosis is genre-tilted.** Lisle's diagnostic tables are calibrated for commercial fiction (action genres + romance). Literary fiction and intentional ambiguity get pathologized. Our fantasy/litRPG focus mostly avoids this.
- **Iterative expansion locks in early decisions.** Same failure mode as Snowflake. The Sentence is supposed to be revisable, but in practice the page sketch's tone and shape resist late changes to the Sentence.
- **The skeleton's seven slots are Hollywood-shaped.** They presume a try/fail/leap/triumph arc. Tragedies, deliberate anti-arcs, and slice-of-life don't fit. Lisle is explicit that the skeleton is for "satisfying" stories, which she defines by genre conventions.
- **Lisle's intuitive components (the hook test, the "feels right" test, bright-light scenes) are high-quality signal for human authors and fundamentally absent for autonomous LLM authoring.** The harness has to substitute pattern-matching against successful corpora (which is what our voice-LoRA track does at the prose layer; the structural analog for the planning layer is largely TBD — `WRITER_GENRE_PACKS` is the closest current equivalent and operates only on writer voice, not plan structure).
- **Notecarding is ephemeral.** Real cards are thrown away or rearranged. A logged version (which our harness needs) loses the act-of-rearranging that gives the method its diagnostic power. We can simulate it via revision passes, but the friction is different.
- **Lisle's frameworks under-specify antagonist development.** Compared to Snowflake's step 3 demand that the antagonist have full goal/conflict/epiphany, Lisle's framework is content with "antagonistic force." For genre fiction this can produce cardboard villains.

## 11. Citations

- Lisle, Holly. *How to Think Sideways: Career Survival School for Writers*. Online course, How to Think Sideways LLC. https://hollylisle.com/how-to-think-sideways/ (lessons 1-26, particularly lessons 1-5 for the Sentence/Paragraph/Page/Skeleton expansion and lessons 11-16 for notecarding).
- Lisle, Holly. *Holly Lisle's Notecarding: Plotting Under Pressure*. OneMoreWord Books, 2010. (The canonical reference for the front-of-card / back-of-card data model and the afternoon procedure.)
- Lisle, Holly. *Create A Plot Clinic: How to Build Powerful Plots, Subplots, and Twists*. OneMoreWord Books / Writers Digest tie-in, 2007. (The plot skeleton, the seven slots, the symptom-diagnosis tables, the surgery exercises.)
- Lisle, Holly. *Mugging the Muse: Writing Fiction for Love and Money*. OneMoreWord Books, 2002. (Pre-HTTS; contains early versions of the Sentence test and the per-scene drafting ritual.)
- Lisle, Holly. *Holly Lisle's Writing the World: Worldbuilding for Speculative Fiction*. OneMoreWord Books, 2013. (Worldbuilding companion; includes the rule that the world's defining weirdness must be locked at the paragraph layer.)
- Lisle, Holly. *How to Write A Series*. OneMoreWord Books, 2018. (Cross-book continuity; the limits of notecarding at series scale.)
- HollyLisle.com — the article archive (2000-present). The earliest articulations of "one-pass revision," "the sentence test," and the bright-light concept appear in HollyLisle.com articles before they appear in the books.
- Parker, Trey & Stone, Matt. NYU Film School Q&A, 2011. (Source of the "but/therefore vs. and then" test that Lisle adopts; widely transcribed online and cited in HTTS lesson materials.)
- Hemingway, Ernest. *A Moveable Feast*. Scribner, 1964. (Source of the "one true sentence" advice Lisle invokes for in-scene unsticking.)
