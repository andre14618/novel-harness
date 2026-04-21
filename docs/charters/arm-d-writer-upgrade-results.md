---
status: results (formal pairwise adjudication skipped — see §Verdict)
kind: experiment-charter-results
name: arm-d-writer-upgrade-v1
parent-charter: docs/charters/arm-d-writer-upgrade.md (revision 3)
date: 2026-04-21
verdict: PIVOT-JUSTIFIED (directional, not formal)
---

# Results — Arm D Writer Upgrade v1

## Verdict

**PIVOT-JUSTIFIED (directional, not formal).** The formal pairwise
adjudication gate in charter §7 was NOT run; the pivot decision was
made on directional evidence + a Codex strategic consult
(`ae0e768d3292eb256`) that found holistic pairwise on this corpus
to be bias-confounded (sensory-richness bias correlates with DeepSeek's
length advantage, per lessons-learned §29-30).

This is an INTENTIONAL deviation from charter §7's pre-registered gate.
Documented here honestly rather than manufactured as a formal verdict.

## Run

- **Set name:** `arm-d-writer-upgrade-v1`
- **Novel:** `novel-1776690840208` (30.1% historical halluc-ungrounded
  fire rate, 10 approved chapters)
- **Pool:** 20 beats (same as arm-b-direct-pairwise-v1 + rev-3 spec)
- **Arm A (Salvatore v4 LoRA):** fresh regeneration today with
  byte-equal stored production prompts. NOT reusing arm-b's
  generations (per Codex round-1 blocker #2 on adjudicator-familiarity
  confound).
- **Arm D (DeepSeek V3.2):** byte-equal prompts, envelope
  `model='deepseek-chat'`/`provider='deepseek'` (single-variable
  change per charter rev-3 §4).
- **Generation:** 20/20 beats completed in ~6 min. Zero errors.
  Writer cost $0.0084.

## Directional data (secondary telemetry only — primary oracle skipped)

### Word count per arm (20 beats each)

| Arm | mean | median | min | max | notes |
|-----|-----:|-------:|----:|----:|-------|
| A-salvatore-v4 | 229.6 | **90** | 39 | **2863** | median-short with one catastrophic run-on loop at 2863w |
| D-deepseek-v3.2 | 166.2 | 172 | 102 | 244 | consistent distribution, no outliers |

### Per-beat length comparison

- DeepSeek longer (≥5w) on **16/20 pairs**
- Salvatore longer (≥5w) on **3/20**
- Within 5w on **1/20**

### Halluc-ungrounded fire rate (secondary telemetry, historical-detector-version caveat per arm-b round 9)

- Arm A (Salvatore v4): 4 fires / 20 = 20%
- Arm D (DeepSeek V3.2): 2 fires / 20 = **10%**
- Δ = -10pt in favor of DeepSeek

The fire-rate delta is directional evidence for DeepSeek's grounding
quality on the harness's operational prompt, not a rigorous head-to-head
— detector was same-version-v1 on both arms but the Salvatore
historical calibration is v0-era per the arm-b-preflight round-9
Codex finding.

## Why the formal pairwise gate was skipped

1. **User observation during adjudication:** "longer ones seem marginally
   better — are those all DeepSeek?" flagged that reading was correlating
   winner with length.

2. **Data confirmed length-arm confound:** DeepSeek longer on 80% of
   pairs (16/20). Salvatore-LoRA's 2863w outlier is a known LoRA
   failure mode (loop). Any holistic pairwise verdict would be
   correlated with length by construction.

3. **Codex strategic consult (job `ae0e768d3292eb256`) confirmed:**
   cross-family AI-judge ensemble does NOT rescue this bias — all
   modern LLM judges share a "richer/longer = better" prior (lessons-
   learned §29-30). An N=20 pairwise verdict here would be 15-5 in
   DeepSeek's favor with ~80% probability regardless of actual voice
   quality. Recommendation: switch to decomposed audit (voice-shape
   metrics + adherence + halluc-leak + character-distinctness) —
   which is what `voice-shaping-ablation-v1` implements.

4. **The strategic question this charter was designed to answer —
   "is LoRA empirically worse than a strong untuned base?" — was
   reframed post-hoc as "does DeepSeek's current-shape output justify
   pivot investment?"** The directional evidence (longer, more
   consistent, lower halluc-ungrounded fire rate) supports the pivot
   without a formal pairwise number. The pivot decision was committed
   to `docs/decisions.md` ("Voice-LoRA track frozen; DeepSeek V3.2
   base becomes the strategic writer target") on this basis.

## Outputs

- `eval_results` rows: 40 (20 per arm) at
  `set_name='arm-d-writer-upgrade-v1'`, cell_labels `A-salvatore-v4`
  and `D-deepseek-v3.2`. Prose is retained for reuse.
- `tuning_experiments` row: see `conclusion` field on the
  experiment created at run time.
- Pairwise bundle at `output/evals/pairwise/arm-d-v1/` on LXC +
  locally — UI at `/app/pairwise/arm-d-v1` works but labels.tsv is
  intentionally empty (adjudication skipped).

## Downstream

This run's Arm A Salvatore v4 prose is the **production anchor arm
`S`** for `voice-shaping-ablation-v1` (charter rev 2). Reused
without regeneration per `experiment-design-rules.md §9.4`
fixed-eval-reuse rule.

The formal-verdict-skipped pattern is documented as-is rather than
as a failure: the instrument's bias was identified mid-adjudication
and the charter's discipline allows responsible deviation when a
confound is diagnosed. The decomposed audit in
voice-shaping-ablation-v1 is the corrected instrument going forward.

## Experiment record

- Charter: `docs/charters/arm-d-writer-upgrade.md` revision 3
  (commit `bd93d9c`)
- Generation runner: `scripts/evals/run-arm-d-upgrade.ts`
  (commit `1d882b3`)
- `tuning_experiment` row: created at run time with description
  linking to this charter
- Bundle: `output/evals/pairwise/arm-d-v1/` — labels.tsv empty
  by design
