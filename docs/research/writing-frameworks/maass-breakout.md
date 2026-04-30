# Donald Maass — Breakout Quality Diagnostic Framework

**Author**: research-pass-2026-04-29
**Frameworks**: Donald Maass, *Writing the Breakout Novel* (2001) + *Writing the Breakout Novel Workbook* (2004); *The Fire in Fiction* (2009); *The Emotional Craft of Fiction* (2016); *The Career Novelist* (1996); Writer Unboxed essays (2008-present)
**Target encoding**: planner constraints, beat prompts, checker rules across `src/phases/{concept,planning,drafting,validation}.ts`
**Length target**: 3000-5000 words

---

## 1. Framework summary

Donald Maass is a literary agent (Donald Maass Literary Agency, founded 1980) whose craft books and workshops are organized around a single empirical claim: across thousands of submitted manuscripts, the difference between books that sell modestly and books that "break out" — that hit list-makers, drive word of mouth, and build careers — is not idea quality, voice talent, or plot ingenuity but **the relentless presence of tension at every level of the prose, top to bottom**. His books decompose this claim into operational layers: premise selection (does the idea generate stakes that resonate?), character construction (are the characters larger-than-life with productive contradictions?), plot architecture (does every scene contain tension, and do outer/inner/world-story layers reinforce each other?), and — the layer he developed most fully across his three primary craft books — **microtension**, the moment-to-moment pressure inside the smallest unit of prose, often produced by emotional contradiction in the POV character.

For a per-beat writing harness, Maass is the most directly encodable craft authority in the literature, because his unit of analysis is *the page* and *the line*, which maps cleanly onto our beat-level pipeline (beats are ~290-token chunks, roughly a page of prose). His diagnostic exercises (workshop-tested for twenty-plus years across his Breakout Novel Intensives) are formulated as questions a writer asks of a randomly selected page — those translate one-to-one into LLM-call checker rules. Of all his contributions, **microtension** is the single highest-leverage prose-quality insight we are not currently encoding, and section 6 of this report goes deep on it.

---

## 2. Maass at the concept phase

### 2.1 Premise selection: stakes that resonate

In *Writing the Breakout Novel* (Ch. 2 "Stakes"), Maass argues breakout-quality stakes operate on three levels simultaneously:

- **Personal stakes** — what does the protagonist stand to lose that matters to *them*, in terms the protagonist would articulate? (Loss of a person, loss of a self-concept, loss of a place.)
- **Public stakes** — what does the protagonist stand to lose that matters to *others around them*? Family, community, faction. The stakes are visible to other characters, not only interior.
- **Ultimate stakes** — what is the largest possible framing of what is at risk? (Civilization, faith, the nature of love, the soul.)

A premise that resonates carries all three. A thriller premise with only ultimate stakes ("the bomb destroys the city") and no personal stakes ("...but the protagonist barely knows the city") reads thin. A literary premise with only personal stakes ("the marriage is failing") reads claustrophobic. The breakout premise nests them: the marriage failing is also (publicly) the family pulling apart and (ultimately) a question about whether love can survive truth.

**Encoding**: at the concept phase, after world-builder and plotter emit their drafts, run a stakes-triangulation LLM call: "given this premise, list (a) what the protagonist personally stands to lose, (b) what their community stands to lose, (c) what is the largest framing of what is at stake. Score each on a 0-3 scale." Premises scoring below 2 on any dimension are flagged; the planner is asked to deepen.

### 2.2 Larger-than-life characters

In *The Fire in Fiction* (Ch. 1 "Protagonists vs. Heroes"), Maass distinguishes *protagonists* (characters who happen to be the camera) from *heroes* (characters readers want to follow). Heroes are constructed from three operational features:

- **Productive contradictions** — a quality and its apparent opposite living in the same character: tender and ruthless, devout and cynical, generous and possessive. The contradiction must be productive — i.e., it generates story by surfacing in scenes — not decorative.
- **Distinctive ways of speaking** — a syntactic, lexical, or rhythmic signature that is recognizable across hundreds of pages. Maass's example exercises ask writers to write three lines of dialogue for a character and then read them aloud; if a stranger could not identify the speaker, the voice is not yet distinctive.
- **Signature gestures** — physical or behavioral tics that recur and accrue meaning. Not crutches (every character "shrugs"); meaningful tics (the priest who touches his pocket where the rosary used to be).

