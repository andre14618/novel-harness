# LitRPG / Progression Fantasy — Craft Framework for the Novel Harness

**Status:** Research synthesis, 2026-04-29.
**Audience:** Novel-harness contributors deciding planner constraints, beat-prompt requirements, and checker rules for the LitRPG / progression-fantasy niche.
**Scope:** Modern LitRPG (with explicit system mechanics), Western progression fantasy (no system but explicit power tiers), and Eastern cultivation / xianxia. Dungeon-core and kingdom-builder sub-flavors covered as variants.

There is no canonical Trubys-of-LitRPG handbook. This document synthesizes from author craft posts (Andrew Rowe, Will Wight), reader-community consensus (Royal Road forums, r/ProgressionFantasy, LitRPG forums), and structural analysis of reference works (*Cradle*, *Dungeon Crawler Carl*, *He Who Fights with Monsters*, *Mother of Learning*, *The Wandering Inn*, *Beware of Chicken*, *Defiance of the Fall*, *The Primal Hunter*, *I Shall Seal the Heavens*).

The harness's three-layer architecture (Planning / Writing / Checking) maps cleanly onto the genre. The genre's load-bearing artifact is the **power-progression curve**: a quantified, monotonic, gated trajectory the protagonist follows from chapter 1 to series end. The planner must encode it; the writer must dramatize it; the checker must verify it.

---

## 1. Genre summary and reader expectations

### 1.1 Why this genre is commercially distinctive

LitRPG and progression fantasy are the dominant growth genres on Royal Road and Kindle Unlimited (KU) — they monetize *serial pacing* in a way traditional epic fantasy does not. Three structural facts drive the economics:

1. **Royal Road → KU pipeline.** Authors web-serialize on Royal Road (free, daily-to-weekly chapter drops, 2k–4k words each), build a follower base, then publish completed arcs to KU as 100k–200k-word "books." KU's per-page-read royalty rewards long, binge-readable text — exactly what serialized progression produces. Royal Road forum consensus: 1.5k–3.5k words per chapter is the engagement sweet spot; 2k–3k is most common; sub-1k chapters of "half blue screens" are punished. Successful series push 100k+ words per "book" with 120k–200k cited as the KU-ready range, up to 300k as the soft ceiling. Multi-book series are the norm (*Cradle* is 12 books, *Defiance of the Fall* and *The Primal Hunter* are double-digit ongoing).
2. **Daily-chapter cadence.** Top Royal Road performers post daily or 5x/week. The first chapter has roughly **one paragraph to hook**, the first chapter to anchor a reader, and the first 5–12 chapters to convert a reader into a habitual returner. Below ~75% chapter-1-to-2 retention, the story is structurally broken in the eyes of community advice.
3. **Repetition with variation as a feature, not a bug.** The genre's reader contract is *predictable rhythmic reward*. A smooth incremental progression "doesn't give the endorphin rush" — instead, readers want jump-cuts where last week's threat is now trivial. This is the "numbers go up" dopamine loop, and it is the genre's entire commercial moat. Literary fiction discourages predictability; progression fantasy *requires* it.

### 1.2 The reader contract — what every chapter owes

A LitRPG / progression-fantasy chapter must deliver some non-empty subset of:

- **Visible power growth** — a stat, skill, technique, or resource has measurably advanced, OR the protagonist has unlocked a new option, OR the gap between the protagonist and a previously-threatening adversary has visibly closed.
- **Competence porn** — the protagonist applies what they have to win at something (combat, crafting, social, intellectual), and the reader feels superiority by proxy.
- **System mastery beats** — the protagonist understands their toolkit better than they did last chapter (a synergy realized, a build optimized, a rule exploited).
- **Forward promise** — at least one new chekhov-stat, chekhov-skill, or chekhov-tier is named, escalating the next-chapter expectation.

If a chapter delivers none of these — even a great character chapter — Royal Road comments will register it as filler. This is the most important difference from literary craft: in this genre, **growth is the unit of plot.**

---

## 2. Subgenre taxonomy

The harness should treat these three as distinct routing targets, each with different obligatory beats and checker rules.

### 2.1 LitRPG (with explicit system)

A diegetic game system is present in-world: stat blocks, skills with names and descriptions, system-message text boxes, levels, classes, quest log, and so on. The system is observable to the protagonist and usually to other characters; it is the load-bearing supernatural element.

Sub-flavors:
- **System apocalypse** — the system arrives on contemporary Earth, abruptly forcing humans into level-up survival. Reference works: *Defiance of the Fall*, *The Primal Hunter*, the entire "blue-box-Earth" subgenre on Royal Road.
- **Isekai-into-system** — protagonist is transported (death, summoning, VR-trap) into a pre-existing system world. Reference: *He Who Fights with Monsters* (Jason transported to a cultivation-LitRPG world).
- **Native-system** — characters live inside the system from birth; it is just how the world works. Reference: *The Wandering Inn* (every sapient being has a class and skills).
- **Dungeon-core / dungeon-as-protagonist** — the dungeon is a system-administered entity; *Dungeon Crawler Carl* combines this with system-apocalypse-game-show.

Obligatory beats LitRPG owes that progression fantasy does not:
- A **system-introduction** scene (typically chapter 1–3) where the system "speaks" to the protagonist for the first time.
- A **first stat-screen reveal** scene.
- **Class / path selection** scene (often chapter 2–6).
- Periodic **level-up** scenes with the system speaking.

### 2.2 Progression fantasy (without system)

No diegetic stat blocks; power is tiered and named, but it is not "gameified." Cultivation is the dominant flavor. References: *Cradle*, *Mother of Learning* (a magic-school progression with explicit ranks but no blue boxes).

The protagonist's progression must still be **explicit, named, and quantifiable** — readers must know what tier the protagonist is at and what the next tier is. The difference from LitRPG is that the system stays diegetic to the world's metaphysics, not to a UI.

Obligatory beats progression fantasy owes:
- A **tier hierarchy reveal** (often a sage-mentor exposition) early.
- **Breakthrough scenes** at each tier transition, dramatized as physical-spiritual transformation.
- **Bottleneck scenes** where the protagonist hits a wall and must find a new technique, insight, or resource to advance.

### 2.3 Cultivation / xianxia (Eastern progression)

A specialized form of progression fantasy with conventionalized tropes from Chinese web-serial xianxia (*I Shall Seal the Heavens*, *A Will Eternal*, *Coiling Dragon*). The realms are typically named and tribulation-gated, the social structure is sect-and-clan, and a specific trope vocabulary applies (see §6.6).

Distinctive obligatory beats:
- **Heavenly tribulation** at major realm transitions — lightning, divine fire, conceptual attacks. Surviving = power-up.
- **Face-slap scenes** — arrogant young master humiliates protagonist, protagonist later returns, dominates, humiliates back.
- **Sect-trial / sect-tournament arcs** — periodic competitive structures.
- **Treasure / pill-acquisition arcs** — resources gate progression as much as effort does.

