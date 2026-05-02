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
- 2026-05-02 (cycle 4): L41 paired-replay completed chapter 2 drafting with L38-A live; **hypothesis REFUTED on N=1 paired replay**. The dominant prior-state writer-conflation cluster persists despite the writer demonstrably receiving the prior-chapter established facts in its prompt.
  - Run outcome: `novel-1777721066908` chapter 2 attempt 1 exhausted with 4 continuity blockers; `chapter_exhaustions.id=83` (decision=null, plan-assist gate waiting in web UI).
  - Prompt-shape verification (paired): same novel, same chapter, same fact set, two runs.
    - Baseline beat-writer prompts (`llm_calls.id` 58205..58250, 11:32–11:36 UTC): no READER-INFO STATE section, prompt length ~2.4–2.6 KB.
    - Resume beat-writer prompts (`llm_calls.id` 58325..58371, 15:23–15:27 UTC): READER-INFO STATE section rendered at offset ~2.1–2.4 KB, prompt length ~3.2–3.5 KB. Section contains all 8 ch1 facts including "Maret has been secretly compiling a file on System anomalies for years", "A sealed report... copied by Maret months ago", "Maret's anomaly file is hidden under a loose floorboard", "Maret's stats displayed as false (Strength 3)".
  - Continuity-blocker comparison (paired):
    - Baseline (`chapter_exhaustions.id=81`, 5 blockers): Maret only-now-discovers stat override; Maret only-now-finds sealed report; searching temple archives instead of guildhall hidden file; summons specificity; Cassel observation (calluses vs ink smudges).
    - Resume with L38-A live (`id=83`, 4 blockers): Maret only-now-discovering override-was-deliberate; Maret only-now-learns override-was-deliberate (contradicts copied-months-ago); floorboard file referenced then contradicted by new-document-in-temple; Strength 27 vs Strength 3.
    - Overlap: blockers 1–2 are the *same writer-side prior-state conflation* the lane targeted. Blocker 3 is a near-identical conflation (file-already-existed vs found-anew). Blocker 4 (Strength 27/3) is a new internal-consistency error possibly induced by the new fact surface itself.
  - Classification: hypothesis substantively refuted. The writer can see the prior-state facts in its prompt and *still* drafts chapter 2 as if Maret is discovering the override and sealed report for the first time. Marginal blocker-count reduction (5→4) does not break the dominant cluster; one new pattern (Strength 27/3) suggests minor (c)-class regression risk but is not severe.
  - Stop-gate read: strict gates (a)(b)(c) do not cleanly fire on this run alone (heretic ch2-clean was the contracted oracle and heretic seeded into a different, ch1-only failure mode), but the paired N=1 evidence is sufficient to declare the L38-A causal hypothesis refuted. Per escalation rule, we do NOT queue L38-B because L38-A did not "remove writer-side conflation" — the precondition for the planner-side follow-up. Natural next direction is writer prompt-discipline / beat-level adherence to the new READER-INFO STATE surface (or model swap), not deeper context plumbing.
  - Cost so far on lane: ~$0.13 cumulative (well under $4 cap). Resume run added ~$0.05 across drafting + checks; plan-assist gate sits idle waiting in web UI.
  - Artifacts: `chapter_exhaustions.id` 81, 83 (paired baseline + L38-A); `llm_calls.id` 58325, 58371 (READER-INFO STATE in beat-writer prompt); `/tmp/smoke-l38a-resume-l41-1777735397.log` (LXC).

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-A-prior-context.md --actor <opencode|claude|supervisor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-A-prior-context.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-A-prior-context.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome: **Hypothesis REFUTED on N=1 paired replay.** L38-A renders prior-chapter established facts and per-character ignorance into the chapter-2 beat-writer prompt as designed, and the production code path is verified live on LXC. However, on the same L41 baseline novel that previously bailed at chapter 2 with the prior-state conflation cluster, a re-draft with L38-A live still bails at chapter 2 with the *same dominant cluster* (4 continuity blockers, 3 of which are the same writer-side prior-state conflations the lane targeted). The writer sees the facts and drafts as if it has not. Conclusion: missing prior-chapter context in writer beat input was not the dominant cause of the chapter-2 conflation cluster.
- Stop gate fired: None of (a)/(b)/(c) cleanly fires on this run; heretic-ch2 oracle bailed in chapter 1 (independent halluc-ungrounded cluster) and was not retried. Lane stops on durable evidence rather than gate text: paired-replay refutes the causal hypothesis. Per escalation rule, L38-B (planner-side scope narrowing) is **not** queued because L38-A did not remove writer-side conflation — the documented precondition. Recommended follow-up direction: writer prompt-discipline / beat-level adherence to READER-INFO STATE (or writer model swap), not deeper context plumbing. L38-C (chapter summary wiring) remains independently motivated and may still help, but not as a lane-A continuation.
- Evidence link/row/path: `chapter_exhaustions.id` 81 (baseline 5-blocker exhaustion) and 83 (L38-A live, 4-blocker exhaustion) on novel `novel-1777721066908`; paired beat-writer prompts at `llm_calls.id` 58205/58250 (no READER-INFO STATE) vs 58325/58371 (READER-INFO STATE rendered with all 8 ch1 facts); `/tmp/smoke-l38a-resume-l41-1777735397.log` on LXC; experiment row #369.
- Cost: ~$0.13 cumulative on lane (heretic ch1 bail $0.033 + L41 paired re-draft ~$0.05 + L41 baseline pre-existing $0.046). $4 cap untouched.
- Commit(s): `0f92be3` (cycle 1: L38-A runtime wiring); cycle-4 docs commit (this update).

## Pickup Instructions

- Lane state: hypothesis refuted on N=1 paired replay (cycle 4). Results section captures the durable finding; experiment #369 should be concluded with refuted-hypothesis outcome and the next lane queued.
- Outstanding cleanup: the L41 resume (LXC PID 1128002) is still parked at the plan-assist gate in the web UI on `chapter_exhaustions.id=83`. It can be safely orphaned — the chapter-2 evidence is already captured. Either resolve via the Studio plan-assist UI or update `chapter_exhaustions.decision='orphaned'` directly; no further drafting is needed for this lane.
- Next action: conclude experiment #369 (`harness.experiments.concludeExperiment(369, …)`) with hypothesis-refuted result; update `docs/decisions.md` with the L38-A finding (writer sees prior-chapter facts and still conflates → lane-A direction is closed; pivot to writer prompt-discipline / model-swap for the chapter-2 conflation cluster); remove L38-A from `docs/todo.md` if listed. Do not relaunch validation runs in this lane — the cluster is already characterized.
- Optional confirmation if more evidence is desired: a *second* paired-replay novel where chapter 1 has high-information prior-state facts (e.g. another L41-class novel) would tighten the N. Skip if the paired-replay finding is already sufficient.
- Out-of-lane signals worth tracking elsewhere: the heretic seed's chapter-1 halluc-ungrounded cluster (Beat 5 invented entities) is a separate finding; queue as its own investigation if it recurs across diverse seeds.
