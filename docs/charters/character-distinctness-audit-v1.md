---
status: proposed
kind: experiment-charter
name: character-distinctness-audit-v1
revision: 2
owner: andre
date: 2026-04-21
parent-charter: docs/charters/voice-shaping-ablation-v1.md
---

# Experiment Charter — `character-distinctness-audit-v1`

Cheap follow-on to `voice-shaping-ablation-v1`. Runs a Sonnet quote-required
distinctness audit on the already-generated 80 `eval_results` rows (Arms D0 /
D1 / D2 / D3 on same 20 beats), plus the Salvatore v4 anchor from
`arm-d-writer-upgrade-v1`. No new writer generation.

Answers the question the voice-shape metrics couldn't: **does any
prompt-level intervention measurably improve per-character
distinctness within a beat?** D3 (character voice directives) was
specifically designed for this; voice-shape-metrics reported D3 as
FLAT vs D0 because they measure rhythm/cadence, not speaker
differentiation. Distinctness is a different axis.

**Revision 2 (2026-04-21):** addresses Codex YELLOW review
`a2a03962d5344f4a5` blockers — pre-counted eligible denominator,
per-speaker quote budget to neutralize length bias, pre-registered
D1/D2 attribution branch, dialogue-tag variety demoted to secondary
readout, retest expansion at decision boundaries.

## 0. Pre-counted eligible pool

The 20-beat pool from `novel-1776690840208` was audited for
multi-speaker eligibility before writing thresholds:

- **17/20 beats are multi-speaker** (≥2 speaking characters)
- **3/20 beats are single-speaker** (excluded as N/A)
- `N_eligible = 17`

**Minimum eligible N:** 12. If the Sonnet-determined eligibility
rate deviates from the pre-count by >2 beats (i.e., `N_eligible ≤ 14`),
stop and re-evaluate before reporting a verdict — the pool is too
thin for the ±5pt / ±10pt decision bands below.

## 1. Hypothesis

**If** we run a blind Sonnet quote-required distinctness audit on the
17 eligible beats × 5 arms (85 beat-arm samples) using the evidence-capped
rubric in §4, **then** D3 will pass distinctness on ≥ 13/17 beats
(~76%) AND at least +10pt over D0's pass rate, **because** D3's
CHARACTER VOICE DIRECTIVES block explicitly instructs the writer to
differentiate characters on **cadence, register, and signature
phrasings** — axes the bare DeepSeek prompt doesn't emphasize.

**Dialogue-tag variety is NOT part of the primary mechanism claim.**
Tag variety is a surface lexical feature that both the judge rubric
(§4) and the voice-shape metrics (rhythm-agnostic for tags) cannot
cleanly score without confounding with length. Tag variety is
captured only as a secondary readout (§4.5) — it does not gate the
pass/fail verdict.

## 2. Falsification and attribution branches

Every outcome below uses rates over `N_eligible` (expected 17):

- **D3 pass rate < D0 pass rate + 5pt** → the character-directive
  prompt doesn't measurably differentiate characters at DeepSeek
  scale. The D3 mechanism is falsified.
- **D1 OR D2 pass rate ≥ D3 pass rate + 5pt** → D3's specific
  mechanism is wrong, but prompt-level distinctness IS a real lever
  via a different path: style guide (D1) or few-shot demonstration
  (D2). Branch to §5's MODEST-ATTRIBUTION outcome; do not claim
  D3-style character directives ship.
- **D1 AND D2 both within 5pt of D0 AND D3 ≥ D0 + 10pt** → D3 wins
  cleanly; the mechanism specifically is character directives, not
  incidental other prompt shaping.
- **Adjudicator retest flips ≥ 3/8** → rubric too vague. Re-register
  the rubric; do not report a verdict from this run. (Retest budget
  expanded from 4 to 8 in Revision 2 — see §4.)

## 3. Arms (all reuse existing eval_results rows, NO regeneration)

