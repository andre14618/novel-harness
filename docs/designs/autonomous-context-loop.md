---
status: design (not yet implemented)
kind: subsystem-design
revision: 2
date: 2026-04-21
related: docs/program-direction-2026-04-21.md (the "what" — this is the "how")
supersedes-note: Revision 1 (commit 0b12436) was beat-writer-only scoped — rejected after Codex consult `af1875be5a79f4e3b` confirmed the user's pushback that the loop needs to span more than `buildBeatContext`.
---

# Autonomous Context-Exploration Loop — Design Sketch (Revision 2)

Design for **LLM-driven hyperparameter-search sub-loops** over the
harness's optimizable surfaces. Per the 2026-04-21 program direction:
context-richness is the primary prose-quality lever, the config
space is large, and hand-charting each configuration is the bottleneck.

User framing: "what I really want to do is an autonomous testing
loop to figure out the right amount of context to use. I want to use
Codex to run a persistent loop." Follow-up pushback: "seems like
it's very beat focused when there are tons of different parts of the
harness we could test and iterate on such as the planners and other
world and character building items."

Revision 1 (beat-writer-only) was rejected. Codex consult
`af1875be5a79f4e3b` confirmed: one flat loop spanning all surfaces is
incoherent because of layer coupling; the loop should be decomposed
into per-layer sub-loops with an explicit composition rule. The original Phase 0
proposal started at `planning-beats`, not `buildBeatContext`, because the planner
owned the structured state that feeds both drafting and checking.

**Updated 2026-05-01:** exp #289 split that planner surface. `planning-beats`
now owns beat shape only; `planning-state-mapper` owns `establishedFacts`,
`characterStateChanges`, `knowledgeChanges`, payoff links, and writer-visible
obligations. Any autonomous planning loop now needs either two sub-loops or a
composed planner loop that treats beat shape and state mapping as separate arms.

This doc is **not a charter** — it's a subsystem spec that will
generate charters for each sub-loop's Phase 0.

## Research question (unchanged from R1)

What harness configuration produces the best prose-quality scores on
the decomposed audit, at what token cost, on a fixed novel?

"Best" = Pareto-optimal on (adherence, halluc-ungrounded-clean,
voice-shape distance-to-reference, character-distinctness) with
token-cost as the budget axis.

## Why decomposed sub-loops, not one flat loop

The pipeline is coupled and non-stationary:

- `planning-beats` output shape determines the beat descriptions
  the writer consumes and the `establishedFacts` / `knowledgeChanges`
  the checkers compare against.
- `buildBeatContext` prompt shape determines what the writer sees
  at generation time.
- Checker thresholds determine what "pass" means on a given
  distribution of writer output.

Changing any upstream stage shifts the distribution the downstream
stage was calibrated on. A single history JSONL over all surfaces
mixes causes and effects and produces bad proposer decisions: a
planner change that improves beat descriptions might look like a
regression because the checker hasn't recalibrated. Codex-as-proposer
has to reason over mixed parameter spaces and mixed objectives —
known to degrade.

The fix is **four bounded sub-loops + one composition rule**, not
one broad loop.

## Layer decomposition

> **Stale surface note:** Sections below predate exp #289 and exp #272 in places. `planning-beats` is now beat-shape only; state/fact/knowledge/obligation placement belongs to `planning-state-mapper`. There is no live voice-LoRA compact route or Salvatore leak checker in runtime. Use this design as loop architecture, not as a current surface inventory; current surfaces live in `docs/archive/2026-04/harness-optimization-inventory.md` and `docs/current-state.md`.

**Current operating overlay (2026-05-02):** each sub-loop below maps to one primary lane at a time. Parallel support work is allowed for replay harnesses, tests, audits, operator summaries, and result docs, but unrelated runtime behavior changes must become separate lanes. Use DeepSeek V4 Flash concurrency for same-lane statistical power: repeated same-family runs, fixed panels, paired replay, or multi-seed confirmation with predeclared sample shape, family key, budget cap, and promotion gate. A tier winner cannot be promoted from a smoke that also changed a different tier's prompt, routing, schema, checker threshold, planner/context surface, or retry policy unless that bundle was declared as the lane before validation.

