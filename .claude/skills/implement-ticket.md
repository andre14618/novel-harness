---
name: implement-ticket
description: Canonical end-to-end workflow for shipping one approved ticket on novel-harness. Plan → Codex triage → Codex plan review → parallel Sonnet subagents → preflight → Codex implementation review → fix once → deploy → validate → docs → retrospective.
status: active
updated: 2026-04-19
origin: Codex threads a65ba6ef7290fdf25 (strategy) + ad350aa657ec1c9b1 (validation)
---

# implement-ticket

**This is a documentation skill, not runtime automation.** It captures the workflow that produced today's quality gains. Follow it by hand; don't try to run it as a loop.

## When to invoke

**Only on a human-approved ticket.** Never pick the next `docs/todo.md` item autonomously. Approved = user says "ship X" or explicit allowlist in a handoff doc. On ambiguous input, ask which ticket first.

## Phase -1 — Session start (MANDATORY, before any ticket work)

Before starting ANY work in a session (ticket or not):

1. **Read `.claude/session-handoff.md`** — short living state doc from the prior session. Contains: what's in flight, pending Codex reviews, unresolved decisions, recent architectural decisions (last 48h). If the handoff is stale (updated > 48h) or missing, fall back to `bun scripts/status.ts` (once it ships) or manual reconstruction via `git log --oneline -20 | head` + most recent `docs/sessions/` retrospective.

2. **List in-flight runs:** `bun scripts/lib/in-flight.ts list`. Each entry represents a background process launched from a prior session. For each:
   - Verify LXC process alive: `ssh novel-harness-lxc 'pgrep -af <cmd fragment>'`. If dead + experiment row still open → the run crashed silently; query logs to reconstruct, then remove the registry entry.
   - Verify experiment row: `SELECT conclusion IS NOT NULL FROM tuning_experiments WHERE id = ?`. If the process ended but the experiment never concluded, conclude it manually with a recovered outcome.

3. **Check `docs/todo.md`** for priority shifts.

Only then start ticket work. Skipping Phase -1 means the session operates with stale assumptions — Codex thread IDs from last session may not be in-context, in-flight runs may get double-started, and telemetry chains can silently break.

## Phase 0 — Create tuning_experiment (MANDATORY)

**Before any code work.** CLAUDE.md rule 1: every experiment goes in the DB. Rule 2: every benchmark run links to an experiment via `EXPERIMENT_ID=N`.

```ts
import { createTuningExperiment } from "src/db/ops"
const expId = await createTuningExperiment(
  "charter" | "validation_sweep" | "infrastructure" | "checker-eval" | ..., // existing type enum
  "<one-line description — what + why>",
  { /* structured config: commits, codex threads, pass criteria, etc. */ },
  { target: "<what>", dimension: "<axis>" },
)
```

- **Architectural / charter work** (Round A/B-style multi-commit effort with Codex verdicts): `experiment_type='charter'`. Config includes `commits`, `codex_thread_ids`, `codex_final_verdict`, `codex_confidence`.
- **Benchmark / validation runs** (organic-run-verify, R-campaign replays, cross-novel sweeps): `experiment_type='validation_sweep'` or existing matching type. Config includes seed, env, pass criteria, related_charter.
- **Fine-tune trainings**: `experiment_type='sft_training'` — matches existing convention.

**EXPERIMENT_ID discipline:**
- Script runs: export `EXPERIMENT_ID=N` so logs link back
- LLM calls: `llm_calls.experiment_id` should be populated where applicable
- Commit body: cite the experiment ID (e.g., "Linked to experiment #237") when the commit ships code behind the experiment

**In-flight registry discipline:** Any background launch (nohup LXC process, long campaign, async eval, training job) MUST write an entry to the local in-flight registry so session-crash or user-switch doesn't lose track:

```bash
bun scripts/lib/in-flight.ts add '{
  "run_id": "<novel_id or campaign slug>",
  "kind": "novel-run" | "campaign" | "eval" | "training" | "other",
  "exp_id": <N>,
  "pid": <PID if known>,
  "host": "lxc",
  "log_path": "/tmp/<name>.log",
  "launched_at": "<ISO>",
  "expected_finish_at": "<ISO or null>",
  "description": "<one line>"
}'
```

Registry lives at `.claude/in-flight/active.json` (gitignored). On run finish, remove the entry: `bun scripts/lib/in-flight.ts remove <run_id>`. Scripts that auto-conclude their experiment row (like `organic-run-verify.ts`) should also auto-remove their registry entry in the same finally block.

