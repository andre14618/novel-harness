---
status: retrospective
updated: 2026-04-19
duration: ~9 hours
commits: 38
subagents_spawned: ~12 (Codex reviews + Sonnet implementations + doc passes)
---

# Session retrospective — 2026-04-19 exhaustion-handler

## Section 1 — What shipped

The session delivered the non-blind-retry architecture for all three drafting-phase exhaustion paths, as specified in `docs/exhaustion-handler-design.md`. The five implementation steps (path C validation-driven reviser, plan-assist gate scaffolding, gate wire-in + UI stub, structured outline editor, `chapter_exhaustions` telemetry) shipped in commits `ce64e28..1d1b4e1`. On top of that, a debug-injection MVP (`src/config/debug-injection.ts` with `DEBUG_FORCE_*` env flags) and two campaign test runners were built to exercise every path without waiting for natural exhaustion events. The telemetry surface includes a new `chapter_exhaustions` table, `GET /api/novel/:id/exhaustions`, and an `ExhaustionsPanel` component. Operational fixes addressed a transport fetch hang (no-timeout on outbound LLM calls), SSE watcher race conditions, and stall-detection blind spots. The session closed with a Codex final-verdict review (thread `a252aecbb785a0eb3`): conditional pass, 78% confidence. Two gaps remained open: restart recovery for in-memory gate state and a clean no-forced-flags validation run. See `docs/next-session-plan.md` for the follow-on plan.

---

## Section 2 — Architectural iterations with supersession chains

### Chain A: Force-injection seam coverage

**Initial approach.** Commit `7d53dac` wired the debug-injection seams at the initial call sites in `src/phases/drafting.ts` — three explicit injection check points at the plan-check call, the validation call, and the reviser call. One force site per logical decision.

**Problem discovered.** Running the live campaign immediately exposed the gap: after a beat rewrite triggered by a forced-fail plan-check, the settle loop re-invoked the real `chapter-plan-checker` agent. The forced-fail result was gone; the real checker returned `pass=true`; the settle loop exited successfully. Chapter 1 completed normally under `DEBUG_FORCE_PLAN_CHECK=fail`, defeating the entire test. The injection was bypassed before the exhaustion handler path was ever reached.

**Superseded by.** Commit `fed9e4a` — "also force settle-loop recheck" — mirrored the same forced-fail at the recheck site at `drafting.ts:583-590`. Same class of bug was independently discovered on the validation settle-loop; commit `4ad2413` fixed that site (flagged by Codex seam-gap audit `a1e06c61f62e901e7` Q5).

**Codex verdict.** The V2 transport-interceptor design (specced in `docs/debug-injection-v2-spec.md`, authored by Codex thread `a892e3f5b4c79a3ea`) is the durable fix: inject at the transport layer once, cover every call path automatically.

**Lesson.** "One force site per agent" is not sufficient. Every path that re-enters a decision point — settle loops, retry branches, fallback rechecks — is a potential seam gap. Auditing every `callAgent({agentName: X})` site is the minimum; a transport-level interceptor is the ceiling.

---

### Chain B: Test runner feedback loop

**Initial approach.** The first campaign runner in `7d53dac` polled `GET /api/novel/:id/state` on a fixed interval, waiting for `active=false && lastRunError != null`. Timeout set to 3 minutes.

**Problem discovered.** Real DeepSeek calls on concept/planning push a 1-chapter attempt to 5–15 minutes wall-clock. Every test false-failed before the architecture had a chance to be exercised. Timeout was bumped to 25 minutes in `c52c47e`. Still: the runner was blind. It had no visibility into which stage the pipeline was at, so a stall and a slow-but-working run looked identical.

**Superseded by SSE watcher.** Commit `59f8fff` replaced the polling approach with an SSE-based runner (`scripts/test/exhaustion-web-campaign.ts`) that subscribes to the novel's event stream and uses structured `plan-check-outcome` and `validation-check-outcome` trace events to fast-fail. Stall detection added in `2784dd5` (30s log + 5min hard-abort); detection interval tightened to 10s in `40aaf0a`.

