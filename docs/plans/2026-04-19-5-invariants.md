---
ticket: 5-invariants-implementation
experiment: 243
parent: 242 (registry)
status: planning
created: 2026-04-19
---

# Plan — 5 starting invariants

## Goal
Ship blocking preflight implementation for the 5 invariants in `docs/invariants.md`, with a known-bad fixture per invariant to prove each one fires.

## Non-goals
- No new invariants (candidates stay in "Future candidates").
- No retroactive fix for existing code the invariants might flag — if HEAD fails invariant X, the fix goes in a separate ticket (document and allowlist with 30-day expiry).
- No changes to the existing `.test.ts` files' module-mock boilerplate — only new test cases / new file.

## Exit criteria
1. `bun scripts/lint/invariants-check.ts` exits 0 on HEAD (all syntactic invariants green or allowlisted with expiry).
2. `bun test src/phases/drafting-reviser-escalation.test.ts src/phases/drafting-revision-used-persistence.test.ts` passes including the new invariant cases.
3. Each of the 5 invariants has a companion known-bad fixture under `tests/invariants-fixtures/` — running the checker against the fixture proves the check FIRES with an expected diagnostic.
4. `.claude/invariants-allowlist.yaml` exists (empty list is fine); loader rejects past-expiry entries.
5. Preflight wrapper `scripts/preflight.ts` runs the bundle and exits non-zero on any failure.
6. Registry entries flipped `planned → shipped` in `docs/invariants.md`, status table updated.
7. Codex implementation review verdict PASS (or PASS-WITH-MINOR on LOW-only findings).

## File ownership slices

### Slice A — syntactic checker + allowlist (GREEN, single subagent)
**Owner:** subagent A
**Files:**
- CREATE `scripts/lint/invariants-check.ts` — Bun CLI, walks source via TypeScript compiler API (already a dependency via `bunx tsc`), runs invariants #2, #3, #5. Exit 0 on green, 1 on failure.
- CREATE `.claude/invariants-allowlist.yaml` — empty list with a commented schema example.
- CREATE `tests/invariants-fixtures/seam-recheck-asymmetry.ts` — known-bad snippet that invariant #2 catches.
- CREATE `tests/invariants-fixtures/watcher-missing.ts` — known-bad script that invariant #3 catches.
- CREATE `tests/invariants-fixtures/body-already-used.ts` — known-bad snippet invariant #5 catches.
- CREATE `tests/invariants-fixtures/README.md` — 5-line note: these files are intentional invariants failures, excluded from preflight scan, only fed to the checker via `--target` flag for self-test.

### Slice B — runtime invariants via extension tests (GREEN, single subagent)
**Owner:** subagent B
**Files (registry says "extend existing," honor that):**
- EDIT `src/phases/drafting-revision-used-persistence.test.ts` — add Invariant #1 test case: simulate process-restart between reviser-fire and outcome-log, assert DB-write count stays at exactly 1. New test block only; leave existing tests untouched.
- EDIT `src/phases/drafting-reviser-escalation.test.ts` — add Invariant #4 mode-parameterized test: force plan-assist gate fire in both auto and web modes via existing module-mock shape, capture `emit()`'d events, assert event-type sequences are identical. New test block only.
- No new files under `src/invariants/`; the skill doc's reference to `src/invariants/` is aspirational for a shared assertion library, which this ticket does not need — tests are self-contained via the existing mock shape.

### Slice C — preflight wiring + registry flip (RED after A+B land)
**Owner:** Claude main
**Files:**
- CREATE `scripts/preflight.ts` — wrapper that runs, in order: `bun test src/` → `bunx tsc --noEmit` → `bun scripts/lint/invariants-check.ts` (default scan) → `bun scripts/lint/invariants-check.ts --self-test` (known-bad fixture rot check). Aggregates exit codes, prints summary, exits non-zero on any failure. No migration-path test yet (no sql/ changes in this ticket).
- EDIT `docs/invariants.md` — flip status column for all 5 entries `planned → shipped`, add implementation file paths.
- EDIT `.claude/skills/implement-ticket.md` Phase 5 — add `bun scripts/preflight.ts` as the canonical invocation.
- EDIT `docs/todo.md` — mark priority #1 done with commit refs.

