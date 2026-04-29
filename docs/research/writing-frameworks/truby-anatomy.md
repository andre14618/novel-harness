# Truby — *The Anatomy of Story*: Harness Integration Report

**Source:** John Truby, *The Anatomy of Story: 22 Steps to Becoming a Master Storyteller* (Faber & Faber, 2007). Supplemented by Truby's Writers Studio class materials (genre-class lectures: Crime, Detective, Action, Myth, Memoir, Love, Comedy, Fantasy, Science Fiction, Horror, Thriller).

**Scope:** Translate Truby's framework into encodable constraints, prompts, and checkers for the four-phase harness pipeline (Concept → Planning → Drafting → Validation).

---

## 1. Framework Summary

Truby's central thesis is that story is a *moral argument* dramatised through a hero's pursuit of a **desire** in the face of an **opponent** who is the best possible challenger to the hero's deepest weakness. Plot, character, theme, and structure are not separable; they are facets of one organic system. The 22 steps are not a beat sheet imposed from outside (Truby is explicit and dismissive about the Field/Snyder paradigm) — they are the structural skeleton that emerges from a properly designed character, in the order a coherent narrative must surface them.

Three pillars carry the framework:

1. **Premise as designing principle.** A premise must compress hero, weakness, opponent, desire, and the moral cost of victory into a single sentence — and that sentence must imply *only this story*, not a generic genre exercise. Truby's "designing principle" is a metaphor or organising image (e.g. "a man becomes king of his country only to lose his wife and children" — *The Godfather*) that tells you which scenes belong and which do not.
2. **The character web.** Heroes are not designed alone. They are designed *in opposition* — every major character is a variation on the same theme, exposing a different facet of the moral argument. The opponent shares the hero's deepest weakness, twisted in another direction. Allies, fake-allies, and sub-opponents form a graph in which every edge is a moral comparison.
3. **The moral argument.** Theme is not a slogan; it is the proof that emerges when the hero's *immoral actions* (taken in service of desire) cause damage, which forces a **self-revelation** that resolves the hero's psychological *and* moral need. The story is the argument; the structure is the proof.

The 22 steps are the dramatised proof in serial order. The seven *key* steps (weakness/need, desire, opponent, plan, battle, self-revelation, new equilibrium) are the load-bearing subset; the remaining 15 are amplifiers and connectives.

---

## 2. Concept-Phase Prescriptions

The Concept phase (worldbuilding, character, plotter agents) is where Truby's framework yields the most leverage. The harness currently produces premise/world/characters/plot in parallel; Truby's argument is that these are not parallel — they are fields of one design problem and must be *iterated jointly*.

### 2.1 The Seven Key Story Steps (must be set during Concept)

Every concept must explicitly emit these seven slots before planning begins:

| # | Step | Definition | Concept-agent prompt addition |
|---|------|-----------|-------------------------------|
| 1 | **Weakness / Need** | A moral and psychological flaw that is *killing the hero's life* before the story starts. Need = what they must learn or change to live a better life. | "State the protagonist's psychological need (self-directed, e.g. 'cannot trust anyone') AND moral need (other-directed, e.g. 'manipulates people who depend on them'). The two must connect — the psychological flaw must produce the moral failing." |
| 2 | **Desire** | A specific external goal the hero pursues. Concrete, visible, achievable or refusable. | "State the desire as a single sentence in active voice with a measurable end-state. 'Wants peace' fails. 'Wants to recover the stolen relic before the equinox' passes." |
| 3 | **Opponent** | The character best positioned to *prevent* the hero from achieving the desire AND to *expose* the hero's weakness. They want the same goal, or a goal that contradicts it at the same site. | "The opponent must want the same thing as the hero (or directly block it). They must share a deep similarity with the hero — a mirrored weakness or value. Generic villains fail this check." |
| 4 | **Plan** | The hero's strategy. Often deceptive (toward opponent, audience, or self). | "State the hero's initial plan and what makes it morally compromised. The plan must require the hero to act on their weakness." |
| 5 | **Battle** | Final confrontation; the conflict comes to a head. | "Describe the final battle — physical, verbal, or psychological — in one paragraph. It must occur at the site of the desire and force the weakness into the open." |
| 6 | **Self-revelation** | The hero sees their weakness and the moral cost. Psychological self-revelation = "I have been X." Moral self-revelation = "I have done X to others." | "State both revelations. The protagonist must *name* the weakness. Implicit revelations fail." |
| 7 | **New equilibrium** | After self-revelation, the hero settles into a new moral state. Higher (transcendent) or lower (tragic). | "Describe the post-story state of the hero in one sentence and label it ascending / descending / static." |

These seven slots are emitted by an extended `plotter` agent and validated by a Concept-phase checker before the run is allowed to proceed to Planning.

### 2.2 Moral Argument

The premise must declare a **moral argument** — a sentence of the form:

> "If you live by [false value], you will [cost]. To live well, you must [true value]."

The Concept phase emits this string explicitly. Every later check (chapter-plan-checker, validation, beat-adherence) can reference the moral argument as a touchstone. Without it, the story has no thematic spine and Truby's checks degenerate to plot mechanics.

### 2.3 Character Web

Truby's character web is the load-bearing innovation that distinguishes him from Field/Snyder/McKee. Each major character is designed as a **moral variation** on the protagonist. The web specifies four opponent types plus alliance types:

- **Main opponent** — best opponent for *this* hero, sharing the deepest weakness.
- **Sub-opponents** (1–3) — minor antagonists who oppose facets of the desire.
- **Fake-ally opponent** — appears to help, secretly opposes. Often the most thematically rich character.
- **Fake-opponent ally** — appears hostile, secretly helps.
- **Ally** — true ally; often a foil who lacks the protagonist's weakness or shares it less acutely.
- **Audience surrogate / sub-protagonist** — perceives the hero's flaws.

Each node carries: `name`, `moral_weakness`, `psychological_weakness`, `value_held`, `value_opposed`, `desire_relationship` (same / blocking / orthogonal). Each edge carries: `relation_type ∈ {opposes, allies, fake-allies, fake-opposes}`, `shared_weakness`, `value_contrast`.

The Concept phase emits this web as JSON. A web without a fake-ally-opponent is acceptable but flagged. A web in which the opponent does *not* share a weakness with the hero fails the check — that is Truby's most-violated rule and the root cause of the "generic villain" failure mode.

### 2.4 Moral vs Psychological Need

Every protagonist must have *both*:

- **Psychological need** — internal, hurts only the hero (e.g. "cannot believe they deserve love").
- **Moral need** — external, hurts other people (e.g. "uses friends as instruments and discards them").

The two must causally connect: the psychological wound *produces* the moral failing. A hero with only psychological need is therapeutic, not dramatic — the moral argument has nothing to argue. The Concept phase must emit both fields and a one-sentence connection statement; a checker validates the causal link via LLM call.

---

## 3. Planning-Phase Prescriptions: The 22 Steps

Truby's 22 steps are the order in which a coherent story surfaces information. They are emitted by the Planning phase as a **structural index** that maps to specific chapters or beats. The harness's `planning-plotter` already emits chapter skeletons; a Truby-aware planner adds a `truby_step` field per chapter (or per beat for short stories).

The 22 steps in canonical order:

1. **Self-revelation, need, and desire** (often opens the story implicitly via what the hero *lacks*).
2. **Ghost and story world** — the past trauma (the "ghost") that produced the weakness; the world that reinforces it.
3. **Weakness and need** — dramatised, not stated. We see the hero failing morally and psychologically.
4. **Inciting event** — a specific event that triggers the desire. Distinct from a generic "call to adventure"; it is the *first place the desire becomes possible*.
5. **Desire** — the hero commits to a specific external goal.
6. **Ally or allies** — the hero acquires help.
7. **Opponent and/or mystery** — the opponent appears or is foreshadowed; in mystery genres, the opponent is hidden and the *mystery* takes this slot.
8. **Fake-ally opponent** — introduced. Often signals theme.
9. **First revelation and decision: changed desire and motive** — new information forces the hero to update goal or method.
10. **Plan** — the hero forms a strategy.
11. **Opponent's plan and main counterattack** — the opponent reveals or executes their counter-strategy.
12. **Drive** — the long middle in which the hero pursues the plan; escalating obstacles.
13. **Attack by ally** — the closest ally challenges the hero's morality. Often the moral pivot of the story.
14. **Apparent defeat** — the hero appears to lose.
15. **Second revelation and decision: obsessive drive, changed desire and motive** — new information; the hero is now obsessive, often immoral.
16. **Audience revelation** — the audience learns something the hero does not (typical of fake-ally exposure).
17. **Third revelation and decision** — final piece of the puzzle.
18. **Gate, gauntlet, visit to death** — the hero crosses a threshold of no return; often physically dangerous.
19. **Battle** — the final confrontation.
20. **Self-revelation** — psychological + moral.
21. **Moral decision** — the hero acts on the revelation; chooses a moral course.
22. **New equilibrium** — closing state.

