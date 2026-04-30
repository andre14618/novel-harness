# Story (Robert McKee) — Framework Report for Novel Harness

> **Purpose.** Extract structural constraints from Robert McKee's *Story: Substance, Structure, Style and the Principles of Screenwriting* (1997) that can be encoded as planner rules, beat-level prompt instructions, or checker rules in a programmatic novel-writing pipeline. McKee's framework predates and underwrites Story Grid; where Coyne is engineering-checklist, McKee is principle-driven and prose-rich. The trade-off: deeper insight, more interpretive labor to convert into machine-checkable rules. The single most important McKee mechanic for our checker layer is **the gap** — the difference between a character's expectation and the actual result of their action — and the fact that *every scene must produce a measurable value-charge shift*, identical to Coyne's value-shift rule but with crisper philosophical grounding.

---

## 1. Framework summary

**Origin.** Robert McKee taught the *Story Seminar* at USC starting 1984; the book *Story: Substance, Structure, Style and the Principles of Screenwriting* (HarperCollins, 1997) is the codified curriculum. Although nominally a screenwriting book, McKee's principles are explicitly cross-medium and have been adopted as a craft baseline in novel writing, showrunning, and game narrative design. Follow-up books *Dialogue* (2016) and *Character* (2021) extend the framework into prose-specific territory.

**Core thesis.** Story is "the metaphor of life lived" — a controlled, dramatized argument about human existence. McKee's framework is built on three nested ideas:

1. **The gap is the engine of story.** A character takes an action expecting a result; the world delivers a different result; the gap forces the character to take a riskier action. Story is this widening spiral of expectation/reality mismatches.
2. **Every scene is a value-charge shift.** A scene is not a unit of *event* but a unit of *change in human condition*. If the character's situation along the value axis at scene-end is identical to scene-start, no scene has occurred.
3. **The Controlling Idea is the spine.** Every story argues a single proposition — the value+cause statement that the climax demonstrates. Theme is what the climax *proves*.

McKee is the philosophical source for ~70% of what Coyne later operationalized. Where Coyne offers checklists, McKee offers principles you must understand before the checklists can be sensibly applied. For our harness this means McKee's content shapes *prompt engineering* (the writer LLM's understanding of what a beat is *for*) and *meta-checker design* (how the checker should reason about defects), more than it provides direct deterministic rules.

---

## 2. Concept-phase prescriptions

### 2.1 The Controlling Idea (Ch. 5)

McKee's central concept-phase artifact: **"VALUE prevails because CAUSE."**

