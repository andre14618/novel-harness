---
status: active
date: 2026-05-06
---

# L85: Mainline-First Workflow

## Decision

Novel Harness development now defaults to direct work on `main`.

Agents should not create lane, feature, or captain branches unless the user
explicitly asks for one or the work is a disposable experiment that may be
thrown away. For risky merges, rewrites, or migrations, create a rollback tag
before the move instead of using a long-lived branch as the safety mechanism.

## Rationale

The repository is a fast-moving local harness with atomic commits, local
verification gates, and one canonical active truth. Long-lived branches created
drift: unpushed commit piles, stale experiment tips, duplicated status, and
uncertainty about which work was real. After `synthesis-bundle-v1` was
fast-forwarded to `main`, branch isolation no longer added value for normal
lane work.

## Operating Rules

- Start implementation on `main`.
- Commit coherent slices atomically.
- Keep `main` green with focused tests, typecheck, docs weight, and Playwright
  evidence for UI slices.
- Use rollback tags before large or risky moves.
- Use short-lived branches only for explicit user requests, disposable
  experiments, or parallel work that cannot safely share the same worktree.
- Historical docs may mention old branch names as evidence; they are not active
  workflow policy.

## Evidence

On 2026-05-06, `synthesis-bundle-v1` was pushed, safety-tagged, verified, and
fast-forwarded into `main`.

- `origin/main`: `cb820bd7724ba3e7dd0efa148bac2a9c0016b163`
- rollback tag: `main-pre-synthesis-merge-2026-05-06`
- rollback target: `a385df19b28b9295faef5aa2e103aac9cdef4360`
- former feature branch: `origin/synthesis-bundle-v1` at `cb820bd`

Verification before the push: `bun run test:fast`, `./node_modules/.bin/tsc
--noEmit`, and `bun run docs:weight`.
