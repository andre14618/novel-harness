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
- 2026-05-02 (cycle 1): Wired READER-INFO STATE into production beat context.
  - `src/agents/writer/enriched-context.ts`: exported `renderReaderInfoStateBlock` + new `selectReaderInfoStateForBeat` slot-selector (chapter > 1 gate).
  - `src/agents/writer/beat-context.ts`: added `priorChapterFacts?: Fact[]` to `BeatContextInput`, `readerInfoState: string | null` to `BeatContext`; slot builder calls `selectReaderInfoStateForBeat`.
  - `src/agents/writer/beat-context-render.ts`: appends the section between resolved-references and SETTING, mirroring `insertEnrichedSection` anchor.
  - `src/phases/drafting.ts`: fetches `getFactsUpToChapter(novelId, ch - 1)` and threads `priorChapterFacts` at all three `buildBeatContext` call sites (initial draft + chapter-plan-check rewrite + validation rewrite).
  - Tests: new `beat-context-prior-state.test.ts` (5 cases pinning the gate), `beat-context-render.test.ts` (placement + null-suppression), updated render-test fixture for the new slot. Byte-parity gate (20 fixtures) still passes — fixtures pass no `priorChapterFacts` so the gate returns null and the rendered prompt is byte-identical.
  - Checks: `bun test src/agents/writer/ src/phases/ tests/beat-context-parity.test.ts` → 136 pass / 0 fail; `bunx tsc --noEmit` clean; `bun scripts/preflight-docs-impact.ts --strict` OK.
  - Pending: commit + LXC deploy + heretic ch2 smoke (stop-gate evaluation).
- 2026-05-02 (cycle 2): Deployed cycle-1 commit `0f92be3` to LXC and launched the heretic ch2 smoke for stop-gate evaluation.
  - Deploy: `bash scripts/deploy-lxc.sh` clean (orchestrator restarted, migrations applied).
  - Pre-deploy guard: `ssh novel-harness-lxc "ps aux | grep 'bun src/index'"` → no active generation.
  - Smoke launch: `EXPERIMENT_ID=369 nohup bun src/index.ts --auto --seed fantasy-system-heretic --chapters 2 --runs 1` → log `/tmp/smoke-l38a-heretic-1777734605.log` (LXC PID 1121178).
  - Pending: monitor smoke completion; evaluate stop gates (a) clean ch2 vs (b) new dominant blocker vs (c) regression.
- 2026-05-02 (cycle 3): Heretic smoke (cycle-2 launch) bailed in chapter 1 — never reached chapter 2; relaunched on L41 baseline novel via `--resume` to actually exercise L38-A.
  - Heretic smoke result (`novel-1777734605735`): bailed at chapter 1, attempt 1, kind=`plan-check-exhausted`, decision=null. 6 unresolved blockers, all `[beat-check:halluc-ungrounded]` on Beat 5 (writer invented entities like "terminal on the second floor", "junior records clerk", "municipal annex terminals"). Continuity check passed clean.
  - Classification: NOT a stop gate for L38-A. The chapter-1 failure is independent of L38-A (selector gates rendering on `chapter > 1`; ch1 receives no prior-state surface). Chapter 2 was never reached, so the L38-A hypothesis cannot be evaluated from this run. Verified L38-A code is live on LXC (`priorChapterFacts` threading + `selectReaderInfoStateForBeat` import present in deployed `src/agents/writer/beat-context.ts` and `src/phases/drafting.ts`).
  - Deployed-code verification (LXC): `src/agents/writer/beat-context.ts` imports `selectReaderInfoStateForBeat`, declares `priorChapterFacts?: Fact[]`, and emits `readerInfoState`; `src/phases/drafting.ts` calls `getFactsUpToChapter(novelId, ch - 1)` at all three `buildBeatContext` call sites (lines 281, 637, 898).
  - Pivot to L41 baseline resume: `novel-1777721066908` already approved chapter 1 (8 facts established, phase=drafting, current_chapter=2) and previously bailed at chapter 2 with the exact prior-state continuity cluster L38-A targets. Resuming exercises the new code path on chapter 2 directly.
  - Resume launch: pre-deploy guard clean. `ssh novel-harness-lxc "EXPERIMENT_ID=369 nohup bun src/index.ts --resume novel-1777721066908 > /tmp/smoke-l38a-resume-l41-1777735397.log 2>&1 &"` → LXC PID 1128002. Confirmed drafting started: chapter 2, attempt 1/3, beats 1–7/15 at log tail.
  - Cost so far on lane: heretic novel $0.0332 + L41 baseline pre-existing $0.0462; well under $4 cap.
  - Pending: monitor resume run to chapter-2 outcome; classify stop gate (a)/(b)/(c) on the chapter-2 result.

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

- Last safe command: `ssh novel-harness-lxc "tail -80 /tmp/smoke-l38a-resume-l41-1777735397.log"` (cycle 3 launched L41 resume; LXC PID 1128002; novel-1777721066908; EXPERIMENT_ID=369).
- Heretic smoke (cycle-2 launch) outcome: `novel-1777734605735` bailed in chapter 1 with halluc-ungrounded blockers — independent of L38-A (selector gates `chapter > 1`). Reroute documented above.
- Next action: Monitor the L41 resume to chapter-2 completion. Tail the log; check `chapter_exhaustions WHERE novel_id='novel-1777721066908' AND chapter=2 AND attempt>=2` for the resumed attempt. Classify stop class — (a) clean ch2 pass / (b) new dominant blocker / (c) regression — then write Results + run `bun scripts/operator-summary.ts --latest`. If chapter 1 in heretic seed becomes a recurring obstacle for diverse-seed validation, queue a separate halluc-ungrounded investigation (out of L38-A scope). Cap at $4 per the lane contract.
