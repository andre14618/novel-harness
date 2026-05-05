---
status: active
updated: 2026-05-05
---

# Agent Lane Protocol

Repo-local protocol for running interactive Claude Code/OpenCode captain sessions and support agents against the same primary lane without relying on private chat state.

Default engineering control plane: **Claude Code or OpenCode interactive harness**. `lane-runner.ts` is officially retired as the default loop and is legacy/optional only. Do not invest in runner orchestration as the main loop. See `docs/interactive-claude-captain-loop.md`.

## Roles

- **Lane captain:** owns the primary runtime hypothesis, integration, commits, and stop-gate decision.
- **Evidence agent:** builds or runs fixed-panel replay, repeated same-family runs, or result analysis for the active lane.
- **Test and Invariant Agent:** owns test tier shape, invariant promotion,
  local gate health, and coverage handoff for a lane. Follow
  `docs/test-invariant-agent.md`.
- **Support agent:** handles tests, docs-impact audits, operator summaries, stop classifiers, and pickup docs.

Only the lane captain should edit runtime behavior unless the lane context explicitly delegates a same-hypothesis arm to another worktree.

## Shared State

Every lane uses:

- `docs/sessions/<lane>.md` for the durable loop contract.
- `output/agent-runs/<lane-id>/events.jsonl` for append-only heartbeat and event records.
- `output/agent-runs/<lane-id>/messages.jsonl` for addressed operational requests, claims, handoffs, and results.
- `tuning_experiments`, `phase_eval_runs`, and `llm_calls` for persistent evidence.
- Git commits for completed coherent work.

Chat history is not a source of truth.

