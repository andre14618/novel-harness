# Story Grid (Shawn Coyne) — Framework Report for Novel Harness

> **Purpose.** Extract structural constraints from Shawn Coyne's *Story Grid* method that can be encoded as planner rules, beat-level prompt instructions, or checker rules in a programmatic novel-writing pipeline. Coyne's framework is uniquely engineered for harness-style use: it is more checklist-driven and less mystical than most craft books, and many of its diagnostics map almost 1:1 onto deterministic or single-LLM-call validators.

---

## 1. Framework summary

**Origin.** Shawn Coyne is a former acquisitions editor (Doubleday, Simon & Schuster, Disney, Rugged Land) who developed *The Story Grid* as the diagnostic spreadsheet he used internally to decide whether a manuscript would sell. The book *The Story Grid: What Good Editors Know* was published in 2015. The method was further developed across the storygrid.com blog, the *Story Grid Podcast* (Coyne with Tim Grahl, 2015–present), and follow-on workbooks (*The Story Grid 101*, 2021; the *Story Grid Masterwork* genre series).

**Core thesis.** Stories are engineered objects. There is a finite set of structural commitments a writer makes when they choose a genre, and a manuscript either honors those commitments or it doesn't sell. Story Grid distinguishes between *story* (a value-shifting unit of dramatized change) and *narrative* (anything written down). It then prescribes:

1. **Genre is a contract.** Pick a genre and you owe the reader the specific obligatory scenes and conventions of that genre.
2. **Every level of the story does the same job.** Beat → scene → sequence → act → global story all turn on a value shift. The fractal structure means a checker designed for one level can in principle run at every level.
3. **The Five Commandments are universal.** Every working story unit (whether 200-word beat or 90,000-word novel) contains an inciting incident, progressive complications, a crisis, a climax, and a resolution. Missing any one of them is a structural defect.
4. **Diagnosis is a spreadsheet.** Coyne's eponymous "grid" is literally a row-per-scene spreadsheet with columns for value-charge in/out, on-the-nose-ness, scene purpose, etc. The whole framework is auditable; this is why it ports cleanly to LLM checkers.

For a harness whose philosophy is "deterministic code controls flow, LLMs are leaf calls," Story Grid is closer to a specification than to literary advice.

---

## 2. Concept-phase prescriptions

Coyne's pre-writing checklist is **The Editorial Six** (sometimes "the Foolscap top half"). Before a writer drafts, they must lock down:

1. **Global Genre.** One of Coyne's 12 content genres (Action, Crime, Horror, Love, Performance, Society, Status, Thriller, War, Western, Worldview, Morality) or one of the realm/style/structure/time genres. For our harness, this is the seed `genre` field.
2. **Global Object of Desire.** What the protagonist consciously wants (external) AND unconsciously needs (internal). These almost always conflict.
3. **Global Controlling Idea / Theme.** The one-sentence value-charge claim the entire novel argues. Coyne uses a near-McKee form: `"VALUE_FINAL prevails when CAUSE."` Example: *"Justice prevails when an unconventional investigator outsmarts an institutionally protected predator."*
4. **Global Beginning / Middle / End "hooks" (Beginning Hook, Middle Build, Ending Payoff).** The three top-level value shifts of the book.
5. **Internal vs. External Genre Pair.** Every commercially viable novel has a primary external genre (Action, Thriller, Crime…) AND a primary internal genre (Worldview, Status, Morality). Mismatched pairings are a leading cause of "didn't work."
6. **Point of View / Narrative Device.** First/third, omniscient, distance, tense — chosen *and held* across the manuscript.

**Programmatic implication.** All six belong on the `seed` object before planning begins. Today our seed has `genre`; we should add at minimum `internalGenre`, `controllingIdea`, and `globalObjectOfDesire`. The conversationalist already extracts much of this implicitly; making the slots explicit lets the planner and checkers reference them.

The Editorial Six are why Story Grid is a *concept-phase* framework as much as a planning one. The planning-plotter cannot know whether a chapter skeleton "works" unless it has access to what the global story is arguing.

---

