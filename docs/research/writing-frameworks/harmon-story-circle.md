# Dan Harmon's Story Circle — Research Report

**Author**: research-pass-2026-04-29
**Frameworks**: Dan Harmon's Story Circle (Channel 101 / Harmontown / "Story Embryo" essays); Christopher Vogler's *The Writer's Journey* (1992/2007); Joseph Campbell's *The Hero with a Thousand Faces* (1949)
**Target encoding**: planner constraints, beat prompts, checker rules in `src/phases/{concept,planning,drafting,validation}.ts`
**Length target**: 3000-5000 words

---

## 1. Framework summary

Dan Harmon's Story Circle is a tightened, eight-position diagram of Joseph Campbell's monomyth, originally written up by Harmon on the Channel 101 wiki under the heading "Story Structure 101: Super Basic Shit" and a follow-on series ("...Down the Road," "...Let's Simplify," "...Final Battle," "...The Audience"). Harmon's claim is that Campbell described the same eight movements that Vogler later pinned to twelve stages, but Campbell and Vogler both described them in language that resists daily use at the writing desk. Harmon's response was to compress the journey to a circle — the protagonist starts at the top in a zone of comfort, descends clockwise into an unfamiliar lower half, and returns to the top a changed person. The eight positions are:

1. **You** — a character in a zone of comfort
2. **Need** — but they want something
3. **Go** — they enter an unfamiliar situation
4. **Search** — adapt to it
5. **Find** — get what they wanted
6. **Take** — pay its price
7. **Return** — come back to their familiar situation
8. **Change** — having changed

The eight points sit on a circle because Harmon's central claim is **rotational symmetry**: position N is the structural counterpart of position N+4. The circle is bisected horizontally (a "ground line" between the comfort zone above and the unfamiliar world below) and vertically (a left-half "order/known" and right-half "chaos/unknown"). Every story moves clockwise through the four quadrants. The structural insight that makes the circle useful for a programmatic harness is that the symmetry constraint is *checkable*: the location/tone/relationship at step 5 must be unfamiliar relative to step 1, the want at step 2 must rhyme with the get-with-cost at step 6, the threshold-crossing at step 3 must be re-crossed in reverse at step 7, and the search-adaptation at step 4 must be paid off as visible transformation at step 8.

For our pipeline, the Story Circle gives us a planner-level chapter-position labeling scheme and four mirror-pair invariants the chapter-plan-checker can validate cheaply. It is **not** a microtension framework (Maass owns that layer); it is a chapter-arc-shape framework. Its limitation is that it collapses for stories that are not character-arc-driven (mosaic novels, ensemble pieces with no single POV transformation, plot-puzzle thrillers where the protagonist does not meaningfully change). For LitRPG and fantasy — the harness's near-term focus — it fits cleanly, because both genres are protagonist-transformation-driven by genre convention.

---

## 2. The eight steps in detail

### Position 1 — You (zone of comfort)

The protagonist appears in their familiar world. Harmon's emphasis: "you" because the audience must locate themselves in the protagonist before any journey can be taken on their behalf. The zone of comfort does not have to be pleasant — it can be a stable misery, a numbed routine, a long-tolerated injustice. What matters is that it is *known*. The reader leaves this position knowing what the protagonist's life looked like before the story disturbed it.

In our pipeline this maps to Chapter 1 opening beats and possibly the prologue. Planner constraint: the opening chapter's `establishedFacts` should be heavy on baseline-state facts (current job, current relationships, current capability ceiling), light on inciting-incident facts.

### Position 2 — Need (want / disturbance)

A want surfaces. In Harmon's writeups this is sometimes phrased as a need the protagonist did not know they had until it was disturbed; sometimes as a conscious want already present that some new event amplifies past the threshold of action. The structural job of position 2 is to generate the engine that will drive the protagonist into the unknown half of the circle.

Position 2 is the first of the four "want" markers; positions 2, 4, 6, 8 form the protagonist's internal trajectory. Position 6 (Take) is the structural payoff of position 2: the protagonist gets what was wanted at 2, but the form in which they get it reveals a cost. The 2↔6 mirror is the most diagnostically useful pairing in the circle because it lets a checker verify that the prize at the climax is the answer to the question posed in act one.