**Concluding:** call `concludeExperiment(expId, conclusion)` at end-of-work with the outcome (Codex verdict, pass/fail, measured Δ, whatever is load-bearing). NEVER delete experiments per rule in CLAUDE.md.

**Pair every experiment with a decisions.md entry** when it produces a design choice or rules a path out. Cite the experiment ID and date in the entry.

## Phase 1 — Plan

Write a plan with:
- **Goal + non-goals** (single bullet each)
- **File ownership slices** (disjoint per subagent)
- **Green work** (scaffolding, tests, docs, leaf helpers — safe to dispatch speculatively)
- **Red work** (state machine, migrations, event contracts, retries, gates, persistence, restart behavior, async boundaries — blocked until Codex PASS)
- **Exit criteria** (concrete pass/fail signals, not vibes)

If the plan can't be split into green/red, default ALL work to red.

## Phase 2 — Codex plan-triage (30-sec routing call)

**Strict I/O contract — do not let this drift into a mini-review.**

- **Input:** plan bullets + touched areas (file globs) + tests + exit criteria. Nothing else.
- **Output constraint:** `green | red | mixed` + max 3 reasons + 1 blocker (if any). **No patch suggestions.** **No code snippets.** **Hard stop on uncertainty** (return `mixed` with "needs deep review").
- **Model:** `gpt-5.4 --effort high`. Label the thread `triage-only` so future turns respect the contract.

Use the verdict to decide:
- `green` → proceed to Phase 4 in parallel with Phase 3 (speculative dispatch)
- `red` → block on Phase 3 before Phase 4
- `mixed` → block, treat as red

## Phase 3 — Codex plan review (full)

Full plan review at `gpt-5.4 --effort high`. Typical 3-8 min.

If `CHANGE`/`NEEDS-WORK`: apply corrections inline to the plan doc; re-dispatch triage only if architecture changed.

## Phase 4 — Dispatch Sonnet subagents

Parallel where disjoint. Single message, multiple Agent tool uses (CLAUDE.md rule 10).

**Mandatory in every subagent prompt:**
- Exact file ownership scope + explicit "do NOT touch" list
- Codex decisions from Phase 2-3 that constrain implementation
- Test requirements (unit tests mandatory; coverage expectations named)
- Commit contract (one commit, message format, do NOT push, do NOT deploy)
- Report-back shape (<200 word summary, files + tests + design deviations + commit SHA)

## Phase 5 — Preflight (wrapper + invariants)

**Preflight is a blocking gate.** Runs on the aggregated commit set before Codex implementation review. Sits between subagent completion and Phase 6.

Preflight bundle:
1. `bun test src/` — expected pass count (pre-existing failures documented inline)
2. `bunx tsc --noEmit` — no NEW errors (pre-existing implicit-any failures allowlisted)
3. Migration-path test if `sql/` moved
4. **Invariants** (see next section)

Preflight failures HALT — no Codex cycle until green. Two failures on the same root cause → escalate to human.

### Invariants (blocking, not debug-only)

Lives in `src/invariants/` + `scripts/lint/invariants-check.ts`. Runs as part of preflight. Codex agreed (thread `ad350aa657ec1c9b1` Q6): **if invariants stay behind a DEBUG flag, they become theater.**

Starting set (2026-04-19):
- `revisionUsed` restart persistence — at-most-one-non-skip `chapter_revisions` row per (novel, chapter) in integration runs
- Seam-recheck symmetry — every `DEBUG_FORCE_*` branch in `drafting.ts` must appear at ALL recheck sites (syntactic AST scan)
- Subscribe-before-start — any `apiPost(.../start)` in test harnesses must be preceded by `watchForExpectations`/`watchForTerminal` in the same function (syntactic)
- Branch-symmetric event emission — narrow scope: specific state transitions that broke today (auto-mode plan-assist emit; validation-path settle exit); NOT a global symmetry proof (Codex Q3 caveat)
- Body-already-used detection — any template literal with `await X.text()` AND `await X.json()` on the same Response is flagged (syntactic)

New invariant added only when a bug class recurs across 2+ sessions. Temporary allowlist file (`.claude/invariants-allowlist.yaml`) for intentional violations with expiry.

## Phase 6 — Codex implementation review

**Two parts in one Codex thread:**

1. **Narrow-question block** (hot-review mode): 3-4 bounded binary questions tied to today's risk classes. Format: "Q1: Does X preserve Y? YES/NO/PARTIAL with file:line refs." Codex's reasoning: catches specific regressions full-diff review would bury.
2. **Full-diff review** (cold-review mode): structural assessment. HIGH/MEDIUM/LOW findings separately.

