---
status: portable
origin: extracted from a first-party multi-agent session; see appendix for provenance
---

# Portable Claude ↔ Codex orchestration workflow

Drop-in skill doc for any project using Claude Code (or any Claude agent) that has access to a second reviewer model (Codex, another Claude, GPT-5+, whatever). Captures a 13-phase pattern validated on a real project in a single day of heavy use; see **Appendix — Example provenance** at the end for the specific numbers and context.

**Intent:** copy this file into your new project's `.claude/skills/` (or equivalent docs directory). Customize the bracketed `[CUSTOMIZE]` blocks. The 13-phase structure + exit triggers + telemetry are the load-bearing pieces; those stay as-is.

---

## Prerequisites

- A primary implementation model (Claude Code or similar) that can dispatch parallel subagents
- A secondary review model accessible as a tool (Codex gpt-5.4, another Claude, etc.). **Prefer a different provider or model family** for genuine independence. If unavailable, same-model review is still useful when run in a separate thread with commit-pinned inputs — but treat it as lower-independence (the protocol is what buys you most of the value: bounded questions with `file:line` refs, commit-pinned review, not the model diversity per se).
- A git repo with atomic-commit discipline
- An experiment tracking surface (DB table, markdown log, whatever) so architectural work is durably recorded
- A deploy/runtime path, **if applicable** (dev server, staging, production, etc. — a library project or research codebase can skip Phase 8; see Phase 8-10 variants)
- `[CUSTOMIZE]` — note your specific infrastructure: what's your equivalent of a remote runtime + background-process launcher? systemd? k8s? local dev? bare `&`? Skip if not applicable.

## When to invoke

**Only on a human-approved ticket.** The model never picks the next todo item autonomously. Approved = user says "ship X" or explicit allowlist in a handoff doc. On ambiguous input, ask which ticket first.

## Actor model

Five actors. Color-code them in any UI you build.

| Actor | Role |
|---|---|
| **User** | Picks tickets. Resolves architectural forks. Final authority. |
| **Claude** (primary impl) | Plans, orchestrates subagents, runs preflight, integrates Codex feedback, commits. |
| **Subagent** (parallel Sonnet/Haiku/etc.) | Implements one file slice per task. Reports back with commit SHA. |
| **Codex** (secondary review) | Plan-triage, plan review, impl review. Narrow-question + full-diff modes. |
| **Runtime/DB** | Where builds, tests, deploys, validations actually execute. |

---

## Phase -1 — Session start (MANDATORY)

Before ANY work:

1. Read the session handoff doc (`.claude/session-handoff.md` or equivalent). Short living state — "what's in flight / pending reviews / unresolved decisions / recent architectural decisions."
2. List in-flight registry. For each entry, verify it's genuinely still running (via `pgrep`, boot-id, or equivalent). Prune ghosts.
3. Check project todo / priorities doc.
4. **Emit the mandatory session-start receipt as the FIRST substantive response:**
   `session-start: handoff ✓ in-flight ✓ todo ✓`
   Missing or partial receipt is visible friction. Creates enforcement without needing hooks.

## Phase 0 — Create experiment row (MANDATORY)

Register the ticket in your experiment tracking system BEFORE code work. Commit body cites the experiment ID. Any background launch writes an in-flight registry entry. Scripts that auto-conclude their experiment row also auto-remove their registry entry on finish.

`[CUSTOMIZE]` — tool for experiment creation (DB insert, markdown log, notion entry, whatever). The discipline is the row, not the storage.

## Phase 1 — Plan

Write a plan with:
- **Goal + non-goals** (one bullet each)
- **File ownership slices** (disjoint per subagent)
- **Green work** (safe to dispatch speculatively: scaffolding, tests, docs, leaf helpers)
- **Red work** (blocked until Codex PASS: state machines, migrations, event contracts, retries, gates, persistence, restart behavior, async boundaries)
- **Exit criteria** (concrete pass/fail signals)

If the plan can't be split into green/red, default ALL work to red.

## Phase 2 — Codex plan-triage (30-sec routing)

**Strict I/O contract — do NOT let this drift into a mini-review.**

- **Input:** plan bullets + touched areas + tests + exit criteria. Nothing else.
- **Output:** `green | red | mixed` + ≤3 reasons + ≤1 blocker. **NO patch suggestions.** **NO code snippets.** Hard stop on uncertainty (return `mixed`).

Use the verdict:
- `green` → proceed to Phase 4 in parallel with Phase 3 (speculative dispatch)
- `red` → block on Phase 3 before Phase 4
- `mixed` → block, treat as red

## Phase 3 — Codex plan review (full)

Full plan review with the second model. Typical 3-8 min. Returns PASS / CHANGE / NEEDS-WORK.

If CHANGE/NEEDS-WORK: apply corrections inline to the plan doc.

## Phase 4 — Parallel subagent dispatch

`[CUSTOMIZE]` — your agent-spawning mechanism. In Claude Code: single message, multiple `Agent` tool calls.

