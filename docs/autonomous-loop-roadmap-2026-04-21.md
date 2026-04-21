---
status: draft
kind: roadmap
date: 2026-04-21
branch: autonomous-harness-loop
related:
  - docs/designs/autonomous-context-loop.md (revision 2, Codex-reviewed)
  - docs/harness-optimization-inventory.md (revision 2, Codex-amended)
  - docs/writer-imitation-benchmark.md (quality oracle — Salvatore corpus)
  - docs/corpus-pipeline.md (ground-truth infrastructure)
---

# Autonomous Improvement Loop — Phased Roadmap

Captures the user's 2026-04-21 framing: structural cohesion first,
prose quality second, refinement third. Each tier unlocks the next;
skipping ahead produces wins that reward-hack downstream metrics.

The core thesis:
> With cohesive planning + convincing characters + good beat context,
> we can produce a **successful if bland novel**. Prose quality then
> becomes a separate problem — attack via better writer models or a
> new fine-tune methodology. Once planning is sharp enough, a
> plan-aware linter becomes buildable.

Primary evaluation substrate for every tier: **published-prose
distance on the Salvatore held-out set** (per the 2026-04-21 pivot —
see docs/designs/autonomous-context-loop.md revision 3 when landed).

---

## Tier 1 — Structural cohesion (prerequisite)

**Goal:** produce a structurally coherent plan that, when followed,
matches the narrative shape of successful published novels.

### 1A. Planner sub-loop — beat flow and narrative arc

- [ ] Map beat flow to overall narrative
  - Metric: narrative-coherence score (cross-beat consistency, act
    structure realization, payoff-link completion rate)
  - Ground truth: back-extracted "plans" from the Salvatore trilogy
    (the corpus pipeline already has beat briefs per chapter; an
    inverse step can reconstruct chapter-level plans)
- [ ] `planning-beats` autoresearch loop (Phase 0 from design doc)
  - Target file: `src/agents/planning-beats/beat-expansion-system.md`
  - Knob set per inventory §1.2 (Phase-0-eligible subset)
  - Fixture: 5-chapter held-out rotation + marginal-case replay set
    + canary controls
- [ ] `planning-plotter` autoresearch loop (Phase 0.5 — opens after
      `planning-beats` converges)
  - Target: chapter-skeleton prompt
  - Metric: chapter-plan → beat-plan handoff fidelity

### 1B. Character cohesion — convincing characters

- [ ] `character-agent` sub-loop
  - Metric: character-distinctness (within-beat) + character-consistency
    (across-chapter). Compared against distinctness patterns in
    `novels/salvatore-icewind-dale/analysis/dialogue-extract.jsonl`
    (2,447 attributed lines, 2+ characters per beat avg)
- [ ] Signature-phrasing extraction knob
  - Pull habitual constructions from `exampleLines` into explicit
    "use one of these this beat" directives per character (per
    `program.md` character interactivity notes)
- [ ] Relationship-graph depth knob (dyad / triad / full-N)
- [ ] Register-locking per-character (formal / vernacular /
      figurative tier, pinned at novel-concept time)

### 1C. Beat-context handoff (already in Phase 0 scope)

- [ ] `readerInfoStateEnabled` wiring (currently unshipped)
- [ ] `worldExpansionBudget` wiring (currently 0)
- [ ] `priorBeatEstablishedFacts` threading via `getFactsUpToChapter`
- [ ] Evaluate `toolsMode` for writer-tool-calling methodology

**Exit criterion for Tier 1:** on held-out Salvatore chapters, the
harness-produced plan + beat-context combination produces prose that
matches published prose's **structural rhythm + plot-point coverage +
character-distinctness** within 1σ of reference. Voice-shape and
interiority density may still be off; that's Tier 2's problem.

---

## Tier 2 — Prose quality (after structural is stable)

**Goal:** close the voice-shape + interiority-density gap between
harness prose and published prose. Structural wins from Tier 1 are
the substrate; Tier 2 is about HOW the words land.

### 2A. Better writer models

- [ ] Benchmark top-tier writers on the Tier 1 fixtures
  - Candidates: GPT-5.4, Claude Opus 4.7, Gemini 3, DeepSeek V3.2
    (current), DeepSeek R1
  - Budget: ~$5–15 for a 5-chapter comparison across candidates
  - Measurement: voice-shape distance + interiority density on
    held-out Salvatore
- [ ] If a candidate clears the structural gap → ship it as the
      fantasy-route writer (supersedes Salvatore v4 LoRA)

### 2B. Alternative fine-tune methodologies

The Salvatore voice-LoRA track was frozen 2026-04-21 (see
`docs/decisions.md`). Revisit with different methodologies:

- [ ] DPO on paired prose (harness-produced vs published) —
      contrastive fine-tuning rather than SFT
- [ ] Distillation from larger models (Opus 4.7 → Qwen3-14B student)
      — target voice-shape transfer rather than raw prose imitation
- [ ] Continued pretraining on larger Salvatore-adjacent corpus
      before SFT — address corpus-vocabulary-bleed issue differently
- [ ] Evaluate whether methodology alone can close the voice-shape
      gap on 14B base, or whether the base scale is fundamentally the
      limiter

### 2C. Writer-layer context engineering (bare-DeepSeek route)

