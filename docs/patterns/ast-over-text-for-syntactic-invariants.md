---
pattern: ast-over-text-for-syntactic-invariants
status: active
first-seen: 2026-04-19 (docs/sessions/2026-04-19-5-invariants.md)
last-seen: 2026-04-19 (docs/sessions/2026-04-19-t1-t3.md)
elevated_from:
  - docs/sessions/2026-04-19-5-invariants.md
  - docs/sessions/2026-04-19-t1-t3.md
---

# AST-over-text for syntactic invariants

## Characterization

Syntactic invariants often start as a fast text scan because the target sounds textual:
"is `inject.forceXxx` near this call site?" or "did we call `.text()` before `.json()`?"
That shortcut leaks the exact edge cases the invariant exists to catch.

Real TS/JS source shape is AST-shaped, not line-shaped. Comments, string literals,
shadowed identifiers, sibling scopes, and branch-local control flow all look
plausible under raw text or regex, but they mean different things semantically.

Typical symptoms:
- A checker passes because the text appears in a comment or string literal.
- A checker over-accepts because some unrelated sibling scope contains the token.
- A regex catches one source form, then misses the same bug in a different AST shape.

## Problem shape

The bug class is "syntactic invariant implemented as text heuristics." The rule is
trying to reason about nodes, scopes, or control flow, but the implementation only
reasons about substrings, line windows, or regex captures.

## Anti-pattern

- Function-scope "any matching text anywhere in this function" scans
- Raw line-window proximity checks with `line.includes(...)`
- Regex rules tied to one surface form of a call or template literal

These are attractive because they are quick to ship, but they are brittle on real
TS/JS AST shapes.

## Pattern

Parse the file and collect the real nodes of the shape you care about. Then apply
the invariant against AST-backed facts:

- Use the `typescript` compiler API when the rule needs lexical scope,
  declaration identity, or precise node kinds — both shipped recurrences
  (invariant #2, invariant #5) use `ts.createSourceFile` + visitor walks.
- Group identifiers by declaration node, not name string.
- Treat comments and string literals as non-evidence unless the invariant is
  explicitly about text.
- Model control flow at the AST level when reachability matters.

## When to apply

- The invariant targets specific node kinds such as `PropertyAccessExpression`,
  `CallExpression`, or `ElementAccessExpression`.
- The rule is scope-sensitive: nearest declaration wins, shadowing matters, or a
  sibling block should not satisfy the check.
- The rule is path-sensitive: `throw`/`return`/`break`/`continue` change whether a
  later node is reachable.

## When not to apply

- The check is genuinely textual: license headers, TODO tags, trailing whitespace,
  forbidden phrases in docs, or exact string payloads.
- The cost of a parser is unjustified for a one-off repo hygiene check with no
  syntactic ambiguity.

## Sessions where seen

- 2026-04-19 — [5 starting invariants](../sessions/2026-04-19-5-invariants.md):
  invariant #2 failed first as function-scope over-acceptance (`ce6452c`), then as
  text-window comment/string bypass (`7afe4dd`), and was fixed by AST-only force-ref
  collection (`dedc0b6`).
- 2026-04-19 — [T1 + T2 + T3](../sessions/2026-04-19-t1-t3.md): invariant #5 moved
  from template-literal regex to AST grouping by receiver declaration in `70f814d`,
  then hardened for lexical shadowing and switch reachability in `b5cb37a` and
  `8cc3d2c`.

## Canonical fix

Prefer AST traversal from the first implementation when the invariant is about
syntactic meaning, not text presence. For this repo, that means a `typescript`
compiler API walk in `scripts/lint/invariants-check.ts`.

Fixing commits:
- Invariant #2 (function-scope over-acceptance → AST collector): `dedc0b6`.
- Invariant #5 (template-literal regex → AST receiver/path analysis):
  `70f814d` → hardened via `b5cb37a` and `8cc3d2c`.

## Recurrences

1. Invariant #2, exp #243: function-scope subtree scan -> text-window scan -> AST
   collector (`ce6452c` -> `7afe4dd` -> `dedc0b6`).
2. Invariant #5, exp #244: template-literal regex -> AST receiver/path analysis
   (`70f814d` -> `b5cb37a` -> `8cc3d2c`).

## Related

- [Invariants registry](../invariants.md)
- [2026-04-19 — 5 starting invariants](../sessions/2026-04-19-5-invariants.md)
- [2026-04-19 — T1 + T2 + T3](../sessions/2026-04-19-t1-t3.md)
