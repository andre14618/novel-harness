---
ticket: T4 — loop-statement reachability for invariant #5
experiment: 247
parent: 244
status: planning
created: 2026-04-19
---

# Plan — Extend `exitsFunction()` to recognize loop-terminated clauses

## Goal
Extend `exitsFunction()` in `scripts/lint/invariants-check.ts` (the T1 / exp #244 helper) to correctly classify loop statements whose body unconditionally exits the enclosing function. Specifically: `while(true) { ...throw/return }` and `for(;;) { ...throw/return }` shapes where the loop body has no reachable exit via `break`/`continue`/normal fallthrough.

## Non-goals
- No general dataflow analysis. Only the unambiguous `while(true)` + `for(;;)` shapes where the body itself `exitsFunction`.
- No handling of labeled-break / continue / try-finally unwinding — conservative false remains for anything the narrow heuristic can't prove.
- No change to invariant #2, #3, or the runtime invariants #1, #4.
- No new receiver-grouping logic (receiver aliasing remains deferred — it's a separate ticket if/when a HEAD site surfaces).

## Exit criteria
1. `bun scripts/lint/invariants-check.ts` — 0 violations, 0 allowlisted on HEAD (unchanged).
2. `bun scripts/lint/invariants-check.ts --self-test` — **5/5** fixtures fire (unchanged). No new fixture is added to the self-test runner, since the runner is expected-FIRE only and the new case is an expected-NOT-FIRE one. Coverage for the new classifier lives in unit tests instead (see #3).
3. NEW file `scripts/lint/invariants-check.test.ts` — unit tests for the terminator classifiers. At minimum:
   - (a) `while(true) { ... throw }` is classified terminal
   - (b) `for(;;) { ... return }` is classified terminal
   - (c) `do { ... return } while (true)` is classified terminal
   - (d) `while (cond) { ... throw }` is NOT terminal (condition may be false)
   - (e) `while (true) { if (x) break; throw }` is NOT terminal (break exits the loop)
   - (f) `while (true) { if (x) continue; throw }` is NOT terminal (continue loops back)
   - (g) `while (true) { switch (x) { case 1: continue } throw }` is NOT terminal (continue inside a switch still targets the enclosing loop)
   - (h) `while (true) { for (const y of ys) break; throw }` IS terminal (inner break doesn't target the while)
   - (i) `while (true) { switch (x) { case 1: break } throw }` IS terminal (switch-break targets the switch, not the loop)
   - (j) `while (true) { for (const y of ys) continue; throw }` IS terminal (inner `continue` targets the INNER loop, not the outer — locks in the nested-loop boundary per Codex thread `aef73a30` finding #1)
   - (k) `do { return } while (someCondition)` IS terminal (body runs unconditionally at least once)
4. `bun scripts/preflight.ts` — all 4 steps green.
5. Codex implementation review verdict RESOLVED.

## File ownership slices

### Slice A — loop-terminator recognition + unit test + negative-case verification (single subagent)
**Files:**
- EDIT `scripts/lint/invariants-check.ts`:
  - Extend `exitsFunction()` to handle `WhileStatement` / `ForStatement` / `DoStatement`. The rule: a loop is terminal iff (a) its body `exitsFunction` AND (b) there's no reachable `break` / labeled-break targeting the loop inside the body OR any continue-jump that loops back to a non-terminal state.
  - Implementation shape:
    ```ts
    if (ts.isWhileStatement(stmt) || ts.isDoStatement(stmt) || ts.isForStatement(stmt)) {
      // Only classify as terminal when we can be sure the loop body always
      // exits the function. Requires: body exitsFunction AND no `break`
      // targeting this loop in the body AND (for WhileStatement/ForStatement)
      // the loop is always-true.
      if (!exitsFunction(stmt.statement)) return false
      if (containsBreakOrContinueTargeting(stmt.statement, stmt)) return false
      if (ts.isWhileStatement(stmt)) {
        return isLiteralTrue(stmt.expression)
      }
      if (ts.isForStatement(stmt)) {
        // for(;;) has no condition AST node
        return stmt.condition === undefined
      }
      if (ts.isDoStatement(stmt)) {
        // do { return } while (cond) — body runs at least ONCE unconditionally.
        // If the body exits the function on every path AND no break/continue
        // targets this loop, we're terminal regardless of `while (cond)`.
        // Codex thread `aef73a30` HIGH: gating on isLiteralTrue(cond) would be
        // a false negative for `do { return } while (someCondition)`.
        return true
      }
    }
    ```
  - Add helper `isLiteralTrue(expr)`: returns true iff expr is `ts.SyntaxKind.TrueKeyword` OR a `ParenthesizedExpression` wrapping one recursively. Conservative — does NOT try to prove `1 === 1`, `!0`, or similar constants; also does NOT try to resolve `for (; true ;)` outside of the explicit `condition === undefined` path (documented false negative).
  - Add helper `containsBreakOrContinueTargeting(node, loopStmt)`: walks the subtree; returns true if any `break` or `continue` would target `loopStmt`. The capture rules differ per keyword (Codex triage `a744b941` correction):
    - **`break`** — targets the nearest enclosing LOOP or SWITCH. So when scanning the loop body for a `break` that targets our loop, skip nested LOOP subtrees AND nested SWITCH subtrees (a `break` inside a `switch` targets the switch, not our loop).
    - **`continue`** — targets the nearest enclosing LOOP only. Switches do NOT capture `continue`. So when scanning for a `continue` that targets our loop, skip only nested LOOP subtrees; DO descend into nested SWITCH subtrees (a `continue` inside a switch inside our loop still jumps back to our loop's condition).
    - Always skip nested `FunctionDeclaration` / `FunctionExpression` / `ArrowFunction` / `MethodDeclaration` subtrees — those are different scopes.
    - Labeled breaks/continues targeting outer labels: treat as targeting our loop (conservative — a `break outer` or `continue outer` could escape). Until we add label-aware resolution, return true on any LabeledStatement / labeled break inside the body that matches the outer loop.
  - Update the top-of-file docstring for `exitsFunction` / `alwaysTerminates` to reflect loop handling.

- CREATE `scripts/lint/invariants-check.test.ts`:
  - Uses `bun:test`. Imports `exitsFunction` directly from `invariants-check.ts` — the function goes from module-local to named export. Codex thread `aef73a30` MEDIUM #4: a `__classifyTerminator(src)` wrapper would be a second parsing surface that can drift; direct export is simpler.
  - Test shape: each case parses a TS snippet, extracts the last top-level statement via `sourceFile.statements.at(-1)`, calls `exitsFunction(stmt)`, asserts the expected boolean.
  - Test cases:
    - `while (true) { throw new Error('x') }` → terminal.
    - `while (true) { return 1 }` → terminal.
    - `for (;;) { throw new Error('x') }` → terminal.
    - `do { return 1 } while (true)` → terminal.
    - `while (cond) { throw new Error('x') }` → NOT terminal (condition may be false).
    - `while (true) { if (cond) break; throw new Error('x') }` → NOT terminal (break exits loop).
    - `while (true) { if (cond) continue; throw new Error('x') }` → NOT terminal (continue can loop back to non-terminal state).
    - `while (true) { for (const x of arr) break; throw new Error('x') }` → TERMINAL (inner break doesn't target the while).
    - `switch (x) { case 1: throw; default: return }` — still terminal via existing switch path.
  - Expected count: ~10 cases, 1 file.

### Slice B — registry update (trivial, after Slice A)
- EDIT `docs/invariants.md` §#5 Implementation note — remove "loops deferred as conservative false" language; add sentence describing the new `while(true)/for(;;)/do-while(true)` recognition.
- EDIT `docs/todo.md` — if there's a follow-up mentioning "loop reachability" still pending, mark DONE; otherwise no-op.

## Risks + mitigations
- **Break vs continue targeting rules differ** — `break` is captured by loops AND switches; `continue` is captured by loops only. The helper must distinguish (Codex triage `a744b941` correction). Covered by unit tests (g) and (i).
- **Labeled break** — `outer: while (true) { inner: while (true) { break outer } }` — rare in this codebase (grep for `^\s*\w+:\s*(while|for|do)` patterns — zero hits expected). Conservative: return true on any labeled break/continue inside the body; defers label-aware resolution.
- **Complex `for` loops with condition** — `for (let i = 0; ; i++)` (no condition) → terminal if body exits; `for (let i = 0; i < n; i++)` → NOT terminal (loop can finish normally). Detector uses `stmt.condition === undefined` as the proxy; anything else → conservative false.
- **`do { ... } while (...)` vs `while (...) { ... }` semantics** — do-while runs at least once. Handled by the separate branch.
- **Test runner import** — if `exitsFunction` is a module-local helper, exposing it just for tests introduces a tiny API surface. Better: a test-only wrapper function like `__classifyTerminator(src)` that the runtime code doesn't use but the tests import.

## Green / red split
- **Green.** Additive changes to `exitsFunction`, new unit test file, tiny docs update. No runtime API changes. No fixture additions to the self-test runner.

## Commit chain (anticipated)
1. `[lint] T4 — loop-statement reachability in invariant #5 terminator (exp #247)` — Slice A.
2. `[docs] T4 — update #5 registry note (exp #247)` — Slice B.
3. Possible `[fix] Codex review <thread>` if review flags anything.

## Codex sequencing
- Phase 2 triage: expect `green` — contained, additive, test-covered.
- Phase 3 full review: focus on break/continue targeting correctness, `do-while` semantics, `for` condition-absence detection.
- Phase 6 impl review: **hot tier** (pure helper extension, unit-tested, behavior-preserving for existing HEAD).