## 3. Planning-phase prescriptions

### 3.1 The Foolscap Global Story Grid

Coyne's "foolscap" is a single 8.5×14 sheet of paper folded into two halves:

- **Top half — global story.** The Editorial Six plus the three top-level units (Beginning Hook / Middle Build / Ending Payoff). Each unit gets its own Five Commandments.
- **Bottom half — scene-by-scene grid.** Every scene is a row. Columns include: word count, POV, on-stage characters, location, time, value shift (charge in / charge out), scene's Five Commandments, the *life value* at stake, on-the-nose-ness flag, polarity (positive/negative scene), and a one-line summary.

For our harness, the foolscap maps directly:

| Foolscap region | Harness artifact |
|---|---|
| Top half (Editorial Six + Hook/Build/Payoff) | `SeedInput.directives` + planner Phase 1 chapter skeleton |
| Bottom half (per-scene rows) | planner Phase 2 beat decomposition |

Our two-phase planner (skeleton → per-chapter beats) is already structurally aligned with the foolscap. The discipline we're missing is the *columns*: each beat needs a `valueIn`, `valueOut`, `lifeValue`, `polarity` field.

### 3.2 The Five Commandments of Storytelling

Every story unit — beat, scene, sequence, act, global — has these five elements in order:

1. **Inciting Incident.** A causal or coincidental event that knocks the protagonist's life out of balance for this unit. Causal beats sharper; coincidental beats more surprising.
2. **Progressive Complication / Turning Point.** Forces of antagonism push back. The unit's *turning point* is the moment information arrives that makes the prior plan obsolete (active turning point: protagonist's choice; revelatory turning point: new info).
3. **Crisis.** A best-bad-choice or irreconcilable-goods dilemma. The protagonist *must* choose between two undesirable options or two competing positive values.
4. **Climax.** The protagonist acts on the crisis decision. This is where the value shift actually happens.
5. **Resolution.** The aftermath; new equilibrium that becomes the new normal entering the next unit.

This is the single most encodable construct in Story Grid. **Every beat in our planner output should be labeled with which of the five it primarily serves**, and a chapter that doesn't contain all five (or whose beats are out of order) is structurally defective.

### 3.3 Genre Conventions vs. Obligatory Scenes

Coyne distinguishes:

- **Conventions** — recurring elements the genre needs (e.g., Thriller needs a "speech in praise of the villain"; Love story needs a "lovers meet" event; Action needs a "hero at the mercy of the villain" moment).
- **Obligatory Scenes** — specific dramatized events the reader has been promised by the genre label.

A genre contract failure (missing an obligatory scene or key convention) is the most common reason commercial fiction is rejected. See §7 for genre tables.

### 3.4 Scene as quantum of story

A scene is the smallest *autonomous* unit that contains all five commandments and produces a value shift. (A beat is even smaller and may carry only one commandment.) The implication for our pipeline: **a "scene" in the Story Grid sense often spans several of our beats**. Our beat decomposition should group beats into scenes, and each scene group should pass the Five-Commandment check.

This is a planner-level constraint we don't currently impose: the planning-beats output should optionally annotate `sceneGroupId` so the checker can validate scene-level structure, not just beat-level.

---

## 4. Drafting-phase prescriptions

### 4.1 The value shift is non-negotiable

Coyne's most cited rule: **"If the value at stake doesn't shift charge, you don't have a scene — you have a description of an event."** A value-charge shift means the *life value* (e.g., love/hate, life/death, justice/tyranny, freedom/slavery, hope/despair) flips polarity, or moves further along its axis (love → hate is a flip; suspicion → certainty-of-betrayal is a deepening).

Every beat the writer drafts must:

- Enter with a clear **value charge** (positive, negative, or double-charged).
- Exit with a **different** value charge, or a movement to a *different value* (escalation: stakes broaden from "love at risk" to "love + life at risk").

### 4.2 The gap between expectation and result

Coyne (citing McKee directly) instructs writers to draft scenes by:

1. Establish what the POV character expects to happen.
2. Have the world deliver something different.
3. Force the character to adapt.

