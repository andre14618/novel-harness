---
status: draft (pending Codex R5 adversarial review)
kind: experiment-charter
name: corpus-structural-decomposition-v1
owner: andre
date: 2026-04-29
revision: 5
pre-gate: 1 LitRPG novel PDF on disk (local or LXC) before R5 review.
parent-context: docs/research/writing-frameworks/SYNTHESIS.md, docs/corpus-pipeline.md, docs/todo.md "Three-bucket forward plan"
adversary-verdict:
  R1: RED (codex:codex-rescue gpt-5.5 effort=high, agent a2dfdb5c339c911f8, 2026-04-29) — premature 6-extractor build. Cheapest counterfactual: "Stratified Top-2 Calibration Pilot, ~$2-4."
  R2: YELLOW (codex:codex-rescue gpt-5.5 effort=high, agent aed14f4069c607b16, 2026-04-29) — 3 protocol-level blockers + 3 warnings + 2 suggestions. Pilot architecturally on track.
  R3: YELLOW (codex:codex-rescue gpt-5.5 effort=high, agent a78a3f201ecc4bf63, 2026-04-29) — 3 source-shape blockers + 6 warnings + 2 suggestions.
  R4: YELLOW (codex:codex-rescue gpt-5.5 effort=high, agent afcade8df722c3a13, 2026-04-29) — R4 resolved all R3 issues correctly (verified). 2 NEW blockers from deeper file inspection: source-normalization spec drops epilogue chapters (92 rows in beats.jsonl have chapter ∈ {epilogue, epilogue2, epilogue3}, plus streams_of_silver has part1/part2/part3); sort key references nonexistent `scene_idx` field (real field is `scene_id`). 3 warnings (NER pipeline unnamed; F1≈1−d not a real multi-class bound; LitRPG ingest reserve range). Recommended action: ITERATE-R5.
---

# Experiment Charter — `corpus-structural-decomposition-v1`

## 0. Tl;dr (R5 — calibration pilot, full-domain corpus normalization)

**R5 closes the deeper source-shape gaps Codex R4 caught from direct file inspection: epilogue/part chapters (92+ rows) and `scene_id`-not-`scene_idx`. R4's normalization spec was incomplete; R5 replaces it with a per-book label-domain mapping that handles the full set of observed chapter labels.**

R1 (RED) attempted 5–10 books × 6 extractors as a decision-grade priors document; rejected for premature full-build, mixed strata, uncalibrated CV gate, confidence-gated encodeability. R2 (YELLOW) collapsed to a 2-book × 2-dimension calibration pilot; rejected for unanchored F1 thresholds, undefined PromiseRegistry scoring unit, and gold-baseline reliability not measured. R3 keeps R2's scope and tightens the protocol:

- **2 books**: 1 LitRPG (TBD; pre-gate) + 1 fantasy (Salvatore *Crystal Shard* from existing `novels/salvatore-icewind-dale/`).
- **2 framework dimensions**: per-scene **value-charge** (5-framework convergence per SYNTHESIS.md §2; ranked Lever #2) + per-novel **PromiseRegistry** (3-framework convergence per SYNTHESIS.md §1).
- **Cost-function-anchored thresholds (R3 §1)**: value-charge is precision-first (false-positive constraint > false-negative miss); PromiseRegistry is recall-first (missing real promises > inventing fake ones). Thresholds anchored to halluc-checker-v3 production precedent (77.8 P / 85.4 R / 81.4 F1, `docs/decisions.md` "Hallucination-checker v3 two-adapter architecture").
- **PromiseRegistry scoring unit defined (R3 §2)**: per-promise rows, normalized-text + chapter-window matching policy, fixed `payoff_quality` enum.
- **Adjudicator-drift guard (R3 §3)**: 10% of gold rows silently retested; > 15% self-disagreement triggers a NULL-GOLD verdict (single-rater not viable for that dimension; require 2-human follow-on).
- **Stratum-differ language downgraded (R3 §7)**: at n=1/stratum, "STRATA-DIFFER" is a directional book-effect screen, NOT genre-level evidence. Follow-on charters need n≥2/stratum to claim genre.
- **Budget reconciled (R3 §8)**: ~$1.50 LLM, ~5 working days calendar.

The pilot answers a different question than R1's full charter: "are our extractors reliable enough for any framework prescription to be encodeable?" If pilot CELL PASS, a follow-on charter scopes to the full 6-dim × 8-book run with calibrated extractors. If pilot FAIL, we close the structural-encoding bucket and pivot Bucket 3 to per-book imitation rather than generic constraints.

This is a **read-only** pilot — no runtime-pipeline impact, no harness changes.

## Pivot history

- **R1 (RED):** Codex (`a2dfdb5c339c911f8`, gpt-5.5 effort=high) flagged 4 blockers + 3 warnings. Named cheapest counterfactual: "Stratified Top-2 Calibration Pilot, ~$2-4." Recommended action: RUN CHEAPER COUNTERFACTUAL.
- **R2 (YELLOW):** Codex (`aed14f4069c607b16`, gpt-5.5 effort=high) confirmed scope-pivot landed cleanly (R1 attack surfaces 3, 4, 5, 7, 9 closed). 3 remaining blockers were protocol-level. Recommended action: revise.
- **R3 (YELLOW):** Codex (`a78a3f201ecc4bf63`, gpt-5.5 effort=high) found 3 source-shape blockers: (1) the §2 PromiseRegistry invariant "every promise must have evidence in chapters 1–25%" is not supported by SYNTHESIS.md and would mark legit mid-book promises as errors; (2) the field selectors `book_id=crystal-shard` don't match the actual corpus (real fields: top-level `book` in scenes/beats, nested `brief.book` in pairs); (3) `beats.jsonl` is not in narrative order, breaking PromiseRegistry's full-novel reasoning. 6 warnings + 2 suggestions. Recommended action: ITERATE-R4.
- **R4 (YELLOW):** Codex (`afcade8df722c3a13`, gpt-5.5 effort=high) confirmed all R3 issues resolved correctly. Found 2 NEW source-shape blockers from deeper file inspection: (a) `beats.jsonl` has `epilogue/epilogue2/epilogue3` chapter labels (92 rows in crystal_shard alone) plus `streams_of_silver` has `part1/part2/part3`, none in `verification.json.chapters_found` — R4's `[prelude, 1..N]` canonical ordering would silently drop these; (b) sort key referenced `scene_idx` but real field is `scene_id`. 3 warnings + 2 suggestions. Recommended action: ITERATE-R5.
- **R5 (this revision):** integrates both R4 blockers + 3 warnings + 2 suggestions. Source normalization rewritten with per-book full-domain chapter-label mapping; sort key uses `scene_id`-derived `scene_ordinal`. PromiseRegistry chapter fields now carry both raw label and canonical index. NER pipeline named explicitly. F1 bound reframed as intuition.

## 1. Question (R3 — cost-function-anchored)

**Primary (calibration question):** Are LLM extractor agents reliable enough to produce structural framework tags at a precision/recall floor that supports downstream "encodeable as planner constraint" decisions, given the asymmetric cost of false-positive vs. false-negative tags per dimension?

**Operationalized:** for the 2 highest-convergence dimensions in `docs/research/writing-frameworks/SYNTHESIS.md`:

1. **Per-scene value-charge** (Coyne + McKee + Yorke + Truby + Swain converge — SYNTHESIS.md §2): `{valueIn ∈ {+,−,0}, valueOut ∈ {+,−,0}, lifeValue: enum, polarity ∈ {+,−,0}, confidence: float, evidence_quote: string, abstain_reason: string | null}`.
2. **Per-novel PromiseRegistry** (Sanderson + Lisle + LitRPG converge — SYNTHESIS.md §1): array of per-promise rows; full schema in §2.

Compute per-extractor per-stratum: precision, recall, F1 vs. human-adjudicated gold subset.

### Cost-function asymmetry per dimension (R2 blocker 1 fix — anchored to halluc-v3 precedent)

The downstream cost function for each dimension is asymmetric:

- **value-charge → planner constraint (precision-first).** A false-positive tag (extractor says "value shifted +→−" when it didn't) creates a planner constraint that the writer either ignores (low cost) or follows incorrectly (medium cost — bad prose). A false-negative tag (missed real shift) is a missed constraint that's not enforced (low cost — "we already weren't enforcing it"). Therefore: **precision matters more than recall.**
- **PromiseRegistry → planner constraint (recall-first).** A false-positive promise creates a constraint to "pay off something that wasn't actually promised" — the writer fabricates resolution (medium-high cost). A false-negative miss leaves a real promise un-enforced — the writer leaves a thread dangling (high cost; this is exactly the failure mode the registry exists to prevent). Therefore: **recall matters more than precision.**

### Production precedent: halluc-checker-v3

The cited production-clearing checker baseline is **halluc-v3 at P=0.778 / R=0.854 / F1=0.814** (`docs/lessons-learned.md` "Hallucination-checker v3 two-adapter architecture" — R3 W1 fix: this trio is in `lessons-learned.md`, not `decisions.md`. `decisions.md` carries the v2 natural-val regression `77.8 / 51.2 / 61.8` which is a DIFFERENT data point not used here.) Pilot thresholds are anchored to this precedent with cost-function asymmetry:

**Hypothesis (template-compliant):**

> H1 (value-charge, precision-first): The value-charge extractor will achieve **P ≥ 0.78 AND R ≥ 0.65 AND F1 ≥ 0.71** on its human-adjudicated gold subset, computed separately per stratum.
>
> H2 (PromiseRegistry, recall-first): The PromiseRegistry extractor will achieve **R ≥ 0.80 AND P ≥ 0.65 AND F1 ≥ 0.71** on its human-adjudicated gold subset, computed separately per stratum.

**Threshold rationale:**
- The matched-floor metric per dimension (P=0.78 for value-charge; R=0.80 for PromiseRegistry) sits AT the halluc-v3 precedent value — both are pilot-acceptable production-equivalent floors for the dimension's lead metric.
- The off-axis metric (R=0.65 for value-charge; P=0.65 for PromiseRegistry) is RELAXED below halluc-v3 because the cost asymmetry tolerates more error on the off-axis. 0.65 is the minimum for the dimension to be "useful as a directional signal" (better than chance on a binary judgment with class balance ~50/50).
- F1 ≥ 0.71 (versus halluc-v3's 0.814) reflects that corpus extraction is harder than hallucination check (longer context, more dimensions per call), AND the calibration pilot is gating "is this worth scaling," not "is this worth shipping to production." A future production-deployment charter would tighten F1 ≥ 0.81 to match halluc-v3 fully.

**Falsification:** both extractors fall below their dimension's hypothesis on at least one stratum. Verdict: extractor-based framework tagging is not reliable enough at the matched cost function; close the corpus-structural-tagging family and pivot Bucket 3 to per-book voice-LoRA imitation.

**Secondary (stratification question, pre-registered, R2 warning 2 fix):** does extractor F1 differ by stratum by ≥0.10 absolute? If YES, this is **directional book-effect signal**, NOT genre-level evidence — the n=1/stratum sample doesn't separate book from genre. Follow-on charters MAY use this as a scoping signal but MUST verify with n ≥ 2 books per stratum before treating it as genre-level. Stratum-differ does NOT trigger any binding "MUST run per-stratum" rule on follow-ons.

**Tertiary (CV-CI sanity check, pre-registered):** for the value-charge `polarity` distribution, compute observed CV at n=2 books with 95% CI. The CI is expected to span [0.3, 1.0]+ at this n. This is reported as the empirical anchor for "n must grow before any distribution claims," NOT as a verdict input.

**This pilot does NOT propose runtime-pipeline changes. It does NOT claim corpus distributions. It produces extractor-reliability evidence only.**

## 2. Scope (R2)

### In scope

- **Corpus**: 2 books, predeclared per stratum:
  - **Fantasy stratum**: `salvatore-icewind-dale` bundle's `crystal_shard` book ONLY. Source files at `novels/salvatore-icewind-dale/{scenes,beats,pairs}.jsonl`. The bundle is a 3-book mixed corpus (Crystal Shard / Streams of Silver / Halfling's Gem); pre-flight MUST materialize per-book slices before Stage 6 runs. **Real selector keys** (R3 B2 fix — verified via direct file read): `scenes.jsonl` and `beats.jsonl` have a top-level `book` field (string, e.g. `"crystal_shard"`); `pairs.jsonl` has `brief.book` (nested). Bundle key uses underscore (`crystal_shard`), NOT hyphen (`crystal-shard`).
  - **LitRPG stratum**: 1 LitRPG novel TBD post-pre-gate. Acquisition candidates: *Cradle Bk1 (Unsouled, Wight)*, *Dungeon Crawler Carl Bk1 (Dinniman)*, *He Who Fights with Monsters Bk1 (Aronica/Shirtaloon)*. Pre-gate (per `docs/charters/salvatore-v5-corpus-expansion.md` §3 pattern):
    - [ ] PDF on disk (local or LXC)
    - [ ] Inventory logged (title, file path, file size sanity check, source)
    - [ ] Stages 1–5 of `corpus-pipeline.md` applied → bundle exists at `novels/<litrpg-key>/{scenes,beats,pairs}.jsonl` + `analysis/`
    - [ ] R4 review only after pre-gate clears

- **2 extractor agents** (R1 had 6; R2 cut to the 2 strongest-converging per SYNTHESIS.md). **All field names below are the canonical schema used by both §2 and §3 (R3 S2 fix — harmonized end-to-end):**
  - **`structure-value-charge-extractor`** — input: per-book-sliced scene briefs from `pairs.jsonl` (filtered by `brief.book == <stratum-book>`) + ±1 chapter context from per-book-sliced `beats.jsonl` (filtered by `book == <stratum-book>`). Output per scene: `{valueIn ∈ {+,−,0}, valueOut ∈ {+,−,0}, lifeValue ∈ <enum>, polarity ∈ {+,−,0}, confidence ∈ [0,1], evidence_quote: string, abstain_reason: string | null}`. `lifeValue` enum drawn from Coyne/McKee shared lexicon: `{life-death, freedom-slavery, justice-injustice, love-hate, truth-lie, power-weakness, hope-despair, success-failure, belief-doubt, identity-unknown, other}`.
  - **`structure-promise-extractor`** — input: per-book-sliced AND **canonically-ordered** chapter beats sequence from `beats.jsonl` (R3 B3 fix — see "Source normalization" below). Output per novel: array of per-promise rows. Each row: `{promise_id: string (UUID), promise_text: string (≤200 chars), opened_chapter: int, closed_chapter: int | null, hint_chapters: int[], payoff_quality ∈ <enum>, evidence_quote_open: string, evidence_quote_close: string | null, confidence ∈ [0,1]}`. `payoff_quality` enum: `{satisfied, partially_satisfied, unsatisfied, unclear}`.

- **PromiseRegistry scoring unit + matching policy (R2 blocker 2 fix)**:

  Scoring is **per-promise row** (not per-novel). The extractor outputs N predicted promises; gold has M adjudicated promises per book. F1 is computed at the row level after pair-matching gold to predictions.

  **Matching policy** (predicted ↔ gold):
  - A predicted promise matches a gold promise IFF ALL THREE conditions hold:
    1. `|predicted.opened_chapter − gold.opened_chapter| ≤ 1` (1-chapter window for chapter-edge ambiguity), AND
    2. text similarity ≥ threshold: `Jaccard token similarity ≥ 0.5` OR `Levenshtein ratio ≥ 0.6` over normalized text (lowercase, strip punctuation, drop function words), AND
    3. **(R3 W2 + R4 W1 fix — actor/object disambiguator with named NER stack):** the predicted and gold promises share at least one named entity (character / object / location) extracted from `promise_text` via a deterministic NER pass. Two promises with high lexical overlap but disjoint entity sets (e.g., "Drizzt promises to free Catti-brie" vs. "Drizzt promises to fight Artemis Entreri") FAIL condition 3 and do NOT match. **NER pipeline (R4 W1 fix)**: hybrid of (a) `spacy en_core_web_sm` for `PERSON | ORG | LOC | GPE` extraction (handles capitalized multi-token names well), AUGMENTED with (b) a lightweight DeepSeek V4 Flash extraction call when spacy returns < 2 entities per promise (~10% of fantasy-prose cases per the harness's existing entity-aware checks). Spacy is the primary; LLM augmentation is the fallback for low-recall fantasy proper nouns. Augmentation cost is amortized into adjudication-helper budget line in §8.
  - **Tie-break (R3 W2 fix)**: when multiple predictions match a single gold (or vice-versa) per conditions 1–3, the adjudicator hand-disambiguates. Tie-break decisions logged in `structure-gold/promises-tiebreaks.jsonl` for audit.
  - Each gold promise matches AT MOST one predicted promise (greedy assignment by combined Jaccard + Levenshtein score, with manual tie-break override).
  - Unmatched predictions → false positives. Unmatched gold → false negatives.
  - **Edge case (degenerate 0-promise novel)**: if gold contains zero promises for a book, the extractor's F1 is undefined for that book; report extractor's predicted-promise count and adjudicate each as either FP or "spurious." Don't propagate undefined F1 to the stratum-aggregate.

  **payoff_quality scoring** (separate from promise-existence F1, secondary):
  - For matched (predicted, gold) pairs only: report `payoff_quality` agreement rate (4-class enum, expected ≥ 0.70 if extractor is calibrated).
  - Free-form text variant rejected per R2 blocker 2.

- **Human-adjudicated gold subset**:
  - **value-charge**: 30–50 random samples per book × 2 books = 60–100 gold rows. Sampled uniformly at random from extractor-output scenes.
  - **PromiseRegistry**: 30–50 hand-identified promises per book (NOT extractor output — adjudicator reads chapter beats fresh and identifies promises directly). For 2 books = 60–100 gold promise rows.
  - Andre adjudicates (sole rater for the pilot — inter-rater κ deferred to follow-on charters with a second human rater).
  - Adjudication recorded in `novels/<key>/structure-gold/{value-charge,promises}.jsonl`.
  - Adjudication BLINDED to extractor output (no priming).
  - Adjudication uses the same schema as the LLM extractor; disagreement at any field is a "miss."

- **Adjudicator-drift guard (R2 blocker 3 fix; R3 W3 grounding)**:
  - 10% of each dimension's gold rows are silently retested: the adjudicator is presented the same source data again (different shuffle order, ≥1 day apart) WITHOUT being told it's a retest.
  - Self-disagreement rate computed: `# rows where 1st label ≠ 2nd label / # retest rows`.
  - **Engineering choice — kill rule at >15% (R3 W3 + R4 W2 grounding)**: 15% is an **explicit pilot heuristic, not a sourced fact, and not a derived bound**. Rough intuition (NOT a real multi-class bound — R4 W2 fix): when a labeler self-disagrees on ~15% of binary calls, an extractor predicting that labeler can't distinguish itself from the noise floor much above 85% accuracy on those calls; multi-class enums make this looser and asymmetric, but the directional signal is "high self-disagreement caps how strict we should be in our F1 floor." Pushing the kill threshold higher would let cells claim PASS on labels that aren't reproducible. Calibrating on κ would require a second rater, which the pilot scope explicitly defers. Follow-on charters with a 2nd rater can revise to a κ-based threshold.
  - **Engineering choice — ≥1-day retest gap (R3 W3 grounding)**: 1 day is **arbitrary; chosen as the smallest interval that defeats trivial short-term recall**. R4 follow-on may revise after observing actual drift behavior (if drift is 0% at 1 day, gap is fine; if high, revisit).
  - **Kill verdict**: if self-disagreement > 15% on any (dimension × stratum) cell, that cell's verdict is **NULL-GOLD** — the schema is too subjective for single-rater pilot **on that cell**. Other cells are unaffected (R3 W4 fix; previously NULL-GOLD-DOMINANT over-aggregated).
  - **Warn band**: if self-disagreement is 10%–15%, gold is usable but the F1 calibration carries a ±0.05 uncertainty band. Reflected in §7 verdict gates.
  - If self-disagreement < 10%, gold is treated as reliable.

- **Calibration metrics** (per dimension per stratum):
  - Precision, recall, F1 against gold.
  - Per-field disagreement breakdown (e.g., "extractor agreed on `valueIn` polarity 92% of the time but disagreed on `lifeValue` enum 31% of the time").
  - Confidence-vs-correctness curve: if extractor `confidence ≥ 0.9`, what is its precision? (R1 blocker 4: confidence is MEASURED as a calibration signal, NEVER used to gate downstream decisions.)
  - Stratum-difference signal: |F1_litrpg − F1_fantasy| ≥ 0.10 → directional book-effect (NOT genre-level — see §1 secondary).

- **Distribution sketches** (descriptive only, NOT decision-grade):
  - Per stratum, observed mean / median / IQR / CV with 95% CI for value-charge polarity counts and PromiseRegistry size.
  - Pre-registered: at n=2 books, the CV CI is expected to span 0.5 — this is shown as the empirical anchor for "n=2 is not enough for distribution claims."

- **Verification invariants** (extension of `corpus-pipeline.md`'s 14):
  - **Coverage:** every scene in `scenes.jsonl` has either a value-charge tag or an "abstain" reason; every chapter in `beats.jsonl` has either a promise-list tag or "no promises detected."
  - **Schema validity:** every tag passes its zod schema.
  - **Evidence-quote present:** every tag with non-zero confidence cites a verbatim text quote from the source. Quote substring must appear in `pairs.jsonl` or `source/` text.
  - **(R1 warning #1 fix) Semantic invariants per dimension:**
    - **Value-charge:** if `valueIn ≠ valueOut`, the scene's prose must contain at least one of: explicit value-shift verb (became, lost, gained, learned, escaped, fell), or a McKee-Gap signal (the result diverged from the character's expectation). Spot-checked on 20% of samples.
    - **PromiseRegistry:** every closed promise must have its `closed_chapter > opened_chapter`. Promises closed without an opening event in the registry → flagged as tagging error. Promises opened without later resolution within the book are **VALID** (per SYNTHESIS.md §2.2 — open-at-end-of-book is normal for series fiction; only "opened-and-closed-without-progress" is flagged). **(R3 B1 fix — removed the unsupported "every promise must open in first 25%" rule.)**

### Out of scope (R2)

- **The other 4 dimensions from R1** (MICE per-chapter, Yorke-phase per-beat, character-arc Lie/Truth/Want/Need, character-web). They are DEFERRED to follow-on charters that run only if THIS pilot validates extractor reliability.
- **CV-as-encodeability gate.** R2 does not produce encodeability decisions. The follow-on charter does, with a calibrated F1 floor and CI-based CV thresholds.
- **The 6+ book corpus.** R2 is 2 books. The follow-on charter scales after pilot validation.
- **Aggregate `corpus-distributions.json` across strata.** R2 produces per-stratum sketches only. Aggregate is forbidden until the stratification-difference test (§1 secondary) clears.
- **Any runtime-pipeline change.** Same as R1 — Bucket 3 charters cite this output, they don't ship from it.
- **Multiple raters / κ statistic on gold.** Single rater (Andre) for the pilot. κ is a follow-on requirement.
- **All R1's other rejected counterfactuals.** Already rejected; R2 inherits those rejections.

## 3. Approach (R2)

### Stage-6 pipeline addition (extends `docs/corpus-pipeline.md`)

Existing pipeline:
```
ingest → scenes → beats → briefs → analysis (Stages 1-5)
```

New stage (R2 pilot scope — 2 dimensions only, decoupled extractors):
```
ingest → scenes → beats → briefs → analysis → structure (Stages 1-6, pilot)
```

Stage 6 (structure) reads `novels/<key>/{scenes,beats,pairs}.jsonl` + `analysis/` and writes:
- `novels/<key>/structure/<book>/value-charge.jsonl` — one row per scene **per book** (per-book sliced; R3 B2 fix).
- `novels/<key>/structure/<book>/promises.json` — one document per book.
- `novels/<key>/structure-gold/<book>/{value-charge,promises}.jsonl` — human gold subset per book.
- `novels/<key>/structure-calibration/<book>.json` — per-(book, dimension) precision/recall/F1 + confidence calibration curve.

Pure read-only over Stages 1–5. Cleanly resumable. No `analysis/` overwrites.

### Source normalization (R3 B2 + B3 + R4 B1 + B2 fix — full-domain pre-flight invariant)

Before either extractor runs, Stage 6 invokes `scripts/corpus/normalize-for-structure.ts` which produces normalized per-book working files in `novels/<key>/structure-tmp/<book>/`:

1. **Per-book slice.** Read `scenes.jsonl` and filter rows where `row.book == <book>`; read `beats.jsonl` and filter where `row.book == <book>`; read `pairs.jsonl` and filter where `row.brief.book == <book>` (note: top-level `book` for scenes/beats, NESTED `brief.book` for pairs — verified against actual files via direct inspection; R3 B2 fix).

2. **Full per-book chapter-label domain (R4 B1 fix).** Verified by direct read against `novels/salvatore-icewind-dale/beats.jsonl`, the actual chapter-label domain per book is:
   - `crystal_shard`: `prelude` (str), `1..30` (int), `epilogue` `epilogue2` `epilogue3` (str)
   - `halflings_gem`: `prelude`, `1..25`, `epilogue` `epilogue2` `epilogue3`
   - `streams_of_silver`: `prelude`, `1..24`, `part1` `part2` `part3` (str — these are part-headers between chapter ranges, NOT chapters), `epilogue`
   `verification.json.stages.corpus.<book>.chapters_found` contains ONLY the integer chapters and silently misses the string-labeled ones. **R5 derives the canonical chapter domain from the OBSERVED labels in `beats.jsonl` (not from `verification.json`)**, then sorts per a fixed label-class precedence:
   ```
   precedence: prelude (-1), part1 (50), part2 (51), part3 (52), <int N> (N), epilogue (1000), epilogue2 (1001), epilogue3 (1002)
   ```
   The `chapter_canonical_index` is the integer above; raw labels are preserved alongside it. (Note: `part*` labels in streams_of_silver are part-headers within the book; their precedence-50 placement is arbitrary but stable. They typically have few or no own beat rows, but if present they sort between integer chapters and epilogues — adjudicator-side review during pilot will verify whether this placement is semantically correct or whether part-headers should be filtered out before extraction. Decision logged in R5 attack list.)

3. **Sort key (R4 B2 fix).** `beats.jsonl` rows have `scene_id` (string like `"crystal_shard_ch10_s0"`), NOT `scene_idx` as R4 wrote. R5 derives `scene_ordinal` by parsing `scene_id`:
   ```
   scene_id = "<book>_ch<chapter>_s<scene_ordinal>"  e.g. "crystal_shard_ch10_s0"
                                                          OR "crystal_shard_chprelude_s0"
                                                          OR "crystal_shard_chepilogue_s0"
   scene_ordinal = parse_int(scene_id.rsplit('_s', 1)[1])
   ```
   Sort key: `(chapter_canonical_index, scene_ordinal, beat_idx)`. All three fields exist on every row (verified).

4. **Verification invariants (Stage 6 pre-flight):**
   - **Coverage invariant**: all filtered rows accounted for (`input_rows == output_rows + dropped_other_book`).
   - **Sort stability invariant**: every consecutive pair satisfies the sort key.
   - **Full-domain invariant (R4 B1 fix)**: every chapter LABEL observed in the per-book sliced rows maps to a `chapter_canonical_index` in the precedence above; rejection on any unmapped label.
   - **Scene-ordinal invariant (R4 B2 fix)**: every row's `scene_id` parses cleanly to `(chapter, scene_ordinal)`; rejection on parse failure.
   - **No silent drop of epilogue/part rows (R4 B1 fix)**: post-sort row count equals filtered row count.
   - `pairs.jsonl` is NOT sorted (used only for value-charge per-scene context lookup, not for full-novel ordering).

This step is non-trivial because R3 assumed `beats.jsonl` was already in narrative order (verified false: file starts at `crystal_shard ch10`, contains epilogue/part rows at arbitrary positions). Without this normalization step, the PromiseRegistry extractor would either drop the 92+ epilogue/part rows or interleave them with main-body chapters in their append order.

### PromiseRegistry chapter representation (R4 B1 fix)

R5 changes the per-promise schema to carry BOTH raw label and canonical index (was R4: numeric-only). Final canonical schema:
```
{
  promise_id:                 string (UUID),
  promise_text:               string (≤200 chars),
  opened_chapter_label:       string,         // raw, e.g. "10" or "prelude" or "epilogue"
  opened_chapter_index:       int,            // canonical, e.g. 10, -1, 1000
  closed_chapter_label:       string | null,
  closed_chapter_index:       int | null,
  hint_chapter_labels:        string[],
  hint_chapter_indices:       int[],
  payoff_quality:             enum,
  evidence_quote_open:        string,
  evidence_quote_close:       string | null,
  confidence:                 float,
}
```
Matching policy condition 1 (chapter window) compares INDICES: `|predicted.opened_chapter_index − gold.opened_chapter_index| ≤ 1`. The 1-chapter window is in canonical-index space; e.g., `prelude` (-1) is window-adjacent to chapter 1 (1) only via the integer-int gap of 2 (so prelude and ch1 do NOT match — that's intentional, prelude is structurally distinct).

### Extractor decomposability (R1 issue 7 fix)

The 2 R2 extractors are independent — neither needs the other's output as input. Verified:

- **value-charge** input: scene brief + ±1 chapter beat context. Self-contained.
- **PromiseRegistry** input: full novel beats. Self-contained.

(R1's 6-extractor design DID have a dependency graph — character-arc-extractor needed character-web-extractor's output. R2's 2-pick avoids this.)

### Extraction agents

- **`structure-value-charge-extractor`** at `src/agents/structure-value-charge/`:
  - Prompt: `value-charge-system.md` defines the schema, gives 5 in-context examples (3 fantasy + 2 LitRPG, hand-curated from public-domain sources NOT in our corpus to avoid contamination).
  - Schema (zod): `{valueIn: enum(["+","-","0"]), valueOut: enum(["+","-","0"]), lifeValue: string, polarity: enum(["+","-","0"]), confidence: number, evidence_quote: string, abstain_reason: string | null}`.
  - Model: DeepSeek V4 Flash, non-thinking, temperature 0.1.
  - Per-call shape: ~1.5K input × ~200 output. Per-novel: ~150 scenes × ~1 call ≈ ~$0.05/novel.

- **`structure-promise-extractor`** at `src/agents/structure-promise/`:
  - Prompt: `promise-extraction-system.md` defines schema, gives 3 in-context examples.
  - Schema (matches §2 canonical schema; R3 S2 harmonization fix): first pass `{promises: [{promise_id, promise_text, opened_chapter, hint_chapters[], confidence, evidence_quote_open}]}` (open-only); **second pass** `{promises: [{promise_id, ...same..., closed_chapter, payoff_quality, evidence_quote_close}]}` (closure pass given the first pass's promise list, joined by `promise_id`).
  - Model: DeepSeek V4 Flash, **thinking-mode ON** (cross-chapter reasoning per `roles.ts` thinking-mode rule).
  - Per-novel shape: ~2 calls × 50K input × 2K output ≈ ~$0.10/novel.

Both agent dirs follow the existing `src/agents/<name>/{index.ts, schema.ts, context.ts, prompt.md}` convention.

### Gold-set adjudication procedure

For each book × each dimension:

1. Run the LLM extractor over the full book → write tags to `structure/<dim>.jsonl`.
2. Sample 30–50 rows uniformly at random (`scripts/corpus/sample-for-adjudication.ts <book> <dim>`).
3. **Hide the LLM tags.** Adjudicator (Andre) sees ONLY the source data (scene brief / chapter beats) and applies the same schema fresh.
4. Adjudication recorded in `structure-gold/<dim>.jsonl` with the sampled row IDs.
5. After all gold rows are adjudicated, `scripts/corpus/compute-calibration.ts` joins gold ↔ extractor output by row ID and writes `structure-calibration.json` with precision/recall/F1 + per-field disagreement.

(R1 issue 4 fix: this gold subset is the calibration baseline. Encodeability is NEVER inferred from extractor `confidence` alone — confidence is a SECONDARY signal whose calibration is itself measured.)

### Stratum split (R1 issue 2 fix)

R2 NEVER aggregates across strata. Outputs are per-stratum:

- `corpus-distributions-fantasy-pilot.jsonl`
- `corpus-distributions-litrpg-pilot.jsonl`
- `corpus-calibration-fantasy-pilot.json`
- `corpus-calibration-litrpg-pilot.json`

Stratification-difference test (§1 secondary) decides whether follow-on charters operate per-stratum or one-stratum-only.

## 4. Deliverables (R2)

1. **2 new extractor agents** under `src/agents/structure-value-charge/` and `src/agents/structure-promise/`.
2. **`scripts/corpus/extract-structure.ts`** — Stage 6 pilot driver.
3. **`scripts/corpus/sample-for-adjudication.ts`** — gold-set sampler.
4. **`scripts/corpus/compute-calibration.ts`** — precision/recall/F1 + confidence calibration curve.
5. **Extended `verify-pipeline.py`** — Stage 6 pilot invariants (semantic invariants per dimension, evidence-quote substring check, schema check, coverage check).
6. **Reference novels processed**: `salvatore-icewind-dale/source/salvatore-crystal-shard.txt` (fantasy stratum) + 1 LitRPG novel TBD (post-pre-gate).
7. **`docs/charters/corpus-structural-decomposition-v1-results.md`** — verdict charter post-pilot, citing the per-(book, dimension) calibration JSON files and naming whether either extractor cleared its dimension's pre-registered hypothesis from §1 (value-charge: P ≥ 0.78 AND R ≥ 0.65 AND F1 ≥ 0.71; PromiseRegistry: R ≥ 0.80 AND P ≥ 0.65 AND F1 ≥ 0.71). **(R3 W6 fix — harmonized at the §1/§7 floor of F1 ≥ 0.71; previous "F1 ≥ 0.75" reference was stale R2 language.)**
8. **Decision-doc entry** in `docs/decisions.md`: pilot result + follow-on routing (FULL-CHARTER / NO-CHARTER / SINGLE-DIM-ONLY / SINGLE-STRATUM-ONLY).

## 5. Cheapest counterfactuals considered (R2)

R2 IS a cheapest counterfactual to R1, applied. Below: counterfactuals considered RELATIVE to R2.

- **Single-book, single-dimension pilot** ($1, ~2 days). Considered. Rejected because the stratification-difference test (§1 secondary) is load-bearing for follow-on charter scoping; can't run that test without 2 strata.
- **Hand-tag without LLM extractor** (~3 days, 0 LLM cost). Considered. Rejected because the pilot's calibration question is "is the LLM extractor reliable" — hand-only tagging answers a different question (does the dimension exist in the corpus). The follow-on charter MAY do hand-only annotation if pilot fails; this isn't load-bearing for now.
- **Synthetic-corpus calibration only** (~$2, ~3 days). Considered. Rejected — synthetic data calibration doesn't transfer (per `docs/decisions.md` "Synthetic teacher accuracy doesn't predict calibration on marginal cases"). Real corpus is mandatory for the calibration claim.
- **Defer until autonomous-loop is live** (~0 cost). Rejected — `docs/designs/autonomous-context-loop.md` is sub-loop scoped per layer; without corpus-derived priors, sub-loop 1 (planning) has no target distribution to converge against.

## 6. Distribution match + invariants (R2)

Stage 6 pilot inherits the 14 conservation invariants from `corpus-pipeline.md` and adds the four invariants in §2 ("Verification invariants" — coverage, schema, evidence-quote substring, per-dimension semantic).

**Distribution claims (R1 issue 3 fix):**

- All distributional metrics in §1 (CV, mean, median, IQR) are reported with **95% CI** per stratum (bootstrap, n_resample=1000).
- Pre-registered: at n=2 books, the CV CI for any single metric is expected to span [0.3, 1.0]+ — distribution claims at this n are NOT made. The CI width is reported as evidence of "n must grow before encodeability claims."
- The follow-on charter (post-pilot, if pilot passes) inherits this CI requirement at higher n.

`scripts/corpus/verify-pipeline.py` extended to audit all of these per-novel.

## 7. Success criteria + next steps (R2)

### Verdict gates (pilot — extractor-reliability question)

**Per (dimension × stratum) cell, applied in order — first matching predicate wins (R2 blocker 1 fix — cost-function-anchored thresholds):**

| Cell verdict | value-charge predicate (precision-first) | PromiseRegistry predicate (recall-first) |
|---|---|---|
| **NULL-GOLD** | adjudicator-drift > 15% (R2 blocker 3) | same |
| **CELL PASS** | P ≥ 0.78 AND R ≥ 0.65 AND F1 ≥ 0.71 | R ≥ 0.80 AND P ≥ 0.65 AND F1 ≥ 0.71 |
| **CELL MARGINAL** | (lead metric in [0.65, threshold)) AND F1 ≥ 0.60 | (lead metric in [0.70, threshold)) AND F1 ≥ 0.60 |
| **CELL FAIL** | F1 < 0.60 OR lead < 0.65 | F1 < 0.60 OR lead < 0.70 |

Lead metric = P for value-charge, R for PromiseRegistry (per cost-function asymmetry, §1).

Adjudicator-drift in [10%, 15%]: cell verdict carries a ±0.05 F1 uncertainty band. Threshold-edge cells reported with the band; do NOT promote a "with-band" pass over the un-banded threshold.

### Aggregated pilot verdict (R2 suggestion 1 — `SCOPED PASS` clarification)

Per Codex R2 §"Suggestions": rename `PASS` to `SCOPED PASS` so a 1-of-4 calibrated-cell outcome is not misread as broad readiness.

**Pilot verdict is computed cell-by-cell, then aggregated. NULL-GOLD on one cell does NOT override other cells (R3 W4 fix).**

- **SCOPED PASS** — at least 1 (dimension × stratum) cell is CELL PASS. Open follow-on charter scoped to the calibrated cell's (dimension × stratum) only. NOT a green light to run all 6 dims × 8 books. Reports the NULL-GOLD cells separately (those need 2-rater arbitration before being usable, but they don't block the SCOPED PASS).
- **PARTIAL** — at least 1 cell CELL MARGINAL, no cell CELL PASS. Follow-on charter MAY iterate on prompts (one round) before re-piloting on the marginal cell.
- **NULL-GOLD-ONLY** — every non-NULL-GOLD cell is missing (i.e., all 4 cells are NULL-GOLD). Schema is too subjective for single-rater pilot across the matrix. Follow-on REQUIRES second human rater on at least one dimension before further work.
- **FAIL** — all non-NULL-GOLD cells are CELL FAIL. Close the corpus-structural-tagging family. Pivot Bucket 3 to per-book voice-LoRA imitation as the only structural lever.

NULL-GOLD on individual cells is reported in all verdicts (PASS/PARTIAL/FAIL alike) so the follow-on charter can decide whether to recruit a 2nd rater for that specific cell or accept the partial signal.

### Stratification signal (R2 warning 2 fix — DOWNGRADED)

- **STRATA-DIFFER (book-effect signal)** — |F1_litrpg − F1_fantasy| ≥ 0.10 on either dimension. **At n=1/stratum, this is directional book-effect signal, NOT genre-level evidence.** Follow-on charters MAY use as scoping signal but MUST verify with n ≥ 2 books per stratum before any "MUST run per-stratum" rule fires.
- **STRATA-SIMILAR** — |F1_litrpg − F1_fantasy| < 0.10 on both dimensions. Same caveat: at n=1/stratum, weak evidence. Follow-on charter MAY use a unified extractor with stratum as a context tag, contingent on a 2-book-per-stratum re-test.

### Decisions surfaced for downstream charters

Pilot output IS the calibration baseline for any future structural-tagging charter. Follow-on charters cite this pilot's `corpus-calibration-{stratum}-pilot.json` as their precision/recall floor.

## 8. Budget (R4 — consolidated, includes LitRPG ingest)

### LLM cost

Single explicit formula:

**Per-call cost on DeepSeek V4 Flash** (`registry.ts`: $0.14/1M input, $0.28/1M output):
- value-charge: 1.5K input + 200 output → 1.5K × 0.14e-6 + 0.2K × 0.28e-6 = $0.000266/call.
- PromiseRegistry: 50K input + 2K output (thinking-on; 2-pass for open + close) → 50K × 0.14e-6 + 2K × 0.28e-6 = $0.00756/call.

**Per-book Stage 6 extraction:**
- value-charge: ~150 scenes × $0.000266 = **$0.040/book**.
- PromiseRegistry: 2 passes × $0.00756 = **$0.015/book**.

**Per-book Stage 6 total: ~$0.055/book. 2 books: ~$0.11 base.**
**Retry buffer (Stage 6 only) at 3×** (schema-mismatch + prompt iteration): $0.11 × 3 = **$0.33** (inclusive).
**Adjudication helper Sonnet** (first-pass tagging assist for ambiguous rows; ~60-100 calls/dimension at ~$0.005/call): **$0.50.**
**LitRPG Stages 1–5 ingest cost (R3 W5 + R4 W3 fix — range, not point estimate).** Per `docs/corpus-pipeline.md` Stages 1–5 estimate **~$10–20/novel** for a fresh LitRPG bundle (PDF→text + scene/beat segmentation + brief generation + analysis). LitRPG novels can be longer than fantasy (HWFWM Bk1 is ~150K words, Cradle Bk1 is ~70K), so the high end is realistic. Reserve **$20** to bound it.

**Pilot total: $0.33 + $0.50 + $20.00 = ~$20.83. Round-up reserve: ~$22.**

R3 had budgeted ~$1.50 (Stage-6-only). R4 had ~$12 with `~$10` ingest line. R5's ~$22 reflects the corpus-pipeline's actual range estimate. Still well under any benchmark re-train cost ($50+ per W&B SFT run).

### Time

- LitRPG bundle ingest (Stages 1–5 on the chosen LitRPG novel): ~1 day (already-validated pipeline).
- Source normalization step (R3 B3): ~0.5 day (new pre-flight script + invariants).
- Extractor prompt + schema design (2 dims): ~2 days.
- Extractor implementation + integration with `scripts/corpus/run.ts`: ~1 day.
- Stage 6 extraction runs: ~2 hours wall-clock (2 books × 2 extractors).
- Gold-set adjudication: ~1 day primary pass (60–100 samples × 2 dims × ~3 min/sample = ~6–10h). Plus ~1.5h for 10% silent retest. Total ~1.25 days.
- Calibration + invariant verification + adjudicator-drift report + verdict: ~0.5 day.
- Results charter + verdict: ~0.5 day.

**Total: ~5.75 working days. ~1.5 weeks calendar.** R3's ~5 days plus 0.5 day for the new source-normalization step (R3 B3 fix) and 0.25 day for retest pass.

### Pre-gate calendar

LitRPG PDF acquisition: TBD per `salvatore-v5-corpus-expansion.md` pattern. May add 0–14 days to calendar depending on availability.

## 9. Linked context (R2)

- `docs/research/writing-frameworks/SYNTHESIS.md` §1 + §2 — convergence ranking. value-charge (5 frameworks) + PromiseRegistry (3 frameworks) selected as R2's two dimensions.
- `docs/corpus-pipeline.md` — existing 5-stage corpus pipeline; this charter adds Stage 6 in pilot scope. Updated file paths (`{scenes,beats,pairs}.jsonl`, NOT `.json`) per R1 warning #2 fix.
- `docs/charters/salvatore-v5-corpus-expansion.md` §3 — PDF pre-gate pattern copied for the LitRPG stratum.
- `docs/decisions.md` — "Plan-only extractionMode validated — LLM extractors removed" + "Synthetic teacher accuracy doesn't predict calibration on marginal cases" + "Genre DOES differentiate" — R1 RED rationale.
- `docs/lessons-learned.md` — "Eval-brief stratification must match training-data stratification" + "1-10 judges showed 0-33% discrimination" — anchors for R2's stratum-split + confidence-calibration design.
- `docs/experiment-design-rules.md` §11 (lever selection) — R2's framework. (R2 cited a §12 on power/sample sizing that does NOT exist in the rules doc as of 2026-04-29 — R2 suggestion 2 fix; charter-local rationale for n=60–100 gold samples per dimension is in §2 above: enough to compute F1 with ±0.05 binomial CI at the precision/recall floors stated in §1.)
- `docs/todo.md` "Three-bucket forward plan" — this charter is Bucket 1.
- `novels/salvatore-icewind-dale/{scenes,beats,pairs}.jsonl` — fantasy stratum source.
- `novels/manifest.json` — only 1 bundle today; expansion required for LitRPG.

## 10. Adversary review

| Reviewer | Date | Verdict | Thread |
|---|---|---|---|
| codex:codex-rescue gpt-5.5 effort=high | 2026-04-29 | **R1 RED** | `a2dfdb5c339c911f8` |
| codex:codex-rescue gpt-5.5 effort=high | 2026-04-29 | **R2 YELLOW** | `aed14f4069c607b16` |
| codex:codex-rescue gpt-5.5 effort=high | 2026-04-29 | **R3 YELLOW** | `a78a3f201ecc4bf63` |
| codex:codex-rescue gpt-5.5 effort=high | 2026-04-29 | **R4 YELLOW** | `afcade8df722c3a13` |
| (R5 pending) | (pending) | (pending) | (pending) |

### R1 verbatim verdict (preserved for audit)

> VERDICT: RED
>
> SUMMARY: As written, this run will not produce decision-grade corpus priors because it mixes incompatible genre strata, uses an uncalibrated universal CV gate at n=5-10, and skips a much cheaper calibration pilot that would answer whether six structural extractors are worth building.
>
> BLOCKING ISSUES: (1) skip cheaper calibration lever — replace with 2-book stratified pilot, 2 dimensions, human-audited extractor bakeoff before 6-agent build; (2) aggregate "LitRPG-heavy + Salvatore/Sanderson anchors" is uninterpretable per stratification rules — predeclare separate distribution files or narrow to one stratum; (3) universal CV<0.5 gates with no empirical grounding — at n=10 the 95% CI for observed CV 0.35 reaches ~0.52 — pre-register primary metrics and require upper 95% CV bound; (4) extractor confidence cannot gate encodeability without a measured precision/recall/FPR baseline.
>
> WARNINGS: invariants check structural presence not semantic correctness; file paths reference `.json` but live corpus is `.jsonl`; budget likely understates acquisition + retry risk.
>
> CHEAPEST UNTRIED COUNTERFACTUAL: Stratified Top-2 Calibration Pilot, ~$2-4.
>
> RECOMMENDED NEXT ACTION: RUN CHEAPER COUNTERFACTUAL.

### R2 verbatim verdict (preserved for audit)

> VERDICT: YELLOW
>
> BLOCKING ISSUES:
> 1. Threshold Grounding — `P≥0.80 / R≥0.70 / F1≥0.75` not tied to a stated downstream cost function and sits below the only cited production-clearing adapter floor (halluc-checker v3 at 77.8 / 85.4 / 81.4). Fix: state precision-first or recall-first per dimension, anchor to that cost function, compare to halluc-v3 precedent.
> 2. PromiseRegistry Metric Undefined — defined as one per-novel document but charter claims `30–50 random samples per dimension per book` and `precision/recall/F1 vs gold`. Without pre-registered unit of analysis and matching rule, F1 is undefined; free-form `payoff_quality` makes it worse. Fix: define promise-level scoring rows, matching policy, payoff_quality enum.
> 3. Gold Baseline Reliability — single-rater is defensible for cheap pilot only with reliability guard. Hiding LLM tags removes priming but does not measure adjudicator drift on subjective schemas. Fix: silent retests with kill/warn rule; second rater is for arbitration, not co-equal gold.
>
> WARNINGS: budget arithmetic inconsistent ($0.10 + $0.20 + $0.60 + $0.50 = $1.40 not $1.10); stratum-difference at n=1/stratum is book-effect screen not genre evidence — downgrade MUST language; attack list missed PromiseRegistry scoring.
>
> SUGGESTIONS: rename PASS → SCOPED PASS; document §12 sample-size gap (rules.md exposes §11 but not §12).
>
> RECOMMENDED NEXT ACTION: revise.

### R3 verbatim verdict (preserved for audit)

> VERDICT: YELLOW
>
> BLOCKING ISSUES:
> 1. §2 PromiseRegistry semantic invariant "every opened promise must have evidence in chapters 1–25%" not supported by SYNTHESIS.md §2.2 (which defines validity around introduction/progress/payoff status with promises still open at 95% completion as a separate flag). As written would mark legitimate mid-book promises as tagging errors. Fix: drop the rule.
> 2. §2 source-shape claim mismatches actual corpus. "Filter to `book_id=crystal-shard`" but real fields are `book` in scenes/beats and `brief.book` in pairs. Salvatore bundle is 3-book mixed corpus, not single-book file. Fix: rewrite with real selectors and require materialized per-book slices.
> 3. §3 PromiseRegistry input "full chapter beats sequence from `beats.jsonl`" but actual file is NOT in narrative order (starts at crystal_shard ch10). Without deterministic sort, full-novel reasoning is wrong before the model runs. Fix: add normalization step (per-book slice → canonical chapter/scene/beat ordering) as Stage 6 pre-flight invariant.
>
> WARNINGS: halluc-v3 citation in `decisions.md` is wrong (numbers are in `lessons-learned.md`); PromiseRegistry match rule has degenerate near-duplicate merge case; adjudicator-drift heuristics ungrounded; NULL-GOLD-DOMINANT too coarse; LitRPG Stages 1–5 ingest cost missing from budget; Deliverable 7 still says F1 ≥ 0.75 but §1/§7 use F1 ≥ 0.71.
>
> SUGGESTIONS: add source normalization to attack list; harmonize PromiseRegistry field names between §2 and §3.
>
> RECOMMENDED NEXT ACTION: ITERATE-R4.

### R4 verbatim verdict (preserved for audit)

> VERDICT: YELLOW
>
> BLOCKING ISSUES:
> 1. (B1) Canonical chapter domain mismatch. `beats.jsonl` has `epilogue, epilogue2, epilogue3` rows NOT in `verification.json.chapters_found`. PromiseRegistry int-only chapter fields would silently drop epilogue openings/payoffs. Fix: derive canonical order from observed labels per book, store both raw label and canonical index, add invariant.
> 2. (B2) Sort key references nonexistent `scene_idx`. Real field is `scene_id` (string). Without declared derivation, narrative sorting is ambiguous. Fix: define `scene_ordinal` derivation from `scene_id` explicitly.
>
> WARNINGS: NER disambiguator stack still unnamed; F1≈1−d is a heuristic not a real multi-class bound; LitRPG ingest reserve `~$10` should be `~$10–20`.
>
> RECOMMENDED NEXT ACTION: ITERATE-R5.

R5 integrates both R4 blockers + 3 warnings + 2 suggestions. Submit R5 to Codex for follow-up review before implementation begins.

### R5 attack surfaces for Codex

- **Full chapter-label domain.** R5 §3 enumerates per-book domain incl. `epilogue/epilogue2/epilogue3` for crystal_shard + halflings_gem, plus `part1/part2/part3` for streams_of_silver. Are there other label classes I haven't seen (e.g., `interlude`, `intermission`)? Should the precedence map be data-driven (extracted from observed labels) rather than hard-coded?
- **Part-headers in streams_of_silver.** R5 places `part1/2/3` at precedence 50 (between integers and epilogue). Is that semantically right, or are part-headers actually structural separators that should be FILTERED from the per-book sequence (so they don't pollute Promise reasoning)? R5 §3 logs the decision as adjudicator-side review during pilot.
- **`scene_id` parser robustness.** R5 says `scene_id.rsplit('_s', 1)[1]` extracts the scene ordinal. Does this work for ALL scene_id values? Edge case: `crystal_shard_chprelude_s0` parses cleanly; what about `crystal_shard_chepilogue_s10` — does `rsplit('_s', 1)` correctly find the trailing `_s10`? (Likely yes, but verify.)
- **Promise schema with both label + index.** R5 doubles the chapter fields. Adjudication is now slightly more verbose (rater needs to write the label; the index is computed). Is the doubled schema worth it, or should canonical-index-only suffice with a `chapter_canonical_index_to_label()` helper?
- **NER pipeline (spacy + LLM augmentation fallback).** Is the 2-entity threshold the right augmentation trigger? Could be 1-entity-or-fewer, or could be confidence-driven. Pilot may need to log this and tune.
- **F1 ≈ 1−d intuition reframe.** R5 explicitly labels it "intuition, not a bound." Is that enough, or should the kill-rule rationale be reframed entirely (e.g., "we want the kill threshold low enough that NULL-GOLD cells are recoverable by adding a 2nd rater later — 15% is the largest disagreement we'd accept on a single rater before requiring arbitration")?
- **Budget range $20.** R5 reserves $20 for LitRPG ingest. Is this still bounded? HWFWM Bk1 is ~150K words; if scene segmentation is per-1K-word chunks, that's ~150 LLM calls in Stage 2 alone, before briefs (Stage 3 again ~150 calls).
- **GREEN-readiness judgment (R4 carryover).** With 5 rounds in, is R5 finally GREEN-ready, or has R5 introduced its own gaps? At this point, the marginal value of R6 is approaching the cost of paused implementation.
- **Pre-implementation checklist completeness.** R5's source-normalization spec is detailed enough to write `scripts/corpus/normalize-for-structure.ts` directly. Is anything else still ambiguous enough to block implementation?