**Planning-phase prescription:** the planner is constrained to emit a chapter-to-step mapping such that:

- Steps 1–5 land within Act I (~25% of the novel's word budget).
- Steps 6–12 fill Act II's first half.
- Steps 13–17 occupy the middle's pivot and second half.
- Steps 18–22 land in the final act.
- Every step appears at least once. Steps may be combined within a single chapter, but no step may be skipped.
- Step 13 (Attack by ally) is the most-skipped step in genre fiction; the planner is instructed to emit it explicitly even when uncomfortable.

A `truby-step-coverage` checker (deterministic) validates that all 22 step IDs appear in the chapter plan. A separate LLM checker validates that the step's *content* matches its definition (e.g. step 4's chapter actually contains an inciting event).

---

## 4. Drafting-Phase Prescriptions: Scene Weave

Truby's most demanding craft instruction is **scene weave**: every scene should advance multiple of the 22 steps simultaneously, and every scene should advance multiple character arcs simultaneously. A scene that does only one thing is a scene Truby would cut.

### 4.1 Scene-Weave Beat Prompt Addition

Each beat prompt receives an addition listing the Truby-step IDs the beat is expected to advance, plus the character-web edges it is expected to activate:

```
This beat advances Truby steps: [13 (attack by ally), 9 (first revelation)].
Character-web edges activated: [protagonist↔ally (alliance test), protagonist↔fake-ally-opponent (foreshadow exposure)].
The beat must surface the moral argument by showing the protagonist's weakness causing harm to the ally.
```

The drafting agent then writes prose that — at minimum — dramatises the listed steps and edges. A post-draft checker re-reads the beat and confirms each listed step is present.

### 4.2 The Seven-Step Scene Structure

Truby provides a scene-internal seven-step structure that nests inside the 22 macro steps:

1. **Scene desire** — what does the POV character want *in this scene*?
2. **Endpoint** — what concrete event would end this scene?
3. **Opponent in scene** — who blocks the desire here? (May not be the main opponent.)
4. **Plan in scene** — strategy for this scene.
5. **Conflict** — escalating exchange.
6. **Turn / outcome** — the desire is met, refused, or transformed.
7. **Self-revelation in scene** (optional) — micro-realisation that compounds toward the macro self-revelation.

This is congruent with Yorke's fractal claim (see companion report) but Truby specifies the *content* of each beat, not just its shape. The harness's `beat-writer` prompt receives this seven-step scaffold per beat; a deterministic check validates that the planner emitted scene-desire and scene-endpoint fields.

### 4.3 Moral-Argument Surface Density

Truby's drafting instruction: the moral argument should surface through *action*, not dialogue, in the majority of scenes — but it should surface explicitly (in dialogue or interiority) at least at three pivot points: the inciting event, the attack by ally (step 13), and the self-revelation (step 20). A drafting-phase prompt addition forces the writer to consult the moral-argument string and decide whether the current beat is one of the three explicit-surface points.

---

## 5. Validation Prescriptions

Truby's validation surface is rich because his framework is deeply constrainted. The most productive checks:

### 5.1 Self-Revelation Check

The most-failed Truby step in genre fiction. Validation prescription:

> Find the scene labelled `truby_step=20`. Read it. Does the protagonist *name* their psychological weakness? Does the protagonist *name* the harm caused to others by that weakness? If either is implicit-only, fail.

This is encodable as a single LLM checker call. It is high-value because implicit self-revelation is the single most common reason a draft "feels hollow" without the reader being able to articulate why.

### 5.2 Moral Argument Coherence Check

> Read the premise's moral-argument string. Read the final-beat self-revelation and new-equilibrium scenes. Does the hero's final state *prove* the moral argument? If the argument was "mercy outweighs vengeance," does the hero end the story acting mercifully under conditions that previously triggered vengeance? If not, the moral argument is decorative, not load-bearing.

### 5.3 Best-Opponent Check

> Read the protagonist's psychological weakness. Read the opponent's character sheet. Does the opponent's existence *force* the protagonist to confront this specific weakness? Is there any plausible opponent who would force this confrontation *more* sharply? If yes, the current opponent is suboptimal.

This check often returns "the current opponent is generic." Truby's claim is that this is the most diagnostic single failure mode in amateur fiction.

### 5.4 Character-Web Density Check