The *gap* between expectation and reality is where story lives. A beat that resolves exactly as the POV expected is, by definition, not a turning point and likely not load-bearing.

### 4.3 Subtext and the "on-the-nose" rule

Coyne's loudest drafting rule: **no on-the-nose dialogue.** Characters should never directly state their feelings, intentions, or the theme of the scene. Subtext = what's *really* happening underneath the surface text. The Story Grid editor's first pass marks every line of on-the-nose dialogue for cutting.

For a writer LLM, this is one of the most directly encodable constraints — see §5/§6.

### 4.4 Polarity rules

Scene polarity refers to whether the unit ends up (positive charge) or down (negative charge) on its dominant value. Coyne's guidance:

- **Long sequences of same-polarity scenes are deadly.** Three consecutive negative scenes flatten emotional response. Alternate.
- **Each act ends on the *opposite* polarity from where it started.** This is the unit-level value shift writ large.
- **Beginning Hook ends slightly down; Middle Build ends very down; Ending Payoff ends decisively up or decisively down (per the genre contract — Tragedy ends down, Romance ends up, etc.).**

### 4.5 Coyne on "what makes a scene work" (drafting checklist)

Coyne's drafting-time checklist for each scene-in-progress:

1. What's the **point-of-view character's** unit-of-story goal?
2. What's the **inciting incident** for this scene?
3. What are the **forces of antagonism** in this scene (could be other character, environment, internal conflict, social institution, time)?
4. What is the **turning point** — and is it active or revelatory?
5. What is the **crisis question** (best-bad / irreconcilable-goods)?
6. What is the **climax** (the choice acted out)?
7. What is the **resolution** (new state)?
8. What is the **value charge in vs. out**?
9. What is the **essential action** the POV takes?
10. Is the dialogue on-the-nose or subtextual?

For our drafting-phase prompt, this is the checklist the beat-writer should be conditioned on, beat by beat.

---

## 5. Validation / checking prescriptions

Coyne's diagnostic mindset is the closest analogue in the craft literature to our checker layer. His master question for any unit of story:

> **Does this scene work?** = Did a value change? Was there an inciting incident, progressive complication, crisis, climax, resolution? Is the value shift driven by character action or by author fiat?

Mapped to harness checkers:

| Coyne diagnostic | Checker shape |
|---|---|
| Value shift detection | LLM call with `valueIn`/`valueOut` labels + deterministic equality check |
| Five Commandments completeness | LLM classifier per beat group: which of {II, PC, Cr, Cl, Re} does this beat carry? Aggregate per scene-group; flag if missing |
| On-the-nose dialogue | LLM check per dialogue line: is the character stating intent/emotion/theme directly? |
| Author-fiat / coincidence in act 3 | Deterministic structural check + LLM check: does the climax derive causally from prior beats? |
| Polarity monotony | Deterministic: scan polarity sequence; flag any run of ≥3 same polarity |
| Genre obligatory scene coverage | Deterministic: for `globalGenre`, check planner output contains each required scene |
| Genre convention coverage | LLM check: does the manuscript surface the named conventions for this genre? |
| Crisis dilemma quality | LLM check: is the crisis a best-bad/irreconcilable-goods choice, or a false dilemma? |
| Turning point classification | LLM check: does this scene's turning point arrive as new info (revelatory) or as character choice (active)? Both valid; absence of either = no turning point at all |
| POV consistency | Deterministic regex/LLM: do we cross POV inside a scene? |
| Word-count-per-scene sanity | Deterministic: scenes outside genre's typical 800–2500 word band warrant flag (advisory) |

### 5.1 On the "scene works" boolean

Coyne reduces all of the above to a single editorial verdict per scene: works / doesn't work. For our pipeline this is a useful aggregate flag, but it should *not* gate retries directly — the per-defect signal (which commandment is missing, which value didn't shift) is what the targeted-rewrite path needs.

### 5.2 On exposition

Coyne (echoing McKee) treats exposition as ammunition: dramatize it, never narrate it. A checker can flag any beat where >X% of words are narrative summary (verbs in past perfect, abstract nouns, character backstory delivered in declarative voice without interlocutor).

