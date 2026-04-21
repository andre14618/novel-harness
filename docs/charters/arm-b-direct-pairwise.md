---
status: proposed
kind: experiment-charter
name: arm-b-direct-pairwise
owner: andre
date: 2026-04-21
revision: 2 (post-Codex-YELLOW round 1 — 2026-04-21)
supersedes: docs/charters/arm-b-detector-preflight.md (revision 9, RED)
---

# Experiment Charter — `arm-b-direct-pairwise`

Pivot from the 9-round `arm-b-detector-preflight` charter per meta-consult
(job `a738b4bb2879c39d0`, 2026-04-21). The preflight asked an instrument
question (does `halluc-ungrounded` detector stay usable under the Arm B
context shift?); this charter asks the product question directly.

Per `docs/lessons-learned.md`: pairwise is right for substantive prose
differences. Per Codex meta-consult: detector-precision-preservation is a
weak proxy for "does enriched context improve prose" because at the 8-fire
adjudicable floor one label moves precision 12.5pt — enough to see
catastrophic detector collapse, not enough to see modest writing
improvement.

## 1. Question

Does the enriched-context block (speaker directives + reader-info state +
focused world slice) produce measurably-better prose than the baseline
beat-context, as judged by a blind human pairwise read on 20 matched
beats?

"Better" = the rater's overall preference between two prose excerpts for
the same beat, order-randomized and arm-masked.

## 2. Hypothesis

**If** we regenerate 20 matched beats from `novel-1776690840208` through
both arms (A: byte-replay of stored production prompt; B: same + inserted
ENRICHED CONTEXT block) and blind-adjudicate each pair, **then** Arm B
will win on ≥ 15 of the decisive (non-tie) pairs at N = 20 (one-tailed
exact binomial p ≤ 0.021 against fair-coin null, ties excluded from the
denominator), **because** the enriched block adds ~2.2 KB of character
background, reader-info state, and world-bible detail that the writer
currently cannot see in compact mode.

**Revision-2 decision-rule correction:** Codex round 1 (job
`ae40043cc3262a8b2`) caught two errors in the original 14/20 rule.
First, P(X ≥ 14 | N = 20) = 0.0577 (one-tailed), far above the stated
p < 0.025 — the threshold must be 15, not 14. Second, counting ties as
0.5 per arm breaks the binomial model (can't have fractional
successes). Revision 2 excludes ties from the binomial denominator and
requires ≥ 70% of the N = 20 primary pairs to be decisive before a
directional verdict is computed; under-decisive runs route to CAUTION
automatically.

No prediction on which sub-block (speaker / reader-info / world-slice)
carries the signal. If Arm B wins, a follow-on ablation can decompose.

## 3. Falsification threshold

Stated before results.

- **Arm A wins ≥ 15 decisive pairs** at N_decisive ≥ 14 (70% of 20
  primary pairs). Enriched context is net-negative on this corpus.
  KILL the context-engineering roadmap item for Salvatore-routed
  fantasy; re-charter for a different enrichment package or move
  capital to writer-upgrade / editing-pass arms.
- **Middle decisive range (neither arm clears 15 of the decisive
  pairs).** Measurement underpowered at N=20. Options in §7 action
  column (expand to N=40 or treat as null).
- **Under-decisive run (< 14 decisive pairs across the 20 primary
  packets, i.e., > 30% ties).** Tie rate dominates; the binomial test
  is not computable at rigor. Automatic CAUTION verdict; options per
  §7.
- **Retest order-swap check fails (≥ 2/4 position-dependent flips).**
  Adjudicator-position bias exceeds noise threshold. KILL this run; a
  different adjudicator or larger N is required before any pairwise
  claim.
- **Calibration check fails (Arm-A-vs-A or Arm-B-vs-B preference
  on ≥ 2/5 same-arm pairs).** Adjudicator is manufacturing a winner
  when shown identical-arm prose — signals strong preference priors
  decoupled from arm identity. KILL this run; tighten the
  adjudication rubric before retry.

## 4. Baseline ladder

| Slot | Arm | What it is |
|------|-----|------------|
| Current prod | **A: baseline** | Byte-replay of stored `system_prompt` + `user_prompt` for the beat. Same writer (Salvatore v4 LoRA), same envelope. |
| Intervention | **B: +enriched context** | Same writer + `insertEnrichedSection(armA_sections, ENRICHED CONTEXT block)` per `src/agents/writer/enriched-context.ts`. |

No ceiling / floor arm. This is a 2-point decision on one lever. Per
§2.1 of `experiment-design-rules.md`, floor/ceiling applies to capability
experiments; this is an intervention A/B.

## 5. Counterfactuals considered