Four tiers, ordered upstream → downstream. Each tier's winner gates
on downstream replay before ship. Phase 0 starts at Sub-loop 1
(`planning-beats`); Sub-loop 0 (concept/world-building) is on the
map per user direction 2026-04-21 ("we can further decompose it to
world building sections upstream from planning") but is deferred
pending Sub-loop 1 convergence — concept changes are farthest from
audited per-beat failures and attribution is hardest there, so the
sub-loop that's closest to the oracle goes first.

### Sub-loop 0: Concept / world-building layer (upstream of planning)

**Scope (ordered by ROI within tier):**
- `world-builder` prompt (setting spine, magic/tech systems,
  cultures, geography; outputs `world_bible`).
- `character-agent` prompt (character profiles, relationships,
  drives/avoids/conflicts, `exampleLines`).
- `plotter` prompt (initial story arc before chapter-level
  planning).

**Knobs (Phase N; not Phase 0):**

| Knob | Range | Default |
|---|---|---|
| `world-builder` systems depth | names-only / brief-rules / full-rules-+-edges | brief-rules |
| `world-builder` culture count floor | 1 / 3 / 5 | existing default |
| `world-builder` geography granularity | region / region-+-sites / sites-+-routes | region |
| `character-agent` relationship-graph depth | dyad / triad / full-N | dyad |
| `character-agent` `exampleLines` count per character | 2 / 4 / 8 | 4 (per schema-of-record) |
| `character-agent` signature-phrasing extraction | off / passive / enforced | off |
| `plotter` arc-shape prior | free / hero-journey / genre-pack-locked | free |

**Measurement axes (primary):**
1. Downstream planning-beats quality — when concept output changes,
   does `planning-beats` produce higher-richness beats on all the
   Sub-loop 1 primary metrics? This is the **load-bearing measurement
   for this tier** because concept output is consumed by planning,
   not by prose directly.
2. Downstream writing quality — full decomposed audit after
   replaying frozen planner + frozen writer against the new concept
   output.
3. Concept-native richness signals:
   - World entity graph size (characters + places + systems + edges).
   - Character `exampleLines` distinctness spread (inter-character
     lexical divergence on the same seeded prompts).
   - Cross-reference density (does character X reference
     world-system Y? does place A constrain event B?).
4. Concept-phase token cost (input + output for all concept calls).

**Why deferred from Phase 0:** Codex consult `af1875be5a79f4e3b`
flagged concept-layer optimization as lower-yield early —
"concept changes are farther from the audited per-beat failures and
will be harder to attribute cleanly in Phase 0." Attribution goes
through two downstream layers (planner then writer), which means
more confounding paths. Open Sub-loop 0 only after Sub-loop 1 has
converged AND its winners are shipping a meaningful delta on
downstream prose, so that Sub-loop 0's attribution path is
well-conditioned.

**Phase 0 policy for Sub-loop 0:** the concept layer is **frozen at
current production prompts** while Sub-loops 1 and 2 run. This
isolates the upstream variable and prevents cross-tier confounds.

### Sub-loop 1: Planning layer

**Scope (ordered by ROI):**
- `planning-beats` prompt (per-chapter beat expansion; N parallel
  calls per novel; owns `establishedFacts`, `characterStateChanges`,
  `knowledgeChanges`).
- `planning-plotter` prompt (chapter skeletons).

**Knobs (Phase 0 = `planning-beats` only):**

| Knob | Range | Default |
|---|---|---|
| Beat-description richness tier | compact / standard / rich | standard |
| `establishedFacts` per-beat target | 0 / 1–2 / 3–5 | existing planner default |
| `knowledgeChanges` per-beat explicitness | implicit / named-character / named-+-reason | implicit |
| Payoff-link depth in beat.description | 0 / 1-hop / 2-hop | 1-hop (V1a shipped) |
| Beat-count floor multiplier | 0.8× / 1.0× / 1.2× of `ceil(targetWords/150)` | 1.0× |

**Measurement axes (primary):**
1. Beat-count-floor pass rate (existing `enforcePlanningOutput` gate).
2. Chapter-plan-checker pass rate (DeepSeek base, cross-beat
   coherence).
3. Downstream adherence pass rate after replaying beat-writer
   against the frozen-downstream prompts (see §composition).
4. Planner-native richness signals:
   - `establishedFacts` coverage: fraction of planned facts cited
     verbatim in generated prose (tokenizer-agnostic substring).
   - `knowledgeChanges` coverage: fraction of planned character
     knowledge shifts reflected in next-chapter beats.
   - Payoff-link realization rate (existing V1a metric).
5. Token cost per novel (input + output across the whole pipeline).

### Sub-loop 2: Writing layer

**Scope:** `buildBeatContext` — the 12 knobs from Revision 1's
original spec.

**Knobs:** (unchanged from R1)

| Knob | Range | Default (current production) |
|---|---|---|
| `compactMode` | bool | `true` on voice-LoRA route |
| `beatEntityListVariant` | `"v0"` / `"v1"` / `"v3"` | `"v1"` (exp #254) |
| `readerInfoStateEnabled` | bool | `false` |
| `readerInfoStateDepth` | 0 / `"chapter-scoped"` / `"novel-scoped"` | n/a |
| `worldExpansionBudget` | 0 / `"brief-entity-keyed"` / `"full-entities"` | 0 |
| `worldExpansionMaxBytes` | 0 / 1000 / 3000 / 8000 | 0 |
| `transitionBridgeSentences` | 0 / 1 / 3 / 5 | 3 |
| `landingTargetEnabled` | bool | `true` |
| `priorBeatEstablishedFacts` | bool | `false` (not threaded from `getFactsUpToChapter`) |
| `speakerDirectivesDepth` | `"compact"` / `"directives"` / `"directives+cadence"` | `"compact"` |
| `payoffLinksVisible` | bool | `true` (V1a shipped) |
| `toolsMode` | bool | `false` |

**Measurement axes:**
1. Adherence pass rate
2. Halluc-ungrounded fire rate
3. Halluc-leak fire rate
4. Voice-shape distance
5. Character distinctness pass rate (from the
   `character-distinctness-audit-v1` instrument when it lands)
6. Defect fire rate (`detectSyncDefects`)
7. Token cost per beat

### Sub-loop 3: Checker layer

**Scope:** checker prompts, rubrics, and thresholds for
`adherence-events`, `chapter-plan-checker`, `halluc-ungrounded`,
`halluc-leak-salvatore`.

**Critical rule:** the checker sub-loop optimizes **only against
frozen labeled data** (existing `eval_results` ground-truth sets + any
new Sonnet-labeled ground truth). It does NOT optimize against live
generation runs — that would couple checker tuning to writer drift
and destroy the calibration invariant.

**Measurement axes:** precision / recall / F1 against frozen ground
truth. Latency and cost as Pareto axes.

**Not in Phase 0.** Checker layer is currently strong per program
direction §3 ("No new checker work proposed right now."). Sub-loop 3
is design-only until a checker recalibration becomes urgent — most
likely triggered by a Sub-loop 1 or 2 winner shifting the distribution
enough that a checker's precision degrades.

## Cross-layer composition rule

**Winners do not compose by default.** Promoting a sub-loop winner
into production requires a downstream replay:

```
Phase A: sub-loop explores its own knob space against its own metrics
Phase B: candidate winner(s) identified
Phase C: freeze upstream-winner, replay frozen downstream prompts
         against the same 20-beat pool, re-score on the full
         decomposed audit
Phase D: accept only if downstream gates still clear (adherence
         within 5pt, halluc within 2pt, voice-shape within 1σ of
         pre-winner baseline)
```

Rejecting a sub-loop winner at Phase D is a valid outcome and
indicates a **contract failure between layers** — e.g., planner
richness that lives only in metadata fields the writer doesn't
consume, or writer-context that assumes a planner shape the planner
stopped producing.

This is "freeze upstream → replay downstream → accept/reject", NOT
"sum the best scores from each sub-loop."

## Loop shape per sub-loop

```
while (sub_loop_budget_remaining && !converged):
    history = read_sub_loop_history_jsonl()
    next_config = llm_propose(history, sub_loop_knobs, sub_loop_metrics)
    artifacts  = run_sub_loop_stage(next_config, frozen_pool)
    scores     = sub_loop_audit(artifacts)
    append(history, { config, scores, iteration_id })
    converged = check_convergence(history)
```

`llm_propose` is Codex `gpt-5.4 effort=high` via `codex exec`, but
scoped to one sub-loop's history and one sub-loop's knob-space at a
time. Codex is the right proposer for a **bounded** search space;
the R1 design that fed Codex a 12-knob flat history was the outer
bound of viable, and a cross-layer flat history would have been past
it.

## Schema for sub-loop history JSONL

```jsonc
{
  "iteration_id": "planning-beats-loop-v1-iter-003",
  "sub_loop": "planning-beats",
  "proposed_at": "2026-04-21T18:00:00Z",
  "proposer_reasoning": "<optional LLM-proposer quote>",
  "config": { /* sub-loop-specific knobs */ },
  "beats_scored": 20,
  "scores": { /* sub-loop-specific metrics */ },
  "downstream_replay": {
    "ran": true,
    "frozen_downstream_sha": "<commit>",
    "gate_status": "pass" | "fail",
    "gate_details": { /* adherence/halluc/voice deltas */ }
  },
  "notes": "optional human or proposer annotation"
}
```

## Phase 0 plan — `planning-beats` sub-loop only

Per Codex `af1875be5a79f4e3b` recommendation: start with
`planning-beats`, not `buildBeatContext` and not `world-builder`.
Rationale: `planning-beats` directly controls beat descriptions plus
planned state, both of which flow into drafting and checking. It is
the highest-ROI surface that is still close enough to the audited
per-beat defects to attribute cleanly.

**Phase 0 scope:**

1. Freeze `buildBeatContext` to current production shape (compact,
   V1a payoff-links, V1 entity list).
2. Freeze checkers to current production prompts + thresholds.
3. Pick a single 20-beat pool for measurement (reuse
   `novel-1776690840208` so instruments stay comparable).
4. **Carve out a held-out 10-beat replay set** from a different
   novel (NOT `novel-1776690840208`) for final-winner validation.
   Prevents pool-overfitting; flagged as risk below.
5. Hand-seed 3 starting `planning-beats` configurations:
   (a) current production, (b) richer-facts, (c) explicit-knowledge.
6. Manually drive 3–5 iterations with Codex-as-proposer reading a
   JSONL history of {config, scores, notes}. No automation yet.
7. **For every candidate winner, run Phase C downstream replay**
   (frozen writer + frozen checkers) and report the full decomposed
   audit.
8. Ship to production only if Phase D downstream gates clear AND the
   held-out 10-beat replay set also clears.

**Estimated Phase 0 cost:** ~$0.50 per iteration (planning-beats
call + writer replay + adherence + halluc on 20 beats). 5 iterations
= ~$2.50. Plus ~$0.30 final held-out validation. Total ~$3.

**Estimated Phase 0 effort:** ~1 day assuming `planning-beats`
prompt variants can be expressed declaratively (no schema changes).

## Named risks (from Codex consult)

1. **Pool overfitting.** The 20-beat pool is finite. A sub-loop
   winner can be a winner on the pool and a loser on novel prose.
   **Mitigation:** held-out 10-beat replay set on a different novel
   (Phase 0 step 4). No ship without held-out clearance.
2. **Checker drift.** A Sub-loop 1 or 2 winner can look worse on
   halluc/adherence because those checkers haven't recalibrated for
   the new writer input distribution, not because the winner is
   actually worse. **Mitigation:** before rejecting an upstream
   winner on a checker regression, sample 10 beats and spot-check
   checker calls for systematic drift.
3. **Contract failure between layers.** If the planner produces
   richness in a metadata field the writer doesn't consume, the
   upstream winner looks good on planner-native metrics but flat on
   downstream prose. **Mitigation:** Phase 0 step 7 is exactly the
   downstream replay that surfaces this.
4. **Cache-hit rate swings in token-cost comparisons.** DeepSeek
   cache hit rate varies iteration-to-iteration; raw `total_cost`
   can jitter ±20%. **Mitigation:** report token-cost-per-beat at
   both cache-hot and cache-cold steady state; alert if cache hit
   drops below 60%.
5. **Hypothesis: concept-agent optimization is lower-yield early.**
   Concept changes are farther from audited per-beat failures than
   planning-beats changes. Defer the concept sub-loop until planning
   sub-loop exhausts its gains.

## Budget + safety (unchanged from R1 shape)

- **Per-iteration hard cap:** $1.00 (raised for cross-layer replay).
- **Session hard cap:** $5.00 default; configurable via env.
- **Per-24h hard cap for unattended mode:** $20.00.
- **Kill switch:** `touch /tmp/context-loop-stop` mid-iteration.
- **Write discipline:** every iteration logs via `initExperimentRun`
  (post-`a67d200f4fe05168a` fix). Full telemetry reconstructable.

## What this is NOT

- A replacement for charters. Each decisively-winning configuration
  still gets a formal charter before shipping.
- A substitute for `character-distinctness-audit-v1` or the full-novel
  DeepSeek validation. Those are independent near-term steps.
- A theoretically-grounded Bayesian optimizer. LLM-in-the-loop is
  pragmatic; fall back to traditional search if convergence stalls.
- A single flat loop over the whole harness. Revision 1 proposed
  that and was rejected.

## Prerequisites before Phase 0

1. ✅ Decomposed-audit machinery (`voice-shape-metrics.ts` + audit
   subagent pattern) — shipped.
2. ✅ `llm_calls` persistence fix — shipped in `2f48217`.
3. ⬜ `character-distinctness-audit-v1` charter green (Revision 2
   landed 2026-04-21; pending calibration + audit run).
4. ⬜ `planning-beats` knob surface declaratively expressible.
   Current planner prompt is a template string; Phase 0 needs a
   small config-driven variant system.
5. ⬜ Held-out 10-beat replay set built from a second novel.
6. ⬜ `planning-beats-loop-iteration-history.jsonl` +
   `propose-next-planning-config.ts` driver script.

## Next step

Charter `docs/charters/planning-beats-autonomous-loop-phase-0.md`
when ready to start. This design doc is the blueprint it should cite.

**Not charter this session** unless the user explicitly asks — this
revision is a rescoping, and the user may want to react to the new
Phase 0 pivot (planning-beats instead of beat-writer) before
committing to a Phase 0 charter.
