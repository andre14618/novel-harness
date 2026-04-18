---
status: active
updated: 2026-04-18
role: canonical-current-truth
---

# Current State

This is the canonical current-state document for the novel harness.

If another document disagrees with this one about the live architecture, active pipeline, or retired components, this file wins.

## How To Use This Doc

Read this file first when you need to understand the system as it exists today.

Use the rest of the doc set like this:

- `README.md`: onboarding and quick-start
- `docs/context-engineering.md`: detailed current context/planner strategy
- `docs/experiment-design-rules.md`: experiment methodology and evaluation rules
- `docs/decisions.md`: historical decision log and rationale
- `docs/lessons-learned.md`: accumulated empirical findings
- `docs/todo.md`: backlog, not source of truth

## Operating Model

The harness is explicitly **context-engineering-forward**.

The split is:

- Planner and beat context decide what to write.
- Writer model weights decide how to write it.
- Checkers stay narrow and only police failures that plans cannot prevent reliably.

This means:

- craft is treated as a model problem, not a prompt-rules problem
- planner expressiveness and context assembly are primary quality levers
- post-hoc craft checkers are not the main path to improving prose quality

Reference:

- `docs/decisions.md` — "Context-engineering-forward architecture"

## Active Pipeline

### Planning and generation

- Concept and planning remain on smart frontier-style models, not an all-14B stack.
- Writer routing is genre-aware.
- For fantasy seeds, the active default is the Salvatore voice LoRA route.
- For non-matching genres, the default writer path is DeepSeek.

Primary code references:

- `src/models/roles.ts`
- `src/agents/writer/`
- `docs/context-engineering.md`

### Active quality controls

The active narrow checkers are:

- adherence
- hallucination

Continuity remains part of the system, but the architectural direction is that checkers stay narrow and load-bearing rather than expanding into a large craft-checker zoo.

### Validation and retry shape

- Chapter-level rewriter is removed.
- Tonal pass is not auto-run.
- On-demand tonal pass remains available for comparison and archival workflows.
- Retry pressure should route through drafting / targeted issue handling, not chapter-wide rewrite passes.

Primary code references:

- `src/phases/validation.ts`
- `src/config/pipeline.ts`
- `src/orchestrator/novel-routes.ts`

## Retired Or Rejected Methodologies

These are not current strategy, even if older docs discuss them at length.

- Universal Howard-primer-style methodology as a default writing strategy: retired
- Craft encoded as large prompt-rule bundles: rejected
- Chapter-level rewriter as a core quality mechanism: removed
- Auto tonal-pass as part of the normal production pipeline: off

If a historical doc describes one of the above as current, treat that as historical context rather than live guidance.

## Current Improvement Philosophy

Systematic improvement should prefer these levers in order:

1. Planner output quality and expressiveness
2. Beat-context delivery and constraint clarity
3. Narrow checker calibration on real failure modes
4. Writer model / LoRA upgrades

Improvement should not default to:

- adding new craft checkers
- encoding style theory into long system prompts
- multiplying post-hoc quality passes

## Canonical Verification Gates

When the runtime, orchestration, or type surfaces change, these are the core checks:

```bash
./ui/node_modules/.bin/tsc -p tsconfig.json --noEmit
./ui/node_modules/.bin/tsc -p ui/tsconfig.json --noEmit
bun build --target bun src/index.ts --outfile /tmp/index.js
bun build --target bun src/orchestrator/server.ts --outfile /tmp/orchestrator.js
bun test
```

If a change affects model cost accounting, also verify representative `getTokenCost()` calls stay finite.

If a change affects eventing or orchestration, verify the backend event contract and process supervision path explicitly.

## Documentation Contract

To keep the repo from drifting:

### Canonical source rule

For live architecture and runtime behavior, this file is the canonical source of truth.

### Same-commit update rule

If a commit changes current runtime behavior, architecture, or active methodology, it must do one of the following:

- update `docs/current-state.md` in the same commit, or
- include `docs-impact: none` in the commit body

`docs-impact: none` means the author explicitly checked and concluded that the change does not alter the current-state contract.

### Document roles

Use these categories consistently:

- **Current truth**: `docs/current-state.md`
- **Onboarding**: `README.md`
- **Method/rules**: `docs/experiment-design-rules.md`
- **Historical notebook**: `docs/decisions.md`, `docs/lessons-learned.md`, experiment reports
- **Backlog/drafts**: `docs/todo.md`, charters, in-flight planning docs

Do not treat historical notebook docs as canonical current-state references.

## Update Checklist

When changing the live system, check these questions:

- Did the active writer route change?
- Did the active checker set change?
- Did a component move from active to retired, or vice versa?
- Did the retry/validation path change?
- Did the canonical verification gates change?
- Did the methodology change at the architecture level, not just as an experiment?

If yes, update this file.

## Current Known Gaps

These are known cleanup items, not contradictions in the operating model:

- Root TypeScript still has a bounded set of implicit-`any` row-mapping errors.
- Historical docs still contain valid context mixed with stale current-tense statements.
- The repo still needs discipline around classifying docs as current-truth vs historical notes.

Those are documentation/process debt items, not a reason to fork the methodology again.
