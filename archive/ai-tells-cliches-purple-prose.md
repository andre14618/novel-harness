---
status: reference
verified: 2026-04-03
---

# AI Tells: Cliche Lexicon and Purple Prose

> **Date:** 2026-04-03
> **Scope:** AI-overused phrases, dead metaphors, purple prose density, adjective stacking

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [Background](#background)
- [Part I: AI Cliche Patterns](#part-i-ai-cliche-patterns)
- [Part II: Purple Prose Heuristics](#part-ii-purple-prose-heuristics)
- [Pattern Summary Table](#pattern-summary-table)
- [Measurement Strategy](#measurement-strategy)
- [Appendix A — Source Citations](#appendix-a--source-citations)
- [Appendix B — AI Cliche Corpus](#appendix-b--ai-cliche-corpus)
- [Appendix C — Purple Prose Examples](#appendix-c--purple-prose-examples)

---

## Executive Summary

This report proposes **15 AI cliche patterns** (category `AI_CLICHE`, Tier 2) and **3 purple prose heuristics** (category `PURPLE_PROSE`, Tier 3) for addition to the novel harness lint system.

**Pattern counts by category:**

| Category | Count | Tier | Detection Method |
|---|---|---|---|
| AI_CLICHE | 15 | 2 | Regex with context scoping |
| PURPLE_PROSE | 3 | 3 | Heuristic (counting/density) |

**False positive risk assessment:** Most AI cliche patterns carry Low to Medium FP risk because they target specific multi-word constructions that rarely appear in skilled prose. The higher-risk patterns (AC-9 "something about him/her," AC-15 "shiver down spine") are mitigated by tight regex scoping. Purple prose heuristics carry Medium-High FP risk because density thresholds require calibration against the existing novel corpus before deployment.

**Integration approach:** AI_CLICHE patterns slot directly into the existing `lint_patterns` table as Tier 2 regex entries alongside FILTER_WORD patterns. PURPLE_PROSE heuristics require new functions in `src/lint/index.ts` that operate on paragraph-level windows rather than single-regex matches.

---

## Background

### Why AI Models Produce Cliche Clusters

Large language models generate text by predicting the most probable next token given the context. This statistical process creates a gravitational pull toward high-frequency phrases in the training corpus. When RLHF (reinforcement learning from human feedback) further optimizes for outputs that human raters judge as "good writing," the result is a convergence on phrases that *sound* literary without doing literary work: metaphors so common they have become invisible, emotional shorthand that names feelings rather than creating them.

A 2024 study from the Max Planck Institute demonstrated that words like "delve," "robust," and "pivotal" spiked in usage by over 50% in published essays and online articles after ChatGPT's release (Kobak et al., 2024). The Wikipedia editorial community maintains a living document cataloging AI writing signs, organized by era: 2023-mid-2024 tells include "tapestry," "testament," "vibrant," and "meticulous"; mid-2024-mid-2025 shifted to "emphasizing," "enhance," "fostering," and "showcasing" (Wikipedia, "Signs of AI Writing").

In fiction specifically, the problem is more insidious. AI models do not merely overuse transition words or formal vocabulary — they overuse *emotional shorthand*. Phrases like "the weight of the silence," "something shifted between them," and "a breath she didn't know she'd been holding" are the fiction equivalents of "delve" in nonfiction. They perform the appearance of emotional depth through dead metaphor rather than earning it through concrete sensory detail.

### Why Purple Prose Is an AI Tell

Models lack what Stephen King in *On Writing* calls the revision instinct — the ability to recognize when description has crossed from evocative into self-indulgent. King writes: "The road to hell is paved with adverbs" and argues that overwriting is a sign of fear: "Adverbs, like the passive voice, seem to have been created with the timid writer in mind" (King, 2000). AI models have no fear, but they have an analogous problem: they have no *restraint*. They generate prose by predicting what sounds good next, and three adjectives sound three times as good as one.

Strunk and White's *The Elements of Style* captures the principle concisely: "Vigorous writing is concise. A sentence should contain no unnecessary words, a paragraph no unnecessary sentences, for the same reason that a drawing should have no unnecessary lines and a machine no unnecessary parts" (Strunk & White, 1959). Constance Hale in *Sin and Syntax* extends this to adjectives specifically, citing Mark Twain: "When you catch an adjective, kill it" — and adding that "the stronger the word, the more room it needs in a sentence" (Hale, 1999). AI models violate both principles systematically because they cannot evaluate whether a word is *earning its place*.

The CRAFT Literary journal observed that AI "is trained to generate phrase patterns; it is not trained to generate silence" (Hartenberger, 2025). This inability to omit — to choose what *not* to say — is what makes purple prose and cliche clustering reliable AI fingerprints.

### The Craft Case Against Dead Metaphors

George Orwell wrote in "Politics and the English Language" (1946) that a dead metaphor "has in effect reverted to being an ordinary word and can generally be used without loss of vividness." But in fiction, the problem is worse: dead metaphors *pretend* to be vivid. "A wave of grief" wears the costume of concrete imagery while delivering only abstraction. The reader gets the label "grief" wrapped in a metaphor so worn that it adds nothing.

September C. Fawkes, analyzing purple prose at Fiction University, identifies the core mechanism: "Purple prose consists of several long sentences, stacked adjectives, lots of adverbs, too many metaphors or similes, and ornate language" that "draws excessive attention to itself while lacking substance" (Fawkes, 2018). When AI generates these patterns, it creates prose that is simultaneously overwrought and emotionally flat — describing heartbreak without inflicting it (Wilson, 2026).

---

## Part I: AI Cliche Patterns

### AC-1: The Weight of [Abstract Noun]

**What:** "The weight of [silence/guilt/grief/loss/responsibility/decision/words/absence/truth/moment]" — using physical weight as a metaphor for emotional burden.

**AI prevalence:** AI models reach for "weight" as a default metaphor for emotional significance because it appears across thousands of training examples in literary fiction, self-help writing, and journalism. The construction is maximally "literary-sounding" with minimal specificity, making it a high-probability token sequence.

**Detection approach:**
- Regex: `\bthe\s+weight\s+of\s+(the\s+)?(silence|guilt|grief|loss|responsibility|decision|moment|words|absence|truth|realization|unspoken|everything|it\s+all|what|her|his|their)\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Replace the abstraction with a physical sensation — pressure in the chest, heaviness in the limbs, inability to move. Show the weight, don't name it."

**Writer prompt rule:** "NEVER write 'the weight of [emotion/abstraction].' If something feels heavy, describe the physical sensation: posture collapse, difficulty breathing, limbs that won't cooperate."

**Effort:** Low

**False positive risk:** Low
- Mitigation: The regex targets abstract/emotional nouns specifically. "The weight of the armor" or "the weight of the stone" will not match because those nouns are not in the list.
- Edge cases: "The weight of her words" could be legitimate if the character is literally measuring the impact of specific words in a calculated way. The rewriter should judge.

**Craft rationale:** Strunk & White: "Omit needless words" — the construction adds a metaphorical frame that contributes nothing the reader cannot infer from context (Strunk & White, 1959). Orwell: dead metaphors "have lost all evocative power and are merely used because they save people the trouble of inventing phrases for themselves" (Orwell, 1946). King: description should be grounded in concrete sensory detail, not abstract labeling (King, 2000).

**Verdict:** DO IT

---

### AC-2: The Silence Stretched / Hung / Settled / Thickened

**What:** Personifying silence as a physical substance that stretches, hangs, settles, thickens, or fills a room. "The silence stretched between them." "A heavy silence settled over the room."

**AI prevalence:** This is one of the most commonly observed AI fiction tells. LLMs treat silence as a scene-setting device and reach for it as a default beat between dialogue lines or emotional moments. The construction appears in virtually every genre of AI-generated fiction.

**Detection approach:**
- Regex: `\b(the\s+|a\s+|an?\s+\w+\s+)?silence\s+(stretched|hung|settled|thickened|filled|descended|fell|pressed|grew|lingered|deepened|dragged|swallowed|enveloped|blanketed)\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Cut the silence sentence entirely, or replace with a concrete detail: what does the character hear in the silence? A clock, breathing, traffic, their own heartbeat. Or use the silence as a beat by showing what the character *does* during it."

**Writer prompt rule:** "NEVER personify silence as stretching, hanging, settling, or thickening. If a pause matters, show what fills it: a character fidgeting, a sound intruding, an impulse suppressed."

**Effort:** Low

**False positive risk:** Low
- Mitigation: The two-part construction (silence + specific verb) is distinctive enough to avoid matching unrelated uses.
- Edge cases: In horror or surrealist fiction, personified silence may be a deliberate genre convention. The rewriter should judge based on genre context.

**Craft rationale:** Hartenberger (2025) observes that AI "is not trained to generate silence" — instead it fills pauses with description of the pause itself, which is the opposite of letting silence do narrative work. King (2000): good description is grounded in concrete detail, not in telling the reader that silence exists.

**Verdict:** DO IT

---

### AC-3: Something Shifted (In/Between)

**What:** "Something shifted between them." "Something shifted in his expression." "Something shifted in the air." A vague invocation of change without specifying what changed.

**AI prevalence:** Extremely high. "Something shifted" is the AI equivalent of a scene transition — it signals that an emotional beat has occurred without committing to what the beat actually is. LLMs use this as a bridge between dialogue and internal reflection.

**Detection approach:**
- Regex: `\bsomething\s+(shifted|changed|passed|broke|snapped|clicked|loosened|tightened|cracked|stirred)\s+(in|between|within|behind|across)\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Name what shifted. Was it the character's understanding? Their posture? The dynamic between them? Replace the vague 'something' with the specific change."

**Writer prompt rule:** "NEVER write 'something shifted' — it is the prose equivalent of a placeholder. Name the change: a realization, a physical reaction, a shift in eye contact, a dropped pretense."

**Effort:** Low

**False positive risk:** Low
- Mitigation: Requires both "something" + specific verb + preposition, which is a very distinctive AI construction.
- Edge cases: In mystery/thriller POV where the character genuinely cannot identify what changed, this *might* be legitimate — but even then, concrete uncertainty ("His jaw tightened, though she couldn't say why") is stronger.

**Craft rationale:** Hale (1999): strong prose replaces vague constructions with precise ones. The problem is not the word "something" but the refusal to commit to specifics. Fawkes (2018): purple prose "lacks substance" — this pattern is a textbook example of giving the reader an emotional label wrapped in vagueness.

**Verdict:** DO IT

---

### AC-4: A Flicker of [Emotion/Abstract]

**What:** "A flicker of recognition." "A flicker of something she couldn't name." "A flicker of doubt crossed his face." The "flicker" metaphor applied to internal states.

**AI prevalence:** High. "Flicker" is an AI-favorite emotion verb because it implies brevity and subtlety — two qualities AI prose aspires to but rarely achieves. The construction appears in nearly every AI-generated scene involving interpersonal tension.

**Detection approach:**
- Regex: `\ba\s+flicker\s+of\s+(something|recognition|doubt|surprise|emotion|fear|hope|anger|amusement|irritation|pain|hesitation|interest|warmth|concern|understanding|uncertainty|awareness|guilt|sadness|curiosity|defiance|vulnerability|unease|discomfort)\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Replace with a concrete physical detail: a tightened jaw, a quick glance away, fingers curling. Show the emotion through the body, not through a 'flicker of [label].'"

**Writer prompt rule:** "NEVER write 'a flicker of [emotion].' Emotions do not flicker — faces do. Show the physical micro-expression: a narrowed eye, a twitch at the corner of the mouth, a hand that pauses mid-gesture."

**Effort:** Low

**False positive risk:** Low
- Mitigation: The regex requires "a flicker of" + an abstract/emotional noun. "A flicker of candlelight" or "a flicker of the screen" will not match.
- Edge cases: "A flicker of recognition" in a scene where literal flickering light causes a character to recognize something. Extremely rare; rewriter should judge.

**Craft rationale:** This is a specific instance of the DECLARED_EMOTION pattern (already in Tier 3) but is called out separately because AI models use "flicker" at vastly higher rates than human writers. King (2000): show, don't tell — naming the emotion bypasses the reader's experience. The "flicker" wrapper merely adds a dead metaphor to the telling.

**Verdict:** DO IT

---

### AC-5: The Air Between/Around Them

**What:** "The air between them charged/shifted/thickened/crackled/hummed." "Something in the air changed." The air as a vessel for emotional tension.

**AI prevalence:** Very high. AI models use "the air" as a catch-all metaphor for interpersonal dynamics. It is the spatial equivalent of "something shifted" — a way to externalize internal states without committing to what anyone actually feels.

**Detection approach:**
- Regex: `\bthe\s+air\s+(between|around|surrounding)\s+(them|her|him|us)\s+(felt\s+)?(charged|shifted|thickened|crackled|hummed|grew|changed|turned|became|seemed|was)\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Cut the sentence. Show the tension through character behavior: averted eyes, a step backward, a voice that drops in register. The air does not have feelings — people do."

**Writer prompt rule:** "NEVER describe 'the air between them' as charged, thickened, or shifted. If tension exists between characters, show it through what they do, say, or avoid saying."

**Effort:** Low

**False positive risk:** Low
- Mitigation: Requires the full construction: "the air" + spatial preposition + pronoun + emotional verb. Weather descriptions ("the air around them grew cold") could match but are rare in this exact syntactic shape.
- Edge cases: Literal temperature change in the air (magic systems, environmental descriptions). Rewriter should judge.

**Craft rationale:** Wilson (2026) identifies this as a core AI pattern: "AI pads and performs emotion instead of expressing it." Describing the air is a deflection from describing the characters. Strunk & White (1959): prefer the concrete to the abstract.

**Verdict:** DO IT

---

### AC-6: Hung/Settled In/Over the Air/Room/Space

**What:** "The words hung in the air." "A chill settled over the room." "Tension hung between them." "Grief settled in the space." Emotions or statements treated as physical objects suspended in space.

**AI prevalence:** High. This is the companion pattern to AC-2 (silence personification) and AC-5 (air as vessel). AI models externalize emotions by placing them in the room's atmosphere, creating a consistent pattern of *decorating the space* rather than *inhabiting the characters*.

**Detection approach:**
- Regex: `\b(words?|tension|question|threat|accusation|implication|promise|truth|lie|silence|grief|sadness|anger|fear|dread|unease)\s+(hung|settled|lingered|hovered|floated)\s+(in|over|between|across|throughout)\s+(the\s+)?(air|room|space|silence|gap|void|darkness)\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Cut the sentence or replace with character reaction. After a loaded statement, show the listener's response: what they do with their hands, whether they look away, how long before they speak."

**Writer prompt rule:** "NEVER describe words, tension, or emotions as 'hanging in the air' or 'settling over the room.' After a significant moment, show character reactions — not atmospheric effects."

**Effort:** Low

**False positive risk:** Medium
- Mitigation: The regex requires a specific emotional/verbal subject + a suspension verb + spatial preposition + location noun. This is a five-part construction unlikely to appear in non-cliche usage.
- Edge cases: "Smoke hung in the air" (literal, not emotional) will not match because "smoke" is not in the subject list. "The words hung in the air like a threat" — adding a simile does not make the cliche more original.

**Craft rationale:** Orwell (1946): "A newly invented metaphor assists thought by evoking a visual image, while a dead metaphor has in effect reverted to being an ordinary word." The "hung in the air" construction has fully reverted — it evokes nothing visual. Hale (1999): prefer strong verbs attached to real subjects.

**Verdict:** DO IT

---

### AC-7: The World Fell Away / Narrowed / Shifted

**What:** "The world fell away." "The world narrowed to just the two of them." "The world shifted beneath her feet." "Everything else faded." Using "the world" as a subject for emotional focus.

**AI prevalence:** High. AI models use "the world" constructions to signal moments of intense focus or emotional significance. It is a macro-level version of the "something shifted" pattern — applying the change to the entire environment rather than to the characters.

**Detection approach:**
- Regex: `\b(the\s+world|everything(\s+else)?|the\s+rest\s+of\s+the\s+world|reality|the\s+room|the\s+noise|the\s+sounds?)\s+(fell\s+away|narrowed|shifted|faded|blurred|dissolved|disappeared|melted|receded|shrank|tilted|went\s+quiet|went\s+still|went\s+silent|ceased\s+to\s+exist|ceased\s+to\s+matter)\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Show the focus through sensory narrowing: what the character stops hearing, what they see in sharp detail, what they forget they were doing. Don't announce it — create it."

**Writer prompt rule:** "NEVER write 'the world fell away' or 'everything else faded.' Instead, narrow the sensory channel: describe only what the character perceives in the moment of focus, and let the absence of other details create the effect."

**Effort:** Low

**False positive risk:** Low
- Mitigation: The regex requires "the world/everything/reality" + a specific emotional verb. Literal descriptions ("the world shifted on its axis" in sci-fi) could match but are rare in the exact listed forms.
- Edge cases: In fantasy/sci-fi where reality literally shifts or dissolves. Rewriter should judge based on context.

**Craft rationale:** King (2000) argues for showing through concrete detail rather than announcing emotional states. "The world fell away" is a maximally abstract announcement. Fawkes (2018): purple prose "draws excessive attention to itself" — this construction is a spotlight aimed at its own drama.

**Verdict:** DO IT

---

### AC-8: Couldn't Quite Place/Name/Identify the Feeling

**What:** "She couldn't quite place the feeling." "He couldn't name the emotion." "There was something she couldn't identify." The narrator acknowledging a feeling exists while refusing to specify it.

**AI prevalence:** High. This construction lets AI models signal emotional complexity without generating the specific, nuanced observation that would actually demonstrate it. It is a placeholder masquerading as depth.

**Detection approach:**
- Regex: `\bcouldn'?t\s+(quite\s+)?(place|name|identify|describe|put\s+(her|his|their|a)\s+(finger\s+on|words?\s+to)|explain|articulate|define|pin\s*down)\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Commit to the feeling. If the character is confused, show the confusion through contradictory impulses or physical restlessness. If the character recognizes the emotion but resists naming it, show the resistance — not the inability."

**Writer prompt rule:** "NEVER write that a character 'couldn't quite place' or 'couldn't name' a feeling. Either name it through physical detail, or show the character's confusion through action — not by announcing that confusion exists."

**Effort:** Low

**False positive risk:** Medium
- Mitigation: The regex targets the specific "couldn't + qualifier + naming verb" construction. "Couldn't place the book on the shelf" (physical) will not match because "place" requires the qualifier "quite" or the construction lacks an emotional context.
- Edge cases: In mystery/thriller POV where the inability to identify is plot-relevant (e.g., a character trying to identify a poison by taste). Rewriter should judge.

**Craft rationale:** Hale (1999): "the stronger the word, the more room it needs in a sentence." This construction occupies space while delivering nothing. King (2000): the writer's job is to find the right word, not to announce that the right word cannot be found.

**Verdict:** DO IT

---

### AC-9: Something About Him/Her/Them

**What:** "There was something about her that..." "Something about his voice made her..." "Something about the way they..." A vague attribution of significance without specifying what the "something" is.

**AI prevalence:** High. This is the characterization equivalent of "something shifted" — it signals that a character is interesting or affecting without doing the work of showing why. AI models use it as a bridge to emotional beats.

**Detection approach:**
- Regex: `\b(there\s+was\s+)?something\s+about\s+(him|her|them|his|her|their|the\s+way)\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Name the 'something.' Is it the angle of their jaw? The way they hold their coffee cup? The fact that they make eye contact a beat too long? Replace vagueness with the specific detail that creates the effect."

**Writer prompt rule:** "NEVER write 'there was something about her.' Find the specific detail that creates the impression and describe it directly."

**Effort:** Low

**False positive risk:** Medium
- Mitigation: The regex targets the specific "something about + pronoun/possessive" construction. The broader "something about" (e.g., "something about this place") is included through "the way" but is relatively narrow.
- Edge cases: First-person narration where the character is genuinely processing an unclear impression and the vagueness serves the POV. Rewriter should evaluate whether the narrator has had time to process.

**Craft rationale:** Strunk & White (1959): "Prefer the specific to the general." This construction is the general masquerading as the specific. Hale (1999) argues that strong prose names what it sees — "something about" is the opposite, a refusal to look closely.

**Verdict:** DO IT

---

### AC-10: A Familiar/Unfamiliar Ache/Pang/Tug

**What:** "A familiar ache settled in her chest." "An unfamiliar pang of jealousy." "A tug of something she couldn't name." Emotional sensations described through generic physical metaphors prefixed with familiarity markers.

**AI prevalence:** High. AI models combine the DECLARED_EMOTION pattern (Tier 3) with familiarity markers to create the appearance of characterization — implying the character has a history with this emotion — while still delivering a generic label.

**Detection approach:**
- Regex: `\b(a|the|that)\s+(familiar|unfamiliar|old|strange|sudden|sharp|dull|deep)\s+(ache|pang|tug|pull|twist|knot|hollow|heaviness|tightness|prickle|sting)\s+(of|in|behind|settled|formed|bloomed|spread|radiated)\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Replace with the specific physical sensation and its location. 'A familiar ache in her chest' → 'The old tightness behind her sternum, the one that showed up every time she drove past the house.' Ground it in this character's specific history."

**Writer prompt rule:** "NEVER write 'a familiar ache' or 'an unfamiliar pang.' These are emotional fill-in-the-blanks. Describe the specific sensation, locate it in the body, and connect it to a concrete memory or trigger unique to this character."

**Effort:** Low

**False positive risk:** Medium
- Mitigation: The regex requires a familiarity adjective + body-sensation noun + continuation. This three-part construction is specific enough to filter out legitimate single uses of these words.
- Edge cases: In literary fiction with deliberate callback structure, "the familiar ache" might reference a specific earlier scene. Rewriter should check whether the sensation has been established concretely elsewhere.

**Craft rationale:** King (2000): "Description begins in the writer's imagination, but should finish in the reader's." This construction starts and finishes in abstraction — the reader never gets a concrete image. The DECLARED_EMOTION pattern (Tier 3) already covers "a wave of grief"; this catches the variant where familiarity is used as a false-depth marker.

**Verdict:** DO IT

---

### AC-11: Let Out a Breath [Didn't Know] [Been Holding]

**What:** "She let out a breath she didn't know she'd been holding." One of the most widely recognized fiction cliches, dramatically amplified by AI usage.

**AI prevalence:** Extremely high. This phrase was already a cliche before LLMs, but AI models deploy it with such regularity that it has become a primary AI fiction tell. It appears in romance, thriller, fantasy, and literary fiction AI output with near-universal frequency.

**Detection approach:**
- Regex: `\b(let\s+out|released|exhaled)\s+(a\s+|the\s+)?breath\s+(s?he|they|I|she|he)\s+(didn'?t|hadn'?t|did\s+not|had\s+not)\s+(know|realize|notice)`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Cut entirely. If the character's tension-release matters, show it through a different physical channel: shoulders dropping, fingers unclenching, a jaw relaxing. The breath-holding cliche has been used so many times it communicates nothing."

**Writer prompt rule:** "NEVER write 'let out a breath she didn't know she'd been holding.' This is the single most recognized AI fiction cliche. Show tension release through shoulders dropping, hands unclenching, or muscles loosening."

**Effort:** Low

**False positive risk:** Low
- Mitigation: This exact construction is almost always a cliche, whether written by AI or human. Flagging it is always helpful feedback.
- Edge cases: None significant. Even in first-person narration, this has been used so frequently that it reads as lazy writing regardless of context.

**Craft rationale:** This phrase appears on virtually every "fiction cliches to avoid" list, including those from NY Book Editors, MasterClass, LitReactor, and Writer's Digest. It was identified as a cliche long before AI made it ubiquitous. BuzzFeed's "17 Overused Phrases You've Probably Seen In Every Book" lists it prominently (Emanuel, 2024). King (2000): rely on specific detail, not stock phrases.

**Verdict:** DO IT

---

### AC-12: Eyes [Didn't Know] [Been Searching/Looking]

**What:** "Eyes she didn't know she'd been searching for." "Eyes he hadn't realized he'd been avoiding." A variant of the AC-11 pattern applied to eye contact rather than breath.

**AI prevalence:** High. This is a less-recognized variant of the AC-11 construction but appears frequently in AI-generated romance and literary fiction. The construction follows the same template: body action + didn't know + progressive verb.

**Detection approach:**
- Regex: `\beyes\s+(s?he|they|I)\s+(didn'?t|hadn'?t|did\s+not|had\s+not)\s+(know|realize)\s+(s?he'?d|they'?d|I'?d)\s+been\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Cut and replace with a specific observation about the eyes or the moment of eye contact. What color are they? What expression do they hold? What does the POV character actually notice?"

**Writer prompt rule:** "NEVER use the '[body part] didn't know [had been doing]' construction. It is a template, not a sentence. Describe the moment of recognition directly."

**Effort:** Low

**False positive risk:** Low
- Mitigation: The regex is very specific — it requires the exact "eyes + pronoun + negation + progressive" construction.
- Edge cases: Nearly none. The construction is so formulaic that it is always worth flagging.

**Craft rationale:** This is a variant of what the writing community calls the "didn't know they were [verb]-ing" template. It distances the reader from the experience by inserting a layer of retroactive narration. Strunk & White (1959): prefer direct statements.

**Verdict:** DO IT

---

### AC-13: Voice Barely Above a Whisper

**What:** "Her voice was barely above a whisper." "He spoke in a voice barely above a whisper." "His voice, barely above a whisper, carried across the room."

**AI prevalence:** High. AI models use this construction as a default for emotionally charged dialogue. It is a volume descriptor that has become a cliche through overuse — it tells the reader the character is speaking quietly rather than making the dialogue itself feel quiet.

**Detection approach:**
- Regex: `\bvoice\s+(was\s+)?(barely|hardly|scarcely)\s+(above|more\s+than)\s+(a\s+)?whisper\b`
- Flags: `gi`
- dialogue_ok: false

**fix_template:** "Cut the volume descriptor. If the quiet voice matters, show it through the listener straining to hear, leaning closer, or asking the speaker to repeat. Or use a dialogue tag: 'she whispered.'"

**Writer prompt rule:** "NEVER write 'voice barely above a whisper.' If a character speaks quietly, either use 'whispered' as a tag or show the listener straining to hear."

**Effort:** Low

**False positive risk:** Low
- Mitigation: The exact multi-word construction is distinctive. "Barely a whisper" or "whisper-quiet" would not match.
- Edge cases: None significant. The construction is always weaker than the alternatives.

**Craft rationale:** King (2000) argues that dialogue tags should be invisible — "said" is almost always sufficient. The "barely above a whisper" construction is an extended tag that does the work a simple "whispered" could handle. It is telling the reader about volume rather than creating the experience of quiet through pacing and context.

**Verdict:** DO IT

---

### AC-14: Tension [Didn't Realize] [Been Carrying]

**What:** "She released tension she didn't realize she'd been carrying." "The tension he hadn't known he was holding in his shoulders." A body-tension variant of the AC-11 breath pattern.

**AI prevalence:** High. This is the third member of the "didn't know [had been doing]" template family. AI models deploy it as a scene-ending release beat, especially after confrontations or revelations.

**Detection approach:**
- Regex: `\b(tension|tightness|stiffness|knot)\s+(s?he|they|I)\s+(didn'?t|hadn'?t|did\s+not|had\s+not)\s+(know|realize|notice)\s+(s?he'?d|they'?d|I'?d)\s+been\s+(carrying|holding|clenching)\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Show the release through specific body language: rolling the neck, stretching fingers that had been balled, pressing palms into lower back. Ground the tension release in the body without the retroactive-awareness framing."

**Writer prompt rule:** "NEVER use the 'tension [pronoun] didn't know they'd been carrying' construction. Show the physical release directly — shoulders dropping, jaw unclenching, hands opening."

**Effort:** Low

**False positive risk:** Low
- Mitigation: Extremely specific regex — requires the exact "[noun] + [pronoun] + [negated awareness] + [progressive carrying/holding]" template.
- Edge cases: None. This is always a cliche.

**Craft rationale:** Same as AC-11 and AC-12. The "didn't know [had been doing]" template is a three-pronged AI cliche family. Each variant wraps a simple physical action in a retroactive-awareness frame that distances the reader from the experience. Hale (1999): cut the frame, keep the action.

**Verdict:** DO IT

---

### AC-15: Sent a Shiver Down [His/Her/Their] Spine

**What:** "The words sent a shiver down her spine." "A chill ran down his spine." "Something sent a shiver through her." Stock physical-reaction cliche for fear, excitement, or dread.

**AI prevalence:** High. This is a pre-AI cliche that LLMs have amplified significantly. AI models reach for it as a default fear/excitement response because it is a high-frequency training-data phrase.

**Detection approach:**
- Regex: `\b(sent|ran|crawled|crept|shot|traced)\s+(a\s+)?(shiver|chill|cold|tingle|thrill)\s+(down|up|through|along)\s+(his|her|their|my|the)\s+(spine|back|body|arms?|neck)\b`
- Flags: `gi`
- dialogue_ok: true

**fix_template:** "Replace with a specific physical reaction: goosebumps on the forearms, the hair on the back of the neck lifting, a sudden need to look over the shoulder, skin prickling. The spine-shiver is too generic to create sensation."

**Writer prompt rule:** "NEVER write 'a shiver down the spine.' Show the fear/excitement through a specific physical reaction unique to this character and moment: goosebumps, a flinch, a sudden awareness of every exit in the room."

**Effort:** Low

**False positive risk:** Medium
- Mitigation: The regex requires the full construction: action verb + sensation noun + directional preposition + body part. Partial matches are unlikely.
- Edge cases: In horror/thriller fiction, spine-related physical sensations are a genre convention. The pattern is still a cliche, but the rewriter may need to work harder to find an alternative that fits the genre tone.

**Craft rationale:** This appears on virtually every "fiction cliches to avoid" list. MasterClass (2026): "cliches rely on overly familiar language" — this is one of the most familiar physical-reaction descriptions in English. The craft fix is always the same: specificity. What does *this* fear feel like to *this* character in *this* moment?

**Verdict:** DO IT

---

## Part II: Purple Prose Heuristics

### PP-1: Adjective Stacking

**What:** Three or more adjectives modifying a single noun within the same noun phrase. "The dark, cold, unforgiving night." "Her long, tangled, rain-soaked hair." "A vast, empty, lifeless expanse."

**Detection approach:**

Algorithm:
1. Tokenize the text into sentences.
2. For each sentence, use a lightweight POS-tagging heuristic or adjective word list to identify adjective sequences.
3. Count consecutive adjectives (separated by commas, "and," or directly adjacent) before a noun.
4. Flag when count >= 3.

Implementation sketch:
```
const ADJ_PATTERN = /(?:\b\w+(?:ly|ous|ive|ful|less|ing|ed|en|al|ant|ent|ic|ish|ary|ory|able|ible)\b[,\s]+){2,}\b\w+(?:ly|ous|ive|ful|less|ing|ed|en|al|ant|ent|ic|ish|ary|ory|able|ible)\b\s+(?=\b[a-z]+\b)/gi

function detectAdjectiveStacking(text: string): LintIssue[] {
  // Split into sentences
  // For each sentence, find runs of 3+ comma-separated or
  // adjacent adjective-shaped words before a noun
  // Use suffix heuristic: -ous, -ive, -ful, -less, -ing, -ed,
  //   -en, -al, -ant, -ent, -ic, -ish, etc.
  // Plus a curated list of common adjectives without
  //   distinctive suffixes: dark, cold, old, new, big, small,
  //   long, deep, wide, thin, pale, warm, soft, hard, bright,
  //   sharp, dull, raw, wet, dry, red, blue, black, white, gray
  // Flag matches where 3+ adjectives precede the same noun
}
```

Suggested threshold: Flag at 3+ adjectives. This catches the most egregious stacking while allowing "dark, cold night" (2 adjectives) which is within normal prose range.

**fix_template:** "Cut to the single strongest adjective. If two are essential, they must do different work (one sensory, one emotional). Three or more adjectives before a noun is always overwriting."

**Effort:** Medium (requires adjective-detection heuristic, not just regex)

**False positive risk:** Medium-High
- Calibration needed: Run against existing novel corpus to establish baseline rate. Intentional literary style (Faulkner, Nabokov) may use adjective stacking deliberately.
- Mitigation: Only flag 3+ (not 2+). Skip sentences in dialogue. Consider allowing stacking in the first sentence of a chapter (establishing shots).
- The suffix-based heuristic will miss some adjectives (e.g., "dark" has no adjective suffix) and false-positive on some non-adjectives (e.g., "running" as a gerund). A curated common-adjective list supplements the suffix approach.

**Craft rationale:** Hale (1999) cites Mark Twain: "When you catch an adjective, kill it." She argues that "the stronger the word, the more room it needs in a sentence" — three adjectives compete for the reader's attention and weaken each other. Strunk & White (1959): "Write with nouns and verbs, not with adjectives and adverbs." King (2000): "I believe the road to hell is paved with adverbs, and I will shout it from the rooftops." Liz Verity (2025) identifies "too many adjectives or adverbs with descriptions crammed alongside one another" as the primary diagnostic for purple prose. Fiction University (Hardy, 2010) recommends: "Go through your writing and highlight your adjectives. If you're seeing a ton of descriptions for everything, it's a pretty good indicator that you've got some purple prose."

**Verdict:** DO IT (with calibration phase)

---

### PP-2: Simile Density

**What:** More than 2 similes in a single paragraph. "Her voice was like honey. The room felt as cold as a tomb. His eyes burned like embers." Simile clustering creates an overwrought, try-hard effect.

**Detection approach:**

Algorithm:
1. Split text into paragraphs (double newline or indentation).
2. For each paragraph, count simile markers: `like a`, `like the`, `like an`, `as a`, `as the`, `as an`, `as if`, `as though`, `resembled`, `reminded her/him of`.
3. Exclude known non-simile uses: "looked like" (could be literal appearance), "felt like" (could be texture), "sounded like" (could be literal sound). Use a conservative count.
4. Flag paragraphs with count > 2.

Implementation sketch:
```
const SIMILE_MARKERS = [
  /\blike\s+a[n]?\s+\w+/gi,
  /\blike\s+the\s+\w+/gi,
  /\bas\s+(cold|hot|dark|bright|sharp|smooth|hard|soft|quiet|loud|still|fast|slow|heavy|light|sweet|bitter|deep|thin|thick|pale|white|black|red|blue|green|old|young|dead|dry|wet|empty|full|clean|dirty|rough|flat|round|clear|tall|short|wild|tame|rich|poor|blind|bare|raw)\s+as\b/gi,
  /\bas\s+(if|though)\s+/gi,
]

function detectSimileDensity(text: string): LintIssue[] {
  // Split into paragraphs
  // For each paragraph, count matches across all SIMILE_MARKERS
  // Deduplicate overlapping matches
  // Flag paragraphs where count > 2
}
```

Suggested threshold: >2 similes per paragraph. This allows normal simile usage (1-2 per paragraph is typical in literary fiction) while catching the density that signals overwriting.

**fix_template:** "Keep the strongest simile and cut the others. If two similes are doing different work (one visual, one auditory), they may both stay — but three or more in one paragraph overwhelms the reader."

**Effort:** Medium

**False positive risk:** Medium
- Calibration needed: Run against existing corpus to establish typical simile density per paragraph. Genre matters — romance and literary fiction use more similes than thriller.
- Mitigation: The threshold of >2 is conservative. "Like" in non-simile contexts ("I'd like to," "looked like she was leaving") must be filtered out.
- Dialogue paragraphs may naturally contain more simile-like language — consider a higher threshold (>3) for dialogue-heavy paragraphs.

**Craft rationale:** Strunk & White (1959): "The simile is a common device and a useful one, but similes coming in rapid succession are unlikely to be effective." September C. Fawkes (2018) lists "too many metaphors or similes" as a primary indicator of purple prose. The density problem is distinct from the quality problem — even good similes become noise when clustered.

**Verdict:** DO IT (with calibration phase)

---

### PP-3: Emotional Tell Density

**What:** More than 2 explicit emotion-naming constructions in a 3-sentence window. This is a density-based complement to the existing DECLARED_EMOTION patterns in Tier 3 — those catch individual instances, this catches *clustering*.

**Detection approach:**

Algorithm:
1. Split text into sentences.
2. For each sliding window of 3 consecutive sentences, count matches against a combined emotion-word list: the DECLARED_EMOTION regex subjects (angry, sad, happy, afraid, etc.) plus the DECLARED_EMOTION container nouns (wave, surge, pang, jolt, etc.).
3. Flag windows with count > 2.

Implementation sketch:
```
const EMOTION_WORDS = /\b(angry|sad|happy|afraid|scared|nervous|anxious|excited|frustrated|annoyed|furious|terrified|heartbroken|devastated|elated|thrilled|relieved|embarrassed|ashamed|guilty|jealous|lonely|confused|shocked|stunned|disgusted|horrified|delighted|overjoyed|miserable|desperate|hopeful|grateful|proud|content|grief|joy|rage|terror|panic|dread|shame|hope|love|hatred|jealousy|longing|anxiety|despair|excitement|frustration)\b/gi

const EMOTION_CONTAINERS = /\b(wave|surge|pang|jolt|rush|stab|flash|flicker|spark|burst|weight|knot|tug|pull|twist|hollow|heaviness|tightness|prickle|sting)\s+of\b/gi

function detectEmotionTellDensity(text: string): LintIssue[] {
  // Split into sentences
  // For each 3-sentence window:
  //   Count EMOTION_WORDS matches + EMOTION_CONTAINERS matches
  //   Skip matches inside dialogue
  //   Flag if count > 2
}
```

Suggested threshold: >2 emotion names per 3-sentence window. This catches the pattern where AI models dump multiple emotional labels in quick succession ("She felt a wave of grief. The guilt was overwhelming. A pang of regret shot through her.") while allowing individual emotion mentions.

**fix_template:** "This passage names too many emotions in quick succession. Pick the dominant emotion and show it through action and physical sensation. Cut the others — the reader can only feel one thing at a time."

**Effort:** Medium

**False positive risk:** Medium
- Calibration needed: Run against existing corpus to establish typical emotion-word density. Literary fiction with extensive internal monologue will have higher baseline density.
- Mitigation: The 3-sentence window is narrow enough that it only catches *clustering*, not normal emotional prose. Dialogue exclusion prevents false-positiving on characters discussing feelings.
- Edge cases: Therapy scenes, confession scenes, and internal-monologue-heavy passages may legitimately name multiple emotions. Rewriter should evaluate whether the naming serves the scene.

**Craft rationale:** King (2000): "I'm not particularly keen on writing which exhaustively describes the physical characteristics of the people in the story and what they're wearing... I'm not keen on it for the same reason I'm not keen on those big, flat, showy prose passages that are as rich as Belgian chocolate but not nearly as nourishing." The density heuristic catches the fiction equivalent — passages so saturated with emotional labeling that they become numbing rather than affecting. Hartenberger (2025): AI "fills silence with explanation when restraint would be more powerful."

**Verdict:** MAYBE (implement but keep disabled until calibrated)

---

## Pattern Summary Table

| ID | Category | Pattern/Heuristic | FP Risk | dialogue_ok | Verdict |
|----|----------|-------------------|---------|-------------|---------|
| AC-1 | AI_CLICHE | The weight of [abstract noun] | Low | true | DO IT |
| AC-2 | AI_CLICHE | Silence stretched/hung/settled | Low | true | DO IT |
| AC-3 | AI_CLICHE | Something shifted in/between | Low | true | DO IT |
| AC-4 | AI_CLICHE | A flicker of [emotion] | Low | true | DO IT |
| AC-5 | AI_CLICHE | The air between/around them | Low | true | DO IT |
| AC-6 | AI_CLICHE | Hung/settled in the air/room | Medium | true | DO IT |
| AC-7 | AI_CLICHE | The world fell away/narrowed | Low | true | DO IT |
| AC-8 | AI_CLICHE | Couldn't quite place the feeling | Medium | true | DO IT |
| AC-9 | AI_CLICHE | Something about him/her/them | Medium | true | DO IT |
| AC-10 | AI_CLICHE | Familiar/unfamiliar ache/pang | Medium | true | DO IT |
| AC-11 | AI_CLICHE | Breath didn't know been holding | Low | true | DO IT |
| AC-12 | AI_CLICHE | Eyes didn't know been searching | Low | true | DO IT |
| AC-13 | AI_CLICHE | Voice barely above a whisper | Low | false | DO IT |
| AC-14 | AI_CLICHE | Tension didn't realize carrying | Low | true | DO IT |
| AC-15 | AI_CLICHE | Shiver down the spine | Medium | true | DO IT |
| PP-1 | PURPLE_PROSE | Adjective stacking (3+ before noun) | Med-High | false | DO IT* |
| PP-2 | PURPLE_PROSE | Simile density (>2/paragraph) | Medium | false | DO IT* |
| PP-3 | PURPLE_PROSE | Emotion tell density (>2/3 sentences) | Medium | false | MAYBE |

\* With calibration phase against existing corpus before enabling.

---

## Measurement Strategy

### Baseline Measurement

Before enabling new patterns:
1. Run the full lint suite against all existing novel output in `output/novel-*/` to establish baseline issue counts per pattern.
2. For each AI_CLICHE pattern, manually review 5 flagged instances to verify the flag is correct (precision check).
3. For each PURPLE_PROSE heuristic, manually review 10 flagged instances to calibrate thresholds.

### Calibration Protocol for Heuristic Patterns

1. **Adjective stacking (PP-1):** Run against 3 existing novels. If >20% of paragraphs are flagged, the adjective word list is too broad — prune it. If <2%, the suffixes are too narrow — expand the curated list. Target: 5-15% of paragraphs flagged.
2. **Simile density (PP-2):** Count similes per paragraph across 3 novels. Establish the 90th percentile and set the threshold there. Expected: >2 flags 5-10% of paragraphs.
3. **Emotion tell density (PP-3):** Count emotion words per 3-sentence window across 3 novels. If the mean is already >1.5, the threshold of >2 is too aggressive — raise to >3.

### Impact Measurement

After enabling patterns in the writer prompt:
1. Run a paired benchmark: same seed, same model, with and without the new writer prompt rules.
2. Measure: lint issue count reduction (primary), prose quality score change (secondary), word count change (monitor for over-cutting).
3. If lint issues drop by >40% with no prose quality regression, keep the patterns enabled.

### Pairwise Comparison

Use the existing `benchmark/pairwise/` system to compare prose before and after AI_CLICHE rules are added to the writer prompt. The comparison should focus on:
- Does the prose feel more specific and grounded?
- Are there fewer stock phrases?
- Has the revision introduced new problems (over-correction, stilted prose)?

---

## Appendix A — Source Citations

### Books

1. **King, Stephen.** *On Writing: A Memoir of the Craft.* Scribner, 2000.
   - "The road to hell is paved with adverbs." (p. 125)
   - "Adverbs, like the passive voice, seem to have been created with the timid writer in mind." (p. 124)
   - Description should be grounded in concrete sensory detail; the writer's job is to find the specific image.

2. **Strunk, William Jr. and E.B. White.** *The Elements of Style.* Macmillan, 1959 (revised edition).
   - "Vigorous writing is concise. A sentence should contain no unnecessary words, a paragraph no unnecessary sentences." (Rule 17)
   - "Prefer the specific to the general, the definite to the vague, the concrete to the abstract." (Rule 16)
   - "The simile is a common device and a useful one, but similes coming in rapid succession are unlikely to be effective."
   - "Do not overwrite. Rich, ornate prose is hard to digest, generally unwholesome, and sometimes nauseating."

3. **Hale, Constance.** *Sin and Syntax: How to Craft Wickedly Effective Prose.* Broadway Books, 1999.
   - Cites Mark Twain: "When you catch an adjective, kill it."
   - "The stronger the word, the more room it needs in a sentence."
   - Adjectives are "consorts, never attending a party alone, preferring to hook themselves on the arm of a sturdy noun."
   - Advocates replacing adverb + weak verb with a single strong verb.

4. **Orwell, George.** "Politics and the English Language." *Horizon*, 1946.
   - "A newly invented metaphor assists thought by evoking a visual image, while a dead metaphor has in effect reverted to being an ordinary word."
   - "Never use a metaphor, simile, or other figure of speech which you are accustomed to seeing in print."

5. **Meredith, Scott.** *Writing to Sell.* Writer's Digest Books, 1987 (revised edition).
   - Emphasis on clean, commercial prose. Overwriting identified as a manuscript rejection trigger — editors stop reading when description overwhelms story movement.

### Academic Research

6. **Kobak, Dmitry et al.** "Delving into LLM-assisted writing in biomedical publications through excess vocabulary." *Science Advances*, 2024.
   - Documented >50% spike in words like "delve," "robust," "pivotal" in published essays post-ChatGPT.

7. **"Detecting Stylistic Fingerprints of Large Language Models."** arXiv:2503.01659, 2025.
   - Achieved 99.8% precision in LLM family attribution using stylometric classifiers.
   - DeepSeek-R1 showed 74.2% stylistic similarity to OpenAI outputs.

8. **"The Last Fingerprint: How Markdown Training Shapes LLM Prose."** arXiv:2603.27006, 2026.
   - Em dash overuse identified as "the smallest surviving unit of the structural orientation that LLMs acquire from markdown-saturated training corpora."

9. **"Stylometric comparisons of human versus AI-generated creative writing."** *Humanities and Social Sciences Communications* (Nature), 2025.
   - AI writing produces "tightly grouped clusters" with "uniform patterns typical of a given model" while human texts show "far greater variation and individuality."

10. **Tantucci, Vittorio.** "ChatGPT only talks in cliches — here's why that's a threat to human creativity." *The Conversation*, 2024.
    - Lexical diversity was "much lower for ChatGPT than for human speakers" — AI recycled the same expressions rather than varying word choice.

### Articles and Community Sources

11. **Wikipedia contributors.** "Wikipedia:Signs of AI writing." *Wikipedia*. Accessed 2026-04-03.
    - Comprehensive living document cataloging AI writing tells by era, including vocabulary shifts, structural patterns, and formatting artifacts.
    - Era-specific high-density vocabulary: 2023-mid-2024 ("delve," "tapestry," "testament," "vibrant"), mid-2024-mid-2025 ("emphasizing," "enhance," "fostering"), mid-2025+ ("emphasizing," "enhance," "highlighting," "showcasing").

12. **Hartenberger, Christopher.** "Show, Don't Tell: What AI Can't Do." *CRAFT Literary*, March 2025.
    - AI "is trained to generate phrase patterns; it is not trained to generate silence."
    - AI defaults to "exposition over scene-building" with "generic adjective pairing" and "explicit interpretation."

13. **Wilson, Jamie K.** "No Ache, No Story: AI and Today's Publishers Are Producing the Same Cowardly Fiction." *PJ Media*, March 2026.
    - AI "pads and performs emotion instead of expressing it, filling silence with explanation when restraint would be more powerful."
    - AI cannot distinguish between "describing heartbreak and inflicting it."

14. **Fawkes, September C.** "Purple Prose: What it is, How it Works, How to Get Rid of it." *Fiction University / septembercfawkes.com*, 2018.
    - Purple prose "consists of several long sentences, stacked adjectives, lots of adverbs, too many metaphors or similes, and ornate language" that "draws excessive attention to itself while lacking substance."

15. **Verity, Liz.** "Beware of Overwriting: Purple Prose (With Examples)." *lizverity.com*, 2025.
    - "Too many adjectives or adverbs with descriptions crammed alongside one another" as primary purple prose diagnostic.

16. **Record Crash (Substack).** "How to Identify AI-Written Web Fiction." 2025.
    - AI fiction tells: "alternating loquacious ponderous similes and tiny sentences made out of cliches," the "Not X; Y" construction, lists of three, and dialogue blocked into separate sections from exposition.
    - AI shows "opposite instinct [to human writers], to stick to instructions and generate text that seems to fit the previous paragraph."

17. **Originality.AI.** "174% Increase in AI Content in Popular Writing Subreddits." 2025.
    - AI content in NoSleep subreddit reached 41.39% in 2024 (up from 15.09% in 2023).

18. **Emanuel, Danielle.** "17 Overused Phrases You've Probably Seen In Every Book." *BuzzFeed*, 2024.
    - "Let out a breath she didn't know she'd been holding" listed as one of the most universally recognized fiction cliches.

---

## Appendix B — AI Cliche Corpus

### AC-1: The Weight of [Abstract Noun]

**AI-generated examples:**
> "The weight of the silence pressed down on her shoulders like a physical thing."
>
> "He could feel the weight of her grief in the room, heavy and suffocating."
>
> "The weight of the unspoken truth between them made it hard to breathe."

**Published fiction handling the same concept well:**
> "She sat in the chair and the grief was so heavy it felt as though her bones were iron." — *Beloved*, Toni Morrison (the comparison is specific and physical; "grief" is named once, then embodied)
>
> "His ribs ached. He thought it was from carrying the pack but it wasn't the pack." — style of Cormac McCarthy (the weight is literal-seeming until the reader infers the emotional layer)

---

### AC-2: The Silence Stretched / Hung / Settled

**AI-generated examples:**
> "The silence stretched between them like a living thing."
>
> "A heavy silence settled over the table, broken only by the ticking of the clock."
>
> "The silence that followed his words thickened until it was almost unbearable."

**Published fiction handling silence well:**
> "Neither of them said anything. The coffee grew cold." — style of Raymond Carver (the silence is shown through neglected objects, not named)
>
> "They looked at each other and looked away. Someone's dog was barking three houses over." — the silence is defined by what fills it, not by naming its existence

---

### AC-3: Something Shifted (In/Between)

**AI-generated examples:**
> "Something shifted between them in that moment, something neither of them could name."
>
> "Something shifted in his expression — a softening around the eyes, a loosening of the jaw."
>
> "She felt something shift in the dynamic, subtle but unmistakable."

**Published fiction handling relational change well:**
> "He looked at her and she looked back and for the first time he didn't look away first." — the shift is shown through the specific change in behavior
>
> "After that night she started calling him by his first name." — the shift is demonstrated through a concrete changed action

---

### AC-4: A Flicker of [Emotion]

**AI-generated examples:**
> "A flicker of recognition crossed his face before he schooled his expression into neutrality."
>
> "She caught a flicker of something — fear? guilt? — in his eyes before he turned away."
>
> "A flicker of doubt passed through her, quickly smothered by determination."

**Published fiction handling brief emotions well:**
> "His hand paused on the glass. Then he drank." — the micro-hesitation communicates doubt without naming it
>
> "She started to say something, stopped, pressed her lips together." — the aborted speech shows the internal conflict through action

---

### AC-5: The Air Between/Around Them

**AI-generated examples:**
> "The air between them crackled with unspoken tension."
>
> "Something in the air around them shifted, charged with a new energy."
>
> "The air between them felt thick enough to cut."

**Published fiction handling interpersonal tension well:**
> "She moved to the far end of the couch." — physical distance communicates the emotional state
>
> "He kept talking to the bartender. She kept not leaving." — tension shown through contradictory actions

---

### AC-6: Hung/Settled In the Air/Room

**AI-generated examples:**
> "His words hung in the air between them, heavy with implication."
>
> "The accusation settled over the room like a fog."
>
> "The question lingered in the air, unanswered."

**Published fiction handling aftermath well:**
> "Nobody spoke for a long time after that. Then Jim said he was going to check on the horses." — the deflection to mundane action shows the impact
>
> "'You shouldn't have said that,' she said, but only after he'd left the room." — timing communicates weight

---

### AC-7: The World Fell Away / Narrowed

**AI-generated examples:**
> "The world fell away until there was nothing but the two of them."
>
> "Everything else faded — the noise, the crowd, the music — until all she could see was him."
>
> "The world narrowed to the sound of his voice and the pressure of his hand on hers."

**Published fiction handling intense focus well:**
> "She didn't hear the phone. She didn't hear anything. The letter was three sentences long and she read it four times." — the narrowing is demonstrated through what is missed, not announced
>
> "He was aware that someone was speaking to him. The edges of his vision had gone gray." — physical symptoms show the focus/dissociation

---

### AC-8: Couldn't Quite Place the Feeling

**AI-generated examples:**
> "There was a feeling she couldn't quite place — not quite sadness, not quite relief."
>
> "He couldn't name the emotion that welled up in him as he watched her leave."
>
> "Something stirred in her that she couldn't identify, a nameless ache that settled in her chest."

**Published fiction handling ambiguous emotion well:**
> "She wanted to throw the plate. She also wanted to sit down. She did neither." — the ambiguity is shown through contradictory impulses
>
> "It wasn't anger, exactly. He kept opening and closing the kitchen drawer." — the restlessness *is* the unnamed emotion

---

### AC-9: Something About Him/Her/Them

**AI-generated examples:**
> "There was something about her that drew him in, something he couldn't quite define."
>
> "Something about the way he looked at her made her feel seen for the first time."
>
> "There was something about his presence that put her at ease, despite everything."

**Published fiction handling attraction/magnetism well:**
> "She had a way of tilting her head when she listened that made you feel like the only person who'd ever said anything interesting." — the specific behavior replaces the vague "something"
>
> "He was the kind of person who remembered what you drank." — a concrete detail communicates attentiveness

---

### AC-10: Familiar/Unfamiliar Ache/Pang

**AI-generated examples:**
> "A familiar ache bloomed in her chest, the same one she felt every time she passed the old house."
>
> "An unfamiliar pang of jealousy surprised her."
>
> "The old tug of longing pulled at her, familiar as breathing."

**Published fiction handling recurring emotion well:**
> "She drove past the house. She always slowed down. She never stopped." — the habitual action communicates the recurring ache
>
> "It was the same feeling as the night his father left — his stomach going cold, his hands going still." — the emotion is grounded in specific physical memory, not labeled with "familiar ache"

---

### AC-11: Breath Didn't Know Been Holding

**AI-generated examples:**
> "She let out a breath she didn't know she'd been holding."
>
> "He exhaled slowly, releasing a breath he hadn't realized he'd been holding."
>
> "The breath she'd been holding — without realizing it — escaped in a shudder."

**Published fiction handling tension release well:**
> "Her shoulders dropped two inches when he said yes." — specific physical measurement communicates the held tension
>
> "He unclenched his hands. There were half-moon marks where his nails had been." — the evidence of tension replaces the announcement of its release

---

### AC-13: Voice Barely Above a Whisper

**AI-generated examples:**
> "Her voice was barely above a whisper when she finally spoke."
>
> "'I know,' he said, his voice barely above a whisper."
>
> "She spoke in a voice barely above a whisper, as if afraid the words might shatter something."

**Published fiction handling quiet speech well:**
> "'I know,' she said. He had to lean in to hear her." — the listener's action communicates the volume
>
> "She said it so quietly he wasn't sure she'd meant to say it at all." — uncertainty about intention adds dimension

---

### AC-15: Shiver Down the Spine

**AI-generated examples:**
> "The words sent a shiver down her spine."
>
> "A chill ran down his spine as the door creaked open."
>
> "Something about the way she said it sent a cold shiver crawling down his back."

**Published fiction handling dread/excitement well:**
> "The hair on the back of his neck stood up, and he turned before he knew why." — specific physiological response
>
> "She felt the cold in her teeth first." — unexpected sensory channel creates genuine surprise

---

## Appendix C — Purple Prose Examples

### PP-1: Adjective Stacking

**Before (purple):**
> "The ancient, weathered, moss-covered stone wall stretched across the vast, empty, wind-swept moor beneath a low, gray, threatening sky."

**After (revised):**
> "The wall stretched across the moor, its stones green with moss. The sky hung low and gray."

**Principle applied:** Strunk & White's "Omit needless words." Each noun gets one modifier at most. The reader's imagination fills in the gaps — and does it better than three adjectives can.

---

**Before (purple):**
> "Her long, dark, tangled, rain-soaked hair clung to her pale, gaunt, hollow-cheeked face."

**After (revised):**
> "Wet hair clung to her face. She looked thinner than he remembered."

**Principle applied:** Hale's "the stronger the word, the more room it needs." "Wet" does the work of four adjectives. "Thinner than he remembered" grounds the description in the POV character's relationship to her.

---

### PP-2: Simile Density

**Before (purple):**
> "Her voice was like warm honey, smooth and golden. The words flowed like a river over stones, each syllable polished and round. His heart beat like a drum in his chest as he listened, as if she were casting a spell with every breath, as though the very air between them had turned to silk."

**After (revised):**
> "She had a voice that made you lean in. He forgot what he'd been about to say."

**Principle applied:** Strunk & White: "similes coming in rapid succession are unlikely to be effective." One simile earns its place; five compete for attention and cancel each other out. The revision uses *effect* (leaning in, forgetting) rather than *comparison* to communicate the voice's quality.

---

### PP-3: Emotion Tell Density

**Before (purple):**
> "A wave of grief washed over her. The guilt was overwhelming, pressing down on her chest. She felt a sharp pang of regret, mixed with the bitter sting of betrayal. The sadness was unbearable."

**After (revised):**
> "She sat on the kitchen floor because the chairs were too far away. The linoleum was cold under her legs. She noticed that. She noticed everything except the thing she was supposed to be feeling."

**Principle applied:** King: "Description begins in the writer's imagination, but should finish in the reader's." The revision names zero emotions. The reader constructs the grief from the physical details and the character's dissociation. Four sentences of emotion-labeling are replaced by four sentences of concrete sensory detail that *create* the emotion in the reader.