## Green / red split
- **Green** (speculative dispatch OK): Slices A + B — disjoint paths (A: new files under `scripts/lint/` + `tests/invariants-fixtures/`; B: additive test blocks inside existing `src/phases/drafting-*-persistence.test.ts` and `drafting-reviser-escalation.test.ts`). No shared types, no runtime changes to `src/phases/drafting.ts`.
- **Red** (waits for Codex PASS): Slice C — touches the canonical registry doc + skill doc. Wait for Phase 3 green verdict before flipping status column.

## Invariant-specific implementation notes

### #1 — revisionUsed restart persistence (runtime)
- Existing test covers (a) fresh chapter and (b) resumed chapter paths; what's missing is the race between "reviser fires" and "logRevision records outcome" being severed by a simulated process exit.
- New test strategy: mock `setRevisionUsed` to resolve, mock `callAgent` (reviser) to resolve with a normal revised plan, then DROP the current drafting iterator (simulating process death) before `logRevision` resolves. Re-enter drafting with `isRevisionUsedInitial = true`. Assert: only the skip_already_revised path fires on the second entry.
- This is already the DB-backed init's intended behavior — the test is a regression belt.

### #2 — Seam-recheck symmetry (syntactic AST)
- Walk `src/phases/drafting.ts` with TypeScript compiler API (`ts.createSourceFile` + `ts.forEachChild`).
- For each CallExpression where callee is `callAgent` and the `agentName` property is `chapter-plan-checker` / `chapter-plan-reviser`, OR where the expression is `validateChapterDraft(...)`:
  - **Block-aware check, not 10-line window.** Walk upward from the call site through `Block` ancestors within the enclosing function body. For each ancestor block, scan for a reference to the matching `inject.forceXxx` identifier. PASS if any ancestor block contains the guard OR if the CallExpression line has a `// @noninjectable` comment (±2 lines).
  - The 10-line heuristic from the registry body is a simplification; the implementation uses ancestor-block containment because the real surrounds in `drafting.ts` span 30+ lines (e.g. the plan-check initial call at `drafting.ts:425-430` is paired with the `inject.forcePlanCheck` guard at `:470`, ~40 lines down — same enclosing `for-of ch` loop body).
- Expected passing sites based on actual file shape (Codex thread `a105b9c01649eccfd` Q1 grounded the count): 6 — `callAgent("chapter-plan-checker")` at `425-430` + `611-617`; `validateChapterDraft` at `443-448` + `926`; `callAgent("chapter-plan-reviser")` at `680-686` + `1001-1007`.
- Known-bad fixture: a copy of a 60-line excerpt with one site's `inject.force*` guard deleted; checker must flag it.
- Allowlist support: yaml entry with `file + line + reason + expires` exempts a specific site.

### #3 — Trace-seeded watcher (syntactic)
- Walk `scripts/test/**/*.ts` functions. For each FunctionDeclaration / ArrowFunction / MethodDeclaration:
  - Scan body for: `startNovel(` calls OR `apiPost("/api/novel/start"` calls.
  - If found, scan same body for trace/SSE event evidence. **Detection surface broadened per Codex thread `a105b9c01649eccfd` Q2:**
    - Event-type literal prefixes: any string literal matching `/^(gate:|phase:|llm-call-|trace$|error$|done$)/` (covers `"gate:plan-assist"`, `"phase:changed"`, etc.).
    - Property accesses in {`.eventType`, `.type`, `.data`, `.chapter`, `.agent`} off identifiers that look event-shaped (`event`, `e`, `evt`, `gateEvent`, `sseEvent`, or any name ending in `Event` / `Evt`).
    - Optional-chain forms (`e.data?.eventType`, `gateEvent?.data.chapter`) treated same as plain property access.
    - Direct fetches of `/api/novel/:id/events` or `/trace` endpoints also count as event-consumption evidence.
  - If BOTH (startNovel call) AND (event-consumption evidence) are present, body MUST contain one of: `watchForExpectations(` / `watchForTerminal(` call.
- Known-bad fixture: script that calls startNovel + fetches `/api/novel/:id/events` directly without the helper.