**Commit-pinned reviews:** every Codex review prompt cites `git show <sha>` explicitly. No live-workspace diffs (workspace may have uncommitted subagent writes or stale state).

Tier selection (NOT line count):
- **Cold (full-diff + narrow):** state machine, migrations, event contracts, retries, gates, persistence, restart behavior, async boundaries, multi-file coupling. Small edits in `src/phases/`, `src/orchestrator/`, `src/db/`, `src/transport.ts`, `src/gates.ts` are cold even when short.
- **Hot (narrow only):** leaf-local, behavior-preserving, deterministic verification.
- If uncertain → cold.

## Phase 7 — Fix + re-review

Fix only Codex-flagged issues. Re-review ONCE on the fix delta. HIGH findings after the first fix pass → halt and escalate.

## Phase 8 — Deploy

`yes y | bash scripts/deploy-lxc.sh` (or equivalent). Verify service restart + migration apply + no regression in startup sweep. Two deploy failures → escalate.

## Phase 9 — Validate

Deterministic check when possible (preferred). Organic novel run for integration coverage (accepted as fuzzy). Pass gate must be declared in the plan; ambiguous outcomes escalate.

## Phase 10 — Docs subagent

Runs in parallel with Phase 9 validation wall-clock (20-45 min dead time otherwise). Sonnet subagent updates:
- `docs/current-state.md` (authoritative live-system doc)
- `docs/todo.md` (mark ticket items done with commit refs)
- `docs/lessons-learned.md` (append anything session-novel)

## Phase 11 — Session retrospective

Write `docs/sessions/YYYY-MM-DD-{slug}.md` per `docs/sessions/TEMPLATE.md`. **Telemetry frontmatter is mandatory** — missing fields fail the review. See template.

If a pattern recurs across 2+ sessions → elevate to `docs/patterns/{slug}.md`.

## Phase 12 — Session close (handoff for the next session)

Before ending the session:

1. **Update `.claude/session-handoff.md`** — overwrite with current state:
   - What's in flight (pull from `.claude/in-flight/active.json`)
   - What's pending Codex review (any open threads)
   - Unresolved decisions / next-session priorities
   - Recent architectural decisions (last 48h, pointers to `docs/decisions.md`)
   - Commit chain this session
   - "If you just landed here and don't know what's going on" paragraph
2. **Confirm no in-flight runs are silently dropped** — each must either have completed (registry removed + experiment concluded) OR be explicitly documented in the handoff with "next session please check on X."
3. **Commit the handoff doc** in the same commit as the session retrospective (or a separate `[docs]` commit if the retrospective has separate review).

## Exit triggers (stop and escalate)

Per Codex thread `a65ba6ef7290fdf25` Section C. Halt on:

1. Codex plan review returns a blocker requiring architectural change
2. Codex implementation review has HIGH findings after ONE fix pass
3. Scope expands outside declared file ownership or into a second subsystem
4. Preflight fails twice on the same root cause
5. Deploy fails twice
6. Validation is ambiguous or exceeds time budget
7. Ticket completes and the workflow would need to pick a new backlog item
8. Quota or wall-clock budget exceeded
9. Canonical docs disagree with current code in a way that changes implementation decisions

Output token per exit: `DONE | NEEDS_HUMAN_DECISION | NEEDS_SCOPE_RESET | NEEDS_DEBUGGING` + trigger condition + current state snapshot.

## Commit discipline

One concern per commit. Commit message body explains WHY, not WHAT. Format per `docs/commit-conventions.md`. Every commit that touches runtime behavior updates `docs/current-state.md` in the same commit OR includes `docs-impact: none` in the body.

## What this skill is NOT

- Not runtime automation. Do not build a loop that runs these phases autonomously. The user picks tickets; Claude picks Codex cycles; Codex reviews. Three loops kept separate.
- Not a replacement for judgment. The phase list is the happy path; exit triggers exist because the phases fail.
- Not frozen. Update when a class-of-bug pattern validates a new invariant or a drift-case invalidates an assumption.

## Origin

Codex strategic consultation on `2026-04-19`:
- Thread `a65ba6ef7290fdf25` — 5-lever latency analysis
- Thread `ad350aa657ec1c9b1` — overhaul validation

Claude's critique added: green/red plan-triage, commit-pinned reviews, preflight-false-positive telemetry. Codex validated all three (Q2/Q4/Q5).
