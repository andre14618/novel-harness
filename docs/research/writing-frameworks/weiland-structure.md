# K.M. Weiland — Story Structure Framework

A research synthesis of K.M. Weiland's craft trilogy (*Structuring Your Novel*, *Outlining Your Novel*, *Creating Character Arcs*) for the Novel Harness, with focus on the percentage-locked beat sheet as a programmatic planning structure.

## 1. Framework Summary

K.M. Weiland is a craft instructor whose three core books form an unusually integrated system:

- ***Outlining Your Novel*** (2011) — pre-first-draft world / character / plot scaffolding, including her "Premise Sentence" approach.
- ***Structuring Your Novel*** (2013) — the percentage-locked three-act beat sheet (10 named beats at fixed positions in the novel).
- ***Creating Character Arcs*** (2016) — the Lie / Truth / Want / Need framework for positive, negative, and flat character arcs, designed to align with the same beat sheet so that internal arcs map onto external structure.

Weiland's framework's most distinctive (and most programmatically encodable) feature is its **percentage-locked beat sheet**: 10 named beats placed at specific percentage positions in the manuscript (1%, 12%, 25%, 37%, 50%, 62%, 75%, 88%, 98%, 99%). She is explicit that these are guidelines, not laws, but argues that successful commercial novels cluster tightly around these positions and that deviations of more than ~5% generally signal structural problems.

The framework is more rigid than Sanderson's (which resists fixed percentages) but pairs cleanly with it: Sanderson's Promise/Progress/Payoff and MICE describe what KIND of contract is being managed; Weiland's beat sheet describes WHEN load-bearing structural moments happen. For a planner, Weiland is the timing layer.

The character-arc work is also unusually structurally integrated: Weiland aligns each beat with a specific moment in the protagonist's internal journey from Lie (false belief at the opening) to Truth (corrected belief at the climax), via the Want (external goal driven by the Lie) and Need (internal correction the Truth provides). This makes character arc a structurally trackable thing rather than a vague mood.

## 2. Concept-Phase Prescriptions

Weiland's concept phase is dominated by **character-internal-state design**. Where Sanderson designs world systems and promises, Weiland designs the character's psychological starting position.

### 2.1 The Lie the Character Believes

Every protagonist begins the novel with a Lie — a false belief about themselves, the world, or their place in it. Examples:

- "I am only valuable when I succeed." (achievement-trauma archetype)
- "Love is a weakness that gets people killed." (grimdark guarded-heart)
- "The System is fair." (LitRPG awakening protagonist)
- "Magic is forbidden because it's evil." (chosen-one fantasy)

The Lie is the engine of the character arc. It is what the events of the novel will systematically pressure-test until the character either accepts the Truth (positive arc), rejects it (negative arc), or holds the line against the world that has rejected the Truth (flat arc — the rare hero whose existing belief was correct all along, e.g., Sherlock Holmes, Atticus Finch).

For the harness: the concept phase should emit a `lie_text` field, with optional `lie_origin` (see Ghost) and a planned `arc_type` ∈ {positive, negative, flat}.

### 2.2 The Ghost (Backstory Wound)

The Ghost is the past event that installed the Lie. A childhood loss, a betrayal, a failure. Weiland is firm that the Ghost should rarely be told outright in chapter 1 — instead, it should leak through behavior, dialogue rhythm, and avoidances. The Ghost is the iceberg under the Lie.

In Weiland's character-arc beat alignment, the Ghost is typically:

- **Hinted** at in the Hook.
- **Triggered** at the Inciting Event.
- **Revealed** (partially) around the Midpoint.
- **Confronted** at the Third Plot Point.
- **Resolved** at the Climax.

A planner can reserve a `ghost_text` field at concept phase and tag specific beats with `ghost_role: hint|trigger|reveal|confront|resolve` to ensure the Ghost actually shows up in the prose at the expected positions.

### 2.3 The Truth

The Truth is the corrected belief the protagonist will arrive at by the end of a positive arc:

- Lie: "I am only valuable when I succeed." → Truth: "My worth is independent of my achievements."
- Lie: "Love is weakness." → Truth: "Connection is the source of meaning."

The Truth is sometimes embodied by an **impact character** — a secondary character (mentor, love interest, foil) who already lives the Truth and shows it to the protagonist. Weiland recommends explicit casting of this role at concept phase. For LitRPG: the impact character is often the wise NPC, the older guildmaster, or a mentor PC who challenges the protagonist's progression-min-max worldview.

