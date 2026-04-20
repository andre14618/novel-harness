---
ticket: T2 — refactor 4 invariant #5 callsites
experiment: 245
parent: 243
may_be_subsumed_by: 244 (T1)
status: planning
created: 2026-04-19
---

# Plan — Refactor 4 invariant #5 callsites (`if (!res.ok) throw … ${await res.text()}`)

## Goal
Rewrite each of the 4 callsites currently covered by allowlist entries so the `.text()` call is moved OUT of the template-literal-inside-throw shape. After this ticket, the invariant #5 regex has **zero** legitimate false positives at HEAD, and the allowlist entries can be removed.

## Non-goals
- No change to the invariant #5 detector itself (that's T1). If T1 ships first, this ticket is partially subsumed but the refactor still has merit as code-hygiene (the extracted-text variable pattern is more readable).
- No behavior change — the refactored sites must produce identical error messages and side effects.

## Explicit relation to T1
If T1 (exp #244) ships first and the AST detector correctly recognizes the throw short-circuit, the 4 allowlist entries can be removed without this refactor. T2 becomes purely a code-style ticket with no invariant-delta.

Codex plan-triage should rule on whether this ticket is (a) subsumed by T1 and should be closed WONTFIX, (b) worth shipping as pure hygiene, or (c) needed as defense-in-depth if T1's detector is incomplete.

## Exit criteria
1. All 4 callsites rewritten:
   - `src/db/embed.ts:46-50`
   - `scripts/finetune/archetype-poc/flatten-deepseek.ts:66-67`
   - `scripts/corpus/test-deepseek-dialogue.ts:79-80`
   - `scripts/hallucination/smoke-eval.ts:41-42`
2. `.claude/invariants-allowlist.yaml` — the 4 body-already-used entries removed.
3. `bun scripts/lint/invariants-check.ts` — exits 0 with zero allowlisted entries.
4. Error messages at each site are structurally equivalent (same status code, same body text in the error message). Unit coverage exists at none of these sites; manual inspection of the error-construction code in the diff is the verification.
5. Codex implementation review verdict RESOLVED / PASS.

## Refactor pattern

Before:
```ts
if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
const json = await res.json()
```

After:
```ts
if (!res.ok) {
  const errText = await res.text()
  throw new Error(`${res.status}: ${errText}`)
}
const json = await res.json()
```

The `.text()` call is moved to a `const errText` statement INSIDE the `if` branch, outside the template literal. The regex `/\$\{await\s+(\w+)\.(text|json|arrayBuffer|blob)\(\)\}/` no longer matches, because the template literal no longer contains the await-call.

Net effect: identical runtime behavior (still only reads body on error path, throws with the same message content), but the invariant #5 regex no longer sees the template-literal idiom.

## File ownership slices

### Slice A — 4 callsite refactors + allowlist removal (GREEN, single subagent or Claude main)
**Files:**
- EDIT `src/db/embed.ts` — refactor the one site.
- EDIT `scripts/finetune/archetype-poc/flatten-deepseek.ts` — refactor.
- EDIT `scripts/corpus/test-deepseek-dialogue.ts` — refactor.
- EDIT `scripts/hallucination/smoke-eval.ts` — refactor.
- EDIT `.claude/invariants-allowlist.yaml` — remove the 4 entries; keep schema doc + commented example.

### Slice B — registry update (GREEN, trivial)
- EDIT `docs/invariants.md` — remove the allowlist reference from the #5 entry. Update #5 implementation note to state "as of T2 / exp #245, no HEAD allowlist entries."
- EDIT `docs/todo.md` — mark the 2nd follow-up (refactor allowlist-4) as DONE.

## Green / red split
- **Green** — mechanical, low risk. Each callsite is a local 3-line rewrite. No type changes, no behavior changes, no cross-file coupling.

## Risks + mitigations
- **Side-effect ordering** — in the Before shape, `await res.text()` is evaluated eagerly inside the template, synchronously within the `throw new Error(...)` expression. In the After shape, `await errText` resolves first, then `throw new Error(...)` runs with a plain string. Same net effect (one await, then throw); no observable difference.
- **Subsumption by T1** — if T1 lands first and correctly handles the throw short-circuit, these 4 refactors are purely cosmetic. Codex should rule on whether T2 still ships.
- **Scope creep** — no broader refactor (e.g. extracting a shared `fetchJson` helper) is in scope for this ticket. That would be a separate, larger ticket.

## Commit chain (anticipated)
1. `[fix] refactor 4 callsites away from ${await res.text()}-in-throw idiom (exp #245)` — Slice A.
2. `[docs] remove #5 allowlist reference, mark T2 follow-up DONE (exp #245)` — Slice B.

## Codex sequencing
- Phase 2 triage: ALSO consider the T1/T2 subsumption question — Codex should say whether T2 should proceed given T1 is in flight.
- Phase 3 full review: pattern-check each of the 4 refactors for equivalent behavior.
- Phase 6 impl review: **hot tier** (leaf-local, behavior-preserving edits).