Mandatory in every subagent prompt:
- Exact file ownership scope + explicit "do NOT touch" list
- Review decisions from Phase 2-3 that constrain implementation
- Test requirements (unit tests mandatory; coverage named)
- Commit contract (one commit, message format, do NOT push, do NOT deploy)
- Report-back shape (<200 words: files + tests + design deviations + commit SHA)

## Phase 5 — Preflight (BLOCKING gate)

Runs on the aggregated commit set before Codex impl review. Failures HALT — no review cycle until green.

Preflight bundle:
1. Test suite (pre-existing fails allowlisted)
2. Typecheck (pre-existing errors allowlisted)
3. Schema/migration tests if applicable
4. **Invariants** — deterministic checks tied to this project's recurring failure classes. MUST be blocking, not debug-only. Start with 3-5; grow when bug classes recur.

Two preflight failures on the same root cause → escalate to human.

`[CUSTOMIZE]` — your test command (`bun test` / `pytest` / `go test` / etc.) + typecheck + project-specific invariants.

## Phase 6 — Codex implementation review

**Two parts in one thread:**

1. **Narrow-question block** (hot-review): 3-4 bounded binary questions tied to known risk classes. Format: "Q1: Does X preserve Y? YES/NO/PARTIAL with file:line refs." Catches specific regressions that full-diff review buries.
2. **Full-diff review** (cold-review): structural assessment. HIGH/MEDIUM/LOW findings separately.

**Commit-pinned:** every review prompt cites `git show <sha>` explicitly. No live-workspace diffs (workspace may have uncommitted subagent writes).

**Tier selection (NOT line count):**
- **Cold (full + narrow):** state machines, migrations, event contracts, retries, gates, persistence, restart behavior, async boundaries, multi-file coupling. Small edits in load-bearing files are COLD even when short.
- **Hot (narrow only):** leaf-local, behavior-preserving, deterministic verification.
- If uncertain → cold.

## Phase 7 — Fix + re-review

Fix only Codex-flagged issues. Re-review ONCE on the fix delta. HIGH findings after the first fix → halt and escalate.

## Phase 8 — Deploy

**Variant by project type:**
- **Service / app** — REQUIRED. Your deploy command/flow. Verify service restart + migrations + no new regressions in startup/health checks. Two deploy failures → escalate.
- **Library** — OPTIONAL. `npm publish` / `cargo publish` / equivalent. Often deferred until Phase 11 bundles multiple tickets.
- **Research / notebook** — N/A. Skip to Phase 9.

`[CUSTOMIZE]` — your deploy command/flow for the applicable variant.

## Phase 9 — Validate

Deterministic check when possible (preferred). Broader integration/end-to-end run for coverage when the system's behavior is emergent (accepted as fuzzy). Pass gate must be declared in the plan. Ambiguous outcomes escalate.

**Variant by project type:**
- **Deterministic-only** (most libraries, pure functions) — one-pass unit + property tests. Often complete in seconds.
- **Mixed** (services with side effects) — deterministic tests + a smaller integration run.
- **Heavy integration** (systems with emergent behavior: agents, simulations, distributed systems) — long-running validation (minutes to an hour+). This is the case where Phase 10 parallelism matters.

## Phase 10 — Docs subagent (parallel)

REQUIRED when Phase 9 has meaningful wall-clock (> ~5 min). OPTIONAL when validation is seconds. Updates:
- Authoritative current-state doc
- Todo / priorities
- Lessons-learned log

If Phase 9 is fast, run docs serially after it — no parallelism needed.

## Phase 11 — Session retrospective