### Position 3 — Go (cross the threshold)

The protagonist crosses out of the familiar world. In Vogler this is Stage 5 (Crossing the First Threshold). In Harmon it is the descent across the horizontal axis — comfort zone above, unfamiliar below. The threshold can be physical (geographic move, dungeon entrance, foreign country), social (joining a new group, breaking with an old one), or epistemic (learning a fact that cannot be unlearned).

The 3↔7 mirror is the cleanest physical/locational symmetry to check programmatically: whatever physical/social/epistemic threshold was crossed at position 3 should be crossed back at position 7. If position 3 was a dungeon entrance, position 7 is the dungeon exit. If position 3 was learning that magic exists, position 7 is the protagonist returning to the people who do not know magic exists, carrying that knowledge.

### Position 4 — Search (adapt)

The bottom of the circle. The protagonist learns the rules of the unfamiliar world, accumulates allies and enemies, fails and recovers. In Vogler this is Stages 6-7 (Tests, Allies, and Enemies; Approach to the Inmost Cave). In Harmon's "Final Battle" essay he emphasizes that position 4 is the longest position by page count in most stories — it is where most of the prose lives.

Position 4's mirror is position 8 (Change). The adaptations forced on the protagonist in position 4 are the seeds of the change visible in position 8. A planner constraint: the specific skills, attitudes, or relationships the protagonist *must* have at position 8 should be *being acquired* during position 4 chapters. If position 8 shows the protagonist trusting someone they previously didn't trust, position 4 must contain the trust-building scenes that make that change earned rather than asserted.

### Position 5 — Find (get what they wanted)

The protagonist gets the thing they wanted at position 2. In Vogler this is the Reward (Stage 9) following the Ordeal (Stage 8). In Harmon's circle, position 5 is directly opposite position 1, which is the deepest structural claim of the framework: position 5 should feel *as alien as position 1 felt familiar*. The location, tone, social context, and emotional valence at position 5 should mirror position 1 inverted.

A planner constraint we can encode: the tonal register of the chapter containing position 5 should diverge from the chapter containing position 1 along checkable axes (interior vs. exterior, alone vs. crowded, safe vs. dangerous, ordered vs. chaotic). If the position-1 chapter's setting is "the protagonist's small village at dawn, nothing happening," the position-5 chapter's setting should not also be "small village, dawn, nothing happening."

### Position 6 — Take (pay its price)

The protagonist gets what they wanted, and discovers what it costs. This is the structural climax of the circle's right half. The "take" here is bidirectional: the protagonist *takes* the prize, but the prize/world also *takes* something from the protagonist. Harmon's distinction from Campbell is that "take" emphasizes loss as much as gain — the boon comes pre-attached to its tax.

The 2↔6 mirror is the diagnostic pair: position 2 states the want; position 6 grants the want with its cost made legible. If position 2 was "the protagonist wants to be acknowledged by their estranged father," position 6 must contain that acknowledgment *and* the cost of having earned it.

### Position 7 — Return (cross back)

The threshold crossed at position 3 is re-crossed in reverse. The protagonist comes back to where they started, geographically/socially/epistemically. This is Vogler's Stage 10 (The Road Back) plus the early movement of Stage 11. The asymmetry that gives the position its weight is that the protagonist is no longer the person who crossed the threshold the first time — same threshold, different self.

For our pipeline, position 7 is a high-leverage chapter for the chapter-plan-checker, because it is where novice plans most often fail: the protagonist returns geographically but not changed, or the change is asserted rather than dramatized. A checker rule: the position-7 chapter should reference at least one element from the position-1 chapter (a person, place, object, or routine) and demonstrate the protagonist relating to that element differently.

### Position 8 — Change (having changed)

The protagonist arrives back at the comfort zone visibly transformed. In Vogler this is Stage 12 (Return with the Elixir). In Harmon, the change is the entire point of the circle — the seven positions before it exist to earn this position. Position 8 closes the loop both by physically returning the protagonist to position 1's locus and by demonstrating the difference between the position-1 self and the position-8 self.

The 4↔8 mirror is the longest-arc check: the adaptations of position 4 should produce the change of position 8. If the protagonist's adaptations during the search phase did not point toward the transformation visible at the end, the change at position 8 will read as authorial assertion rather than character earning.

