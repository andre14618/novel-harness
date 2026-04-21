---
status: proposed
kind: experiment-charter
name: arm-b-direct-pairwise
owner: andre
date: 2026-04-21
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
will be preferred on ≥ 14 / 20 pairs (p < 0.025 vs fair-coin null under
a one-tailed binomial test), **because** the enriched block adds ~2.2 KB
of character background, reader-info state, and world-bible detail that
the writer currently cannot see in compact mode.

No prediction on which sub-block (speaker / reader-info / world-slice)
carries the signal. If Arm B wins, a follow-on ablation can decompose.

## 3. Falsification threshold

Stated before results.

- **Arm A preferred on ≥ 14/20 pairs.** Enriched context makes prose
  worse at this corpus. KILL the context-engineering roadmap item for
  Salvatore-routed fantasy; re-charter for a different enrichment
  package or move capital to writer-upgrade / editing-pass arms.
- **Middle range (7 ≤ A-wins ≤ 13 and 7 ≤ B-wins ≤ 13).** Measurement
  inconclusive at N=20. Options in §7 action column.
- **Retest order-swap check fails (≥ 2/4 position-dependent flips).**
  Adjudicator-position bias exceeds noise threshold. KILL this run; a
  different adjudicator or larger N is required before any pairwise
  claim.

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
manifest (`output/evals/arm-b-preflight-pool-manifest-rev9.json`).
Selection: take the first 20 by (chapter, beat_index) ascending —
deterministic, reproducible. Preserves the reallocate-to-none stratum
composition proportionally (8 lore + 5 state + 7 none = 20).

**Parity.** Same contract as `arm-b-detector-preflight` revision 9 §6:
byte-replay Arm A, insert ENRICHED CONTEXT before `SETTING:` /
`Sensory:` anchor (or append if absent). Parity check via
`scripts/evals/preflight-arm-b-parity.ts` `checkArmBStructure()` pure
function — all 7 assertions enforced. Aborts the beat on any
structural violation.

## 7. Success criteria

Pre-registered. One-tailed binomial test against fair-coin null:

| Outcome | Condition | Action |
|---------|-----------|--------|
| **GO** | Arm B wins ≥ 14 / 20 pairs (p < 0.025). Retest flips < 2/4. | Context engineering stays on the board; proceed to a simplified replay-ladder that excludes detector-as-primary-oracle. |
| **CAUTION / ambiguous** | 7 ≤ Arm B wins ≤ 13. Retest flips < 2/4. | Expand to N = 40 pairs (another 20 beats from the remaining manifest slots). If still ambiguous after 40, treat as null and move capital to another lever. |
| **NO-GO** | Arm A wins ≥ 14 / 20 pairs (p < 0.025). | Enriched context is net-negative for this corpus. Retire the package; consider alternate enrichment designs before re-charter. |
| **INCONCLUSIVE** | Retest flips ≥ 2/4 regardless of win count. | Adjudicator-position bias dominates; do not report a verdict. Larger N or second adjudicator required. |

Ties are counted as 0.5 wins for each arm in the totals per standard
pairwise convention; a full-tie run with 10 wins each collapses to
CAUTION.

## 8. Budget

- **Spend cap:** $0.10 hard. Expected: 20 beats × 2 arms × (writer +
  detector-as-secondary) at ~$0.00023/call = ~$0.02 total. 5× headroom.
- **Wall-clock cap:** 2 hours from GREEN to verdict committed.
  Generation ~15 min, parity ~5 min, adjudication ~45 min, writeup
  ~15 min.
- **Human-time cap:** 60 min for adjudication. 20 pairs + 4 retests =
  24 packets at ~2-3 min each.
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
| `/codex:adversarial-review` (GPT) — primary | YELLOW | 2026-04-21 | Job `ae40043cc3262a8b2`. Two blockers + four warnings. **Blockers:** (1) decision-rule math — P(X≥14/20) = 0.058 not 0.025; P(X≥15/20) = 0.021. Tie-as-0.5 breaks the binomial model. Fix: require ≥15/20 decisive B wins with ties excluded; or sign-test on decisive pairs with min decisive-pair count. (2) Sample selection — "first 20 by (chapter, beat_index)" clusters early-chapter beats; loses chapter-position parity control that the parent ladder required. Fix: stratum + chapter-position balanced selection from the 40-beat manifest. **Warnings:** (a) add 5 blind same-arm calibration pairs to estimate null-side preference/tie rate (4 retests only measure order bias); (b) dual-seed randomization (packet-order separate from per-pair side); mid-run break; (c) detector fire-rate delta remains confounded by BEAT_ENTITY_LIST_VARIANT version drift — caveat in writeup; (d) DON'T replace holistic pairwise with a checklist rubric (§4.1 / exp #90 — atomizing destroys signal); require 1-2 sentence reason per pair instead. Named counterfactual: 5 calibration pairs + exact-threshold rewrite (~$0.002, ~10 min). Per charter §10 discipline: fix and proceed (YELLOW with protocol tweaks, no new structural concern). |
