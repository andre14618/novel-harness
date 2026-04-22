---
status: proposed
kind: experiment-charter
name: tier-ordering-validation-v1
owner: andre
date: 2026-04-21
parent-context: docs/autonomous-loop-roadmap-2026-04-21.md (revision 2)
---

# Experiment Charter — `tier-ordering-validation-v1`

Forcing function for the question the autonomous-loop roadmap
(revision 2) cannot answer analytically: **does sequential tiering
(Tier 1 structural → Tier 2 writer quality) actually hold, or do
Tier 1 and Tier 2 require parallel-coupled optimization?**

Codex adversarial review of the roadmap (2026-04-21) identified the
ordering assumption as the single load-bearing structural choice that
is not independently validated. If the assumption is wrong, the
entire 3-tier roadmap restructures around joint optimization. The
cheapest way to find out is a 2×2 replay on a small fixture BEFORE
any autonomous-loop Phase 0 iteration commits to the tier structure.

## 1. Question

On the shared Salvatore rotation fixture, does a concrete Tier 1
planner-side structural intervention improve structural-audit
metrics (a) under BOTH current writer models (DeepSeek V3.2 and
Salvatore v4 LoRA) and (b) with STABLE ranking across writer swaps?

## 2. Hypothesis

**If** we regenerate 5 chapters × 2 planner variants × 2 writer
models (20 chapter-runs) and measure structural-audit metrics
(adherence-events pass rate, character-distinctness, plot-point
coverage, payoff-link completion), **then** the planner-variant
delta (loud − baseline) will have the same sign under both writers
AND the across-writer rank-correlation of (planner, writer) cell
scores will exceed 0.7, **because** if the planner intervention
changes structured state the writers consume (beat descriptions,
`establishedFacts`, `characterStateChanges`), both writers are
downstream consumers of the same signal and should respond in the
same direction; a ranking flip would indicate the intervention is
actually writer-specific reward-hacking rather than structural
improvement.

## 3. Falsification threshold

The 3-tier sequential ordering assumption is **falsified** if:

- **Sign flip:** (loud − baseline) is positive for one writer and
  negative for the other on ≥ 2 of 4 primary structural metrics, OR
- **Magnitude divergence:** |delta under DeepSeek − delta under
  Salvatore| > 2σ on any primary metric, where σ is estimated from
  within-cell variance across the 5 chapters, OR
- **Rank inversion:** Spearman rank-correlation of the 4 cells'
  scores across writers < 0.5 on any primary metric.

If falsified, the roadmap restructures around parallel-coupled
Tier 1 / Tier 2 optimization and the autonomous loop design
(`docs/designs/autonomous-context-loop.md` revision 2) needs a
composition rule for joint planner+writer search, not decomposed
sub-loops with sequential gating.

## 4. Baseline ladder

| Slot | Config | Purpose |
|------|--------|---------|
| Floor | Baseline planner + DeepSeek V3.2 writer | current production on non-fantasy routes |
| Current prod | Baseline planner + Salvatore v4 writer | current production on fantasy routes (default seed → Salvatore LoRA via `WRITER_GENRE_PACKS`) |
| Intervention A | Loud planner + DeepSeek V3.2 writer | tests whether planner-lift transfers to non-LoRA writer |
| Intervention B | Loud planner + Salvatore v4 writer | tests whether planner-lift transfers to LoRA writer |

"Loud planner variant" (concrete definition):

- **Lever:** `planning-beats` prompt edit to tighten the
  `establishedFacts` / `characterStateChanges` / `knowledgeChanges`
  density contract — floor of 3 `establishedFacts` per beat + floor
  of 1 `characterStateChange` per beat where a character with a
  `Drives` entry is POV.
- **Why this lever:** it is a pure prompt edit (shippable in ~30
  min with no downstream code changes), upstream of every writer
  choice (so the Tier 1 hypothesis is directly testable), and it
  changes the STRUCTURED STATE both writers consume. It does NOT
  touch writer-visible context templates or checker thresholds.
