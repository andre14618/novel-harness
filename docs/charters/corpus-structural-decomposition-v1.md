---
status: draft (pending Codex R7 adversarial review)
kind: experiment-charter
name: corpus-structural-decomposition-v1
owner: andre
date: 2026-04-29
revision: 7
pre-gate: NONE — single-book crystal_shard smoke against the existing Salvatore bundle. R7 swaps the human-gold protocol for an LLM-judge protocol; no new ingest dependencies.
parent-context: docs/research/writing-frameworks/SYNTHESIS.md, docs/corpus-pipeline.md, docs/todo.md "Three-bucket forward plan", docs/structure-sonnet-judge-rubric.md
adversary-verdict:
  R1: RED (codex:codex-rescue gpt-5.5 effort=high, agent a2dfdb5c339c911f8, 2026-04-29) — premature 6-extractor build. Cheapest counterfactual: "Stratified Top-2 Calibration Pilot, ~$2-4."
  R2: YELLOW (codex:codex-rescue gpt-5.5 effort=high, agent aed14f4069c607b16, 2026-04-29) — 3 protocol-level blockers + 3 warnings + 2 suggestions. Pilot architecturally on track.
  R3: YELLOW (codex:codex-rescue gpt-5.5 effort=high, agent a78a3f201ecc4bf63, 2026-04-29) — 3 source-shape blockers + 6 warnings + 2 suggestions.
  R4: YELLOW (codex:codex-rescue gpt-5.5 effort=high, agent afcade8df722c3a13, 2026-04-29) — R4 resolved all R3 issues correctly (verified). 2 NEW blockers from deeper file inspection: source-normalization spec drops epilogue chapters (92 rows in beats.jsonl have chapter ∈ {epilogue, epilogue2, epilogue3}, plus streams_of_silver has part1/part2/part3); sort key references nonexistent `scene_idx` field (real field is `scene_id`). 3 warnings (NER pipeline unnamed; F1≈1−d not a real multi-class bound; LitRPG ingest reserve range). Recommended action: ITERATE-R5.
  R5: YELLOW (codex:codex-rescue gpt-5.5 effort=high, agent a9d06835481391bd5, 2026-04-29) — R5 closed R4's source-shape bugs. 3 NEW blockers + 1 warning. (1) Axis 4: LitRPG bundle does not exist on disk; manifest.json lists only salvatore-icewind-dale; the 2-stratum pilot cannot run as chartered. (2) Axis 5: PromiseRegistry schema inconsistent end-to-end — §2 + §3-extractor use int-only `opened_chapter`, §3.1 uses `*_label + *_index`. P/R/F1 join rule undefined at exactly the place the run needs it. (3) Axis 7: §1 falsification rule and §7 aggregation rule produce incompatible verdicts on the same result matrix (e.g., both pass fantasy + both fail LitRPG would be FAIL per §1 but SCOPED PASS per §7). 1 warning: streams_of_silver part1/2/3 are substantive narrative beats; 50/51/52 ordinal mapping is safe only scoped to crystal_shard. Named cheapest counterfactual: "Single-book crystal_shard instrumentation smoke (~$0.10-0.50 LLM cost) to flush schema and join-contract defects before paying LitRPG ingest." Recommended action: REVISE CHARTER (ITERATE-R6).
  R6: NOT REVIEWED — R6 was the cheapest-counterfactual implementation of R5; user pivoted directly to implementation. R6 deliverables 1-6 (+ verify-pipeline.py extension) shipped on `phase-variant-screen` branch as part of Bucket 1 implementation work (commits TBD).
  R7: PENDING — R7 swaps the R6 human-gold protocol for an LLM-judge protocol (V4 Pro auto-judge + optional Sonnet/Codex subagent for premium-sample arbitration). Motivation: human single-rater gold consumes ~90-150 min adjudicator time per dimension, blocking the smoke verdict. R7 trades adjudicator time for LLM compute (~$0.05-0.50). Independence shifts from "human vs LLM" to "capability-gradient + cross-family-arbitrated" — see §2 R7 update.
---

# Experiment Charter — `corpus-structural-decomposition-v1`

## 0a. Tl;dr (R7 — LLM-judge replaces single-human-rater gold)

**R7 takes R6's design as-is for extraction, normalization, and verdict computation, and swaps the human-gold protocol for an LLM-judge protocol. Two-tier independence: V4 Pro reasoning-tier as automated baseline judge, Sonnet / Codex subagents as premium sample arbiters. The R6 verdict gates (§7) are unchanged; only the gold producer changes.**

R6 was implementation-shipped (extractor agents, normalize-for-structure preflight, sampler, calibration script, verify-pipeline Stage 6 audit) on the `phase-variant-screen` branch as part of Bucket 1. The `crystal_shard` extraction completed (139 scenes × value-charge + full-book PromiseRegistry pass). The R6 verdict was blocked at the human-gold step — ~90-150 min × 2 dimensions of single-rater adjudication time — so R7 swaps the gold producer.

**R7 protocol changes (vs R6 §2):**
- Replace "Andre adjudicates 30-50 rows per dimension, single rater" with "V4 Pro auto-judges 30-50 rows per dimension via `scripts/corpus/llm-judge.ts`."
- Replace "10% silent retest of Andre's labels" with "single-judge run; for self-consistency, a second V4 Pro pass with a different seed measures judge stability." (Sample-level only; not gating.)
- Add "premium-sample arbitration: Sonnet/Codex subagent re-labels the 10 lowest-V4-Pro-confidence rows; cross-judge disagreement flags rows for the operator." Per `docs/structure-sonnet-judge-rubric.md`.
- Independence axis: R6 had "human vs LLM" (orthogonal but blocked by human time). R7 has "capability-gradient (Pro reasoning > Flash extractor) + cross-family arbitration (Sonnet/Codex on a sample)." Acknowledged trade: in-family judge captures less of the extractor's blind-spots than a true cross-family judge would; the Sonnet/Codex sample-pass on the ambiguous quartile is the mitigation.

**What does NOT change:** R6 §1 hypothesis floors, §3 extraction pipeline, §6 invariants, §7 verdict gates (all four CELL PASS / MARGINAL / FAIL / NULL-GOLD predicates apply identically; the gold rows fed in are now LLM-produced rather than human).

**Caveat acknowledged in writing:** R7's verdict measures "extractor ↔ LLM-judge agreement," not "extractor ↔ ground truth." This is a strictly weaker claim than R6's. The R6 human-gold path remains a valid follow-on if R7's verdict comes back FAIL or PARTIAL and the operator wants to verify whether the failure is a true extractor problem or a judge-calibration problem. R7's deliverables include the prompts.jsonl files, so the human-gold path stays a single `bun scripts/corpus/sample-for-adjudication.ts` invocation away.

**R7 budget delta:** + ~$0.05-0.50 V4 Pro auto-judge calls. Sonnet / Codex subagent passes are billed externally to the harness (Claude Code session compute). Net cost increase: <$1 per dimension. Net adjudicator-time savings: ~90-150 min per dimension.

## 0. Tl;dr (R6 — single-book crystal_shard smoke per Codex R5 cheapest counterfactual)

**R5 cleared R4's source-shape bugs but uncovered three deeper issues that all dissolved when Codex named the cheapest untried counterfactual: a single-book crystal_shard smoke run that exercises every schema and join-contract path before paying LitRPG ingest cost. R6 takes that. The 2-stratum pilot is deferred to a follow-on charter that opens only if R6's smoke clears the schema/join-contract defects.**

