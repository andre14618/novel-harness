---
status: active
updated: 2026-04-19
---

# Invariants registry

Canonical home for structural-property checks that run as part of the preflight bundle (per `.claude/skills/implement-ticket.md` Phase 5). An invariant is a claim that's always true in a running system — a rule the code promises to maintain. When an invariant fails, a class of bug just shipped.

**Source of truth:** this file. Every other mention of invariants in the repo (skill doc, session handoff, Codex preamble) should point here. If you find inline lists elsewhere, they're drifted — either delete them or replace with a link.

**Why this matters:** today (2026-04-19) the ratio of `bugs_caught_by_codex : bugs_caught_by_preflight` was 9:1. Codex is $0.50-1.00 per review cycle; preflight is free. Every invariant shipped permanently rebalances that ratio toward preflight.

## Shape taxonomy

An invariant has one of four shapes. Shape determines cost + coverage tradeoffs.

| Shape | Check mechanism | Cost | Best for |
|---|---|---|---|
| **Syntactic** | AST walk / regex / lint rule over source files | ~milliseconds | Structural patterns visible in the code itself (e.g. "every DEBUG flag has N call sites"). |
| **Runtime** | Assertion fires during test execution | Seconds (test wall-clock) | Properties that only manifest during execution (e.g. "at most one row per X across process lifetime"). |
| **Cross-state** | Query against persisted state (DB, filesystem, etc.) | ~seconds (query cost) | Consistency between two stores (e.g. "if flag=TRUE then row exists in Y"). |
| **LLM-check** | Fast model (Haiku / Cerebras Qwen 235B / DeepSeek V3.2) judges a diff | ~2-5 seconds, $0.001-0.01 | Semantic patterns regex can't phrase (e.g. "does this diff access a Response body twice"). |

LLM-check is the newest shape, not yet implemented. Plan: ships as a script that takes a diff on stdin + a prompt template, returns PASS/FAIL. Same three-layer logic as the content checkers (adherence/hallucination/chapter-plan) — narrow tasks, small models, OR-gated.

## Entry schema

Each invariant gets an entry below with:

- **Name** — short, grep-able
- **Shape** — syntactic / runtime / cross-state / LLM-check
- **Catches** — bug class; 1+ commit SHAs of instances
- **Assertion** — the exact rule
- **Implementation** — file path (or `planned` / `blocked`)
- **Status** — `planned` / `shipped` / `blocked-<reason>` (allowlist entries are file/line-scope exceptions under a still-shipped invariant; see Allowlist section)
- **Allowlist** — temporary exceptions with expiry dates (if applicable)
- **Pattern doc** — `docs/patterns/<slug>.md` if elevated

## Status summary

