---
status: draft (pending Codex adversarial review)
kind: experiment-charter
name: corpus-structural-decomposition-v1
owner: andre
date: 2026-04-29
revision: 1
parent-context: docs/research/writing-frameworks/SYNTHESIS.md, docs/corpus-pipeline.md, docs/todo.md "Three-bucket forward plan"
---

# Experiment Charter — `corpus-structural-decomposition-v1`

## 0. Tl;dr

Extend the existing 5-stage `corpus-pipeline.md` to 6 stages by adding a structural-tagging pass that extracts framework-level features from already-decomposed novel bundles. Run on 5–10 reference novels weighted to target market (LitRPG-heavy + Salvatore/Sanderson anchors). Aggregate to `corpus-distributions.json`. Output is **decision-grade**: which framework prescriptions does the target corpus actually validate (vs. expert prescription that doesn't generalize to the target market)?

This is a **read-only** experiment — no runtime-pipeline impact, no harness changes. Pure analysis, generates priors data for downstream Bucket 3 refactor decisions.

## 1. Question

**Primary:** Of the framework prescriptions catalogued in `docs/research/writing-frameworks/SYNTHESIS.md` (50 levers, 5 structural refactors), **which are empirically present in the target-market reference corpus** at distributions material enough to be worth encoding into the harness?

**Secondary:** Where the corpus disagrees with framework expert opinion, which side does the harness encode? (E.g., LitRPG progression novels almost certainly violate Snyder's 25% First Plot Point rule. Whose number wins?)

**Hypothesis (template-compliant per `experiment-charter-template.md`):**

> H1: A subset of the 5 structural refactors from SYNTHESIS.md ($\le 5$ candidates) will show **distributions in the reference corpus that are tight enough to encode as planner constraints** (coefficient of variation $< 0.5$ across the 5–10 reference novels), while a complementary subset will show distributions so wide that any encoded prescription would be either wrong or vacuous.

**Falsification:** the corpus distributions are wide enough across all 5 refactors that NONE survive as encodeable constraints. In that case, the framework synthesis was right that the prescriptions exist, but wrong that they're tight enough to be load-bearing in production. Verdict: do not encode framework structural levers; the corpus says structure varies too much to be a constraint.

**This charter does NOT propose runtime-pipeline changes.** It produces the empirical baseline that downstream charters cite.

## 2. Scope

### In scope

- **Corpus selection**: 5–10 reference novels weighted toward target genres (LitRPG primary, fantasy secondary). Working candidate list:
  - **Cradle Bk1 (Unsouled, Wight)** — progression-fantasy keystone
  - **Cradle Bk2 (Soulsmith, Wight)** — second-book structure check (does the same author maintain MICE balance across volumes?)
  - **Dungeon Crawler Carl Bk1 (Dinniman)** — comedy-LitRPG, system-voice anchor
  - **He Who Fights with Monsters Bk1 (Aronica/Shirtaloon)** — first-person LitRPG, second-genre anchor
  - **Mother of Learning Bk1 (Domagoj Kurmaic)** — time-loop progression, MICE-thread density anchor
  - **Beware of Chicken Bk1 (CasualFarmer)** — slice-of-life cultivation, low-stakes structure anchor
  - **Salvatore — Crystal Shard / Streams of Silver / Halfling's Gem** (already in corpus) — fantasy reference, voice-LoRA training source
  - **Sanderson — Way of Kings or Mistborn Bk1** — high-fantasy ceiling, professional-craft anchor
- **Tagging passes** (extension of existing scenes→beats→briefs cascade in `corpus-pipeline.md`):
  - **Per-chapter MICE type** (Sanderson): one of `Milieu | Inquiry | Character | Event`. LIFO open/close discipline annotation per chapter.
  - **Per-scene value-charge** (Coyne / McKee / Yorke / Truby / Swain): `valueIn`, `valueOut`, `lifeValue` (the value-axis the scene operates on), `polarity ∈ {+, −, 0}`.
  - **Per-beat Yorke-phase** (Yorke): `setup | call-to-action | refusal | crossing-the-threshold | tests | midpoint | reversal | dark-night | climax | resolution` (13-phase decomposition).
  - **Per-novel PromiseRegistry** (Sanderson + Lisle + LitRPG): array of `(promise_text, opened_chapter, closed_chapter | null, payoff_quality)`. Captures the dangling-setup / deus-ex-machina detection surface.
  - **Per-novel Lie/Truth/Want/Need** (Truby): the 4-element character-arc spine for the protagonist. One per book.
  - **Per-novel character web** (Truby): graph of `(character_a, character_b, edge_type)` where edge_type ∈ `{ally, opponent, fake-ally, foil, mentor, romantic-interest, ...}`. Character roles relative to protagonist.
- **Aggregations**:
  - `novels/<key>/structure.json` per book (typed schema; see §4 deliverables).
  - `corpus-distributions.json` aggregate (mean / median / IQR / min / max / coefficient-of-variation per metric across the corpus).
  - Per-metric assessment: does the distribution support encoding as a planner constraint? Threshold: $CV < 0.5$ for "tight enough"; $0.5 \le CV < 1.0$ for "soft prior"; $CV \ge 1.0$ for "do not encode."
- **Verification invariants** (extension of the 14 conservation invariants in `corpus-pipeline.md`):
  - Every chapter has exactly one MICE primary type.
  - Every scene has $valueIn \in \{+, -, 0\}$ and $valueOut \in \{+, -, 0\}$.
  - PromiseRegistry: every `closed_chapter` references a real chapter in the book; every novel has $\ge 0$ unresolved promises by end-of-book.
  - Character web: every edge cites at least one chapter where the relationship is observed.

### Out of scope

- **Any runtime-pipeline change.** This charter produces analysis artifacts. Bucket 3 charters cite this output to justify pipeline refactors.
- **Encoding any specific structural refactor.** Decisions about MICE thread tracking, PromiseRegistry as cross-cutting state, etc. land in separate charters.
- **Beat-level value-shift checking in production.** A Bucket 3 candidate; not this charter.
- **Voice / cadence / sentence-level analysis.** Already covered by the writer-imitation-benchmark and Salvatore voice LoRA workstreams; this charter focuses on structural skeleton only.
- **Adversary-review-blocked or pending-PDF books** (per `docs/charters/salvatore-v5-corpus-expansion.md` workflow — keep that pre-gate intact for Salvatore expansion).
- **The 50-knob roadmap from SYNTHESIS.md.** Most knobs are additive layers; their value is gated on this charter producing supporting corpus distributions.

## 3. Approach

### Stage-6 pipeline addition (extends `corpus-pipeline.md`)

Existing pipeline (per `docs/corpus-pipeline.md`):
```
ingest → scenes → beats → briefs → analysis (Stages 1-5)
```

New stage:
```
ingest → scenes → beats → briefs → analysis → structure (Stages 1-6)
```

Stage 6 (structure) reads the existing `novels/<key>/{scenes,beats,briefs}.json` artifacts and produces `novels/<key>/structure.json`. Pure read-only over Stages 1-5 outputs. Cleanly resumable.

### Extraction agents

Each tag is produced by a focused LLM extraction call with a tight schema and small temperature ($\le 0.2$):

- **`structure-mice-extractor`** — input: chapter scenes + briefs; output: `{primary_mice_type, secondary_mice_types[], opened_threads[], closed_threads[], confidence}`.
- **`structure-value-charge-extractor`** — input: scene briefs + chapter context; output per-scene: `{valueIn, valueOut, lifeValue, polarity, confidence}`.
- **`structure-yorke-phase-extractor`** — input: chapter beats + book-level position; output per-beat: `{phase ∈ <13-phase enum>, confidence}`.
- **`structure-promise-extractor`** — input: full chapter beats sequence; output: `{promise_text, opened_chapter, hint_locations[]}`. Run end-of-book pass to populate `closed_chapter` / `payoff_quality` retroactively.
- **`structure-character-arc-extractor`** — input: full novel beats + briefs; output: `{protagonist, lie, truth, want, need, evidence_chapters[]}`. One call per novel.
- **`structure-character-web-extractor`** — input: full novel + character list; output: `{edges[], evidence_per_edge[]}`. One call per novel.

All agents land under `src/agents/structure-*` following existing agent-dir conventions. Prompt files in each agent dir, schema.ts uses zod, context.ts builds the input envelope. Integration with the corpus pipeline via `scripts/corpus/run.ts` extending the stage list.

### Aggregation

`scripts/corpus/aggregate-distributions.ts` reads every `novels/<key>/structure.json` and produces `corpus-distributions.json`:

```
{
  "corpus_size": 8,
  "metrics": {
    "mice_balance": { "M_pct": 0.18, "I_pct": 0.34, "C_pct": 0.27, "E_pct": 0.21, "cv": 0.4, "encodeable": true },
    "act1_pct_chapters": { "mean": 0.31, "median": 0.30, "iqr": [0.27, 0.34], "cv": 0.18, "encodeable": true },
    "promises_opened_per_chapter": { "mean": 0.8, "cv": 0.6, "encodeable": "soft" },
    "yorke_phase_density_per_act": { ... },
    "char_web_edge_count_per_novel": { ... },
    ...
  }
}
```

`encodeable` field is the load-bearing decision per metric:
- `true` if $CV < 0.5$ — tight enough to encode as a planner constraint (e.g., "MICE balance must fall in 0.15-0.25 / 0.30-0.40 / ..." ranges).
- `"soft"` if $0.5 \le CV < 1.0$ — encode as a prior, not a constraint.
- `false` if $CV \ge 1.0$ — distribution too wide; do not encode.

## 4. Deliverables

1. **6 new extractor agents** under `src/agents/structure-*` with prompt + schema + context per existing convention.
2. **`scripts/corpus/extract-structure.ts`** — Stage 6 driver, runs all 6 extractors per novel, writes `novels/<key>/structure.json`.
3. **`scripts/corpus/aggregate-distributions.ts`** — reads all structure.json files, produces `corpus-distributions.json`.
4. **Extended `verify-pipeline.py`** — adds Stage 6 invariants to the existing 14-invariant audit.
5. **Reference novels processed** — minimum 5 books, target 8–10. PDFs already on disk for Salvatore + Sanderson; LitRPG sources require pre-gate (PDF acquisition) per the same shape as `salvatore-v5-corpus-expansion.md`.
6. **`docs/charters/corpus-structural-decomposition-v1-results.md`** — verdict charter post-extraction, citing the `corpus-distributions.json` blob and naming which metrics survive each `encodeable` threshold.

## 5. Cheapest counterfactuals considered

- **Just trust the framework synthesis directly** — rejected. Memory `feedback_engineering_frame_for_novel_writing` says measurable ground truth (real published prose) over expert eyeballing. Voice already validated this for cadence (Howard primer retired in favor of corpus-derived Salvatore LoRA). Same epistemology applies to structure.
- **Hand-tag one book** — rejected as incomplete. Single-book tags can't produce distributions; the load-bearing question ("how tight is the prescription?") needs $n \ge 5$.
- **LLM-judge framework agreement on existing harness output** — rejected. Memory `feedback_engineering_frame_for_novel_writing` + decisions.md "1-10 judges showed 0-33% discrimination" — LLM judges on subjective structural questions are unreliable. Corpus-derived counts are not.
- **Extract only one tag dimension (e.g., MICE only)** — considered. Single-dim extraction would cost ~$2 instead of ~$15. Rejected because the SYNTHESIS.md convergences (5 frameworks all converge on value-shift; 3 frameworks on PromiseRegistry; etc.) lose their cross-validation power without multi-dim tagging. The corpus's value comes from the joint distribution, not any single axis.
- **Defer until a runtime-refactor charter requires the data** — rejected. Bucket 3 charters NEED this data as a precondition; deferring would stall both. Better to land the corpus baseline as its own vertical slice.

## 6. Distribution match + invariants

Stage 6 inherits the 14 conservation invariants from `corpus-pipeline.md` and adds:

- **MICE-balance invariant.** Sum of MICE-type chapter counts equals total chapters.
- **Value-charge invariant.** Every scene has both `valueIn` and `valueOut`; transitions are not assumed to be symmetric (a `+` scene can open with `+` and end with `+`).
- **Promise-balance invariant.** Number of opened promises ≥ number of closed promises (open promises at end-of-book are valid; closed-without-opened is a tagging error).
- **Yorke-phase ordering.** Phase sequence is monotonic per Yorke's spec (no `climax` before `crossing-the-threshold` in any chapter).
- **Character-arc completeness.** Every novel has exactly one `(lie, truth, want, need)` quadruple for the protagonist; antagonists may have a partial spine.

`scripts/corpus/verify-pipeline.py` extended to audit all of these per-novel.

## 7. Success criteria + next steps

### Verdict gates

- **PARTIAL-SUCCESS:** at least 1 metric crosses the $CV < 0.5$ threshold AND at least 1 metric crosses the "soft prior" threshold ($0.5 \le CV < 1.0$). This is the expected outcome; opens at least one Bucket 3 candidate refactor with corpus-derived parameters.
- **FULL-SUCCESS:** $\ge 3$ metrics cross the $CV < 0.5$ threshold. Strong empirical baseline for at least 3 of the 5 structural refactors.
- **NULL-RESULT:** all metrics show $CV \ge 1.0$. Falsifies H1; the framework synthesis prescriptions are too varied across the corpus to be encoded as planner constraints. In this case, structural changes proceed only via per-book voice-LoRA-style imitation, not generic constraints.

### Next-step branches

- **PARTIAL or FULL:** open Bucket 3 refactor charter for the top-1 highest-CV-survivor metric. Each refactor charter cites this charter's `corpus-distributions.json` as its empirical baseline. Refactor charters are gated on Bucket 2 eval module being live (so the refactor's effect can be measured).
- **NULL:** close the structural-refactor bucket entirely. Pivot to other quality strategies (writer-model upgrades, voice-LoRA scaling, prompt-only context-engineering).

### Decisions surfaced for downstream charters

`corpus-distributions.json` becomes the canonical priors document for any planner-constraint discussion. Snyder's 10% rule, Brooks's 25% First Plot Point, Sanderson's MICE balance: each gets validated or falsified per-genre.

## 8. Budget

### LLM cost

Per-novel extraction (6 calls, varying input sizes):
- MICE per chapter: ~30 chapters × ~2K input × 200 output → $0.30/book on V4 Flash thinking-on (justified by cross-chapter MICE thread reasoning).
- Value-charge per scene: ~150 scenes × ~1K input × 100 output → $0.15/book on V4 Flash non-thinking.
- Yorke-phase per beat: ~400 beats × ~500 input × 50 output → $0.25/book.
- PromiseRegistry: end-to-end novel pass × ~50K input × 2K output → $0.30/book on V4 Flash thinking-on.
- Character arc: ~50K input × 500 output × 1 call/novel → $0.07/book.
- Character web: ~50K input × 1K output × 1 call/novel → $0.08/book.

**Per-novel total: ~$1.15.** **8-novel corpus: ~$9.20.** **Buffer 2× for retries / re-extractions: ~$20 charter total.**

### Time

- Agent-prompt drafting + schema design: ~3 days.
- Extractor implementation + integration with `scripts/corpus/run.ts`: ~3 days.
- Reference-corpus PDF acquisition + ingest (Stages 1-5 for any books not already in the bundle): ~2 days (parallel with above).
- Stage 6 extraction runs: ~1 day (8 novels × ~1h serial).
- Aggregation + verification: ~1 day.
- Results charter + verdict: ~1 day.

**Total: ~10 working days. ~2 weeks calendar.**

## 9. Linked context

- `docs/research/writing-frameworks/SYNTHESIS.md` — 50-lever / 5-refactor synthesis from 16 framework reports. The priors document this charter validates against the corpus.
- `docs/corpus-pipeline.md` — existing 5-stage corpus pipeline; this charter adds Stage 6.
- `docs/charters/salvatore-v5-corpus-expansion.md` — same PDF-acquisition pre-gate pattern; reuse the workflow.
- `docs/decisions.md` "Corpus pipeline" + "Plan-only extractionMode validated" — decisions establishing the corpus-first epistemology.
- `docs/lessons-learned.md` 2026-04-29 §"Charter R5 cheapest-counterfactual reinforcement" — the pattern that produced this charter (corpus decomp is the cheapest-counterfactual to "encode 50 framework levers blindly").
- `docs/todo.md` "Three-bucket forward plan" — this charter is Bucket 1.
- `novels/<key>/` — existing bundle directory layout this charter extends.
- `src/agents/<name>/` — agent-dir convention used for the 6 new extractor agents.

## 10. Adversary review

| Reviewer | Date | Verdict | Thread |
|---|---|---|---|
| (pending) | (pending) | (pending) | (pending) |

Submit to `codex:adversarial-review` (or `codex:codex-rescue gpt-5.5 effort=high`) before any extractor agent ships. Specific attack surfaces to flag:

- Is the $CV < 0.5$ threshold defensible? (Codex may push for stricter.)
- Are 5–10 books sufficient for the metrics' distributions, given that LitRPG and high-fantasy may need separate distributions?
- Does the per-genre split need to be explicit (separate `corpus-distributions-litrpg.json` + `corpus-distributions-highfantasy.json`)?
- Is the LLM extractor's confidence calibration trustworthy enough to gate "encodeable" decisions on?
- Have I undercounted the per-genre stratification that follows from `feedback_eval_stratification` ("brief sets must match training-data stratification regime")?
- Cheapest-untried-counterfactual to this charter at the corpus-decomp level (probably "tag fewer dimensions; iterate")?
