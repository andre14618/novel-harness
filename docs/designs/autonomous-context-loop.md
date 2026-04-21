---
status: design (not yet implemented)
kind: subsystem-design
date: 2026-04-21
related: docs/program-direction-2026-04-21.md (the "what" — this is the "how")
---

# Autonomous Context-Exploration Loop — Design Sketch

Design for a **persistent LLM-driven hyperparameter-search loop** over
context-engineering configurations. Per the 2026-04-21 program
direction: context-richness is the primary prose-quality lever, the
config space is large, and hand-charting each configuration is the
bottleneck.

User framing: "what I really want to do is an autonomous testing loop
to figure out the right amount of context to use. I want to use Codex
to run a persistent loop."

This doc is **not a charter** — it's a subsystem spec that will
generate charters for each loop iteration's specific configuration.

## Research question

What context configuration (which levers, how much of each) produces
the best prose-quality scores on the decomposed audit, at what token
cost, on a fixed novel?

"Best" = Pareto-optimal on (adherence, halluc-ungrounded-clean, voice-shape
distance-to-reference, character-distinctness) with token-cost as the
budget axis.

## Parameter space (the knobs)

Each iteration proposes a value per knob. All knobs are in the
`buildBeatContext` path — runtime context assembly, not writer
fine-tuning.

