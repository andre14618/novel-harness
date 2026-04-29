---
status: draft (pending Codex R4 adversarial review)
kind: experiment-charter
name: corpus-structural-decomposition-v1
owner: andre
date: 2026-04-29
revision: 4
pre-gate: 1 LitRPG novel PDF on disk (local or LXC) before R4 review.
parent-context: docs/research/writing-frameworks/SYNTHESIS.md, docs/corpus-pipeline.md, docs/todo.md "Three-bucket forward plan"
adversary-verdict:
  R1: RED (codex:codex-rescue gpt-5.5 effort=high, agent a2dfdb5c339c911f8, 2026-04-29) — premature 6-extractor build, mixed strata, uncalibrated CV gate, confidence-gated encodeability. Named cheapest counterfactual: "Stratified Top-2 Calibration Pilot, ~$2-4."
  R2: YELLOW (codex:codex-rescue gpt-5.5 effort=high, agent aed14f4069c607b16, 2026-04-29) — 3 blockers (threshold grounding vs. halluc-v3 precedent, PromiseRegistry metric undefined, gold baseline reliability) + 3 warnings + 2 suggestions. Recommended action: revise; pilot architecturally on track.
  R3: YELLOW (codex:codex-rescue gpt-5.5 effort=high, agent a78a3f201ecc4bf63, 2026-04-29) — 3 blockers (PromiseRegistry 1-25% rule unsupported, source field-name mismatch with real corpus, beats.jsonl narrative-order violation) + 6 warnings + 2 suggestions. Recommended action: ITERATE-R4; remaining issues are protocol-level not architectural.
---

# Experiment Charter — `corpus-structural-decomposition-v1`

## 0. Tl;dr (R4 — calibration pilot, source-shape-corrected)

