---
status: draft (RED on R1 — pivoting per cheaper-counterfactual recommendation)
kind: corpus-pipeline-architecture
name: decomposed-extractor-sonnet-anchor-v1
owner: andre
date: 2026-04-29
revision: 1
supersedes-shape: monolithic per-dim Flash extractor + Pro judge calibration (R7 charter v1)
parent-context: docs/charters/corpus-structural-decomposition-v1.md (R7), novels/salvatore-icewind-dale/structure-calibration/crystal_shard-conclusions.md
adversary-verdict:
  R1-design: RED (codex:codex-rescue gpt-5.5 effort=high, agent a9e006dd5bf8d407b, 2026-04-29) — 5 blockers, 3 warnings, named cheapest counterfactual: "Run the current monolithic mice and promise extractors against a Sonnet anchor on one frozen 50-scene sample, plus a close-criteria-only mice prompt sharpen." Recommended action: RUN CHEAPER COUNTERFACTUAL.
  R1-findings: RED (codex:codex-rescue gpt-5.5 effort=high, agent a73cbe165ff62ef4a, 2026-04-29) — review of the conclusions doc this design responds to; 5 blockers, 5 warnings, named cheapest counterfactual: "Judge-stability micro-pilot: rerun the promise judge twice at T=0 with a tightened rubric on a 20-row sample, plus one Sonnet pass on the same rows and manual adjudication of 5 disagreements." Recommended action: RUN CHEAPER COUNTERFACTUAL.