| Arm | Source | Expected role |
|---|---|---|
| S (Salvatore v4) | `eval_results` set `arm-d-writer-upgrade-v1` cell `A-salvatore-v4` | Production anchor — LoRA's baseline distinctness |
| D0 | `eval_results` set `voice-shaping-ablation-v1` cell `D0-bare` | Bare DeepSeek baseline |
| D1 | set `voice-shaping-ablation-v1` cell `D1-style-guide` | Style guide doesn't target distinctness directly; expected ≈ D0 (but see attribution branch §2) |
| D2 | set `voice-shaping-ablation-v1` cell `D2-few-shot` | Few-shot examples may incidentally transfer character-differentiation patterns; uncertain |
| D3 | set `voice-shaping-ablation-v1` cell `D3-char-directives` | Distinctness-targeted — the arm that should win if the D3 mechanism is correct |

## 4. Measurement protocol

**Instrument:** Sonnet subagent per beat-arm packet (85 primary + 8
retest = ~93 calls). Parallelizable via the `Agent` tool — max 10
concurrent per the parallel-batch-limit memory.

**Rubric (frozen Revision 2):**

> For each beat, given two or more speaking characters, decide: do
> the characters sound meaningfully different from each other —
> GROUNDED IN their speaker profiles?
>
> **Evidence budget (load-bearing length-bias control):**
> - Quote **exactly one dialogue line per speaking character** — no
>   more. If a character has multiple lines, pick the most
>   character-revealing single utterance.
> - Evidence scoring considers **dialogue only**. Do not reward
>   distinctness signal that comes from narration, sensory framing,
>   interiority, or stage direction around the quote.
>
> **For each quoted line:** cite the specific speaker-profile
> attribute (voice, drives, avoids, conflict) the line reflects,
> and decide whether the line sounds distinctly like that character
> versus any other speaker in the beat.
>
> **Do NOT reward** overall beat length, sensory richness, prose
> polish, dialogue tag variety, or "evocative" language.
>
> **Primary label:** PASS / FAIL / UNCLEAR, with quote-required
> per-speaker justification. A beat PASSES only if **every** speaking
> character's single quoted line is distinct from every other
> speaker's single quoted line in that beat.

**§4.5 Secondary readout (non-gating):** dialogue-tag variety count
per beat-arm. Reported alongside the primary verdict for descriptive
context; does not affect pass/fail. Claim D3 "ships" only on primary
verdict, never on secondary.

**Beats without multiple speakers** are scored N/A and excluded from
the pass-rate denominator (see §0 for the pre-counted denominator).

**Retest controls (Revision 2):**
- **8 retests** (up from 4), stratified:
  - 4 random across arms (same pattern as earlier charters)
  - 4 targeted at **decision-boundary beats** — beats where the
    first-pass label was UNCLEAR OR beats where D3 and D0 disagree
    (the beats that move the ±5pt / ±10pt decision).
- **Double-judging for boundary cases.** If the arm-level pass-rate
  margin between any two arms falls within 5pt of a threshold
  (GO/MODEST/FLAT boundaries), run a second independent Sonnet pass
  on every beat contributing to that margin and report both labels.
- **Flip rate ≥ 3/8 → INCONCLUSIVE.** Same protocol as charter's
  earlier 4/2 rule, scaled for 8 retests.

## 5. Success criteria

Rates below are over `N_eligible` (pre-counted 17).

