---
status: queued
updated: 2026-05-02
role: primary-lane-context
---

# L38-C Chapter Summary Wiring

## Loop Contract

- Objective: Restore or implement chapter summary persistence so future chapters have a compact prior-chapter bridge surface in addition to fact lists.
- Starting commit: cd832f7
- Experiment ID: 371
- Budget cap: $2 DeepSeek V4 Flash validation cap after local tests; no live smoke until the persistence path is proven locally or by DB inspection.
- Primary lane: L38-C chapter summary wiring.
- Causal hypothesis: Empty `chapter_summaries` rows remove a compact narrative bridge that should help later chapters preserve what happened, even though L38-A showed raw fact presence alone is not enough.
- Baseline: `novel-1777721066908` and recent generated novels show empty `chapter_summaries`, while chapter outlines and character state facts exist.
- Changed runtime lever: Identify why chapter summaries are absent, then wire the smallest persistence or summarization path needed to populate `chapter_summaries` after chapter approval.
- Feedback signal: Focused tests or DB-backed local verification show an approved chapter writes a summary row; a narrow post-change run or fixture confirms chapter N+1 can retrieve the persisted summary without changing unrelated writer/checker policy.
- Stop gate: Stop on (a) summary persistence is restored with tests and evidence, (b) summaries are intentionally obsolete and a better existing bridge is identified, (c) fixing summaries requires broader pipeline design, (d) DB/deploy/provider evidence is unavailable, or (e) $2 cap is reached.
- Escalation rule: If summaries are obsolete, document the replacement bridge and close L38-C without adding a new summarizer. If a broader phase boundary change is required, stop and queue a new architecture lane rather than mixing it here.
- Allowed parallel support work: schema inspection, service-layer tracing, focused persistence tests, docs-impact audit, operator summary, experiment conclusion, stale-gate cleanup for classified evidence rows.
- DeepSeek V4 Flash concurrency plan: None until local persistence evidence exists. Use at most one cheap validation run if a live chapter approval is needed to prove persistence.
- Deferred out-of-lane runtime changes: writer prompt-discipline/model routing for READER-INFO adherence, continuity checker calibration, planner prior-fact context, retry budget changes.
- Files/scripts expected to change: `src/phases/**`, `src/db/**` or `src/harness/**` summary accessors if needed, focused tests, docs/current-state.md if runtime behavior changes.
- Evidence artifact: Experiment #371 plus test output, DB rows or operator-summary output proving `chapter_summaries` persistence.
- Event log: output/agent-runs/2026-05-02-L38-C-chapter-summary-wiring/events.jsonl
- Dashboard command: bun scripts/agent/lane-dashboard.ts docs/sessions/2026-05-02-L38-C-chapter-summary-wiring.md --watch --latest-novel
- Runner command: bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L38-C-chapter-summary-wiring.md --engine claude --model opus --permission-mode auto --max-cycles 30 --max-hours 8 --queue docs/sessions/lane-queue.md

## Baseline

- Current behavior: Recent novels have empty `chapter_summaries`, so no compact narrative summary bridge is available for later chapter context.
- Baseline command(s): Inspect summary table/schema through service-layer or information_schema; inspect phase code for chapter approval and summary persistence; query `novel-1777721066908` summary rows through repo DB helpers.
- Baseline result: L38 investigation found the summary surface absent while outline facts and character state facts exist.

## Stop Gates

- (a) Clean pass: approved chapter writes or exposes a summary row with focused tests/evidence.
- (b) Obsolete surface: `chapter_summaries` is no longer intended to be populated and an existing replacement bridge is documented.
- (c) Design boundary: restoration requires broader phase/summarizer architecture.
- (d) Infrastructure failure: DB, deploy, provider, or evidence queries prevent interpretation.
- (e) Cost cap: $2 validation cap reached before a readable stop class.

## Command Plan

- Sample shape / N: Local schema/code inspection first; one focused persistence test; optional one chapter-approval validation only if needed.
- Probe-family key or fixed panel: `L38-C-summary-persistence`.
- Expected cost: $0 for local tests; optional live validation capped at $2.
- Command 1: `bun test <focused summary persistence tests>`
- Command 2: `bun scripts/preflight-docs-impact.ts --strict`
- Runner dry-run: `bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L38-C-chapter-summary-wiring.md --engine claude --model opus --permission-mode auto --queue docs/sessions/lane-queue.md --dry-run`
- Verification command(s): `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L38-C-chapter-summary-wiring.md --json`; DB evidence for summary rows.

## Progress Log

- Pending. Queued after L38-F because L38-A showed raw READER-INFO fact presence is not enough; summaries remain independently useful but should not be treated as the immediate fix for writer-side prompt adherence.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-C-chapter-summary-wiring.md --actor <opencode|claude|supervisor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-C-chapter-summary-wiring.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-C-chapter-summary-wiring.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome:
- Stop gate fired:
- Evidence link/row/path:
- Cost:
- Commit(s):

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 371 --conclusion "<summary>"`.
- Classified pending gates resolved as `orphaned` after dry-run, if any.
- Final checks run: `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- Last safe command: `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L38-C-chapter-summary-wiring.md --json`
- If failed, failure fingerprint:
- Next action: Inspect the current summary table/schema and phase approval path. Do not edit writer prompts or continuity policy in this lane.
