---
status: draft (pending Codex R3 adversarial review)
kind: experiment-charter
name: corpus-structural-decomposition-v1
owner: andre
date: 2026-04-29
revision: 3
pre-gate: 1 LitRPG novel PDF on disk (local or LXC) before R3 review.
parent-context: docs/research/writing-frameworks/SYNTHESIS.md, docs/corpus-pipeline.md, docs/todo.md "Three-bucket forward plan"
adversary-verdict:
  R1: RED (codex:codex-rescue gpt-5.5 effort=high, agent a2dfdb5c339c911f8, 2026-04-29) — premature 6-extractor build, mixed strata, uncalibrated CV gate, confidence-gated encodeability. Named cheapest counterfactual: "Stratified Top-2 Calibration Pilot, ~$2-4."
  R2: YELLOW (codex:codex-rescue gpt-5.5 effort=high, agent aed14f4069c607b16, 2026-04-29) — 3 blockers (threshold grounding vs. halluc-v3 precedent, PromiseRegistry metric undefined, gold baseline reliability) + 3 warnings (budget arithmetic inconsistent, stratum-difference overclaim at n=1/stratum, attack list incomplete) + 2 suggestions. Recommended action: revise; pilot architecturally on track.
---

# Experiment Charter — `corpus-structural-decomposition-v1`

## 0. Tl;dr (R3 — calibration pilot, protocol-tightened)

**R2 pivoted from R1's full-build to a calibration pilot. R3 hardens the pilot's scoring protocol per Codex R2 YELLOW.**

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
- **R2 (YELLOW):** Codex (`aed14f4069c607b16`, gpt-5.5 effort=high) confirmed scope-pivot landed cleanly (R1 attack surfaces 3, 4, 5, 7, 9 closed). 3 remaining blockers were protocol-level: F1 thresholds unanchored to a cost function or production precedent; PromiseRegistry scoring unit + matching policy + `payoff_quality` enum undefined; gold-baseline reliability not measured for subjective schemas. Recommended action: revise.
- **R3 (this revision):** integrates all 3 R2 blockers + 3 warnings + 2 suggestions as protocol additions. No scope change. Pilot is now protocol-complete.

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

The only cited production-clearing checker baseline in `docs/decisions.md` is **halluc-v3 at P=0.778 / R=0.854 / F1=0.814** (`docs/decisions.md` "Hallucination-checker v3 two-adapter architecture," 2026-04-18). Pilot thresholds are anchored to this precedent with cost-function asymmetry:

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
  - **Fantasy stratum**: `novels/salvatore-icewind-dale/source/salvatore-crystal-shard.txt` — already in canonical bundle. Use scenes/beats from existing `novels/salvatore-icewind-dale/{scenes,beats,pairs}.jsonl` (filter to `book_id=crystal-shard` if mixed; verify in pre-flight).
  - **LitRPG stratum**: 1 LitRPG novel TBD post-pre-gate. Acquisition candidates: *Cradle Bk1 (Unsouled, Wight)*, *Dungeon Crawler Carl Bk1 (Dinniman)*, *He Who Fights with Monsters Bk1 (Aronica/Shirtaloon)*. Pre-gate (per `docs/charters/salvatore-v5-corpus-expansion.md` §3 pattern):
    - [ ] PDF on disk (local or LXC)
    - [ ] Inventory logged (title, file path, file size sanity check, source)
    - [ ] Stages 1–5 of `corpus-pipeline.md` applied → bundle exists at `novels/<litrpg-key>/{scenes,beats,pairs}.jsonl` + `analysis/`
    - [ ] R2 review only after pre-gate clears

- **2 extractor agents** (R1 had 6; R2 cut to the 2 strongest-converging per SYNTHESIS.md):
  - **`structure-value-charge-extractor`** — input: scene briefs from `pairs.jsonl` + chapter context from `beats.jsonl`; output per scene: `{valueIn ∈ {+,−,0}, valueOut ∈ {+,−,0}, lifeValue ∈ <enum>, polarity ∈ {+,−,0}, confidence ∈ [0,1], evidence_quote: string, abstain_reason: string | null}`. `lifeValue` enum drawn from Coyne/McKee shared lexicon: `{life-death, freedom-slavery, justice-injustice, love-hate, truth-lie, power-weakness, hope-despair, success-failure, belief-doubt, identity-unknown, other}`.
  - **`structure-promise-extractor`** — input: full chapter beats sequence from `beats.jsonl`; output per novel: array of per-promise rows. Each row: `{promise_id: string (UUID), promise_text: string (≤200 chars), opened_chapter: int, closed_chapter: int | null, hint_chapters: int[], payoff_quality ∈ <enum>, evidence_quote_open: string, evidence_quote_close: string | null, confidence ∈ [0,1]}`. `payoff_quality` enum (R2 blocker 2 fix): `{satisfied, partially_satisfied, unsatisfied, unclear}`.

- **PromiseRegistry scoring unit + matching policy (R2 blocker 2 fix)**:

  Scoring is **per-promise row** (not per-novel). The extractor outputs N predicted promises; gold has M adjudicated promises per book. F1 is computed at the row level after pair-matching gold to predictions.

  **Matching policy** (predicted ↔ gold):
  - A predicted promise matches a gold promise IFF:
    - `|predicted.opened_chapter − gold.opened_chapter| ≤ 1` (1-chapter window for chapter-edge ambiguity), AND
    - text similarity ≥ threshold: `Jaccard token similarity ≥ 0.5` OR `Levenshtein ratio ≥ 0.6` over normalized text (lowercase, strip punctuation, drop function words).
  - Each gold promise matches AT MOST one predicted promise (greedy assignment by similarity score).
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

- **Adjudicator-drift guard (R2 blocker 3 fix — silent retest with kill rule)**:
  - 10% of each dimension's gold rows are silently retested: the adjudicator is presented the same source data again (different shuffle order, ≥1 day apart) WITHOUT being told it's a retest.
  - Self-disagreement rate computed: `# rows where 1st label ≠ 2nd label / # retest rows`.
  - **Kill rule**: if self-disagreement > 15% on any dimension on any stratum, that (dimension × stratum) cell verdict is **NULL-GOLD** — the schema is too subjective for single-rater pilot. Follow-on charters MUST recruit a second human rater for arbitration on that dimension.
  - **Warn rule**: if self-disagreement is 10%–15%, gold is usable but the F1 calibration carries a ±0.05 uncertainty band. Reflected in §7 verdict gates.
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
    - **PromiseRegistry:** every closed promise must have its `closed_chapter > opened_chapter`. Every opened promise must have evidence in chapters 1–25% of the book (Sanderson — promise density skews toward openings). Promises closed without an opening event or opened without later resolution → flagged as tagging error.

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
- `novels/<key>/structure/value-charge.jsonl` — one row per scene.
- `novels/<key>/structure/promises.json` — one document per novel.
- `novels/<key>/structure-gold/{value-charge,promises}.jsonl` — human gold subset.
- `novels/<key>/structure-calibration.json` — per-dimension precision/recall/F1 + confidence calibration curve.