| Lever | Cost | Rejected because |
|-------|------|------------------|
| `arm-b-detector-preflight` revisions 9/10 (per-fire precision adjudication) | $0.01 + 3h | Meta-consult: instrument question, not product question. Coarse floor resolution can't distinguish "modest writing improvement" from "detector still kinda works." Nine rounds of review became displacement activity. |
| Detector fire-rate delta only (no human oracle) | $0.005 + 0h | Codex: "a lower fire rate could mean better grounding, weaker detector sensitivity, or both." Not a product signal. |
| Informal 5-pair read-through | $0.002 + 15min | Acceptable for triage if N=20 is unavailable, but 5 pairs binomial has no resolution: 5/5 = p=0.031 (marginal), ≤4/5 = no signal. Inadequate as a ladder gate. |
| Full ladder with human sidecar (original replay-ladder-v1) | $0.02 + 3h | Stays on the table as the follow-on if this pairwise returns GO or CAUTION. Skipping the pairwise would relitigate the preflight's detector-validity question. |

## 6. Distribution match

**Novel selection.** `novel-1776690840208` (epic-fantasy, 10 approved
chapters, 30.1% historical halluc-ungrounded fire rate). This charter
inherits the source novel from `arm-b-detector-preflight` revision 9
because the stratum audit, world-bible entity set, and archived
baseline are already validated for it.