| Outcome | Condition | Action |
|---|---|---|
| **GO (clean D3 win)** | D3 pass rate ≥ D0 + 10pt AND ≥ 75% absolute AND neither D1 nor D2 within 5pt of D3 | D3 character-directive prompt works as hypothesized. Ship D3-style directives into production default for fantasy route. |
| **MODEST-ATTRIBUTION** | D1 OR D2 pass rate ≥ D3 pass rate + 5pt (and ≥ D0 + 5pt) | Prompt-level distinctness works, but NOT via D3's mechanism. Investigate the winner; do not ship D3. Candidate ablations: strip style-guide to only its differentiation clauses; probe which few-shot pair drives the effect. |
| **MODEST-D3** | D3 pass rate ≥ D0 + 5pt but < 10pt AND D3 leads D1/D2 | Real but small effect via D3's proposed mechanism. Keep as candidate for autonomous-loop stacking. |
| **FLAT** | All arms within 5pt of D0 | Prompt-level character-shaping doesn't move distinctness on its own. Architecture pivot: per-character context passes, multi-turn generation, or weight-level per-character fine-tune. |
| **INCONCLUSIVE** | Retest flip rate ≥ 3/8 OR `N_eligible ≤ 14` OR N/A rate deviates from pre-count by >2 beats | Re-register rubric OR expand beat pool to include more multi-speaker beats. Do not report a verdict. |

## 6. Budget

- **Spend cap:** $0.60 hard (Revision 2 — up from $0.50 to cover
  boundary double-judging). Expected: 85 primary + 8 retest + up to
  ~20 boundary double-judges × ~$0.003 = ~$0.35.
- **Wall-clock cap:** 1 hour (parallel 10-at-a-time).
- **Human time:** 0 primary adjudication. Spot-check any beat where
  retest flips or double-judge disagrees.
- **Stop if:** >10% subagent errors; `N_eligible ≤ 14` from the live
  eligibility check; or adjudicator-position variance on retests
  above the §2 threshold.

## 7. Pre-flight calibration (Codex CHEAPEST UNTRIED COUNTERFACTUAL)

Before the full 85-packet audit, run a **10-packet duplicate-judge
calibration** on a stratified sample (2 per arm × 5 arms) with the
Revision 2 capped-evidence rubric:

- Estimate the flip rate between duplicate Sonnet runs on identical
  packets. Target: ≤ 20% flip rate. Above that, rubric needs tightening
  before the full audit spends budget.
- Verify eligibility count matches the §0 pre-count of 17 multi-speaker
  beats (tolerance ±2).

**Gate:** do not start the full audit if either check fails. Expected
cost: ~$0.06. Adds ~10 minutes.

## 8. Adversary review

Codex `/codex:adversarial-review` round 1 (consult id
`a2a03962d5344f4a5`, 2026-04-21) — **YELLOW** with 5 blockers.
Revision 2 addresses all 5 blockers inline:

| Blocker | Fix in Revision 2 |
|---|---|
| §§4-5 denominator undefined pre-run + hypothesis 15/20 vs N/A exclusion | §0 pre-count (17 multi-speaker); §1 hypothesis restated as 13/17; §5 all thresholds rates over `N_eligible`; minimum eligible N=12 set |
| Length-bias susceptibility (D3 206w vs D0 177w) | §4 one-dialogue-line-per-speaker cap; scoring limited to dialogue evidence; narration/sensory excluded from scoring window |
| D1/D2-beats-D3 has no pre-registered interpretation | §2 MODEST-ATTRIBUTION branch added; §5 action row for it |
| Dialogue-tag variety contradiction (claimed lever but excluded from scoring) | §1 removed from primary mechanism claim; §4.5 demoted to non-gating secondary readout |
| 4 retests underpowered for ±5pt/±10pt bands | §4 expanded to 8 retests with 4 targeted at decision boundary; §4 double-judging protocol for ±5pt-of-threshold margins |

Per charter §10 "fix and proceed" discipline after an initial YELLOW
with protocol tweaks: no round-2 Codex review unless newly-discovered
structural concern surfaces. Proceed to §7 calibration → full audit.

| Reviewer | Verdict | Date | Notes |
|---|---|---|---|
| `/codex:adversarial-review` — round 1 | YELLOW | 2026-04-21 | 5 blockers (see table above); consult `a2a03962d5344f4a5`; all blockers addressed in Revision 2 |