- **What it is NOT:** a writer-prompt change, a context-template
  change, a model swap, or a checker-threshold change. Those all
  confound the Tier 1 / Tier 2 separation this experiment is
  designed to test.

## 5. Cheapest counterfactuals considered

| Lever | Estimated cost | Rejected because |
|-------|----------------|------------------|
| Analytically reason through the ordering | $0 | The ordering assumption IS the thing we cannot reason through — it depends on whether planner signal is writer-invariant, which is an empirical property of the current writer stack. |
| Run only 1×2 (baseline planner + both writers) | ~$1 | Measures writer variance but does NOT measure whether a planner change transfers across writers. The planner-transfer question is the ordering question. |
| Run only 2×1 (both planners + one writer) | ~$1 | Measures planner lift but does NOT measure writer-swap robustness. Would commit to the ordering on single-writer evidence, which is exactly what the Codex review flagged as insufficient. |
| 2×2 on 1 chapter only (instead of 5) | ~$0.50 | Within-cell variance on 1 chapter is too high to detect the 2σ magnitude divergence in §3. 5 chapters is the floor where per-cell σ is estimable. |

The 2×2 at 5 chapters is the minimum design that answers the
question. A cheaper variant would under-power the falsification
criterion.

## 6. Distribution match

**Fixture (primary).** 5 chapters drawn from the shared Salvatore
rotation fixture (prerequisite per roadmap revision 2 cross-cutting
section). Stratification: 5 chapters spanning the narrative arc
positions (opener / rising / midpoint / complication / payoff) to
avoid arc-position confounds in the ranking analysis.

**Fixture (held-out replay).** If primary 2×2 shows stable ranking,
replay the loud-planner cell under both writers on an additional 3
chapters from the second untouched holdout (roadmap prerequisite) to
confirm the result is not rotation-fixture-overfit. This is a
post-hoc ladder, not a blocker on the primary verdict.

**Parity harness.**
- **Request-construction parity:** the baseline planner and loud
  planner are the same `planning-beats` agent with only the
  system prompt file differing. Request envelope (model, temperature,
  schema, user-prompt construction) is byte-equal. Parity check
  script: diff the stored `llm_calls` request bodies for the
  baseline and loud cells at the planning-beats stage, assert only
  the system-prompt region differs.
- **Writer parity:** baseline-planner and loud-planner chapters fed
  to the same writer (DeepSeek V3.2 or Salvatore v4 LoRA
  respectively) share the same writer-agent code path, same
  context-builder, same model envelope. Writer differs only by
  model assignment.
- **Measurement parity:** decomposed audit (adherence-events,
  halluc-ungrounded, character-distinctness, structural metrics)
  runs identically on all 4 cells. Adherence/halluc adapters are
  NOT retrained for this experiment — the Codex round-9
  detector-version caveat is noted; if calibration drift shows up in
  the audit, it affects both cells of a given writer equally and
  does not confound the planner-delta sign.

**Stratification match.** The rotation fixture matches training-data
stratification per memory `feedback_eval_stratification` (both drawn
from Salvatore corpus). No training is happening in this experiment
— no contamination risk.

## 7. Success criteria

Primary metrics (4):

1. **adherence-events pass rate** (per-beat, averaged per cell)
2. **character-distinctness pass rate** (per-beat, averaged per cell)
3. **plot-point coverage** (vs back-extracted reference plan for the
   chapter)
4. **payoff-link completion rate** (beats that seed a required
   payoff realize it)

