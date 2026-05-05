# Agent Context

This repository is optimized for a small context pack. Load these first:

1. `docs/current-state.md`
2. `docs/decisions.md`
3. `docs/sessions/lane-queue.md`
4. `README.md` only when setup or command context is needed.

Do not load archived docs unless a current file links to a specific archive or
you need historical evidence for a decision.

## Documentation Discipline

- `docs/current-state.md` is live truth and should stay under 300 lines.
- `docs/decisions.md` is an index and should stay under 250 lines.
- Detailed decisions belong in `docs/decisions/LNNN-short-slug.md`.
- Historical snapshots belong in `docs/archive/` or `docs/sessions/archive/`.
- Run `bun run docs:weight` before closing docs-heavy work.

## Current Work

Current lane and runtime posture live in `docs/current-state.md` and
`docs/sessions/lane-queue.md`. Do not duplicate transient roadmap status here.