---

## 6. Programmatic levers

The following twenty levers are concrete enough to implement against our existing `chapterBeatsSchema`, `adherence-events`, and `chapter-plan-checker` infrastructure. Listed roughly in order of expected ROI.

1. **Beat value-charge labels.** Extend `chapterBeatsSchema` with `valueIn: string`, `valueOut: string`, `lifeValue: enum`. Planner-emitted; checker-validated.
2. **Beat-level value-shift checker.** New checker: deterministic comparison of `valueIn` / `valueOut`; flag if equal AND beat is not pure transition. This is the single highest-leverage rule from either framework — you can implement it in an afternoon.
3. **Scene-group annotation.** Planner Phase 2 emits `sceneGroupId` per beat (1..N). Checker validates each scene-group contains all five commandments.
4. **Five-Commandment classifier.** Per-beat LLM call returning `commandmentRole: II | PC | Cr | Cl | Re | bridge`. Aggregate per scene-group; missing roles → planner re-expansion or beat targeted rewrite.
5. **Polarity sequence monotony detector.** Deterministic: extract `polarity` from beat labels; flag any run of ≥3 same. Acts as a "boring stretch" warning at the planning phase, before drafting.
6. **Act-end polarity inversion check.** Deterministic on chapter-skeleton: ending polarity of each act should oppose its starting polarity. Planner-time gate.
7. **Crisis-quality LLM check.** Per scene-group: classify the crisis beat's dilemma as `best-bad | irreconcilable-goods | false-dilemma | absent`. False-dilemma or absent → flag.
8. **Genre obligatory-scene coverage.** Per `globalGenre`, a static checklist (see §7). Planner output is matched against it; missing scenes → planner re-expansion. This belongs at planner time, not drafting.
9. **On-the-nose dialogue checker.** Per beat with dialogue: LLM scores each line `on-the-nose: 0..1`. Aggregate; flag if mean score above threshold or any line >0.8.
10. **Subtext-presence LLM check.** Per scene-group, LLM answers: "Is there a gap between what is said and what is meant?" Y/N + evidence quote. Persistent N → flag.
11. **Expectation/result gap detector.** Per beat, LLM extracts `pov_expectation_at_entry` and `actual_outcome_at_exit`; deterministic similarity check. High similarity → no turning point.
12. **Turning-point active/revelatory classifier.** Per scene-group, LLM labels turning point. Absence → flag. Long runs of revelatory-only turning points → flag (passive protagonist).
13. **Coincidence-in-climax detector.** LLM check on Ending Payoff scenes: "Does the protagonist's prior action cause the climax outcome?" Causal chain back to beats. Detects deus ex machina.
14. **Scene length advisory.** Deterministic: scenes outside `[800, 2500]` words for typical genre → advisory flag at planner time (`targetWords`).
15. **POV cross-cut detector.** Deterministic: within a scene-group, single `pov`. Multi-POV inside scene-group → flag.
16. **Internal-genre presence audit.** Static map of internal-genre obligatory shifts (Worldview = belief shift; Status = social-status shift; Morality = moral-state shift). LLM check per major plot turn confirms the internal genre's shift fires alongside the external one.
17. **Controlling idea adherence.** At validation, LLM check: "Does the ending dramatize the controlling idea `VALUE prevails when CAUSE`?" Flag drift.
18. **Object-of-desire conflict check.** LLM check at planner output: do `external_want` and `internal_need` actively conflict somewhere in the middle build? If they're never in tension, the internal genre is decorative.
19. **Exposition density flag.** Deterministic regex + lightweight LLM: ratio of `past-perfect summary sentences` to `dramatized scene sentences` per beat. High ratio → flag.
20. **Foolscap export.** Render the full novel state as a Story-Grid-style spreadsheet (`/api/novel/:id/foolscap`). Each row: scene-group, beats, valueIn/Out, polarity, commandments, on-the-nose flag, summary. Free editorial UX win.

### 6.1 The value-shift checker, in detail

Because this is the highest-ROI lever, here's the concrete shape:

```
// schema addition
chapterBeatsSchema.beats[i].valueIn:   string  // free-form, e.g. "trust"
chapterBeatsSchema.beats[i].valueOut:  string  // free-form, e.g. "betrayal"
chapterBeatsSchema.beats[i].lifeValue: enum    // {love/hate, life/death, justice/injustice,
                                                //  freedom/slavery, hope/despair, truth/lie,
                                                //  power/weakness, meaning/meaninglessness, ...}
chapterBeatsSchema.beats[i].polarity:  enum    // {+, -, ++, --, mixed}
chapterBeatsSchema.beats[i].sceneGroupId: number

// planner produces these as part of Phase 2 expansion (single LLM call already running)

// checker (deterministic + one cheap LLM call)
function valueShiftCheck(beat):
  if beat.valueIn == beat.valueOut and beat.commandmentRole != 'bridge':
    return { defect: 'no-value-shift', beat_index: beat.index }

  // semantic equality (cheap LLM): are valueIn and valueOut the same value
  // re-stated, or genuinely different positions on the lifeValue axis?
  if llm.semantic_equal(beat.valueIn, beat.valueOut):
    return { defect: 'restated-value', beat_index: beat.index }

  return { ok: true }
```

The retry surface: if a `no-value-shift` defect fires, route to drafting.ts targeted rewrite with prompt addendum: *"This beat must end with `lifeValue` in a different charge state than it started. Currently it enters at `valueIn` and exits at `valueOut`, which is the same charge. Rewrite the beat so something happens that flips or escalates the charge."*

This shape is identical to how `adherence-events` already routes targeted rewrites; the implementation surface is small.

---

## 7. Genre obligation tables

Coyne enumerates obligatory scenes and conventions per genre across *The Story Grid*, the storygrid.com "leading questions" series, and the Masterwork book line. The tables below are condensed for the four genre families most relevant to our LitRPG/fantasy focus. Encode each as a static checklist the planner output is matched against.

### 7.1 Action genre (External)

**Obligatory Scenes:**
- Inciting attack by villain (story starts with hero's life thrown out of balance by an aggressive force).
- Hero sidekick/mentor relationship established.
- Hero discovers an unfair advantage / weakness in the antagonist.
- Hero at the mercy of the villain (the all-is-lost moment; villain has the upper hand).
- Speech in praise of the villain (someone — often the hero — articulates why the antagonist is formidable).
- Hero's object of desire scene (clear what they're fighting for).
- Climactic confrontation between hero and villain.

**Conventions:**
- A clear, externalized villain.
- A MacGuffin or hostage/object of desire.
- Set-piece "save the cat" moments establishing hero's moral fiber.
- Ticking clock or escalating geographical pressure.

### 7.2 Thriller genre (External, hybrid Action/Crime/Horror)

**Obligatory Scenes:**
- Inciting crime against the protagonist or society (often POV-witnessed).
- Hero learns the antagonist's plan / true scope.
- Hero at the mercy of the villain (Coyne flags this as the genre's signature; it's *the* thriller obligatory scene).
- All-is-lost / point-of-no-return.
- Hero's sacrifice or willingness-to-die-for-cause beat.
- Final confrontation in a confined or symbolic space.
- Society's restoration (or pyrrhic restoration) at resolution.

**Conventions:**
- Investigation structure or pursuit structure.
- Antagonist on-page early (often POV-aligned in alternating chapters).
- Red-herring or false-resolution mid-book.
- High-stakes geographical/temporal escalation.

### 7.3 Fantasy / Worldview hybrid (most epic fantasy, including Salvatore-style)

Fantasy in Coyne's taxonomy is a *realm* genre (setting modifier) layered onto a content genre — usually Action or Worldview. Salvatore's Drizzt sits at Action+Worldview; LitRPG sits closer to Performance/Status+Action. So the obligatory scenes are the union of the underlying content genre's scenes plus realm-specific conventions:

