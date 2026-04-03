---
status: reference
verified: 2026-04-03
---

# AI Tells: Emotional Echo (Show-Then-Tell)

> **Date:** 2026-04-03
> **Scope:** Redundant emotion labeling after physical/behavioral showing, R.U.E. violations, MRU breaks

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Background](#background)
   - [R.U.E. -- The canonical craft principle](#rue--the-canonical-craft-principle)
   - [Motivation-Reaction Units and the show-tell sequence](#motivation-reaction-units-and-the-show-tell-sequence)
   - [Why AI models are especially prone to emotional echo](#why-ai-models-are-especially-prone-to-emotional-echo)
   - [Psychic distance and the cost of telling after showing](#psychic-distance-and-the-cost-of-telling-after-showing)
3. [Detection Architecture](#detection-architecture)
   - [Why single-regex detection is insufficient](#why-single-regex-detection-is-insufficient)
   - [Two-pass heuristic design](#two-pass-heuristic-design)
   - [Physical indicator lexicon (Pass 1)](#physical-indicator-lexicon-pass-1)
   - [Emotion label matching (Pass 2)](#emotion-label-matching-pass-2)
   - [Proximity window and sentence boundaries](#proximity-window-and-sentence-boundaries)
4. [Proposed Patterns](#proposed-patterns)
5. [The Analytical Extension Exception](#the-analytical-extension-exception)
6. [Implementation Sketch](#implementation-sketch)
7. [Pattern Summary Table](#pattern-summary-table)
8. [Measurement Strategy](#measurement-strategy)
9. [Appendix A -- Source Citations](#appendix-a--source-citations)
10. [Appendix B -- Physical Indicator Lexicon](#appendix-b--physical-indicator-lexicon)
11. [Appendix C -- Example Corpus](#appendix-c--example-corpus)

---

## Executive Summary

This report proposes **6 emotional echo patterns** (category `EMOTIONAL_ECHO`, Tier 3) for addition to the novel harness lint system. Unlike existing patterns that operate as single-regex matches, EMOTIONAL_ECHO requires a **two-pass heuristic**: Pass 1 identifies sentences containing physical/behavioral indicators of emotion; Pass 2 checks whether the immediately following sentence (or the second half of the same sentence) redundantly names the emotion that was just shown.

**What this catches that existing patterns do not:**

| Existing Pattern | What It Catches | What It Misses |
|---|---|---|
| `DECLARED_EMOTION` (Tier 3) | "She was afraid" in isolation | The *redundancy* -- that the preceding sentence already showed fear through trembling hands |
| `FILTER_WORD` (Tier 2) | "She could feel the dread" | The structural pattern of showing-then-telling as a two-sentence unit |
| `AI_CLICHE` (Tier 2) | "A wave of grief washed over her" | Whether a physical showing preceded it, making it doubly redundant |

EMOTIONAL_ECHO targets the **pair**: the physical showing that does the work, followed by the emotion label that undermines it. The existing patterns catch the tell; this pattern catches the tell that follows adequate showing.

**Pattern counts:**

| Category | Count | Tier | Detection Method |
|---|---|---|---|
| EMOTIONAL_ECHO | 6 | 3 | Two-pass heuristic (physical indicator + emotion label within proximity window) |

**False positive risk assessment:** Medium-High. The critical calibration challenge is distinguishing **redundant echo** ("Her hands trembled. She was afraid.") from **analytical extension** ("Her hands trembled. She hadn't realized how much she still cared."). The report proposes specific heuristic filters to mitigate this: analytical-extension sentences contain cognitive verbs (realized, understood, wondered, hadn't expected), subordinate clauses, or negation that signals the character is processing rather than merely restating.

**Integration approach:** EMOTIONAL_ECHO cannot be implemented as rows in `lint_patterns` because it requires multi-sentence analysis. It requires a new heuristic function in `src/lint/index.ts` that runs alongside the regex-based patterns but operates on sentence pairs rather than individual regex matches.

---

## Background

### R.U.E. -- The canonical craft principle

The acronym R.U.E. -- Resist the Urge to Explain -- comes from Renni Browne and Dave King's *Self-Editing for Fiction Writers: How to Edit Yourself into Print* (first edition 1993, second edition 2004). Browne and King coined the term as a marginal annotation for manuscripts where the author explains what the dialogue or action has already communicated:

> "[The] tendency to describe a character's emotion may reflect a lack of confidence on the part of the writer. And more often than not, writers tell their readers things already shown by dialogue and action." (Browne & King, 2004)

Their prescription is surgical: "When you come across an explanation of a character's emotion, simply cut the explanation. If the emotion is still shown, then the explanation wasn't needed. If the emotion isn't shown, rewrite the passage so that it is." The logic is binary -- either the showing works or it does not. If it works, the tell is redundant. If it does not work, the fix is to improve the showing, not to add a tell.

R.U.E. applies specifically to emotional echo because the pattern is not merely "telling" -- it is telling *after* showing, which is worse than telling alone. A flat declaration like "She was angry" is weak craft but at least commits to a single mode. Showing anger through clenched fists and then stating "She was angry" commits to showing, then retreats to telling, signaling that the writer does not trust the showing to land. As Browne and King note, this "pays readers the opposite of a compliment -- it assumes them to be stupid."

The R.U.E. principle has been widely adopted in craft instruction. Fiction University, Writers Helping Writers, and the editorial community at large treat it as foundational. It appears in virtually every developmental editing checklist. For this lint system, R.U.E. is the primary craft citation for why emotional echo is a defect rather than a stylistic choice.

### Motivation-Reaction Units and the show-tell sequence

Dwight V. Swain, in *Techniques of the Selling Writer* (1965), formalized the Motivation-Reaction Unit (MRU) as the fundamental building block of prose at the sentence and paragraph level. An MRU consists of two elements:

1. **Motivation** -- an external stimulus the focal character perceives (something happens in the world)
2. **Reaction** -- the character's response, which follows a specific natural sequence:
   - **Feeling** (involuntary emotional response)
   - **Involuntary physical action** (flinching, gasping, sweating)
   - **Conscious physical movement** (stepping back, reaching for a weapon)
   - **Speech** (deliberate verbal response)

The sequence moves from the most involuntary to the most intentional. Swain's insight was that readers experience events in the same order characters do: first you feel, then your body reacts, then you act deliberately, then you speak. Violating this order creates "an element of unreality" that breaks immersion (September C. Fawkes, 2022, summarizing Swain).

Emotional echo is a specific MRU violation. The correct MRU sequence for a fear response is:

1. Motivation: "The door slammed open."
2. Reaction-feeling: (implied by physical response)
3. Reaction-involuntary: "Her hands went cold."
4. Reaction-conscious: "She pressed herself against the wall."

The emotional echo version adds a redundant step:

1. Motivation: "The door slammed open."
2. Reaction-involuntary: "Her hands went cold."
3. Reaction-conscious: "She pressed herself against the wall."
4. **Redundant tell:** "Fear gripped her."

Step 4 violates the MRU because the feeling was already communicated through steps 2 and 3. Naming the emotion after showing it is not merely redundant -- it reverses the MRU's increasing-intentionality sequence by dropping back from conscious action to an abstract emotional label. The reader has already constructed the feeling from the physical detail; the label deconstructs it.

### Why AI models are especially prone to emotional echo

Large language models generate text by predicting the most probable next token given context. This statistical process creates two tendencies that converge in emotional echo:

**Tendency 1: Hedging through redundancy.** LLMs are trained via RLHF to produce outputs that human raters judge as clear and complete. Raters penalize ambiguity. The result is a model that, having generated a physical indicator of emotion (trembling hands), assigns high probability to an explicit emotion label in the next sentence -- because leaving the emotion unnamed feels "incomplete" from a token-prediction standpoint. The model has no concept of trust between writer and reader; it only knows that naming the emotion makes the passage more explicit, which RLHF rewards.

**Tendency 2: Pattern completion from training data.** Literary fiction in the training corpus contains both showing and telling -- but often in different contexts. Skilled authors show in high-intensity scenes and tell in transitions. AI models, unable to distinguish scene context, learn that physical indicators and emotion labels frequently co-occur in "good" writing. They reproduce the co-occurrence without understanding that in skilled prose, the two modes are alternatives, not complements.

**Tendency 3: The "belt and suspenders" failure mode.** AI models exhibit what writing coaches call the "belt and suspenders" approach -- securing the emotional beat through two redundant mechanisms. This pattern appears across all major model families (GPT, Claude, Gemini, Llama) and persists even with explicit prompting against it, because the statistical pressure toward redundancy is embedded in the model weights. As the CRAFT Literary journal observed, AI "is trained to generate phrase patterns; it is not trained to generate silence" (Hartenberger, 2025). Emotional echo is the anti-silence: it fills the space where restraint should live.

**Tendency 4: Loss of psychic distance control.** The emotional echo pattern represents a failure to maintain consistent psychic distance (see next section). AI models shift between showing (close distance) and telling (far distance) within the same beat because they have no model of where the camera is. A skilled author at close psychic distance would never step back to label an emotion just shown through visceral detail -- but an LLM has no spatial metaphor for narrative perspective.

### Psychic distance and the cost of telling after showing

John Gardner introduced the concept of psychic distance in *The Art of Fiction: Notes on Craft for Young Writers* (1983), defining it as "the distance the reader feels between himself and the events in the story." Gardner illustrates a five-level continuum from most distant to most intimate:

1. **Most distant:** "It was winter of the year 1853. A large man stepped out of a doorway."
2. **Fairly distant:** "Henry J. Warburton had never much cared for snowstorms."
3. **Moderate:** "Henry hated snowstorms."
4. **Close:** "God how he hated these damn snowstorms."
5. **Closest:** "Snow. Under your collar, down inside your shoes, freezing and plugging up your miserable soul..."

At Level 5, the reader is inside the character's sensory experience. Physical indicators of emotion -- trembling hands, a clenched jaw, a racing heart -- operate at Level 4-5 psychic distance. They are immediate, visceral, experienced from within.

An explicit emotion label -- "She was afraid," "Anger coursed through him" -- operates at Level 2-3. It is the narrator summarizing, stepping back from the character's body to provide a label. This shift is not inherently wrong: Gardner emphasizes that writers should modulate psychic distance deliberately, moving closer for intensity and pulling back for transitions. The problem with emotional echo is that the shift is *involuntary* -- a close-distance physical detail immediately followed by a mid-distance emotion label, creating a jarring zoom-out at exactly the moment the prose should sustain intimacy.

Ursula K. Le Guin addresses a related principle in *Steering the Craft* (1998/2015), arguing for trust between writer and reader. The writer who shows anger through a slammed door and then writes "He was angry" does not trust the reader to connect the door-slamming to anger. This failure of trust breaks what Gardner calls the "vivid and continuous dream" of fiction -- the reader's immersive experience is interrupted by the author's anxious clarification.

Emma Darwin, writing on psychic distance, notes that "naming specific emotions moves readers outward on the spectrum. Using abstract emotional labels creates distance, while sensory details and immediate experiences draw readers inward." Emotional echo is therefore a two-sentence psychic distance violation: the first sentence draws the reader in (showing), and the second sentence pushes them out (telling).

---

## Detection Architecture

### Why single-regex detection is insufficient

The existing lint system operates by matching individual regex patterns against prose text. Each pattern in the `lint_patterns` table is a single regex that fires independently. This works well for:

- **FILTER_WORD** patterns: "seemed to," "could feel" -- single-phrase matches
- **DECLARED_EMOTION** patterns: "she was afraid," "a wave of grief" -- single-clause matches
- **AI_CLICHE** patterns: "the weight of the silence" -- single-phrase matches

EMOTIONAL_ECHO cannot be detected this way because the defect is not in either sentence alone. "Her hands trembled" is good prose. "She was afraid" is a DECLARED_EMOTION issue, but only a minor one in isolation. The defect is in the *combination* -- the tell following adequate showing. A single regex cannot span sentence boundaries while maintaining the semantic relationship between physical indicator and emotion label.

The existing `DECLARED_EMOTION` pattern catches "She was afraid" regardless of context. EMOTIONAL_ECHO should only flag "She was afraid" when it follows a sentence that already showed fear through physical detail. This requires cross-sentence analysis that the current regex-per-row architecture does not support.

### Two-pass heuristic design

The detection algorithm operates in two passes over the text:

**Pass 1 -- Physical Indicator Detection:**
Scan all sentences for physical/behavioral indicators from the indicator lexicon (Appendix B). Each match is tagged with one or more emotion families it could indicate (e.g., "hands trembled" maps to `fear`, `anxiety`, `anger`, `grief`). The output is a list of `(sentence_index, indicator_match, emotion_families[])` tuples.

**Pass 2 -- Emotion Label Proximity Check:**
For each sentence flagged in Pass 1, examine the next 1-2 sentences for explicit emotion labels. An emotion label matches if:
1. It matches existing `DECLARED_EMOTION` regex patterns, AND
2. The named emotion belongs to one of the emotion families tagged to the physical indicator from Pass 1.

If both conditions are met, the pair is flagged as EMOTIONAL_ECHO.

**Why two passes:** Pass 1 alone would flag every instance of body language in the text (too noisy). Pass 2 alone would flag every emotion declaration (already covered by DECLARED_EMOTION). Only the conjunction -- physical indicator followed by matching emotion label -- constitutes the echo pattern.

### Physical indicator lexicon (Pass 1)

The indicator lexicon is organized by body system, drawing from Angela Ackerman and Becca Puglisi's *The Emotion Thesaurus: A Writer's Guide to Character Expression* (2012/2019). Each indicator is tagged with the emotion families it most commonly signals. See Appendix B for the complete lexicon.

The lexicon is implemented as an array of `{ regex, emotion_families[] }` objects. Each regex is designed to match the indicator in narrative context (third-person and first-person POV) while excluding dialogue.

Key design decisions:
- **Regex, not NLP:** The indicators are concrete physical descriptions with predictable syntactic patterns. Regex handles them efficiently without requiring tokenization or dependency parsing.
- **Multi-family tagging:** Most physical indicators map to multiple emotions. "Hands trembled" can signal fear, anxiety, anger, or grief. This is intentional -- the emotion family is disambiguated in Pass 2 by the specific emotion label that follows.
- **Broad coverage, narrow regex:** Each regex targets a specific physical action (e.g., "jaw\s+(clenched|tightened|set)") rather than a vague body part reference. This keeps false positives low while maintaining comprehensive coverage.

### Emotion label matching (Pass 2)

Pass 2 reuses the existing `DECLARED_EMOTION` regex patterns from the `lint_patterns` table, extended with an emotion-family tag for each emotion word. The family mapping:

| Emotion Family | Emotion Words |
|---|---|
| `fear` | afraid, scared, terrified, frightened, panicked, fearful, petrified |
| `anger` | angry, furious, enraged, irate, livid, incensed, seething |
| `sadness` | sad, heartbroken, devastated, grief-stricken, sorrowful, bereft, despondent |
| `anxiety` | anxious, nervous, worried, apprehensive, uneasy, agitated, on edge |
| `joy` | happy, elated, thrilled, overjoyed, delighted, ecstatic, jubilant |
| `shame` | ashamed, embarrassed, humiliated, mortified, guilty, remorseful |
| `disgust` | disgusted, revolted, repulsed, sickened, nauseated, appalled |
| `surprise` | shocked, stunned, astonished, startled, dumbfounded, flabbergasted |
| `grief` | grieving, mourning, bereaved, devastated, anguished, despairing |
| `love` | loving, tender, affectionate, smitten, enamored, devoted |

Pass 2 also catches the "container + emotion" form: "a wave/surge/pang/jolt of [fear/anger/etc.]" -- already in the DECLARED_EMOTION patterns.

### Proximity window and sentence boundaries

The proximity window is the critical parameter for balancing precision and recall:

**Window: 1-2 sentences after the physical indicator sentence.**

Rationale:
- **1 sentence:** Catches the most common echo pattern ("Her hands trembled. She was afraid."). Highest precision.
- **2 sentences:** Catches cases where a brief transition intervenes ("Her hands trembled. She pressed them flat against the table. Fear -- cold and absolute -- held her in place."). Moderate precision, higher recall.
- **3+ sentences:** Too far. At 3 sentences, the emotion label may be doing genuine narrative work (advancing the character's processing of the emotion, not echoing the showing). Unacceptable false positive rate.

**Same-sentence detection:** Also check for emotion labels in the second half of the same sentence after a semicolon or em-dash. "Her hands trembled; she was afraid" and "Her hands trembled -- fear had her now" are single-sentence echo patterns.

**Sentence boundary detection:** Use the existing `getSentenceAt()` function's logic, splitting on `.`, `!`, `?`, and `\n`. For the proximity check, build a sentence index array and check adjacent indices.

---

## Proposed Patterns

### EE-1: Trembling/Shaking + Fear/Anxiety Label

**What:** Physical trembling or shaking in one sentence, followed by an explicit fear or anxiety label in the next 1-2 sentences.

**Detection:**
- Pass 1 indicator regex: `\b(hands?|fingers?|body|lip|lips|voice)\s+(trembl\w*|shak\w*|shook|quiver\w*)\b`
- Pass 1 also catches: `\btrembl\w+\b` as standalone (when preceded by a subject-verb pattern)
- Pass 2 emotion families: `fear`, `anxiety`
- Pass 2 label regex: reuse DECLARED_EMOTION patterns filtered to fear/anxiety words
- Window: 1-2 sentences

**Example (redundant echo -- flag):**
> Her hands trembled as she reached for the door handle. She was terrified.

The trembling already communicates terror. "She was terrified" adds nothing.

**Example (analytical extension -- do not flag):**
> Her hands trembled as she reached for the door handle. She hadn't expected to be this afraid -- not of him, but of what she might say.

The second sentence adds analytical depth: the character is surprised by the emotion, and the clause "not of him, but of what she might say" specifies the *source* of fear, which the trembling alone could not communicate. This is legitimate telling.

**fix_template:** "The physical detail already shows the emotion. Check whether the emotion label adds new information (source, surprise, contradiction). If it merely restates what the body language showed, cut it. If it adds analytical depth (character self-awareness, unexpected source, ironic contrast), keep it."

**Writer prompt rule:** "After writing physical indicators of emotion (trembling, shaking, quivering), do NOT follow with an explicit fear/anxiety label unless the character is analyzing the emotion (identifying its source, noting surprise at its intensity, or contrasting it with expectation). The body language does the showing; trust it."

**Effort:** Medium (requires two-pass heuristic, not single regex)

**FP risk + mitigation:**
- Medium-High for the raw pattern. Mitigated by:
  - **Analytical extension filter:** If the label sentence contains cognitive verbs (realized, understood, wondered, hadn't expected, didn't know, surprised, couldn't believe), subordinate clauses, or negation, downgrade from flag to advisory.
  - **Dialogue exclusion:** Skip if either sentence is in dialogue.
  - **Genre context:** In horror, naming fear after showing it can be a deliberate intensification technique. The rewriter should evaluate.
- Residual FP risk after filters: Medium.

**Craft rationale:** Browne & King (2004): "simply cut the explanation. If the emotion is still shown, then the explanation wasn't needed." Swain (1965): the MRU reaction sequence moves from feeling to action to speech -- looping back to feeling-label after action violates the sequence. Ackerman & Puglisi (2019): the entire *Emotion Thesaurus* exists because body language is sufficient to communicate emotion without naming it.

**Verdict:** DO IT

---

### EE-2: Jaw Clenching/Fists + Anger Label

**What:** Jaw clenching, fist balling, or teeth grinding in one sentence, followed by an explicit anger label in the next 1-2 sentences.

**Detection:**
- Pass 1 indicator regex: `\b(jaw|teeth|fists?|hands?)\s+(clench\w*|tighten\w*|grind\w*|gritted|balled|set)\b|\bclenched\s+(his|her|their)\s+(jaw|fists?|teeth)\b|\b(fists?\s+balled|hands?\s+curled\s+into\s+fists?)\b`
- Pass 2 emotion families: `anger`
- Pass 2 label regex: reuse DECLARED_EMOTION patterns filtered to anger words
- Window: 1-2 sentences

**Example (redundant echo -- flag):**
> His jaw clenched so hard his teeth ached. Anger surged through him.

The jaw clench is a textbook anger indicator from *The Emotion Thesaurus*. "Anger surged through him" is a DECLARED_EMOTION match wrapped in a dead metaphor, and it redundantly names what the jaw clench already showed.

**Example (analytical extension -- do not flag):**
> His jaw clenched so hard his teeth ached. He hadn't been this angry since the night his father left -- and recognizing the similarity made it worse.

The second sentence adds backstory, self-comparison, and escalation. The anger label is subordinate to the analytical insight.

**fix_template:** "The jaw/fist action already signals anger. Check whether the anger label adds new context (backstory, escalation, surprising target). If it merely restates what the physical action showed, cut it. If the character is comparing this anger to a past experience or identifying its specific trigger, keep it."

**Writer prompt rule:** "After writing anger indicators (clenched jaw, balled fists, ground teeth), do NOT follow with 'anger,' 'fury,' 'rage,' or their containers ('a surge of anger'). If the anger's source or quality needs specification, embed it in action or thought, not in a label."

**Effort:** Medium

**FP risk + mitigation:**
- Medium. Jaw clenching is one of the most unambiguous anger indicators, making the emotion-family match highly reliable. The main FP risk is analytical extension, mitigated by the cognitive-verb filter.
- Edge case: Characters who clench their jaw from pain rather than anger. The emotion-family overlap (jaw clenching maps to both `anger` and `pain/determination`) means the anger-label match must be present for a flag.

**Craft rationale:** Ackerman & Puglisi (2019) list "muscles in the jaw bunching" and "hands fisting at the character's sides" as primary anger signals with explicit instruction to show these instead of naming anger. Gardner (1983): naming the emotion after showing it through physical detail breaks the vivid and continuous dream by shifting from Level 4-5 psychic distance to Level 2-3.

**Verdict:** DO IT

---

### EE-3: Heart Racing/Pounding + Fear/Anxiety/Excitement Label

**What:** Heart-rate indicators (pounding, racing, hammering, skipping, thudding) in one sentence, followed by an explicit fear, anxiety, or excitement label in the next 1-2 sentences.

**Detection:**
- Pass 1 indicator regex: `\b(heart|pulse)\s+(pound\w*|rac\w*|hammer\w*|skip\w*|thud\w*|flutter\w*|stutter\w*|slam\w*|gallop\w*|thunder\w*)\b|\b(pound\w*|rac\w*|hammer\w*)\s+(heart|pulse|heartbeat)\b`
- Pass 2 emotion families: `fear`, `anxiety`, `excitement`
- Window: 1-2 sentences

**Example (redundant echo -- flag):**
> Her heart hammered against her ribs. She was terrified of what lay beyond the door.

The hammering heart shows the terror. "She was terrified" undercuts the showing.

**Example (analytical extension -- do not flag):**
> Her heart hammered against her ribs. She recognized the feeling -- not fear, exactly, but the wild anticipation she used to feel before a dive.

The second sentence reframes the physical sensation, rejecting the obvious interpretation (fear) and substituting a specific memory. This is legitimate emotional analysis.

**fix_template:** "The heart-rate detail already establishes the emotional intensity. Check whether the emotion label reframes, contradicts, or specifies beyond what the physical detail shows. If it merely names the obvious emotion, cut it. If the character is misidentifying, reframing, or comparing the sensation, keep it."

**Writer prompt rule:** "After writing cardiac indicators (pounding heart, racing pulse), do NOT label the emotion they signal. The heart speaks for itself. If the character needs to name the feeling, have them question it, deny it, or compare it to something unexpected."

**Effort:** Medium

**FP risk + mitigation:**
- Medium-High. Heart-rate indicators are ambiguous across `fear`, `anxiety`, and `excitement`. A flag requires that the following emotion label matches one of these families, which is reliable. The main FP source is excitement contexts (romance, adventure) where naming the emotion may feel more natural. Mitigated by the analytical-extension filter.
- Edge case: Medical contexts ("His heart raced. The arrhythmia was back.") -- not an emotion label, so Pass 2 would not flag.

**Craft rationale:** Ackerman & Puglisi (2019) categorize heart-rate changes as "internal sensations" that communicate emotion without naming it, listing them under fear, anxiety, excitement, dread, and anticipation. Swain (1965): involuntary physical responses (heart rate) precede conscious processing in the MRU sequence -- naming the emotion after the physical response reverses the natural order. Le Guin (1998/2015): trust the reader to connect the physical detail to the emotion.

**Verdict:** DO IT

---

### EE-4: Stomach/Gut Distress + Dread/Anxiety/Disgust Label

**What:** Stomach or gut sensations (churning, dropping, knotting, twisting, tightening, roiling, clenching) in one sentence, followed by an explicit dread, anxiety, or disgust label in the next 1-2 sentences.

**Detection:**
- Pass 1 indicator regex: `\b(stomach|gut|belly|insides?|abdomen)\s+(churn\w*|drop\w*|knot\w*|twist\w*|tighten\w*|roil\w*|clench\w*|flip\w*|lurch\w*|heav\w*|sank|plummet\w*|hollow\w*)\b|\b(churn\w*|knot\w*|twist\w*|hollow\w*)\s+(in|of)\s+(his|her|their)\s+(stomach|gut|belly)\b`
- Pass 2 emotion families: `anxiety`, `fear`, `disgust`, `grief`, `dread`
- Window: 1-2 sentences

**Example (redundant echo -- flag):**
> Her stomach knotted. Dread settled over her like a weight.

The knotting stomach shows dread. The second sentence names dread and wraps it in a dead metaphor ("like a weight"), compounding the problem.

**Example (analytical extension -- do not flag):**
> Her stomach knotted. She'd felt this way before every deployment, and she'd learned that the nausea meant her instincts were right.

The second sentence adds backstory, pattern recognition, and the character's relationship with her own body signals. This is experiential knowledge, not redundant labeling.

**fix_template:** "The gut/stomach sensation already communicates the emotion viscerally. Check whether the follow-up label adds backstory, pattern recognition, or character self-knowledge. If it merely names the emotion the gut already showed, cut it. If the character is connecting this physical response to past experiences or learned insight, keep it."

**Writer prompt rule:** "After writing gut/stomach distress (churning, knotting, dropping), do NOT follow with dread/anxiety/disgust labels. The visceral sensation is the most powerful form of showing. Labeling it afterward is like explaining a joke."

**Effort:** Medium

**FP risk + mitigation:**
- Medium. Gut sensations are fairly unambiguous as emotion indicators (few literal stomach problems in fiction outside medical drama). The analytical-extension filter handles the main FP source.
- Edge case: Food-related nausea preceding genuine illness description. Pass 2 would not flag because illness descriptions do not match DECLARED_EMOTION patterns.

**Craft rationale:** Ackerman & Puglisi (2019) list stomach distress under anxiety, dread, fear, and disgust, noting these as "internal sensations" -- the most intimate layer of showing. Browne & King (2004): if the physical detail works, the explanation is redundant; if it doesn't, fix the detail. Gardner (1983): gut sensations operate at Level 5 (closest) psychic distance -- labeling the emotion after them snaps back to Level 2-3.

**Verdict:** DO IT

---

### EE-5: Breath Catching/Holding + Shock/Fear/Surprise Label

**What:** Breath-related indicators (catching, hitching, holding, quickening, stopping, sucking in) in one sentence, followed by an explicit shock, fear, or surprise label in the next 1-2 sentences.

**Detection:**
- Pass 1 indicator regex: `\b(breath|breathing)\s+(catch\w*|hitch\w*|held|stop\w*|quicken\w*|stall\w*|froze|seiz\w*|snag\w*)\b|\b(caught|held|sucked\s+in|drew|drew\s+in)\s+(his|her|their|a\s+(sharp|ragged|shaky|shuddering))\s+breath\b|\bgasp\w*\b`
- Pass 2 emotion families: `fear`, `surprise`, `shock`, `anxiety`
- Window: 1-2 sentences

**Example (redundant echo -- flag):**
> Her breath caught. Shock rippled through her.

The caught breath already shows shock. "Shock rippled through her" is a DECLARED_EMOTION match ("rippled" is a container synonym for "wave/surge") that restates it.

**Example (analytical extension -- do not flag):**
> Her breath caught. Not from surprise -- she'd known this was coming. The catch was grief catching up.

The second and third sentences actively reinterpret the physical response, rejecting the obvious reading (surprise) and substituting grief. This is emotional analysis that depends on the label to function.

**fix_template:** "The breath reaction already shows the emotional impact. Check whether the emotion label reinterprets the physical reaction, identifies an unexpected cause, or contradicts the obvious reading. If it merely names the emotion the breath disruption already showed, cut it."

**Writer prompt rule:** "After writing breath indicators (caught, hitched, held, quickened), do NOT label the emotion. Let the disrupted breath carry the beat. If the character is surprised by their own reaction, show that surprise through thought, not through an emotion label."

**Effort:** Medium

**FP risk + mitigation:**
- Medium. Breath indicators are common in both emotional and physical contexts (running, exertion). Pass 2 filters to emotion labels only, which eliminates exertion false positives. Analytical-extension filter handles legitimate reinterpretation.
- Edge case: Asthma, medical conditions. These will not match DECLARED_EMOTION patterns in the follow-up sentence.

**Craft rationale:** Swain (1965): breath disruption is an involuntary physical response in the MRU sequence -- the most immediate layer of reaction. Naming the emotion after it reverses the sequence from visceral to abstract. Ackerman & Puglisi (2019) list breath catching under shock, fear, and surprise with the explicit guidance to "show don't tell." Le Guin (1998/2015): trust the reader to interpret the body's signals.

**Verdict:** DO IT

---

### EE-6: Body Freezing/Stiffening + Fear/Shock Label

**What:** Whole-body indicators (freezing, stiffening, going rigid, going still, rooted to the spot) in one sentence, followed by an explicit fear or shock label in the next 1-2 sentences.

**Detection:**
- Pass 1 indicator regex: `\b(froze|stiffened|went\s+(rigid|still|cold|pale)|rooted\s+to)\b|\b(body|muscles?|spine|shoulders?)\s+(stiff\w*|tens\w*|rigid|lock\w*|froze|seiz\w*)\b|\b(couldn.t|could\s+not|unable\s+to)\s+move\b`
- Pass 2 emotion families: `fear`, `shock`, `surprise`
- Window: 1-2 sentences

**Example (redundant echo -- flag):**
> She froze in the doorway. Fear gripped her.

"Froze" is the showing. "Fear gripped her" names the emotion and wraps it in a dead metaphor.

**Example (analytical extension -- do not flag):**
> She froze in the doorway. Not from fear -- from recognition. The man at the table wore her dead brother's face.

The second sentence explicitly rejects the obvious interpretation and substitutes a specific, plot-relevant cause. This is legitimate and necessary telling.

**fix_template:** "Freezing/stiffening already communicates fear or shock. Check whether the follow-up emotion label reframes the freeze (it's not fear but recognition), provides specific cause beyond the obvious, or adds character insight. If it merely names what the freeze already showed, cut it."

**Writer prompt rule:** "After writing freeze/stiffen responses, do NOT label them as fear or shock. The freeze is the fear. If the source of fear needs specification, provide it through the character's perception (what they see, hear, remember), not through an emotion label."

**Effort:** Medium

**FP risk + mitigation:**
- Medium. Freezing is one of the most common emotional indicators in fiction and is unambiguous as a fear/shock signal. The analytical-extension filter is particularly important here because freeze-then-reinterpret is a legitimate narrative technique (common in mystery/thriller).
- Edge case: Literal cold ("She froze in the snow") -- context makes this obvious, and the follow-up sentence would describe temperature rather than matching DECLARED_EMOTION patterns.

**Craft rationale:** Gardner (1983): the freeze response is Level 5 psychic distance -- the reader experiences it from inside the character's locked body. Naming fear afterward drops to Level 2-3, breaking the immersion at the moment of highest tension. Browne & King (2004): "cut the explanation. If the emotion is still shown, the explanation wasn't needed." Ackerman & Puglisi (2019) list freezing as a primary fear and shock indicator, the default body language a reader will interpret correctly without help.

**Verdict:** DO IT

---

## The Analytical Extension Exception

Not every emotion label following a physical indicator is an emotional echo. The critical distinction is between **redundant restatement** and **analytical extension**. The rewriter (and the lint system's false-positive filter) must distinguish these cases:

### Redundant Echo (flag and cut)

The emotion label restates what the physical detail already communicated, adding no new information:

> "Her hands trembled. She was afraid."
> "His jaw clenched. He was furious."
> "Her stomach dropped. A wave of dread washed over her."
> "He froze. Terror seized him."

In each case, the second sentence adds only an emotion label (or an emotion label wrapped in a dead metaphor). The reader already knows the emotion from the physical detail. Cutting the tell loses nothing.

### Analytical Extension (do not flag)

The emotion label is embedded in a sentence that adds one or more of:

**1. Surprise at the emotion:**
> "Her hands trembled. She hadn't expected to be this afraid -- not of him, but of what she might say."

The character is surprised by their own reaction. "Hadn't expected" signals cognitive processing, not redundant labeling.

**2. Identification of unexpected source:**
> "His jaw clenched. The anger wasn't about the insult. It was about the fact that she'd been right."

The tell specifies the *source* of anger, which the jaw clench alone cannot communicate.

**3. Comparison to past experience:**
> "Her stomach knotted. She'd felt this way before every deployment, and she'd learned that the nausea meant her instincts were right."

The character connects the present sensation to a pattern of past experience, adding backstory and self-knowledge.

**4. Reinterpretation or contradiction:**
> "She froze in the doorway. Not from fear -- from recognition."

The emotion label appears specifically to be rejected, reframing the physical response.

**5. Ironic distance or unreliable narration:**
> "His hands shook. He told himself it was the cold."

The character is denying the emotion, creating dramatic irony. The emotion label ("the cold" as deflection) reveals character through self-deception.

**6. Escalation with new content:**
> "Her breath caught. The fear was back -- the same fear that had kept her from opening the letter for three weeks, the fear that had made her change the locks."

The emotion label introduces specific, previously unknown content (the letter, the locks) that transforms the physical response from a moment into a narrative thread.

### Heuristic Filters for Analytical Extension

The implementation should apply these filters before flagging:

**Cognitive verb filter:** If the label sentence contains any of: `realized, understood, wondered, hadn't expected, didn't know, surprised, couldn't believe, recognized, told herself, told himself, reminded, remembered, knew, learned, discovered`, downgrade the flag to advisory (or suppress entirely).

**Negation filter:** If the label sentence contains negation of the emotion (`not from fear`, `wasn't anger`, `it wasn't`, `not because`), suppress the flag. Negation signals reinterpretation.

**Subordinate clause filter:** If the emotion label appears in a subordinate clause rather than the main clause (`The anger that she'd been suppressing for weeks finally had a target`), suppress the flag. Subordinate embedding indicates the emotion is being analyzed, not merely named.

**Comparative filter:** If the label sentence contains comparison markers (`like the time`, `the same way`, `reminded her of`, `as she had`, `before every`), suppress the flag. Comparison indicates the character is connecting present to past.

These filters will not catch every analytical extension, but they will eliminate the most common false positives. The residual FP rate should be manageable with the rewriter's `fix_template` instructing case-by-case evaluation.

---

## Implementation Sketch

### Architecture Decision: Hardcoded Heuristic Function

EMOTIONAL_ECHO should be implemented as a dedicated function in `src/lint/index.ts` rather than as rows in the `lint_patterns` table, because:

1. It requires cross-sentence analysis (the regex engine operates on individual matches, not sentence pairs).
2. It requires the two-pass structure (indicator detection, then proximity-based label check).
3. It requires the analytical-extension filters (cognitive verb, negation, subordinate clause, comparative).

However, the results should still be stored in `lint_issues` with a reference to a synthetic `lint_patterns` row for the EMOTIONAL_ECHO category, so that scoring, dashboarding, and reporting work identically to regex-based patterns.

### Pseudocode

```typescript
interface IndicatorDef {
  regex: RegExp
  emotionFamilies: string[]  // e.g., ["fear", "anxiety"]
}

interface EmotionLabelDef {
  regex: RegExp
  family: string  // e.g., "fear"
}

// Precompiled from Appendix B
const PHYSICAL_INDICATORS: IndicatorDef[] = [
  { regex: /\b(hands?|fingers?|body|lip|lips|voice)\s+(trembl\w*|shak\w*|shook|quiver\w*)\b/gi, emotionFamilies: ["fear", "anxiety", "anger", "grief"] },
  { regex: /\b(jaw|teeth|fists?|hands?)\s+(clench\w*|tighten\w*|grind\w*|gritted|balled|set)\b/gi, emotionFamilies: ["anger", "determination", "fear"] },
  { regex: /\b(heart|pulse)\s+(pound\w*|rac\w*|hammer\w*|skip\w*|thud\w*|flutter\w*)\b/gi, emotionFamilies: ["fear", "anxiety", "excitement"] },
  { regex: /\b(stomach|gut)\s+(churn\w*|drop\w*|knot\w*|twist\w*|tighten\w*|roil\w*|clench\w*|flip\w*|lurch\w*|sank)\b/gi, emotionFamilies: ["anxiety", "fear", "disgust", "dread"] },
  { regex: /\b(breath|breathing)\s+(catch\w*|hitch\w*|held|stop\w*|quicken\w*|froze)\b/gi, emotionFamilies: ["fear", "surprise", "shock", "anxiety"] },
  { regex: /\b(froze|stiffened|went\s+(rigid|still|cold|pale)|rooted\s+to)\b/gi, emotionFamilies: ["fear", "shock", "surprise"] },
  // ... additional indicators from Appendix B
]

// Maps emotion words to families
const EMOTION_LABELS: EmotionLabelDef[] = [
  { regex: /\b(afraid|scared|terrified|frightened|panicked|fearful)\b/gi, family: "fear" },
  { regex: /\b(angry|furious|enraged|irate|livid|incensed|seething)\b/gi, family: "anger" },
  { regex: /\b(anxious|nervous|worried|apprehensive|uneasy|agitated)\b/gi, family: "anxiety" },
  // ... complete list per emotion family table
]

// DECLARED_EMOTION patterns reused
const TELL_PATTERNS = [
  /\b(she|he|they|[A-Z][a-z]+)\s+(was|were|felt)\s+EMOTION\b/g,
  /\b(a\s+)?(wave|surge|pang|jolt|rush|stab|flash)\s+of\s+EMOTION\b/gi,
]

// Analytical extension filters
const COGNITIVE_VERBS = /\b(realized?|understood|wondered|hadn.t expected|didn.t know|surprised|couldn.t believe|recognized|told (herself|himself|themselves)|reminded|remembered|knew|learned|discovered)\b/i
const NEGATION_REFRAME = /\bnot\s+(from|because\s+of)\b|\bwasn.t\s+(anger|fear|grief|sadness|joy|love|surprise|shock)\b|\bit\s+wasn.t\b/i
const COMPARISON_MARKERS = /\b(like the time|the same (way|feeling)|reminded (her|him|them) of|as (she|he|they) had|before every)\b/i

function detectEmotionalEcho(text: string): LintIssue[] {
  const sentences = splitIntoSentences(text)
  const issues: LintIssue[] = []

  // Pass 1: Find physical indicators
  const indicatorHits: { sentenceIdx: number, families: string[], match: string }[] = []
  for (let i = 0; i < sentences.length; i++) {
    if (isInDialogue(text, getCharOffset(sentences, i))) continue
    for (const indicator of PHYSICAL_INDICATORS) {
      indicator.regex.lastIndex = 0
      const m = indicator.regex.exec(sentences[i])
      if (m) {
        indicatorHits.push({ sentenceIdx: i, families: indicator.emotionFamilies, match: m[0] })
      }
    }
  }

  // Pass 2: Check proximity window for emotion labels
  for (const hit of indicatorHits) {
    for (let offset = 0; offset <= 2; offset++) {
      const checkIdx = hit.sentenceIdx + offset
      if (checkIdx >= sentences.length) break
      // For offset 0, only check second half of sentence (after ; or --)
      const checkText = offset === 0
        ? getSecondHalf(sentences[checkIdx])
        : sentences[checkIdx]
      if (!checkText) continue
      if (isInDialogue(text, getCharOffset(sentences, checkIdx))) continue

      // Check for emotion labels matching the indicator's families
      for (const label of EMOTION_LABELS) {
        if (!hit.families.includes(label.family)) continue
        label.regex.lastIndex = 0
        const labelMatch = label.regex.exec(checkText)
        if (!labelMatch) continue

        // Check if it's in a DECLARED_EMOTION construction
        if (!isDeclaredEmotionConstruction(checkText, labelMatch)) continue

        // Apply analytical extension filters
        if (COGNITIVE_VERBS.test(checkText)) continue
        if (NEGATION_REFRAME.test(checkText)) continue
        if (COMPARISON_MARKERS.test(checkText)) continue

        issues.push({
          patternId: EMOTIONAL_ECHO_PATTERN_ID,
          charOffset: getCharOffset(sentences, hit.sentenceIdx),
          category: "EMOTIONAL_ECHO",
          match: `${sentences[hit.sentenceIdx]} || ${sentences[checkIdx]}`,
          sentence: sentences[hit.sentenceIdx],
          fixTemplate: getFixTemplate(hit.families, label.family),
        })
        break  // One flag per indicator hit
      }
    }
  }

  return issues
}
```

### Schema Considerations

The `lint_patterns` table needs a synthetic entry for EMOTIONAL_ECHO to provide the `pattern_id` foreign key for `lint_issues`:

```sql
INSERT INTO lint_patterns (tier, category, pattern, flags, fix_template, dialogue_ok, enabled, rationale, edge_cases)
VALUES (
  3, 'EMOTIONAL_ECHO', '-- heuristic, not regex --', '',
  'The physical detail already shows the emotion. Cut the label unless it adds analytical depth (surprise, contradiction, source identification, comparison to past experience).',
  false, true,
  'R.U.E. (Browne & King, 2004): showing then telling is worse than telling alone because it signals distrust of the reader. MRU violation (Swain, 1965): naming emotion after physical response reverses the involuntary-to-intentional sequence.',
  'Analytical extensions where the character processes, reframes, or contextualizes the emotion are legitimate. Filter for cognitive verbs, negation, subordinate clauses, and comparisons.'
);
```

The heuristic function should be called from `lintProse()` after the regex-based patterns, and its results appended to the same `issues` array. This keeps the scoring and persistence pipeline unchanged.

### Integration with Existing Patterns

When EMOTIONAL_ECHO flags a sentence pair, the Pass 2 label sentence will often also match the standalone DECLARED_EMOTION pattern. To avoid double-counting:

- Option A: Deduplicate in `lintProse()` -- if an EMOTIONAL_ECHO flag covers a sentence that also matches DECLARED_EMOTION, suppress the DECLARED_EMOTION match.
- Option B: Keep both flags but tag the EMOTIONAL_ECHO as the primary finding. The rewriter sees both but prioritizes the EMOTIONAL_ECHO fix_template (which includes the distinction between redundant echo and analytical extension).

**Recommendation:** Option B. Keeping both flags preserves data integrity for analysis (we can measure how often DECLARED_EMOTION co-occurs with EMOTIONAL_ECHO), while the rewriter instructions in the EMOTIONAL_ECHO fix_template are more specific and should take precedence.

---

## Pattern Summary Table

| ID | Category | Physical Indicator | Emotion Families | Window | FP Risk | Verdict |
|----|----------|-------------------|-----------------|--------|---------|---------|
| EE-1 | EMOTIONAL_ECHO | Trembling/shaking (hands, body, voice) | fear, anxiety | 1-2 sentences | Medium-High | DO IT |
| EE-2 | EMOTIONAL_ECHO | Jaw clenching, fists balling, teeth grinding | anger | 1-2 sentences | Medium | DO IT |
| EE-3 | EMOTIONAL_ECHO | Heart pounding/racing/hammering | fear, anxiety, excitement | 1-2 sentences | Medium-High | DO IT |
| EE-4 | EMOTIONAL_ECHO | Stomach churning/dropping/knotting | anxiety, fear, disgust, dread | 1-2 sentences | Medium | DO IT |
| EE-5 | EMOTIONAL_ECHO | Breath catching/holding/hitching | fear, surprise, shock | 1-2 sentences | Medium | DO IT |
| EE-6 | EMOTIONAL_ECHO | Freezing/stiffening/going rigid | fear, shock, surprise | 1-2 sentences | Medium | DO IT |

All patterns share:
- **Tier:** 3
- **dialogue_ok:** false
- **Detection method:** Two-pass heuristic with analytical-extension filters
- **Effort:** Medium (requires heuristic function, not just regex)

---

## Measurement Strategy

### Baseline Measurement

Before enabling EMOTIONAL_ECHO patterns:

1. **Run the two-pass heuristic** against all existing novel output in `output/novel-*/` to establish baseline issue counts per EE pattern.
2. **Manual review:** For each EE pattern, review 10 flagged instances to assess:
   - True positive rate (was the tell genuinely redundant?)
   - Analytical extension filter accuracy (did it correctly suppress non-redundant cases?)
   - Overlap with DECLARED_EMOTION flags (how often do they co-occur?)
3. **Calibrate the proximity window:** Compare 1-sentence vs. 2-sentence windows on the same corpus. If the 2-sentence window produces >30% more false positives than the 1-sentence window, restrict to 1 sentence.

### Ongoing Measurement

1. **Track co-occurrence with DECLARED_EMOTION:** EMOTIONAL_ECHO should fire alongside (but not instead of) DECLARED_EMOTION. The ratio of EMOTIONAL_ECHO flags to DECLARED_EMOTION flags indicates how often the AI is not just telling, but showing-then-telling.
2. **Track analytical-extension filter rates:** If >50% of potential EMOTIONAL_ECHO flags are suppressed by the analytical-extension filters, the indicator lexicon may be too broad (catching body language that precedes legitimate emotional analysis). Tighten the indicator regexes.
3. **Post-rewrite evaluation:** After the rewriter processes EMOTIONAL_ECHO flags, check whether the rewritten prose retains the physical showing while cutting the tell. If the rewriter cuts the showing instead, the fix_template needs adjustment.

### Success Criteria

- **Target true-positive rate:** >70% after analytical-extension filters.
- **Target reduction in emotional echo:** 50% reduction in show-then-tell pairs in new generations after writer prompt rules are deployed.
- **No regression on prose quality scores:** Emotional echo removal should not reduce prose quality benchmark scores. If scores drop, the analytical-extension filters may be too aggressive (suppressing legitimate flags) or the rewriter may be cutting too much.

---

## Appendix A -- Source Citations

### Primary Craft Sources

1. **Browne, Renni, and Dave King.** *Self-Editing for Fiction Writers: How to Edit Yourself into Print.* 2nd ed. New York: William Morrow, 2004. First edition 1993.
   - Chapter 1: "Show and Tell" -- introduces R.U.E. (Resist the Urge to Explain)
   - Core principle: "simply cut the explanation. If the emotion is still shown, then the explanation wasn't needed."
   - On confidence: "the tendency to describe a character's emotion may reflect a lack of confidence on the part of the writer"
   - On reader intelligence: avoiding explanation "pays readers the compliment of assuming them to be intelligent"

2. **Swain, Dwight V.** *Techniques of the Selling Writer.* Norman, OK: University of Oklahoma Press, 1965.
   - Chapter on Motivation-Reaction Units (MRUs)
   - Reaction sequence: feeling (involuntary) -> physical reflex -> conscious action -> speech
   - Principle: readers experience events in the same order characters do; violating the sequence creates "an element of unreality"

3. **Le Guin, Ursula K.** *Steering the Craft: A Twenty-First-Century Guide to Sailing the Sea of Story.* Boston: Mariner Books, 2015. First edition 1998.
   - Trust between writer and reader as foundational to narrative craft
   - Language should work through its own power, not through authorial explanation

4. **Gardner, John.** *The Art of Fiction: Notes on Craft for Young Writers.* New York: Vintage, 1983.
   - Psychic distance: "the distance the reader feels between himself and the events in the story"
   - Five-level continuum from most distant to most intimate
   - The "vivid and continuous dream": fiction's immersive effect, broken by authorial intrusion
   - Naming emotions shifts psychic distance outward, from close visceral experience to distant summary

5. **Ackerman, Angela, and Becca Puglisi.** *The Emotion Thesaurus: A Writer's Guide to Character Expression.* 2nd ed. JADD Publishing, 2019. First edition 2012.
   - Body language catalog for 130 emotions: physical signals, internal sensations, mental responses
   - Core philosophy: "readers don't want to be told how a character feels; they want to experience the emotion for themselves"
   - Entry structure: physical signals, internal sensations, mental responses, acute/long-term responses, signs of suppression, escalation, associated power verbs
   - The lexicon in Appendix B of this report is organized using categories derived from their framework

### Secondary and Contextual Sources

6. **Fawkes, September C.** "Writing Motivation-Reaction Units (MRUs According to Swain)." SeptemberCFawkes.com, January 2022.
   - Detailed breakdown of MRU reaction sequence with contemporary examples
   - Notes that reactions move "from the most involuntary reaction to the most intentional reaction"

7. **Darwin, Emma.** "Psychic Distance: What It Is and How to Use It." Substack, 2023.
   - Extended discussion of Gardner's five-level scale with practical examples
   - "Naming specific emotions moves readers outward on the spectrum"

8. **Hartenberger, Lisa.** "AI and the Art of Fiction." CRAFT Literary journal, 2025.
   - "AI is trained to generate phrase patterns; it is not trained to generate silence"
   - On AI's inability to omit: "the inability to choose what not to say is what makes [AI patterns] reliable fingerprints"

9. **King, Stephen.** *On Writing: A Memoir of the Craft.* New York: Scribner, 2000.
   - "The road to hell is paved with adverbs" -- on the weakness of qualifying emotional descriptions
   - Description should be grounded in concrete sensory detail, not abstract labeling
   - The revision instinct: the ability to recognize when description has crossed from evocative into self-indulgent

10. **Strunk, William Jr., and E.B. White.** *The Elements of Style.* 4th ed. New York: Longman, 1999. First edition 1959.
    - "Vigorous writing is concise. A sentence should contain no unnecessary words."
    - Prefer the concrete to the abstract

11. **Orwell, George.** "Politics and the English Language." 1946.
    - Dead metaphors "have lost all evocative power and are merely used because they save people the trouble of inventing phrases for themselves"

12. **Kobak, Dmitry, et al.** "Delving into ChatGPT usage in academic writing." Max Planck Institute, 2024.
    - Demonstrated 50%+ spike in AI-characteristic word usage in published essays post-ChatGPT
    - Relevant as evidence for LLM tendency toward high-frequency, low-specificity token choices

---

## Appendix B -- Physical Indicator Lexicon

The lexicon is organized by body system. Each entry includes the regex pattern, the emotion families it signals, and example narrative context. These are sourced from categories in Ackerman & Puglisi's *The Emotion Thesaurus* (2019) and cross-referenced with standard craft advice on body language in fiction.

### Hands and Arms

| Indicator | Regex | Emotion Families | Example |
|---|---|---|---|
| Trembling/shaking hands | `\b(hands?|fingers?)\s+(trembl\w*|shak\w*|shook|quiver\w*)` | fear, anxiety, anger, grief | "Her fingers trembled against the latch." |
| Clenching fists | `\b(fists?\s+(clench\w*|ball\w*|tighten\w*)|hands?\s+curled\s+into\s+fists?)` | anger, determination, fear | "His fists clenched at his sides." |
| Wringing hands | `\b(wrung|wring\w*)\s+(his|her|their)\s+hands?` | anxiety, grief, helplessness | "She wrung her hands in her lap." |
| Gripping tightly | `\b(grip\w*|clutch\w*|clung\s+to)\s+(the|his|her|their)\b.{0,20}\b(tightly|hard|white-knuckled)` | fear, anxiety, desperation | "She gripped the armrest until her knuckles whitened." |
| Hands dropping/going limp | `\bhands?\s+(drop\w*|fell|went\s+limp|slack\w*)` | defeat, shock, resignation | "His hands dropped to his sides." |
| Nails digging | `\b(nails?|fingernails?)\s+(dug|dig\w*|bit\w*)\s+(into|through)` | anger, anxiety, pain | "Her nails dug into her palms." |

### Face and Jaw

| Indicator | Regex | Emotion Families | Example |
|---|---|---|---|
| Jaw clenching/tightening | `\bjaw\s+(clench\w*|tighten\w*|set|hard\w*|lock\w*)\b|\bclenched\s+(his|her|their)\s+jaw` | anger, determination, frustration | "His jaw tightened." |
| Lips pressing/thinning | `\blips?\s+(press\w*|thin\w*|purs\w*|compress\w*|flatten\w*)\b` | anger, disapproval, restraint | "Her lips thinned to a white line." |
| Nostrils flaring | `\bnostrils?\s+flar\w*` | anger, exertion, fear | "His nostrils flared." |
| Teeth grinding/gritting | `\b(teeth|jaw)\s+(grind\w*|grit\w*|gnash\w*)\b|\bgritted\s+(his|her|their)\s+teeth` | anger, frustration, pain | "She gritted her teeth." |
| Face draining of color | `\b(face|cheeks?|color|colour)\s+(drain\w*|blanch\w*|pale\w*|went\s+(white|pale|ashen))` | fear, shock, nausea | "The color drained from her face." |
| Face flushing | `\b(face|cheeks?|neck|ears?)\s+(flush\w*|redden\w*|burn\w*|heat\w*|color\w*)\b` | embarrassment, anger, shame | "Heat crept up her neck." |

### Eyes

| Indicator | Regex | Emotion Families | Example |
|---|---|---|---|
| Eyes widening | `\beyes?\s+(widen\w*|went\s+wide|grew\s+wide|flew\s+open)` | surprise, shock, fear | "Her eyes widened." |
| Eyes narrowing | `\beyes?\s+(narrow\w*|slit\w*|squint\w*)` | suspicion, anger, assessment | "His eyes narrowed." |
| Blinking rapidly | `\bblink\w*\s+(rapid\w*|fast|several\s+times|back\s+tears?)` | surprise, fighting tears, confusion | "She blinked rapidly." |
| Eyes glistening/filling | `\beyes?\s+(glisten\w*|fill\w*|shimmer\w*|glass\w*|brimm\w*)\b.{0,15}\b(tears?|moisture|wet)` | grief, sadness, emotion | "Her eyes glistened with unshed tears." |
| Gaze dropping/averting | `\b(gaze|eyes?|look)\s+(drop\w*|avert\w*|fell|lower\w*|shift\w*\s+away)` | shame, guilt, submission | "His gaze dropped to the floor." |
| Staring blankly | `\b(star\w*|gaz\w*)\s+(blank\w*|into\s+(nothing|space|the\s+(void|distance|wall)))` | shock, dissociation, numbness | "She stared blankly at the wall." |

### Heart and Cardiovascular

| Indicator | Regex | Emotion Families | Example |
|---|---|---|---|
| Heart pounding/racing | `\b(heart|pulse)\s+(pound\w*|rac\w*|hammer\w*|thud\w*|thunder\w*|slam\w*|gallop\w*)` | fear, anxiety, excitement, anticipation | "His heart hammered against his ribs." |
| Heart skipping/stuttering | `\b(heart|pulse)\s+(skip\w*|stutter\w*|flutter\w*|miss\w*|falter\w*)` | surprise, fear, attraction | "Her heart skipped a beat." |
| Heart sinking/dropping | `\b(heart|stomach)\s+(sank|drop\w*|plummet\w*|fell|plunged)` | dread, disappointment, despair | "His heart sank." |
| Blood running cold | `\bblood\s+(ran\s+cold|froze|chill\w*|drain\w*)` | fear, horror, dread | "Her blood ran cold." |

### Stomach and Gut

| Indicator | Regex | Emotion Families | Example |
|---|---|---|---|
| Stomach churning/roiling | `\b(stomach|gut|insides?)\s+(churn\w*|roil\w*|heav\w*|revolt\w*|rebel\w*)` | anxiety, disgust, nausea, fear | "Her stomach churned." |
| Stomach dropping/sinking | `\b(stomach|gut)\s+(drop\w*|sank|plummet\w*|fell|bottom\w*\s+out)` | dread, fear, shock | "His stomach dropped." |
| Stomach knotting/tightening | `\b(stomach|gut|insides?)\s+(knot\w*|tighten\w*|twist\w*|clench\w*|coil\w*)` | anxiety, dread, fear | "A knot tightened in her stomach." |
| Bile rising | `\bbile\s+(rose|rising|burn\w*|climb\w*)` | disgust, horror, nausea | "Bile rose in his throat." |
| Nausea | `\b(nause\w*|queasy|sick\s+to\s+(his|her|their)\s+stomach)` | disgust, horror, anxiety, grief | "Nausea rolled through her." |

### Breath and Respiratory

| Indicator | Regex | Emotion Families | Example |
|---|---|---|---|
| Breath catching/hitching | `\b(breath|breathing)\s+(catch\w*|hitch\w*|snag\w*|stall\w*|seiz\w*)` | surprise, fear, shock, emotion | "Her breath caught." |
| Breath holding | `\b(held|hold\w*)\s+(his|her|their)\s+breath` | anticipation, fear, anxiety | "She held her breath." |
| Breath quickening | `\b(breath\w*|breathing)\s+(quicken\w*|speed\w*|shallow\w*|rapid|fast)` | fear, anxiety, excitement | "Her breathing quickened." |
| Gasping | `\bgasp\w*\b` | shock, surprise, pain, fear | "She gasped." |
| Breath shuddering/ragged | `\b(breath|breathing)\s+(shudder\w*|ragged|unsteady|uneven|shak\w*)` | grief, fear, aftermath of crying | "His breath came in ragged gasps." |
| Choking/throat closing | `\b(throat|voice)\s+(close\w*|tighten\w*|constrict\w*|thick\w*)\b|\bchok\w*\s+(on|back|down)` | grief, fear, anger suppression | "Her throat tightened." |

### Whole Body

| Indicator | Regex | Emotion Families | Example |
|---|---|---|---|
| Freezing in place | `\b(froze|frozen)\b|\bwent\s+(rigid|still|motionless)\b|\brooted\s+to\s+(the\s+)?(spot|floor|ground)` | fear, shock, surprise | "She froze." |
| Stiffening | `\b(stiffened|went\s+stiff|tensed|body\s+tense\w*)\b` | anger, fear, alertness | "He stiffened." |
| Trembling/shaking (body) | `\b(body|frame|shoulders?)\s+(trembl\w*|shak\w*|shook|shudder\w*|quak\w*)` | fear, cold, grief, rage | "Her whole body trembled." |
| Flinching | `\bflinch\w*\b` | fear, pain, surprise | "He flinched." |
| Recoiling | `\b(recoil\w*|shrank\s+back|drew\s+back|pulled\s+away|stepped\s+back)` | fear, disgust, surprise | "She recoiled." |
| Going weak/legs buckling | `\b(legs?\s+(buckl\w*|gave\s+(way|out)|weak\w*)|knees?\s+(buckl\w*|gave|weak\w*|went\s+soft))` | shock, relief, fear, grief | "Her knees buckled." |
| Sweating | `\b(sweat|perspir\w*)\s+(bead\w*|broke\s+out|drip\w*|trickl\w*|prick\w*)\b|\b(palms?\s+(sweat\w*|damp|slick|clammy))` | anxiety, fear, exertion | "Sweat beaded on his forehead." |
| Goosebumps/chills | `\b(goose\s*bumps?|gooseflesh|chills?\s+(ran|crept|raced|crawled)|shiver\w*|hair\s+(stood|rising|rose)\s+(on\s+end|along))` | fear, cold, awe, excitement | "Goosebumps rose along her arms." |

### Voice

| Indicator | Regex | Emotion Families | Example |
|---|---|---|---|
| Voice breaking/cracking | `\bvoice\s+(broke|crack\w*|waver\w*|falter\w*|shook|trembl\w*)` | grief, fear, overwhelming emotion | "Her voice broke." |
| Voice dropping/going quiet | `\bvoice\s+(drop\w*|fell|lower\w*|went\s+(quiet|soft|low|barely))` | fear, seriousness, grief, intimacy | "His voice dropped." |
| Voice rising/sharpening | `\bvoice\s+(rose|sharp\w*|pitch\w*|climb\w*|went\s+(shrill|high|tight))` | anger, panic, fear, hysteria | "Her voice rose." |
| Unable to speak | `\b(couldn.t|could\s+not|unable\s+to)\s+(speak|talk|form\s+words|find\s+(his|her|their)\s+(voice|words))\b|\bmouth\s+open\w*\s+(and\s+clos\w*|but\s+no)` | shock, grief, fear, overwhelm | "She opened her mouth but no words came." |

---

## Appendix C -- Example Corpus

### AI-Generated Examples Showing the Echo Pattern

These are representative examples of the emotional echo pattern as it appears in AI-generated fiction. Each demonstrates the two-part structure: physical showing followed by redundant emotion labeling.

**Example 1: Fear echo (trembling + label)**

> AI output: "Her hands trembled as she reached for the envelope. She was afraid of what she might find inside."

Analysis: "Her hands trembled" shows fear. "She was afraid" names it redundantly. The telling clause "of what she might find inside" could be retained if reframed as thought: *What was in the envelope that could make it worse?*

**Example 2: Anger echo (jaw + label)**

> AI output: "Marcus's jaw clenched, the muscles in his neck standing out like cords. Anger pulsed through him, hot and relentless."

Analysis: The jaw clench and neck tension are excellent showing -- the reader feels the anger physically. "Anger pulsed through him" adds a DECLARED_EMOTION ("anger") wrapped in a dead metaphor ("pulsed through him"). The qualifiers "hot and relentless" try to add texture but only ornament the label.

**Example 3: Dread echo (stomach + label)**

> AI output: "Her stomach knotted, a cold weight settling low in her belly. Dread filled her as she stared at the open door."

Analysis: The knotted stomach with "cold weight settling low" is visceral, close-distance showing. "Dread filled her" snaps back to mid-distance telling, naming the emotion the reader already felt through the physical detail.

**Example 4: Shock echo (freeze + label)**

> AI output: "She froze in the hallway, one hand still on the banister. Shock rippled through her like an electric current."

Analysis: "Froze" is the showing. "Shock rippled through her" names the emotion. "Like an electric current" attempts to rescue the tell with a simile, but the simile itself is a cliche. The entire second sentence should be cut.

**Example 5: Grief echo (voice + label)**

> AI output: "His voice broke on her name, the single syllable cracking like ice. Grief consumed him, vast and suffocating."

Analysis: "Voice broke" and "cracking like ice" show grief through sound and simile. "Grief consumed him" names it and "vast and suffocating" stacks adjectives on the label. The second sentence is pure echo.

**Example 6: Anxiety echo (heart + label)**

> AI output: "Her heart hammered so hard she could feel it in her teeth. Anxiety clawed at her, making it impossible to think."

Analysis: "Heart hammered so hard she could feel it in her teeth" is powerful, specific showing. "Anxiety clawed at her" names the emotion with a personification metaphor. "Making it impossible to think" adds a consequence that could be shown instead: *The numbers on the screen blurred together.*

### Published Fiction Showing Correct Handling

These examples from published authors demonstrate physical indicators of emotion without redundant labeling. The authors trust the reader to connect body language to emotion.

**Example 1: Cormac McCarthy, *The Road***

> "He held the boy against him. The boy was shaking."

McCarthy does not write "He was afraid for the boy" or "Fear filled him." The holding and shaking do all the work. The reader fills in the terror.

**Example 2: Kazuo Ishiguro, *Never Let Me Go***

> "I found I couldn't move from the spot."

Ishiguro does not explain why the narrator cannot move or name the emotion that roots her. The paralysis is the emotion, rendered in the character's own understated voice.

**Example 3: Toni Morrison, *Beloved***

> "She just flew. Collected every bit of life she had made, all the parts of her that were precious and fine and beautiful, and carried, pushed, dragged them through the veil."

Morrison shows desperation and motherly love through frantic physical action -- "collected," "carried, pushed, dragged." She does not write "She was desperate." The verbs are the emotion.

**Example 4: Raymond Carver, "Cathedral"**

> "My eyes were still closed. I was in my house. I knew that. But I didn't feel like I was inside anything."

Carver's narrator describes his physical and spatial experience without naming the emotion. The reader experiences awe, transcendence, or disorientation depending on their own reading -- which is the point. Naming the emotion would close down the interpretation.

**Example 5: Ian McEwan, *Atonement***

> "Cecilia felt the silence like a weight."

Notably, McEwan *does* name the sensation ("like a weight") but does NOT name the emotion. The sentence shows what the silence feels like physically without telling the reader whether Cecilia feels dread, guilt, or anticipation. The emotion remains implied, and the reader participates in interpreting it.

This is the key distinction: physical sensation metaphors (feeling silence as weight) are showing. Emotion labels ("she felt dread") are telling. Emotional echo combines both, which is the worst of both modes.