R1 (RED) attempted 5–10 books × 6 extractors. R2 (YELLOW) collapsed to 2-book × 2-dimension. R3–R5 progressively closed source-shape and protocol issues. R5 surfaced three blockers that Codex's named counterfactual sidestepped:

1. **LitRPG bundle does not exist on disk.** `manifest.json` lists only `salvatore-icewind-dale`. The 2-stratum pilot is structurally unrunnable as chartered, regardless of how clean the schema is.
2. **PromiseRegistry schema is inconsistent end-to-end.** §2 and §3-extractor used int-only `opened_chapter`; §3.1 used `*_label + *_index`. The P/R/F1 join rule was undefined at exactly the place the run needs it. Until the smoke run forces this contract through real data, more bugs hide.
3. **Falsification rule and aggregation rule conflicted on the same result matrix.** §1 said "fail any stratum → FAIL"; §7 said "any cell PASS → SCOPED PASS." Same matrix, two verdicts.

R6 collapses scope to flush these out cheaply:

- **1 book, not 2**: `crystal_shard` from existing `novels/salvatore-icewind-dale/` ONLY. LitRPG stratum deferred. Stratification question (was §1 secondary) deferred entirely until R6 establishes the smoke baseline.
- **2 framework dimensions**: per-scene **value-charge** + per-novel **PromiseRegistry**. Same as R5.
- **Same cost-function-anchored thresholds (R3 §1, R5 §1)**: value-charge precision-first (P ≥ 0.78 / R ≥ 0.65 / F1 ≥ 0.71); PromiseRegistry recall-first (R ≥ 0.80 / P ≥ 0.65 / F1 ≥ 0.71). Anchored to halluc-checker-v3 production precedent.
- **Schema unified end-to-end (R5 B2 fix — completed in R6)**: PromiseRegistry uses `*_label + *_index` everywhere — §1, §2, §3, §3.1, §7. Extractor agents emit BOTH; matching policy joins on `_index`. The 2-rep dual schema is mandatory because raw labels carry semantics (`prelude` ≠ `chapter -1`) AND canonical indices enable arithmetic windows.
- **Single-stratum verdict only (R5 B3 fix — completed in R6)**: §7 verdict gates apply per-cell within crystal_shard's 2 cells (value-charge × crystal_shard, PromiseRegistry × crystal_shard). §1 falsification REPLACED with: "any non-NULL-GOLD cell is CELL FAIL → close the family for that dimension within crystal_shard." Aggregated verdict (§7 "SCOPED PASS / PARTIAL / FAIL / NULL-GOLD-ONLY") is the SOLE verdict function. §1 no longer carries a competing rule.
- **Streams_of_silver part1/2/3 mapping scoped to its book (R5 W1 fix — completed in R6)**: the `{part1: 50, part2: 51, part3: 52}` mapping in §3.1 applies ONLY when processing `streams_of_silver`. R6's smoke runs on `crystal_shard` (which has `prelude / 1..30 / epilogue / epilogue2 / epilogue3` — NO part labels), so the streams_of_silver mapping is preserved as documentation but unused in v1. A future LitRPG/streams charter can revisit.
- **Budget collapsed (R5 cheapest counterfactual)**: ~$0.10–0.50 LLM (only Stage 6 on crystal_shard, no LitRPG ingest). ~2 working days (was R5's ~5.75).

The smoke answers the same question R5's pilot did, ON ONE STRATUM ONLY: "is our extractor reliable enough on a single fantasy book that scaling to a second is justified?" If R6 CELL PASS on crystal_shard for either dimension, a follow-on charter (with LitRPG bundle materialized) opens to add the second stratum and run the genre-stratification question. If R6 FAIL on both dimensions, the family closes — no point paying LitRPG ingest for an extractor that's unreliable on the dataset we have.

This is a **read-only** smoke — no runtime-pipeline impact, no harness changes.

## Pivot history

- **R1 (RED):** Codex (`a2dfdb5c339c911f8`, gpt-5.5 effort=high) flagged 4 blockers + 3 warnings. Named cheapest counterfactual: "Stratified Top-2 Calibration Pilot, ~$2-4." Recommended action: RUN CHEAPER COUNTERFACTUAL.
- **R2 (YELLOW):** Codex (`aed14f4069c607b16`, gpt-5.5 effort=high) confirmed scope-pivot landed cleanly (R1 attack surfaces 3, 4, 5, 7, 9 closed). 3 remaining blockers were protocol-level. Recommended action: revise.
- **R3 (YELLOW):** Codex (`a78a3f201ecc4bf63`, gpt-5.5 effort=high) found 3 source-shape blockers (PromiseRegistry chapter-window invariant, real field selectors, beats.jsonl not in narrative order). 6 warnings + 2 suggestions. Recommended action: ITERATE-R4.
- **R4 (YELLOW):** Codex (`afcade8df722c3a13`, gpt-5.5 effort=high) found 2 NEW source-shape blockers from deeper file inspection (epilogue/part chapter labels, scene_id vs scene_idx). 3 warnings + 2 suggestions. Recommended action: ITERATE-R5.
- **R5 (YELLOW, REVISE-R6):** Codex (`a9d06835481391bd5`, gpt-5.5 effort=high) confirmed R5 cleared R4's source-shape bugs. 3 NEW blockers: (1) Axis 4: LitRPG bundle does not exist on disk; the 2-stratum pilot cannot run as chartered; (2) Axis 5: PromiseRegistry schema inconsistent end-to-end — §2 + §3-extractor int-only `opened_chapter`, §3.1 `*_label + *_index`; P/R/F1 join rule undefined; (3) Axis 7: §1 falsification + §7 aggregation produce incompatible verdicts on the same result matrix. 1 warning: streams_of_silver part1/2/3 mapping must be scoped to that book only. Named cheapest counterfactual: "Single-book crystal_shard instrumentation smoke (~$0.10-0.50 LLM cost) to flush schema and join-contract defects before paying LitRPG ingest." Recommended action: REVISE-R6.
- **R6 (NOT REVIEWED, IMPLEMENTATION-SHIPPED):** Took the R5 cheapest counterfactual. Scope collapsed from 2 books × 2 dimensions to 1 book (crystal_shard) × 2 dimensions. LitRPG ingest deferred to a follow-on charter that opens only if R6 smoke clears. PromiseRegistry schema unified end-to-end on `*_label + *_index` (R5 B2 fix). §1 falsification REPLACED with a single rule that cites §7 verdict gates (R5 B3 fix — single source of truth for verdict function). Streams_of_silver part1/2/3 mapping scoped to that book only and out of R6's run scope (R5 W1 fix). Budget collapsed from ~$22 + ~5.75 days to ~$0.10–0.50 + ~2 days. Implementation landed on `phase-variant-screen` (extractor agents, preflight, sampler, calibration script, verify-pipeline.py Stage 6 audit). Verdict was blocked at the human-gold step — Codex review skipped per user direction; pivot directly to R7.
- **R7 (this revision):** Swap human-gold protocol for LLM-judge. V4 Pro auto-judges 30-50 rows per dimension via `scripts/corpus/llm-judge.ts`; Sonnet/Codex subagents re-label the lowest-confidence quartile per `docs/structure-sonnet-judge-rubric.md`. Verdict gates unchanged. Acknowledged trade-off: R7 measures "extractor ↔ LLM-judge agreement" not "extractor ↔ ground truth"; R6 human-gold path preserved as single-command escape if R7 verdict warrants. ~$0.05-0.50 LLM-cost delta; ~90-150 min adjudicator-time saved per dimension.

## 1. Question (R6 — single-book smoke)

**Primary (smoke question):** On `crystal_shard` only, are LLM extractor agents reliable enough to produce structural framework tags at the precision/recall floors specified below, given the asymmetric cost of false-positive vs. false-negative tags per dimension?

**Operationalized:** for the 2 highest-convergence dimensions in `docs/research/writing-frameworks/SYNTHESIS.md`:

1. **Per-scene value-charge** (Coyne + McKee + Yorke + Truby + Swain converge — SYNTHESIS.md §2): `{valueIn ∈ {+,−,0}, valueOut ∈ {+,−,0}, lifeValue: enum, polarity ∈ {+,−,0}, confidence: float, evidence_quote: string, abstain_reason: string | null}`.
2. **Per-novel PromiseRegistry** (Sanderson + Lisle + LitRPG converge — SYNTHESIS.md §1): array of per-promise rows; full schema in §3.1 (canonical `*_label + *_index` representation).

Compute per-extractor on crystal_shard: precision, recall, F1 vs. human-adjudicated gold subset.

**Stratification question deferred (R6 scope cut).** R5's secondary stratification question required n=1/stratum × 2 strata; R6's single-stratum scope can't address it. A follow-on charter opens with the LitRPG bundle materialized AND R6's smoke verdict in hand.

### Cost-function asymmetry per dimension (R2 blocker 1 fix — anchored to halluc-v3 precedent)

The downstream cost function for each dimension is asymmetric:

- **value-charge → planner constraint (precision-first).** A false-positive tag (extractor says "value shifted +→−" when it didn't) creates a planner constraint that the writer either ignores (low cost) or follows incorrectly (medium cost — bad prose). A false-negative tag (missed real shift) is a missed constraint that's not enforced (low cost — "we already weren't enforcing it"). Therefore: **precision matters more than recall.**
- **PromiseRegistry → planner constraint (recall-first).** A false-positive promise creates a constraint to "pay off something that wasn't actually promised" — the writer fabricates resolution (medium-high cost). A false-negative miss leaves a real promise un-enforced — the writer leaves a thread dangling (high cost; this is exactly the failure mode the registry exists to prevent). Therefore: **recall matters more than precision.**

### Production precedent: halluc-checker-v3

The cited production-clearing checker baseline is **halluc-v3 at P=0.778 / R=0.854 / F1=0.814** (`docs/lessons-learned.md` "Hallucination-checker v3 two-adapter architecture" — R3 W1 fix: this trio is in `lessons-learned.md`, not `decisions.md`. `decisions.md` carries the v2 natural-val regression `77.8 / 51.2 / 61.8` which is a DIFFERENT data point not used here.) Pilot thresholds are anchored to this precedent with cost-function asymmetry:

**Hypothesis (template-compliant):**

> H1 (value-charge, precision-first): The value-charge extractor will achieve **P ≥ 0.78 AND R ≥ 0.65 AND F1 ≥ 0.71** on its human-adjudicated gold subset for crystal_shard.
>
> H2 (PromiseRegistry, recall-first): The PromiseRegistry extractor will achieve **R ≥ 0.80 AND P ≥ 0.65 AND F1 ≥ 0.71** on its human-adjudicated gold subset for crystal_shard.

**Threshold rationale:**
- The matched-floor metric per dimension (P=0.78 for value-charge; R=0.80 for PromiseRegistry) sits AT the halluc-v3 precedent value — both are pilot-acceptable production-equivalent floors for the dimension's lead metric.
- The off-axis metric (R=0.65 for value-charge; P=0.65 for PromiseRegistry) is RELAXED below halluc-v3 because the cost asymmetry tolerates more error on the off-axis. 0.65 is the minimum for the dimension to be "useful as a directional signal" (better than chance on a binary judgment with class balance ~50/50).
- F1 ≥ 0.71 (versus halluc-v3's 0.814) reflects that corpus extraction is harder than hallucination check (longer context, more dimensions per call), AND the smoke is gating "is this worth scaling to a second stratum," not "is this worth shipping to production." A future production-deployment charter would tighten F1 ≥ 0.81 to match halluc-v3 fully.

**Falsification rule (R5 B3 fix — SINGLE rule via §7 verdict gates):** The R6 verdict is computed cell-by-cell per §7's verdict-gate table, then aggregated per §7's "Aggregated smoke verdict." There is NO competing falsification rule outside §7. The single SOLE verdict function is the §7 aggregation. (R5 had a separate §1 falsification rule and §7 aggregated rule that could fire incompatibly on the same matrix; R6 collapses to §7 only.)

If §7's aggregated verdict is **FAIL** (all non-NULL-GOLD cells are CELL FAIL), the smoke's family-level conclusion is: extractor-based framework tagging is not reliable enough on the dataset we have. Close the corpus-structural-tagging family on crystal_shard. Pivot Bucket 3 toward per-book voice-LoRA imitation as the structural lever.

If §7's aggregated verdict is **SCOPED PASS** or **PARTIAL** on crystal_shard for either dimension, a follow-on charter (with LitRPG bundle materialized AND the R6 verdict in hand) opens to add the second stratum and run the genre-stratification question. Until then, "this works on crystal_shard" is the strongest claim we make.

**Secondary stratification question (deferred to follow-on, R6 scope cut):** R5's "does extractor F1 differ by stratum by ≥0.10 absolute" requires 2 strata. R6 has 1. The question opens in the follow-on charter that adds the LitRPG stratum, IFF R6's smoke clears.

**Tertiary CV-CI sanity check (deferred):** R5's CV-CI sanity check on the value-charge `polarity` distribution at n=2 books also requires 2 books; R6 has 1. Defer to the follow-on.

**This smoke does NOT propose runtime-pipeline changes. It does NOT claim corpus distributions. It produces extractor-reliability evidence on crystal_shard only.**

## 2. Scope (R2)

### In scope

- **Corpus**: 1 book — `crystal_shard` from the existing `salvatore-icewind-dale` bundle. Source files at `novels/salvatore-icewind-dale/{scenes,beats,pairs}.jsonl`. The bundle is a 3-book mixed corpus (Crystal Shard / Streams of Silver / Halfling's Gem); pre-flight MUST materialize a `crystal_shard` slice before Stage 6 runs. **Real selector keys** (R3 B2 fix — verified via direct file read): `scenes.jsonl` and `beats.jsonl` have a top-level `book` field (string, e.g. `"crystal_shard"`); `pairs.jsonl` has `brief.book` (nested). Bundle key uses underscore (`crystal_shard`), NOT hyphen (`crystal-shard`).

  **LitRPG stratum is NOT in scope for R6.** A follow-on charter opens with LitRPG ingest IFF R6's smoke verdict is SCOPED PASS or PARTIAL on either dimension. The follow-on's pre-gate (PDF on disk; bundle materialized via Stages 1–5 of `corpus-pipeline.md`) is documented in that follow-on, not here.

- **2 extractor agents** (R1 had 6; R2 cut to the 2 strongest-converging per SYNTHESIS.md). **All field names below are the canonical schema used by both §2 and §3 (R3 S2 fix + R5 B2 fix — harmonized end-to-end on `*_label + *_index` for PromiseRegistry):**
  - **`structure-value-charge-extractor`** — input: scene briefs from `pairs.jsonl` (filtered by `brief.book == "crystal_shard"`) + ±1 chapter context from `beats.jsonl` (filtered by `book == "crystal_shard"`). Output per scene: `{valueIn ∈ {+,−,0}, valueOut ∈ {+,−,0}, lifeValue ∈ <enum>, polarity ∈ {+,−,0}, confidence ∈ [0,1], evidence_quote: string, abstain_reason: string | null}`. `lifeValue` enum drawn from Coyne/McKee shared lexicon: `{life-death, freedom-slavery, justice-injustice, love-hate, truth-lie, power-weakness, hope-despair, success-failure, belief-doubt, identity-unknown, other}`.
  - **`structure-promise-extractor`** — input: per-book-sliced AND **canonically-ordered** chapter beats sequence from `beats.jsonl` (filtered by `book == "crystal_shard"`; R3 B3 fix — see "Source normalization" below). Output per novel: array of per-promise rows matching the §3.1 canonical schema:
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
      payoff_quality:             enum,           // {satisfied, partially_satisfied, unsatisfied, unclear}
      evidence_quote_open:        string,
      evidence_quote_close:       string | null,
      confidence:                 float,
    }
    ```
    Both `*_label` (raw) and `*_index` (canonical int from §3.1's chapter-label domain mapping) are emitted by the extractor in a single pass. The label preserves source-fidelity ("prelude" is structurally distinct from "chapter 1"); the index enables the §2 matching-policy arithmetic window. R5 B2 fix completed in R6.

- **PromiseRegistry scoring unit + matching policy (R2 blocker 2 fix + R5 B2 fix)**:

  Scoring is **per-promise row** (not per-novel). The extractor outputs N predicted promises; gold has M adjudicated promises for crystal_shard. F1 is computed at the row level after pair-matching gold to predictions.

  **Matching policy** (predicted ↔ gold):
  - A predicted promise matches a gold promise IFF ALL THREE conditions hold:
    1. `|predicted.opened_chapter_index − gold.opened_chapter_index| ≤ 1` (1-chapter window for chapter-edge ambiguity, computed in canonical-index space — R5 B2 fix; e.g., `prelude` (-1) is window-adjacent to `chapter 1` (1) only via the integer-int gap of 2, so prelude and ch1 do NOT match; that's intentional, prelude is structurally distinct), AND
    2. text similarity ≥ threshold: `Jaccard token similarity ≥ 0.5` OR `Levenshtein ratio ≥ 0.6` over normalized text (lowercase, strip punctuation, drop function words), AND
    3. **(R3 W2 + R4 W1 fix — actor/object disambiguator with named NER stack):** the predicted and gold promises share at least one named entity (character / object / location) extracted from `promise_text` via a deterministic NER pass. Two promises with high lexical overlap but disjoint entity sets (e.g., "Drizzt promises to free Catti-brie" vs. "Drizzt promises to fight Artemis Entreri") FAIL condition 3 and do NOT match. **NER pipeline (R4 W1 fix)**: hybrid of (a) `spacy en_core_web_sm` for `PERSON | ORG | LOC | GPE` extraction (handles capitalized multi-token names well), AUGMENTED with (b) a lightweight DeepSeek V4 Flash extraction call when spacy returns < 2 entities per promise (~10% of fantasy-prose cases per the harness's existing entity-aware checks). Spacy is the primary; LLM augmentation is the fallback for low-recall fantasy proper nouns. Augmentation cost is amortized into adjudication-helper budget line in §8.
  - **Tie-break (R3 W2 fix)**: when multiple predictions match a single gold (or vice-versa) per conditions 1–3, the adjudicator hand-disambiguates. Tie-break decisions logged in `structure-gold/promises-tiebreaks.jsonl` for audit.
  - Each gold promise matches AT MOST one predicted promise (greedy assignment by combined Jaccard + Levenshtein score, with manual tie-break override).
  - Unmatched predictions → false positives. Unmatched gold → false negatives.
  - **Edge case (degenerate 0-promise novel)**: if gold contains zero promises for a book, the extractor's F1 is undefined for that book; report extractor's predicted-promise count and adjudicate each as either FP or "spurious." Don't propagate undefined F1 to the stratum-aggregate.

  **payoff_quality scoring** (separate from promise-existence F1, secondary):
  - For matched (predicted, gold) pairs only: report `payoff_quality` agreement rate (4-class enum, expected ≥ 0.70 if extractor is calibrated).
  - Free-form text variant rejected per R2 blocker 2.

- **LLM-judge gold subset (R7 — replaces R6 human-gold protocol)**:
  - **value-charge**: 30-50 random samples for crystal_shard. Sampled uniformly at random from extractor-output scenes (same sampling code as R6).
  - **PromiseRegistry**: judge reads chapter beats fresh and identifies promises directly (NOT extractor output — same protocol as R6 except the judge is V4 Pro, not Andre).
  - **Primary judge**: DeepSeek V4 Pro thinking-on (`scripts/corpus/llm-judge.ts`), routed via `structure-{value-charge,promise}-judge` agent roles. Pricing: $1.74/$3.48 per 1M tokens (75%-off promo until 2026-05-31: $0.435/$0.87). For a 50-row pass: ~$0.05-0.20.
  - **Cross-family arbiter (premium sample)**: Sonnet (Anthropic) and Codex (gpt-5.5) via Agent subagent on the lowest-V4-Pro-confidence quartile (~10 rows). Per `docs/structure-sonnet-judge-rubric.md`. Subagent compute is billed to the Claude Code session, not the harness.
  - Gold recorded in `novels/salvatore-icewind-dale/structure-gold/crystal_shard/{value-charge,promise}-gold.jsonl`. Same on-disk shape as R6's human-gold; `compute-calibration.ts` consumes either source identically.
  - Judging is BLINDED to extractor output (the prompt files contain only source prose / chapter beats; no extractor labels leak in).
  - Judge uses the same schema and the same system prompt as the LLM extractor; disagreement at any field is a "miss" — identical to the R6 schema-disagreement convention.

- **Judge-stability guard (R7 — replaces R6 adjudicator-drift)**:
  - **Single-judge stability**: V4 Pro is run with `temperature: 0.1` (value-charge) / `0.3` (promise) and a fixed prompt; same prompt + same model + same config gives near-deterministic output (sample-level variance < 5% empirically on similar tasks per `docs/lessons-learned.md`). For self-consistency confirmation, the operator MAY run a second pass via `bun scripts/corpus/llm-judge.ts ... --max-prompts=10` on a 10-row subset and diff polarity / promise_id assignments.
  - **Cross-judge disagreement on the lowest-confidence quartile** is the R7 analog of R6's drift retest. If V4 Pro and Sonnet (or V4 Pro and Codex) disagree on > 20% of the lowest-confidence subset, the cell's verdict carries a ±0.05 F1 uncertainty band (same band as R6 §7) AND the operator routes those rows through Andre human-gold for the cell pass.
  - **NULL-GOLD trigger replaced**: R6 NULL-GOLD fired on adjudicator self-disagreement > 15%. R7 NULL-GOLD fires when (a) cross-judge disagreement > 30% on the sample AND (b) Andre's manual review of 5 disagreed rows confirms the schema is genuinely ambiguous (rather than judge-noise). The operator's manual review is logged as a brief note in `structure-gold/<book>/<dim>-judge-notes.md`.
  - **Acknowledged trade**: R7's stability guard is weaker than R6's adjudicator-drift retest because LLM judges are more deterministic than humans. The R7 mitigation is the cross-family Sonnet/Codex sample, which catches systematic V4 Pro biases that a same-judge retest never would.

- **Calibration metrics** (per dimension on crystal_shard):
  - Precision, recall, F1 against gold.
  - Per-field disagreement breakdown (e.g., "extractor agreed on `valueIn` polarity 92% of the time but disagreed on `lifeValue` enum 31% of the time").
  - Confidence-vs-correctness curve: if extractor `confidence ≥ 0.9`, what is its precision? (R1 blocker 4: confidence is MEASURED as a calibration signal, NEVER used to gate downstream decisions.)
  - Stratum-difference signal DEFERRED to the LitRPG-extension follow-on charter (R6 has 1 stratum).

- **Distribution sketches DEFERRED** (R6 has 1 book; CV-CI sanity check requires ≥2 books). The follow-on that adds LitRPG carries this measurement.

- **Verification invariants** (extension of `corpus-pipeline.md`'s 14):
  - **Coverage:** every scene in `scenes.jsonl` has either a value-charge tag or an "abstain" reason; every chapter in `beats.jsonl` has either a promise-list tag or "no promises detected."
  - **Schema validity:** every tag passes its zod schema.
  - **Evidence-quote present:** every tag with non-zero confidence cites a verbatim text quote from the source. Quote substring must appear in `pairs.jsonl` or `source/` text.
  - **(R1 warning #1 fix) Semantic invariants per dimension:**
    - **Value-charge:** if `valueIn ≠ valueOut`, the scene's prose must contain at least one of: explicit value-shift verb (became, lost, gained, learned, escaped, fell), or a McKee-Gap signal (the result diverged from the character's expectation). Spot-checked on 20% of samples.
    - **PromiseRegistry:** every closed promise must have its `closed_chapter > opened_chapter`. Promises closed without an opening event in the registry → flagged as tagging error. Promises opened without later resolution within the book are **VALID** (per SYNTHESIS.md §2.2 — open-at-end-of-book is normal for series fiction; only "opened-and-closed-without-progress" is flagged). **(R3 B1 fix — removed the unsupported "every promise must open in first 25%" rule.)**

### Out of scope (R6)

- **LitRPG stratum.** Deferred to a follow-on charter that opens IFF R6's smoke verdict is SCOPED PASS or PARTIAL on either dimension. The follow-on carries the LitRPG ingest budget (~$10–20 per `corpus-pipeline.md` Stages 1–5) and the genre-stratification question.
- **Second book of any kind.** R6 is 1 book — `crystal_shard`. Crystal_shard's two cousin books (`streams_of_silver`, `halflings_gem`) are NOT processed in R6 even though they're in the same bundle. Per Codex R5, single-book scope is the cheapest defect-detection vehicle.
- **The other 4 dimensions from R1** (MICE per-chapter, Yorke-phase per-beat, character-arc Lie/Truth/Want/Need, character-web). Deferred to follow-on charters that run only if R6 + the LitRPG-extension follow-on validate extractor reliability.
- **Stratification-difference signal.** Requires 2 strata; R6 has 1. Deferred.
- **CV-CI sanity check on polarity distribution.** Requires 2 books; R6 has 1. Deferred.
- **CV-as-encodeability gate.** Same as R1–R5: no encodeability decisions in this charter.
- **Aggregate `corpus-distributions.json` across strata.** Same as R5: forbidden, but R6's single-stratum scope makes the question moot.
- **Any runtime-pipeline change.** Same as R1 — Bucket 3 charters cite this output, they don't ship from it.
- **Multiple raters / κ statistic on gold.** Single rater (Andre) for the smoke. κ is a follow-on requirement.
- **All R1's other rejected counterfactuals.** Already rejected; R6 inherits those rejections.

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

2. **Per-book chapter-label domain (R4 B1 fix + R5 W1 fix scoped per book).** Verified by direct read against `novels/salvatore-icewind-dale/beats.jsonl`, the actual chapter-label domain per book is:
   - `crystal_shard`: `prelude` (str), `1..30` (int), `epilogue` `epilogue2` `epilogue3` (str)
   - `halflings_gem`: `prelude`, `1..25`, `epilogue` `epilogue2` `epilogue3`
   - `streams_of_silver`: `prelude`, `1..24`, `part1` `part2` `part3` (str — substantive narrative beats, NOT empty headers; verified per R5 W1 + Codex R5 finding), `epilogue`
   `verification.json.stages.corpus.<book>.chapters_found` contains ONLY the integer chapters and silently misses the string-labeled ones. **R6 derives the canonical chapter domain from the OBSERVED labels in `beats.jsonl` (not from `verification.json`)**, then sorts per a per-book label-class precedence:
   - **`crystal_shard` (R6's sole in-scope book) precedence**: `prelude → -1`, `<int N> → N`, `epilogue → 1000`, `epilogue2 → 1001`, `epilogue3 → 1002`. NO `part*` labels exist in crystal_shard; the mapping is closed at the labels above.
   - **`streams_of_silver` precedence (R5 W1 scoped, NOT used in R6 — preserved as documentation only)**: `prelude → -1`, `<int N> → N`, `part1 → 50`, `part2 → 51`, `part3 → 52`, `epilogue → 1000`. The `part*` placement at 50/51/52 was Codex-flagged in R5 because part1/2/3 are SUBSTANTIVE beats, not empty headers; the 50/51/52 fallback is acceptable only as a per-book convention, not a generic bundle rule. R6 does NOT process streams_of_silver, so this mapping is unused; a future LitRPG/streams charter must validate that part-header placement is semantically correct (or filter `part*` rows out before extraction) before the mapping ships in production.
   - **`halflings_gem` precedence (preserved as documentation only)**: same shape as crystal_shard.

   The `chapter_canonical_index` is the integer above; raw labels are preserved alongside it.

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

### Output shape (R6 single-stratum)

R6 outputs are crystal_shard-only:

- `novels/salvatore-icewind-dale/structure/crystal_shard/value-charge.jsonl`
- `novels/salvatore-icewind-dale/structure/crystal_shard/promises.json`
- `novels/salvatore-icewind-dale/structure-gold/crystal_shard/{value-charge,promises}.jsonl`
- `novels/salvatore-icewind-dale/structure-calibration/crystal_shard.json`

The follow-on LitRPG-extension charter introduces the second stratum's directory and the cross-stratum stratification-difference test.

## 4. Deliverables (R7)

R6's deliverables 1-6 shipped on `phase-variant-screen` branch. R7 adds 9 + 10 + 11; deliverables 7 + 8 still depend on the smoke verdict.

1. **2 new extractor agents** under `src/agents/structure-value-charge/` and `src/agents/structure-promise/` — emit the canonical `*_label + *_index` PromiseRegistry schema (R5 B2 fix completed in R6). **SHIPPED.**
2. **`scripts/corpus/extract-structure.ts`** — Stage 6 smoke driver, hardcoded to crystal_shard for v1. **SHIPPED.**
3. **`scripts/corpus/sample-for-adjudication.ts`** — gold-set sampler. **SHIPPED.**
4. **`scripts/corpus/compute-calibration.ts`** — precision/recall/F1 + confidence calibration curve. **SHIPPED.**
5. **Extended `verify-pipeline.py`** — Stage 6 smoke invariants (semantic invariants per dimension, evidence-quote substring check, schema check, coverage check, full-domain chapter-label invariant per §3). **SHIPPED.**
6. **Reference novel processed**: `crystal_shard` slice of `salvatore-icewind-dale` bundle (fantasy stratum). NO LitRPG novel processed in R6/R7. **SHIPPED via extract-structure.ts run.**
7. **`docs/charters/corpus-structural-decomposition-v1-results.md`** — verdict charter post-smoke, citing `structure-calibration/crystal_shard.json` and naming whether either extractor cleared its dimension's pre-registered hypothesis from §1 (value-charge: P ≥ 0.78 AND R ≥ 0.65 AND F1 ≥ 0.71; PromiseRegistry: R ≥ 0.80 AND P ≥ 0.65 AND F1 ≥ 0.71). **PENDING gold + calibration runs.**
8. **Decision-doc entry** in `docs/decisions.md`: smoke result + follow-on routing (LITRPG-EXTENSION-CHARTER / NO-CHARTER / SINGLE-DIM-ONLY). **PENDING smoke verdict.**
9. **`scripts/corpus/llm-judge.ts`** (R7 NEW) — V4 Pro auto-judge driver. Reads `<dim>-prompts.jsonl`, re-runs extractor prompts/schemas through V4 Pro judge agents, emits `<dim>-gold.jsonl`. **SHIPPED.**
10. **`docs/structure-sonnet-judge-rubric.md`** (R7 NEW) — rubric for routing premium-sample arbitration through Sonnet (via Agent subagent) or Codex (via codex:codex-rescue). Documents the cross-family judge protocol + cross-judge disagreement metrics + anti-patterns. **SHIPPED.**
11. **Two judge agent roles** in `src/models/roles.ts` (R7 NEW): `structure-value-charge-judge` and `structure-promise-judge`, both routing to V4 Pro thinking-on. **SHIPPED.**

## 5. Cheapest counterfactuals considered (R6)

R6 IS the cheapest counterfactual to R5, applied (per Codex R5's named counterfactual: "Single-book crystal_shard instrumentation smoke"). Below: counterfactuals considered RELATIVE to R6.

- **2-book × 2-dimension pilot (R5's scope)**. Rejected at R6: LitRPG bundle does not exist on disk; the 2-stratum pilot is structurally unrunnable as chartered. Codex R5's cheapest counterfactual (R6's scope) was named explicitly.
- **Stratification-difference test in v1.** Rejected at R6: requires 2 strata; can't run without LitRPG bundle. Deferred to the follow-on charter that opens IFF R6 SCOPED PASS or PARTIAL.
- **Hand-tag without LLM extractor** (~3 days, 0 LLM cost). Considered. Rejected because the smoke's calibration question is "is the LLM extractor reliable" — hand-only tagging answers a different question (does the dimension exist in the corpus). The follow-on charter MAY do hand-only annotation if R6 fails; this isn't load-bearing for now.
- **Synthetic-corpus calibration only** (~$2, ~3 days). Rejected — synthetic data calibration doesn't transfer (per `docs/decisions.md` "Synthetic teacher accuracy doesn't predict calibration on marginal cases"). Real corpus is mandatory for the calibration claim.
- **Defer until autonomous-loop is live** (~0 cost). Rejected — `docs/designs/autonomous-context-loop.md` is sub-loop scoped per layer; without corpus-derived priors, sub-loop 1 (planning) has no target distribution to converge against.
- **Half-book smoke** (~$0.05, ~1 day). Considered. Rejected because the PromiseRegistry extractor needs the full novel context to identify cross-chapter promises (a half-book sample would systematically miss long-arc promises that close in the second half). Crystal_shard at full length is the minimum viable scope for the PromiseRegistry dimension.

## 6. Distribution match + invariants (R6)

Stage 6 smoke inherits the 14 conservation invariants from `corpus-pipeline.md` and adds the four invariants in §2 ("Verification invariants" — coverage, schema, evidence-quote substring, per-dimension semantic) plus the §3 normalization invariants (per-book slice, full chapter-label domain, sort key, no silent epilogue drop).

**Distribution claims (R1 issue 3 fix; R6 scope):**

- All distributional metrics in §1 (CV, mean, median, IQR) ARE NOT REPORTED in R6 (single-book scope; CV-CI requires ≥2 books). Distribution claims are deferred to the follow-on charter that adds LitRPG.
- The smoke's verdict is a per-cell calibration claim (P/R/F1 against gold), not a distribution claim.

`scripts/corpus/verify-pipeline.py` extended to audit Stage 6 invariants on crystal_shard.

## 7. Success criteria + next steps (R6 — single-stratum smoke)

### Verdict gates (smoke — extractor-reliability question on crystal_shard)

**Per dimension cell on crystal_shard, applied in order — first matching predicate wins (R2 blocker 1 fix — cost-function-anchored thresholds):**

| Cell verdict | value-charge predicate (precision-first) | PromiseRegistry predicate (recall-first) |
|---|---|---|
| **NULL-GOLD** | adjudicator-drift > 15% (R2 blocker 3) | same |
| **CELL PASS** | P ≥ 0.78 AND R ≥ 0.65 AND F1 ≥ 0.71 | R ≥ 0.80 AND P ≥ 0.65 AND F1 ≥ 0.71 |
| **CELL MARGINAL** | (lead metric in [0.65, threshold)) AND F1 ≥ 0.60 | (lead metric in [0.70, threshold)) AND F1 ≥ 0.60 |
| **CELL FAIL** | F1 < 0.60 OR lead < 0.65 | F1 < 0.60 OR lead < 0.70 |

Lead metric = P for value-charge, R for PromiseRegistry (per cost-function asymmetry, §1).

Adjudicator-drift in [10%, 15%]: cell verdict carries a ±0.05 F1 uncertainty band. Threshold-edge cells reported with the band; do NOT promote a "with-band" pass over the un-banded threshold.

### Aggregated smoke verdict (R5 B3 fix — single source of truth for verdict function)

R6's smoke has 2 cells: `value-charge × crystal_shard` and `PromiseRegistry × crystal_shard`. There is exactly ONE aggregation rule. §1's earlier "falsification rule" (which conflicted with this aggregation in R5) is REPLACED by a §7 reference; this section is the SOLE verdict function.

**Verdict computed cell-by-cell, then aggregated. NULL-GOLD on one cell does NOT override the other (R3 W4 fix).**

- **SCOPED PASS** — at least 1 cell is CELL PASS. Open follow-on charter scoped to that calibrated cell's dimension × `crystal_shard` only. NOT a green light to run all 6 dims × 8 books, and NOT a green light to assume the dimension generalizes to LitRPG. Reports the NULL-GOLD cell separately if applicable.
- **PARTIAL** — at least 1 cell CELL MARGINAL, no cell CELL PASS. Follow-on charter MAY iterate on prompts (one round) before re-running the smoke on the marginal cell.
- **NULL-GOLD-ONLY** — both cells NULL-GOLD. Schema is too subjective for single-rater smoke. Follow-on REQUIRES second human rater on at least one dimension before further work.
- **FAIL** — all non-NULL-GOLD cells are CELL FAIL. Close the corpus-structural-tagging family on crystal_shard. Pivot Bucket 3 toward per-book voice-LoRA imitation as the structural lever. Per §1's falsification reference, this IS the falsification verdict.

NULL-GOLD on an individual cell is reported in all verdicts (PASS/PARTIAL/FAIL alike) so the follow-on charter can decide whether to recruit a 2nd rater for that specific cell or accept the partial signal.

### Stratification signal — DEFERRED (R6 single-stratum scope)

R5's STRATA-DIFFER / STRATA-SIMILAR signal computation requires 2 strata. R6 has 1. The signal is deferred to the follow-on charter that adds the LitRPG stratum.

### Decisions surfaced for downstream charters

R6's output IS the calibration baseline for crystal_shard for any future structural-tagging charter. Follow-on charters cite `corpus-calibration-crystal_shard-smoke.json` as the per-dimension precision/recall floor on crystal_shard. Generalizing across books or genres requires additional smokes; one book is one book.

## 8. Budget (R6 — single-book smoke)

### LLM cost

Single explicit formula:

**Per-call cost on DeepSeek V4 Flash** (`registry.ts`: $0.14/1M input, $0.28/1M output):
- value-charge: 1.5K input + 200 output → 1.5K × 0.14e-6 + 0.2K × 0.28e-6 = $0.000266/call.
- PromiseRegistry: 50K input + 2K output (thinking-on; 2-pass for open + close) → 50K × 0.14e-6 + 2K × 0.28e-6 = $0.00756/call.

**Crystal Shard Stage 6 extraction (R6 sole in-scope book):**
- value-charge: ~150 scenes × $0.000266 = **$0.040**.
- PromiseRegistry: 2 passes × $0.00756 = **$0.015**.

**Crystal Shard Stage 6 total: ~$0.055 base.**
**Retry buffer (Stage 6 only) at 3×** (schema-mismatch + prompt iteration): $0.055 × 3 = **$0.165** (inclusive).
**Adjudication helper Sonnet** (first-pass tagging assist for ambiguous rows; ~60-100 calls/dimension at ~$0.005/call): **$0.50.**
**LitRPG ingest cost: $0** (LitRPG ingest is OUT of R6 scope; the follow-on charter that adds LitRPG carries the ~$10–20 ingest cost per `corpus-pipeline.md` Stages 1–5).

**R6 smoke total: $0.165 + $0.50 = ~$0.67. Round-up reserve: ~$1.**

R3 had budgeted ~$1.50 (Stage-6-only). R4 had ~$12. R5 had ~$22. R6 collapses to ~$1 by deferring the LitRPG stratum entirely. Still well under any benchmark re-train cost.

### R7 LLM-judge cost delta (replaces human time, not LLM extraction)

The R6 extraction-side budget is unchanged. R7 ADDS judge calls and SUBTRACTS adjudicator time:

**V4 Pro auto-judge cost** (`structure-{value-charge,promise}-judge` roles):
- Pricing: $1.74/$3.48 per 1M tokens base; $0.435/$0.87 promo (75%-off until 2026-05-31).
- value-charge: 50 rows × (1.5K input + 1K output) = 75K + 50K = $0.131 + $0.174 = **$0.305 base / $0.076 promo**.
- PromiseRegistry: 2 passes × (50K input + 4K output) = 100K + 8K = $0.174 + $0.028 = **$0.202 base / $0.051 promo**.
- Both dims: **$0.51 base / $0.13 promo**.

**Sonnet/Codex subagent cost (premium sample)**: billed externally to the harness; ~10-row arbitration sample per dim consumes ~5-10 minutes of subagent compute total. No direct LLM cost in `llm_calls` ledger (subagents run in the orchestrator's billing, not the harness account).

**Adjudicator time saved**: R6's gold protocol required ~30-50 samples × ~3 min/sample × 2 dims + ~45 min for retest = ~3-5h adjudicator time. R7 returns this time to the operator. The R7 cross-judge sanity-check on 10 disagreed rows costs ~5 min.

**R7 total budget delta**: + ~$0.50 LLM, − 3-5h adjudicator. Net: ~$1.50 per smoke for both dimensions, ~3 working days end-to-end (was ~3 days for R6 because adjudication was the long tail; R7 collapses that).

### Time

- Source normalization step (R3 B3): ~0.5 day (new pre-flight script + invariants).
- Extractor prompt + schema design (2 dims, with full `*_label + *_index` PromiseRegistry schema R5 B2): ~1 day.
- Extractor implementation + integration with `scripts/corpus/run.ts`: ~0.5 day.
- Stage 6 extraction runs: ~1 hour wall-clock (1 book × 2 extractors).
- Gold-set adjudication: ~0.5 day primary pass (60–100 samples × 2 dims × ~3 min/sample = ~6–10h, but 1 book worth of scenes/promises is ~2× lighter than R5's 2-book scope). Plus ~45min for 10% silent retest. Total ~0.6 day.
- Calibration + invariant verification + adjudicator-drift report + verdict: ~0.25 day.
- Results note + verdict (NOT a follow-on charter — that's only opened if R6 SCOPED PASS or PARTIAL): ~0.25 day.

**Total: ~3 working days. ~1 week calendar.** R5 was ~5.75 days; R6 collapses LitRPG ingest (1 day) + gold adjudication scope (0.6 day) + extractor design (1 day vs 2).

### Pre-gate calendar

NONE for R6. The Salvatore bundle exists on disk; no acquisition required.

LitRPG PDF acquisition becomes a follow-on charter's pre-gate IFF R6 verdict is SCOPED PASS or PARTIAL.

## 9. Linked context (R6)

- `docs/research/writing-frameworks/SYNTHESIS.md` §1 + §2 — convergence ranking. value-charge (5 frameworks) + PromiseRegistry (3 frameworks) selected as R2's two dimensions; preserved in R6.
- `docs/corpus-pipeline.md` — existing 5-stage corpus pipeline; R6 adds Stage 6 on crystal_shard only. Updated file paths (`{scenes,beats,pairs}.jsonl`, NOT `.json`) per R1 warning #2 fix.
- `docs/charters/salvatore-v5-corpus-expansion.md` §3 — PDF pre-gate pattern. R6 itself has NO pre-gate (Salvatore bundle exists on disk); the LitRPG-extension follow-on charter copies this pattern for its own pre-gate.
- `docs/decisions.md` — "Plan-only extractionMode validated — LLM extractors removed" + "Synthetic teacher accuracy doesn't predict calibration on marginal cases" + "Genre DOES differentiate" — R1 RED rationale.
- `docs/lessons-learned.md` — "Eval-brief stratification must match training-data stratification" + "1-10 judges showed 0-33% discrimination" — anchors for R2's stratum-split + confidence-calibration design.
- `docs/experiment-design-rules.md` §11 (lever selection) — R6's framework. R6 IS Codex R5's named cheapest counterfactual.
- `docs/todo.md` "Three-bucket forward plan" — this charter is Bucket 1.
- `novels/salvatore-icewind-dale/{scenes,beats,pairs}.jsonl` — R6's sole input source (filtered to `book == "crystal_shard"`).
- `novels/manifest.json` — only 1 bundle today (`salvatore-icewind-dale`). LitRPG expansion is the follow-on charter's pre-gate.
- Git commit `a2889f2` — R5 design preserved as the starting point for the LitRPG-extension follow-on if R6 SCOPED PASS or PARTIAL.

## 10. Adversary review

| Reviewer | Date | Verdict | Thread |
|---|---|---|---|
| codex:codex-rescue gpt-5.5 effort=high | 2026-04-29 | **R1 RED** | `a2dfdb5c339c911f8` |
| codex:codex-rescue gpt-5.5 effort=high | 2026-04-29 | **R2 YELLOW** | `aed14f4069c607b16` |
| codex:codex-rescue gpt-5.5 effort=high | 2026-04-29 | **R3 YELLOW** | `a78a3f201ecc4bf63` |
| codex:codex-rescue gpt-5.5 effort=high | 2026-04-29 | **R4 YELLOW** | `afcade8df722c3a13` |
| codex:codex-rescue gpt-5.5 effort=high | 2026-04-29 | **R5 YELLOW (REVISE-R6)** | `a9d06835481391bd5` |
| (R6 not reviewed — implementation-shipped) | 2026-04-29 | NOT REVIEWED | n/a |
| (R7 pending) | (pending) | (pending) | (pending) |

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

### R5 verbatim verdict (preserved for audit)

> VERDICT: YELLOW
>
> SUMMARY: R5 closes the R4 source-shape bugs (`scene_ordinal`, chapter-label domain mapping, 92-row epilogue count), but three blocking issues remain.
>
> BLOCKING ISSUES:
> 1. Axis 4 — LitRPG pre-gate not cleared; only the Salvatore bundle exists on disk; the 2-stratum pilot cannot be executed as chartered (§7.1). Fix: ingest a LitRPG PDF/bundle before review OR narrow the charter to an explicit one-stratum smoke.
> 2. Axis 5 — PromiseRegistry schema is inconsistent: int-only fields in some sections, *_label + *_index fields in others, reversion to int-only in the extractor schema. The join rule used to compute P/R/F1 is undefined (§3.1, §7.4). Fix: pick one canonical chapter representation and rewrite every schema, matching rule, and invariant to it.
> 3. Axis 7 — §1 falsification and §7 aggregated verdict logic produce incompatible verdicts on the same result matrix, making the post-run decision non-interpretable (§7.4). Fix: collapse to one pre-registered aggregation rule and rewrite falsification to be consistent with it.
>
> WARNINGS:
> - streams_of_silver part1/2/3 are substantive beats (not empty headers); the 50/51/52 ordinal mapping is only safe scoped to crystal_shard and must not become a generic bundle rule without a true in-book placement policy (§4.6).
>
> CHEAPEST UNTRIED COUNTERFACTUAL: Single-book crystal_shard instrumentation smoke (~$0.10-0.50 LLM cost) to flush schema and join-contract defects before paying LitRPG ingest. Expected zero extractor-quality movement but high defect-detection value.
>
> RECOMMENDED NEXT ACTION: REVISE CHARTER (ITERATE-R6)

R6 takes Codex's named cheapest counterfactual. Submit R6 to Codex for follow-up review before implementation begins.

### R6 attack surfaces for Codex

(Preserved for context; R6 was implementation-shipped without Codex review at user direction. R7 attack surfaces below extend these.)

- **Single-stratum verdict aggregation.** R6 §7 collapses the verdict function to per-cell within crystal_shard's 2 cells. §1 falsification is replaced by a §7 reference (R5 B3 fix). Verify the §7 aggregated rule is now the SOLE verdict function and §1 cannot fire incompatibly. Are there cells the smoke could produce that §7's table doesn't cover (e.g., one cell PASS, one cell NULL-GOLD — does that map to SCOPED PASS cleanly per the table)?
- **PromiseRegistry schema unification on `*_label + *_index`.** R6 §2 + §3 + §3.1 all use the canonical `*_label + *_index` representation; the extractor agent emits both in a single pass; the matching policy joins on `*_index`. Verify there's no remaining int-only or label-only schema slip in §1, §2, §3, §3.1, §7.
- **Streams_of_silver mapping scoping.** R6 §3 keeps the streams_of_silver `{part1: 50, part2: 51, part3: 52}` mapping as documentation but explicitly notes it's NOT used in R6.
- **Crystal_shard chapter-label domain completeness.** R6 §3 says crystal_shard's domain is `{prelude, 1..30, epilogue, epilogue2, epilogue3}`. Verified empirically during R7 implementation: 858 beats / 34 chapters, all labels match this domain, scene_id parses 100% clean.
- **Cheapest-counterfactual fidelity.** Codex R5 named the smoke as "~$0.10–0.50 LLM cost." R6 budgets ~$1 inclusive of retry buffer + adjudication helper.
- **Scope-cut completeness.** R6 cut: LitRPG bundle, secondary stratification question, tertiary CV-CI sanity check.

### R7 attack surfaces for Codex

- **Capability-gradient independence vs same-family bias.** R7 §2 argues V4 Pro thinking-on is "independent enough" from V4 Flash non-thinking because of the capability gradient. Codex R6 W1 (raised but not addressed because R6 was not reviewed) flagged the in-family contamination risk for the Sonnet helper case. R7's case is stronger because Pro >> Flash, but it's still in-family. Is the cross-family Sonnet/Codex sample on the lowest-confidence quartile a sufficient mitigation, or does R7 need the full Sonnet/Codex pass on every row to clear the contamination concern?
- **NULL-GOLD trigger weakening.** R6's NULL-GOLD fired on adjudicator self-disagreement > 15% — a quantitatively-grounded heuristic backed by per-judge variance. R7's NULL-GOLD fires on cross-judge disagreement > 30% AND a manual review of 5 disagreed rows. The "AND manual review" gate is operator-discretion-shaped and re-introduces single-rater dependence at the trigger boundary. Is R7's NULL-GOLD trigger architectural-equivalent to R6's, or is it strictly weaker?
- **Stability guard correctness.** R7 says "V4 Pro at temp=0.1 / 0.3 with fixed prompt is near-deterministic, sample variance < 5% per docs/lessons-learned.md." Verify the lessons-learned citation actually supports this for V4 Pro on extraction tasks (rather than for V3.2 / Flash).
- **Verdict claim weakening.** R7's verdict measures "extractor ↔ LLM-judge agreement" not "extractor ↔ ground truth." R7 §0a acknowledges this in writing. Is the acknowledgment sufficient — or does the verdict gate language in §7 (CELL PASS / MARGINAL / FAIL / NULL-GOLD) need to change to reflect that it's now an agreement metric rather than a calibration metric?
- **Sonnet/Codex subagent path is documentation, not code.** Unlike V4 Pro auto-judge (which has a runnable script), the cross-family arbitration step is a markdown doc that requires the operator (or Claude in a session) to spawn the subagent manually. Is this enough scaffolding for the protocol to actually run, or does R7 need a runnable orchestrator script for the subagent path too?
- **R6 was not Codex-reviewed.** R7 inherits R6's design and adds the LLM-judge protocol on top. Any R6 attack surface Codex would have flagged is now an R7 attack surface. Codex MUST review R7 with R6's design as part of scope, not just the R7 deltas.
- **Falsification rule change.** R6 replaced §1's "both extractors fall below their dimension's hypothesis on at least one stratum → close the family" with "§7 aggregated FAIL → close the family." Is this a faithful rewrite, or did R6 make falsification weaker (e.g., R5's rule could fail because the LitRPG-only stratum failed; R6's rule needs BOTH cells to fail because R6 has only one stratum)? At single-stratum scope, "FAIL means both crystal_shard cells failed" — Codex should verify this matches the falsification intent (the family-level conclusion is "extractors are unreliable on the data we have," which on a single book translates to "both dimensions failed on this book").
- **Post-smoke decision tree.** R6 §0 says: SCOPED PASS or PARTIAL → follow-on charter with LitRPG materialized; FAIL → close family. PARTIAL has a "MAY iterate one round on prompts" clause — does R6 preserve enough of the smoke artifacts (gold, calibration, normalized files) to support that prompt iteration without re-running adjudication? If iterating means re-adjudicating, the budget needs another ~0.5 day.
