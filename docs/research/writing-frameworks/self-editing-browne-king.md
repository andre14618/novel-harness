# Self-Editing for Fiction Writers — Renni Browne & Dave King

**Research report for the novel-harness project. Focus: operational, sentence-level rules that map directly to lint patterns, beat-writer prompt directives, and small-LLM checker calls in the Drafting and Validation phases.**

## 1. Framework summary

Renni Browne and Dave King's *Self-Editing for Fiction Writers* (HarperCollins/HarperPerennial, 1st ed. 1993; 2nd ed. 2004) is the line-editing companion to Swain's structural manual. Where Swain operates at the scene and paragraph level, Browne-King operates at the sentence and clause level: which words to cut, which constructions to flag, which dialogue mechanics produce amateur prose, where italics belong and where they don't, how proportion of action-to-reflection should map to story tension. Both authors were senior fiction editors (Browne ran "The Editorial Department," one of the first independent fiction-editing firms; King was a senior editor there), so the book's authority is the cumulative pattern recognition of two professionals reading thousands of unpublished manuscripts. The book is structured as twelve chapters (eleven in the 1st edition; "Voice" was added in the 2nd), each devoted to one editorial pass over a manuscript: each chapter ends with a checklist and exercises. For our harness, Browne-King is the densest single source of immediately encodable lint rules and small-LLM checker prompts. The book's distinguishing commitment is that almost every rule is illustrated with paired *before* and *after* examples, making the rules learnable as classification tasks (a small fine-tune target). The 2nd edition's "Voice" chapter is the weakest (most subjective); chapters 1–8 and 10–11 are the highest-value for our purposes.

The chapter-by-chapter sweep that follows enumerates each chapter's headline rule, the named bad patterns, and the operational checks. The book's chapter list (2nd edition, 2004):

1. Show and Tell
2. Characterization and Exposition
3. Point of View
4. Proportion
5. Dialogue Mechanics
6. See How It Sounds
7. Interior Monologue
8. Easy Beats
9. Breaking Up Is Easy to Do
10. Once Is Usually Enough
11. The Right Word
12. Voice
(Appendix in the 2nd ed.: Sophistication.)

## 2. Scene structure

Browne-King do not provide a Swain-equivalent scene structure. They presume the structure exists and operate within it. See `swain-techniques.md` for the structural layer; the two reports are complementary.

## 3. Motivation-Reaction Units

Not addressed by Browne-King under that name. They make scattered remarks consistent with MRU (e.g., on "stage-direction" and "internal vs. external" balance in chapter 4 "Proportion") but offer no equivalent typology. Treat Swain as the source for MRU; Browne-King as the source for everything sentence-level.

## 4. Self-Editing rules — chapter-by-chapter

### 4.1 Chapter 1 — Show and Tell

**Headline rule**: dramatize the moments that carry emotional or plot weight; summarize the rest. Do not narrate emotion through abstract labels when a scene-level dramatization would carry the same information through behavior.

**Bad patterns named**:

- **Naked emotion labels**: "She was angry." "He felt sad." Browne-King want the body and the action that *constitute* the anger, not the label.
- **Author-summary of dramatic content**: a one-paragraph précis of an argument that should have been a scene.
- **"Telling" verbs of cognition**: "she realized," "he understood," "she knew" — flagged when used to deliver information that the reader could infer from action.
- **Telling adverbs in dialogue tags**: "she said angrily" (overlaps with chapter 5).

**Equally important — when telling is correct**:

- Time compression ("Three weeks passed.")
- Background that does not warrant a scene
- Transitions between dramatized passages
- When showing would slow proportion past tolerance (chapter 4 cross-reference)

**Operational checks**:

- Lint: regex on direct emotion-label patterns (`(was|felt|seemed|looked) (angry|sad|happy|nervous|excited|afraid)`); fires as a candidate, not a hard error.
- Small-LLM check: paragraph-level classifier — "is this paragraph dramatizing or summarizing?" — combined with the chapter-plan beat tag to flag dramatize-mode beats that are mostly summary.

### 4.2 Chapter 2 — Characterization and Exposition

**Headline rule**: trust the reader. Backstory and character information should arrive in fragments, when needed, through action and dialogue — never as block exposition.

**Bad patterns named**:

- **Info-dump in dialogue** ("As you know, Bob..."): one character tells another character information they both already know, for the reader's benefit. Sometimes called the "maid-and-butler" opening.
- **Block backstory paragraphs**: 200+ words of biographical summary inserted into a scene.
- **Character description on first appearance** when the character isn't yet driving plot.
- **Repetition of established traits**: telling the reader twice that a character is brave, generous, etc.
- **Author-as-explainer**: parentheticals or asides that explain motivation directly.