> For each major character, list the moral weakness. Compare to protagonist's moral weakness. Each major character's weakness should be a *variation* on the protagonist's, not an unrelated flaw. A web of unrelated flaws indicates characters were designed independently rather than as moral commentary on each other.

### 5.5 Drive Without Decision Check (step 12)

> The drive section (middle) should contain at least two "revelation and decision" moments (steps 9, 15) that *change* the protagonist's plan or motive. A flat drive without decisions is the most common middle-sag failure.

---

## 6. The Character Web as a Programmatic Structure

The character web is the most directly encodable element of Truby's framework. Sketch:

```typescript
type MoralAxis = {
  weakness: string;        // "manipulates dependents"
  psychological: string;   // "cannot believe self deserves love"
  value_held: string;      // "control"
  value_opposed: string;   // "surrender"
};

type CharacterNode = {
  id: string;
  name: string;
  role: "protagonist" | "main_opponent" | "sub_opponent" |
        "fake_ally_opponent" | "fake_opponent_ally" |
        "ally" | "audience_surrogate" | "minor";
  moral: MoralAxis;
  desire_relation: "same_goal" | "blocking_goal" |
                   "orthogonal_goal" | "no_goal";
};

type WebEdge = {
  source: string; target: string;
  type: "opposes" | "allies" | "fake_allies" | "fake_opposes";
  shared_weakness?: string;  // The Truby-mandated similarity for opponents
  value_contrast?: string;   // What this edge dramatises about the moral argument
};

type CharacterWeb = {
  protagonist_id: string;
  moral_argument: string;
  nodes: CharacterNode[];
  edges: WebEdge[];
};
```

### 6.1 Programmatic Web Validators

These can run as deterministic + LLM hybrid checks at the end of the Concept phase:

- **Web completeness** — protagonist + ≥1 main opponent + ≥1 ally exist (deterministic).
- **Opponent-similarity** — every opponent edge has a non-empty `shared_weakness`; LLM call validates the shared weakness is genuine and not pasted boilerplate.
- **Web-as-variation** — for each major node, an LLM checker reads protagonist.moral.weakness and node.moral.weakness and answers: "Is the latter a thematic variation of the former?" Threshold: ≥80% of major nodes must pass.
- **Fake-ally density** — at least one fake-ally-opponent OR fake-opponent-ally exists. Soft check; warning only.
- **Value triangulation** — the union of `value_held` and `value_opposed` across the web should populate both poles of the moral argument's central opposition. If every character holds the same value, the web is monochromatic.

### 6.2 Web-as-Graph Reasoning

Once the web is in this form, downstream agents can reason about it:

- The planner can ensure each major character is *active* in some chapter (no orphan nodes).
- The drafting beat-context assembler can include web edges relevant to the current scene (e.g. when protagonist and fake-ally are alone, surface their `shared_weakness` and the upcoming exposure).
- The chapter-plan-checker can verify that the "attack by ally" step (Truby step 13) traverses an actual `ally` edge in the graph.

This is a far richer context-engineering surface than the current free-text character snapshots. It is also straightforward to extract from existing JSON outputs with a one-shot LLM transform; a migration is feasible without retraining.

---

## 7. Programmatic Levers

Concrete checks and prompt additions, ordered roughly by implementation cost (cheapest first):

1. **Seven-key-step slot enforcement** — Concept phase emits seven required JSON fields; deterministic non-empty check.
2. **Moral argument string** — Concept phase emits one sentence; deterministic non-empty check.
3. **Psychological-vs-moral need split** — Concept phase emits both; LLM check validates causal connection.
4. **22-step chapter coverage** — Planner emits `truby_step` per chapter; deterministic coverage check across [1..22].
5. **Step-content match** — LLM checker per chapter validates the chapter's content matches the assigned step's definition.
6. **Best-opponent check** — LLM check at end of Concept: is the opponent the *best* opponent for this protagonist's specific weakness?
7. **Self-revelation explicit-naming check** — LLM check on the step-20 chapter: does the protagonist name the weakness in dialogue or interiority?
8. **Moral-argument coherence check** — LLM check at end of Validation: does the new equilibrium prove the moral argument?
9. **Character-web schema** — Concept phase emits the web JSON; deterministic schema validation.
10. **Opponent-similarity check** — LLM check per opponent edge: validate `shared_weakness` is real and load-bearing.
11. **Web-monochromatic warning** — deterministic check on `value_held` distribution; warn if entropy < threshold.
12. **Scene-weave beat instruction** — beat prompts list the Truby steps and web edges they should advance.
13. **Scene-internal seven-step scaffold** — beat plan emits scene-desire and scene-endpoint fields; deterministic non-empty check.
14. **Attack-by-ally enforcement** — planner is required to emit a chapter labelled `truby_step=13`; deterministic check.
15. **Drive-decision density** — middle chapters must contain ≥2 revelation-decision steps (steps 9, 15); deterministic check on planner output.
16. **Ghost-and-world surfacing** — Concept phase emits a "ghost" (past trauma) field; planner must reference it in step 2 chapter; LLM check on chapter content.
17. **Three explicit moral-argument surface points** — drafting prompt instruction at steps 4, 13, 20 forces explicit theme surface; validation re-checks.