| # | Name | Shape | Status |
|---|---|---|---|
| 1 | revisionUsed restart persistence | runtime | shipped (exp #243, `src/phases/drafting-revision-used-persistence.test.ts`) |
| 2 | Seam-recheck symmetry | syntactic | shipped (exp #243, `scripts/lint/invariants-check.ts` + `tests/invariants-fixtures/seam-recheck-asymmetry.ts`) |
| 3 | Trace-seeded watcher for post-start event assertions | syntactic | shipped (exp #243, `scripts/lint/invariants-check.ts` + `tests/invariants-fixtures/watcher-missing.ts`) |
| 4 | Branch-symmetric event emission | runtime (narrow) | shipped (exp #243, `src/phases/drafting-reviser-escalation.test.ts`) |
| 5 | Body-already-used detection | syntactic | shipped (exp #243; widened to AST exp #244, `scripts/lint/invariants-check.ts` + `tests/invariants-fixtures/body-already-used{,-sequential,-json-first}.ts`) |

**Ratio target:** within 3-5 sessions after invariants ship, `bugs_caught_by_preflight` should catch up to or exceed `bugs_caught_by_codex` on the recurring bug classes named below. If the ratio doesn't move, invariants are theater — re-evaluate the shapes.

---

## Planned invariants (5)

### 1. revisionUsed restart persistence

- **Shape:** runtime
- **Catches:** Fire-and-forget DB write race. In-memory guards that must survive restart but don't get awaited. Instance: commit `0c9fa3b` fixed via await-then-flip; caught by Codex thread `aad6d3503db164b1f` HIGH A.
- **Assertion:** For any (novel_id, chapter_number), across the full drafting lifetime (including mid-run process restarts), `chapter_revisions` must contain AT MOST ONE row with `outcome != 'skip_already_revised'` and `outcome != 'skip_duplicate_sig'` and `outcome != 'skip_no_beat_state'`. If this invariant fires, the reviser hard cap was violated.
- **Implementation:** shipped at `src/phases/drafting-revision-used-persistence.test.ts` → "Invariant #1: reviser-then-restart → total non-skip chapter_revisions writes stays at 1". Simulates process-restart between reviser-fire and outcome-log, asserts cumulative non-skip write count stays at exactly 1 across pre-restart and post-restart entries.
- **Status:** shipped (exp #243, commits `10ce979`)
- **Pattern doc:** `docs/patterns/in-memory-state-restart-data-loss.md`

### 2. Seam-recheck symmetry

- **Shape:** syntactic (AST walk)
- **Catches:** Missed recheck sites for DEBUG_FORCE_* env injection. Instances: commits `fed9e4a` (plan-check settle-loop recheck missed) + `4ad2413` (validation settle-loop recheck missed). Both shipped; both caught only after the next session's forced-flag campaign revealed them.
- **Assertion:** In `src/phases/drafting.ts`, every branch that reads `inject.forceXxx` (where `Xxx` ∈ `PlanCheck`, `Validation`, `Reviser`) must appear at ALL sites where the corresponding check runs — including initial invocation AND every recheck inside a settle loop. AST rule: find all call sites of `chapter-plan-checker` / `validateChapterDraft` / `chapter-plan-reviser`; for each, assert the surrounding 10-line block contains a matching `inject.forceXxx` guard OR the block is explicitly annotated `// @noninjectable`.
- **Implementation:** shipped at `scripts/lint/invariants-check.ts` `checkSeamRecheckSymmetry()`. Uses `typescript` compiler API to find call sites of `callAgent({agentName: "chapter-plan-checker"|"chapter-plan-reviser"})` and `validateChapterDraft(...)`, then checks whether any real AST node of shape `inject.forceXxx` exists within ±50 source lines of the call (comments and string literals excluded via AST-only matching). Regression belt: `tests/invariants-fixtures/seam-recheck-asymmetry.ts` with zero-guard recheck + comment-bypass trap line.
- **Status:** shipped (exp #243, commits `ce6452c` + `7afe4dd` + `dedc0b6`)
- **Pattern doc:** `docs/patterns/ast-over-text-for-syntactic-invariants.md`

### 3. Trace-seeded watcher for post-start event assertions

- **Shape:** syntactic (lint)
- **Catches:** SSE race where events fire before the watcher attaches. Instance: commits `f1f844f` + later `0c9fa3b` fixed the R3/R4 race. The current safe pattern does NOT require subscribing before `startNovel` — `scripts/test/lib/sse-watcher.ts` seeds the matcher chain from `GET /trace` BEFORE opening SSE (see `sse-watcher.ts:45-48,80-100`). What's unsafe is asserting on post-start events without using the trace-seeded helpers at all.
- **Assertion:** In `scripts/test/**/*.ts`, for any function that (a) calls `startNovel(...)` OR `apiPost("/api/novel/start", ...)` AND (b) makes assertions or match conditions referencing trace/SSE events (e.g. references to event-type strings `"gate:"`, `"trace:"`, `"llm-call-"`, `"phase-"`, `"error"`, `"done"`, or property accesses on `event.data` / `e.data` from an SSE stream), the SAME function MUST also call one of `watchForExpectations(...)` / `watchForTerminal(...)`. Direct `fetch()` against `/api/novel/:id/events` or raw `subscribeSSE` without the trace-seed preamble IS the race; require the helper.
- **Implementation:** shipped at `scripts/lint/invariants-check.ts` `checkTraceWatcher()`. AST walk over `scripts/test/**/*.ts`; detection surface: string literals matching `/^(gate:|phase:|llm-call-|trace$|error$|done$)/`, property/element access on event-shaped identifier names, direct fetches of `/events` or `/trace` endpoints. Regression belt: `tests/invariants-fixtures/watcher-missing.ts`.
- **Status:** shipped (exp #243, commit `ce6452c`)
- **Correction history:** original invariant draft required the watcher-attach to precede `startNovel` in control flow; that was wrong and would have flagged current safe production code (`exhaustion-web-campaign.ts:249-255, 367-373`, `organic-run-verify.ts:107-117`). Corrected per Codex review `ac669b6ed0fcf4109` HIGH.

### 4. Branch-symmetric event emission

- **Shape:** runtime (narrow)
- **Catches:** Asymmetric event emission between auto-mode and web-mode branches. Instance: commit `a2118e1` fixed auto-mode `gate:plan-assist` silence (the event fired on web branch but not auto branch because of a Promise-constructor ordering bug).
- **Assertion:** Narrow scope — NOT a global symmetry proof. For each named state transition in a whitelist (initially: plan-assist gate fire, validation settle exit, drafting-complete), both auto-mode and web-mode execution paths must emit the same trace event type with structurally-comparable payloads. Integration test: run a forced scenario in both modes, diff the `pipeline_events` stream, assert the event-type sequence matches.
- **Implementation:** shipped at `src/phases/drafting-reviser-escalation.test.ts` → "Invariant #4: plan-assist gate fires the same `gate:plan-assist` event in auto and web modes". Drives through REAL `src/gates.ts` (unmocked); auto mode catches real `PipelineBailError`, web mode polls the real pending-gate map then calls real `resolvePlanAssist()`. Assertion narrowed to `gate:plan-assist` emit parity with matching kind + chapter.
- **Status:** shipped (exp #243, commits `10ce979` + `7afe4dd`)

### 5. Body-already-used detection

- **Shape:** syntactic (AST)
- **Catches:** Fetch/Response body consumed twice. Instance: commit `5505985` fixed a template-literal that eagerly called `await X.text()` before `await X.json()` on the same Response.
- **Assertion:** In any `.ts` file, for any Response-like receiver `X` within a single function scope, at most one body-consuming call (`X.text()` / `X.json()` / `X.arrayBuffer()` / `X.blob()`) can execute on any real control-flow path. Any source-ordered pair of body-consuming calls on the same receiver is a violation, regardless of which method comes first — unless the first call is inside a control-flow branch (if/else/try/catch) that unconditionally terminates via throw/return/continue/break before reaching the second.
- **Implementation:** shipped at `scripts/lint/invariants-check.ts` `checkBodyAlreadyUsed()`. AST walk using the `typescript` compiler API: collects every body-consuming call, groups by `(enclosingFunction, receiverDeclaration)` — tracked by the binding's declaration-node identity, not name-string, so shadowing doesn't mis-group — with `(enclosingFunction, receiverShape)` as fallback for unresolvable receivers, then flags any source-ordered pair whose branch-containing-first does NOT always terminate. Reachability heuristic recognizes throw / return / continue / break as terminators; try-blocks terminate iff both `try`-last and `catch`-last statements terminate; `switch`-statements terminate iff every case arm (including `default`) terminates. Receivers that construct fresh objects at the call site (`new Response(...).text()`, `(await fn()).text()`) are excluded from grouping. Regression belt: `tests/invariants-fixtures/body-already-used.ts` (template-literal shape), `body-already-used-sequential.ts` (plain sequential double-consume), `body-already-used-json-first.ts` (ordering-symmetry `.json()` → `.text()`). Loop-statement terminators (T4, exp #247, Codex threads `a624cc89` / `aef73a30a2a74ce51`): `while (true) { ... }`, `for (;;) { ... }`, and `do { ... } while (cond)` are now recognized as terminal when (a) the body unconditionally exits the function AND (b) no `break`/`continue` inside the body targets that loop (switches capture `break` but not `continue`; nested loops capture their own). For `do-while`, the classifier is body-only regardless of the trailing `while (cond)` because the body runs unconditionally once. Known deferred false negatives: `for (; true ;)` (only `condition === undefined` is recognized, not a literal-true header expression), truthy non-keyword conditions (`!0`, `1 === 1`, numeric `1`), labeled-break/continue resolution (conservatively treated as targeting the current loop), and receiver-alias tracking (`const b = a; b.text(); a.json()` — separate ticket). Exp #244 widened from template-literal regex; retired the 4 short-circuit-error-throw allowlist entries from `.claude/invariants-allowlist.yaml`.
- **Status:** shipped (exp #243, commit `ce6452c`); widened to AST detection (exp #244, 2026-04-19, commits `70f814d` + `b5cb37a` + `8cc3d2c`). Exp #245 closed as SUBSUMED by #244 per Codex triage `a0d7c3b5`. Loop-terminator extension shipped (exp #247, T4, 2026-04-19).
- **Pattern doc:** `docs/patterns/ast-over-text-for-syntactic-invariants.md`

---

## Future candidates (not yet prioritized)

From `docs/codex-preamble.md` FAILURE_CLASSES list; these are known bug classes without a recurrence count ≥2 yet, so they don't have a scheduled invariant. Elevate when they recur.

- **Retry-path truth** — every timeout/network failure must enter retry, no fast-fail branches. (Shape: probably runtime + syntactic combo.) Candidate trigger: add when a bug in this class ships.
- **Replayable observability** — don't use persisted trace events as "happened after X" signals if the stream replays history on connect. (Shape: syntactic — lint on `watchForExpectations` usage that matches trace-event types.) First instance shipped today (R3 race); waiting for recurrence before elevating.
- **Target-runtime state validation** — probe target process's env/state directly; don't trust `process.env` for orchestrator state. (Shape: syntactic — lint on `process.env.DEBUG_FORCE_*` reads in test scripts, require a matching `/api/health/debug-flags` probe in the same function.) First instance: experiment #238 FAIL.
- **Fail-open coverage** — matcher, applyAction, AND enrichment errors all need try/catch. (Shape: AST walk on `src/debug/transport-interceptor.ts` + `src/llm.ts`.) First instance shipped today (Codex thread `a1f0d145132145414` M1); waiting for recurrence.

---

## Allowlist

**Canonical file:** `.claude/invariants-allowlist.yaml` (gitignored? NO — committed, so exceptions are visible in code review; if we move to gitignored, we lose the review trail).

**Loader contract:** `scripts/lint/invariants-check.ts` reads this file at start. Each invariant's checker is passed the matching entries for its name; the checker decides how to honor them (skip the specific file/line, relax the rule, etc.). If the allowlist file is missing, the check runs with zero exceptions (fail-closed).

**Entry format:**

```yaml
- invariant: "Trace-seeded watcher for post-start event assertions"  # exact name match
  file: "scripts/test/exhaustion-auto-campaign.ts"
  line: 42                              # approximate; used for diagnostics, not matched exactly
  reason: "This test intentionally starts a novel without a watcher to prove the handler stays quiet — expected to fail the invariant by design."
  added: "YYYY-MM-DD"
  expires: "YYYY-MM-DD"                 # HARD 30-day max; renew or refactor by then
  owner: "<github-handle>"
```

**Expiry enforcement:** the loader rejects entries with `expires` in the past. Renewing requires an edit to the YAML + a fresh 30-day expiry + re-justification in `reason` (git blame is the audit trail).

**Status vocabulary note:** an invariant's status in the summary table is `planned | shipped | blocked-<reason>`. Individual allowlist entries live at file/line scope and do NOT make the invariant itself `allowlisted` — they're scoped exceptions under a still-shipped invariant. If EVERY instance of an invariant is allowlisted, delete the invariant instead.

Allowlist entries are a smell. Each one is either (a) a real edge case the invariant should be refined to accommodate, or (b) a bug waiting to happen under a different input. Don't accumulate them — refactor or narrow the invariant.

---

## How to add a new invariant

1. A class of bug recurs across 2+ sessions (elevation criterion for pattern docs; same criterion here).
2. Write the entry using the schema above. Put it in "Planned invariants" section.
3. Open a ticket per the skill doc workflow; implement in `scripts/lint/invariants-check.ts` or a new test file.
4. Wire into preflight bundle (`.claude/skills/implement-ticket.md` Phase 5) so failures HALT. Not debug-only — Codex review `ad350aa657ec1c9b1` Q6: non-blocking invariants become theater.
5. Move the entry from "Planned" to shipped + update the status table at the top.
6. If the underlying bug class has a `docs/patterns/<slug>.md`, cross-link.

## What this registry is NOT

- **Not a list of every possible bug.** Bugs that happen once and never again don't warrant invariants — fix the bug, don't write an invariant. Elevation criterion: 2+ recurrences.
- **Not a substitute for tests.** Tests verify specific scenarios; invariants verify structural properties. You want both.
- **Not a substitute for Codex review.** Codex catches novel reasoning and architectural judgment; invariants catch KNOWN classes. They're complementary.
- **Not a living design doc.** Add entries when invariants ship; edit entries when allowlists change. Don't turn this into a narrative.

## Related

- `.claude/skills/implement-ticket.md` Phase 5 — preflight bundle (includes invariants as blocking)
- `docs/patterns/` — class-of-bug patterns that precede invariants
- `docs/codex-preamble.md` — short failure-classes list Codex sees on every review
- Session telemetry fields `bugs_caught_by_codex` / `bugs_caught_by_preflight` / `preflight_false_positives` — the data to measure whether invariants are working