- [ ] Speaker-directives depth experiments (per inventory §2.2)
- [ ] Reader-info-state visibility experiments
- [ ] Per-character generation passes (multi-turn writer) —
      architecture pivot for distinctness per
      `docs/program-direction-2026-04-21.md` §2

**Exit criterion for Tier 2:** on held-out Salvatore chapters,
voice-shape distance is within 0.5σ across all 5 features AND
interiority density is within reference band. Prose is no longer
"bland" on the decomposed audit.

---

## Tier 3 — Refinement

**Goal:** catch contract failures between stages and polish prose
without introducing reward-hacking paths.

### 3A. Expanded lint catalog (with risks flagged)

Current lint: ~26 deterministic patterns + LLM fixes for cliché,
hedging, emotional echo, rhythm. Lives in `src/lint/`.

Potential expansions:
- [ ] Dialogue-tag variety detector (currently not lint-enforced)
- [ ] Sensory-modality balance (over-reliance on visual, under-use of
      kinesthetic / tactile)
- [ ] Repetition-across-chapters (catches structural monotony the
      current per-chapter detectors miss)
- [ ] Filter-word catalog (realized, noticed, felt — telling markers)

**Risks to surface to Codex:**
1. Lint-pass optimization as Goodhart target — if writer learns to
   please the lint catalog, prose gets sanitized
2. False-positive rate compounds as catalog grows (classic SQL lint
   problem scaled to prose)
3. Research/citation debt — per memory `feedback_lint_sourcing`,
   every lint pattern needs a craft-reference citation. Expanding
   the catalog 2× means 2× citation work.

### 3B. Plan-aware linter (novel — not in current codebase)

**The idea:** a linter that checks prose against PLAN expectations
per-beat, not just surface prose patterns. Currently we have:
- `adherence-events` checker — events + attribution match
- `chapter-plan-checker` — cross-beat coherence

A plan-aware linter would sit between these, operating at the
**beat level** with stricter contracts:

- Plan says "Character X reveals drive toward safety" → prose must
  show this drive manifest, not just mention it
- Plan seeds a `requiredPayoff` at beat 3 paying off at beat 7 →
  linter flags if beat 7's prose doesn't realize the payoff
- Plan specifies character's `Avoids` → linter flags prose where
  that character engages with the avoided topic

- [ ] Design spec for plan-aware linter
- [ ] Prototype on held-out Salvatore chapters (does the
      published prose satisfy the linter's contracts against its
      back-extracted plan? This is the calibration check.)
- [ ] Risk audit — when does the linter produce signal the existing
      checkers don't already catch?

**Risks specific to plan-aware linter:**
1. Requires extremely cohesive planning stage (Tier 1 must be done)
   or the linter enforces incorrect contracts
2. Duplicates adherence/chapter-plan-checker work — may add no
   signal over what already exists
3. Could be used to reward-hack: writer learns to satisfy lint-style
   plan contracts rather than write good prose

### 3C. Tonal-pass methodology revival (deferred)

Howard tonal-pass retired 2026-04-16. Revisit only if Tier 2's
voice-fine-tune methodologies fail to close the gap AND a
post-generation polish layer looks like the remaining lever.

---

## Cross-cutting enablers (all tiers)

- [ ] Expand ground-truth fixture to 8–12 Salvatore chapters rotated
      as mini-batches (per Codex consult 2026-04-21 `af1b71a73d8add59d`)
- [ ] Build second untouched-holdout set for final-winner validation
      (additional Salvatore chapters, not a different author)
- [ ] Attribution tooling: scheduled ablation checkpoints when an
      iteration produces meaningful gain/regression
- [ ] Cost observability: per-iteration token + dollar breakdown
      wired into history JSONL
- [ ] Reward-hacking defense stack: leak detector + distinct-beat
      stress test + untouched validation set (phase 0 minimum)

---

## Sequencing notes

**Strict ordering:** Tier 1 before Tier 2 before Tier 3. Skipping
ahead risks reward-hacking the lower-tier metric (e.g., optimizing
Tier 2 voice-shape without Tier 1 narrative cohesion produces prose
that sounds right while dropping required story content).

**Within a tier, parallelism is OK.** 1A and 1B can run as separate
autoresearch sub-loops simultaneously IF they share the
ground-truth fixture and the held-out untouched-holdout.

**Enablers are NOT blockers** — Tier 1 can start before all
cross-cutting items ship; they land incrementally alongside the
first autoresearch iterations.

---

## Open questions for Codex review

1. Is the Tier ordering correct (structural → prose → refinement)?
   Or is there a different decomposition that better matches the
   repo's actual bottleneck?
2. Is "successful if bland" a useful intermediate target? Or does
   skipping voice-quality in Tier 1 mean we build a planner that
   produces unsalvageable plans?
3. Plan-aware linter: does it add signal over existing adherence +
   chapter-plan-checker, or is it duplicative?
4. DPO / distillation / continued-pretraining — which (if any) is
   the most promising Tier 2B methodology for voice fine-tuning?
5. Is the ~$5–15 budget for Tier 2A writer benchmarking realistic?
   Does GPT-5.4 at that price make sense as a production writer?
6. What's the cheapest Tier 1 counterfactual to validate the whole
   ordering before committing to the 3-tier structure?
