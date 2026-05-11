# Agent Context

This repository is optimized for a small context pack. Load these first:

1. `docs/current-state.md`
2. `docs/decisions.md`
3. `docs/sessions/lane-queue.md`
4. `README.md` only when setup or command context is needed.

Do not load archived docs unless a current file links to a specific archive or
you need historical evidence for a decision.

## Documentation Discipline

- `docs/current-state.md` is live truth and should stay near 150 lines, with a
  hard docs-weight limit of 180 lines.
- `docs/decisions.md` is an index and should stay under 250 lines.
- `docs/reference/` holds active details that are too large for the context
  pack. Load a reference doc only when the task touches that surface.
- Detailed decisions belong in `docs/decisions/LNNN-short-slug.md`.
- Historical snapshots belong in `docs/archive/` or `docs/sessions/archive/`.
- Run `bun run docs:weight` before closing docs-heavy work. Treat it as a
  context-budget guard, not a reason to delete useful active detail.

## Git Workflow

- Work directly on `main` by default. Do not create lane or feature branches
  unless the user explicitly asks.
- Before risky merges, rewrites, or migrations, create a rollback tag instead
  of long-lived branches.
- Commit coherent slices atomically on `main`; keep the worktree clean before
  handing off or starting a new lane.

## Change Intent

Before non-trivial implementation, surface the change packet: phase/surface,
exact change, expected benefit/outcome, downstream projection across affected
IDs/contracts, and the evidence gate. If the phase or benefit is unclear, keep
the work diagnostic/docs-only or stop for user judgment.

## Development Modes

- Production lane is the default: preserve runtime defaults and run the relevant
  production verification gates.
- Production-path one-offs are allowed when they reuse production modules,
  commands, artifact schemas, and comparison/cohort reports. Prefer a
  default-off production arm, diagnostic, or thin wrapper over a separate POC
  runner.
- POC lane is allowed only when the user explicitly asks for a proof of concept
  or disposable experiment. Preserve traceability IDs, require explicit
  disposable flags for output-producing runs, and do not change production
  defaults. See L107.
- When L101/aggressive evidence loops are active, keep moving through the next
  independent goal after each artifact or commit. Use parallel agents where
  write scopes are separable, gather run statistics, and use semantic
  diagnostics as decision aids rather than blockers.

## Current Work

Current lane and runtime posture live in `docs/current-state.md` and
`docs/sessions/lane-queue.md`. Do not duplicate transient roadmap status here.

## Test And UI Gates

Test and invariant work follows `docs/test-invariant-agent.md`. UI-facing work
requires Playwright MCP evidence per `docs/ui-work-gate.md`.