**Encoding**: at the concept phase, for each named character, the character-agent is asked to emit `productiveContradictions: string[]` (at least one) and `signatureGesture: string`. A checker call verifies that the contradictions are productive (each can be plausibly tested by a scene) and that the signature gesture is specific (not "shrugs"). The speech-pattern field already exists in our character schema; Maass's contribution is to make us check whether the field is actually distinctive (a side-by-side LLM compare of the protagonist's speech pattern vs. each other major character's; convergence flags the field).

### 2.3 First-page hooks

In *The Fire in Fiction* (Ch. 8 "Tension on Every Page"), the strongest version of the page-1 rule is: tension must be present from the first paragraph, and the tension does not have to be plot-tension — it can be tonal, situational, or emotional. The dictum: "open in motion, with friction." The first sentence does work; the first paragraph generates a question the reader needs the next paragraph to answer.

**Encoding**: the first beat of chapter 1 receives a stricter adherence-checker pass: must contain at least one of (interpersonal friction, internal contradiction, situational threat, tonal dissonance) detectable by the events-classifier. Beats that pass the regular adherence check but fail this stricter first-page check are rewritten with a hook-emphasis prompt.

---

## 3. Maass at the planning phase

### 3.1 Tension on every page

This is Maass's single most quoted dictum and the title of *The Fire in Fiction*'s longest chapter. The claim: every scene, even quiet scenes, must carry tension, and the recipe for guaranteeing this is to ask "what does the POV character feel about something on this page?" If the answer is "nothing in particular," the scene is broken regardless of how elegant the prose is. The fix is not to add more plot — it is to deepen what the protagonist *feels about* whatever is happening, even if what is happening is mundane.

The planning-phase implication: every chapter outline must specify, for each scene/beat, *what the POV character feels about something* — not the plot event, the felt response. Scenes whose plan reads as pure event ("Aragorn meets Boromir at the council") without affective dimension ("Aragorn meets Boromir at the council; Aragorn feels admiration shadowed by mistrust because Boromir reminds him of the brother he never had and the king he refuses to be") are pre-flagged for the planner.

**Encoding**: extend the per-beat planning schema with a required `povAffect: string` field — short (≤30 words), required, validated for non-emptiness and non-genericness ("happy" / "sad" / "fine" → reject; "admiration shadowed by mistrust" → accept). The planning-beats agent already produces `description`; we add affect as a sibling.

### 3.2 Plot layers: outer story / inner story / world story

In *The Fire in Fiction* (Ch. 2 "Building Plots from Plot Layers"), Maass argues breakout-quality novels braid three plot strands rather than running one:

- **Outer story** — the visible plot, the events that an outsider could observe (the war, the heist, the courtship).
- **Inner story** — the protagonist's internal change arc (the wound healing, the worldview revising, the courage developing).
- **World story** — the change in the world, society, or set of characters around the protagonist, independent of whether the protagonist drove it (the kingdom shifting, the family changing shape, the community accepting or expelling).

Single-layer plots feel thin; layered plots feel inevitable. The diagnostic: for each chapter, can you state how each of the three strands progressed? If only the outer moved, the chapter is thin.

**Encoding**: extend chapter-level planner output with three short fields per chapter: `outerProgression`, `innerProgression`, `worldProgression`. Empty/no-change values are permitted (not every chapter advances all three) but at least two of three should advance per chapter, and every chapter should advance at least one. The chapter-plan-checker validates this — call it `plotLayerCoverage`.

---

## 4. Maass at the drafting phase — microtension (deep section)

This is the report's longest section because microtension is, on the harness's strategic priorities, the highest-leverage prose-quality insight we are not currently encoding.

### 4.1 What microtension is

In *The Fire in Fiction* (Ch. 8) and *The Emotional Craft of Fiction* (Ch. 4-6), Maass defines microtension as **tension at the smallest scale of prose — the line, the paragraph, the page — produced not by plot but by emotional friction inside the POV character or between the POV character and what is in front of them**. Microtension is what keeps readers turning pages even when nothing plot-relevant is happening; its absence is what causes readers to set books down even during plot-relevant scenes.

