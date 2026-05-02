---
status: active
updated: 2026-05-01
role: result-doc
loop: L7-adherence-convergence
experiment: 320
---

# Adherence-events N-Call Convergence — L7 Results (2026-05-01)

## Question

Does the convergence methodology that worked on `halluc-ungrounded` (L1, exp #316: +5-13% F1 from 5-call temp=0.5 voting) also lift `adherence-events`?

## Headline

**No.** Adherence-events at single-call temp=0.1 is **already perfect on this panel** (F1=1.000 at k=1..4 of 5). Higher temperature only INTRODUCES error.

## Same panel, completely different result vs halluc

Same 22 labeled rows from `/tmp/halluc-current-panel-exp299-labeled.jsonl` — adherence-events checker rows only. Composition: 13 TN natural + 4 TP natural + 5 synthetic event_omission (expected_pass=false). Total: 9 fails, 13 passes.

### T=0.1 N=5

| Threshold | TP | FP | FN | TN | Recall | Precision | F1 |
|---|---|---|---|---|---|---|---|
| **k=1..4** | **9** | **0** | **0** | **13** | **1.000** | **1.000** | **1.000** |
| k=5 | 8 | 0 | 1 | 13 | 0.889 | 1.000 | 0.941 |

Agreement matrix: **21/22 unanimous (95%)**. The checker is essentially deterministic on this panel.

### T=0.5 N=5

| Threshold | TP | FP | FN | TN | Recall | Precision | F1 |
|---|---|---|---|---|---|---|---|
| k=1 | 9 | 1 | 0 | 12 | 1.000 | 0.900 | 0.947 |
| k=2 | 8 | 0 | 1 | 13 | 0.889 | 1.000 | 0.941 |
| k=3 | 7 | 0 | 2 | 13 | 0.778 | 1.000 | 0.875 |
| k=4 | 6 | 0 | 3 | 13 | 0.667 | 1.000 | 0.800 |
| k=5 | 6 | 0 | 3 | 13 | 0.667 | 1.000 | 0.800 |

Agreement: 18/22 unanimous (82%). Higher temperature added meaningful divergence — but every disagreement HURT recall (FN increased) without buying any precision (already at 1.000 ceiling).

## Comparison vs L1 halluc convergence (same panel, same N=5, same temps)

| Checker | Best F1 (T=0.1) | Best F1 (T=0.5) | Convergence delta |
|---|---|---|---|
| halluc-ungrounded | 0.720 (k=1) | **0.762** (k=3) | **+0.042** abs (+5.8% rel) |
| adherence-events | **1.000** (k=1..4) | 0.947 (k=1) | **−0.053** abs (REGRESSION) |

The convergence methodology is **not generic** across semantic checkers. It helps where the LLM has real stochastic disagreement room AND the model is mid-recall (not at the ceiling). For adherence-events on this panel, the model is essentially perfect at temp=0.1; voting produces nothing to aggregate, and higher temperature only introduces noise.

## Why adherence is "easier" than halluc on this panel

- **Halluc** asks the model to maintain a mental model of the entire grounded surface (world bible + brief + beat-entities) and check every named noun against it. False negatives are easy when the model misses one.
- **Adherence** asks "did the events the beat described happen on-page?" — a much more concrete question with shorter implicit reference set. Synthetic event_omission fixtures (where prose totally omits the planned action) are easy to catch.

This is consistent with `docs/decisions.md` "Current-surface checker calibration panel labeled — halluc-ungrounded under-fires badly, adherence-events is well-calibrated" (2026-04-XX entry).

## Caveats

1. **Panel size is small** (n=22, 9 fails). F1=1.000 is suspicious — confidence interval is wide. A bigger adherence panel (with subtle partial-enactment fixtures, not just total event omission) might reveal a non-trivial failure mode.
2. **The synthetic fixtures may be too "loud"** (totally omit the planned action). Real-world failures are more subtle (partial enactment, off-page reference, wrong-character action). The L5 two-stage prototype (per-event enumeration on FAIL) is the right approach for surfacing those.
3. **Single FN at k=5 of T=0.1** — one row lost the unanimous fail vote. That's the boundary case where the model occasionally pasees a true failure. Worth inspecting.

## Cost

| Run | Calls | Cost |
|---|---|---|
| T=0.1 N=5 | 110 | ~$0.03 |
| T=0.5 N=5 | 110 | ~$0.03 |
| **Total** | **220** | **~$0.07** |

Trivial.

## Persisted evidence

| Run | phase_eval_runs.id | Verdict |
|---|---|---|
| T=0.1 N=5 | 62 | CONVERGENCE-N5-T0.1 |
| T=0.5 N=5 | 63 | CONVERGENCE-N5-T0.5 |

Tracking experiment: `tuning_experiments.id=320`.

Per-row JSONL on LXC:
- `/tmp/adherence-convergence-N5-T01-20260501T032300.jsonl`
- `/tmp/adherence-convergence-N5-T05-20260501T032300.jsonl`

## Recommendation

1. **Do NOT promote N-call convergence for adherence-events.** Single-call temp=0.1 is at the ceiling on this panel.
2. **L5 two-stage wiring (binary first, per-event on FAIL) is the right adherence improvement.** Detail enrichment, not voting, is what the checker needs.
3. **Generalization for §11 backlog "checker convergence sweeps":** apply convergence ONLY to checkers whose single-call F1 is ≤ 0.85 AND whose temp=0.1 unanimous-vote rate is < 80%. Above the ceiling or below the divergence floor, convergence is wasted compute.
4. **Future work:** expand adherence panel with subtle-failure fixtures (partial enactment, wrong-character, off-page reference). If those reveal F1 ≤ 0.85, revisit convergence.
