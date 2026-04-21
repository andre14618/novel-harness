---
status: proposed
kind: experiment-charter
name: replay-ladder-v1
owner: andre
date: 2026-04-21
revision: 1
---

# Experiment Charter — `replay-ladder-v1`

Four-arm matched-beat decision ladder on 20 stratified beats. Compares the
next-$N *spending options* head-to-head rather than isolating mechanism
axes. Hybrid oracle: deterministic detector fire-rates (narrow, cheap,
production-calibrated) + a 10-beat blind human sidecar (prose-quality
revalidation against the context-distribution shift).

Proposed after a three-round review cycle:

- **Codex synthesis consult** (job `adf7f81ab1689d8bd`, 2026-04-21) — YELLOW
  on a 2×2 factorial, proposed edge-only pairwise + masked cross-writer +
  Sonnet/GPT-5.4 calibration.
- **Opus `experiment-adversary`** (2026-04-21) — RED on the 2×2; flagged
  §11.5 bundled-lever on the writer axis, sensory-richness judge-bias
  citation, LoRA anchor confound. Proposed context-only detector probe.
- **Codex adversarial on reconciliation** (job `a465ddb87d07222a2`,
  2026-04-21) — RED on my staged synthesis; flagged citation
  over-generalization, detector-calibration-under-shift problem, loss of
  interaction term. Named the 4-arm decision ladder below as the
  cheapest-untried counterfactual.

Each round surfaced a distinct failure mode in the prior proposal. This
charter is the reconciled form.

## 1. Question

Where should the next $N of engineering effort in the novel-harness
project go, given the 2026-04-21 capital-allocation options on the
table: enriched context engineering, editing-pass iteration via the
shipped `qualityRedraftEnabled` gate (commit `893bb26`), or writer-model
upgrade (LoRA voice → stronger non-LoRA base)?

Scope limit — this charter tells us the *relative ranking* of these
three options measured on production prose from the Salvatore-routed
fantasy path. It does not claim to measure a universal writer ceiling,
a universal context ceiling, or a clean capability-vs-voice separation.
Those abstractions were explicitly rejected by the review chain.

## 2. Hypothesis

**If** we regenerate 20 stratified beats from a completed Salvatore-routed
novel through four arms (baseline, +enriched context, +quality-redraft,
stronger writer), **then** at least one non-baseline arm will satisfy
both oracles simultaneously:

- detector fire-rate delta ≥ 10pt vs baseline across the 20 beats, and
- blind human pairwise preference ≥ 65% vs baseline on the 10-beat sidecar,

