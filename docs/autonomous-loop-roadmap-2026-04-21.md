---
status: draft
kind: roadmap
revision: 2
date: 2026-04-21
branch: autonomous-harness-loop
related:
  - docs/designs/autonomous-context-loop.md (revision 2, Codex-reviewed)
  - docs/archive/2026-04/harness-optimization-inventory.md (revision 2, Codex-amended)
  - docs/writer-imitation-benchmark.md (quality oracle — Salvatore corpus)
  - docs/corpus-pipeline.md (ground-truth infrastructure)
  - docs/program-direction-2026-04-21.md (the "what"; this is the "how")
supersedes-note: |
  Revision 1 (commit 42ac1e8) separated planner / character / beat-context
  into three parallel tracks inside Tier 1, kept concept/world-building
  unnamed, set a prose-coupled Tier 1 exit criterion, and under-ranked
  the methodology risks in Tier 2B. Codex adversarial review 2026-04-21
  (session continuing from charter-review) flagged all four. Revision 2
  consolidates Tier 1, names Tier 1.5 (concept) as explicitly deferred,
  tightens the Tier 1 exit criterion to planner-native metrics first and
  mandatory re-replay under Tier 2 writers, and re-ranks Tier 2B with
  scale (not methodology) as the likely limiter.
---

# Autonomous Improvement Loop — Phased Roadmap (revision 2)

Captures the user's 2026-04-21 framing — structural cohesion first,
prose quality second, refinement third — **after Codex adversarial
review**. Each tier unlocks the next; skipping ahead produces wins
that reward-hack downstream metrics.

The core thesis:
> With cohesive planning + convincing characters + good beat context,
> we can produce a **successful if bland novel**. Prose quality then
> becomes a separate problem — attack via better writer models or a
> new fine-tune methodology. Once planning is sharp enough, a
> narrow plan-aware linter becomes buildable.

**Current operating overlay (2026-05-02):** roadmap tiers are explored through one primary lane at a time. A lane declares its baseline, changed runtime lever, feedback signal, stop gate, and escalation rule before validation. DeepSeek V4 Flash concurrency should buy statistical power inside that lane through repeated same-family runs, fixed panels, paired replay, or multi-seed confirmation. Support tooling can proceed in parallel, but runtime changes from another tier are deferred to their own lane so promotion evidence stays attribution-clean.

Primary evaluation substrate for every tier: **published-prose
distance on the Salvatore held-out set** (per the 2026-04-21 pivot —
see `docs/designs/autonomous-context-loop.md` and the shared fixture
infrastructure described in the cross-cutting section below).

---

## Prerequisites (land before Tier 1 autonomous-loop iterations)

These are NOT optional enablers — they are gating because the loop
cannot safely toggle writer/planner knobs while they are
process-global reads.

- [ ] **`seed.pipelineOverrides` + env-var migration** — the loop
      needs to toggle `qualityRedraftEnabled`, `readerInfoStateEnabled`,
      `worldExpansionBudget`, and similar writer-visible knobs on a
      PER-NOVEL basis while the orchestrator service is running. The
      `QUALITY_REDRAFT_ENABLED` env-var pattern was already removed
      (see CLAUDE.md drafting.ts note, 2026-04-21) because it read at
      module-load and could not be scoped per-novel. Every remaining
      env-gated runtime toggle that the autonomous loop will mutate
      must migrate to `effectivePipeline(novel.seed)` first. Audit
      target: every `process.env.*` read under `src/phases/` and
      `src/agents/`.
- [ ] **Second untouched-holdout set, wired as drift detector** —
      additional Salvatore chapters (not a different author) that the
      loop NEVER sees during iteration. Feeds a calibration-substrate
      drift detector: when any tier's winner is promoted, replay on
      the second holdout and compare delta vs. the rotation set; if
      delta sign flips or magnitude differs >1σ, fail the promotion.
      This is the concrete answer to "the rotation set is itself
      being optimized against."
