---
status: session-closed
updated: 2026-04-19
session_closed_at: 2026-04-20T00:15:00Z
---

# Session handoff — novel-harness

## What's in flight RIGHT NOW

**Nothing.** `bun scripts/lib/in-flight.ts list` → empty.

## What's pending review

**Nothing open.** Final thread for T8/T9/T10 was Claude-main self-review (Codex sandbox blocked T10's Codex review surface). All experiments this session concluded PASS.

## Start-here priorities for next session

**Default: pick a product ticket. Three consecutive scaffolding-heavy sessions is the limit.**

### Option A — highest product signal

**Planner Phase-2 `requiredPayoffs` enrichment** (`docs/todo.md` §3). Add `requiredPayoffs: [{fact_id, payoff_beat}]` to chapter outline schema. Planner links setups→payoffs explicitly. Chapter-plan-checker gets a new mechanizable invariant (every declared fact_id has a payoff_beat that actually mentions it). Direct creative-quality delta.

Scope: 1-2 days. Touches `src/schemas/shared.ts`, planner prompts, `chapter-plan-checker`, `beat-context.ts`. Full-tier pipeline — behavior-changing, multi-file.

### Option B — measurement

**Hallucination checker v3 production fire-rate** (`docs/todo.md` §1 open bullet). 5-10 organic novels with telemetry collection. Pure ops; no new code unless fire rate suggests adapter retuning.

### Option C — compound value from today's kits

**First real use of `workflows_starter/` in the tandem Claude-run repo.** Copy `invariants-starter/` in; run against that repo's HEAD; surface friction; refine templates. This is the validation that separates useful-scaffolding from decoration.

## Deferred / flagged

- **Loop-statement reachability edge cases** — labeled break/continue, `for (; true ;)`, `!0` truthiness. Invariants #5 T4 handles the common cases.
- **Receiver aliasing in invariant #5** — `const body = res; body.text(); res.json()`. Not caught.
- **Codex sandbox boundary variability** — seen in T5 (commit lock) and T10 (cross-directory write). Third recurrence would trigger pattern elevation.
- **T4-T7 experiment labels** — all `charter`, should be `ticket` per the taxonomy T7 itself shipped. Bootstrap artifact; not backfilling.

## Recent architectural decisions (last 48h)

Full entries in `docs/decisions.md`:
- **Invariants registry + 5 invariants shipped** (#242, #243) — blocking preflight gate.
- **Invariant #5 widened to AST-based** (#244) + **loop reachability** (#247).
- **Pattern elevations** (#248, #249) — AST-over-text + bun-test mock hygiene.
- **TrackedWorkType taxonomy** (#250) — `ticket` default, `charter` reserved.
- **Pipeline tiering** — Phase 0.5 in workflow-portable; light tier validated on 3 tickets.
- **`workflows_starter/` created** (#251, #252, #253) — cross-project orchestration artifacts at `/Users/andre/Desktop/personal_projects/workflows_starter/`. NOT a git repo. Houses: PRINCIPLES.md, workflow-portable.md, invariants-starter/, preflight-starter/, session-templates/, patterns-starter/.

## Session-start protocol

1. Read this doc FIRST.
2. `bun scripts/lib/in-flight.ts list` — must be empty or investigate.
3. `bun scripts/lib/in-flight.ts prune` — cleans ghosts.
4. Check `docs/todo.md` priorities.
5. Emit `session-start: handoff ✓ in-flight ✓ todo ✓`.
6. Only then start new work.

## Session-close protocol (what this session did)

- **2 substantive commits** in novel-harness: `9b074c6` (move workflow-portable.md out) + this docs commit.
- **14 files + 3 anchors** landed in `workflows_starter/` (not versioned; loose files).
- **Experiments concluded PASS**: #251, #252, #253.
- Retrospective at `docs/sessions/2026-04-19-t8-t10.md`.

## Commit chain this session

```
9b074c6  [docs] Move workflow-portable.md to shared workflows_starter/ directory
(plus this docs commit)
```

Outside novel-harness at `/Users/andre/Desktop/personal_projects/workflows_starter/`:
- PRINCIPLES.md, README.md, workflow-portable.md
- invariants-starter/{README, 3 .template, fixtures/README.template, allowlist.template}
- preflight-starter/{README, preflight.ts.template}
- session-templates/{README, retrospective.template, handoff.template, in-flight-registry.template}
- patterns-starter/{README, PATTERN.md.template}

## If you just landed here and don't know what's going on

Today: morning had real product work (exhaustion handler + race fixes), then 3 scaffolding-heavy sessions back-to-back (invariants + tiering + portable-starter-kits). The scaffolding is real but **three straight sessions without user-visible novel-writing progress is the drift signal**. Next session's default is a product ticket — planner enrichment preferred (Option A above).

The new `workflows_starter/` at `/Users/andre/Desktop/personal_projects/workflows_starter/` is your cross-project home for orchestration machinery. novel-harness keeps project-specific versions; `workflows_starter/` keeps the shared templates. Don't copy between them unless extracting a proven pattern from novel-harness into the starter, or importing a starter template into novel-harness with customization.

SOP still: parallel subagents for multi-file impl, Codex-implement for docs/config-only tickets, Phase 6 review is NEVER optional, session-start receipt, commit-pinned reviews.