**Operational checks**:

- Small-LLM check: for each dialogue exchange longer than ~80 tokens, ask "is this exchange primarily delivering information the speakers already know to the reader?" — fires "as you know Bob" detection.
- Lint: paragraph-length thresholds in dramatized beats (block paragraph > 150 words in a scene-mode beat is suspect).
- Lint: repeated trait phrase detection across chapters (e.g., "his iron will" appearing 3+ times across the book).

### 4.3 Chapter 3 — Point of View

**Headline rule**: pick a viewpoint per scene and stay in it. Do not "head-hop" — drift between characters' interiorities within a single scene.

**Bad patterns named**:

- **Head-hopping**: within a single scene, the narration accesses two or more characters' thoughts.
- **POV breach via observation impossibilities**: the viewpoint character "sees" their own face redden, or describes themselves in third-person prose terms that imply external observation.
- **Author-omniscient intrusions** in close-third: parenthetical narrator opinions.
- **Filtering verbs** that distance the viewpoint: "she saw the door open" (filtered) vs. "the door opened" (direct). Filtering is sometimes correct (when emphasizing the act of perception) and often wrong (when it adds a layer between reader and event). Browne-King's filter-word list: *saw, heard, felt, watched, noticed, realized, wondered, thought, decided, seemed*.

**Operational checks**:

- Small-LLM check: per-scene POV classification — "which character's interior is being accessed?" Fire on multi-character interior access within one scene.
- Lint: filtering-verb detection. Fires as a candidate; small-LLM call to disambiguate "necessary" filtering from "stripable" filtering.
- Lint: self-observation impossibilities ("his blue eyes flashed" in his own POV; "her face went white" in her own POV).

### 4.4 Chapter 4 — Proportion

**Headline rule**: scenes that carry plot or emotional weight get more page time; scenes that are connective tissue get less. Mismatched proportion (a long scene about something small, a short scene about something big) reads as amateur.

**Bad patterns named**:

- **Disproportionate dramatization** of low-stakes events.
- **Truncated climactic scenes**: the scene the whole novel has been building to gets two paragraphs.
- **Even-pacing flatness**: every chapter is the same length, every scene the same beat count, regardless of weight.
- **Action-to-reflection imbalance**: too much interiority slows the scene; too little leaves the reader without anchor.

**Operational checks**:

- Cross-beat: chapter-plan-checker can flag a chapter whose word count is more than 1.5σ off the planned `targetWords` distribution.
- Cross-beat: relative weight check — disaster beats should average longer than transition beats. The planner can mark beat priority, the writer can be told the per-beat target, the validator can score the deviation.
- Small-LLM check: per-scene "is the dramatization proportional to the stakes named in the scene goal?" — adversarial check that costs one cheap call per scene.

### 4.5 Chapter 5 — Dialogue Mechanics

**Headline rule**: most dialogue should be tagged with "said" or with action beats; almost never with "said-bookisms" (creative tag verbs); never with adverb-loaded tags. Beat tags (action beats) are usually preferable to dialogue tags when used sparingly.

This chapter is the densest source of lint patterns in the entire book. Going through it carefully:

- **Said-bookisms**: tag verbs other than "said" or "asked" — "exclaimed," "muttered," "growled," "hissed," "ejaculated," "expostulated." Browne-King: use "said" as the invisible default; reserve specialty verbs for cases where the reader genuinely cannot hear the line otherwise. Their list of forbidden tag verbs is large and well-bounded — a perfect lint regex.
- **Adverb tags**: "she said angrily," "he said sadly." Browne-King: cut the adverb. Either the dialogue carries the emotion, or you need to change the dialogue.
- **Dialogue tag vs. beat tag confusion**: a *dialogue tag* is "she said." A *beat tag* (action beat) is a sentence of action attached to dialogue: *"I'm leaving." She picked up her bag.* Browne-King prefer beat tags when used sparingly because they double as character action. Overusing beat tags (a beat after every line) clogs prose; underusing them loses anchor. They want a calibrated mix.
- **Tag positioning**: tags should come at the first natural pause in the dialogue line, not at the start, not after the entire monologue.
- **Floating dialogue**: long dialogue exchanges with no tags or beats, where the reader loses track of who's speaking. Browne-King: every 3–4 lines, anchor.
- **Bookish contractions**: characters who speak in formal "I am" / "you are" instead of "I'm" / "you're" without dialect reason. Browne-King want contractions as the default for natural speech.
- **Dialect spelling**: phonetic dialect ("ye don't say") is almost always overdone; use word choice and rhythm instead.
- **Dialogue that is too on-the-nose**: characters saying exactly what they think (overlap with Swain's chapter 4).

**Operational checks**:

- Lint regex (highest-value additions to our existing 26-pattern set):
    - `said-bookism`: tag verb in `(exclaimed|muttered|growled|hissed|barked|snarled|laughed|smiled|shouted|whispered|grumbled|chuckled|spat|cried|moaned|groaned|gasped|breathed|sighed|wheezed|chortled|cackled|giggled|simpered|smirked|snorted|huffed|scoffed|sneered|spluttered|stuttered|stammered|interjected|interposed|expostulated|ejaculated|opined|averred|asseverated|declaimed|expounded)\b` after a quotation. Score by frequency, not absolute presence; allow some.
    - `adverb tag`: `(said|asked|replied|answered) \w+ly\b` after a quotation.
    - `tag verbs that can't carry sound`: "smiled," "laughed," "grimaced," "frowned" used as dialogue tags ("'No,' she smiled.") — physiologically impossible to vocalize through.
    - `floating dialogue run`: 5+ consecutive quotation paragraphs without a `said` tag or action beat.
    - `bookish-no-contraction`: in dialogue, full forms ("I am," "you are," "do not") at frequency > some threshold without dialect/character reason.
- Small-LLM check: per-exchange "is this dialogue too on-the-nose?" — flags lines whose subtext is identical to their text.

### 4.6 Chapter 6 — See How It Sounds

**Headline rule**: read prose aloud (or have a TTS read it). Sentences that are awkward to vocalize are sentences that fail. Rhythm and repetition are detectable by ear and quantifiable by syllable/stress patterns.

**Bad patterns named**:

- **Tongue-twisters**: clusters of similar consonants or sibilants that snag the reader.
- **Repeated sentence shapes**: three subject-verb-object sentences in a row of similar length produce a metronomic beat that flattens the prose.
- **Echoing word repetitions**: the same noun, verb, or adjective recurring within a paragraph.
- **Awkward homophones / near-homophones**: clusters that read smoothly but sound jarring aloud.
- **Run-on sentences without rhythm**: 50+ word sentences without commas at appropriate breath points.

**Operational checks**:

- Lint: sentence-length variance check. A paragraph whose sentences have variance below some threshold (all sentences within 2 words of each other) is a candidate for the "metronomic" pattern. Already partially in our lint set (the rhythm pattern).
- Lint: word repetition within a 200-word window for content words (excluding stop-words and proper nouns). Already partially in our lint set (emotional echo).
- Small-LLM check (or local TTS + acoustic feature extraction): detect tongue-twister clusters by comparing consecutive consonant clusters. Probably overkill; not first priority.

### 4.7 Chapter 7 — Interior Monologue

**Headline rule**: thoughts can be rendered three ways — direct (italicized first-person present: *I have to leave.*), indirect (third-person past: *She had to leave.*), and tagged ("She thought she had to leave."). Prefer indirect; reserve direct (italics) for specific emphasis; almost never use the "she thought" tag.

**Bad patterns named**:

- **Italics overuse**: every interior thought rendered in italics, producing a manuscript with italics on every page. Browne-King: italics should be reserved for moments where the indirect form would be ambiguous about the source of the thought, or for genuine emphasis.
- **"She thought" tags**: redundant when in close-third POV (the reader already knows whose thoughts these are). Browne-King: cut the tag, either italicize or render as indirect.
- **Italics + tag double-marking**: *I have to leave, she thought.* — pick one.
- **Italics for emphasis on regular words**: ("I really *can't* believe this.") — different problem from interior monologue but called out as italics overuse.
- **Filtering of interior thought**: "She thought about how she should leave" (filtered) vs. direct rendering.

**Operational checks**:

- Lint: count italics blocks per chapter. A chapter with > N italics blocks (where N depends on chapter length) is a candidate.
- Lint: regex on `\bshe thought\b|\bhe thought\b|\bI thought\b` — fires as a candidate; small-LLM call to confirm it's redundant in close-third POV.
- Lint: italics + thought-tag colocation (`\*[^*]+\*[^.!?]*\b(thought|wondered|mused)\b`).

### 4.8 Chapter 8 — Easy Beats

**Headline rule**: action beats (the *she picked up her glass* sentences) attached to dialogue should vary; falling into a rhythm of one beat per line, or always the same kind of beat (sips of drinks, glances out windows), produces background hum that the reader filters out and that doesn't pull weight.

**Bad patterns named**:

- **Repetitive beat content**: every beat involves a beverage, every beat involves a glance.
- **Mechanical beat-per-line**: a beat after every dialogue line, regardless of pacing.
- **Beats that don't characterize**: "She nodded." vs. "She tucked her hair behind her ear, an old tell when she was lying."
- **Beats that sub for emotion labels**: "He frowned" used as shorthand for displeasure, repeatedly.

**Operational checks**:

- Lint: count of generic beat verbs (`nodded, smiled, frowned, sighed, shrugged, glanced, looked`) as fraction of all beats per chapter. High fractions flag.
- Lint: ratio of dialogue lines to action beats; a 1:1 ratio across a long exchange is a candidate.
- Small-LLM check: "do the action beats in this dialogue characterize the speaker, or are they generic?" — single call per long exchange.

### 4.9 Chapter 9 — Breaking Up Is Easy to Do

**Headline rule**: paragraph density is a pacing tool. Short paragraphs accelerate; long paragraphs slow. Use paragraph breaks to manage tension, not just grammatical turns.

**Bad patterns named**:

- **Block paragraphs in action scenes**: a chase or fight scene rendered in 200-word paragraphs reads slow even when the prose is energetic.
- **Fragmented paragraphs in reflective scenes**: a meditation rendered in single-sentence paragraphs reads as terse and unconsidered.
- **Dialogue paragraph breaks**: each new speaker gets a new paragraph (this is grammar, not style; failing it is a hard error).
- **Internal-thought breaks**: long interiority should be broken at logical thought boundaries.

**Operational checks**:

- Lint: paragraph-length distribution per chapter. Compare against beat-tag-driven expectations (action-tagged beats expect shorter paragraphs; sequel-tagged beats expect longer).
- Lint: dialogue paragraph rule — every speaker change starts a new paragraph. Hard error if violated.

### 4.10 Chapter 10 — Once Is Usually Enough

**Headline rule**: any noticeable word, image, or construction used twice on the same page or in the same chapter calls attention to itself the second time. Cut the repetition.

**Bad patterns named**:

- **Repeated content words**: nouns, verbs, adjectives reappearing within a small window.
- **Repeated images**: a metaphor or simile pattern reused — e.g., comparing two different things to "shattered glass" within a chapter.
- **Repeated sentence structures**: "He did X. He did Y. He did Z." — already covered in chapter 6.
- **Repeated attributions**: the same character described as "iron-jawed" in three places.
- **Repeated dialogue tics**: a character saying "Indeed" in every other line.

**Operational checks**:

- Lint: word-repetition window check (already partially present as our "emotional echo" pattern). Browne-King would extend this to all noticeable content words, not just emotion words.
- Lint: image-repetition check via small-LLM call — extract metaphors per chapter, flag repetition. Costlier; defer.
- Lint: character-tic check — if a character has more than N instances of the same dialogue lead-in across the book, flag.

### 4.11 Chapter 11 — The Right Word

**Headline rule**: prefer the precise common word over the impressive uncommon word. Avoid jargon, thesaurus reach, and elevated diction unless the character or narrator earns it.

**Bad patterns named**:

- **Thesaurus-pulled vocabulary**: "perambulated" for "walked"; "orbed" for "looked at."
- **Mixed-register lapses**: a casual viewpoint character thinking in elevated diction without reason.
- **"Was" overuse / passive constructions**: "There was a man standing on the corner" → "A man stood on the corner."
- **"Suddenly"**: Browne-King single this out as nearly always cuttable; if something is sudden, the prose should feel sudden, and the word redundantly labels.
- **"Began to" / "started to"**: usually replaceable with the bare verb — "She began to cry" → "She cried."
- **Hedge words**: "somewhat," "rather," "quite," "very," "really," "just" — usually cuttable.
- **Modifier stacking**: "the very dark, slightly menacing, deeply shadowed forest."

**Operational checks** (these are direct lint regex additions):

- `\bsuddenly\b` — flag.
- `\bbegan to \w+|\bstarted to \w+` — flag.
- `\b(very|really|quite|rather|somewhat|just|sort of|kind of)\b` — flag at frequency > N per chapter (already in our hedging lint).
- `\bThere (was|were|is|are) \w+ \w+ing\b` — flag (passive existential).
- Thesaurus reach: small-LLM check — sample N words per chapter and ask "is this word register-consistent with the surrounding prose?"

### 4.12 Chapter 12 — Voice (2nd ed. only)

**Headline rule**: voice is the cumulative effect of word choice, sentence rhythm, viewpoint distance, and characteristic concerns. It is built, not summoned.

This chapter is the most subjective and the least operational. For our harness, voice is handled at the *model* layer (per-genre voice LoRAs, e.g., Salvatore for fantasy) rather than the lint layer. Skip for direct rule encoding.

### 4.13 Appendix — Sophistication

**Headline rule** (across chapters but consolidated in the 2nd ed. appendix): mark of amateur prose vs. professional prose is in a small set of "tells":

- Excessive **adverbs** generally (not just in dialogue tags).
- **Melodrama** — overstated emotion, hyperbolic stakes language.
- **Sentimentality** — emotional manipulation that the prose has not earned through scene.
- **"Tell" words** — `suddenly, finally, just, very, really, somehow, sort of, kind of`.
- **Cliché simile and metaphor**.
- **Clichéd dialogue** ("It's not what you think." "I never wanted any of this." "We need to talk.").
- **Exclamation points** outside dialogue.
- **All-caps emphasis**.
- **Tag chains**: every dialogue line tagged (when alternation is established).

**Operational checks**:

- Lint regex for tell words (we have hedging; expand to the full Browne-King list).
- Lint regex for exclamation points outside dialogue contexts.
- Cliché lint (we already have ~26 patterns; Browne-King's list expands the candidate set substantially — see programmatic levers below).
- Adverb-frequency check: count of `\w+ly\b` adverbs per 1000 words; flag chapters above some calibrated threshold.

## 5. Concept/planning prescriptions

Browne-King are weak here; they explicitly disclaim plot and structural advice ("we are line editors, not story doctors"). The chapter on Proportion is the closest they come to structural input, and even there the prescription operates on the page-balance level, not the premise level. For our harness, Browne-King contributes nothing direct to concept or planning, and their absence reinforces Swain's role at that layer.

## 6. Drafting-phase prescriptions

The rules a beat-writer prompt could enforce, distilled across all twelve chapters and condensed:

### 6.1 Per-beat directives

```
While writing this beat:
1. If the beat's tag is dramatize-mode (G/C/D scene beats), prefer dramatization;
   if the tag is summary-mode (T transition beats), prefer summary.
2. Render emotion through behavior and body, not through emotion-label words
   (was angry, felt sad, seemed nervous).
3. Keep a single viewpoint character; their interior thoughts only.
4. Render thoughts in indirect close-third by default; reserve italics for
   specific emphasis; never use "she thought" tags in close-third.
5. Use "said" or "asked" as dialogue tags by default; never use a tag verb
   that cannot vocalize ("smiled," "laughed," "frowned" cannot tag dialogue);
   never use adverb tags ("said angrily").
6. Use action beats sparingly to anchor speakers in long dialogue exchanges;
   make beats specific to the character, not generic (nodded, smiled, frowned).
7. Use contractions in dialogue unless dialect or character reason exists.
8. Avoid filtering verbs (saw, heard, felt, noticed, realized, wondered)
   when direct rendering would carry the same content.
9. Cut "suddenly," "began to," "started to."
10. Cut hedges (very, really, quite, rather, somewhat, just) unless the
    viewpoint character's voice requires them.
11. Vary sentence length across the paragraph; do not stack three same-length
    sentences in a row.
12. Vary action-beat content; avoid three drink-sips, three glances, three
    nods within a scene.
13. Match paragraph length to pacing: short paragraphs in action, longer
    paragraphs in reflection.
14. Avoid restating in dialogue what the speaker already knows; cut "as you
    know" structures.
15. Once is usually enough — don't repeat noticeable content words within a
    paragraph or distinctive images within a chapter.
```

### 6.2 The minimal beat-writer system-prompt insertion

A condensed insertion (~150 tokens) for the writer prompt:

> Write in close-third on the named POV character. Render emotion through body and action, not through emotion-label words. Tag dialogue with "said" or "asked" by default; avoid tag verbs that cannot vocalize and avoid adverb-loaded tags ("said angrily"). Use action beats sparingly to anchor long exchanges; vary their content. Use contractions in dialogue. Avoid filtering verbs (saw, heard, noticed, realized, wondered) when direct rendering carries the content. Cut "suddenly," "began to," "started to," and hedges (very, really, quite, just) unless voice requires them. Match paragraph length to pacing — short for action, longer for reflection. Do not have characters dialogue-explain things they both already know.

## 7. Validation/checking prescriptions

This is Browne-King's highest-value contribution. The full lint-candidate set, organized by detection method:

### 7.1 Hard regex lints (Tier-1, deterministic)

| Pattern                             | Regex (illustrative)                                                                 | Severity     |
| ----------------------------------- | ------------------------------------------------------------------------------------ | ------------ |
| Said-bookism                        | `"\s*[,.!?]\s*\w+\s+(exclaimed\|muttered\|growled\|hissed\|barked\|...)\b`           | Warn         |
| Adverb dialogue tag                 | `(said\|asked\|replied\|answered)\s+\w+ly\b`                                         | Warn         |
| Non-vocal tag verbs                 | `"\s*[,.!?]"?\s+(\w+\s+)?(smiled\|laughed\|frowned\|grimaced\|scowled)\.?`           | Warn         |
| Suddenly                            | `\bsuddenly\b`                                                                       | Warn         |
| Began/started to                    | `\bbegan to \w+\|started to \w+`                                                     | Warn         |
| Existential passive                 | `\bThere (was\|were\|is\|are)\s+\w+\s+\w+ing\b`                                      | Info         |
| Hedge stacking                      | `\b(very\|really\|quite\|rather\|just\|somewhat)\b` (count per 1000 words)           | Warn at threshold |
| Filtering verb                      | `\b(saw\|heard\|felt\|noticed\|realized\|wondered\|watched\|thought)\b`              | Info         |
| Direct emotion label                | `\b(was\|felt\|seemed\|looked)\s+(angry\|sad\|happy\|nervous\|afraid\|excited)\b`    | Warn         |
| Italics overuse                     | Count of italics blocks per chapter > N                                              | Warn         |
| "She thought" tag                   | `\b(she\|he\|I)\s+(thought\|wondered\|mused)\b`                                      | Info         |
| Italics + thought-tag double mark   | `\*[^*]+\*[^.!?]*\b(thought\|wondered\|mused)\b`                                     | Warn         |
| Floating dialogue run               | 5+ consecutive `"..."` paragraphs with no tag                                        | Warn         |
| Exclamation outside dialogue        | `[^"]*!\s*[^"]*$` — bare `!` on lines without a quote                                | Info         |
| Sentence-length variance            | std-dev of sentence length / mean < threshold                                        | Info         |
| Word repetition within window       | Same content lemma 2+ times in 200-word window                                       | Info         |

### 7.2 Small-LLM checker calls (Tier-2)

Each is one cheap small-model call per chapter or per scene; many can run in parallel:

- **POV consistency check**: per scene, identify whose interior is accessed. Fire if more than one.
- **Self-observation breach**: per scene, identify any sentences in which the POV character is described from outside (their own face reddening, their own eyes flashing).
- **As-you-know-Bob detector**: per dialogue exchange > 80 tokens, classify whether the exchange primarily delivers information both speakers already know.
- **Show-vs-tell beat classifier**: per dramatize-tagged beat, classify whether the beat is mostly summary; fire if so.
- **Beat-content genericness**: per long dialogue exchange, classify whether the action beats are character-specific or generic.
- **On-the-nose dialogue**: per scene, flag dialogue lines whose subtext equals their text.
- **Image repetition**: per chapter, extract metaphors/similes; flag repeated patterns.
- **Register consistency**: per chapter, sample N word choices; flag thesaurus-reach lapses.

### 7.3 Cross-chapter checks (chapter-plan-checker class)

- **Trait-repetition audit**: descriptive phrases that recur across chapters ("his iron will," "her copper hair") — flag at frequency.
- **Proportion audit**: chapter word count vs. planned `targetWords`, plus weight expectations from beat tags.
- **Tic-frequency audit**: per character, frequency of dialogue lead-ins; flag character-A "Indeed" usage if it dominates their lines.

### 7.4 Patterns Browne-King explicitly call out as "wrong" (master list)

Compiled across chapters, with example flagged-construction patterns:

1. Naked emotion labels — "She was furious."
2. Block backstory in scene — 200+ word biographical paragraph mid-scene.
3. Maid-and-butler dialogue — "As you know, Henry, our family has..."
4. Head-hopping — accessing two interiors in one scene.
5. POV self-observation — "His blue eyes blazed" in his own POV.
6. Filtering verbs — "She saw the door open."
7. Said-bookism — "Indubitably!" he ejaculated.
8. Adverb tag — "she said angrily."
9. Non-vocal tag — "'No,' she smiled."
10. Floating dialogue — long exchange with no anchors.
11. Bookish dialogue — full forms when contractions are natural.
12. Phonetic dialect — "ye don't say."
13. On-the-nose dialogue — text = subtext.
14. Italics-overuse — every thought italicized.
15. Italics + "thought" double-tag — *I have to leave, she thought.*
16. "She thought" in close-third — redundant tag.
17. Beat-per-line mechanism — beat after every dialogue line.
18. Generic beats — nod, smile, frown, glance, sigh.
19. Action-tagged emotion beats — "He frowned" as a stand-in for displeasure.
20. Block paragraphs in action scenes.
21. Fragment paragraphs in reflective scenes.
22. Repeated content words in 200-word window.
23. Repeated images within a chapter.
24. Repeated sentence shapes.
25. Repeated dialogue tics for one character.
26. Thesaurus vocabulary — "perambulated" for "walked."
27. Mixed-register diction.
28. Existential passives — "There was a man standing..."
29. "Suddenly."
30. "Began to" / "started to."
31. Hedges — very, really, quite, rather, somewhat, just, sort of, kind of.
32. Modifier stacking — "the very dark, slightly menacing, deeply shadowed forest."
33. Adverb overuse generally.
34. Melodrama — overstated stakes language.
35. Sentimentality — unearned emotional manipulation.
36. "Tell" words — finally, somehow, suddenly, just.
37. Cliché simile/metaphor.
38. Cliché dialogue ("It's not what you think.").
39. Exclamation points outside dialogue.
40. ALL-CAPS emphasis.
41. Tag chains — every line tagged when alternation is established.
42. Author-as-explainer parentheticals.

This list expands our existing 26-pattern lint set to roughly 50 distinct patterns, of which ~30 are pure regex (Tier-1) and the remainder require small-LLM judgment (Tier-2). The Tier-1 set in particular is ~$0 to add.

## 8. Programmatic levers (15-25)

Each lever is a candidate knob in the writing/checking sub-loops. Format: name — type — surface.

1. `bk.said_bookism_lint` — bool — Tier-1 lint regex; warn or block.
2. `bk.adverb_tag_lint` — bool — Tier-1 lint regex.
3. `bk.non_vocal_tag_lint` — bool — Tier-1 lint regex.
4. `bk.filtering_verb_lint` — bool — Tier-1 lint regex (info-level — many false-positives).
5. `bk.emotion_label_lint` — bool — Tier-1 lint regex.
6. `bk.suddenly_lint` — bool — Tier-1 lint regex.
7. `bk.began_to_lint` — bool — Tier-1 lint regex.
8. `bk.hedge_density_lint` — float — threshold per 1000 words.
9. `bk.adverb_density_lint` — float — threshold per 1000 words.
10. `bk.existential_passive_lint` — bool — Tier-1 lint regex.
11. `bk.italics_per_chapter_max` — int — Tier-1 count check.
12. `bk.thought_tag_lint` — bool — Tier-1 lint regex.
13. `bk.floating_dialogue_run_lint` — int — N consecutive untagged quote paragraphs to fire.
14. `bk.pov_check` — small-LLM — per-scene head-hopping classifier.
15. `bk.self_observation_check` — small-LLM — POV-breach detector.
16. `bk.as_you_know_bob_check` — small-LLM — per-exchange info-dump classifier.
17. `bk.show_vs_tell_beat_check` — small-LLM — per-beat dramatize/summary classifier.
18. `bk.generic_beat_check` — small-LLM — per-exchange beat-genericness classifier.
19. `bk.on_the_nose_check` — small-LLM — text=subtext detector.
20. `bk.proportion_check` — heuristic — chapter word count vs. planned targetWords.
21. `bk.image_repetition_check` — small-LLM — per-chapter metaphor extraction + dedup.
22. `bk.register_check` — small-LLM — diction sampling.
23. `bk.beat_writer_prompt_insertion` — enum — `{none, minimal, full}` — how much of §6.2 to append to writer prompt.
24. `bk.dialogue_tag_default` — enum — `{said, asked, mixed}` — drives writer prompt.
25. `bk.italics_policy` — enum — `{none, emphasis-only, free}` — drives writer prompt.

Many of these compose with the Swain levers in `swain-techniques.md` — together they form a roughly 50-knob surface for the autonomous loop's writing-and-checking sub-loops.

## 9. Limitations

Browne-King's framework is editor-pragmatic; it is not theoretically grounded and several rules are over-applied in the wild:

- **"Show, don't tell" is overzealous.** Not every emotion needs dramatization. Some emotions are background and do not warrant scene weight; labeling them ("She was tired.") is correct economy. The harness should warn, not block, on emotion labels — especially in transition or summary beats.
- **"Said" is not the only acceptable tag.** Browne-King's preference for invisible tags is a strong default but voice-driven prose (especially fantasy with stylized narrators) can earn other tags. The said-bookism rule should be calibrated per `WRITER_GENRE_PACKS` slot — Salvatore's voice tolerates some "growled" and "snarled" that a Browne-King editor would cut.
- **Filtering verbs are sometimes correct.** When the act of perception is itself the dramatic point ("She heard the door open *before* he did") the filter is necessary. The lint should be info-level, not warn.
- **"Suddenly" has its uses.** A first-person voice that uses "suddenly" deliberately is not the same as a third-person narrator who reaches for it as a crutch. Per-character voice tracking would be needed for nuance; for now, a frequency cap is the right shape.
- **Italics rules are typeface-dependent.** In rendered ebook prose, italics work differently than in a galley proof. The harness's prose output is plain Markdown until publish, so italics counting is consistent — but the policy should not be transferred uncritically to other formats.
- **"Voice" chapter is subjective.** The 2nd-edition Voice chapter cannot be encoded as lint; voice transfers via weights (per-genre LoRAs), not rules. Skip for direct rule encoding.
- **POV head-hopping detection is non-trivial.** Determining "whose interior is being accessed" reliably requires either a small LLM with full-scene context or careful regex on cognitive verbs cross-referenced to character names. The latter is fragile; the former is the right shape but introduces a per-scene checker call.
- **"Once is usually enough" overshoots in genre fiction.** Fantasy and litRPG conventions tolerate (and sometimes reward) repetition for incantatory effect. The harness's repetition lint should be calibrated to genre, not applied uniformly.
- **Browne-King target is literary-leaning genre fiction.** Their examples skew toward thrillers and mainstream. Pure pulp, pure literary, and pure stylized voice (e.g., New Weird) deviate from Browne-King in known ways. Use as the default, override per genre pack.
- **The book pre-dates LLM-generated prose.** Many of Browne-King's named patterns (especially adverb tags, "suddenly," hedge stacking) are *also* the failure modes of unguided LLM drafting — which is a happy accident. Browne-King's rules apply as much or more to LLM output than to the human manuscripts they were written for. The harness's lint set is a near-direct port.

## 10. Citations

- Browne, Renni, and Dave King. *Self-Editing for Fiction Writers: How to Edit Yourself into Print*. New York: HarperCollins / HarperPerennial, 1st edition, 1993; 2nd edition, 2004. ISBN 0-06-054569-0 (2nd ed. paperback). Page references in this report follow the 2nd edition (2004).
- Chapter 1 ("Show and Tell"): pp. 1–18.
- Chapter 2 ("Characterization and Exposition"): pp. 19–44.
- Chapter 3 ("Point of View"): pp. 45–66.
- Chapter 4 ("Proportion"): pp. 67–86.
- Chapter 5 ("Dialogue Mechanics"): pp. 87–116.
- Chapter 6 ("See How It Sounds"): pp. 117–134.
- Chapter 7 ("Interior Monologue"): pp. 135–156.
- Chapter 8 ("Easy Beats"): pp. 157–172.
- Chapter 9 ("Breaking Up Is Easy to Do"): pp. 173–188.
- Chapter 10 ("Once Is Usually Enough"): pp. 189–204.
- Chapter 11 ("The Right Word"): pp. 205–222.
- Chapter 12 ("Voice", added in 2nd ed.): pp. 223–240.
- Sophistication appendix: pp. 241–252.

**Companion sources consulted (not cited in body):**

- Strunk, William, and E. B. White. *The Elements of Style*. 4th ed. Allyn & Bacon, 2000. Antecedent for the hedge / passive / wordiness rules.
- King, Stephen. *On Writing*. Scribner, 2000. Independent corroboration of the said-only tag rule and the adverb-cut rule (the famous "the road to hell is paved with adverbs").
- Lukeman, Noah. *The First Five Pages*. Fireside, 1999. Editorial-pragmatic companion with overlapping diagnostic patterns (manuscript "tells" of amateur prose).

---

**One-paragraph summary:** Browne and King's *Self-Editing for Fiction Writers* is a sentence-level checklist that maps almost one-to-one onto lint rules and small-LLM checkers in the harness's Validation phase, with substantial spillover into beat-writer prompt directives. The chapter-by-chapter sweep yields ~42 named bad patterns, of which roughly 30 are encodable as Tier-1 regex lints (said-bookisms, adverb tags, non-vocal tags, "suddenly," "began to," hedges, existential passives, italics overuse, "she thought" tags, floating dialogue, exclamation outside dialogue, sentence-length monotony, word repetition) and the remaining 12 are Tier-2 small-LLM checker calls (POV head-hopping, "as you know Bob," show-vs-tell beat classification, on-the-nose dialogue, generic action beats, image repetition, register consistency, proportion). The book contributes nothing to concept or planning (use Swain there) and the "Voice" chapter is the only weak section (handled at the model layer via per-genre LoRAs, not lint). Combined with Swain's structural rules, Browne-King roughly doubles the harness's existing 26-pattern lint set, with calibration knobs per `WRITER_GENRE_PACKS` slot to handle genre-driven exceptions; the highest-impact immediate additions are said-bookism detection, the adverb-tag regex, the non-vocal-tag regex, "suddenly"/"began to" cuts, italics counting, the floating-dialogue-run check, and a small-LLM POV-consistency call per scene.