### 2.4 Want vs. Need

- **Want** — the external, conscious goal driven by the Lie. ("I must become the strongest swordsman to prove my worth.")
- **Need** — the internal correction the Truth provides. ("I must learn that strength isn't worth.")

The arc engine: the Want drives plot until events force the protagonist to choose. At the Third Plot Point or Climax, the protagonist often must give up the Want to gain the Need (or in negative arcs, doubles down on the Want and loses the Need). The harness should track Want and Need as concept-phase fields and check at the climax which the protagonist chose.

### 2.5 Premise Sentence

From *Outlining Your Novel*: the entire novel should compress into a single sentence of the form:

> *"[Protagonist] in [setting] wants [want] but [obstacle / antagonist] forces them to confront [internal lie], leading to [thematic statement]."*

This is the concept-phase elevator pitch and the closest Weiland gets to Sanderson's "promise of the book." The harness can require this field at concept phase and pass it as a constraint into all later phases.

## 3. Planning-Phase Prescriptions

This is where Weiland is most directly translatable into deterministic structure. The percentage-locked beat sheet is the framework's signature contribution.

### 3.1 The Beat Sheet (with Functions)

Ten named beats at specific percentage positions. Total story length = 100%.

**Beat 1 — Hook (1%)**
- *Function*: establish POV, tone, genre, and a question that pulls the reader into the next page.
- *Content*: a moment of mystery, conflict, or characterization that makes the reader ask "what happens next?"
- *Common failure*: starting with weather, exposition, or character introspection in vacuum.

**Beat 2 — Inciting Event (12%)**
- *Function*: the thing that disrupts the protagonist's normal world and that they cannot ignore. Often the protagonist BRUSHES against the main conflict but does not yet commit.
- *Content*: discovery, intrusion, summons, attack. The Ghost may be triggered here.
- *Note*: the Inciting Event is usually NOT the call to adventure being accepted — that's the First Plot Point. The Inciting Event is the disturbance that makes acceptance eventually inevitable.

**Beat 3 — First Plot Point (25%)**
- *Function*: end of Act 1. The protagonist crosses into the main conflict and cannot return to the normal world. The "door slams shut behind them."
- *Content*: commitment to the quest; the reveal that changes the situation; the death / loss / disaster that makes turning back impossible.
- *STRUCTURALLY RIGID*: Weiland argues this should be within ±3% of the 25% mark. Misplacement is the single most common structural failure.

**Beat 4 — First Pinch Point (37%)**
- *Function*: a reminder of the antagonist's power / the stakes. The reader sees clearly what the protagonist is up against.
- *Content*: an antagonist set-piece, a reveal of capability, a defeat for an ally.
- *Often handled by an antagonist POV chapter in multi-POV books.*

**Beat 5 — Midpoint (50%)**
- *Function*: a reveal that reframes the conflict and shifts the protagonist from REACTIVE (running from the antagonist) to PROACTIVE (hunting the antagonist). Sometimes called the "moment of truth," "midpoint reversal," or "midpoint revelation."
- *Content*: information that changes the protagonist's understanding of the situation; the first major confrontation; a victory that proves false; a death that crystallizes resolve.
- *STRUCTURALLY RIGID*: the proactive-shift is the load-bearing functional requirement.

**Beat 6 — Second Pinch Point (62%)**
- *Function*: another antagonist-power reminder, now at higher stakes. The protagonist is on the offense but still outmatched.
- *Content*: counter-attack from antagonist; loss of an ally / resource; reveal of antagonist's deeper plan.

**Beat 7 — Third Plot Point (75%)**
- *Function*: end of Act 2. The protagonist hits their lowest point — the "all is lost" moment. Often a death (literal or symbolic), a betrayal, or the irreversible failure of the protagonist's Want.
- *Content*: the protagonist confronts the Lie. Internal arc forced to a decision: accept Truth (positive arc), reject Truth (negative arc), or recommit to existing Truth (flat arc).
- *STRUCTURALLY RIGID*: misplacement here breaks Act 3 pacing.

**Beat 8 — Climax (88%)**
- *Function*: the final confrontation begins. The protagonist, having internalized the Truth, mounts the final attempt.
- *Content*: the final battle / confrontation / decision sequence.

