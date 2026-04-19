---
status: session-closed
updated: 2026-04-19
session_closed_at: 2026-04-19T19:50:00Z
---

# Session handoff — novel-harness

**Purpose:** short living state doc. Next session reads this FIRST before reconstructing from git/todo/sessions. If stale (`updated` > 48h old), treat as unreliable and fall back to `bun scripts/status.ts` (not yet shipped — see next-session priority #2) + manual reconstruction.

## What's in flight RIGHT NOW

**Nothing.** Today's organic-run-verify completed (experiment #239 PASS). In-flight registry is empty (pruned at session close).

If you see any active runs in `bun scripts/lib/in-flight.ts list`, something was launched between session close and your session-start. Investigate before starting new work.

## What's pending Codex review

**Nothing open.** Final session-close thread `ab0b2dcea718737cf` returned `RESIDUAL_WORK_2` — two known-deferred items (see below), not blocking.

## Start-here priorities for next session

1. **5 starting invariants** — see canonical registry at [`docs/invariants.md`](../docs/invariants.md). Per Codex Q6 (`ad350aa657ec1c9b1`): invariants MUST be blocking, NOT debug-only. Today's telemetry: 9 bugs caught by Codex vs 1 by preflight — invariants rebalance that. All 5 entries currently `planned`; ship `scripts/lint/invariants-check.ts` + `src/invariants/` + integration-test extensions to move them to `shipped`.

2. ~~`scripts/status.ts`~~ **DONE 2026-04-19** — shipped in commit `413bf12` + `5da3475` (exp #241). One-shot dashboard; run `bun scripts/status.ts`.

3. ~~`docs/codex-preamble.md`~~ **DONE 2026-04-19** — generator at `scripts/lib/codex-preamble.ts`, emits `docs/codex-preamble.md`. Regenerate with `bun scripts/lib/codex-preamble.ts --emit`. ~57 lines under a 200-line hard cap (regenerates per-invocation). Codex review `a3af80e8eb4312169` HOLD → all 3 findings fixed in `5da3475`. Now also points at `docs/invariants.md` as canonical registry (commit `9ed7980`).

## Deferred / flagged

- **M3 Zod per-kind validation** on `POST /api/debug/inject` — 20-min
  follow-up. Env gate blocks prod adversaries; malformed test rules
  fail loudly when fired. Not urgent.
- **V2 transport interceptor Phase 2** — retire V1 env flags. Needs an
  equivalence test matrix (seven V1 seams × V2 rule-backed equivalents).
- **Codex RESIDUAL_WORK_2 note:** the organic-run-verify #239 PASS is
  narrow — didn't exercise rewrite/reviser/exhaustion branches. Combined
  with today's forced R-campaigns the architecture is validated. Worth
  noting for future "what counts as validation" discussions.

## Recent architectural decisions (last 48h)

Full entries in `docs/decisions.md`:
- **Round A + Round B architecture** (exp #237 charter) — non-blind-retry
  + V2 transport interceptor Phase 1 + workflow overhaul (skill doc +
  telemetry).
- Experiments #238 (FAIL — env contamination) + #239 (PASS — clean run).

## Session-start protocol

1. Read this doc FIRST.
2. `bun scripts/lib/in-flight.ts list` — must be empty (expected) or
   investigate.
3. `bun scripts/lib/in-flight.ts prune` — cleans ghosts.
4. Check `docs/todo.md` priorities section.
5. **Emit the mandatory session-start receipt:**
   `session-start: handoff ✓ in-flight ✓ todo ✓`
6. Only then start new work.

## Session-close protocol (what today did)

- 15 commits on main (see retrospective at
  `docs/sessions/2026-04-19-workflow-overhaul.md` for the supersession
  chains + Codex exchanges + telemetry)
- Deployed (commit `d00993b` pushed to LXC; WorkflowPage live at
  `/app/workflow`)
- Experiment #239 auto-concluded PASS
- Registry pruned
- This handoff overwritten with close state

## Commit chain this session (15 commits, full set)

```
0c9b1ef  revisionUsed persistence (Round A)
f1f844f  R3/R4 race fixes
83ffce0  cleanup-orphans script
0c9fa3b  Codex Round A 3-HIGH-bug fixes
c3e0c08  todo.md Round A done
a1f4842  organic-run-verify + post-settle validation-check trace (Round B)
b25f01e  V2 transport interceptor Phase 1
7cdc0de  doc supersession pass (continuation)
ef4aa1b  preflight-caught retryErrors type fix
c0704bd  Codex Round B MEDIUM follow-ups
a0d396e  implement-ticket skill + session telemetry
7787a24  experiment tracking + Phase 0 mandatory
e8886c1  in-flight registry + session handoff scaffolding
687e651  Codex scaffolding review fixes (verify_pattern + receipts + env probe)
d00993b  WorkflowPage UI — visual map at /app/workflow
(plus this commit — retrospective + handoff close)
```

## If you just landed here and don't know what's going on

The `novel-harness` repo completed a large workflow-scaffolding push on
2026-04-19. Key artifacts live at:

- `.claude/skills/implement-ticket.md` — the workflow (13 phases)
- `docs/sessions/2026-04-19-workflow-overhaul.md` — today's retrospective
- `docs/decisions.md` "Round A + Round B architecture" — the authoritative
  decision log
- `/app/workflow` (UI) — visual dashboard of the orchestration pattern

The SOP is: short check-back cadence (~120s) on background runs; use
parallel Sonnet subagents for decomposable implementation; commit-pinned
reviews; mandatory Phase 0 experiment tracking; mandatory session-start
receipt.
