# Writing Methodology Integration Report

> **Date:** 2026-04-01
> **Status:** Reference document — testable items for augmenting the novel harness with published author methodologies
> **Scope:** Story Grid (Shawn Coyne), Save the Cat! (Jessica Brody), K.M. Weiland Scene/Sequel + Character Arcs, MICE Quotient (Mary Robinette Kowal / Orson Scott Card)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Methodology Overviews](#methodology-overviews)
3. [Testable Items — Story Grid](#i-story-grid-shawn-coyne)
4. [Testable Items — Save the Cat!](#ii-save-the-cat-jessica-brody)
5. [Testable Items — K.M. Weiland](#iii-km-weiland)
6. [Testable Items — MICE Quotient](#iv-mice-quotient-kowal--card)
7. [Cross-Cutting Concerns](#v-cross-cutting-concerns)
8. [Implementation Priority Tiers](#tier-summary)
9. [Measurement Strategy](#measurement-strategy)
10. [Appendix A — Story Grid Genre Conventions](#appendix-a--story-grid-genre-conventions-short-fiction-subsets)
11. [Appendix B — Save the Cat Beat Sheet (3-Chapter Compression)](#appendix-b--save-the-cat-beat-sheet-3-chapter-compression)
12. [Appendix C — Value Spectrum Reference](#appendix-c--value-spectrum-reference)
13. [Appendix D — Character Arc Beat Mapping](#appendix-d--character-arc-beat-mapping)

---

## Executive Summary

Four published author methodologies were evaluated for encoding into the novel harness as generation guidance, structural validation, and benchmark evaluation. Each was assessed against the harness's 3-chapter short story format (~3,000 words, 6-12 scenes).

**20 testable items** were identified, ranked by effort, impact, and risk:

| Tier | Count | Description | Effort |
|------|-------|-------------|--------|
| Tier 1 | 6 | Prompt-only changes, immediate impact | Low |
| Tier 2 | 6 | Schema/config changes, structural improvements | Medium |
| Tier 3 | 5 | New validation agents/judges | Medium-High |
| Tier 4 | 3 | Benchmark prototypes, uncertain reliability | Medium |
| Skip | 5 | Redundant, over-engineered, or premature | — |

**Key architectural gaps filled:**
- No scene-level structural validation (filled by SG-1 Five Commandments + W-1 Scene/Sequel)
- No character arc tracking (filled by W-2 Lie/Truth + STC-2 Want/Need)
- No midpoint/pacing structure (filled by STC-4 False Victory/Defeat + W-3 Pinch Points)
- No thread closure validation (filled by MICE-1 FILO nesting)
- No genre-specific structural requirements (filled by SG-4/SG-5 conventions + obligatory scenes)

**Recommended framework allocation (one per concern, no overlap):**

| Concern | Framework | Rationale |
|---------|-----------|-----------|
| Scene structure | Weiland Scene/Sequel + Story Grid Five Commandments | Complementary: Scene/Sequel for generation, Five Commandments for validation |
| Story beats | Save the Cat (compressed 7-8 beats) | Best fit for 3-chapter format with percentage targets |
| Genre requirements | Story Grid conventions + obligatory scenes | Most detailed, best documented |
| Character arc | Weiland Lie/Truth/Ghost + STC Want/Need | Complementary: Lie/Truth is internal, Want/Need is external |
| Thread closure | MICE FILO nesting | Unique check not covered by other methodologies |
| Midpoint structure | STC False Victory/Defeat | Most prescriptive definition |

---

## Methodology Overviews

### Story Grid (Shawn Coyne)

An analytical framework treating story editing as engineering. Every scene is analyzed through Five Commandments (Inciting Incident, Progressive Complication, Crisis, Climax, Resolution) and value shifts. Twelve content genres each have specific conventions (elements that must exist) and obligatory scenes (events that must occur). Originally published in *The Story Grid* (2015), extensively documented at storygrid.com.

**Strengths for the harness:** Extremely rule-based. Everything is checkable. Genre conventions are checklists. The spreadsheet format is essentially a database schema.

**Weaknesses for the harness:** Designed for novel-length works (60-80 scenes). Some conventions require space to plant and pay off. The full spreadsheet is over-engineered for 6-12 scenes.

### Save the Cat! Writes a Novel (Jessica Brody / Blake Snyder)

A 15-beat story structure with exact percentage-of-book placement targets. Ten story genres each have exactly three required ingredients. The framework treats the story as a "transformation machine" that forces character change. Originally a screenwriting framework (*Save the Cat!*, 2005), adapted for novels by Jessica Brody (2018).

**Strengths for the harness:** Precise percentage targets are quantitatively checkable. The transformation machine maps Want/Need/Wound to specific beats. The 10 genres have exactly 3 ingredients each — minimal but enforced.

**Weaknesses for the harness:** 15 beats in 3,000 words is too many — requires compression to 7-8 essential beats. Genre classification overlaps with Story Grid.

### K.M. Weiland — Scene/Sequel + Character Arcs

Scene-level writing structure (from Dwight Swain) systematized into Goal→Conflict→Disaster / Reaction→Dilemma→Decision alternation. Character arcs defined through Lie/Truth/Ghost framework with five arc types (Positive, Flat, Disillusionment, Fall, Corruption). Published across blog series at helpingwritersbecomeauthors.com and multiple books.

**Strengths for the harness:** Scene/Sequel is the most practical scene-level writing rule. Lie/Truth/Ghost is the most structured character arc framework. Both are directly encodable as prompt guidance.

**Weaknesses for the harness:** Scene/Sequel at short word counts requires compression. Negative arc types are harder for LLMs to write well.

### MICE Quotient (Mary Robinette Kowal / Orson Scott Card)

Four narrative thread types (Milieu, Inquiry, Character, Event) with a FILO nesting rule (threads must close in reverse order of opening). Thread count determines story length. Originally from Orson Scott Card (*How to Write Science Fiction and Fantasy*, 1990), systematized by Mary Robinette Kowal through Writing Excuses podcast and workshops.

**Strengths for the harness:** FILO nesting is a bracket-matching algorithm — purely deterministic validation. Thread count check prevents overambitious outlines. Try/fail cycles provide escalation structure.

**Weaknesses for the harness:** Thread identification from finished prose is subjective. At 3-chapter scale, 1-2 threads make FILO trivially satisfied. Best applied at planning level where threads can be explicitly tagged.

---

## I. Story Grid (Shawn Coyne)

### SG-1: Five Commandments Per Scene

**ID:** SG-1
**What it tests:** Every scene in the output has all five structural elements — Inciting Incident, Progressive Complication (with Turning Point), Crisis, Climax, Resolution.

**Where it applies:** Two places:
1. **Planning-plotter prompt + schema** (generation) — require the outline to specify each commandment per scene beat
2. **New benchmark judge** (validation) — evaluate finished prose for whether each scene contains all five

**Implementation approach:**

*Planning side:* Extend the `planning-plotter/schema.ts` `SceneBeat` type to include fields:
```typescript
{
  incitingIncident: string,
  turningPoint: { description: string, type: "action" | "revelation" },
  crisis: { description: string, type: "bestBadChoice" | "irreconcilableGoods" },
  climax: string,
  resolution: string
}
```
The planning-plotter prompt already requires "specific dramatic beats" — this makes the requirement structural.

*Validation side:* A benchmark judge rubric that reads finished prose and checks: can each scene's five commandments be identified? Are any missing or implicit when they should be explicit?

**Effort:** Medium

**Why do it:** This is the single highest-value structural check available. The current system has no scene-level structural validation at all. Every competent editor checks for this. It catches:
- Scenes that are pure exposition (no turning point)
- Scenes that are all action with no consequence (no resolution)
- Scenes where nothing changes (no crisis/climax)

These are the most common structural failures in AI-generated prose.

**Why you might not:** The Five Commandments are designed for human-length novels where scenes run 2,000-5,000 words. Harness chapters are 800-1,200 words with 2-4 scenes each, meaning scenes are 200-600 words. At that density, some commandments will necessarily be compressed or implied. A judge that demands all five be explicit will penalize lean prose.

**Mitigation:** Calibrate the judge to accept implicit commandments in scenes under 400 words, and require all five to be identifiable (not necessarily elaborated) in scenes over 400 words.

**Verdict: DO IT.** Fills the biggest structural gap. Implement in planning schema first (cheap, immediate), then add a benchmark judge once baseline quality is established at these word counts.

**Priority: Tier 2**

---

### SG-2: Value Shift Per Scene

**ID:** SG-2
**What it tests:** Every scene shifts a value on a spectrum (e.g., safety to danger, trust to betrayal). No scene leaves the value unchanged.

**Where it applies:**
1. **Planning-plotter schema** (generation) — add `valueShift: { from: string, to: string, polarity: string }` per scene
2. **Benchmark judge** (validation) — does each scene in the finished prose demonstrably shift a value?

**Implementation approach:**

The planning-plotter already tracks `emotionalShift` at the chapter level. Value shift is more precise: it names a specific human value (not just an emotion) and tracks its movement on a four-point spectrum (+, +/-, -, --).

Define a set of value spectrums per genre (see Appendix C). Seeds already specify genre — this connects directly.

Judge rubric: "For each scene, identify the value at the start and end. Did it change? If not, the scene is structural dead weight."

**Effort:** Medium

**Why do it:** Value shifts are the most precise way to detect "nothing happens" scenes. The current dead-weight benchmark dimension catches filler *phrases* but not filler *scenes*. A scene can have zero dead-weight phrases and still be structurally dead if no value changes. This catches that.

**Why you might not:** Value tracking requires genre-aware configuration. Seeds span genres (dark fantasy, sci-fi, romance, YA), requiring a genre-to-value mapping table. Value shifts are also subjective — two judges might disagree on whether "cautious to wary" is a real shift or not.

**Mitigation:** Start with the external genre value only (ignore internal genre), and use coarse polarity (+ or -) rather than the full four-point spectrum.

**Verdict: DO IT**, but in simplified form. Add `valueShift` to the planning schema. Don't build a benchmark judge yet — the planning-level enforcement alone will improve structural quality, and it's measurable through existing prose benchmarks (fewer dead-weight scenes lead to lower dead-weight counts).

**Priority: Tier 2**

---

### SG-3: Turning Point Type Variety

**ID:** SG-3
**What it tests:** Scenes don't all turn the same way. Story Grid requires a mix of Action turning points (something happens) and Revelation turning points (information is revealed).

**Where it applies:** Planning-plotter schema + deterministic validation check.

**Implementation approach:**

If SG-1 is implemented, `turningPoint.type` already exists per scene. A deterministic check in the validation pipeline verifies: across all scenes in the outline, are both "action" and "revelation" types represented? Flag if all scenes use the same type.

This is a *deterministic* check, not an LLM judge — it's counting enum values in the schema output.

**Effort:** Low (trivial if SG-1 is done). Depends on SG-1.

**Why do it:** Monotonous turning points create predictable prose. If every scene turns on a fight (action, action, action), readers disengage. If every scene turns on a discovery (revelation, revelation, revelation), the story feels like an info dump. This is a free check once SG-1 exists.

**Why you might not:** With only 6-12 scenes in a 3-chapter story, statistical power is limited. Two revelation scenes in a row might be fine at this scale.

**Mitigation:** Flag only if ALL scenes are the same type, not if there's a local cluster.

**Verdict: DO IT** — nearly free if SG-1 exists. Skip if SG-1 is skipped.

**Priority: Tier 3 (depends on SG-1)**

---

### SG-4: Genre Conventions Checklist

**ID:** SG-4
**What it tests:** The story includes all required conventions for its genre. E.g., a Thriller must have a MacGuffin, a Clock, Red Herrings, and Making It Personal.

**Where it applies:** Planning validation — check the completed outline against a genre-specific checklist.

**Implementation approach:**

Create a `genre-conventions.ts` file mapping each genre to its required conventions and obligatory scenes (see Appendix A for short-fiction subsets).

After the planning-plotter produces the outline, run a judge that cross-references the outline against the genre's checklist. "Does this thriller outline include a MacGuffin? A clock/deadline? A scene where the villain makes it personal?"

Seeds already specify genre. Map seed genres to Story Grid genres to convention checklist.

**Effort:** Medium-High

**Why do it:** Genre conventions are what readers expect even if they can't name them. Without this check, the plotter might produce a "thriller" that has no deadline, no personal stakes, and no scene where the hero is at the villain's mercy — which would read as a bland action story, not a thriller.

**Why you might not:** The 3-chapter format is very short. Some conventions (e.g., Red Herrings in thrillers) need space to plant and pay off. A story with 6-12 scenes can't hit 8+ conventions without feeling like a checklist. Short fiction typically satisfies 3-5 conventions from a genre, not all of them.

**Mitigation:** Define a "short fiction subset" of conventions per genre — the 3-4 most essential ones (see Appendix A).

**Verdict: DO IT**, but with a curated short-fiction subset per genre. Don't try to enforce all conventions.

**Priority: Tier 3**

---

### SG-5: Obligatory Scenes Checklist

**ID:** SG-5
**What it tests:** The story includes specific scenes that the genre demands. E.g., a Love story must have: Lovers Meet, First Kiss, Confession of Love, Breakup, Proof of Love, Reunion.

**Where it applies:** Planning validation — similar to SG-4 but checking for specific *events*, not just *elements*.

**Implementation approach:**

Same infrastructure as SG-4. The judge checks: "Does this Love story outline include a scene where the lovers break up? A scene where one lover proves their love through sacrifice?"

Can be combined with the SG-4 judge into a single "genre compliance" check.

**Effort:** Low (if SG-4 infrastructure exists)

**Why do it:** Obligatory scenes are the genre's emotional payoffs. A Love story without a breakup scene feels incomplete. A Thriller without a "hero at mercy of villain" scene has no climax. These are non-negotiable for genre satisfaction.

**Why you might not:** Same short-fiction concern as SG-4 — some obligatory scenes need setup time. The "Speech in Praise of the Villain" works in novels where the villain has screentime but may feel forced in a 3-chapter story.

**Mitigation:** Curate a short-fiction subset. For 3-chapter stories, require the *core event* (the single most important obligatory scene per genre) and 2-3 others. See Appendix A.

**Verdict: DO IT**, combined with SG-4 as a single genre compliance check.

**Priority: Tier 3 (combined with SG-4)**

---

### SG-6: Global Story Structure (Beginning Hook / Middle Build / Ending Payoff)

**ID:** SG-6
**What it tests:** Each of the three acts has its own complete Five Commandments, and they escalate properly (Hook introduces, Build complicates, Payoff resolves).

**Where it applies:** Planning validation at the act level.

**Implementation approach:**

The plotter already produces 3 acts with `summary` and `emotionalArc`. Extend to require Five Commandments at the act level: each act must have an identifiable inciting incident, turning point, crisis, climax, and resolution.

Deterministic check: Act 3's climax should be the genre's Core Event. Act 2's crisis should be the "All Is Lost" moment.

**Effort:** Low-Medium

**Why do it:** The 3-chapter structure maps perfectly to Hook/Build/Payoff — 1:1 correspondence. Chapter 1 = Beginning Hook, Chapter 2 = Middle Build, Chapter 3 = Ending Payoff. This is the most natural structural framework for the format.

**Why you might not:** May be redundant with SG-1 at the scene level. If every scene has its Five Commandments, the acts will likely have them too.

**Counter:** Not necessarily — well-structured scenes can fail to escalate across acts. The act-level check catches stories that plateau.

**Verdict: DO IT.**

**Priority: Tier 3**

---

### SG-7: Story Grid Spreadsheet Schema

**ID:** SG-7
**What it tests:** Every scene tracked with: scene number, word count, story event synthesis, value shift, polarity, turning point type, POV, time, duration, location, on-stage characters.

**Where it applies:** Planning-plotter output schema + post-draft extraction.

**Effort:** High

**Why do it:** The most complete analytical view of a story. Enables programmatic cross-run analysis.

**Why you might not:** Over-engineering for 6-12 scenes. Manual inspection is faster. Extracting all fields accurately from LLM output is noisy. The individual components (SG-1 value shifts, SG-3 turning point types) give 80% of the value. ROI only justifies itself at novel length.

**Verdict: SKIP for now.** Build only if scaling to longer works.

**Priority: Skip**

---

### SG-8: Controlling Idea Validation

**ID:** SG-8
**What it tests:** The story's ending emerges from its climax in a way that communicates a clear thematic takeaway. Format: "[Value] [prevails/fails] when [cause]."

**Where it applies:** Post-completion validation.

**Effort:** Medium

**Why do it:** Catches stories that set up a theme but don't pay it off — the plotter says the theme is "redemption through sacrifice" but the ending is a lucky escape with no sacrifice. Thematic incoherence is a common AI writing failure.

**Why you might not:** Themes are inherently subjective. A judge might extract a different controlling idea than intended, and both could be valid. Creates noisy benchmark results.

**Mitigation:** Frame the judge as a consistency check ("does the climax match the stated theme?") rather than a quality assessment.

**Verdict: MAYBE.** Worth prototyping as a benchmark judge. Don't add to the validation pipeline until reliability is confirmed.

**Priority: Tier 4**

---

## II. Save the Cat! (Jessica Brody)

### STC-1: Beat Compliance (Compressed for 3 Chapters)

**ID:** STC-1
**What it tests:** The story hits essential Save the Cat beats at approximately the right proportional positions, compressed from 15 beats to 7-8 for the 3-chapter format.

**Where it applies:** Planning validation — check the outline against beat placement percentages.

**Implementation approach:**

The full 15-beat sheet compressed to 7-8 beats (see Appendix B):

| # | Beat | Placement | Chapter | What Must Happen |
|---|------|-----------|---------|------------------|
| 1 | Opening Image / Setup | 0-10% | Ch1 opening | Flawed status quo. Stasis = Death. |
| 2 | Catalyst | ~10-15% | Ch1 mid | Life-changing disruption. Cannot return to normal. |
| 3 | Break Into 2 | ~20-25% | Ch1 ending | Protagonist enters "upside-down world." Active choice. |
| 4 | Midpoint | ~50% | Ch2 mid | False Victory or False Defeat. Stakes raised. |
| 5 | All Is Lost | ~75% | Ch2 ending | Lowest point. Whiff of death. Old self dies. |
| 6 | Break Into 3 | ~80% | Ch3 opening | "Aha" moment. Protagonist understands what they must do. |
| 7 | Finale (Dig Deep Down) | ~85-95% | Ch3 mid | Transformation completes. Acts on Need, not Want. |
| 8 | Final Image | ~99% | Ch3 closing | Mirror of Opening Image showing transformation. |

For a ~3,000-word story: Catalyst = ~300-450 words, Midpoint = ~1,500 words, All Is Lost = ~2,250 words.

**Effort:** Medium

**Why do it:** Beat sheets are the most popular structural framework in commercial fiction. They produce stories that feel "right" to readers even if readers can't articulate why. The percentage targets give quantitative metrics: "Is the Catalyst too late? Is the Midpoint off-center?"

**Why you might not:** Even 7-8 beats in 3,000 words is one beat every 375-430 words. Some beats may feel rushed.

**Mitigation:** Treat percentage targets as guidelines (within 5% tolerance), not exact requirements.

**Verdict: DO IT** with the compressed 7-8 beat version.

**Priority: Tier 2**

---

### STC-2: Want vs. Need Tracking

**ID:** STC-2
**What it tests:** The protagonist has a clearly defined Want (external goal, driven by flaw) and Need (internal lesson, thematic truth), and the story resolves by the hero choosing Need over Want.

**Where it applies:**
1. **Character-agent schema** — add `want` and `need` fields
2. **Plotter** — story spine specifies where Want and Need diverge
3. **Validation** — climax demonstrates Need chosen over Want

**Implementation approach:**

Extend `CharacterProfile` in `character-agent/schema.ts`:
```typescript
{
  // existing fields...
  want: string,   // External goal the character pursues (driven by Lie)
  need: string,   // Internal lesson they must learn (the Truth)
}
```

The plotter's `endingDirection` should specify whether the hero achieves Want, Need, both, or neither.

A validation judge checks: "Does the climax show the protagonist acting on their Need rather than their Want?"

**Effort:** Low-Medium

**Why do it:** Want/Need divergence is the engine of character transformation. Without it, characters are flat — they want something, they get it (or don't), end of story. When Want and Need conflict, the character must choose, and that choice IS the story. The current character-agent has `goals` but no concept of internal Need. This is the biggest character-arc gap.

**Why you might not:** Some stories don't have a Want/Need split — flat arc stories have a protagonist who already knows the truth and changes the world instead. LLMs tend to make Want and Need synonymous.

**Mitigation:** Make Need optional in the schema. Flag if missing so the decision can be made per-seed.

**Verdict: DO IT.** Foundational character improvement with low implementation cost. Combine with W-2 (Lie/Truth/Ghost).

**Priority: Tier 2**

---

### STC-3: "Stasis = Death" in Opening

**ID:** STC-3
**What it tests:** The opening establishes that the hero's current life is unsustainable — staying the same leads to spiritual or literal death.

**Where it applies:** Planning-plotter prompt guidance for Chapter 1, Scene 1.

**Implementation approach:**

Add to the planning-plotter prompt: "Chapter 1's opening scene must establish why the protagonist's current situation cannot continue. What is unsustainable about their life? What will happen if nothing changes?"

Benchmark judge can check: "Does the opening scene create urgency for change, or does the protagonist seem comfortable?"

**Effort:** Low (prompt change only)

**Why do it:** Openings without urgency are boring. If the protagonist's life is fine and something disrupts it, we have sympathy but no stakes. If their life was already unsustainable and the disruption is the catalyst for change they needed, we have investment. This is the difference between "things happen to a person" and "a person's world cracks open."

**Why you might not:** Some genres (cozy mystery, slice-of-life) don't start with unsustainable situations.

**Mitigation:** Frame as "establish what the protagonist is missing or avoiding" rather than "establish doom."

**Verdict: DO IT.**

**Priority: Tier 1**

---

### STC-4: Midpoint False Victory / False Defeat

**ID:** STC-4
**What it tests:** The midpoint of the story is either a false victory (things seem great but collapse) or a false defeat (things seem terrible but improve). Not a gradual transition.

**Where it applies:** Planning validation — Chapter 2's midpoint has a clear polarity shift.

**Implementation approach:**

Require the planning-plotter to specify `midpointType: "falseVictory" | "falseDefeat"` in the Chapter 2 outline.

Deterministic check: if midpointType is "falseVictory," the second half of Chapter 2 must trend negative (toward All Is Lost). If "falseDefeat," the second half must trend positive before the final collapse.

**Effort:** Low (schema addition + prompt guidance)

**Why do it:** The midpoint is where most AI-generated stories go flat. Without a deliberate false victory or false defeat, Chapter 2 tends to be a straight line of "things get progressively worse" or "things sort of happen." The false victory/defeat creates a reversal that re-engages the reader at exactly the point where attention wanes.

**Why you might not:** No real downside at this cost level.

**Verdict: DO IT.**

**Priority: Tier 1**

---

### STC-5: Three-Point Finale

**ID:** STC-5
**What it tests:** Chapter 3 follows three movements: Setup/Execution, Surprise/Setback, Transformation + Resolution. (Simplified from the full five-point finale.)

**Where it applies:** Planning-plotter prompt guidance for Chapter 3.

**Implementation approach:**

Add to the planning-plotter prompt for Chapter 3: "Structure the finale in three movements: (1) The protagonist assembles resources and executes their plan, (2) An unexpected obstacle stops the plan cold — forces fundamental reassessment, (3) The protagonist turns inward, completes their transformation, and resolves the conflict through internal change rather than external force."

The most critical element is the "Dig Deep Down" — the moment where external action pauses and the hero turns inward to complete their transformation. This is where Want/Need (STC-2) pays off.

**Effort:** Low (prompt guidance)

**Why do it:** Chapter 3 endings are the weakest part of AI-generated stories. They tend to either rush to resolution (no internal turn) or drag through anticlimax (no surprise setback). The three-point structure gives the LLM a template for a satisfying ending.

**Why you might not:** Three movements in 800-1,200 words is ~300 words per movement. This is tight but workable.

**Verdict: DO IT.**

**Priority: Tier 3**

---

### STC-6: Opening / Final Image Mirror

**ID:** STC-6
**What it tests:** The final scene mirrors and contrasts with the opening scene, demonstrating transformation.

**Where it applies:** Planning validation + benchmark judge.

**Implementation approach:**

Planning-plotter prompt: "The final scene must mirror the opening scene — same setting, same character, same type of action — but showing how the character has changed."

Benchmark judge: "Compare the opening and closing scenes. Do they share a setting, character, or motif? Does the final scene demonstrate transformation relative to the opening?"

**Effort:** Low (prompt) to Medium (judge)

**Why do it:** The opening/final mirror is one of the most powerful narrative devices. It gives readers a concrete visual demonstration of change. It also creates structural closure.

**Why you might not:** Not all stories benefit from mirroring. Tragedy, horror, and some thrillers intentionally end in a different register. Forcing a mirror on a horror story where the protagonist dies would feel artificial.

**Mitigation:** Make it planning suggestion, not a hard requirement. Flag its absence in benchmarks for analysis.

**Verdict: DO IT** as planning guidance. Don't hard-enforce.

**Priority: Tier 4**

---

### STC-7: "Whiff of Death" at All Is Lost

**ID:** STC-7
**What it tests:** Something or someone dies (literally or metaphorically) at the 75% mark — a mentor, a relationship, a dream, a belief.

**Where it applies:** Planning-plotter prompt guidance for Chapter 2's ending.

**Implementation approach:**

Add to the planning-plotter prompt: "Chapter 2 must end with a significant loss — death, destruction of a key relationship, loss of the protagonist's primary tool/ally/belief. This loss must feel irreversible."

Judge: "Does Chapter 2 end with a significant, irreversible loss?"

**Effort:** Low

**Why do it:** The "death" at 75% is what makes the final act meaningful. Without it, the climax is "the protagonist solves the problem." With it, the climax is "the protagonist solves the problem DESPITE having lost the thing they relied on." This raises emotional stakes enormously.

**Why you might not:** In a 3-chapter story, Chapter 2's ending is also the setup for Chapter 3. If the loss is too severe, the protagonist may have nothing left to work with in the finale.

**Mitigation:** Specify "metaphorical death" as acceptable — the loss of a belief or strategy, not necessarily a character.

**Verdict: DO IT.**

**Priority: Tier 1**

---

### STC-8: Save the Cat Genre Classification

**ID:** STC-8
**What it tests:** Map each seed to one of the 10 STC genres (Monster in the House, Golden Fleece, Buddy Love, etc.) and enforce genre-specific ingredients.

**Where it applies:** Seed configuration + planning validation.

**Effort:** Medium

**Why do it:** STC genres are orthogonal to traditional publishing genres. Knowing the STC genre tells the plotter what structural ingredients are needed.

**Why you might not:** This overlaps significantly with SG-4/SG-5 (Story Grid genre conventions). Implementing both creates redundant checks that may conflict. Story Grid's genre system is more detailed and better documented.

**Verdict: SKIP.** Use STC beats (STC-1) with Story Grid genres (SG-4/SG-5). Avoids framework conflicts.

**Priority: Skip**

---

### STC-9: B-Story Character as Theme Carrier

**ID:** STC-9
**What it tests:** A secondary character/relationship exists whose function is to embody and deliver the theme. The B-story character provides the key insight that triggers the hero's transformation.

**Where it applies:** Character-agent + planning-plotter.

**Implementation approach:**

In the character-agent output, identify one character as the "B-story character" whose relationship to the protagonist is thematic.

In the planning-plotter, ensure at least one scene per chapter involves the B-story character, and that their interaction in Chapter 3 triggers the hero's breakthrough.

**Effort:** Low-Medium

**Why do it:** Without a B-story character, theme gets delivered through narrator exposition or protagonist internal monologue — both forms of telling. A B-story character lets theme emerge through dialogue and action (showing). This directly supports the existing anti-telling goal.

**Why you might not:** In a 3-chapter story with limited word count, every character needs to serve double duty. A character whose only function is thematic feels like a waste of narrative real estate.

**Mitigation:** The B-story character should also serve a plot function (ally, rival, love interest). The thematic function is additional, not exclusive.

**Verdict: DO IT** as a character-agent prompt enhancement.

**Priority: Tier 2**

---

### STC-10: Transformation Checkpoints

**ID:** STC-10
**What it tests:** At specific beats, the protagonist's relationship to their flaw/Lie/Want/Need is at a specific state (see Appendix D for beat-by-beat mapping).

**Where it applies:** Cross-chapter validation — a judge checks character state progression.

**Implementation approach:**

Define expected transformation state at each act boundary:
- End of Chapter 1: protagonist has left comfort zone but still operates from flaw/Lie
- End of Chapter 2: protagonist has glimpsed the truth but the old self has died (All Is Lost)
- End of Chapter 3: protagonist acts from truth/Need, completing transformation

A judge reads the character's behavior at chapter boundaries and checks progression.

**Effort:** Medium-High

**Why do it:** Character arcs are the most common weakness in AI-generated fiction. LLMs tend to produce characters that change too quickly (instant epiphany in Chapter 1) or not at all (same person start to finish). Checkpoint validation ensures gradual, earned transformation.

**Why you might not:** "Is the character still operating from their flaw?" is a subjective assessment. Judge LLMs may produce noisy results. Also, not all stories have positive transformation arcs.

**Mitigation:** Start with a simple 3-point check (flaw visible in Ch1, crisis in Ch2, change in Ch3) rather than detailed state tracking.

**Verdict: MAYBE.** Prototype as benchmark dimension first. Don't add to validation pipeline until judge consistency is verified.

**Priority: Tier 4**

---

## III. K.M. Weiland

### W-1: Scene/Sequel Pattern in Writer Prompt

**ID:** W-1
**What it tests:** Every scene follows Goal->Conflict->Disaster (action), and is followed by Reaction->Dilemma->Decision (reflection). The decision becomes the next scene's goal.

**Where it applies:** Writer agent `prompt.md` — generation guidance.

**Implementation approach:**

Add to `writer/prompt.md`:

> Structure each scene as: Goal (what does the POV character want in this scene?) then Conflict (what opposes them?) then Disaster (how does it go wrong or succeed-with-cost?). Between scenes, include a brief sequel: Reaction (emotional response) then Dilemma (what now?) then Decision (next action). The decision should connect to the next scene's goal. Sequels can be a single sentence between scenes — the pattern should be present but not belabored.

No schema changes required.

**Effort:** Low (prompt change only)

**Why do it:** This is the most practical scene-level writing framework. It gives the LLM a concrete pattern for each scene rather than "write vivid prose." The writer prompt currently has 6 craft rules (all about style — showing, sensory detail, dialogue). This adds a structural rule.

The Scene/Sequel pattern naturally prevents two common AI failures:
- Scenes that are all action with no reflection (pure Scene, no Sequel)
- Scenes that are all internal monologue with no action (pure Sequel, no Scene)

**Why you might not:** At 200-600 words per scene, the full 6-element cycle is long. A compressed scene might be Goal->Conflict->Disaster in 300 words with the Sequel compressed to a single sentence.

**Mitigation:** Already included in the prompt language: "Sequels can be a single sentence."

**Verdict: DO IT.** The single best addition to the writer prompt. Low cost, high structural impact.

**Priority: Tier 1**

---

### W-2: Lie/Truth Character Arc Framework

**ID:** W-2
**What it tests:** The protagonist believes a specific Lie at the start, encounters the Truth through the story, and either embraces it (positive arc), rejects it (negative arc), or already holds it (flat arc).

**Where it applies:** Character-agent schema + plotter + planning-plotter.

**Implementation approach:**

Extend `CharacterProfile`:
```typescript
{
  // existing fields...
  lie: string,       // The false belief ("The only way to protect people is to control them")
  truth: string,     // The reality that counters the Lie
  ghost: string,     // Backstory trauma that created the Lie
  arcType: "positive" | "flat" | "negative"
}
```

The plotter's act summaries should specify where the Lie is challenged.

The planning-plotter should ensure:
- Ch1 shows the Lie operating (protagonist makes decisions based on false belief)
- Ch2's midpoint is the "Moment of Truth" (first conscious recognition of Truth)
- Ch2's ending is the "Death of the Lie" (Lie-based paradigm collapses)

**Effort:** Medium

**Why do it:** This is the character-arc equivalent of the Five Commandments — the most structured, most encodable character framework available. The current character-agent produces `goals`, `fears`, `traits`, and `backstory` but nothing about internal transformation. Lie/Truth/Ghost gives the planning-plotter something concrete to arc across 3 chapters.

Pairs perfectly with STC-2 (Want/Need): Want is driven by the Lie, Need is the Truth.

**Why you might not:** The Lie/Truth framework works best for positive change arcs. Some seeds might produce flat-arc or negative-arc stories. LLMs tend to make the Lie too obvious ("I'm not good enough").

**Mitigation:** Provide examples of good Lies in the character-agent prompt: "The Lie should be specific and debatable, not a generic insecurity. Good: 'The only way to protect people is to control them.' Bad: 'I'm not worthy of love.'"

**Verdict: DO IT.** Second-highest-value character improvement after STC-2, and they're complementary. Implement both together.

**Priority: Tier 2**

---

### W-3: Pinch Points at 37% and 62%

**ID:** W-3
**What it tests:** The antagonistic force demonstrates its power at two specific points — 37% and 62% of the story.

**Where it applies:** Planning-plotter prompt guidance.

**Implementation approach:**

In a 3-chapter, ~3,000-word story: 37% = ~word 1,100 (mid-Chapter 2), 62% = ~word 1,860 (late Chapter 2). Both pinch points fall in Chapter 2.

Add to the planning-plotter prompt: "Chapter 2 must include two moments where the antagonistic force demonstrates its power or raises stakes. The first should come in the first half of Chapter 2, the second in the second half."

**Effort:** Low (prompt guidance)

**Why do it:** Pinch points prevent the "sagging middle" — Chapter 2 is where AI-generated stories most often lose momentum. Requiring two antagonist-pressure beats ensures Chapter 2 has escalation, not just progression.

**Why you might not:** With 2-4 scenes in Chapter 2, two pinch points might leave no room for non-antagonist scenes.

**Mitigation:** Frame as "the antagonist's influence must be felt" rather than "the antagonist must appear on stage." A pinch point can be discovering evidence of the antagonist's actions.

**Verdict: DO IT.**

**Priority: Tier 1**

---

### W-4: Chiastic (Mirror) Structure Validation

**ID:** W-4
**What it tests:** Story beats mirror each other across the midpoint: Hook to Resolution, Inciting Event to Climactic Moment, First Plot Point to Third Plot Point.

**Where it applies:** Planning validation — post-outline analysis.

**Effort:** Medium

**Why do it:** Creates subconscious satisfaction. Measurable: check whether motifs, settings, or character states at the start reappear (inverted) at the end.

**Why you might not:** Overlaps with STC-6 (Opening/Final Image Mirror). The additional mirroring (inciting/climactic, plot point/plot point) may be too subtle for a judge LLM at short-story scale.

**Verdict: SKIP.** STC-6 covers the most valuable mirror (opening/closing). Full chiastic structure is overkill for 3 chapters.

**Priority: Skip**

---

### W-5: Disaster Type Variety

**ID:** W-5
**What it tests:** Scene disasters vary in type (direct obstruction, indirect obstruction, partial obstruction, hollow victory) rather than always being the same.

**Where it applies:** Planning validation.

**Effort:** Low (if SG-1 exists)

**Why you might not:** With 6-12 scenes, variety is naturally limited. Two scenes ending the same way isn't a problem — 3+ in a row is, but that's unlikely at this scale. SG-3 (turning point type) covers the same ground.

**Verdict: SKIP.** Not enough scenes to make this meaningful.

**Priority: Skip**

---

### W-6: Negative Arc Support

**ID:** W-6
**What it tests:** When the seed/story demands a negative arc (Disillusionment, Fall, or Corruption), the harness correctly structures the character's descent rather than forcing a positive arc.

**Where it applies:** Character-agent (arc type selection) + planning-plotter (conditional beat mapping).

**Effort:** Medium

**Why do it:** Some seeds naturally call for negative arcs (dark-fantasy "cure that comes back wrong" is a strong Fall arc candidate). Without explicit support, the harness always produces positive "hero overcomes flaw" stories, limiting tonal range.

**Why you might not:** Negative arcs are harder for LLMs to write well. The character must make increasingly bad choices that feel *motivated*, not arbitrary. AI-generated negative arcs tend to produce characters who seem stupid rather than tragic.

**Mitigation:** Only enable for seeds that explicitly tag `arcType: "negative"`.

**Verdict: MAYBE.** Implement the schema support (`arcType` field) now as part of W-2. Build the conditional prompt logic later when positive arcs work well.

**Priority: Skip (implement schema only as part of W-2)**

---

## IV. MICE Quotient (Kowal / Card)

### MICE-1: Thread Identification and FILO Nesting Validation

**ID:** MICE-1
**What it tests:** All narrative threads (Milieu, Inquiry, Character, Event) are identified, and threads close in reverse order of opening — the FILO rule (First In, Last Out).

**Where it applies:** Planning-level validation (not post-draft).

**Implementation approach:**

Have the planning-plotter explicitly tag each thread with open/close scene numbers:
```typescript
{
  threads: [
    { type: "event", description: "plague destabilizes kingdom", opensAt: "ch1-s1", closesAt: "ch3-s3" },
    { type: "character", description: "doctor questions methods", opensAt: "ch1-s2", closesAt: "ch3-s2" }
  ]
}
```

Deterministic check: do threads close in reverse order of opening? If not, flag the violation.

**Effort:** Medium-High

**Why do it:** FILO violations are the #1 cause of "the ending dragged" or "the story kept going after it should have ended." If the main mystery (Inquiry) is solved in Chapter 2 but the characters are still in the dangerous location (Milieu) through Chapter 3, the reader feels the story is over. This is a genuinely novel check — bracket-matching for narrative structure.

**Why you might not:** Thread identification is subjective. 3-chapter stories typically have 1-2 dominant threads, making FILO trivially satisfied.

**Mitigation:** Apply at planning level where threads are explicitly tagged. Don't try to extract threads from finished prose.

**Verdict: DO IT**, but at planning level only.

**Priority: Tier 3**

---

### MICE-2: Thread Count Appropriate to Length

**ID:** MICE-2
**What it tests:** The number of active narrative threads is appropriate for the story length. For ~3,000-word stories: 1-2 dominant threads.

**Where it applies:** Planning validation — count threads in the outline.

**Implementation approach:**

If MICE-1 tags threads, count them. Flag if >3 threads are marked as dominant. Deterministic check.

**Effort:** Low (trivial if MICE-1 exists)

**Why do it:** Too many threads in short fiction creates a rushed, surface-level story. Each thread needs space for try/fail cycles. With 3,000 words and 4 threads, each thread gets ~750 words — barely enough for one try/fail cycle.

**Why you might not:** The planning-plotter is unlikely to create 4+ threads naturally. This is a safety valve.

**Verdict: DO IT** (trivial with MICE-1).

**Priority: Tier 3 (depends on MICE-1)**

---

### MICE-3: Try/Fail Cycles (Yes-But / No-And)

**ID:** MICE-3
**What it tests:** Each dominant thread has escalating try/fail cycles where the protagonist's attempts either succeed-with-complications (yes-but) or fail-and-worsen (no-and).

**Where it applies:** Planning-plotter prompt guidance.

**Implementation approach:**

Add to the planning-plotter prompt: "For the dominant thread, include at least 2-3 try/fail cycles. Each attempt should either succeed with a new complication (yes, but...) or fail while making things worse (no, and...). Each cycle should escalate stakes — more to lose, fewer options, greater time pressure."

**Effort:** Low (prompt guidance)

**Why do it:** Try/fail cycles create narrative tension. Without them, stories are either "protagonist succeeds immediately" (boring) or "protagonist fails once then succeeds" (flat). Multiple escalating attempts create the sense that the problem is genuinely hard and the eventual resolution is earned. The current planning-plotter produces "scenes" but doesn't require them to escalate through failed attempts.

**Why you might not:** Kowal recommends 4 cycles per thread; the 3-chapter format has room for 2-3 at most.

**Mitigation:** Require 2-3 cycles, not 4.

**Verdict: DO IT.**

**Priority: Tier 1**

---

### MICE-4: Thread Type Tagging Per Seed

**ID:** MICE-4
**What it tests:** Each seed explicitly declares its dominant MICE thread type(s), so the harness knows what kind of story it's building.

**Where it applies:** Seed JSON files.

**Implementation approach:**

Add `miceThreads` to seed files:
```json
{
  "miceThreads": {
    "dominant": "event",
    "secondary": "character"
  }
}
```

Example mappings:
- `dark-fantasy.json` — Event (plague doctor must find cure) + Character (moral transformation)
- `sci-fi-thriller.json` — Inquiry (is the AI lying?) + Milieu (trapped on generation ship)
- `romance-drama.json` — Character (rivals fall in love) + Milieu (shared kitchen)
- `young-adult-fantasy.json` — Character (grief/identity) + Event (dead familiar mystery)
- `minimal.json` — Inquiry (what's behind the door?) + Milieu (exploring the building)

**Effort:** Low

**Why do it:** Knowing the dominant thread type tells the harness what "satisfying" means. An Inquiry-dominant story is satisfying when the question is answered. A Character-dominant story is satisfying when identity shifts. Without this tag, the harness has no way to know whether the ending resolves the right thing.

**Why you might not:** Requires manual classification of each seed. One-time cost.

**Verdict: DO IT.**

**Priority: Tier 2**

---

## V. Cross-Cutting Concerns

### Methodology Overlap Map

Multiple items check similar things under different names. To avoid redundancy, use one framework per concern:

| Concern | Story Grid | Save the Cat | Weiland | MICE | **Use** |
|---------|-----------|-------------|---------|------|---------|
| Scene structure | Five Commandments (SG-1) | — | Scene/Sequel (W-1) | — | **Both** (complementary) |
| Story beats | Hook/Build/Payoff (SG-6) | 15 beats (STC-1) | 11 beats | — | **STC-1** (best 3-ch fit) |
| Genre requirements | Conventions (SG-4) + Obligatory Scenes (SG-5) | 10 genres x 3 ingredients (STC-8) | — | — | **SG-4/SG-5** (more detailed) |
| Character arc | — | Want/Need (STC-2) + Transformation (STC-10) | Lie/Truth/Ghost (W-2) | — | **STC-2 + W-2** (complementary) |
| Midpoint | — | False Victory/Defeat (STC-4) | Moment of Truth | — | **STC-4** (most prescriptive) |
| Thread closure | — | — | — | FILO nesting (MICE-1) | **MICE-1** (unique) |
| Escalation | — | — | — | Try/Fail cycles (MICE-3) | **MICE-3** (most concrete) |

---

## Tier Summary

### Tier 1 — Do immediately (prompt changes only, low effort, high impact)

| ID | Item | Agent Affected | Effort |
|----|------|---------------|--------|
| W-1 | Scene/Sequel pattern | writer `prompt.md` | Low |
| STC-3 | "Stasis = Death" in opening | planning-plotter `prompt.md` | Low |
| STC-4 | Midpoint False Victory/Defeat | planning-plotter `prompt.md` + schema | Low |
| STC-7 | "Whiff of Death" at All Is Lost | planning-plotter `prompt.md` | Low |
| W-3 | Pinch Points in Chapter 2 | planning-plotter `prompt.md` | Low |
| MICE-3 | Try/Fail cycle guidance | planning-plotter `prompt.md` | Low |

**Total: 6 items. All prompt-only. Can be implemented and benchmarked in a single session.**

### Tier 2 — Do next (schema + config changes, medium effort, high impact)

| ID | Item | Agent Affected | Effort |
|----|------|---------------|--------|
| STC-2 + W-2 | Want/Need + Lie/Truth/Ghost | character-agent schema + prompt | Medium |
| SG-1 | Five Commandments per scene | planning-plotter schema + prompt | Medium |
| SG-2 | Value shift per scene | planning-plotter schema | Medium |
| STC-1 | Compressed 7-8 beat structure | planning-plotter prompt + validation | Medium |
| STC-9 | B-story character tagging | character-agent prompt | Low-Medium |
| MICE-4 | Thread type tagging per seed | seed JSON files | Low |

**Total: 6 items. Schema changes + prompt updates.**

### Tier 3 — Do when Tier 2 is validated (new validation agents/judges)

| ID | Item | Type | Effort |
|----|------|------|--------|
| SG-4 + SG-5 | Genre conventions + obligatory scenes | Planning judge | Medium-High |
| SG-6 | Act-level Five Commandments | Planning validation | Low-Medium |
| MICE-1 + MICE-2 | Thread identification + FILO + count | Planning schema + deterministic check | Medium-High |
| STC-5 | Three-Point Finale structure | Planning prompt | Low |
| SG-3 | Turning point type variety | Deterministic check | Low |

**Total: 5 items. New validation checks.**

### Tier 4 — Prototype as benchmark dimensions only (uncertain reliability)

| ID | Item | Type | Effort |
|----|------|------|--------|
| STC-10 | Transformation checkpoints | Benchmark judge | Medium-High |
| SG-8 | Controlling idea validation | Benchmark judge | Medium |
| STC-6 | Opening/Final Image Mirror | Benchmark judge | Medium |

**Total: 3 items. Analysis only — don't gate on these until judge reliability is confirmed.**

### Skip (redundant, over-engineered, or premature)

| ID | Item | Reason |
|----|------|--------|
| SG-7 | Full spreadsheet schema | Over-engineering for 6-12 scenes |
| STC-8 | STC genre classification | Redundant with Story Grid genres |
| W-4 | Chiastic structure | Subsumed by STC-6 |
| W-5 | Disaster type variety | Not enough scenes to be meaningful |
| W-6 | Negative arc support | Premature — get positive arcs right first |

---

## Measurement Strategy

Every change should be measurable through existing benchmark infrastructure:

| Change Type | How to Measure |
|-------------|---------------|
| **Prompt changes (Tier 1)** | Run prose benchmark before and after. Telling, Dead Weight, and Dialogue scores should shift. |
| **Schema changes (Tier 2)** | Requires new planning benchmark dimensions: "Beat Compliance" (are specified beats present?) and "Arc Progression" (does character state change across chapters?). |
| **Validation additions (Tier 3)** | Count issues detected per run. Track whether rewriting fixes them. |
| **Benchmark prototypes (Tier 4)** | Run as analysis-only dimensions. Track scores across runs but don't gate on them. |

**Commit format for methodology changes:**
```
[agent:planning-plotter] Add try/fail cycle guidance (MICE-3)

methodology: MICE Quotient — try/fail cycles
benchmark: T:5.2 W:1.8 D:2.3 (delta vs baseline)
```

---

## Appendix A — Story Grid Genre Conventions (Short Fiction Subsets)

Full convention lists are extensive (4-10 items per genre). These are the **3-4 most essential** for 3-chapter short stories — the conventions that define the genre's feel and are achievable in limited space.

### Action
| Type | Item |
|------|------|
| Convention | Hero, Villain, Victim triangle |
| Convention | Deadline / limited time for action |
| Obligatory Scene | **Hero at the Mercy of the Villain** (core event) |
| Obligatory Scene | Hero's initial strategy fails |

### Thriller
| Type | Item |
|------|------|
| Convention | MacGuffin (villain's object of desire) |
| Convention | Clock (limited time constraint) |
| Obligatory Scene | **Hero at the Mercy of the Villain** (core event) |
| Obligatory Scene | Protagonist becomes the Victim (crimes become personal) |

### Horror
| Type | Item |
|------|------|
| Convention | Monster that cannot be reasoned with |
| Convention | Claustrophobic setting |
| Obligatory Scene | **Victim at the Mercy of the Monster** (core event) |
| Obligatory Scene | Monster's true nature revealed |

### Love
| Type | Item |
|------|------|
| Convention | Opposing forces preventing the match |
| Convention | Helpers and Harmers |
| Obligatory Scene | **Proof of Love** — sacrifice without guarantee of return (core event) |
| Obligatory Scene | Lovers break up |
| Obligatory Scene | Lovers meet |

### Morality
| Type | Item |
|------|------|
| Convention | Spiritual mentor or sidekick |
| Convention | Seemingly impossible external conflict forcing a moral choice |
| Obligatory Scene | **The Big Choice** — sacrifice self or remain selfish (core event) |
| Obligatory Scene | All Is Lost moment — recover moral code or choose immorality |

### Worldview
| Type | Item |
|------|------|
| Convention | Mentor figure |
| Convention | Clear point of no return |
| Obligatory Scene | **Protagonist acts on new wisdom** (core event) |
| Obligatory Scene | Initial strategy to outmaneuver antagonist fails |

### Status
| Type | Item |
|------|------|
| Convention | Strong mentor figure |
| Convention | Clear point of no return |
| Obligatory Scene | **The Big Choice** — pursue status or reject the world they sought (core event) |
| Obligatory Scene | All Is Lost — must redefine success or compromise values |

---

## Appendix B — Save the Cat Beat Sheet (3-Chapter Compression)

Full 15-beat sheet compressed to 7-8 beats for ~3,000-word, 3-chapter stories.

| # | Beat | % Window | Chapter | Word ~(3k) | Must Happen |
|---|------|----------|---------|-----------|-------------|
| 1 | **Opening Image / Setup** | 0-10% | Ch1 open | 0-300 | Flawed status quo. Stasis = Death. "Six Things That Need Fixing" visible. |
| 2 | **Catalyst** | 10-15% | Ch1 mid | 300-450 | Life-changing disruption. Cannot return to normal. External or internal. |
| 3 | **Break Into 2** | 20-25% | Ch1 close | 600-750 | Protagonist enters "upside-down world." Active choice, not passive. New goal. |
| 4 | **Midpoint** | 45-55% | Ch2 mid | 1350-1650 | False Victory or False Defeat. Stakes raised. A-story and B-story cross. |
| 5 | **All Is Lost** | 70-80% | Ch2 close | 2100-2400 | Lowest point. Whiff of death. Old self/belief/ally dies. |
| 6 | **Break Into 3** | 80-85% | Ch3 open | 2400-2550 | "Aha" moment. Protagonist understands what they must do. B-story insight. |
| 7 | **Finale** | 85-95% | Ch3 mid | 2550-2850 | Dig Deep Down: transformation completes. Acts on Need, not Want. |
| 8 | **Final Image** | 98-100% | Ch3 close | 2940-3000 | Mirror of Opening Image showing transformation. |

**Beats absorbed by compression:**
- Theme Stated (5%) — embedded in Setup dialogue
- Debate (10-20%) — compressed into Catalyst reaction
- B Story (22%) — embedded in Break Into 2
- Fun and Games (20-50%) — folded into Chapter 2 first half
- Bad Guys Close In (50-75%) — folded into Chapter 2 second half
- Dark Night of the Soul (75-80%) — compressed into All Is Lost reaction

---

## Appendix C — Value Spectrum Reference

Story Grid value spectrums mapped to genres relevant to existing seeds.

| Genre | Positive (+) | Contrary (+/-) | Negative (-) | Negation of Negation (--) |
|-------|-------------|-----------------|--------------|---------------------------|
| **Action** | Life | Unconsciousness | Death | Damnation (fate worse than death) |
| **Thriller** | Life | Unconsciousness | Death | Damnation |
| **Horror** | Life | Unconsciousness | Death | Damnation |
| **Love** | Love | Commitment without passion | Hate/Indifference | Hate masked as Love |
| **Morality** | Altruism | Self-interest aligned with others | Selfishness | Selfishness masked as Altruism |
| **Worldview** | Wisdom/Knowledge | Cognitive Dissonance | Ignorance | Ignorance masked as Knowledge |
| **Status** | Success | Compromise | Failure | Selling Out (failure masked as success) |

**Seed-to-genre mapping (proposed):**

| Seed | Primary Genre | Secondary Genre | Primary Value |
|------|--------------|----------------|---------------|
| `dark-fantasy.json` | Horror | Morality | Life / Death |
| `young-adult-fantasy.json` | Worldview | Love | Wisdom / Ignorance |
| `sci-fi-thriller.json` | Thriller | Worldview | Life / Death |
| `romance-drama.json` | Love | Status | Love / Hate |
| `minimal.json` | Thriller | Worldview | Life / Death |

---

## Appendix D — Character Arc Beat Mapping

Combined Weiland + STC transformation checkpoints mapped to the 3-chapter format.

### Positive Change Arc (default)

| Chapter | Beat | Character State | Lie/Truth Status | Want/Need Status |
|---------|------|----------------|-----------------|-----------------|
| Ch1 open | Opening Image | Fully in the Lie. Flawed but functional. | Lie operational, Ghost/Wound visible | Pursuing Want. Need invisible. |
| Ch1 mid | Catalyst | Disruption challenges Lie for the first time. | Lie still dominant but cracks appear | Want intensifies in response to disruption |
| Ch1 close | Break Into 2 | Enters new world. Old strategies begin failing. | Lie no longer works in new context | Want seems achievable in new world |
| Ch2 mid | Midpoint | **Moment of Truth.** First conscious recognition. | Glimpses Truth but still clings to Lie | Realizes Want alone won't suffice |
| Ch2 close | All Is Lost | Old self dies. Lie-based paradigm collapses. | Lie demonstrably destroyed | Want has failed. Need not yet grasped. |
| Ch3 open | Break Into 3 | "Aha" moment. Understands what they must do. | Truth recognized. Lie released. | Need understood (often via B-story character) |
| Ch3 mid | Dig Deep Down | Transformation completes through action. | Acts from Truth under pressure | Chooses Need over Want |
| Ch3 close | Final Image | New self established. | Truth integrated | Need fulfilled (Want may or may not be achieved) |

### Flat Arc (protagonist already holds Truth)

| Chapter | Beat | Character State |
|---------|------|----------------|
| Ch1 | Setup | Character believes Truth in a Lie-ridden world. World tries to impose Lie. |
| Ch2 | Midpoint | Proves Truth's power. Doubt at pinch points: "Can Truth actually win?" |
| Ch2 close | All Is Lost | Lie seems to triumph externally. Character's darkest doubt. |
| Ch3 | Climax | Final Truth vs. Lie confrontation. World changes, not the character. |

### Negative Arc — Fall (refuses Truth, embraces worse Lie)

| Chapter | Beat | Character State |
|---------|------|----------------|
| Ch1 | Setup | Believes initial Lie. World is destructive. |
| Ch2 mid | Midpoint | **Glimpses Truth, rejects it, chooses worse Lie.** |
| Ch2 close | All Is Lost | Complete failure. Refuses to repent or turn to Truth. |
| Ch3 | Climax | Last-ditch attempt via worse Lie. Total destruction. |

---

## References

### Story Grid
- [Five Commandments of Storytelling](https://storygrid.com/five-commandments-of-storytelling/)
- [Value Shift 101](https://storygrid.com/value-shift-101/)
- [Genre Conventions and Obligatory Scenes](https://storygrid.com/find-obligatory-scenes-conventions/)
- [The Story Grid Spreadsheet](https://storygrid.com/spreadsheet/)
- [Hook, Build, Payoff](https://storygrid.com/hook-build-payoff/)
- [Foolscap Global Story Grid](https://storygrid.com/foolscap/)
- [Savannah Gilbo: Obligatory Scenes Guide](https://www.savannahgilbo.com/blog/obligatory-scenes-and-conventions)

### Save the Cat!
- [Jessica Brody: Beat Sheet Guide](https://www.jessicabrody.com/2020/11/how-to-write-your-novel-using-the-save-the-cat-beat-sheet/)
- [Jessica Brody: Five-Point Finale](https://www.jessicabrody.com/2021/02/the-save-the-cat-five-point-finale-with-examples/)
- [Save the Cat: Transformation Machine](https://savethecat.com/todays-blog/the-transformation-machine)
- [Save the Cat: Genre Terms Glossary](https://savethecat.com/tips-and-tactics/blake-snyders-glossary-of-genre-terms-2)
- [Kindlepreneur: Beat Sheet Guide](https://kindlepreneur.com/save-the-cat-beat-sheet/)

### K.M. Weiland
- [Scene Structure Complete Series](https://www.helpingwritersbecomeauthors.com/how-to-structure-scenes/)
- [Character Arcs Complete Series](https://www.helpingwritersbecomeauthors.com/write-character-arcs/)
- [Story Structure Complete Series](https://www.helpingwritersbecomeauthors.com/secrets-story-structure-complete-series/)
- [5 Types of Character Arc](https://www.helpingwritersbecomeauthors.com/learn-5-types-of-character-arc-at-a-glance/)

### MICE Quotient
- [Writing Excuses 16.40: Nesting Threads](https://writingexcuses.com/16-40-nesting-threads-in-the-m-i-c-e-quotient/)
- [Writing Excuses 16.41: Middles and Conflicts](https://writingexcuses.com/16-41-middles-and-conflicts/)
- [Driverless Crocodile: MICE Summary](https://www.driverlesscrocodile.com/tools-and-techniques/resource-structuring-stories-with-mary-robinette-kowal-1-the-mice-quotient/)
- [MICE Quotient Nesting and Try/Fails](https://learning2grow.org/plot-your-novel-with-mice-quotient-and-try-fails/)
