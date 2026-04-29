# Yorke — *Into the Woods*: Harness Integration Report

**Source:** John Yorke, *Into the Woods: A Five-Act Journey Into Story* (Particular Books / Penguin, 2013). Supplemented by Yorke's BBC drama-department editorial materials (BBC Writersroom, EastEnders / Holby City script-editor practice) and the Story Engine workshop notes (post-2014).

**Scope:** Translate Yorke's framework into encodable constraints, prompts, and checkers for the four-phase harness pipeline (Concept → Planning → Drafting → Validation), with particular emphasis on the *fractal* structural claim — the single most actionable element of the book for beat-level prompting.

---

## 1. Framework Summary

Yorke is a long-form synthesist: *Into the Woods* knits together Aristotle, Hegelian dialectic, Freytag, Joseph Campbell, structuralism (Propp), Field/Truby/McKee, and three decades of BBC drama-script-editing practice into a single claim about story. That claim, stripped of ornament, is two-part:

1. **Story is the dramatisation of *change*.** A protagonist begins in one state, encounters a disruption that forces them to acquire knowledge they lack, and ends in a new state. The story's content is whatever change occurs; if no change occurs, there is no story. This is more permissive than Truby's moral-argument frame (a *change* need not be ethically loaded), but it is also stricter: every meaningful unit of story — act, scene, beat, exchange — must move someone from one state to another.
2. **Story is fractal.** The five-act shape (setup → inciting / new world → midpoint reversal → crisis / dark night → climax / resolution) recurs at every scale. The whole novel has it. Each act has it. Each scene has it. Each beat has it. Each *exchange of dialogue* often has it. The same shape — desire encountering an obstacle, escalation, climax, release — is the engine at every level.

Yorke's other recurring claim is the **want / need** distinction (consonant with Truby but framed differently): the protagonist *knows what they want* (the conscious goal) but *does not know what they need* (the truth that will heal them). The journey "into the woods" is the protagonist's encounter with the unconscious — the place where want is exposed as inadequate and need is discovered. The book's title is from Sondheim by way of Bettelheim by way of Jung; Yorke is genuinely committed to the fairy-tale frame.

The framework is more *philosophical* than mechanical. Yorke offers fewer hard rules than Truby and far fewer than Field. What he offers instead is one extremely powerful schema (the fractal) and one extremely powerful diagnostic (the change test). For an automated harness, those two pieces are exactly what is encodable.

---

## 2. Concept-Phase Prescriptions

### 2.1 Want vs Need

The harness Concept phase must emit, for the protagonist:

- **Want** — the conscious external goal. The thing the protagonist *thinks* will solve their problem. Visible, statable, often achievable.
- **Need** — the unconscious truth the protagonist must encounter to be made whole. Often the *opposite* of the want, or the want's hidden cost. Not statable by the protagonist at the start of the story.
- **Want-need contradiction** — a one-sentence statement of how achieving the want would *prevent* learning the need, and how learning the need will *transform* the want.

Yorke's central instruction: the protagonist must not know what they need. The story is the process of need-discovery. A protagonist who knows their need at chapter one has no journey.

This is a **lighter contract than Truby's seven steps** but it is the right minimum bar. A run that fails the want/need split fails Yorke's primary diagnostic: there is nothing to dramatise.

### 2.2 The "Woods" Crossing

The protagonist's central act is *entering the woods* — leaving a known world (where their want lives) for an unknown world (where their need waits). Every protagonist contract should specify:

- **Known world** — what does the protagonist know how to operate in?
- **Unknown world** — what world will the inciting event push them into?
- **Threshold** — the literal or metaphorical entry point.

This maps to Campbell's call/threshold but Yorke's emphasis is on *epistemic* unfamiliarity, not geographic. The unknown world is the world in which the protagonist's want-strategies fail.

### 2.3 Concept-Phase Prompt Additions

```
Emit:
  want: <one sentence, present-tense active voice, externally visible>
  need: <one sentence, the unconscious truth the protagonist must learn>
  want_need_contradiction: <one sentence linking them>
  known_world: <one paragraph>
  unknown_world: <one paragraph; what changes about the protagonist's environment>
  threshold_event: <the inciting event that crosses the threshold>
```

A Concept-phase checker validates: want and need are non-equivalent; want is external/visible; need is internal/epistemic; the contradiction sentence connects them rather than restating one of them.

