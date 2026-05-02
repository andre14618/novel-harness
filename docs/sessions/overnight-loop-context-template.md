---
status: template
updated: 2026-05-02
role: overnight-loop-context-template
---

# Overnight Loop Context Template

Use this template for any unattended Claude loop. Copy it to `docs/sessions/YYYY-MM-DD-<short-loop-name>.md` before starting the loop and keep it current enough that a fresh agent can resume safely without chat history. The primary lane is mandatory; support work is allowed only when it does not change unrelated runtime behavior.

## Loop Contract

- Objective:
- Starting commit:
- Experiment ID:
- Budget cap:
- Primary lane:
- Causal hypothesis:
- Baseline:
- Changed runtime lever:
- Feedback signal:
- Stop gate:
- Escalation rule:
- Allowed parallel support work:
- DeepSeek V4 Flash concurrency plan:
- Deferred out-of-lane runtime changes:
- Files/scripts expected to change:
- Evidence artifact:
- Event log: output/agent-runs/<lane-id>/events.jsonl
- Dashboard command: bun scripts/agent/lane-dashboard.ts docs/sessions/<lane>.md --watch --latest-novel
- Runner command: bun scripts/agent/lane-runner.ts docs/sessions/<lane>.md --engine claude --model opus --permission-mode auto --max-cycles 30 --max-hours 8

## Baseline

- Current behavior:
- Baseline command(s):
- Baseline result:

## Stop Gates

- (a) Clean pass:
- (b) New dominant blocker:
- (c) Regression:
- (d) Infrastructure failure:
- (e) Cost cap:

## Command Plan

- Sample shape / N:
- Probe-family key or fixed panel:
- Expected cost:
- Command 1:
- Command 2:
- Runner dry-run: `bun scripts/agent/lane-runner.ts docs/sessions/<lane>.md --engine claude --model opus --permission-mode auto --dry-run`
- Verification command(s):

## Progress Log

- Pending.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/<lane>.md --actor <opencode|claude|supervisor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/<lane>.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/<lane>.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome:
- Stop gate fired:
- Evidence link/row/path:
- Cost:
- Commit(s):

## Pickup Instructions

- Last safe command:
- If failed, failure fingerprint:
- Next action:
