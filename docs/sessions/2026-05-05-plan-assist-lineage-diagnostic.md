---
status: active
updated: 2026-05-05
role: lane-doc
---

# Plan-Assist Lineage Diagnostic — 2026-05-05

## Loop Contract

- **Objective:** Add a read-only `diagnostics:plan-assist-lineage` CLI report over `planning_mutation_lineage` rows where `source_table IN ('chapter_exhaustions','chapter_revisions')`, joined with the source telemetry tables. No runtime behavior change.
- **Starting commit:** `d1de2d9`
- **Experiment ID:** 475
- **Budget cap:** $0 (no LLM calls; local DB read only)
- **Primary lane:** Authoring visibility/interactivity foundation — diagnostic-only support work.
- **Causal hypothesis:** Operators currently can't inspect plan-assist + reviser lineage without ad-hoc SQL. A small CLI mirroring the pattern of `diagnostics:plan-drift` and `diagnostics:checker-warnings` (commits `35f7bbb`, `326692e`) makes the persisted lineage usable as evidence before any envelope-wrap decision on the deferred higher-risk slices.
- **Baseline:** No CLI for plan-assist or reviser lineage; only `chapter-traceability.ts` consumes the rows, and only via the Trace UI per chapter.
- **Changed runtime lever:** None. Pure read-only diagnostic.
- **Feedback signal:** Unit tests on synthetic rows pass; CLI prints a non-empty report against any novel that has plan-assist or reviser lineage rows.
- **Stop gate:** (a) Clean pass — see below.
- **Escalation rule:** N/A (no runtime change).
- **Allowed parallel support work:** Doc sweep on close.
- **Files expected to change:** `scripts/analysis/plan-assist-lineage-report.ts` (new), `scripts/analysis/plan-assist-lineage-report.test.ts` (new), `package.json` (add `diagnostics:plan-assist-lineage` script), `docs/sessions/lane-queue.md`, `docs/current-state.md` or `docs-impact: none`, `docs/todo.md`.
- **Evidence artifact:** Test output + a sample report run against the smoke-fixture novel (or a synthetic seed if no plan-assist rows exist locally).

## Stop Gates

- **(a) Clean pass:** New unit test green; existing `bun test scripts/analysis/` green; `bunx tsc --noEmit` clean on touched files; `bun run docs:weight` clean.
- **(b) New dominant blocker:** Lineage rows malformed → flag separately, do not in-scope a fix.
- **(c) Regression:** TS check or other diagnostic tests break.
- **(d) Infrastructure failure:** N/A (read-only).
- **(e) Cost cap:** N/A.

## Command Plan

- Sample shape: 1 (CLI run against any novel with plan-assist lineage rows).
- Expected cost: $0.
- Verification:
  - `bun test scripts/analysis/plan-assist-lineage-report.test.ts`
  - `bunx tsc --noEmit` (warm run)
  - `bun run diagnostics:plan-assist-lineage -- --novel <novelId>` (manual smoke if a local novel exists)

## Results

- Outcome: shipped. Read-only diagnostic CLI plus unit tests landed.
- Stop gate fired: (a) clean pass — `bun test scripts/analysis/plan-assist-lineage-report.test.ts` 3/3 green, `bunx tsc --noEmit` clean.
- Evidence: smoke run against `test-novel` returned 7 events (4 plan-assist overrides, 3 reviser-accepted) with per-chapter beat-id added/removed/retained sets and override-value transitions rendered correctly.
- Cost: $0 (no LLM calls; local DB read only).
- Commits: pending — landed in this session.
- Review: self-review against the established `plan-drift-report` / `checker-warning-report` pattern; no behavior change so no Codex pass requested.