---

## 3. Planning-Phase Prescriptions: The Five-Act Fractal

Yorke argues that the five-act structure (his renaming/refining of Freytag) is not a *style choice* but the underlying shape of all working stories — three-act structures are five-act stories with the act boundaries redrawn. The five acts:

| Act | Function | Approx. word share |
|-----|---------|-------------------|
| **Act 1 — Setup** | Establish the known world; protagonist's want surfaces; inciting event closes the act. | ~20% |
| **Act 2 — False hope / new world** | Protagonist enters the unknown world; first attempts to apply want-strategies; appears to be working. | ~25% |
| **Act 3 — Midpoint turn** | A reversal exposes the inadequacy of the want-strategy. The protagonist begins to glimpse the need. | ~15% |
| **Act 4 — Dark night** | The need is now visible but the protagonist resists it. Apparent defeat. Bottom of the arc. | ~25% |
| **Act 5 — Resolution** | Protagonist accepts the need (or fatally refuses it). Climax and new equilibrium. | ~15% |

For a 3-chapter short story (the harness's rapid-iteration form), Yorke's mapping compresses cleanly:

- Chapter 1: Acts 1 + 2 (setup + entering the woods).
- Chapter 2: Acts 3 + 4 (midpoint + dark night).
- Chapter 3: Act 5 (resolution).

For a 20–30-chapter novel, the five-act mapping is more flexible but the boundaries should fall near the percentage targets; the planner's `targetWords` field already supports this.

### 3.1 Planner Prompt Addition

The `planning-plotter` agent receives an addition:

```
Assign each chapter a `yorke_act` field in {1,2,3,4,5}.
The total word budget per act must approximate:
  act1: 20% ± 5%
  act2: 25% ± 5%
  act3: 15% ± 5%
  act4: 25% ± 5%
  act5: 15% ± 5%
The act 1 → 2 boundary must coincide with the inciting / threshold event.
The act 2 → 3 boundary must coincide with the first false-hope reversal.
The act 3 → 4 boundary must coincide with the moment the need becomes visible.
The act 4 → 5 boundary must coincide with the protagonist accepting (or refusing) the need.
```

A deterministic checker validates the word-share distribution; an LLM checker validates that the four act boundaries land at the correct functional moments.

### 3.2 The Fractal at the Act Level

Yorke's fractal claim: each *act* is itself a five-act structure. Within an act, there is a setup, a complication, a midpoint turn, a dark night, and a resolution. This is the planner's most demanding instruction: every act of the novel must independently exhibit the five-act shape, scaled down.

For a 25%-of-budget Act 2 (~25,000 words for a 100k novel), this means ~5,000 words of act-2-internal setup, ~6,250 of act-2-internal false hope, ~3,750 of act-2-internal midpoint, ~6,250 of act-2-internal dark night, ~3,750 of act-2-internal resolution — and the resolution of Act 2 *is* the inciting event of Act 3.

This is a real and load-bearing claim. The harness's per-chapter beat planner can encode it: each chapter, given its `yorke_act` and position-within-act, receives a sub-act assignment and the planner is constrained to give chapters within an act a rising-then-resolving arc.

### 3.3 The Act-Level Rhythm

Yorke's full-story act-level rhythm in plain English:

- **Act 1 — Setup.** Show the protagonist living in their want, ignorant of their need. Surface the want; surface the world's fragility. Close on the inciting event.
- **Act 2 — False hope.** The protagonist enters the unknown world, applies their existing tools, and *appears to succeed*. This is the most underwritten act in genre fiction. Yorke is emphatic: false hope, not flailing failure. The protagonist's want-strategies look adequate.
- **Act 3 — Turn.** A reversal at or near the geometric midpoint exposes the want as inadequate. The protagonist glimpses — but does not yet understand — the need. The tone darkens.
- **Act 4 — Dark night.** The protagonist now sees the need but resists it. Most apparent-defeat scenes live here. The lowest point of the arc; the protagonist often loses what they value most.
- **Act 5 — Resolution.** The protagonist accepts the need (transcendent ending) or refuses it (tragic ending). The final climax is the proof of the change.

---

## 4. Drafting-Phase Prescriptions: The Beat-Level Fractal

This is Yorke's highest-leverage gift to the harness. Every beat — the smallest planning unit, ~100–300 words — should exhibit the same five-act shape. The harness's beat-writer becomes a *micro-five-act-engine*.

### 4.1 The Beat-Internal Five-Phase Shape

Yorke's beat-level mapping (compressed from the act-level shape):

1. **Setup** — the beat's POV character enters the moment in a stable state with a small-scale want. Establish.
2. **Disruption / complication** — something destabilises. Could be external (entering character, environmental change) or internal (memory, realisation).
3. **Escalation** — the disruption produces a rising response. Tension increases.
4. **Climax** — the moment of maximum disruption; the small-scale want is met, refused, or transformed.
5. **Release / new equilibrium** — the beat closes on a transformed state. The beat's exit-state is *not* the beat's entry-state.

The exit state of beat N is the entry state of beat N+1; this gives the chapter's scene-weave its forward motion.

### 4.2 Beat-Prompt Template Addition

```
This beat's micro-arc:
  setup: <state at beat entry; the POV character's small-scale want at this moment>
  disruption: <what destabilises in the first ~25% of the beat>
  escalation: <how the disruption forces rising response>
  climax: <the beat's peak moment>
  release: <the exit state — how it differs from setup>

Constraint: the beat must end in a different emotional, informational, or
physical state than it began. A beat that ends in the same state it began
is a flat beat and must be redrafted.
```

This addition is small, low-cost, and directly actionable by the writer model. It composes well with the existing harness's beat brief (transition bridge, landing target, character snapshots).

### 4.3 The "Change" Test

Yorke's universal diagnostic, applicable at every scale: **between the start and end of this unit, what changed?** If the answer is "nothing," the unit is dead and must be cut or rewritten.

This applies recursively:
- For the whole novel: protagonist's relationship to need.
- For each act: protagonist's understanding of the world.
- For each chapter: the POV character's relationship to the chapter's central question.
- For each beat: the POV character's emotional/informational/physical state.
- For each exchange of dialogue: the relationship between the two speakers, or one speaker's belief about the other.

The harness can run a **change-test checker** at the beat level, which is the lowest cost and highest signal. An LLM checker reads the beat and answers two questions: (1) what was the entry state; (2) what was the exit state. If the answers are equivalent or trivially different, the beat fails.

### 4.4 Setting as Externalised Internal State

Yorke borrows from drama: the setting often *externalises* the protagonist's internal state at the beat level. A protagonist in a clarifying moment is in a clean, lit, ordered space; a protagonist in confusion is in fog, rain, crowds, dim light. This is not a mechanical rule but a tendency the drafting prompt can surface as guidance.

---

## 5. Validation Prescriptions

Yorke's validation surface is narrower than Truby's because his framework has fewer hard rules. The high-value checks:

### 5.1 The Change Test (per beat)

> Read this beat. State the POV character's entry state and exit state in one sentence each. If the two sentences are equivalent, this beat is flat. Flat beats must be redrafted.

This is the single highest-leverage Yorke check. It targets the most common drafting failure: beats that elaborate without progressing.

### 5.2 The Want-vs-Need Acceptance Check

> Read the final act. Does the protagonist's behaviour at the climax demonstrate that they now act on the *need*, not the *want*? Or — for tragic endings — does the protagonist's refusal of the need produce the cost the story has been arguing toward?

If the protagonist still acts on the original want at the climax, the journey didn't happen. (Equivalent to Truby's moral-argument-coherence check, framed differently.)

