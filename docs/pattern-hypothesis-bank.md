---
status: active
updated: 2026-04-30
---

# Pattern Hypothesis Bank

Forward queue of corpus patterns to mine. Ranked by expected harness leverage. Each row records the hypothesis, the methodology (pure compute / LLM classification), the harness lever it would feed, and the leverage tier (HIGH / MEDIUM / LOW). Roughly sorted by tier then by "obvious next step" precedence.

The harness-tuning-roadmap is the *active queue* (patterns 1–60 with verdicts); this doc is the *backlog* (patterns 61+ that are hypothesized but not yet measured). When a hypothesis here graduates to a measurement, it gets a row in the roadmap and (after run) a verdict in `pattern-registry.json`.

## Recently landed (shipped since bank construction — DO NOT re-spawn)

The 2026-04-30 mega-batch landed 17 patterns. The 11 candidates below were on this bank and have shipped under the harness numbers shown:

| Bank # | Hypothesis | Shipped as | Verdict |
|---|---|---|---|
| 55 | Past-perfect density | **P55** | PASS_PARTIAL |
| 56 | Body-part vocabulary | **P56** | PASS_PARTIAL (v2 sensitivity) |
| 57 | Pronoun + negation density | **P57** | PASS_PARTIAL |
| 58 | Italics / emphasis usage | **P58** | KILL — italics stripped at ingest |
| 59 | Question-mark density | **P59** | PASS_PARTIAL |
| 60 | Comma + clause-count | **P60** | PASS_PARTIAL |
| 61 (bank) | Free indirect discourse | **P68** | PASS |
| 62 (bank) | Camera/POV closeness | **P67** | DIVERGE / HOLD |
| 63 (bank) | Combat verb-chain sequences | **P66** | PASS_PARTIAL |
| 64 (bank) | Showing-vs-telling ratio | **P64** | PASS_PARTIAL |
| 66 (bank) | Word repetition windowing | **P71** | PASS_PARTIAL |
| 67 (bank) | Character thought-attribution | **P69** | DIVERGE (Drizzt + Regis stable; rest unstable) |
| 69 (bank) | Em-dash placement patterns | **P70** | PASS_PARTIAL |

Plus 4 candidates not pre-listed but mined opportunistically: **P61** verb tense distribution, **P62** simile density, **P63** compound-hyphenated modifiers, **P65** per-character voice signature (PASS).

## Pattern numbering convention going forward

The next available pattern numbers are **P72, P73, ...**. The bank entries below preserve their original numbering for reference; **when graduating an entry to a measurement, allocate the next-available canonical number** (start at P72).

## High-leverage queue

These hypotheses target either the writer-prompt voice imitation surface or the planner-prompt structural prior surface — both currently have multiple stable Salvatore patterns and would benefit from additional dimensions.

### P61: Free indirect discourse signatures