- [ ] **Shared 8–12 chapter rotation fixture** — per Codex consult
      2026-04-21 `af1b71a73d8add59d`; used as mini-batch substrate
      for all tier sub-loops.

---

## Tier 1 — Structural cohesion (consolidated)

**Goal:** produce a structurally coherent plan + beat-context
combination that, when followed, matches the narrative shape of
successful published novels.

**Scope note (revision 2):** Consolidated from revision 1's 1A/1B/1C
split. The "highest-ROI writer-context levers" from
`docs/program-direction-2026-04-21.md` (reader-info-state,
world-expansion budget, prior-beat facts) are **structural**, not
prose-polish — they change what the writer *knows*, not how it
*sounds*. Character interactivity levers likewise change the
structured state the writer sees. All belong in Tier 1.

### 1A. Planner sub-loop — beat flow and narrative arc

- [ ] Map beat flow to overall narrative
  - Metric: narrative-coherence score (cross-beat consistency, act
    structure realization, payoff-link completion rate)
  - Ground truth: back-extracted "plans" from the Salvatore trilogy
    (corpus pipeline already has beat briefs per chapter; inverse
    step reconstructs chapter-level plans)
- [ ] `planning-beats` autoresearch loop (Phase 0 from design doc)
  - Target file: `src/agents/planning-beats/beat-expansion-system.md`
  - Knob set per inventory §1.2 (Phase-0-eligible subset)
  - Fixture: shared 8–12 chapter rotation + marginal-case replay
    set + canary controls
- [ ] `planning-plotter` autoresearch loop (Phase 0.5 — opens after
      `planning-beats` converges)
  - Target: chapter-skeleton prompt
  - Metric: chapter-plan → beat-plan handoff fidelity

### 1B. Writer-visible context levers (structural state richness)

These change what the writer *sees*, not how it writes — load-bearing
for Tier 1 because they expand the structured state the planner
produces and checkers compare against.

- [ ] `readerInfoStateEnabled` wiring (currently unshipped) — what
      the reader has been shown vs what a given character knows
- [ ] `worldExpansionBudget` wiring (currently 0) — per-chapter KB
      budget of relevant world_bible excerpts selected by entity match
- [ ] `priorBeatEstablishedFacts` via `getFactsUpToChapter` threading
      into `buildBeatContext` (infrastructure exists, not threaded)
- [ ] Evaluate `toolsMode` for writer-tool-calling methodology

### 1C. Character interactivity (distinctness — structural, not cosmetic)

- [ ] `character-distinctness-audit-v1` on existing 80-row fixture —
      does D3 directive-heavy prompt measurably differentiate voices
      within a beat? (runs before new work)
- [ ] Per-character context-pass architecture — generate prose
      character-by-character in sequence; each pass sees only its own
      speaker profile
- [ ] Signature-phrasing extraction knob — pull habitual
      constructions from `exampleLines` into per-beat "use one of
      these" directives
- [ ] Relationship-graph depth knob (dyad / triad / full-N)
- [ ] Register-locking per-character (formal / vernacular /
      figurative tier, pinned at novel-concept time)

### Tier 1 exit criterion (revision 2 — tightened)

**Primary gate (planner-native):** on the shared 8–12 chapter
rotation fixture, the planner's output satisfies the structural
metrics in 1A (narrative-coherence, payoff-link completion,
cross-beat consistency) within 1σ of the reference plans
back-extracted from Salvatore. **This gate does not depend on
writer prose.**

**Secondary gate (prose replay under current writer):** the planner
winner, when executed through the current DeepSeek writer, produces
prose that matches structural rhythm + plot-point coverage +
character-distinctness within 1σ of reference on the rotation
fixture. Voice-shape may still be off — that is Tier 2's problem.