### 5.3 The Five-Act Boundary Check

> Validate that the four act boundaries land at:
>  - Act 1→2: an inciting event that crosses a known/unknown threshold.
>  - Act 2→3: a reversal that exposes the want as inadequate.
>  - Act 3→4: a moment the protagonist sees the need.
>  - Act 4→5: a moment the protagonist accepts or refuses the need.
> Boundaries that land elsewhere indicate a structural drift.

### 5.4 The Fractal Check (per scene/chapter)

> For this chapter, identify the chapter-internal setup, complication, midpoint turn, dark night, and resolution. If any of the five phases is missing or compressed below ~5% of chapter word budget, the chapter is structurally thin.

### 5.5 The Woods Check

> For the protagonist, was there a moment they entered a world in which their want-strategies stopped working? If no such moment exists, the story has not gone "into the woods" — it remains in the known world.

---

## 6. Character Web (Yorke's Lighter Form)

Yorke does not have Truby's full character-web apparatus. What he offers instead is the **opposing-force principle**: every major character should embody a value that contests the protagonist's. This is a thinner specification but encodable:

```typescript
type YorkeCharacter = {
  id: string;
  role: "protagonist" | "antagonist" | "shadow" | "mentor" |
        "trickster" | "threshold_guardian" | "ally";
  embodied_value: string;           // what value does this character incarnate?
  contests_protagonist_want: boolean;
  contests_protagonist_need: boolean;
};
```