**because** the harness has a measured 44.9% → 28.9% ungrounded fire-rate
headroom documented by `beat-entity-list-v1` (exp #254), known rewrite-to-
redraft asymmetry documented by `rewrite-capability-probe` (2026-04-21),
and a legitimate capability gap between voice-LoRA and non-LoRA writers
— any one of which could plausibly produce a dominant arm on this corpus.

No prediction is made about the *identity* of the winning arm. The
review chain established that all three priors (writer, context,
editing) have plausible dominant-arm stories; the experiment's job is
to rank them, not to confirm one.

## 3. Falsification threshold

Stated before results:

- **All four arms within ±5pt on detector and within 45%–55% on human
  sidecar.** Measurement too insensitive at this N. KILL the charter
  shape — do not re-run at larger N without redesigning the oracle.
  Escalate to either human-read-through on full chapters or a different
  measurement substrate.
- **Detector says Arm X wins by ≥10pt but human sidecar prefers
  baseline on Arm X's sample pairs.** Detectors are orthogonal to
  prose quality on this question. KILL the detector-primary approach;
  all future replay runs require a human-or-equivalent primary oracle.
- **Human sidecar exhibits >30% position-dependent flips on the
  built-in order-symmetry check (5 pairs rejudged with swapped
  order).** Sidecar is dominated by position bias at N=10. KILL this
  run; require a larger sidecar (≥20 pairs) or a different reviewer
  protocol before any future replay.
- **Enriched-context arm regresses detector fire-rates by ≥10pt vs
  baseline.** The "context engineering is the lever" prior is falsified
  for *this* enrichment package on *this* corpus. KILL the enriched-
  context arm; a different enrichment design must be charter'd
  separately before any spend on the speaker_directives / reader-info
  / world-expansion roadmap.

## 4. Baseline ladder

| Slot | Arm label | What it is | Next-$N option it represents |
|------|-----------|------------|------------------------------|
| Floor | — | (none — baseline IS the floor; prior runs establish the 44.9% ungrounded fire rate as context) | — |
| Current prod | **A: baseline** | Salvatore v4 voice-LoRA + current production beat-context + `qualityRedraftEnabled: false` | do nothing |
| Lever 1 | **B: +enriched context** | Same writer; add `speaker_directives` per beat + reader-info state slice + targeted world-bible expansion keyed to beat entities | context-engineering roadmap |
| Lever 2 | **C: +quality-redraft** | Same writer + same context; `qualityRedraftEnabled: true` via `seed.pipelineOverrides` per commit `e8b2bb6` | shipped editing-pass gate |
| Ceiling | **D: stronger writer** | DeepSeek V3.2 base (no voice LoRA) + current production beat-context + `qualityRedraftEnabled: false` | model upgrade (accepts voice loss as a product cost) |

Note on Arm D — the writer swap trades capability for voice. Per §11.5
of `experiment-design-rules.md`, this IS a bundled lever. But for the
capital-allocation question this charter asks, "what does a writer
upgrade buy in practice" is the honest framing: you cannot deploy
DeepSeek V3.2 and also keep the Salvatore voice LoRA. The bundling is
a product constraint, not a measurement flaw — and is disclosed here so
readers of the results do not over-claim capability separation.

## 5. Cheapest counterfactuals considered

| Lever | Est cost | Rejected because |
|-------|----------|------------------|
| 2×2 factorial (Codex synthesis YELLOW) | ~$5 + 2–5h judge time | Review chain established that Sonnet-pairwise oracle has documented failure modes on sensory-richness preference (lessons-learned §29–30, acknowledged as extrapolation not proof) and that the 4-cell design underpowers interaction detection at N=30–50. Edge-only judging is an improvement but doesn't address the orchestration-of-oracles question. |
| Context-only detector probe, writer fixed (Opus adversary) | ~$0.50 | Drops the interaction term and the writer-upgrade option entirely. If the real world is "context only helps at stronger writer," this run returns a false null and misallocates next-$N toward a writer upgrade whose standalone ROI was never measured. |
| Staged synthesis: context-only first, then writer-only if context nulls (Claude reconciliation) | ~$1 + follow-on | Codex adversarial pass flagged that this design STILL loses the interaction, plus reuses production-calibrated detectors as a "primary oracle" on a distribution (enriched context) where they were never calibrated — violates §3.2 / §9.2 / §11.6. |
| 4-arm decision ladder with hybrid oracle (this charter) | ~$2 + user read-time | Proposed. Each arm *is* a real spending option. Hybrid oracle (detector + blind human sidecar) addresses detector-calibration concern via the sidecar as revalidation, and addresses human-oracle cost via the narrow 10-pair bound. |
| Full human read-through on 3 chapters across 4 arms | ~$4 + 6–8h user time | Higher-signal oracle but scope creep past a one-night decision-support run. Deferred to a follow-on charter conditioned on this one producing ambiguous results. |

## 6. Distribution match

**Novel selection.** A single already-completed Salvatore-routed fantasy
novel from `public.novels` where all chapters have approved drafts and
`adherence-events` ran cleanly. Pick the most recent qualifying novel
with ≥4 chapters and ≥40 approved beats to leave slack for stratification.

**20-beat stratification** (pre-registered — commit before generation):

- 8 dialogue-heavy / multi-speaker beats (≥3 speakers, ≥4 dialogue lines per detector count)
- 6 state-dependent beats (beat description references knowledge state, inventory, or spatial constraints from a prior chapter)
- 6 lore-specific beats (beat description references ≥1 world-bible entity the writer hasn't generated yet in the current chapter)

Selection within each stratum is seeded deterministically from a fixed
RNG seed + novel ID so the set is reproducible. Stratum membership is
computed from beat metadata at selection time and frozen into a
manifest (`output/evals/replay-ladder-v1-beat-manifest.json`) before
any generation runs.

**Production distribution check.** The selected beats must match the
chapter-position distribution of the source novel within ±1 chapter in
each stratum — not all late-chapter beats, not all early-chapter. Reject
the seed if it skews; re-seed.

**Parity harness (per `experiment-design-rules.md` §4.7):**

- **Request-construction parity — required on Arms A, B, C.** Arm A's
  prompt bytes must byte-equal the production beat-writer row for the
  same (novel, chapter, beat) tuple, modulo timestamp fields.
  `scripts/evals/conditioning-floor-parity-check.ts` is the prior-art
  structured-segment differ; extend or reuse. Arm B adds the enriched-
  context block as a named expected delta (specified regions only).
  Arm C is byte-identical to Arm A on the first writer attempt — the
  redraft gate only fires on the second attempt, and parity on the
  first-attempt prompt is the invariant.
- **Arm D (stronger writer) — request-construction parity is byte-equal
  to Arm A except on the `model` and `provider` fields.** The parity
  check must whitelist exactly those two field changes and fail on any
  other delta.
- **Response-parse parity — required on all four arms.** Response-
  format envelope must parse through the existing `beat-writer` schema
  handler without schema errors. Arms that schema-miss are counted as
  lost beats, per §7 below.
- **DB write-shape parity — N/A.** This charter only writes to
  `eval_briefs` + `eval_results` (per `docs/eval-infrastructure.md`);
  the production `llm_calls` / `pipeline_events` write shapes are
  unchanged.
- **Skip category — not applied.** None of {pure evaluation task,
  model/weight-only swap, analysis-only} fits. This is an eval against
  a modified context-assembly code path.

## 7. Success criteria

Per-arm thresholds. Gate on both oracles (detector AND human sidecar)
for SHIP; one-sided signals route to ITERATE.

| Arm | SHIP condition | ITERATE condition | KILL condition (beyond §3) |
|-----|----------------|--------------------|----------------------------|
| A (baseline) | — (reference) | — | — |
| B (+enriched context) | detector Δ ≥ −10pt AND human preference ≥ 65% over A on 10-pair sidecar | detector Δ ∈ [−10, −5]pt OR human preference ∈ [55%, 65%] | detector Δ ≥ +10pt (regression) per §3 bullet 4 |
| C (+quality-redraft) | detector Δ ≥ −5pt AND human preference ≥ 60% over A | one oracle positive, other null | detector Δ > +5pt — the shipped gate is actively hurting |
| D (stronger writer) | detector Δ ≥ −15pt AND human preference ≥ 70% over A | partial signal in either direction | human preference ≤ 50% — the swap loses on prose quality AND the writer has already lost the voice, so no upside |

Thresholds for C are looser because the quality-redraft gate is already
shipped and free to run; the question is whether to flip the default
ON, not whether to fund new work. Threshold for D is stricter because
the voice loss is a real product cost that a marginal quality lift does
not justify.

**Combined-arm story takes precedence over per-arm winners.** If B
ships AND C ships AND D kills, the recommendation is "context roadmap
+ flip redraft gate, defer writer upgrade." If B and D both ship but C
kills, "context + writer, the shipped redraft gate is not load-bearing
in combination." All six combinatorial outcomes are pre-enumerated in
the run writeup template before execution.

## 8. Budget

- **Spend cap:** $3 hard, covering 80 writer calls (20 beats × 4 arms) +
  any automated helpers. Real-world expectation: <$2 based on `llm_calls`
  cost histogram for Salvatore-v4 + DeepSeek V3.2 beat-writer calls.
- **Time cap:** 6 hours wall-clock from charter GREEN verdict to results
  table committed to `docs/charters/replay-ladder-v1.md` §Results.
- **Human sidecar time cap:** 60 minutes for the 10-pair blind read
  (10 pairs × ~6 min reading + tag selection per pair, with a 5-pair
  position-swap recheck built in).
- **Stop if:** any arm errors on >15% of beats (infrastructure failure
  threshold); parity harness reports unexpected delta on any arm on
  ≥3 of the first 5 beats (abort and re-charter); detector output
  contains NaN / schema errors on ≥1 beat (detector bug, not
  measurement signal).

## 9. Linked context

- **Prior experiments:**
  - #254 (`beat-entity-list-v1`) — established 44.9% baseline ungrounded
    fire rate and context-surface-mismatch mechanism. Provides the
    detector-calibration baseline this charter revalidates.
  - #255 (`rewrite-capability-probe`) — established that Salvatore v4
    LoRA does not meaningfully rewrite from critique but CAN redraft
    from scratch. Motivates Arm C's redraft-gate presence.
  - Conditioning-floor KILL (exp #253-adjacent, 2026-04-21, commit
    `639712e`) — established that sampling-parameter conditioning is
    not the lever. Motivates why this charter's Arm C is a gate, not a
    sampling knob.
- **Related decisions:**
  - `docs/decisions.md` 2026-04-21: "quality-redraft gate"
  - `docs/decisions.md` 2026-04-21: "Conditioning-floor KILL"
  - `docs/decisions.md` 2026-04-21: "Rewrite-capability probe"
- **Code that must be committed before run:**
  - Replay runner: adapt `scripts/evals/run-conditioning-floor-replay.ts`
    into `scripts/evals/run-replay-ladder-v1.ts` (4-arm variant).
  - Parity harness: extend `scripts/evals/conditioning-floor-parity-check.ts`
    to handle arm-D model/provider whitelist.
  - Enriched-context builder: new module in `src/agents/writer/` that
    composes `speaker_directives` + reader-info state + targeted
    world-bible slice. Must be feature-flagged so production is
    unaffected.
  - Human sidecar helper: `scripts/evals/replay-ladder-sidecar.ts` —
    emits 10 blinded pair files (markdown, names/places masked per Codex
    protocol control #1) + a position-swap recheck of 5 of them.
- **`tuning_experiment` ID will be:** assigned by
  `createTuningExperiment()` at charter GREEN + code-committed time.

## 10. Adversary review

Primary reviewer: Codex via `/charter-review` → `/codex:adversarial-review`.

This charter IS the reconciliation of a three-round review chain. A
fresh Codex pass is still required — the prior reviews were against
design sketches, not the committed charter text, and charter-level
details (stratification scheme, parity harness scope, per-arm thresholds,
distribution-shift revalidation) are new.

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT) — primary | RED | 2026-04-21 | Job `aabc1fd419f0be2b2`. Five blockers: (1) §7 thresholds sign-inverted — `Δ ≥ -10` allows null/regression to SHIP; violates §3.1. (2) 10-pair prose sidecar measures preference, not detector validity under enriched-context shift — §3.2/§9.2/§11.6 gap. (3) 20-beat stratification not reproducible — "state-dependent"/"lore-specific" need executable queries; §7.1. (4) "combinatorial-outcome pre-enumeration" claimed in §7 but not actually written; full state space is 27 not 6. (5) Arm B parity contract too loose — "extend or reuse" doesn't name the exact delta spans; §4.7 risk given exp #258 permissive-diff precedent. Warnings: Arm D bundled-lever acknowledgment sufficient for product-allocation question (not capability-only); position-bias check should be integer flips ≥2/5 not %. Cheapest untried counterfactual: **Arm-B calibration preflight only** — A vs B on 10 beats, human-adjudicate sampled detector fires/non-fires instead of prose preference, ~$0.50 + 45–60 min, answers whether detector stays usable under enriched-context shift before paying for the full ladder. Recommendation: REVISE CHARTER. |
| `experiment-adversary` (Opus) — fallback | (ran against design sketch 2026-04-21) | 2026-04-21 | RED on 2×2 design; recommendations folded into this charter's §4 and §5 |

Block run on YELLOW or RED. Iterate the charter, not the run. If fresh
Codex pass materially disagrees with Opus's prior RED (e.g., Codex
GREENs the ladder where Opus RED'd the 2×2), record both and proceed —
divergence on different designs is not a disagreement, it's a design
change. If Codex also RED's the ladder on a *new* axis (i.e., not the
axes already addressed by §§4–7), escalate to the user before any
revision.
