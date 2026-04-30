# Writing Framework Synthesis — Principles & Programmatic Levers

*Synthesis of 15 deep-research reports on novel-craft frameworks (Save the Cat, Brooks, Coyne, McKee, Snowflake, Lisle, Truby, Yorke, Swain, Browne-King, Sanderson, Weiland, Harmon, Maass, LitRPG/Progression Fantasy), evaluated against the novel-harness's four-phase pipeline (concept → planning → drafting → validation) with commercial focus on fantasy + LitRPG.*

---

## 1. Executive summary

Across the 15 frameworks, ~70% of all load-bearing structural rules collapse into a small handful of cross-framework convergences: every story unit must contain *change* (value shift / gap / disaster / disruption); every character arc runs on an *internal contradiction* (lie/truth, want/need, weakness/desire); structural beats *land at predictable percentages* and the climax answers the opening's question; *promises must be paid off* in proportion to how loudly they were promised; and *iterative-expansion conservation* is what keeps a long plan from drifting from its premise. Wrapped around these convergences are framework-specific contributions: McKee's "Gap" (expectation vs. result at every beat), Truby's character web (every major character is a moral variation on the protagonist), Sanderson's MICE-as-balanced-parens, Coyne's value-charge formalism, Maass's microtension (emotional contradiction inside the POV character at line scale), LitRPG's PromiseRegistry + system-consistency, and Browne-King's ~30 deterministic prose lints.

**The five highest-leverage findings:**

1. **Maass microtension detector** is the single most encodable prose-quality lever currently absent — emotional contradiction inside POV per beat, $0.04/novel, routes to the existing quality-redraft gate.
2. **`valueIn`/`valueOut`/`lifeValue` per beat** (Coyne + McKee + Yorke + Truby + Swain converge) — the universal "did this beat change something?" check, deterministic + one cheap LLM call, replaces ~5 separate convergent checks.
3. **PromiseRegistry as a first-class table** (Sanderson + Lisle + LitRPG + Coyne genre obligations) — concept-phase extraction + end-of-arc payoff verification, catches dangling setups and deus ex machina simultaneously.
4. **Snowflake-style upstream concept expansion** (logline → paragraph → page → skeleton with conservation invariants) — currently entirely missing; the harness jumps straight to step 6/8 territory and cannot enforce disaster conservation between concept and planning.
5. **Swain `G C+ D R Dl Dc` beat-tag schema + MRU lint** — beat-shape tagging at planner time + paragraph-level motivation/reaction-order lint. Catches the dominant LLM-drafting failure mode (telegraphing, dropped reactions, no-disaster scenes) with regex + 1 small-LLM call.

**Where the harness already aligns:** beat-level context engineering, planner-declared `establishedFacts`/`characterStateChanges`/`knowledgeChanges` (Snowflake/Lisle "what changes"), per-genre routing via `WRITER_GENRE_PACKS`, the quality-redraft gate (which already has the right shape for plugging in microtension and value-shift detectors), the chapter-plan-checker emitting beat-indexed deviations.

**Largest gaps:** no upstream concept expansion (Snowflake/Lisle/Brooks/STC/Truby all converge on this — premise/concept/logline/disaster-manifest as load-bearing artifacts); no beat-level value-shift or gap check (Coyne+McKee+Yorke+Truby converge); no PromiseRegistry (Sanderson+Lisle+LitRPG converge); no character-web schema (Truby unique, Yorke partial); no Sanderson MICE thread tracking; no Lie/Truth/Want/Need on protagonist (Weiland unique within the convergence cluster); no antagonist parallel-goal annotation (McKee+Truby converge); ~24 lint-pattern expansions available from Browne-King.

---

## 2. Cross-framework convergences (the load-bearing principles)

These are the principles where 3+ frameworks independently arrive at the same idea. High confidence by convergence. Each section names the principle, cites which frameworks express it, the encoded shape, and where it lands in the pipeline.

### 2.1 Every story unit must contain *change*

**Frameworks:** Yorke (the change test, fractal at every scale), Coyne (value-charge shift, "if value doesn't shift, you have a description not a scene"), McKee (the gap; scene as value shift; "no gap = no beat"), Swain (Disaster as the obligatory closing of every Scene; "scene that ends better is not a scene"), Truby (every scene must surface step-progression OR character-web edge activation; flat scenes get cut), Lisle (the "but/therefore" test; "and then" sequences are not plots; "every card's *what changes* must motivate next card's *what's at stake*"), Sanderson (every scene must accomplish ≥2 of {advance plot, develop character, develop world, set up payoff}), Weiland (Scene/Sequel both end on commitment-events; no mid-stride termination), Maass (tension on every page; if POV feels nothing about something on this page, scene is broken), Snowflake (no more than 3 consecutive scenes without disaster/reversal/revelation).

This is the single most universally agreed principle in the corpus.

**Encoded shape:**
- Schema: per beat — `valueIn: string`, `valueOut: string`, `lifeValue: enum`, `polarity: enum {+, -, ++, --, mixed}`
- Schema: per beat — `povExpectation: string`, `actualOutcome: string` (McKee gap)
- Checker: deterministic `valueIn != valueOut` + cheap LLM "are these semantically distinct positions on lifeValue axis?"
- Checker: cheap LLM gap detector returning `{no-gap | small | medium | large}`; `no-gap` routes to quality-redraft

**Pipeline placement:** Planning emits `valueIn`/`valueOut`/`lifeValue` in chapterBeatsSchema. Drafting receives them as constraint in beat prompt. Validation runs the dual check (Coyne + McKee) per beat.

**Important caveat (Yorke, Coyne, Swain converge):** scope this check to scene-group granularity, not every individual beat. Transitional/connective beats legitimately don't change. Use `commandmentRole: bridge` (Coyne tag) to suppress.

### 2.2 Promise / progress / payoff (the contract)

**Frameworks:** Sanderson (explicit; macro/meso/micro scales), STC (setup/payoff "Six Things That Need Fixing"), Brooks (hook → FPP → SPP causality; "no new info post-SPP"), Coyne (genre obligatory scenes as promises; controlling idea as the master payoff), McKee (controlling idea VALUE prevails because CAUSE; climax must dramatize), Maass ("first-and-last-line audit"; first paragraph generates a question), LitRPG (promise registry literalized — "I will reach Gold" / "I will learn fireball"; reader-tracked progression as constant-cadence proof of progress), Snowflake (3-disasters + ending; disaster conservation), Lisle (bright-light protection; causal chain), Yorke (want/need: want is conscious promise made to self; the climax pays off whether want or need wins).

**Encoded shape:** A first-class `PromiseRegistry` table:

```
table promise {
  id, novel_id,
  promise_type ∈ {genre, tone, character_arc, conflict, magic_capability,
                  romance, mystery_question, world_question, stakes,
                  skill_acquisition, tier_advance, antagonist_defeat},
  introduced_in beat_id,
  introduced_pct float,
  expected_payoff_pct float,
  text, weight ∈ {major, minor, flavor},
  status ∈ {open, progressing, paid_off, broken, retracted}
}

table progress_event { promise_id, beat_id, event_type, delta }
table payoff { promise_id, beat_id, satisfaction ∈ {full, partial, subverted}, scale_match }
```