Pure read-only over Stages 1–5. Cleanly resumable. No `analysis/` overwrites.

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
  - Schema: `{promises: [{text, opened_chapter, hint_locations[], confidence, evidence_quote}]}` (open-only first pass) + a **second pass** `{promises: [{...same..., closed_chapter, payoff_quality, closure_evidence_quote}]}` (closure pass given the first pass's promise list).
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
7. **`docs/charters/corpus-structural-decomposition-v1-results.md`** — verdict charter post-pilot, citing the 4 calibration JSON files and naming whether either extractor cleared the F1 ≥ 0.75 floor per stratum.
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

- **SCOPED PASS** — at least 1 (dimension × stratum) cell is CELL PASS, AND no cell is NULL-GOLD. Open follow-on charter scoped to the calibrated cell's (dimension × stratum) only. NOT a green light to run all 6 dims × 8 books.
- **PARTIAL** — at least 1 cell CELL MARGINAL, no cell CELL PASS, no cell NULL-GOLD. Follow-on charter MAY iterate on prompts (one round) before re-piloting on the marginal cell.
- **NULL-GOLD-DOMINANT** — at least 1 cell NULL-GOLD on any dimension (regardless of others). The schema is too subjective for single-rater pilot scope. Follow-on REQUIRES second human rater for arbitration on that dimension before any further pilot work.
- **FAIL** — all non-NULL-GOLD cells are CELL FAIL. Close the corpus-structural-tagging family. Pivot Bucket 3 to per-book voice-LoRA imitation as the only structural lever.

### Stratification signal (R2 warning 2 fix — DOWNGRADED)

- **STRATA-DIFFER (book-effect signal)** — |F1_litrpg − F1_fantasy| ≥ 0.10 on either dimension. **At n=1/stratum, this is directional book-effect signal, NOT genre-level evidence.** Follow-on charters MAY use as scoping signal but MUST verify with n ≥ 2 books per stratum before any "MUST run per-stratum" rule fires.
- **STRATA-SIMILAR** — |F1_litrpg − F1_fantasy| < 0.10 on both dimensions. Same caveat: at n=1/stratum, weak evidence. Follow-on charter MAY use a unified extractor with stratum as a context tag, contingent on a 2-book-per-stratum re-test.

### Decisions surfaced for downstream charters

Pilot output IS the calibration baseline for any future structural-tagging charter. Follow-on charters cite this pilot's `corpus-calibration-{stratum}-pilot.json` as their precision/recall floor.

## 8. Budget (R3 — explicit formula)

### LLM cost

Single explicit formula (R2 warning 1 fix — R2's $1.10 was inconsistent with line-item arithmetic, real total is ~$0.13 base extraction):

**Per-call cost on DeepSeek V4 Flash** (`registry.ts`: $0.14/1M input, $0.28/1M output):
- value-charge: 1.5K input + 200 output → $1.5K × 0.14e-6 + 0.2K × 0.28e-6 = $0.000266/call.
- PromiseRegistry: 50K input + 2K output (thinking-on; 2-pass for open + close) → $50K × 0.14e-6 + $2K × 0.28e-6 = $0.00756/call.

**Per-book extraction:**
- value-charge: ~150 scenes × $0.000266 = **$0.040/book**.
- PromiseRegistry: 2 passes × $0.00756 = **$0.015/book**.

**Per-book total: ~$0.055/book. 2 books: $0.11 base extraction.**

**Retry buffer (extractions only)** at 3× (schema-mismatch retries + prompt iteration): $0.11 × 3 = **$0.33** (inclusive total, not additive).

**Adjudication helper Sonnet (first-pass tagging assist for ambiguous rows; 60–100 calls/dimension at ~$0.005/call): **$0.50.

**Pilot LLM total: $0.33 + $0.50 = ~$0.83. Round-up reserve: ~$1.50.**

Well under Codex R1's named counterfactual estimate ("~$2-4") and R2's earlier ~$3.30 (which was inconsistent with the line-item math).

### Time

- Extractor prompt + schema design (2 dims): ~2 days.
- Extractor implementation + integration with `scripts/corpus/run.ts`: ~1 day (single new stage, 2 sub-stages, no extractor coupling).
- LitRPG bundle ingest (Stages 1–5 on the chosen LitRPG novel): ~1 day (already-validated pipeline).
- Stage 6 extraction runs: ~2 hours wall-clock (2 books × 2 extractors).
- Gold-set adjudication: ~1 day for primary pass (60–100 samples per dim × 2 dims × ~3 min/sample = ~6–10h). Plus ~1.5h for the 10% silent retest pass (R2 blocker 3). Total ~1.25 days.
- Calibration computation + invariant verification + adjudicator-drift report + verdict: ~0.5 day.
- Results charter + verdict: ~0.5 day.

**Total: ~5 working days. ~1 week calendar.** Same as R2.

### Pre-gate calendar

LitRPG PDF acquisition: TBD per `salvatore-v5-corpus-expansion.md` pattern. May add 0–14 days to calendar depending on availability.

### Time

- Extractor prompt + schema design (2 dims): ~2 days.
- Extractor implementation + integration with `scripts/corpus/run.ts`: ~1 day (single new stage, 2 sub-stages).
- LitRPG bundle ingest (Stages 1–5 on the chosen LitRPG novel): ~1 day (already-validated pipeline).
- Stage 6 extraction runs: ~2 hours wall-clock (2 books × 2 extractors).
- Gold-set adjudication: ~1 day (60–100 samples per dimension × 2 dimensions × ~3 min/sample = ~6–10h).
- Calibration computation + invariant verification + report: ~0.5 day.
- Results charter + verdict: ~0.5 day.

**Total: ~5 working days. ~1 week calendar.** ~50% under R1's ~2-week estimate.

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
| (R3 pending) | (pending) | (pending) | (pending) |

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

R3 integrates all 3 R2 blockers + 3 warnings + 2 suggestions. Submit R3 to Codex for follow-up review before implementation begins.

### R3 attack surfaces for Codex

- **PromiseRegistry matching policy edge cases.** `Jaccard ≥ 0.5 OR Levenshtein ≥ 0.6` matched on normalized text. Are there degenerate cases the policy handles wrong? E.g., two distinct promises with high lexical overlap ("Drizzt promises to free Catti-brie" vs. "Drizzt promises to fight Artemis Entreri" — both contain "Drizzt promises to") — does the matcher merge them when it shouldn't?
- **Cost-function asymmetry justification.** Are precision-first / recall-first assignments reversed for either dimension? Could PromiseRegistry actually be precision-first (cost of false-positive constraint > cost of dangling thread)? The asymmetry is opinion, not measurement; verify the framing matches the harness's actual writer behavior under the constraint type.
- **F1 ≥ 0.71 floor justification.** Anchored to halluc-v3 precedent (0.81) minus 0.10 for "harder task / pilot scope." Is 0.10 the right gap? Could be 0.05 (closer to production) or 0.20 (more permissive for pilot). What's the right delta?
- **Adjudicator-drift kill threshold (15%).** Arbitrary or grounded? At 15% self-disagreement, what's the upper-bound F1 ceiling the extractor could reach (since its labels are bounded by adjudicator agreement)?
- **Silent retest's 1-day-apart minimum** is meant to defeat short-term memory. Is 1 day enough? Could be 3–7 days for stronger drift signal.
- **NULL-GOLD-DOMINANT verdict path.** If 1 cell hits NULL-GOLD on a dimension, the verdict overrides ALL other cells' verdicts on that dimension. Is that correct, or should NULL-GOLD on stratum A allow stratum B to still pass independently?
- **Stratum-differ language downgrade.** "Directional book-effect, not genre evidence" — does this language fully prevent the follow-on charter from over-claiming? Should §7's STRATA-DIFFER explicitly say "NEXT-CHARTER MUST verify with n≥2 books"?
- **Budget reconciliation.** R3 says ~$0.83 base + reserve to $1.50. Is this still under-counted (e.g., do we need a budget line for the Stages 1–5 LitRPG bundle ingest LLM costs)?
- **Attack-list completeness.** Have I missed any new attack surface introduced by R3's additions (cost-function framing, matching policy, drift guard)?
