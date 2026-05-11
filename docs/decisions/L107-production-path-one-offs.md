---
status: active
date: 2026-05-11
role: decision-record
amends:
  - L101
  - L106
---

# L107: Production-Path One-Offs Over POC-to-Main Loops

## Decision

Do not use a POC-to-main loop when the hypothesis can be tested through the
production planning, drafting, diagnostics, semantic replay, readiness, compare,
or cohort path.

The default implementation target is production code on `main`, with behavior
kept behind an existing/default-off control when promotion is not yet justified.
One-off work is acceptable only when it reuses the same production modules,
commands, schemas, trace IDs, and artifact formats the main path uses.

## One-Off Contract

A one-off may be added when it is a thin orchestration wrapper around production
code and writes production-compatible evidence, such as:

- `drafting-isolated-report.json`;
- `planning-drafting-context-report.json`;
- `scene-semantic-review.json`;
- Plan Readiness aggregate JSON/Markdown;
- `drafting-run-compare` or `drafting-run-cohort` artifacts.

It must not carry independent planner/writer/checker prompt logic, private
schema shapes, or a separate promotion path. If the one-off discovers useful
behavior, the reusable code should already live in the production module; only
the orchestration wrapper should be disposable.

## POC Boundary

Standalone POC runners under `poc/` or clone-producing disposable eval scripts
require explicit user approval and explicit `--allow-disposable-*` flags. They
are for questions that cannot yet be safely represented as a production arm,
diagnostic, fixture replay, or thin wrapper.

Historical POC outputs remain evidence and fixtures. They should not be
extended as active workflows when the same question can run through production
commands.

## Implications

- Add a default-off production arm before adding a parallel POC arm.
- Add production telemetry before writing a private POC manifest.
- Add production compare/cohort support before running repeated bespoke
  analyses.
- Promote, absorb, or archive old POC lessons; do not keep revalidating them in
  a second main-path pass.
- If a one-off cannot name the production module/artifact it reuses, it is a
  POC and needs explicit approval.