The structural claim: macrotension (will they survive the war? will they win the trial?) operates on book-scale and chapter-scale; mesotension (will they make it out of this room? will this conversation go well?) operates on scene scale; microtension operates on paragraph scale and is the only one that determines whether the reader keeps reading the *next* paragraph. A novel can have impeccable macro and meso tension and still be unreadable if the microtension is absent.

The mechanism: microtension comes from **the reader sensing two things at once in the POV character that are in tension with each other**. Love and fear. Hope and dread. Want and revulsion. Loyalty and contempt. Pride and shame. The two states do not resolve into one; they coexist, and their coexistence generates the question the reader needs the next paragraph to answer ("which one wins, in this beat?").

This is not the same as conflict between characters (that's mesotension) or threat from the environment (that's situational tension). It is friction *inside* the POV character at the line level. A character can be alone in a quiet room reading a letter and the prose can be charged with microtension if the letter produces simultaneous, contradictory feelings.

### 4.2 Why microtension is the highest-leverage encodable insight for our harness

The harness's beat-writer produces ~290 tokens of prose per beat. That is the unit at which microtension lives. Plot tension is set by the planner (we already have that); scene tension is set by the planner-to-beat-list expansion (we already have that). Microtension is the layer the writer either delivers or fails to deliver, and we currently have **no checker that validates it**. Adherence-events checks for plot-event presence; chapter-plan-checker checks cross-beat properties; hallucination-checker checks for ungrounded claims and corpus leak. None of them ask "does this beat's prose contain emotional contradiction in the POV character?"

That single question, asked of every beat by a small fast LLM, is — based on Maass's empirical claim across thousands of manuscript reads — the highest-leverage prose-quality signal available. A beat that fails it can be regenerated with an explicit microtension prompt ("rewrite this beat with the POV character feeling two contradictory emotions about the same object — name them, let them coexist on the page"). This is the same shape as our existing quality-redraft gate (`pipeline.qualityRedraftEnabled`); microtension absence becomes a third detected defect alongside repetition-loop and underlength.

### 4.3 Maass's specific microtension techniques

Across *The Fire in Fiction* Ch. 8 and *The Emotional Craft of Fiction* Ch. 4-7 and his Writer Unboxed columns, Maass enumerates roughly a dozen microtension techniques. The most operational subset:

1. **Contradictory simultaneous emotions** — the core technique. The POV character feels A and not-A about the same object at the same time. Love + fear, hope + dread, attraction + repulsion, gratitude + resentment.

2. **Mismatch between what is felt and what is said/done** — the character feels one thing and acts another, and the prose makes the reader *see* the gap. Pretending to be calm while internally alarmed; smiling while bitter; agreeing while certain it is a mistake.

3. **Mismatch between expectation and observation** — the POV character expected X to feel/be a certain way, and it isn't. A long-anticipated reunion that lands flat; a feared encounter that turns benign; a "victory" that produces grief.