**Tertiary gate (writer-upgrade robustness — mandatory):** the
planner winner MUST be re-replayed under whichever writer Tier 2
ultimately ships, and must retain its structural-metric lead. If
the structural metrics invert or collapse under the upgraded writer,
the Tier 1 winner is invalidated as reward-hacked against DeepSeek
idiosyncrasies and re-enters the sub-loop. The second untouched
holdout is the substrate for this replay.

**Drift-detector gate (always-on):** second holdout delta must
agree in sign and within 1σ magnitude of rotation delta. Any
promoted winner that fails this is rolled back.

---

## Tier 1.5 — Concept / world-building (deferred, named)

**Status:** deferred pending Tier 1 convergence. Explicitly named so
it does not disappear from the plan.

**Scope (per `docs/designs/autonomous-context-loop.md` sub-loop 0):**
- `world-builder` prompt (setting spine, systems, cultures, geography)
- `character-agent` prompt (profiles, relationships, drives/avoids)
- `plotter` prompt (initial arc before chapter-level planning)

**Why deferred:** concept changes are farthest from audited per-beat
failures; attribution is hardest at this layer; the sub-loop closest
to the oracle (planning-beats) goes first and tells us whether the
upstream concept layer is even the bottleneck.

**Entry criterion:** Tier 1 planner sub-loop has converged AND
post-promotion drift detector shows residual structural deficits
that trace back to concept-layer inputs (via attribution tooling).

---

## Tier 2 — Prose quality (after structural is stable)

**Goal:** close the voice-shape + interiority-density gap between
harness prose and published prose. Structural wins from Tier 1 are
the substrate; Tier 2 is about HOW the words land.

### 2A. Writer-model bakeoff (run BEFORE committing methodology direction)

**Revision 2 correction:** the original $5–15 budget was
underanchored — the repo has actual Sonnet costs of ~$2–6 per
20-chapter novel from `public.llm_calls`, but no logged Opus 4.7
estimate at novel-scale. **A one-shot bakeoff is the gating
artifact**, not the whole tier.

