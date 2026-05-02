---
status: active
updated: 2026-05-02
role: interactive-captain-loop-contract
---

# Interactive Engineering Harness Loop

The default engineering loop is now an interactive Claude Code or OpenCode captain session. The external engineering harness owns coding orchestration directly and uses repo-local contract artifacts as shared state. `lane-runner.ts` is retired as the default control plane.

This boundary is deliberate: Novel Harness may call model APIs for novel functionality, evaluation, and observability, but engineering/coding orchestration should rely on established engineering harnesses with their native agents and subagents.

## Official Retirement

`scripts/agent/lane-runner.ts` is **not** the primary engineering loop. Do not start new harness-engineering efforts by adding runner features or debugging runner lifecycle semantics. The runner remains only for legacy/headless one-shot experiments and historical replay.

The runner proved useful for forcing durable state, but it became a second orchestration layer that needed its own liveness, terminal pickup, review, queue, and progress contracts. The durable artifacts are the valuable part; a scripted supervisor is not.

Keep these artifacts:

- lane docs under `docs/sessions/`
- `docs/sessions/lane-queue.md`
- `monitor`, lane heartbeats, and lane messages
- experiment rows and eval/result tables
- preflight, replay-first, docs-impact, operator-summary, and smoke-stop classifier helpers
- independent review evidence or explicit waiver before queue handoff

Retire as default:

- `lane-runner.ts` as the autonomous engineering control plane
- captured one-cycle worker orchestration as the normal path
- debugging runner stop semantics instead of using Claude Code/OpenCode interactive sessions and native agents directly

## Boundary

Use Novel Harness code for:

- novel planning, writing, checking, revision, and evaluation runtime behavior
- API/model calls that are part of novel generation or evaluation
- observability of novel runs: telemetry, operator summaries, dashboards, stop classifiers, product acceptance gates, and DB evidence
- deterministic contract artifacts and sensors consumed by engineering agents

Use Claude Code/OpenCode for:

- coding orchestration
- subagent spawning and coordination for engineering work
- implementation, review, docs finalization, and queue handoff
- interactive human/operator decision points

Do not build a bespoke in-repo replacement for Claude Code/OpenCode agent orchestration.

## Launch

Start or resume the Claude Code captain session with:

```bash
bun scripts/agent/open-claude-captain.ts
```

For a specific lane:

```bash
bun scripts/agent/open-claude-captain.ts docs/sessions/<lane>.md
```

Dry-run the handoff prompt without opening WezTerm:

```bash
bun scripts/agent/open-claude-captain.ts docs/sessions/<lane>.md --dry-run --print-prompt
```

The helper opens WezTerm, starts interactive Claude Code, injects the lane contract, monitor snapshot, recommended first action, and captain rules, then records a `claude_captain_terminal_spawn` event plus heartbeat in the lane log. OpenCode can also be used directly as the engineering captain when that is the better interactive harness; it should follow the same lane docs, monitor, heartbeat, message, experiment, review, and commit contract.

## Captain Responsibilities

The captain must:

- read the active lane doc and `monitor` before acting
- keep one primary lane and one causal hypothesis active
- record heartbeat events before substantial work
- use lane messages for delegated work and ownership handoffs
- spawn Claude Code/OpenCode agents only for bounded support work such as evidence collection, focused tests, review, or docs finalization
- persist important findings to lane docs, result docs, DB rows, or commits
- conclude experiments and record review evidence before queue handoff
- never push without explicit user instruction

## Subagent Pattern

Use engineering-harness agents for bounded work that has a clear return artifact.

Good subagent jobs:

- inspect a fixed panel and report row counts/class distribution
- monitor an LXC smoke and return the novel id, log path, phase, cost, and blocker rows
- run focused tests and report exact commands/results
- perform commit-pinned implementation review
- draft docs finalization from supplied evidence

Bad subagent jobs:

- own the whole lane without a captain
- change runtime behavior while another agent changes a different lever
- make product decisions without recording rationale
- run long background jobs without lane-message ownership

## Loop Procedure

1. Start the captain terminal with `open-claude-captain.ts`.
2. Run `monitor --once` and inspect the active lane doc.
3. If the lane is blocked only by stale heartbeat, refresh heartbeat and continue from durable state.
4. If dirty files exist, classify ownership before editing. Do not overwrite another agent's lane doc or result doc changes.
5. Execute the smallest safe next action for the lane.
6. Use subagents for bounded evidence/support/review tasks.
7. Update `## Progress Log` during the lane, not only at finalization.
8. When stop gate fires, fill `## Results`, conclude the experiment, record review evidence/waiver, run checks, and commit final docs/cleanup.
9. Advance `docs/sessions/lane-queue.md` manually only after the current lane is finalized.
10. If the queue is empty, run `docs/harness-next-work-process.md` to select the next lane.

## Legacy Runner Policy

`scripts/agent/lane-runner.ts` remains available for experiments, historical replay, or headless one-shot tasks. It is not the recommended way to run the full harness engineering loop.

If used, it must still obey the same contract artifacts and review gate. Do not add more runner orchestration features unless they serve as reusable sensors/tools for Claude Code/OpenCode.
