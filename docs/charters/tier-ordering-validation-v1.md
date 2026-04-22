---
status: killed
kind: experiment-charter
name: tier-ordering-validation-v1
owner: andre
date: 2026-04-21
parent-context: docs/autonomous-loop-roadmap-2026-04-21.md (revision 2)
killed-by: terrain survey 2026-04-21 — see §11 below
---

> **STATUS: KILLED (2026-04-21).** The Opus adversary review flagged
> 7 blockers and recommended a $0.60 synthetic-loud-planner probe as
> cheapest-untried-counterfactual. While surveying the codebase to
> build the probe driver, we confirmed that the charter's "loud
> planner variant" lever — inflating `establishedFacts` +
> `characterStateChanges` on the chapter outline — does NOT reach the
> writer prompt under the current `beat-context.ts` flow. Orphan
> facts not linked via `requiredPayoffs` are invisible to the writer;
> `characterStateChanges` from the outline is not rendered at all.
> The lever is vacuous. See §11 for the full finding and next-step
> options. Charter is superseded by whatever comes out of the
> follow-up decision.

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
| `/codex:adversarial-review` (GPT) — primary | not run | 2026-04-21 | SlashCommand tool unavailable in session; Codex plugin invocation failed on first try; user directed fallback. |
| `experiment-adversary` (Opus) — fallback | **RED** | 2026-04-21 | 7 blockers + 4 warnings + cheapest-counterfactual. Summary below. |

Block execution on YELLOW or RED. Iterate the charter, not the run.

### Opus experiment-adversary verdict (2026-04-21) — RED

**Summary.** Two of four primary metrics (plot-point coverage,
payoff-link completion) do not exist in the codebase — grep of
`src/` and `scripts/evals/` returns only the `requiredPayoffs`
schema field at `src/schemas/shared.ts:32`, no measurement code.
Design doc `autonomous-context-loop.md` line 161 mislabels
payoff-link realization as an "existing V1a metric" when only the
schema field exists. Hidden dev scope + rigged-dimension
load-bearing lever make the verdict uninterpretable regardless of
execution quality.

**Blocking issues:**
1. **Metrics are vaporware** (§9.2, axis 6). Drop to
   `{adherence-events, character-distinctness}` (N=2) OR land the
   missing metrics as charters-of-their-own first.
2. **Bundled lever** (§11.5). "Loud variant" mixes
   `establishedFacts` density (floor 3/beat) and
   `characterStateChanges` (floor 1 on POV-with-Drives). Single-knob
   arm missing. Restrict to `establishedFacts` density only OR
   expand to 2×3.
3. **Adherence-events reward-hacking unmitigated** (§11.1). More
   declared facts → more targets the checker scores against. If
   per-beat credit is normalized by declared-event count, loud cell
   inflates pass rate independent of structural cohesion. Add
   deterministic decomposition into (per-event precision, per-event
   recall, event-count delta) — mirrors voice-shaping-ablation-v1
   word-count residualization pattern.
4. **OR-ed falsification inflates Type-I error** (§3.4). Three
   falsification conditions × 4 metrics at n=5 — joint Type-I rate
   under H0 is substantially above 5%. Require per-metric
   conjunctive gate (≥2 of 3 conditions fire on SAME metric) OR
   Bonferroni-adjust (single-metric 2σ → 3σ; Spearman <0.5 on ≥2
   metrics, not "any").
5. **n=5 within-cell σ is statistically unidentified** (§7.1).
   σ-estimator CI half-width ~60% at n=5; the 2σ magnitude gate is
   effectively random. Pre-register σ from prior arm-d writer-upgrade
   variance OR pre-commit to n=8 (60% cost bump, ~$1.80 extra).
6. **Writer-stage parity skipped** (§4.7). Writer user_prompt is
   constructed from planner output — it DIFFERS between baseline
   and loud cells by design (facts + state sections). Parity harness
   only diffs planning stage. Add writer-stage invariant:
   "byte-equal EXCEPT for ESTABLISHED FACTS and CHARACTER STATE
   sections; envelope (model/provider/temp/maxTokens/responseFormat)
   byte-equal." Enforce with parity script on first beat of each
   cell. Pattern:
   `scripts/evals/conditioning-floor-parity-check.ts`.