**Pool.** 20 beats sampled from the revision-9 40-beat exact-pool
manifest (`output/evals/arm-b-preflight-pool-manifest-rev9.json`) via
stratum- AND chapter-position-balanced deterministic selection (Codex
round-1 blocker #2 fix, job `ae40043cc3262a8b2`).

Selection algorithm (executable, pre-registered):

1. Sort the 40-beat manifest by `(chapter, beat_index)` ascending.
2. Partition into 10 chapter buckets (the novel has 10 approved
   chapters; the manifest has ~4 beats per chapter on average).
3. From each chapter bucket, take the first ⌊len/2⌋ and the last
   ⌈len/2⌉ beats alternating (ensures within-chapter position balance).
4. Traverse chapters in ascending order; accept the next beat if it
   doesn't oversubscribe its stratum target (8 lore / 5 state / 7 none).
   If accepting would exceed the stratum target, skip and try the next.
5. Stop when 20 beats are selected. If the 40-beat manifest exhausts
   before 20 are accepted under the stratum cap, relax the stratum
   caps in the order {none → state → lore} and continue until 20.

Outputs: 20 beats with chapter distribution ≈ 2/chapter AND stratum
ratio within ±1 of target (8/5/7). Rejects the old "first 20 by
(chapter, beat_index)" rule which clustered early-chapter beats per
round-1 blocker #2.

**Calibration packets (revision 2).** Before the 20 primary pairs are
emitted, the adjudicator sees 5 calibration packets:

- 3 × Arm-A-vs-Arm-A: same beat's Arm A prose shown as Version 1 and
  Version 2 (no regeneration — just duplicated). Expected label: TIE.
- 2 × Arm-B-vs-Arm-B: same beat's Arm B prose on both sides.
  Expected label: TIE.

Calibration packets are intermixed with primary pairs in the shuffled
packet order — the adjudicator does NOT know which packets are
calibration. If ≥ 2 of 5 calibration packets come back with a winner
(not TIE), the adjudicator is manufacturing preferences from prose
differences that don't exist — verdict is INCONCLUSIVE per §3's
calibration-check-fails bullet.

**Adjudication-order discipline.** Two independent deterministic
seeds control randomization per Codex warning (2):

- Packet-order seed: controls the order packets are presented in
  `packets.md`. Keyed on `${set_name}:order`.
- Per-pair A/B-side seed: controls which arm appears as Version 1 in
  each packet. Keyed on `${set_name}:${beat_id}:side`.

Separate seeds let us audit either axis independently. A mid-run
break is scheduled at the halfway mark (after packet 12 of 24) via a
visible divider in `packets.md` — reduces fatigue-correlated drift.

**Parity.** Same contract as `arm-b-detector-preflight` revision 9 §6:
byte-replay Arm A, insert ENRICHED CONTEXT before `SETTING:` /
`Sensory:` anchor (or append if absent). Parity check via
`scripts/evals/preflight-arm-b-parity.ts` `checkArmBStructure()` pure
function — all 7 assertions enforced. Aborts the beat on any
structural violation.

## 7. Success criteria

Pre-registered. One-tailed binomial test against fair-coin null:

Pre-registered one-tailed exact binomial on DECISIVE pairs only (ties
excluded from the denominator per Codex round-1 blocker #1). Outcome
precedence is top-down — first matching row wins.

| Outcome | Condition | Action |
|---------|-----------|--------|
| **INCONCLUSIVE** | Retest flips ≥ 2/4 (§3 order-bias kill) OR calibration fails (≥ 2/5 same-arm pairs labeled non-TIE) | Adjudicator-position bias OR adjudicator manufacturing preferences. Do NOT report a verdict. Larger N, second adjudicator, or tightened rubric required. |
| **CAUTION (underpowered)** | < 14 decisive pairs across the 20 primary packets (> 30% tie rate) | Tie rate dominates; binomial test not computable at rigor. Expand N, tighten the rubric, or treat as null. |
| **GO** | Arm B wins ≥ 15 of the decisive pairs at N_decisive ≥ 14 (exact p ≤ 0.021 at 15/20 decisive; scales per the decisive-threshold table in `scripts/evals/arm-b-pairwise.ts`) | Context engineering stays on the board. Proceed to a simplified replay-ladder that excludes detector-as-primary-oracle. |
| **NO-GO** | Arm A wins ≥ 15 of the decisive pairs at N_decisive ≥ 14 | Enriched context is net-negative for this corpus. Retire the package; consider alternate enrichment designs before re-charter. |
| **CAUTION (middle range)** | Default. Decisive pairs ≥ 14 but neither arm clears the threshold. | Expand to N = 40 pairs or treat as null and move capital to another lever. |

Threshold-table entries for other N_decisive values are documented
inline in `computePairwiseVerdict` (exact binomial thresholds for
N ∈ [10, 40]; normal approximation beyond).

**Adjudicator notes column required** (Codex round-1 warning 4). Each
primary packet gets a 1–2 sentence reason alongside the TIE /
VERSION-1-WINS / VERSION-2-WINS label. Preserves auditability without
collapsing into a Likert checklist (§4.1 of experiment-design-rules +
exp #90 — atomizing holistic judgment destroys signal). Empty notes
are permitted for retests and calibration packets where the label
itself is the datum.

## 8. Budget

- **Spend cap:** $0.10 hard. Expected: 20 beats × 2 arms × (writer +
  detector-as-secondary) at ~$0.00023/call = ~$0.02 total. 5× headroom.
- **Wall-clock cap:** 2 hours from GREEN to verdict committed.
  Generation ~15 min, parity ~5 min, adjudication ~45 min, writeup
  ~15 min.
- **Human-time cap:** 75 min for adjudication. 20 primary pairs + 4
  silent retests + 5 calibration packets = 29 packets at ~2–3 min
  each. Mid-run break after packet 12 of 24 (mid-session of non-
  calibration work; calibration packets are not a natural break point
  because the adjudicator shouldn't know when a calibration pair has
  appeared).
- **Stop if:** parity harness rejects a beat; writer errors on Arm A
  on >2 of 20 beats; retest flip count exceeds kill threshold;
  infrastructure error.

## 9. Linked context

- **Supersedes:** `docs/charters/arm-b-detector-preflight.md` (revision
  9 RED — commit `4a150c0`). Full history of 9 rounds retained for
  posterity; infrastructure from that work is reused.
- **Reused infrastructure (already committed):**
  - `src/agents/writer/enriched-context.ts` — Arm B construction
  - `scripts/evals/preflight-arm-b-parity.ts` — parity check
  - `scripts/evals/run-arm-b-preflight.ts` — generation runner
  - `scripts/evals/preflight-arm-b-stratum-audit.ts` — pool audit
- **New code for this charter:**
  - `scripts/evals/preflight-arm-b-adjudicate.ts` — add `--emit-pairwise`
    and `--ingest-pairwise` modes alongside the existing per-fire
    adjudication (kept for the deferred detector-oracle work).
  - Extract `computePairwiseVerdict()` pure function + tests.
- **Related decisions:**
  - `docs/charters/arm-b-detector-preflight-results.md` (exp #260)
  - Meta-consult verdict 2026-04-21 (job `a738b4bb2879c39d0`) — archived
    as a footnote in this charter's §10.
- **`tuning_experiment` ID will be:** assigned by
  `createTuningExperiment(type='checker_eval')` with description
  pointing to this charter.

## 10. Adversary review

Scope discipline: ONE Codex pass, not nine. Meta-consult already validated
the shape (direct human pairwise on 10–20 beats with detector fire-rate
delta as secondary telemetry). If round 1 returns YELLOW with
protocol-level tweaks, fix and proceed. If it returns RED on a
newly-discovered structural concern, escalate; do not spin up a review
tower.

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| meta-consult (GPT) — step-back | PIVOT from per-fire preflight to direct pairwise | 2026-04-21 | Job `a738b4bb2879c39d0`. Six findings (a–f) in commit `4a150c0` message; (f) explicitly recommended running this charter's shape instead of revision 9/10. |
| `/codex:adversarial-review` (GPT) — round 1 | YELLOW | 2026-04-21 | Job `ae40043cc3262a8b2`. All 2 blockers + 4 warnings addressed in revision 2 per charter §10 discipline ("fix and proceed, no review tower"). Fix summary: (1) decision-rule math → exact binomial on decisive pairs only (table of thresholds in `computePairwiseVerdict`; 15/20 exact p≈0.021); ties excluded from denominator; <14 decisive routes to CAUTION. (2) Pool selection → stratum + chapter-position-balanced algorithm in §6. Warnings: 5 calibration packets (3 A-vs-A + 2 B-vs-B) added with ≥2/5 non-TIE kill rule (§3); dual-seed randomization (per-pair side ≠ packet-order) in emitter; mid-run break marker in `packets.md` after 12th non-calibration packet; 1–2 sentence notes required per primary pair; detector fire-rate delta caveated (see §9). No round 2 review per §10 discipline unless a fresh structural concern appears. |