4. **Forbidden thoughts surfacing** — the POV character has a thought that violates their self-image (the priest's flicker of doubt; the loving parent's flicker of resentment; the loyal friend's envy). The thought is acknowledged on the page, not buried.

5. **Sensory detail charged with emotional resonance** — a physical detail (the smell of bread, the slant of light) carries a charge that competes with the surface event. The detail is not decoration; it is a vector for a feeling that conflicts with what the scene is "supposed" to be about.

6. **Dialogue with subtext** — characters say A while wanting B; the reader feels the gap. Maass's note: subtext requires the POV character to *register* the gap; if the POV character is oblivious, the reader feels nothing.

7. **Time pressure inside emotional pressure** — the character must feel, decide, and act inside a small window, and the felt-decide-act sequence is itself in tension (they want to do A, know they should do B, will feel C either way).

8. **Memory intrusion** — a present moment is interrupted by a memory that pulls the felt register sideways. The intrusion is the friction. The character is in one emotional register and a memory pulls them to another.

9. **The third-level emotion** — the emotion below the emotion below the surface. Surface: anger. Below anger: hurt. Below hurt: shame at having been the kind of person this could happen to. The third-level emotion is the one that registers as true to the reader because surface emotions read as melodramatic when named, but third-level emotions read as recognized.

10. **Showing the emotion the reader will feel, not what the character feels** — Maass's reformulation of "show don't tell" specifically for emotion. The page does not say "she was sad"; the page does not even say "her chest tightened and her eyes burned"; the page constructs the situation, detail, and rhythm such that the reader *feels* sad on the character's behalf. The character may be doing something else entirely (laughing, cooking, lying) — the reader is the one carrying the emotion.

Techniques 9 and 10 are *The Emotional Craft of Fiction*'s specific contribution beyond *Fire in Fiction*. They are also the hardest to encode as a checker because they require the LLM to reason about what the *reader* would feel, not what the *prose* states. A practical proxy: technique 1 (contradictory simultaneous emotions) plus technique 4 (forbidden thought surfacing) plus technique 6 (subtext gap registered by POV) covers most of the microtension-positive cases and is checkable.

### 4.4 The microtension detector — concrete LLM-call shape

Per beat (after writer emits prose), call a small fast checker:

```
System: You are a microtension detector. Microtension is emotional contradiction in
the POV character — two feelings about the same thing in the same beat that do not
resolve. Examples: love + fear, hope + dread, want + revulsion, gratitude +
resentment, loyalty + doubt.

Given the beat prose below, answer:
1. Does this beat contain microtension as defined? Y/N
2. If Y, name the two contradictory feelings in 4-8 words.
3. If N, what is the dominant single emotional register? In 4-8 words.
4. If N, suggest the contradiction that would most plausibly fit the scene
   (one sentence).

Beat prose:
{{beat_text}}
```

Cost: ~400 input + ~80 output ≈ 480 tokens at DeepSeek prices ≈ $0.0001 per beat. For a 30-chapter novel × 14 beats/chapter = 420 beats × $0.0001 = $0.042 per novel. Negligible.

Outcome routing:
- **Y** → log microtension pair to telemetry; beat passes.
- **N with dominant register that is "neutral" / "informational" / "transitional"** → low-priority flag; beat passes (some beats are transition glue and should not be force-charged).
- **N with dominant register that is a strong single emotion** → fire the quality-redraft gate; regenerate the beat with the suggested contradiction in the prompt.

### 4.5 Why a per-beat microtension prompt also belongs at generation time

A checker-then-redraft loop catches misses but spends two writer calls for every miss. Cheaper: include a microtension hint *in the writer prompt* so beats are more likely to land microtension on the first call. Maass's implicit instruction-set translates to a 60-token prompt addendum:

> Inside this beat, let the POV character feel two things at once about the same object — name them in the prose by gesture, sensory detail, or unguarded thought. Do not resolve the contradiction; let it coexist.

We can A/B this against the current writer prompt to verify it improves microtension-detector pass rate without harming other adherence metrics.

---

## 5. Maass at the validation/diagnostic phase

Maass's workshops are organized around exercises a writer performs on a *finished* draft, not on outlines. The most encodable exercises:

### 5.1 The random-page tension test

The exercise: open the manuscript to a random page; can you find tension on it within 30 seconds? If not, the page is broken regardless of where it is in the book. The fix is mechanical — deepen what the POV character feels.

**Encoding**: at validation, sample N random beats from the completed novel (default N=10 for short stories, N=30 for full novels). For each sampled beat, run the microtension detector (section 4.4). Report a tension-coverage percentage. Below threshold (e.g., <70%) the validation phase logs a warning; below a stricter threshold (e.g., <40%) we surface an explicit diagnostic in the Studio UI ("X% of randomly sampled pages lack detectable tension; consider running quality-redraft on flagged beats").

### 5.2 The contradiction inventory

The exercise: list every productive contradiction in the protagonist; verify each surfaces in at least one scene. Contradictions that are listed but never surfaced are decoration, not character.

**Encoding**: validation pulls the `productiveContradictions` field from the concept-phase character record and runs a coverage check: for each listed contradiction, does any scene/beat in the completed prose surface it? An LLM pass over chapter summaries scores 0-1 per contradiction. Uncovered contradictions are flagged.

### 5.3 The plot-layer coverage report

The exercise: for each chapter, list how outer / inner / world progressed. Chapters with only outer progression are thin.

**Encoding**: validation summarizes each chapter against the planner's `outerProgression` / `innerProgression` / `worldProgression` fields and verifies the prose actually delivered each. Mismatches are flagged.

### 5.4 The first-and-last-line audit

The exercise: read every chapter's first line and every chapter's last line in sequence. The first lines should each pose a question; the last lines should each leave the reader pulled forward. Maass's diagnostic: if the last line is a wind-down, the chapter break is in the wrong place.

**Encoding**: validation extracts first-and-last-line pairs per chapter, runs a hook-detector LLM call on each, reports which chapters have weak hooks at either end.

---

## 6. Programmatic levers — summary table

| Phase | Lever | Maass source | Implementation shape | Cost per novel |
|-------|-------|--------------|----------------------|----------------|
| Concept | Stakes triangulation (personal/public/ultimate) | *Breakout Novel* Ch. 2 | LLM call after concept phase emits draft; flag low-scoring premises | ~1 call, ~$0.0005 |
| Concept | Productive-contradictions field per character + check | *Fire in Fiction* Ch. 1 | Schema field + LLM check that contradictions are productive | ~1 call per char |
| Concept | Distinctive-voice cross-character compare | *Fire in Fiction* Ch. 1 | LLM compares speech-pattern fields pairwise; flag convergence | ~1 call |
| Concept | Signature gesture per character + specificity check | *Fire in Fiction* Ch. 1 | Schema field + LLM check (reject "shrugs") | ~1 call per char |
| Concept | First-page hook strict adherence | *Fire in Fiction* Ch. 8 | Stricter adherence pass on chapter-1 beat-0 | included in adherence |
| Planning | `povAffect` field per beat | *Fire in Fiction* Ch. 8 | Required schema field, validated non-empty/non-generic | schema-time |
| Planning | Plot-layer coverage (outer/inner/world) per chapter | *Fire in Fiction* Ch. 2 | Three required fields; checker validates ≥1 advances | included in chapter-plan-checker |
| **Drafting** | **Microtension detector per beat** | ***Fire in Fiction* Ch. 8 + *Emotional Craft* Ch. 4-6** | **Small fast LLM Y/N + named pair; routes to quality-redraft on miss** | **~$0.04/novel** |
| Drafting | Microtension hint in writer prompt | *Emotional Craft* Ch. 4 | 60-token prompt addendum | prompt-token cost only |
| Validation | Random-page tension test | *Breakout Novel* workshop | Sample N beats, run microtension detector, report coverage | ~$0.003/novel at N=30 |
| Validation | Contradiction-coverage check | *Fire in Fiction* Ch. 1 | LLM verifies each listed contradiction surfaces in prose | ~1 call |
| Validation | Plot-layer-delivered check | *Fire in Fiction* Ch. 2 | LLM verifies planner's outer/inner/world predictions | ~1 call/chapter |
| Validation | First-and-last-line audit | *Breakout Novel* workshop | Hook-detector on chapter boundaries | ~2 calls/chapter |

The microtension detector is the row to ship first. It is the highest-leverage and operationally simplest. Everything else can follow; this one is the keystone.

---

## 7. Limitations

**"Tension on every page" can produce over-stuffed prose if applied rigidly.** Some beats genuinely should be quiet glue; forcing emotional contradiction into every transition produces a melodramatic register that exhausts the reader. The microtension detector should treat transitional/informational beats as a recognized "low-tension OK" class, not as failures. Maass himself, in workshop, distinguishes between *charged quiet* (tension is present but muted) and *empty quiet* (tension is absent); the detector should aim at the second.

**Microtension as a checker can produce false positives on intentional minimalism.** Some genres and voices (Hemingway-derived prose, certain literary minimalism) achieve their effect through deliberately flat surfaces with implied depth. A naive microtension detector might fail these. Mitigation: the detector returns *what it didn't find* alongside Y/N, and the writer prompt's voice/genre context (e.g., minimalist tag) can soften the redraft trigger.

**Three-layer plot architecture (outer/inner/world) does not fit all genres.** Pure puzzle plots, certain action genres, and some commercial subgenres prioritize outer-story velocity over the layering. Forcing inner-arc commitment in a fast-action LitRPG might harm pacing. Mitigation: plot-layer coverage thresholds should be per-genre, with action-genre seeds tolerating outer-only chapters at higher rates than literary or character-arc-driven seeds.

**Larger-than-life characterization can cross into camp.** Productive contradictions plus signature gestures plus distinctive speech, applied without restraint, produces costume-drama protagonists. Maass acknowledges this; the antidote is *believability* — the contradictions must trace to plausible psychological causes, not be applied like accessories. Encoding caveat: the contradiction-check should also verify *plausible cause*, not just *productive*.

**Stakes triangulation can produce stakes-inflation.** A premise with strong personal stakes is sometimes weakened by forcing in ultimate stakes that aren't earned. ("She wants her marriage back — and also civilization is collapsing.") Mitigation: the stakes-triangulation check should reward *coherent* nesting, not maximal stakes; an LLM judge can be prompted to prefer "personal stakes that imply public stakes that imply ultimate stakes" over independent additive stakes.

**The first-page-hook rule can produce same-shape openings across all chapters.** If every chapter's first beat is hook-prompted, the reader pattern-matches the cadence and the hooks lose force. Mitigation: apply the strict hook rule to chapter 1 only; later chapters use the regular adherence pass with a softer "open with motion" hint.

**Microtension is per-writer-genre dependent.** The contradiction-pair vocabulary that lands in fantasy ("loyalty + doubt") is not the same that lands in literary fiction ("envy + tenderness") or thriller ("trust + suspicion"). The detector's example list should be genre-conditioned via the existing `WRITER_GENRE_PACKS` routing.

---

## 8. Citations

- **Maass, Donald.** *Writing the Breakout Novel*. Writer's Digest Books, 2001.
- **Maass, Donald.** *Writing the Breakout Novel Workbook*. Writer's Digest Books, 2004.
- **Maass, Donald.** *The Fire in Fiction: Passion, Purpose, and Techniques to Make Your Novel Great*. Writer's Digest Books, 2009.
- **Maass, Donald.** *The Emotional Craft of Fiction: How to Write the Story Beneath the Surface*. Writer's Digest Books, 2016.
- **Maass, Donald.** *The Career Novelist: A Literary Agent Offers Strategies for Success*. Heinemann, 1996. (Free PDF on the Donald Maass Literary Agency website.)
- **Maass, Donald.** Writer Unboxed monthly column, 2008-present. (Selected: "The Microtension of Now," "Tension All the Time," "Writing the Third Level of Emotion," "What Makes a Hero," "The Plot Whisperer.") Writer Unboxed, writerunboxed.com.
- **Donald Maass Literary Agency.** Breakout Novel Intensives workshop curricula (referenced in *Workbook* and *Fire in Fiction*).

---

## 9. One-paragraph summary

Donald Maass's breakout-quality framework, distilled across *Writing the Breakout Novel* (2001), *The Fire in Fiction* (2009), and *The Emotional Craft of Fiction* (2016), is built on a single empirical claim from a literary agent's view of thousands of manuscripts: breakout novels have relentless tension at every level, and the level that determines whether a reader keeps turning pages is **microtension** — emotional contradiction inside the POV character at the line/paragraph scale (love + fear, hope + dread, gratitude + resentment), unresolved on the page. The framework's other layers (three-tier stakes at the concept phase; productive contradictions and signature gestures for characters; outer/inner/world plot layering at the planning phase; tension-on-every-page; the third level of emotion; "show the emotion the reader will feel, not what the character feels") all support and culminate in microtension. The single highest-leverage encoding for our beat-level harness is a per-beat microtension detector — a small fast LLM call (~$0.0001/beat, ~$0.04/novel) that asks "does this beat contain emotional contradiction in the POV character? Y/N + named pair," with N-results routing to the existing quality-redraft gate alongside repetition-loop and underlength defects, plus a 60-token microtension hint added to the writer prompt at generation time. Secondary encodings include a stakes-triangulation check at concept, a `povAffect` required field per planned beat, an outer/inner/world plot-layer-coverage check per chapter, and a random-page tension-coverage report at validation (Maass's signature workshop diagnostic). Limitations: tension-everywhere can over-charge transitional glue, three-layer plotting can fight pure puzzle/action genres, and microtension vocabulary is genre-dependent and should route through `WRITER_GENRE_PACKS`. Of all encodable craft authorities reviewed for the harness, Maass's microtension is the single most actionable prose-quality structural insight currently absent from our checker stack.