7. **Baseline ladder missing writer ceiling anchor** (§2.1–2.3).
   Ordering hypothesis is ABOUT writer-invariance of planner lift;
   testing across only DeepSeek V3.2 + Salvatore v4 (two writers
   that program-direction-2026-04-21 calls "near-ceiling at similar
   scale") cannot distinguish writer-invariant lift from
   writer-pair-specific lift. Add Arm E (Loud planner + Llama 8B on
   Groq, <$0.05 incremental) as low-ceiling anchor.

**Warnings:**
- Roadmap-charter lever mismatch: roadmap §"Validating the ordering"
  named the lever as Tier 1B/1C (worldExpansionBudget +
  signature-phrasing extraction); charter uses Tier 1A planner
  density. Acknowledge the divergence + justify.
- Metric independence: adherence-events and plot-point coverage both
  read plan-fidelity. If plot-point lands, pre-register Spearman
  correlation between metrics; if >0.6, restate threshold as "3/4 of
  underlying-independent-axes" not "3/4 of reported metrics."
- Assignment confound: Salvatore v4 was trained on corpus matching
  current-planner shape. Loud planner shifts distribution AWAY from
  its training data. Under adapter-specific-distribution-shift
  alternative, Salvatore v4 degrades while DeepSeek gains → sign
  flip → false falsification. Add interpretation rule: if sign flip
  occurs AND Salvatore is the losing side, audit whether regressions
  cluster on beats with high establishedFacts-count delta; if yes,
  flag as adapter-distribution-shift, not tier-ordering falsification.
- `seed.pipelineOverrides` concurrency not audited. Add sentence:
  "2×2 driver runs cells sequentially on service with no other
  novels queued; each cell's planner prompt materialized before
  planning-beats calls and verified via --print-active-prompt
  assertion in first llm_calls row." OR wire
  `--planner-prompt-file=...` into the driver to pass prompt
  explicitly.
- Roadmap consequence of falsification is over-stated. Temper §3
  conclusion to: "If falsified AND not explained by blockers 2/3/6,
  commission follow-on 2×3 with metrics landed, THEN restructure."

**Cheapest untried counterfactual (~$0.60, ~1 hour):**
Synthetic-loud-planner probe. Take current baseline planning output
for 5 rotation chapters. Programmatically apply "loud" density
floors to it (duplicate adjacent facts to reach floor of 3; add
characterStateChanges to POV-with-Drives beats). Feed baseline vs
synthetically-loud planning output through current writer for 2
chapters × 2 writers = 4 chapter-runs (not 20). Run
adherence-events + character-distinctness on the 4 cells. Answers
the SHAPE of the question: does the writer respond to
structured-state density at all? If 4-cell probe shows zero delta
on both writers, full 2×2 won't produce signal — kill before the
expensive run. If signed delta, proceed to the revised full 2×2.

**Recommended action: REVISE CHARTER.** The ordering question is
worth answering, budget shape is right — but running as-specified
produces an undefendable verdict. Fixes 1–7 take <30 min each in
the charter at $0 experiment cost. Under those revisions: YELLOW
with named tweaks, then GREEN.

---

## 11. Post-review terrain survey (2026-04-21) — charter KILLED

Following the adversary's cheapest-untried-counterfactual, I began
surveying `src/agents/writer/beat-context.ts` to plan the
$0.60 synthetic-loud-planner probe driver. The survey surfaced a
structural flaw the adversary review did not catch that makes the
entire charter's lever vacuous regardless of how the protocol is
tightened.

### Finding

The charter defines "loud planner variant" as: floor of 3
`establishedFacts` per beat + floor of 1 `characterStateChange` per
beat where POV has a `Drives` entry. Both fields exist on
`ChapterOutline` (`src/agents/planning-plotter/schema.ts:52–85`)
and are produced by `planning-beats`
(`src/phases/planning.ts:207–212`).

**However** — `src/agents/writer/beat-context.ts` renders neither
field bulk-wise in the writer prompt:

- Lines 252–253 read `outline.establishedFacts` **only to build a
  `factById` lookup map**, not to render a facts block.
- Lines 255–262 render the `SEEDS (this beat must set up):` block
  by iterating over `beat.requiredPayoffs` (NOT
  `establishedFacts`) and looking up the fact text by
  `p.fact_id`.
- Lines 264–281 render the `PAYOFFS DUE (this beat must realize):`
  block by scanning earlier beats' `requiredPayoffs` whose
  `payoff_beat` equals the current index.
- `characterStateChanges` from the outline is **never rendered**;
  character state in the writer prompt comes from `characterStates`
  (end-of-chapter per-character state queried separately from the
  DB) at lines 302–316, not from the outline field the charter
  proposed to move.

**Consequence:** a planner that declares 3 `establishedFacts` per
beat but does NOT link them via `requiredPayoffs` produces byte-equal
writer prompts to a planner that declares 1 fact per beat. Adding
`characterStateChanges` to the outline changes nothing the writer
sees. The "loud variant" is invisible to the downstream writer, so
no delta — positive, negative, or sign-flipped — can exist to
measure.

The adversary's Blocker #2 (bundled lever) and Blocker #6 (writer
parity skipped without invariant) are both subsumed by a deeper
issue: **the lever does not exist on the writer code path at all**.