- **Hypothesis**: Salvatore uses free-indirect-discourse (FID) — narration that adopts the POV character's idiom while remaining in third person — at measurable density and with stable per-kind distribution. Predict: interiority kind has the highest FID density; FID rises in tense scenes (correlates with stake-escalation P20).
- **Methodology**: LLM classification (Sonnet preferred — multi-axis "is this sentence narrator-voiced or character-voiced") on a sampled subset. Anchor-stability check at beat granularity required (J ≥ 0.85 cap).
- **Harness lever**: Writer-prompt prior on POV-character voice register (when POV is X, narration uses X's idiom). Could be added to `beat-writer-system.md` as a "POV-aligned voice" instruction.
- **Tier**: **HIGH** — directly addresses character-distinctness (named follow-on from voice-shaping KILL 2026-04-30).

### P62: Camera/POV closeness per kind

- **Hypothesis**: Within each beat-kind, Salvatore varies camera distance (close-third / medium / distant). Predict: action and interiority skew close; description skews medium; dialogue is mixed. The per-kind closeness ranking is cross-book stable.
- **Methodology**: LLM classification (DeepSeek V4 Flash for primary axis; Sonnet anchor on a subset). Per-beat label `camera_distance: close | medium | distant`.
- **Harness lever**: Writer-prompt per-kind camera prior (e.g., "action beats: close camera; describe POV's body sensations"). Pairs with P52 (POV distribution) and P34d (interiority markers).
- **Tier**: **HIGH**.

### P63: Combat verb-chain sequence patterns

- **Hypothesis**: Action beats have a stable sub-pattern: motion verb → impact verb → reaction verb. Goes beyond P34b's frequency lexicon to a sequence signature. Predict: the trigram of action-verb categories within a 2-3-sentence span clusters around `[motion, contact, recoil]` more often than chance.
- **Methodology**: Pure compute. Tag verbs in action-kind beats by category (motion / contact / recoil / utterance / cognition) using a small lexicon, count trigram frequencies, compare to a chance baseline.
- **Harness lever**: Writer-prompt action-prose prior. Could underpin a fewshot block under the Salvatore-LoRA route. Pairs with P34b (action verb lexicon) — adds a sequence layer to the frequency layer.
- **Tier**: **HIGH** — extends an already-PASS pattern (P34b).

### P64: Showing-vs-telling ratio

- **Hypothesis**: Salvatore's prose has a measurable concrete-sensory-vs-abstract-reporting ratio. Predict: ratio is cross-book stable; varies by kind (action highest concrete; interiority mixed; description highest concrete; dialogue lowest concrete because dialogue is reported speech).
- **Methodology**: LLM classification per beat (Sonnet anchor — borderline cases are common). Categories: "concrete sensory" / "abstract reporting" / "mixed". Anchor-stability gate required.
- **Harness lever**: Writer-prompt concrete-sensory ratio target. Pairs with P53 (sensory mode density) and P34d (interiority markers).
- **Tier**: **HIGH** — addresses a craft principle ("show don't tell") that many prose-style guides cite.

### P65: Verb tense slips

- **Hypothesis**: Salvatore stays in past tense across the whole trilogy with very rare slips into present tense. Predict: per-100w slip count is < 0.05 across all books; slips concentrate in dialogue (where present tense is grammatical for ongoing speech).
- **Methodology**: Pure compute. Tag every verb's tense via a small lexicon + suffix patterns (-ed past, -s/-ing present), normalize per 100w by kind.
- **Harness lever**: Lint rule. Detect present-tense verbs in narration (non-dialogue) at density > corpus ceiling and flag for rewrite. Likely a low-fire-rate but high-confidence rule.
- **Tier**: **MEDIUM** — narrow lint target but reliable.

## Medium-leverage queue

### P66: Word-repetition windowing

- **Hypothesis**: Salvatore avoids repeating content words within a small window (e.g., 50–80 tokens) at a measurable rate. Predict: repetition rate within 80-token window is below a corpus-stable ceiling; common function words (the, a, of) excluded.
- **Methodology**: Pure compute. Sliding-window content-word repetition counter; per-book rate per 1k words.
- **Harness lever**: Lint detector — extends the existing `src/lint/quality-detectors.ts` `detectRepetitionLoop` to a corpus-calibrated threshold.
- **Tier**: **MEDIUM**.

### P67: Character thought-attribution patterns

- **Hypothesis**: Salvatore distinguishes "X thought" / "X knew" / "X realized" / "X considered" with a stable per-character ranking. Predict: Drizzt's interiority is dominantly "knew" (corroborates P34d "knew" finding); Bruenor's is dominantly "thought" or "decided"; Wulfgar's is dominantly "felt".
- **Methodology**: Pure compute. Regex-tag attribution verbs in interiority beats; aggregate per-character.
- **Harness lever**: Writer-prompt per-character interiority verb prior — feeds the character-distinctness audit (named follow-on 2026-04-30).
- **Tier**: **MEDIUM** — narrow but character-distinguishing.

### P68: Direct vs indirect thought representation

- **Hypothesis**: Salvatore uses both direct interior thought (italicized in original; lost at ingest) and indirect ("X knew Y") at a stable ratio. Predict: indirect dominates ~80%; the ratio is per-character (Drizzt skews more direct than the others).
- **Methodology**: BLOCKED on italics ingest (P58 KILL). Re-ingestion with markdown emphasis preserved is the gate. After re-ingest, pure compute on `*phrase*` markers.
- **Harness lever**: Writer-prompt internal-thought formatting prior; would pair with P34d.
- **Tier**: **MEDIUM** — high potential lever, but blocked.

### P69: Em-dash placement patterns (interaction with P42)

- **Hypothesis**: Em-dashes are kind-heavy (P42 PASS) and have stable placement signatures within a sentence: most often parenthetical-aside (mid-sentence), sometimes interruption (end-sentence in dialogue), rarely list-introducer.
- **Methodology**: Pure compute. Tag em-dash position within sentence (start/mid/end), per-kind aggregation.
- **Harness lever**: Lint rule extension — `lint.em_dash_in_action` becomes `lint.em_dash_position_in_action` with finer granularity.
- **Tier**: **MEDIUM** — refines existing PASS pattern.

### P70: Pronoun reference-resolution distance

- **Hypothesis**: Salvatore keeps pronoun antecedents close — most "he/she/it" references resolve within 1–2 sentences of their antecedent. Predict: 80%+ of pronouns resolve within 2 sentences; long-distance references (5+ sentences) are < 5%.
- **Methodology**: LLM classification (Sonnet — coreference is hard). Per-pronoun: distance to nearest plausible antecedent in tokens or sentences.
- **Harness lever**: Lint rule + writer-prompt prior. Long-distance pronoun = potential ambiguity.
- **Tier**: **MEDIUM** — useful but anchor-stability gate is expensive.

### P71: Setting infodump distribution

- **Hypothesis**: Salvatore avoids monolithic setting paragraphs ("the city of Bryn Shander rose…") in favor of distributed setting cues. Predict: 90%+ of setting beats have ≤ 30% of words devoted to fresh setting; long infodumps are concentrated in chapter-opens (P38 setting tags at scene-opens).
- **Methodology**: LLM classification. Per beat: % of words that are pure setting/description (vs character action, dialogue, etc.).
- **Harness lever**: Writer-prompt setting-distribution prior. Pairs with P38 and P11.
- **Tier**: **MEDIUM**.

### P72: Description chunking — single-paragraph vs spread

- **Hypothesis**: Salvatore distributes description across multiple short paragraphs more often than a single long paragraph. Predict: median description-paragraph length is shorter than median action-paragraph length; per-kind distribution holds.
- **Methodology**: Pure compute on paragraph breaks. **BLOCKED** on the same paragraph-ingest issue that broke P29 (CS+HG soft-wrapped, no `\n\n`). Re-ingest gate.
- **Harness lever**: Writer-prompt paragraph-length prior; pairs with P29.
- **Tier**: **MEDIUM** but blocked.

## Lower-leverage / exploratory queue

### P73: Sentence-final punctuation distribution per kind

- **Hypothesis**: Period:question:exclamation ratios per kind are cross-book stable. Refines P59 (question density) into the full closer-distribution.
- **Methodology**: Pure compute.
- **Harness lever**: Lint rule (action-kind exclamation density floor; description-kind exclamation density ceiling).
- **Tier**: **LOW** — likely just refines P59.

### P74: Adjective stacking per noun

- **Hypothesis**: Salvatore avoids long adjective chains ("the dark, brooding, cold, ancient stone"). Predict: 90%+ of nouns have ≤ 1 modifying adjective; chains of 3+ are < 1%.
- **Methodology**: Pure compute (POS tagging or simple "comma-separated adjectives before noun" regex).
- **Harness lever**: Lint rule.
- **Tier**: **LOW**.

### P75: Dialogue beat split pattern (alternation rhythm)

- **Hypothesis**: In dialogue-kind beats, the alternation between speakers (turn count) follows a stable cadence — pairs with P35 (chunk shape). Predict: median turn count is 4–6, very few beats have a single speaker monologue, very few have 10+ rapid turns.
- **Methodology**: Pure compute (parse quoted segments + attribution).
- **Harness lever**: Writer-prompt dialogue-rhythm prior.
- **Tier**: **LOW** — likely subsumed by P35.

### P76: First-person plural usage

- **Hypothesis**: Salvatore uses "we/us/our" rarely outside dialogue; in dialogue, it's a marker of in-group speech (Companions of the Hall). Predict: 90%+ of plural-first-person tokens are within quoted speech.
- **Methodology**: Pure compute.
- **Harness lever**: Writer-prompt prior; may feed character-distinctness work.
- **Tier**: **LOW**.

### P77: Anaphora / parallelism patterns

- **Hypothesis**: Salvatore uses sentence-start anaphora ("And. And then. And there.") at a measurable rate, especially in interiority beats (corroborates P39 conjunction-first-as-interiority signature).
- **Methodology**: Pure compute. Detect 2+ consecutive sentences starting with the same word; per-kind density.
- **Harness lever**: Writer-prompt rhythm prior.
- **Tier**: **LOW**.

### P78: Color word distribution

- **Hypothesis**: Salvatore uses a constrained color palette — predict: top-10 color words cover 80%+ of color-word tokens; cross-book stable.
- **Methodology**: Pure compute. Lexicon-based.
- **Harness lever**: Writer-prompt setting prior; pairs with P38 (time-of-day defaults — e.g., night-modal corpus → cool color palette).
- **Tier**: **LOW**.

### P79: Abstract noun density (interiority anchoring)

- **Hypothesis**: Salvatore anchors abstract nouns (rage, fear, doubt, faith) to concrete sensory pairings. Predict: ~70%+ of abstract-noun mentions are paired with a concrete sensory verb within the same sentence.
- **Methodology**: LLM classification — anchor required.
- **Harness lever**: Writer-prompt prior; pairs with P64 (showing-vs-telling).
- **Tier**: **LOW** — high effort, niche payoff.

### P80: Number / quantity expression

- **Hypothesis**: Salvatore prefers spelled-out numbers under 100 ("forty leagues") and digit form for larger ("a thousand years"). Predict: cross-book stable convention.
- **Methodology**: Pure compute.
- **Harness lever**: Lint rule (style consistency).
- **Tier**: **LOW**.

## Sequencing suggestions

When the user resumes corpus mining, the prioritized order is:

1. **P61, P62, P64** (HIGH, all writer-prompt voice imitation) — these directly support the character-distinctness audit named as the next step after the 2026-04-30 voice-shaping KILL.
2. **P63** (HIGH, action-prose sequence) — extends the already-PASS P34b verb lexicon work; high impact for fantasy genre.
3. **P67, P71** (MEDIUM, character + setting distribution) — fill gaps in character-distinctness and setting-infodump priors.
4. **P65, P66, P69** (MEDIUM, lint targets) — narrow but reliable; cheap to mine.
5. **P68, P72** (BLOCKED on re-ingest) — schedule together with the italics + paragraph-break re-ingest charter.

Patterns P73–P80 are exploratory; mine them only if a higher-tier hypothesis surfaces a related question.