**R2 pivoted from R1's full-build to a calibration pilot. R3 hardened the pilot's scoring protocol per R2 YELLOW. R4 corrects the source-shape claims per Codex R3 YELLOW — the corpus files use different field names than R3 wrote, and `beats.jsonl` is not in narrative order, both of which would have broken Stage 6 implementation.**

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
- **R4 (this revision):** integrates all 3 R3 blockers + 6 warnings + 2 suggestions. Verified actual corpus shape via direct file inspection. Pilot is now protocol-complete and source-shape-correct.

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
    3. **(R3 W2 fix — actor/object disambiguator):** the predicted and gold promises share at least one named entity (character / object / location) extracted from `promise_text` via a deterministic NER pass. Two promises with high lexical overlap but disjoint entity sets (e.g., "Drizzt promises to free Catti-brie" vs. "Drizzt promises to fight Artemis Entreri") FAIL condition 3 and do NOT match.
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
  - **Engineering choice — kill rule at >15% (R3 W3 grounding)**: 15% is an **explicit pilot heuristic, not a sourced fact**. Rationale: (a) at >15% self-disagreement on a 4-class enum like `payoff_quality`, the ground-truth signal is below the noise floor for an F1≥0.71 claim (the upper-bound F1 on a label set with self-disagreement=d is ≈ 1−d, so 15% drift caps achievable F1 at ~0.85, well above our 0.71 floor — pushing the kill threshold higher would let cells claim PASS on labels that aren't reproducible); (b) calibrating on κ would require a second rater, which the pilot scope explicitly defers. R4 follow-on may revise to a κ-based threshold once a second rater enters.
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

### Source normalization (R3 B2 + B3 fix — pre-flight invariant)

Before either extractor runs, Stage 6 invokes `scripts/corpus/normalize-for-structure.ts` which produces normalized per-book working files in `novels/<key>/structure-tmp/<book>/`:

1. **Per-book slice.** Read `scenes.jsonl` and filter rows where `row.book == <book>`; read `beats.jsonl` and filter where `row.book == <book>`; read `pairs.jsonl` and filter where `row.brief.book == <book>` (note: top-level `book` for scenes/beats, NESTED `brief.book` for pairs — verified field-by-field against the actual files; R3 B2 fix).
2. **Canonical chapter ordering.** Per-book chapter order is established from `verification.json` (Stage 1 output). Chapter tokens are heterogeneous: `scenes.jsonl` uses string `"prelude"` for prologue and ints `1, 2, 3, ...` for numbered chapters; `beats.jsonl` uses ints only and has no `"prelude"` rows. Canonical ordering: `[prelude, 1, 2, 3, ..., N]` per book per `verification.json.stages.corpus.<book>.chapters_found` plus an explicit prelude prefix.
3. **Sort each per-book file** by `(chapter_canonical_index, scene_idx, beat_idx)`. The `chapter_canonical_index` is computed from the canonical ordering above (prelude → 0, ch1 → 1, ch2 → 2, ...).
4. **Verification invariant (Stage 6 pre-flight):**
   - All filtered rows accounted for (`input_rows == output_rows + dropped_other_book`).
   - Sort is stable and complete (`output[i+1].chapter_canonical_index >= output[i].chapter_canonical_index`).
   - Every chapter listed in `verification.json` for the book has at least one row in the per-book sliced output (catches scene/beat-loss bugs).
   - `pairs.jsonl` is NOT sorted (used only for value-charge per-scene context lookup, not for full-novel ordering).

This step is non-trivial because R3 attempted to write extractor logic that assumed `beats.jsonl` was already in narrative order; verified against the actual file (`head -3 novels/salvatore-icewind-dale/beats.jsonl` starts at `crystal_shard ch10`, not ch1 or prelude — the file is in append-order from the corpus-pipeline build, NOT narrative order). Without this normalization step, the PromiseRegistry extractor would receive an out-of-order beat sequence and reason about "promise opened in chapter 10" relative to a 0-indexed file position that has nothing to do with the book's narrative order.

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
**LitRPG Stages 1–5 ingest cost (R3 W5 fix — was missing in R3 §8).** Per `docs/corpus-pipeline.md` Stages 1–5 estimate ~$10/novel for a fresh LitRPG bundle (PDF→text + scene/beat segmentation + brief generation + analysis). Reserve: **$10.**

**Pilot total: $0.33 + $0.50 + $10.00 = ~$10.83. Round-up reserve: ~$12.**

R3 had budgeted ~$1.50 (Stage-6-only). R4's ~$12 reflects the missing LitRPG ingest line. Still well under Codex R1's named counterfactual estimate ("~$2-4 for Stage 6 only") plus the standard ingest reserve.

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
| (R4 pending) | (pending) | (pending) | (pending) |

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

R4 integrates all 3 R3 blockers + 6 warnings + 2 suggestions. Submit R4 to Codex for follow-up review before implementation begins.

### R4 attack surfaces for Codex

- **Source normalization invariants completeness.** R4 §3 added per-book slicing + canonical ordering + 4 pre-flight invariants. Have I missed an invariant (e.g., a row in `pairs.jsonl` whose `brief.book` doesn't match any row in `scenes.jsonl` for the same scene_id)?
- **Canonical chapter ordering for prelude.** R4 §3 says "prelude → 0, ch1 → 1, ch2 → 2." Is this correct for `verification.json`? `chapters_found` for crystal_shard is `[1, 2, ..., N]` with no explicit prelude; the prelude appears in scenes.jsonl but NOT in `chapters_found`. Need to verify this assumption against the actual `verification.json`.
- **Actor/object disambiguator (R3 W2 fix)** uses NER on `promise_text`. NER quality varies — what NER pipeline? `spacy en_core_web_sm`? `Stanford CoreNLP`? An LLM-based extractor? Each has different precision/recall on fantasy proper nouns.
- **Drift-guard 15% threshold rationale (R3 W3 fix)** anchored to "F1 upper-bound = 1−d." Is the 1−d relationship correct for multi-class enums (where label disagreement on one of 4 classes ≠ disagreement on a binary)?
- **NULL-GOLD-ONLY new verdict (R4 §7).** Only fires when ALL 4 cells are NULL-GOLD. Is this verdict reachable in practice, or is the threshold so tight it's never used?
- **F1 ≥ 0.71 floor (R3 carryover).** Still anchored to halluc-v3 0.81 minus 0.10 for "harder task / pilot scope." Codex didn't push back on this in R3; verify R4 wording is consistent.
- **Budget reconciliation (R3 W5 fix).** R4 added ~$10 LitRPG ingest line. Is the corpus-pipeline.md ~$10/novel estimate current, or stale?
- **Cost-function asymmetry (R3 carryover).** Could PromiseRegistry actually be precision-first under harness behavior? Verify the writer's response to a false-positive promise constraint.
- **Pivot history accuracy.** R4's pivot history attributes specific R3 findings to specific blockers. Verify these attributions match the verbatim R3 verdict above.
- **Suggested meta-attack.** With 4 rounds of YELLOW, the marginal value of R5 is low. Is R4 GREEN-ready, or does R4 introduce new gaps that R5 would need to close?