**Realm conventions (fantasy):**
- Magical or non-mundane system established with consistent rules.
- A "realm tour" sequence introducing the world's rules through dramatized stakes.
- Threshold-crossing scene (hero leaves known world).
- Mentor figure encounter.
- Magic-system payoff in climax (Sanderson's First Law: deus ex machina rate inversely proportional to reader understanding of the system).
- Cost-of-power demonstration scene.

**Worldview-arc obligatory shifts (when fantasy is internally Worldview):**
- Hero's belief is challenged by experience.
- Hero rejects the new view (defends old worldview).
- Crisis forces hero to act on the *new* worldview.
- Resolution: hero's worldview is permanently altered, demonstrated by action under pressure.

### 7.4 LitRPG / Performance hybrid

LitRPG is not in Coyne's original 12 but maps cleanly to **Performance genre** (mastery-of-skill arc) + Action realm. Inferred obligatory scenes:

- System-introduction scene (the game/world rules are dramatized, not info-dumped).
- First-power-up / class-selection scene (commitment).
- Hero discovers a system exploit or unique build.
- Defeat at the hands of a higher-level force (the "level cap" all-is-lost).
- Mentor or guild relationship beat.
- Skill-mastery montage or training arc (Performance-genre obligatory).
- High-stakes PvP or boss-tier confrontation.
- Hero's build/skill is revealed as decisively superior or surprisingly synergistic at climax (Performance-genre payoff).
- Persistent-world consequence (the system state has changed permanently).

**LitRPG-specific conventions:**
- Stat blocks / system messages dramatized as part of POV experience.
- Numerical progression curves visible to the reader.
- Cost/grind explicit (no free power-ups).
- Game-mechanic constraints used to engineer crisis dilemmas (mana cost vs. cooldown vs. party safety).

### 7.5 Encoding

```ts
// pseudo-shape
const OBLIGATORY_SCENES: Record<Genre, string[]> = {
  action:   ['inciting_attack', 'hero_at_mercy_of_villain', 'speech_in_praise_of_villain', ...],
  thriller: ['inciting_crime', 'hero_at_mercy_of_villain', 'all_is_lost', ...],
  fantasy:  [...ACTION_OR_WORLDVIEW_BASE, 'threshold_crossing', 'magic_system_payoff', ...],
  litrpg:   ['system_introduction', 'class_selection', 'training_montage', 'level_cap_defeat', ...],
};

// planner-time check:
//   for each required scene, ask LLM: "Which beat (index) dramatizes this scene? null if missing."
//   missing -> planner re-expansion (insert beat) or chapter-plan-reviser escalation
```

Because the planner already has Phase 2 per-chapter expansion, the obligatory-scene checker fits naturally as a third step ("Phase 2.5: gap-fill") between expansion and approval.

---

## 8. Limitations

Story Grid is engineering-friendly but has known failure modes:

1. **Genre rigidity.** The 12-genre taxonomy works well for commercial fiction but stresses on literary, hybrid, or genre-novel work. A literary character study with no clear external genre will fail Coyne's tests for reasons that don't correlate with quality. **Mitigation:** treat genre obligation tables as advisory for non-genre seeds; mandatory only when seed declares a commercial genre.
2. **Formula bias.** A planner that satisfies every obligatory scene can produce a structurally correct, narratively predictable book. Coyne acknowledges this — the *Masterwork* series' point is that great novels honor conventions while subverting them. A pure check-the-box planner would underperform on novelty. **Mitigation:** the obligatory-scene checker should also flag *over-fidelity* (every cliched convention present, none subverted).
3. **The Five Commandments can become procrustean at the beat level.** Coyne is clear that not every *beat* needs all five — only every *unit of story*. A naive checker that demands all five per 290-token beat will produce false-positive defects. **Mitigation:** apply the Five Commandments check at scene-group granularity, not beat granularity. This is why the `sceneGroupId` annotation matters.
4. **On-the-nose detection risks killing voice.** First-person interior-thought POV (common in LitRPG) often reads as on-the-nose by Coyne's screenwriting-influenced metric, but is genre-correct. **Mitigation:** scope the on-the-nose checker to *dialogue lines spoken to other characters*, not interior monologue.
5. **Polarity monotony rules misfire on Tragedy.** Coyne's rule "no three same-polarity scenes in a row" assumes broad commercial fiction; a literary tragedy may run six negative scenes in a sustained descent. **Mitigation:** seed-level `genre.tragedyMode` flag suppresses the polarity-run check.
6. **Spreadsheet thinking ≠ prose quality.** Story Grid is a structural editor; it has nothing to say about sentence-level prose, voice, image density, or dialogue rhythm. Those are addressable only by the writing layer (voice LoRA / DeepSeek-base). Don't overload the checker layer with prose-quality jobs Coyne's framework doesn't actually solve.
7. **Coyne's controlling-idea formulation can be reductive.** Forcing every novel into `VALUE prevails when CAUSE` works for action-driven stories but can flatten ambivalent or polysemic literary works. **Mitigation:** the controlling-idea checker should be a soft signal (alignment ≥ threshold), not a binary gate.

---

## 9. Citations

**Primary text.**
- Coyne, Shawn. *The Story Grid: What Good Editors Know*. Black Irish Entertainment, 2015. — chapters on the Editorial Six, the Five Commandments, the foolscap, genre conventions/obligatory scenes, the spreadsheet method.
- Coyne, Shawn. *The Story Grid 101: The Five First Principles of Storytelling*. Black Irish Entertainment, 2021. — condensed version, useful for the genre-five-commandments derivations.
- Coyne, Shawn (ed.). *The Story Grid Masterwork* series (2018–): *The Silence of the Lambs* (Thriller), *Pride and Prejudice* (Love), *The Great Gatsby* (Status), *The Tell-Tale Heart* (Horror). Each volume reverse-engineers a canonical work scene-by-scene against the grid; richest source for genre-specific obligatory scenes.

**Web / podcast.**
- storygrid.com — particularly the "Five Commandments" series, the "Genre 5 Commandments" leading-questions series, and the "Beats, Scenes, Sequences, Acts" decomposition posts (2015–2018 archive).
- *The Story Grid Podcast* with Tim Grahl — episodes 1–50 cover the foundations (2015–2016); episodes 100+ get into per-genre deep dives. Particularly:
  - Eps. 1–10: foolscap and Editorial Six.
  - Eps. 25–35: Five Commandments at every level.
  - Eps. 50+: genre conventions and obligatory scenes per genre.
  - The "*Story Grid Editor Roundtable*" episodes for diagnostic case studies.
- *Story Grid Beat Sheet* downloadable templates (storygrid.com/resources) — closest existing analog to the foolscap-as-spreadsheet shape we'd want to render in the Studio UI.

**Adjacent.**
- McKee, Robert. *Story* (1997) — Coyne explicitly builds on McKee, especially the value-charge / scene-as-value-shift mechanic. See companion report `mckee-story.md`.
- Truby, John. *The Anatomy of Story* (2007) — alternative 22-step structure; partially compatible with Story Grid's genre-as-contract thesis but more character-arc-driven.

---

## One-paragraph summary

Story Grid is the most directly encodable craft framework for a programmatic novel harness: it treats stories as engineered objects with auditable structural properties at every scale (beat → scene → act → global), and its central diagnostic — *every working unit of story turns on a value-charge shift* — maps onto a single deterministic checker (compare `valueIn` vs. `valueOut` per beat) that is likely the highest-ROI single rule we can add to our pipeline. The Editorial Six belong on the seed object; the Foolscap maps directly onto our two-phase planner; the Five Commandments give us a per-scene-group classifier; genre obligatory-scene tables become static planner-time checklists per `globalGenre`; and Coyne's "does this scene work?" diagnostic decomposes cleanly into ~8 narrow checker calls (value shift, on-the-nose dialogue, polarity monotony, crisis-dilemma quality, turning-point classification, coincidence-in-climax, exposition density, obligatory-scene coverage). The main failure modes — formula rigidity on literary work, false positives on first-person interior POV, procrustean beat-level commandment enforcement — are mitigated by scoping checks to scene-group granularity and by treating obligatory-scene coverage as advisory for non-commercial seeds.
