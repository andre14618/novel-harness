---
job: 2
title: Deep Craft and Market Research
date: 2026-05-10
model: opus
status: draft (decision artifact, not promotion-ready)
---

# Deep Craft and Market Research

## Reading order

This artifact extends, does not replace, `docs/research/writing-frameworks/SYNTHESIS.md`. The SYNTHESIS already covers (a) the cross-framework convergences, (b) framework-specific gold, (c) per-phase encodings, (d) what NOT to encode. This artifact assumes you've read it and answers a different question: **given the harness's H1-H12 hypothesis bank and the V1 method-pack charter, what storytelling structures translate into testable planner templates and scene contracts that match KU commercial-fantasy reader expectations?**

Three sections:

- **Section A** — nine structural frames as planner templates with diagnostic columns.
- **Section B** — KU/commercial reader expectations by quartile, with subgenre overlays.
- **Section C** — twelve testable planner-template recommendations in the structured format requested.

Where a claim is web-research-backed, I cite. Where it's my synthesis across multiple sources, I label `[synthesis]`. Where it's directly from SYNTHESIS or a framework doc, I cite the doc.

---

## Conventions used in the planner templates

Each template below is a table with seven columns. They map to fields a planner agent prompt could literally consume:

- **Slot** — chapter or beat index (some templates are scene-grain, most are chapter-grain).
- **Function** — the structural job the slot is doing (one short noun phrase).
- **Required scene action** — what visibly happens (verb-led, not "feels").
- **Required character pressure** — internal state that must be active (Lie/Want/Need movement).
- **Required worldbuilding pressure** — what the world or system must demand. Empty cells mean "no specific demand".
- **Payoff promise (made / repaid)** — `M:<promise>` for new promises, `R:<promise-id>` for paid promises, `P:<id>` for partial progress.
- **Diagnostic that catches its absence** — the cheapest signal that says this slot didn't fire. `[det]` = deterministic, `[llm]` = needs one cheap LLM call, `[panel]` = compares against another slot.

Most templates use percentage windows rather than fixed chapter numbers, because target word count varies. The harness's planner emits `expected_pct_min`/`expected_pct_max` already, so this maps cleanly.

---

# Section A — Structural Methodology Mapping

## A1. The 24-chapter commercial fantasy outline (Plottr / Murphy shape)

This is the modern KU/trad-hybrid spine for 90-110k novels. It is a Hero's-Journey-with-an-extra-quarter shape (six "acts" of four chapters each). It is not in the SYNTHESIS doc.

