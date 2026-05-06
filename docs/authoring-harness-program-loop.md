---
status: active
updated: 2026-05-06
role: program-loop-contract
---

# Authoring Harness Program Loop

This is the durable control shape for continuing Novel Harness infrastructure
work across Codex, Claude, Playwright, and future agent sessions. It is broader
than a single overnight lane: the goal is to keep moving the authoring harness
toward better novel planning, operator interactivity, traceability, and
plan-faithful drafting without prematurely wiring creative heuristics.

## Direction

Improve the harness in this order:

1. Visibility: make failures, lineage, stale impact, and plan-to-prose evidence
   inspectable by humans and agents.
2. Interactivity: route operator and agent adjustments through durable proposal
   envelopes, stale preconditions, diffs, and mutation lineage.
3. Context engineering: improve what the planner, writer, and checkers see,
   but only after diagnostics show the target failure class.
4. Runtime levers: promote planner/writer/checker changes only through
   diagnostic-only, replay, fixture, or A/B evidence.
5. Polish: character voice, motivation, world detail, promise/payoff, scene
   turns, and prose richness follow once the deterministic flow is observable.

## Workstreams

- Evidence and diagnostics:
  `diagnostics:semantic-gate`, `diagnostics:writer-expansion`,
  `diagnostics:plan-drift`, `diagnostics:checker-warnings`,
  `diagnostics:plan-assist-lineage`, `diagnostics:semantic-gate-matrix`,
  `diagnostics:semantic-gate-cohort-matrix`, replay, and live A/B summaries.
- Proposal and interactivity infrastructure:
  Planning Studio, proposal diffs, stale impact preview, structural edits,
  artifact preview edits, and mutation lineage.
- Test architecture:
  keep fast pure tests fast; keep DB/e2e tests bounded and explicit; promote
  recurring bugs into invariants or focused regression tests.
- UI clearance:
  every UI-facing slice gets Playwright MCP evidence before handoff, with
  evidence under `output/playwright/<date>/<surface>-<novel>/`.
- Documentation:
  every coherent commit cluster gets a durable record of what happened, why it
  happened, evidence, and next implications.

## Trigger Rules

- Work directly on `main` by default. Branches are for explicit user requests
  or disposable experiments only; rollback tags are the safety mechanism for
  risky mainline moves.
- After any code commit cluster, update a durable doc when the change affects
  current architecture, active lane state, decisions, lessons, or next work.
- Before changing planner, writer, or checker runtime behavior, produce
  diagnostic or A/B evidence for the exact failure class.
- If the same failure fingerprint appears twice, improve the harness with a
  test, invariant, diagnostic, or replay seam before another prompt tweak.
- If a UI surface changes, run Playwright MCP or mark browser evidence as
  explicitly pending.
- If a live A/B returns `hold`, document the dominant blocker before changing
  defaults.
- If docs are shortened for line limits, first move rationale/evidence into a
  durable decision, lesson, session record, or feature document.

## Change Intent Contract

Before non-trivial implementation, the agent must state the change packet:

- Phase/surface: which creation phase, UI, checker, telemetry, or test surface
  is being changed.
- Exact change: the concrete behavior, files/modules, data shape, or workflow
  being altered.
- Expected benefit/outcome: what improves and how it should be visible.
- Downstream projection: which planner, writer, checker, proposal, UI, ID,
  lineage, or evaluation contracts should change as a consequence.
- Evidence gate: the targeted test, replay, diagnostic, A/B run, or Playwright
  pass that will prove or disprove the benefit.
- Non-goals/risks: what is deliberately not being changed, especially when a
  downstream patch is only evidence for an upstream design question.

If the expected benefit is speculative, keep the work diagnostic-only or A/B
gated. If the phase is ambiguous, clarify the layer before editing.

## Loop Shape

The default Codex loop is not the retired headless lane runner. It is:

1. Read the context pack and this program loop.
2. Confirm the repo is on `main`, then inspect worktree and active docs.
3. Pick the highest-value ready slice from `docs/sessions/lane-queue.md` and
   `docs/todo.md`.
4. Write the change packet so the phase, benefit, downstream projection, and
   evidence gate are explicit.
5. Baseline with the narrowest meaningful signal.
6. Implement one coherent slice.
7. Verify with focused tests plus cheap static checks; broaden only when risk
   warrants it.
8. Commit atomically.
9. Update durable docs and commit the docs/cleanup slice when the result changes
   active state, decisions, or lessons.
10. Continue to the next ready slice until a stop condition or human decision is
   reached.

## Concurrency

Codex can continue locally without forcing subagents. Use subagents or Claude
only when parallel work has a concrete, disjoint output:

- Claude/Playwright: browser preflight, screenshots, console/network evidence.
- Claude or subagent: focused code review, docs sweep, or isolated test run.
- Codex: integration, architecture choices, commits, docs finalization, and
  avoiding cross-slice conflicts.

Do not create multiple agents changing the same runtime lever. Do not treat
Claude's overnight captain loop as the only valid control plane for Codex.
Parallel work that needs branch isolation must be explicitly named disposable
experiment work; otherwise integrate via atomic commits on `main`.

## Stop Conditions

Stop and ask for user judgment when:

- the next step would promote a creative heuristic without evidence;
- two attempts hit the same unresolved failure fingerprint;
- cost or runtime exceeds the stated budget for the slice;
- UI evidence requires browser access that is unavailable;
- the next slice is a product decision rather than an implementation decision.

## Default Verification

For non-UI code:

```bash
bun test <focused files>
./node_modules/.bin/tsc --noEmit
git diff --check
```

For docs-heavy slices:

```bash
bun run docs:weight
git diff --check
```

For broader safety after multiple code commits:

```bash
bun run test:fast
```

For UI slices:

```bash
bun run ui:preflight -- --surface <surface> --novel <id> --url <path>
```

Then use Playwright MCP for the actual browser evidence.