**Beat 9 — Climactic Moment (98%)**
- *Function*: the single moment of victory or defeat. The Want is achieved or surrendered; the Need is fulfilled (or in negative arcs, denied).
- *Content*: the killing blow, the kiss, the revelation, the choice.
- *STRUCTURALLY RIGID*: this is the load-bearing payoff. Weiland is explicit that everything earlier is in service of this single moment.

**Beat 10 — Resolution (99%)**
- *Function*: aftermath; the new normal; promise tying-up; emotional decompression for the reader.
- *Content*: short. Not a second climax. Often a beat that mirrors the Hook, showing how far the protagonist has come.

### 3.2 STRUCTURAL vs. FLEXIBLE

Per Weiland's own emphasis:

- **STRUCTURAL (within ±3% is recommended)**: First Plot Point (25%), Midpoint (50%), Third Plot Point (75%), Climactic Moment (98%). These four beats are the load-bearing skeleton. Significant misplacement breaks the novel.
- **MODERATELY STRUCTURAL (±5%)**: Inciting Event (12%), Climax (88%). Functionally important but tolerant of placement variance.
- **FLEXIBLE (±10%)**: Hook (1%), First Pinch Point (37%), Second Pinch Point (62%), Resolution (99%). These are useful guides but real published novels show wider variance.

Weiland explicitly acknowledges that very long novels (>150k) can stretch Act 2 and that very short novels (<60k) can compress Act 1 — but the proportional placements remain.

### 3.3 Scene/Sequel (after Dwight Swain)

Weiland adopts and extends Dwight Swain's scene-and-sequel pattern:

- **Scene** = goal → conflict → disaster (or partial setback). External; action-driven.
- **Sequel** = reaction → dilemma → decision. Internal; reflection-driven.

Novels alternate Scene and Sequel. Pure-Scene novels (action-action-action) feel exhausting; pure-Sequel novels feel inert. Weiland adds named subtypes:

- **Goal Scene** — establishing the goal.
- **Conflict Scene** — pursuing it against opposition.
- **Disaster Scene** — failing or partially failing.
- **Reaction Sequel** — emotional fallout.
- **Dilemma Sequel** — weighing options.
- **Decision Sequel** — committing to the next goal, which becomes the next Scene's goal.

This creates a planning grammar at the scene level that complements Sanderson's MICE at the chapter / arc level.

### 3.4 Arc-Aligned Beats

In *Creating Character Arcs*, Weiland aligns the internal arc with the structural beats:

| Structural Beat | Positive-Arc Internal State |
|---|---|
| Hook | Lie is the dominant lens; protagonist seems "fine" |
| Inciting Event | Lie is challenged; protagonist resists |
| First Plot Point | Protagonist commits to a Want driven by the Lie |
| First Pinch Point | Lie causes a setback; protagonist doubles down |
| Midpoint | Truth is glimpsed (often via impact character / revelation); protagonist begins to suspect Lie |
| Second Pinch Point | Lie causes a worse setback; Truth becomes harder to deny |
| Third Plot Point | Protagonist faces the choice between Lie and Truth — usually loses everything they wanted |
| Climax | Protagonist embraces Truth; chooses Need over Want |
| Climactic Moment | Truth is enacted in decisive action |
| Resolution | New normal reflects the Truth |

For negative arcs, the same beats invert (Truth is glimpsed and rejected; Lie hardens; Climactic Moment is a tragic doubling-down).

This is enormously useful for the harness because the planner can emit, per beat, an `arc_state` tag (e.g., `lie_dominant`, `lie_challenged`, `truth_glimpsed`, `truth_resisted`, `truth_embraced`) and a checker can verify the trajectory.

## 4. Drafting-Phase Prescriptions

### 4.1 Scene/Sequel Subtype Per Scene

Each scene tagged with one of {Goal, Conflict, Disaster, Reaction, Dilemma, Decision}. The drafting prompt can select tone / pacing / interiority density appropriate to the subtype:

- **Goal scenes** open with a clear protagonist intention statement.
- **Conflict scenes** pace fast; minimize interiority; tight dialogue.
- **Disaster scenes** end with the loss landing; resist immediate processing.
- **Reaction sequels** lead with feeling; expand interiority.
- **Dilemma sequels** itemize options; permit longer paragraphs.
- **Decision sequels** end with committed action / movement to the next Scene.

### 4.2 Hook Hygiene

Weiland is rigorous about chapter openings: every chapter (not just chapter 1) opens with a mini-hook — a question, a tension, a piece of motion — that pulls the reader past the chapter break. She lists three failure modes:

- **Static descriptive opening** — paragraph of weather / setting before any action or character.
- **Recap opening** — character thinks back over what happened in the previous chapter.
- **Identity-information opening** — full name, age, profession in the first line ("Sarah Mitchell, twenty-eight, was a barista").

### 4.3 Cliffhanger Hygiene

Each scene closes either on a Disaster (ending a Scene unit) or on a Decision (ending a Sequel unit). A scene that ends on a Reaction or a Conflict mid-stride is generally a structural error in pacing.

### 4.4 Show-vs-Tell as Function-Driven

Weiland is more permissive about telling than craft folklore suggests: telling is appropriate for transitions, time compression, and emotional summary. Showing is required for the load-bearing scenes (the four structural beats above all). A planner can mark beats with `mode: show|tell` and a checker can verify load-bearing beats are in show-mode.

### 4.5 Foreshadowing Rules

Weiland's foreshadowing rules align closely with Sanderson's First Law:

- Every revelation in Act 3 should have at least one plant in Act 1 or early Act 2.
- The plant should be subtle enough to miss on first read but obvious in retrospect.
- The Midpoint is often a "double-plant" — a revelation that re-contextualizes earlier plants.

## 5. Validation Prescriptions — Structural-Position Checks

Weiland's framework is unusually checker-friendly because beats live at known positions and have named functions.

- **Position checks**: each named beat must occur within its tolerance window. A First Plot Point at 35% is a structural fail — Act 1 is too long, Act 2 is too short.
- **Function checks**: at the expected position, the actual prose must perform the expected function. A "Midpoint" at 50% that doesn't shift the protagonist from reactive to proactive fails the function check even if it's at the right position.
- **Arc-state checks**: at the Third Plot Point, the protagonist must visibly confront the Lie (positive arc) or visibly reject the Truth (negative arc). A planner that emits `arc_state` tags makes this checkable.
- **Hook check**: chapter 1 must contain a question, tension, or motion in the first paragraph. Static descriptive openings fail.
- **Want / Need check**: the Want must be explicit by the First Plot Point. The Need must be glimpsed at the Midpoint. The choice between them must occur at the Third Plot Point or Climax.
- **Pinch-point check**: at 37% and 62%, an antagonist-power-reminder beat must occur. Pure protagonist-progress in those windows is a pacing failure.
- **Resolution length check**: Resolution should be ≤2% of total length. Long resolutions (5%+) suggest structural drag.
- **Climactic-moment singularity check**: there should be ONE climactic moment near 98%. Multiple "climaxes" (anti-climaxes followed by re-climaxes) usually signal Act 3 misplacement.

## 6. MICE Quotient (Cross-Reference to Sanderson)

Weiland does not use MICE as a primary framework, but her beat sheet maps cleanly onto MICE thread management when both are used together. In a Sanderson+Weiland hybrid:

- The central novel's MICE type (M, I, C, E) determines what KIND of payoff the Climactic Moment delivers.
- The First Plot Point usually OPENS the dominant MICE thread.
- The Midpoint usually advances or reframes it.
- The Climactic Moment CLOSES it.

A combined harness encoding: every Weiland-named beat carries a Sanderson MICE role tag (`open|progress|close`).

## 7. Promise / Progress / Payoff (Cross-Reference to Sanderson)

Weiland's beat sheet IS a Promise / Progress / Payoff structure expressed as timing:

- **Hook + Inciting Event + First Plot Point** = Promise phase.
- **First Pinch + Midpoint + Second Pinch + Third Plot Point** = Progress phase.
- **Climax + Climactic Moment + Resolution** = Payoff phase.

The harness's combined planner can use Weiland's positions as the timing of Sanderson's PPP cycle, and use Sanderson's PPP semantics as the check on Weiland's positions: every promise made in the Hook/Inciting/FPP block needs a payoff at or before the Climactic Moment.

## 8. Lie/Truth/Want/Need as Planner Constraints

This is Weiland's highest-leverage encodable structure beyond the beat sheet itself.

### 8.1 Data Model

