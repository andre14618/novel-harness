# Brandon Sanderson — BYU Lectures (English 318R / 335R)

A research synthesis of Brandon Sanderson's craft lectures for the Novel Harness, with a focus on programmatically encodable structures (MICE, Promise/Progress/Payoff, Magic Laws) for the fantasy + LitRPG track.

## 1. Framework Summary

Brandon Sanderson teaches creative writing at Brigham Young University (English 318R "Writing Science Fiction and Fantasy" and English 335R "Writing for Publication"). Multiple lecture series have been recorded and published on YouTube — the canonical reference is the 2020 BYU 318R series, with revisions/extensions in 2025. The lectures are unusually well-suited to engineering use because Sanderson is, by his own admission, an engineer who reverse-engineered storytelling from his own corpus. The framework is mechanistic, decomposable, and full of named structures.

Five load-bearing concepts run through the lectures:

1. **Promise / Progress / Payoff** — every story arc is a contract between author and reader. The author makes promises (genre, tone, character trajectory, conflict, world question), shows progress on those promises throughout the middle, and pays them off in proportion to how loudly they were promised. Broken promises are the dominant failure mode of fantasy novels.
2. **The MICE quotient** (borrowed and extended from Orson Scott Card) — Milieu, Inquiry, Character, Event. Every story thread has a type, and threads nest like parentheses (last opened, first closed). MICE is the closest thing in popular craft writing to a formal grammar.
3. **The Three Laws of Magic** — a set of design constraints for "hard" magic systems: (1) author's ability to resolve conflict with magic is proportional to reader's understanding of it; (2) limitations are more interesting than powers; (3) expand what you have before adding something new. These are author-facing rules, not in-world rules.
4. **Plot archetypes** — heist, mystery, romance, hero's journey, etc. Each archetype carries obligatory beats. Choosing an archetype is a promise.
5. **The viewpoint stack** — limited 3rd person is the workhorse of modern SFF; lectures cover distance regulation, sensory hierarchy, and how POV gates information.

Sanderson is also the source of the "discovery writer / outliner / hybrid" taxonomy that informs his planning advice. Most relevant to a deterministic planner-driven harness: he teaches the outliner mode explicitly because it's the more transferable skill set.

## 2. Concept-Phase Prescriptions

Sanderson's concept work is dominated by **promise-setting** and **constraint-engineering**. The concept phase commits the author to a set of contracts that the planning and drafting phases must honor.

### 2.1 The Promise of the Book

The opening of a novel makes four kinds of promises that the reader uses to predict the experience they're buying:

