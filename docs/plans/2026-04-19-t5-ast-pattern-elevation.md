---
ticket: T5 — elevate pattern: AST-over-text for syntactic invariants
experiment: 248
parent: 243
status: planning
created: 2026-04-19
---

# Plan — Create `docs/patterns/ast-over-text-for-syntactic-invariants.md`

## Goal
Promote the "AST beats text for syntactic checks" lesson from session-level (observed 3+ times across exp #243 + #244) to a pattern-level document per `docs/sessions/README.md` elevation criterion. Docs-only ticket; no code changes.

## Non-goals
- No code changes. This is pure elevation.
- No new invariant — the pattern generalizes the rationale behind existing invariants, it doesn't add one.
- No revision of the sessions themselves — only back-link additions.

## Exit criteria
1. NEW file `docs/patterns/ast-over-text-for-syntactic-invariants.md` (50-120 lines) with the canonical pattern doc shape: title, status frontmatter, "Problem shape," "Antipattern," "Pattern," "When to apply," "Recurrences," "Related."
2. Back-links added to: `docs/invariants.md` (new "Related patterns" section OR a one-line pointer in the shape-taxonomy section), `docs/sessions/2026-04-19-5-invariants.md` §4 (Class-of-bug patterns — add reference + confirm elevation), `docs/sessions/2026-04-19-t1-t3.md` §4 (same).
3. `docs/todo.md` — if there's a standing "elevate when pattern recurs" note, mark it done; otherwise no-op.
4. Preflight PASS (unchanged — pure docs).
5. Codex review verdict RESOLVED.

## Recurrences to cite

Documented instances from git log + session retrospectives:
1. **Invariant #2 — function-scope subtree scan** (exp #243, commit `ce6452c`). Codex `a01385f5` HIGH #1: "function-scope over-accepts." Fixed via `7afe4dd` (text-window), further hardened in `dedc0b6` (AST-scoped collector).
2. **Invariant #2 — text-substring window** (exp #243, commit `7afe4dd`). Codex `acf3a597` HIGH: "raw substring scan accepts comments + string literals." Fixed via `dedc0b6` (real AST node collection).
3. **Invariant #5 — template-literal regex** (exp #244, before commit `70f814d`). Codex review from earlier sessions already knew regex missed non-template shapes. Widened to AST in `70f814d` + follow-up hardening in `b5cb37a` / `8cc3d2c`.

Three occurrences in two sessions. Canonical elevation signal (≥2 recurrences per `docs/sessions/README.md`).

## File ownership slices

### Slice A — pattern doc + back-links (single subagent or Claude main — small)
**Files:**
- CREATE `docs/patterns/ast-over-text-for-syntactic-invariants.md`. Template structure:

  ```markdown
  ---
  status: active
  updated: 2026-04-19
  elevated_from:
    - docs/sessions/2026-04-19-5-invariants.md
    - docs/sessions/2026-04-19-t1-t3.md
  ---

  # AST-over-text for syntactic invariants

  ## Problem shape
  Short paragraph — syntactic checks (lint rules, regex scans, "does X appear in source") tempt a fast text-level implementation. Text scans leak edge cases: comments, string literals, nested scopes, shadowing.

  ## Antipattern
  - Raw text substring scans (`line.includes("X")`).
  - Line-window proximity with text matching.
  - Function-scope "any X anywhere in function body" subtree scans.
  Each leaks: comments ([invariant #2 leak example]), sibling-scope shadowing ([invariant #5 leak example]), or branch-independence (one guarded site makes a sibling pass).

  ## Pattern
  Parse the source via `typescript` compiler API. Collect real AST nodes of the shape you care about. Apply scoping rules (nearest-enclosing scope walk for identifiers, block-level for statements, condition-analysis for control flow). Comments and string literals naturally fall out.

  ## When to apply
  - Syntactic invariants where the target shape is a specific AST node type (PropertyAccess, CallExpression with a particular argname, etc.).
  - Scope-sensitive rules (shadowing, control-flow reachability).
  NOT for: license headers, TODO comments, trailing whitespace, anything that's genuinely about text.

  ## Recurrences (chronological)
  1. Invariant #2 function-scope → text-window → AST-scoped (exp #243, commits ce6452c → 7afe4dd → dedc0b6).
  2. Invariant #5 regex → AST-scoped (exp #244, commits 70f814d → b5cb37a → 8cc3d2c).

  ## Related
  - `docs/invariants.md` — canonical invariants registry.
  - `docs/sessions/2026-04-19-5-invariants.md` — first emergence.
  - `docs/sessions/2026-04-19-t1-t3.md` — third recurrence.
  ```

- EDIT `docs/invariants.md` — add a short "Related patterns" section after the shape taxonomy (or inline in §Shape taxonomy) pointing at the new pattern doc.
- EDIT `docs/sessions/2026-04-19-5-invariants.md` §4 — if the "class-of-bug patterns" list mentions this as "elevation candidate," change to "elevated to `docs/patterns/ast-over-text-for-syntactic-invariants.md`."
- EDIT `docs/sessions/2026-04-19-t1-t3.md` §4 — same transformation.
- EDIT `docs/todo.md` — if there's an "elevate AST pattern" item in the deferred list, mark DONE.

## Green / red split
- **Green.** Pure docs. No code or config changes.

## Risks + mitigations
- **Session edits can drift** — but only two sessions are edited, and the edit is a single-line replacement (elevation-candidate → elevated).
- **Back-link rot** — if a session retrospective is later renamed, back-links break. Mitigation: the `elevated_from` frontmatter in the pattern doc itself provides a reverse-index.

## Commit chain (anticipated)
1. `[docs] T5 — elevate pattern: AST-over-text for syntactic invariants (exp #248)` — one commit; pure additive + back-links.

## Codex sequencing
- Phase 2 triage: expect `green`.
- Phase 3 full review: pattern doc quality + accuracy of recurrence citations (commit SHAs, Codex thread IDs, session retro references).
- Phase 6 impl review: **hot tier** (docs only).