```
table character_arc {
  id              uuid pk
  novel_id        uuid fk
  character_id    uuid fk
  arc_type        enum('positive','negative','flat','disillusionment','corruption')
  lie_text        text       -- the false belief at the start
  ghost_text      text       -- backstory wound; nullable
  truth_text      text       -- the corrected belief at the climax (target)
  want_text       text       -- external, conscious goal driven by Lie
  need_text       text       -- internal correction Truth provides
  impact_character_id uuid fk -- secondary character embodying Truth; nullable
  starting_arc_state text    -- "lie_dominant"
  ending_arc_state text      -- "truth_embraced" / "truth_rejected" / etc.
}

table beat_arc_state {
  beat_id         uuid fk
  character_arc_id uuid fk
  arc_state       enum('lie_dominant','lie_challenged','lie_doubled_down',
                       'truth_glimpsed','truth_resisted','truth_chosen',
                       'truth_embraced','truth_rejected')
  ghost_role      enum('hint','trigger','reveal','confront','resolve','none')
}
```

### 8.2 Checker Rules

- Each protagonist must have a `character_arc` row at concept phase.
- The four structural beats (FPP, Midpoint, TPP, Climactic Moment) must each have a `beat_arc_state` for the protagonist.
- Trajectory must match `arc_type`:
  - Positive: lie_dominant → lie_challenged → truth_glimpsed → truth_resisted → truth_chosen → truth_embraced
  - Negative: lie_dominant → lie_challenged → truth_glimpsed → truth_resisted → lie_doubled_down → truth_rejected
  - Flat: lie_dominant (already truth) → repeated truth-tested → truth_held → truth_proven
- Want must be explicit somewhere in the first 25%. Need must be hinted by 50%. Choice must occur at TPP or Climactic Moment.

### 8.3 LLM-Extractor Verification

Per chapter, an LLM extractor reads the prose and emits the protagonist's apparent `arc_state`. Discrepancies between planner-declared and prose-extracted arc state surface as adherence failures.

## 9. Programmatic Levers — 18 Concrete Items

1. **Beat-position validator** — verify each named beat's actual word position is within tolerance.
2. **Beat-function validator** — LLM extractor checks the prose at each named beat performs the named function.
3. **Hook hygiene checker** — first paragraph of chapter 1 must contain a question / tension / motion.
4. **Per-chapter mini-hook checker** — first paragraph of every chapter must contain question / motion / tension.
5. **Resolution-length cap** — Resolution ≤2% of total novel length.
6. **Climactic-moment singularity** — exactly one Climactic Moment beat tag in the planner output.
7. **Lie/Truth/Want/Need schema** — required fields at concept phase for protagonist.
8. **Arc-state per beat** — required for protagonist on the four structural beats.
9. **Arc-trajectory validator** — verifies arc-state sequence matches declared `arc_type`.
10. **Ghost staging schedule** — ghost_role tags at hint / trigger / reveal / confront / resolve positions.
11. **Pinch-point antagonist-power check** — at 37% and 62%, prose must reference / show antagonist capability.
12. **Midpoint reactive→proactive shift check** — POV's grammatical mode (passive vs. active sentence ratio) shifts at midpoint, OR an explicit decision beat occurs.
13. **Want vs. Need explicitness gates** — Want must be on-page by FPP; Need must be hinted by Midpoint.
14. **Scene/Sequel subtype tagger** — every scene tagged Goal / Conflict / Disaster / Reaction / Dilemma / Decision.
15. **Scene/Sequel alternation pacing check** — flag long runs of all-Scene or all-Sequel (>4 in a row).
16. **Foreshadowing-plant audit** — Act 3 revelations must reference at least one plant from Acts 1–2.
17. **Show vs. tell mode tagger** — load-bearing beats forced to show-mode.
18. **Arc-state reconciliation** — planner-declared arc-state vs. LLM-extracted arc-state per chapter; flag drift.

Combined with Sanderson's 20 levers, the harness gets ~38 distinct planner / checker dimensions, far more than the legacy adherence + continuity + chapter-plan-checker triad.

## 10. Limitations of the Weiland Framework