- **Genre promise** — fantasy, LitRPG, romance, thriller. Includes sub-genre and tone signals (grimdark vs. heroic, cozy vs. epic). Genre mismatch in delivery (a romance that doesn't pay off the romance, a fantasy whose magic never matters) is the most savage form of broken promise.
- **Tone promise** — comedic vs. tragic, distance vs. intimacy, irony vs. earnestness. Set in the first 1,000–2,000 words and ratified throughout chapter 1.
- **Character promise** — what kind of arc this protagonist is on. Want, need, lie they believe (Sanderson borrows this from Weiland), starting flaw. The reader reads the first chapter to ask "is this someone I want to spend a novel with, and what's their trajectory?"
- **Conflict promise** — what is this novel ABOUT? What question will be answered? This is often the implicit MICE-frame thread: "will Vin discover what the Lord Ruler is?" (Inquiry), "will Kaladin escape the Shattered Plains?" (Milieu), "will Wax solve the kidnappings?" (Inquiry / Event).

For the harness, these are the four fields the concept phase MUST emit and the planner MUST inherit. They aren't just metadata — they're constraints on every later checker.

### 2.2 The Three Laws of Magic

Sanderson's First Law: *"An author's ability to solve conflict satisfactorily with magic is directly proportional to how well the reader understands said magic."* Hard magic (Allomancy in Mistborn, the System in any LitRPG) is constrained, costed, and explained — these systems can resolve plot. Soft magic (Gandalf, the One Ring's vague malevolence) is awe-driven and CANNOT be used to resolve plot without breaking the reader's contract. This law is what flags deus ex machina in fantasy: if the magic that resolves the climax wasn't established earlier, you've violated it.

Sanderson's Second Law: *"Limitations > powers."* What a magic system CAN'T do is more interesting than what it can. Costs (burning metals consumes them; spells exhaust mana; Surgebinders need stormlight) drive plot because they create scarcity and trade-offs. A magic system without limitations is structurally inert.

Sanderson's Third Law: *"Expand what you have before you add something new."* If you've established Allomancy, find a new use of pewter before introducing Hemalurgy. This is the anti-bloat law and the anti-info-dump law: novels feel coherent when their magic compounds rather than sprawls.

A useful corollary, attributed to Sanderson but really folklore: **"Give the reader the rules in chapter 1, then test the edges of those rules."** Magic introduction beats should be front-loaded; later magic beats should be permutations.

### 2.3 The World-Building Iceberg

Sanderson teaches that the writer should know roughly 10× what makes it onto the page. This isn't a license to info-dump; it's a prerequisite for confidence in implication. The iceberg principle shows up in three places:

- **Implied depth** — a single offhand mention of "the Long Trench Wars" implies a researched history. The author has it; the reader senses it.
- **Cultural plausibility** — characters from different cultures should have different idioms, different oaths, different food. These details are emitted on demand, not exhaustively.
- **Magic system coherence** — costs and edges of the system imply a deeper underlying physics. This is what makes hard magic FEEL like a system rather than a list.

For the harness: the world-bible is the iceberg. The beat-writer surfaces only what the beat needs.

## 3. Planning-Phase Prescriptions

The planning phase is where Sanderson's craft is most directly translatable into deterministic structure. Three frameworks dominate.

### 3.1 The MICE Quotient

Drawn from Orson Scott Card's *Characters and Viewpoint* and extended in the BYU lectures. Every story thread is one of four types:

- **Milieu** — about a place. Opens when the character enters a new place (Frodo leaves the Shire); closes when the character leaves (Frodo throws the Ring into Mount Doom; technically when he leaves Middle-earth at the Grey Havens). Travelogues and quest fantasies are milieu-dominant.
- **Inquiry** — about a question. Opens when the question is posed (who killed Lord Renarin?); closes when the question is answered. Mysteries are inquiry-dominant. Most LitRPG progression-mystery (what is the System? who built the dungeon?) is inquiry.
- **Character** — about an internal change. Opens when the character is shown unhappy with their internal state; closes when they have grown / failed to grow. Character arcs.
- **Event** — about a disruption to the status quo. Opens when something breaks (war begins; the king dies); closes when a new status quo is established. Disaster plots, war plots.

**Threads nest, last-in-first-out.** If you open a milieu thread (Frodo leaves the Shire), then within it open an event thread (Sauron rises), then within THAT open a character thread (Frodo's corruption by the Ring), you should close them in reverse: character first (Frodo at Mount Doom), then event (Sauron destroyed), then milieu (the Grey Havens). Closing out-of-order leaves the reader with dangling promises.

This is where MICE becomes programmable: the planner can tag each chapter or scene with a primary MICE type, mark it as `open` or `close`, and a checker can verify that the open/close tags form a balanced, well-nested sequence.

### 3.2 Plot Archetypes

Each archetype carries obligatory beats — the genre's structural promises. Sanderson's lectures treat these as schemas to choose from, not mandates:

- **Heist** — assemble crew, plan the job, set up the obstacles, complication during execution, twist (the real plan), payoff (often involves the audience being deceived alongside the marks).
- **Mystery** — body / inciting question, suspects introduced, red herrings, investigation beats, false solution, real solution. Fair-play promise: clues must be on the page.
- **Romance** — meet-cute, attraction, complication, dark moment (separation), reunion / commitment. Two POVs ideal. Beats are obligatory; missing one breaks the genre.
- **Hero's Journey** — call, refusal, mentor, threshold, trials, abyss, transformation, return. Sanderson is mildly skeptical of this as a planning tool because it's too generic, but it's a useful diagnostic.
- **Tragedy** — protagonist's flaw is shown, escalates, leads to the fall, partial wisdom in defeat.

A LitRPG example: progression-fantasy obligatory beats include First Skill / Class Acquisition, First Death-Stakes Fight, First Tier Up / Evolution, Power Reveal to Allies, First True Boss. These should be in a `WRITER_GENRE_PACKS` LitRPG schema as obligatory beat tags.

### 3.3 Promise / Progress / Payoff at Multiple Scales

The Promise/Progress/Payoff cycle operates at three scales simultaneously:

- **Macro (novel)** — promises set in chapter 1; payoffs in the climax.
- **Meso (arc / part)** — each three-act part of a long novel runs its own cycle.
- **Micro (chapter / scene)** — each scene should close one micro-loop. Sanderson cites this as why some chapters feel "dead" — they do not pay off anything that was promised earlier in the chapter or set up anything that will be paid later.

For a planner: every promise in the early chapters should be tagged with its expected payoff chapter. Every chapter should be tagged with which promises it makes progress on and which (if any) it pays off. A checker can flag any promise without a payoff and any "dead" chapter that neither progresses, promises, nor pays.

### 3.4 STRUCTURAL vs. FLEXIBLE Beats

Sanderson resists rigid percentage-locked structures (this is where his lectures diverge from Weiland). His structural commitments are:

- **STRUCTURAL** — the genre's obligatory beats (mystery must have a real solution; romance must have reunion); the climax must pay off the central promise; the magic-resolution beat must be set up in advance.
- **FLEXIBLE** — exact placement of midpoints, pinch points, and reversal beats. He acknowledges three-act and Save-the-Cat structures work but doesn't prescribe percentages.

The harness's planning-phase grammar should treat genre obligatory beats as hard constraints and pacing-percentage beats as soft scoring constraints (good to have, not a fail).

## 4. Drafting-Phase Prescriptions

### 4.1 Scene Function (the "do at least two" rule)

Every scene must accomplish at least two of:

- **Advance plot** — change a state in the external situation.
- **Develop character** — change a state in a POV or supporting character.
- **Develop world** — reveal something about the setting / system / culture that will pay off.
- **Set up future payoff** — plant a Chekhov's gun.

A scene that does only one of these reads as filler. A scene that does none should be cut. This is directly encodable as a per-scene checker: tag the scene with its claimed functions, validate against actual content, flag scenes scoring 0–1.

### 4.2 Viewpoint

Sanderson's default is **limited 3rd person** with occasional close 3rd. Key techniques:

- **Distance regulation** — narrator can pull in (interiority, emotional reaction, sensory specifics) or out (zoomed observation, irony, summary). Distance shifts mark beats: pull-in for emotional revelation, pull-out for spatial / political summary.
- **Sensory hierarchy** — different POVs notice different things. A soldier notices weapons and exits; a merchant notices clothes and posture; a scholar notices titles and dialect. The first sensory detail in a scene tells the reader whose head they're in.
- **Information gating** — POV character does not know things they have not learned. Dramatic irony comes from POV gaps (reader knows from chapter 3 what POV character learns in chapter 8). The harness's `doesn't-know` constraints are a direct implementation.

### 4.3 Tension — Micro vs. Macro

Sanderson distinguishes:

- **Macro tension** — will Vin survive the Lord Ruler? sustained over many chapters.
- **Micro tension** — line-level question pressure ("but what's behind the door?"); resolved within paragraphs to pages.

He identifies (with Howard Tayler in Writing Excuses, and reaffirmed in lecture) **five tension types**:

1. **Action tension** — physical danger / combat.
2. **Dramatic tension** — interpersonal friction (argument, betrayal, romance).
3. **Mystery tension** — unresolved question.
4. **Stakes tension** — what's at risk.
5. **Anticipation tension** — known future event the reader is waiting for ("the duel is in three days").

A scene that lacks all five flatlines. A novel typically rides 2–3 simultaneously and rotates which dominates per scene.

### 4.4 Description as Implicit World-Building

Don't open a chapter with a paragraph of weather. Open with a POV doing something, then layer setting through the lens of what they care about. This is a corollary of viewpoint sensory hierarchy.

### 4.5 Dialogue

Two principles:

- Each character should sound different. Idiolect, vocabulary, rhythm, idioms.
- Dialogue advances plot OR develops character — preferably both. "Pure information dialogue" (one character telling another what the reader needs to know) is the failure mode.

## 5. Validation Prescriptions — Sanderson's Failure Modes

Sanderson's lectures explicitly enumerate failure modes, which map directly to checker dimensions.

- **Deus ex machina** — climax resolved by a power, ally, or coincidence not previously established. Violates First Law of Magic. Checker: every plot-resolution element at the climax should have been introduced (with a positive plant) before the 75% mark.
- **Info-dump** — exposition load that exceeds reader patience. Often violates Third Law (introducing new system pieces rather than expanding existing ones). Checker: density of new-proper-noun introductions per page; flag spikes.
- **Unset-up payoff** — emotional or plot moment the reader can't feel because nothing earlier earned it. Checker: payoff events should match a promise event at least N chapters earlier.
- **Broken promises** — genre / tone delivery mismatch. A grimdark opening followed by a heroic-fantasy climax. A romance whose romance never resolves. Checker: extract genre/tone tags from chapter 1; verify climax / resolution honor those tags.
- **MICE imbalance** — open more threads than you close, or close them out of order. Checker: walk the MICE stack.
- **Magic system creep** — adding new magic abilities mid-novel without earlier hints. Violates Third Law. Checker: every magic ability used after chapter 5 should be either established or flagged as a Chekhov plant from earlier.
- **Stakes drift** — the stakes of the climax are different from what was promised. Checker: extract stakes tag from chapter 1; verify climax stakes overlap.
- **Flat character arc** — protagonist ends in the same internal state they started, with no narrative justification. Sanderson allows flat arcs but only when intentional. Checker: extract internal-state tag from chapter 1 and chapter N; require either delta or explicit "flat-arc" planner declaration.

## 6. MICE Quotient as a Programmatic Structure

This is the highest-leverage encoding. Sketch:

### 6.1 Data Model

```
table mice_thread {
  id              uuid pk
  novel_id        uuid fk
  thread_type     enum('M','I','C','E')
  scope           enum('novel','part','chapter','scene')   -- which scale
  open_beat_id    uuid fk beats   -- where the thread opens
  close_beat_id   uuid fk beats   -- where it closes (nullable while pending)
  parent_thread   uuid fk mice_thread  -- nesting parent
  description     text             -- "Frodo leaves the Shire"
  promise_text    text             -- what's promised
  payoff_text     text             -- what closes it
  status          enum('open','closed','dangling','dropped')
}

table beat_mice_tags {
  beat_id         uuid fk beats
  thread_id       uuid fk mice_thread
  role            enum('open','progress','close')
}
```

### 6.2 Checker Algorithm

1. Walk all beats in narrative order.
2. Maintain a stack of currently-open MICE threads.
3. On `open` tag → push.
4. On `close` tag → pop; verify the popped thread matches. If not, emit `mice_out_of_order` violation.
5. After the final beat, any threads still on the stack are `mice_dangling` violations.
6. Cross-check: the dominant thread (deepest on the stack at the climax) should be the type implied by the genre promise (mystery → I, quest → M, etc.). If not, emit `mice_genre_mismatch`.

### 6.3 Planner Use

The two-phase planner can be extended so that:

- Phase 1 (chapter skeleton) emits a MICE type per chapter and an `open|progress|close` role.
- Phase 2 (per-chapter beat decomposition) inherits the chapter's MICE type and emits beat-level tags.
- A pre-drafting validator runs the stack walk before any chapter is written.

### 6.4 LLM-Extractor Fallback

For existing novels or for verification, an LLM extractor can read each chapter and emit MICE tags retrospectively. Used as ground-truth check on the planner.

## 7. Promise / Progress / Payoff as a Programmatic Structure

The second-highest-leverage encoding.

### 7.1 Data Model

```
table promise {
  id              uuid pk
  novel_id        uuid fk
  promise_type    enum('genre','tone','character_arc','conflict',
                       'magic_capability','romance','mystery_question',
                       'world_question','stakes')
  introduced_in   uuid fk beats
  introduced_pct  float  -- where in the novel (0-1) the promise was made
  expected_payoff_pct float -- planner's intended payoff position
  text            text   -- "Vin will discover what the Lord Ruler is"
  weight          enum('major','minor','flavor')  -- how loudly promised
  status          enum('open','progressing','paid_off','broken','retracted')
}

table progress_event {
  id              uuid pk
  promise_id      uuid fk
  beat_id         uuid fk
  event_type      enum('reveal','setback','complication','clue','escalation')
  delta           float  -- amount of progress (heuristic)
}

table payoff {
  id              uuid pk
  promise_id      uuid fk
  beat_id         uuid fk
  satisfaction    enum('full','partial','subverted','aborted')
  scale_match     bool  -- did payoff scale match promise weight?
}
```

### 7.2 Extraction Pipeline

- After concept phase: planner emits initial promises (genre, tone, character arc, conflict).
- After each chapter: an LLM extractor reads the chapter and emits new promises, progress events on existing ones, and payoffs.
- Both planner-declared and prose-extracted promises persist; reconciliation flags drift.

### 7.3 Checker Rules

- Every `major` promise must have at least one progress event in middle chapters and a `paid_off` payoff before the resolution.
- Promise weight must match payoff scale: a `major` promise paid off in two sentences is a `payoff_undersized` violation.
- Payoff position must be within ±15% of `expected_payoff_pct`, or planner flags.
- Any promise still `open` at 95% novel completion is `dangling_promise`.
- Reverse: any payoff event without an earlier matching promise is `unset_up_payoff` — this catches deus ex machina.

### 7.4 Planning Use

The planner's chapter skeleton phase can be augmented to emit, per chapter, a list of `promises_made` and `payoffs_delivered`. The harness pre-validates the chapter skeleton: every promise has a planned payoff, no payoff lacks a setup.

## 8. Sanderson's Magic Laws as Planner Constraints

For fantasy / LitRPG seeds:

### 8.1 First Law Enforcement (capability vs. understanding)

The planner can mark each magic ability with a `reader_understanding` score (0 = soft / mystery, 1 = hard / fully explicit). At the climax, any ability that resolves a major plot point must have `reader_understanding >= threshold` (e.g., 0.7). The threshold is genre-tunable: epic fantasy permits more soft magic in climax (Aragorn's heroism is non-magical); LitRPG demands near-1.0 (the System reveals everything).

A simpler formulation: tag each magic-introduction beat with `(ability_name, established_pct)`. At the climax, every ability whose use is plot-load-bearing must have `established_pct < 0.75`.

### 8.2 Second Law Enforcement (limitations before powers)

For every magic ability introduced, the planner must emit at least one `limitation` and at least one `cost` in the SAME or a NEARBY beat:

```
beat:
  type: magic_introduction
  ability: "burn pewter"
  limitations:
    - "consumes the metal in the burner's body"
    - "physical strength only, not invulnerability"
  costs:
    - "metal must be sourced and ingested"
    - "leaves user nauseous when burned out"
```

A pre-drafting validator rejects any magic-introduction beat lacking limitations or costs. This is enforceable at the planner-output schema level — make the fields required for `type=magic_introduction`.

### 8.3 Third Law Enforcement (expand before adding)

The planner maintains a `magic_register` of established abilities. New abilities can only be introduced if:

- The abilities already in the register have been used at least twice OR
- The new ability is flagged as a deliberate genre promise (e.g., a multi-system world declared in concept).

This prevents "system bloat" mid-novel. For LitRPG: skill / class additions follow the same rule — new skills should expand on existing class identity unless a tier-up beat is explicit.

### 8.4 LitRPG-Specific Extensions

LitRPG inherits Sanderson's laws unusually well because the System is by genre convention HARD. Encodable extras:

- Every System notification in a chapter should reference an established mechanic OR be marked as a `system_reveal` beat with planner-declared `reader_understanding` advancement.
- Numeric stats / level-ups must be monotonic unless a `setback` event is declared.
- New skills must respect the Third Law: a previously-shown skill should be used in 2+ contexts before a new one in the same school is granted.

## 9. Programmatic Levers — 20 Concrete Items

Each is implementable as a planner schema field, a checker, or a runtime constraint.

1. **Genre-promise lock** — concept phase emits genre tag; climax-checker validates payoff matches.
2. **Tone-promise lock** — first-2k-words tone tag (`grimdark|heroic|cozy|tragic`); validated at resolution.
3. **MICE thread tagger** — every chapter gets a primary MICE type and `open|progress|close` role.
4. **MICE stack validator** — pre-draft balanced-parens check on the chapter skeleton.
5. **Genre obligatory beat checklist** — per-genre `WRITER_GENRE_PACKS` lists obligatory beats; planner must emit each.
6. **Promise table** — concept phase emits explicit promises; planner schedules payoffs.
7. **Promise-payoff distance enforcement** — major promises must be paid within configured window.
8. **Magic-register schema** — required `limitations[]` + `costs[]` on every magic-introduction beat.
9. **First Law climax check** — climax-resolving abilities must have `established_pct < 0.75`.
10. **Third Law expand-before-add gate** — new ability rejected unless predecessors used N+ times.
11. **Scene-function tagger** — every scene tagged with its 2+ functions; checker validates content.
12. **POV sensory-hierarchy probe** — first-sensory-detail audit per chapter; flag generic openings.
13. **POV doesn't-know enforcement** — character snapshot already tracks this; tighten penalty for leaks.
14. **Distance-regulation linter** — measure interiority density per scene; flag flatlining.
15. **Five-tension-type per-scene tagger** — every scene must declare its dominant tension type; flag scenes with none.
16. **Information-density limiter** — new-proper-noun count per page; spike → info-dump warning.
17. **Plot-archetype obligatory-beat schema** — `WRITER_GENRE_PACKS` per archetype lists obligatory beats.
18. **Promise-weight ↔ payoff-scale validator** — `major` promises require commensurate payoff prose.
19. **Magic-ability planting tracker** — every magic use after chapter 5 must reference an earlier plant.
20. **LitRPG System-reveal pacing** — System lore reveals scheduled to match Sanderson's expand-before-add cadence.

## 10. Limitations of the Sanderson Framework

- **Engineer-brain bias** — Sanderson openly says his rules favor outliner / hard-magic / structural writers. They underperform for literary fiction, magical realism, and lyrical / tone-driven prose. Our harness happens to live in the favored regime (fantasy + LitRPG + outliner), so this is an asset, not a liability — but extending to literary genres later will require softer constraints.
- **Mechanistic prose risk** — over-applying Sanderson can produce prose that feels like it was assembled from a checklist. The Salvatore voice LoRA + DeepSeek base prose generation is the antidote: structure is enforced at the planner level; voice lands at the writer level.
- **First Law over-application** — applied too rigidly, it forbids any soft magic. Sanderson explicitly says soft magic is fine; just don't use it to resolve plot. The harness encoding (capability score + climax-load-bearing flag) captures this nuance; a naïve "every magic ability must be 100% explained" check would over-fire.
- **MICE oversimplification** — real novels have many simultaneous threads of mixed type. The four-letter taxonomy is a useful first-pass model; real grading requires multi-thread tracking, not single-letter chapter tags.
- **No prescription on prose-line craft** — Sanderson's lectures focus on architecture; sentence-level beauty / rhythm / specificity is mostly absent. K.M. Weiland is similar. Line-level prose remains the writer-LoRA's job, not the planner's.
- **The rules are heuristics** — Sanderson is the first to admit. They describe what works in commercial SFF, which is precisely the harness's commercial target. Treat them as defaults, not invariants.

## 11. Citations

Canonical YouTube playlists (search exact titles; link rot has hit a few of the 2018 uploads):

- **BYU 318R 2020 series** — *"Brandon Sanderson — 318R — 2020 — Lectures"* (14 lectures, full series). The most-watched and most-cited reference. Covers Plot, MICE, Promise/Progress/Payoff, Characters, Viewpoint, Worldbuilding (4 lectures), Magic Systems, Publishing, and Q&A.
- **BYU 318R 2025 series (revised)** — *"Brandon Sanderson — 318R — 2025"* (extended; includes updated thoughts on AI in writing, contemporary publishing, and LitRPG). Where 2020 and 2025 disagree, 2025 supersedes.
- **BYU 335R 2014/2016 series** — *"Brandon Sanderson — Writing for Publication"* (more career / business / publishing focus; less craft).
- **Sanderson on Magic Systems** — independent lecture *"Sanderson's Three Laws"*, also published as essays at brandonsanderson.com:
  - *"Sanderson's First Law"* (2007, blog) — capability vs. understanding.
  - *"Sanderson's Second Law"* (2012, blog) — limitations > powers.
  - *"Sanderson's Third Law"* (2013, blog) — expand before adding.

Adjacent / cited:

- Card, Orson Scott. *Characters and Viewpoint*. Writer's Digest, 1988 (revised 2010). Source of MICE; Sanderson extends.
- Truby, John. *The Anatomy of Story*. FSG, 2007. Cited in Sanderson's plot lectures.
- Vogler, Christopher. *The Writer's Journey*. Michael Wiese, 2007 (3rd ed.). Hero's-Journey reference Sanderson uses skeptically.
- Writing Excuses podcast (Sanderson, Tayler, Wells, Kowal). 17+ seasons. Tag-team craft discussion; the "five types of tension" episode is canonical.
- Sanderson, Brandon. *The Stormlight Archive* lecture appendices and *Mistborn* annotations on his website — author-side commentary that demonstrates the laws in his own work.

---

*Notes on harness application — the three highest-leverage Sanderson encodings for the Novel Harness are MICE-as-balanced-parens, Promise/Progress/Payoff as a tracked database table, and Magic Laws as planner-output schema requirements on magic-introduction beats. All three are implementable inside the existing two-phase planner without major architectural change. They become particularly load-bearing as the harness moves toward LitRPG (where hard-magic conventions are universal and the System is by genre definition explicit) and toward multi-book series (where MICE thread management across volumes becomes critical for the world-bible extraction step).*
