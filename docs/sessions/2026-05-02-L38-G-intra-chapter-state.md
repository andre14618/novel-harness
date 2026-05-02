---
status: closed
updated: 2026-05-02
role: primary-lane-context
---

# L38-G Intra-Chapter State Consistency

## Loop Contract

- Objective: Fix the new chapter-2 intra-chapter physical-state contradiction surfaced after L38-F removed prior-state conflation.
- Starting commit: 6717592
- Experiment ID: 372
- Budget cap: $4 DeepSeek V4 Flash validation cap after local tests/replay; paired replay before any broad live smoke.
- Primary lane: L38-G intra-chapter physical-state consistency.
- Causal hypothesis: After READER-INFO adherence is fixed, the remaining chapter-2 blocker is caused by weak writer tracking of local physical evidence within the same chapter, such as Maret washing ink-smudged hands before Cassel later observes those smudges.
- Baseline: L38-F paired replay on `novel-1777721066908` removed all writer-side prior-state discovery/conflation blockers but chapter 2 still bailed on a new dominant intra-chapter consistency error: Maret washes her hands twice, removing smudges Cassel notes later in the same chapter.
- Changed runtime lever: Add the smallest writer-side local-state discipline or beat-context surface needed to preserve visible physical state across adjacent beats in a chapter.
- Feedback signal: Paired replay over `novel-1777721066908` chapter 2 has no hand-washing/smudge contradiction and no return of the prior-state conflation cluster.
- Stop gate: Stop on (a) paired replay removes the intra-chapter physical-state contradiction, (b) the contradiction is gone but a new dominant blocker appears, (c) writer quality/regression or prompt bloat worsens, (d) DB/deploy/provider evidence is unavailable, or (e) $4 cap is reached.
- Escalation rule: If a minimal prompt/state carryover rule fails, stop and queue a deterministic local-state extraction/checker lane rather than changing continuity severity or retry budget here.
- Allowed parallel support work: prompt-shape tests, paired replay helper work, docs-impact audit, operator summary, stale-gate cleanup for classified evidence rows, experiment conclusion, final docs sweep.
- DeepSeek V4 Flash concurrency plan: None before local/prompt tests pass. Use one paired replay on `novel-1777721066908` chapter 2 first; repeat only if the stop class is ambiguous and budget remains.
- Deferred out-of-lane runtime changes: planner prior-fact context, continuity checker calibration, retry budget changes, chapter summary revival, broad writer model routing.
- Files/scripts expected to change: beat-writer prompt files or beat-context local-state bridge tests; docs/current-state.md if runtime behavior changes.
- Evidence artifact: Experiment #372 plus focused test output, paired replay evidence, `chapter_exhaustions` comparison, and relevant `llm_calls` prompt/prose rows.
- Event log: output/agent-runs/2026-05-02-L38-G-intra-chapter-state/events.jsonl
- Dashboard command: bun scripts/agent/lane-dashboard.ts docs/sessions/2026-05-02-L38-G-intra-chapter-state.md --watch --latest-novel
- Runner command: bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L38-G-intra-chapter-state.md --engine claude --model opus --permission-mode auto --max-cycles 30 --max-hours 8 --queue docs/sessions/lane-queue.md

## Baseline

- Current behavior: L38-F removes prior-state conflation but leaves a same-chapter physical-state contradiction around Maret's ink-smudged hands.
- Baseline command(s): Review `docs/sessions/2026-05-02-L38-F-reader-info-adherence.md`; inspect latest `chapter_exhaustions` row from the L38-F paired replay; inspect beat-writer prose around the hand-washing/smudges sequence.
- Baseline result: New dominant blocker is intra-chapter physical-state inconsistency, not prior-chapter READER-INFO misuse.

## Stop Gates

- (a) Clean pass: paired replay removes the hand-washing/smudges physical-state contradiction without reviving prior-state conflation.
- (b) New dominant blocker: physical-state contradiction is gone but another checker/runtime cluster halts the replay.
- (c) Regression: prompt bloat, weaker prose, new halluc/adherence blockers, or prior-state conflation returns.
- (d) Infrastructure failure: DB, deploy, monitor, provider, or evidence queries prevent interpretation.
- (e) Cost cap: $4 validation cap reached before a readable stop class.

## Command Plan

- Sample shape / N: Local prompt/context tests first; one paired replay on `novel-1777721066908` chapter 2 after commit/deploy.
- Probe-family key or fixed panel: `L38-G-intra-chapter-state-ch2`.
- Expected cost: Local tests $0; first paired replay capped at $4.
- Command 1: `bun test <focused writer prompt/context tests>`
- Command 2: `bun scripts/preflight-docs-impact.ts --strict`
- Runner dry-run: `bun scripts/agent/lane-runner.ts docs/sessions/2026-05-02-L38-G-intra-chapter-state.md --engine claude --model opus --permission-mode auto --queue docs/sessions/lane-queue.md --dry-run`
- Verification command(s): `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L38-G-intra-chapter-state.md --json`; paired replay evidence via `bun scripts/operator-summary.ts novel-1777721066908` and targeted DB/prose inspection through repo helpers.