Write `docs/sessions/YYYY-MM-DD-{slug}.md` (or your project's equivalent). **Telemetry frontmatter is mandatory.**

## Phase 12 — Session close

Before ending the session:
1. Overwrite session-handoff doc with current state
2. Confirm no in-flight runs are silently dropped
3. Commit handoff + retrospective
4. `[CUSTOMIZE]` — push to remote? publish a summary? depends on your workflow

---

## Exit triggers (halt + escalate)

ANY of these stops the loop and returns control to the user:

1. Codex plan review returns a blocker requiring architectural change
2. Codex impl review has HIGH findings after ONE fix pass
3. Scope expands outside declared file ownership
4. Preflight fails twice on the same root cause
5. Deploy fails twice
6. Validation ambiguous or exceeds time budget
7. Ticket completes and workflow would need to pick a new backlog item
8. Quota or wall-clock budget exceeded
9. Canonical docs disagree with current code in a load-bearing way

Output token per exit: `DONE | NEEDS_HUMAN_DECISION | NEEDS_SCOPE_RESET | NEEDS_DEBUGGING` + trigger + state snapshot.

---

## Telemetry (mandatory retrospective frontmatter)

Zero values are valid; missing fields are NOT. Goal: stop making workflow decisions on vibes.

```yaml
wall_clock_min: 0
codex_reviews: 0              # all review calls combined
rework_passes: 0              # fix-commits after a Codex CHANGE/NEEDS-WORK/HIGH
bugs_caught_by_codex: 0       # real bugs Codex caught that tests missed
bugs_caught_by_preflight: 0   # real bugs preflight caught pre-Codex
bugs_escaped_to_prod: 0       # bugs found after deploy
preflight_false_positives: 0  # preflight halts that turned out to be non-bugs
```

Takes 3-5 sessions before the numbers are comparatively useful.

---

## Artifacts you'll want in any project

- `.claude/skills/implement-ticket.md` — this doc, customized to your project
- `.claude/session-handoff.md` — short living state doc, overwritten at session close
- `.claude/in-flight/active.json` — per-machine registry of background runs (gitignored)
- Registry helper script (~150 LOC) — `list / add / remove / prune` commands. Prune cross-checks via `pgrep` + boot-id.
- Session retrospective template with the 7 telemetry fields
- Architectural decision log (append-only)
- Pattern docs directory (class-of-bug patterns that recur)
- Experiment tracking surface (DB table, markdown, notion, whatever)
- Commit-pinned review discipline in every Codex prompt
- `[CUSTOMIZE]` — a health/debug-env endpoint on your primary service so benchmark scripts can probe contamination

---

## What NOT to do

Lessons paid for in full on 2026-04-19:

- **Don't run Codex reviews on uncommitted workspace state.** Pin every review to `git show <sha>`.
- **Don't fire-and-forget a write that IS a guard.** Await the write before the action it guards. Fire-and-forget is only safe when the follow-up is compensating.
- **Don't use replayable observability streams as ordering guarantees.** Events that replay history on reconnect can satisfy "happened after X" assertions with stale data. Use explicit state polling with a unique marker.
- **Validate target-runtime state from the target runtime.** Local env checks don't catch contamination in the remote/separate process you're actually testing. Expose a health/introspection endpoint and probe it.
- **Don't stay in a per-subagent Codex review pattern.** Review runs ONCE on the aggregated diff. Per-subagent reviews are wasted cycles.
- **Don't let invariants stay behind a DEBUG flag.** Non-blocking shift-left becomes theater. Block on preflight.
- **Don't automate the full loop.** Documentation is the artifact; automation is an optimization. The user picks tickets.
- **Don't run Codex plan-triage as a mini-review.** Strict I/O contract: verdict + ≤3 reasons + ≤1 blocker, NO patch suggestions.

---

## How to customize for a new project

1. Copy this file to `.claude/skills/implement-ticket.md` (or equivalent)
2. Replace every `[CUSTOMIZE]` block with project specifics
3. **Seed the minimum artifact set** — these three are load-bearing for cross-session continuity, don't skip:
   - `.claude/session-handoff.md` (can start empty: "nothing in flight, start here: <ticket>")
   - `.claude/in-flight/` registry directory (gitignored) + registry helper script
   - Session retrospective template (copy `docs/sessions/TEMPLATE.md` pattern — 7 telemetry fields in frontmatter)
4. **Seed 3-5 starting invariants.** For new projects without bug history, seed from: (a) architecture promises (things you claim your system does — test each is actually true), (b) unsafe boundaries (inputs from untrusted sources, async/retry/persistence seams), (c) irreversible actions (deletes, writes to shared state, migrations). Replace these with bug-pattern invariants once you have 2-3 months of post-ship history.
5. Set up your experiment tracking surface (DB table, markdown log, Notion, whatever)
6. Commit the skill doc + artifact set
7. On your next ticket, emit the session-start receipt (`session-start: handoff ✓ in-flight ✓ todo ✓`) and walk the phases

First 2-3 tickets will feel heavy. Phases 2 + 5 + 11 pay for themselves by ticket 4.

---

## Appendix — Example provenance

This doc was extracted from a single-day heavy-use session on a real multi-agent project (2026-04-19). Numbers from that session:

- 15 clean commits shipped, zero regressions reached the deployed runtime
- 9 real bugs caught by the secondary reviewer (3 HIGH + 2 MEDIUM + 4 CHANGE across 3 review passes)
- 1 bug caught by preflight (type widening) before any review cycle ran — validated the shift-left
- 1 bug escaped to the deployed runtime (environmental contamination from a stale systemd config) — produced a new pattern + health endpoint + skill-doc update within the same session
- Wall-clock: ~5 hours for an end-to-end hardening + architecture + UI + scaffolding push that would normally take 2-3 days

The project was a beat-first AI novel-generation harness with 30+ LLM agents, a Postgres state machine, and a long integration-test wall-clock (20-45 min per organic run). The pattern showed most value on exactly the kind of work that's hard to unit-test: async retry paths, persistence-after-restart, multi-agent coordination.

Parallel subagents are the multiplier. Reviewer cycles are the fixed cost of quality. The 13-phase scaffold is what makes both composable.
