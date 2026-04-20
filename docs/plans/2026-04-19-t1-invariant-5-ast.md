---
ticket: T1 — widen invariant #5 to AST-based detection
experiment: 244
parent: 243
status: planning
created: 2026-04-19
---

# Plan — Widen invariant #5 to AST-based detection

## Goal
Replace the template-literal regex in `scripts/lint/invariants-check.ts` (`checkBodyAlreadyUsed`) with an AST-based detector that tracks Response-bodied `.text()`/`.json()`/`.arrayBuffer()`/`.blob()` calls on the same variable across expressions — catching the broad assertion from `docs/invariants.md` §#5, not just the template-literal shape. Retire the 4 HEAD allowlist entries by making them unnecessary.

## Non-goals
- No change to the other two syntactic invariants (#2, #3) or their fixtures.
- No refactor of the 4 callsites themselves (they stay as-is; the new detector correctly flags them as safe because the throw short-circuits).
- No coverage for async-boundary cases (body consumed in a nested closure, via await-in-another-function). Deferred.

## Exit criteria
1. `bun scripts/lint/invariants-check.ts` exits 0 on HEAD with **zero** allowlist entries for invariant #5 (the 4 current entries are removed; the new detector sees the throw short-circuit and correctly marks them safe).
2. `bun scripts/lint/invariants-check.ts --self-test` — all 5 fixtures fire with their declared expected-invariant: 3 existing (`seam-recheck-asymmetry.ts`, `watcher-missing.ts`, `body-already-used.ts`) + 2 new (`body-already-used-sequential.ts`, `body-already-used-json-first.ts`). The runner globs `tests/invariants-fixtures/*.ts`, so adding new fixtures automatically raises the total count from 3/3 → 5/5.
3. NEW fixtures exercise cases regex never caught:
   - `tests/invariants-fixtures/body-already-used-sequential.ts` — `const a = await res.text(); const b = await res.json()`.
   - `tests/invariants-fixtures/body-already-used-json-first.ts` — `const j = await res.json(); const t = await res.text()` (ordering-symmetry lock-in).
4. The existing `tests/invariants-fixtures/body-already-used.ts` (template-literal shape) still fires under the new detector.
5. `bun scripts/preflight.ts` passes end-to-end.
6. Codex implementation review verdict RESOLVED or PASS.

## File ownership slices

### Slice A — AST detector + allowlist removal (RED, single subagent)
**Owner:** one Sonnet subagent (or Claude main — the scope is contained).
**Files:**
- EDIT `scripts/lint/invariants-check.ts` — replace `checkBodyAlreadyUsed`'s regex pass with an AST walk using `typescript` compiler API:
  - Collect all `AwaitExpression` → `CallExpression` pairs where the callee is a PropertyAccessExpression whose name is one of `text | json | arrayBuffer | blob` and whose expression is an Identifier (capture the identifier name) OR a PropertyAccess/CallExpression returning a known Response-typed value (we'll duck-type by identifier name — see heuristic below).
  - Group by (file, receiver-identifier-name, enclosing-function-scope). For each receiver with ≥2 calls, check whether any call is on a path that can still reach a subsequent call (i.e. not behind a `return`, `throw`, or branching `if (!res.ok) { throw ... }` short-circuit in between).
  - Heuristic for "reachable after consumption": walk the AST from the first call to the second. If a `ThrowStatement` or `ReturnStatement` lies in the linear path between them (same block or an if-branch that contains the second call as a SIBLING after the first), the second is unreachable from the first — safe.
  - Concretely: the 4 HEAD patterns match `if (!res.ok) throw new Error(\`... ${await res.text()}\`); const j = await res.json()` — the `.text()` is inside the throw expression, which aborts control flow. The `.json()` only runs when `!res.ok` is false, which is the path where `.text()` was NOT evaluated. → safe.
- EDIT `.claude/invariants-allowlist.yaml` — remove the 4 active entries (schema doc + commented example stay).
- CREATE `tests/invariants-fixtures/body-already-used-sequential.ts` — non-template-literal double-consume (`const a = await res.text(); const b = await res.json()`) with `// expected-invariant-failure: body-already-used-detection`. Confirms the detector catches the broad shape.
- EDIT `tests/invariants-fixtures/body-already-used.ts` (the template-literal fixture) — verify still fires; no structural change needed (the expression remains `${await r.text()}` followed by `await r.json()` with NO throw between them).

### Slice B — docs (RED after Slice A lands)
- EDIT `docs/invariants.md` — update the #5 entry: remove "known false-negative" sentence, remove "AST detector deferred," remove the allowlist reference. Update implementation note to describe the new detector shape.
- EDIT `docs/todo.md` — mark the 3 follow-ups from §0 that relate to #5 as DONE (the widen ticket + the allowlist refactor subsumed).
- Check `scripts/preflight.ts` `BASELINE_TEST_FAILURES` — no change from this ticket; T3 owns that.

## Green / red split
- **All red.** The AST detector is a core-correctness change that must ship on a verified fix, not speculative. Slice A first, Slice B after Slice A + Codex PASS.

## Detector design (detailed)

The assertion is: "For any Response-like variable `X`, at most one body-consuming call (`X.text()`/`X.json()`/`X.arrayBuffer()`/`X.blob()`) can execute on any real control-flow path."

**Algorithm:**
1. Walk each `.ts` file (excluding `tests/invariants-fixtures/**` in default mode). Collect all `AwaitExpression` wrapping a `CallExpression` whose callee is a PropertyAccessExpression matching `.(text|json|arrayBuffer|blob)()`, with the receiver being an Identifier.
2. Group matches by `(file, receiverDeclarationNode, enclosingFunction)`. The enclosing function is the nearest `FunctionDeclaration | FunctionExpression | ArrowFunction | MethodDeclaration`. Key each match by the AST node where the receiver identifier was *declared* (walking up to the nearest `VariableDeclaration` / `ParameterDeclaration` / `BindingElement` for the identifier) — NOT by the identifier *name* string. Rationale per Codex thread `ac53ffe9` Q2: grouping by name string conflates shadowed same-name bindings in inner scopes (e.g. `const res = ...` outside and a different `const res = ...` in an inner block). Using the declaration-node identity makes shadowing safe. If the receiver can't be resolved to a single declaration (e.g. imported symbol, property-access receiver, parameter of an outer closure), fall back to `enclosingFunction`-scoped name grouping — which matches the previous behavior — and emit a debug note; this is the pragmatic bound.
3. For each group with ≥2 matches, order by source position. For each pair `(first, second)` where first precedes second:
   - Determine whether the second is **reachable** after the first consumes the body. Reachable means: there exists a control-flow path from first's exit to second's entry that doesn't pass through a `ThrowStatement` or `ReturnStatement` after first.
   - **Unreachable heuristic (conservative — we want to flag only real bugs):** if first is inside an `IfStatement` condition/then/else branch AND second is in a SIBLING position after the IfStatement AND the branch containing first ends in a throw/return, mark as unreachable (safe).
   - Specific pattern to recognize: `if (!X.ok) throw new Error(\`...${await X.text()}\`); await X.json()` — the `await X.text()` is inside the throw's expression; the `await X.json()` is a sibling statement AFTER the if. The throw inside the if-branch makes the second call unreachable from the first.
4. If a pair is reachable and both consume the same receiver's body, FLAG it.

**Ordering symmetry (Codex thread `ac53ffe9` Q4):** the rule fires on ANY source-ordered pair of body-consuming calls on the same receiver, regardless of which method comes first. `await r.json(); await r.text()` is equally a violation as `await r.text(); await r.json()`. The detector iterates `.sort((a,b) => a.line - b.line)` and checks each (first, second) pair; method names are not special-cased. Fixture coverage for the json-first direction is added explicitly (see below).

**Ordering invariants of existing sites (verified):**
- `src/db/embed.ts:47-50`: `if (!res.ok) throw new Error(\`Embedding failed: ${res.status} ${await res.text()}\`); const data = await res.json()` → unreachable, safe.
- `scripts/finetune/archetype-poc/flatten-deepseek.ts:66-67`: same shape.
- `scripts/corpus/test-deepseek-dialogue.ts:79-80`: same shape.
- `scripts/hallucination/smoke-eval.ts:41-42`: same shape.

All 4 match the exact if-throw-then-json pattern the heuristic handles. After shipping, these should pass with zero allowlist entries.

**Fixture coverage:**
- `body-already-used.ts` (existing) — template-literal shape without throw protection:
  ```ts
  assert(`decide ${await decideR.text()}`); const body = await decideR.json()
  ```
  No intervening throw; both calls reachable; FLAG.
- `body-already-used-sequential.ts` (NEW) — plain sequential double-consume:
  ```ts
  const t = await res.text(); const j = await res.json()
  ```
  No intervening throw; both calls reachable; FLAG. This is the case regex never caught.
- `body-already-used-json-first.ts` (NEW) — ordering-symmetry fixture. The rule fires regardless of which body-method comes first:
  ```ts
  const j = await res.json(); const t = await res.text()
  ```
  Both calls reachable; FLAG. Locks in the detector's method-name-agnostic pairing so a future refactor can't accidentally special-case text→json ordering.

## Risks + mitigations
- **False positives on safe async-boundary patterns** — if a user reads `.text()` in one branch and `.json()` in another mutually-exclusive branch, the detector might flag them unless the branch-exclusivity analysis is right. Mitigation: the heuristic is CONSERVATIVE (only flag when pair is clearly reachable); prefer false negatives over false positives; add a `// @noninjectable`-style comment escape hatch (`// @body-consumed-single-path`) if needed.
- **Heuristic gaps on nested closures / callbacks** — `res.then(r => r.text())` or body-read-in-callback patterns. Document as deferred scope.
- **Receiver-alias tracking** — `const body = res; await body.text(); await res.json()` — two different identifiers, same object. Not caught by identifier-name grouping. Document as deferred.
- **AST parse perf** — we already parse each file once for invariants #2/#3/#5; adding this visitor uses the same parse. No new cost.

## Commit chain (anticipated)
1. `[lint] widen invariant #5 to AST-based detection (exp #244)` — Slice A, new detector + 1 new fixture + allowlist-4 removal.
2. `[docs] flip #5 entry to broad-coverage + mark T1/T2 follow-ups DONE (exp #244)` — Slice B.
3. `[fix] Codex review <thread> — <N> findings` (if review flags anything).

## Codex sequencing
- Phase 2 triage: expect `green` given contained scope + precedent (AST pattern worked for #2 last session).
- Phase 3 full review: focus on detector heuristic correctness — does the if-throw-short-circuit detection cover the 4 HEAD sites without over-flagging? Any new HIGH risk on sibling-position vs nested-call cases?
- Phase 6 impl review: **cold tier** (lint-checker correctness is load-bearing across all future preflight runs).