- [ ] Frontier-vs-DeepSeek bakeoff on Tier 1 fixtures
  - Candidates: GPT-5.4, Claude Opus 4.7, Gemini 3, DeepSeek V3.2
    (incumbent), DeepSeek R1
  - Cost: log actual `llm_calls` cost post-run — do NOT estimate
    from per-token pricing (memory
    `feedback_query_llm_calls_for_costs`: "I was 100× too high on
    2026-04-20")
  - Measurement: voice-shape distance + interiority density on
    held-out Salvatore + rotation fixture
- [ ] Bakeoff outcome gates everything downstream in Tier 2:
  - If a frontier model closes >50% of the voice-shape gap at
    ≤5× DeepSeek cost → ship it; Tier 2B fine-tune work
    de-prioritized (methodology is less leveraged than scale)
  - If the gap is largely scale-invariant → Tier 2B matters;
    methodology choice drives next step
  - If DeepSeek holds → harder problem; revisit in Tier 3

### 2B. Alternative fine-tune methodologies (re-ranked by Codex)

**Revision 2 correction:** scale is the likely limiter, not
methodology. Methodologies re-ranked below.

The Salvatore voice-LoRA track was frozen 2026-04-21. Revisit ONLY
if 2A bakeoff says scale is not the gap:

1. **Distillation from a stronger writer** (Opus 4.7 → Qwen3-14B
   student, target voice-shape transfer rather than raw prose
   imitation) — the only plausible methodology of the three. Scale
   of teacher is the source of the lift.
2. **DPO on paired prose** (harness-produced vs published) —
   Goodhart-prone; contrastive signals on prose quality at 14B
   scale are dominated by surface features the reward model can
   learn to please. Not ruled out but ranked below distillation.
3. **Continued pretraining on larger Salvatore-adjacent corpus
   before SFT** — weakest bet. Corpus-vocabulary bleed-through was a
   problem at the current data scale; expanding the corpus without
   changing the architecture amplifies it.

- [ ] Pick #1 (distillation) for first attempt if 2A gates this tier
- [ ] Treat #2 and #3 as research arms, not roadmap commitments

### 2C. Writer-layer context engineering (bare-DeepSeek route)

These overlap Tier 1C conceptually but are framed as prose-quality
levers rather than distinctness levers. Run in parallel with 2A if
the bakeoff is cheap.

- [ ] Speaker-directives depth experiments (per inventory §2.2)
- [ ] Reader-info-state visibility experiments (may ship as Tier 1
      work depending on where measured signal lands)

### Tier 2 exit criterion

On held-out Salvatore chapters (both rotation fixture AND second
untouched holdout), voice-shape distance is within 0.5σ across all
5 features AND interiority density is within reference band. Prose
is no longer "bland" on the decomposed audit. Drift detector
agreement required.

---

## Tier 3 — Refinement

**Goal:** catch contract failures between stages and polish prose
without introducing reward-hacking paths.

### 3A. Expanded lint catalog (with risks flagged — re-ranked)

Current lint: ~26 deterministic patterns + LLM fixes for cliché,
hedging, emotional echo, rhythm. Lives in `src/lint/`.

Potential expansions:
- [ ] Dialogue-tag variety detector (currently not lint-enforced)
- [ ] Sensory-modality balance (over-reliance on visual, under-use
      of kinesthetic / tactile)
- [ ] Repetition-across-chapters (catches structural monotony the
      current per-chapter detectors miss)
- [ ] Filter-word catalog (realized, noticed, felt — telling markers)

**Risks (revision 2 — re-ranked by Codex):**
1. **Calibration drift + operational overhead** (immediate risk).
   Each new lint pattern changes the retry surface and can
   miscalibrate — cite the no-op quality-redraft gate
   miscalibration from `docs/decisions.md` 2026-04-21 as the
   pattern-to-avoid. FP-rate compounding (revision 1 risk #2) is
   a specific form of this.
2. **Research/citation debt IS load-bearing** (not just "nice to
   have"). Per memory `feedback_lint_sourcing` and the harness
   inventory's citation-debt column: every lint pattern needs a
   craft-reference citation. Expanding the catalog 2× means 2×
   citation work; without it the catalog grows ad-hoc and the
   harness can't defend its own checker decisions.
3. Lint-pass optimization as Goodhart target (revision 1 risk #1)
   — real but ranked below calibration drift because Tier 1
   structural gates would catch most reward-hack paths before they
   reach the lint surface.

### 3B. Plan-aware linter (narrow — not broad)

**Revision 2 correction:** narrowly scoped to planner-state
contracts that existing checkers do NOT already enforce. If scoped
broadly, it relabels existing work; scoped narrowly, it audits
three specific schema fields.

**The idea:** a linter that checks prose against PLAN
expectations per-beat, operating at the beat level with stricter
contracts than existing checkers. Currently we have:
- `adherence-events` — events + attribution match
- `chapter-plan-checker` — cross-beat coherence

A plan-aware linter sits between these, targeting **three planner
fields not covered by existing checks**:

1. **`Avoids`** (character-level) — linter flags prose where a
   character engages with an avoided topic
2. **`Drives`** (character-level) — linter flags prose where the
   beat's POV character does NOT manifest their drive (not just
   mention it)
3. **`requiredPayoffs`** (plan-level) — linter flags when a beat
   seeded as paying off an earlier beat does not realize the
   payoff

- [ ] Design spec for plan-aware linter (scoped to the three fields
      above, NOT generic "plan compliance")
- [ ] **Salvatore calibration pass** — does published Salvatore
      prose satisfy the linter's contracts against its back-extracted
      plan? If no, the linter is miscalibrated or the back-extraction
      is lossy. This is the gating prerequisite.
- [ ] Prototype on held-out Salvatore chapters
- [ ] Audit: does the linter produce signal the existing checkers
      don't already catch? (if no → retire the idea)

**Risks specific to plan-aware linter:**
1. Requires extremely cohesive planning stage (Tier 1 must be done)
   or the linter enforces incorrect contracts
2. If broad-scoped, duplicates adherence/chapter-plan-checker work.
   Narrow scope (above) avoids this.
3. Could be used to reward-hack: writer learns to satisfy lint-style
   plan contracts rather than write good prose

### 3C. Tonal-pass methodology revival (deferred)

Howard tonal-pass retired 2026-04-16. Revisit only if Tier 2's
writer-model bakeoff + fine-tune methodologies fail to close the gap
AND a post-generation polish layer looks like the remaining lever.

---

## Cross-cutting enablers (all tiers)

- [ ] Shared 8–12 chapter rotation fixture (prerequisite, listed
      above)
- [ ] Second untouched-holdout set + drift detector (prerequisite,
      listed above)
- [ ] Attribution tooling: scheduled ablation checkpoints when an
      iteration produces meaningful gain/regression
- [ ] Cost observability: per-iteration token + dollar breakdown
      wired into history JSONL (sourced from `public.llm_calls`,
      never computed from per-token pricing)
- [ ] Reward-hacking defense stack: leak detector + distinct-beat
      stress test + untouched validation set (phase 0 minimum)

---

## Sequencing notes

**Strict ordering:** Tier 1 before Tier 1.5 before Tier 2 before
Tier 3. Skipping ahead risks reward-hacking the lower-tier metric
(e.g., optimizing Tier 2 voice-shape without Tier 1 narrative
cohesion produces prose that sounds right while dropping required
story content).

**Within a tier, parallelism is OK.** 1A, 1B, and 1C can run as
separate autoresearch sub-loops simultaneously IF they share the
rotation fixture + second untouched holdout.

**Tier 2A bakeoff is the gate for Tier 2B/2C direction** — run
the bakeoff first; let results decide whether methodology work or
context-engineering work gets priority.

**Prerequisites are blockers.** `seed.pipelineOverrides` migration
and the second untouched holdout must ship before the loop starts
toggling knobs.

---

## Validating the ordering (before committing to 3-tier structure)

Per Codex adversarial review — the cheapest counterfactual to
validate whether sequential tiering actually holds or whether
Tier 1 and Tier 2 need parallel-coupled optimization:

**2×2 replay design:**

| | DeepSeek V3.2 writer | Salvatore v4 writer |
|---|---|---|
| **Baseline planner** | cell A | cell B |
| **Loud planner variant** | cell C | cell D |

- Fixture: 5-chapter pool from rotation set + second-novel held-out
- "Loud planner variant" = one concrete Tier 1 structural lever
  applied (e.g., `worldExpansionBudget` > 0 + signature-phrasing
  extraction enabled) against the current baseline
- Cost target: ~$2–5, half a day

**Decision rule:**
- If planner lift improves structural metrics under BOTH writers
  AND planner ranking stays stable across writer swaps → sequential
  tiering is valid, commit to the 3-tier roadmap
- If writer swap flips planner ranking OR materially changes
  structural outcomes → Tier 1 and Tier 2 require parallel-coupled
  optimization; the roadmap needs joint-optimization restructure

See `docs/charters/` for the charter capturing this experiment.

---

## Open questions (after Codex review — remaining)

1. **Attribution tooling concrete design:** scheduled ablation
   checkpoints are named as an enabler — what's the actual trigger
   (delta magnitude? run count? manual?) and what's the
   artifact format?
2. **Tier 1.5 entry criterion tightness:** "residual structural
   deficits that trace back to concept-layer inputs via attribution
   tooling" presumes attribution tooling works well enough to
   trace. Needs a calibration pass of its own before it can gate
   Tier 1.5.
3. **Drift-detector tolerance:** "within 1σ of rotation delta" is
   the opening proposal. Needs to be calibrated against observed
   variance across current Salvatore evals before it becomes a
   production gate.
