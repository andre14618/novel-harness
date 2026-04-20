# Patterns

Class-of-bug and architectural-trade-off docs that recur across sessions. Written once, updated when a new session re-encounters the pattern. Back-links to session retrospectives provide the evidence chain.

## Why this is a separate doc tree from `sessions/`

- **Sessions** are point-in-time: what was shipped on date X, with full narrative and supersession chains.
- **Patterns** are reusable: "here's a class of bug we keep hitting; here's the canonical fix; here's every session it appeared in."

A pattern doc that doesn't link back to at least 2 sessions should either (a) be folded into the single session's retrospective or (b) be explicitly labeled `status: first-seen-only` until a second recurrence justifies elevating it.

## Writing / updating a pattern doc

Trigger: a session retrospective surfaces a pattern that also appeared in an earlier session, OR the same bug class has been caught twice in a single session (as happened 2026-04-19 with the seam-recheck pattern).

Shape (see `TEMPLATE.md` — not yet written, use existing patterns as reference):

1. **Frontmatter** — `pattern`, `status`, `first-seen` / `last-seen` with session refs.
2. **Characterization** — what the pattern looks like when it bites. Symptoms, triggers.
3. **Sessions where seen** — back-links to `docs/sessions/YYYY-MM-DD-{slug}.md` with one-sentence recap of each instance.
4. **Canonical fix** — the right shape, with code example if applicable. Cite the fixing commit.
5. **Anti-patterns** — specific "common but wrong" responses to the pattern.
6. **Observability requirement** (optional) — what instrumentation exists / should exist to detect the pattern in the future.
7. **Related patterns** — cross-links within `docs/patterns/`.

## Index

- [ast-over-text-for-syntactic-invariants](ast-over-text-for-syntactic-invariants.md) — syntactic invariants should traverse AST nodes, not reason from text windows or regex surfaces.
- [in-memory-state-restart-data-loss](in-memory-state-restart-data-loss.md) — flags/maps/caches that reset on restart → correctness drift. First seen 2026-04-19 across 3 sites.
- [fetch-without-abortcontroller](fetch-without-abortcontroller.md) — outbound fetches that hang forever on silent socket drop. First seen 2026-04-19 (DeepSeek world-builder 7+ min hang).
