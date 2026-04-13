---
status: reference
verified: 2026-04-03
---

# AI Tells: Hedging and Qualifying Language

> **Date:** 2026-04-03
> **Scope:** Epistemic hedging, qualifying phrases, abstract sensation filler, vague determiners

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Background](#background)
3. [Proposed Patterns](#proposed-patterns)
4. [Pattern Summary Table](#pattern-summary-table)
5. [Relationship to Existing Patterns](#relationship-to-existing-patterns)
6. [Measurement Strategy](#measurement-strategy)
7. [Appendix A -- Source Citations](#appendix-a--source-citations)
8. [Appendix B -- Example Corpus](#appendix-b--example-corpus)

---

## Executive Summary

**12 proposed patterns** in a new `HEDGE_QUALIFIER` category, assigned to **Tier 2** (same tier as existing `FILTER_WORD` patterns).

**Tier assignment rationale:** Hedging patterns sit at the same complexity level as filter words -- they require dialogue awareness, are fixable by a cheap rewriter model, and have moderate false-positive risk that demands context sensitivity. They are not Tier 1 (mechanically replaceable with zero context) because several patterns are legitimate in deep POV internal monologue. They are not Tier 3 (structural/emotional) because the fix is usually deletion or local substitution, not a scene-level rewrite.

**Expected FP risk:** Medium overall. The primary false-positive scenario is deep POV narration where the character is genuinely uncertain ("Perhaps he'd been wrong" in close third). The `dialogue_ok: true` flag on most patterns plus fix_template instructions to the rewriter mitigate this. The abstract sensation patterns (HQ-11, HQ-12) have lower FP risk because they target specific cliched constructions.

**Integration points:**
- DB: Insert into `lint_patterns` table as Tier 2, category `HEDGE_QUALIFIER`
- Writer prompt: Add a new NEVER rule block to `src/agents/writer/prompt.md`
- Rewriter: fix_template instructions feed directly into rewrite calls
- Benchmarks: Run lint on existing generations to establish baseline hit rates before enabling

---

## Background

### Hedging as an AI detection marker

AI-generated text uses hedging devices at substantially higher rates than human writing. A corpus-based study comparing AI-generated and human-written essays found 405.5 total hedging instances in AI text vs. 250 in human text -- a 62% increase (Isnaini & Haryanti, 2025). The modal verb "can" appeared 341 times in AI essays vs. 65 in human essays; "may" appeared 119 times vs. 13.

GPTZero's detection framework identifies hedging as a core AI marker: "AI hedges. It says, 'Some people say X, others say Y.' Humans say, 'This is wrong'" (GPTZero, 2024). This tendency stems from RLHF safety training, which penalizes confident assertions, producing what The Augmented Educator calls "an overly cautious tone" from "safety protocols embedded in language models" (The Augmented Educator, 2025). The result is prose saturated with epistemic hedges -- "perhaps," "somehow," "it seemed," "in a way that" -- that read as the model hedging its bets rather than a character experiencing uncertainty.

In fiction specifically, this manifests differently than in essays. AI-generated narration hedges not through modal verbs ("can," "may") but through distancing constructions: vague similes ("it was as though"), imprecise comparisons ("something like"), and existential hedges ("there seemed to be"). These patterns create narrative distance -- the opposite of the close POV that strong fiction demands.

### Hedging as a craft problem

The craft objection to hedging predates AI by decades:

- **William Zinsser** (*On Writing Well*, 1976/2006, Ch. 3 "Clutter"): "Prune out the small words that qualify how you feel and how you think and what you saw: 'a bit,' 'a little,' 'sort of,' 'kind of,' 'rather,' 'quite,' 'very,' 'too,' 'pretty much,' 'in a sense.'" His core argument: "Every little qualifier whittles away some fraction of the reader's trust."

- **Roy Peter Clark** (*Writing Tools*, 2006, Tool #3 "Activate Your Verbs"): Identifies verb qualifiers as barnacles -- "sort of, tend to, kind of, must have, seemed to, could have, used to, begin to" -- and recommends scraping them away during revision so that "prose can glide toward meaning."

- **Renni Browne & Dave King** (*Self-Editing for Fiction Writers*, 1993/2004, Ch. 1 "Show and Tell" and Ch. 7 "Interior Monologue"): Their R.U.E. principle ("Resist the Urge to Explain") targets the hedging instinct directly. When a narrator writes "She seemed afraid" instead of showing the fear through action, the narrator is explaining and hedging simultaneously. Their chapter on interior monologue distinguishes between legitimate character uncertainty and authorial hedging.

- **Noah Lukeman** (*The First Five Pages*, 2000, Ch. 2-4): Lists vague, noncommittal prose among the first things agents notice in a rejection pile. Lukeman's taxonomy of weak prose includes excessive adjectives, adverbs, and qualifiers -- all markers of a writer who won't commit to a concrete image.

- **Sol Stein** (*Stein on Writing*, 1995, Ch. 14 "Triage"): Advocates for removing all adjectives and adverbs from a manuscript, then re-admitting only the necessary few after careful testing. Qualifiers fail this test almost universally.

### Relationship to existing FILTER_WORD patterns

The harness already has 7 `FILTER_WORD` patterns at Tier 2, covering sensory filtering: "seemed to," "could feel/see/hear/smell/taste," and "found herself/himself." These target **perceptual distancing** -- the narrator reporting their own noticing instead of describing direct experience.

`HEDGE_QUALIFIER` patterns target a different mechanism: **epistemic distancing** -- the narrator hedging about what is true, what something resembles, or how to characterize an experience. The boundary:

| Category | Mechanism | Example | Fix direction |
|----------|-----------|---------|---------------|
| `FILTER_WORD` | Perceptual filter | "She could see the tower" | Describe the tower directly |
| `HEDGE_QUALIFIER` | Epistemic hedge | "Perhaps the tower was watching" | Commit to the image or cut |

One existing pattern overlaps: "seemed to" is currently in `FILTER_WORD`. The new `HEDGE_QUALIFIER` patterns avoid duplicating it. "It seemed" (existential) and "there seemed" are distinct constructions and are included here.

---

## Proposed Patterns

### HQ-1: Perhaps/Maybe in Narration

**What:** The words "perhaps" and "maybe" used in narration (not dialogue) to hedge assertions. AI prose defaults to these instead of committing to concrete description. "Perhaps the shadows moved" is the model declining to assert that the shadows moved.

**Where it appears:** Narration, very common in AI prose. Rare in published literary fiction outside of deep POV internal monologue where the character is genuinely uncertain.

**Detection approach:**
- Regex: `\b(perhaps|maybe)\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Remove the hedge and commit to the statement. If the character is genuinely uncertain in deep POV, rephrase as a direct question or uncertain action instead. 'Perhaps the door was locked' -> 'The door was locked' or 'She tried the handle. Locked.' If uncertainty is the point: 'Was the door locked? She couldn't remember.'"

**Writer prompt rule:** "NEVER use 'perhaps' or 'maybe' in narration to soften assertions. If the character is uncertain, show it through action or internal question -- do not hedge with adverbs."

**Effort:** Low

**False positive risk:** Medium
- Mitigation: `dialogue_ok: true` skips all dialogue. The fix_template instructs the rewriter to preserve genuine character uncertainty by converting to direct questions or uncertain actions.
- Edge cases: Deep POV close-third where the narrator voice merges with the character's thoughts. "Perhaps he'd been wrong all along" can be legitimate internal monologue. The rewriter must distinguish narrator hedging (the model is uncertain) from character hedging (the character is uncertain). The test: does removing "perhaps" change the meaning, or just remove waffling?

**Craft rationale:** Zinsser identifies "perhaps" among qualifiers that "whittle away the reader's trust" (*On Writing Well*, Ch. 3). Clark lists it among verb qualifiers to scrape away (*Writing Tools*, Tool #3). In AI-generated prose specifically, "perhaps" and "maybe" appear at far higher rates than in human fiction because the model's RLHF training penalizes confident assertions (GPTZero, 2024; The Augmented Educator, 2025).

**Verdict:** DO IT

---

### HQ-2: "It was as though/if" (Distancing Simile)

**What:** The construction "it was as though" or "it was as if" introduces a simile through an existential frame ("it was") plus a distancing hedge ("as though/if"). Double indirection: the narrator declines to use a direct metaphor or simile and instead routes through an impersonal "it."

**Where it appears:** Narration, frequent in AI prose. Published fiction uses "as though" and "as if" but rarely with the "it was" frame -- strong prose attaches the comparison to a concrete subject.

**Detection approach:**
- Regex: `\bit\s+was\s+as\s+(though|if)\b`
- Flags: `gi`
- dialogue_ok: false

**fix_template:** "Replace with a direct simile attached to a concrete subject, or convert to metaphor. 'It was as though the room had shrunk' -> 'The walls pressed closer' or 'The room shrank around her.' Attach the comparison to something the POV character perceives."

**Writer prompt rule:** "NEVER use 'it was as though' or 'it was as if' -- attach similes to concrete subjects. 'It was as though the air had thickened' -> 'The air thickened around her.'"

**Effort:** Low

**False positive risk:** Low
- Mitigation: The "it was" + "as though/if" combination is almost never the strongest construction available. Even when the comparison is good, the frame weakens it.
- Edge cases: Deliberate stylistic choice in a Kafkaesque or absurdist register where the impersonal "it" is thematic. Extremely rare in the harness's genre targets.

**Craft rationale:** Browne & King's R.U.E. principle applies: the narrator is explaining what something resembles instead of rendering it directly (*Self-Editing for Fiction Writers*, Ch. 1). The "it was" frame is an existential construction that distances the reader from the POV character's experience. Fiction editors consistently flag this as weak prose (Ellen Brock, "Novel Boot Camp #3," 2015; The Editor's Blog, "Making Comparisons," 2012).

**Verdict:** DO IT

---

### HQ-3: "In a way that" (Vague Qualifier)

**What:** The phrase "in a way that" introduces a vague characterization instead of a specific description. "She looked at him in a way that suggested anger" -- the narrator is hedging about what the look actually conveyed.

**Where it appears:** Narration, common in AI prose. Used as a connector when the model cannot commit to a specific sensory detail.

**Detection approach:**
- Regex: `\bin\s+a\s+way\s+that\b`
- Flags: `gi`
- dialogue_ok: false

**fix_template:** "Replace the vague qualifier with a specific description. 'She spoke in a way that made him uncomfortable' -> 'Her voice dropped to a murmur, each word clipped short.' Show the specific manner instead of gesturing at it."

**Writer prompt rule:** "NEVER use 'in a way that' -- describe the specific manner. 'He moved in a way that suggested pain' -> 'He winced with each step, favoring his left side.'"

**Effort:** Low

**False positive risk:** Low
- Mitigation: "In a way that" is almost always replaceable with stronger, more specific prose. The construction is inherently vague.
- Edge cases: Philosophical or essayistic narration where abstraction is intentional. Not relevant for close-POV fiction.

**Craft rationale:** Zinsser classifies "in a sense" and similar constructions as clutter that "don't mean anything" (*On Writing Well*, Ch. 3). "In a way that" is the fiction equivalent -- it gestures at meaning without delivering it. Lukeman identifies vague prose as a submission killer because it signals the writer cannot find the precise image (*The First Five Pages*, Ch. 2-3).

**Verdict:** DO IT

---

### HQ-4: "Something like/akin to" (Imprecise Comparison)

**What:** The constructions "something like" and "something akin to" introduce comparisons that the narrator cannot commit to. "She felt something like dread" -- the model knows it wants dread but won't commit.

**Where it appears:** Narration, frequent in AI prose, particularly for emotions and sensations.

**Detection approach:**
- Regex: `\bsomething\s+(like|akin\s+to)\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Commit to the comparison or replace with concrete sensation. 'Something like grief settled in her chest' -> 'Grief settled in her chest' or 'A weight pressed behind her sternum.' If the character genuinely can't name the feeling, show the physical sensation instead of hedging about the label."

**Writer prompt rule:** "NEVER use 'something like' or 'something akin to' in narration. Either commit to the comparison or describe the physical sensation. 'Something like fear' -> 'Fear' or 'Her stomach clenched.'"

**Effort:** Low

**False positive risk:** Medium
- Mitigation: `dialogue_ok: true` handles conversational usage. The fix_template gives two paths: commit to the noun, or replace with a physical sensation.
- Edge cases: A character who genuinely cannot identify what they are feeling -- this is a legitimate narrative moment but should be rendered through physical confusion, not hedging language. "She couldn't name the feeling. It sat behind her ribs like a stone."

**Craft rationale:** Stein's triage method (*Stein on Writing*, Ch. 14) would strip "something like" as a failed qualifier. Browne & King's show-don't-tell principle demands that emotions be rendered through physical experience, not approximated with hedging comparisons (*Self-Editing for Fiction Writers*, Ch. 1). The construction signals the writer (or model) could not find the specific word.

**Verdict:** DO IT

---

### HQ-5: "Almost as if" (Double Hedge)

**What:** "Almost as if" stacks two hedges: "almost" (not quite) and "as if" (resembling but not being). The narrator is twice-removed from asserting anything. "The silence was almost as if the world had stopped" -- the model is maximally noncommittal.

**Where it appears:** Narration, moderate frequency in AI prose. A favorite of instruction-tuned models because it sounds literary while committing to nothing.

**Detection approach:**
- Regex: `\balmost\s+as\s+if\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Remove the double hedge. Choose either a direct simile ('as if the world had stopped') or commit to the image ('The world stopped'). One layer of comparison is the maximum -- never stack hedges."

**Writer prompt rule:** "NEVER stack hedges: 'almost as if,' 'nearly as though.' Use one comparison layer maximum."

**Effort:** Low

**False positive risk:** Low
- Mitigation: The double-hedge construction is almost never (pun intended) the strongest available phrasing. Even a single "as if" is stronger.
- Edge cases: None significant. If "almost" is meaningful (the thing is close to but not quite the comparison), use "nearly" with a concrete image instead.

**Craft rationale:** Clark's Tool #3 targets stacked qualifiers explicitly (*Writing Tools*). Zinsser's clutter principle (*On Writing Well*, Ch. 3) applies doubly -- each hedge whittles trust, and two together compound the effect. The construction is a diagnostic marker for AI prose because human writers self-edit the double hedge in revision.

**Verdict:** DO IT

---

### HQ-6: "Sort of/Kind of" in Narration

**What:** Colloquial hedges "sort of" and "kind of" used in narration (not dialogue). In dialogue, these are natural speech patterns. In narration, they signal the narrator's (or model's) inability to commit. "The room sort of tilted" -- commit to the tilt or find the right verb.

**Where it appears:** Narration and dialogue. Common in AI prose that attempts casual register.

**Detection approach:**
- Regex: `\b(sort|kind)\s+of\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Remove the hedge and commit. 'The room sort of tilted' -> 'The room tilted.' 'She kind of smiled' -> 'She smiled' or find a more precise verb: 'The corner of her mouth lifted.' If imprecision is the point, use a concrete image instead."

**Writer prompt rule:** "NEVER use 'sort of' or 'kind of' in narration. Commit to the verb or find a precise one."

**Effort:** Low

**False positive risk:** Medium
- Mitigation: `dialogue_ok: true` is critical -- "sort of" and "kind of" are natural in speech. The remaining narration hits are almost always improvable.
- Edge cases: First-person narrators with a casual, conversational voice (e.g., YA or humorous fiction) may use these deliberately. The rewriter should respect established narrator voice. The harness's current seeds (romance-drama, sci-fi-thriller, dark-fantasy, young-adult-fantasy) use close third, where these are rarely appropriate.

**Craft rationale:** Zinsser lists "sort of" and "kind of" explicitly as qualifiers to prune (*On Writing Well*, Ch. 3). Clark identifies them as "verb qualifiers that attach themselves to standard prose like barnacles" (*Writing Tools*, Tool #3). The Rocky Mountain Fiction Writers identify these as among the "6 weasel words to cut from your manuscript" (RMFW, 2017).

**Verdict:** DO IT

---

### HQ-7: "A certain/Some kind of" (Vague Determiner)

**What:** Vague determiners that substitute for specific description. "A certain sadness" instead of describing the sadness. "Some kind of barrier" instead of naming or describing the barrier. The narrator gestures at specificity without delivering it.

**Where it appears:** Narration, moderate frequency in AI prose.

**Detection approach:**
- Regex: `\b(a\s+certain|some\s+kind\s+of)\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Replace the vague determiner with a specific description. 'A certain sadness in her eyes' -> 'Her eyes were red-rimmed' or 'She looked away.' 'Some kind of barrier' -> name the barrier or describe its properties. If the vagueness is the character's experience (they genuinely don't know what kind), describe what they perceive instead."

**Writer prompt rule:** "NEVER use 'a certain' or 'some kind of' as lazy specificity. Either name the thing or describe it concretely."

**Effort:** Low

**False positive risk:** Medium
- Mitigation: `dialogue_ok: true` handles conversational usage. "A certain" has a literary register ("a certain je ne sais quoi") that is occasionally deliberate.
- Edge cases: "A certain" used for genuine withholding of information from the reader for dramatic effect ("A certain guest had arrived" in a mystery). The rewriter should judge whether the vagueness serves the plot. "Some kind of" when the POV character genuinely cannot identify the thing -- but this should still be rendered through concrete sensory detail rather than the hedge.

**Craft rationale:** Lukeman flags vague description as one of the first things agents notice in a rejection pile (*The First Five Pages*, Ch. 2-3). Zinsser's entire clutter chapter argues that imprecise language erodes reader trust (*On Writing Well*, Ch. 3). "A certain" is a hedge that promises specificity and fails to deliver.

**Verdict:** DO IT

---

### HQ-8: "Somehow/Somewhat" in Narration

**What:** The adverbs "somehow" and "somewhat" are pure hedges in narration. "Somehow she knew" -- the narrator declines to explain how. "Somewhat reluctantly" -- the narrator declines to quantify the reluctance. AI models use these to paper over gaps in causal logic.

**Where it appears:** Narration, very common in AI prose. "Somehow" is particularly diagnostic because it signals the model could not generate a causal chain.

**Detection approach:**
- Regex: `\b(somehow|somewhat)\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Remove the hedge. For 'somehow': either show the mechanism or remove the word entirely. 'Somehow she knew he was lying' -> 'His left eye twitched -- he was lying' or just 'She knew he was lying.' For 'somewhat': commit to the degree or cut. 'Somewhat reluctantly' -> 'reluctantly' or show the reluctance through action."

**Writer prompt rule:** "NEVER use 'somehow' in narration -- either show how or don't qualify. NEVER use 'somewhat' -- commit to the degree or show it through action."

**Effort:** Low

**False positive risk:** Low
- Mitigation: `dialogue_ok: true` handles speech. In narration, both words are almost always deletable or replaceable with stronger prose.
- Edge cases: "Somehow" in genuine mystery narration where the mechanism is deliberately withheld as plot tension. Rare, and even then, "She knew he was lying, though she couldn't say why" is stronger. "Somewhat" has essentially no legitimate narration use.

**Craft rationale:** Clark's Tool #3 lists "seemed to" and similar constructions but the principle -- scrape away verb qualifiers -- applies equally to "somehow" and "somewhat" (*Writing Tools*). Zinsser would classify both as qualifiers that "whittle away trust" (*On Writing Well*, Ch. 3). "Somehow" is specifically flagged in fiction editing circles as a logic gap the writer hasn't resolved (TCK Publishing, "Weasel Words," 2023).

**Verdict:** DO IT

---

### HQ-9: "It seemed/There seemed" (Existential Hedge)

**What:** Existential constructions "it seemed" and "there seemed" where the narrator hedges about what exists or what is happening. Distinct from "seemed to [verb]" (already caught by FILTER_WORD). "It seemed darker than before" -- commit to the darkness. "There seemed to be a figure" -- either there's a figure or there isn't.

**Where it appears:** Narration, frequent in AI prose.

**Detection approach:**
- Regex: `\b(it|there)\s+seemed\b`
- Flags: `gi`
- dialogue_ok: false

**fix_template:** "Remove the existential hedge and commit. 'It seemed darker' -> 'The hallway was darker' or 'Shadows had thickened.' 'There seemed to be a figure' -> 'A figure stood at the end of the hall.' If the character is genuinely uncertain about what they perceive, show the uncertainty through sensory confusion: 'She squinted. Was that a figure at the end of the hall?'"

**Writer prompt rule:** "NEVER use 'it seemed' or 'there seemed' -- commit to what the POV character perceives or show their uncertainty through action."

**Effort:** Low

**False positive risk:** Low
- Mitigation: `dialogue_ok: false` is appropriate -- these constructions are rare in speech. The existential frame is almost always weaker than a direct statement.
- Edge cases: Deliberately unreliable narration where the narrator's hedging is thematic. Very rare in the harness's current genre targets.

**Craft rationale:** Browne & King's R.U.E. principle targets exactly this: the narrator explaining rather than rendering (*Self-Editing for Fiction Writers*, Ch. 1). "It seemed" is a filter word wearing an existential disguise -- it still distances the reader from direct experience. The existing FILTER_WORD pattern "seemed to" catches verb phrases ("seemed to glow"); this pattern catches the existential frame ("it seemed darker"), which is a different syntactic construction.

**Verdict:** DO IT

---

### HQ-10: "Couldn't help but" (Involuntary Hedge)

**What:** The construction "couldn't help but [verb]" frames a deliberate action as involuntary, hedging the character's agency. "She couldn't help but smile" -- the narrator declines to let the character simply smile. Common in AI prose because the model reaches for it as an emotional intensifier.

**Where it appears:** Narration, moderate frequency in AI prose, particularly for emotional reactions.

**Detection approach:**
- Regex: `\bcouldn't\s+help\s+but\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Remove the involuntary frame -- let the character act. 'She couldn't help but smile' -> 'She smiled' or 'A smile broke through despite herself.' If the involuntary quality is important, show it through physical detail rather than the hedge construction."

**Writer prompt rule:** "NEVER use 'couldn't help but' -- let the character act directly. 'She couldn't help but laugh' -> 'She laughed' or 'A laugh escaped before she could stop it.'"

**Effort:** Low

**False positive risk:** Low
- Mitigation: `dialogue_ok: true` for speech. The construction is almost always weaker than the direct action.
- Edge cases: When the involuntary nature of the action is genuinely load-bearing (the character is trying to suppress the reaction). Even then, "She bit her lip, but the laugh came anyway" is stronger than "She couldn't help but laugh."

**Craft rationale:** This construction violates Browne & King's principle of direct character action (*Self-Editing for Fiction Writers*, Ch. 1). It tells the reader the character couldn't resist instead of showing the resistance (or lack thereof). TCK Publishing lists "couldn't help but" among weasel words that soften prose (TCK Publishing, 2023).

**Verdict:** DO IT

---

### HQ-11: Abstract Sensation -- Electricity/Current Between Characters

**What:** The cliched use of electricity, current, magnetism, or charge as metaphors for interpersonal (usually romantic) tension. "Electricity crackled between them," "A current passed through her," "The air between them was charged." AI models default to these dead metaphors because they are overrepresented in training data.

**Where it appears:** Narration, very common in AI-generated romance and romantic subplots. The TV Tropes "Electric Love" entry documents this as a recognized trope across media (TV Tropes, "Electric Love").

**Detection approach:**
- Regex: `\b(electricity|electric\s+current|magnetism|magnetic\s+pull)\b.*?\b(between|through|crackled|coursed|flowed|passed|sparked|surged|pulsed|hummed)\b`
- Flags: `gi`
- dialogue_ok: false

**fix_template:** "Replace the dead electricity metaphor with a specific physical sensation grounded in the POV character's body. 'Electricity crackled between them' -> 'Her skin prickled where his arm brushed hers' or 'She forgot what she was saying mid-sentence.' Show the effect of attraction through concrete sensory detail, not abstract energy metaphors."

**Writer prompt rule:** "NEVER use electricity, magnetism, or current as metaphors for interpersonal tension. Show attraction through specific physical sensation or behavioral change."

**Effort:** Low

**False positive risk:** Low
- Mitigation: The regex requires both an electricity-domain noun and a transmission verb, reducing false hits on literal electrical descriptions in sci-fi.
- Edge cases: Literal electricity in sci-fi/fantasy settings (a character who manipulates electrical current). The regex's co-occurrence requirement helps, but sci-fi-thriller generations may need manual review. The rewriter should check context.

**Craft rationale:** This is a recognized dead metaphor in fiction editing. Ellen Brock identifies overused similes and metaphors as a signal of unrevised prose ("Novel Boot Camp #3," 2015). The "electric touch" is so pervasive it has its own TV Tropes page. Browne & King's show-don't-tell principle demands concrete sensory detail over abstract metaphor (*Self-Editing for Fiction Writers*, Ch. 1). AI models gravitate to this metaphor because it appears at enormous frequency in their training data.

**Verdict:** DO IT

---

### HQ-12: Abstract Sensation -- "The Air Charged/Thickened/Shifted"

**What:** The air or atmosphere is given vague agency as a vehicle for emotional tension. "The air between them thickened," "The atmosphere shifted," "Tension charged the air." These are abstract sensation fillers that substitute for concrete sensory description.

**Where it appears:** Narration, common in AI prose across genres. A sibling pattern to HQ-11 but targeting the air/atmosphere vehicle rather than the electricity domain.

**Detection approach:**
- Regex: `\b(the\s+)?(air|atmosphere)\s+(between\s+(them|her|him|us))?\s*(thickened|shifted|changed|charged|crackled|hummed|grew\s+(heavy|thick|tense|still))\b`
- Flags: `gi`
- dialogue_ok: false

**fix_template:** "Replace the abstract air/atmosphere description with a concrete physical sensation or behavioral change in the POV character. 'The air between them thickened' -> 'She became aware of how close he was standing' or 'Her breath caught.' Ground the tension in the character's body, not in the ambient environment."

**Writer prompt rule:** "NEVER describe the air or atmosphere as thickening, shifting, or charging to convey emotional tension. Show what the POV character's body does."

**Effort:** Low

**False positive risk:** Low
- Mitigation: The regex requires the atmosphere noun plus a specific set of abstract verbs/adjectives. Literal weather descriptions ("the air grew cold") are less likely to match because "cold" is not in the adjective list.
- Edge cases: Fantasy settings where atmosphere literally changes (magic). The rewriter should check context. Actual weather descriptions where "the air thickened" describes humidity before a storm -- the word list ("tense," "charged") biases toward emotional rather than meteorological descriptions.

**Craft rationale:** This pattern is the environmental cousin of declared emotions (already caught by Tier 3 `DECLARED_EMOTION`). Instead of naming the emotion in a character, the narrator projects it onto the environment. Browne & King's show-don't-tell principle applies: the atmosphere doesn't feel things, characters do (*Self-Editing for Fiction Writers*, Ch. 1). Lukeman flags noncommittal description as a rejection trigger (*The First Five Pages*, Ch. 2-3).

**Verdict:** DO IT

---

## Pattern Summary Table

| ID | Pattern Name | Regex | FP Risk | dialogue_ok | Verdict |
|----|-------------|-------|---------|-------------|---------|
| HQ-1 | Perhaps/Maybe in narration | `\b(perhaps\|maybe)\b` | Medium | true | DO IT |
| HQ-2 | Distancing simile "it was as though/if" | `\bit\s+was\s+as\s+(though\|if)\b` | Low | false | DO IT |
| HQ-3 | Vague qualifier "in a way that" | `\bin\s+a\s+way\s+that\b` | Low | false | DO IT |
| HQ-4 | Imprecise comparison "something like/akin to" | `\bsomething\s+(like\|akin\s+to)\b` | Medium | true | DO IT |
| HQ-5 | Double hedge "almost as if" | `\balmost\s+as\s+if\b` | Low | true | DO IT |
| HQ-6 | Colloquial hedge "sort of/kind of" | `\b(sort\|kind)\s+of\b` | Medium | true | DO IT |
| HQ-7 | Vague determiner "a certain/some kind of" | `\b(a\s+certain\|some\s+kind\s+of)\b` | Medium | true | DO IT |
| HQ-8 | Hedge adverb "somehow/somewhat" | `\b(somehow\|somewhat)\b` | Low | true | DO IT |
| HQ-9 | Existential hedge "it seemed/there seemed" | `\b(it\|there)\s+seemed\b` | Low | false | DO IT |
| HQ-10 | Involuntary hedge "couldn't help but" | `\bcouldn't\s+help\s+but\b` | Low | true | DO IT |
| HQ-11 | Electricity/current metaphor | `\b(electricity\|...)\b.*?\b(between\|...)\b` | Low | false | DO IT |
| HQ-12 | Air/atmosphere as emotion vehicle | `\b(the\s+)?(air\|atmosphere)\s+...` | Low | false | DO IT |

---

## Relationship to Existing Patterns

### Boundary with FILTER_WORD (Tier 2)

The existing `FILTER_WORD` category covers **perceptual filtering** -- constructions where the narrator reports their own act of perceiving instead of describing the perception directly:

| Existing FILTER_WORD | Mechanism |
|---------------------|-----------|
| `seemed to [verb]` | Narrator reports perceived action indirectly |
| `could feel/see/hear/smell/taste` | Narrator reports sensory ability instead of sensation |
| `found herself/himself` | Narrator reports noticing their own action |

The new `HEDGE_QUALIFIER` category covers **epistemic hedging** -- constructions where the narrator qualifies assertions, comparisons, or descriptions:

| New HEDGE_QUALIFIER | Mechanism |
|--------------------|-----------|
| `perhaps/maybe` | Narrator qualifies truth of assertion |
| `it was as though` | Narrator hedges a comparison through existential frame |
| `in a way that` | Narrator gestures at manner without describing it |
| `something like` | Narrator approximates instead of committing |
| `sort of/kind of` | Narrator colloquially hedges degree |
| `somehow/somewhat` | Narrator hedges mechanism or degree |
| `it/there seemed` | Narrator hedges existence or state |
| `couldn't help but` | Narrator hedges character's agency |
| electricity/air patterns | Narrator uses abstract filler instead of concrete sensation |

**The one overlap:** `seemed to` (FILTER_WORD) vs. `it/there seemed` (HEDGE_QUALIFIER). The existing pattern `\bseemed\s+to\b` catches "seemed to [verb]" -- a filter on perceived actions. The new pattern `\b(it|there)\s+seemed\b` catches existential constructions where "seemed" modifies a state, not an action. These are syntactically and functionally distinct. Both should remain enabled.

### Boundary with DECLARED_EMOTION (Tier 3)

Some overlap exists between HQ-4 ("something like grief") and Tier 3 `DECLARED_EMOTION` ("a wave of grief"). The boundary:

- `DECLARED_EMOTION` catches the emotion-naming pattern (wave/surge/pang of [emotion])
- `HEDGE_QUALIFIER` HQ-4 catches the hedging construction ("something like [anything]")
- A phrase like "something like a wave of grief" would be flagged by HQ-4 (the "something like" hedge). The emotion-naming issue is secondary to the hedge.

### Writer prompt integration

The writer prompt (`src/agents/writer/prompt.md`) currently has NEVER rules for filter words, filler phrases, redundant body language, redundant adverbs, said bookisms, and empty transitions. A new block should be added:

```
- NEVER hedge in narration: "perhaps," "maybe," "somehow," "somewhat," "sort of," "kind of." Commit to the statement or show uncertainty through character action.
- NEVER use distancing similes: "it was as though," "it was as if," "almost as if." Attach comparisons to concrete subjects.
- NEVER use vague qualifiers: "in a way that," "something like," "a certain," "some kind of." Be specific.
- NEVER use "couldn't help but" -- let the character act directly.
- NEVER use electricity, magnetism, or current as metaphors for interpersonal tension. Show attraction through specific physical sensation.
- NEVER project emotion onto atmosphere: "the air thickened," "the atmosphere shifted." Show what the character's body does.
```

---

## Measurement Strategy

### Baseline establishment

Before enabling HEDGE_QUALIFIER patterns in the lint pipeline:

1. **Run lint on existing generations.** Query all generations from the last 5 benchmark runs and lint them with the new patterns (disabled in scoring, just counting hits). Record per-pattern hit counts and per-seed hit rates.

2. **Estimate false positive rate.** Manually review a sample of 20 hits per pattern. Classify each as true positive (the construction weakens the prose) or false positive (the construction is legitimate in context). Target: <20% FP rate for DO IT patterns.

3. **Record baseline in DB.** Create a tuning experiment with `type: lint-calibration`, documenting per-pattern hit rates and FP rates.

### Enablement

4. **Add patterns to DB.** Insert into `lint_patterns` as Tier 2, category `HEDGE_QUALIFIER`, enabled.

5. **Add writer prompt rules.** Update `src/agents/writer/prompt.md` with the NEVER rules above.

6. **Run benchmark comparison.** Create an experiment comparing prose quality scores before and after the prompt update. Use `BENCHMARK_SEEDS=romance-drama,dark-fantasy` (genres where hedging is most problematic) with `BENCHMARK_RUNS=3`.

### Ongoing tracking

7. **Monitor per-pattern hit rates.** After each benchmark run, check `getPatternStats()` for HEDGE_QUALIFIER hit counts. A rising hit count means the writer prompt rules are not being followed -- consider strengthening the prompt or adjusting model temperature.

8. **Track skip rate.** Patterns with high skip counts (rewriter decides the flagged text is legitimate) may have FP rates that are too high. If skip_count/hit_count > 0.3 for any pattern, review the regex or add exclusions.

9. **Pairwise comparison.** After the patterns have been live for 2-3 runs, use `benchmark/pairwise/` to A/B compare generations from before and after. This measures whether removing hedging actually improves perceived prose quality (not just lint scores).

---

## Appendix A -- Source Citations

| # | Author(s) | Title | Year | Relevant Chapter/Section | Key Contribution |
|---|-----------|-------|------|--------------------------|------------------|
| 1 | William Zinsser | *On Writing Well* (30th anniversary ed.) | 2006 | Ch. 3 "Clutter" | Identifies qualifiers ("sort of," "kind of," "perhaps," "a bit") as trust-eroding clutter. "Every little qualifier whittles away some fraction of the reader's trust." |
| 2 | Roy Peter Clark | *Writing Tools: 55 Essential Strategies for Every Writer* | 2006 | Tool #3 "Activate Your Verbs," Tool #10 "Cut Big, Then Small" | Names verb qualifiers ("sort of, tend to, kind of, seemed to") as "barnacles" to scrape away. |
| 3 | Renni Browne & Dave King | *Self-Editing for Fiction Writers* (2nd ed.) | 2004 | Ch. 1 "Show and Tell," Ch. 7 "Interior Monologue" | R.U.E. (Resist the Urge to Explain) principle. Distinguishes legitimate character uncertainty in internal monologue from authorial hedging. |
| 4 | Noah Lukeman | *The First Five Pages: A Writer's Guide to Staying Out of the Rejection Pile* | 2000 | Ch. 2-4 (Adjectives/Adverbs, Sound, Comparison) | Vague, noncommittal prose as a top-of-pile rejection trigger. |
| 5 | Sol Stein | *Stein on Writing* | 1995 | Ch. 14 "Triage" | Remove all adjectives and adverbs, re-admit only the necessary few. Qualifiers almost never survive triage. |
| 6 | Isnaini & Haryanti | "The Use of Hedging Devices and Engagement Markers in AI-Generated and Human-Written Essays" | 2025 | Full paper (SCIRP Journal) | Corpus study: AI essays contained 405.5 hedging instances vs. 250 in human essays (62% more). Modal "can": 341 (AI) vs. 65 (human). |
| 7 | GPTZero | "What is Perplexity & Burstiness for AI Detection?" | 2024 | Blog post | Identifies hedging as a core AI marker: "AI hedges... Humans say, 'This is wrong.'" Low burstiness as detection signal. |
| 8 | The Augmented Educator | "The Ten Telltale Signs of AI-Generated Text" | 2025 | Blog post | Lists hedging language and "overly cautious tone" as an AI tell stemming from safety training. Instruction-tuned models use participial constructions at 2-5x human rates. |
| 9 | Wikipedia contributors | "Wikipedia:Signs of AI Writing" | 2024-2025 | Project page | Compiled vocabulary fingerprints ("delve," "underscore," "tapestry"), structural patterns, and hedging indicators. |
| 10 | TCK Publishing | "Weasel Words: Get Rid of These Words to Improve Your Writing" | 2023 | Blog post | Lists hedging words ("fairly," "in a sense," "may/might") as weasel words that undermine clarity. |
| 11 | Write It Sideways (Janet Burroway cite) | "Are These Filter Words Weakening Your Fiction?" | 2012 | Blog post | Distinguishes filter words (perceptual distancing) from hedging (epistemic distancing). Cites Burroway's *On Writing*. |
| 12 | TV Tropes | "Electric Love" | ongoing | Trope page | Documents the electricity/magnetism metaphor for romantic attraction as a recognized cross-media trope. |
| 13 | Ellen Brock | "Novel Boot Camp #3: How Not to Suck at Similes" | 2015 | Blog post | Weak and distancing simile constructions as marks of unrevised prose. |

---

## Appendix B -- Example Corpus

### AI-generated examples showing the problem

These are representative examples of the patterns as they appear in AI-generated fiction prose:

**HQ-1 (Perhaps/Maybe):**
> Perhaps the shadows were longer than they should have been. Maybe it was just her imagination, but the corridor seemed narrower somehow.

Three hedges in two sentences: "perhaps," "maybe," "somehow." The narrator declines to commit to anything. Compare the published example below.

**HQ-2 (It was as though/if):**
> It was as though the entire world had gone silent, and it was as if time itself had paused to hold its breath.

Double use of the distancing simile in one sentence. The "it was" frame distances from the POV character. Note the personification of time (another AI default).

**HQ-3 (In a way that):**
> She spoke in a way that suggested she had been thinking about this for a long time, her eyes fixed on the horizon in a way that made him uncomfortable.

Two "in a way that" constructions -- neither describes the specific manner. What did her speech sound like? What was her expression?

**HQ-4 (Something like):**
> Something like grief settled over her, mixed with something like relief and something like the feeling of watching a door close for the last time.

Triple "something like" -- the narrator cannot commit to any of three emotions. The final one is not even an emotion but a simile hedged by "something like."

**HQ-5 (Almost as if):**
> The silence was heavy, almost as if the room itself was holding its breath, waiting for someone to speak.

Double hedge (almost + as if) plus room personification plus "waiting" participial -- three AI tells in one sentence.

**HQ-6 (Sort of/Kind of):**
> She kind of smiled, then sort of shrugged, like she hadn't really made up her mind about anything.

Three hedges in narration that should be dialogue-register language. In close-third narration, this reads as the model being imprecise, not a character being casual.

**HQ-7 (A certain/Some kind of):**
> There was a certain tension in the room, some kind of unspoken understanding that hung between them.

"A certain tension" and "some kind of understanding" -- both gesture at specificity without delivering it.

**HQ-8 (Somehow/Somewhat):**
> Somehow, she knew he was lying. She felt somewhat relieved by this, though she couldn't have explained why.

"Somehow" papers over a missing causal chain. "Somewhat" softens the emotion. "Couldn't have explained why" is a third hedge. Three layers of the narrator declining to do the work of showing.

**HQ-9 (It/There seemed):**
> It seemed darker than before, and there seemed to be a figure standing at the far end of the corridor, though it was hard to tell in the dim light.

"It seemed," "there seemed," "it was hard to tell" -- triple hedge. Either the corridor is darker and there's a figure, or describe the visual confusion concretely.

**HQ-10 (Couldn't help but):**
> She couldn't help but notice the way his hands trembled, and she couldn't help but wonder if he felt the same way.

Double "couldn't help but" -- the narrator frames both noticing and wondering as involuntary. Let the character notice and wonder directly.

**HQ-11 (Electricity metaphor):**
> Electricity crackled between them, an invisible current that seemed to pulse with every accidental touch. The magnetism was undeniable.

Three electricity-domain metaphors in two sentences. None describe what the character actually feels physically.

**HQ-12 (Air/Atmosphere):**
> The air between them thickened, charged with an unspoken tension that neither dared to acknowledge. The atmosphere shifted as their eyes met.

"Air thickened" + "charged" + "atmosphere shifted" -- the environment is doing the emotional work. What does the POV character's body do?

### Published fiction showing correct usage

**Commitment over hedging (Cormac McCarthy, *Blood Meridian*):**
> The man sat alone in the darkened room. The shadows pooled at his feet like something spilled.

No hedges. "Like something spilled" is a concrete simile attached to a concrete subject (shadows), not routed through "it was as though."

**Direct sensation over electricity metaphor (Toni Morrison, *Beloved*):**
> She moved closer. He did not move back. The warmth of her was everywhere.

No electricity, no magnetism. "The warmth of her was everywhere" is a concrete physical sensation grounded in the POV character's perception.

**Character uncertainty without hedging (Kazuo Ishiguro, *Never Let Me Go*):**
> I'm not sure now if I'm remembering it right.

First-person narrator expressing genuine uncertainty through a direct statement, not "perhaps" or "somehow." The uncertainty is the content, not a hedge on the content.

**Atmosphere through concrete detail (Raymond Chandler, *The Big Sleep*):**
> The air was thick with the brandy smell of dead leaves.

Concrete sensory detail. The air is described through smell, not through abstract emotional projection. Compare to "The air thickened with tension."

**Emotional response without "couldn't help but" (Denis Johnson, *Jesus' Son*):**
> I knew I was going to die. I looked at my hand. It was the size of a glove.

Direct perception, no involuntary framing, no hedging. The shock is rendered through the distorted perception (hand looking glove-sized), not through "I couldn't help but notice my hand looked strange."
