# Autonomous Harness Loop — Branch Scaffolding

**Branch:** `autonomous-harness-loop`
**Status:** scaffolding only — NO iterations have run on this branch.
**Design:** `docs/designs/autonomous-context-loop.md` (revision 2)
**Inventory:** `docs/archive/2026-04/harness-optimization-inventory.md` (revision 2,
Codex-amended)
**Program direction:** `docs/program-direction-2026-04-21.md`

This branch is the working surface where Codex (`gpt-5.4 effort=high`,
via `codex exec`) proposes knob changes and DeepSeek V3.2 produces the
prose that gets audited. Each iteration is one row in a history JSONL,
and the auditor is the decomposed-audit stack (adherence +
halluc-ungrounded + halluc-leak + voice-shape + distinctness + defects
+ token cost).

## Phase 0 target

`planning-beats` sub-loop ONLY. Writer context, checker prompts, and
concept layer are FROZEN at their production-default shapes during
Phase 0. See `docs/designs/autonomous-context-loop.md` §Phase-0.

## Prerequisites before first iteration

Tracked in `docs/archive/2026-04/harness-optimization-inventory.md` "Remaining Phase 0
gating work":

1. **Migrate env-vars to per-novel DB config.**
   `STYLE_PRIMER`, `WRITER_MODEL_OVERRIDE`, `WRITER_PROVIDER_OVERRIDE`,
   `WRITER_CONDITIONING` must move from module-load env reads into
   `seed.pipelineOverrides.*`. Without this, the loop can't isolate
   per-iteration interventions.
2. **Calibration-substrate drift detector.**
   Replay harness over frozen `eval_results` sets. Opens Sub-loop 3
   when any checker drops >5pt precision or >3pt F1.
3. **5-chapter planner-only A/B cheapest-counterfactual.**
   Current vs loud-variant (richer beats, `establishedFacts` target
   3-5, `knowledgeChanges` named+reason, 1.2× beat-count floor). This
   is the **GO/NO-GO gate** for Phase 0. If loud variant doesn't move
   planner-native metrics beyond noise, the loop's knob space is
   broken.
4. **Held-out 10-beat replay set.**
   On a second novel (NOT `novel-1776690840208`). Required before
   shipping any sub-loop winner.

These four items ship as tickets before `bun driver.ts` ever runs.

## Contract (what the loop promises)

Each iteration:

1. Reads `history/planning-beats-loop.jsonl` (full history up to now).
2. Calls Codex with the history + Phase 0 knob subset + the research
   question from the design doc. Codex returns one JSON config.
3. Applies the config to a forked `planning-beats` prompt variant
   (the loop NEVER edits `src/agents/planning-beats/*` directly —
   it writes to a per-iteration variant file in
   `scripts/autonomous-loop/variants/`).
4. Generates planner output for the frozen 20-beat novel pool using
   the variant.
5. Runs the decomposed audit + downstream replay (frozen writer +
   frozen checkers from §Phase-0 of the design).
6. Appends one record to the history JSONL.
7. Checks convergence and safety caps. Exits or loops.

## Directory layout

```
scripts/autonomous-loop/
├── README.md                             ← this file
├── driver.ts                             ← skeleton; not executable yet
├── propose-next-planning-config.ts       ← skeleton; Codex-exec wrapper
├── score-iteration.ts                    ← skeleton; decomposed audit + replay
├── kill-switch.ts                        ← shared /tmp flag check
├── variants/                             ← per-iteration prompt variants
│   └── .gitkeep
└── history/
    ├── planning-beats-loop.jsonl         ← append-only iteration log
    └── .schema.md                        ← JSONL record schema
```

## Safety caps (from the design doc)

- Per-iteration cost: $1.00 hard
- Session cost: $5.00 default, env-configurable
- Unattended 24h: $20.00
- Kill switch: `touch /tmp/context-loop-stop` — checked between every
  stage of every iteration (see `kill-switch.ts`)
- Write discipline: every iteration writes to DB via
  `initExperimentRun` (llm_calls persistence fix `2f48217`)

## Not yet decided (punt to first iteration planning session)

- Whether the Phase 0 knob subset is 5 knobs or 8 (see inventory §1.2
  — 8 marked Y after Codex demotion). Start with the smallest
  declaratively-expressible subset.
- Whether iteration 0 starts from the 3 hand-seeded configs named in
  the design doc (current / richer-facts / explicit-knowledge) or lets
  Codex propose from a blank history.
- Whether the writer-replay uses the same 20-beat novel as
  `voice-shaping-ablation-v1` or a fresh one built for planner
  measurement (tradeoff: comparable to prior evidence vs. untainted
  from prior attribution).

## Handoff to next session

Working on this branch next session should:

1. Read this README, the design doc, and the inventory.
2. Decide the three "not yet decided" items above with the user.
3. Ship the four prerequisite tickets (env→DB migration, drift
   detector, cheapest-counterfactual A/B, held-out replay set).
4. Only THEN replace the skeletons in this directory with working
   code and run the first iteration.

Do NOT run any iteration from this scaffolding as-is. The skeletons
throw on invocation for exactly this reason.
