---
status: active-session
updated: 2026-04-19
session_id: 82192dba-f3ef-4e79-9fbe-049ebbf4fe69
---

# Session handoff — novel-harness

**Purpose:** short living state doc. Overwritten at session close. Next session reads this FIRST before reconstructing from git/todo/sessions. If stale (`updated` > 48h old), treat as unreliable and fall back to `bun scripts/status.ts` (once that ships) + manual reconstruction.

## What's in flight RIGHT NOW

See `.claude/in-flight/active.json` for structured data. Human summary:

- **novel-1776626490042** — organic-run-verify validation (experiment #238).
  - Host: LXC 307, PID 215487, log `/tmp/organic-run-238.log`
  - Seed: fantasy-healer, 1 chapter, auto mode, no `DEBUG_FORCE_*` flags
  - Launched 2026-04-19 ~19:21 UTC, expected finish within 45 min
  - Pass gate: zero `chapter_exhaustions` rows + no `PipelineBailError` + zero active V2 rules
  - Script auto-concludes experiment #238 on finish with structured PASS/FAIL

## What's pending Codex review

- Nothing blocking. Round A (`ac5ae1215077a1bee` PASS @ 90%) and Round B (`a1f0d145132145414` CONDITIONAL PASS @ 84%, M1/M2 fixed in `c0704bd`, M3 deferred) both verified. Workflow-overhaul validation in `ad350aa657ec1c9b1`.

- **Pending next session:** Codex design review of the in-flight registry + session handoff scaffolding shipped in the same commit as this doc (see commit log). Design detailed below.

## Decisions unresolved / flagged for next session

- **M3 (Zod per-kind validation on `POST /api/debug/inject`)** — deferred. Env gate blocks prod adversaries; malformed test-script rules fail loudly. Worth a 20-min follow-up next session.
- **Codex preamble doc `docs/codex-preamble.md`** — not yet written. Should be ≤200 lines canonical repo state auto-prepended to every Codex review. Contents planned: pointers to `docs/current-state.md`, active experiments, recent architectural decisions (last 7 days), pattern watch-list, repo-specific failure classes. Next-session priority.
- **`scripts/status.ts`** — queries in-flight registry + DB experiments + LXC `pgrep` + orchestrator `/state`, prints a dashboard. Small (~60 lines). Next-session priority.
- **5 starting invariants** (per `docs/decisions.md` "Round A + Round B architecture" entry) — next-session #1. Must be blocking preflight gates, not debug-only (Codex Q6).

## Recent architectural decisions (last 48h)

Full entries in `docs/decisions.md`:
- **Non-blind-retry architecture shipped** (exp #237 charter, concluded). Plan-assist gate, chapter-plan-reviser, `chapter_exhaustions` telemetry.
- **V2 transport interceptor Phase 1** coexists with V1 env flags. Routes hard-404 when `DEBUG_ENABLE_INJECTION` unset.
- **`revisionUsed` persistence** to `chapter_outlines.revision_used` (sql/031) — reviser hard cap survives restart.
- **Workflow overhaul** — `.claude/skills/implement-ticket.md` + mandatory session telemetry. Invariants first (not speculative dispatch), invariants must be blocking.

## Session-start protocol (read before starting work)

1. Read this handoff doc first.
2. Check in-flight registry: `bun scripts/lib/in-flight.ts list`
3. Verify health of any listed in-flight runs:
   - LXC process alive? `ssh novel-harness-lxc 'pgrep -af <cmd>'`
   - Experiment row open? Query `tuning_experiments` for `conclusion IS NULL`
   - Log file still being written? `ssh novel-harness-lxc 'stat <log_path>'`
4. Read `docs/todo.md` priorities section.
5. Read `docs/current-state.md` if the last update is within this week; else read most recent session retrospective in `docs/sessions/`.
6. Only then start new work. Every new background launch MUST write an in-flight registry entry per `.claude/skills/implement-ticket.md` Phase 0.

## Session-close protocol (before session ends)

1. Ensure no in-flight runs are silently dropped — each must either:
   - (a) Have completed (registry entry removed OR auto-concluded experiment row)
   - (b) Be documented here with clear "next session please check on X"
2. Commit this doc + any experiment conclusions + session retrospective per `docs/sessions/TEMPLATE.md`.
3. Update `docs/todo.md` if priorities shifted.

## Commit chain this session

```
0c9b1ef  revisionUsed persistence (Round A)
f1f844f  R3/R4 race fixes
83ffce0  cleanup-orphans script
0c9fa3b  Codex Round A 3-HIGH-bug fixes
c3e0c08  todo.md Round A done
a1f4842  organic-run-verify + validation-check trace (Round B)
b25f01e  V2 transport interceptor Phase 1
7cdc0de  doc supersession pass (continuation)
ef4aa1b  preflight-caught retryErrors type fix
c0704bd  Codex Round B MEDIUM follow-ups
a0d396e  implement-ticket skill + session telemetry
7787a24  experiment tracking + Phase 0 mandatory
(this commit)  in-flight registry + session handoff scaffolding
```

## If you just landed here and don't know what's going on

1. The `novel-harness` repo is mid-session through a large workflow-scaffolding push.
2. A validation run is likely still executing on LXC — see in-flight registry above.
3. Architectural state is stable. No HIGH bugs open. Workflow overhaul landed; ops scaffolding (this doc + registry) is the last piece.
4. The SOP is: short check-back cadence (~120s) on background runs per user preference — see `feedback_short_checkback_cadence.md` in Claude memory.