**Superseded by heartbeat.** Slow-but-working LLM calls (concept and checker agents don't stream) still looked like stalls. Commit `dcd9c4a` added an `llm-in-flight` heartbeat that emits every 5s during any LLM call, giving the watcher liveness signal distinct from a genuine stall.

**Additional supersession.** The outer fetch had no timeout; a silently-dropped provider socket left the call hung forever. Commit `0e9b24d` added `AbortController` with a 5-minute timeout — but as Codex review `ab530b43a6716d937` found, the `AbortError` propagated before the 429/5xx retry guard, so timeouts failed fast with zero retry. Commit `83772dd` wrapped the fetch in try/catch so abort and network errors enter the retry backoff like any other transient failure.

**Lesson.** The feedback loop is the architecture. A test runner that can't distinguish "pipeline passed this gate" from "pipeline is stuck here" is worse than no test — it wastes 3-25 minutes per iteration while hiding whether anything is actually broken.

---

### Chain C: Auto-mode gate semantics

**Initial approach.** Commit `2f012de` wired the `gate:plan-assist` SSE emit and trace call inside the Promise constructor body in `src/gates.ts`. This body only executes when `gate.mode === "web"`. The auto-mode path throws `PipelineBailError` before reaching the constructor body.

**Problem discovered.** Codex review `a2d16769d75b1d9cc` (Q10a, BLOCKER): in auto mode, the SSE event never fires. Any auto-mode test runner subscribed to `gate:plan-assist` waits forever. All auto-mode R1/R7 tests would have hung indefinitely.

**Superseded by.** Commit `a2118e1` — hoisted the `emit(gate:plan-assist)` and `trace(plan-assist-wait)` calls OUT of the Promise constructor, making them execute synchronously at the function entry point, before any branching. Auto mode now emits the event, then throws `PipelineBailError`. Web/CLI mode emits the same event, then awaits resolution.

**Lesson.** Cross-cutting SSE event emission should live at the function entry point, not inside conditional code paths that some callers never reach. Single emission point, then branch. Bugs in this pattern are invisible to tests that only exercise one of the branches.

---

### Chain D: Transport fetch hang and retry contract

**Initial approach.** The original `src/transport.ts` had no timeout on outbound LLM fetches. Commit `0e9b24d` added `AbortController` with a 5-minute timeout and claimed in the commit message that "aborts flow through the 429/5xx retry loop."

**Problem discovered.** Codex review `ab530b43a6716d937` (Q2, correctness bug): the claim was wrong. The control flow path was:

```
fetch() → AbortError thrown → propagates out of the `if (res.status === 429)` guard (never reached) → exits the retry loop
```

Timeouts caused fast-fail with no retry. Worst-case improvement was zero; the abort just turned an infinite hang into an immediate error.

**Superseded by.** Commit `83772dd` — wrapped the fetch in try/catch; abort and network errors now land in `retryErrors`, enter the backoff logic, and hit `continue` to retry. Separate `timeoutAttempts` counter caps timeout-specific retries at 2 total attempts (was 4 × 5 min = 20 min worst-case). The same commit added a per-chunk idle timeout inside `consumeSSEStream()` via `Promise.race`, catching mid-stream silent stalls that the outer fetch timeout (which is cleared before the streaming path runs) cannot catch.

**Lesson.** "Retry on X" claims in commit messages are hypotheses, not proofs. Walking the control flow is the only way to verify them. Post-implementation Codex review catches these because it reads the actual code path, not just the stated intent.

---

### Chain E: SSE watcher race conditions

**Initial approach.** The first SSE-based runner in `59f8fff` opened the `/api/novel/:id/events` stream after `POST /start` returned. This is the natural order — start the run, then watch.

**Problem discovered.** `runNovel()` is fire-and-forget at `novel-routes.ts:453-465`. The pipeline starts immediately on POST return. Early events (`debug-inject`, `plan-check-outcome`) can fire before the watcher's SSE connection is established. On fast iterations, R1 passed; on slower iterations where early events fired in the gap, the watcher missed them and timed out.

**Superseded by seed-from-trace.** Commit `a2118e1` added a seed-from-trace preamble: GET `/api/novel/:id/trace` first, replay historical rows through the matcher chain, dedup by `row.id`, then open the live SSE stream. Events that arrived in the gap are replayed from the DB.

**Then discovered:** `gate:plan-assist-resolved` is a native SSE event fired synchronously in `resolvePlanAssist()` when `POST /decide` is called. It is not persisted to `pipeline_events`. The watcher opens AFTER the POST returns, so the event is already past — seed-from-trace can't rescue it because there's no row to seed.

**Superseded again.** Commit `6e1c750` — the resolved matcher now accepts EITHER the native `gate:plan-assist-resolved` SSE event OR the `trace:plan-assist-resolve` row (which IS persisted to `pipeline_events`). If the watcher misses the native event, the trace row catches it on seed-from-trace replay.

**Lesson.** Every "subscribe after X" pattern is a race with the event stream. The durable fix is subscribe first + seed from durable storage + dedup. For events that are never persisted, the fallback is a parallel persisted trace event that covers the same signal.

---

### Chain F: Test-seed scope vs force-injection scope

**Initial approach.** The first campaign runner used a 3-chapter × 500w test seed, matching earlier harness testing patterns.

**Problem discovered.** `DEBUG_FORCE_PLAN_CHECK=fail` fires the exhaustion handler once per chapter. A 3-chapter seed fires gates on chapters 2 and 3 as well as chapter 1. Per-test assertions were scoped to exactly one gate per run; chapters 2/3 produced additional `chapter_exhaustions` rows that inflated counts beyond the expected assertion values. Every test that asserted `exhaustion_count === 1` failed.

**Superseded by.** Commit `c52c47e` shrunk the auto-mode seed to 1 chapter × 300w. Commit `6e1c750` applied the same 1-chapter constraint to the web-mode campaign.

**Lesson.** Test seed size must match assertion scope. When a force flag fires per-chapter, multi-chapter seeds make assertions non-deterministic. "Test one thing" applies to the seed shape as much as to the assertion.

---

## Section 3 — Back-and-forth exchanges

### 1. Codex thread `a2d16769d75b1d9cc` — auto-mode gate and SSE watcher

**What the original commit claimed.** Step 2 commit `2f012de` scaffolded the gate infrastructure; commit `a2118e1` (initially) was implementing the SSE-based runner. The PR-equivalent state had the gate working for web/CLI mode, but auto-mode was implicitly assumed to also emit the SSE event.

**What Codex found.** Four issues, two blockers:

- Q10a (BLOCKER): `gate:plan-assist` SSE emit was inside the Promise constructor which only runs in web/CLI mode. Auto mode throws before reaching it.
- Q10b (BLOCKER): SSE watcher race — subscribe-after-start means early events are lost.
- Q5: SSE watcher fast-failed on any error event, including expected `PipelineBailError` emissions.
- Implicit: `Bun.serve` idle timeout would drop SSE streams during 30s+ LLM call silences.

**What the fix was.** Commit `a2118e1` addressed all four: hoisted emit/trace out of constructor; seed-from-trace preamble; error events pass through matcher chain before failing; `idleTimeout: 0` on the Bun serve config; keepalive interval reduced from 30s to 5s.

**Whether the fix was sufficient.** Sufficient for those four issues. The seam-gap bugs (`fed9e4a`, `4ad2413`) were a separate class discovered during actual campaign execution.

---

### 2. Codex thread `ab530b43a6716d937` — transport retry contract

**What the original commit claimed.** Commit `0e9b24d` added 5-minute `AbortController` timeout with the stated guarantee that "aborts flow through the 429/5xx retry loop."

**What Codex found.** Q2 (correctness bug): `AbortError` thrown by fetch propagated past the `if (res.status === 429)` guard without triggering retry. The loop exited on first timeout. The stated guarantee was wrong. Also Q4: the original cap was 4 retries × 5 min = 20 min worst-case hang. Q5: `consumeSSEStream()` had no per-chunk idle timeout.

**What the fix was.** Commit `83772dd`: fetch wrapped in try/catch; abort/network errors route to retry backoff via `continue`; separate `timeoutAttempts` counter caps at 2 total timeout retries; `consumeSSEStream()` gains `Promise.race` per-chunk idle timeout.

**Whether the fix was sufficient.** Yes per Codex follow-up. No further corrections needed on this thread.

---

### 3. Codex thread `a1e06c61f62e901e7` — seam-gap audit

**What the original commit claimed.** Commit `fed9e4a` fixed the plan-check settle-loop seam gap. After the fix, "both the initial check and the recheck are covered."

**What Codex found.** Q5: validation settle-loop recheck at `drafting.ts:889-893` was the only remaining uncovered site. Same bug class: initial force covered, recheck calls real function, real rewrites pass, exhaustion handler never reached. Campaign task `b1meod3p9` confirmed — R5 produced trace sequence `validation-check → phase-complete → done` with no exhaustion event.

**What the fix was.** Commit `4ad2413` mirrored the pov/word-count synthesis at the validation recheck site.

**Whether the fix was sufficient.** Yes. All known seam gaps covered by MVP. V2 transport interceptor (specced in `docs/debug-injection-v2-spec.md`) eliminates the class structurally.

---

### 4. Codex thread `a252aecbb785a0eb3` — final architectural verdict

**What the session state claimed at that point.** The exhaustion-handler was functionally complete; campaign tests R0/R1/R5/R6/R7 all passed; the architecture was ready to mark shipped.

**What Codex found.** Conditional pass (78% confidence). Three residual gaps:

1. **In-memory state + restart.** `revisionUsed`, `pendingPlanAssistGates`, and the auto-mode override flag all live in process memory. An orchestrator restart during an active gate clears this state — the novel can re-enter drafting without knowing the gate was open, potentially doubling the reviser budget. Session anomaly on `novel-1776616563937` confirmed: 2 non-skip reviser invocations when restart reset `revisionUsed`. `callerId` propagation was also flagged (timeout logs showed `provider/model` only, not `agent=X`).
2. **Clean no-forced-flags validation run.** The test suite exercises forced paths. A single no-flags full chapter run confirming validation exhaustion is never accidentally triggered in normal operation was still pending.
3. **Invariant checks at `src/invariants/debug.ts`.** The session's learnings about seam coverage should propagate into invariant/assertion helpers that catch this class of bug at test time.

**What the fix was.** Commit `13f8143` addressed `callerId` propagation and added orphan gate detection MVP (`listOrphanedExhaustions` + `markExhaustionOrphaned`). Full restart recovery for gate state remains pending per `docs/todo.md`. See `docs/next-session-plan.md`.

---

## Section 4 — Classes of bugs we kept hitting

- **In-memory state + restart = data loss.** `revisionUsed`, `pendingPlanAssistGates`, and `planCheckOverride` all live in process memory. Orchestrator restart during an active gate clears them. Pattern: any state the pipeline depends on across a potential restart must be persisted to the DB. The hard-cap guarantee on reviser invocations is only as durable as the process that holds the flag.

- **Initial-call-only injection misses recheck/retry sites.** Two separate instances this session (`fed9e4a` and `4ad2413`). The settle loop is the canonical missed site. The fix each time was manual: find the recheck, add the seam. The durable fix is V2 transport-level interception that covers all paths by construction.

- **Body already used.** `response.text()` called inside a template literal fires eagerly; attempting `response.json()` on the same response body afterwards throws "Body already consumed." Buffer the response body once into a local variable before using it in multiple places. Surfaced in the `decide` endpoint response handling (`5505985`).

- **Stored as JSON string vs object.** `Bun.sql` with a `::jsonb` cast stores `JSON.stringify(obj)` as a jsonb-of-type-string, not as a jsonb object. Reading back yields a string, not an object. This pre-existed on `chapter_revisions` (outline columns); the same pattern appeared on `chapter_exhaustions.decision_details`. Fix at read-time via `JSON.parse()` rather than changing the write path, since production code already handles it (`6e1c750`).

- **Race between POST and subscribe.** Both the `/start` path (fire-and-forget `runNovel()`) and the `/decide` path (`gate:plan-assist-resolved` fires synchronously and is never persisted) had subscribe-after races. Durable fix: subscribe first, seed from `GET /trace` with row-id dedup, use dual-source matchers for events that may or may not be persisted.

- **Fetch with no timeout.** DeepSeek dropped connections silently with no EOF, leaving fetch calls hung indefinitely. Every outbound LLM fetch needs an `AbortController`. And the timeout retry path must be verified by reading the control flow, not by reading the commit message.

---

## Section 5 — Process observations

Parallel Sonnet subagents materially shortened implementation time. Every time disjoint-file work was split across two or three subagents — the typical pattern was "subagent A handles transport + watcher, subagent B handles drafting + gates" — wall-clock time dropped compared to sequential handoffs. The aggregate Codex review at the end caught cross-subagent inconsistencies (e.g., Q10a and Q10b in `a2d16769d75b1d9cc` spanned two subagents' files) before they became hard bugs to unravel. This pattern is now codified as CLAUDE.md rule 10.

Codex review proved non-optional even for changes that compiled and passed all tests. Four real bugs shipped to the LXC-equivalent production environment before any Codex review ran: the auto-mode emit placement, the AbortError retry-path bug, the SSE subscribe race, and the validation settle-loop seam gap. None of these were caught by the test suite because the test suite didn't exercise the relevant branches. Codex reads the code path, not just whether tests pass. The pattern from this session: every non-trivial commit or commit cluster gets a Codex review before the next implementation chunk begins, not at the end of the session.

The doc-subagent pattern (CLAUDE.md rule 11, landed in `78ccc6b`) kept docs current without blocking implementation. Spawning a documentation subagent in parallel with the next implementation chunk meant that `lessons-learned.md`, `decisions.md`, and `current-state.md` reflected the session state at each milestone rather than accumulating a large catch-up pass at the end.

The test runner feedback loop improved in two distinct phases. Phase 1 (commits `c52c47e` through `59f8fff`) replaced polling with SSE-based fast-fail and fixed gross timeout mismatches. Phase 2 (commits `2784dd5` through `dcd9c4a`) added stall detection, subtype-aware snapshots, and the `llm-in-flight` heartbeat. By the end of phase 2, a broken test produced a readable diagnostic in under 30 seconds instead of timing out silently after 3+ minutes. The investment was about 6 commits; the value in iteration speed was compounded across every subsequent test run.

---

## Section 6 — Open questions / next-session focus

See `docs/next-session-plan.md` for the prioritized follow-on plan, including the three residual gaps Codex called out in verdict `a252aecbb785a0eb3`: full restart recovery for `revisionUsed` and `pendingPlanAssistGates`, a clean no-forced-flags validation run confirming no accidental exhaustion in normal operation, and propagation of the seam-coverage lesson into invariant checks at `src/invariants/debug.ts`. The V2 transport interceptor spec is at `docs/debug-injection-v2-spec.md` and is ready for implementation — the main open design question is the novel-ID guard (the current auto-generated `novel-${Date.now()}` format conflicts with the proposed `test-*` ID guard).

See `docs/todo.md` for the living pending-items list. The two items relevant to this session are flagged with the Codex thread reference and linked to the same gaps.