### Why the probe did not need to run

The adversary's cheapest-counterfactual was designed to test
"does the writer respond to structured-state density at all?" with
the synthetic-loud transformation applied to the outline. The
terrain-survey answer is **no, it cannot respond** — because the
transformation does not propagate to the writer's prompt bytes.
$0 probe replaces the $0.60 probe. This is a strictly stronger
version of the cheapest-untried-counterfactual pattern: the
counterfactual itself is a no-op.

### Implications for the roadmap (revision 2)

- Roadmap revision 2 names "writer-visible context levers
  (structural state richness)" as Tier 1B. This finding confirms
  Tier 1B is not-yet-shipped in a stronger sense than previously
  documented: the `establishedFacts` threading requires writer-side
  rendering work, not just a planner prompt edit.
- The intended Tier 1A vs Tier 1B separation ("planner output
  shape" vs "what the writer consumes") is NOT cleanly
  decomposable under the current `beat-context.ts`. Planner knobs
  that change fields beat-context doesn't render are invisible;
  only knobs touching fields beat-context DOES render (beat
  descriptions, `requiredPayoffs`, character name lists, POV,
  setting) produce writer-side signal.
- The roadmap's "Validating the ordering" §(2×2 design example)
  used "worldExpansionBudget + signature-phrasing extraction" as
  the concrete lever in the narrative description. Those are
  Tier 1B levers too, and `worldExpansionBudget` is documented as
  wired-but-zero in program-direction-2026-04-21. Both faces of the
  2×2 design are blocked on shipping Tier 1B first.

### Next-step options

1. **Ship Tier 1B writer-visible context threading first** (inject a
   bulk "ESTABLISHED FACTS FOR THIS CHAPTER" section into
   `beat-context.ts`, wire `worldExpansionBudget`, thread
   `priorBeatEstablishedFacts` via `getFactsUpToChapter`), THEN
   re-scope the ordering-validation charter against a lever that
   actually reaches the writer. This matches the program-direction
   thesis that Tier 1B is "highest-ROI most-unshipped." But it
   eliminates the cheap pre-validation of the tier ordering itself.
2. **Pivot the lever to `requiredPayoffs` density.** This field
   already reaches the writer at `beat-context.ts:255–281` via
   SEEDS/PAYOFFS DUE blocks. Test whether forcing the planner to
   emit ≥2 `requiredPayoffs` per beat (vs. the current unbounded
   output) moves adherence + distinctness under the two writers.
   Restores the cheapest-counterfactual shape without a code change.
3. **Kill ordering validation entirely** and accept the 3-tier
   sequential ordering as a working assumption; revisit if Tier 1
   winners repeatedly collapse under Tier 2 writer swaps. Matches
   "act on the next step" discipline but leaves the ordering
   unvalidated.

This decision is an architectural fork — recommend escalating to the
user rather than picking silently.

### Commit trace for audit

- `db9d8f6` — roadmap revision 2
- `76a7667` — charter v1 draft
- `cca9f57` — Opus adversary RED verdict recorded
- (this commit) — terrain-survey kill + next-step options
