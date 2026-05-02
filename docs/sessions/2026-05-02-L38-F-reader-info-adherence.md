---
status: queued
updated: 2026-05-02
role: primary-lane-context
---

# L38-F Reader-Info Adherence

## Loop Contract

- Objective: Make the beat writer obey prior-state facts it can already see in READER-INFO STATE, targeting the chapter-2 "only-now-discovers" conflation cluster.
- Starting commit: cd832f7
- Experiment ID: 370
- Budget cap: $4 DeepSeek V4 Flash runtime validation cap after local tests/replay; paired replay before any broad live smoke.
- Primary lane: L38-F writer READER-INFO adherence.
- Causal hypothesis: The remaining chapter-2 prior-state conflation cluster is caused by weak writer salience/discipline around visible READER-INFO STATE, not missing facts or planner context.
- Baseline: L38-A paired replay on `novel-1777721066908` showed beat-writer prompts contained all 8 chapter-1 facts (`llm_calls.id` 58325/58371), yet chapter 2 still bailed on the same prior-state conflation cluster (`chapter_exhaustions.id` 83 vs baseline 81).
- Changed runtime lever: Add the smallest writer-side instruction, prompt placement, or writer-routing probe that makes READER-INFO STATE binding for beat-level drafting without changing checker thresholds or adding more context.
- Feedback signal: Paired replay over `novel-1777721066908` chapter 2 shows no writer-side "only-now-discovers" prior-state discovery/conflation blockers after READER-INFO STATE is present; prompt-shape tests confirm the rule is visible only where intended.
- Stop gate: Stop on (a) paired replay removes the prior-state writer-conflation blockers, (b) READER-INFO adherence improves but a new dominant blocker appears, (c) writer quality/regression or prompt bloat worsens, (d) DB/deploy/provider evidence is unavailable, or (e) $4 cap is reached.
- Escalation rule: If a minimal writer prompt/salience change fails while facts are present, stop and queue a writer model-routing probe rather than adding more context. If model routing helps but prompt discipline does not, document that as a separate lane.
- Allowed parallel support work: prompt-shape tests, paired replay helper work, docs-impact audit, operator summary, stale-gate cleanup for classified evidence rows, experiment conclusion, final docs sweep.
- DeepSeek V4 Flash concurrency plan: None before local/prompt tests pass. Use one paired replay on `novel-1777721066908` chapter 2 first; repeat only if the stop class is ambiguous and budget remains.
- Deferred out-of-lane runtime changes: chapter summary wiring (L38-C), planner prior-fact context (L38-B), continuity checker calibration (L38-E), retry budget changes, broad model routing outside the declared writer probe.
- Files/scripts expected to change: beat-writer prompt files or beat-context rendering/salience tests; `src/models/roles.ts` only if the lane explicitly records a writer-routing probe; docs/current-state.md if runtime behavior changes.
- Evidence artifact: Experiment #370 plus focused test output, paired replay evidence, `chapter_exhaustions` comparison, and `llm_calls` prompt rows proving READER-INFO STATE presence.
- Event log: output/agent-runs/2026-05-02-L38-F-reader-info-adherence/events.jsonl
- Dashboard command: bun scripts/agent/lane-dashboard.ts docs/sessions/2026-05-02-L38-F-reader-info-adherence.md --watch --latest-novel
- Runner command: bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L38-F-reader-info-adherence.md --engine claude --model opus --permission-mode auto --max-cycles 30 --max-hours 8 --queue docs/sessions/lane-queue.md

## Baseline

- Current behavior: READER-INFO STATE is present in chapter-2 beat-writer prompts, but the writer still dramatizes established facts as fresh discoveries.
- Baseline command(s): Review `docs/sessions/2026-05-02-L38-A-prior-context.md`; inspect `chapter_exhaustions.id` 81 and 83; inspect `llm_calls.id` 58325 and 58371 for the READER-INFO STATE section.
- Baseline result: L38-A refuted missing-context hypothesis; blocker count changed 5 -> 4 but dominant writer-side prior-state conflation remained.

## Stop Gates

- (a) Clean pass: paired replay removes writer-side prior-state discovery/conflation blockers from chapter 2.
- (b) New dominant blocker: prior-state conflation is gone but another checker/runtime cluster halts the replay.
- (c) Regression: prompt bloat, weaker prose, new halluc/adherence blockers, or READER-INFO facts overconstrain chapter 1 where they do not belong.
- (d) Infrastructure failure: DB, deploy, monitor, provider, or evidence queries prevent interpretation.
- (e) Cost cap: $4 validation cap reached before a readable stop class.

## Command Plan

- Sample shape / N: Local prompt-shape tests first; one paired replay on `novel-1777721066908` chapter 2 after commit/deploy.
- Probe-family key or fixed panel: `L38-F-reader-info-adherence-ch2`.
- Expected cost: Local tests $0; first paired replay capped at $4.
- Command 1: `bun test <focused writer prompt/context tests>`
- Command 2: `bun scripts/preflight-docs-impact.ts --strict`
- Runner dry-run: `bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L38-F-reader-info-adherence.md --engine claude --model opus --permission-mode auto --queue docs/sessions/lane-queue.md --dry-run`
- Verification command(s): `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L38-F-reader-info-adherence.md --json`; paired replay evidence via `bun scripts/operator-summary.ts novel-1777721066908` and targeted DB prompt/exhaustion inspection through repo helpers.

## Progress Log

- Pending. Queued from L38-A refutation: the writer sees prior-state facts but does not reliably use them.
- 2026-05-02 (cycle 2): Added a single READER-INFO STATE binding rule to the production beat-writer system prompt (and mirrored into the dormant Salvatore primer variant). Rule teaches the writer that "Reader already knows" facts are established history for the POV character and any character who acted in them — those characters cannot be drafted as discovering or first-realizing the fact. Only "Hidden from {char}" lines mark information as new for that character. This is the smallest writer-side instruction change targeted at the L38-A refutation failure mode (writer drafted Maret discovering a sealed report she had copied months ago).
  - Files: `src/agents/writer/beat-writer-system.md`, `src/agents/writer/beat-writer-system-salvatore.md`, `scripts/evals/writer-prompts.test.ts`.
  - Tests: `bun test scripts/evals/writer-prompts.test.ts src/agents/writer/ tests/beat-context-parity.test.ts` → 89 pass / 0 fail. `bunx tsc --noEmit` clean.
  - Commit: `d5c8e95` (`[agent:writer] L38-F: bind READER-INFO STATE in beat-writer system prompt`).
  - Pending: deploy + paired replay on `novel-1777721066908` chapter 2 to evaluate stop gates (a)/(b)/(c).

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-F-reader-info-adherence.md --actor <opencode|claude|supervisor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-F-reader-info-adherence.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-F-reader-info-adherence.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome:
- Stop gate fired:
- Evidence link/row/path:
- Cost:
- Commit(s):

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 370 --conclusion "<summary>"`.
- Classified pending gates resolved as `orphaned` after dry-run, if any.
- Final checks run: `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- Last safe command: `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L38-F-reader-info-adherence.md --json`
- If failed, failure fingerprint:
- Next action: Inspect the beat-writer prompt and READER-INFO STATE placement. Make one narrow writer-discipline or salience change; do not add more context or change checker severity in this lane.