related:
  - docs/decisions.md (decisions log; companion entry on this pivot lands at the same time as this doc)
  - src/agents/structure-mice/mice-system-v2-draft.md (close-criteria ARE re-usable as sub-rubrics)
  - src/agents/structure-value-charge/value-charge-system-v2-draft.md (3-step lattice + commit-to-sign rules ARE re-usable)
  - src/agents/structure-promise/ (the dim that exposed the gold-stochasticity ceiling)
  - feedback_decompose_checker_calls.md (memory: 14B can't handle complex single-call checklists; split per dimension)
  - feedback_gold_stability_first.md (memory: measure judge self-consistency before extractor calibration)
  - feedback_codex_counterfactual_signal.md (memory: treat named cheapest-untried-counterfactual as pivot recommendation, not alternative to refute)
---

# Decomposed extractor + Sonnet anchor (corpus structural-decomposition v2)

## TL;DR

Two architectural changes for the corpus structural-decomposition pipeline, applied per-dim:

1. **Decompose the extractor.** Where a dim asks the model to handle multiple categories or fields in one call, split into N parallel sub-calls each scoped to a tight enum. Mice goes from "one 4-way classification + 6 fields" per scene to "4 parallel binary calls per scene." Promise splits into two sub-dims (`arc-promise`, `setup-payoff-bridge`) with disjoint close criteria.

2. **Replace the Pro judge with a Sonnet anchor.** Instead of using V4 Pro (same model family as Flash extractor) as the calibration judge, use Anthropic Sonnet as a one-shot oracle on a 50-scene sample per dim. Sonnet's an independent model family, validated higher recall (Phase C.1, 2026-04-29), and one-shot cost is $0.50–1.50 per dim per book.

Architecture replaces the Flash×Pro shape that hit the gold-stochasticity ceiling on promise. Scoped to mice, promise, value-charge, mckee-gap. Character-arcs is unchanged (CELL PASS F1=1.00 already shipped, commit `4ec5d8b`).

---

## Why this exists (problem statement)

Phase C of the R7 charter (Crystal Shard, 2026-04-29) revealed that the existing monolithic-extractor + Pro-judge architecture has two compounding failure modes:

### Failure mode 1: Cognitive load per call

Mice asks one Flash call to: hold all 4 thread-type definitions, pick the dominant thread, decide opens_thread (using the correct close criterion for the chosen type), decide closes_thread (same), maybe emit secondary_thread, cite a verbatim quote, assess confidence. Per scene. Result: F1=0.776 / P=0.731 — borderline (CELL MARGINAL). Below the 0.78 PASS gate by 5pp.

This is the same failure pattern observed on adherence-checker in 2026-04-08: complex single-call checklists hit a capability ceiling on 14B models. Decomposing into per-dimension parallel calls cleared the ceiling. Memory note: `feedback_decompose_checker_calls.md`.

### Failure mode 2: Gold stochasticity

Promise asks the Pro judge to emit free-text promise descriptors with integer chapter ranges. The rubric admits two structurally different interpretations of "promise" (book-spanning arc threats vs within-chapter Chekhov bridges). Two consecutive Pro judge runs at T=0.3 produced 30 vs 27 promises with only 14 shared — Jaccard 0.326. Sonnet pair-matcher confirmed (0.357). T=0 produced the same problem in a different shape. Cardinality pivot inherits the same ceiling. Memory note: `feedback_gold_stability_first.md`.

The deeper finding: the Pro judge isn't picking *different promises* run-to-run — it's picking different *definitions* of "promise" each run (gold v1 mean payoff span 104 chapters; gold v2 mean span 4 chapters). Same model. Same prompt. Different rubric interpretation. The judge is also stochastic, so using it as ground-truth gold gives a moving target.

### What ties the two failure modes

Both are rubric-latitude problems, just at different layers. Mice's latitude is "one of these 4 thread types AND open AND close AND descriptor AND quote — keep all in mind at once." Promise's latitude is "describe each promise in free text" — infinite possible answer space. The fix in both cases is the same shape: tighten the answer space. Decomposition tightens cognitive load; sub-dim splitting (promise → arc-promise + bridge) tightens semantic latitude.

---

## What changes

### Per-dim plan

| Dim | Current shape | New shape | Rationale |
|---|---|---|---|
| **promise** | 1 call → free-text descriptor + (open_ch, close_ch) | 2 sub-dims (`arc-promise`, `setup-payoff-bridge`), each with closed enum constraint on the close-distance window. Each sub-dim is an independent extractor + anchor pair. | Splits the rubric latitude. Each sub-dim has tighter scope; the two sub-dims don't compete for "which definition wins." |
| **mice** | 1 call → primary M/I/C/E + opens + closes + secondary + descriptor + quote | 4 parallel binary calls per scene (one per M/I/C/E thread type), each emitting `{is_dominant, opens, closes}`. Aggregator collapses to primary + opens/closes. Descriptor + quote drop to a 5th lighter call. | Removes the cross-thread cognitive load. Each call holds ONE thread type's full close criterion. |
| **value-charge** | 1 call → 11-value enum + polarity-shift + valueIn + valueOut + quote | 1 call retained — same shape. Already enum-shaped on every field. Sonnet anchor replaces Pro judge. | Decomposing 11-value lifeValue into 11 binary calls would 11× cost without removing the ambiguity (the latitude is "which of the 11 axes," not "is it on this axis"). Single call is right; what was wrong was using a same-family judge. |
| **mckee-gap** | 1 call → gap_size + gap_type + povExpectation + actualOutcome + quote | 1 call retained. Already enum-shaped on the load-bearing fields. Sonnet anchor replaces Pro judge. | Same logic as value-charge. The expected/actual fields are free-text but they're descriptive, not categorical. The structural verdict (gap_size, gap_type) is fully enum. |
| **character-arcs** | 1 call → fixed character cast + LTWN + arc_resolution enum | NO CHANGE. Already shipped (commit `4ec5d8b`). | F1=1.00 on character identification + LTWN structure. arc_resolution agreement 67% (above PASS gate). Architecture works for this dim. |

### Anchor change (applies to all 4 modified dims)

| Aspect | Pro judge (current) | Sonnet anchor (new) |
|---|---|---|
| Model | DeepSeek V4 Pro (same family as Flash) | Anthropic Sonnet |
| Cost per book per dim | ~$0.30–1.50 | ~$0.50–1.50 |
| Scope | Re-runs the extractor task on the same prompts | One-shot ground truth on a 50-scene sample |
| Self-consistency | Untested → measured 0.326 Jaccard on promise | Test BEFORE using; require ≥ 0.85 Jaccard |
| Independence | Same model family as extractor — shared biases | Independent family — no shared biases |

The anchor is used ONCE per book per dim to establish ground truth on a 50-scene sample. The Flash extractor runs on the full corpus. Calibration F1 = Flash output vs Sonnet anchor on the 50-scene overlap.

---

## Decisions

### D1 — Sonnet, not Pro, for the anchor

**Decision:** Sonnet anchors the calibration; Pro judge is retired from the corpus-decomposition pipeline.

**Why:** Independent model family is the load-bearing property. Pro and Flash share architecture, training data, and tokenizer biases — same-family judge inflates F1 on the wrong axis. Sonnet was already validated as a higher-recall anchor on promise (Phase C.1, 38 promises vs Pro's 27–30, found nearly all Pro's PLUS the series-hook setups Pro missed). Cost is comparable ($0.50–1.50/dim/book vs $0.30–1.50). Single-shot cost is acceptable.

**Why not Codex GPT-5.5:** Also independent of DeepSeek family; would also work. Default to Sonnet because we've already used it for Phase C.1 and have the subagent path wired (`Sonnet pair-matcher`, `feedback_codex_gpt54_subagents.md` notes Codex is for adversarial review and parallel analysis, not corpus-extraction anchoring).

### D2 — Decomposition for mice; single call for value-charge / mckee-gap

**Decision:** Mice gets 4 parallel binary calls per scene. Value-charge and mckee-gap stay as single calls.

**Why:** The decomposition target is *cognitive load*, not field count. Mice's per-call cognitive load is "compare 4 thread types and pick one + remember which type's close criterion to apply." That's actually 4 nested judgments per scene. Value-charge's per-call cognitive load is "name one of 11 values + assign 3-step polarity to entry and exit" — sequential and independent. Mckee-gap's is "name expected outcome + name actual outcome + classify gap" — three sequential judgments, each narrow. Neither value-charge nor mckee-gap has the *cross-category competition* that drives mice's marginal P=0.731.

If value-charge or mckee-gap calibration with Sonnet anchor reveals their own marginal results, decomposition is on the table for them too. Don't pre-decompose without evidence.

### D3 — Promise re-scope into two sub-dims

**Decision:** `promise` splits into `arc-promise` (close ≥ 5 chapters from open) and `setup-payoff-bridge` (close ≤ 3 chapters from open). Each sub-dim is an independent extractor + Sonnet anchor pair. The current monolithic `promise` extractor is retired.

**Why:** Phase C.2 found gold v1 mean payoff span 104 chapters (arc-promise dominant) vs gold v2 mean span 4 chapters (bridge dominant). The judge wasn't choosing different promises — it was choosing different *categories* each run. By making the categories explicit and disjoint at the prompt level, each sub-dim has tight latitude. The 4-to-5 chapter gap between the two windows is intentional — promises that close in chapter 4 from chapter 0 are ambiguous (could be either category) and we want the extractor to pick one explicitly.

**Why not just sharper rubric on monolithic `promise`:** Tested via Sonnet pair-matcher in Phase C.3 (Round 2, R2.3) — Sonnet's overlap with Pro v1↔v2 was within 1 promise of the V4 Pro pair-matcher. The latitude is in the *rubric definition*, not the *matcher*. Sharper-but-still-monolithic rubric drafts cycle through the same competition.

### D4 — Character-arcs untouched

**Decision:** No architectural change to character-arcs. Already shipped (commit `4ec5d8b`).

**Why:** F1=1.00 on character identification + LTWN. arc_resolution agreement 0.67 cross-model and 0.83 self-model — above PASS gates. The dim has tight structure (closed character cast + 4-value enum). Whatever architectural pressure drives mice/promise/value-charge marginalia doesn't apply.

### D5 — Drop monolithic v2 prompt drafts; absorb their content as sub-rubric source material

**Decision:** `mice-system-v2-draft.md` and `value-charge-system-v2-draft.md` are not promoted to canonical prompts. The close-criteria from mice-v2 are absorbed into the 4 per-thread sub-prompts. The 3-step lattice from value-charge-v2 is absorbed into the (still-monolithic) value-charge prompt as part of the Sonnet-anchored re-calibration.

**Why:** v2 drafts sharpen the OLD architecture (one big call). The decomposed shape supersedes the architecture. The work isn't wasted — the close-criteria are exactly the kind of tight per-thread guidance the new sub-prompts need. The drafts are SOURCE MATERIAL, not the destination.

### D6 — 50-scene anchor sample, not full-corpus anchor

**Decision:** Sonnet runs on a stratified 50-scene sample per dim per book. The Flash extractor runs on the full corpus.

**Why:** Cost. Full-corpus Sonnet is ~$10–20 per dim per book; 50-scene sample is $0.50–1.50. The 50-scene sample is the same sampling shape `sample-for-adjudication.ts` already produces. Confidence intervals are wide on n=50, but the goal is "is this dim shipping calibration ≥ 0.78 F1 against a stable anchor?" not "what is the exact F1 to 3 decimals?" — the directional answer fits in n=50 budget.

If the verdict is borderline (0.75 ≤ F1 ≤ 0.81), expand to n=100 by drawing a fresh 50 and re-anchoring.

---

## Measurement plan

For each modified dim (mice, promise/arc-promise, promise/setup-payoff-bridge, value-charge, mckee-gap):

### Step 1 — Sonnet self-consistency

Run Sonnet twice on the same 50-scene sample with the same prompt. Compute Jaccard on the output sets.

| Result | Action |
|---|---|
| ≥ 0.85 | Anchor is stable; proceed to step 2 |
| 0.70 – 0.85 | Anchor is marginal; report ceiling explicitly; proceed to step 2 with caution |
| < 0.70 | Re-scope the sub-dim BEFORE proceeding; the rubric admits multiple interpretations |

### Step 2 — Flash × Sonnet calibration

Run the Flash extractor (decomposed for mice, sub-dim'd for promise) on the full corpus. Compute precision, recall, F1 against the Sonnet anchor on the 50-scene overlap.

### Step 3 — Comparison vs Flash×Pro baseline

Tabulate side-by-side:

| Dim | Old (Flash×Pro) F1 | New (Flash×Sonnet, decomposed) F1 | Delta | Cost change |
|---|---|---|---|---|
| mice | 0.776 | TBD | TBD | TBD |
| promise (monolithic) | 0.491 (gold-stability ceiling) | — superseded by sub-dims — | — | — |
| arc-promise | — new sub-dim — | TBD | TBD | TBD |
| setup-payoff-bridge | — new sub-dim — | TBD | TBD | TBD |
| value-charge | 0.94 (binary) / 0.76 (polarity) | TBD | TBD | TBD |
| mckee-gap | TBD (current Pro judge in flight) | TBD | TBD | TBD |

### Step 4 — Pass criteria per dim

A dim passes the v2 architecture test if **both**:

1. **Sonnet self-consistency Jaccard ≥ 0.85** on its sample (anchor is stable).
2. **Flash × Sonnet F1 ≥ 0.78** (the existing PASS gate from R7 charter v1) AND ≥ 5pp improvement over the Flash×Pro baseline (or, for the new sub-dims, ≥ 0.78 absolute).

If one criterion holds and the other doesn't:
- Stable anchor + low F1 → extractor needs work (decompose further, or sharpen sub-rubric).
- Unstable anchor + any F1 → re-scope the sub-dim before re-running.

---

## Alternatives rejected

### A1 — Ensemble gold (intersection/union of N Pro runs)

**Rejected.** The two Pro runs in C.2 produced structurally different categorizations (arc-promise vs Chekhov-bridge dominant). Intersection collapses to ~14 shared promises (all "obvious" ones), losing the discrimination signal. Union doubles up to 43 with most being category-disagreement noise. Neither bypasses the rubric-latitude problem.

### A2 — T=0 deterministic extraction

**Rejected.** Tested in C.3. Pro@T=0 produced the same 22 promises as Pro@T=0.3 but interacted differently with which gold sample fixed each side. F1 against gold v1 went 0.538 → 0.615 (up); F1 against gold v2 went 0.612 → 0.490 (down). The variance is in the *judge*, not the *extractor temperature*.

### A3 — More prompt examples on the monolithic call

**Rejected.** Tested via the v2 prompt drafts (mice-v2, value-charge-v2). The drafts ARE good prompts; they sharpen close-criteria with worked examples. But they sharpen the OLD architecture, which has a cognitive-load ceiling regardless of prompt quality.

### A4 — Sonnet for the FULL corpus extraction (not just the anchor)

**Rejected.** Cost. Sonnet on 800 scenes per dim per book is $10–20 per book per dim; 5 dims × 1 book = $50–100/book. Versus Flash full-corpus + Sonnet anchor: ~$1–2 + $0.50–1.50 = $1.50–3.50/book/dim, ~$8–18/book total. Sonnet-everywhere doesn't add information past the 50-scene anchor — Sonnet self-consistency is the limit.

### A5 — Parallel Pro judge runs to diagnose vs Sonnet anchor

**Rejected as primary path.** Was the Phase C.2 instrument and produced the gold-stability finding. We don't need to re-run it; the finding generalizes. May be useful as a one-time diagnostic for value-charge and mckee-gap to confirm Pro instability isn't dim-specific to promise — but that's a follow-up, not a blocker.

---

## Open questions

1. **Sonnet self-consistency on the 4 modified dims.** Hypothesis: stable for mice (per-thread sub-rubrics), value-charge (already enum-shaped), mckee-gap (already enum-shaped). Possibly unstable for arc-promise / setup-payoff-bridge if the 5-vs-3-chapter window doesn't disambiguate enough. **Measure first.**

2. **Should arc-promise + setup-payoff-bridge run as ONE Flash call emitting both lists, or TWO Flash calls each emitting its sub-list?** Two calls keeps each sub-dim's prompt minimal and reduces cross-category competition. One call halves cost. Tentative default: TWO calls (latitude removal > cost saving).

3. **Should the 4 mice sub-calls run on the same input prompt or per-thread tailored prompts?** Tailored prompts (one per thread type, with that type's close criterion expanded) is the principled choice. Same prompt with a "which thread is this scene on?" framing is cheaper but probably loses the cognitive-load benefit.

4. **Is character-arcs really safe at F1=1.00?** Possible the Pro judge agreed with the Flash extractor *because they share biases*. A Sonnet anchor on character-arcs would test this. Low priority — already shipped — but worth a one-shot validation when convenient.

---

## Implementation order

1. **Sonnet self-consistency measurement** on the 4 modified dims. 4 dims × 2 runs × 50-scene samples ≈ 400 Sonnet calls, ~$8–15 total. One day of wall-clock with subagent path. **GATE 1.**

2. **For each dim that passes Gate 1**, design the new sub-prompts (decomposed for mice, sub-dim split for promise; absorb v2 drafts' criteria as source material).

3. **Run Flash extraction** with the new sub-prompts on the full corpus. Cost ~$1–4/dim/book.

4. **Compute Flash × Sonnet calibration** on the 50-scene overlap. Append to conclusions doc.

5. **Per-dim verdict**: ship to harness if both gates clear (per Step 4 of measurement plan).

6. **Cross-book validation** (Streams of Silver, Storm Front per `cross-book-cross-author-brief.md`): run with the v2 architecture from the start.

---

## Cost projection

Per book, all 4 modified dims:

| Step | Cost |
|---|---|
| Sonnet self-consistency (4 dims × 2 runs × 50 scenes) | $8–15 |
| Decomposed Flash extraction (mice ×4, promise ×2 sub-dims, value-charge, mckee-gap) | $2–4 |
| Sonnet anchor (4 dims × 1 run × 50 scenes) | $4–8 |
| **Total per book** | **$14–27** |

vs. v1 architecture (Flash×Pro): ~$2.50/book at promo, ~$5/book post-promo. **5–10× cost increase.**

This is acceptable per the existing memory `feedback_query_llm_calls_for_costs.md`: corpus-wide research costs are trivial absolute spend; the savings come from getting the right answer once instead of running multiple unstable calibration cycles. We've already burned ~$3.85 on Crystal Shard alone with the old architecture and have parked the promise dim. v2 architecture lands a stable answer per dim, per book.

---

## Status

- Draft, 2026-04-29 (revision 1).
- **Adversary review R1: RED on both target documents** (this design doc + the Phase C conclusions doc). Two parallel Codex `codex-rescue gpt-5.5 effort=high` reviewers ran 2026-04-29. Both recommended the same cheapest-untried-counterfactual: run the current monolithic extractor against a Sonnet anchor on a frozen sample BEFORE committing to decomposition / sub-dim splitting. Per memory `feedback_codex_counterfactual_signal.md`, this is a pivot signal, not an alternative to refute.
- **Specific blockers from R1-design (must resolve in R2 or supersede the doc):**
  1. Cheapest counterfactual skipped — Sonnet anchor + monolithic extractor on frozen sample not yet measured. (§9.3)
  2. Pass-gate confound — comparing new Sonnet F1 to old Pro F1 from different samples breaks same-eval comparability. (§2.1, §2.2, §2.3, §9.4)
  3. Promise split has a verdict-space hole — exact-4-chapter close belongs to neither sub-dim. (§4.2)
  4. Mice aggregator underspecified — what happens when 0 or 2+ sub-calls return is_dominant. (§4.2, §7.4)
  5. 50-scene anchor used as a ship gate without uncertainty plan. (§3.3)
- **Specific blockers from R1-findings (carry over into v2 measurement plan):**
  1. Verdict protocol drift — value-charge NULL-GOLD vs mckee-gap waiver inconsistency on the same 40% retest disagreement. (§7, §1.1)
  2. Character-arcs raw artifact missing (RESOLVED: regenerated at `crystal_shard.20260430T000116.json` 2026-04-30; verdict CELL PASS confirmed F1=1.000 / arcResolution=0.667; LTWN semantic agreement still unmeasured).
  3. Sonnet-as-anchor claim outruns evidence — Sonnet ↔ Pro@T=0 cardinality correlation is the LOWEST pair (0.184), and Sonnet's promise list contains impossible negative spans (min=-979 chapters). Cleaning required before "Sonnet is the exhaustive recall ceiling" claim holds. (§5.1, §5.2, §6.6)
  4. One-book smoke promoted to ship/generalization claims. (§7.1, §9.2)
  5. Metric framing mismatched to downstream use — value-charge / mckee-gap headlined on binary F1 while planner-relevant subfield agreements are well below the gate. (§3.1)
- Not yet implemented. The Gate 1 plan in this doc is REPLACED by the cheaper-counterfactual experiment for R2 (see "Pivot for R2" below).

## Pivot for R2 (post-Codex R1 RED)

Both reviewers converge on the same cheaper experiment. R2 of this design doc — and ANY further architecture commitment — is gated on running this first:

**Cheapest-counterfactual experiment (~$1–3/dim/book):**

1. Take a frozen 50-scene sample for mice and a frozen 20–30-row sample for promise.
2. Run the EXISTING monolithic extractors (Flash, no decomposition) on those samples.
3. Run a Sonnet anchor on the same samples (with self-consistency check: Jaccard ≥ 0.85 required to use as anchor).
4. Compute Flash × Sonnet F1.
5. Decision tree:
   - If monolithic Flash × Sonnet F1 ≥ 0.78 on mice → decomposition is unnecessary; just swap Pro→Sonnet and re-calibrate.
   - If monolithic Flash × Sonnet F1 < 0.78 AND a one-shot mice prompt sharpening (close-criteria only, no decomposition) lifts it ≥ 0.78 → prompt-only fix is the right path; don't decompose.
   - If neither → THEN decomposition is justified, with the architecture-pivot evidence Codex requested.
   - For promise: if Sonnet self-consistency is stable (≥ 0.85) AND Sonnet vs T=0 monolithic Flash extractor F1 ≥ 0.78 → swap judge, no sub-dim split needed. Otherwise the sub-dim split (with the dead-zone fix from R1-design BLOCKER 3) is the right move.

This experiment costs ~$3–5 total per book. If it lands the answer, the v2 architecture in this doc collapses to "swap Pro→Sonnet across the existing pipeline" — much smaller blast radius than the doc currently proposes.

Tracking: this experiment supersedes the original "Implementation order step 1" and is the single gate before any architecture decision. R2 of this doc will either:
- Restate v2 with the experiment results justifying decomposition where it's needed (and dropping it where prompt-only fixes worked), OR
- Supersede this doc with a much shorter "swap judge to Sonnet, sharpen close-criteria where needed" design.
