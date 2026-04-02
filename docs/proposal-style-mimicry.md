---
status: proposal
verified: 2026-04-02
---

# Proposal: Author Style Mimicry for Fanfiction

## Goal

Enable the harness to produce prose that mimics the stylistic patterns of a specific author, for personal fanfiction use. The approach focuses on extracting **concrete, measurable patterns** rather than asking models to "write like Author X" (which produces shallow pastiche).

## Why Concrete Patterns Over Vibes

LLMs are bad at holistic imitation but good at following structural constraints. "Write like Ursula Le Guin" produces generic literary fiction. "Use 60% short declarative sentences, favor tactile over visual sensory detail, end scenes on ambiguity rather than resolution" produces something measurably closer to the actual style.

## Architecture

Four components, layered on top of the existing harness.

### 1. Style Extractor (new agent or offline tool)

A new agent (or standalone script) that takes sample passages from a target author and extracts a structured **style profile**.

**Input:** 5-10 representative passages (1000-2000 words each), pasted or loaded from files.

**Output:** A JSON style profile covering:

| Category | Example Patterns |
|---|---|
| **Sentence structure** | Average length, length distribution (short/short/long rhythm), fragment frequency, compound sentence rate |
| **Dialogue style** | Dialogue-to-narration ratio, average exchange length, tag style (said vs. bookisms vs. untagged), subtext level |
| **Sensory channels** | Which senses dominate (visual/auditory/tactile/olfactory/gustatory), sensory density per paragraph |
| **Paragraph rhythm** | Action-reflection balance, interiority ratio, paragraph length distribution |
| **Punctuation & mechanics** | Em dash frequency, semicolons, ellipses, sentence fragments as stylistic choice |
| **Narrative distance** | Close psychic distance vs. panoramic, frequency of direct thought, tense patterns |
| **Figurative language** | Metaphor density, simile style (literary vs. grounded), personification tendencies |
| **Pacing** | Scene-to-summary ratio, time compression patterns, chapter/section break rhythm |

**Storage:** `src/seeds/styles/` or a `style_profiles` table in harness.db. One profile per author.

**Approach options:**
- **LLM extraction:** Feed passages + a structured rubric, get back a style profile. Fast, might miss subtleties.
- **Hybrid:** LLM extraction + deterministic analysis (sentence length stats, punctuation counts, dialogue ratio). More reliable for quantitative patterns.
- **Manual curation:** Human reads the author, fills in the profile. Most accurate, least scalable.

Recommendation: hybrid. Use deterministic tools for anything countable, LLM for qualitative patterns (subtext level, narrative distance, figurative language style).

### 2. Writer Prompt Integration

The style profile feeds into the writer agent via `context.ts`, injected as concrete constraints in the system prompt.

**How it works:**
- `context.ts` loads the active style profile (from seed config or CLI flag)
- Converts the JSON profile into natural-language writing rules
- Appends these rules to the writer's system prompt alongside the existing methodology rules

**Example injected block:**
```
## Style Constraints (target: Le Guin)
- Sentence length: average 14 words. Alternate 2-3 short declarative sentences with one longer compound sentence.
- Sensory: favor tactile and auditory over visual. Minimum 2 non-visual sensory details per paragraph of description.
- Dialogue: 35% of word count. Mostly untagged or "said." No bookisms. Subtext over directness.
- Fragments: use sentence fragments for emphasis, 1-2 per page equivalent.
- Metaphor: grounded in the physical world (nature, craft, body). Avoid abstract/literary metaphors.
- Narrative distance: close third, frequent direct thought without italics.
- Pacing: end scenes on ambiguity or quiet tension, not resolution.
```

**Key consideration:** These rules interact with the existing methodology rules in `prompt.md`. Some may reinforce each other (both might discourage filter words), others may conflict (methodology says "avoid fragments as dead weight" but the style profile says "use fragments for emphasis"). The style profile should take precedence when there's a conflict — it's the more specific constraint.

### 3. Style-Aware Judging

Adapt the existing benchmark judges to evaluate against the style profile rather than (or in addition to) generic quality.

**Penalty judge modifications:**
- Load the active style profile as context
- Adjust what counts as a flaw based on the profile. If the target author uses lots of em dashes, don't penalize em dashes. If they never use filter words, penalize filter words harder.
- Add new dimensions: "Style Adherence" (does the prose match the extracted patterns?)

**Pairwise judge (most valuable):**
- Compare generated passages against actual author excerpts
- Rubric: "Which passage more closely matches these style patterns: [profile]?"
- This catches emergent qualities that individual metrics miss
- Position-bias correction already built in

**New benchmark dimension: Style Distance**
- Quantitative: measure sentence length distribution, dialogue ratio, sensory channel usage against the profile targets
- Qualitative: LLM judge rates adherence to each qualitative pattern
- Combined score gives a single "how close are we" metric

### 4. Iteration Loop

Uses the existing experiment workflow. No new infrastructure needed.

```
1. Extract style profile from author samples
2. Inject into writer prompt
3. Run benchmark (style-aware penalties + pairwise vs. real excerpts)
4. Identify which patterns the model nails vs. ignores
5. Strengthen/rephrase rules the model ignores
6. Re-run benchmark
7. Repeat until pairwise judge can't reliably distinguish
```

The existing `EXPERIMENT_ID` tracking, `tuning_experiments` table, and `/diagnose` workflow all apply directly.

## What's Hard

**Emergent qualities:** Some author qualities emerge from combinations of patterns. You can match every measurable dimension and still not capture the "feel." Pairwise comparison against real excerpts is the best tool for catching this, but it may have a ceiling.

**Style vs. content separation:** The profile should capture *how* an author writes, not *what* they write about. An author's style applied to different subject matter is the whole point of fanfiction, so the extractor needs to cleanly separate stylistic patterns from thematic ones.

**Model capability floor:** In the main harness, methodology rules only helped capable models (Kimi K2 improved, Qwen3 32B didn't). Style mimicry likely has an even higher capability floor — the model needs enough control over its own output to follow 15+ simultaneous structural constraints.

**Interaction with existing quality rules:** The methodology rules in `prompt.md` are tuned for general prose quality. Author-specific style may intentionally violate some of them (e.g., an author who uses telling effectively, or one who writes deliberately purple prose). Need a clean precedence model.

## Scope Estimate

- **Style extractor agent:** New agent, similar complexity to fact-extractor. Schema + prompt + context builder.
- **Deterministic style analyzer:** New script for countable patterns (sentence lengths, punctuation stats, dialogue ratio). Moderate effort.
- **Writer integration:** Small change to `context.ts` — load and format style profile.
- **Judge modifications:** Medium effort — new dimension, profile-aware penalty adjustments.
- **Pairwise against real excerpts:** Small change — load author samples as comparison targets.

## Dependencies

None hard. Could be built incrementally:
1. Manual style profile + writer prompt injection (immediate value, minimal work)
2. Style-aware pairwise judging (enables measurement)
3. Automated style extraction (enables scaling to multiple authors)
4. Penalty judge integration + style distance metric (enables automated iteration)

## Open Questions

- How many sample passages are needed for a reliable style profile? Probably 5-10, but needs testing.
- Should style profiles version over time (authors evolve)? Probably overkill for personal use.
- Can multiple author styles blend? (e.g., "Le Guin's sentence structure with Rothfuss's sensory density") Theoretically yes, but likely produces mud.
- Where do style profile files live? `src/seeds/styles/` keeps them near the creative inputs. A DB table enables querying but adds complexity for something that changes rarely.