### #4 — Branch-symmetric event emission (runtime narrow)
- **Test surface corrected per Codex thread `a105b9c01649eccfd` Q4:** the real auto-vs-web divergence lives in `src/cli.ts:179-222 presentForExhaustion` + the module-level `resolverMode` state, NOT a `pipeline.mode` toggle. The prior spec would have missed the `a2118e1` class of bug.
- Implementation strategy:
  - Extend `drafting-reviser-escalation.test.ts`. Do NOT mock `../cli` (the existing tests' override is for the escalation path; the new test needs the real `presentForExhaustion` to branch on resolverMode). Instead mock `../gates` to capture `requestPlanAssist` emit-events and return a canned decision.
  - Add mock `emit()` in `../events` that records `{type, data}` tuples.
  - Test 1: call `setResolverMode("auto")`, drive drafting to the plan-assist fire path, catch the thrown `PipelineBailError`, record the sequence of captured emit events + gates-requestPlanAssist payload.
  - Test 2: call `setResolverMode("web")`, same driver, have the mocked gate resolve with `{action: "abort"}`, record events.
  - Assert: event-type sequences are structurally identical (ignore payload details like timestamps; compare `events.map(e => e.type).join("|")`).
- The assertion is narrow (plan-assist gate fire only). Adding validation-settle-exit and drafting-complete transitions is deferred to a future ticket.

### #5 — Body-already-used (regex)
- **Scope narrowed per Codex thread `a105b9c01649eccfd` Q3.** The regex detects ONLY the template-literal-within-log/assert shape that commit `5505985` fixed. The broader "any two body-consuming calls on same Response" rule is AST-scoped and deferred to a future ticket.
- Regex: `/\$\{await\s+(\w+)\.(text|json|arrayBuffer|blob)\(\)\}/` captures the variable + method; look later in same function scope for `await $VAR.(text|json|arrayBuffer|blob)()` where $VAR matches and method differs from the first call.
- Approximate scope: find the first occurrence, search within the following ~80 lines of the same file until closing `}` depth returns to the enclosing function.
- **Known false-negative documented in-code:** non-template-literal double-consumes (e.g. `src/db/embed.ts` and `scripts/fork-writer-test.ts` patterns Codex surfaced) are NOT caught by this regex. A comment in `invariants-check.ts` + in this plan explicitly notes the gap so the next maintainer knows what's deferred.
- Known-bad fixture: the pre-`5505985` shape — `assert(\`decide ${await decideR.text()}\`); const body = await decideR.json()`.

## Risks + mitigations
- **AST churn**: TypeScript compiler API is verbose. Mitigate: both AST-using subagents can fall back to a regex-first pass; document the regex approximation in code comments. An AST upgrade is a future ticket.
- **Known-bad fixture contamination + rot** (per Codex thread `a105b9c01649eccfd` Q5): these files intentionally violate invariants. Checker MUST exclude `tests/invariants-fixtures/**` from its default scan. Prevent silent rot by adding a **self-test mode**: `scripts/lint/invariants-check.ts --self-test` runs the checker against each fixture file expecting a specific failure; exits 0 iff every fixture fires its expected invariant. Preflight wrapper (`scripts/preflight.ts`) invokes BOTH the default scan AND `--self-test` so rot surfaces immediately.
- **Allowlist fail-open risk**: per registry, fail-CLOSED on missing file. Loader returns empty-array not missing-entry when file absent. Verified in Slice A.
- **Scope creep**: NO retroactive fixes. If HEAD currently fails invariant X, document with a 30-day-expiry allowlist entry and open a separate ticket. Invariants ship first; cleanups follow.

## Commit chain (anticipated)
1. `[lint] scripts/lint/invariants-check.ts + allowlist + fixtures (exp #243)` — Slice A
2. `[test] extend drafting persistence/escalation tests — invariants #1 + #4 (exp #243)` — Slice B
3. `[scripts] preflight wrapper bundling tsc + bun test + invariants (exp #243)` — Slice C preflight only
4. `[docs] flip invariants registry planned → shipped + skill Phase 5 pointer (exp #243)` — Slice C docs
5. `[fix] Codex review <thread> — <N> findings` (if review flags anything)

## Codex sequencing
- Phase 2 triage: plan bullets + file list + exit criteria only. Expect `green` given disjoint new-file additions + pre-existing test scaffolding pattern.
- Phase 3 full review: blocker/non-blocker only. Blockers likely around AST-vs-regex correctness on invariant #2 or #3.
- Phase 6 implementation review: cold tier (cross-cutting preflight wiring, multi-file).