---

## 3. The four mirror pairs as encodable invariants

This is the most programmatically useful claim in Harmon's framework. The eight positions form four diagonal pairs, each with a checkable structural property:

| Pair | Property | Checker shape |
|------|----------|---------------|
| **1 ↔ 5** | The Find at 5 must feel unfamiliar/alien relative to the You-zone at 1. Setting, tone, social context, emotional register diverge. | LLM call: given chapter-1 summary and chapter-N (position 5) summary, score divergence on (setting, social context, emotional register, agency) |
| **2 ↔ 6** | The want stated at 2 must be the prize granted (with cost) at 6. Form follows from the question. | LLM call: given chapter-1 want statement and chapter-M (position 6) climax, verify the climax answers the want |
| **3 ↔ 7** | The threshold crossed at 3 is re-crossed in reverse at 7. Same gate, different self. | Deterministic: extract the threshold-event noun from each chapter; require shared referent. LLM call: verify the protagonist's relation to the threshold differs |
| **4 ↔ 8** | The adaptations in 4 produce the change in 8. The change at 8 is foreshadowed in the search at 4. | LLM call: given the position-4 adaptation list and the position-8 change, verify a causal chain |

The 1↔5 mirror is the highest-yield check because it is the most commonly violated by autonomous planners: the planner produces a chapter sequence that geographically traverses the journey but does not tonally invert at the structural midpoint. A 200-token LLM call comparing chapter 1's setting/tone/social paragraph against the midpoint chapter's would catch this cheaply.

---

## 4. Vogler/Campbell comparison — twelve stages

Christopher Vogler's *The Writer's Journey* (originally a Disney internal memo, expanded to a book in 1992 and revised in 2007) is the most-used Hollywood adaptation of Campbell's monomyth. Its twelve stages are:

1. **Ordinary World** — the hero's familiar life
2. **Call to Adventure** — disruption, the inciting incident
3. **Refusal of the Call** — hesitation, fear, or principled resistance
4. **Meeting the Mentor** — receipt of advice, training, or talisman
5. **Crossing the First Threshold** — committed entry to the special world
6. **Tests, Allies, and Enemies** — the hero learns the rules of the new world
7. **Approach to the Inmost Cave** — preparing for the central trial
8. **Ordeal** — the central trial, often involving symbolic death
9. **Reward (Seizing the Sword)** — the prize claimed
10. **The Road Back** — return journey begins
11. **Resurrection** — the climactic test that proves the change
12. **Return with the Elixir** — the hero brings back something of value

Campbell's *Hero with a Thousand Faces* lays out seventeen stages across three sections (Departure, Initiation, Return), but very few stories hit all seventeen, and Campbell's prose is anthropological rather than prescriptive.

**Harmon's compression of Vogler's twelve to eight**:

| Vogler | Harmon |
|--------|--------|
| 1. Ordinary World | 1. You |
| 2. Call to Adventure | 2. Need |
| 3. Refusal | (folded into 2) |
| 4. Meeting the Mentor | (folded into 4) |
| 5. Crossing the First Threshold | 3. Go |
| 6. Tests, Allies, Enemies | 4. Search |
| 7. Approach to Inmost Cave | (folded into 4) |
| 8. Ordeal | (folded into 5) |
| 9. Reward | 5. Find |
| 10. The Road Back | 6. Take / 7. Return |
| 11. Resurrection | (folded into 6) |
| 12. Return with the Elixir | 8. Change |

Harmon's compression is not lossy in a literary sense; it is lossy in a checklist sense. Vogler gives a writer twelve diagnostic boxes to tick. Harmon gives a writer four diagonal symmetries to verify. For an autonomous planner, the symmetry framing is more useful because it produces *checkable mirror constraints* rather than *checklist completeness*.