| Outcome | Condition | Action |
|---------|-----------|--------|
| **ORDERING VALIDATED** | (loud − baseline) same sign under both writers on ≥ 3/4 metrics AND Spearman rank-correlation of 4 cells across writers ≥ 0.7 on ≥ 3/4 metrics | Commit to the 3-tier sequential roadmap. Begin Phase 0 of `planning-beats` autoresearch sub-loop per design doc. |
| **ORDERING FALSIFIED** | Any one of the §3 falsification conditions triggers | Roadmap restructures to joint optimization. Autonomous-loop design gets a composition rule for joint planner+writer search. New charter for the restructured plan. |
| **UNDERPOWERED** | Within-cell σ > observed delta on ≥ 2 primary metrics | Expand to 8 chapters (matches full rotation fixture size). Re-run. |
| **INFRA FAILURE** | Planner or writer errors on > 10% of chapter-runs | Fix infra, re-run. Not a verdict. |

## 8. Budget

- **Spend cap:** $5 hard. Expected shape: 5 chapters × 2 planners =
  10 planning-beats calls (~$0.20 at DeepSeek pricing); 20
  chapter-runs × ~10 beats/chapter × 2 writers ≈ 200 beat-writer
  calls at ~$0.01 each (DeepSeek) or ~$0.02 each (Salvatore v4 on
  W&B Inference) = ~$2–3 writer spend; audit calls ~$0.50. Total
  target: ~$3.
- **Wall-clock cap:** half a day (4 hours) from GREEN to verdict.
- **Stop if:** planner parity check fails (experiment invalidated
  by envelope divergence), writer errors on > 2 of 20 chapter-runs
  (infrastructure, not product), or the analysis surfaces a design
  confound Codex review missed.

## 9. Linked context

- **Parent roadmap:** `docs/autonomous-loop-roadmap-2026-04-21.md`
  (revision 2) — this charter IS the roadmap's
  "Validating the ordering" section, instantiated.
- **Codex review that mandated this experiment:** adversarial
  review of roadmap revision 1, 2026-04-21 (session continuing from
  `/charter-review` — verdict: ROADMAP NEEDS AMENDMENTS + REORDER).
- **Prerequisites (roadmap revision 2):**
  - Shared 8–12 chapter rotation fixture must exist (at least 5
    chapters ready + 3 held-out) before this runs.
  - `seed.pipelineOverrides` migration is NOT strictly required for
    this experiment since the planner-prompt swap is a file-level
    change per run, not a per-novel runtime toggle. Flagged so that
    post-experiment the mechanism does not leak into production
    without the override wiring.
- **Reused infrastructure:**
  - `src/phases/planning.ts` two-phase planner
  - `src/agents/planning-beats/` prompt files (the loud variant is
    a sibling prompt file, not a structural change)
  - Existing writers (DeepSeek V3.2 default, Salvatore v4 via
    `WRITER_GENRE_PACKS` for fantasy-route)
  - Decomposed audit stack (adherence-events, halluc-ungrounded,
    character-distinctness, structural metrics)
  - `eval_results` / `eval_briefs` persistence
- **New code required:**
  - `src/agents/planning-beats/beat-expansion-system.loud.md` —
    sibling prompt file with tightened density contract.
  - `scripts/evals/run-tier-ordering-2x2.ts` — driver that for each
    of 5 chapters × 2 planner variants × 2 writers produces a
    chapter-run, writes to `eval_results` with
    `set_name='tier-ordering-validation-v1'` and the cell label
    identifying planner-variant + writer.
  - Parity check: extend an existing planning-stage parity script
    or add `scripts/evals/planner-prompt-parity-check.ts`.
- **`tuning_experiment` ID:** created at GREEN, type `ticket`
  (per memory `feedback_experiment_db` — every benchmark run links
  to an experiment).

## 10. Adversary review

Primary: Codex `/charter-review` → `/codex:adversarial-review`.

| Reviewer | Verdict | Date | Notes |
|----------|---------|------|-------|
| `/codex:adversarial-review` (GPT) — primary | pending | — | — |
| `experiment-adversary` (Opus) — fallback only | — | — | only if Codex unavailable |

Block execution on YELLOW or RED. Iterate the charter, not the run.
