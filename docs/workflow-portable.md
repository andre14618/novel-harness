---
status: portable
origin: novel-harness 2026-04-19 workflow overhaul
---

# Portable Claude ↔ Codex orchestration workflow

Drop-in skill doc for any project using Claude Code (or any Claude agent) that has access to a second reviewer model (Codex, another Claude, GPT-5+, whatever). Captures the pattern that shipped 15 clean commits in one day on novel-harness. See `docs/sessions/2026-04-19-workflow-overhaul.md` in that repo for telemetry + supersession chains proving the shape.

**Intent:** copy this file into your new project's `.claude/skills/` (or equivalent docs directory). Customize the bracketed `[CUSTOMIZE]` blocks. The 13-phase structure + exit triggers + telemetry are the load-bearing pieces; those stay as-is.

---

## Prerequisites

- A primary implementation model (Claude Code or similar) that can dispatch parallel subagents
- A secondary review model accessible as a tool (Codex gpt-5.4, another Claude, etc.) — **must be a different model family than the implementer** for genuine independence
- A git repo with atomic-commit discipline
- An experiment tracking surface (DB table, markdown log, whatever) so architectural work is durably recorded
- A deploy path for the project (local dev server, staging, production — whatever "ship" means for you)
- `[CUSTOMIZE]` — note your specific infrastructure: what's your equivalent of LXC + nohup? systemd? k8s? local dev? bare `&`?

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

`[CUSTOMIZE]` — your deploy command/flow. Verify service restart + migrations + no new regressions in startup/health checks. Two deploy failures → escalate.

## Phase 9 — Validate

Deterministic check when possible. Integration run for broader coverage (accepted as fuzzy). Pass gate must be declared in the plan. Ambiguous outcomes escalate.

## Phase 10 — Docs subagent (parallel)

Runs IN PARALLEL with Phase 9 validation wall-clock (20-45 min dead time otherwise). Updates:
- Authoritative current-state doc
- Todo / priorities
- Lessons-learned log

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

## What this workflow delivers (proven 2026-04-19)

**On one novel-harness session (day 1, first run through the pattern):**
- 15 clean commits, zero regressions shipped to LXC
- 9 real bugs caught by Codex (3 HIGH + 2 MEDIUM + 4 CHANGE across 3 review passes)
- 1 bug caught by preflight (type widening) — validated the Lever 3 shift-left
- 1 bug escaped to "prod" (LXC env contamination from stale systemd drop-in) — produced a new pattern + endpoint + skill-doc update the same session
- Wall-clock: ~5 hours for an end-to-end hardening + architecture + UI + scaffolding push that would normally take 2-3 days

Parallel subagents are the multiplier, Codex cycles are the fixed cost of quality.

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
- **Don't use trace events as "happened after X" signals** if the event system replays history on connect.
- **Don't trust your own process env** when validating a clean state for a different process. Probe the target.
- **Don't stay in a per-subagent Codex review pattern.** Review runs ONCE on the aggregated diff. Per-subagent reviews are wasted cycles.
- **Don't let invariants stay behind a DEBUG flag.** Non-blocking shift-left becomes theater. Block on preflight.
- **Don't automate the full loop.** Documentation is the artifact; automation is an optimization. The user picks tickets.
- **Don't run Codex plan-triage as a mini-review.** Strict I/O contract: verdict + ≤3 reasons + ≤1 blocker, NO patch suggestions.

---

## How to customize for a new project

1. Copy this file to `.claude/skills/implement-ticket.md` (or equivalent)
2. Replace every `[CUSTOMIZE]` block with project specifics
3. Identify your project's 3-5 starting invariants (look at the last 3 months of post-ship bugs — pattern them)
4. Set up your experiment tracking surface
5. Write your first session-handoff doc (can be empty: "nothing in flight, start here: <ticket>")
6. Commit the skill doc
7. On your next ticket, emit the session-start receipt and walk the phases

First 2-3 tickets will feel heavy. Phases 2 + 5 + 11 pay for themselves by ticket 4.
