---
status: superseded
date: 2026-05-10
role: decision-record
superseded_by: L106
---

# L100: POC Acceleration Lane

Superseded 2026-05-10 by L106. Keep this record as historical guidance for
explicit disposable experiments only; the active lane posture is now production
path integration.

## Decision

Novel Harness now has two explicit engineering modes:

- **Production lane:** default for runtime behavior, persisted schemas, operator
  workflows, UI, proposal flows, checker routing, and production defaults.
- **POC lane:** an explicitly marked fast lane for proving whether a harness
  idea produces reviewable authoring value before hardening it.

When `docs/sessions/lane-queue.md` marks the active work as POC, agents should
optimize for vertical, reviewable artifacts over generalized substrate. This is
the user-approved way to trade tokens and local compute for faster evidence.

## POC Lane Contract

POC code may live under `poc/` and may use local JSON artifacts, static HTML,
simple runners, disposable DB rows, and output directories such as
`poc/<name>/output/<runId>/`. POC code does not need to meet the full production
integration bar before it can be useful.

POC work must still preserve:

- `runId` / `novelId` / chapter refs where available.
- `sceneId`, `obligationId`, `sourceId`, `characterId`, `threadId`,
  `promiseId`, and `payoffId` metadata where available.
- Reproducible inputs, commands, and output paths.
- Enough trace artifacts to debug why the generated story did or did not work.

POC work must not:

- Change production defaults without a separate production decision.
- Remove traceability IDs from state, DB, telemetry, checker findings,
  proposal targets, eval artifacts, or audit logs.
- Expand autonomy, Canon approval, or proposal-policy behavior.
- Add external CI.
- Treat a diagnostic judge/checker as a production blocker.

## What POC May Skip

When the active lane is POC, agents may skip or defer these unless they are the
object being tested:

- Proposal envelopes and ApprovalPolicy flows.
- Playwright/browser evidence for non-UI artifacts.
- Plan-Assist gates and blocking checker settle loops.
- Full UI integration.
- Full DB completeness for every intermediate artifact.
- Generalized schema migrations.
- Broad `test:db:full` or full replay sweeps after every small change.

For POC writer/planner experiments, prefer **checker-deferred** shape: generate
the artifact first, then run diagnostics post-hoc. Continuity, hallucination,
functional-state, and semantic judges should not prevent draft capture unless
the experiment explicitly tests blocker behavior.

## POC Verification

POC slices should verify the smallest behavior that changed:

- Targeted unit tests for new parsers/runners/renderers.
- `./node_modules/.bin/tsc --noEmit` when TypeScript surfaces changed.
- `git diff --check`.
- `bun run docs:weight` for docs-heavy work.
- One live disposable artifact when the POC is about generation quality.

Full `test:fast`, replay parity, Playwright, DB-full, and production promotion
guards remain production-lane gates. They are not required after every POC
slice unless the slice touches production code in a way that needs them.

## Documentation Posture

POC documentation should be lighter than production documentation:

- Keep `AGENTS.md`, `docs/current-state.md`, and `docs/decisions.md` tight.
- Use `docs/sessions/lane-queue.md` for active/next operational detail.
- Use the POC `README.md` and session records for commands, outputs, and
  lessons learned.
- Do not create archive snapshots just to satisfy a low line limit during an
  active POC loop.

`bun run docs:weight` remains a context-budget guard, not a content-deletion
mandate. If the active queue is carrying useful live handoff detail, prefer
raising or tuning the guard over forcing premature archival.

## Parallel Development Posture

When the user asks to accelerate, agents may take larger vertical packets and
parallelize work by file ownership:

- One agent can build a runner while another writes fixture docs.
- One agent can build static review output while another builds diagnostics.
- One agent can analyze generated artifacts while another fixes local runner
  bugs.

Avoid parallel edits to the same files. Commit coherent slices atomically on
`main`. If a slice is blocked, document the exact blocker and move to the next
independent POC task rather than stalling the whole lane.

## Default Loop For Coding Harnesses

When a POC lane is active:

1. Pick the next highest-value vertical slice from `lane-queue`.
2. Implement the smallest runnable artifact.
3. Run targeted verification.
4. If green, commit.
5. If blocked, record the blocker and continue with the next independent slice.
6. Stop only on production-default risk, traceability loss, destructive changes,
   or an operator decision.

## Promotion Back To Production

POC success is not production promotion. To harden a POC result, create a
production change packet that names:

- The exact production phase/surface being changed.
- What POC evidence supports the promotion.
- What will be frozen or removed to avoid substrate sprawl.
- The production verification gate.
- The rollback path.

## Immediate Application

The current scene-first novella work should use this lane. The intended POC
shape is a vertical runner that produces a 3-chapter reviewable artifact with
scene contracts, prose, trace metadata, post-hoc diagnostics, and static HTML.
Production scene-first default flips remain separate production-lane work.

## Non-Goals

- This does not lower the production bar.
- This does not authorize default flips without evidence.
- This does not make proposal/UI/checker infrastructure obsolete.
- This does not remove existing production tests.
