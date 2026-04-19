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
- **Status** — `planned` / `shipped` / `blocked-<reason>` / `allowlisted-<expiry>`
- **Allowlist** — temporary exceptions with expiry dates (if applicable)
- **Pattern doc** — `docs/patterns/<slug>.md` if elevated

## Status summary

| # | Name | Shape | Status |
|---|---|---|---|
| 1 | revisionUsed restart persistence | runtime | planned |
| 2 | Seam-recheck symmetry | syntactic | planned |
| 3 | Subscribe-before-start | syntactic | planned |
| 4 | Branch-symmetric event emission | runtime (narrow) | planned |
| 5 | Body-already-used detection | syntactic | planned |

**Ratio target:** within 3-5 sessions after invariants ship, `bugs_caught_by_preflight` should catch up to or exceed `bugs_caught_by_codex` on the recurring bug classes named below. If the ratio doesn't move, invariants are theater — re-evaluate the shapes.

---

## Planned invariants (5)

### 1. revisionUsed restart persistence

- **Shape:** runtime
- **Catches:** Fire-and-forget DB write race. In-memory guards that must survive restart but don't get awaited. Instance: commit `0c9fa3b` fixed via await-then-flip; caught by Codex thread `aad6d3503db164b1f` HIGH A.
- **Assertion:** For any (novel_id, chapter_number), across the full drafting lifetime (including mid-run process restarts), `chapter_revisions` must contain AT MOST ONE row with `outcome != 'skip_already_revised'` and `outcome != 'skip_duplicate_sig'` and `outcome != 'skip_no_beat_state'`. If this invariant fires, the reviser hard cap was violated.
- **Implementation:** planned — integration test in `src/phases/drafting-revision-used-persistence.test.ts` should extend to cover the restart case (kill process mid-reviser-call, resume, assert zero double-fires).
- **Status:** planned
- **Pattern doc:** `docs/patterns/in-memory-state-restart-data-loss.md`

### 2. Seam-recheck symmetry

- **Shape:** syntactic (AST walk)
- **Catches:** Missed recheck sites for DEBUG_FORCE_* env injection. Instances: commits `fed9e4a` (plan-check settle-loop recheck missed) + `4ad2413` (validation settle-loop recheck missed). Both shipped; both caught only after the next session's forced-flag campaign revealed them.
- **Assertion:** In `src/phases/drafting.ts`, every branch that reads `inject.forceXxx` (where `Xxx` ∈ `PlanCheck`, `Validation`, `Reviser`) must appear at ALL sites where the corresponding check runs — including initial invocation AND every recheck inside a settle loop. AST rule: find all call sites of `chapter-plan-checker` / `validateChapterDraft` / `chapter-plan-reviser`; for each, assert the surrounding 10-line block contains a matching `inject.forceXxx` guard OR the block is explicitly annotated `// @noninjectable`.
- **Implementation:** planned — `scripts/lint/invariants-check.ts` + use `@typescript-eslint/parser` or Bun's built-in AST traversal.
- **Status:** planned

### 3. Subscribe-before-start

- **Shape:** syntactic (lint)
- **Catches:** SSE race where events fire before watcher attaches. Instance: commits `f1f844f` + later `0c9fa3b` fixed the R3/R4 race. The original R3/R4 harness subscribed AFTER the POST /start, so early events were missed.
- **Assertion:** In `scripts/test/**/*.ts`, for any function where `apiPost("/api/novel/start", ...)` or `startNovel(...)` is called, the SAME function must also call `watchForExpectations(...)` or `watchForTerminal(...)` or `subscribeSSE(...)` BEFORE the start POST. Lint rule: reverse-control-flow — for each `startNovel` call, walk up the AST and verify a watcher-attach call precedes it in the same function scope.
- **Implementation:** planned — same `scripts/lint/invariants-check.ts`.
- **Status:** planned

### 4. Branch-symmetric event emission

- **Shape:** runtime (narrow)
- **Catches:** Asymmetric event emission between auto-mode and web-mode branches. Instance: commit `a2118e1` fixed auto-mode `gate:plan-assist` silence (the event fired on web branch but not auto branch because of a Promise-constructor ordering bug).
- **Assertion:** Narrow scope — NOT a global symmetry proof. For each named state transition in a whitelist (initially: plan-assist gate fire, validation settle exit, drafting-complete), both auto-mode and web-mode execution paths must emit the same trace event type with structurally-comparable payloads. Integration test: run a forced scenario in both modes, diff the `pipeline_events` stream, assert the event-type sequence matches.
- **Implementation:** planned — extend `src/phases/drafting-reviser-escalation.test.ts` with a mode-parameterized variant.
- **Status:** planned

### 5. Body-already-used detection

- **Shape:** syntactic (regex / lint)
- **Catches:** Fetch/Response body consumed twice. Instance: commit `5505985` fixed a template-literal that eagerly called `await X.text()` before `await X.json()` on the same Response.
- **Assertion:** In any `.ts` file, if a Response-typed variable `X` has `await X.text()` in its scope, then `await X.json()` / `await X.arrayBuffer()` / `await X.blob()` on the same `X` must NOT appear after it. Equivalent for any ordering of two body-consuming calls. Regex approximation: find `\$\{await\s+(\w+)\.(text|json|arrayBuffer|blob)\(\)\}` followed later by `await\s+\1\.(text|json|arrayBuffer|blob)\(\)`.
- **Implementation:** planned — `scripts/lint/invariants-check.ts` regex pass. AST version deferred (regex catches 95% of real cases).
- **Status:** planned

---

## Future candidates (not yet prioritized)

From `docs/codex-preamble.md` FAILURE_CLASSES list; these are known bug classes without a recurrence count ≥2 yet, so they don't have a scheduled invariant. Elevate when they recur.

- **Retry-path truth** — every timeout/network failure must enter retry, no fast-fail branches. (Shape: probably runtime + syntactic combo.) Candidate trigger: add when a bug in this class ships.
- **Replayable observability** — don't use persisted trace events as "happened after X" signals if the stream replays history on connect. (Shape: syntactic — lint on `watchForExpectations` usage that matches trace-event types.) First instance shipped today (R3 race); waiting for recurrence before elevating.
- **Target-runtime state validation** — probe target process's env/state directly; don't trust `process.env` for orchestrator state. (Shape: syntactic — lint on `process.env.DEBUG_FORCE_*` reads in test scripts, require a matching `/api/health/debug-flags` probe in the same function.) First instance: experiment #238 FAIL.
- **Fail-open coverage** — matcher, applyAction, AND enrichment errors all need try/catch. (Shape: AST walk on `src/debug/transport-interceptor.ts` + `src/llm.ts`.) First instance shipped today (Codex thread `a1f0d145132145414` M1); waiting for recurrence.

---

## Allowlist format

When an invariant must be temporarily bypassed (e.g., a legitimate edge case that's too narrow to encode in the check), add an entry here:

```yaml
- invariant: "Subscribe-before-start"
  file: "scripts/test/exhaustion-auto-campaign.ts"
  line: 42
  reason: "This test intentionally starts a novel without a watcher to prove the handler stays quiet — expected to fail the invariant by design."
  added: "YYYY-MM-DD"
  expires: "YYYY-MM-DD"  # Hard 30-day max; renew or refactor by then
  owner: "<github-handle>"
```

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
