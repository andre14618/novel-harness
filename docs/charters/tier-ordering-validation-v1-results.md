---
status: results
kind: experiment-results
name: tier-ordering-validation-v1
date: 2026-04-21
experiment-id: 264
parent-charter: docs/charters/tier-ordering-validation-v1.md (killed; §11 pivot)
set-name: tier-ordering-probe-v1
---

# Results — tier-ordering-probe-v1 ($0.028, NOT $0.60)

Stage-1 probe for the adversary's cheapest-untried-counterfactual.
After the charter's v1 lever (establishedFacts + characterStateChanges
density) was killed by terrain survey for not reaching the writer, we
pivoted to `requiredPayoffs` density — which DOES render into the
writer's SEEDS/PAYOFFS DUE blocks via `beat-context.ts:255-281`.

## Verdict: FLAT within noise

**Marginal rates (per cell, n=26 beats each):**
- Baseline: 23/26 adherence pass (88.5%)
- Loud: 21/26 adherence pass (80.8%)
- Δ = -7.7 pts (tripped the script's "NEGATIVE" threshold)

**Matched-pairs analysis (the correct test — same beats under both
conditions):**
- Both pass: 19
- Both fail: 1
- P→F (regression): 4
- F→P (recovery): 2
- Discordant pairs: 6
- **McNemar's test: (|4-2|-1)² / (4+2) ≈ 0.17, p ≈ 0.68 — NOT significant**

The -7.7pt marginal delta is within 1σ of zero on a binomial model
and non-significant on the paired test. The script's -5pt threshold
was too tight given n=26 per cell.

## Cost: 21× under budget

Adversary estimated $0.60; actual was $0.028. Writer cost
($0.0279) plus adherence-checker cost (52 calls on W&B adherence-v4
at ~$0.0001 each ≈ $0.005) totals ~$0.033. DeepSeek at
~9800 input + ~500 output tokens per beat on V3.2 with extensive
prefix caching (~280-320 cached tokens) runs far cheaper than the
adversary's generic per-beat estimate.

## What the failures tell us (qualitative)

Not a case of "writer indifferent." The writer IS visibly responding
to the lever — prose differs between cells on the same beats — but
the effect doesn't cleanly improve or harm adherence. The 4 P→F
regressions break down as:

| Beat | Issue in loud cell | Pattern |
|------|--------------------|---------|
| ch1::b1 | "Character Taryn Cross not found in prose" | Deterministic char-presence fail |
| ch1::b9 | Role inversion — "Taryn demands evidence from Aldric" became "Aldric provides info to Taryn" | Action-attribution miss |
| ch2::b8 | "Aldric hastily conceals evidence" → Aldric instead "keeps hands still and composed" | Opposite action |
| ch2::b11 | Prose cut off before Aldric could explicitly name Brennan | Truncation / prose ran long |

The F→P recoveries both fix character-presence failures from
baseline. The one beat that fails under BOTH conditions (ch1::b10)
has a structural planner issue unrelated to the lever.

**Interpretation:** loading the writer with extra `requiredPayoffs`
setups competes with core-beat attention — the writer allocates
word budget to plant payoff facts and occasionally slips on core
adherence. Simultaneously, the added SEEDS blocks sometimes help
by reinforcing character identity via the fact text (F→P
recoveries). Net effect is a wash.

## What this kills

1. **The charter as revised (Fork 2).** Single-writer stage-1 probe
   shows no signal above noise; the full 2×2 (2 planners × 2-3
   writers) would multiply noise, not resolve it.
2. **Density-manipulation as a planner-side lever test.** Neither
   v1 lever (establishedFacts/characterStateChanges, killed by
   terrain survey for vacuity) nor v2 lever (requiredPayoffs,
   killed by this probe for noise-level effect) produces a test
   cheap enough AND load-bearing enough to validate the
   ordering hypothesis.
3. **The cheapest-untried-counterfactual pattern for THIS
   question.** The space of cheap, writer-visible, low-implementation
   density-style levers is now exhausted for the chapter-scale
   fixture we have.

## What this does NOT kill

- **The Tier 1 structural hypothesis itself** — that planner-side
  structural cohesion drives prose quality. We only showed that
  naive density manipulation doesn't move the adherence-events
  metric. The hypothesis could still be true via:
  - Semantic payoff alignment (planner-emitted density where the
    planner CHOOSES what to seed where), not synthetic injection
  - Larger effect sizes from more-substantive interventions
    (e.g., reader-info-state tracking, world-expansion budget)
  - Finer-grained metrics than pass/fail per beat
- **The 3-tier sequential roadmap ordering** — we just couldn't
  cheaply validate it. The ordering may still hold; this probe
  just doesn't discriminate.

## Recommendations for the roadmap

1. **Retire tier-ordering-validation as a charter.** The question
   is real but not cheaply answerable at this instrument level.
   Promote the ordering assumption to "working hypothesis, revisit
   if Tier 1 winners repeatedly collapse under Tier 2 writer swaps"
   per Fork 3 from the §11 options.
2. **Shift Tier 1 investment toward levers that produce a measurable
   writer response.** Per the terrain-survey finding + this probe,
   the short list of writer-visible planner-adjacent surfaces is:
   - `beat.description` content quality (not density)
   - `beat.characters` list (who's present — deterministic check
     caught misses)
   - `beat.kind` (action/dialogue/interiority)
   - `outline.povCharacter`, `outline.setting`
   - AND the unshipped Tier 1B threading (inject bulk
     establishedFacts + worldExpansionBudget + priorBeat facts
     into the writer prompt)
3. **If the ordering question becomes load-bearing again,**
   investigate at larger sampling scale (e.g., full novel runs
   across the 8-chapter rotation fixture when it exists) rather
   than per-chapter probes. The effect size this probe couldn't
   resolve may be detectable with 10× more beats, but not
   cheaply.

## Artifacts

- Experiment ID: `264` (tuning_experiments row, concluded)
- Run ID: `497` (runs row; llm_calls attached)
- eval_results: 52 rows under `set_name='tier-ordering-probe-v1'`
- Driver: `scripts/evals/tier-ordering-probe-v1.ts`
- Log: `/tmp/tier-probe-v1.log` on LXC

## Commit trace

- `db9d8f6` — roadmap revision 2
- `76a7667` — charter v1 draft
- `cca9f57` — Opus adversary RED verdict recorded
- `9956f62` — terrain survey kills v1 lever
- `8b89638` — probe driver (v2 lever)
- (this commit) — probe results + recommendation
