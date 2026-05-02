---
status: queued
updated: 2026-05-02
role: primary-lane-context
---

# L61 End-To-End Smoke After Hardening

## Loop Contract

- Objective: Run one likely-to-complete 3-chapter smoke novel after the L31-L57 hardening stack and record a complete productization evidence packet.
- Starting commit: 6d89447
- Experiment ID: 384
- Budget cap: $4 LXC/model budget.
- Primary lane: L61 end-to-end smoke after hardening.
- Causal hypothesis: After the recent checker, writer-context, integrity, monitoring, and queue-guard hardening, the next useful signal is a full smoke that reveals the next real blocker or confirms the harness can produce a finished 3-chapter artifact under auditable gates.
- Baseline: Recent smokes validated individual fixes and paired replays, but there is no post-L57 complete smoke packet with cost, wall time, checker fires, plan-assist gates, integrity, stop classification, and read-through notes.
- Changed runtime lever: None. This is a validation lane only.
- Feedback signal: One LXC smoke run is classified with `smoke-stop-classifier`, summarized with `operator-summary --json`, and persisted to a tracked result doc with cost, gates, checker fires, integrity status, final phase, and next blocker if any.
- Stop gate: Stop on (a) complete 3-chapter clean pass with evidence packet, (b) new dominant blocker with specific evidence row/log/novel id, (c) regression of an L31-L57 closed cluster, (d) LXC/provider/DB/deploy infrastructure failure, or (e) $4 budget cap.
- Escalation rule: Do not patch runtime behavior inside this lane. If the smoke exposes a blocker, classify it and queue a new single-lever lane.
- Allowed parallel support work: monitoring, operator-summary collection, smoke-stop classification, stale-gate dry-run cleanup, and docs-only result capture.
- DeepSeek V4 Flash concurrency plan: None. Use one seed/run for attribution and budget control.
- Deferred out-of-lane runtime changes: prompt edits, checker severity changes, context changes, retry policy changes, and acceptance policy changes.
- Files/scripts expected to change: `docs/e2e-smoke-2026-05-02.md` or similarly named result doc, this lane doc, `docs/todo.md`, `docs/decisions.md`, and `docs/current-state.md` only if the smoke changes current operating knowledge.
- Evidence artifact: Experiment #384; LXC log path; novel id; `operator-summary --json` output; `smoke-stop-classifier` output; result doc.
- Event log: output/agent-runs/2026-05-02-L61-e2e-smoke-after-hardening/events.jsonl
- Dashboard command: monitor
- Runner command: bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L61-e2e-smoke-after-hardening.md --engine claude --model opus --permission-mode auto --worker-role captain --worker-id captain-claude --max-cycles 8 --max-hours 6 --max-no-change-cycles 1 --queue docs/sessions/lane-queue.md

## Baseline

- Current behavior: The harness has many closed blocker clusters but no fresh end-to-end smoke after the review-gated autonomous cycle and next-work process landed.
- Baseline command(s): `monitor`; `ssh novel-harness-lxc "pgrep -af 'bun src/index' || true"`; `bash scripts/deploy-lxc.sh` after confirming no active generation.
- Baseline result: No active generation expected. L57 is the last active lane before this queue.

## Stop Gates

- (a) Clean pass: smoke completes 3 chapters, result doc records evidence packet, classifier reports clean pass or acceptance-equivalent state, and experiment #384 is concluded.
- (b) New dominant blocker: smoke halts on a specific plan-assist/checker/integrity/runtime blocker outside the lane scope; record novel id, gate row, and next-lane recommendation.
- (c) Regression: any closed L31-L57 cluster returns, such as NER-only retry burn, adherence truncation FN, System rescue failure, unsanctioned walk-on blocker, verbal-action obligation miss, integrity retry regression, prior-state continuity conflation, or queue/review-gate drift.
- (d) Infrastructure failure: deploy guard, SSH, DB, provider, or orchestrator failure prevents interpretation.
- (e) Cost cap: $4 model/runtime spend reached before a clean result.

## Command Plan

- Sample shape / N: One `fantasy-system-heretic` 3-chapter auto-mode smoke unless fresh monitor evidence indicates a safer seed.
- Probe-family key or fixed panel: `L61-e2e-smoke-after-hardening:fss-heretic:3ch`.
- Expected cost: Up to $4.
- Command 1: Confirm no active LXC generation and deploy current committed code if needed: `bash scripts/deploy-lxc.sh`.
- Command 2: Launch on LXC with experiment id: `ssh novel-harness-lxc "cd ~/apps/novel-harness && EXPERIMENT_ID=384 nohup bun src/index.ts --auto --seed fantasy-system-heretic --chapters 3 --experiment 384 > /tmp/smoke-l61-fantasy-system-heretic-$(date +%s).log 2>&1 &"`.
- Runner dry-run: `bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L61-e2e-smoke-after-hardening.md --engine claude --model opus --permission-mode auto --queue docs/sessions/lane-queue.md --dry-run`
- Verification command(s): `monitor`; `bun scripts/operator-summary.ts --latest --json`; `bun scripts/agent/smoke-stop-classifier.ts --known-kinds plan-check-exhausted < <operator-summary-json>`; docs-impact check; whitespace check.

## Progress Log

- Pending.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L61-e2e-smoke-after-hardening.md --actor <opencode|claude|supervisor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L61-e2e-smoke-after-hardening.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L61-e2e-smoke-after-hardening.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome:
- Stop gate fired:
- Evidence link/row/path:
- Cost:
- Commit(s):
- Review:

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 384 --conclusion "<summary>"`.
- Classified pending gates resolved as `orphaned` after dry-run, if any.
- Final checks run: `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- Independent review recorded in `Results: Review` before stop/queue handoff.
- Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- Last safe command: `bun scripts/agent/preflight-loop.ts docs/sessions/2026-05-02-L61-e2e-smoke-after-hardening.md --allow-dirty`
- If failed, failure fingerprint:
- Next action: Start only after L59 and L60 close, unless the user explicitly wants immediate smoke.
