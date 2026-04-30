# Story Engineering / Story Physics / Story Fix — Larry Brooks Framework Report

Research target: extract structural rules and constraints from Larry Brooks's *Story Engineering* (Writer's Digest Books, 2011), *Story Physics* (Writer's Digest, 2013), and *Story Fix* (Writer's Digest, 2015) that can be encoded as planner constraints, beat prompts, or checker rules in a programmatic novel-writing harness.

Date: 2026-04-29
Author: Larry Brooks (storyfix.com)

---

## 1. Framework summary

**Origin.** Larry Brooks is a thriller novelist (the Wolfgang Schmitt series, *Pressure Points*) who runs storyfix.com, one of the most-trafficked craft blogs since 2008. *Story Engineering* (2011) was the first of three books that progressively layered:

- *Story Engineering* (2011, ISBN 978-1-58297-998-4) — the **six core competencies** + **four-part story structure**.
- *Story Physics* (2013, ISBN 978-1-59963-689-4) — the **six dramatic forces** that make competencies "work" beyond the mechanical.
- *Story Fix* (2015, ISBN 978-1-59963-955-0) — diagnostic methodology applied to broken manuscripts: each chapter is a fail-mode and a remediation.

**Core thesis.** Story is engineering. There exist a finite number of structural milestones that successful commercial fiction *always* hits, and they hit at predictable percentages of the manuscript. Writing is not magic; it's the assembly of six craftable elements (concept, character, theme, structure, scene execution, voice) according to a measurable architecture. "Pantsing" is fine as a discovery mode but the published draft will retroactively conform to this architecture or it won't sell.

**Problem solved.** Brooks attacks two distinct failure modes:
1. The *idea-confused* writer who pitches a premise without a concept (or a setting without a story).
2. The *structurally diffuse* writer whose first plot point fires at 35%, whose hero is reactive past the midpoint, whose scenes have no expositional mission.

Both are diagnosed and remediated by the same architecture.

**Distinction from Save the Cat.** Brooks is more architectural and less prescriptive at the beat level. Where Snyder gives 15 named beats, Brooks gives 5 milestones plus 4 part-missions plus 3 character dimensions. Brooks's framework is more *generative* (it prescribes what each part must accomplish, not what scene must occur), making it arguably better-suited to a programmatic planner that needs to compose, not just retrieve, structural slots.

---

## 2. Concept-phase prescriptions

### 2.1 Concept vs Premise vs Theme vs Idea

Brooks's most-cited distinction. From *Story Engineering* and storyfix.com:

| Term | Definition | Test question |
|------|------------|----------------|
| **Idea** | The seed; an intention or vision. "I want to write a love story." | "What do I want to write about?" |
| **Concept** | A "what if?" proposition that creates a *platform* on which a story can unfold. Exists *in the absence of character*. | "What if [conditional that promises drama]?" |
| **Premise** | The specific story built on top of the concept — heroes, villains, stakes, plot. | "What happens, to whom, with what goal, against what opposition?" |
| **Theme** | What the story *says* about life. The argument the story makes through its plot resolution. | "What is this story really about?" |

Brooks's worked example (Superman):
- *Idea*: "I want to write about a superhero."
- *Concept*: "What if an infant from a dying planet is sent to Earth, raised by humans, and grows up with vast powers?"
- *Premise*: "A bad guy chases a young planetary heir to Earth to fetch the codex." (Superman 1978)
- *Theme*: "True power comes from restraint and humanity."

The same concept supports infinitely many premises. The *Titanic* example: "A story about being on the Titanic the night it sinks" is a concept, not a premise. It becomes a premise when you specify *which two people* on the ship the story tracks and *what they want from each other*.

**Diagnostic rule.** Brooks claims ~80% of submissions to his coaching service confuse premise with concept. This is the entry-level failure of unpublished writers.

### 2.2 The "what if?" test

A concept is testable by its phrasability as a "what if?" question. If you cannot frame your concept as a single "what if?" that makes a stranger lean forward, you don't have a concept yet.

Strong-concept criteria:
1. **Generates multiple premises** — the same concept supports multiple distinct novels (sequel/series viability).
2. **Independent of specific character names** — generic enough to be a blueprint.
3. **Universally compelling** — resonates without requiring plot detail.
4. **Beyond "good vs evil"** — a high concept transcends moral binaries.
5. **Series-supportable** — concept survives across multiple stories.

