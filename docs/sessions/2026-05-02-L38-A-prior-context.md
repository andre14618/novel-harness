---
status: active
updated: 2026-05-02
role: primary-lane-context
---

# L38-A Prior-Context Writer Grounding

## Loop Contract

- Objective: Wire prior-chapter reader-info state into production beat context so the writer sees facts already established before drafting chapter N.
- Starting commit: 22353da
- Experiment ID: 369
- Budget cap: $4 DeepSeek V4 Flash runtime validation cap after commit and deploy; local tests/replay first.
- Primary lane: L38-A prior-chapter writer grounding.
- Causal hypothesis: The chapter-2 continuity blocker cluster is caused mostly by missing cumulative prior-chapter establishedFacts and character ignorance state in beat-writer context, not by checker threshold or planner routing.
- Baseline: L41-val novel `novel-1777721066908` bailed in chapter 2 on 5 continuity blockers; L38 investigation found 3 writer-side conflations tied to missing prior-chapter state in `buildBeatContext`.
- Changed runtime lever: Import and render the existing `enriched-context.ts` READER-INFO STATE surface into production beat context for chapters after chapter 1.
- Feedback signal: Parity/prompt-shape test shows prior-chapter established facts and per-character `doesNotKnow` render in beat-writer input; post-deploy heretic ch2 smoke has zero continuity blockers from writer-side prior-state conflation.
- Stop gate: Stop on (a) heretic ch2 reaches approval with no writer-side prior-state continuity blockers, (b) a new dominant blocker appears after L38-A is active, (c) prompt/cache bloat or writer confusion regression is observed, (d) DB/deploy/provider evidence is unavailable, or (e) $4 cap is reached.
- Escalation rule: If L38-A removes writer-side conflation but planner-side scope narrowing remains, stop and queue L38-B; if summaries are still absent but L38-A helps, queue L38-C separately; do not change continuity severity in this lane.
- Allowed parallel support work: parity tests, prompt-size measurement, monitor/heartbeat updates, docs-impact audit, operator summary, stop-condition classification.
- DeepSeek V4 Flash concurrency plan: None until local/parity tests pass and the runtime change is committed/deployed; validation starts with one paired heretic smoke replay/live run, then repeats only if the stop class is ambiguous and budget remains.
- Deferred out-of-lane runtime changes: chapter summary wiring (L38-C), planner prior-fact context (L38-B), continuity checker calibration/threshold changes (L38-E), L41 live-trigger smoke.
- Files/scripts expected to change: `src/agents/writer/beat-context.ts`, `src/agents/writer/enriched-context.ts` only if needed, focused writer-context tests, docs/current-state.md if runtime behavior changes.
- Evidence artifact: Experiment #369 plus test output; post-deploy smoke evidence should link to operator-summary output, `chapter_exhaustions`, and any persisted run/eval row.
- Event log: output/agent-runs/2026-05-02-L38-A-prior-context/events.jsonl
- Dashboard command: bun scripts/agent/lane-dashboard.ts docs/sessions/2026-05-02-L38-A-prior-context.md --watch --latest-novel
- Runner command: bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L38-A-prior-context.md --engine claude --model opus --permission-mode auto --max-cycles 30 --max-hours 8

## Baseline

- Current behavior: Production `buildBeatContext` emits current beat/scene surfaces but does not aggregate prior-chapter established facts or per-character does-not-know state into the writer prompt.
- Baseline command(s): Review `docs/l38-investigation-2026-05-02.md`; inspect `src/agents/writer/beat-context.ts` and `src/agents/writer/enriched-context.ts`; run focused writer context tests before edits.
- Baseline result: `novel-1777721066908` chapter 2 halted on continuity blockers; investigation classified 3/5 as writer-side prior-state conflations that L38-A targets.

## Stop Gates

- (a) Clean pass: L38-A context renders in tests and heretic ch2 smoke has zero writer-side prior-state continuity blockers.
- (b) New dominant blocker: The prior-state conflation cluster disappears but another checker/runtime cluster halts the smoke.
- (c) Regression: Prompt bloat, malformed context, new halluc/adherence blocker pattern, or prior-state facts are rendered to chapter 1 where they do not belong.
- (d) Infrastructure failure: DB, deploy, monitor, provider, or evidence queries prevent interpreting the result.
- (e) Cost cap: $4 validation cap reached before a readable stop class.

## Command Plan

- Sample shape / N: Local parity/prompt-shape tests first; one heretic ch2 post-deploy smoke after commit/deploy.
- Probe-family key or fixed panel: `L38-A-prior-context-heretic-ch2` using the L41/L38 heretic failure cluster as baseline.
- Expected cost: Local tests $0; first live smoke capped at $4.
- Command 1: `bun test <focused writer context tests>`
- Command 2: `bun scripts/preflight-docs-impact.ts --strict`
- Runner dry-run: `bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L38-A-prior-context.md --engine claude --model opus --permission-mode auto --dry-run`
- Verification command(s): `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L38-A-prior-context.md --json`; after commit/deploy, LXC smoke plus `bun scripts/operator-summary.ts --latest`.

## Progress Log

- 2026-05-02: Lane created from monitor-ready template. Experiment #369 created. Runtime work not started yet.
- 2026-05-02: Claude-capable `lane-runner.ts` supervisor documented and ready; start with dry-run, then bounded `--engine claude` cycles.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-A-prior-context.md --actor <opencode|claude|supervisor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-A-prior-context.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-A-prior-context.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome:
- Stop gate fired:
- Evidence link/row/path:
- Cost:
- Commit(s):

## Pickup Instructions

- Last safe command: `bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L38-A-prior-context.md --engine claude --model opus --permission-mode auto --dry-run`
- If failed, failure fingerprint:
- Next action: Inspect the existing enriched-context renderer and production beat-context assembly; add the smallest parity test that proves prior-chapter reader-info state appears only where intended.