Yorke's diagnostic: the antagonist contests the *want*; the shadow contests the *need*. The two roles can be the same character (rich antagonist) or split. A protagonist with no character contesting the *need* has no engine for change; the need will remain undiscovered.

A checker can validate that at least one character contests the need; a stronger check demands that some character *embody* the need (sometimes the love interest, sometimes a child, sometimes the antagonist).

This is genuinely thinner than Truby. The two frameworks are complementary: use Truby's web schema, populate it, then run Yorke's want/need-contestation check on top of it.

---

## 7. The Fractal as a Beat-Level Programmatic Surface

The fractal is the operational center of Yorke's contribution to the harness. Three concrete forms:

### 7.1 Beat-Phase Labelling

A beat is annotated with its *position in the chapter's micro-arc* and its *internal phase shape*. The planner emits, per beat:

```
beat: {
  index: 7,
  chapter_role: "midpoint_turn",   // where in the chapter's micro-arc
  internal_arc: {
    setup: "<entry state, POV's small-scale want>",
    disruption: "<destabilising event>",
    escalation: "<rising response>",
    climax: "<peak moment>",
    release: "<exit state>"
  }
}
```

### 7.2 Beat-Phase Detector

A post-draft LLM checker reads the prose of a beat and labels which phase shape is present. Possible labels: `full_arc`, `setup_only`, `escalation_no_climax`, `climax_no_release`, `flat`, `recursive` (a beat that itself contains multiple sub-arcs).

The planner is configured to reject `flat` beats; `setup_only` beats are acceptable only at chapter openings; `climax_no_release` is acceptable only at chapter cliffhangers.

### 7.3 Recursive Validation

For chapters: the same labels apply. A chapter labelled `flat` is rewritten or dropped. For acts: the same labels apply. For the whole novel: by construction, the novel must end in a `release` state — a final beat with no exit-state-change is the telltale of a story that hasn't ended.

---

## 8. Programmatic Levers

Concrete checks and prompt additions, ordered roughly by implementation cost (cheapest first):

1. **Want / need / contradiction emission** — Concept phase emits three required fields; deterministic non-empty + non-equivalent check.
2. **Known / unknown world emission** — Concept phase emits two paragraphs and a threshold event; deterministic non-empty check.
3. **Yorke-act labelling per chapter** — planner emits `yorke_act ∈ {1..5}`; deterministic word-share validation.
4. **Five-act boundary content check** — LLM checker validates each boundary chapter's content matches the boundary's function.
5. **Change-test per beat** — LLM checker outputs entry-state and exit-state per beat; deterministic equivalence check; flat beats fail.
6. **Beat-phase label** — LLM checker labels each beat with one of `{full_arc, setup_only, escalation_no_climax, climax_no_release, flat, recursive}`; planner rejects `flat`.
7. **Beat micro-arc emission in plan** — planner emits the five-phase scaffold per beat (setup/disruption/escalation/climax/release); deterministic non-empty check.
8. **Beat-prompt addition** — drafting prompt receives the micro-arc scaffold; writer must dramatise each phase.
9. **Fractal-at-act check** — LLM checker per act validates that the act itself exhibits a five-phase shape internally.
10. **Fractal-at-chapter check** — LLM checker per chapter validates the chapter exhibits a five-phase shape.
11. **Want-need acceptance check at climax** — LLM check on the final-act chapters: does the protagonist act on the need?
12. **Need-contestation check** — LLM check on the character roster: is there a character whose presence contests the need (not just the want)?
13. **Setting-as-state surfacing** — drafting prompt addition: surface the POV character's emotional state via setting at climax beats.
14. **Threshold-event check** — LLM check: does the inciting event move the protagonist from the known world into the unknown?
15. **Flat-chapter detector** — recursive change-test at chapter level; chapters whose entry- and exit-state are equivalent are flagged.

