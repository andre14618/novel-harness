---
ticket: T8 — portable invariants starter kit
experiment: 251
parent: 247
status: planning
created: 2026-04-19
tier: light (Codex-implement + mandatory Phase 6 review)
---

# Plan — Portable invariants starter kit for other Claude-orchestrated repos

## Goal
Extract the invariants system (registry + checker + allowlist + fixtures) into a drop-in bundle at `docs/portable/invariants-starter/` that another Claude-run repo can clone. Novel-harness-specific invariants (#1-#5) are NOT shipped; the bundle ships the *framework* + schema + one fully-worked example invariant so the target repo can copy the structure and add their own.

## Non-goals
- No duplication of invariants #1-#5 content. Those stay novel-harness-specific.
- No runtime changes to this repo. Pure additive `docs/portable/invariants-starter/` tree.
- No migration of `workflow-portable.md` (existing path preserved).
- No separate repo extraction. Lives inside novel-harness until a second project actually uses it and we see what drifts.

## Exit criteria
1. NEW dir `docs/portable/invariants-starter/` with 6 files (all suffix `.template` to signal "copy + customize"):
   - `README.md` — how to use this bundle. ~60-100 lines. Explains: copy these files into target repo, rename `.template` → proper extensions, customize the `[CUSTOMIZE]` blocks, run `bun scripts/preflight.ts` (or equivalent).
   - `invariants.md.template` — registry template. Shape taxonomy + entry schema + status table (empty) + allowlist section + elevation criteria. ~100 lines. Redacts novel-harness names; uses `[CUSTOMIZE]` placeholders.
   - `invariants-check.ts.template` — generic checker framework. The structural skeleton: CLI args, file walker, fixture runner, allowlist integration, `exitsFunction` helper (already portable per T4/T7 design), but WITHOUT the seam/watcher/body-consume checks (those are novel-harness-specific). Target repo fills in `checkXxx()` functions for their own invariants. ~300-400 lines.
   - `invariants-allowlist.ts.template` — loader module. Reads YAML, rejects past-expiry, fail-CLOSED on missing. Unchanged from the novel-harness version; just `.template` suffix.
   - `invariants-allowlist.yaml.template` — empty `entries: []` + commented schema + example entry. Unchanged.
   - `fixtures/README.md.template` — explains fixture directory pattern + expected-invariant-failure comment convention.
2. NEW example invariant IN the starter kit — ONE fully-worked example (`body-already-used` — the AST-based detector from invariant #5) included as a reference implementation. Target repos can delete it once they have their own.
3. `docs/portable/invariants-starter/README.md` cross-links to `docs/workflow-portable.md` and to this repo's actual `docs/invariants.md` as a "real-world example of a filled-out registry."
4. `bun scripts/preflight.ts` passes on HEAD (no regression — pure additive docs).
5. Codex impl review PASS.

## File ownership slices

### Slice A — starter kit bundle (Codex-implement, single commit)
**Files (all NEW):**
- `docs/portable/invariants-starter/README.md`
- `docs/portable/invariants-starter/invariants.md.template`
- `docs/portable/invariants-starter/invariants-check.ts.template`
- `docs/portable/invariants-starter/invariants-allowlist.ts.template`
- `docs/portable/invariants-starter/invariants-allowlist.yaml.template`
- `docs/portable/invariants-starter/fixtures/README.md.template`

Scope rules for the Codex agent:
- Copy the structural skeleton of each source file in `scripts/lint/` and `docs/invariants.md` and `.claude/invariants-allowlist.yaml`. STRIP:
  - All novel-harness invariant definitions (#1-#5).
  - All references to `drafting.ts`, `chapter-plan-checker`, `Response.body`, `beat-checks`, etc.
  - All commit SHAs and Codex thread IDs (those are novel-harness history).
- PRESERVE:
  - Shape taxonomy (syntactic / runtime / cross-state / LLM-check) — repo-agnostic.
  - Allowlist schema (invariant, file, line, reason, added, expires, owner).
  - Elevation criterion (≥2 recurrences).
  - Fail-CLOSED allowlist semantics.
  - Self-test mode.
  - Fixture convention (`// expected-invariant-failure: <slug>` + `tests/invariants-fixtures/` dir).
- REPLACE with `[CUSTOMIZE]` blocks:
  - Repo-specific file paths (e.g. `src/phases/drafting.ts` → `[CUSTOMIZE — target file]`).
  - Specific agent names, event types, module names.
- ADD to `invariants-check.ts.template` ONE fully-worked example invariant: the `body-already-used` AST detector from invariant #5 (including `exitsFunction`, `collectBodyConsumeSites`, `containsBreakOrContinueTargeting`, `isLiteralTrue`). Call it out in the README as "delete this once you have your own invariants."

### Slice B — cross-link (trivial, part of Slice A commit)
- EDIT `docs/workflow-portable.md` — after Phase 0.5, add one line pointing at `docs/portable/invariants-starter/` for the invariants kit.
- EDIT `docs/invariants.md` — add a "Portable version" pointer at the top.

## Risks + mitigations
- **Drift between template and actual** — if novel-harness's `invariants-check.ts` evolves (T4 loop reachability did), the template stays stale. Mitigation: README explicitly marks the template as a point-in-time snapshot + dates it. Next refresh is a deliberate ticket, not automatic.
- **Example invariant bloat** — shipping ONE fully-worked example helps the target repo understand the pattern, but shipping too many turns the starter kit into a Trojan horse of novel-harness specifics. Mitigation: ONE example only, clearly labeled as reference + deletable.
- **Copy-paste errors in the stripped version** — Codex agent needs to faithfully strip novel-harness refs without breaking the framework. Mitigation: Codex impl review explicitly checks for leaked specifics.

## Codex sequencing (light tier)
- No plan-triage for this one (light tier, single ticket, user has priority use-case). Straight to Codex-implement.
- Phase 6 impl review MANDATORY (today's lesson). Review surface: did the stripper leave any novel-harness-specific name? Does `invariants-check.ts.template` still compile as a standalone unit (with `[CUSTOMIZE]` placeholders filled with reasonable defaults)?

## Commit shape
ONE commit: `[docs] T8 — portable invariants starter kit for other Claude-orchestrated repos (exp #251)`. Body cites exp #251 + user's tandem-repo use case + the bundle-1 vs bundle-2+ triage decision from today.
