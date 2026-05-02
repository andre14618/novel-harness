---
status: active
updated: 2026-05-02
---

# Agent Lane Protocol

Repo-local protocol for running Claude Code and OpenCode against the same primary lane without relying on either tool's private chat state.

## Roles

- **Lane captain:** owns the primary runtime hypothesis, integration, commits, and stop-gate decision.
- **Evidence agent:** builds or runs fixed-panel replay, repeated same-family runs, or result analysis for the active lane.
- **Support agent:** handles tests, docs-impact audits, operator summaries, stop classifiers, and pickup docs.

Only the lane captain should edit runtime behavior unless the lane context explicitly delegates a same-hypothesis arm to another worktree.

## Shared State

Every lane uses:

- `docs/sessions/<lane>.md` for the durable loop contract.
- `output/agent-runs/<lane-id>/events.jsonl` for append-only heartbeat and event records.
- `tuning_experiments`, `phase_eval_runs`, and `llm_calls` for persistent evidence.
- Git commits for completed coherent work.

Chat history is not a source of truth.

## Commands

Record a heartbeat or event:

```bash
bun scripts/agent/lane-heartbeat.ts docs/sessions/<lane>.md --actor opencode --step "running tests"
bun scripts/agent/lane-heartbeat.ts docs/sessions/<lane>.md --actor claude --type stop_gate --status stop --message "(b) new continuity blocker"
```

Check whether the outside loop should continue:

```bash
bun scripts/agent/lane-status.ts docs/sessions/<lane>.md
bun scripts/agent/lane-status.ts docs/sessions/<lane>.md --latest-novel
bun scripts/agent/lane-status.ts docs/sessions/<lane>.md --json
```

Watch the terminal dashboard:

```bash
monitor
monitor docs/sessions/<lane>.md
monitor --panel outside --panel evidence
bun scripts/agent/lane-dashboard.ts docs/sessions/<lane>.md --watch --latest-novel
```

`monitor` is the shell shortcut for `bun run monitor` in this repo. It defaults to the latest non-template session doc with a complete `Loop Contract`, watches continuously, and includes all panels. If no active lane exists, bare `monitor` stays open in a waiting state and polls until a complete lane doc appears. Use `monitor --once` for a single render, `monitor --append` to append snapshots instead of redrawing in place, `monitor --no-latest-novel` to hide inside-harness novel data, or `monitor --panel <name>` to narrow the dashboard.

Panels are `all`, `outside`, `inside`, `evidence`, `hygiene`, and `process`. `outside` renders the lane contract, heartbeat/event log, and git state. `inside` delegates to `scripts/operator-summary.ts`. `evidence` shows the lane experiment and latest `phase_eval_runs`. `hygiene` shows dirty/unpushed git state, pending/stale gates, open experiments, and docs-impact status. `process` shows DB reachability, recent LLM calls, local/LXC generation process state, and LXC orchestrator state.

Older session docs created before the lane-contract template are intentionally skipped by bare `monitor`; pass the path explicitly if you want to inspect a legacy doc.

Exit codes from `lane-status.ts`:

- `0`: continue
- `10`: stop
- `20`: blocked
- `21`: human-needed
- `22`: infra-failure

## Continue Rule

The outside supervisor loop should continue only when `lane-status.ts` returns `continue` / exit code `0`.

It must stop when:

- a result stop gate is filled in the lane doc
- the latest event has `status: stop`
- a required lane-contract field is missing
- the latest heartbeat is stale
- the latest event says `blocked`, `human-needed`, or `infra-failure`

## Inside Harness Visibility

The dashboard can include the current novel loop by passing `--latest-novel` or `--novel <id>`. It delegates DB inspection to `scripts/operator-summary.ts`, so DB failures show as dashboard warnings instead of crashing the outside loop.

## Gate Hygiene

Keep monitoring focused by resolving abandoned pending gates, not by deleting them. A resolved stale gate keeps the evidence row but stops appearing as live work because monitors filter on `decision IS NULL`.

Dry-run first:

```bash
bun scripts/agent/resolve-stale-gates.ts --older-than-hours 24
bun scripts/agent/resolve-stale-gates.ts --ids 78,81
```

Apply only after reviewing the dry run:

```bash
bun scripts/agent/resolve-stale-gates.ts --older-than-hours 24 --apply
bun scripts/agent/resolve-stale-gates.ts --ids 78,81 --reason "validation smoke evidence captured; no active generation" --apply
```

The resolver sets `decision='orphaned'`, fills `decided_at`, and stores the reason in `decision_details`. It never deletes rows.

## Worktree Rule

Use isolated worktrees when two or more agents might edit code concurrently. Keep one worktree as the lane captain and one optional worktree for evidence/support. More than three active agents usually creates coordination overhead in this repo.