The harness should let the seed pick one of {with-system, no-system-Western-progression, no-system-Eastern-cultivation}, and route to different obligatory-beat templates.

---

## 3. Concept-phase prescriptions

The concept phase must produce **a system specification** alongside the usual world / character / plot. This is the new artifact LitRPG-mode needs.

### 3.1 System design (for LitRPG mode)

A LitRPG system is not flavor — it is **the magic system, the genre rulebook, and the secondary protagonist** all at once. Sanderson's three laws apply with extra force here:

- **First Law: ability to solve conflict with magic ∝ how well the reader understands it.** In LitRPG this is non-negotiable — readers expect to follow the math. Stat blocks are first-law architecture.
- **Second Law: limitations > powers.** A system without sharp limits (mana caps, cooldowns, opportunity costs, level gates, class exclusivity) produces unsatisfying progression. The **constraint** is what makes the next breakthrough feel earned.
- **Third Law: expand before you add.** Will Wight's Cradle discipline: each book deepens an existing power (Lindon's iron body, then his soulsmithing, then his refinement, then his hunger madra) before introducing a wholly new axis. New axes are reserved for tier transitions.

A good harness-generatable system spec includes:

1. **Power-source name and metaphysics** — madra, ki, mana, system points, essence.
2. **Quantification axes** — stats, attributes, skill ranks, mana pool, etc. 3–7 is the comfort range; over 10 makes the page noisy.
3. **Acquisition rules** — how does power increase? Combat? Meditation? Resource consumption? Quest rewards? Multiple sources per axis is the norm.
4. **Spending / opportunity-cost rules** — what does using power cost? A skill cooldown, mana, durability, body damage, lifespan, karma?
5. **Class / path / build rules** — can the protagonist mix paths? Lock in? Re-spec? Build identity is reader-engagement gold.
6. **Loopholes and exploit zones** — the *Cradle* "pure madra" trick, *Defiance of the Fall*'s essence-dao hybrid, *DCC*'s timing exploits. These are *features*. Sanderson's First Law says exploits = puzzle-box payoffs.
7. **The system's voice and personality** (LitRPG only) — see §5.2.

### 3.2 Power-progression curve — the canonical artifact

Every progression-fantasy seed must declare a **named tier ladder**. The *Cradle* canonical ladder is the reference architecture:

> Copper → Iron → Jade → Gold → Truegold → Underlord → Overlord → Archlord → Sage → Herald → Monarch

For each tier, the seed must specify three properties (this is the harness contract):

| Property | Question it answers |
|---|---|
| **Differentiator** | What is *qualitatively* different at this tier vs. the one below? (Iron body → physical durability; Jade → elemental affinity; Gold → core formation.) |
| **Gate** | What unlocks advancement? (Foundation completion + insight + resource? A specific trial? A breakthrough manual?) |
| **Risk** | What is the cost of attempting and failing? (Crippled meridians? Lost decade? Death? Demotion?) |

The harness can encode this as a `progressionLadder: Tier[]` field in `establishedFacts`, with downstream checkers verifying that:
- The protagonist's current tier is consistent across chapters.
- Tier advancements happen at structurally appropriate beats.
- The risk side of the ladder is honored at least once (someone the protagonist knows fails the trial — concrete cost made visible).

### 3.3 Origin / identity — the starting weakness

Every successful progression-fantasy protagonist starts with a **public, specific, painful inadequacy** that the system or magic cannot trivially fix:

- Lindon (*Cradle*) is **Unsouled** — born without affinity, the worst possible test result.
- Carl (*DCC*) is a **divorcee in his underwear**, no class, no plan, with a cat.
- Jason (*HWFWM*) is a **white-collar Australian** from a non-magical world.
- Zorian (*MoL*) is the **second son**, dismissed and overlooked, with mediocre baseline talent.
- Meng Hao (*ISSTH*) is a **failed scholar**, emphatically not a chosen-one prodigy.

This starting weakness has three functions:
1. **Quantitative space to grow.** A protagonist already at tier 5 has only 6 tiers left.
2. **Reader identification.** Readers project onto the underdog; competence porn doesn't pay off if the protagonist started competent.
3. **Trope inversion budget.** Most cultivation novels promise "humble origin reveals legendary lineage." Genre-savvy authors either play this honestly (Lindon's bloodline thread) or invert (*Beware of Chicken*'s Jin Rou refuses the trope entirely and farms instead).

The concept phase should emit an **`originDeficit`** field — a one-line public weakness — alongside ambition (what tier the protagonist swears to reach) and personality (genre-typical: persistent, calculating, ruthless when needed; *not* the noble-knight archetype).

### 3.4 World tier structure: soft, hard, tier-skipping

- **Soft tiers:** *The Wandering Inn* — levels exist but their meaning is genre-loose; level 30 vs 40 isn't a clean fight predictor.
- **Hard tiers:** *Cradle*, *HWFWM* — a Gold-rank vs Iron-rank fight is decided before it begins absent unique advantages.
- **Tier-skipping:** the protagonist defeats opponents one or more tiers above. Almost universal in cultivation; tightly budgeted in Wight (Lindon almost never wins straight up against a higher tier without leverage).

Soft tiers give writer freedom; hard tiers give reader trust. The harness should record the world's tier-strictness (soft/hard) and the protagonist's tier-skipping budget per book (e.g., "may defeat one tier above with leverage; may not defeat two tiers above without unique cheat").

---

## 4. Planning-phase prescriptions

### 4.1 Arc structure — one major advancement per book

Will Wight's discipline, near-universal in published progression fantasy:

> **One major tier advancement OR one major system-discovery per book, plus several minor (skill, technique, sub-stat) advancements throughout.**

*Cradle* book 1 (*Unsouled*): Lindon goes from Foundation → Copper. *Soulsmith* (book 2): Copper → mid-Iron + soulsmithing axis unlocked. Each book is structurally a **single tier transition**, decorated with sub-advances. Web-serial works that release in book-shaped chunks (*Defiance of the Fall*, *Primal Hunter*) follow the same shape.

