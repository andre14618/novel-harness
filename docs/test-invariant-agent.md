---
status: active
updated: 2026-05-05
role: test-invariant-agent-contract
---

# Test And Invariant Agent

This is the contract for a dedicated support/evidence role that owns test
suite shape, invariant promotion, and local gate health. It is a role, not a
specific model or tool. Claude Code, OpenCode, Codex, or Claude can perform it
as long as the lane records a durable identity such as `test-invariant-claude`
or `test-invariant-codex`.

The role does not replace the lane captain. The captain owns runtime behavior,
integration, stop-gate decisions, and final commits. The Test and Invariant
Agent owns the evidence that the change is protected by the right kind of test
or invariant.

## When To Invoke

Use this role when a lane touches any of these:

- test tier design, test speed, flakes, or DB test isolation
- coverage gaps around a changed behavior
- new or modified structural invariants
- architecture rules, lint guards, fixture belts, or preflight gates
- UI-facing work that needs Playwright evidence before handoff
- replay/eval gates that decide whether a prompt, checker, or heuristic is safe
  to wire into production defaults

## Inputs

Load these before changing tests or guards:

- `AGENTS.md`
- `docs/current-state.md`
- `docs/sessions/lane-queue.md`
- the active lane/session doc, when one exists
- `docs/invariants.md` for invariant registry and promotion rules
- `docs/ui-work-gate.md` for browser-facing work
- the touched source and existing tests for the behavior under change

## Operating Contract

1. Inspect the worktree before edits and do not absorb unrelated dirty files.
2. Classify the work as one or more of: pure scenario test, DB integration,
   replay/eval, structural invariant, runtime invariant, cross-state invariant,
   UI browser gate, or docs-only gate update.
3. Baseline the current behavior with the narrowest useful command. If the
   problem is test speed, capture wall-clock timing before refactoring.
4. Add or preserve a failing regression signal first when fixing a behavior
   bug. For invariants, include a deliberate violation fixture or equivalent
   negative test that proves the guard catches the intended shape.
5. Keep tiers honest:
   - `bun run test:fast` is the default loop for pure or in-process tests.
   - `bun run test:db` owns persistence, route, and disposable-data integration
     tests.
   - `bun run test:replay` owns explicit fixture parity and prompt/request drift.
   - `bun run test:archive` owns retired or archived eval surfaces.
   - Playwright MCP evidence owns browser-visible UI clearance.
6. Do not hide DB, network, LXC, replay, or browser dependence inside the fast
   tier. If a test needs that dependency, put it in the matching tier and add a
   pure test for the logic that can stay fast.
7. Refactor tests toward pure/in-process coverage plus smaller DB route smokes
   when possible. Do not delete broad coverage unless the replacement map is
   explicit in the handoff.
8. Promote invariants only from evidence: a recurring bug class, an active
   violation found in survey, or a high-blast failure mode with a concrete
   incident. Speculative rules belong in backlog or diagnostic mode, not as
   blocking guards.
9. Make failures agent-actionable. Error output should name the invariant,
   failing file or fixture, expected rule, and the likely remediation path.
10. Run the relevant tiered verification before closing. Include
   `git diff --check`; run `bun run docs:weight` when docs change and
   `./node_modules/.bin/tsc --noEmit` when TypeScript behavior changes.

## Invariant Promotion Checklist

A new invariant is not done until all of these are true:

- `docs/invariants.md` has an entry with name, shape, bug class, assertion,
  implementation path, status, and allowlist policy.
- The implementation is project-native: AST/lint, runtime test, cross-state
  query, or a deliberately scoped LLM-check wrapper.
- A negative fixture or deliberate violation proves the guard fires.
- The failure message tells a future agent exactly what rule failed.
- False positives are either fixed, narrowly allowlisted with expiry, or called
  out as a blocker before shipping the guard.
- The invariant is wired into the appropriate local gate only after it proves
  useful. Non-blocking invariants are diagnostics, not safety guarantees.

## Coverage No-Gap Rule

When moving a slow test out of the fast tier, preserve its value explicitly:

- core branching and transformation logic should have pure tests
- DB behavior should have disposable-data route or persistence tests in
  `test:db`
- replay-sensitive behavior should have fixture parity or candidate replay in
  `test:replay`
- UI behavior should have Playwright MCP screenshots and console/network notes

The handoff must say what moved, what still covers it, and which tier catches a
regression.

## Handoff Format

Every test/invariant handoff should include:

- role identity used in lane messages or heartbeat, when applicable
- baseline command and result
- changed tests, guards, or invariant registry entries
- verification commands and results
- coverage boundary and any known remaining gap
- commit SHA once the slice is committed

## Boundaries

- Do not add external CI while that posture is on hold.
- Do not use a new invariant to smuggle in unproven craft heuristics. Creative
  planner, writer, or checker changes still need diagnostic or A/B evidence
  before production-default wiring.
- Do not make Canon, world, character, or plot changes autonomous by changing
  tests. Manual review remains the default unless a new decision reopens it.