### 2.3 The three dimensions of character

Brooks's character model (Story Engineering Part Three; expanded in *The Three Dimensions of Character*, 2013, an abbreviated extract).

| Dimension | What it covers | Where it shows up |
|-----------|----------------|-------------------|
| **First (Surface)** | Quirks, looks, accent, mannerisms, profession, demographics. Surface material with no assigned meaning. | Introductions; ordinary world; daily routine. |
| **Second (Inner / Backstory)** | The wound, the worldview, the inner demons, the *why* behind first-dimension choices. | Revealed gradually via subtext, dialogue, flashback. The empathy layer. |
| **Third (High-Stakes Choices)** | Who the character actually IS when stripped to the bone. Revealed only by impossible choices under maximum pressure. | First Plot Point and Second Plot Point; Climax. Where heroes become heroes and villains reveal themselves. |

**Rule.** A novel that delivers only Dimension 1 reads as cardboard. Dimension 2 alone reads as therapy. Dimension 3 must arrive — and arrive at the structural milestones that *force* it (the plot points). The architecture and character are coupled.

### 2.4 Concept-phase deliverables

Per Brooks, before planning begins, the writer must have:
1. A one-sentence concept ("what if?")
2. A one-sentence premise (hero + want + opposition + stakes)
3. A protagonist with all three character dimensions sketched (Dim 1 surface; Dim 2 wound/worldview; Dim 3 the choice we predict they'll face at the plot points)
4. A theme — an *argument*, not a topic. ("Loyalty saves families" is theme; "loyalty" alone is topic.)
5. Stakes — concrete, ascending, with both external and internal axes.

---

## 3. Planning-phase prescriptions

### 3.1 The four-part structure

Each part covers ~25% of word count and has a *mission* — a fixed dramatic responsibility — and the hero operates in a different *mode* in each part.

| Part | Pct range | Name | Hero mode | Mission |
|------|-----------|------|-----------|---------|
| 1 | 0–25% | **Setup** | Orphan / passive | Introduce hero in their pre-story life. Establish stakes. Foreshadow. Build empathy. End by hurling them across the First Plot Point. |
| 2 | 25–50% | **Response** | Wanderer / reactive | Hero responds to the First Plot Point. Survives, flees, regroups, attempts to understand the new world. Reactive throughout. Antagonistic force(s) press at the First Pinch Point (~37.5%). Ends at Midpoint with new information that changes the game. |
| 3 | 50–75% | **Attack** | Warrior / proactive | Hero pivots from reactive to proactive. Initiates engagement with the antagonist. Second Pinch Point (~62.5%) shows the antagonist hitting back harder. Ends at Second Plot Point with the final information needed to win. |
| 4 | 75–100% | **Resolution** | Martyr / sacrificing | Hero deploys what they've learned. Risks everything. Confronts the antagonist using their accumulated wisdom and the Second Plot Point's new information. Outcome resolved. |

The orphan/wanderer/warrior/martyr labels are Brooks's modal heuristic — they map the hero's psychological posture to the part. Sources online vary on whether Brooks uses these literal labels in *Story Engineering* or whether the labels are derived from Carol Pearson's *The Hero Within*. The functional content (passive → reactive → proactive → sacrificing) is the same regardless.

### 3.2 The five structural milestones

Each is a *transition point* between parts (or within parts) and has a specific mission.

| # | Milestone | Pct | Mission |
|---|-----------|-----|---------|
| 1 | **Hook** | 0–5% | Capture the reader. Brooks treats the hook as something that can occur in the first paragraph through ~first 20 pages — distinct from the inciting incident. Many novels conflate hook and inciting incident; Brooks treats them as separable. |
| 2 | **First Plot Point (FPP)** | 20–25% | THE most important milestone. The hero's "doorway of no return" — the moment everything they will do in the rest of the novel is set in motion. Distinct from the inciting incident, which can fire much earlier. The FPP commits the hero to the stakes and the story question. |
| 3 | **First Pinch Point** | ~37.5% (3/8 mark) | Reminder of the antagonistic force. Hero glimpses what they're up against. Stakes re-asserted. |
| 4 | **Midpoint** | ~50% | "A big fat unexpected twist." New information enters that changes the contextual experience for hero, reader, or both. The hero pivots from response (Part 2) to attack (Part 3). The curtain parts. |
| 5 | **Second Pinch Point** | ~62.5% (5/8 mark) | Second reminder of antagonistic pressure, now stronger. Often introduces new info that reframes the conflict. |
| 6 | **Second Plot Point (SPP)** | ~75% | The final piece of information the hero needs. After SPP, no new characters or major plot information may be introduced. Everything from here is execution and resolution. |
| 7 | **Climactic Moment** | ~95–100% | Hero acts on accumulated wisdom. Resolution — not necessarily happy. |

**Critical execution rule (verbatim Brooks).** "No new characters or information should be introduced after the second plot point." This is a hard structural law in Brooks's framework and is one of the most concrete checker rules available.

### 3.3 Structural vs optional

In Brooks's framework, **all five milestones (FPP, Pinch 1, Midpoint, Pinch 2, SPP) are STRUCTURAL.** A novel missing any one of them is, in Brooks's diagnosis, broken. The only "optional" element is the placement of the hook (it can fire on page 1 or page 20).

In contrast to Snyder/Brody's 15 beats, Brooks's structural lattice is *coarser* (5 milestones vs 15 beats) and *more generative* — there's room inside each part for arbitrary scenes, as long as the milestone arrives on cue.

### 3.4 Failure modes Brooks names

From *Story Engineering* and *Story Fix*:

- **First Plot Point too early or too late.** If FPP fires before 20%, Setup is rushed and stakes don't land. If after 25%, Part 2 is compressed and the response arc is unconvincing.
- **No First Plot Point at all.** Story has an inciting incident but never crosses the doorway of no return; reader feels the hero is wandering aimlessly.
- **Midpoint flat.** No twist, no new information. Part 3 reads as continuation of Part 2; no pivot from response to attack.
- **Hero stays reactive past 50%.** Brooks's "Wanderer mode" leaks into the Attack phase, climax feels passive.
- **Second Plot Point introduces NEW characters or major plot info.** Hard violation; reader feels cheated. Late-introduced antagonist is the canonical example.
- **Pinch points missing.** Antagonistic force fades from view; reader forgets what's at stake.
- **Resolution part too short.** Climax is rushed; theme lands flatly.
- **Concept-premise inversion.** Story is built on a premise without a concept — feels mediocre even if technically competent.

---

## 4. Drafting-phase prescriptions

Brooks's *fifth* core competency is **scene execution**. Story Engineering Part Six (Chapter 42 onward) covers it.

### 4.1 The expositional-mission rule (load-bearing)

Brooks's most-quoted scene rule: **"Every scene needs an expositional mission, IN ADDITION TO illustrating character and place."**

A scene must do *one* of:
- Set up plot (in Part 1, before FPP)
- Forward plot (after FPP)

If a scene illustrates character or place but does *neither* setup nor forwarding, it must be cut. Pure character/place scenes are diagnostic of structural failure.

### 4.2 The "one significant exposition per scene" guideline

Brooks recommends each scene deliver one significant piece of exposition — not multiple. A scene that tries to do too much exposition reads as info-dump; a scene that does none reads as filler.

### 4.3 Scene context awareness

Each scene must be developed in context to:
- What came before (setup the scene leverages)
- What comes next (the next scene's setup that this scene plants)

This is the "plot is visible in every scene" rule. The plot must be *visible* — not implied — in every scene's exposition mission.

### 4.4 Scene structure heuristics (drawn from Brooks's commentary)

- **Open the scene with a clear protagonist goal** for that scene.
- **Resolve the scene with goal achieved, denied, or transformed** — never indeterminate.
- **End on a forward-pressure beat** (a question, a threat, a new piece of information) that demands the next scene.
- **Voice and POV are the sixth core competency** — but Brooks treats voice as a craftable skill, not magic. Voice is the *texture* layer over the structural skeleton.

### 4.5 The six "story physics" forces (from *Story Physics*)

Brooks's later book adds *forces* that operate alongside competencies. These are diagnostic criteria for whether a structurally correct story actually *works* dramatically:

1. **Compelling premise** (tied to concept-premise distinction)
2. **Dramatic tension** (the reader's want-to-know engine)
3. **Pacing** (the ratio of forward exposition to texture)
4. **Hero empathy** (Dim 1+2 character work)
5. **Vicarious experience** (the reader's emotional immersion)
6. **Narrative strategy** (POV, structure, voice working in service of the above)

These forces are *diagnostic*, not prescriptive — they're how you check whether a structurally correct outline will produce a functional novel. Brooks uses them to triage broken manuscripts in *Story Fix*.

---

## 5. Validation/checking prescriptions

The Brooks framework yields concrete checker candidates. Each maps cleanly to a deterministic rule + LLM judge:

1. **Concept absent / premise-only** → flag at concept exit. Detection: prompt LLM judge with the concept text; ask "Can this be phrased as a 'what if?' that makes sense without character names? Does it support multiple distinct stories?"

2. **Theme is topic, not argument** → flag at concept exit. Detection: theme must be a sentence with a verb, not a noun phrase.

3. **First Plot Point misplaced** → planner-level structural violation. Detection: locate FPP-tagged chapter; if cumulative-words ratio is outside [0.20, 0.25], flag.

4. **First Plot Point absent** → planner-level violation. Detection: scan chapter purposes for FPP signature ("doorway of no return," irrevocable commitment, world-disrupting stakes).

5. **Midpoint flat** → check chapter at ~50%. Detection: does the chapter introduce *new information* that re-frames stakes? LLM judge against the planner's `establishedFacts` deltas at this chapter.

6. **Hero reactive past 50%** → cross-chapter check. Detection: classify each scene's protagonist agency as reactive vs proactive (LLM judge). If proactive ratio is <50% in chapters covering 50–75%, flag.

7. **No new info post-SPP** → hard rule. Detection: compare characters in chapters past 75% against pre-75% character roster. Any new named character is a hard violation. Also check `establishedFacts` for net new information after SPP.

8. **Second Plot Point absent** → flag at planner level.

9. **Pinch points missing** → check chapters at ~37.5% and ~62.5% for antagonist presence/threat. Detection: scan for antagonist mentions; require minimum density.

10. **Scenes without expositional mission** → checker per beat. Detection: classify each beat's purpose against {`setup`, `forward`, `texture`, `none`}. Flag any "texture" or "none" beat for review.

11. **Info-dump density** → percentage of paragraphs that are pure exposition (no action, no dialogue, no sensory anchor) must be below threshold per chapter.

12. **Scene goal-resolution missing** → per-beat check. Detection: each beat must end with a goal-resolved or goal-transformed cue.

13. **Three dimensions of character not delivered** → arc-level check. Did Dim 3 (high-stakes choice) appear at FPP? At SPP? At climax? If protagonist makes no impossible choice across the structural milestones, flag.

14. **Concept doesn't generate the climax** → climax-quality check. The climactic moment should be the answer to the concept's "what if?" question. LLM judge: "Does this climax answer the concept question? Or does it answer some other question?"

15. **Stakes failed to escalate** → check whether stakes (per chapter `characterStateChanges`) trend monotonically harder across the four parts. If Part 3 stakes are flat or lower than Part 2, flag.

---

## 6. Programmatic levers for the harness

Concrete implementation suggestions, written as if implementable next sprint.

### Lever 1 — Concept-vs-premise gate

Add a `conceptStatement: { whatIf: string }` field to seed directives. Before promoting concept→planning, run a small LLM judge ("Is this a 'what if?' that exists without naming specific characters? Y/N + reason"). Reject premise-shaped concepts. This catches the #1 amateur failure mode.

### Lever 2 — Theme-as-argument validator

`theme: string` in seed directives. Validator: theme must contain a verb and assert a relationship between two abstract nouns. Reject "loyalty" or "love"; accept "loyalty makes families survivable" or "love is incompatible with control."

### Lever 3 — Three-dimensions character schema

Force `character-agent` to emit:
```json
{
  "dimension1": { "surface": "...", "quirks": "...", "speech": "..." },
  "dimension2": { "wound": "...", "worldview": "...", "fear": "..." },
  "dimension3": { "predictedHighStakesChoice": "..." }
}
```
Drop `dimension3.predictedHighStakesChoice` into the FPP and SPP chapter context as a "this is the choice the hero is being driven toward" hint for `beat-writer`.

### Lever 4 — Four-part planning lattice

The planning-plotter outputs chapters tagged with their part: `part: 1 | 2 | 3 | 4` and `mode: orphan | wanderer | warrior | martyr`. Validate cumulative word ratios match the 25/25/25/25 split (with ±5% tolerance). Inject part-mission into chapter-skeleton prompt: "This chapter is in Part 2 (Response); the hero must be reactive, attempting to understand the new world."

### Lever 5 — Five-milestone enforcement at planning

Planner declares one chapter for each milestone. Validator:
- FPP chapter: cumulativeWords/total ∈ [0.20, 0.25]
- Pinch 1 chapter: ∈ [0.35, 0.40]
- Midpoint chapter: ∈ [0.45, 0.55]
- Pinch 2 chapter: ∈ [0.60, 0.65]
- SPP chapter: ∈ [0.72, 0.78]

Misplacement → route to chapter-plan-reviser with the specific milestone's mission as the constraint. This is roughly a 50-line addition to `enforcePlanningOutput`.

### Lever 6 — Hard "no new entities post-SPP" checker

Deterministic check: compute the set of named characters in chapters 1..SPP-chapter. After SPP, scan all `characterStateChanges` and `establishedFacts` for net-new named entities. Any addition is a structural violation. This is a high-value checker because LLM planners *love* introducing late helpers/villains, which violates Brooks's hardest rule. Implementation: ~20 lines on top of existing planner schemas.

### Lever 7 — Hero-mode classifier per beat

Add a small classifier (could run on a 4B base) that tags each beat as `reactive | proactive`. Aggregate per part:
- Part 1: any mix
- Part 2: should be ≥60% reactive
- Part 3: should be ≥60% proactive
- Part 4: should be 100% proactive

If ratios invert, flag. This catches "hero stays passive" — a top failure mode in LLM-drafted novels because LLMs default to reactive narration.

### Lever 8 — Expositional-mission classifier

Each beat's `description` is classified by an LLM judge against {`setup_plot`, `forward_plot`, `character_only`, `place_only`, `none`}. Beats categorized as `character_only` / `place_only` / `none` are flagged for rewrite or merge. This is one of the most actionable Brooks rules because it directly addresses the "filler beat" problem.

### Lever 9 — Pinch-point antagonist-presence check

For chapters at 37.5% and 62.5% (±2.5%), require antagonist appearance/threat in at least one beat. If the planner has no antagonist character defined for that chapter, escalate.

### Lever 10 — Midpoint-as-information-shift check

The Midpoint chapter's `establishedFacts` and `knowledgeChanges` deltas must be non-trivial. Compute |new facts at midpoint| / |new facts at average chapter|; if ratio < 1.5, the Midpoint isn't earning its position. Flag for revision.

### Lever 11 — Scene-resolution forward-pressure rule

Beat-writer prompt addendum: "End this beat with one of: an unanswered question, a new threat, an arrival, a piece of information that reframes earlier facts. Do not end on a stable equilibrium." Add a checker that scans beat closings for forward-pressure signals.

### Lever 12 — Stakes-monotonic-escalation check

Per chapter, `characterStateChanges` should include at least one stakes-incrementing change. Compute aggregate stakes-vector across the four parts; require monotonic increase from Part 1 → Part 4. Flag any part where stakes plateau or decrease.

### Lever 13 — "Six dramatic forces" diagnostic suite

For each completed novel, run a 6-question LLM panel scoring the novel against Brooks's forces (compelling premise / dramatic tension / pacing / empathy / vicarious experience / narrative strategy). Output per-axis score 1–5 with rationale. Use as a *diagnostic* (not blocking) check at validation phase. This is parallel to STC's structural checks but scored against dramatic effectiveness.

### Lever 14 — Hook detection independent from inciting incident

Brooks separates these — the harness should too. Add a planner field: which beat in chapter 1 is the *hook* (the read-on grab) vs. which beat is the *inciting incident*. Validator: hook must be in first 5% of words; inciting incident may fire later. They may be the same beat but should be separately analyzable.

### Lever 15 — Concept-climax coherence check

LLM judge at validation phase: load the concept "what if?" statement and the climactic chapter prose. Ask: "Does the climax answer this 'what if?' question, or does it answer some other question?" Misalignment is a deep failure mode (story drifted from concept). High-value because it catches concept-drift across the planning→drafting handoff.

---

## 7. Limitations / when Brooks fails

- **Architectural rigidity.** Brooks is more architectural than literary. Frameworks like his work poorly for genre-busting structures: nested narratives (*Cloud Atlas*), unreliable-narrator novels (*Pale Fire*, *Lolita*), mosaic narratives (*Olive Kitteridge*). For commercial fantasy/LitRPG (the harness's stated target), this rigidity is a feature, not a bug.

- **Five-milestone lattice is coarser than necessary.** Compared to STC's 15 beats, Brooks gives you fewer hooks for the LLM to write into. A planner that uses *only* Brooks's milestones will produce baggy second acts. Practical harness recommendation: **combine.** Use Brooks's four-part structure + five milestones as the load-bearing lattice; use STC's 15 beats as a finer-grained scene-level scaffolding inside it. (The two frameworks are compatible: STC's beats line up reasonably with Brooks's milestones — Catalyst ≈ inciting incident; Break Into 2 ≈ FPP; Midpoint ≈ Midpoint; All Is Lost ≈ near SPP.)

- **The "no new info post-SPP" rule is too strict for some genres.** Mystery novels often reveal the killer's identity *after* SPP. Brooks would say the SPP is when the detective figures it out, not when the reader does — but in practice the rule needs softening for whodunits.

- **The orphan/wanderer/warrior/martyr labels are derivative.** Multiple sources (Pearson's *The Hero Within*; some Joseph Campbell lineage) use similar labels. Brooks's framework absorbs them but doesn't always credit. The harness should treat these as functional descriptors, not load-bearing taxonomy.

- **Voice as "sixth competency" is underdeveloped.** Brooks's voice chapter is short and vague. For a programmatic harness whose voice layer is currently fine-tuned LoRAs (Salvatore family, per project context), Brooks gives no actionable guidance — which is fine; voice is offloaded to the LoRA stack.

- **"Story Physics" forces are subjective.** "Compelling premise" is exactly the thing every author thinks they have. The forces are useful as a final-pass diagnostic; not useful as a planning constraint.

- **Brooks is American commercial fiction-centric.** His examples are thrillers, romances, mainstream genre. Literary fiction, translated literature, and many international forms don't conform. Within commercial fantasy/LitRPG (the harness target), this is a feature.

- **The framework over-claims universality.** Brooks asserts that *all* successful commercial fiction conforms to this architecture; this is empirically defensible at ~80% but the 20% of exceptions are often the most interesting books. For a harness producing many novels, conforming is the right default.

---

## 8. Citation list

### Books

- Larry Brooks, *Story Engineering: Mastering the 6 Core Competencies of Successful Writing* (Writer's Digest Books, 2011). ISBN 978-1-58297-998-4. ~278 pages.
- Larry Brooks, *Story Physics: Harnessing the Underlying Forces of Storytelling* (Writer's Digest, 2013). ISBN 978-1-59963-689-4. ~224 pages.
- Larry Brooks, *Story Fix: Transform Your Novel from Broken to Brilliant* (Writer's Digest, 2015). ISBN 978-1-59963-955-0. ~256 pages.
- Larry Brooks, *The Three Dimensions of Character* (Writer's Digest e-book, 2013) — abbreviated extract from *Story Engineering*.

### Online resources

- StoryFix.com (Brooks's blog, ~15 years of craft posts): https://storyfix.com/
- "Story Structure Cliff Notes: The Whole Damn Structure Enchilada in Less Than 2000 Words": https://storyfix.com/story-structure-cliff-notes-whole-damn-structure-enchilada-less-2000-words
- "Six Core Competencies of Successful Storytelling": https://storyfix.com/six-core-competencies-of-successful-storytelling
- "A Clearer Understanding of 'Concept'": https://storyfix.com/a-clearer-understanding-of-concept
- Writer's Digest: "Spotlight on Story Engineering & The Six Core Competencies": https://www.writersdigest.com/improve-my-writing/spotlight-on-story-engineering-the-six-core-competencies
- Writer's Digest: "Concept Defined" (Story Engineering excerpt): https://www.writersdigest.com/wd-books/story-engineering-excerpt
- Internet Archive (free borrow): https://archive.org/details/storyengineering0000broo
- Internet Archive (Story Physics): https://archive.org/details/storyphysicslarrybrooks

### Third-party summaries (useful for cross-validation)

- Jordan McCollum, "Overview of Larry Brooks's Story Structure": https://jordanmccollum.com/overview-larry-brookss-story-structure/
- "Larry Brooks' Story Structure" (Write on the World, 2024): https://writeontheworld.wordpress.com/2024/07/26/larry-brooks-story-structure/
- The Friendly Editor (Brooks tag): https://thefriendlyeditor.com/tag/larry-brooks/ — includes a long Harry Potter beat-by-beat structural analysis using Brooks's framework
- "Concept vs Premise" (Helping Writers Become Authors): https://www.helpingwritersbecomeauthors.com/story-concept/
- The Fictorians, "3 Dimensions of Character": https://www.fictorians.com/2013/02/18/3-dimensions-of-character-a-review-of-larry-brooks-character-development-technique/
- Storytellingdb, "The Larry Brooks Short Story Template": https://storytellingdb.com/larry-brooks-short-story-template/
- Mehul Kamdar, "Story Engineering" notes: https://mbkamdar.github.io/books/brooks-story-engineering/

### Adjacent / related frameworks

- Compare to STC sister report: `docs/research/writing-frameworks/save-the-cat.md`
- K.M. Weiland's *Structuring Your Novel* (Helping Writers Become Authors) — uses a near-identical structure to Brooks; cross-validates the milestones.

---

## Appendix A — minimum-viable Brooks encoding for the harness

Drop-in shape for `seed_json.directives`:

```json
{
  "concept": {
    "whatIf": "string"
  },
  "premise": "string",
  "theme": {
    "argument": "string"
  },
  "protagonist": {
    "dimension1": { "surface": "string", "quirks": "string", "speech": "string" },
    "dimension2": { "wound": "string", "worldview": "string", "fear": "string" },
    "dimension3": { "predictedHighStakesChoice": "string" }
  },
  "antagonisticForce": "string",
  "stakes": { "external": "string", "internal": "string" }
}
```

Per-chapter shape gains:

```json
{
  "part": 1,
  "mode": "orphan",
  "milestone": null,  // or "hook" | "fpp" | "pinch1" | "midpoint" | "pinch2" | "spp" | "climax"
  "expositionalMission": "setup_plot",  // or "forward_plot"
  "antagonistPresent": true,
  "stakesDelta": "increases"
}
```

Per-beat shape gains:

```json
{
  "expositionalMission": "setup_plot | forward_plot",
  "heroAgency": "reactive | proactive",
  "endsOnForwardPressure": true
}
```

The four-part validator + five-milestone validator is roughly 60 lines of TypeScript; the post-SPP-no-new-entities check is ~25 lines.

---

## Appendix B — Brooks/STC compatibility map

The two frameworks are compatible. Rough alignment:

| Brooks milestone | STC beats it covers | Pct |
|------------------|---------------------|-----|
| Hook | Opening Image | 0–1% |
| (early Part 1) | Theme Stated, Setup, Save the Cat moment | 1–10% |
| FPP | Catalyst → Debate → Break Into 2 (the FPP often coincides with Break Into 2 in long-form prose) | 20–25% |
| (early Part 2) | B Story, opening of Fun and Games | 22–30% |
| Pinch 1 | inside Fun and Games | 37.5% |
| Midpoint | Midpoint | 50% |
| (mid Part 3) | Bad Guys Close In | 50–62.5% |
| Pinch 2 | inside Bad Guys Close In | 62.5% |
| (late Part 3) | All Is Lost | 75% |
| SPP | All Is Lost → Dark Night → Break Into 3 | 75–80% |
| Climactic Moment | Finale | 80–99% |
| (close) | Final Image | 99–100% |

A harness using both frameworks gets:
- Brooks's four-part dramatic-mission structure as the *coarse* lattice (orphan→wanderer→warrior→martyr).
- STC's 15 beats as the *fine-grained* scene-level prescription.
- Brooks's "no new entities post-SPP" + "expositional mission per scene" as the hardest checker rules.
- STC's transformation machine + six-things + B-story-intersection as the *internal-arc* checker rules.

Both frameworks agree on the percentages within ±5%; neither contradicts the other on the structural skeleton.
