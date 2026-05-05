---
status: active
date: 2026-05-05
decision: test-invariant-agent-contract
---

# L80 Test And Invariant Agent Contract

## Decision

Test and invariant work gets a named support/evidence role: the Test and
Invariant Agent. The role follows `docs/test-invariant-agent.md` and owns test
suite shape, invariant promotion, local gate health, and evidence handoff for
coverage changes.

The lane captain still owns runtime behavior, integration, stop-gate decisions,
and final commits. The Test and Invariant Agent can implement tests, fixtures,
guards, and docs for a lane, but should not independently change production
runtime behavior unless the lane contract explicitly scopes that work.

The repo keeps tiered local gates instead of relying on direct broad `bun test`:

- `bun run test:fast` for pure and in-process default coverage
- `bun run test:db` for bounded persistence, route, and disposable-data smoke
  coverage
- `bun run test:db:full` for exhaustive isolated DB integration when broad
  persistence confidence is worth the runtime cost
- `bun run test:replay` for explicit replay fixture parity
- `bun run test:archive` for archived eval surfaces
- Playwright MCP evidence for UI-facing clearance

New invariants must prove value before becoming blocking guards. Evidence can
come from a recurring bug class, an active violation found in survey, or a
concrete high-blast incident. Speculative rules and craft heuristics stay in
diagnostic or backlog form until they have evidence.

## Rationale

The recent test-harness reliability work restored useful local gates by
separating pure tests from DB integration and making replay parity explicit.
That solved the immediate slowdown and hanging-test shape, but the next risk is
process drift: future agents may add slow route tests to the fast tier, delete
coverage while refactoring, or ship invariants without a negative fixture.

A dedicated role makes the approach repeatable. It also gives the user a
natural unit to delegate to another coding agent without handing over unrelated
runtime architecture.

## Implications

- Every test/invariant slice should baseline the current behavior, identify the
  correct tier, preserve coverage explicitly, and report any remaining gap.
- Moving a slow test out of `test:fast` or `test:db` requires a replacement
  map: pure logic tests, DB route smokes, full DB scenarios, replay fixture
  checks, or Playwright evidence as appropriate.
- New invariants require an entry in `docs/invariants.md`, a deliberate
  violation fixture or equivalent negative check, and agent-actionable failure
  output.
- UI changes remain gated by `docs/ui-work-gate.md` and Playwright MCP evidence.
- External CI remains on hold. These gates are local unless a later decision
  reopens CI.

## Rejected Alternatives

- **Ad hoc test edits per lane.** Rejected because it lets coverage and speed
  drift without a durable owner.
- **Return to broad `bun test` as the default gate.** Rejected because it hides
  DB/replay coupling and makes local feedback slow or flaky.
- **Ship speculative invariants as blocking guards.** Rejected because
  false-positive guards create noise and teach agents to bypass the gate.