## Progress Log

- Pending. Queued from L38-F stop gate (b): prior-state conflation was removed, but a same-chapter physical-state contradiction became the next readable blocker.
- 2026-05-02 (cycle 2): Identified the failure mode from `chapter_exhaustions.id=84` and `llm_calls.id` 58378+58381. Beat 0 of ch2 wrote Maret entering with "the ink smudges scrubbed raw an hour ago" (clean hands). Beat 1's writer received only the last 3 sentences of beat 0 (chanting/footsteps — no hand-state) plus the planner brief "his gaze lingering on her hands" plus READER-INFO ch1 fact "Cassel noticed ink smudges on Maret's hands". The beat-1 writer then dramatized "the ink smudges" anew, contradicting beat 0. Per the lane escalation rule, shipped the smallest writer-side discipline first: a same-chapter physical-state continuity rule added to the beat-writer system prompt (and mirrored into the dormant Salvatore primer). The rule binds visible physical states (washed hands, bandages, drawn weapons, removed cloaks, food/drink, lit torches) across beats once a prior beat establishes them, and instructs the writer to prefer ambiguity over inventing a specific detail that earlier beats may already have changed.
  - Files: `src/agents/writer/beat-writer-system.md`, `src/agents/writer/beat-writer-system-salvatore.md`, `scripts/evals/writer-prompts.test.ts`.
  - Tests: `bun test scripts/evals/writer-prompts.test.ts src/agents/writer/ tests/beat-context-parity.test.ts` → 89 pass / 0 fail. `bunx tsc --noEmit` clean.
  - Pending: deploy + paired replay on `novel-1777721066908` chapter 2 to evaluate stop gates (a)/(b)/(c). Per escalation rule, if the rule alone fails to remove the contradiction (writer cannot comply because the prior beat's prose isn't visible to it), stop and queue a deterministic local-state extraction/checker lane.

## Heartbeat Commands

- Start/continue: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-G-intra-chapter-state.md --actor <opencode|claude|supervisor> --step "<current step>"`
- Blocked: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-G-intra-chapter-state.md --actor <actor> --type blocked --status blocked --message "<reason>"`
- Stop gate: `bun scripts/agent/lane-heartbeat.ts docs/sessions/2026-05-02-L38-G-intra-chapter-state.md --actor <actor> --type stop_gate --status stop --message "<gate + reason>"`

## Results

- Outcome: Pass. Same-chapter physical-state writer rule (commit a27a8a1) cleared the hand-washing/smudges contradiction. Paired replay of `novel-1777721066908` chapter 2 wrote 15/15 beats on attempt 1 (6806 words after edit), `Plan check: passed`, no new `chapter_exhaustions` row, and prior-state conflation cluster did not return. Beat 1 prose now has Maret enter with smudges intact; Cassel notes "the same smudges you bear now"; Maret covers with the iron-bars/ledger explanation rather than re-establishing washed hands.
- Stop gate fired: (a) clean pass — paired replay removes the intra-chapter physical-state contradiction without reviving prior-state conflation.
- Evidence link/row/path: LXC log `/tmp/smoke-l38g-resume-1777739195.log` (chapter 2 attempt 1 success, 15 beats, plan check passed; smudges/iron-bars exchange at lines ~252–255). Prior-state baseline: `chapter_exhaustions` rows 81/83/84 (all `orphaned`, with #84 isolating the hand-washing/smudges deviation).
- Cost: $0.1285 total for novel-1777721066908 (338 calls, 0 failed); incremental ch2 attempt-1 cost well under the $4 cap.
- Commit(s): a27a8a1 (writer rule), 19c74bf (cycle-2 progress doc), this finalization commit.

## Finalization Checklist

- Persistent docs updated: `docs/current-state.md`, `docs/todo.md`, `docs/decisions.md`, `docs/lessons-learned.md`, and this lane doc as applicable.
- Experiment concluded: `bun scripts/agent/conclude-experiment.ts --id 372 --conclusion "<summary>"`.
- Classified pending gates resolved as `orphaned` after dry-run, if any.
- Final checks run: `bun scripts/preflight-docs-impact.ts --strict`; `git diff --check`.
- Final docs/cleanup commit created before stop/queue handoff.

## Pickup Instructions

- Last safe command: `bun scripts/agent/lane-status.ts docs/sessions/2026-05-02-L38-G-intra-chapter-state.md --json`
- If failed, failure fingerprint: n/a (lane closed on stop gate (a)).
- Next action: Lane closed. Continue queue advancement; if a same-chapter physical-state contradiction recurs in a future replay despite the rule, queue a deterministic local-state extraction/checker lane per the original escalation rule rather than reopening this lane.