Source: Plottr 24-chapter template by Derek Murphy ([plottr.com](https://plottr.com/24-chapter-novel-outline/)), `[synthesis]` with Save the Cat percentages and Maass three-layer plot.

Critical observation `[synthesis]`: the Murphy template is structurally STC compatible at 24 = 1.6× the 15-beat lattice. Each STC beat lands on a chapter boundary, which is what makes it useful: STC at chapter granularity, not paragraph-level fidelity. The harness's chapter-grain planner can adopt this without changing beat schemas.

| Slot | Function | Required scene action | Character pressure | World pressure | Payoff (M/P/R) | Diagnostic |
|------|----------|----------------------|--------------------|----|---------------|------------|
| Ch 1 | Really Bad Day (opening image) | POV fails at a daily want; status quo visibly painful | Lie dominant; want surfaces as "if only X" | Operational world rule denies want | M: world-cost, M: protagonist-deficit | First-page tension test [llm]; ambient affect must be charged single emotion [llm] |
| Ch 2 | Something Peculiar (foreshadow) | Strange event; POV rationalizes away | Lie defended | World rule cracks once, ignored | M: weird-world | Beat must contain unresolved question at chapter end [det] |
| Ch 3 | Grasping at Straws | POV doubles down on Lie-aligned plan; small failure | Lie reinforced | World shows pressure increasing | P: protagonist-deficit | Polarity (-) close [llm]; no win allowed |
| Ch 4 | Call to Adventure (catalyst) | Disruption that cannot be ignored | Lie shaken; first hairline crack | World irrevocably changed for POV | M: central-conflict, R: weird-world (partial) | Pre/post POV-options diff [llm] - must reduce options |
| Ch 5 | Head in Sand (debate) | POV refuses; cost of refusal demonstrated | Lie protests | World keeps escalating without POV consent | P: central-conflict | Refusal must be visibly costly [llm] |
| Ch 6 | Pull Out Rug (Break Into 2) | Final external push forces commitment | POV crosses internal threshold (act of will) | World gate opens (visible departure) | R: weird-world (full) M: new-world-rules | Word-count milestone 22-28% [det]; choice must be active not forced [llm] |
| Ch 7 | Enemies & Allies | POV enters new world; meets ≥1 ally + ≥1 antagonist proxy | New context resists POV's old toolkit | New world rules introduced (≥2 named) | M: ally-arc, M: antag-shadow | Must show ≥2 distinct supporting POVs/voices [det] |
| Ch 8 | Games & Trials (Fun & Games) | Promise of the premise — the cover-copy activity | POV applies old toolkit, gets variable results | World mechanics on display | P: new-world-rules, R: protagonist-deficit (partial) | Genre-promise activity must occur ≥2x in chs 7-12 [llm] |
| Ch 9 | Earning Respect | POV scores meaningful win | Want feels close; Lie comfortable | World rewards POV's adaptation | P: ally-arc, P: central-conflict | Polarity (+) close required [llm] |
| Ch 10 | Forces of Evil | Antagonist visible; stakes scale up | POV's Want now visibly threatened | World shows organized opposition | M: antag-personal, P: antag-shadow | Antagonist on-page or referenced via direct action [llm] |
| Ch 11 | Problem Revealed | POV demands answers from ally; ugly truth | Trust-fracture; Lie-Need tension named | A world rule POV trusted is shown false | P: ally-arc (broken edge), R: new-world-rules | Cross-edge dialogue scene [llm] |
| Ch 12 | Truth & Ultimatum (Midpoint) | POV confronts a worldview-rewriting fact; commits to new line | Mirror moment - POV sees the gap between Want/Need | World scope expands (stakes go from local→regional or personal→public) | M: forced-ascension, R: central-conflict (reframed), P: antag-personal | Word-count milestone 48-52% [det]; mirror moment LLM check [llm] |
| Ch 13 | Mirror Stage | POV shifts from victim → agent | Need first glimpsed | World offers a tool POV had been refusing | P: forced-ascension | POV agency LLM classifier - must be ≥60% proactive in this chapter [llm] |
| Ch 14 | Plan of Attack | POV builds strategy; assigns roles | Need committed-to but Lie not abandoned | Plan exploits 2+ established world rules | P: ally-arc (rebuild) | Plan must reference ≥2 prior-chapter facts [det] |
| Ch 15 | Crucial Role | Allies given specific responsibilities | Trust restoration | World stakes locked in | R: ally-arc | All named allies must have plan-role [det] |
| Ch 16 | Direct Conflict | Plan executes; first-pass success | False victory available | World yields to plan partially | P: forced-ascension, P: antag-personal | Polarity (+) trending or peaking |
| Ch 17 | Surprise Failure (Pinch 2) | Plan backfires; cost paid | POV's Lie revealed as mechanism of failure | World/antagonist reveals counter-rule | R: antag-shadow (full reveal), P: antag-personal | Cost-event must touch a named promise/asset [det] |
| Ch 18 | Shocking Revelation | True antag identity / scope exposed | Lie shattered | The world POV thought existed didn't | M: final-confrontation, P: forced-ascension | New entity introduction tolerated here only — STC/Brooks border [det] |
| Ch 19 | Giving Up (All Is Lost) | POV at lowest ebb; literal/symbolic death | Lie still has gravitational pull; Need not yet seized | World indifferent or hostile | P: final-confrontation | "Whiff of death" check [llm]; word-count 73-78% [det] |
| Ch 20 | Pep Talk (Dark Night) | B-story character forces internal reckoning | Need named explicitly by POV | World quiet (introspection beat) | R: ally-arc (sealed), R: protagonist-deficit (full) | Interiority density >60% [det]; B-story char must be on-page [det] |
| Ch 21 | Seizing the Sword (Break Into 3) | POV chooses Need-aligned action even at Want-cost | Lie discarded; Need adopted | World offers narrow window | P: final-confrontation | "Aha" must reference Theme Stated string [llm] |
| Ch 22 | Ultimate Defeat (climactic black moment) | Plan crashes against escalated threat | Need under fire; old Want temptation returns | World hostile, no help available | P: final-confrontation | Polarity (--) deeper than ch 19 [llm] |
| Ch 23 | Unexpected Victory (climax) | Hidden capability/setup deployed | Need-action delivers what Want-action couldn't | World/system rules honored - no deus ex machina | R: final-confrontation, R: forced-ascension, R: antag-personal | Climax-causality LLM check (causal trace from setup to payoff) [llm]; Brooks "no new entities post 75%" [det] |
| Ch 24 | Bittersweet Reflection (final image) | Mirror of Ch 1 status quo, inverted | Need integrated; new equilibrium | World permanently changed | (sequel hook M: book-2-promise) | Final-image mirror-Opening-image check [llm]; resolution ≤2% [det] |

**Critical adaptations for fantasy/KU [synthesis]:**

- **Chapter 7 must lock the magic system.** Most KU fantasy failures here are systems explained in scattered exposition rather than dramatized via a Games-and-Trials encounter. Move Sanderson's First Law check to chapter 7's diagnostic.
- **Chapter 8 (Fun & Games) is the cover-copy chapter.** The book's marketing promise (dragons, court intrigue, dungeon, system) must visibly cash here. KU readers who finish chapter 8 are 4-5× more likely to finish the book per indie author retention reports ([kindlepreneur.com](https://kindlepreneur.com/calculate-series-read-through/)).
- **Chapter 12's midpoint mirror moment is non-negotiable.** Save the Cat literature unanimous on this; readers can tolerate a slow chapter 9 but a flat chapter 12 ends the book in their hands ([Save the Cat](https://savethecat.com/about-the-beats/cracking-the-midpoint-the-false-victory)).
- **Chapter 18's "shocking revelation" is the only window where new entities are tolerated** without violating Brooks's no-new-entities-post-SPP rule. Encode this as a soft exception.

## A2. Save the Cat as fantasy-adventure adaptation (extending SYNTHESIS)

The SYNTHESIS already mapped STC's 15 beats and percentages. What it doesn't cover is **reader-expectation overlays specific to fantasy adaptation**. This table extends the SYNTHESIS by adding fantasy-specific failure modes and reader-expectation signals to each STC beat.

Source: SYNTHESIS §3 (STC), `docs/research/writing-frameworks/save-the-cat.md` §3-5, `[synthesis]` with KU reader retention data ([nicholewithanhproofreading.com](https://www.nicholewithanhproofreading.com/post/how-to-optimize-your-book-for-kindle-unlimited-in-2025)).

| STC Beat | Pct | Fantasy-specific scene action | Fantasy character pressure | Fantasy world pressure | Reader-expectation signal | Diagnostic |
|----------|-----|-------------------------------|----------------------------|------------------------|---------------------------|-----------|
| Opening Image | 0-1% | World-rule visible in first ¶: a magical/social/system constraint shapes the scene | Lie shown as world-belief, not just self-belief | Operational rule on display | KU sample-conversion peaks if first ¶ shows magic operating, not described | First-paragraph contains either system-event OR contradiction-bearing sensory detail [llm] |
| Theme Stated | ~5% | Spoken by a non-POV (often the eventual B-story); fantasy permits oracular/prophetic register | POV dismisses theme as elder-talk | World shows the theme being violated NOW | Theme-as-prophecy is welcome here; readers expect it in fantasy more than literary | Speaker != POV [det]; theme contains a verb [det] |
| Setup | 1-10% | Setup the deficit publicly: in fantasy, this is the "magical aptitude test fails" beat | Wound visible to community, not just POV | Hierarchy/system that adjudicates POV's deficit | "Underdog with public flaw" is the dominant KU fantasy archetype | Setup must establish ≥3 of "Six Things" deficits [det] |
| Catalyst | ~10% | World-disrupting event that closes return-to-status-quo path. In fantasy: invasion, prophecy, system arrival, magic breaking, summons | Lie's terms suddenly invalid | World gate opens or closes | If catalyst is ambiguous to readers at this %, drop-off triples ([RoyalRoad retention](https://www.royalroad.com/forums/thread/111699)) | Pre/post POV-option diff: must reduce ≥2 options [llm] |
| Debate | 10-20% | POV resists in a way that costs them — refusing the call must be expensive in fantasy or it reads as cowardice | Lie's gravitational pull | World's pressure visibly mounts in the absence of action | This is the most-skipped beat in KU fantasy and the dominant cause of "main character is whiny" reviews | Refusal must produce ≥1 cost event [llm] |
| Break Into 2 | ~20-30% | Active threshold cross; visible new-world entry | Active commitment by POV | New-world rules introduced (≥2) | KU readers expect a clean travel/portal/door image here | Word-count milestone [det]; commit must be active [llm] |
| B Story | ~22% | First on-page introduction of the relationship that carries Need | Need-vector character on-page | (none required) | In romantasy, B-story character is romantic lead; in epic fantasy, often mentor/sibling | B-story char must appear in ≥3 of: midpoint, dark night, break into 3 [det] |
| Fun & Games | 20-50% | The cover-copy activity dramatized 3+ times | POV applies toolkit; lie comfortable but variable | World mechanics demonstrated through play | This is the "promise of the premise" — the chapter readers screenshot for booktok | Genre-promise activity LLM check [llm] |
| Midpoint | ~50% | False victory or false defeat with stakes-raise; mirror moment named | Want-Need gap visibly named (often via dialogue with B-story) | World scope expands (local→regional, personal→public) | Hard cliffhanger expected here in serial-shape KU; standalone-shape: chapter ends on tilt | Word-count milestone [det]; mirror moment [llm]; stakes-direction must change [llm] |
| Bad Guys Close In | 50-75% | Compounding threat; Lie's strategy compounds failure | Trust-fracture with allies; Lie reinforces under pressure | Antagonist actively counter-moving | KU readers tolerate this chapter being slow IF tension on the page is high | Polarity descent must be monotonic across this span [llm] |
| All Is Lost | ~75% | Whiff of death (literal/symbolic); a thing dies | Lie at maximum gravitational pull | World indifferent | "Mentor dies" is the trope-marker; works in fantasy | Whiff of death LLM check [llm]; word-count 73-78% [det] |
| Dark Night | 75-80% | Quiet, internal, B-story present | Need finally adopted internally | World quiet | Interiority density check [det]; B-story present [det] |
| Break Into 3 | ~80% | Realization beat; aha that ties theme + B-story + plan | Need integrated; new toolkit emerges | World offers narrow window | Aha must reference Theme Stated [llm] |
| Finale | 80-99% | 5-stage Snyder finale: gather/plan/surprise/dig-deep/execute | Need under fire; old Want returns as temptation | All world-rules honored; setup-payoff continuity | Six Things resolution check [det]; no-new-entities [det]; setup-payoff causal trace [llm] |
| Final Image | 99-100% | Mirror of opening, inverted | Need integrated | World permanently changed | Mirror-of-opening LLM check [llm]; ≤2% length [det] |

**Where this extends the SYNTHESIS [synthesis]:**

- The SYNTHESIS's STC encoding treats `stcGenre` as a 10-way classification. For fantasy, **every commercial fantasy collapses to a small set of STC engines: Golden Fleece (quest), Dude with a Problem (chosen one / system arrival), Rites of Passage (academy / cultivation), Superhero (chosen one with curse), Buddy Love (romantasy)**. Recommendation R5 below leverages this collapse.
- The SYNTHESIS doesn't mention that STC's "Six Things" check is the single highest-leverage end-of-novel diagnostic for KU readers. KU reviews calling a book "satisfying" overwhelmingly correlate with Six-Things resolution rate `[synthesis]`.

## A3. Story Grid genre obligations for fantasy hybrids

Story Grid splits genre into "external" (what happens) and "internal" (who changes). Fantasy is a setting, not a Story Grid genre - the Story Grid genre underneath a fantasy book is what determines obligatory scenes.

Sources: `docs/research/writing-frameworks/story-grid-coyne.md`, [storygrid.com](https://storygrid.com/genres-have-conventions-and-obligatory-scenes/), [storygrid.com](https://storygrid.com/the-story-grid-translated-into-common-writing-terms/), [Tara Maya](https://taramayastales.com/2015/06/12/what-are-the-obligatory-scenes-for-genre-fiction/), `[synthesis]`.

The six external genres most fantasy hybrids actually run on:

| Genre | Core value | Inciting | Required obligatory scenes | Core event | Diagnostic |
|-------|-----------|----------|---------------------------|------------|------------|
| **Action** | Life ↔ death | Inciting attack on protagonist or world | Hero at mercy of villain; speech in praise of villain; clear-cut climax | Climactic confrontation | "Hero at mercy" scene must be on-page in 65-75% [llm] |
| **Adventure** | Death ↔ life-of-meaning | Hero leaves home OR call to adventure | Threshold crossing; tests at threshold; meeting the abyss; return with the boon | Boon-acquisition climax | Threshold-cross must occur 20-30% [det]; abyss must occur 70-80% [det] |
| **Thriller** | Life ↔ damnation (worse than death) | Inciting crime indicates master villain | Hero at mercy of villain (multiple); MacGuffin chase; villain makes it personal; speech in praise of villain; clock; **two endings (false ending + real ending)** | Hero unleashes their gift | Clock must be visible by 30% [det]; villain-personal scene 50-70% [llm]; false-ending exists [llm] |
| **Mystery** | Justice ↔ injustice | Discovery of body | Discovery of body; investigation reveals red herrings; suspect interview cycles; reconstruction of events; confrontation of killer | Confrontation of killer | Body-discovery must occur 0-15% [det]; reconstruction/J'accuse 85-95% [llm] |
| **Love Story** | Love ↔ hate (of self/other) | Lovers meet (cute meet) | Lovers meet; refusal to admit love; declaration; lovers part; choice between love and X; sacrifice | Proof of love (sacrifice/declaration) | Cute meet 0-15% [det]; declaration 40-60% [det]; lovers-part 70-80% [det]; proof-of-love 85-95% [llm] |
| **Performance** | Triumph ↔ shame | Inadequacy made public | Public failure; secret training; rival demonstration; final performance | Public triumph or honored loss | Public-failure 0-15% [det]; final-performance 85-95% [det] |

**Fantasy hybrid taxonomy `[synthesis]`:**

- **Epic fantasy** = Adventure + Worldview internal genre (the protagonist's worldview must change)
- **Sword & sorcery** = Action + Status internal (rise from low)
- **Romantasy** = Love Story (PRIMARY) + Adventure as runner-up
- **Cozy mystery fantasy** = Mystery + Society internal (community values)
- **Thriller fantasy / dark academia** = Thriller + Worldview internal
- **LitRPG / progression** = Performance (PRIMARY — public competence) + Status internal (climbing)
- **Heist fantasy** = Action + Performance hybrid

The harness `seed.directives.stcGenre` should pair with `seed.directives.storyGridGenre` since they classify orthogonal axes. The combination determines which obligatory scenes the planner enforces.

**Diagnostic note:** the **two-endings** rule for thriller is an under-appreciated planner constraint. False ending (climax-1) at ~80%, then real ending at ~95%. Most LLM-drafted thrillers conflate them. This is one cheap LLM check per chapter set.

## A4. MICE quotient threading — nested LIFO for long-form

SYNTHESIS covers MICE (Sanderson §3.7) but doesn't make the **nesting LIFO** explicit at the planner-template level. This matters for long-form because nest depth is the single highest predictor of "the book felt epic vs. the book felt episodic."

Sources: `docs/research/writing-frameworks/sanderson-lectures.md`, [Writing Excuses 16.40](https://writingexcuses.com/16-40-nesting-threads-in-the-m-i-c-e-quotient/), [learning2grow.org](https://learning2grow.org/plot-your-novel-with-mice-quotient-and-try-fails/), [karenwoodward.org](https://blog.karenwoodward.org/2012/10/the-mysteries-of-outlining-and-nesting.html), `[synthesis]`.

**The four threads:**

- **M**ilieu — entering and leaving a place. Closes when POV exits. (*The Hobbit*, *Wizard of Oz*.)
- **I**nquiry — a question that demands an answer. Closes when answer is found. (*Murder mysteries*; LitRPG "what is the system?")
- **C**haracter — internal change arc. Closes when character is no longer the same person. (*Pride and Prejudice*, character-driven literary fic.)
- **E**vent — a state of the world is broken. Closes when the world is restored or remade. (*Lord of the Rings*, kingdom-restoration.)

**The LIFO rule (FILO):** threads must close in reverse order of opening. `[M [I [C [E]]]]` opens M then I then C then E and closes E first, then C, then I, then M.

**Why this is the long-form discipline that LLM planners blow up on `[synthesis]`:** LLMs naturally close threads in the order they were opened (FIFO), which produces a story that feels like it ended before it ended. The nest discipline is the structural reason *Lord of the Rings* feels like one story and not three: the M (Shire to Mordor) opens first and closes last (the Shire Frodo returns to is the Shire of Sam, not Frodo); the C (Frodo's corruption) opens after and closes before the M.

### The LIFO planner template

| Slot | Open/Progress/Close | Thread type | Required scene action | Required pressure | Diagnostic |
|------|--------------------|-------------|----------------------|--------------------|------------|
| 0-15% | Open M | Milieu | POV enters (or commits to enter) the new place | Stakes rooted in setting | Open event tagged in chapter [det] |
| 15-25% | Open I | Inquiry | A question is articulated (often by POV or B-story) that demands an answer | Inquiry consequence stated | Question must be answerable in principle [llm] |
| 25-40% | Open C | Character | POV's Lie is named (often by Want-Need scene) | Wound on display | Lie must be on-page [llm] |
| 35-50% | Open E | Event | World-state breach declared; the world is broken | Stakes go global | Worldstate must be specified pre/post [det] |
| 50-75% | Progress all | All | Each thread shows visible movement | (each thread's pressure compounds) | Per-thread progress LLM check per chapter span [llm] |
| 75-85% | **Close E** | Event | World restored or remade | E-thread payoff | E-payoff named in finale [llm] |
| 80-90% | **Close C** | Character | POV is visibly different person | C-thread payoff | Self-revelation explicit [llm] |
| 85-95% | **Close I** | Inquiry | Question answered | I-thread payoff | Answer must causally chain to question [llm] |
| 95-100% | **Close M** | Milieu | POV exits or returns; place transformed | M-thread payoff | Final-image mirror check [llm] |

**Critical [synthesis]:** the harness's per-chapter `mice_thread_id` field (SYNTHESIS §5.2) should add `nest_depth` (integer) so the balanced-parens check can verify monotonic decrease through the resolution sequence.

**Three failure modes [synthesis]:**

1. **Hanging E-thread** — the world-breach is referenced but never restored. Common in middle-book LitRPG and series fantasy that defers to next book. Make this a `series_carrying` flag, not a violation.
2. **Order-violation close** — closing M before C reads as "we left, but who are we now?" Hard fail.
3. **Mismatched-type close** — opening I and closing it as E (a question that gets resolved by a world-event, not an answer) reads as deus ex machina. Hard fail.

## A5. Maass tension/stakes escalation curve

SYNTHESIS treats Maass primarily as a microtension layer. The stakes-escalation curve at planner granularity is a separate template.

Sources: `docs/research/writing-frameworks/maass-breakout.md`, `[synthesis]`.

| Slot (% pos) | Stakes layer activated | Required scene action | Character pressure | World pressure | Diagnostic |
|--------------|-----------------------|----------------------|-------|----|------------|
| 0-10% | Personal | POV's daily life threatened | Personal want denied | (none) | Personal stakes named [llm] |
| 10-20% | Personal + Public | POV's community/family pulled in | Public reputation at risk | Community pressure | Public stakes named [llm] |
| 20-50% | Public + Ultimate (foreshadow) | Glimpse the largest framing | Ideological/value pressure | Civilizational hint | Ultimate stakes hinted [llm] |
| 50-75% | All three braided | Each scene touches ≥2 layers | Want-Need-Other braided | Local + global braided | Per-chapter coverage check (Maass) [llm] |
| 75-90% | Ultimate + Personal collide | The large frame becomes the personal cost | The Need-payoff is also the world-cost | Worldview-level shift | Stakes-collision must be explicit [llm] |
| 90-100% | Personal alone (resolution) | Stakes return to personal scale | Need integrated | World altered, personally felt | Resolution scope ≤ personal+public, no new ultimate [det] |

The key Maass insight encoded as a planner rule: **the climax is when ultimate stakes become personal in the same beat**. The harness can run a single LLM check on the climactic chapter: "are personal stakes and ultimate stakes carried by the same action in the climax?" If no, the climax is bifurcated and reads as anticlimax.

## A6. Romance/Romantasy emotional beats

The Gwen Hayes "Romancing the Beat" structure is the canonical romance beat sheet. It maps to STC almost 1:1 but adds 9 emotional beats specific to relationship arc.

Sources: [plottr.com Romancing the Beat](https://plottr.com/romancing-the-beat-template/), [mtgberman.substack.com](https://mtgberman.substack.com/p/on-romance-novel-beat-sheets), `[synthesis]` with ACOTAR/Fourth Wing patterns ([cosmicreads.me](https://www.cosmicreads.me/blog/acotar-vs-fourth-wing)).

| Beat | % | Function | Required scene action | Required character pressure | Required relational pressure | Diagnostic |
|------|---|----------|----------------------|------------------------------|------------------------------|------------|
| Introduce H1 | 0-3% | Establish protag-1 want and what blocks love | POV in their want-context | Lie that blocks love named | (none yet) | H1 has explicit "why-no-love" reason [llm] |
| Introduce H2 | 3-7% | Establish protag-2 mystery + opposing want | H2 on-page; some interiority withheld | H2's blocker hinted | (none yet) | H2 introduced ≤10% [det] |
| Meet Cute | 7-12% | First meeting; **dislike or friction**, not insta-attraction | Each registers the other; mutual pressure on Want | First contradiction surfaces | Friction or curiosity must be on-page [llm]; insta-love is failure mode |
| No Way 1 | 12-20% | First protagonist articulates "this won't work" | Lie deployed against attraction | Reason rooted in setting/social rule | Refusal scene named [det] |
| Adhesion | 20-25% | External force binds them together; cannot easily separate | Both want to leave but cannot | World/plot rule forces proximity | Adhesion mechanism must be plot-causal [llm] |
| No Way 2 | 25-40% | External goal still primary; love is "in the way" | Want vs. attraction tension | Stakes pull them apart even as proximity pulls together | Want must be threatened by attraction [llm] |
| Inkling of Desire | 40-50% | Small admitting moments; a touch, a glance, a private thought | Need first glimpsed in love-vector | Vulnerability micro-moments | ≥3 small intimate moments per 10% span [llm] |
| Deepening Desire | 50-55% | Each reveals true self; desire grows | Want softens; Need approaches | Sustained vulnerability | Per-beat affect must include both attraction + something it's contradictory with [llm] |
| Maybe This Could Work | 55-60% | Both wonder if it could succeed | Want reframed | Plan for shared future hinted | Future-language check [llm] |
| Midpoint of Love | 60% | **False high** — they believe they can have both | Lie says love and Want are compatible | World/plot says no but isn't visible yet | Mirror moment specific to relationship [llm] |
| Inkling of Doubt | 60-65% | Fear of giving up too much | Lie returns | Stakes amplify cost of love | Pull-back scene [llm] |
| Deepening Doubt | 65-70% | Doubt visible in intimacy itself | Coldness/withdrawal in shared scenes | Cost of love made concrete | Withdrawal must be enacted, not stated [llm] |
| Retreat Beat | 70-75% | Each names what they fear | Lie verbalized | Fear rooted in stakes/world | Fear-naming dialogue [llm] |
| Shields Up | 75-78% | Self-protection mode; "didn't deserve this" | Lie at maximum | Outside threats compound | Active distancing [llm] |
| **Break Up** | 78-80% | Relationship ends with no easy reconciliation | Lie wins this beat; Need violated | Both walk away with intent | Hard relational break required [llm]; this is the romantasy "All Is Lost" |
| Dark Night | 80-85% | "What have I done" realization | Need first chosen, by one or both | World quiet | Inner reckoning [llm] |
| Wake Up | 85-87% | Decide to fix this | Need adopted; sacrifice contemplated | Sacrifice required by world/plot | Decision-to-act must be active [llm] |
| Grand Gesture | 87-95% | Significant sacrifice; other hesitates | Want sacrificed for Need | World offers single window | Sacrifice must touch a named asset/stake [det] |
| Whole-Hearted | 95-99% | Show change in both | Need integrated by both | World accepts the new state | Both must demonstrate change, not just one [llm] |
| Epilogue | 99-100% | Months/years later; couple in real life together | Equilibrium | World adjusted | Time-jump tag [det]; HEA/HFN required for romance genre [det] |

**Romantasy-specific overlays `[synthesis]` from Fourth Wing/ACOTAR pattern analysis:**

- **The Adhesion mechanism is genre-load-bearing.** ACOTAR uses "bargain debt"; Fourth Wing uses "war college conscription." Without a structural force binding the leads, romantasy reads as contemporary romance with a fantasy paint job ([cosmicreads.me](https://www.cosmicreads.me/blog/acotar-vs-fourth-wing)).
- **The world-stakes must threaten the love specifically, not just generally.** Fourth Wing's threat is *"if you fail you die,"* and the romance threatens *"if I love you and you die, I lose."* This is the Maass stakes-collision rule applied at relationship scale.
- **Spice cadence has a market expectation.** First on-page intimacy 30-50% (not earlier in trad-published romantasy; KU romantasy is more permissive). Major intimacy at 60-65% (right after midpoint-of-love). Final consummation 87-95%.
- **Slow-burn vs. fast-burn maps to subgenre.** ACOTAR is slow-burn (book-1 has minimal romance peak, romance peaks in book-2). Fourth Wing is fast-burn (peak romance lands within book-1). Encode as a `burnRate: slow | fast` seed knob — affects "Inkling of Desire" placement and intimacy cadence.

## A7. Mystery clue/red-herring/payoff cadence

SYNTHESIS doesn't cover mystery cadence at planner granularity. This is the cozy/whodunit shape.

Sources: [plottr.com cozy mystery template](https://plottr.com/cozy-mystery-plot-template/), [storytellingdb.com cozy mystery beat sheet](https://storytellingdb.com/cozy-mystery/), [thebookdecoder.com](https://thebookdecoder.com/how-to-write-a-cozy-mystery-complete-guide-for-2026/), `[synthesis]`.

The fair-play rule: every clue the sleuth uses to solve the case must have been on-page when it was found, in roughly the order found, weighted to look unimportant.

| Slot | Function | Required scene action | Character pressure | Clue/red herring action | Diagnostic |
|------|----------|----------------------|--------------------|--------------------------|------------|
| 0-10% | Ordinary world | Sleuth in their normal context; their special skill on display | Pre-crime equilibrium | (none) | Sleuth-skill demonstrated [llm] |
| 10-15% | **Discovery of body** | Inciting crime found; sleuth pulled in | Personal stake hooked | **Clue 1 on page, looks insignificant** | Body-discovery must occur 10-15% [det] |
| 15-25% | Investigation begins | First witness/suspect interviews | Personal stake compounds | Red herring 1 introduced (suspect-shaped) | ≥3 named suspects by 25% [det] |
| 25-35% | Suspect parade | 5-7 suspects with motive/means/opportunity | Sleuth gathers data | Red herring 2; **Clue 2 on page, sleuth misinterprets** | Suspect-pool ≥5 [det] |
| 35-50% | Try/fail cycles | Theories proposed, disproven | Sleuth's old methods inadequate | Red herring 3; one suspect cleared (eliminator clue) | Each try-fail must end on a question [llm] |
| 50-55% | **Midpoint pivot** | A new framing — sleuth realizes they've been asking the wrong question | Mirror moment | The clue from 10% recontextualizes (looks important now) | Midpoint reframe [llm] |
| 55-70% | Deepening mystery | Stakes raised — new threat, new victim, deadline | Personal stake becomes mortal | **Clue 3** on page; red herring rebuts | Stakes escalation [llm]; new evidence per chapter [det] |
| 70-78% | Lowest point | Sleuth doubts themselves; theory collapses | Lie about own competence | Suspect pool narrows to 2-3 | Self-doubt scene [llm] |
| 78-82% | **Eureka** | The pieces click | Need-aligned insight | All 3 clues align; herrings dismissed | Clue-trace LLM check: each clue points to true killer [llm] |
| 82-92% | **Confrontation** | Sleuth faces killer; killer explains/denies | Sleuth's gift deployed | (no new clues — Brooks rule) | Confrontation scene [llm] |
| 92-98% | Resolution | Killer caught/dispatched; community restored | Sleuth changed | Reconstruction explains all clues + herrings | Reconstruction must reference ≥3 clues [det] |
| 98-100% | Restoration | Community returns to normal-with-knowledge | New equilibrium | Sleuth's life integrated | Final-image check [llm] |

**Critical fair-play diagnostic [synthesis]:** the harness can run a single end-of-novel LLM check: "given the killer reveal, walk back through the prose and identify which scenes contained the on-page clue. Cite chapter and quote. If any clue is absent, fail." This is the **fair-play check** and it's the genre's load-bearing structural test.

**Three-clue rule [synthesis]:** in the cozy/Christie tradition, exactly three genuine clues are needed. Fewer feels random; more feels overdetermined. Encode as a planner `clueBudget: { genuine: 3, redHerrings: 4-6 }` constraint.

## A8. Thriller escalation (ticking clock + threat compounding)

Sources: `docs/research/writing-frameworks/story-grid-coyne.md`, [crimereads.com](https://crimereads.com/ticking-clock-thriller/), [storygrid.com thriller genre](https://storygrid.com/thriller-genre/), `[synthesis]`.

Thriller's distinctive structural device is **threat compounding under time pressure**: each scene the protagonist resolves makes the situation worse, not better, until the climax.

| Slot | Time pressure | Threat layer | Required scene action | Character pressure | Diagnostic |
|------|---------------|-------------|----------------------|--------------------|------------|
| 0-10% | (none yet) | Initial threat established | Inciting crime indicates master villain | Sleuth pulled in | Inciting-crime [det] |
| 10-20% | (clock starts visible) | Personal proximity | Hero's people threatened | Personal stakes hooked | Clock-on-page [det] |
| 20-30% | First deadline | Resource depletion | Hero loses ally/asset | Lie costs them | Asset-loss event [det] |
| 30-40% | Compounding | Information asymmetry | Hero learns villain knows more than expected | Want re-evaluated | Knowledge-gap revealed [llm] |
| 40-50% | Deadline 2 | "**Speech in praise of villain**" | Avatar/proxy character explains villain's brilliance | Hero's confidence shaken | Speech-in-praise scene [llm] |
| 50-60% | Mid-clock | Geographic constraint | Hero's safe place becomes unsafe | Lie under siege | Safe-place breach [llm] |
| 60-70% | Compounding | **Personal target** | Villain makes the crime personal | Need first surfaces | Personal-target scene [llm] |
| 70-80% | Deadline 3 | **Hero at mercy of villain (1st)** | Hero captured/cornered/exposed | Lie at maximum | First mercy-scene [det/llm] |
| 75-80% | Clock near zero | False ending | Apparent resolution | Hero still wears Lie | False ending scene [llm] |
| 80-87% | **Clock expires / restart** | Real threat revealed | The actual climax is something different | Need adopted | Real-threat reveal [llm] |
| 87-95% | (clock irrelevant) | **Hero at mercy of villain (2nd)** + **gift unleashed** | Hero deploys their unique gift | Need-action delivers | Hero-gift-deploy [llm] |
| 95-100% | Aftermath | Resolution | Surviving the cost | Need integrated | Cost-event named [llm] |

**The two-endings rule** is non-negotiable for thriller. Most LLM-drafted thrillers conflate the false ending and real ending into one climax, producing a structurally flat thriller. Encode as a hard planner constraint: thriller seeds must place a `false_ending` at 78-82% and a separate `real_ending` at 88-95%.

**The clock visibility rule:** the ticking clock must be **referenced on-page at least once per chapter** in the second half of the book. Not vaguely ("they were running out of time") but concretely ("six hours until the launch"). Lee Child's Reacher novels are the reference: [crimereads.com](https://crimereads.com/ticking-clock-thriller/) notes Reacher countdowns shift from hours to minutes as the climax nears.

## A9. Sanderson promise/progress/payoff at chapter level

SYNTHESIS covers PromiseRegistry as a global table. This template is the **chapter-grain promise cadence**.

Sources: `docs/research/writing-frameworks/sanderson-lectures.md`, [Sanderson 2025 plot lecture #2](https://www.brandonsanderson.com/blogs/blog/brandon-sandersons-2025-guide-to-plot-lecture-2), `[synthesis]`.

The discipline: **every chapter must (a) progress at least one open promise visibly, (b) optionally make a new promise, (c) optionally close a promise.** A chapter that makes no progress on any open promise is filler.

| Slot (% range) | Promises typically made | Promises typically progressed | Promises typically closed | Diagnostic |
|---------------|------------------------|------------------------------|---------------------------|------------|
| 0-10% | M: protagonist-deficit, M: world-rule, M: theme-question | (none yet) | (none) | ≥3 promises open by 10% [det] |
| 10-25% | M: central-conflict, M: ally-arc | P: protagonist-deficit | (none) | At least 1 promise progresses per 5% span [llm] |
| 25-50% | M: antagonist-shadow, M: secondary-promises | P: central-conflict, P: ally-arc, P: world-rule (rules-test) | R: theme-question (partial — it gets re-asked, not answered) | Per-chapter ≥1 progress [llm]; nothing closes major yet [det] |
| 50-75% | M: forced-ascension, M: antagonist-personal | P: many | R: minor world-rule (closed by being violated, e.g., "the rule has exceptions") | Per-chapter ≥1 progress [llm]; ≥1 minor close [llm] |
| 75-90% | M: final-confrontation (only) | P: all major | R: ally-arc, R: world-rule (deepened understanding), R: protagonist-deficit (partial) | All major promises must be in `progressing` or `closing` state [det] |
| 90-100% | (no new promises — Brooks rule) | — | R: central-conflict, R: forced-ascension, R: antagonist-personal, R: theme-question (full) | All open major promises closed; no new entities [det] |

**The chapter-level discipline `[synthesis]`:** each chapter has a "chapter promise" — a small question raised in the first beat, answered or escalated in the last beat. This is below the major PromiseRegistry layer but reads as the per-chapter cliff/hook contract.

| Slot | Chapter-promise function |
|------|--------------------------|
| Beat 1 | A small question raised (will the meeting happen? what does the letter say?) |
| Beats 2-N-1 | Tension in resolving the small question; main-thread progress |
| Beat N (closing) | Small question answered, escalated, or pivoted (cliffhanger) |

Diagnostic: each chapter's first and last beat extracted; LLM verifies chapter-promise opened in beat 1 and answered/escalated in beat N. ~$0.001/chapter.

---

# Section B — Reader/Market Expectations (KU commercial fantasy)

This section is mostly web-research-backed because the SYNTHESIS doesn't directly cover KU sample/preview behavior.

## B1. The first 10% (KU sample contract)

Amazon Kindle's "Read a Sample" presents roughly the first 10% of a book. KU readers see this before deciding to add to library. Indie author retention data ([nicholewithanhproofreading.com](https://www.nicholewithanhproofreading.com/post/how-to-optimize-your-book-for-kindle-unlimited-in-2025), [kindlepreneur.com](https://kindlepreneur.com/calculate-series-read-through/)) converges on:

| Reader-expectation signal | What KU readers expect | Failure mode the harness can detect |
|--------------------------|------------------------|------------------------------------|
| **Hook in paragraph 1** | A question, threat, system event, off-balance protagonist, or strong voice in first ~150 words. Not a weather report. | First-paragraph LLM hook check: contains tension, voice, concrete sensory detail, OR question. [llm] |
| **Voice signal in first scene** | Distinctive POV register (humor, gravity, register-mismatch with situation) | First-scene voice extraction; compare to a "generic fantasy" baseline [llm] |
| **Genre signal in first chapter** | The reader can identify the subgenre by chapter end (epic / portal / progression / romantasy / cozy / dark academia) | Genre classifier on chapter 1 prose [llm] |
| **World rule visible** | At least one operational world-rule shown (not described). The magic/system/social-rule does something the reader observes. | World-operationality check on chapter 1: does an established rule fire? [llm] |
| **Protagonist competency baseline** | The protagonist demonstrates one thing they're good at AND one thing they're bad at within first 10%. | Competency-baseline LLM check [llm] |
| **Promise of the premise registered** | The reader knows what the book is going to be about (the cover-copy claim is signaled) | Cover-promise alignment check [llm] |
| **Below 25% sample-to-completion = DOA** | Indie author consensus: if fewer than 25% of sample-readers continue to full read, structurally broken | (orchestrator-side metric, not harness signal) |

**The harness implication `[synthesis]`:** a `chapter-1-readiness-checker` running 5-6 cheap LLM checks (~$0.002/run) before the planner emits the chapter-1 skeleton would catch the dominant retention failure mode. This is downstream-of-planner but upstream of drafting.

## B2. First quarter (0-25%): inciting → first turning point

The quarter-mark is dominated by Save the Cat's "Break Into 2" / Brooks's "First Plot Point" / Weiland's FPP. Reader-expectation-shaped patterns:

| Slot | KU reader expects | Subgenre overlay |
|------|-------------------|------------------|
| 8-12% | **Catalyst that visibly closes return-to-status-quo path** | Epic: prophecy/invasion. Portal: portal opens. Progression: system arrives. Romantasy: cute meet escalates to adhesion. Cozy: body discovered. |
| 15-20% | **Magic/system/world rules visible (≥2)** | Epic: 2 magic uses observed. Progression: tier ladder named. Romantasy: world social rule constrains love. Cozy: community texture established. |
| 18-22% | **Ally introduced** | Epic: mentor/companion. Romantasy: B-story (often the love interest themselves; ACOTAR/Fourth Wing pattern). Cozy: sidekick/Watson. |
| 22-28% | **Active commitment to new context (Break Into 2)** | Epic/portal: physical departure. Progression: class/path selection. Romantasy: adhesion locked. Cozy: amateur-investigator commits despite police warning. |

**KU reader red flags by 25% `[synthesis]`:**

- Protagonist still hasn't actively chosen anything → "passive protagonist" reviews
- The genre still isn't clear → "what kind of book is this?" reviews
- No magic/system has fired → "why is this fantasy?" reviews
- Antagonist hasn't been hinted → "no stakes" reviews

These are detectable by chapter-grain LLM checks at 20%, 25%, 30% boundaries.

## B3. Midpoint (50%) conventions

Save the Cat literature unanimous: the midpoint is the load-bearing chapter that determines whether the reader finishes. Specific reader expectations ([Save the Cat](https://savethecat.com/about-the-beats/cracking-the-midpoint-the-false-victory), [Helping Writers Become Authors](https://www.helpingwritersbecomeauthors.com/the-two-halves-of-the-midpoint-2/), [happy-writer.com](https://happy-writer.com/midpoint-mirror-moment-novel-plotting/)):

| Convention | Required signal | Diagnostic |
|------------|-----------------|------------|
| **False victory OR false defeat (not flat)** | Stakes-direction inversion at exactly midpoint | Pre/post stakes-polarity LLM check [llm] |
| **Mirror moment** | POV looks at themselves; sees what they must become | Mirror-moment LLM check on chapter prose [llm] |
| **Stakes scope expand** (local→regional, personal→public) | A new dimension of consequence enters | Stakes-scope diff [llm] |
| **A-story and B-story collide** | The two threads intersect in shared scene | B-story character presence [det] |
| **"Truth bomb" dialogue** | Often a dialogue line that reframes everything | Reframe-dialogue check [llm] |

**Subgenre overlays:**

- **Epic fantasy:** the midpoint reveals the true scale of the threat (often an antagonist-shadow upgrades to antagonist-on-page). Example: midpoint of *The Way of Kings* (Sanderson) — Kaladin sees his bridge crew as soldiers.
- **Progression/LitRPG:** midpoint is often a tier-break failure or an enemy that the current tier cannot defeat. Reframes the progression curve.
- **Romantasy:** midpoint of love is the false high — they believe they can have both love and goal. Always preceded by intimacy peak.
- **Cozy mystery:** midpoint is the detective realizing they've been asking the wrong question; clue from 10% recontextualizes.
- **Thriller:** midpoint is "speech in praise of villain" — the moment the protagonist truly understands the antagonist's brilliance.
- **Portal fantasy:** midpoint is when the portal-back option closes (literal or symbolic), forcing commitment to the new world.

## B4. The 75% pivot (Dark Night / All Is Lost)

Reader expectation literature ([helpingwritersbecomeauthors.com](https://www.helpingwritersbecomeauthors.com/the-two-halves-of-the-third-plot-point-2/), Brody's beat sheet) converges on a two-part 75% structure:

- **75-78%: All Is Lost** — externally visible loss. Whiff of death. A thing/person dies (literal or symbolic).
- **78-82%: Dark Night of the Soul** — internal reckoning with the loss. POV processes. Often quiet, often paired with the B-story character.

**KU reader expectations:**

| Convention | Required signal |
|------------|-----------------|
| **Externalize the loss before internalizing it** | All Is Lost (75-78%) shows it; Dark Night (78-82%) is about it |
| **The thing that dies must be one that was on-page** | Mentor character must have been introduced and developed |
| **The protagonist's Lie must be at maximum gravitational pull** | They're tempted to give up Need and return to Want |
| **B-story character is structurally important here** | They're the one who pulls the protagonist out |

**Subgenre overlays:**

- **Epic fantasy:** mentor death is canonical (Gandalf, Obi-Wan, Brom in *Eragon*). The harness should permit but not require it; "symbolic death of mentorship" can substitute.
- **Romantasy:** the **break-up** at 78-80% is the structural equivalent of All Is Lost. The relationship dies.
- **Cozy mystery:** the sleuth's theory collapses; suspect they had cleared turns out to be guilty (or vice versa); confidence in their own competence dies.
- **Progression/LitRPG:** the protagonist's current tier/build proves inadequate; a friend dies because the build is wrong; protagonist must re-think their path.
- **Thriller:** the false ending happens here. Apparent resolution that doesn't hold.
- **Portal fantasy:** the protagonist realizes they cannot save both worlds, or that returning home is no longer possible/desirable.

## B5. Climax conventions (escalation of promised stakes, not new threats)

Brooks's "no new entities post-SPP" rule is the structural rule readers feel even if they can't name it: **the climax must be lost or won using only what was on-page**.

| Convention | Required signal | Diagnostic |
|------------|-----------------|------------|
| **All climax-load-bearing entities established before 75%** | Brooks's deterministic check | Pre/post 75% entity-diff [det] |
| **All climax-load-bearing capabilities established and demonstrated** | Sanderson's First Law | Capability-trace LLM [llm] |
| **The protagonist's Need is the deciding lever** | Their Want-action couldn't have won; their Need-action does | Need-action causal trace [llm] |
| **The setup-payoff causal chain is complete** | Six Things resolution + PromiseRegistry closure | Setup-payoff trace [llm] |
| **No coincidence saves the protagonist** | If chance enters, it must have been seeded | Coincidence-detector [llm] |
| **The antagonist gets one last credible try** | "Hero at mercy of villain (2nd)" — even outside thriller | Mercy-scene check on climax chapter [llm] |
| **Stakes collide** | Personal + ultimate on the same beat | Stakes-collision check [llm] |

**Subgenre overlays:**

- **Epic fantasy:** the climax often features all three plot layers (outer/inner/world) resolving in same scene. *Lord of the Rings*: ring destroyed (outer), Frodo's corruption (inner), Middle Earth changes (world).
- **Progression/LitRPG:** climax is the deployment of the new tier/build/insight. The "I have grown to this" beat. Stat-blocks and named techniques cluster here.
- **Romantasy:** climax is the grand gesture + sacrifice. Both lovers must change, not just one.
- **Cozy:** climax is the J'accuse — confrontation of the killer with reconstruction of evidence.
- **Thriller:** climax is the gift unleashed (Story Grid term) — the protagonist's unique capability decisive.
- **Portal fantasy:** climax decides whether the protagonist returns home or stays — a Want-Need binary at the world level.

## B6. Resolution conventions (length, scope, sequel hook discipline)

| Convention | Required signal |
|------------|-----------------|
| **Resolution ≤2-3% of total length** | Weiland; reader-expectation backed |
| **Final image mirrors opening image** | Same setting, similar action, **inverted emotional valence** |
| **Six Things resolved** | Each setup deficit referenced/resolved in the closing chapter |
| **Sequel hook distinct from open promise** | Series books: a NEW promise opens, distinct from the just-closed one |
| **Standalone books: no open major promises** | All "this-book" promises must close |

**Sequel hook discipline `[synthesis]`:** the most-cited KU reader complaint ("ended on a cliffhanger and book 2 isn't out") is structurally separable from honest sequel hooks. The discipline:

- **Closed hook (acceptable):** all this-book promises closed; one new promise opened that the reader can choose to engage with.
- **Open hook (problematic):** this-book promises *not* closed; the book ends mid-arc.

Encode as a `bookEndingShape: closed_with_hook | open_arc | standalone` flag, with the planner enforcing PromiseRegistry status by the final chapter.

## B7. Subgenre divergences from the commercial-fantasy spine

| Subgenre | Where it diverges from the 24-chapter spine |
|----------|---------------------------------------------|
| **Epic fantasy** | Expanded Bad Guys Close In (50-75%); often multi-POV; midpoint involves world-stakes scope expansion (regional → continental → cosmic). Resolution often delayed across volumes. |
| **Portal fantasy** | Catalyst is the portal itself (~10%); midpoint is the closure of the portal-back option. Final image often inverts: instead of returning home, choosing to stay (or vice versa). The Darling Axe ([darlingaxe.com](https://darlingaxe.com/blogs/news/portal-fantasy)) notes this is currently a tough sell on its own; portal-fantasy-is-also-romantasy is more commercially viable. |
| **Progression/LitRPG** | The 24-chapter spine is replaced by a tier-cadence spine (one major tier per book, 3-6 minor advances). Midpoint is a tier-break or a build-failure. Climax is gift-of-tier-deployment. Royal Road serial cadence overrides chapter sizing (2-3.5k words). See SYNTHESIS LitRPG section. |
| **Romantasy** | Romancing the Beat (A6) overlays the 24-chapter spine. Adhesion at 20-25% replaces "Break Into 2." Midpoint of love at 60% (later than STC's 50%). Break-up at 78-80% IS the All Is Lost. Two protagonists' arcs must both close. |
| **Cozy mystery fantasy** | The mystery's body-discovery at 10-15% replaces the catalyst. Sleuth-skill demonstration drives early chapters. Three-clue-cadence structures the middle (clue 1 at 10%, clue 2 at 30%, clue 3 at 65%). J'accuse confrontation at 85-92%. Restoration-of-community ending. |
| **Thriller fantasy** | The clock must visible by 30%. Threat-compounding replaces simple bad-guys-close-in. Two endings (false at 80%, real at 90%). Speech in praise of villain at 40-50%. Hero-at-mercy-of-villain twice (75% and 90%). |

**Cross-subgenre mixing `[synthesis]`:** modern KU commercial fantasy is rarely pure. ACOTAR is romantasy + adventure; Fourth Wing is romantasy + dark academia + dragon-rider; *Cradle* is progression + adventure; *Dungeon Crawler Carl* is LitRPG + thriller-comedy. The harness's `seed.directives` should support a primary + secondary genre tag, with the planner running primary-genre obligatory scenes as required and secondary-genre scenes as optional.

---

# Section C — Recommendations (testable planner-template hypotheses)

Twelve recommendations. Each is phrased as a planner-template intervention, tied to a specific reader-expectation failure mode, and falsifiable on a small panel.

---

### Recommendation R1: 24-chapter commercial-fantasy template as `templateId: cfa-24-v2`

- **Layer optimized**: L1 planner.
- **Exact proposed change**: Add `cfa-24-v2` to the templates registry (extends `commercial-fantasy-adventure-v1`). The template defines 24 slot ids with the function/action/pressure columns from §A1. Planner reads the template; for each chapter slot, emits chapter purpose + endpoint + character pressure as a chapter-contract. The diagnostic-only Plan Readiness Review scores per-slot satisfaction.
- **Expected storytelling benefit**: addresses H1 (structure-template) and H3 (chapter contracts) jointly. Reader-visible: clearer chapter functions, stronger endpoint hooks, less middle-chapter drift. Specifically catches "what does chapter 14 do?" emptiness that LLM planners produce when they have no structural target.
- **Downstream risks**: rigid 24-chapter overfitting on shorter forms; conflicts with H2 if scenes become primary unit (mitigation: template slots are story jobs, not chapter-count mechanics, per V1 method-pack design).
- **How to test it cheaply**: run the existing `commercial-fantasy-adventure-v1` planner-only diagnostic on 3 frozen disposable concepts. For each, generate two plans: V1 baseline vs. cfa-24-v2 with explicit slot purposes. Use the existing planner-quality diagnostic + Plan Readiness Review for side-by-side scoring. ~$1.50 total, no drafting.
- **What data would prove value**: cfa-24-v2 must improve `endpointLanded` and `characterArcPressure` dimensions by ≥0.5 (Likert 1-5) on ≥2 of 3 concepts, with no regression on `strategyConservation`. Sample shape: 3 concepts × 2 arms = 6 plans, side-by-side review by user.
- **What should remain unchanged**: writer, checker policy, runtime defaults, drafting; all existing V0/V1 method-pack diagnostics; the slot-as-story-job (not chapter-count) interpretation.

---

### Recommendation R2: First-paragraph hook checker on chapter-1 prose

- **Layer optimized**: L2 scene contract (validation post-draft).
- **Exact proposed change**: add a `chapter-1-hook-checker` validator that reads only the first ~150 words of chapter 1 prose and runs one cheap LLM check: does the first paragraph contain tension (a question, threat, voice mismatch, sensory contradiction) or is it a "weather report" (descriptive, atmospheric, low-tension)? Output: `hook_present: bool`, `hook_type: enum`, `failure_reason: string`. Diagnostic-only initially; routes to `editorial_flag` envelope if missing.
- **Expected storytelling benefit**: directly addresses the KU sample-conversion bottleneck (B1). The single highest-leverage chapter check in the entire pipeline because the rest of the book's value is gated by sample-pass.
- **Downstream risks**: voice-LoRA-aware calibration needed (Salvatore opener may register as low-tension by Maass-strict rubric); over-firing on quiet literary openings (mitigation: scope to seeds with `seed.market = ku_commercial_fantasy`).
- **How to test it cheaply**: run on 10 existing chapter-1 drafts from the harness's existing novel database. Manual rate them (operator) "would I keep reading" Y/N. Compare to checker output. Accuracy target: ≥75%. ~$0.02.
- **What data would prove value**: ≥75% agreement with operator Y/N on n=10 chapter-1 panel; zero false-positives on a known-good chapter-1 (e.g., from Salvatore corpus). If the false-positive rate exceeds 30%, recalibrate by lowering threshold and re-test.
- **What should remain unchanged**: chapters 2+ keep existing checks; planner not affected; this is a post-draft validator only.

---

### Recommendation R3: Romantasy planner template as `templateId: romantasy-rtb-v1`

- **Layer optimized**: L1 planner.
- **Exact proposed change**: add a Romancing-the-Beat-shaped template that overlays the 24-chapter CFA spine. The template adds 9 relationship-arc beat slots (meet cute, no-way 1/2, adhesion, inkling/deepening desire, midpoint of love, retreat, break-up, grand gesture, whole-hearted) with placement percentages from §A6. Per-chapter, planner annotates whether the chapter advances the romance arc or holds it static. Required scene-contract field for romance-active chapters: `relationship_state` (one of {curious, friction, approaching, intimate, doubting, broken, healing, integrated}).
- **Expected storytelling benefit**: addresses the gap that current CFA-v1 doesn't have romance-specific structure. ACOTAR-shape and Fourth-Wing-shape are commercially the largest current KU fantasy market segment. Reader-visible: emotional cadence that doesn't read flat or rushed.
- **Downstream risks**: bolts a second beat sheet onto the first (potential conflict between STC's 50% midpoint and RtB's 60% midpoint of love); mitigation: template explicitly marks STC midpoint = book-mid, RtB midpoint = love-mid, and both need to land.
- **How to test it cheaply**: take an existing romance-leaning concept seed; generate plans with cfa-24-v2 baseline vs. romantasy-rtb-v1 (RtB overlay enabled). Side-by-side review on the diagnostic dimensions of `relationshipMovement`, `intimacyCadence`, `breakUpLanding`. ~$0.75 per arm.
- **What data would prove value**: ≥1 dimension improved by ≥0.5 Likert with no regression on others; specifically the `breakUpLanding` should be at the 78-80% mark with all of: lie-deployed, withdrawal-enacted, allied-rebuke-impossible. Sample: 2 concepts × 2 arms = 4 plans.
- **What should remain unchanged**: non-romance seeds; CFA-v1 baseline behavior; spice cadence is still operator-configured (don't auto-set burn rate).

---

### Recommendation R4: MICE-thread balanced-parens validator at planner output

- **Layer optimized**: L1 planner (validation pre-draft handoff).
- **Exact proposed change**: extend the chapter contract with `mice_thread_id`, `mice_role: open|progress|close`, `mice_type: M|I|C|E`, and `nest_depth: int` (per SYNTHESIS §5.2 + the LIFO discipline). Add a stack-walk validator that runs at planner-output completion: walks chapters in order, pushes on `open`, pops on `close`; closes must match the most-recent unclosed open of the same type. Mismatch → `editorial_flag` envelope.
- **Expected storytelling benefit**: catches the dominant LLM long-form failure mode of FIFO closing (close threads in opened order, not reverse-opened order). Reader-visible: novels where the main story closure feels like the main story closure, not "wait, are we still on this?"
- **Downstream risks**: over-fires on intentionally-open threads (`series_carrying`); mitigation: per-thread `series_carrying: bool` flag suppresses the close requirement.
- **How to test it cheaply**: run on existing planner outputs (5 novels in DB). Manually annotate MICE structure. Compare to validator output. ~$0 (deterministic).
- **What data would prove value**: ≥4 of 5 manually-annotated novels match the validator's nesting structure; validator catches ≥1 known-bad nest in the panel. Promotion gate: zero false-blocker on a known-good Salvatore-shape novel.
- **What should remain unchanged**: writer; chapter-plan-checker; non-MICE-aware seeds (default to one M thread + one C thread, allowing the validator to be a soft warning if no MICE annotation exists).

---

### Recommendation R5: STC-genre + Story-Grid-genre paired planner directive

- **Layer optimized**: L0 concept (Seed.directives).
- **Exact proposed change**: require concept seeds to declare both `stcGenre` (10-way) and `storyGridGenre` (12-way external) tags, where they classify orthogonal axes (dramatic shape vs. content type). The planner uses both: STC for the beat lattice, Story Grid for obligatory scene checklists. Declared pairings are validated for compatibility (e.g., "Buddy Love + Action" is allowed, "Dude with a Problem + Performance" needs justification).
- **Expected storytelling benefit**: Closes the gap that current CFA pack treats genre as a flat marketing label. Reader-visible: obligatory-scene checklists become subgenre-accurate (a romantasy plan must include "lovers part" scene; a thriller plan must include "speech in praise of villain"; a cozy plan must include "discovery of body" at 10-15%).
- **Downstream risks**: planners may treat checklists as mechanical (every genre cliche present); mitigation: SYNTHESIS §9 over-fidelity warning still applies — checker also flags "all conventions present, none subverted" as `mechanical_genre_compliance`.
- **How to test it cheaply**: take 4 existing seeds, classify them in both schemas (manual), generate plans with vs. without the obligatory-scene checklist. Score whether obligatory scenes are dramatized in the resulting plan. ~$1 total.
- **What data would prove value**: planned obligatory-scene coverage rises from baseline to ≥80% across the 4 seeds; the `mechanical_genre_compliance` flag fires at most once; operator side-by-side prefers the dual-tag arm in ≥3 of 4.
- **What should remain unchanged**: existing CFA macro slots; per-genre checklists are advisory/required toggle (start advisory).

---

### Recommendation R6: Midpoint mirror-moment validator

- **Layer optimized**: L1 planner OR L2 scene contract (post-draft).
- **Exact proposed change**: add a `midpoint-mirror-moment-checker` that runs on the chapter at 48-52%. Single LLM check: does this chapter contain a beat where the POV (a) explicitly reflects on what they have become / where they are, AND (b) sees the gap between Want and Need? Output: `mirror_moment_present: bool`, `where_in_chapter: int (beat index)`, `gap_named: bool`. If absent, route to either chapter-plan-reviser (planner stage) or quality-redraft (drafting stage).
- **Expected storytelling benefit**: directly addresses B3 reader-expectation failure ("midpoint flat"). The Save the Cat literature is unanimous that this is the load-bearing midpoint signal; the harness currently has no midpoint-specific check.
- **Downstream risks**: forcing a mirror moment can produce on-the-nose interiority; mitigation: the checker accepts "visual" or "situational" mirror moments (a mirror, a portrait, a reflection, a deja vu) — not just dialogue.
- **How to test it cheaply**: pick 3 existing chapter-12-13 drafts; manual annotate "is this a credible midpoint mirror." Run checker. Compare. ~$0.005 per check.
- **What data would prove value**: ≥75% agreement with manual annotation; checker fires correctly on chapters that operator agrees are flat-midpoint; checker permits valid non-dialogue mirror moments (visual/situational) without false-failure.
- **What should remain unchanged**: chapters outside the 48-52% window; non-CFA-v1 seeds; the rest of the validation stack.

---

### Recommendation R7: Three-clue cadence enforcement for cozy-mystery seeds

- **Layer optimized**: L1 planner.
- **Exact proposed change**: when `seed.directives.storyGridGenre = mystery`, the planner template requires a `clueLedger` field: `{ clue_id, clue_text, plant_chapter_pct, misinterpretation_chapter_pct, payoff_chapter_pct, points_to_killer: bool }`. Exactly 3 genuine clues required (Christie three-clue rule); 4-6 red herrings allowed. Each clue must have plant in 0-30%, misinterpretation in 30-60%, payoff in 78-92%. Validator runs end-of-arc to verify: (a) all 3 clues planted, (b) all 3 referenced in confrontation scene, (c) red herrings dismissed.
- **Expected storytelling benefit**: addresses A7 fair-play rule which the harness currently has no mechanism for. Reader-visible: cozy mysteries that satisfy the "of course! how did I miss that" reaction.
- **Downstream risks**: rigid 3-clue count can over-constrain (some cozies use 2 main clues + a circumstantial chain); mitigation: `clueBudget: { min: 2, max: 4 }` with default 3.
- **How to test it cheaply**: not testable until at least one cozy seed exists. Defer until seed exists; for now ship as `mystery-clue-ledger-v1` template that can be opted-in.
- **What data would prove value**: on a single cozy plan, all 3 clues placed at correct percentages, all 3 reference-chained from confrontation scene to plant scene; ≥4 red herrings introduced and dismissed.
- **What should remain unchanged**: non-mystery seeds; the rest of the planner contract.

---

### Recommendation R8: Maass three-layer plot coverage at chapter contract

- **Layer optimized**: L1 planner (chapter contract field).
- **Exact proposed change**: extend chapter contract with `outerProgression`, `innerProgression`, `worldProgression` strings (per SYNTHESIS §5.2 / Maass §3.2). At least one of three must be non-empty per chapter; at least two of three for chapters 6-22. Diagnostic-only (warning, not blocker) at first.
- **Expected storytelling benefit**: addresses the "this chapter is fine but I don't know why I should care" failure mode. Maass's claim is empirically grounded: breakout-quality novels braid all three strands. Reader-visible: chapters that don't read as filler.
- **Downstream risks**: planners may produce shallow `worldProgression` entries to satisfy the field ("the city felt different"); mitigation: a 1-LLM-call non-genericness check on each field.
- **How to test it cheaply**: re-run the existing 3 disposable concept plans from R1's panel; add the three-layer coverage scoring as additional planner-quality dimensions. Score plans on whether two of three layers are non-trivial. ~$0.01 marginal.
- **What data would prove value**: ≥80% of chapters across the panel hit ≥2-of-3 layer coverage; operator preference correlates with coverage rate; non-genericness check flags ≤10% of layer entries.
- **What should remain unchanged**: existing chapter contract fields; CFA macro slots; this is additive.

---

### Recommendation R9: Two-endings constraint for thriller-tagged seeds

- **Layer optimized**: L1 planner.
- **Exact proposed change**: when `seed.directives.storyGridGenre = thriller` (primary or secondary), the planner template enforces two distinct endings: `false_ending_chapter_pct: 78-82%` and `real_ending_chapter_pct: 88-95%`. Each is a separate planner slot. Validator runs at planner output: (a) two distinct climactic chapters, (b) the false ending must produce apparent resolution, (c) the real ending must reveal the false one as a feint.
- **Expected storytelling benefit**: addresses A8 thriller-specific failure mode that currently has no harness mechanism. LLM-drafted thrillers conflate the two endings; this template enforces the structural separation. Reader-visible: thrillers that don't feel like they peaked at 80%.
- **Downstream risks**: thriller-as-secondary genre may not need both endings (e.g., LitRPG-thriller hybrid like *DCC* uses ticking-clock without false-ending discipline); mitigation: only enforce when thriller is *primary*.
- **How to test it cheaply**: defer until a thriller-primary seed exists. Reference design only at first.
- **What data would prove value**: on a single thriller-primary plan, two distinct ending chapters at correct percentages, with causal chain from false to real climax.
- **What should remain unchanged**: non-thriller seeds; the rest of the planner.

---

### Recommendation R10: Stakes-collision check on climax chapter

- **Layer optimized**: L2 scene contract (validation post-draft of climax chapter).
- **Exact proposed change**: on the chapter tagged `milestone: climax` (or chapter at 88-95%), run a single LLM check: "does the climactic action carry both a personal stake and an ultimate stake in the same beat?" Output: `personal_stake_present: bool`, `ultimate_stake_present: bool`, `same_beat: bool`. All three must be true; failure routes to chapter-plan-reviser (catch at plan stage) or quality-redraft (catch at draft stage).
- **Expected storytelling benefit**: this is Maass's stakes-collision rule (§A5). Reader-visible: climaxes that feel weighty rather than mechanical. The single most under-encoded high-leverage check available.
- **Downstream risks**: cozy mysteries and slice-of-life don't have ultimate stakes; mitigation: only enforce for `seed.directives.storyGridGenre ∈ {action, thriller, adventure, war, worldview}`.
- **How to test it cheaply**: run on 3 existing climax-chapter drafts. Manual rate "personal+ultimate-collide-Y/N." Compare. ~$0.01 total.
- **What data would prove value**: ≥75% agreement with operator on n=3; checker correctly distinguishes "personal-only" climaxes (cozy-shape) from "stakes-colliding" climaxes (epic/thriller-shape).
- **What should remain unchanged**: chapters before climax; non-applicable-genre seeds; existing chapter-plan-checker.

---

### Recommendation R11: Sequel-hook discipline classifier

- **Layer optimized**: L1 planner OR L2 final-chapter scene contract.
- **Exact proposed change**: add a `bookEndingShape: closed_with_hook | open_arc | standalone` field to seed.directives; on the planner's final chapter, run a validator that checks against the declared shape. For `closed_with_hook`: all major book-internal promises closed AND ≥1 new promise opened that can be the next book's catalyst. For `open_arc`: open promises required. For `standalone`: no new promises opened.
- **Expected storytelling benefit**: addresses B6 sequel-hook failure mode — KU readers' #1 gripe is books that end mid-arc without warning. Reader-visible: book endings that feel earned even when they hook the next book.
- **Downstream risks**: complicates PromiseRegistry semantics (which promises are book-internal vs. series-carrying); mitigation: extends SYNTHESIS Q4 — `book_internal: bool` field on each promise; validator checks `book_internal: true` ones close in this book.
- **How to test it cheaply**: run on 3 existing novels' final chapters. Classify the actual ending shape vs. the declared one. ~$0.005 total.
- **What data would prove value**: classifier agrees with operator on n=3 final chapters; correctly distinguishes a "closed-with-hook" ending from an "open-arc" ending; PromiseRegistry book_internal status is correctly set on existing data.
- **What should remain unchanged**: PromiseRegistry's existing schema (this is additive); per-chapter promise extraction.

---

### Recommendation R12: Subgenre-overlay knob for `seed.market`

- **Layer optimized**: L0 concept (seed configuration).
- **Exact proposed change**: add `seed.market: ku_commercial_fantasy | ku_romantasy | ku_progression | ku_cozy | indie_general | trad_literary` (extensible). Map markets to (a) chapter-length targets (KU 100-150k, romantasy 90-130k, progression 100-200k+, cozy 70-90k), (b) opening-hook strictness (KU stricter than trad), (c) which obligatory-scene checklists are required vs. optional, (d) sequel-hook expectation (`bookEndingShape` default differs). Diagnostic-only initially; affects which checks run, not which prompts fire.
- **Expected storytelling benefit**: replaces current "fantasy-flavored" defaults with market-aware planner behavior. Addresses H8 (genre/market strategy profiles) directly. Reader-visible: outputs that feel KU-appropriate vs. trad-appropriate per the seed's stated market target.
- **Downstream risks**: combinatorial overhead from market × genre × subgenre; mitigation: start with 4 markets and grow; defer auto-detection (per V1 method-pack rule).
- **How to test it cheaply**: classify existing seeds against the 6 markets (manual). Compare planner outputs grouped by market. Measure whether the chapter-length targets and obligatory-scene coverage diverge correctly. ~$0.05 total.
- **What data would prove value**: across 6 seeds (one per market), the chapter-length target is hit within ±10%, and the relevant obligatory-scene checklist coverage exceeds 80% per market; cross-market plans don't collapse to a single shape.
- **What should remain unchanged**: existing seed defaults (a seed without `seed.market` defaults to `indie_general`); writer behavior; the non-market diagnostic dimensions of V1.

---

## Cross-recommendation arbitration `[synthesis]`

The 12 recommendations form a partial order. Implement bottom-up:

1. **Foundational layer (L0/L1, no drafting changes):** R5 (paired genre tags), R12 (market knob), R11 (sequel-hook discipline). These are seed/concept-level and cost nearly nothing.
2. **Planner template layer (L1):** R1 (cfa-24-v2), R3 (romantasy-rtb-v1), R7 (mystery-clue-ledger-v1), R9 (thriller two-endings), R8 (Maass three-layer coverage), R4 (MICE balanced-parens). These extend templates and chapter-contract fields without changing drafting.
3. **Validator layer (L2 post-draft):** R2 (chapter-1 hook), R6 (midpoint mirror), R10 (stakes-collision). Cheap LLM checks on specific chapters.

**Conflicts to watch:**

- R3 (RtB midpoint at 60%) vs. R6 (mirror moment at 50%) — resolved by treating them as separate beats (book-midpoint and love-midpoint can coexist).
- R5 (obligatory-scene checklists) vs. SYNTHESIS §9 over-fidelity warning — resolved by the `mechanical_genre_compliance` flag.
- R8 (three-layer coverage) vs. existing chapter-purpose field — resolved by treating Maass layers as decomposition of "chapter purpose," not replacement.

---

## What this artifact does NOT recommend

Following CLAUDE.md's strategic-constraints discipline:

- No new SFT or fine-tune work. All recommendations work with existing model routing (DeepSeek V4 Flash + existing prompt cache).
- No new checker blockers in production paths. All new checks ship as warning-class diagnostics first; promotion to blocker requires an oracle-calibrated panel per CLAUDE.md.
- No expansion of UI surface. R2/R6/R10 are post-draft validators that emit `editorial_flag` envelopes consumed by existing review surfaces.
- No replacement of beat-grain adherence. Scene-first migration (L095-L098) continues per existing lane plan; these recommendations integrate at chapter-grain.

---

## Sources

Web research:

- [Plottr — 24 Chapter Novel Outline (Derek Murphy)](https://plottr.com/24-chapter-novel-outline/)
- [Plottr — Romancing the Beat Template (Gwen Hayes)](https://plottr.com/romancing-the-beat-template/)
- [Plottr — Cozy Mystery Plot Template](https://plottr.com/cozy-mystery-plot-template/)
- [StoryTellingDB — Cozy Mystery Beat Sheet](https://storytellingdb.com/cozy-mystery/)
- [The Book Decoder — How to Write a Cozy Mystery](https://thebookdecoder.com/how-to-write-a-cozy-mystery-complete-guide-for-2026/)
- [Mary Berman — On Romance Novel Beat Sheets](https://mtgberman.substack.com/p/on-romance-novel-beat-sheets)
- [CosmicReads — ACOTAR vs Fourth Wing Romantasy Showdown](https://www.cosmicreads.me/blog/acotar-vs-fourth-wing)
- [Save the Cat — Cracking the Midpoint: The False Victory](https://savethecat.com/about-the-beats/cracking-the-midpoint-the-false-victory)
- [Helping Writers Become Authors — Two Halves of the Midpoint](https://www.helpingwritersbecomeauthors.com/the-two-halves-of-the-midpoint-2/)
- [Helping Writers Become Authors — Two Halves of the Third Plot Point](https://www.helpingwritersbecomeauthors.com/the-two-halves-of-the-third-plot-point-2/)
- [Happy Writer — Midpoint Mirror Moment](https://happy-writer.com/midpoint-mirror-moment-novel-plotting/)
- [CrimeReads — When Time Is the Enemy: Ticking-Clock Thriller](https://crimereads.com/ticking-clock-thriller/)
- [Story Grid — Genres Have Conventions and Obligatory Scenes](https://storygrid.com/genres-have-conventions-and-obligatory-scenes/)
- [Story Grid — Story Grid Translated Into Common Writing Terms](https://storygrid.com/the-story-grid-translated-into-common-writing-terms/)
- [Story Grid — Thriller Genre](https://storygrid.com/thriller-genre/)
- [Tara Maya — What Are the Obligatory Scenes for Genre Fiction](https://taramayastales.com/2015/06/12/what-are-the-obligatory-scenes-for-genre-fiction/)
- [Brandon Sanderson — 2025 Plot Lecture #2 (Promise/Progress/Payoff)](https://www.brandonsanderson.com/blogs/blog/brandon-sandersons-2025-guide-to-plot-lecture-2)
- [Writing Excuses 16.40 — Nesting Threads in MICE Quotient](https://writingexcuses.com/16-40-nesting-threads-in-the-m-i-c-e-quotient/)
- [Karen Woodward — Outlining and Nesting MICE](https://blog.karenwoodward.org/2012/10/the-mysteries-of-outlining-and-nesting.html)
- [Learning2Grow — MICE Quotient Nesting Codes and Try/Fails](https://learning2grow.org/plot-your-novel-with-mice-quotient-and-try-fails/)
- [Nichole With An H Proofreading — Optimize Your Book for KU 2025](https://www.nicholewithanhproofreading.com/post/how-to-optimize-your-book-for-kindle-unlimited-in-2025)
- [Kindlepreneur — Calculate Series Read-Through](https://kindlepreneur.com/calculate-series-read-through/)
- [Royal Road Forums — Reader Drop Rate and Retention](https://www.royalroad.com/forums/thread/111699)
- [Darling Axe — Why Portal Fantasy Is a Tough Sell](https://darlingaxe.com/blogs/news/portal-fantasy)

Local docs (extended, not duplicated):

- `docs/research/writing-frameworks/SYNTHESIS.md` — the spine; this artifact is its delta
- `docs/research/writing-frameworks/save-the-cat.md` — STC primary
- `docs/research/writing-frameworks/maass-breakout.md` — Maass primary
- `docs/research/writing-frameworks/sanderson-lectures.md` — Sanderson primary
- `docs/research/writing-frameworks/litrpg-progression.md` — LitRPG primary
- `docs/research/writing-frameworks/story-grid-coyne.md` — Coyne primary
- `docs/research/writing-frameworks/holly-lisle.md` — Lisle primary
- `docs/research/writing-frameworks/snowflake-ingermanson.md` — Snowflake primary
- `docs/method-packs/commercial-fantasy-adventure-v1.md` — current method-pack charter
- `docs/authoring-methodology-hypotheses.md` — H1-H12 hypothesis bank
- `docs/current-state.md` — live architecture
- `CLAUDE.md` — strategic constraints

