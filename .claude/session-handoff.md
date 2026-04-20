---
status: session-closed
updated: 2026-04-19
session_closed_at: 2026-04-19T23:45:00Z
---

# Session handoff — novel-harness

## What's in flight RIGHT NOW

**Nothing.** `bun scripts/lib/in-flight.ts list` → no runs.

## What's pending Codex review

**Nothing open.** Final session thread `aff17da16c4bf5a25` returned
RESOLVED + no new issues on `8cc3d2c`. Exp #244 + #246 concluded PASS.
Exp #245 concluded SUBSUMED.

## Start-here priorities for next session

1. **Measure the ratio (ongoing).** Across 2 sessions now:
   `bugs_caught_by_preflight = 0`, `bugs_caught_by_codex = 4+` this session.
   Invariants are currently preventing REGRESSIONS, not catching new bugs.
   The ratio tips when a preflight-caught regression lands. 3 more sessions
   remain in the exp #243 window — watch for it.

2. **Loop-statement reachability (low priority).** The T1 detector
   currently treats ALL loops as non-terminal (conservative false). Open a
   ticket if a HEAD site ever legitimately hits this — none today.

3. **Receiver aliasing (low priority).** `const body = res; await
   body.text(); await res.json()` — same Response, different identifiers.
   The detector misses this because it groups by declaration-node identity.
   Same deferral: open a ticket only when a real HEAD site surfaces.

## Deferred / flagged

- Pattern elevation candidate: `docs/patterns/bun-test-module-mock-hygiene.md` — seen 2 sessions now (exp #243 surfaced, exp #246 fixed). One more recurrence would trigger elevation.
- Pattern elevation candidate: `docs/patterns/ast-over-text-for-syntactic-invariants.md` — 3 recurrences now (T1 invariant #5 regex → AST + the invariant #2 text-substring → AST from exp #243). Strong elevation signal. If the next syntactic invariant starts with regex, elevate preemptively.

## Recent architectural decisions (last 48h)

Full entries in `docs/decisions.md`:
- **Invariants registry shipped** (exp #242).
- **5 starting invariants shipped** (exp #243).
- **Invariant #5 widened to AST-based detection** (exp #244) — retired 4 allowlist entries, 2 new fixtures, control-flow reachability with switch/try/if + throw/return-only `exitsFunction` for scope-local distinction.
- **bun:test cross-file mock hygiene** (exp #246) — full-shape mocks mandatory; `BASELINE_TEST_FAILURES` at 0.
- **T2 subsumed by T1** (exp #245) — parallel plan triage caught redundancy.

## Session-start protocol

1. Read this doc FIRST.
2. `bun scripts/lib/in-flight.ts list` — must be empty or investigate.
3. `bun scripts/lib/in-flight.ts prune` — cleans ghosts.
4. Check `docs/todo.md` priorities.
5. Emit `session-start: handoff ✓ in-flight ✓ todo ✓`.
6. Only then start new work.

Before dispatching subagents whose work touches `.claude/*.yaml`: Claude main writes the file scaffolding FIRST.

## Session-close protocol (what today did)

- 5 substantive commits on main: `70f814d`, `b8b5967`, `b5cb37a`, `8cc3d2c` (plus this docs commit).
- Experiments #244 + #246 auto-concluded PASS; #245 SUBSUMED.
- Registry pruned.
- Retrospectives at `docs/sessions/2026-04-19-5-invariants.md` (prior session) + `docs/sessions/2026-04-19-t1-t3.md` (this session).

## Commit chain this session (5 substantive + docs)

```
70f814d  [lint] widen invariant #5 to AST-based detection (exp #244) — T1 impl
b8b5967  [test] fix beat-checks cross-file mock pollution (exp #246) — T3 impl
b5cb37a  [fix] Codex a0b8a5d7 + acd8a3a3 — T1 HIGH/MEDIUM + T3 LOW delta
8cc3d2c  [fix] Codex a76243c1 — switch-clause break mis-classified as terminal
(plus this docs + retrospective commit)
```

## If you just landed here and don't know what's going on

Today extended the 5-invariants baseline from exp #243 with two follow-up
tickets: T1 widened invariant #5 to AST-based (retiring the 4 HEAD
allowlist entries), T3 fixed a bun:test mock pollution issue (dropping
`BASELINE_TEST_FAILURES` to 0). T2 was closed as subsumed by T1 via Codex
parallel-plan triage — save of ~30min.

Preflight: 71 pass / 0 fail / 0 new tsc errors / 112 invariant sites / 0
violations / 5/5 self-test. Run `bun scripts/preflight.ts` before any
Codex cycle.

The invariants registry at `docs/invariants.md` remains source-of-truth.
The SOP is documented in `.claude/skills/implement-ticket.md`.
