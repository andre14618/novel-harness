---
status: results
kind: experiment-charter-results
name: arm-b-direct-pairwise-v1
parent-charter: docs/charters/arm-b-direct-pairwise.md (revision 2)
date: 2026-04-21
verdict: CAUTION (middle range)
---

# Results — Arm B Direct Pairwise v1

## Verdict

**CAUTION (middle range)** per charter §7 outcome table. Neither arm
cleared the 15-decisive threshold at N_decisive=20, so no directional
claim is defensible at p ≤ 0.025 one-tailed.

The weak A-lean (11 vs 9) is suggestive that enriched context is not
helping on this corpus, but it is not statistically significant and
should not drive a decision on its own. The true product-question
answer the user wants — "should we keep investing in this enrichment
package?" — has to be made on priors + the cost of the alternative,
not on this data.

## Run

- **Set name:** `arm-b-direct-pairwise-v1`
- **Novel:** `novel-1776690840208` (30.1% historical halluc-ungrounded
  fire rate, 10 approved chapters, Salvatore-routed)
- **Pool:** 20 beats, 2 per chapter across all 10 chapters. Stratum
  distribution 14 lore / 3 state / 3 none (lore-first ranking per
  chapter). Pool manifest at
  `output/evals/arm-b-direct-pairwise-pool.json` (LXC).
- **Arm A:** byte-replay of stored production prompts. Salvatore v4
  voice LoRA (`wandb-artifact:///andre14618-/novel-harness/salvatore-1988-v4`),
  compact-mode context.
- **Arm B:** same writer + `insertEnrichedSection(sections_A,
  ENRICHED CONTEXT block)`. Avg enriched block 2,441 bytes (range
  ~0.8–3.4 KB) — speaker directives + reader-info state + focused
  world slice.
- **Generation:** 20/20 beats completed in ~6 min on W&B Inference.
  Zero errors. Writer cost $0.0038.
- **Fire-rate delta (secondary telemetry):** A 6/20 = 30% · B 6/20 = 30%
  · Δ = 0. Same raw fire counts; the detector is insensitive to the
  enriched-context intervention at this N.

## Adjudication

- **Adjudicator:** primary user (via the React pairwise UI at
  `/app/pairwise/v1`, committed `41df605` + `d9536cf`).
- **Packets:** 29 = 20 primary + 4 silent retests + 5 calibration
  (3 A-vs-A + 2 B-vs-B).
- **Primary pairs outcome:** A wins 11 · B wins 9 · TIE 0.
- **Decisive pairs:** 20/20 (zero ties — strong adjudicator signal).
- **Retest order-swap check:** 1/4 flips (below the 2-flip position-bias
  kill threshold).
- **Same-arm calibration check:** 0/5 non-TIE (adjudicator correctly
  identified every identical-prose pair as TIE — no preference-priors
  decoupled from arm identity).

Adjudicator reliability is confirmed by both control checks. The
signal is not noise; the direction is just below statistical
significance at N=20.

## Interpretation

**Directly-measured claims supported by this run:**

1. Enriched context did NOT meaningfully help Salvatore v4 on the
   pairwise instrument. Expected effect size at B ≥ 15 decisive wins
   (B-win-rate ≥ 0.75) is falsified by this data.
2. The enriched-context package as a bundle did not harm prose
   quality enough to trigger a NO-GO. A=11 is below the 15-threshold
   too.
3. The detector's fire-rate was unmoved. Whatever enrichment did at
   the writer level, it did not change what the halluc-ungrounded
   detector sees.

**Directly-measured claims NOT supported by this run (despite
plausible priors):**

- "Enriched context is net-negative" — A=11 is directional but not
  statistically significant. CAUTION, not NO-GO.
- "The enriched package has no effect" — 0 ties + 11/9 split suggests
  the adjudicator SAW differences on every pair; the two arms are
  genuinely distinguishable, just roughly balanced in quality.
- "Salvatore v4 LoRA is sufficient for production" — not tested here.
  This run only compared v4 + compact context vs v4 + enriched
  context. A stronger base writer (Arm D of the original replay-ladder
  design) has not been measured.

## Next step

Per the Codex strategic consult (job `acc1b47d14ce265f4`, 2026-04-21),
the appropriate response is NOT to pivot the LoRA track on this data
alone. Rather: run the Arm D writer-upgrade test — see
`docs/charters/arm-d-writer-upgrade.md` — to resolve whether the LoRA
is empirically capped vs a strong untuned base model before making
the strategic decision.

The three claims the arm-b result does NOT distinguish, per Codex §6:

1. "Current LoRA-side levers are failing" — evidence YES (this run +
   3 prior 2026-04-21 negatives)
2. "LoRA is worse than a strong untuned base" — evidence UNKNOWN
   (never tested; Arm D answers this)
3. "The whole fine-tune / offline thesis is wrong" — evidence NONE
   (too large a claim for the data)

Arm D is the forcing function for claim #2. Full synthesis of the
2026-04-21 evidence arc into `docs/decisions.md` +
`docs/lessons-learned.md` is deferred until Arm D resolves, so the
retrospective isn't written around an unresolved question.

## Detector-version caveat for the fire-rate delta

Per Codex round-9 feedback on the preflight charter, historical
halluc-ungrounded labels on `novel-1776690840208` may have been
generated under a pre-V1 `BEAT_ENTITY_LIST_VARIANT`, while the
runtime detector in this run defaulted to V1. The Δ=0 fire-rate
result is therefore a SECONDARY data point only — it says "the
detector as currently configured fired the same number of times on
both arms" but does not rigorously compare historical detector
behavior against runtime detector behavior. The pairwise adjudication
(not the fire-rate) is the primary oracle per the charter; this
caveat does not affect the primary verdict.

## Experiment record

- Charter: `docs/charters/arm-b-direct-pairwise.md` (revision 2,
  commit `fa66490`)
- Generation commit: —
- `tuning_experiment` ID for this run: created by `run-arm-b-preflight.ts
  --create-experiment` — query with `SELECT id, description FROM
  tuning_experiments WHERE description LIKE '%arm-b-direct-pairwise-v1%'`
- Bundle: `output/evals/pairwise/v1/` on LXC, pulled to local at
  `output/evals/pairwise/v1/`
- UI artifact: `/app/pairwise/v1` (live on LXC orchestrator)