The harness's planner should:
1. Read the seed's `targetTier` (start tier and end tier for this book).
2. Place the **single major breakthrough beat** in the back third of the chapter skeleton (typically chapters N-3 through N-1 of an N-chapter book).
3. Allocate 3–5 **minor advancement beats** spread across the book, each tied to a different sub-system (a skill, a technique, a relationship, a resource cache, a build optimization).
4. Reserve chapter N (the last) for either a **payoff scene** (the new tier solves the inciting problem) or a **next-book hook** (a problem the new tier *can't* yet solve, plus a new tier teased above).

### 4.2 Power-creep budget per book

A budget the harness can enforce as a planning constraint:

| Resource | Budget per book |
|---|---|
| Major tier advances (named ladder) | 1 |
| New skills/techniques unlocked | 3–6 |
| New resources / artifacts acquired | 1–3 |
| New relationships of plot-significance | 1–3 |
| Fights that establish protagonist as a tier-above-threat | 1–2 (climactic) |
| Fights that establish protagonist as currently outmatched | 1 (early/mid book) |

Going over budget is the dominant failure mode — books that grant the protagonist three new techniques, a tier advance, a god-tier artifact, and a harem in 100k words leave the next book with nothing to do. The harness can hard-fail planning if the budget is exceeded.

### 4.3 Promise / Progress / Payoff at progression scale

Sanderson's plot framework is *especially* applicable here because progression fantasy literalizes the framework:

- **Promise** — "I will reach Gold," "I will avenge my mother," "I will learn the Forbidden Sword Technique." Promises are explicit declarations by the protagonist, often in the first 10% of the book. The harness can extract these declarations as a structured **PromiseRegistry**.
- **Progress** — every chapter must show movement on at least one promise. *Visibility of progress is the #1 reader-retention driver.* "Made progress on technique X" → measurable: stat increment, skill level-up, training session that named what was learned.
- **Payoff** — the promised event happens, in the right book, with surprise-but-inevitable shape. A skill named in chapter 3 of book 1 is *expected* to be used decisively in book 1's climax; if not, it's a debt carried forward and tracked.

### 4.4 The level-up cadence

LitRPG-mode specific. Successful series have a roughly regular level-up cadence — readers expect a stat-update beat at predictable intervals, typically:

- **Early book / low-level phase:** every 2–4 chapters. Levels are cheap, the protagonist is grinding, dopamine is fast.
- **Mid book / mid-level phase:** every 5–8 chapters. Levels are work; tribulations and trials gate them.
- **Late book / pre-tier-break phase:** every 10–15 chapters. Levels are hard; the protagonist may stagnate while gathering insight or resources.

Within a tier, the curve is roughly geometric: each level takes more effort than the last. *Defiance of the Fall* and *Primal Hunter* both follow this shape closely. The harness's planner can treat level-up cadence as a **schedule constraint**: across N chapters within tier T, the planner must place at least floor(N / cadence(T)) level-up beats, and the level numbers must be monotonically non-decreasing.

### 4.5 System message budget — aesthetic balance

LitRPG-mode aesthetic constraint. Per Royal Road forum consensus and craft guides:

- **Per-chapter system-message budget:** 1–4 blocks for a normal chapter, up to 8 for a level-up or class-selection chapter.
- **Page coverage:** system blocks should not exceed ~15% of chapter prose.
- **Placement:** at meaningful junctures (boss kill, breakthrough, quest completion). Not after every kobold.
- **Length:** short. A stat dump should fit on a phone screen.

The harness should treat per-chapter system-message count and total system-block character coverage as planner outputs and checker inputs.

---

## 5. Drafting-phase prescriptions

### 5.1 Stat-block formatting

Stat blocks are the genre's typographic signature. They must be:

- **Visually distinct** — italic, bracketed, framed in characters (`╔═══...═══╗`), or set in a code-like fixed-width block. Royal Road authors most commonly use italics + brackets.
- **Compact** — ~5–15 lines. Long stat dumps lose readers who scroll past.
- **Differentiable** — a [Skill] block looks different from a [Quest] block from a [Level Up] block. Reader recognition is a feature.
- **Reactive** — every stat block should be paired with a one-or-two-sentence in-character reaction. Numbers without protagonist interpretation are skim-fodder.

The harness can encode the stat-block schema per-seed (which fields, which markup, which cadence) and the writer agent can be instructed to emit stat blocks via a **dedicated tag** in prose, e.g., `<system>...</system>` or a markdown fence, that the validator can parse.

### 5.2 System voice — the "second protagonist"

If the system speaks (it does in most LitRPG), it has a personality that must stay consistent:

- ***Dungeon Crawler Carl*'s system AI** is sarcastic, profane, weaponized-corporate-cheerful. "Achievement Unlocked: Borderline Sociopath."
- ***HWFWM*'s system messages** are dry, formal, bureaucratic. Quest text reads like a bank letter.
- ***The Wandering Inn*'s class system** is impassive and ceremonial. "[Innkeeper Class Obtained]" — no flavor, just the words.
- ***Defiance of the Fall*'s system** is informational, neutral, occasionally cryptic. Closer to a UI than a character.

The harness should record a **`systemVoice`** field in the seed: `{tone: sarcastic|dry|ceremonial|neutral, register: corporate|bureaucratic|mystical|terse, exemplars: [3–5 in-prose lines]}`. The drafting prompt embeds these exemplars; the validator clusters all system messages emitted across chapters and flags outliers.

### 5.3 Combat scene mechanics

The dominant question: cinematic flow vs turn-based stat impact. The genre answer is **cinematic prose with selective stat-impact moments**:

- **Default beat shape**: prose-cinematic combat (sensory, kinesthetic, in tight POV). No stat blocks during the kinetic flow.
- **Inflection moments**: skill activation (named ability invoked), critical-hit / damage-spike (stat applied to outcome), defeat (stat block summarizes XP/loot), level-up (full stat reveal).
- **Internal calculation passes**: short bracketed mental math from the protagonist — *"His Strength is at 84; mine's 91; if I burn three mana on Reinforce, the threshold flips."* This is the **interiority-of-calculation** that distinguishes progression-fantasy POV from generic fantasy POV.

The genre's biggest combat-scene craft failure is **stat-paralysis** — a fight that pauses every two paragraphs for a stat block becomes unreadable. The fix is to put stats *before* the fight (build setup) and *after* the fight (consequence reveal), with no more than one mid-fight stat reveal at the strongest inflection moment.

### 5.4 Crafting / training scenes — micro-structure

These are obligatory and have a stable shape (especially in cultivation and crafting-LitRPG sub-flavors):

1. **Resource gathering** — the protagonist acquires materials, manuals, mentor time, or solitude. Page-count: short. Often summarized.
2. **Training friction / blockage** — the first-pass attempts fail. Specific failure modes are named (the third sword form fights back, the alchemical reagent burns through the cauldron, the spell template won't compile). This is where craft authors invest character interiority.
3. **Insight beat** — the protagonist sees something differently. Often catalyzed by an outside trigger (a fight, a conversation, a piece of nature, a flashback). The "insight" is the emotional-narrative breakthrough that licenses the mechanical breakthrough.
4. **Breakthrough** — the technique works, the level rises, the artifact forms. This is the dramatized moment — system messages here, not earlier.
5. **Stat-update reveal** — the new state quantified, with character reaction.

The harness can enforce this five-stage micro-structure for any beat tagged `kind: "training"` or `kind: "crafting"`.

### 5.5 POV constraints

Almost universally **tight 3rd person limited or 1st person**, with heavy interiority weighted toward:

- **Calculation** — the protagonist actively does math/comparison/build-planning in-text.
- **Plans** — multi-step strategies the protagonist articulates internally.
- **System mastery** — the protagonist names their resources, options, and constraints.
- **Self-talk on goals** — promises restated, costs reckoned, ambitions sharpened.

Multi-POV exists (*The Wandering Inn* is the master class — pirateaba shifts among Erin, Ryoka, Numbtongue, the Antinium, etc.). The genre tolerates it well because each POV is its own "build" the reader is curious about. However the harness should default to **single-POV-per-chapter with planned occasional POV swaps** rather than free POV-hopping, to keep the planning layer's per-chapter character-state model coherent.

The **interiority-of-calculation** style (Zorian in *MoL* is the canonical example) should be encoded as a writer-prompt instruction: "the POV character must think in terms of resources, options, and trade-offs at least twice per beat where strategy is relevant." Without this, generic LLM prose drifts toward heroic-emotive interiority that reads off-genre.

---

## 6. Validation / checker prescriptions

The genre's structural properties give us **deterministic checkers** that traditional fantasy doesn't enable. This is where the harness can offer real value over a generic LLM writer.

### 6.1 System consistency checker

Once a stat exists, it must be tracked. Once a rule is established, it must hold. The harness already has a **world-bible / `establishedFacts`** primitive — extend it with:

- **`stats` table** — every stat the system has named, with type, range, and current value.
- **`skills` table** — every skill named, with level, cost, cooldown, last-used chapter.
- **`systemRules` table** — every rule the system has stated ("level cap is 99", "you cannot have two classes", "mana regenerates at 1/sec").

The checker (`system-consistency-checker`) runs at end-of-chapter, parses all system blocks emitted, and verifies:
- No stat decreased without a stated cause.
- No skill was used at a level it doesn't have.
- No rule was violated.
- No stat has been promoted ("Strength: 50") and then forgotten (no further mention for 30 chapters).

### 6.2 Power-creep monotonicity check

The protagonist's **named tier** and **headline stats** should be monotonic non-decreasing across chapters within a book, modulo explicit cost events. The checker is mechanical:

- For each tracked stat S: assert S(chapter N+1) ≥ S(chapter N), OR a `costEvent` was recorded in chapter N+1 explaining the decrease (cripple, sealing, exhaustion, equipment loss).
- For tier T: assert tier transitions only happen at planner-designated breakthrough beats; assert no demotion without explicit demote-event.

This is the genre-equivalent of the harness's existing world-bible consistency check, but specialized for quantified power.

### 6.3 Promise / payoff tracker

A **PromiseRegistry** populated during planning and updated during drafting:

- A planner-extracted list of *named* promises ("will learn fireball", "will reach Gold", "will avenge mother", "will defeat young master Liu").
- Each promise has: declaration chapter, expected payoff window (this book / next book / series finale), payoff status (pending / partial / paid / broken).
- An end-of-arc checker asserts all "this book" promises are paid or explicitly carried (with author-acknowledged debt).

Genre-specific: a promise of *learning* a skill is paid when the skill is *used decisively* in a fight, not just unlocked. The harness can encode this two-stage payoff (unlock → decisive-use) as the default for skill promises.

### 6.4 Numbers-go-up monotonicity

A specialization of §6.2 focused on **the protagonist's headline progress signal** — the number the reader is tracking. In LitRPG, this is usually "level" or "core stat." In progression fantasy, it's the **named tier**. The harness can:

1. Extract the headline-progress signal from each chapter (parse stat blocks; named-tier mentions).
2. Plot the trajectory across chapters.
3. Flag any non-monotone segment without an annotated cost-event.
4. Flag long flat segments (>15 chapters with no progress, no insight, no skill unlock) — reader-retention failure shape.

### 6.5 System leak detection

System messages emitted in chapter N must not contradict prior system rules. Implementation: maintain a **system-rules accumulator** during drafting; on each new system block, run a small checker LLM call that asserts "this message is consistent with the accumulated rules." Cross-checks:

- Same skill, same name, same description.
- Damage formulas / stat formulas don't drift mid-book.
- Class restrictions stated in chapter 3 still hold in chapter 30.
- The system's **voice** (tone/register) doesn't drift — already covered by the system-voice clusterer (§5.2).

### 6.6 Cliché / genre-trope detection

The genre runs on tropes; the question is whether they're *deployed* tropes (deliberate, owned) or *fallen-into* tropes (accidental, sloppy). The harness can detect and tag:

| Trope | Deployed marker | Failure marker |
|---|---|---|
| **Humble origin / hidden lineage** | Setup chapters explicitly stake the protagonist as ordinary; reveal lands at structural turn. | Lineage revealed chapter 1 ("turns out my mom was the Sword Empress!"); no underdog phase. |
| **Trash technique that's actually OP** | Named limitation explained; protagonist does narrative work to discover the loophole. | Loophole shows up free, no setup, no cost. |
| **Broken cultivation / system bug** | Cost stated; system itself reacts (system warnings, oversight figures); other characters comment. | No cost; protagonist exploits silently and other characters never notice. |
| **Young master face-slap** | Young master is given motive, agency, and a return appearance; humiliation is earned. | One-scene cardboard antagonist insulted and dispatched in three pages. |
| **Power-up via near-death** | Tribulation framed and named; cost is paid. | Random injury → random level-up. |
| **Mentor-dies-to-grant-power** | Mentor has page-time and relationship; death has consequences. | Mentor is named in one scene and dies in the next. |
| **Harem / love-triangle inflation** | Each romantic interest has POV-tested distinct characterization. | New named-female-character per arc with no plot relevance. |

The checker's job is *not* to forbid tropes — they are reader contracts — but to ensure they are deployed with full setup-cost-payoff structure. A planner constraint can require: "if trope T is invoked, the planner must have placed a setup beat ≥3 chapters earlier and a cost beat within 2 chapters."

The cultivation-specific trope corpus from r/ProgressionFantasy and xianxia analyses (face-slap, young master, sect tournament, treasure / pill pickup, breakthrough tribulation, hidden bloodline, grand-elder-betrayal) can be encoded as a **trope library** the planner samples from per-arc, with each trope carrying its own setup-cost-payoff contract.

---

## 7. Royal Road / serial pacing prescriptions

### 7.1 Chapter cadence

- **Target chapter length:** 2,000–3,500 words (Royal Road sweet spot).
- **Variance:** keep individual chapters within ±30% of the target. Wildly variable chapter lengths break habit-formation.
- **Per-book chapter count:** for KU 100k–200k books, 35–80 chapters at the 2k–3.5k target range.

### 7.2 Cliffhanger discipline

The end-of-chapter beat is the genre's load-bearing **return-driver**. Per the cliffhanger craft consensus:

- **Don't cliffhanger every chapter.** Reader desensitization is real ("Boy Who Cried Wolf" effect).
- **Hard cliffhangers** at act turns (book quarter / half / three-quarters / climax). 4–6 per book.
- **Soft hooks** every chapter — an unanswered question, a new variable introduced, a forward-promise restated.
- **End on motion, not stasis.** Even non-cliffhanger chapters should end with the protagonist starting something, not finishing.

The harness can encode chapter-ending shape as a planner constraint: each chapter's last beat must be tagged `endShape: hard-cliff | soft-hook | motion-turn`, with the planner enforcing a distribution across the book.

### 7.3 Reader retention beats

- **Chapter 1: hook in paragraph 1.** The opening must contain a question, a threat, a system event, an off-balance protagonist, or a strong voice. Royal Road retention data: chapter-1-to-2 drop is the largest single drop in any series; getting it under 25% is the difference between viable and DOA.
- **Chapters 1–5: establish the genre contract.** By chapter 5, the reader must know: the genre (LitRPG / progression / cultivation), the protagonist's deficit, the system-or-tier-ladder, and the central promise.
- **First 50k words: pay off something concrete.** A first promise paid (level reached, technique mastered, antagonist beaten) within 50k words anchors readers; series that don't pay anything in 50k bleed readers.
- **Chapter 1 system arrival shape (apocalypse-LitRPG):** the dominant pattern is *mundane scene → catastrophic event → first system message*. Reference openings: *Defiance of the Fall*, *Primal Hunter*, countless Royal Road copies. The harness's apocalypse-flavor seed can templatize this.

---

## 8. Programmatic levers — concrete, implement-this-week

This is the heaviest section because this is where the harness can offer measurable value. Each lever is concrete enough to schedule as a ticket.

### Concept-phase levers

1. **Add `systemSpec` to `SeedInput` for LitRPG-flavored seeds.** Fields: `powerSourceName`, `quantificationAxes[]`, `acquisitionRules[]`, `spendingRules[]`, `pathOptions[]`, `loopholes[]`. The planner reads it; the writer's primer embeds 3–5 in-prose exemplars; the validator parses system blocks against the spec.
2. **Add `progressionLadder: Tier[]`** to `establishedFacts`, where each `Tier = {name, differentiator, gate, risk}`. Planner reads the protagonist's start tier, target end tier; checker verifies tier monotonicity.
3. **Add `originDeficit` and `protagonistAmbition`** as required fields for fantasy/litrpg seeds. Concept-phase agent emits both; planner uses both as the book's structural anchors.
4. **Add `worldTierStrictness: "soft" | "hard"`** and `tierSkippingBudget` to the world-bible. Combat planning consults this to gate fights against higher-tier enemies.
5. **Add `systemVoice: {tone, register, exemplars}`** for LitRPG seeds. Sample exemplars curated per-system-flavor (sarcastic-DCC, dry-HWFWM, ceremonial-Wandering-Inn, neutral-DotF).

### Planning-phase levers

6. **Per-book power-creep budget enforcement.** The planner takes a `creepBudget` config (one tier advance, 3–6 skills, 1–3 artifacts, etc.) and the planning checker rejects skeletons that exceed it.
7. **Single-major-breakthrough placement constraint.** Major tier advance must be placed in chapters [N - 3, N - 1] of an N-chapter book. Hard planner constraint.
8. **Level-up cadence schedule.** Given protagonist's tier and book-position, planner enforces minimum level-up beat density per phase (early/mid/late).
9. **PromiseRegistry extraction at planning time.** A small LLM call after concept emits a list of `{promise, declaration_chapter, expected_payoff_window}`. End-of-arc checker validates closure.
10. **Per-chapter `endShape` tagging.** Every chapter in the skeleton tagged `hard-cliff | soft-hook | motion-turn`. Planner enforces a distribution (hard-cliffs at quarter / half / three-quarter / climax; soft-hooks otherwise).
11. **Trope library as planner-samplable items.** Each trope (face-slap, breakthrough-tribulation, young-master, treasure-pickup, etc.) carries a setup-cost-payoff contract. Planner can sample one trope per arc; trope contract dictates required beats.
12. **Training/crafting micro-structure as a beat-template.** Beats tagged `kind: "training"` or `kind: "crafting"` expand into the five-stage micro-structure (gather / friction / insight / breakthrough / reveal). Drafting agent receives the micro-structure as constraint.
13. **Per-chapter system-message budget** as a planner output and a writer-prompt input. Constrains writer to N system blocks for this chapter.

### Drafting-phase levers

14. **Stat-block schema and dedicated tags.** Writer emits stats inside `<system>...</system>` tags (or markdown-fenced `system` blocks); a parser extracts them; system-block prose is excluded from prose-quality checkers and routed to system-consistency checkers.
15. **System-voice exemplars in writer primer.** 3–5 short in-prose system messages embedded in primer; writer matches tone for new system blocks.
16. **Interiority-of-calculation prompt requirement.** Writer prompt for strategy beats explicitly requires the POV character to think in terms of "resources, options, trade-offs" at least twice per beat. Generic LLM prose drifts to emotive interiority without this.
17. **Combat-scene stat-impact discipline.** Drafting agent for combat beats receives an explicit constraint: stat blocks only at fight start (setup), fight inflection (1 max), fight end (consequence). Mid-fight calculations are interiority, not blocks.
18. **Per-system-block reaction-pairing constraint.** Every emitted system block must be followed by ≥1 sentence of in-character reaction. Writer prompt enforces; lint checker verifies.

### Checker-phase levers

19. **`system-consistency-checker` agent.** Per-chapter checker that parses all system blocks, accumulates stats/skills/rules into a running registry, and asserts no contradictions across chapters. Emits issues as `{rule, chapter_violated, evidence}`.
20. **Stat-monotonicity checker.** Compares headline-progression signal (level / tier / core stat) across chapters; flags any non-monotone segment without a recorded cost-event.
21. **`promise-payoff-tracker` agent.** Reads PromiseRegistry; asserts `this-book` promises are paid or carried with author acknowledgment; emits unpaid-promise warnings at end-of-arc.
22. **System-voice clusterer.** Embeds all system messages emitted across chapters; clusters; flags messages that fall outside the dominant cluster as voice-drift candidates. Cheap LLM call to confirm.
23. **Trope deployment checker.** When a trope tag is invoked in a beat (e.g., `face-slap`), checker verifies the setup-cost-payoff contract was placed; emits issues if (e.g.) the young master shows up only once.
24. **Cadence-flat-spot detector.** Scans chapter-by-chapter progression-signal; flags >15-chapter flat spots as reader-retention warnings to the planner for next iteration.
25. **System-message budget enforcer.** Counts system blocks per chapter and total prose coverage; flags chapters that exceed the planner-allocated budget.

### Pipeline / pacing levers

26. **Royal-Road-shape chapter-length checker.** Asserts chapter word counts within target ±30% of the configured target; flags wildly off-target chapters for re-plan.
27. **Chapter-1-hook checker.** A small LLM call: "does the first paragraph contain a hook (question, threat, system event, voice)?" Critical for any seed flagged for serial release.
28. **Genre-contract checker (chapters 1–5).** By end of chapter 5, the prose must have established: genre, deficit, system-or-tier, central promise. Single LLM call.
29. **First-50k-words payoff checker.** At end of chapter ~16, assert at least one of: a level reached, a technique mastered, an antagonist beaten, a tier ascended. Otherwise raise reader-retention warning.
30. **`systemArrival` opener template** for apocalypse-flavor seeds. Concept→planning emits an opening chapter shape: mundane → catastrophe → first system block. Drafting agent receives this as a beat-template constraint.

---

## 9. Reference works analyzed

### *Cradle* (Will Wight, 12 books) — the western progression-fantasy reference

**Structural patterns from book 1, *Unsouled*:** Lindon starts as the worst possible test result (Unsouled, no path-affinity), introduced via the magical aptitude ceremony where his deficit is made *publicly humiliating*. The book moves him from Foundation to Copper — the very first rung of the named ladder. Tier transition is positioned in the back third. The central promise — to leave Sacred Valley and seek power — is set up by an outside event (Suriel, the post-credits scene that pre-promises the entire 12-book arc). The book's payoff is partial (Copper, not Iron) but anchors the next book's promise.

**From book 2, *Soulsmith*:** Lindon advances from Copper → mid-Iron, but the *book's* contribution is unlocking the **soulsmithing axis** — Wight's discipline of "expand existing power before adding new" is here as the meta-axis (madra) is deepened with a craft sub-system rather than a wholly new magic.

**The 12-book ladder** (Foundation → Copper → Iron → Jade → Gold → Truegold → Underlord → Overlord → Archlord → Sage → Herald → Monarch) is the **canonical reference** the harness should embed as a default `progressionLadder` for Western progression seeds.

**Wight's craft principles (per his published interviews / podcast):** obligatory scenes are the weakness-establishment scene, the magic-system-figuring-out scene, the magic-fights, and the "Clown in a Bottle" scene (a personal-naming for a setup-payoff trick). Books are deliberately lean — minimal worldbuilding indulgence, maximum forward motion. Six-month release cadence keeps reader habit alive.

### *Dungeon Crawler Carl* (Matt Dinniman) — system voice, dark-comedy register

**System voice** is the standout craft asset — sarcastic, profane, weaponized-corporate-cheerful. The system AI is a *character*, not a UI. Achievement names are punchlines. This is the reference for the harness's `systemVoice` field. Dinniman writes specifically for audio (Jeff Hays narration), which shapes voice density and dialogue-vs-prose balance — useful context if the harness ever optimizes for audio-secondary release.

**Arc structure** is per-floor: each floor is a tonal unit with a boss, a mechanic, a death toll, a stat-and-class progression for Carl, and a setup-payoff contract that resolves on floor exit. The harness's "arc" abstraction can model these.

**Revision discipline** — Dinniman has stated he writes ~800k words for a 270k-word book; the harness's role isn't to replicate that but to acknowledge that aggressive cut-and-revise is the genre's quality lever.

### *He Who Fights with Monsters* (Shirtaloon) — explicit tier-system clarity

**Rank ladder** (Iron → Bronze → Silver → Gold → Diamond → Transcendent) is rigorously enforced. Diamond is mortal-peak-ageless; Transcendent is god-tier. Ranks have **lifespan implications** (Gold lives ~500 years, Diamond is ageless) — a clean example of the third "Risk" property of each tier carrying *positive* meaning, not just downside cost. Useful seed-design pattern: tier perks beyond raw power.

**System voice is dry-bureaucratic** — quest text reads like formal bank correspondence. Useful as a contrast exemplar to DCC's sarcastic register.

**Progression bottleneck:** at Gold, monster-killing is no longer the primary advancement path; "essence revelations" (insight-type breakthroughs) replace grind. Worth encoding: late-game tier transitions require *qualitatively different* advancement mechanics than early-game.

### *Mother of Learning* (nobody103) — time-loop structural innovation

**The time loop is the structural device that licenses arbitrary skill-acquisition density.** Zorian re-runs a one-month loop hundreds of times; "every loop covered something new" so the structure isn't repetitive. By chapter 86, Zorian has lived ~8 years of subjective time and his skills have grown roughly exponentially.

**Craft lesson for the harness:** time-loop and similar structural conceits *unlock* training-dense narratives that linear time can't sustain. If a seed flags `structuralConceit: time-loop`, the planner can generate dramatically denser per-chapter skill-acquisition without breaking pacing.

**Interiority shape:** Zorian is the canonical example of *calculation-heavy* progression-fantasy POV. He thinks in terms of inventory, time-budget, opportunity cost. This is the reference register for the §5.5 interiority-of-calculation requirement.

### *The Wandering Inn* (pirateaba) — multi-POV class-system progression

**POV-multiplying** is the structural innovation — the central "system" is a class system every sapient has, so every POV is a fresh build the reader can engage with. Erin → Ryoka → Numbtongue → Antinium → Klbkch — each POV is a different class, a different progression curve, a different reader-engagement axis.

**Craft asset for the harness:** if the seed wants long-form (200k+) and reader-retention via POV-rotation, the class-system-makes-every-POV-a-build pattern is the proven shape. Each POV's progression budget can be tracked independently.

**Caveat:** pirateaba publishes a first-draft serial (10k-word chapters, 2x/week) — quality is uneven on purpose, traded for cadence. The harness's quality bar is higher than that, so don't import the editing-discipline shape; do import the structural shape.

### *Beware of Chicken* (CasualFarmer) — subversion / lifestyle progression

**Subversion model:** the protagonist transmigrates into a cultivation world and *refuses to play the game*. Jin Rou farms, raises animals, befriends his rooster (Bi De — who becomes a POV), and progresses incidentally and "holistically" via lifestyle rather than face-slap-and-tribulation grinding.

**Craft lesson for the harness:** **anti-tropes are tropes too.** A "Beware of Chicken-flavor" seed needs trope-awareness to *not invoke* the standard progression beats and instead invoke lifestyle / slice-of-life beats (planting, harvest, animal husbandry, festival, neighbor-help). The trope library should include both standard and subversive sets, with seeds choosing one.

### *I Shall Seal the Heavens* (Er Gen) — xianxia conventional reference

**Standard xianxia template, executed at scale.** Meng Hao is a failed-scholar protagonist (canonical humble-origin), forcibly recruited into a sect, levels through realms (Foundation, Core, Nascent Soul, Spirit Severing, Dao Seeking, Immortal, etc.), face-slaps young masters constantly, gathers treasures and pills, ascends through tribulations.

**Useful as the reference template** for what cultivation-flavor seeds should look like by default. The trope vocabulary (face-slap, young master, tribulation, sect tournament, treasure pickup, golden core) can be encoded directly from this corpus.

### *Defiance of the Fall* / *The Primal Hunter* — apocalypse-LitRPG references

Both follow the **system-arrives-on-Earth** template with cultivation-LitRPG hybrid mechanics. Useful structural references for:
- **Apocalypse opening shape** (mundane → catastrophe → first system message → hard tutorial → first level / class).
- **Path-of-power individuality** — *Primal Hunter*'s explicit "no two paths are alike" is a planner-relevant constraint: each major character should have a *different* progression axis.
- **Hybrid system + cultivation** — system levels overlay on cultivation realms; the harness can support this as a system-spec compositional pattern.

---

## 10. Web sources

These are the most useful sources synthesized in this report, organized by topic.

**Genre definition / overview**

- [Andrew Rowe — "Progression Fantasy – A New Subgenre Concept"](https://andrewkrowe.wordpress.com/2019/02/26/progression-fantasy-a-new-subgenre-concept/) — origin essay coining the subgenre.
- [Andrew Rowe — "Writing Progression Fantasy"](https://andrewkrowe.wordpress.com/2019/03/02/writing-progression-fantasy/) — author-craft principles for the subgenre.
- [Progression Fantasy & LitRPG Database — "What is Progression Fantasy?"](https://progressionfantasy.co.uk/what-is-progression-fantasy/) — community-canonical genre definition.
- [Reader's Grotto — Progression Fantasy: Top 5 series to get you started](https://www.readersgrotto.com/2021/04/20/beginners-guide-to-progression-fantasy/)

**LitRPG craft**

- [LitRPG Reads — "How to Write LitRPG: Integrating Game Systems Into Your Story Without Losing Readers"](https://litrpgreads.com/blog/litrpg/how-to-write-litrpg-integrating-game-systems-into-your-story-without-losing-readers)
- [LitRPG Reads — "Designing Believable LitRPG Mechanics"](https://litrpgreads.com/blog/litrpg/designing-believable-litrpg-mechanics)
- [Royal Road forums — "LitRPG Guide. What makes a good LitRPG"](https://www.royalroad.com/forums/thread/97990)
- [Royal Road forums — "Help with formatting: LitRPG style system calls"](https://www.royalroad.com/forums/thread/133773)
- [Royal Road forums — "My LitRPG Style Guide Thus Far"](https://www.royalroad.com/forums/thread/140370)
- [Royal Road forums — "Guide: How to make a litrpg [system]"](https://www.royalroad.com/forums/thread/120806)
- [Level Up Publishing — How to Write LitRPG](https://www.levelup.pub/how-to-write-litrpg)
- [John Champaign — "Strategies For Success Releasing LitRPG Stories On Royal Road"](https://johnchampaign.com/2024/01/29/strategies-for-success-releasing-litrpg-stories-on-royal-road/)
- [Worldbuilding Academy — "What is LitRPG? A Storyteller's Guide"](https://academy.worldanvil.com/blog/what-is-litrpg-and-how-to-write-it)
- [Campfire Writing — "What Is LitRPG? Everything You Need to Know to Start Writing"](https://www.campfirewriting.com/learn/litrpg)

**Sanderson's laws (applied to power systems)**

- [Brandon Sanderson — Sanderson's First Law](https://www.brandonsanderson.com/blogs/blog/sandersons-first-law)
- [Brandon Sanderson — Sanderson's Second Law](https://www.brandonsanderson.com/blogs/blog/sandersons-second-law)
- [Brandon Sanderson FAQ — Sanderson's Laws of Magic](https://faq.brandonsanderson.com/knowledge-base/what-are-sandersons-laws-of-magic/)
- [Brandon Sanderson — 2025 Guide to Plot Lecture #2 (Promise / Progress / Payoff)](https://www.brandonsanderson.com/blogs/blog/brandon-sandersons-2025-guide-to-plot-lecture-2)
- [Standard Story Co — "Promise, Progress, Payoff"](https://standardstoryco.com/a-simple-storytelling-formula-promise-progress-payoff/)

**Will Wight / Cradle**

- [Wizards, Warriors, & Words — Will Wight on writing progression fantasy (podcast)](https://creators.spotify.com/pod/profile/wizardswarriorswords/episodes/2-50-Writing-progression-fantasy-tips-from-Will-Wight-author-of-Cradle-e1b7ptn)
- [AC Cobble — Interview with Will Wight](https://www.accobble.com/blog/2019/5/31/interview-with-will-wight)
- [Goodreads — Cradle Series](https://www.goodreads.com/series/192821-cradle)
- [Aethon Books — Unsouled (Cradle #1) review](https://aethonbooks.com/2021/12/13/unsouled-cradle-will-wight/)

**Cultivation / xianxia tropes**

- [Wikipedia — Xianxia](https://en.wikipedia.org/wiki/Xianxia)
- [LightNovelsAI — "Top 10 Most Overused Xianxia Tropes"](https://lightnovelsai.com/blog/most-overused-xianxia-tropes/)
- [Cultivating Dragons — "Cheats, Face-Slaps & Golden Fingers"](https://cultivatingdragons.com/cheats-face-slaps-golden-fingers-the-xianxia-cultivation-trope-guide-you-didnt-know-you-needed/)
- [Xiuxian Guide — "The Art of Immortal Cultivation: A Dive into Chinese Xianxia Fiction"](https://xiuxian0.com/cultivation-methods/immortal-cultivation-xianxia-fiction/)
- [Mortykay — "What Is Xianxia? From Daoist Immortals to Kindle Bestsellers"](https://mortykay.com/blog/what-is-xianxia/)
- [Scribble Hub forum — "THE PERFECT FORMULA FOR XIANXIA NOVELS"](https://www.scribblehubforum.com/threads/the-perfect-formula-for-xianxia-novels.5141/)
- [TVTropes — Spirit Cultivation Genre](https://tvtropes.org/pmwiki/pmwiki.php/Main/SpiritCultivationGenre)

**Reference works (per-series)**

- [Wikipedia — Dungeon Crawler Carl](https://en.wikipedia.org/wiki/Dungeon_Crawler_Carl)
- [Audible — Matt Dinniman on Dungeon Crawler Carl](https://www.audible.com/blog/matt-dinniman-dungeon-crawler-carl-audio-interview)
- [He Who Fights with Monsters Wiki — Ranks](https://he-who-fights-with-monsters.fandom.com/wiki/Ranks)
- [Mother of Learning Wiki — Time loop](https://mother-of-learning.fandom.com/wiki/Time_loop)
- [TVTropes — Mother of Learning](https://tvtropes.org/pmwiki/pmwiki.php/Literature/MotherOfLearning)
- [The Wandering Inn — Pirateaba (official)](https://wanderinginn.com/)
- [Beware of Chicken Wiki — Cultivation Concepts](https://beware-of-chicken.fandom.com/wiki/Cultivation_Concepts)
- [Novel Updates — I Shall Seal the Heavens](https://www.novelupdates.com/series/i-shall-seal-the-heavens/)
- [Wuxiaworld — I Shall Seal the Heavens](https://www.wuxiaworld.com/novel/i-shall-seal-the-heavens)
- [Cosmic Coding — Review: Defiance of the Fall](https://cosmiccoding.com.au/reviews/defiance_of_the_fall/)
- [Cosmic Coding — Review: The Primal Hunter](https://cosmiccoding.com.au/reviews/primal_hunter/)
- [Abidan Archives Wiki — Ranks (Cradle)](https://abidan-archives.fandom.com/wiki/Ranks)

**Royal Road / serial pacing**

- [Royal Road Knowledge Base](https://www.royalroad.com/support/knowledgebase/83)
- [Royal Road forums — "User Retention"](https://www.royalroad.com/forums/thread/102067)
- [Royal Road forums — "Reader Drop Rate and Retention"](https://www.royalroad.com/forums/thread/111699)
- [Royal Road forums — "Words per chapter"](https://www.royalroad.com/forums/thread/116432)
- [Royal Road forums — "Average book length for Amazon?"](https://www.royalroad.com/forums/thread/128481)
- [Royal Road forums — "The Art of the Cliffhanger"](https://www.royalroad.com/forums/thread/131550)
- [Royal Road forums — "To Cliffhang or Not To Cliffhang"](https://www.royalroad.com/forums/thread/127455)
- [William Flattener (Medium) — "Royal Road for Beginners"](https://medium.com/@william.flattener/royal-road-for-beginners-answering-every-question-about-launching-your-web-fiction-f1cf0fc2e888)
- [Helping Writers Become Authors — "How to Use Chapter Cliffhangers"](https://www.helpingwritersbecomeauthors.com/chapter-cliffhangers/)
- [Carissa Taylor — "10 Types of Chapter Ending Cliffhangers"](http://carissa-taylor.blogspot.com/2015/10/10-types-of-chapter-ending-cliffhangers.html)

**Failure modes / critique**

- [SpaceBattles — "How Do You Make LitRPGs Work Without Making Them A Power Fantasy?"](https://forums.spacebattles.com/threads/how-do-you-make-litrpgs-work-without-making-them-a-power-fantasy.706561/)
- [David R. MacIver — "What is it like to read LitRPG?"](https://drmaciver.substack.com/p/psychology-of-litrpg)
- [Royal Road forums — "When Did Stats Become 'Not Enough'?"](https://www.royalroad.com/forums/thread/104488)
- [Royal Road forums — "Character growth, regression, and sticking to the premise"](https://www.royalroad.com/forums/thread/151007)

---

## 11. Limitations and failure modes

The genre's commercial strength is also its craft trap. Things to design *against*:

- **Stat-block paralysis.** When system blocks dominate prose, scrolling becomes the reader's default mode; once habituated, they skim past stat reveals — defeating the genre's core dopamine loop. Rule: stat-block coverage <15% of chapter, blocks at meaningful junctures only.
- **Level-up porn.** Numbers go up but characters do not. The most-cited critique of the genre (David MacIver, SpaceBattles, the Goodreads LitRPG forum). Specifically: a chapter satisfies the "growth is the unit of plot" rule mechanically (stats moved) but doesn't move character relationships, doesn't restate or pay promises, doesn't develop the protagonist's voice. The harness must verify *both* mechanical progression *and* the established-fact / relationship / promise-payoff dimensions per chapter, not just the former.
- **Power-creep monotony.** Every book grants new power; the protagonist becomes overpowered relative to Book 1's threats; the only way to keep stakes is to escalate the world; eventually the cosmos is at stake and the prose-level granularity of the early books is gone. *Cradle*'s late books receive this critique. Mitigation: explicit per-book creep budget (lever 6) and tier-skipping budget (§3.4).
- **Identical-rhythm fatigue.** Readers tire of the same level-up cadence, the same training-friction-insight-breakthrough loop, the same face-slap-young-master beat. Mitigation: trope library with explicit beat variation; planner samples from an *anti-trope* set occasionally; each book should have at least one **structural surprise** beat.
- **Origin-deficit erosion.** The protagonist's starting weakness becomes irrelevant by Book 3, and with it the underdog identification that anchored early reader engagement. Mitigation: track `originDeficit` and require periodic callbacks (a humbling moment, a memory, an old-friend encounter) for the first 50% of the series.
- **System-voice drift.** The system AI starts as one character, ends as another. *DCC* is a positive example (consistency over 7 books). Lever 22 (system-voice clusterer) addresses this.
- **Wandering-Inn-syndrome.** Multi-POV expansion eats the central protagonist's progression; new POVs accumulate and per-POV progression budgets are forgotten. Mitigation: per-POV progression-budget tracking; planner caps active POVs per book.
- **Subversion-without-substitution.** *Beware of Chicken*-style anti-trope works only if the substituted beats (lifestyle, slice-of-life, neighbor-help) are themselves load-bearing and emotionally engaging. A seed flagged as `subversive` must still satisfy the reader-contract chapter rule (§1.2) — just with substituted beat types.

---

## TL;DR — the five most actionable programmatic levers

The most actionable programmatic levers are: **(1) `progressionLadder` as a first-class field on `establishedFacts`** — named tiers with differentiator/gate/risk per tier, encoded once at concept time and read by every downstream agent; **(2) per-book power-creep budget enforcement at the planner** — one major tier advance, 3–6 skills, 1–3 artifacts, hard-failing skeletons that exceed it; **(3) PromiseRegistry with planner-time extraction and end-of-arc payoff verification** — names every "I will reach X / learn Y / defeat Z" declaration and tracks closure, the genre-equivalent of our world-bible for forward debts; **(4) `system-consistency-checker` plus stat-monotonicity checker** — accumulates stats/skills/rules across chapters and asserts no contradictions or unjustified regressions, the genre-natural extension of the existing world-bible consistency check; and **(5) `systemVoice` field with exemplar-driven writer prompting and a system-voice clusterer** — pins the system AI's tone (sarcastic / dry / ceremonial / neutral) at concept time, embeds 3–5 in-prose exemplars in the writer primer, and clusters emitted system messages to flag voice-drift outliers. Together these five make the LitRPG / progression-fantasy contract *machine-checkable* in a way the harness's current generic-fantasy gates do not, and they slot into existing primitives (`establishedFacts`, world-bible checker, beat-context primer) rather than requiring new infrastructure.