---

## 9. Limitations

Yorke's framework is *more philosophical than mechanical* — this is the primary caveat for harness integration:

- **Ambiguity at the boundary points.** Yorke's act boundaries are functional, not numeric — what counts as "the moment the need becomes visible" is a judgment call, and an LLM checker may rubber-stamp weak boundaries. The check needs explicit counter-example prompting and probably a strong evaluator.
- **The fractal is a *tendency*, not a *law*.** Yorke is sometimes more prescriptive than the underlying claim warrants — many beats in published fiction are deliberately partial-arc (transitional, tonal, atmospheric). Forcing every beat to have a full five-phase arc will produce uniformly busy prose. The right shape is: most beats have full arcs; some are deliberately partial; *no* beat is flat.
- **The change test is binary in a graded reality.** A beat that moves a character's understanding from 0.3 to 0.32 is "changed" by Yorke's test but functionally flat in a reader's experience. Operationalising the change test needs a *magnitude* dimension, which is harder to score reliably.
- **Want vs need overlaps with Truby's psychological/moral need.** Running both frameworks risks double-coverage and contradiction; treat Yorke's want/need as the *primary* diagnostic and Truby's split as a refinement when moral argument matters.
- **The framework assumes literary-dramatic shape.** LitRPG and other system-driven progression genres often fail Yorke's tests not because they are broken but because their primary engine is *system mastery*, not character change. The change test must be applied to *whatever the genre treats as its central axis* — for LitRPG, that may be the protagonist's relationship to the system, not their psychological state.
- **BBC origins show.** Many of Yorke's examples are British TV drama; the structural emphasis on midpoint reversals reflects a 60-minute-with-ad-breaks rhythm that is real but not universal. Long-form prose has more degrees of freedom.
- **Composability with the voice LoRA.** The Salvatore voice LoRA's beats often run shorter than Yorke's full five-phase shape would demand; the corpus contains many transitional beats. Forcing the full fractal may collide with the voice. Recommend per-genre tuning of the fractal-strictness threshold.

---

## 10. Citations

- Yorke, John. *Into the Woods: A Five-Act Journey Into Story*. Particular Books / Penguin, 2013. ISBN 978-1846146930.
- Yorke, John. *Story Engine* (online course / workshop materials, Penguin Random House, 2018–).
- BBC Writersroom — script-editor guidance documents (2010–2020) drawing on Yorke's editorial framework.
- Freytag, Gustav. *Die Technik des Dramas* (1863) — the source of the five-act pyramid Yorke reframes.
- Bettelheim, Bruno. *The Uses of Enchantment* (1976) — Yorke's principal source for the "into the woods" metaphor.
- Joseph Campbell, *The Hero with a Thousand Faces* (1949) — Yorke positions his framework as a synthesis of Campbell's monomyth with Freytag's structural pyramid.
- Vladimir Propp, *Morphology of the Folktale* (1928) — referenced as the structuralist precedent for the fractal claim.
- Robert McKee, *Story* (1997) — the closest contemporary parallel; Yorke acknowledges McKee while arguing for five acts over McKee's three.

---

## Summary Paragraph

Yorke's *Into the Woods* gives the harness one philosophical contract (every story is the dramatisation of *change*, framed as the protagonist's journey from a conscious *want* to an unconscious *need*) and one extraordinarily encodable structural claim (story is *fractal* — the five-act shape of setup → false hope → midpoint turn → dark night → resolution recurs at every scale, including the beat). The Concept phase emits want/need/contradiction and known/unknown worlds; the Planning phase labels each chapter with a Yorke-act and validates word-share distribution and boundary functionality; the Drafting phase receives a beat-level micro-arc scaffold (setup/disruption/escalation/climax/release) that the writer must dramatise, and a post-draft phase-detector labels each beat — flat beats are rejected. The Validation phase's highest-leverage check is the per-beat **change test** ("what is the entry state, what is the exit state, are they equivalent?"), which targets the most common drafting failure mode and is encodable as a single LLM call per beat. Limitations: the framework is more philosophical than mechanical, the fractal is a tendency rather than a law, and the change test needs a magnitude dimension to avoid binary noise on graded transitions; per-genre strictness tuning is required, especially for LitRPG and for voice-LoRA-routed runs whose corpus tolerates partial-arc beats.