| Knob | Range | Default (current production) |
|---|---|---|
| `compactMode` | bool | `true` on voice-LoRA route (unchanged post-pivot; DeepSeek may want false) |
| `beatEntityListVariant` | `"v0"` / `"v1"` / `"v3"` | `"v1"` (shipped, exp #254) |
| `readerInfoStateEnabled` | bool | `false` (not shipped; family-1 lever) |
| `readerInfoStateDepth` | 0 / `"chapter-scoped"` / `"novel-scoped"` | n/a |
| `worldExpansionBudget` | 0 / `"brief-entity-keyed"` / `"full-entities"` | 0 (compact-mode strips most) |
| `worldExpansionMaxBytes` | 0 / 1000 / 3000 / 8000 | 0 |
| `transitionBridgeSentences` | 0 / 1 / 3 / 5 | 3 |
| `landingTargetEnabled` | bool | `true` |
| `priorBeatEstablishedFacts` | bool | `false` (not threaded from `getFactsUpToChapter`) |
| `speakerDirectivesDepth` | `"compact"` / `"directives"` / `"directives+cadence"` | `"compact"` |
| `payoffLinksVisible` | bool | `true` (V1a shipped) |
| `toolsMode` | bool | `false` |

## Measurement axes (the score)

Each iteration's configuration is scored against a frozen 20-beat
pool (reuse `novel-1776690840208` beats from earlier charters). The
scorecard per arm:

1. **Adherence pass rate** — `runBeatChecks` output, per beat
2. **Halluc-ungrounded fire rate** — primary detector
3. **Halluc-leak fire rate** — regex-only (Salvatore) + adapter if
   Salvatore-route
4. **Voice-shape distance** — `voice-shape-metrics.ts` per-feature
   Euclidean-normalized distance to `voice-shape-reference.json`
5. **Character distinctness pass rate** — Sonnet quote-required audit
   (expensive; ~$0.003/beat)
6. **Defect fire rate** — `detectSyncDefects` (repetition, underlength)
7. **Token cost per beat** — input + output tokens actually used at
   generation time; the Pareto axis

Aggregate per iteration: one JSON record with all 7 axes. Written to
`eval_results` with `cell_label=<iteration-id>` + config snapshot.

## Loop shape

```
while (budget_remaining && !converged):
    history = read_iteration_history_jsonl()
    next_config = llm_propose(history, param_space, research_question)
    prose_per_beat = generate(next_config, 20_beat_pool)
    scores = decomposed_audit(prose_per_beat)
    append(history, { config: next_config, scores, iteration_id })
    converged = check_convergence(history)
```

**Components:**

- **`llm_propose`** — Codex (or Sonnet) receives the history JSONL +
  param-space spec + research question in a frozen prompt template.
  Returns a new config JSON. The reasoning model does the picking;
  we don't bake in a specific algorithm (Bayesian / bandit / grid).
  We trust the model to apply sensible Pareto reasoning given history.
- **`generate`** — executes `buildBeatContext(config)` per beat →
  writer call → stores prose in eval_results.
- **`decomposed_audit`** — existing decomposed-audit stack (the
  same one voice-shaping-ablation-v1 used). Scores all 7 axes.
- **`check_convergence`** — not-converged until either (a) N
  iterations without improvement on any Pareto axis, or (b) budget
  exhausted, or (c) human interrupt.

## Open design questions

1. **Proposer model choice.** User said Codex. Codex `gpt-5.4
   effort=high` via `codex exec` is sequential (composes fine for
   per-iteration calls). Alternative: Sonnet-via-Agent-subagent,
   which has cleaner concurrency but was specifically NOT what the
   user asked for. **Recommendation:** Codex per user preference;
   fall back to Sonnet if `codex exec` hangs on long-running loops.
2. **How much history to show the proposer.** Full JSONL (grows
   over iterations; may hit context limits at 50+ iterations) vs
   summarized (e.g., top-3 Pareto-optimal so far + last 5 iterations).
   **Recommendation:** start with full JSONL; switch to summarized
   if context pressure surfaces.
3. **Stop condition tuning.** "N iterations without improvement" is
   a soft convergence rule. Pareto improvement is multi-dimensional;
   "no improvement on ANY axis for 5 iterations" is probably too
   strict. **Recommendation:** stop on "no improvement on the
   dominant axis (adherence OR voice-shape) for 5 iterations AND
   budget > 50% used." Err toward running longer.
4. **Per-iteration audit cost.** Each iteration is 20 beats × 1 arm
   × (writer + adherence + halluc-ungrounded + halluc-leak +
   distinctness) ≈ $0.10–0.15 (distinctness is the dominant cost
   at $0.003 × 20 = $0.06). 50 iterations = ~$5–8. **Recommendation:**
   start with distinctness OFF for most iterations, on only for
   the top-K Pareto-optimal configurations.
5. **Cold-start seed configurations.** Ask proposer or hand-seed?
   **Recommendation:** hand-seed 3–5 known configurations (current
   production, all-levers-on, all-levers-off, plus 2 intermediate)
   then let the proposer explore from there.

## Schema for history JSONL

```jsonc
{
  "iteration_id": "loop-v1-iter-003",
  "proposed_at": "2026-04-21T18:00:00Z",
  "proposer_reasoning": "<optional brief quote from LLM proposer>",
  "config": {
    "compactMode": true,
    "readerInfoStateEnabled": true,
    "readerInfoStateDepth": "chapter-scoped",
    "worldExpansionBudget": "brief-entity-keyed",
    "worldExpansionMaxBytes": 3000,
    /* ... all knobs ... */
  },
  "beats_scored": 20,
  "scores": {
    "adherence_pass_rate": 0.85,
    "halluc_ungrounded_fire_rate": 0.15,
    "halluc_leak_fire_rate": 0.00,
    "voice_shape_distance": 1.42,
    "character_distinctness_pass_rate": 0.70,
    "defect_fire_rate": 0.05,
    "token_cost_per_beat": 0.00035
  },
  "notes": "optional human or proposer annotation"
}
```

## Implementation phases

**Phase 0 (POC, ~1 day):** one-iteration-at-a-time driver. Script
reads history, writes Codex prompt to a file, user runs
`codex exec < prompt > next-config.json` manually, script applies
next-config, runs generation + audit, appends to history. No
automation of Codex invocation. Validates the loop logic + scoring
end-to-end on 3–5 iterations.

**Phase 1 (automated driver, ~2 days):** Phase 0 script wraps the
Codex invocation into a shell loop. Budget cap + iteration cap
honored automatically. Human can interrupt between iterations but
doesn't need to run each one. 10–30 iterations in one sitting.

**Phase 2 (dashboard, ~3 days):** React page at `/app/context-loop`
shows iteration history, Pareto frontier, current-best config per
axis, proposer reasoning. Trigger a single iteration from the UI;
inspect proposer's config before accepting.

**Phase 3 (persistent loop, ~5 days):** runs unattended overnight
with guardrails (max spend per 24h, SIGTERM on budget exhaustion,
email/slack on convergence or anomaly). Produces a final report
auto-commited as `docs/retrospectives/context-loop-<date>-results.md`.

## Budget + safety

- **Per-iteration hard cap:** $0.15. Abort iteration on overrun.
- **Session hard cap:** $5.00 default; configurable via env.
- **Per-24h hard cap for unattended mode:** $20.00.
- **Kill switch:** `touch /tmp/context-loop-stop` mid-iteration.
- **Write discipline:** every iteration logs to DB via
  `initExperimentRun` (post-`a67d200f4fe05168a` fix). Full per-call
  telemetry reconstructable.
- **Cache hit rate monitoring:** alert if DeepSeek cache hit rate
  drops below 60% — suggests prompt-drift between iterations and
  blown token budget.

## What this is NOT

- A replacement for charters. Each decisively-winning configuration
  still gets a formal charter before being routed into production.
  The loop explores the space; charters validate + ship.
- A substitute for `character-distinctness-audit-v1` or the full-novel
  DeepSeek validation. Those are independent near-term steps from the
  program direction.
- A theoretically-grounded Bayesian optimizer. LLM-in-the-loop is
  pragmatic; if convergence is too slow, fall back to traditional
  hyperparameter search (grid / random / BoTorch).

## Prerequisites before Phase 0

1. ✅ Decomposed-audit machinery (`voice-shape-metrics.ts` + audit
   subagent pattern) — shipped.
2. ✅ `llm_calls` persistence fix — shipped in `2f48217`.
3. ⬜ `character-distinctness-audit-v1` charter green + Sonnet-subagent
   distinctness auditor isolated as a reusable module (not yet —
   audit stays embedded in voice-shaping ablation until its own
   charter ships).
4. ⬜ `buildBeatContext` knob surface widened — currently only has
   `compactMode`, `conditioning`, `genre`. Loop needs additional
   knobs (readerInfoState, worldExpansion, speakerDirectives). New
   types + branches.
5. ⬜ `iteration-history.jsonl` + `propose-next-config.ts` driver script.

Estimated Phase 0 delivery: ~1 day of focused work, assuming the
distinctness auditor can be extracted and the new context knobs can
be implemented in one pass.

## Next step

Charter `docs/charters/autonomous-context-loop-phase-0.md` when
ready to start. This design doc is the blueprint it should cite.
