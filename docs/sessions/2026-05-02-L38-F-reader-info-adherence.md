---
status: stopped
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
- 2026-05-02 (cycle 3): Deployed `b77d206` to LXC and ran paired replay on `novel-1777721066908` chapter 2. **Stop gates (a) and (b) both fire — hypothesis CONFIRMED**: the targeted prior-state writer-conflation cluster collapsed; the chapter still bailed but on a new dominant pattern unrelated to prior-state adherence.
  - Deploy: `bash scripts/deploy-lxc.sh` clean (orchestrator restarted, no active generation).
  - Resume launch: `EXPERIMENT_ID=370 nohup bun src/index.ts --resume novel-1777721066908 > /tmp/smoke-l38f-resume-l41-1777735497.log 2>&1 &` → LXC PID 1139515.
  - Prompt-shape verification (paired): same novel, same chapter, same fact set, three runs.
    - L41 baseline (`llm_calls.id` 58205..58250): no READER-INFO STATE.
    - L38-A live (`llm_calls.id` 58325..58371): READER-INFO STATE present, no binding rule in system prompt.
    - L38-F live (`llm_calls.id` 58378..; system_prompt 2960 chars; user_prompt READER-INFO STATE block at offset 2105): both the binding rule AND all 8 ch1 facts rendered in the chapter-2 beat-writer prompt.
  - Continuity-blocker comparison (paired):
    - Baseline (`chapter_exhaustions.id=81`, 5 blockers): 4 prior-state writer-conflation blockers (Maret discovering stat override; finding sealed report; searching wrong place; summons specificity) + 1 same-chapter Cassel-observation blocker.
    - L38-A live (`id=83`, 4 blockers): 3 prior-state writer-conflation blockers (Maret discovering override-deliberate ×2; floorboard file vs new document) + 1 internal-consistency blocker (Strength 27 vs 3).
    - L38-F live (`id=84`, 1 blocker): **0 prior-state writer-conflation blockers**; 1 intra-chapter blocker (Maret washes hands twice → smudges removed → contradicts Cassel noticing them in same chapter).
  - Classification: stop gate (a) fires — the dominant chapter-2 prior-state writer-conflation cluster L38-F targeted is gone. Stop gate (b) also fires — a new dominant blocker (intra-chapter hand-washing/evidence-removal) appears, but it is a separate failure mode (writer breaks an in-chapter fact, not a prior-chapter fact) and is queued separately. No (c) regression detected: prompt size grew ~0 (system prompt 2960 chars, no bloat), prose did not weaken, no new halluc/adherence pattern.
  - Cost on lane: $0.021 (resume run) on top of cycle-2 deploy. Total novel cumulative $0.0857. Well under $4 cap.
  - Artifacts: `chapter_exhaustions.id` 81/83/84 (paired baseline + L38-A + L38-F); `llm_calls.id` 58378+ for L38-F prompts; `/tmp/smoke-l38f-resume-l41-1777735497.log` on LXC; experiment row #370.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-F-reader-info-adherence.md --actor <opencode|claude|supervisor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-F-reader-info-adherence.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-F-reader-info-adherence.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome: **Hypothesis CONFIRMED on N=1 paired replay.** A single writer-side READER-INFO STATE binding rule in the beat-writer system prompt collapsed the chapter-2 prior-state writer-conflation cluster on `novel-1777721066908`. The cluster of "only-now-discovers" blockers that survived L38-A (writer sees facts but ignores them) is gone after the writer is told that "Reader already knows" lines are binding history for the POV character and any character who performed/witnessed/authored the listed action. Chapter 2 still bailed, but on a new dominant pattern (intra-chapter hand-washing/smudges contradiction) that is not prior-state conflation and is queued separately.
- Stop gate fired: (a) Clean pass on the targeted cluster — paired replay removed all writer-side prior-state discovery/conflation blockers; AND (b) New dominant blocker — intra-chapter consistency error (Maret washes hands twice in chapter 2, removing smudges that Cassel notes in the same chapter). No (c) regression: system prompt grew negligibly, no prose/adherence regression observed.
- Evidence link/row/path: `chapter_exhaustions.id` 81 (baseline 5-blocker), 83 (L38-A live 4-blocker), 84 (L38-F live 1-blocker, marked `decision='orphaned'` after classification) on `novel-1777721066908`; `llm_calls.id` 58378+ for L38-F chapter-2 beat-writer prompts (system prompt 2960 chars, READER-INFO STATE block at user_prompt offset 2105); `/tmp/smoke-l38f-resume-l41-1777735497.log` on LXC; experiment row #370.
- Cost: $0.021 resume run; cumulative on novel `novel-1777721066908` is $0.0857. $4 cap untouched.
- Commit(s): `d5c8e95` (cycle 2 runtime: writer-side binding rule); `b77d206` (cycle 2 progress doc); cycle-3 finalization commit (this doc + persistent doc updates).

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 370 --conclusion "<summary>"`.
- Classified pending gates resolved as `orphaned` after dry-run, if any.
- Final checks run: `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- Lane state: hypothesis CONFIRMED on N=1 paired replay (cycle 3). Stop gates (a) and (b) fired. Results captured; experiment #370 concluded with confirmed-hypothesis outcome; orphan gates #83/#84 cleaned up.
- Cleanup done: `chapter_exhaustions.id=84` set `decision='orphaned'` with classification reason. No active LXC generation remains.
- Next action: queue a new lane only if targeting the new dominant pattern — intra-chapter consistency (writer breaks facts established earlier in the same chapter, e.g. Maret washing hands removes the smudges Cassel notes). Do not relaunch validation runs in L38-F — the binding-rule effect on prior-state cluster is characterized.
- Optional confirmation if more evidence is desired: a *second* paired-replay novel where chapter 1 has high-information prior-state facts (e.g. another L41-class novel) would tighten N. Skip if the paired-replay finding is already sufficient.
- Out-of-lane signals worth tracking elsewhere: intra-chapter consistency (in-chapter fact rebinding) appears to be the new dominant blocker after prior-state is fixed. Heretic seed's chapter-1 halluc-ungrounded cluster (from L38-A cycle 3) remains a separate finding.