- **Percentages are guidelines, not laws** — Weiland herself emphasizes this, but practitioners often treat them as rigid. Real published novels show 5–10% variance on most beats and 15%+ on some. The harness's beat-position validator should use soft tolerances (warn) rather than hard rejections.
- **Prescription bias toward commercial three-act fiction** — the framework works extremely well for commercial SFF, romance, mystery, and thriller (precisely the harness's target zone) but fits poorly for literary fiction, fragmented timelines, or non-Western narrative forms. For multi-POV novels, beats apply per-POV-arc, not just to the global novel — Weiland addresses this in *Structuring Your Novel* but the percentages get noisier.
- **Lie/Truth binarism** — real character arcs often have multiple Lies (one about self, one about world, one about a relationship). Weiland models the dominant Lie and treats secondary arcs as auxiliary. The harness can extend with `secondary_arcs[]` if needed.
- **Negative-arc and flat-arc patterns are less developed** — the books spend most of their pages on positive arcs. Disillusionment and corruption arcs are sketched but not fully decomposed.
- **No prose-line craft prescription** — Weiland's books are about architecture, not sentences. Pairs cleanly with the harness's separation of planning (structure) and writing (voice via LoRA) layers.
- **Genre-blindness on obligatory beats** — Weiland's beat sheet is structure-agnostic; she does not say "romance must have a meet-cute" or "mystery must have a fair-play clue chain." For genre-obligatory beats, Sanderson's archetype work or `WRITER_GENRE_PACKS` per-genre schemas are needed.
- **Weiland's arc-state vocabulary is informal** — the labels in this report (`lie_dominant`, `lie_challenged`, etc.) are formalizations for the harness, not Weiland's own taxonomy. Her prose describes the states; this document encodes them.

## 11. Citations

Books (all available in print and Kindle):

- Weiland, K.M. *Outlining Your Novel: Map Your Way to Success*. PenForASword Publishing, 2011.
- Weiland, K.M. *Outlining Your Novel Workbook*. PenForASword Publishing, 2014.
- Weiland, K.M. *Structuring Your Novel: Essential Keys for Writing an Outstanding Story*. PenForASword Publishing, 2013.
- Weiland, K.M. *Structuring Your Novel Workbook*. PenForASword Publishing, 2015.
- Weiland, K.M. *Creating Character Arcs: The Masterful Author's Guide to Uniting Story Structure, Plot, and Character Development*. PenForASword Publishing, 2016.
- Weiland, K.M. *Creating Character Arcs Workbook*. PenForASword Publishing, 2017.

Web / blog (helpingwritersbecomeauthors.com):

- *"How to Structure a Story: 7 Steps That Guarantee Success"* — beat-sheet primer.
- *"The 5 Most Common Mistakes Writers Make With the First Plot Point"* — diagnostic for the 25% beat.
- *"Lie the Character Believes"* (multi-part series) — concept-phase scaffolding.
- *"Three-Act Structure Posts"* — large series with example breakdowns of published novels.

Adjacent / cited:

- Swain, Dwight V. *Techniques of the Selling Writer*. University of Oklahoma Press, 1965. The Scene/Sequel original; Weiland's debt is explicit.
- Truby, John. *The Anatomy of Story*. FSG, 2007. Cross-referenced for Want/Need vocabulary.
- Card, Orson Scott. *Characters and Viewpoint*. Writer's Digest Books, 1988 / 2010. Source of MICE; Weiland uses the broader idea informally.
- Snyder, Blake. *Save the Cat!*. Michael Wiese, 2005. Adjacent beat-sheet work; Weiland's framework is more novel-oriented than screenwriting-oriented.
- Brooks, Larry. *Story Engineering*. Writer's Digest, 2011. Independent percentage-locked beat-sheet work that closely parallels Weiland's; useful triangulation.

Podcast / video:

- Helping Writers Become Authors podcast (K.M. Weiland) — long-running; episodes cover each beat in depth.
- Weiland's YouTube channel (@KMWeiland) — short-form lectures aligned with the books.

---

*Notes on harness application — Weiland's highest-leverage encodings for the Novel Harness are the beat-position validator (timing layer), the Lie/Truth/Want/Need character-arc schema (internal-arc tracking layer), and the Scene/Sequel subtype tagger (drafting-prompt customization layer). All three slot cleanly into the existing two-phase planner without architectural change. Combined with Sanderson's MICE + Promise/Progress/Payoff + Magic Laws, the harness gets a near-complete planning-layer grammar: Sanderson handles WHAT KIND of contracts (MICE thread types, magic system constraints, genre archetypes), Weiland handles WHEN those contracts hit load-bearing moments (beat positions) and HOW the protagonist's internal state must move at each. A planner that emits both Sanderson MICE-tags and Weiland beat-tags per chapter, plus Lie/Truth/Want/Need per protagonist, and that gates drafting on a pre-write structural validator, would be a substantial advance over the current adherence + chapter-plan-checker pipeline. The percentage-locked beat sheet is particularly valuable because it provides cheap, deterministic, position-based first-pass checks that don't require LLM calls — just word-count math and tag presence.*