When a queue ends or a user asks what harness work should happen next, use `docs/harness-next-work-process.md` to choose one primary lane. Do not start a captain session from a broad backlog item without passing that process's specificity gate.

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
monitor --full
monitor --panel outside --panel coordination --panel evidence
```

Open the default interactive Claude Code captain terminal:

```bash
bun scripts/agent/open-claude-captain.ts
bun scripts/agent/open-claude-captain.ts docs/sessions/<lane>.md --dry-run --print-prompt
```

The captain helper opens a new WezTerm window by default, starts interactive Claude Code, injects the lane contract plus monitor snapshot, records a `claude_captain_terminal_spawn` event, and refreshes the lane heartbeat. The interactive engineering harness, not `lane-runner.ts`, owns orchestration, subagent delegation, finalization, and queue handoff. Use OpenCode directly instead when it is the preferred engineering harness for the session; follow the same durable lane contract either way.

Open an interactive pickup terminal when a lane is blocked/stale and the human wants context before continuing:

```bash
bun scripts/agent/open-pickup-terminal.ts
bun scripts/agent/open-pickup-terminal.ts docs/sessions/<lane>.md --only-if-blocked
```

The helper opens a new WezTerm window by default, starts interactive OpenCode with a generated pickup prompt, writes that prompt under `output/agent-runs/<lane-id>/pickup/`, records a `pickup_terminal_spawn` event, and refreshes the lane heartbeat so stale-heartbeat blocking clears. Use `--tab` for a new tab instead of a new window, `--no-model` to use OpenCode's configured default model, and `--dry-run --print-prompt` to inspect the handoff without launching anything.

Coordinate operational handoffs between agents:

```bash
bun scripts/agent/lane-message.ts send docs/sessions/<lane>.md --actor captain --to evidence --kind request --subject "Monitor LXC replay" --body "Watch novel-123 until chapter 2 completes or gates" --ref "novel-123" --ref "/tmp/smoke.log"
bun scripts/agent/lane-message.ts claim docs/sessions/<lane>.md <msg-id> --actor evidence --lease-minutes 30
bun scripts/agent/lane-message.ts resolve docs/sessions/<lane>.md <msg-id> --actor evidence --result "Replay gated on chapter_exhaustions.id=84" --ref "chapter_exhaustions#84"
bun scripts/agent/lane-message.ts list docs/sessions/<lane>.md --open
```

Finalize lane docs with the OpenCode docs-finalizer subagent:

```bash
bun scripts/agent/finalizer-packet.ts docs/sessions/<lane>.md --result "<pass|refuted|new blocker|regression|infra failure|human-needed>" --commit <sha> --evidence "experiment#<id>" --print
bun scripts/agent/finalize-docs.ts docs/sessions/<lane>.md --result "<pass|refuted|new blocker|regression|infra failure|human-needed>" --commit <sha> --evidence "experiment#<id>" --evidence "chapter_exhaustions#<id>"
```

### Legacy: Unattended Runner (Deprecated)

`scripts/agent/lane-runner.ts` is retained only for headless one-shot experiments and historical replay. Do not reach for it as the default engineering loop — start an interactive Claude Code or OpenCode captain via `open-claude-captain.ts` instead. See `docs/interactive-claude-captain-loop.md`.

```bash
bun scripts/agent/lane-runner.ts docs/sessions/<lane>.md --dry-run
bun scripts/agent/lane-runner.ts docs/sessions/<lane>.md --max-cycles 4 --max-hours 3 --model openai/gpt-5.5
bun scripts/agent/lane-runner.ts docs/sessions/<lane>.md --engine claude --model opus --permission-mode auto --max-cycles 30 --max-hours 8
bun scripts/agent/lane-runner.ts docs/sessions/<lane>.md --engine claude --model opus --permission-mode auto --max-cycles 30 --max-hours 8 --queue docs/sessions/lane-queue.md --pickup-terminal-on-stop
nohup bun scripts/agent/lane-runner.ts docs/sessions/<lane>.md --engine claude --model opus --permission-mode auto --max-cycles 30 --max-hours 8 --queue docs/sessions/lane-queue.md --pickup-terminal-on-stop > /tmp/lane-runner-<lane-id>.log 2>&1 &
# Visible-terminal workers (legacy; prefer open-claude-captain.ts):
bun scripts/agent/lane-runner.ts docs/sessions/<lane>.md --engine claude --model opus --permission-mode auto --worker-role captain --worker-id captain-claude --worker-io terminal
bun scripts/agent/lane-runner.ts docs/sessions/<lane>.md --engine opencode --model openai/gpt-5.5 --worker-role evidence --worker-id evidence-dsv4 --worker-io terminal
```

`monitor` is the compact shell shortcut for `bun run monitor` in this repo. Human-facing monitoring instructions should default to bare `monitor`; use expanded `bun run monitor`, `bun scripts/agent/monitor.ts`, or `lane-dashboard` commands only when debugging the alias or working where the alias is unavailable. It defaults to the latest non-template session doc with a complete `Loop Contract`, watches continuously, hides latest-novel wall text, and shows only the operational panels: `outside`, `coordination`, and `process`. The default outside view includes `Lane progress`, sourced from the lane doc's latest `Progress Log` bullets and populated `Results` fields. If no active lane exists, bare `monitor` stays open in a waiting state and polls until a complete lane doc appears. Use `monitor --once` for a single render, `monitor --append` to append snapshots intentionally, `monitor --full` for all panels plus latest novel summary, or `monitor --panel <name>` to choose panels explicitly. In non-TTY/captured output, watch mode renders one snapshot instead of repeating forever unless `--append` is explicit.

Panels are `all`, `outside`, `coordination`, `inside`, `evidence`, `hygiene`, and `process`. `outside` renders the lane contract, heartbeat/event log, and git state. `coordination` shows active worker identity when present, latest heartbeat actor, claimed work by actor, open lane messages, claimed work, and expired leases from `output/agent-runs/<lane-id>/messages.jsonl`. `inside` delegates to `scripts/operator-summary.ts`. `evidence` shows the lane experiment and latest `phase_eval_runs`. `hygiene` shows dirty/unpushed git state, pending/stale gates, open experiments, and docs-impact status. `process` shows DB reachability, recent LLM calls, local/LXC generation process state, and LXC orchestrator state.

Older session docs created before the lane-contract template are intentionally skipped by bare `monitor`; pass the path explicitly if you want to inspect a legacy doc.

`preflight-loop.ts` is the lane-contract gate for any captain session. It validates the lane doc's `Loop Contract` (REQUIRED_LOOP_FIELDS plus an explicit `Files/scripts expected to change` deploy implication), confirms the starting commit resolves in git, confirms the experiment id is a positive integer, and checks the worktree is clean (or `--allow-dirty` is explicit). Exit codes: 0 pass, 10 lane-context, 20 dirty-worktree, 22 git-infra. Run `bun scripts/agent/preflight-loop.ts docs/sessions/<lane>.md` before launching a captain on a new lane.

`lane-runner.ts` is legacy. It is a bounded supervisor for headless one-shot experiments or historical replay, not the engineering control plane. Prefer Claude Code/OpenCode interactive sessions for coding work.

Use `--pickup-terminal-on-stop` for supervised unattended runs where a human is nearby. When the runner exits on blocked, human-needed, infra-failure, stop-without-advance, max cycles/hours, or no-change limit, it calls `open-pickup-terminal.ts` before exiting. The pickup terminal opens WezTerm/OpenCode with the current lane context and a single recommended next action. The flag is opt-in so CI/headless environments do not try to open a GUI terminal unexpectedly.

Queued advancement has a review gate by default. Before a stopped lane can advance, `Results: Review` must be populated with independent commit-pinned review evidence such as `impl-review <sha> PASS`, or an explicit waiver reason and reviewer. Use `--no-review-gate` only for historical-lane replay where old Results sections predate this field.

Do not use `--worker-io terminal` as a substitute for a real Claude Code/OpenCode session. Start the engineering harness directly with `open-claude-captain.ts`, `claude`, or `opencode` and use lane artifacts for shared state.

Every captain/support agent should have an explicit durable identity such as `captain-claude`, `captain-opencode`, `evidence-claude`, or `support-opencode`, and should use that identity in `lane-heartbeat --actor` and `lane-message --actor`.

Agents coordinate through durable shared state rather than private chat. Use the terminal session for immediate discussion, but make cross-agent requests durable with `lane-message`, current progress durable with `lane-heartbeat`, conclusions durable in lane-doc progress/results, evidence durable in DB rows, and completed work durable in commits. A useful pattern is: lane captain owns runtime edits, evidence agent claims fixed-panel or LXC monitoring requests, support agent claims tests/docs-impact requests, and `monitor --panel coordination` renders open ownership.

The lane message bus is intentionally small and operational. `send` creates an addressed message. `claim` records who owns it and for how long. `resolve` records the finding and evidence references. `cancel` closes obsolete requests. Messages are append-only JSONL under `output/agent-runs/<lane-id>/messages.jsonl`; the dashboard collapses updates by message id and flags expired claims. Use messages for short-lived operational coordination, not as a replacement for lane docs, experiments, or commits.

`docs-finalizer` is a repo-local OpenCode subagent stored at `.opencode/agent/docs-finalizer.md`. `scripts/agent/finalize-docs.ts` first builds a deterministic handoff packet with `scripts/agent/finalizer-packet.ts`, then invokes OpenCode on `deepseek/deepseek-v4-flash` with the high reasoning variant. The packet gives DeepSeek required evidence (lane fields, supplied commits/evidence, current Results), supporting context (recent events/messages and git state), and inventory (durable docs, log paths, warnings). Point it at a lane/session doc plus result classification, commits, and evidence refs when the lane has a durable result. It may update the lane Results, `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, and `docs/lessons-learned.md`, then run docs-impact and whitespace checks. It commits only allowed documentation files with a `[docs] ...` message and must not edit runtime code or push.

When using the legacy runner in the background, treat the `/tmp/lane-runner-<lane-id>.log` file as the supervisor process log and the per-cycle files under `output/agent-runs/<lane-id>/cycles/` as the worker transcript artifacts. Use `monitor --once` for a compact snapshot without taking over the terminal, or `monitor --append` only when you intentionally want repeated snapshots in a log.

Queue advancement is deterministic. A captain should advance only after the stopped lane has `Results: Outcome`, `Results: Stop gate fired`, `Results: Evidence link/row/path`, `Results: Commit(s)`, and `Results: Review` filled. Queue entries must point to pre-created lane docs:

```markdown
# Lane Queue

## Active
- docs/sessions/current-lane.md

## Next
1. docs/sessions/next-lane.md
```

A lane with a durable result should update persistent docs, conclude its experiment, resolve classified stale gates as `orphaned`, run docs-impact plus whitespace checks, record independent review evidence or waiver in `Results: Review`, and commit the docs/cleanup unit before queue handoff. This keeps the queue moving without depending on private chat history.

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
