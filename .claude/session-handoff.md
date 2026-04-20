---
status: session-closed
updated: 2026-04-19
session_closed_at: 2026-04-19T22:30:00Z
---

# Session handoff — novel-harness

**Purpose:** short living state doc. Next session reads this FIRST.

## What's in flight RIGHT NOW

**Nothing.** Registry empty (`bun scripts/lib/in-flight.ts list` → no runs).
If you see any active runs, something was launched between session close
and your session-start. Investigate before starting new work.

## What's pending Codex review

**Nothing open.** Final session thread `ac2bb23e2682785f0` returned
RESOLVED + CLEAN. 5-invariants ticket concluded (exp #243).

## Start-here priorities for next session

1. **Measure the ratio.** `docs/invariants.md` §Ratio target: within 3-5
   sessions `bugs_caught_by_preflight` should match or exceed
   `bugs_caught_by_codex` on recurring classes. Track via session-
   retrospective telemetry (`wall_clock_min`, `bugs_caught_by_*`,
   `preflight_false_positives`). If ratio doesn't move, invariants are
   theater — revisit shape taxonomy.

2. **Invariant #5 allowlist refactor ticket.** 4 allowlist entries in
   `.claude/invariants-allowlist.yaml` expire 2026-05-19. Each is an
   `if (!res.ok) throw \`... ${await res.text()}\`; const j = await res.json()`
   idiom the template-literal regex false-positives on. Either refactor
   each to `const txt = await res.text(); if (!res.ok) throw ...` OR widen
   the invariant to AST-scoped detection that recognizes throw
   short-circuit. Sites: `src/db/embed.ts:50`,
   `scripts/finetune/archetype-poc/flatten-deepseek.ts:67`,
   `scripts/corpus/test-deepseek-dialogue.ts:80`,
   `scripts/hallucination/smoke-eval.ts:42`.

## Deferred / flagged

- Invariant #2 / #3 MEDIUM findings from Codex thread `a01385f5` — broad
  event-consumption detector + cross-file `globalThis.__invariant4State`
  fragility. Deferred per "invariants are not a test substitute."
  Adapter tests + fixtures remain the regression belts. Revisit if the
  MEDIUM class recurs.
- Invariant #5 AST-scoped detector — the full assertion ("any two body-
  consuming calls on same Response") needs AST support. Deferred.
- `docs/patterns/ast-over-text-for-syntactic-invariants.md` — elevation
  candidate. Pattern observed 2x this session (function-scope →
  text-window → AST). Wait for one more recurrence per elevation
  criterion before committing the pattern doc.

## Recent architectural decisions (last 48h)

Full entries in `docs/decisions.md`:
- **Invariants registry shipped** (exp #242) — `docs/invariants.md` is the
  canonical source for all invariants + allowlist format.
- **5 starting invariants shipped** (exp #243) — all 5 entries flipped
  `planned → shipped`; `scripts/preflight.ts` is the canonical
  pre-Codex-review gate.
- (Pre-today) Round A + Round B architecture (exp #237 charter).

## Session-start protocol

1. Read this doc FIRST.
2. `bun scripts/lib/in-flight.ts list` — must be empty or investigate.
3. `bun scripts/lib/in-flight.ts prune` — cleans ghosts.
4. Check `docs/todo.md` priorities.
5. Emit mandatory session-start receipt:
   `session-start: handoff ✓ in-flight ✓ todo ✓`
6. Only then start new work.

Before dispatching subagents whose work touches `.claude/*.yaml` or
similar sandbox-gated paths: Claude main writes the file scaffolding
FIRST. Subagents extend. (Observed 2026-04-19 — Slice A lost one
dispatch to a Write denial on `.claude/invariants-allowlist.yaml`.)

## Session-close protocol (what today did)

- 5 commits on main: `ce6452c`, `10ce979`, `7afe4dd`, `dedc0b6`, `2c29b91`
  (plus retrospective + handoff + docs-subagent edits).
- Experiment #243 auto-concluded PASS.
- Registry pruned (no in-flight runs).
- This handoff overwritten with close state.
- Retrospective at `docs/sessions/2026-04-19-5-invariants.md`.

## Commit chain this session (5 substantive commits)

```
ce6452c  [lint] scripts/lint/invariants-check.ts + fixtures (Slice A)
10ce979  [test] extend drafting tests — invariants #1 + #4 (Slice B)
7afe4dd  [fix] Codex a01385f5 — invariants HIGH #1 + HIGH #2
dedc0b6  [fix] Codex acf3a597 — HIGH #1 follow-up (AST-scoped guard scan)
2c29b91  [process] Slice C — preflight wrapper + flip registry to shipped
(plus this commit + docs subagent edits)
```

## If you just landed here and don't know what's going on

`novel-harness` completed a 5-invariants implementation push on
2026-04-19. The registry lives at `docs/invariants.md` — every invariant
ships with commit refs + an implementation file. The blocking preflight
is `bun scripts/preflight.ts` — run it before any Codex cycle.

SOP remains: parallel Sonnet subagents for decomposable implementation;
commit-pinned Codex reviews; mandatory Phase 0 experiment tracking;
session-start receipt; `.claude/*.yaml` scaffolding written by Claude
main before subagent dispatch.
