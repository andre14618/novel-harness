---
status: reference
verified: 2026-04-03
---

# AI Tells: Sentence and Paragraph Rhythm Homogeneity

> **Date:** 2026-04-03
> **Scope:** Sentence length uniformity, opening repetition, compound sentence dominance, paragraph structure homogeneity

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Background](#background)
   - [The craft case for rhythm variation](#the-craft-case-for-rhythm-variation)
   - [Burstiness: the AI detection dimension](#burstiness-the-ai-detection-dimension)
   - [Stylometric foundations](#stylometric-foundations)
3. [Detection Architecture](#detection-architecture)
   - [Why regex is insufficient](#why-regex-is-insufficient)
   - [Statistical windowing approach](#statistical-windowing-approach)
   - [Handling dialogue vs narration](#handling-dialogue-vs-narration)
   - [The lintRhythm() function design](#the-lintrhythm-function-design)
4. [Proposed Patterns](#proposed-patterns)
   - [RM-1: Sentence Length Uniformity](#rm-1-sentence-length-uniformity)
   - [RM-2: Sentence Opening Repetition](#rm-2-sentence-opening-repetition)
   - [RM-3: Compound Sentence Dominance](#rm-3-compound-sentence-dominance)
   - [PH-1: Paragraph Length Uniformity](#ph-1-paragraph-length-uniformity)
   - [PH-2: Paragraph Opening Pattern Repetition](#ph-2-paragraph-opening-pattern-repetition)
5. [Calibration Strategy](#calibration-strategy)
6. [Implementation Sketch](#implementation-sketch)
7. [Pattern Summary Table](#pattern-summary-table)
8. [Measurement Strategy](#measurement-strategy)
9. [Appendix A -- Source Citations](#appendix-a--source-citations)
10. [Appendix B -- Rhythm Metrics Reference](#appendix-b--rhythm-metrics-reference)
11. [Appendix C -- Example Corpus](#appendix-c--example-corpus)

---

## Executive Summary

**5 proposed patterns** across two new categories -- `RHYTHM_MONOTONY` (3 patterns) and `PARAGRAPH_HOMOGENEITY` (2 patterns) -- assigned to **Tier 3**.

**Tier assignment rationale:** These patterns require statistical computation over windows of text rather than regex matching at a single position. They detect structural problems that cannot be fixed by local substitution -- the fix requires rewriting multiple consecutive sentences or restructuring paragraphs. This is fundamentally different from Tier 1 (mechanical replacement) and Tier 2 (local substitution with context awareness). Tier 3 patterns flag structural/scene-level issues.

**What makes this different from existing lint:** The current `lintProse()` engine runs regex patterns against text and flags individual character offsets. Rhythm patterns require a new `lintRhythm()` function that operates on sequences of sentences or paragraphs, computing statistical measures over sliding windows. The two engines run in parallel and produce the same `LintIssue` output format for unified persistence and reporting.

**All patterns start disabled by default** (`enabled = false`). These heuristics have high false-positive risk without empirical calibration. The calibration strategy (Section 6) must be executed before any pattern is enabled.

**Expected FP risk:** High without calibration, medium after calibration. The primary false-positive scenarios are: intentional short-sentence action sequences (RM-1), deliberate anaphora for rhetorical effect (RM-2), dialogue-heavy passages with naturally short uniform lines (all patterns), and literary styles that use uniform paragraph length as a deliberate aesthetic choice (PH-1).

**Integration points:**
- New `lintRhythm()` function in `src/lint/rhythm.ts`, called alongside `lintProse()` in `lintRun()`
- DB: Heuristic patterns stored in `lint_patterns` with category `RHYTHM_MONOTONY` or `PARAGRAPH_HOMOGENEITY`, `pattern` field holds a JSON config object instead of a regex string
- Writer prompt: Add rhythm-awareness rules to `src/agents/writer/prompt.md`
- Benchmarks: Measure metrics on existing harness output and published fiction excerpts before enabling

---

## Background

### The craft case for rhythm variation

The foundational demonstration of sentence rhythm comes from Gary Provost's *100 Ways to Improve Your Writing* (1985):

> "This sentence has five words. Here are five more words. Five-word sentences are fine. But several together become monotonous. Listen to what is happening. The writing is getting boring. The sound of it drones. It's like a stuck record. The ear demands some variety. Now listen. I vary the sentence length, and I create music. Music. The writing sings. It has a pleasant rhythm, a lilt, a harmony. I use short sentences. And I use sentences of medium length. And sometimes, when I am certain the reader is rested, I will engage him with a sentence of considerable length, a sentence that burns with energy and builds with all the impetus of a crescendo, the roll of the drums, the crash of the cymbals -- sounds that say listen to this, it is important."

Provost's passage is its own proof. The first section (nine sentences, all 4-7 words) is numbing. The second section (sentences ranging from 1 to 49 words) is alive. The word counts tell the story:

- Monotonous section: 5, 5, 4, 5, 5, 5, 5, 6, 5 (mean 5.0, CV = 0.11)
- Varied section: 2, 10, 1, 3, 9, 4, 7, 49 (mean 10.6, CV = 1.38)

The coefficient of variation (standard deviation divided by mean) jumps from 0.11 to 1.38 -- a 12x increase. That quantitative gap between "drones" and "sings" is exactly what a rhythm linter should detect.

Verlyn Klinkenborg's *Several Short Sentences About Writing* (2012) takes this further, arguing that the sentence is the fundamental unit of prose craft. Klinkenborg's method treats each sentence as a musical note -- its length, its internal rhythm, its relationship to neighboring sentences all contribute to the reader's experience. The book itself is written as sentences stacked vertically, each one considered in isolation before being placed in sequence. His instruction to "catch the rhythm of the sentences without overemphasizing it" acknowledges that rhythm should be felt, not forced -- and that uniform rhythm is the absence of craft.

Roy Peter Clark's *Writing Tools* (2006) codifies this as Tool #18: "Set the pace with sentence length." Clark's formulation: "Vary sentences to influence the reader's speed." Long sentences slow the reader; short sentences accelerate. The deliberate alternation between the two creates pacing -- the writer's control over the reader's temporal experience.

The underlying principle across all three sources: **rhythm variation is not decorative -- it is functional.** Short sentences create urgency, tension, emphasis. Long sentences create flow, accumulation, complexity. Uniform sentences create monotony, regardless of their individual quality.

### Burstiness: the AI detection dimension

The craft insight that varied rhythm signals skilled writing was independently rediscovered by AI detection researchers as the concept of "burstiness."

GPTZero, developed by Edward Tian at Princeton (launched January 2023), uses burstiness as one of its core detection dimensions alongside perplexity. GPTZero defines burstiness as a measure of how much writing patterns and text perplexities vary throughout a document (GPTZero, 2024). The key observation: language models produce text with a consistent level of complexity across sentences -- low burstiness. Humans naturally vary their sentence construction and word choice -- high burstiness.

GPTZero's detection framework notes: "A perplexity above 85 is more likely than not from a human source" and that low burstiness scores are a strong indicator of machine generation. While GPTZero does not publish exact burstiness thresholds (to prevent evasion), the conceptual framework maps directly onto the craft observations: AI text has uniform sentence length and structure; human text does not.

Feature-based AI detection research reinforces this. A 2024 study on stylometric markers in LLM text identified average sentence length and its variance as important discriminators, with AI-generated text exhibiting "more uniform, grammatically standardized style, leading to lower burstiness" (ResearchGate, 2024). A hybrid detection system combining stylometric features including sentence length variance achieved over 95% accuracy in identifying AI texts.

The detection research specifically identifies these AI text characteristics relevant to rhythm:
- **Uniform sentence lengths** in the 12-18 word range (NetusAI, 2025)
- **Heavy reliance on coordinating conjunctions** for sentence construction (Stryng, 2024)
- **Less lexical diversity** than human-written text across multiple studies
- **Formulaic syntactic constructions** repeated throughout documents

These findings converge: the same property that craft experts call "monotonous rhythm" is what detection researchers call "low burstiness." Both are algorithmically detectable without LLM calls.

### Stylometric foundations

Sentence length as a quantifiable authorial fingerprint has a long history in computational stylistics.

Thomas C. Mendenhall conducted the first manual quantitative authorship analysis in the 1880s, creating "characteristic curves of composition" based on word length distributions across works by Bacon, Marlowe, and Shakespeare. While Mendenhall focused on word length rather than sentence length, his fundamental insight -- that statistical properties of text vary characteristically by author -- launched the field.

Frederick Mosteller and David Wallace's landmark 1964 study *Inference and Disputed Authorship: The Federalist* resolved the disputed authorship of twelve Federalist Papers using statistical analysis of function word frequencies. Their Bayesian approach demonstrated that quantitative text analysis could achieve reliable attribution, establishing the statistical foundations that later researchers applied to sentence-level features.

Williams (1940) and Yule (1939) were among the first to study sentence length specifically as an authorship attribute, treating the distribution of sentence lengths within a work as an author signature. Modern computational stylistics builds on this foundation: a 2015 study by Mikros and Argiri ("On sentence length distribution as an authorship attribute") confirmed that sentence length distribution carries significant authorial information, though average sentence length alone is insufficient -- the distribution shape (variance, skewness) matters.

The critical insight for our purposes: **stylometric research consistently finds that sentence length variance is author-characteristic.** Published fiction authors have distinctive rhythmic signatures. AI models, trained on averaged patterns across millions of texts, produce the mean of all these signatures -- rhythmically bland text that sounds like no one in particular. This is the same phenomenon that makes AI text detectable and makes it read as generic.

A key finding from authorship attribution research: using average sentence length as a feature "hides variation: an author with a mix of long and short sentences will have the same average as an author with consistent mid-length sentences." To capture the rhythmic signature, researchers use the distribution itself -- its variance, its sequential patterns, its coefficient of variation. This is exactly the approach the rhythm linter must take.

---

## Detection Architecture

### Why regex is insufficient

The existing `lintProse()` engine in `src/lint/index.ts` runs regex patterns against prose text, flagging individual character positions where a pattern matches. This works for lexical patterns (specific words, phrases, constructions) because the detection target is a string at a fixed position.

Rhythm patterns are fundamentally different:

1. **No single string to match.** "Sentence length uniformity" is not a pattern in the text -- it is a statistical property of a sequence of sentences. There is no regex that matches "8 consecutive sentences with similar word counts."

2. **Context is a window, not a position.** A regex match has a character offset. A rhythm issue spans a range -- "sentences 4 through 11 in paragraph 3 have CV < 0.25." The unit of detection is a window, not a point.

3. **Metrics require computation.** Coefficient of variation, consecutive-opening counting, compound sentence ratios -- these require splitting text into sentences, counting words, computing statistics. Regex cannot do arithmetic.

4. **Thresholds are continuous, not binary.** A regex either matches or does not. Rhythm metrics produce continuous values (CV = 0.31) that must be compared against thresholds. Different thresholds may apply to different contexts (dialogue vs. narration, action vs. reflection).

The `lint_patterns` table schema stores `pattern` as a TEXT field with `flags` for regex compilation. Heuristic patterns can reuse this schema by storing a JSON configuration object in the `pattern` field (e.g., `{"metric": "cv", "window": 8, "threshold": 0.25}`) with a reserved `flags` value like `"heuristic"` to signal that `lintRhythm()` should handle this pattern instead of `lintProse()`.

### Statistical windowing approach

The core detection mechanism is a sliding window over sequences of sentences (for RM patterns) or paragraphs (for PH patterns):

1. **Split** the text into units (sentences or paragraphs)
2. **Measure** each unit (word count, opening word, structure type)
3. **Slide** a window of fixed size across the sequence
4. **Compute** a metric for each window position
5. **Flag** windows where the metric exceeds/falls below the threshold

Window parameters:
- **Window size:** The number of units in each window. Smaller windows (6-8 sentences) are more sensitive but noisier. Larger windows (12-16) are more stable but miss local monotony.
- **Step size:** How many units to advance between windows. Step = 1 gives maximum sensitivity (every possible window is tested). Step = window/2 reduces computation and avoids flagging overlapping windows for the same issue.
- **Minimum text length:** Patterns should not fire on passages shorter than 2x the window size. Short passages (dialogue exchanges, single-paragraph descriptions) do not have enough data for meaningful statistics.

### Handling dialogue vs narration

Dialogue-heavy passages are the primary false-positive risk for rhythm patterns. Dialogue naturally contains short, varied utterances -- a character saying "No." followed by another saying "Why not?" is not monotonous rhythm; it is realistic speech.

The handling strategy has three levels:

1. **Exclude dialogue sentences entirely** from rhythm analysis. Use the existing `isInDialogue()` function to identify sentences inside quotation marks and skip them when building the sentence sequence for windowing. This is the most aggressive approach and the default for RM-1 and RM-3.

2. **Analyze dialogue and narration separately.** Split the text into narration-only and dialogue-only streams, apply rhythm analysis to each independently. Dialogue streams get relaxed thresholds (or are skipped entirely). This is appropriate for PH-1 and PH-2, where paragraph-level analysis should count dialogue paragraphs differently from narration paragraphs.

3. **Flag but annotate.** Run the analysis on the full text but annotate flagged windows with a dialogue percentage. Windows with >50% dialogue content are auto-suppressed or marked as low-confidence. This provides data for calibration without generating false positives.

For the initial implementation, option 1 (exclude dialogue) is recommended. It is simple, aligns with how the existing linter handles `dialogue_ok`, and avoids the most common false positive. Option 2 can be implemented later if calibration reveals that narration-only analysis misses important patterns in mixed passages.

### The lintRhythm() function design

`lintRhythm()` runs as a separate analysis pass alongside `lintProse()`:

```
lintProse(text)   --> regex-based issues
lintRhythm(text)  --> statistical/heuristic issues
                         |
                         v
              merged LintIssue[] array
              (same format, same DB persistence)
```

The function signature mirrors `lintProse()`:

```typescript
async function lintRhythm(prose: string, tier?: number): Promise<LintResult>
```

Internally, it:
1. Loads enabled heuristic patterns from `lint_patterns` where `flags = 'heuristic'`
2. Parses the JSON config from each pattern's `pattern` field
3. Splits prose into sentences and paragraphs
4. Dispatches each pattern to its detection function based on the config's `metric` field
5. Collects issues in the standard `LintIssue` format

The `charOffset` for rhythm issues points to the start of the first sentence in the flagged window. The `match` field contains a summary string (e.g., "8 sentences, CV=0.18, words: [14,12,15,13,14,16,12,15]"). The `sentence` field contains the full window text (truncated to 500 chars if needed).

---

## Proposed Patterns

### RM-1: Sentence Length Uniformity

**What:** Detects windows of consecutive narration sentences with suspiciously similar word counts. AI-generated prose tends toward a comfortable medium sentence length (12-18 words) with low variance. Published fiction oscillates between very short sentences (1-5 words) and very long ones (30+ words), with the variation itself carrying meaning.

**Detection algorithm:**

1. Split prose into sentences at `.!?\n` boundaries (using enhanced sentence splitter -- see Implementation Sketch)
2. Exclude sentences inside dialogue (via `isInDialogue()`)
3. Compute word count for each remaining narration sentence
4. Slide a window of 8 sentences across the sequence, stepping by 4
5. For each window, compute the coefficient of variation: CV = stddev / mean
6. Flag windows where CV < threshold

**Proposed threshold:** CV < 0.30

**Threshold rationale:** The Provost monotonous passage has CV = 0.11. The Provost varied passage has CV = 1.38. Published literary fiction typically has CV in the range 0.40-0.80 for 8-sentence windows (this needs empirical confirmation -- see Calibration Strategy). AI-generated fiction tends toward CV 0.15-0.35. A threshold of 0.30 aims to catch the worst monotony while avoiding false positives on naturally consistent passages. This is a starting proposal that must be calibrated against real data before enabling.

**Implementation sketch:**

```typescript
function detectSentenceLengthUniformity(
  sentences: { text: string; wordCount: number; charOffset: number }[],
  config: { window: number; step: number; threshold: number }
): LintIssue[] {
  const issues: LintIssue[] = []
  const { window, step, threshold } = config

  for (let i = 0; i <= sentences.length - window; i += step) {
    const windowSentences = sentences.slice(i, i + window)
    const counts = windowSentences.map(s => s.wordCount)
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length
    const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length
    const stddev = Math.sqrt(variance)
    const cv = mean > 0 ? stddev / mean : 0

    if (cv < threshold) {
      issues.push({
        patternId: -1, // filled by caller
        charOffset: windowSentences[0].charOffset,
        category: "RHYTHM_MONOTONY",
        match: `${window} sentences, CV=${cv.toFixed(2)}, words: [${counts.join(",")}]`,
        sentence: windowSentences.map(s => s.text).join(" ").slice(0, 500),
        fixTemplate: "" // filled by caller
      })
    }
  }
  return issues
}
```

**Pattern config (stored in `lint_patterns.pattern`):**

```json
{"metric": "sentence_length_cv", "window": 8, "step": 4, "threshold": 0.30}
```

**fix_template:** "This passage has 8+ consecutive sentences of nearly identical length, creating a metronomic rhythm. Vary the sentence lengths: break some into short punches (3-6 words), combine others into longer flowing sentences (25+ words), and insert a one-word or two-word sentence for emphasis. The goal is a CV (standard deviation / mean) above 0.40 for any 8-sentence window."

**Writer prompt rule:** "NEVER write 6+ consecutive narration sentences of similar length. After every 2-3 sentences, sharply change the length -- follow a medium sentence with a very short one, or build a long complex sentence after a series of short ones. Sentence length IS pacing: short = fast/tense, long = flowing/reflective, varied = engaging."

**Effort:** Medium -- requires the sentence splitting infrastructure and CV computation, but the math is trivial.

**FP risk and calibration approach:** High before calibration, medium after.
- **Intentional uniform rhythm:** Action sequences legitimately use staccato short sentences for pacing. A chase scene with eight 4-word sentences is not a defect. Mitigation: the 0.30 threshold should be set low enough to catch only truly monotonous passages, not intentional style. Calibration against published action scenes (e.g., Lee Child, James Patterson chase sequences) is essential.
- **Short passages:** A paragraph with exactly 8 sentences might flag even if the broader context is varied. Mitigation: minimum text requirement (passage must contain at least 16 sentences for the 8-sentence window to fire).
- **Sentence splitting errors:** Abbreviations (Dr., Mrs., U.S.) and ellipses (...) cause false sentence breaks. Mitigation: enhanced sentence splitter that handles common abbreviations.

**Craft rationale:** Provost (1985) demonstrates the principle viscerally. Clark (2006, Tool #18) codifies it as a technique. Klinkenborg (2012) makes it the foundation of prose craft. GPTZero's burstiness metric (Tian, 2023) confirms that uniform sentence length is a machine signature. Stylometric research from Williams (1940) through modern computational stylistics confirms that sentence length distribution is author-characteristic, and AI's tendency toward the mean produces distinctively flat distributions.

**Verdict:** DO IT (disabled by default, enable after calibration)

---

### RM-2: Sentence Opening Repetition

**What:** Detects consecutive sentences that begin with the same word or the same two-word pattern. AI-generated prose frequently falls into pronoun runs ("She looked... She felt... She turned... She noticed...") and article runs ("The room... The walls... The light... The air..."). While intentional anaphora (deliberate repetition for rhetorical effect) is a legitimate literary device, accidental repetition from AI's limited opening vocabulary is a craft defect.

**Detection algorithm:**

1. Split prose into sentences (same splitter as RM-1)
2. Exclude dialogue sentences
3. Extract the first word of each sentence (normalized to lowercase)
4. Scan for runs of 3+ consecutive sentences starting with the same word
5. Additionally: extract the first two words and scan for runs of 3+ with the same two-word opening
6. Flag runs of 3+ identical openings

**This pattern CAN use regex** for the single-word version, but the two-word version and the consecutive-sentence logic require the sentence-splitting infrastructure. Implementing it in `lintRhythm()` alongside the other rhythm patterns is cleaner.

**Proposed threshold:** 3+ consecutive sentences with the same opening word; 3+ with the same two-word opening.

**Threshold rationale:** Two consecutive sentences with the same opening is common and usually benign. Three consecutive is noticeable and almost always unintentional in AI prose. Published authors occasionally use three for deliberate anaphora (Dickens: "It was the best of times, it was the worst of times, it was the age of wisdom...") but this is rare outside of highly rhetorical passages.

**Implementation sketch:**

```typescript
function detectOpeningRepetition(
  sentences: { text: string; charOffset: number }[],
  config: { minRun: number; twoWord: boolean }
): LintIssue[] {
  const issues: LintIssue[] = []
  const openings = sentences.map(s => {
    const words = s.text.trim().split(/\s+/)
    return {
      one: words[0]?.toLowerCase() ?? "",
      two: words.slice(0, 2).join(" ").toLowerCase(),
      charOffset: s.charOffset,
      text: s.text
    }
  })

  // Single-word runs
  let runStart = 0
  for (let i = 1; i <= openings.length; i++) {
    if (i < openings.length && openings[i].one === openings[runStart].one) continue
    const runLength = i - runStart
    if (runLength >= config.minRun) {
      const runSentences = openings.slice(runStart, i)
      issues.push({
        patternId: -1,
        charOffset: runSentences[0].charOffset,
        category: "RHYTHM_MONOTONY",
        match: `${runLength}x "${openings[runStart].one}..." opening`,
        sentence: runSentences.map(s => s.text).join(" ").slice(0, 500),
        fixTemplate: ""
      })
    }
    runStart = i
  }

  // Two-word runs (if enabled)
  if (config.twoWord) {
    runStart = 0
    for (let i = 1; i <= openings.length; i++) {
      if (i < openings.length && openings[i].two === openings[runStart].two) continue
      const runLength = i - runStart
      if (runLength >= config.minRun) {
        const runSentences = openings.slice(runStart, i)
        issues.push({
          patternId: -1,
          charOffset: runSentences[0].charOffset,
          category: "RHYTHM_MONOTONY",
          match: `${runLength}x "${openings[runStart].two}..." two-word opening`,
          sentence: runSentences.map(s => s.text).join(" ").slice(0, 500),
          fixTemplate: ""
        })
      }
      runStart = i
    }
  }

  return issues
}
```

**Pattern config:**

```json
{"metric": "opening_repetition", "minRun": 3, "twoWord": true}
```

**fix_template:** "These consecutive sentences all start with the same word/phrase. Vary the openings: start with a prepositional phrase, an adverb, a participial phrase, dialogue, or a different subject. If this is intentional anaphora for rhetorical effect, the repetition should build to a climax -- if it does not escalate, it reads as accidental."

**Writer prompt rule:** "NEVER start 3+ consecutive narration sentences with the same word. Especially avoid pronoun runs (She... She... She...) and article runs (The... The... The...). Vary sentence openings: use prepositional phrases, adverbial clauses, participial phrases, inversions, and dialogue beats to break monotonous patterns."

**Effort:** Low-medium -- the detection logic is straightforward, leveraging the same sentence-splitting infrastructure as RM-1.

**FP risk and calibration approach:** Medium.
- **Intentional anaphora:** Deliberate rhetorical repetition (e.g., "I have a dream..." or Dickens' "It was...") is a literary device. Mitigation: the fix_template explicitly acknowledges intentional anaphora and instructs the rewriter to preserve it if it escalates. For automated use, a whitelist of known anaphoric patterns could be added later.
- **Pronoun-heavy close POV:** Close third-person narration uses the protagonist's name or pronoun frequently. "She" appearing at the start of 3 consecutive sentences in close third is more forgivable than in omniscient narration. Mitigation: threshold of 3 is conservative. Raising to 4 during calibration is an option.
- **Dialogue attribution runs:** "She said... He said... She said..." in dialogue-heavy passages. Mitigation: dialogue exclusion handles the dialogue itself; attribution sentences ("She said") after dialogue are narration and will be caught -- but these are genuinely worth flagging.

**Craft rationale:** Browne & King (*Self-Editing for Fiction Writers*, Ch. 3 "Point of View") identify pronoun-heavy openings as a symptom of weak POV management. ProWritingAid and other editing tools flag repeated sentence openings as a standard prose quality check. In AI-generated fiction, pronoun runs and article runs are among the most immediately visible tells -- the model defaults to Subject-Verb-Object structure and rarely varies its syntactic openings.

**Verdict:** DO IT (disabled by default, enable after calibration)

---

### RM-3: Compound Sentence Dominance

**What:** Detects windows where an excessive proportion of sentences use compound structure (independent clause + coordinating conjunction + independent clause). AI defaults to medium-complexity compound sentences as a comfortable middle ground: not too simple (which feels choppy) and not too complex (which risks syntactic errors). The result is a passage where most sentences follow the pattern "X happened, and Y happened" or "X was true, but Y was also true."

**Detection algorithm:**

1. Split prose into sentences (same infrastructure)
2. Exclude dialogue sentences
3. For each sentence, test whether it contains a comma followed by a coordinating conjunction: `, and `, `, but `, `, so `, `, yet `, `, or `, `, nor `
4. Slide a window of 10 sentences, stepping by 5
5. Compute the ratio of compound sentences in each window
6. Flag windows where the ratio exceeds the threshold

**Proposed threshold:** >60% compound sentences in a 10-sentence window (i.e., 7+ out of 10).

**Threshold rationale:** In published literary fiction, sentence types are roughly evenly distributed among simple, compound, and complex, with significant variation by author and scene type. A 60% compound rate means the author is almost never using simple sentences (for punch) or complex sentences (for nuance). This threshold is deliberately high to avoid flagging passages that happen to have a few compound sentences in a row. Calibration should test whether 50% is a better threshold for AI output.

**Implementation sketch:**

```typescript
function detectCompoundDominance(
  sentences: { text: string; charOffset: number }[],
  config: { window: number; step: number; threshold: number }
): LintIssue[] {
  const issues: LintIssue[] = []
  const COMPOUND_RE = /,\s+(and|but|so|yet|or|nor)\s+/i

  for (let i = 0; i <= sentences.length - config.window; i += config.step) {
    const windowSentences = sentences.slice(i, i + config.window)
    const compoundCount = windowSentences.filter(s => COMPOUND_RE.test(s.text)).length
    const ratio = compoundCount / config.window

    if (ratio > config.threshold) {
      issues.push({
        patternId: -1,
        charOffset: windowSentences[0].charOffset,
        category: "RHYTHM_MONOTONY",
        match: `${compoundCount}/${config.window} compound sentences (${(ratio * 100).toFixed(0)}%)`,
        sentence: windowSentences.map(s => s.text).join(" ").slice(0, 500),
        fixTemplate: ""
      })
    }
  }
  return issues
}
```

**Pattern config:**

```json
{"metric": "compound_dominance", "window": 10, "step": 5, "threshold": 0.60}
```

**fix_template:** "Over 60% of sentences in this passage are compound (clause + conjunction + clause). Mix in simple sentences for emphasis ('She ran.'), complex sentences for nuance ('Although the door was locked, she found a way through the window that overlooked the garden.'), and fragments for rhythm ('Gone.'). Not every idea needs a conjunction."

**Writer prompt rule:** "NEVER let more than half the sentences in a paragraph be compound (two clauses joined by ', and', ', but', ', so'). Use simple sentences for punchy emphasis, complex sentences (with subordinate clauses) for nuance, and occasional fragments for rhythm. Compound sentences are the AI default -- actively vary sentence types."

**Effort:** Low -- the comma+conjunction regex is simple, and the windowing infrastructure is shared with RM-1.

**FP risk and calibration approach:** Medium.
- **Legitimate compound-heavy style:** Some published authors (e.g., Hemingway's later work, Cormac McCarthy) use extensive coordination. Mitigation: the 60% threshold is high enough that normal compound usage will not trigger it. Calibration against a range of published styles is essential.
- **False compound detection:** A sentence like "She picked up the red, soft, and fuzzy blanket" contains `, and` but is not a compound sentence -- it is a list. Mitigation: the regex `,\s+(and|but|so|yet|or|nor)\s+` will catch some list constructions. A more sophisticated detector could require that text on both sides of the conjunction contains a verb, but this adds NLP complexity. For the initial implementation, the simple regex with the high threshold (60%) provides adequate precision.
- **Dialogue attribution:** "She said, and he nodded" is technically a compound sentence but reads differently from narration compounds. Mitigation: dialogue exclusion.

**Craft rationale:** Clark (2006, Tool #18) emphasizes varying sentence types, not just lengths. The Wikipedia entry on signs of AI writing identifies "heavy reliance on correlative conjunctions" and "formulaic syntactic constructions" as AI markers. Research on AI text detection consistently finds that AI text has less syntactic diversity than human text, with compound sentences as the default structure. Waddell, Esch, and Walker's *The Art of Styling Sentences* catalogs 20 sentence patterns and emphasizes that skilled writers draw from the full range -- defaulting to one pattern (compound) is the opposite of craft.

**Verdict:** DO IT (disabled by default, enable after calibration)

---

### PH-1: Paragraph Length Uniformity

**What:** Detects sequences of consecutive paragraphs with suspiciously similar word counts. AI-generated prose tends toward paragraphs of uniform length -- typically 60-120 words each, forming regular blocks of text. Published fiction varies paragraph length dramatically for pacing: one-sentence paragraphs for emphasis, long paragraphs for immersive description, short staccato paragraphs for action, varying the visual rhythm of the page.

**Detection algorithm:**

1. Split prose by `\n\n` into paragraphs
2. Compute word count for each paragraph
3. Filter out very short paragraphs (< 5 words -- likely dialogue tags or whitespace artifacts)
4. Slide a window of 4 paragraphs, stepping by 2
5. For each window, check if all paragraph word counts are within 20% of the window's mean
6. Flag windows where all paragraphs are within the tolerance band

**Alternative metric:** Compute CV across paragraph lengths in the window. Flag if CV < 0.15 (very tight clustering). The 20% tolerance band is simpler to explain but the CV approach is more statistically principled. Both should be tested during calibration.

**Proposed threshold:** 4+ consecutive paragraphs within 20% of each other's word count, OR paragraph-level CV < 0.15 over 4-paragraph windows.

**Threshold rationale:** In published fiction, consecutive paragraphs routinely vary from 10 words to 200+ words, especially in scenes mixing dialogue, action, and description. Four paragraphs of similar length is unusual enough to be worth examining. The 20% tolerance means a paragraph of 80 words would need all neighbors to be between 64 and 96 words -- a tight band that rarely occurs naturally in varied prose.

**Implementation sketch:**

```typescript
function detectParagraphUniformity(
  paragraphs: { text: string; wordCount: number; charOffset: number }[],
  config: { window: number; step: number; tolerance: number; minWords: number }
): LintIssue[] {
  const issues: LintIssue[] = []
  const filtered = paragraphs.filter(p => p.wordCount >= config.minWords)

  for (let i = 0; i <= filtered.length - config.window; i += config.step) {
    const windowParas = filtered.slice(i, i + config.window)
    const counts = windowParas.map(p => p.wordCount)
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length

    const allWithinTolerance = counts.every(
      c => Math.abs(c - mean) / mean <= config.tolerance
    )

    if (allWithinTolerance) {
      issues.push({
        patternId: -1,
        charOffset: windowParas[0].charOffset,
        category: "PARAGRAPH_HOMOGENEITY",
        match: `${config.window} paragraphs within ${(config.tolerance * 100).toFixed(0)}% of mean (${mean.toFixed(0)} words): [${counts.join(", ")}]`,
        sentence: windowParas.map(p => p.text.slice(0, 80) + "...").join(" | ").slice(0, 500),
        fixTemplate: ""
      })
    }
  }
  return issues
}
```

**Pattern config:**

```json
{"metric": "paragraph_length_cv", "window": 4, "step": 2, "tolerance": 0.20, "minWords": 5}
```

**fix_template:** "These consecutive paragraphs are all nearly the same length, creating a visually and rhythmically monotonous page. Vary paragraph length for pacing: use a one-sentence paragraph for a gut-punch moment, a long paragraph for an immersive description, and shorter paragraphs for rapid action or dialogue. The page should look varied when you squint at it."

**Writer prompt rule:** "NEVER write 4+ consecutive paragraphs of similar length. Vary paragraph size deliberately: use one-sentence paragraphs for emphasis, long paragraphs (150+ words) for immersive passages, and short paragraphs (20-40 words) for transitions and action beats. When you finish a paragraph, make the next one a visibly different length."

**Effort:** Low -- paragraph splitting by `\n\n` is trivial, word counting is trivial, the tolerance check is simple arithmetic.

**FP risk and calibration approach:** Medium-high.
- **Dialogue-heavy passages:** Extended dialogue exchanges produce many short paragraphs of similar length (one line of dialogue each). Mitigation: filter out dialogue-only paragraphs (paragraphs that are >80% dialogue by character count) before analysis. This requires combining paragraph splitting with dialogue detection.
- **Consistent literary style:** Some literary fiction (e.g., Jose Saramago's long-paragraph style, or minimalist flash fiction with uniform short paragraphs) intentionally maintains consistent paragraph length. Mitigation: the 4-paragraph minimum window and 20% tolerance are conservative. Calibration against a diverse corpus is essential.
- **Genre differences:** Romance and thriller fiction tends toward shorter, more uniform paragraphs than literary fiction. Mitigation: genre-aware thresholds could be added later, but the initial implementation uses a single threshold.

**Craft rationale:** The KillZone blog ("Pacing and Spacing: The Power of Artful Paragraphing," 2019) emphasizes that "white space on a page spells relief" and contrasts "turgid" uniform paragraphs with varied ones that create tension. Literature & Latte's analysis of chapter and paragraph length effects on pacing confirms that short paragraphs accelerate pace while long ones slow it -- and that deliberate variation between the two creates the reader's temporal experience. Janice Hardy (*Fiction University*, "Pacing, Line by Line") connects paragraph length directly to pacing at the line level, advocating for deliberate variation as a scene-level control.

**Verdict:** DO IT (disabled by default, enable after calibration)

---

### PH-2: Paragraph Opening Pattern Repetition

**What:** Detects consecutive paragraphs that open with the same syntactic pattern. AI-generated prose frequently falls into a pattern where every paragraph opens with "[Character name] [past-tense verb]" -- "Elena crossed the room. Elena felt the weight. Elena turned to face him." Alternatively, a pattern of "[Pronoun] [verb]ed" -- "She looked... She turned... She felt..." across paragraph boundaries.

This is the paragraph-level equivalent of RM-2 (sentence opening repetition), but operating across paragraph boundaries, which is more noticeable to readers because each paragraph opening is visually prominent.

**Detection algorithm:**

1. Split prose by `\n\n` into paragraphs
2. Extract the first sentence of each paragraph
3. Extract the first 2 words of each first sentence, normalized to lowercase
4. Classify the opening pattern into types:
   - `pronoun_verb`: starts with a pronoun (she, he, they, it, I) followed by a verb
   - `name_verb`: starts with a capitalized word followed by a past-tense verb
   - `article_noun`: starts with the/a/an followed by a noun
   - `other`: anything else
5. Flag runs of 3+ paragraphs with the same opening pattern type AND the same first word

**Proposed threshold:** 3+ consecutive paragraphs opening with the same first word, OR 4+ consecutive paragraphs opening with the same pattern type (e.g., all `pronoun_verb`).

**Threshold rationale:** Three paragraphs opening with "She" is immediately noticeable. Four paragraphs all starting with "[Pronoun] [verb]" (even if different pronouns) suggests structural monotony. The two-tier threshold catches both specific word repetition and broader pattern repetition.

**Implementation sketch:**

```typescript
function detectParagraphOpeningRepetition(
  paragraphs: { text: string; charOffset: number }[],
  config: { minRunWord: number; minRunPattern: number }
): LintIssue[] {
  const issues: LintIssue[] = []
  const PRONOUNS = new Set(["she", "he", "they", "it", "i", "we", "you"])
  const ARTICLES = new Set(["the", "a", "an"])

  const openings = paragraphs.map(p => {
    const firstSentence = p.text.split(/[.!?\n]/)[0]?.trim() ?? ""
    const words = firstSentence.split(/\s+/)
    const first = words[0]?.toLowerCase() ?? ""
    const second = words[1]?.toLowerCase() ?? ""

    let patternType = "other"
    if (PRONOUNS.has(first)) patternType = "pronoun_verb"
    else if (ARTICLES.has(first)) patternType = "article_noun"
    else if (first[0] === first[0]?.toUpperCase() && second.endsWith("ed"))
      patternType = "name_verb"

    return { first, patternType, charOffset: p.charOffset, text: firstSentence }
  })

  // Same first word runs
  let runStart = 0
  for (let i = 1; i <= openings.length; i++) {
    if (i < openings.length && openings[i].first === openings[runStart].first) continue
    const runLength = i - runStart
    if (runLength >= config.minRunWord) {
      const run = openings.slice(runStart, i)
      issues.push({
        patternId: -1,
        charOffset: run[0].charOffset,
        category: "PARAGRAPH_HOMOGENEITY",
        match: `${runLength} paragraphs opening with "${openings[runStart].first}"`,
        sentence: run.map(o => o.text).join(" | ").slice(0, 500),
        fixTemplate: ""
      })
    }
    runStart = i
  }

  // Same pattern type runs
  runStart = 0
  for (let i = 1; i <= openings.length; i++) {
    if (i < openings.length && openings[i].patternType === openings[runStart].patternType) continue
    const runLength = i - runStart
    if (runLength >= config.minRunPattern) {
      const run = openings.slice(runStart, i)
      issues.push({
        patternId: -1,
        charOffset: run[0].charOffset,
        category: "PARAGRAPH_HOMOGENEITY",
        match: `${runLength} paragraphs with "${openings[runStart].patternType}" opening pattern`,
        sentence: run.map(o => o.text).join(" | ").slice(0, 500),
        fixTemplate: ""
      })
    }
    runStart = i
  }

  return issues
}
```

**Pattern config:**

```json
{"metric": "paragraph_opening_repetition", "minRunWord": 3, "minRunPattern": 4}
```

**fix_template:** "These consecutive paragraphs all open with the same pattern. Vary paragraph openings: start with a setting detail, a sensory impression, an action, dialogue, a subordinate clause, or a sentence fragment. Each paragraph opening is the reader's first impression of a new unit -- repetitive openings signal mechanical prose."

**Writer prompt rule:** "NEVER start 3+ consecutive paragraphs with the same word. NEVER start 4+ consecutive paragraphs with the same syntactic pattern (e.g., all '[Name] [verb]ed' or all '[Pronoun] [verb]'). Begin paragraphs with variety: setting details, actions, dialogue, subordinate clauses, sensory descriptions, single-word sentences."

**Effort:** Medium -- requires paragraph splitting, first-sentence extraction, and basic pattern classification. The pattern classification (pronoun_verb, name_verb, etc.) is a heuristic and does not require NLP parsing.

**FP risk and calibration approach:** Medium.
- **POV consistency:** Close third-person narration naturally gravitates toward the protagonist's name or pronoun at paragraph starts. "She" opening 4 consecutive paragraphs in deep POV is more forgivable than in omniscient narration. Mitigation: the same-word threshold of 3 is conservative for common pronouns. During calibration, consider raising to 4 for "she/he" specifically.
- **Scene-opening conventions:** Many published novels start consecutive paragraphs with the same character name when establishing a new scene. Mitigation: the pattern fires only for 3+ consecutive occurrences, and the fix_template acknowledges that scene establishment may justify some repetition.
- **Pattern type false positives:** The heuristic pattern classification (pronoun_verb, name_verb) is imperfect -- some sentences classified as "pronoun_verb" may actually start with a pronoun used as a determiner. Mitigation: the 4-paragraph threshold for pattern-type runs is deliberately high.

**Craft rationale:** Browne & King (*Self-Editing for Fiction Writers*) identify repetitive paragraph openings as a mark of amateurish prose. The ProWritingAid tool explicitly flags repeated sentence and paragraph openings. In AI-generated prose, paragraph opening repetition is one of the most visible structural tells -- models tend to start every paragraph with the same subject-verb structure, creating a visual monotony that experienced readers notice immediately.

**Verdict:** DO IT (disabled by default, enable after calibration)

---

## Calibration Strategy

All five patterns start disabled. Enabling them without calibration will produce unacceptable false-positive rates. The calibration process:

### Phase 1: Measure published fiction baselines (1-2 days)

**Corpus selection:** Select 10 published fiction excerpts (5,000-10,000 words each) spanning genres and styles:

| # | Book | Author | Genre | Why included |
|---|------|--------|-------|-------------|
| 1 | *The Road* | Cormac McCarthy | Literary | Short sentences, minimal paragraphing |
| 2 | *Normal People* | Sally Rooney | Literary | Close third, dialogue-heavy |
| 3 | *Gone Girl* | Gillian Flynn | Thriller | Dual POV, varied pacing |
| 4 | *The Name of the Wind* | Patrick Rothfuss | Fantasy | Ornate prose, long sentences |
| 5 | *The Hunger Games* | Suzanne Collins | YA/Action | First person, action-heavy |
| 6 | *Beloved* | Toni Morrison | Literary | Highly varied rhythm, experimental |
| 7 | *The Da Vinci Code* | Dan Brown | Thriller | Short chapters, punchy paragraphs |
| 8 | *A Game of Thrones* | George R.R. Martin | Fantasy | Multiple POV, varied styles |
| 9 | *Big Little Lies* | Liane Moriarty | Contemporary | Dialogue-heavy, multiple voices |
| 10 | *Circe* | Madeline Miller | Literary/Myth | First person, flowing prose |

**Metrics to compute for each excerpt:**
- Sentence length CV across all 8-sentence windows (distribution: min, P25, median, P75, max)
- Maximum run of same-opening sentences
- Maximum run of same-opening paragraphs
- Compound sentence ratio across all 10-sentence windows (distribution)
- Paragraph length CV across all 4-paragraph windows (distribution)

**Deliverable:** A table of metric distributions per book, plus aggregate distributions across all 10 books. This establishes the "what published fiction looks like" baseline.

### Phase 2: Measure AI output baselines (1 day)

Run the same metrics on existing harness output:
- Select 10 recent generations from the DB (diverse seeds: romance-drama, sci-fi-thriller, dark-fantasy, young-adult-fantasy, minimal)
- Compute the same metric distributions as Phase 1

**Deliverable:** A table of metric distributions per generation, plus aggregate. This establishes the "what our AI output looks like" baseline.

### Phase 3: Compare and set thresholds (1 day)

For each metric:
1. Plot the published fiction distribution and AI output distribution
2. Identify the gap between the two distributions
3. Set the threshold in the gap -- ideally at a point where:
   - <5% of published fiction windows would be flagged (low FP rate)
   - >50% of AI output windows would be flagged (high detection rate)
4. If no clear gap exists for a metric, that pattern is not viable and should remain disabled

**Example (hypothetical):**
- Published fiction sentence length CV: median 0.55, P25 = 0.38
- AI output sentence length CV: median 0.22, P25 = 0.15
- Threshold: CV < 0.30 flags 80% of AI windows, <3% of published fiction windows

### Phase 4: Enable and monitor (ongoing)

1. Enable patterns one at a time, starting with the pattern that has the clearest gap between distributions
2. Run lint on the next 5 benchmark generations
3. Manually review every flagged issue for false positives
4. Adjust thresholds based on FP review
5. If FP rate > 10% after adjustment, disable the pattern and revisit

### Calibration infrastructure

The calibration process should be scripted and reproducible:

```bash
# Compute rhythm metrics on a text file (published fiction excerpt)
bun scripts/rhythm-calibrate.ts --input excerpts/mccarthy-road.txt --output calibration/mccarthy.json

# Compute rhythm metrics on harness generations
bun scripts/rhythm-calibrate.ts --from-db --run-id 42 --output calibration/run42.json

# Compare distributions
bun scripts/rhythm-compare.ts --published calibration/*.json --ai calibration/run*.json
```

The calibration scripts compute all five metrics and output JSON with full window-level data, enabling statistical analysis and visualization.

---

## Implementation Sketch

### File structure

```
src/lint/
  index.ts        # existing regex linter (unchanged)
  rhythm.ts       # new rhythm/heuristic linter
  sentences.ts    # shared sentence-splitting utilities
```

### Enhanced sentence splitter (`src/lint/sentences.ts`)

The existing `getSentenceAt()` in `index.ts` finds a single sentence around a position. The rhythm linter needs to split an entire text into all sentences:

```typescript
interface Sentence {
  text: string
  wordCount: number
  charOffset: number
  inDialogue: boolean
}

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr",
  "vs", "etc", "inc", "ltd", "st", "ave",
  "gen", "sgt", "cpl", "pvt", "capt", "lt", "col"
])

function splitSentences(text: string): Sentence[] {
  const sentences: Sentence[] = []
  let start = 0
  let inQuote = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    // Track dialogue state
    if (ch === '\u201C') inQuote = true
    else if (ch === '\u201D') inQuote = false
    else if (ch === '"') inQuote = !inQuote

    // Sentence boundary detection
    if (ch === '.' || ch === '!' || ch === '?' || ch === '\n') {
      // Check for abbreviations (period only)
      if (ch === '.') {
        const beforeDot = text.slice(start, i).trim().split(/\s+/).pop()?.toLowerCase() ?? ""
        if (ABBREVIATIONS.has(beforeDot)) continue
        // Check for ellipsis
        if (text[i + 1] === '.' || text[i - 1] === '.') continue
      }

      // Check for paragraph break (not sentence break)
      if (ch === '\n' && text[i + 1] !== '\n') continue

      const sentText = text.slice(start, i + 1).trim()
      if (sentText.length > 0) {
        const wordCount = sentText.split(/\s+/).filter(w => w.length > 0).length
        sentences.push({
          text: sentText,
          wordCount,
          charOffset: start,
          inDialogue: inQuote
        })
      }
      start = i + 1
    }
  }

  // Handle trailing text without terminal punctuation
  const trailing = text.slice(start).trim()
  if (trailing.length > 0) {
    sentences.push({
      text: trailing,
      wordCount: trailing.split(/\s+/).filter(w => w.length > 0).length,
      charOffset: start,
      inDialogue: inQuote
    })
  }

  return sentences
}

interface Paragraph {
  text: string
  wordCount: number
  charOffset: number
  dialogueRatio: number  // 0.0 to 1.0
}

function splitParagraphs(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = []
  let offset = 0

  for (const block of text.split(/\n\n+/)) {
    const trimmed = block.trim()
    if (trimmed.length === 0) {
      offset += block.length + 2
      continue
    }

    const wordCount = trimmed.split(/\s+/).filter(w => w.length > 0).length

    // Compute dialogue ratio
    let dialogueChars = 0
    let inQuote = false
    for (const ch of trimmed) {
      if (ch === '\u201C' || (ch === '"' && !inQuote)) { inQuote = true; continue }
      if (ch === '\u201D' || (ch === '"' && inQuote)) { inQuote = false; continue }
      if (inQuote) dialogueChars++
    }
    const dialogueRatio = trimmed.length > 0 ? dialogueChars / trimmed.length : 0

    paragraphs.push({
      text: trimmed,
      wordCount,
      charOffset: text.indexOf(trimmed, offset),
      dialogueRatio
    })

    offset += block.length + 2
  }

  return paragraphs
}
```

### Rhythm linter (`src/lint/rhythm.ts`)

```typescript
import db from "../../data/connection"
import type { LintIssue, LintPattern, LintResult } from "./index"

interface RhythmConfig {
  metric: string
  [key: string]: any
}

async function getEnabledRhythmPatterns(tier?: number): Promise<LintPattern[]> {
  const patterns = tier !== undefined
    ? await db`SELECT * FROM lint_patterns WHERE enabled = true AND flags = 'heuristic' AND tier = ${tier}`
    : await db`SELECT * FROM lint_patterns WHERE enabled = true AND flags = 'heuristic'`
  return patterns as LintPattern[]
}

export async function lintRhythm(prose: string, tier?: number): Promise<LintResult> {
  const patterns = await getEnabledRhythmPatterns(tier)
  const allIssues: LintIssue[] = []

  // Pre-compute sentence and paragraph splits (shared across patterns)
  const sentences = splitSentences(prose)
  const narrationSentences = sentences.filter(s => !s.inDialogue)
  const paragraphs = splitParagraphs(prose)
  const narrationParagraphs = paragraphs.filter(p => p.dialogueRatio < 0.5)

  for (const pat of patterns) {
    let config: RhythmConfig
    try { config = JSON.parse(pat.pattern) }
    catch { continue }

    let issues: LintIssue[] = []

    switch (config.metric) {
      case "sentence_length_cv":
        issues = detectSentenceLengthUniformity(narrationSentences, config)
        break
      case "opening_repetition":
        issues = detectOpeningRepetition(narrationSentences, config)
        break
      case "compound_dominance":
        issues = detectCompoundDominance(narrationSentences, config)
        break
      case "paragraph_length_cv":
        issues = detectParagraphUniformity(narrationParagraphs, config)
        break
      case "paragraph_opening_repetition":
        issues = detectParagraphOpeningRepetition(narrationParagraphs, config)
        break
    }

    // Stamp pattern metadata onto each issue
    for (const issue of issues) {
      issue.patternId = pat.id
      issue.category = pat.category
      issue.fixTemplate = pat.fix_template
    }

    allIssues.push(...issues)
  }

  allIssues.sort((a, b) => a.charOffset - b.charOffset)

  const counts: Record<string, number> = {}
  for (const issue of allIssues) {
    counts[issue.category] = (counts[issue.category] || 0) + 1
  }

  return { issues: allIssues, counts, totalIssues: allIssues.length }
}
```

### Integration into `lintRun()`

In `src/lint/index.ts`, modify `lintRun()` to call both engines:

```typescript
import { lintRhythm } from "./rhythm"

export async function lintRun(runId: number) {
  // ... existing code ...
  for (const gen of gens) {
    const regexResult = await lintProse(gen.prose)
    const rhythmResult = await lintRhythm(gen.prose)

    // Merge results
    const allIssues = [...regexResult.issues, ...rhythmResult.issues]
    const allCounts: Record<string, number> = { ...regexResult.counts }
    for (const [cat, count] of Object.entries(rhythmResult.counts)) {
      allCounts[cat] = (allCounts[cat] || 0) + count
    }

    const result = {
      issues: allIssues,
      counts: allCounts,
      totalIssues: allIssues.length
    }

    await saveLintIssues(gen.id, result.issues)
    results.push({ generationId: gen.id, seed: gen.seed, result })
  }
  return results
}
```

### Schema considerations

Heuristic patterns fit in the existing `lint_patterns` table:

| Column | Regex pattern | Heuristic pattern |
|--------|---------------|-------------------|
| `pattern` | Regex string: `\b(perhaps\|maybe)\b` | JSON config: `{"metric": "sentence_length_cv", "window": 8, ...}` |
| `flags` | Regex flags: `gi` | Sentinel value: `heuristic` |
| `dialogue_ok` | Per-match dialogue check | Handled by pre-filtering in `lintRhythm()` |
| `enabled` | `true`/`false` | `false` (default, until calibrated) |
| Other fields | Normal | Normal |

The `flags = 'heuristic'` sentinel tells the system which engine handles the pattern. `lintProse()` already filters to non-heuristic patterns (it compiles `flags` as regex flags, so `'heuristic'` would fail regex compilation -- an implicit filter). `lintRhythm()` explicitly filters to `flags = 'heuristic'`.

No schema migration is needed -- the existing `lint_patterns` table accommodates heuristic patterns via the existing TEXT columns.

---

## Pattern Summary Table

| ID | Category | Pattern | Metric | Threshold | Effort | FP Risk | Default |
|----|----------|---------|--------|-----------|--------|---------|---------|
| RM-1 | RHYTHM_MONOTONY | Sentence Length Uniformity | CV over 8-sentence windows | CV < 0.30 | Medium | High pre-cal | Disabled |
| RM-2 | RHYTHM_MONOTONY | Sentence Opening Repetition | Consecutive same-opening runs | 3+ same word | Low-Med | Medium | Disabled |
| RM-3 | RHYTHM_MONOTONY | Compound Sentence Dominance | Compound ratio over 10-sent windows | >60% compound | Low | Medium | Disabled |
| PH-1 | PARAGRAPH_HOMOGENEITY | Paragraph Length Uniformity | Word count tolerance band | 4+ within 20% | Low | Med-High | Disabled |
| PH-2 | PARAGRAPH_HOMOGENEITY | Paragraph Opening Repetition | Consecutive same-opening para runs | 3+ same word | Medium | Medium | Disabled |

---

## Measurement Strategy

### Metrics to track after enabling

1. **Hit rate per pattern per seed:** How many issues does each pattern flag per 1,000 words of generated prose? Track this over time to measure whether prompt rules reduce the flagging rate.

2. **False positive rate:** Manual review of a sample of flagged issues (at least 20 per pattern) to estimate FP rate. Target: <10% FP after calibration.

3. **Correlation with prose quality scores:** Do generations with more rhythm issues score lower on the prose benchmark's overall dimension? If not, the pattern may not be measuring something meaningful.

4. **Pre/post comparison:** After adding writer prompt rules, compare rhythm metrics on generations before vs. after the prompt change. The metrics should improve (higher CV, fewer opening repetitions) if the prompt rules are effective.

5. **Rewriter effectiveness:** When the rewriter receives rhythm fix_templates, does it successfully vary the rhythm? Measure the same metrics before and after rewriting.

### Experiment design

Each calibration round and pattern enablement should follow the standard experiment protocol:

```bash
# Create experiment
bun scripts/create-experiment.ts --name "rhythm-lint-calibration-rm1" \
  --description "Calibrate RM-1 sentence length CV threshold"

# Run metrics on published fiction corpus
EXPERIMENT_ID=N bun scripts/rhythm-calibrate.ts --corpus published/

# Run metrics on AI generations
EXPERIMENT_ID=N bun scripts/rhythm-calibrate.ts --from-db --recent 10

# Compare and record conclusion
bun scripts/conclude-experiment.ts --id N --conclusion "threshold-set" \
  --notes "CV < 0.30 flags 2% published, 75% AI. Enabling for trial."
```

---

## Appendix A -- Source Citations

### Craft references

1. **Provost, Gary.** *100 Ways to Improve Your Writing.* Mentor/Penguin, 1985. The "this sentence has five words" passage demonstrating the effect of sentence length variation on prose rhythm.

2. **Klinkenborg, Verlyn.** *Several Short Sentences About Writing.* Vintage, 2012. Argues that the sentence is the fundamental unit of prose craft, with rhythm emerging from the relationship between consecutive sentences.

3. **Clark, Roy Peter.** *Writing Tools: 55 Essential Strategies for Every Writer.* Little, Brown, 2006 (10th Anniversary Edition, 2016). Tool #18: "Set the pace with sentence length. Vary sentences to influence the reader's speed."

4. **Waddell, Marie L., Robert M. Esch, and Roberta R. Walker.** *The Art of Styling Sentences.* Barron's, 5th ed., 2012. Catalogs 20 sentence patterns, emphasizing that skilled writers draw from the full range of syntactic structures.

5. **Browne, Renni, and Dave King.** *Self-Editing for Fiction Writers.* William Morrow, 1993/2004. Chapter 3 (Point of View) identifies pronoun-heavy openings as weak POV management; Chapter 1 (Show and Tell) addresses the craft problems that produce monotonous paragraph structures.

6. **Zinsser, William.** *On Writing Well.* Harper Perennial, 1976/2006. Chapter 3 ("Clutter") on pruning qualifiers and varying sentence construction.

7. **KillZone Blog.** "Pacing and Spacing: The Power of Artful Paragraphing." February 2019. On paragraph length variation as a pacing tool, contrasting "turgid" uniform paragraphs with varied ones.

8. **Hardy, Janice.** "Pacing, Line by Line." *Fiction University*, May 2019. Connecting sentence and paragraph length to line-level pacing control.

### AI detection and stylometry references

9. **Tian, Edward.** GPTZero. Princeton University, launched January 2023. Uses perplexity and burstiness as core AI text detection metrics. "Burstiness measures how much writing patterns and text perplexities vary throughout an entire document." https://gptzero.me/news/perplexity-and-burstiness-what-is-it/

10. **GPTZero.** "How Do AI Detectors Work? Techniques, Limitations & More." 2024. Overview of detection methodology including burstiness, perplexity, and deep learning components.

11. **ResearchGate.** "Feature-Based Detection of AI-Generated Text: An Analysis of Stylometric and Perplexity Markers in Contemporary Large Language Models." 2024. Identifies average sentence length and its variance as important discriminators for LLM-generated text.

12. **ResearchGate.** "Stylometric Approaches for AI-Text Identification." 2024. Stylometric methods detect GPT-4 level generations with 70-80% precision, improving to 90% when fused with machine learning.

13. **Tercone, Luka.** "Linguistic Characteristics of AI-Generated Text: A Survey." arXiv:2510.05136, 2025. AI-generated text exhibits more phrasal coordination, lower lexical diversity, and heavier reliance on cohesive devices and formulaic syntactic constructions.

14. **MIT Press.** "A Survey on LLM-Generated Text Detection: Necessity, Methods, and Future Directions." *Computational Linguistics* 51, no. 1 (2025): 275. Comprehensive survey of detection approaches including watermarking, statistics-based, and neural-based detectors.

15. **NetusAI.** "Stylometry: How AI Detectors Identify Your Writing Style." 2025. Identifies "uniform 12-18 word sentences" as an AI red flag and notes that stylometric accuracy drops by over 40% for texts shorter than 1,000 words.

16. **Wikipedia.** "Signs of AI writing." Identifies heavy reliance on correlative conjunctions and formulaic syntactic constructions as AI markers.

### Historical stylometry

17. **Mendenhall, Thomas C.** "The Characteristic Curves of Composition." *Science* 9 (1887): 237-249. First manual quantitative authorship analysis using word length distributions.

18. **Mosteller, Frederick, and David L. Wallace.** *Inference and Disputed Authorship: The Federalist.* Addison-Wesley, 1964. Landmark Bayesian authorship attribution study resolving the disputed Federalist Papers.

19. **Williams, C.B.** "A Note on the Statistical Analysis of Sentence-Length as a Criterion of Literary Style." *Biometrika* 31 (1940): 356-361. Early study of sentence length as an authorship attribute.

20. **Yule, G. Udny.** "On Sentence Length as a Statistical Characteristic of Style in Prose." *Biometrika* 30 (1939): 363-390. Statistical treatment of sentence length distributions across authors.

21. **Mikros, George K., and Kostas Argiri.** "On sentence length distribution as an authorship attribute." In *Proceedings of the International Conference on Textual Data Statistical Analysis*, 2015. Confirms sentence length distribution carries significant authorial information beyond simple averages.

---

## Appendix B -- Rhythm Metrics Reference

### Coefficient of Variation (CV) reference values

The coefficient of variation (CV = standard deviation / mean) measures the relative variability of a dataset. For sentence lengths:

| CV Range | Interpretation | Typical source |
|----------|---------------|----------------|
| 0.00-0.15 | Extremely uniform | Deliberately monotonous passages, some AI output |
| 0.15-0.30 | Low variation | AI-generated prose (typical range) |
| 0.30-0.45 | Moderate variation | Mixed -- some AI, some published |
| 0.45-0.70 | Good variation | Published literary fiction (typical range) |
| 0.70-1.00 | High variation | Published fiction with dramatic rhythm |
| 1.00+ | Extreme variation | Passages mixing very short and very long sentences |

**Note:** These ranges are estimates based on the Provost example (monotonous CV=0.11, varied CV=1.38) and the GPTZero research indicating AI text tends toward uniform 12-18 word sentences. They must be validated against the calibration corpus before use as operational thresholds.

### Provost passage word counts (detailed)

**Monotonous section (9 sentences):**

| # | Sentence | Words |
|---|----------|-------|
| 1 | "This sentence has five words." | 5 |
| 2 | "Here are five more words." | 5 |
| 3 | "Five-word sentences are fine." | 4 |
| 4 | "But several together become monotonous." | 5 |
| 5 | "Listen to what is happening." | 5 |
| 6 | "The writing is getting boring." | 5 |
| 7 | "The sound of it drones." | 5 |
| 8 | "It's like a stuck record." | 6 |
| 9 | "The ear demands some variety." | 5 |

Mean: 5.0 words, StdDev: 0.50, **CV: 0.10**

**Varied section (8 sentences):**

| # | Sentence | Words |
|---|----------|-------|
| 1 | "Now listen." | 2 |
| 2 | "I vary the sentence length, and I create music." | 10 |
| 3 | "Music." | 1 |
| 4 | "The writing sings." | 3 |
| 5 | "It has a pleasant rhythm, a lilt, a harmony." | 9 |
| 6 | "I use short sentences." | 4 |
| 7 | "And I use sentences of medium length." | 7 |
| 8 | "And sometimes, when I am certain the reader is rested, I will engage him with a sentence of considerable length, a sentence that burns with energy and builds with all the impetus of a crescendo, the roll of the drums, the crash of the cymbals -- sounds that say listen to this, it is important." | 49 |

Mean: 10.6 words, StdDev: 15.4, **CV: 1.45**

### Sentence type distribution reference

| Sentence type | Definition | Published fiction (est.) | AI prose (est.) |
|---------------|-----------|--------------------------|-----------------|
| Simple | One independent clause | 25-40% | 15-25% |
| Compound | Two+ independent clauses joined by conjunction | 20-35% | 40-60% |
| Complex | Independent + dependent clause | 20-30% | 15-25% |
| Compound-complex | Multiple independent + dependent clauses | 5-15% | 5-10% |
| Fragment | Incomplete sentence for effect | 5-15% | 0-5% |

**Note:** These estimates are derived from craft literature descriptions of varied prose and from AI detection research identifying compound sentence dominance. They require empirical validation.

---

## Appendix C -- Example Corpus

### Example 1: AI-generated monotonous rhythm

The following is a representative AI-generated passage exhibiting sentence length uniformity (fabricated to illustrate the pattern):

> Elena crossed the room and placed her hand on the window. The glass was cold beneath her fingers and she shivered slightly. She could see the garden stretching out before her in the moonlight. The roses had bloomed earlier that week and their petals were scattered. Marcus had told her about the plans and she had listened carefully. She turned away from the window and walked toward the hallway. The floorboards creaked beneath her feet as she moved through the darkness. She paused at the doorway and considered what she had seen outside.

**Word counts:** 12, 11, 13, 11, 12, 12, 13, 13
**Mean:** 12.1, **StdDev:** 0.78, **CV:** 0.06

**Analysis:** Eight consecutive sentences, all between 11 and 13 words. CV of 0.06 is extremely low. Every sentence is compound (containing ", and" or equivalent connective). Six of eight sentences start with "She" or "The." This is textbook AI monotony -- individually unobjectionable sentences that collectively create a drone.

**Patterns triggered:**
- RM-1 (CV=0.06, far below 0.30 threshold)
- RM-2 (multiple "She" openings in sequence)
- RM-3 (high compound ratio -- 5/8 = 63% have ", and")

### Example 2: Published fiction with varied rhythm

From the style of varied literary prose (fabricated to illustrate the pattern, inspired by published fiction techniques):

> Elena crossed the room.
>
> The window drew her -- its black glass a mirror at this hour, reflecting back the hallway light in a smear of amber that made her own face ghostly, older, someone she barely recognized from the photographs her mother kept on the piano. She pressed her fingertips to the pane. Cold. The garden beyond was silver and shadow, rose petals scattered like confetti after a wedding no one had wanted.
>
> Marcus knew. He had known for weeks, probably, watching her with those careful eyes that cataloged everything and forgave nothing.
>
> She turned from the window.

**Word counts:** 4, 48, 8, 1, 17, 2, 18, 5
**Mean:** 12.9, **StdDev:** 15.2, **CV:** 1.18

**Analysis:** Eight sentences ranging from 1 word ("Cold.") to 48 words (the window reflection sentence). CV of 1.18 reflects dramatic variation. Sentence types: simple (4 words), complex (48 words), simple (8 words), fragment (1 word), complex (17 words), simple (2 words), complex (18 words), simple (5 words). Openings vary: "Elena," "The window," "She," "Cold," "The garden," "Marcus," "He," "She." The rhythm creates pacing -- the long window sentence forces the reader to slow down and see; the one-word fragment snaps attention.

**Patterns triggered:** None. CV well above threshold, no opening repetitions, mixed sentence types.

### Example 3: Legitimate uniform rhythm (false positive case)

An action sequence where uniform short sentences are a deliberate pacing choice (fabricated):

> He ran. The door was close. Three steps. Two. He reached for the handle. The alarm screamed. He pulled. The door held. He pulled again. Metal groaned. The hinges gave. He was through.

**Word counts:** 2, 5, 2, 1, 6, 3, 2, 3, 3, 2, 3, 3
**Mean:** 2.9, **StdDev:** 1.3, **CV:** 0.45

**Analysis:** Despite being uniformly short, the CV is 0.45 because the variation between 1-word and 6-word sentences is proportionally large relative to the tiny mean. This is above the proposed 0.30 threshold, so RM-1 would correctly NOT flag it. However, if the passage used slightly more uniform 4-5 word sentences, the CV would drop. This illustrates why the threshold must be set carefully -- staccato action sequences should not be flagged.

This is also why the CV metric is well-suited: it measures relative variation. A passage with all 4-5 word sentences (action) and a passage with all 14-15 word sentences (AI monotony) both have low absolute stddev, but the action passage has higher CV because its mean is lower. The metric naturally accommodates intentional short-sentence style better than absolute variance would.