---

## 8. Limitations

Truby's framework is dense and arguably *over-specified for genre fiction*. Several caveats apply when integrating it into a harness aimed at fantasy / LitRPG (per the project's stated genre focus):

- **Genre fiction often runs lighter on moral argument.** A LitRPG novel whose primary appeal is system-progression catharsis may legitimately have a thin Truby-style moral argument. Imposing Truby's full check surface on such a novel will produce false-failure noise. The right shape is *graded enforcement* — Truby checks run as advisory/scoring rather than blocking on genres marked `low_moral_argument: true`.
- **The 22 steps are not all dramatic.** Some (e.g. step 16, audience revelation) are technical positioning steps that may be absorbed into other steps in shorter forms. For 3-chapter short stories, a reduced 12-step variant is more honest than forcing all 22.
- **Truby's fake-ally rule is genre-specific.** It is load-bearing in crime, thriller, and detective; less so in romance and fantasy adventure. The web validator should treat fake-ally density as a soft constraint per-genre.
- **The "best opponent" check is hard to evaluate automatically.** It requires the checker to imagine *better* opponents and compare — an open-ended reasoning task that LLM checkers may rubber-stamp. Empirically, this check needs a strong evaluator (DeepSeek V3.2 base or Sonnet) and explicit counter-example prompting.
- **Cross-talk with voice LoRA.** The Salvatore voice LoRA is trained on Drizzt-era prose, which often runs *thin* on Truby's moral self-revelation explicitness. Forcing explicit self-revelation may collide with the voice's preference for understatement. A/B testing required before treating the self-revelation check as blocking on voice-LoRA-routed runs.
- **The framework is high-touch.** Truby's value is highest when applied during *concept iteration with a human author*, not during fully autonomous drafting. The harness's `plan-assist` human gate is the natural integration point; forcing Truby into auto-mode may produce technically-conformant but lifeless outputs.

---

## 9. Citations

- Truby, John. *The Anatomy of Story: 22 Steps to Becoming a Master Storyteller*. Faber & Faber, 2007. ISBN 978-0865479517.
- Truby, John. *The Anatomy of Genres: How Story Forms Explain the Way the World Works*. Picador, 2022. (Companion volume; expands the genre-class material.)
- Truby Writers Studio. Genre class lecture transcripts (Crime, Detective, Action, Myth, Memoir, Love, Comedy, Fantasy, Science Fiction, Horror, Thriller). 1990s–2020s; reference for character-web examples.
- BBC Writersroom — character-web exercises drawing on Truby (post-2015 editorial materials).
- Robert McKee, *Story* (1997) — adjacent framework; useful contrast for the "controlling idea" (analogous to Truby's moral argument) but lacks the character-web rigour.
- Christopher Vogler, *The Writer's Journey* (3rd ed., 2007) — Campbellian alternative; Truby is explicitly post-Vogler and treats Vogler's monomyth as one possible 22-step trace, not the universal form.

---

## Summary Paragraph

Truby's *Anatomy of Story* gives the harness its richest concept-phase scaffolding: a seven-key-step protagonist contract (weakness/need, desire, opponent, plan, battle, self-revelation, new equilibrium), an explicit moral argument string, a split psychological-vs-moral need, and — most distinctively — a fully encodable **character web** in which every major character is a moral variation on the protagonist and every opponent shares the protagonist's deep weakness. The 22 steps map cleanly onto chapter-level planning constraints with a coverage-and-content checker pair; scene-weave drafting instructions give per-beat step IDs and character-web edges to activate. The highest-value validation checks are the self-revelation explicit-naming check, the best-opponent check, and the moral-argument coherence check between premise and new equilibrium. Limitations: the framework is over-specified for genre-driven LitRPG/fantasy and works best as graded scoring rather than blocking gates, especially under a voice LoRA whose corpus prefers understatement.