**Checker rules:**
- Every `major` promise has ≥1 progress event in the middle and a `paid_off` payoff before resolution.
- Promise weight matches payoff scale (major promise paid off in two sentences = `payoff_undersized` violation).
- Any promise still `open` at 95% completion = `dangling_promise`.
- Any payoff event without an earlier matching promise = `unset_up_payoff` (catches deus ex machina = Sanderson's First Law violation).

**Pipeline placement:** Concept phase extracts initial promises (genre/tone/character-arc/conflict). Planning emits per-chapter `promises_made[]` + `payoffs_delivered[]`. Validation runs the registry check at end of arc.

### 2.3 Character must have an internal contradiction

**Frameworks:** Weiland (Lie / Truth / Want / Need — the canonical formal version), Truby (psychological need vs moral need, must causally connect; weakness/desire), Yorke (want vs need; "protagonist must not know what they need"), Harmon (positions 2/6 mirror — want stated at 2 returns with cost at 6), STC (Wound / Want / Need — the Transformation Machine), Maass (productive contradictions; characters built from a quality and its apparent opposite), McKee (conscious vs unconscious desire; antagonism on multiple axes), Sanderson (lie/truth/want/need — borrows from Weiland explicitly).

**Eight frameworks converge on this; it is the densest convergence in the corpus.**

**Encoded shape (composite):**

```typescript
type CharacterArc = {
  arc_type: 'positive' | 'negative' | 'flat' | 'disillusionment' | 'corruption',
  // Weiland
  lie_text: string,           // false belief at start
  truth_text: string,         // corrected belief at climax
  ghost_text?: string,        // backstory wound that installed lie (Weiland/Truby)
  // McKee/Yorke
  want_text: string,          // external conscious goal, driven by lie
  need_text: string,          // internal correction truth provides
  // Truby split
  psychological_need: string, // hurts only the hero
  moral_need: string,         // hurts other people
  causal_link: string,        // the one-sentence statement linking psych → moral
  // Maass
  productive_contradictions: string[],  // ≥1; each plausibly testable in scenes
  signature_gesture: string,  // specific, not "shrugs"
  // STC
  wound_shard: string,        // sharp-edged absorbed wrong from past
};
```

**Checker rules:**
- Want must be on-page by the First Plot Point (~25%, Weiland/Brooks).
- Need must be hinted by the Midpoint (~50%, Weiland/Yorke).
- Choice between want and need must occur at Third Plot Point or Climactic Moment (Weiland).
- At Self-Revelation beat (Truby step 20), the protagonist must explicitly *name* the weakness.
- Climax must dramatize the protagonist acting on the *need* (or refusing it for tragic arcs).
- Each productive_contradiction must surface in ≥1 scene (Maass contradiction inventory).

**Pipeline placement:** Concept-phase exit gate (mandatory). Planner places ghost-staging beats (hint/trigger/reveal/confront/resolve at structural milestones). Per-beat `arc_state ∈ {lie_dominant, lie_challenged, truth_glimpsed, truth_resisted, truth_chosen, truth_embraced, truth_rejected}`. Validation runs trajectory check.

### 2.4 Structural beats land at predictable percentages

**Frameworks:** STC (15 beats at fixed % positions, Brody's calculator), Brooks (FPP @ 20-25%, Pinch1 @ 37.5%, Midpoint @ 50%, Pinch2 @ 62.5%, SPP @ 75%, Climactic Moment @ 95-100%), Weiland (10 beats at fixed % positions, ±3% on the four structural ones), Yorke (five-act @ 20/25/15/25/15%, fractal at every scale), Sanderson (resists fixed percentages but acknowledges three-act and STC work; uses promise/progress/payoff as the spine), Snowflake (3 disasters at ~25/50/75%), Truby (22 steps with quartile distribution).

**Strong convergence on the *positions*; light disagreement on rigidity.**

**Encoded shape:**

```typescript
chapter.milestone?: 'hook' | 'inciting_event' | 'fpp' | 'pinch1' | 'midpoint' |
                    'pinch2' | 'tpp' | 'climax' | 'climactic_moment' | 'resolution'
chapter.expected_pct_min: float
chapter.expected_pct_max: float
chapter.yorke_act: 1 | 2 | 3 | 4 | 5
chapter.part: 1 | 2 | 3 | 4   // Brooks's four-part
chapter.mode: 'orphan' | 'wanderer' | 'warrior' | 'martyr' // Brooks's hero modes
```

**Checker rules:**
- Soft tolerance (±5%) for the four load-bearing milestones (FPP/Midpoint/TPP/Climactic Moment).
- Wider tolerance (±10%) for hook/inciting/pinch points/resolution.
- Resolution ≤2% of total length (Weiland).
- "No new entities post-SPP" — hard rule (Brooks; the hardest deterministic rule in the corpus).
- Hero-mode classifier per beat: Part 2 ≥60% reactive, Part 3 ≥60% proactive (Brooks).

**Pipeline placement:** Planning Phase 1 emits per-chapter milestone + cumulative-words validator. The "no new entities post-SPP" check is the highest-confidence hard rule available — implement as a deterministic pre-draft gate.

### 2.5 Microtension / value shift / gap at the smallest unit

**Frameworks:** Maass (microtension is the keystone — emotional contradiction inside POV at paragraph scale), Coyne (every beat carries valueIn/valueOut), McKee (the gap; expectation vs result), Swain (motivation-reaction units; feeling → reflex → action sub-order), Yorke (beat-level fractal; setup/disruption/escalation/climax/release), Truby (scene-internal seven-step structure), Lisle (per-card "what changes" that motivates next card's "what's at stake").

**Encoded shape:**

```typescript
beat: {
  // Coyne / McKee / Yorke
  valueIn, valueOut, lifeValue, polarity,
  povExpectation, actualOutcome,
  // Maass
  povAffect: string,  // "admiration shadowed by mistrust" — non-generic
  // Yorke fractal
  internal_arc: { setup, disruption, escalation, climax, release },
  // Swain
  swain_tag: 'G' | 'C' | 'D' | 'R' | 'Dl' | 'Dc' | 'T',
  // Lisle
  causal_link_to_previous: string,  // "but" / "therefore"
}
```

**Checkers (per beat):**
- Microtension detector (Maass): cheap LLM Y/N + named contradiction pair. ~$0.0001/beat.
- Gap check (McKee): Y/N + magnitude.
- Value-shift check (Coyne): deterministic + semantic.
- Beat-phase classifier (Yorke): `{full_arc, setup_only, escalation_no_climax, climax_no_release, flat, recursive}`. Reject `flat`.
- "But/therefore" test (Lisle): per consecutive beat pair, is connection consequence or mere sequence? Flag "and then" runs >2.

These checks are partially redundant — running all five would over-fire. The right shape: **microtension + gap + value-shift as a 3-call ensemble**, with majority-vote routing to the quality-redraft gate. The Yorke phase classifier is supplementary and runs only on flagged beats.

### 2.6 Conservation across iterative expansion

**Frameworks:** Snowflake (10-step ladder with explicit conservation invariants between steps), Lisle (sentence → paragraph → page → skeleton → bright lights → notecards → prose with promise-conservation), Truby (premise → moral argument → character web → 22-step plan must each conserve prior layers), Coyne (foolscap top-half → bottom-half is hierarchical not parallel — global commits constrain scene-level), Brooks (concept → premise → theme is hierarchical; concept generates climax must hold at validation).

**Encoded shape:** A pre-skeleton concept expansion with explicit conservation checks:

```
Step 1 (logline / one-sentence): ≤15 words, no proper nouns, concrete verb,
                                  concrete antagonist or target.
Step 2 (paragraph): 5 sentences — setup, 3 disasters, ending. Disasters causally chain.
Step 3 (per-character summary): name, summary, motivation (abstract),
                                 goal (concrete), conflict, epiphany, paragraph arc.
Step 4 (one-page synopsis): expand each paragraph sentence to one paragraph.
                            Disaster-conservation invariant.
```

**Checker rules:**
- Step 1 → Step 2: same protagonist archetype, same central conflict.
- Step 2 → Step 4: each disaster appears, named and expanded.
- Each step must conserve the canonical *promise* of step 1.

**Pipeline placement:** This is **the single biggest current gap.** The harness jumps from concept agents straight to chapter skeletons. Adding the logline/paragraph/disaster-manifest sub-step is the keystone change — every downstream check (promise registry, milestone placement, climactic-idea coherence) becomes more reliable when these upstream artifacts exist.

### 2.7 Genre contracts / obligatory scenes

**Frameworks:** Coyne (12-genre taxonomy with obligatory scenes per genre), STC (10 genres with three ingredients each), Sanderson (plot archetypes — heist/mystery/romance/hero's journey/tragedy — with obligatory beats), LitRPG (system-introduction, class-selection, level-up, training-montage, level-cap defeat, persistent-world consequence), Truby (genre class lectures with per-genre obligatory beats), Brooks (compelling premise as a genre-shape proxy).

**Encoded shape:** Static per-genre obligatory-scene checklists:

```ts
const OBLIGATORY_SCENES: Record<Genre, string[]> = {
  action:   ['inciting_attack', 'hero_at_mercy_of_villain',
             'speech_in_praise_of_villain', 'climactic_confrontation'],
  thriller: ['inciting_crime', 'hero_at_mercy_of_villain', 'all_is_lost', ...],
  fantasy:  [...ACTION_OR_WORLDVIEW_BASE, 'threshold_crossing',
             'magic_system_payoff', 'cost_of_power_demo'],
  litrpg:   ['system_introduction', 'first_stat_screen', 'class_selection',
             'first_death_stakes_fight', 'training_montage', 'level_cap_defeat',
             'first_tier_up', 'power_reveal_to_allies', 'first_true_boss'],
  cultivation: [...litrpg_minus_system, 'tier_hierarchy_reveal', 'breakthrough',
                'bottleneck', 'heavenly_tribulation', 'face_slap', 'sect_trial',
                'treasure_pickup'],
  romance:  ['meet_cute', 'attraction', 'complication', 'dark_moment_separation',
             'reunion_commitment'],
}
```

**Pipeline placement:** Planning Phase 1.5 — between skeleton emit and approval, run obligatory-scene coverage check per `seed.genre`. Missing scenes → planner re-expansion or chapter-plan-reviser.

**Important caveat (Coyne, Maass, Sanderson all flag):** also detect *over-fidelity* — every cliched convention present, none subverted = mechanical-feeling prose. Flag as "trope deployment without inversion."

---

## 3. Framework-specific gold (the unique contributions)

What each framework supplies that others don't.

**Save the Cat (Brody/Snyder).** The 15-beat percentage *calculator* (precise prose-pacing percentages) and the **B-Story character** as a structural slot — a planner-named character whose job is to carry the theme into the protagonist's arc, with required intersection at Midpoint, Dark Night, and Break Into 3. Other frameworks have themes; only STC structurally pins them to a specific character node.

**Brooks (Story Engineering).** The **concept-vs-premise-vs-theme-vs-idea** taxonomy (Brooks's most-cited distinction; ~80% of amateur submissions confuse premise with concept) and the *hardest deterministic rule in the corpus*: "No new characters or information after the Second Plot Point (~75%)." This is a one-grep planner check that catches the most common late-introduced-helper failure.

**Coyne (Story Grid).** The **foolscap as a literal spreadsheet** — every scene a row with valueIn/valueOut/polarity/lifeValue/commandment columns; the value-charge mechanic at the smallest unit. Coyne's framework is the most engineering-friendly in the corpus; it's a specification, not a manual. The unique contribution is the *spreadsheet-shaped* mental model — every check Coyne proposes is auditable, even if other frameworks proposed similar mechanics.

**McKee (Story).** The **negation of the negation** — the deepest stakes-depth mechanic. For any value (love, justice, freedom), the deepest negative state is not the simple opposite (hate) but the contradiction-justified-as-the-value (self-hate masquerading as love; tyranny justified as justice). Climax stakes at NoN level vs at contradictory level is one level of dramatic depth. No other framework articulates this.

**Snowflake (Ingermanson).** **Iterative-expansion with conservation invariants** — the explicit ladder where each step's output conserves prior steps' canonical content (disaster conservation between step 2 and step 4 is the cleanest example). The *process* of expansion-with-conservation, not just the artifacts. This is what the harness's planning phase fundamentally lacks.

**Lisle (How to Think Sideways).** **Bright-light protection** — author-declared "scenes I cannot wait to write" that get protected status, with the skeleton flexing to accommodate them. This is the only framework that treats the author's *emotional investment* as a structural constraint. For a human-in-the-loop harness, it's the natural shape for human seed input. Also unique: the **"but/therefore" test** as a per-card causal-chain check.

**Truby (Anatomy of Story).** **The character web** — every major character is a moral variation on the protagonist; opponents share the protagonist's deepest weakness; the web is a graph with `shared_weakness` annotations on opponent edges. This is the most encodable character-construction artifact in the corpus and has no Coyne/STC/McKee equivalent. Also unique: the **22-step coverage** with the often-skipped step 13 (Attack by Ally — the moral pivot that genre fiction omits).

**Yorke (Into the Woods).** **The fractal claim** — five-act shape (setup/false-hope/turn/dark-night/resolution) recurs at every scale: novel, act, chapter, scene, beat, dialogue exchange. The same shape-check applies recursively, which means one detector covers multiple scales. Also unique: **want/need framed as epistemic** (protagonist must not *know* their need at the start; the journey *is* need-discovery).

**Swain (Techniques of the Selling Writer).** The **MRU (Motivation-Reaction Unit)** with the strict feeling → reflex → action sub-order *inside* a reaction. The single most operationalizable paragraph-level rule in the entire corpus — encodable as regex + a small classifier. Reverses are catchable: "She winced. The door slammed." vs "The door slammed. She winced." Also: the `G C+ D R Dl Dc T` beat-tag schema as a direct grammar.

**Browne-King (Self-Editing for Fiction Writers).** **~30 deterministic prose lints** (said-bookisms; adverb tags; non-vocal tag verbs like "smiled" used as dialogue tags; "suddenly"; "began to"; existential passives; floating dialogue; italics overuse; "she thought" tags; emotion labels; filtering verbs; hedge stacking). A near-doubling of the existing 26-pattern lint set, ~$0 to add (regex-only). The chapter-by-chapter checklist format is itself a model for how to structure a lint-pass library.

**Sanderson (BYU Lectures).** **MICE-quotient as balanced-parens** — Milieu/Inquiry/Character/Event threads nest LIFO, every open must close, type-mismatched closes are violations. The genre-wide Three Laws of Magic are also Sanderson-distinctive (especially Third Law: "expand before adding," which catches power-creep in fantasy/LitRPG). And **"every scene does ≥2 of {advance plot, develop character, develop world, set up payoff}"** as the cleanest scene-purpose checker.

**Weiland (Structuring Your Novel + Creating Character Arcs).** The **percentage-locked beat sheet** (10 beats at fixed percentages, ±3% for the four structural ones) and — uniquely — the **arc-state-per-beat trajectory** (`lie_dominant → lie_challenged → truth_glimpsed → truth_resisted → truth_chosen → truth_embraced` for positive arcs; inverse for negative). Weiland is the only framework that pins each named beat to a specific internal arc state.

**Harmon (Story Circle).** **The four diagonal mirror pairs** — 1↔5 (zone vs alien), 2↔6 (want vs cost), 3↔7 (threshold vs return), 4↔8 (adaptation vs change). Each pair is a single cheap LLM check verifying *symmetry*, not completeness. ~$0.0005/novel for all four. No other framework reduces to four checks this cleanly. Also unique: the rotational-symmetry framing as an alternative to the more common percentage-position framing.

**Maass (Writing the Breakout Novel + Fire in Fiction + Emotional Craft).** **Microtension** — emotional contradiction inside the POV character at line/paragraph scale. The single highest-leverage prose-quality insight in the corpus that the harness is not currently encoding. Also unique: the **third-level-emotion** mechanic (surface anger → below it hurt → below that shame; third level reads as recognized). And the random-page tension test as a workshop-validated diagnostic.

**LitRPG / Progression Fantasy (synthesized from Rowe, Wight, Royal Road consensus).** The **PromiseRegistry literalized** — the genre by convention names every promise ("I will reach Gold") as on-page declaration; readers track them; payoff structure is more rigorously contractual than literary fiction. Also unique: the **`progressionLadder`** with per-tier `{differentiator, gate, risk}`; the **`systemVoice`** field (sarcastic-DCC, dry-HWFWM, ceremonial-Wandering-Inn); per-book power-creep budget enforcement; level-up cadence schedule. The genre's machine-checkability is unusually high because the conventions are explicit.

---

## 4. Programmatic levers — ranked by leverage

Roughly 50 levers ranked by (impact × ease × current-gap-size). Top 10 first; the table below has all of them.

### Top 10 (implement next week)

These are the highest-ROI levers:

| # | Lever | Phase | Source | Mechanism | Effort | Impact | Why it ranks here |
|---|-------|-------|--------|-----------|--------|--------|-------------------|
| 1 | **Microtension detector** (per-beat) | drafting/validation | Maass | Cheap LLM Y/N + named pair → routes to quality-redraft | S | **High** | Highest-leverage prose-quality gap; ~$0.04/novel; plugs into existing quality-redraft gate (no new infrastructure) |
| 2 | **valueIn/valueOut/lifeValue** schema + value-shift checker | planning/validation | Coyne+McKee+Yorke+Truby+Swain | Schema fields + deterministic eq + cheap LLM semantic | S | **High** | 5 frameworks converge; single check covers most "flat beat" cases |
| 3 | **PromiseRegistry** (table + extraction + payoff verification) | concept/planning/validation | Sanderson+Lisle+LitRPG+Coyne | DB table + concept-phase LLM extraction + end-of-arc verifier | M | **High** | Catches dangling setups + deus ex machina simultaneously; especially load-bearing for LitRPG |
| 4 | **Snowflake-style logline → paragraph → disaster-manifest** (concept upstream expansion) | concept | Snowflake+Lisle+Brooks | New concept sub-phase: 3 LLM calls (logline, paragraph, character summaries); deterministic shape checks | M | **High** | Single biggest current gap; every downstream check becomes more reliable |
| 5 | **No-new-entities-post-SPP** check | validation | Brooks | Deterministic char/fact diff after 75% chapter | S | High | Hardest deterministic rule available; high catch rate on planner late-introduced helpers |
| 6 | **Browne-King ~24 new lint patterns** (said-bookisms, adverb-tags, non-vocal tags, "suddenly", "began to", existential passives, italics overuse, etc.) | drafting/validation | Browne-King | Regex (Tier-1) | S | Med-High | ~$0 cost; near-doubles current 26-pattern lint set |
| 7 | **Lie/Truth/Want/Need + arc_type** schema (protagonist) + arc-state-per-beat trajectory check | concept/planning/validation | Weiland+Truby+Yorke+STC+Maass | Schema fields + per-beat arc_state + trajectory validator | M | High | 5+ frameworks converge; pins internal arc to structural beats |
| 8 | **Sanderson "scene does ≥2 of 4"** function-tag check | planning/drafting | Sanderson | Per-beat tags `{advances_plot, develops_char, develops_world, sets_up_payoff}` + count check | S | Med-High | Cleanest "is this scene doing work?" check |
| 9 | **Swain `G C+ D R Dl Dc T`** beat-tag schema + per-chapter shape check | planning | Swain | Tag enum + regex-on-tag-sequence | S | Med | Catches the "no disaster" and "no sequel" failure modes that current adherence misses |
| 10 | **Harmon mirror-pair checks** (1↔5, 2↔6, 3↔7, 4↔8) | validation | Harmon | 4 cheap LLM calls comparing chapter pairs | S | Med | $0.0005/novel; single chapter-arc shape-check; orthogonal to percentage-based checks |

**Justification for the top-10 ranking:**
- #1 microtension: largest current gap × high impact × small cost × already has retry infrastructure (quality-redraft gate). It's a clear keystone.
- #2 value-shift: 5+ frameworks converge — high confidence; single mechanism handles much of what 5 separate checks would otherwise need.
- #3 PromiseRegistry: high impact for fantasy/LitRPG specifically (which is the harness's commercial focus); composable with #1, #2, #5.
- #4 Snowflake upstream: structural foundation for everything else. Lower impact in isolation but unlocks every other concept-derived check.
- #5 No-new-entities: hardest deterministic rule available; cheap; high false-negative reduction.
- #6 Browne-King lints: free wins, complementary to #1.
- #7 Lie/Truth/Want/Need: huge convergence; ties together character work across phases.
- #8 ≥2-of-4 scene check: cleanest scene-purpose check available; simple.
- #9 Swain beat-tags: catches a structural failure class current checkers miss (no sequel after disaster).
- #10 Harmon mirrors: surprising entry — they're cheap and orthogonal to percentage-based checks. The 1↔5 divergence in particular catches "geographic journey but tonally identical" failures the planner currently accepts.

### Full lever list (~50)

| # | Lever | Phase | Source | Mechanism | Effort | Impact |
|---|-------|-------|--------|-----------|--------|--------|
| 1 | Microtension detector | drafting/val | Maass | LLM ($0.0001/beat) | S | High |
| 2 | valueIn/valueOut/lifeValue schema + check | plan/val | Coyne+McKee+Yorke+Truby+Swain | det+LLM | S | High |
| 3 | PromiseRegistry | concept/plan/val | Sanderson+Lisle+LitRPG+Coyne | DB + LLM | M | High |
| 4 | Logline / paragraph / disaster-manifest (concept upstream) | concept | Snowflake+Lisle+Brooks | new sub-phase | M | High |
| 5 | No-new-entities-post-SPP | val | Brooks | deterministic | S | High |
| 6 | Browne-King ~24 lint patterns | val | BK | regex | S | Med-High |
| 7 | Lie/Truth/Want/Need + arc-state trajectory | concept/plan/val | Weiland+Truby+Yorke+STC | schema+LLM | M | High |
| 8 | Sanderson "scene does ≥2 of 4" | plan/draft | Sanderson | tag enum | S | Med-High |
| 9 | Swain `GCDRDlDcT` tag schema | plan | Swain | enum+regex | S | Med |
| 10 | Harmon mirror-pair checks (4) | val | Harmon | 4 LLM | S | Med |
| 11 | Truby character web (graph schema + opponent-similarity check) | concept | Truby | schema + LLM | M | High |
| 12 | Sanderson MICE thread tracking + balanced-parens check | plan/val | Sanderson | tag + stack walk | M | Med-High |
| 13 | Concept-vs-premise gate | concept | Brooks | LLM judge | S | Med-High |
| 14 | Theme-as-argument validator | concept | Brooks+Truby+Coyne+McKee | regex (verb-required) | S | Med |
| 15 | Genre obligatory-scene checklist | plan | Coyne+STC+Sanderson+LitRPG | static map per genre + LLM judge | M | High |
| 16 | LitRPG `progressionLadder` schema | concept | LitRPG | schema | S | High (LitRPG only) |
| 17 | LitRPG `systemSpec` + `systemVoice` | concept | LitRPG | schema + exemplars | M | High (LitRPG only) |
| 18 | LitRPG per-book power-creep budget | plan | LitRPG | numeric caps | S | High (LitRPG only) |
| 19 | LitRPG `system-consistency-checker` (stat/skill/rule registry) | val | LitRPG | accumulator + LLM | M | High (LitRPG only) |
| 20 | LitRPG stat-monotonicity check | val | LitRPG | deterministic | S | Med (LitRPG only) |
| 21 | McKee gap detector (povExpectation / actualOutcome) | plan/val | McKee | schema + LLM | S | Med-High |
| 22 | povAffect required field per beat | plan | Maass | schema + non-genericness check | S | Med |
| 23 | Outer/inner/world plot-layer coverage per chapter | plan | Maass | schema + check | S | Med |
| 24 | Three-dimensions character schema + Dim3 high-stakes choice | concept | Brooks | schema + LLM | S | Med |
| 25 | Brooks 4-part hero-mode classifier (orphan/wanderer/warrior/martyr) | plan/val | Brooks | per-beat tag + ratio check | M | Med |
| 26 | Hero reactive-vs-proactive ratio per part | val | Brooks | LLM classifier | M | Med-High |
| 27 | Antagonist parallel-goal annotation per chapter | plan | McKee+Truby | schema + LLM | M | Med-High |
| 28 | Negation-of-the-negation depth check | val | McKee | LLM judge on climax | S | Med |
| 29 | Coincidence-in-climax (deus ex machina) detector | val | McKee+Sanderson | LLM causal trace | M | Med-High |
| 30 | Self-revelation explicit-naming check | val | Truby | LLM on step-20 chapter | S | Med |
| 31 | Yorke fractal beat-arc scaffold (setup/disrupt/escalate/climax/release) | plan/draft | Yorke | schema + writer prompt | M | Med |
| 32 | Yorke change-test per beat | val | Yorke | LLM | S | Med (overlaps #2) |
| 33 | Yorke flat-beat detector | val | Yorke | LLM | S | Med |
| 34 | Lisle "but/therefore" causal-chain check | plan/val | Lisle | LLM per beat-pair | S | Med |
| 35 | Lisle stakes field per beat + visibility check | plan | Lisle | schema + LLM | S | Med |
| 36 | Lisle plot-clinic symptom diagnosis (middle-sags etc) | val | Lisle | LLM classifier | M | Med |
| 37 | Save-the-Cat `sixThings` registry + finale payoff | concept/val | STC | list + LLM | S | Med |
| 38 | STC B-Story character + intersection check | concept/plan | STC | schema + presence check | S | Med |
| 39 | STC Theme-Stated beat (4-7%, speaker != POV) | plan | STC | tag + constraint | S | Med |
| 40 | All-Is-Lost "whiff of death" detector | val | STC | LLM | S | Low-Med |
| 41 | Final-Image mirror-Opening-Image check | val | STC | LLM | S | Low-Med |
| 42 | Sanderson Magic Laws: limitations[] + costs[] required on magic-intro beats | plan/val | Sanderson | schema | S | Med-High (fantasy) |
| 43 | Sanderson Third Law: expand-before-add gate (magic_register) | plan | Sanderson | accumulator | M | Med (fantasy) |
| 44 | Five-tension-type per-scene tagger | plan/val | Sanderson | enum | S | Low-Med |
| 45 | First-and-last-line audit (chapter boundaries) | val | Maass | hook-detector LLM | S | Med |
| 46 | Random-page tension test (validation report) | val | Maass | sample N + microtension | S | Med |
| 47 | Stakes-triangulation (personal/public/ultimate) at concept | concept | Maass | LLM judge | S | Med |
| 48 | Productive-contradictions field per character + coverage | concept/val | Maass | schema + LLM | S | Med |
| 49 | Hook hygiene checker (every chapter opens with question/motion/tension) | val | Weiland+Maass | LLM | S | Med |
| 50 | Per-chapter `endShape` tagging (hard-cliff / soft-hook / motion-turn) | plan | LitRPG+Maass | enum + distribution check | S | Med (LitRPG primarily) |

**Effort key:** S = ≤1 day; M = 1-3 days; L = >3 days.

---

## 5. Phase-by-phase recommendations

### 5.1 Concept phase

**Schema additions to `Seed`/`SeedInput.directives`:**

```typescript
type ConceptDirectives = {
  // Brooks
  concept: { whatIf: string },              // tested as "what if?"
  premise: string,
  theme: { argument: string },              // verb required, not topic
  // Truby + Weiland
  protagonist: {
    // Brooks
    dimension1: { surface, quirks, speech },
    dimension2: { wound, worldview, fear },
    dimension3: { predictedHighStakesChoice },
    // Weiland
    arc_type: 'positive' | 'negative' | 'flat' | 'disillusionment' | 'corruption',
    lie_text: string,
    truth_text: string,
    ghost_text?: string,
    want_text: string,
    need_text: string,
    // Truby split
    psychological_need: string,
    moral_need: string,
    causal_link: string,                    // psych→moral
    // Maass
    productive_contradictions: string[],
    signature_gesture: string,
  },
  // Truby character web
  character_web: {
    nodes: CharacterNode[],
    edges: WebEdge[],                       // each opponent edge has shared_weakness
    moral_argument: string,                 // "if you live by X, you Y; to live well, Z"
  },
  // McKee
  controlling_idea: { value: string, cause: string },
  narrative_mode: 'archplot' | 'miniplot' | 'antiplot',  // gates which checks apply
  // STC
  stcGenre: '...' | null,                   // optional 10-genre tag
  sixThingsToFix: string[],
  bStoryCharacter: string,
  // LitRPG
  systemSpec?: SystemSpec,
  progressionLadder?: Tier[],
  originDeficit?: string,
  systemVoice?: { tone, register, exemplars[] },
  // Coyne Editorial Six
  globalGenre: string,
  internalGenre: string,
  globalObjectOfDesire: { external_want: string, internal_need: string },
  // Maass
  stakes: { personal: string, public: string, ultimate: string },
  // Snowflake/Lisle
  logline: string,                          // ≤15 words, no proper nouns
  paragraph_summary: string,                // 5 sentences (setup, 3 disasters, ending)
  disaster_manifest: { d1: string, d2: string, d3: string, ending: string },
}
```

**Concept-exit gates (must pass before promoting to planning):**

1. Logline ≤15 words, no proper nouns, concrete verb (deterministic regex).
2. Concept passes "what if?" test (LLM judge: phrasable without character names; supports multiple stories).
3. Theme contains a verb and asserts a relationship between two abstractions (deterministic).
4. Three disasters extracted from paragraph_summary; each is causally chained to prior (LLM judge).
5. Lie ≠ Truth; Want ≠ Need (semantic).
6. Psychological need causally produces moral need (LLM judge).
7. Character web: protagonist + ≥1 opponent + ≥1 ally; every opponent edge has non-empty `shared_weakness`; LLM verifies each shared_weakness is real (not pasted boilerplate).
8. Controlling idea passes McKee shape: VALUE prevails because CAUSE.
9. Maass stakes: each of personal/public/ultimate scores ≥2.
10. (LitRPG only) systemSpec has all required fields; progressionLadder has start tier and end tier with differentiator/gate/risk.

**Agent prompt additions:**
- `world-builder`: emit `globalGenre`, `internalGenre`, world-tier-strictness if fantasy/LitRPG.
- `character-agent`: emit Lie/Truth/Want/Need + dimensions + productive contradictions + signature gesture.
- `plotter`: emit logline + paragraph_summary + disaster_manifest + controlling_idea + character_web.

### 5.2 Planning phase

**Schema additions to chapter:**

```typescript
chapter: {
  // existing: title, pov, setting, purpose, targetWords, charactersPresent[], scenes[]
  // existing: establishedFacts, characterStateChanges, knowledgeChanges
  // ----- structural -----
  // STC + Brooks + Weiland convergence
  milestone?: 'hook' | 'inciting' | 'fpp' | 'pinch1' | 'midpoint' |
              'pinch2' | 'tpp' | 'climax' | 'climactic_moment' | 'resolution',
  expected_pct_min: float,
  expected_pct_max: float,
  // Brooks
  part: 1 | 2 | 3 | 4,
  mode: 'orphan' | 'wanderer' | 'warrior' | 'martyr',
  expositional_mission: 'setup_plot' | 'forward_plot',
  antagonist_present: boolean,
  antagonist_goal_this_chapter: string,
  stakes_delta: 'increases' | 'plateaus' | 'decreases',
  // Yorke
  yorke_act: 1 | 2 | 3 | 4 | 5,
  // Sanderson MICE
  mice_thread_id: string,
  mice_role: 'open' | 'progress' | 'close',
  mice_type: 'M' | 'I' | 'C' | 'E',
  // Sanderson promises/payoffs
  promises_made: PromiseRef[],
  payoffs_delivered: PayoffRef[],
  // Maass
  outer_progression: string,
  inner_progression: string,
  world_progression: string,
  // Harmon
  story_circle_position: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
  // LitRPG
  major_breakthrough?: { tier_from, tier_to } | null,
  level_up_count?: number,
  end_shape: 'hard-cliff' | 'soft-hook' | 'motion-turn',
}
```

**Schema additions to beat (chapterBeatsSchema):**

```typescript
beat: {
  // existing: description, characters[], pov, setting
  // ----- micro-arc -----
  // Coyne / McKee / Yorke / Truby
  valueIn: string,
  valueOut: string,
  lifeValue: 'love/hate' | 'life/death' | 'justice/injustice' | 'freedom/slavery' |
             'hope/despair' | 'truth/lie' | 'power/weakness' | 'meaning/meaningless' |
             'mastery/impotence' | ...,
  polarity: '+' | '-' | '++' | '--' | 'mixed',
  // McKee gap
  pov_expectation: string,
  actual_outcome: string,
  // Maass
  pov_affect: string,                       // ≤30 words, non-generic
  // Yorke fractal
  internal_arc: { setup, disruption, escalation, climax, release },
  // Swain
  swain_tag: 'G' | 'C' | 'D' | 'R' | 'Dl' | 'Dc' | 'T',
  scene_group_id: number,                   // Coyne scene-group annotation
  commandment_role: 'II' | 'PC' | 'Cr' | 'Cl' | 'Re' | 'bridge',
  // Lisle
  causal_link_to_previous: string,          // "but ___" / "therefore ___"
  stakes_at_risk: string,
  beat_purpose: 'introduce' | 'complicate' | 'resolve',
  // Sanderson scene functions
  scene_functions: ('advances_plot' | 'develops_character' | 'develops_world' |
                    'sets_up_payoff')[],   // ≥2 required
  // Weiland scene/sequel subtype
  scene_sequel_subtype: 'goal' | 'conflict' | 'disaster' |
                        'reaction' | 'dilemma' | 'decision',
  // Weiland arc-state
  arc_state: 'lie_dominant' | 'lie_challenged' | 'lie_doubled_down' |
             'truth_glimpsed' | 'truth_resisted' | 'truth_chosen' |
             'truth_embraced' | 'truth_rejected',
  // Truby scene-internal seven-step (for major beats)
  scene_desire?: string,
  scene_endpoint?: string,
  scene_opponent?: string,
}
```

**New planner sub-phase: 1.5 (between Phase 1 skeleton and Phase 2 expansion)**

Run obligatory-scene coverage check per `seed.genre`. For each required scene (from per-genre static map), LLM identifies which chapter dramatizes it; missing scenes route to planner re-expansion. This is the "gap-fill" phase Coyne implies in the foolscap workflow.

**Per-chapter constraints to encode:**
- Hero-mode ratio per Brooks part (Part 2 ≥60% reactive; Part 3 ≥60% proactive).
- Antagonist appears at chapters covering 37.5% and 62.5% (pinch points).
- "No new entities post-SPP" (chapters past 75%).
- LitRPG: per-book creep budget enforcement.
- Resolution chapter ≤2% of total length.

**Beat floor / ceiling refinements:**
Current floor is `ceil(targetWords / 150)`. Add:
- Beat ceiling: `floor(targetWords / 80)` to prevent over-dense planning.
- Per-chapter: at least one beat tagged `D` (disaster) per Swain Scene; at least one `Dc` (decision) per Sequel.
- Per-chapter: ≥1 beat advances each of the three plot layers (outer/inner/world) — Maass.

**Cross-beat invariants:**
- Each `Dc` beat's produced goal matches the next `G` beat's stated goal (Swain decision-to-goal continuity).
- MICE threads form a balanced-parens sequence (Sanderson stack walk).
- Polarity sequence has no run of ≥3 same polarity (Coyne; suppress for tragedy seeds).
- Beat-arc-state trajectory matches `arc_type` (Weiland trajectory check).
- Chapter `story_circle_position` is monotonic non-decreasing across chapter index (Harmon).

### 5.3 Drafting phase

**Beat-prompt additions:**

```
You are writing beat {beat.index} of chapter {chapter.title}.

[Existing context: pov, setting, transition bridge, landing target, character snapshots]

This beat's structural target:
  Swain tag: {beat.swain_tag}      # G/C/D/R/Dl/Dc/T
  Five-act phase: {beat.internal_arc.setup → ... → release}  # Yorke fractal
  Value charge: {beat.valueIn} → {beat.valueOut} on {beat.lifeValue} axis
  Scene functions to advance: {beat.scene_functions}  # ≥2 of 4 (Sanderson)

The POV character's expectation entering this beat: {beat.pov_expectation}
What the world actually delivers: {beat.actual_outcome}
The contradiction inside the POV (microtension target): {beat.pov_affect}
                                                          # e.g. "admiration shadowed by mistrust"

Inside this beat:
  - Let the POV character feel two things at once about the same object — name them
    via gesture, sensory detail, or unguarded thought. Do not resolve. (Maass)
  - Lead each paragraph with motivation (external stimulus); follow with reaction.
    Inside reaction, feeling → reflex → action/speech order. (Swain MRU)
  - The beat ends in a different emotional, informational, or physical state than
    it began. (Yorke change test)

[If beat.swain_tag == 'G':] Open with stated goal in first 1-3 sentences.
[If beat.swain_tag == 'D':] Close at a worse strategic equilibrium.
[If beat.swain_tag == 'R':] Open with body, then reflex, then thought.

[If chapter.story_circle_position == 5:] The setting and tone should feel alien
  relative to chapter 1.
[If chapter.story_circle_position == 7:] Reference at least one element from
  chapter 1; show the protagonist relating to it differently now.

[Browne-King default-on lints to internalize:]
  Tag dialogue with "said" or "asked"; never adverb tags or non-vocal verbs.
  Render emotion through behavior, not labels. Use contractions in dialogue.
  Avoid filtering verbs (saw, heard, noticed). Cut "suddenly," "began to."
```

**Beat-context additions:**
- Antagonist parallel-goal: what the antagonist is *actively doing* during this scene to advance their counter-goal (McKee+Truby).
- Truby step IDs the beat is expected to advance (e.g. "step 13 attack-by-ally + step 9 first revelation").
- Character-web edges activated (e.g. "protagonist↔fake_ally_opponent: foreshadow exposure").
- LitRPG: per-chapter system-message budget (1-4 normal, up to 8 for level-up); systemVoice exemplars (3-5 short in-prose lines).

**Voice-pack interactions (Salvatore primer compatibility):**
- Salvatore corpus tolerates partial-arc beats and some "growled"/"snarled" dialogue tags. Make these checks soft-fail under `WRITER_GENRE_PACKS = fantasy` routing.
- Microtension check should still fire (Salvatore's beat density is thinner but emotional contradiction is still load-bearing).
- Browne-King "said-bookism" lint should be calibrated per writer-genre-pack — Salvatore allows ~2x the rate of a Browne-King-strict register.
- Per-genre `tragedyMode` flag suppresses the Coyne polarity-monotony check.
- McKee's "subtext-everywhere" check should be suppressed in beats labeled `combat: true` or `pure-action: true` (see §9 below).

### 5.4 Validation phase

**New checkers to add (with rough cost in tokens/$):**

| Checker | Cost/novel | Source | Mechanism |
|---------|------------|--------|-----------|
| Microtension detector (per beat) | $0.04 | Maass | LLM Y/N + named pair |
| Value-shift check (per beat) | $0.03 | Coyne | det + LLM semantic |
| Gap detector (per beat) | $0.03 | McKee | LLM 4-class |
| Yorke change-test (per chapter) | $0.005 | Yorke | LLM |
| Harmon mirror-pair (4 calls) | $0.0005 | Harmon | LLM |
| No-new-entities-post-SPP | ~$0 | Brooks | deterministic |
| MICE balanced-parens | ~$0 | Sanderson | deterministic on planner output |
| Promise-payoff verifier | $0.01 | Sanderson+LitRPG | LLM per major promise |
| Self-revelation explicit-naming | $0.001 | Truby | 1 LLM call |
| Negation-of-negation depth | $0.001 | McKee | 1 LLM call |
| Coincidence-in-climax | $0.005 | McKee+Sanderson | causal-trace LLM |
| Stakes triangulation | $0.001 | Maass | LLM at concept time |
| Random-page tension test | $0.003 | Maass | sample 30 beats, microtension on each |
| Browne-King ~24 regex lints | ~$0 | BK | regex |
| BK POV-consistency / show-vs-tell / on-the-nose | $0.02 | BK | small LLM per scene |
| LitRPG system-consistency-checker | $0.01 | LitRPG | accumulator + LLM |
| LitRPG stat-monotonicity | ~$0 | LitRPG | deterministic |
| LitRPG promise-payoff (genre-specific, 2-stage unlock→use) | $0.005 | LitRPG | LLM |
| Truby character-web density check | $0.005 | Truby | LLM per major node |
| Hero reactive/proactive ratio per Brooks part | $0.01 | Brooks | LLM classifier per beat |
| Plot-layer coverage (outer/inner/world) | $0.005 | Maass | LLM per chapter |
| **Total marginal cost** | **~$0.18/novel** | | |

Existing pipeline cost is on the order of $0.50-2.00/novel; adding ~$0.18 is well within budget.

**Lint-pattern expansions (Browne-King):**

Add to existing 26-pattern set (~doubles it):

Tier-1 (regex, ~$0):
1. Said-bookisms (40+ tag verbs)
2. Adverb dialogue tags (`(said|asked|replied) \w+ly`)
3. Non-vocal tag verbs (smiled, laughed, frowned, grimaced as dialogue tags)
4. "Suddenly"
5. "Began to" / "started to"
6. Existential passives (`There (was|were|is|are) \w+ \w+ing`)
7. Direct emotion labels (`(was|felt|seemed) (angry|sad|happy|nervous|afraid)`)
8. "She thought" tags in close-third
9. Italics-overuse (count per chapter)
10. Italics + thought-tag double mark
11. Floating dialogue run (5+ untagged quotes)
12. Exclamation outside dialogue
13. Sentence-length variance below threshold (metronomic prose)
14. Word-repetition window (200-word window, content lemmas)
15. Filtering verbs (saw/heard/felt/noticed/realized/wondered) — info-level
16. Modifier stacking
17. Generic-beat verb fraction (nodded/smiled/frowned/glanced/sighed)
18. ALL-CAPS emphasis
19. Tag chains (every line tagged when alternation established)
20. Author-as-explainer parentheticals
21. Telegraphing pattern (`\w+ as \w+ slammed|hit|struck`) — Swain
22. Adverb-loaded attribution (`said \w+ly`) — Swain
23. Pre-stimulus reaction (short reaction sentence + immediately following past-tense external event)
24. Stage-direction overload (extended physical blocking that displaces motivation/reaction)

Tier-2 (small LLM):
- POV head-hopping (per scene)
- Self-observation breach (POV described from outside)
- "As you know, Bob" detector (per dialogue exchange >80 tokens)
- Show-vs-tell beat classifier
- Generic-action-beat detector
- On-the-nose dialogue (text == subtext)
- Image repetition (per chapter, metaphor extraction + dedup)
- Register consistency (thesaurus reach)
- Trait-repetition audit (cross-chapter: "his iron will" appearing 3+ times)

**Cross-checker arbitration when multiple checks fire on same beat:**

Multiple checkers may fire simultaneously on the same beat. Arbitration rules:

1. **Highest-priority defect wins.** Ranking: structural defects (no-disaster, value-shift-missing, gap-missing) > microtension-missing > prose-quality lints.
2. **Convergent fires (same defect class)** → consolidate into single rewrite prompt. Example: gap-missing + value-shift-missing + flat-arc-from-Yorke all fire on the same beat → single "this beat doesn't change anything; something needs to happen that flips the [lifeValue] charge or breaks the POV's expectation" prompt.
3. **Conflicting fires** are rare but possible. Example: Browne-King lint fires for "growled" tag (said-bookism) but voice-pack `salvatore` allows it. Resolve via per-pack lint calibration (lower severity, not block).
4. **Quality-redraft gate vs. targeted-rewrite.** Existing harness uses targeted rewrite as default; redraft only on repetition-loop or underlength. Add microtension-missing and value-shift-missing as additional redraft triggers (since these defects often can't be fixed by editing — they require regeneration with different prompt).

---

## 6. Architectural changes worth considering

These are bigger than knob-tuning.

**1. Pre-skeleton concept-expansion sub-phase (Snowflake/Lisle).**
Currently the harness's concept agents (world-builder, character-agent, plotter) emit straight to chapter skeletons. Add an upstream sub-phase that emits logline → paragraph_summary → disaster_manifest → character_summaries (Snowflake step 1-3). The chapter-skeleton phase then becomes Snowflake step 6 with conservation invariants checked against the upstream artifacts. This is the single biggest unlocked-by-architecture change — every downstream check (promise registry, milestone placement, controlling-idea adherence) becomes more reliable when these upstream artifacts exist.

**2. `valueShift` / `microtension` / gap fields throughout the beat schema (cross-cutting).**
Six frameworks converge on per-beat change being load-bearing. Adding the fields to chapterBeatsSchema is one schema change; the planner emits them as part of Phase 2 expansion (no new LLM call), the writer reads them as constraints, and the checker validates them. This is high-ROI but cross-cutting.

**3. `PromiseRegistry` as a global table that persists across chapters.**
Currently the harness's chapter-plan-checker is per-chapter. PromiseRegistry needs to track promises *across* chapters and *across* books (for series). This is a new top-level data structure with concept-phase write, per-chapter write, and end-of-arc verification. Composes with `establishedFacts` / `characterStateChanges` (which are the existing per-chapter analogues).

**4. Fractal validation infrastructure.**
Yorke's fractal claim implies that the same shape-check (setup → disrupt → escalate → climax → release; or value-in vs value-out; or change test) should apply at multiple scales — beat, scene-group, chapter, act, novel. Building this infrastructure once means a single checker function that takes a `unit_text` + `unit_scope ∈ {beat, scene_group, chapter, act, novel}` and returns a phase classification or change-test result. Avoids per-scale duplication.

**5. Per-genre routing for checkers (extends `WRITER_GENRE_PACKS`).**
Currently `WRITER_GENRE_PACKS` routes writer LoRA selection. Extend to route checker calibration: tragedy-mode suppresses polarity-monotony, combat-mode suppresses on-the-nose dialogue, voice-LoRA-mode softens Browne-King said-bookism severity. The packs become a richer routing surface than just writer-model selection.

**6. Truby character web as a graph data structure.**
Currently characters are emitted as free-text snapshots. Promoting to a graph (nodes + edges with shared_weakness / value_contrast / desire_relation) enables: planner per-chapter "which web edges are active?" annotation; drafting beat-context per-edge prompt; checker web-density / opponent-similarity / fake-ally-presence checks. ~M effort, high impact for character-driven seeds.

**7. Sanderson MICE thread tracking with balanced-parens semantics.**
Currently no thread tracking. Adding a `mice_threads` table with open/close events per chapter enables the LIFO-balanced check + the "dominant thread at climax matches genre promise" check. Composes cleanly with existing chapter-skeleton output; the cost is mostly schema and a stack-walk validator.

**8. Pre-draft structural validator (planner output → drafting hand-off gate).**
Currently planning emits to drafting with chapter-plan-checker as the only structural gate. Add a pre-draft validator that runs *all* planning-phase checks (milestone positions, no-new-entities-post-SPP, MICE balance, obligatory-scene coverage, character-web density, promise registry initial state) before drafting begins. Rejected plans route to chapter-plan-reviser. This catches structural defects when fixes are cheapest (planner LLM call) rather than after drafting (writer LLM calls × 14 beats × N chapters).

---

## 7. Genre-specific encodings

A focused section on fantasy + LitRPG specifically — the harness's commercial focus.

### 7.1 Sanderson Magic Laws as planner constraints

Per-magic-system schema (from concept phase):

```typescript
type MagicSystem = {
  name: string,                           // "Allomancy", "the System", "madra cultivation"
  power_source: string,                   // "burning metals", "absorbed essence"
  quantification_axes: string[],          // 3-7
  acquisition_rules: string[],
  costs: string[],                        // ≥1 required (Sanderson Second Law)
  limitations: string[],                  // ≥1 required (Sanderson Second Law)
  abilities: Ability[],
}

type Ability = {
  name: string,
  costs: string[],                        // required
  limitations: string[],                  // required
  established_pct: float,                 // 0-1, when in the novel it was first revealed
  reader_understanding: float,            // 0-1, how clearly explained
  uses_count: number,                     // for Third Law expand-before-add gate
}
```

**Checker rules:**
- First Law: every plot-load-bearing ability used in the climax has `established_pct < 0.75` AND `reader_understanding >= 0.7`.
- Second Law: every ability has ≥1 cost and ≥1 limitation declared at introduction.
- Third Law: new abilities can only be introduced if all prior abilities have `uses_count >= 2`, OR the new ability is flagged as a deliberate genre promise (multi-system world declared).

### 7.2 LitRPG `progressionLadder` + `systemVoice` + `PromiseRegistry`

```typescript
type Tier = {
  name: string,                           // "Iron", "Jade", "Gold"
  differentiator: string,                 // qualitative difference vs prior tier
  gate: string,                           // what unlocks advancement
  risk: string,                           // cost of failed attempt
  // optional perks (HWFWM-style)
  perks?: string[],                       // e.g. "Gold-rank lifespan ~500 years"
}

type SystemVoice = {
  tone: 'sarcastic' | 'dry' | 'ceremonial' | 'neutral',
  register: 'corporate' | 'bureaucratic' | 'mystical' | 'terse',
  exemplars: string[],                    // 3-5 in-prose lines for primer
}

// PromiseRegistry from §2.2 with LitRPG-specific promise types:
// 'tier_advance' | 'skill_acquisition' | 'antagonist_defeat' | 'class_selection' |
// 'system_reveal' | 'breakthrough'
```

**LitRPG-specific checker rules:**
- Every chapter delivers ≥1 of: visible power growth | competence-porn application | system-mastery beat | new chekhov-tier-skill named.
- `system-consistency-checker`: stats/skills/rules registry; no contradictions across chapters.
- Stat monotonicity: headline stat non-decreasing without explicit `costEvent`.
- Promise-payoff for skill promises is two-stage: `unlocked` → `used decisively in a fight`.
- Per-book power-creep budget: 1 major tier advance, 3-6 skills, 1-3 artifacts.
- Single-major-breakthrough placement: chapters [N-3, N-1] of an N-chapter book.
- Level-up cadence per phase: early 2-4 ch, mid 5-8 ch, late 10-15 ch.
- System-message budget: 1-4 blocks per normal chapter, ≤8 for level-up; ≤15% of chapter prose.
- Cliffhanger discipline: hard cliffs at quarter/half/three-quarter/climax (4-6/book); soft hooks otherwise; never ends on stasis.
- Origin-deficit callbacks: `originDeficit` referenced periodically for first 50% of series.

### 7.3 MICE-tagging per chapter

Sanderson MICE applies cleanly to fantasy/LitRPG. Most progression-fantasy is **Inquiry-dominant** (what is the System? what is the Lord Ruler?) with **Milieu** subthreads (entering the dungeon, leaving Sacred Valley) and **Character** subthreads (the protagonist's want/need arc).

**Per-chapter tagging:** primary `mice_type` + `open/progress/close` role + `mice_thread_id` (so multiple threads with the same type are distinguishable).

**Pre-draft check:** stack walk validates LIFO; type-mismatched closes flagged. Dominant thread at climactic_moment matches genre promise (LitRPG genre promise is usually I or C).

### 7.4 Cultivation vs LitRPG vs progression-fantasy routing

```typescript
seed.subgenre: 'litrpg-system' | 'litrpg-apocalypse' | 'litrpg-isekai' |
              'progression-fantasy-western' | 'progression-fantasy-cultivation' |
              'progression-fantasy-cultivation-subverted'  // Beware-of-Chicken style
```

**Routing implications:**

- `litrpg-*`: requires `systemSpec`, `systemVoice`, stat-block schema with tags; system-consistency-checker active.
- `progression-fantasy-western` (Cradle-shape): requires `progressionLadder` with named tiers; no system blocks; tier-strictness `hard`; tier-skipping budget 1-per-book with leverage.
- `progression-fantasy-cultivation`: trope library includes face-slap, young-master, sect-trial, tribulation, treasure-pickup; tier-strictness configurable; cultivation-specific obligatory beats.
- `progression-fantasy-cultivation-subverted`: anti-trope library (lifestyle/farming/community-building); standard progression beats explicitly *avoided*; substitute-beat library required.

---

## 8. Sequencing recommendation

Roadmap: 4 implementation tranches, each ~1-2 weeks. Each tranche has a coherent theme and ships independently-valuable improvements.

### Tranche 1 (1-2 weeks): Per-beat structural tags + value-shift checker

**Theme:** the "did anything change?" layer. Highest-leverage, lowest-effort, cleanest convergence.

- Schema: add `valueIn`/`valueOut`/`lifeValue`/`polarity`, `pov_expectation`/`actual_outcome`, `pov_affect`, `swain_tag`, `scene_group_id`, `commandment_role` to chapterBeatsSchema.
- Checker: value-shift detector (deterministic + cheap LLM semantic) — Coyne.
- Checker: McKee gap detector (LLM 4-class).
- Checker: **microtension detector (Maass, the keystone)** — wire to existing quality-redraft gate.
- Lint: ~24 new Browne-King regex patterns.
- Validation: random-page tension test (sample 30 beats, run microtension; report coverage).

**Estimated cost:** 1.5 weeks; ~$0.10/novel marginal; catches the dominant "flat beat" failure class.

### Tranche 2 (1-2 weeks): PromiseRegistry + Sanderson MICE

**Theme:** the "did the contract close?" layer. Composes with Tranche 1.

- Schema: PromiseRegistry table with concept-phase extraction + per-chapter `promises_made`/`payoffs_delivered`.
- Schema: `mice_thread_id` / `mice_role` / `mice_type` per chapter.
- Checker: promise-payoff verifier at end-of-arc; dangling promises and unset-up payoffs flagged.
- Checker: MICE balanced-parens stack walk.
- Checker: deus ex machina detector (Brooks no-new-entities-post-SPP + McKee causal trace from climax).
- Schema: Sanderson "scene does ≥2 of 4" function tags.

**Estimated cost:** 1.5 weeks; ~$0.05/novel marginal; especially load-bearing for LitRPG.

### Tranche 3 (1-2 weeks): Snowflake-style upstream concept expansion

**Theme:** the "is the foundation solid?" layer. Architectural — biggest impact per dollar of effort.

- New concept sub-phase: logline → paragraph_summary → disaster_manifest → character_summaries.
- Schema: `Seed.directives.logline`, `paragraph_summary`, `disaster_manifest`, plus Brooks's concept/premise/theme split.
- Concept-exit gates: 10 checks (logline shape, what-if test, theme-as-argument, disaster causality, etc.).
- Conservation invariants: disaster_manifest entries appear in chapter skeleton.
- Per-character: Lie/Truth/Want/Need/arc_type fields with concept-phase validators.
- Truby character web: graph schema + opponent-similarity check + best-opponent check.
- Maass stakes triangulation (personal/public/ultimate).

**Estimated cost:** 2 weeks; ~$0.02/novel marginal; foundational for everything downstream.

### Tranche 4 (1-2 weeks): Maass tension + Browne-King Tier-2 + LitRPG specifics

**Theme:** the "is this prose alive, and does it honor genre contracts?" layer. Polish and genre-routing.

- Tier-2 lint: POV head-hopping, "as you know Bob," show-vs-tell beat classifier, on-the-nose dialogue, generic-action-beat detector.
- Maass: outer/inner/world plot-layer coverage per chapter; productive-contradictions field per character + coverage check; first-and-last-line audit.
- LitRPG: `systemSpec`, `systemVoice`, `progressionLadder`, per-book creep budget enforcement, system-consistency-checker, stat-monotonicity, level-up-cadence schedule.
- Per-genre routing extensions to `WRITER_GENRE_PACKS` (tragedy-mode, combat-mode, voice-LoRA-mode lint calibrations).

**Estimated cost:** 2 weeks; ~$0.05/novel marginal; rounds out the prose-quality and genre-fidelity layers.

**Total marginal cost across all 4 tranches:** ~$0.22/novel. Total effort: 6-8 weeks. Each tranche is independently shippable.

---

## 9. What to NOT encode

Important counterweight. Several framework prescriptions would HURT the pipeline if encoded literally.

**Save the Cat homogenization risk.** STC's central critique (Slate, Mythcreants) is that universal application produces a subliminal sameness. For a programmatic harness producing many novels, this is paradoxically *useful at small scales* (predictable structure for LLM-drafted novels) but catastrophic at scale (every harness-produced novel reads alike). **Mitigation:** vary the *texture* inside beats, not the lattice. Genre selection + voice LoRA + character variables produce divergence inside an STC skeleton. Don't encode the 15-beat lattice as the only structural template — combine with Brooks's looser 5-milestone or Yorke's five-act.

**Browne-King's overzealous show-don't-tell.** Not every emotion needs dramatization — some are background and warrant labeling ("She was tired."). Salvatore voice tolerates direct emotion labels at higher frequency than Browne-King would accept. **Mitigation:** make emotion-label lint *info-level*, not blocking; calibrate per `WRITER_GENRE_PACKS` slot.

**Browne-King "said is the only acceptable tag."** Voice-driven prose (especially fantasy with stylized narrators) earns "growled," "snarled," "whispered" at higher frequency. **Mitigation:** the said-bookism rule should be calibrated per voice pack — Salvatore allows ~2x rate of a Browne-King-strict register.

**Yorke fractal applied too rigidly to flat scenes.** Many published transition beats are *deliberately* partial-arc — they're connective tissue. Forcing every beat to have a full setup/disrupt/escalate/climax/release arc produces uniformly busy prose. **Mitigation:** apply the fractal check at scene-group granularity by default; flag only `flat` beats (no change at all), not `partial-arc` beats. Use `commandment_role: bridge` to suppress checks on legitimately transitional beats.

**McKee's screenwriter bias.** Single-protagonist assumption, 25% inciting-incident rule, three-act rigidity — all film-shaped. Multi-POV epic fantasy (GRRM, Erikson) violates these without losing quality. The 25% rule is brittle in 200K-word novels. **Mitigation:** per-seed `narrativeMode`, `protagonists[]`, `realityMode` flags gate which checks apply. Apply McKee structural checks per-protagonist arc, not globally.

**Truby's full 22-step coverage in short stories.** Some Truby steps (e.g. step 16, audience revelation) are technical positioning steps that may be absorbed into other steps in shorter forms. For 3-chapter stories, a reduced 12-step variant is more honest. **Mitigation:** scale step coverage by chapter count; short stories require only the 7 key steps.

**STC Theme Stated at 5% as on-the-nose dialogue.** Literary readers notice when the theme is bluntly stated by a side character. Brody acknowledges "subtle" Theme Stated (a child's overheard remark, graffiti, song lyric) works better. **Mitigation:** allow Theme Stated to be visual/situational, not just dialogue. The checker validates *presence* of theme content in the 4-7% range, not specific dialogue.

**Snowflake's three-disasters template on non-genre fiction.** It's a romance/thriller/genre-fiction template. Literary fiction, slice-of-life, intentionally non-cathartic stories don't fit. Apply it to a Knausgaard novel and the synopsis won't converge. **Mitigation:** the harness is fantasy/LitRPG-focused so this is mostly a non-issue; still, gate the disaster-manifest validator on `seed.narrativeMode != miniplot`.

**Brooks "no new info post-SPP" too strict for some genres.** Mystery novels often reveal the killer's identity *after* SPP. Brooks would say SPP is when the detective figures it out, not the reader — but in practice the rule needs softening for whodunits. **Mitigation:** soften to advisory severity for `seed.subgenre = mystery`.

**Sanderson First Law against soft magic.** Applied too rigidly, it forbids soft magic entirely. Sanderson explicitly says soft magic is fine; just don't use it to resolve plot. **Mitigation:** the harness encoding (capability score + climax-load-bearing flag) captures the nuance — only flag soft magic that *resolves* climax, not soft magic generally.

**Coyne polarity-monotony rule on Tragedy.** "No three same-polarity scenes in a row" assumes broad commercial fiction. Literary tragedy may run six negative scenes in a sustained descent. **Mitigation:** seed-level `genre.tragedyMode` flag suppresses the polarity-run check.

**McKee's controlling-idea reductiveness.** Some literary works deliberately argue *no* controlling idea — they enact ambivalence. McKee's framework punishes this. **Mitigation:** make controlling-idea adherence a soft signal for non-commercial seeds.

**Maass tension-on-every-page over-application.** Some beats are quiet glue and *should* be. Forcing emotional contradiction into every transition produces a melodramatic register. **Mitigation:** the microtension detector recognizes a "low-tension OK" class (transitional/informational) — `commandment_role: bridge` suppresses the check.

**Lisle's "but/therefore" naive over-firing.** Some scenes are setup that pays off many scenes later; the immediate transition is "and then" but the structural connection is "therefore" across a longer arc. **Mitigation:** flag "and then" runs of >2 beats specifically, not isolated "and then" connections.

**Weiland percentages applied as hard rules.** Weiland herself emphasizes they're guidelines; practitioners often treat them as rigid. Real published novels show 5-10% variance on most beats. **Mitigation:** soft tolerances (warn, not reject) — already in the recommended encoding.

**Truby's "best opponent" check rubber-stamped by LLMs.** The check requires the LLM to imagine *better* opponents — open-ended reasoning that LLM checkers may rubber-stamp. **Mitigation:** strong evaluator (Sonnet or DeepSeek) + explicit counter-example prompting; treat as advisory unless the evaluator returns a concrete superior alternative.

**Cross-talk with voice LoRA.** Salvatore corpus is trained on Drizzt-era prose, which often runs *thin* on Truby's moral self-revelation explicitness. Forcing explicit self-revelation may collide with voice's preference for understatement. **Mitigation:** A/B test before treating self-revelation check as blocking on voice-LoRA-routed runs; treat as advisory for `WRITER_GENRE_PACKS = fantasy` until validated.

**Genre-checklist mechanical conformity.** A planner that satisfies every obligatory scene can produce a structurally correct, narratively predictable book. **Mitigation:** the obligatory-scene checker should also flag *over-fidelity* — every cliched convention present, none subverted. Coyne acknowledges this; the *Masterwork* series' point is great novels honor *and* subvert conventions.

---

## 10. Open questions for the human

Decisions that can't be made from the reports alone — Andre's call.

**Q1. How rigid should percentage-based milestone checks be?**
Weiland argues ±3% on the four structural beats. Brooks argues similar windows. Sanderson resists fixed percentages. The harness can encode soft tolerance (warn-only), strict tolerance (block), or per-genre tolerance. **Recommend:** per-genre — strict for STC-compliant commercial fantasy, soft for literary or epic. Andre to decide the policy.

**Q2. Should the harness require Truby's character web for non-character-driven seeds?**
Truby is over-specified for genre-driven LitRPG/fantasy. Sanderson and Weiland have lighter character requirements. **Recommend:** require Lie/Truth/Want/Need (Weiland) for all seeds; require character web only when `seed.directives.character_focus = high`. Andre to weigh in on whether the web should be a default or opt-in.

**Q3. Microtension detector: voice-LoRA-aware calibration?**
Salvatore voice tolerates partial-arc beats and thinner emotional contradiction. The microtension detector may over-fire on voice-LoRA-routed runs. **Recommend:** A/B the detector on a 3-chapter Salvatore-routed romance-drama run before treating it as blocking; calibrate threshold per `WRITER_GENRE_PACKS`. Andre's call on whether to ship blocking or advisory in Tranche 1.

**Q4. PromiseRegistry: how aggressive should "dangling promise" warnings be?**
LitRPG conventions allow promises to span multiple books (a tier promised in Book 1 may be paid in Book 3). The harness currently produces single books. **Recommend:** distinguish `book_internal` promises (must close in this book) from `series_carrying` promises (can defer with explicit acknowledgment). Andre to specify the series-vs-novel scope policy.

**Q5. Concept-phase upstream expansion: how much human-in-the-loop?**
Snowflake's logline → paragraph → disaster manifest is by tradition human-driven. The harness is currently auto-mode-by-default. **Recommend:** make the upstream expansion a `plan-assist` gate by default for new seeds, auto-mode opt-in. The `planning-conversationalist` already does some of this work informally; making the artifacts explicit lets human override at the highest-leverage point.

**Q6. STC Theme Stated: dialogue-only or visual/situational?**
STC's checker requires `speaker != POV`. Brody acknowledges visual Theme Stated works better. **Recommend:** allow either; checker validates *presence* of theme content in the 4-7% range. Andre to decide whether to enforce dialogue specifically or allow flexibility.

**Q7. LitRPG vs progression-fantasy-Western default routing.**
Cradle-shape (no system blocks, tier ladder only) vs Defiance-of-the-Fall-shape (system blocks, level-up porn). Different obligatory beats, different reader expectations. **Recommend:** default to `progression-fantasy-western` for fantasy seeds; require explicit `litrpg-*` flag for system-block-style. Andre's call given commercial focus.

**Q8. Brooks's "no new entities post-SPP" with character_introductions in subgenre conventions.**
Mystery genre often introduces the killer-as-revealed-late. Some epic fantasy series introduce significant antagonists late. **Recommend:** soft for mystery + epic-fantasy seeds; hard for commercial three-act seeds. Andre to choose the per-genre default.

**Q9. Tranche ordering — is "concept upstream expansion" really Tranche 3?**
Architecturally it's the foundation. But Tranche 1 (per-beat checks) is faster to ship and produces immediate value. There's a case for swapping Tranche 1 and Tranche 3. **Recommend:** Tranche 1 first because the value-shift / microtension / Browne-King wins are immediately visible in output and ship in 1.5 weeks; Tranche 3 has higher long-term leverage but takes longer. Andre to confirm priority.

**Q10. How much of the "what to NOT encode" list should be enforced as hard suppressions vs. soft warnings?**
Each mitigation (tragedyMode flag, voice-LoRA calibration, mystery-subgenre softening) is a configuration knob. The harness can either expose them as seed-level config (manual override) or auto-detect (heuristic). **Recommend:** expose as `seed.directives.suppressions[]` for explicit manual control; layer auto-detection later. Andre to decide whether genre-detection is in scope.

---

## Appendix A — Convergence count by framework

| Framework | Strong convergences | Unique contributions |
|-----------|---------------------|----------------------|
| Coyne (Story Grid) | 5 (change/value-shift, beats-at-percentage, microtension, conservation, genre obligations) | Foolscap-as-spreadsheet; commandment classification |
| McKee (Story) | 5 | Negation of the negation; the Gap mechanic |
| Sanderson (BYU) | 5 | MICE balanced-parens; Three Laws of Magic; 2-of-4 scene check |
| Weiland | 4 | Percentage-locked beat sheet; arc-state-per-beat trajectory |
| Truby | 4 | Character web; 22-step coverage; psych/moral need split |
| Maass | 3 | Microtension; productive contradictions; third-level emotion |
| Yorke | 4 | Fractal at every scale; want/need as epistemic |
| STC (Brody) | 4 | 15-beat % calculator; B-Story character; Six Things |
| Brooks | 4 | Concept/premise/theme split; no-new-entities-post-SPP; 4-part hero modes |
| Snowflake | 3 | Iterative-expansion conservation; disaster manifest |
| Lisle | 3 | But/therefore test; bright-light protection; plot-clinic symptoms |
| Swain | 3 | MRU body→reflex→action order; G C+ D R Dl Dc T tag schema |
| Browne-King | 1 | ~30 deterministic prose lints |
| Harmon | 1 | Four diagonal mirror pairs |
| LitRPG | 3 | progressionLadder; systemVoice; literal PromiseRegistry |

---

## Appendix B — Cost summary

| Tranche | LLM cost / novel | Effort | Cumulative cost |
|---------|------------------|--------|-----------------|
| Baseline (current pipeline) | ~$0.50-2.00 | — | ~$0.50-2.00 |
| Tranche 1 (value-shift / microtension / BK lints) | +$0.10 | 1.5 weeks | ~$0.60-2.10 |
| Tranche 2 (PromiseRegistry / MICE / scene-functions) | +$0.05 | 1.5 weeks | ~$0.65-2.15 |
| Tranche 3 (concept upstream / character web / Lie-Truth-Want-Need) | +$0.02 | 2 weeks | ~$0.67-2.17 |
| Tranche 4 (Tier-2 lints / Maass / LitRPG-specifics) | +$0.05 | 2 weeks | ~$0.72-2.22 |

All four tranches: +$0.22/novel marginal cost, 7 weeks of effort, on top of existing pipeline. Well within budget.

---

*End of synthesis.*