Examples (McKee's own):
- *Star Wars*: "Good triumphs because the hero outsmarts the technologically superior evil."
- *Chinatown*: "Evil triumphs because the powerful exploit the weak."
- *Kramer vs. Kramer*: "Love endures when we sacrifice our needs for those we love."

The structure is rigorous:
- **VALUE** must be the final-state of the controlling value (positive or negative).
- **CAUSE** must be a single, specific, dramatized causal mechanism — not a platitude.
- The climax must *embody* the VALUE/CAUSE pair as concrete action, not statement.

A novel without a controlling idea is, in McKee's terms, "well-told nothing."

**Programmatic implication.** The seed must capture `controllingIdea: { value: string, cause: string }`. The pre-planning conversationalist already extracts thematic intent informally; making it strict and McKee-shaped tightens the entire pipeline downstream because the planner, drafter, and checker can all reference the same north-star claim.

### 2.2 Archetypal vs. Stereotypical (Ch. 1, Ch. 17)

A foundational McKee distinction often misread:

- **Stereotypical** = setting and characters whose particulars are interchangeable with hundreds of other works (the generic detective, the generic dystopia).
- **Archetypal** = setting and characters whose particulars are unique and culturally specific, but whose human conflicts are universal.

McKee's prescription: write archetypal, not stereotypical. The cure for stereotypicality is *specificity*. The dystopian state should not be "a totalitarian government"; it should be "the Ministry of Truth, where Winston Smith rewrites yesterday's newspapers in pneumatic-tube-delivered shifts." Specificity at the level of object, ritual, and idiom is what makes a setting archetypal.

For our seed/concept phase: a checker can flag generic worldbuilding by detecting category-noun-without-specific-noun ratios ("the king's army" with no army name, no equipment specifics, no formation conventions = stereotypical). This is a planner-time check.

### 2.3 The Inciting Incident (Ch. 8)

The Inciting Incident is the event that radically upsets the balance of forces in the protagonist's life. McKee's rules:

1. It must occur **on-screen** (dramatized), not in backstory.
2. It must be **causal** preferably, **coincidental** as a fallback (and only once per story).
3. It must create the **Object of Desire** — the *specific* thing the protagonist must achieve to restore balance.
4. It must occur **in the first 25%** of the runtime (with rare exceptions).

For our planner: the Beginning Hook section must contain a beat tagged `incitingIncident: true`, dramatized, occurring in chapters 1–N/4.

### 2.4 Internal vs. External Desire

Adjacent to Coyne's external/internal genre split:
- **Conscious desire** (external): what the protagonist says they want.
- **Unconscious desire** (internal): what the protagonist actually needs.

In multi-protagonist or simple-plot stories, conscious and unconscious can align. In complex, character-driven stories, they conflict — and that conflict is the inner story. The **antagonism axis is fourfold**: physical, social, personal, internal. Strong stories pressure the protagonist on multiple axes simultaneously.

---

## 3. Planning-phase prescriptions

### 3.1 The Story Triangle: Archplot / Miniplot / Antiplot (Ch. 3)

McKee's structural taxonomy:

- **Archplot** — classical design: single active protagonist, external conflict, linear time, causal chain, closed ending, consistent reality. The Hollywood-three-act default.
- **Miniplot** — deliberate minimalisms: passive protagonist, internal conflict primary, possibly multiple protagonists, open ending. *Tender Mercies*, *Lost in Translation*.
- **Antiplot** — anti-classical: nonlinear, coincidence-driven, inconsistent reality, ironic. *Pulp Fiction*, *Memento*.

Most commercial novels are Archplot or Archplot+Miniplot hybrids. McKee's caution: choose deliberately. Defaulting to Archplot is fine; defaulting to Antiplot without intent is fatal.

For our seed: `narrativeMode: archplot | miniplot | antiplot`. Determines which of McKee's other rules apply. (Archplot is the default for our LitRPG/fantasy focus.)

### 3.2 Five-Part Structure: Inciting Incident → Progressive Complications → Crisis → Climax → Resolution (Ch. 8–11)

This is the structural skeleton Coyne later promoted into the "Five Commandments." In McKee's hands:

- **Inciting Incident** — radical imbalance; protagonist's life is now defined by pursuit of the Object of Desire.
- **Progressive Complications** — each successive obstacle requires *greater willpower, takes greater risk, and reveals deeper character*. The stakes escalate by qualitative leaps, not arithmetic increments.
- **Crisis** — the *Crisis Decision*: protagonist faces a choice between irreconcilable goods or the lesser of two evils. McKee insists this is *the* moment of true characterization (Ch. 7: "True character is revealed in the choices a human being makes under pressure").
- **Climax** — the action taken in consequence of the Crisis Decision. Not a battle; the *moment of irrevocable change*. Often quiet.
- **Resolution** — the new equilibrium. McKee: "spend resolution time proportionate to the depth of disturbance."

Applied to our two-phase planner: the chapter skeleton (Phase 1) is the Archplot's three-act spine; the per-chapter beat expansion (Phase 2) is where the five-part structure recurs at the chapter level (each chapter is itself a mini-Archplot in well-built fiction).

### 3.3 The Three Levels of Conflict (Ch. 9)

McKee names three levels of conflict, all of which strong fiction operates on simultaneously:

1. **Inner conflict** — within the protagonist's psyche/heart.
2. **Personal conflict** — between protagonist and intimate others (family, friends, lovers).
3. **Extra-personal conflict** — institutional, social, environmental, supernatural.

A planner that produces only extra-personal conflict (boss fights and quest objectives) without inner and personal conflict produces a flat, externally-driven story. Conversely, all-internal conflict without extra-personal stakes is the miniplot trap.

**Programmatic check:** for each chapter, classify primary conflict level. Flag manuscripts running >70% on a single level for >3 consecutive chapters.

### 3.4 Sequence and Scene (Ch. 2, Ch. 11)

McKee's hierarchy:

```
Beat (gesture/exchange)
  → Scene (value-shifting unit, 800–2500 words typical in prose)
    → Sequence (2–5 scenes building to a larger value shift)
      → Act (3–5 sequences building to act-end value reversal)
        → Story (3 acts; final act-end is climax)
```

Crucially: **each level produces a value shift greater than the level below.** A beat shifts the charge slightly; a scene shifts it noticeably; a sequence shifts it significantly; an act shifts it irreversibly; the story shifts it definitively.

Mapping to our pipeline:
- **Beat** ≈ McKee's beat (we have 14/chapter avg in Salvatore-trained planning).
- **Scene** = scene group (3–5 of our beats; we don't currently annotate these).
- **Sequence** = often a chapter or chapter pair.
- **Act** = the Beginning Hook / Middle Build / Ending Payoff regions.

This is the same structural pyramid Coyne uses, sourced from McKee.

### 3.5 The Negation of the Negation (Ch. 11)

McKee's stakes-escalation rule. For any value, the deepest negative state is not the simple opposite but the *contradiction-of-the-contradiction*:

| Value | Contrary | Contradictory | **Negation of the Negation** |
|---|---|---|---|
| Love | Indifference | Hate | **Self-hate masquerading as love** ("I'm hurting you for your own good") |
| Justice | Unfairness | Injustice (tyranny) | **Tyranny justifying itself as justice** |
| Truth | White lie | Lie | **Self-deception** (the protagonist lies and believes it) |
| Life | Mortality | Death | **A fate worse than death** (damnation, eternal imprisonment, loss-of-self) |
| Freedom | Restriction | Slavery | **Slavery experienced as freedom** (Stockholm syndrome, willing servitude) |
| Wisdom | Ignorance | Stupidity | **Stupidity masquerading as wisdom** (institutional dogma) |

McKee's rule: **the third act of a major story takes the protagonist into the negation of the negation, not just the contradiction.** A novel whose climax pits hero against simple "evil" (contradictory) is operating one level shallower than a novel whose climax pits hero against "evil that has convinced everyone it is good" (negation of negation).

**Programmatic implication.** The Ending Payoff section should pose its central conflict at the negation-of-negation level for the controlling value. This is a planner-time LLM check at chapter-skeleton stage: "Does the climax pit the protagonist against the negation-of-the-negation of `controllingIdea.value`, or only its simple contradictory?" Flag the latter as undercooked stakes.

---

## 4. Drafting-phase prescriptions

### 4.1 The Gap (Ch. 6) — McKee's master mechanic

McKee's most cited principle. The gap is the difference between:

- What the character **expects** when they take an action, and
- What the world **actually delivers**.

The gap forces the character to take a *riskier* action — to spend more of themselves to bridge it. As gaps widen across a story, characterization deepens (the character must reach further into their humanity to act).

The drafting protocol per beat:

1. POV character forms an expectation (often implicit; sometimes explicit).
2. Character takes an action toward that expectation.
3. The world responds — and the response **diverges** from expectation.
4. Character recalibrates, takes a riskier action.

**A beat with no gap is no beat.** The clearest tell of a flabby beat is that everything went the way the character thought it would. McKee's prescription: cut these beats or rewrite them so the response disconfirms the expectation.

This is the single most encodable McKee principle, and it underwrites Coyne's value-shift rule. (No gap = no value shift.)

### 4.2 Scene as Value Shift (Ch. 2, Ch. 12)

McKee's definition: a scene is "a story event that creates meaningful change in the life of a character … expressed in terms of a value and achieved through conflict." A beat that doesn't shift the value charge — even slightly — is filler.

Two scene polarities:
- **Positive scene** — value charge ends higher than entry (love deepens, justice prevails, life is reaffirmed).
- **Negative scene** — value charge ends lower (love fractures, justice perverts, life threatened).

Two structural shapes:
- **Single-value scene** — one value axis is in play (e.g., love).
- **Multi-value scene** — multiple axes shift simultaneously (love deepens but trust shatters); rare and powerful.

### 4.3 Subtext (Ch. 13)

McKee's rule: **nothing happens "as written."** Beneath the spoken words and visible actions there is always a second layer (often a third) of unspoken intent. Characters say "I'm fine" while signaling distress; they ask about the weather while probing for an alibi.

The drafting protocol: for every line of dialogue, the writer must know:
- The **textual content** (what is said).
- The **subtextual content** (what is meant or intended).
- The **sub-subtextual content** (what the character doesn't realize they want).

McKee: "Writing dialogue without subtext is on-the-nose, the cardinal sin." On-the-nose dialogue — characters stating their feelings directly, narrating their backstory at each other, articulating the theme — is McKee's #1 reason to reject a script.

### 4.4 Exposition as Ammunition (Ch. 14)

McKee's rule: **dramatize exposition; never narrate it.** Information the reader needs should be:
1. Delivered in the heat of conflict (so the character resists revealing it).
2. *Late as possible* in the story (the reader doesn't need to know now).
3. Through *indirect* expression (action, reaction, contradiction — not declaration).

Long passages of summary backstory — particularly at chapter openings — are McKee's "white room" exposition: information without dramatic skin. A novel that opens with two pages of worldbuilding history is, by McKee's metric, broken before scene one.

### 4.5 The Principle of Antagonism (Ch. 11)

> "A protagonist and his story can only be as intellectually fascinating and emotionally compelling as the forces of antagonism make them."

McKee's corollary: weak antagonism produces weak protagonist. The forces opposing the protagonist must operate at the *negation of the negation* level for the climax to land. Most "boring middle" problems trace back to underpowered antagonism.

For drafting prompts: the writer LLM should be explicitly conditioned with the antagonist's parallel goal at each major beat — what is the antagonist (or force-of-antagonism) actively *doing* during this scene to advance their own counter-goal?

### 4.6 Choice Under Pressure = True Character (Ch. 7)

> "True character is revealed in the choices a human being makes under pressure — the greater the pressure, the deeper the revelation, the truer the choice to the character's essential nature."

For drafting: every Crisis beat must surface a choice that is:
- Pressured (no time, irreversible, costly).
- Revealing (the choice surfaces something the reader didn't know about the character).
- Causally consequential (the choice produces the climax's outcome).

Beats labeled `commandmentRole: Cr` should be checked against this trio.

---

## 5. Validation / checking prescriptions

McKee's diagnostic mode is principle-based; the work of operationalizing his principles into checkers is exactly the gap between *Story* and *The Story Grid*. The following list converts McKee's most concrete diagnoses into checker shapes.

### 5.1 Cliché (Ch. 1)

McKee defines cliché as the use of any conventional element without earned specificity. Three forms:
- **Cultural cliché** — generic worldbuilding tropes (the medieval tavern, the corrupt megacorp).
- **Genre cliché** — convention deployed without inversion (the chosen one, the tragic mentor death).
- **Verbal cliché** — language patterns ("his eyes burned with hate"; "her heart skipped a beat").

Checker shape:
- *Cultural*: LLM check on planner output — "Are the named locations / institutions / cultural elements specific (named, ritualized) or generic?" Flag genericness at chapter-plan checker level.
- *Genre*: detected by genre-obligatory-scene checker (Story Grid) when a convention is present but never inverted/subverted.
- *Verbal*: handled by the existing lint subsystem. McKee adds new patterns we should source: body-part-as-emotion-signaler ("eyes burned with X"), instant-physical-reaction-to-emotion ("her heart skipped"), and weather-as-mood-mirror.

### 5.2 On-the-Nose Dialogue (Ch. 13)

Detection prompt (per dialogue line):
> "Score 0–1 the degree to which this line directly states the speaker's feelings, intentions, backstory, or the theme of the scene, rather than performing those things via subtext. 0 = pure subtext; 1 = pure on-the-nose. Cite a rewrite that pushes the score below 0.3."

Flag if mean per-beat score > 0.5 or any single line > 0.8.

### 5.3 Exposition Dump (Ch. 14)

Detection:
- Deterministic: ratio of past-perfect verbs + abstract-noun-density per beat. High ratio = summary, not scene.
- LLM: "Does this beat primarily *dramatize* (action + dialogue + sensory reaction) or *narrate* (summary, recap, worldbuilding-as-narrator-aside)?" Per-beat label.

Flag any beat scoring `narrate`, especially in the first 10% of the manuscript (McKee: openings most often suffer this).

### 5.4 Coincidence Driving Climax (Ch. 11)

McKee allows coincidence in the inciting incident or rising-action complications, but **never in the climax.** The climax must derive causally from the protagonist's prior choices.

Checker: per Climax beat, LLM traces the chain of causation back. Does the climax outcome derive from a chain of *protagonist decisions* (with antagonist responses), or is it triggered by an unmotivated event? Flag deus ex machina.

### 5.5 No-Gap Beats (Ch. 6)

The McKee gap-detection check, per beat:
1. LLM extracts `pov_expectation_at_entry` (what does the POV expect to happen).
2. LLM extracts `actual_outcome_at_exit` (what happened).
3. LLM scores the gap on `[no-gap | small-gap | medium-gap | large-gap]`.
4. Flag any beat with `no-gap` and any beat group (scene) where all member beats are `no-gap`.

This is essentially a refined version of the value-shift check, with explicit cognitive grounding (expectation vs. outcome rather than charge vs. charge).

### 5.6 Stakes Underescalation (negation of the negation, Ch. 11)

Checker (planner-time): on the chapter skeleton, LLM evaluates the controlling-value's deepest negative state in the climax region. Returns one of `{contrary | contradictory | negation-of-negation}`. Flag manuscripts whose climax bottoms out at `contradictory` for genres that demand the deeper level.

### 5.7 Antagonism Underpower (Ch. 11)

Per major scene, LLM evaluates whether the forces of antagonism are operating at sufficient strength to genuinely threaten the protagonist's pursuit. Returns `{weak | proportionate | overwhelming}`. Flag long runs of `weak` (boring middle).

### 5.8 Character-Choice-Under-Pressure (Ch. 7)

Per Crisis beat, LLM evaluates:
- Is there a choice (vs. a forced outcome)?
- Is the choice between *positive irreconcilable goods* or *lesser of two evils*?
- Does the choice reveal previously unrevealed character?
- Does the choice causally drive the climax?

Failures here are usually planner-level (the planner emitted a "crisis" that has no actual decision-point).

### 5.9 Generic vs. Archetypal Setting (Ch. 17)

Worldbuilding specificity audit at concept/planning phase. LLM evaluates: are the named locations/institutions/cultures rendered with specific ritual, idiom, and material detail, or as category tokens (the temple, the king, the army)?

---

## 6. Programmatic levers

The McKee-derived levers below complement the Story Grid set; some overlap (where Coyne operationalized McKee directly). Rough ROI order:

1. **The Gap detector.** Per beat, LLM extracts `pov_expectation_at_entry` and `actual_outcome_at_exit`; scoring `[no-gap | small | medium | large]`. Highest-leverage McKee-specific check.
2. **Controlling-Idea slot.** Add `seed.controllingIdea: { value, cause }`. Plumbed to every downstream phase.
3. **Controlling-Idea climax adherence.** At validation, LLM checks: "Does the climax dramatize `value prevails because cause`?" Flag drift.
4. **Negation-of-the-negation depth check.** Planner-time LLM check on chapter skeleton: at what depth (contrary / contradictory / NoN) does the climax oppose the controlling value? Flag shallow stakes for genres that demand depth.
5. **Three-levels-of-conflict balance.** Per chapter, classify primary conflict level (inner / personal / extra-personal). Flag long single-level runs.
6. **Antagonist parallel-goal annotation.** Planner output includes `antagonistGoalThisChapter` and `antagonistActionThisChapter`. Drafting prompt conditions on it. Checker validates the antagonist is *active*, not narrative-furniture.
7. **On-the-nose dialogue scoring.** Per dialogue line, 0–1 score; aggregate per beat. Excludes interior monologue.
8. **Exposition density flag.** Deterministic past-perfect-density + abstract-noun-density per beat; LLM dramatize-vs-narrate label.
9. **Coincidence-in-climax detector.** LLM causal-chain trace back from climax beats.
10. **Choice-under-pressure quality check.** Per Crisis beat, LLM evaluates the dilemma's structure (irreconcilable goods / lesser evil / forced outcome).
11. **Cliché surface audit.** Per planner output, LLM evaluates worldbuilding specificity vs. generic tokens; flag manuscripts whose setting is rendered at the category level only.
12. **Inciting-Incident position check.** Deterministic: `incitingIncident: true` beat exists in first 25% of manuscript and is dramatized (`narrative_mode: scene`, not `summary`).
13. **Conscious/unconscious desire conflict mapping.** Seed captures both; checker validates that `external_want` and `internal_need` actively conflict in the Middle Build region.
14. **Resolution-time proportionality.** Deterministic: resolution chapter's word-count ≥ X% of manuscript (advisory; tunable per genre).
15. **Sequence-level value-shift aggregation.** Sum scene-level shifts across a sequence; require sequence-end charge to differ meaningfully from sequence-start. Catches "lots happened but nothing changed" middles.
16. **Act-end reversal check.** Each act ends opposite the polarity it started. Coyne also has this; McKee is the source.
17. **Subtext presence check.** Per scene-group, LLM answers: "What is the gap between text and subtext in this scene?" If no gap, flag as on-the-nose at scene level.
18. **Verbal-cliché lint patterns.** Source new patterns from McKee's *Dialogue* and *Story* (body-part-emotion-signaler; weather-as-mood; instant-physical-emotion-reaction).
19. **Specificity audit at planner output.** LLM evaluates each named entity (place, faction, ritual, weapon, magic system) for whether it is *named-and-specific* or *category-generic*.
20. **Archplot/miniplot/antiplot mode tag.** Seed captures `narrativeMode`; downstream rules conditionally apply (e.g., suppress "passive protagonist" flag in declared miniplot).

### 6.1 The Gap-Detector, in detail

The McKee-distinctive lever, with concrete shape:

```
// schema addition (Phase 2 planner output)
beat.povExpectation: string   // 1-sentence expectation of POV at beat entry
beat.actualOutcome:  string   // 1-sentence what happens by beat exit

// runtime check (single LLM call per beat, batchable)
gapCheck(beat):
  prompt = """
    POV character expectation entering this beat: {beat.povExpectation}
    What actually happens by beat end:            {beat.actualOutcome}
    Score the gap between expectation and outcome.
    no-gap   = outcome matches expectation
    small    = minor divergence
    medium   = significant divergence requiring recalibration
    large    = expectation broken, character must reassess fundamentally
  """
  return one_of(no-gap, small, medium, large)

// retry routing
if gapCheck(beat) == 'no-gap':
  // beat is filler; route to drafting.ts targeted rewrite
  rewrite_prompt = 
    "This beat ends exactly as the POV expected. Rewrite so the
     world delivers a different result that forces the POV to
     adapt. The divergence must be causally meaningful."
```

Notice this composes with the Story-Grid value-shift check: a beat with `no-gap` will almost always also have `valueIn == valueOut`. Running both gives you precision-recall coverage on the same defect class from two angles.

---

## 7. Genre obligation tables

McKee is genre-aware but does not enumerate per-genre obligatory scenes; that contribution is Coyne's. McKee's contribution to the genre-table layer is the **value-axis-per-genre** mapping — what *value* is the genre fundamentally arguing about?

| McKee Genre | Primary Value Axis | Negation-of-Negation Form | Climax must demonstrate |
|---|---|---|---|
| Love Story | Love / Hate | Self-hate masquerading as love | Love prevails (or is lost) by sacrifice |
| Crime | Justice / Injustice | Tyranny justified as justice | Justice's mechanism (vengeance, law, code) prevails |
| Horror | Life / "Damnation" | Fate-worse-than-death | Survival, or transformation into the horror |
| Modern Epic | Freedom / Tyranny | Slavery experienced as freedom | Individual will vs. institutional power |
| Disillusionment Plot | Meaning / Meaninglessness | False meaning believed | Hero's worldview collapses |
| Education Plot | Wisdom / Stupidity | Folly believed as wisdom | Hero's worldview matures |
| Redemption Plot | Goodness / Evil | Evil believed as goodness | Hero recovers moral state |
| Punitive Plot | Goodness / Evil | (inverse) | Hero descends from good to evil and is punished |
| Action / Adventure | Life / Death (often) | Annihilation / loss-of-self | Hero survives by skill+will |
| Maturation | Naivete / Experience | False knowing | Hero gains true experience |

For LitRPG specifically, the dominant value axis is **mastery / impotence** with secondary axes of `community / isolation` and `progression / stagnation`. The negation-of-the-negation: **stagnation experienced as progression** (the level-up treadmill that doesn't actually develop the character). A LitRPG climax that pits the hero only against a higher-level monster (contradictory) is shallower than one that pits the hero against the *system itself* — the realization that the entire progression metric is a trap (NoN).

For fantasy: dominant axis varies. Drizzt-style sword-and-sorcery is primarily `loyalty / betrayal` with secondary `belonging / exile`; epic fantasy is typically `order / chaos` with NoN as `tyranny justified as order`.

These value-axis tags are what the controlling-idea slot resolves to, and what the value-shift checker tracks per beat.

---

## 8. Limitations

1. **Screenwriting bias.** McKee's examples and pacing assumptions are film-shaped: tight runtime, strict Inciting-Incident-by-25% rule, climax-in-final-act rigidity. Novels — particularly long-form fantasy and series fiction — operate on looser pacing curves. The 25% rule is brittle in 200K-word novels; the Inciting Incident may be in chapter 2 or chapter 8 with equal validity. **Mitigation:** make pacing-position checks advisory, not blocking; tune thresholds per genre+length.
2. **Single-protagonist assumption.** McKee's framework assumes one protagonist with one Object of Desire. Multi-POV epic fantasy (Martin, Erikson) violates this routinely without losing quality. **Mitigation:** allow `protagonists: Character[]`; apply McKee's structural checks per protagonist arc independently; aggregate at the global level only for Controlling-Idea adherence.
3. **Archplot defaultism.** McKee acknowledges miniplot and antiplot but writes 90% of the book about archplot. Applying archplot rules to literary or experimental fiction produces false-positive "defects" that are actually intentional choices. **Mitigation:** seed `narrativeMode` gates which checks apply.
4. **The negation-of-negation isn't always available.** Some genres (cozy mystery, slice-of-life) deliberately operate at the contrary or contradictory level. NoN-depth checks should not gate cozy-mystery or slice-of-life seeds. **Mitigation:** genre allowlist for the depth check.
5. **McKee's anti-coincidence rigor can suppress wonder.** Magical realism, fairy tale, dream-logic narratives accept coincidence as part of their reality contract. **Mitigation:** seed flag `realityMode: realist | magical-realist | dream-logic` modulates the coincidence-in-climax check.
6. **McKee on character is psychological-realist; SFF often isn't.** Hard-SF protagonists, many LitRPG protagonists, and most epic-fantasy archetypes are not modeled on Stanislavski-style interior psychology. **Mitigation:** treat "true character revealed under pressure" as a desirable-not-mandatory check.
7. **Subtext-everywhere can over-fire on action genres.** A LitRPG combat sequence has minimal subtext by design — the surface is the substance. **Mitigation:** the on-the-nose / subtext checker should be suppressed in beats labeled `combat: true` or `pure-action: true`.
8. **Controlling-Idea reductiveness.** Some literary works deliberately argue *no* controlling idea — they enact ambivalence. McKee's framework punishes this. **Mitigation:** make controlling-idea adherence a soft signal for non-commercial seeds.
9. **The 1997 cultural moment.** McKee's examples skew Hollywood 1985–1995; some assumptions about audience tolerance, taboo, and structural expectations have shifted. The framework's bones are durable; specific tonal prescriptions are dated.
10. **No prose-craft guidance.** Story is a *structural* book. It says little about sentence rhythm, image density, voice, or paragraph architecture. Those remain the writer-LLM's job (voice LoRA / DeepSeek base + lint), not McKee's.

---

## 9. Citations

**Primary text.**
- McKee, Robert. *Story: Substance, Structure, Style and the Principles of Screenwriting*. HarperCollins / Methuen, 1997. The canonical text.
  - Ch. 1 — *The Story Problem*: cliché, archetypal vs stereotypical, story design overview.
  - Ch. 2 — *The Structural Spectrum*: archplot/miniplot/antiplot, beat/scene/sequence/act hierarchy.
  - Ch. 3 — *Structure and Setting*: world specificity, archetypal setting.
  - Ch. 4 — *Structure and Genre*: genre conventions; less developed than Coyne's later work.
  - Ch. 5 — *Structure and Character*: dimension, true character, characterization vs character.
  - Ch. 6 — *Structure and Meaning*: the Controlling Idea, ironic vs idealistic vs pessimistic.
  - Ch. 7 — *The Substance of Story*: choice under pressure, true character revealed.
  - Ch. 8 — *The Inciting Incident*.
  - Ch. 9 — *Act Design*: progressive complications, three levels of conflict.
  - Ch. 10 — *Scene Design*: scene as value shift, the gap, turning points.
  - Ch. 11 — *Scene Analysis* + *Composition*: beats, sequence design, negation of the negation, principle of antagonism.
  - Ch. 12 — *Crisis, Climax, Resolution*.
  - Ch. 13 — *The Principle of Antagonism* (also Ch. 11 in some editions).
  - Ch. 14 — *Exposition*: dramatize, never narrate; ammunition principle.
  - Ch. 15 — *Problems and Solutions*: holes, cheat, melodrama, on-the-nose, coincidence.
  - Ch. 16 — *Character*: dimensions of character, complex/round/flat.
  - Ch. 17 — *Text*: imagery, dialogue, voice — McKee's main prose-craft chapter, still mostly principles.
  - (Chapter numbers vary slightly by edition; the 1997 hardcover and the 2023 reissue match.)

**Companion texts.**
- McKee, Robert. *Dialogue: The Art of Verbal Action for Page, Stage, and Screen*. Twelve, 2016. Deep dive on subtext, on-the-nose detection, and dialogue mechanics. Source for additional verbal-cliché lint patterns.
- McKee, Robert. *Character: The Art of Role and Cast Design for Page, Stage, and Screen*. Twelve, 2021. Extended treatment of dimension, characterization vs character, role design.

**Web / talks.**
- *Story Seminar* lectures (3-day intensive) — recorded versions and authorized transcripts. The negation-of-negation discussion is fuller in the seminar than in the book.
- McKee's Substack and the *Storylogue* (now defunct) Q&A archive — case-study-level applications of the principles.

**Adjacent / built-on-McKee.**
- Coyne, Shawn. *The Story Grid* (2015) — see companion report `story-grid-coyne.md`. Coyne explicitly operationalizes McKee's value-shift mechanic.
- Truby, John. *The Anatomy of Story* (2007) — alternative 22-step framework; critic of McKee's Hollywood three-act, more character-arc-driven.
- Snyder, Blake. *Save the Cat!* (2005) — beat-sheet version of Hollywood three-act; tighter and less philosophical than McKee.
- Egri, Lajos. *The Art of Dramatic Writing* (1942) — McKee's primary source for the "premise" (which becomes Controlling Idea) and the conflict-of-wills theory of dramatic action.

---

## One-paragraph summary

Robert McKee's *Story* is the philosophical source from which Coyne's Story Grid was operationalized; for our harness it contributes a small set of high-leverage checker concepts that complement the Story-Grid value-shift mechanic — the most important being **the Gap** (every beat must contain a divergence between POV expectation and actual outcome), **the Controlling Idea** (a single `value-prevails-because-cause` proposition the climax must dramatize), and **the negation of the negation** (climax-stakes depth check: does the final conflict oppose the controlling value at the contradictory level or at the deeper "evil-justified-as-good" level). Concept-phase impacts: add `controllingIdea: {value, cause}`, `narrativeMode`, and `protagonists[]` slots to the seed. Planner-phase impacts: classify each chapter's primary conflict level (inner/personal/extra-personal), require an antagonist-action annotation per chapter, and validate Inciting-Incident position. Drafting-phase impacts: condition beat-writer on POV expectation/outcome and antagonist parallel-goal; flag on-the-nose dialogue, exposition dumps, and no-gap beats. Validation-phase impacts: causal-chain trace from climax (deus ex machina detection), negation-depth audit on the Ending Payoff, controlling-idea adherence at resolution, and a worldbuilding-specificity audit catching stereotypical-vs-archetypal settings. McKee's framework is more interpretive than Story Grid — many of his rules require LLM judgment rather than deterministic comparison — but the Gap detector is the single most encodable McKee-original mechanic and pairs naturally with Coyne's value-shift checker as a precision/recall complement on the same underlying defect class. Limitations are dominated by McKee's screenwriting bias (single protagonist, 25% inciting incident, three-act rigidity) and his archplot defaultism; both are mitigated by per-seed mode flags (`narrativeMode`, `realityMode`, `protagonists[]`) that gate which checks apply.