**When to prefer Vogler over Harmon**: when the story has a strong mentor figure (Vogler's Stage 4 surfaces the mentor as a structural slot; Harmon does not), when refusal-of-call is dramatically central (Vogler's Stage 3 likewise), or when the resurrection beat is genre-mandatory (action/superhero, where the hero's apparent death is a recurring trope).

**When to prefer Harmon**: for tighter character-arc novels where the planner needs to verify mirror-pair coherence rather than completeness of journey beats. For our LitRPG/fantasy focus, Harmon's symmetry is the better encodable target.

---

## 5. Mapping Story Circle positions to chapter-level position

For a 10-chapter novel (the harness's typical mid-size target), a clean position-to-chapter mapping is:

| Story Circle position | Chapter range (10-ch novel) | Chapter range (3-ch novel) |
|----|----|----|
| 1. You | Ch 1 (opening half) | Ch 1 (opening third) |
| 2. Need | Ch 1 (closing half) | Ch 1 (middle third) |
| 3. Go | Ch 2 | Ch 1 (closing third) → Ch 2 opening |
| 4. Search | Ch 3-6 | Ch 2 |
| 5. Find | Ch 7 | Ch 3 (opening third) |
| 6. Take | Ch 8 | Ch 3 (middle third) |
| 7. Return | Ch 9 | Ch 3 (closing third) |
| 8. Change | Ch 10 | Ch 3 (closing beats) |

The mapping is not 1:1; positions 4 and 8 commonly occupy multiple chapters or fractions of chapters. The planner's job is not to assign exactly one chapter to each position but to **label each chapter's primary position and verify that the position sequence is monotonic clockwise around the circle**.

For 20-30 chapter full novels, position 4 (Search) typically expands to 60-70% of total chapters, with positions 1-3 and 5-8 each occupying one to three chapters.

---

## 6. Programmatic levers for the harness

### 6.1 Planning-phase: position labels

Extend `chapterBeatsSchema` (currently in `src/agents/planning-beats/schema.ts`) with an optional `storyCirclePosition: 1|2|3|4|5|6|7|8` field per chapter. Planning-plotter (Phase 1) emits the position label as part of the chapter skeleton. The label is *advisory* to planning-beats (Phase 2) — it informs the beat-list expansion but does not gate it.

### 6.2 Planning-phase: monotonicity check

After planning-plotter emits the chapter skeleton, a deterministic check verifies that `storyCirclePosition` values are non-decreasing across chapter index, with at most one chapter skipping a position (to allow position-4 expansion). If the planner emits `[1, 2, 4, 3, 5, ...]` the check fires and the chapter-plan-checker re-runs with a position-correction prompt.

### 6.3 Chapter-plan-checker: four mirror-pair LLM calls

For each of the four diagonal pairs, add a focused checker call (DeepSeek V3.2 base, ~500 input / ~150 output tokens):

- **1↔5 divergence check**: given chapter-1 summary + chapter-(position-5) summary, score on (setting, social context, emotional register, agency). Fires if any axis shows convergence rather than divergence.
- **2↔6 want-payoff check**: given chapter-1 stated want + chapter-(position-6) climax, verify climax grants the want and demonstrates the cost.
- **3↔7 threshold-crossing check**: given chapter-(position-3) threshold event + chapter-(position-7) return event, verify shared threshold referent and altered protagonist relation.
- **4↔8 adaptation-to-change check**: given chapter-(position-4..) adaptation list + chapter-(position-8) change description, verify causal chain.

Each call is independent and parallelizable. Total cost per novel: ~4 calls × 650 tokens ≈ 2,600 tokens at DeepSeek V3.2 prices = ~$0.0005. Negligible.

### 6.4 Beat-prompt enrichment

Per-beat writer prompts already include POV, setting, transition bridge, and landing target. Add an optional `storyCircleHint: string` field constructed from the chapter's `storyCirclePosition`:

- Position 1 beats: "this beat establishes the protagonist's familiar world; show what is normal here"
- Position 3 beats: "this beat crosses the threshold from the familiar to the unfamiliar; make the threshold legible"
- Position 5 beats: "this beat shows the protagonist getting what they wanted at the start; the setting and tone should feel alien relative to chapter 1"
- Position 7 beats: "this beat returns the protagonist to a place/person/situation from chapter 1; show the protagonist relating to it differently now"

These hints are short (~30 tokens) and can be appended to the writer's beat-context block without exceeding the cache-warm primer budget.

### 6.5 Validation-phase: structural arc check

Validation runs deterministic checks today; add a structural-arc summary that emits each chapter's detected position vs. its planned position. The detection step is a single DeepSeek call that, given the full novel summary and the eight-position definitions, returns a position label per chapter. Disagreement between planned and detected positions is logged but not blocking.

---

## 7. Limitations

**Story Circle collapses for non-character-arc stories.** Mosaic novels (e.g., *Cloud Atlas*), ensemble pieces with no transforming protagonist (much of literary fiction), and plot-puzzle thrillers where the protagonist is the camera rather than the subject (much of procedural mystery) do not fit the eight positions. Trying to force the labels onto these structures produces noise, not signal.

**Position 4 absorbs everything, which is the framework's biggest weakness.** Position 4 is roughly 60% of the circle by page count in most novels, but the framework gives no internal structure for it. The chapter-plan-checker cannot use Story Circle alone to validate the middle of the novel — it needs additional structure (Maass's microtension, scene-level try-fail cycles, pinch points from Save the Cat, or genre-specific beat structures from LitRPG conventions) to check whether the search phase is actually building toward the find.

**The mirror constraints can be over-applied.** Forcing every position-1 element to have a position-5 mirror produces mechanical-feeling prose. The constraints are diagnostic floors, not generative ceilings — a checker should flag a *complete absence* of 1↔5 divergence, not punish stories that achieve the divergence in only one of four axes.

**Symmetry is not necessarily virtue.** Some great novels deliberately violate the circle: protagonist does not return, does not change, returns to a comfort zone that no longer exists, etc. The harness should treat Story Circle compliance as *one signal* among many, not a hard gate.

**The framework was designed for 22-minute TV episodes** (Harmon developed it at Channel 101 for 5-minute and later at *Community* for 22-minute episodes). It scales up to novel length but its rhythm assumes one journey per unit; long novels often contain multiple nested journeys. The harness should permit per-act circle labeling for longer works, not assume one circle per novel.

---

## 8. Citations

- **Harmon, Dan.** "Story Structure 101: Super Basic Shit." Channel 101 Wiki. (Original four-part series: "Super Basic Shit," "...Down the Road," "...Let's Simplify," "...Final Battle," "...The Audience.")
- **Harmon, Dan.** Various "Story Embryo" / "Story Circle" interviews (Wired 2011 "Channel 101 Story Structure"; Scriptnotes podcast appearances).
- **Vogler, Christopher.** *The Writer's Journey: Mythic Structure for Writers*. Michael Wiese Productions, 1992 (1st ed.) / 2007 (3rd ed.).
- **Campbell, Joseph.** *The Hero with a Thousand Faces*. Pantheon, 1949 / Princeton University Press, 1968 (2nd ed.) / New World Library, 2008 (3rd ed.).
- **Howard, Douglas L.**, ed. *Television Aesthetics and Style*. Bloomsbury, 2013. (Chapter on *Community* and Harmon's structural method.)

---

## 9. One-paragraph summary

Dan Harmon's Story Circle compresses Campbell's monomyth and Vogler's twelve-stage Writer's Journey into eight rotational positions (You, Need, Go, Search, Find, Take, Return, Change) connected by four diagonal mirror pairs (1↔5 zone-vs-alien, 2↔6 want-vs-cost, 3↔7 threshold-vs-return, 4↔8 adaptation-vs-change). Its programmatic value to the harness is precisely those four mirrors: they are encodable as four cheap chapter-plan-checker LLM calls (~2.6K tokens total, ~$0.0005 per novel) that verify structural symmetry rather than checklist completeness. Recommended encoding: add `storyCirclePosition` to `chapterBeatsSchema`, have planning-plotter emit position labels in the skeleton, run a monotonicity check at planning, run four mirror-pair LLM checks at chapter-plan-checker, and append a 30-token position hint to writer beat prompts. Limitations: collapses for non-character-arc stories, gives no internal structure for the 60%-of-novel "Search" phase (Maass and genre-specific beat structures must fill that), and should be treated as advisory rather than blocking. Vogler's 12-stage version is preferable when mentor/refusal/resurrection slots are dramatically central; Harmon's 8-position symmetry is preferable for LitRPG/fantasy character-arc novels because the mirror constraints are checkable.
